import { game } from "./game.js";

const state = {
  presets: null,
  selected: null,
  workers: [],
  currentBuild: null,
  currentManifest: null,
  eventSource: null,
  timelineSequences: new Set(),
  completedBuilds: [],
  workerBenchmark: null
};

const elements = {
  artifactLabel: document.querySelector("#artifact-label"),
  buildButton: document.querySelector("#build-game"),
  buildComparison: document.querySelector("#build-comparison"),
  buildId: document.querySelector("#build-id"),
  buildResult: document.querySelector("#build-result"),
  benchmarkBars: document.querySelector("#benchmark-bars"),
  benchmarkButton: document.querySelector("#run-worker-benchmark"),
  benchmarkInsight: document.querySelector("#benchmark-insight"),
  benchmarkStatus: document.querySelector("#benchmark-status"),
  benchmarkTitle: document.querySelector("#benchmark-title"),
  benchmarkWorkerCount: document.querySelector("#benchmark-worker-count"),
  cacheCount: document.querySelector("#cache-count"),
  clearCache: document.querySelector("#clear-cache"),
  comparisonBars: document.querySelector("#comparison-bars"),
  comparisonInsight: document.querySelector("#comparison-insight"),
  enemyOptions: document.querySelector("#enemy-options"),
  failureToggle: document.querySelector("#simulate-failure"),
  fleetHealth: document.querySelector("#fleet-health"),
  gameEnemies: document.querySelector("#game-enemies"),
  gameHealth: document.querySelector("#game-health"),
  gameScore: document.querySelector("#game-score"),
  gameTitle: document.querySelector("#game-title"),
  liveStatus: document.querySelector("#live-status"),
  metricCached: document.querySelector("#metric-cached"),
  metricElapsed: document.querySelector("#metric-elapsed"),
  metricExecuted: document.querySelector("#metric-executed"),
  metricRetries: document.querySelector("#metric-retries"),
  pauseGame: document.querySelector("#pause-game"),
  playGame: document.querySelector("#play-game"),
  resetPresets: document.querySelector("#reset-presets"),
  taskTable: document.querySelector("#task-table"),
  timeline: document.querySelector("#timeline"),
  weaponOptions: document.querySelector("#weapon-options"),
  workerList: document.querySelector("#worker-list"),
  worldOptions: document.querySelector("#world-options"),
  workflowSteps: [...document.querySelectorAll(".workflow-step")]
};

const EVENT_TYPES = [
  "build-created",
  "task-queued",
  "task-cached",
  "task-started",
  "task-progress",
  "task-completed",
  "task-requeued",
  "worker-failed",
  "build-failed",
  "build-completed"
];

