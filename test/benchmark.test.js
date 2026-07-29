import assert from "node:assert/strict";
import test from "node:test";
import { runWorkerComparison } from "../scripts/worker-comparison.js";

test(
  "worker comparison runs the same complete graph with one and three processes",
  { timeout: 15_000 },
  async () => {
    const result = await runWorkerComparison({ workScale: 0.01 });
    assert.equal(result.oneWorker.workerCount, 1);
    assert.equal(result.threeWorkers.workerCount, 3);
    assert.equal(result.oneWorker.tasks.length, 7);
    assert.deepEqual(
      result.oneWorker.tasks.map((task) => task.name),
      result.threeWorkers.tasks.map((task) => task.name)
    );
    assert.ok(
      result.oneWorker.tasks.every((task) => task.durationMs > 0),
      "every one-worker task should have a measured duration"
    );
    assert.ok(
      result.threeWorkers.tasks.every((task) => task.durationMs > 0),
      "every three-worker task should have a measured duration"
    );
    assert.ok(Number.isFinite(result.percentReduction));
    assert.ok(Number.isFinite(result.speedup));
  }
);
