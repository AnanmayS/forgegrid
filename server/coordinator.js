import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { keyForTask, taskGraph } from "./task-definitions.js";
import { validateConfig } from "./presets.js";

const TERMINAL_TASK_STATES = new Set(["completed", "cached"]);

function nowIso() {
  return new Date().toISOString();
}

export class Coordinator extends EventEmitter {
  constructor({ store }) {
    super();
    this.store = store;
    this.builds = new Map();
    this.workers = new Map();
    this.queue = [];
    this.sequence = 0;
    this.lock = Promise.resolve();
  }

  async initialize() {
    await this.store.initialize();
  }

  async synchronized(operation) {
    let release;
    const previous = this.lock;
    this.lock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  async createBuild(input, options = {}) {
    return this.synchronized(async () => {
      const config = validateConfig(input);
      const buildId = `build-${randomUUID().slice(0, 8)}`;
      const startedAt = Date.now();
      const tasks = new Map(
        taskGraph(config).map((definition) => [
          definition.name,
          {
            ...definition,
            id: `${buildId}:${definition.name}`,
            buildId,
            status: "waiting",
            progress: 0,
            progressLabel: "Waiting for dependencies",
            assignedWorker: null,
            attempts: 0,
            key: null,
            output: null,
            durationMs: null,
            queuedAt: null,
            startedAt: null,
            completedAt: null
          }
        ])
      );
      const build = {
        id: buildId,
        config,
        status: "running",
        startedAt,
        completedAt: null,
        durationMs: null,
        events: [],
        tasks,
        cacheHits: 0,
        executedTasks: 0,
        retriedTasks: 0,
        simulateFailure: Boolean(options.simulateFailure),
        failureTriggered: false,
        artifact: null
      };
      this.builds.set(buildId, build);
      this.emitBuildEvent(build, "build-created", {
        message: "Build graph created",
        config
      });
      await this.advanceBuild(build);
      return this.publicBuild(build);
    });
  }

  async advanceBuild(build) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const task of build.tasks.values()) {
        if (task.status !== "waiting") continue;
        const dependencies = task.dependencies.map((name) => build.tasks.get(name));
        if (!dependencies.every((dependency) =>
          TERMINAL_TASK_STATES.has(dependency.status)
        )) {
          continue;
        }

        const dependencyKeys = dependencies.map((dependency) => dependency.key);
        task.key = keyForTask(task, dependencyKeys);
        if (await this.store.has(task.key)) {
          const cached = await this.store.get(task.key);
          task.status = "cached";
          task.progress = 1;
          task.progressLabel = "Reused finished work";
          task.output = cached.output;
          task.durationMs = 0;
          task.completedAt = Date.now();
          build.cacheHits += 1;
          this.emitBuildEvent(build, "task-cached", {
            task: this.publicTask(task),
            message: `Reused ${task.label} from the cache`
          });
        } else {
          task.status = "queued";
          task.progress = 0;
          task.progressLabel = "Ready for a worker";
          task.queuedAt = Date.now();
          this.queue.push(task);
          this.emitBuildEvent(build, "task-queued", {
            task: this.publicTask(task),
            message: `${task.label} is ready`
          });
        }
        changed = true;
      }
    }
    this.finishBuildIfReady(build);
  }

  finishBuildIfReady(build) {
    if (build.status !== "running") return;
    const tasks = [...build.tasks.values()];
    if (!tasks.every((task) => TERMINAL_TASK_STATES.has(task.status))) return;
    const bundle = build.tasks.get("bundle-game");
    build.status = "completed";
    build.completedAt = Date.now();
    build.durationMs = build.completedAt - build.startedAt;
    build.artifact = bundle.output;
    this.emitBuildEvent(build, "build-completed", {
      message:
        build.cacheHits === tasks.length
          ? "Everything matched the cache. The game was ready immediately."
          : "The playable game bundle is ready.",
      build: this.publicBuild(build)
    });
  }

  async registerWorker(workerId, metadata = {}) {
    return this.synchronized(async () => {
      if (
        typeof workerId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9-]{0,39}$/.test(workerId)
      ) {
        throw new Error("worker id must contain only letters, numbers, and hyphens");
      }
      const previous = this.workers.get(workerId);
      if (previous && previous.status !== "offline") {
        const previousInstance = previous.metadata?.instanceId;
        const nextInstance = metadata?.instanceId;
        if (
          previousInstance &&
          nextInstance &&
          previousInstance !== nextInstance
        ) {
          throw new Error("worker id is still leased to another process");
        }
        previous.lastSeen = Date.now();
        previous.metadata = metadata;
        return this.publicWorker(previous);
      }
      const worker = {
        id: workerId,
        status: "idle",
        currentTaskId: null,
        lastSeen: Date.now(),
        completedTasks: previous?.completedTasks ?? 0,
        generation: (previous?.generation ?? 0) + 1,
        metadata
      };
      this.workers.set(workerId, worker);
      this.emit("worker-event", {
        type: previous ? "worker-recovered" : "worker-registered",
        worker: this.publicWorker(worker),
        timestamp: nowIso()
      });
      return this.publicWorker(worker);
    });
  }

  async heartbeat(workerId) {
    return this.synchronized(async () => {
      const worker = this.requireWorker(workerId);
      worker.lastSeen = Date.now();
      return this.publicWorker(worker);
    });
  }

  async claimTask(workerId) {
    return this.synchronized(async () => {
      const worker = this.requireWorker(workerId);
      worker.lastSeen = Date.now();
      if (worker.currentTaskId) return null;

      let task = null;
      while (this.queue.length > 0 && !task) {
        const candidate = this.queue.shift();
        if (candidate.status === "queued") task = candidate;
      }
      if (!task) {
        worker.status = "idle";
        return null;
      }

      const build = this.builds.get(task.buildId);
      task.status = "running";
      task.progress = 0.03;
      task.progressLabel = "Worker accepted task";
      task.assignedWorker = workerId;
      task.attempts += 1;
      task.startedAt = Date.now();
      worker.status = "running";
      worker.currentTaskId = task.id;
      const terminateForDemo =
        build.simulateFailure &&
        !build.failureTriggered &&
        workerId === "worker-2";
      if (terminateForDemo) build.failureTriggered = true;

      const dependencyArtifacts = Object.fromEntries(
        task.dependencies.map((name) => [name, build.tasks.get(name).output])
      );
      this.emitBuildEvent(build, "task-started", {
        task: this.publicTask(task),
        worker: this.publicWorker(worker),
        message: `${workerId} started ${task.label}`
      });
      return {
        id: task.id,
        buildId: task.buildId,
        name: task.name,
        label: task.label,
        input: task.input,
        key: task.key,
        dependencyArtifacts,
        terminateForDemo
      };
    });
  }

  async reportProgress(workerId, taskId, progress, label) {
    return this.synchronized(async () => {
      const { worker, task, build } = this.requireAssignment(workerId, taskId);
      worker.lastSeen = Date.now();
      const numericProgress = Number(progress);
      if (!Number.isFinite(numericProgress)) {
        throw new Error("task progress must be a finite number");
      }
      task.progress = Math.max(task.progress, Math.min(0.98, numericProgress));
      task.progressLabel = String(label || "Working");
      this.emitBuildEvent(build, "task-progress", {
        task: this.publicTask(task),
        worker: this.publicWorker(worker),
        message: `${workerId}: ${task.progressLabel}`
      });
      return this.publicTask(task);
    });
  }

  async completeTask(workerId, taskId, output, durationMs) {
    return this.synchronized(async () => {
      const { worker, task, build } = this.requireAssignment(workerId, taskId);
      if (!output || typeof output !== "object") {
        throw new Error("worker output must be an object");
      }
      const numericDuration = Number(durationMs);
      if (!Number.isFinite(numericDuration) || numericDuration < 0) {
        throw new Error("task duration must be a non-negative number");
      }
      await this.store.put(task.key, {
        task: task.name,
        key: task.key,
        output,
        createdAt: nowIso()
      });
      task.status = "completed";
      task.progress = 1;
      task.progressLabel = "Completed";
      task.output = output;
      task.durationMs = Math.round(numericDuration);
      task.completedAt = Date.now();
      worker.status = "idle";
      worker.currentTaskId = null;
      worker.lastSeen = Date.now();
      worker.completedTasks += 1;
      build.executedTasks += 1;
      this.emitBuildEvent(build, "task-completed", {
        task: this.publicTask(task),
        worker: this.publicWorker(worker),
        message: `${workerId} completed ${task.label}`
      });
      await this.advanceBuild(build);
      return this.publicTask(task);
    });
  }

  async failTask(workerId, taskId, message) {
    return this.synchronized(async () => {
      const { worker, task, build } = this.requireAssignment(workerId, taskId);
      worker.status = "idle";
      worker.currentTaskId = null;
      task.assignedWorker = null;
      task.progress = 0;
      if (task.attempts >= 3) {
        task.status = "failed";
        task.progressLabel = "Failed after three attempts";
        build.status = "failed";
        build.completedAt = Date.now();
        build.durationMs = build.completedAt - build.startedAt;
        this.emitBuildEvent(build, "build-failed", {
          task: this.publicTask(task),
          worker: this.publicWorker(worker),
          message: `${task.label} failed three times: ${message}`,
          build: this.publicBuild(build)
        });
      } else {
        task.status = "queued";
        task.progressLabel = "Retrying after task error";
        build.retriedTasks += 1;
        this.queue.unshift(task);
        this.emitBuildEvent(build, "task-requeued", {
          task: this.publicTask(task),
          worker: this.publicWorker(worker),
          message: `${task.label} failed and was returned to the queue: ${message}`
        });
      }
    });
  }

  async failWorker(workerId, reason = "Worker disconnected") {
    return this.synchronized(async () => {
      const worker = this.workers.get(workerId);
      if (!worker || worker.status === "offline") return;
      worker.status = "offline";
      worker.lastSeen = Date.now();
      const task = worker.currentTaskId
        ? this.findTask(worker.currentTaskId)
        : null;
      worker.currentTaskId = null;
      if (task && task.status === "running") {
        const build = this.builds.get(task.buildId);
        task.assignedWorker = null;
        task.progress = 0;
        if (task.attempts >= 3) {
          task.status = "failed";
          task.progressLabel = "Failed after repeated worker loss";
          build.status = "failed";
          build.completedAt = Date.now();
          build.durationMs = build.completedAt - build.startedAt;
          this.emitBuildEvent(build, "build-failed", {
            task: this.publicTask(task),
            worker: this.publicWorker(worker),
            message: `${task.label} could not finish after three worker losses.`,
            build: this.publicBuild(build),
            reason
          });
        } else {
          task.status = "queued";
          task.progressLabel = "Requeued after worker loss";
          build.retriedTasks += 1;
          this.queue.unshift(task);
          this.emitBuildEvent(build, "worker-failed", {
            task: this.publicTask(task),
            worker: this.publicWorker(worker),
            message: `${workerId} stopped. ${task.label} was safely requeued.`,
            reason
          });
        }
      }
      this.emit("worker-event", {
        type: "worker-offline",
        worker: this.publicWorker(worker),
        reason,
        timestamp: nowIso()
      });
    });
  }

  requireWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) throw new Error(`worker ${workerId} is not registered`);
    return worker;
  }

  requireAssignment(workerId, taskId) {
    const worker = this.requireWorker(workerId);
    const task = this.findTask(taskId);
    if (!task || task.assignedWorker !== workerId || task.status !== "running") {
      throw new Error("task is not assigned to this worker");
    }
    return {
      worker,
      task,
      build: this.builds.get(task.buildId)
    };
  }

  findTask(taskId) {
    const separator = taskId.indexOf(":");
    if (separator === -1) return null;
    const build = this.builds.get(taskId.slice(0, separator));
    return build?.tasks.get(taskId.slice(separator + 1)) ?? null;
  }

  emitBuildEvent(build, type, payload) {
    const event = {
      sequence: ++this.sequence,
      type,
      buildId: build.id,
      timestamp: nowIso(),
      ...payload
    };
    build.events.push(event);
    this.emit("build-event", event);
    this.emit(`build-event:${build.id}`, event);
  }

  getBuild(buildId) {
    const build = this.builds.get(buildId);
    return build ? this.publicBuild(build) : null;
  }

  getBuildEvents(buildId, afterSequence = 0) {
    const build = this.builds.get(buildId);
    if (!build) return null;
    return build.events.filter((event) => event.sequence > afterSequence);
  }

  listWorkers() {
    return [...this.workers.values()].map((worker) => this.publicWorker(worker));
  }

  publicTask(task) {
    return {
      id: task.id,
      name: task.name,
      label: task.label,
      status: task.status,
      progress: task.progress,
      progressLabel: task.progressLabel,
      assignedWorker: task.assignedWorker,
      attempts: task.attempts,
      key: task.key,
      keyShort: task.key?.slice(0, 12) ?? null,
      durationMs: task.durationMs
    };
  }

  publicWorker(worker) {
    return {
      id: worker.id,
      status: worker.status,
      currentTaskId: worker.currentTaskId,
      completedTasks: worker.completedTasks,
      generation: worker.generation,
      lastSeen: new Date(worker.lastSeen).toISOString(),
      metadata: worker.metadata
    };
  }

  publicBuild(build) {
    return {
      id: build.id,
      config: build.config,
      status: build.status,
      startedAt: new Date(build.startedAt).toISOString(),
      completedAt: build.completedAt
        ? new Date(build.completedAt).toISOString()
        : null,
      durationMs: build.durationMs,
      cacheHits: build.cacheHits,
      executedTasks: build.executedTasks,
      retriedTasks: build.retriedTasks,
      simulateFailure: build.simulateFailure,
      failureTriggered: build.failureTriggered,
      tasks: [...build.tasks.values()].map((task) => this.publicTask(task)),
      artifact: build.artifact
    };
  }
}