async function request(pathname, options = {}) {
  const response = await fetch(pathname, {
    headers: {
      "content-type": "application/json",
      ...options.headers
    },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function announce(message) {
  elements.liveStatus.textContent = message;
}

function setWorkflow(step) {
  const names = ["customize", "build", "play"];
  const activeIndex = names.indexOf(step);
  elements.workflowSteps.forEach((element, index) => {
    element.classList.toggle("is-current", index === activeIndex);
    if (index === activeIndex) element.setAttribute("aria-current", "step");
    else element.removeAttribute("aria-current");
  });
}

function escapeText(value) {
  return String(value ?? "");
}

function formatDuration(milliseconds) {
  const value = Math.max(0, Number(milliseconds) || 0);
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function buildCounts(build) {
  const executed = build.tasks.filter(
    (task) => task.status === "completed"
  ).length;
  const cached = build.tasks.filter((task) => task.status === "cached").length;
  const retries = build.tasks.reduce(
    (total, task) => total + Math.max(0, (task.attempts || 0) - 1),
    0
  );
  return {
    executed: Math.max(executed, build.executedTasks || 0),
    cached: Math.max(cached, build.cacheHits || 0),
    retries: Math.max(retries, build.retriedTasks || 0)
  };
}

function renderBuildMetrics() {
  const build = state.currentBuild;
  if (!build) return;
  const elapsed =
    build.status === "running"
      ? Date.now() - Date.parse(build.startedAt)
      : build.durationMs;
  const counts = buildCounts(build);
  elements.metricElapsed.textContent = formatDuration(elapsed);
  elements.metricExecuted.textContent =
    `${counts.executed} / ${build.tasks.length}`;
  elements.metricCached.textContent = String(counts.cached);
  elements.metricRetries.textContent = String(counts.retries);
}

function sameConfig(first, second) {
  return ["world", "weapon", "enemies"].every(
    (field) => first.config[field] === second.config[field]
  );
}

function recordCompletedBuild(build) {
  if (state.completedBuilds.some((item) => item.id === build.id)) return;
  state.completedBuilds.push(build);
  state.completedBuilds = state.completedBuilds.slice(-6);
}

function comparisonRow({ label, durationMs, note, className }, maximum) {
  const row = document.createElement("div");
  row.className = `comparison-row${className ? ` ${className}` : ""}`;

  const name = document.createElement("span");
  name.className = "comparison-label";
  name.textContent = label;

  const track = document.createElement("span");
  track.className = "comparison-track";
  const fill = document.createElement("span");
  fill.className = "comparison-fill";
  fill.style.width =
    `${Math.max(0.8, (Math.max(1, durationMs) / maximum) * 100)}%`;
  track.append(fill);

  const value = document.createElement("span");
  value.className = "comparison-value";
  value.textContent = formatDuration(durationMs);

  const detail = document.createElement("span");
  detail.className = "comparison-note";
  detail.textContent = note;

  row.append(name, track, value, detail);
  return row;
}

function percentLess(faster, slower) {
  if (slower <= 0) return 0;
  return Math.max(0, ((slower - faster) / slower) * 100);
}

function updateBenchmarkSelection() {
  const workerCount = Number(elements.benchmarkWorkerCount.value);
  elements.benchmarkTitle.textContent =
    workerCount === 1
      ? "1 worker baseline"
      : `1 worker vs ${workerCount} workers`;
  if (state.workerBenchmark?.workerCount === workerCount) return;
  elements.benchmarkInsight.textContent = "Ready to measure";
  elements.benchmarkStatus.textContent =
    workerCount === 1
      ? "Runs one seven-task cold build with caching off to establish the baseline."
      : `Runs the same seven-task cold build with 1 worker and ${workerCount} workers. Caching stays off.`;
  elements.benchmarkBars.hidden = true;
}

function renderBuildComparison() {
  const current = state.completedBuilds[state.completedBuilds.length - 1];
  if (!current || state.currentBuild?.status === "running") {
    elements.buildComparison.hidden = true;
    return;
  }

  let executedBuild = current.executedTasks > 0 ? current : null;
  if (!executedBuild) {
    for (let index = state.completedBuilds.length - 2; index >= 0; index -= 1) {
      const candidate = state.completedBuilds[index];
      if (candidate.executedTasks > 0 && sameConfig(candidate, current)) {
        executedBuild = candidate;
        break;
      }
    }
  }
  if (!executedBuild) {
    elements.buildComparison.hidden = true;
    return;
  }

  const rows = [
    {
      label: "Cold build",
      durationMs: executedBuild.durationMs,
      note: `${executedBuild.executedTasks} tasks ran across 3 workers`,
      className: "is-distributed"
    }
  ];
  const cachedRebuild =
    current.id !== executedBuild.id &&
    sameConfig(executedBuild, current) &&
    current.cacheHits === current.tasks.length;
  if (cachedRebuild) {
    rows.push({
      label: "Cached rebuild",
      durationMs: current.durationMs,
      note: `${current.cacheHits} outputs reused, no build work reran`,
      className: "is-cached"
    });
  }

  const maximum = Math.max(1, ...rows.map((row) => row.durationMs));
  const reduction = cachedRebuild
    ? percentLess(current.durationMs, executedBuild.durationMs)
    : 0;
  const reductionLabel = reduction.toFixed(reduction > 99 ? 1 : 0);
  elements.comparisonInsight.textContent = cachedRebuild
    ? `${reductionLabel}% faster rebuild`
    : "Build again to test cache";
  elements.comparisonBars.replaceChildren(
    ...rows.map((row) => comparisonRow(row, maximum))
  );
  elements.comparisonBars.setAttribute(
    "aria-label",
    rows
      .map((row) => `${row.label}: ${formatDuration(row.durationMs)}.`)
      .join(" ") + ` ${elements.comparisonInsight.textContent}.`
  );
  elements.buildComparison.hidden = false;
}

function renderWorkerBenchmark() {
  const result = state.workerBenchmark;
  if (!result) return;
  const workerCount = result.workerCount;
  const rows = [
    {
      label: "1 worker",
      durationMs: result.oneWorker.elapsedMs,
      note:
        workerCount === 1
          ? "Measured cold-build baseline"
          : "Cold build with every task run in series",
      className: ""
    }
  ];
  if (workerCount > 1) {
    rows.push({
      label: `${workerCount} workers`,
      durationMs: result.selectedWorkers.elapsedMs,
      note: "Same cold build with independent tasks run in parallel",
      className: "is-distributed"
    });
  }
  const maximum = Math.max(...rows.map((row) => row.durationMs));
  elements.benchmarkBars.replaceChildren(
    ...rows.map((row) => comparisonRow(row, maximum))
  );
  elements.benchmarkBars.hidden = false;
  elements.benchmarkBars.setAttribute(
    "aria-label",
    rows
      .map((row) => `${row.label}: ${formatDuration(row.durationMs)}.`)
      .join(" ")
  );
  elements.benchmarkTitle.textContent =
    workerCount === 1
      ? "1 worker baseline"
      : `1 worker vs ${workerCount} workers`;
  if (workerCount === 1) {
    elements.benchmarkInsight.textContent = "Baseline measured";
    elements.benchmarkStatus.textContent =
      "This is the one-worker reference. Choose a higher count to measure parallel speedup.";
    return;
  }
  const improved = result.percentReduction > 0;
  elements.benchmarkInsight.textContent = improved
    ? `${result.speedup.toFixed(2)}× speedup`
    : "No local speedup on this run";
  const efficiency = `${result.efficiency.toFixed(0)}% worker efficiency.`;
  const limit =
    workerCount > 6
      ? " This graph has six parallel tasks, so extra workers wait for the final bundle."
      : "";
  elements.benchmarkStatus.textContent = improved
    ? `${result.percentReduction.toFixed(0)}% less time. ${efficiency} No cache or simulated delay was used.${limit}`
    : `${efficiency} The workers shared this computer's resources. No cache or simulated delay was used.${limit}`;
}

async function runWorkerBenchmark() {
  const workerCount = Number(elements.benchmarkWorkerCount.value);
  elements.benchmarkButton.disabled = true;
  elements.buildButton.disabled = true;
  elements.benchmarkWorkerCount.disabled = true;
  elements.benchmarkButton.textContent = "Measuring...";
  elements.benchmarkInsight.textContent =
    workerCount === 1 ? "Running cold baseline" : "Running both cold builds";
  elements.benchmarkStatus.textContent =
    workerCount === 1
      ? "Measuring the one-worker baseline. This takes a few seconds."
      : `First one worker, then ${workerCount} workers. This takes a few seconds.`;
  elements.benchmarkBars.hidden = true;
  announce(
    workerCount === 1
      ? "Running a real one-worker cold build."
      : `Running a real one-worker versus ${workerCount}-worker comparison.`
  );
  try {
    state.workerBenchmark = await request("/api/benchmark/workers", {
      method: "POST",
      body: JSON.stringify({ workerCount })
    });
    renderWorkerBenchmark();
    announce(
      workerCount === 1
        ? `One worker finished in ${formatDuration(state.workerBenchmark.oneWorker.elapsedMs)}.`
        : `${workerCount} workers finished ${state.workerBenchmark.percentReduction.toFixed(0)} percent sooner.`
    );
  } catch (error) {
    elements.benchmarkInsight.textContent = "Comparison could not run";
    elements.benchmarkStatus.textContent = error.message;
    announce(`Benchmark error: ${error.message}`);
  } finally {
    elements.benchmarkButton.disabled = false;
    elements.benchmarkWorkerCount.disabled = false;
    elements.buildButton.disabled =
      state.currentBuild?.status === "running";
    elements.benchmarkButton.textContent =
      state.workerBenchmark ? "Run again" : "Run experiment";
  }
}

function createChoice(group, option, checked) {
  const label = document.createElement("label");
  label.className = "choice";

  const input = document.createElement("input");
  input.type = "radio";
  input.name = group;
  input.value = option.id;
  input.checked = checked;
  input.addEventListener("change", () => {
    state.selected[group] = option.id;
    setWorkflow("customize");
    announce(`${option.name} selected for the next build.`);
  });

  const body = document.createElement("span");
  body.className = "choice-body";
  if (group === "world") {
    const swatch = document.createElement("span");
    swatch.className = "world-swatch";
    for (const color of [
      option.palette.floor,
      option.palette.wall,
      option.palette.hazard
    ]) {
      const part = document.createElement("i");
      part.style.background = color;
      swatch.append(part);
    }
    body.append(swatch);
  }
  const title = document.createElement("span");
  title.className = "choice-title";
  title.textContent = option.name;
  const description = document.createElement("span");
  description.className = "choice-description";
  description.textContent = option.description;
  body.append(title, description);
  label.append(input, body);
  return label;
}

function renderChoices() {
  const groups = [
    ["world", state.presets.worlds, elements.worldOptions],
    ["weapon", state.presets.weapons, elements.weaponOptions],
    ["enemies", state.presets.enemies, elements.enemyOptions]
  ];
  for (const [group, options, container] of groups) {
    container.replaceChildren(
      ...options.map((option) =>
        createChoice(group, option, state.selected[group] === option.id)
      )
    );
  }
}

function taskForWorker(worker) {
  return state.currentBuild?.tasks.find(
    (task) => task.id === worker.currentTaskId
  );
}

function renderWorkers() {
  if (state.workers.length === 0) return;
  const sorted = [...state.workers].sort((a, b) => a.id.localeCompare(b.id));
  elements.workerList.replaceChildren(
    ...sorted.map((worker) => {
      const task = taskForWorker(worker);
      const ticket = document.createElement("article");
      ticket.className = `worker-ticket is-${worker.status}`;

      const top = document.createElement("div");
      top.className = "worker-topline";
      const name = document.createElement("span");
      name.className = "worker-name";
      const icon = document.createElement("span");
      icon.className = "worker-icon";
      icon.textContent = worker.id.replace("worker-", "W");
      icon.setAttribute("aria-hidden", "true");
      name.append(icon, document.createTextNode(humanWorkerName(worker.id)));
      const status = document.createElement("span");
      status.className = "worker-status";
      status.textContent = worker.status;
      top.append(name, status);

      const taskBody = document.createElement("div");
      taskBody.className = "worker-task";
      const taskName = document.createElement("strong");
      taskName.textContent = task?.label || (
        worker.status === "offline" ? "Waiting for replacement" : "Available"
      );
      const taskStatus = document.createElement("span");
      taskStatus.textContent = task?.progressLabel || (
        worker.status === "offline"
          ? "The coordinator will requeue unfinished work"
          : "Ready to claim the next task"
      );
      taskBody.append(taskName, taskStatus);

      const track = document.createElement("div");
      track.className = "progress-track";
      const fill = document.createElement("span");
      fill.style.width = `${Math.round((task?.progress || 0) * 100)}%`;
      track.append(fill);

      const meta = document.createElement("div");
      meta.className = "worker-meta";
      const completed = document.createElement("span");
      completed.textContent = `${worker.completedTasks} finished`;
      const generation = document.createElement("span");
      generation.textContent = `generation ${worker.generation}`;
      meta.append(completed, generation);

      ticket.append(top, taskBody, track, meta);
      return ticket;
    })
  );
}

function humanWorkerName(workerId) {
  const number = workerId.replace("worker-", "");
  return `Worker ${number}`;
}

function mergeTask(updatedTask) {
  if (!state.currentBuild || !updatedTask) return;
  const index = state.currentBuild.tasks.findIndex(
    (task) => task.id === updatedTask.id
  );
  if (index >= 0) state.currentBuild.tasks[index] = updatedTask;
}

function renderTasks() {
  const build = state.currentBuild;
  if (!build) return;
  elements.buildId.textContent = build.id;
  elements.taskTable.replaceChildren(
    ...build.tasks.map((task) => {
      const row = document.createElement("tr");
      const taskCell = document.createElement("td");
      taskCell.textContent = task.label;
      const statusCell = document.createElement("td");
      const status = document.createElement("span");
      status.className = `task-state ${task.status}`;
      status.textContent = task.status;
      statusCell.append(status);
      const workerCell = document.createElement("td");
      workerCell.textContent = task.assignedWorker || (
        task.status === "cached" ? "cache" : "not assigned"
      );
      const durationCell = document.createElement("td");
      durationCell.textContent =
        task.durationMs === null ? "pending" : `${Math.round(task.durationMs)} ms`;
      const keyCell = document.createElement("td");
      const key = document.createElement("code");
      key.textContent = task.keyShort || "pending";
      keyCell.append(key);
      row.append(taskCell, statusCell, workerCell, durationCell, keyCell);
      return row;
    })
  );
}

function appendTimeline(event) {
  if (state.timelineSequences.has(event.sequence)) return;
  state.timelineSequences.add(event.sequence);
  elements.timeline.querySelector(".timeline-empty")?.remove();
  const item = document.createElement("li");
  const time = document.createElement("time");
  time.dateTime = event.timestamp;
  time.textContent = new Date(event.timestamp).toLocaleTimeString([], {
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 1
  });
  const message = document.createElement("span");
  message.textContent = event.message || event.type;
  item.append(time, message);
  elements.timeline.append(item);
  elements.timeline.scrollTop = elements.timeline.scrollHeight;
}

function setBuildResult(kind, title, description, icon) {
  elements.buildResult.className = `build-result ${kind ? `is-${kind}` : ""}`;
  elements.buildResult.replaceChildren();
  const symbol = document.createElement("span");
  symbol.className = "result-icon";
  symbol.textContent = icon;
  symbol.setAttribute("aria-hidden", "true");
  const copy = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = description;
  copy.append(heading, paragraph);
  elements.buildResult.append(symbol, copy);
}

function updateBuildSummary() {
  const build = state.currentBuild;
  if (!build) return;
  renderTasks();
  renderWorkers();
  renderBuildMetrics();
  renderBuildComparison();
  if (build.status === "completed") {
    const allCached = build.cacheHits === build.tasks.length;
    setBuildResult(
      "success",
      allCached ? "Ready from cache" : "Playable build completed",
      allCached
        ? `All ${build.cacheHits} tasks matched finished work.`
        : `${build.executedTasks} tasks ran, ${build.cacheHits} reused, ${build.retriedTasks} retried.`,
      "✓"
    );
  } else {
    const finished = build.tasks.filter((task) =>
      ["completed", "cached"].includes(task.status)
    ).length;
    setBuildResult(
      "building",
      "Building your game",
      `${finished} of ${build.tasks.length} tasks finished.`,
      "●"
    );
  }
}

async function refreshFleet() {
  try {
    const [systemState, health] = await Promise.all([
      request("/api/state"),
      request("/api/health")
    ]);
    state.workers = systemState.workers;
    elements.fleetHealth.classList.add("is-ready");
    elements.fleetHealth.lastChild.textContent =
      ` ${state.workers.filter((worker) => worker.status !== "offline").length} workers connected`;
    elements.cacheCount.textContent = `${health.cacheEntries} cached`;
    renderWorkers();
    const activeBuild = systemState.activeBuilds[0];
    if (activeBuild && state.currentBuild?.id !== activeBuild.id) {
      state.currentBuild = activeBuild;
      state.selected = { ...activeBuild.config };
      renderChoices();
      elements.buildButton.disabled = true;
      elements.benchmarkButton.disabled = true;
      elements.failureToggle.disabled = true;
      setWorkflow("build");
      updateBuildSummary();
      subscribeToBuild(activeBuild.id);
      announce("Reconnected to a build already in progress.");
    }
  } catch {
    elements.fleetHealth.classList.remove("is-ready");
    elements.fleetHealth.lastChild.textContent = " Coordinator unavailable";
  }
}

function finalizeBuild(build) {
  state.currentBuild = build;
  recordCompletedBuild(build);
  state.currentManifest = build.artifact.manifest;
  game?.setManifest(state.currentManifest);
  const checksum = build.artifact.checksum.slice(0, 12);
  elements.artifactLabel.textContent = `${build.id} · ${checksum}`;
  elements.gameTitle.textContent = state.currentManifest.theme.name;
  elements.buildButton.disabled = false;
  elements.benchmarkButton.disabled = false;
  elements.failureToggle.disabled = false;
  setWorkflow("play");
  updateBuildSummary();
  announce(
    build.cacheHits === build.tasks.length
      ? "The game was restored entirely from cache."
      : "The new playable game build is ready."
  );
  refreshFleet();
}

function subscribeToBuild(buildId) {
  state.eventSource?.close();
  const source = new EventSource(`/api/builds/${encodeURIComponent(buildId)}/events`);
  state.eventSource = source;

  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (messageEvent) => {
      const event = JSON.parse(messageEvent.data);
      appendTimeline(event);
      if (event.task) mergeTask(event.task);
      if (event.worker) {
        const index = state.workers.findIndex(
          (worker) => worker.id === event.worker.id
        );
        if (index >= 0) state.workers[index] = event.worker;
      }
      if (event.type === "build-completed") {
        source.close();
        finalizeBuild(event.build);
      } else if (event.type === "build-failed") {
        source.close();
        state.currentBuild = event.build;
        elements.buildButton.disabled = false;
        elements.benchmarkButton.disabled = false;
        elements.failureToggle.disabled = false;
        setBuildResult("error", "Build failed safely", event.message, "!");
        renderTasks();
        renderBuildMetrics();
        announce(event.message);
      } else {
        updateBuildSummary();
      }
    });
  }

  source.onerror = () => {
    if (
      state.currentBuild &&
      !["completed", "failed"].includes(state.currentBuild.status)
    ) {
      announce("The event stream was interrupted. Reconnecting.");
    }
  };
}

async function buildGame() {
  if (!state.selected || state.currentBuild?.status === "running") return;
  elements.buildButton.disabled = true;
  elements.benchmarkButton.disabled = true;
  elements.failureToggle.disabled = true;
  setWorkflow("build");
  elements.buildComparison.hidden = true;
  elements.metricElapsed.textContent = "0 ms";
  elements.metricExecuted.textContent = "0 / 7";
  elements.metricCached.textContent = "0";
  elements.metricRetries.textContent = "0";
  state.timelineSequences.clear();
  elements.timeline.innerHTML =
    '<li class="timeline-empty">Waiting for coordinator events.</li>';
  setBuildResult(
    "building",
    "Creating the build graph",
    "Fingerprinting your selected inputs.",
    "●"
  );
  announce("ForgeGrid is creating the build graph.");

  try {
    const build = await request("/api/builds", {
      method: "POST",
      body: JSON.stringify({
        ...state.selected,
        simulateFailure: elements.failureToggle.checked
      })
    });
    state.currentBuild = build;
    updateBuildSummary();
    if (build.status === "completed") {
      finalizeBuild(build);
    } else {
      subscribeToBuild(build.id);
    }
  } catch (error) {
    elements.buildButton.disabled = false;
    elements.benchmarkButton.disabled = false;
    elements.failureToggle.disabled = false;
    setBuildResult("error", "Build could not start", error.message, "!");
    announce(`Build error: ${error.message}`);
  }
}

async function clearCache() {
  elements.clearCache.disabled = true;
  try {
    await request("/api/cache/clear", { method: "POST", body: "{}" });
    await refreshFleet();
    announce("The build cache is empty. The next build will execute every task.");
  } catch (error) {
    announce(error.message);
  } finally {
    elements.clearCache.disabled = false;
  }
}

function resetChoices() {
  state.selected = { ...state.presets.defaults };
  renderChoices();
  setWorkflow("customize");
  announce("Build choices reset to the starter configuration.");
}

async function initialize() {
  try {
    const [presets, manifest] = await Promise.all([
      request("/api/presets"),
      request("/api/default-game")
    ]);
    state.presets = presets;
    state.selected = { ...presets.defaults };
    state.currentManifest = manifest;
    renderChoices();
    game?.setManifest(manifest);
    elements.gameTitle.textContent = manifest.theme.name;
    await refreshFleet();
    setInterval(refreshFleet, 900);
    setInterval(renderBuildMetrics, 100);
  } catch (error) {
    setBuildResult("error", "ForgeGrid could not start", error.message, "!");
    announce(`Initialization error: ${error.message}`);
  }
}

elements.buildButton.addEventListener("click", buildGame);
elements.benchmarkButton.addEventListener("click", runWorkerBenchmark);
elements.benchmarkWorkerCount.addEventListener(
  "change",
  updateBenchmarkSelection
);
elements.clearCache.addEventListener("click", clearCache);
elements.resetPresets.addEventListener("click", resetChoices);
elements.playGame.addEventListener("click", () => {
  game?.start();
  setWorkflow("play");
  announce("Game started. Use movement keys and fire at the enemies.");
});
elements.pauseGame.addEventListener("click", () => game?.pause());
elements.workflowSteps.forEach((step) => {
  step.addEventListener("click", () => {
    document.querySelector(`#${step.dataset.jump}`)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start"
    });
  });
});

document.addEventListener("forgegrid-game-state", (event) => {
  elements.gameHealth.textContent = escapeText(event.detail.health);
  elements.gameEnemies.textContent = escapeText(event.detail.enemies);
  elements.gameScore.textContent = escapeText(event.detail.score);
  elements.playGame.textContent =
    event.detail.status === "Paused" ? "Resume game" : (
      ["Defeat", "Arena clear"].includes(event.detail.status)
        ? "Play again"
        : "Play current build"
    );
});

initialize();
