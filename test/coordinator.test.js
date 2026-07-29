import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ContentAddressedStore } from "../server/cas.js";
import { Coordinator } from "../server/coordinator.js";
import { executeTask } from "../server/task-definitions.js";

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgegrid-build-"));
  const store = new ContentAddressedStore(directory);
  const coordinator = new Coordinator({ store });
  await coordinator.initialize();
  await coordinator.registerWorker("worker-1");
  await coordinator.registerWorker("worker-2");
  await coordinator.registerWorker("worker-3");
  return { directory, coordinator };
}

async function runUntilComplete(coordinator, buildId) {
  const workerIds = ["worker-1", "worker-2", "worker-3"];
  for (let guard = 0; guard < 20; guard += 1) {
    for (const workerId of workerIds) {
      const task = await coordinator.claimTask(workerId);
      if (!task) continue;
      const output = await executeTask(task, task.dependencyArtifacts, {
        workScale: 0.01
      });
      await coordinator.completeTask(workerId, task.id, output, 1);
    }
    const build = coordinator.getBuild(buildId);
    if (build.status === "completed") return build;
  }
  throw new Error("build did not complete");
}

test("build executes a dependency graph and then reuses its cache", async () => {
  const { directory, coordinator } = await setup();
  try {
    const first = await coordinator.createBuild({
      world: "foundry",
      weapon: "pulse",
      enemies: "balanced"
    });
    const completed = await runUntilComplete(coordinator, first.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.executedTasks, 7);
    assert.equal(completed.cacheHits, 0);
    assert.equal(completed.artifact.type, "game-bundle");
    assert.equal(completed.artifact.manifest.config.world, "foundry");

    const warm = await coordinator.createBuild({
      enemies: "balanced",
      weapon: "pulse",
      world: "foundry"
    });
    assert.equal(warm.status, "completed");
    assert.equal(warm.cacheHits, 7);
    assert.equal(warm.executedTasks, 0);
    assert.ok(warm.tasks.every((task) => task.status === "cached"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("changing one input invalidates only affected tasks and the bundle", async () => {
  const { directory, coordinator } = await setup();
  try {
    const first = await coordinator.createBuild({
      world: "glacier",
      weapon: "pulse",
      enemies: "balanced"
    });
    await runUntilComplete(coordinator, first.id);

    const changed = await coordinator.createBuild({
      world: "glacier",
      weapon: "rail",
      enemies: "balanced"
    });
    const completed = await runUntilComplete(coordinator, changed.id);
    assert.equal(completed.cacheHits, 3);
    assert.equal(completed.executedTasks, 4);
    assert.equal(
      completed.tasks.find((task) => task.name === "process-textures").status,
      "cached"
    );
    assert.equal(
      completed.tasks.find((task) => task.name === "package-level").status,
      "cached"
    );
    assert.equal(
      completed.tasks.find((task) => task.name === "generate-navigation").status,
      "cached"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("worker loss requeues its unfinished task for another worker", async () => {
  const { directory, coordinator } = await setup();
  try {
    const build = await coordinator.createBuild({
      world: "garden",
      weapon: "scatter",
      enemies: "swarm"
    });
    const claimed = await coordinator.claimTask("worker-1");
    assert.ok(claimed);
    await coordinator.failWorker("worker-1", "test failure");

    const recovered = await coordinator.claimTask("worker-2");
    assert.equal(recovered.id, claimed.id);
    const output = await executeTask(recovered, recovered.dependencyArtifacts, {
      workScale: 0.01
    });
    await coordinator.completeTask("worker-2", recovered.id, output, 1);

    const snapshot = coordinator.getBuild(build.id);
    assert.equal(snapshot.retriedTasks, 1);
    assert.equal(
      snapshot.tasks.find((task) => task.id === claimed.id).attempts,
      2
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failure demonstration is carried by the worker protocol and triggers once", async () => {
  const { directory, coordinator } = await setup();
  try {
    const build = await coordinator.createBuild(
      {
        world: "garden",
        weapon: "scatter",
        enemies: "swarm"
      },
      { simulateFailure: true }
    );
    const first = await coordinator.claimTask("worker-2");
    assert.equal(first.terminateForDemo, true);
    assert.equal(coordinator.getBuild(build.id).failureTriggered, true);

    await coordinator.failWorker("worker-2", "intentional demo exit");
    await coordinator.registerWorker("worker-2");
    const retry = await coordinator.claimTask("worker-2");
    assert.equal(retry.id, first.id);
    assert.equal(retry.terminateForDemo, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repeated task errors stop after three attempts", async () => {
  const { directory, coordinator } = await setup();
  try {
    const build = await coordinator.createBuild({
      world: "foundry",
      weapon: "pulse",
      enemies: "balanced"
    });

    const failingTask = await coordinator.claimTask("worker-1");
    assert.ok(failingTask);
    assert.ok(await coordinator.claimTask("worker-2"));
    assert.ok(await coordinator.claimTask("worker-3"));

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await coordinator.failTask(
        "worker-1",
        failingTask.id,
        `intentional failure ${attempt}`
      );
      if (attempt < 3) {
        const retry = await coordinator.claimTask("worker-1");
        assert.equal(retry.id, failingTask.id);
      }
    }

    const snapshot = coordinator.getBuild(build.id);
    assert.equal(snapshot.status, "failed");
    assert.equal(snapshot.retriedTasks, 2);
    assert.equal(
      snapshot.tasks.find((task) => task.status === "failed").attempts,
      3
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid worker identities and progress reports are rejected", async () => {
  const { directory, coordinator } = await setup();
  try {
    await assert.rejects(
      coordinator.registerWorker("../unsafe"),
      /letters, numbers, and hyphens/
    );
    const build = await coordinator.createBuild({
      world: "foundry",
      weapon: "pulse",
      enemies: "balanced"
    });
    const task = await coordinator.claimTask("worker-1");
    await assert.rejects(
      coordinator.reportProgress("worker-1", task.id, Number.NaN, "bad"),
      /finite number/
    );
    assert.equal(coordinator.getBuild(build.id).status, "running");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a restarted process cannot refresh the crashed process lease", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgegrid-lease-"));
  const store = new ContentAddressedStore(directory);
  const coordinator = new Coordinator({ store });
  await coordinator.initialize();
  try {
    await coordinator.registerWorker("worker-1", {
      instanceId: "instance-a"
    });
    await assert.rejects(
      coordinator.registerWorker("worker-1", {
        instanceId: "instance-b"
      }),
      /leased to another process/
    );
    await coordinator.failWorker("worker-1", "old process expired");
    const replacement = await coordinator.registerWorker("worker-1", {
      instanceId: "instance-b"
    });
    assert.equal(replacement.generation, 2);
    assert.equal(replacement.metadata.instanceId, "instance-b");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
