import { fork } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_CONFIG } from "../server/presets.js";
import { taskGraph } from "../server/task-definitions.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = path.join(CURRENT_DIR, "benchmark-worker.js");

function readyTask(tasks, states, outputs) {
  return tasks.find(
    (task) =>
      states.get(task.name) === "pending" &&
      task.dependencies.every((dependency) => outputs.has(dependency))
  );
}

export async function measureWorkerCount({
  config = DEFAULT_CONFIG,
  workerCount,
  workScale = 6
}) {
  const tasks = taskGraph(config);
  const states = new Map(tasks.map((task) => [task.name, "pending"]));
  const outputs = new Map();
  const durations = new Map();
  const children = [];
  const idle = new Set();
  let running = 0;
  let settled = false;
  let timeoutId = null;

  return new Promise((resolve, reject) => {
    let startedAt = null;

    const stopChildren = () => {
      for (const child of children) child.kill("SIGTERM");
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      stopChildren();
      reject(error);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      const elapsedMs = performance.now() - startedAt;
      stopChildren();
      resolve({
        workerCount,
        elapsedMs,
        tasks: tasks.map((task) => ({
          name: task.name,
          label: task.label,
          durationMs: durations.get(task.name)
        }))
      });
    };

    const schedule = () => {
      if (!startedAt || settled) return;
      for (const child of [...idle]) {
        const task = readyTask(tasks, states, outputs);
        if (!task) break;
        idle.delete(child);
        states.set(task.name, "running");
        running += 1;
        child.send({
          type: "run-task",
          task,
          workScale,
          dependencyArtifacts: Object.fromEntries(
            task.dependencies.map((name) => [name, outputs.get(name)])
          )
        });
      }
      if (outputs.size === tasks.length) {
        finish();
      } else if (running === 0 && idle.size === children.length) {
        fail(new Error("benchmark task graph stalled"));
      }
    };

    const startWhenReady = () => {
      if (!startedAt && idle.size === workerCount) {
        startedAt = performance.now();
        schedule();
      }
    };

    for (let index = 0; index < workerCount; index += 1) {
      const child = fork(WORKER_PATH, [], {
        execArgv: process.execArgv.filter(
          (argument) => !argument.startsWith("--input-type")
        ),
        stdio: ["ignore", "ignore", "inherit", "ipc"]
      });
      children.push(child);
      child.on("error", fail);
      child.on("exit", (code, signal) => {
        if (!settled) {
          fail(
            new Error(
              `benchmark worker exited before completion (${signal || code})`
            )
          );
        }
      });
      child.on("message", (message) => {
        if (message?.type === "ready") {
          idle.add(child);
          startWhenReady();
          return;
        }
        if (message?.type === "task-failed") {
          fail(new Error(`${message.taskName}: ${message.message}`));
          return;
        }
        if (message?.type !== "task-completed") return;
        states.set(message.taskName, "completed");
        outputs.set(message.taskName, message.output);
        durations.set(message.taskName, message.durationMs);
        running -= 1;
        idle.add(child);
        schedule();
      });
    }
    timeoutId = setTimeout(
      () => fail(new Error("worker comparison timed out after 60 seconds")),
      60_000
    );
    timeoutId.unref();
  });
}

export async function runWorkerComparison(options = {}) {
  const oneWorker = await measureWorkerCount({
    ...options,
    workerCount: 1
  });
  const threeWorkers = await measureWorkerCount({
    ...options,
    workerCount: 3
  });
  const reduction =
    ((oneWorker.elapsedMs - threeWorkers.elapsedMs) / oneWorker.elapsedMs) * 100;
  return {
    measuredAt: new Date().toISOString(),
    workScale: Number(options.workScale ?? 6),
    oneWorker,
    threeWorkers,
    percentReduction: Math.max(0, reduction),
    speedup: oneWorker.elapsedMs / threeWorkers.elapsedMs
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runWorkerComparison({
    workScale: Number(process.env.FORGEGRID_BENCHMARK_SCALE || 6)
  })
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.stack || error.message);
      process.exitCode = 1;
    });
}
