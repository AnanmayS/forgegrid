import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ContentAddressedStore } from "./cas.js";
import { Coordinator } from "./coordinator.js";
import {
  DEFAULT_CONFIG,
  ENEMIES,
  publicPresets,
  WEAPONS,
  WORLDS
} from "./presets.js";
import { runWorkerComparison } from "../scripts/worker-comparison.js";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(CURRENT_DIR, "..");
const PUBLIC_ROOT = path.join(PROJECT_ROOT, "public");
const STATE_ROOT = path.join(PROJECT_ROOT, ".forgegrid");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  response.end(body);
}

function text(response, status, value) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(value)
  });
  response.end(value);
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("request body must be valid JSON");
  }
}

function defaultManifest() {
  return {
    version: 1,
    builtAt: null,
    config: DEFAULT_CONFIG,
    theme: WORLDS[DEFAULT_CONFIG.world],
    weapon: WEAPONS[DEFAULT_CONFIG.weapon],
    enemy: ENEMIES[DEFAULT_CONFIG.enemies],
    obstacles: [
      { id: "wall-1", x: 0.14, y: 0.18, width: 0.12, height: 0.06 },
      { id: "wall-2", x: 0.44, y: 0.12, width: 0.08, height: 0.12 },
      { id: "wall-3", x: 0.68, y: 0.22, width: 0.14, height: 0.05 },
      { id: "wall-4", x: 0.22, y: 0.6, width: 0.08, height: 0.13 },
      { id: "wall-5", x: 0.52, y: 0.66, width: 0.15, height: 0.06 }
    ],
    hazards: [
      { id: "hazard-1", x: 0.31, y: 0.36, radius: 0.018 },
      { id: "hazard-2", x: 0.73, y: 0.57, radius: 0.02 },
      { id: "hazard-3", x: 0.51, y: 0.42, radius: 0.014 }
    ],
    provenance: null
  };
}

function publicState(coordinator) {
  const activeBuilds = [...coordinator.builds.values()]
    .filter((build) => build.status === "running")
    .map((build) => coordinator.publicBuild(build));
  return {
    workers: coordinator.listWorkers(),
    activeBuilds
  };
}

