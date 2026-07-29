import assert from "node:assert/strict";
import test from "node:test";
import {
  executeTask,
  keyForTask,
  taskGraph
} from "../server/task-definitions.js";

const config = {
  world: "foundry",
  weapon: "pulse",
  enemies: "balanced"
};

test("task keys are reproducible and dependency-sensitive", () => {
  const tasks = taskGraph(config);
  const gameplay = tasks.find((task) => task.name === "compile-scripts");
  const bundle = tasks.find((task) => task.name === "bundle-game");
  assert.equal(keyForTask(gameplay), keyForTask({ ...gameplay }));
  assert.notEqual(
    keyForTask(bundle, ["a", "b", "c"]),
    keyForTask(bundle, ["a", "b", "changed"])
  );
  assert.equal(
    keyForTask(bundle, ["c", "a", "b"]),
    keyForTask(bundle, ["a", "b", "c"])
  );
});

test("build workloads produce deterministic playable artifacts", async () => {
  const tasks = taskGraph(config);
  const outputs = {};
  for (const task of tasks.filter((task) => task.dependencies.length === 0)) {
    outputs[task.name] = await executeTask(task, {}, { workScale: 0.01 });
  }
  const bundle = tasks.find((task) => task.name === "bundle-game");
  const first = await executeTask(bundle, outputs, { workScale: 0.01 });
  const second = await executeTask(bundle, outputs, { workScale: 0.01 });
  assert.equal(first.checksum, second.checksum);
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(first.manifest.config.weapon, "pulse");
  assert.equal(first.manifest.obstacles.length, 14);
  assert.ok(
    first.manifest.obstacles.every(
      (obstacle) =>
        !(
          obstacle.x < 0.56 &&
          obstacle.x + obstacle.width > 0.44 &&
          obstacle.y < 0.59 &&
          obstacle.y + obstacle.height > 0.41
        )
    ),
    "generated walls should not cover the player spawn"
  );
});

test("showcase intensity changes work performed, not artifact identity", async () => {
  const level = taskGraph(config).find((task) => task.name === "package-level");
  const progress = [];
  const standard = await executeTask(level, {}, { workScale: 1 });
  const showcase = await executeTask(level, {}, {
    workScale: 2,
    progress: async (value) => progress.push(value)
  });

  assert.equal(showcase.checksum, standard.checksum);
  assert.deepEqual(showcase.obstacles, standard.obstacles);
  assert.deepEqual(showcase.hazards, standard.hazards);
  assert.ok(progress.length >= 4);
  assert.ok(
    progress.every(
      (value, index) => index === 0 || value >= progress[index - 1]
    )
  );
});
