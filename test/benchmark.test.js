import assert from "node:assert/strict";
import test from "node:test";
import { runWorkerComparison } from "../scripts/worker-comparison.js";

test(
  "worker comparison runs the same complete graph with one and eight processes",
  { timeout: 15_000 },
  async () => {
    const result = await runWorkerComparison({
      workScale: 0.01,
      workerCount: 8
    });
    assert.equal(result.oneWorker.workerCount, 1);
    assert.equal(result.selectedWorkers.workerCount, 8);
    assert.equal(result.oneWorker.tasks.length, 7);
    assert.deepEqual(
      result.oneWorker.tasks.map((task) => task.name),
      result.selectedWorkers.tasks.map((task) => task.name)
    );
    assert.ok(
      result.oneWorker.tasks.every((task) => task.durationMs > 0),
      "every one-worker task should have a measured duration"
    );
    assert.ok(
      result.selectedWorkers.tasks.every((task) => task.durationMs > 0),
      "every selected-worker task should have a measured duration"
    );
    assert.ok(Number.isFinite(result.percentReduction));
    assert.ok(Number.isFinite(result.speedup));
    assert.ok(Number.isFinite(result.efficiency));
  }
);

test("worker comparison rejects counts outside one through eight", async () => {
  await assert.rejects(
    runWorkerComparison({ workScale: 0.01, workerCount: 9 }),
    /workerCount must be an integer from 1 through 8/
  );
});