export async function createForgeGridServer(options = {}) {
  const host = options.host || "127.0.0.1";
  const port = Number(options.port ?? 8000);
  const autoWorkers = options.autoWorkers !== false;
  const requestedWorkScale = Number(
    options.workScale ?? process.env.FORGEGRID_WORK_SCALE ?? 6
  );
  const workScale =
    Number.isFinite(requestedWorkScale) && requestedWorkScale > 0
      ? requestedWorkScale
      : 6;
  const benchmarkRunner = options.benchmarkRunner || runWorkerComparison;
  const benchmarkScale = Number(options.benchmarkScale ?? workScale);
  const store = new ContentAddressedStore(
    options.cacheRoot || path.join(STATE_ROOT, "cache")
  );
  const coordinator = new Coordinator({ store });
  await coordinator.initialize();
  await mkdir(PUBLIC_ROOT, { recursive: true });

  const children = new Map();
  let shuttingDown = false;
  let benchmarkRunning = false;
  const leaseMonitor = setInterval(() => {
    const cutoff = Date.now() - 3_000;
    for (const worker of coordinator.workers.values()) {
      if (worker.status !== "offline" && worker.lastSeen < cutoff) {
        coordinator.failWorker(worker.id, "Heartbeat lease expired");
      }
    }
  }, 1_000);
  leaseMonitor.unref();

  function spawnWorker(workerId) {
    if (shuttingDown || children.has(workerId)) return;
    const coordinatorUrl = `http://${host}:${server.address().port}`;
    const child = spawn(process.execPath, [path.join(CURRENT_DIR, "worker.js")], {
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        FORGEGRID_WORKER_ID: workerId,
        FORGEGRID_COORDINATOR_URL: coordinatorUrl,
        FORGEGRID_WORK_SCALE: String(workScale)
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    children.set(workerId, child);
    child.stderr.on("data", (chunk) => {
      process.stderr.write(`[${workerId}] ${chunk}`);
    });
    let handledExit = false;
    const handleExit = async (description) => {
      if (handledExit) return;
      handledExit = true;
      children.delete(workerId);
      await coordinator.failWorker(workerId, description);
      if (!shuttingDown) {
        setTimeout(() => spawnWorker(workerId), 180);
      }
    };
    child.once("error", (error) => {
      process.stderr.write(`[${workerId}] Could not start: ${error.message}\n`);
      handleExit(`Process could not start (${error.message})`);
    });
    child.once("exit", (code, signal) => {
      handleExit(`Process exited (${signal || code || "unknown"})`);
    });
  }

  const server = createServer(async (request, response) => {
    const requestUrl = new URL(
      request.url,
      `http://${request.headers.host || `${host}:${port}`}`
    );
    const pathname = decodeURIComponent(requestUrl.pathname);

    try {
      if (request.method === "GET" && pathname === "/api/health") {
        json(response, 200, {
          ok: true,
          service: "ForgeGrid coordinator",
          workers: coordinator.listWorkers().length,
          cacheEntries: await store.count()
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/presets") {
        json(response, 200, publicPresets());
        return;
      }

      if (request.method === "GET" && pathname === "/api/default-game") {
        json(response, 200, defaultManifest());
        return;
      }

      if (request.method === "GET" && pathname === "/api/state") {
        json(response, 200, publicState(coordinator));
        return;
      }

      if (request.method === "POST" && pathname === "/api/builds") {
        if (benchmarkRunning) {
          json(response, 409, {
            error: "wait for the worker comparison to finish"
          });
          return;
        }
        const input = await bodyJson(request);
        const build = await coordinator.createBuild(input, {
          simulateFailure: input.simulateFailure
        });
        json(response, 202, build);
        return;
      }

      if (request.method === "POST" && pathname === "/api/benchmark/workers") {
        const active = [...coordinator.builds.values()].some(
          (build) => build.status === "running"
        );
        if (active) {
          json(response, 409, {
            error: "wait for the active game build to finish"
          });
          return;
        }
        if (benchmarkRunning) {
          json(response, 409, {
            error: "the worker comparison is already running"
          });
          return;
        }
        benchmarkRunning = true;
        try {
          const result = await benchmarkRunner({
            workScale: benchmarkScale
          });
          json(response, 200, result);
        } finally {
          benchmarkRunning = false;
        }
        return;
      }

      const buildEventsMatch = pathname.match(
        /^\/api\/builds\/([^/]+)\/events$/
      );
      if (request.method === "GET" && buildEventsMatch) {
        const buildId = buildEventsMatch[1];
        const existing = coordinator.getBuildEvents(
          buildId,
          Number(requestUrl.searchParams.get("after") || 0)
        );
        if (!existing) {
          json(response, 404, { error: "build not found" });
          return;
        }
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        const send = (event) => {
          response.write(`id: ${event.sequence}\n`);
          response.write(`event: ${event.type}\n`);
          response.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        existing.forEach(send);
        if (
          existing.some((event) =>
            ["build-completed", "build-failed"].includes(event.type)
          )
        ) {
          response.end();
          return;
        }
        const listener = (event) => {
          send(event);
          if (["build-completed", "build-failed"].includes(event.type)) {
            setTimeout(() => response.end(), 100);
          }
        };
        coordinator.on(`build-event:${buildId}`, listener);
        const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 15_000);
        request.on("close", () => {
          clearInterval(keepAlive);
          coordinator.off(`build-event:${buildId}`, listener);
        });
        return;
      }

      const buildMatch = pathname.match(/^\/api\/builds\/([^/]+)$/);
      if (request.method === "GET" && buildMatch) {
        const build = coordinator.getBuild(buildMatch[1]);
        if (!build) {
          json(response, 404, { error: "build not found" });
          return;
        }
        json(response, 200, build);
        return;
      }

      if (request.method === "POST" && pathname === "/api/cache/clear") {
        const active = [...coordinator.builds.values()].some(
          (build) => build.status === "running"
        );
        if (active) {
          json(response, 409, { error: "wait for the active build to finish" });
          return;
        }
        await store.clear();
        json(response, 200, { ok: true, entries: 0 });
        return;
      }

      if (
        request.method === "POST" &&
        pathname === "/internal/workers/register"
      ) {
        const input = await bodyJson(request);
        json(
          response,
          200,
          await coordinator.registerWorker(input.id, input.metadata)
        );
        return;
      }

      const workerMatch = pathname.match(
        /^\/internal\/workers\/([^/]+)\/(next|heartbeat|progress|complete|fail)$/
      );
      if (workerMatch) {
        const workerId = workerMatch[1];
        const action = workerMatch[2];
        if (request.method === "GET" && action === "next") {
          const task = await coordinator.claimTask(workerId);
          if (!task) {
            response.writeHead(204);
            response.end();
          } else {
            json(response, 200, task);
          }
          return;
        }
        if (request.method === "POST") {
          const input = await bodyJson(request);
          if (action === "heartbeat") {
            json(response, 200, await coordinator.heartbeat(workerId));
          } else if (action === "progress") {
            json(
              response,
              200,
              await coordinator.reportProgress(
                workerId,
                input.taskId,
                input.progress,
                input.label
              )
            );
          } else if (action === "complete") {
            json(
              response,
              200,
              await coordinator.completeTask(
                workerId,
                input.taskId,
                input.output,
                input.durationMs
              )
            );
          } else if (action === "fail") {
            await coordinator.failTask(workerId, input.taskId, input.message);
            json(response, 200, { ok: true });
          } else {
            json(response, 405, { error: "method not allowed" });
          }
          return;
        }
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        json(response, 404, { error: "route not found" });
        return;
      }

      const relative = pathname === "/" ? "index.html" : pathname.slice(1);
      const resolved = path.resolve(PUBLIC_ROOT, relative);
      if (!resolved.startsWith(`${PUBLIC_ROOT}${path.sep}`)) {
        json(response, 403, { error: "invalid path" });
        return;
      }
      try {
        const content = await readFile(resolved);
        response.writeHead(200, {
          "content-type":
            MIME_TYPES[path.extname(resolved)] || "application/octet-stream",
          "content-length": content.byteLength,
          "cache-control": "no-cache"
        });
        if (request.method === "HEAD") response.end();
        else response.end(content);
      } catch (error) {
        if (error.code === "ENOENT") {
          text(response, 404, "Not found");
        } else {
          throw error;
        }
      }
    } catch (error) {
      json(response, 400, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  if (autoWorkers) {
    spawnWorker("worker-1");
    spawnWorker("worker-2");
    spawnWorker("worker-3");
  }

  async function close() {
    shuttingDown = true;
    clearInterval(leaseMonitor);
    for (const child of children.values()) child.kill("SIGTERM");
    children.clear();
    await new Promise((resolve) => server.close(resolve));
  }

  return {
    server,
    coordinator,
    store,
    close,
    address: `http://${host}:${server.address().port}`
  };
}

async function main() {
  const host = process.env.HOST || "127.0.0.1";
  const port = Number(process.env.PORT || process.argv[2] || 8000);
  const app = await createForgeGridServer({
    host,
    port,
    autoWorkers: process.env.FORGEGRID_AUTO_WORKERS !== "false"
  });
  console.log(`ForgeGrid is running at ${app.address}`);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
