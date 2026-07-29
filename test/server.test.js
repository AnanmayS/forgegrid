import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createForgeGridServer } from "../server/server.js";

test("HTTP server exposes health, presets, game, and static interface", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "forgegrid-http-"));
  const app = await createForgeGridServer({
    port: 0,
    autoWorkers: false,
    cacheRoot: directory,
    benchmarkRunner: async () => ({
      oneWorker: { elapsedMs: 1_000 },
      threeWorkers: { elapsedMs: 440 },
      percentReduction: 56,
      speedup: 2.27
    })
  });
  try {
    const [health, presets, game, homepage, benchmark] = await Promise.all([
      fetch(`${app.address}/api/health`).then((response) => response.json()),
      fetch(`${app.address}/api/presets`).then((response) => response.json()),
      fetch(`${app.address}/api/default-game`).then((response) => response.json()),
      fetch(app.address).then((response) => response.text()),
      fetch(`${app.address}/api/benchmark/workers`, {
        method: "POST"
      }).then((response) => response.json())
    ]);
    assert.equal(health.ok, true);
    assert.equal(health.workers, 0);
    assert.equal(presets.worlds.length, 3);
    assert.equal(game.theme.id, "foundry");
    assert.match(homepage, /Build a game across a fleet of computers/);
    assert.equal(benchmark.percentReduction, 56);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "network workers complete a build and recover a killed worker",
  { timeout: 20_000 },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "forgegrid-network-"));
    const app = await createForgeGridServer({
      port: 0,
      autoWorkers: true,
      cacheRoot: directory,
      workScale: 1
    });
    try {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const health = await fetch(`${app.address}/api/health`).then((response) =>
          response.json()
        );
        if (health.workers === 3) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const createdResponse = await fetch(`${app.address}/api/builds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          world: "garden",
          weapon: "rail",
          enemies: "brutes",
          simulateFailure: true
        })
      });
      assert.equal(createdResponse.status, 202);
      const created = await createdResponse.json();

      let completed = null;
      const buildDeadline = Date.now() + 12_000;
      while (Date.now() < buildDeadline) {
        const snapshot = await fetch(
          `${app.address}/api/builds/${created.id}`
        ).then((response) => response.json());
        if (snapshot.status === "completed") {
          completed = snapshot;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
      assert.ok(completed, "network build should complete");
      assert.equal(completed.tasks.length, 7);
      assert.equal(completed.artifact.type, "game-bundle");
      assert.equal(completed.artifact.manifest.config.world, "garden");
      assert.equal(completed.failureTriggered, true);
      assert.ok(completed.retriedTasks >= 1, "worker loss should retry a task");

      const warmResponse = await fetch(`${app.address}/api/builds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          world: "garden",
          weapon: "rail",
          enemies: "brutes"
        })
      });
      const warm = await warmResponse.json();
      assert.equal(warm.status, "completed");
      assert.equal(warm.cacheHits, 7);

      const eventStream = await fetch(
        `${app.address}/api/builds/${warm.id}/events`,
        { signal: AbortSignal.timeout(2_000) }
      ).then((response) => response.text());
      assert.match(eventStream, /event: build-completed/);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
