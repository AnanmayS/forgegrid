import os from "node:os";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { executeTask } from "./task-definitions.js";

const workerId = process.env.FORGEGRID_WORKER_ID || `worker-${process.pid}`;
const workerInstanceId = randomUUID();
const coordinatorUrl =
  process.env.FORGEGRID_COORDINATOR_URL || "http://127.0.0.1:8000";
const requestedWorkScale = Number(process.env.FORGEGRID_WORK_SCALE || "6");
const workScale =
  Number.isFinite(requestedWorkScale) && requestedWorkScale > 0
    ? requestedWorkScale
    : 6;
let running = true;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function request(pathname, options = {}) {
  const response = await fetch(`${coordinatorUrl}${pathname}`, {
    signal: AbortSignal.timeout(4_000),
    headers: {
      "content-type": "application/json",
      ...options.headers
    },
    ...options
  });
  if (!response.ok && response.status !== 204) {
    const message = await response.text();
    throw new Error(`${response.status}: ${message}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function register() {
  await request("/internal/workers/register", {
    method: "POST",
    body: JSON.stringify({
      id: workerId,
      metadata: {
        hostname: os.hostname(),
        platform: os.platform(),
        architecture: os.arch(),
        pid: process.pid,
        instanceId: workerInstanceId
      }
    })
  });
}

async function heartbeat() {
  try {
    await request(`/internal/workers/${encodeURIComponent(workerId)}/heartbeat`, {
      method: "POST",
      body: "{}"
    });
  } catch {
    // The main polling loop handles coordinator outages and re-registration.
  }
}

async function perform(task) {
  const started = performance.now();
  const progress = async (value, label) => {
    await request(
      `/internal/workers/${encodeURIComponent(workerId)}/progress`,
      {
        method: "POST",
        body: JSON.stringify({ taskId: task.id, progress: value, label })
      }
    );
  };
  try {
    if (task.terminateForDemo) {
      await progress(0.18, "Fault injection armed");
      await wait(120);
      process.exit(86);
    }
    const output = await executeTask(task, task.dependencyArtifacts, {
      workScale,
      progress
    });
    await request(
      `/internal/workers/${encodeURIComponent(workerId)}/complete`,
      {
        method: "POST",
        body: JSON.stringify({
          taskId: task.id,
          output,
          durationMs: performance.now() - started
        })
      }
    );
  } catch (error) {
    try {
      await request(
        `/internal/workers/${encodeURIComponent(workerId)}/fail`,
        {
          method: "POST",
          body: JSON.stringify({
            taskId: task.id,
            message: error.message
          })
        }
      );
    } catch {
      // If the coordinator is gone, the task will be recovered by its lease.
    }
  }
}

async function main() {
  while (running) {
    try {
      await register();
      break;
    } catch {
      await wait(250);
    }
  }

  const heartbeatTimer = setInterval(heartbeat, 700);
  heartbeatTimer.unref();

  while (running) {
    try {
      const task = await request(
        `/internal/workers/${encodeURIComponent(workerId)}/next`
      );
      if (task) {
        await perform(task);
      } else {
        await wait(90);
      }
    } catch {
      await wait(300);
      try {
        await register();
      } catch {
        // Retry on the next loop.
      }
    }
  }
  clearInterval(heartbeatTimer);
}

process.on("SIGTERM", () => {
  running = false;
  process.exit(0);
});
process.on("SIGINT", () => {
  running = false;
  process.exit(0);
});

main().catch((error) => {
  console.error(`[${workerId}] ${error.stack || error.message}`);
  process.exitCode = 1;
});
