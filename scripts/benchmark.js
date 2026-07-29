import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { ContentAddressedStore } from "../server/cas.js";
import { Coordinator } from "../server/coordinator.js";
import { executeTask } from "../server/task-definitions.js";

async function driveBuild(coordinator, buildId, workScale) {
  const workers = ["bench-1", "bench-2", "bench-3"];
  while (coordinator.getBuild(buildId).status === "running") {
    const claimed = await Promise.all(
      workers.map(async (workerId) => ({
        workerId,
        task: await coordinator.claimTask(workerId)
      }))
    );
    const active = claimed.filter(({ task }) => task);
    if (active.length === 0) {
      throw new Error("build stalled with no claimable tasks");
    }
    await Promise.all(
      active.map(async ({ workerId, task }) => {
        const started = performance.now();
        const output = await executeTask(task, task.dependencyArtifacts, {
          workScale
        });
        await coordinator.completeTask(
          workerId,
          task.id,
          output,
          performance.now() - started
        );
      })
    );
  }
  return coordinator.getBuild(buildId);
}

async function measuredBuild(coordinator, config, workScale) {
  const started = performance.now();
  const created = await coordinator.createBuild(config);
  const completed =
    created.status === "completed"
      ? created
      : await driveBuild(coordinator, created.id, workScale);
  return {
    elapsedMs: performance.now() - started,
    build: completed
  };
}

const directory = await mkdtemp(path.join(os.tmpdir(), "forgegrid-benchmark-"));
try {
  const store = new ContentAddressedStore(directory);
  const coordinator = new Coordinator({ store });
  await coordinator.initialize();
  for (const workerId of ["bench-1", "bench-2", "bench-3"]) {
    await coordinator.registerWorker(workerId, { mode: "benchmark" });
  }

  const config = {
    world: "foundry",
    weapon: "pulse",
    enemies: "balanced"
  };
  const cold = await measuredBuild(coordinator, config, 0.3);
  const warm = await measuredBuild(coordinator, config, 0.3);
  const incremental = await measuredBuild(
    coordinator,
    { ...config, weapon: "rail" },
    0.3
  );

  console.log(
    JSON.stringify(
      {
        cold: {
          elapsedMs: Number(cold.elapsedMs.toFixed(2)),
          executedTasks: cold.build.executedTasks,
          cacheHits: cold.build.cacheHits
        },
        warm: {
          elapsedMs: Number(warm.elapsedMs.toFixed(2)),
          executedTasks: warm.build.executedTasks,
          cacheHits: warm.build.cacheHits
        },
        incremental: {
          elapsedMs: Number(incremental.elapsedMs.toFixed(2)),
          executedTasks: incremental.build.executedTasks,
          cacheHits: incremental.build.cacheHits
        },
        warmSpeedup: Number((cold.elapsedMs / warm.elapsedMs).toFixed(2))
      },
      null,
      2
    )
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
