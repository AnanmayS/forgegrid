import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, css, app, game, launcher] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/game.js", import.meta.url), "utf8"),
  readFile(new URL("../start-forgegrid.command", import.meta.url), "utf8")
]);

test("primary recruiter flow is visible in the static interface", () => {
  assert.match(html, /Customize/);
  assert.match(html, /Build Game/);
  assert.match(html, /Play/);
  assert.match(html, /Build this game/);
  assert.match(html, /Demonstrate recovery/);
  assert.match(html, /Build the same choices again/);
  assert.match(html, /Current build measurements/);
  assert.match(html, /Worker scaling lab/);
  assert.match(html, /Choose 1 to 8 workers/);
  assert.match(html, /same seven-task cold\s+build/);
  assert.match(html, /id="benchmark-worker-count"/);
  assert.match(html, /seven build tasks, three workers/);
  assert.match(html, /Why caching helps/);
});

test("interface includes accessibility and responsive contracts", () => {
  assert.match(html, /class="skip-link"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label="Top-down arena game/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height: 44px/);
  assert.doesNotMatch(html, /—/);
});

test("build progress is event-driven and the game is interactive", () => {
  assert.match(app, /new EventSource/);
  assert.match(app, /task-progress/);
  assert.match(app, /renderBuildMetrics/);
  assert.match(app, /renderBuildComparison/);
  assert.match(app, /runWorkerBenchmark/);
  assert.match(app, /\/api\/benchmark\/workers/);
  assert.match(app, /efficiency/);
  assert.match(app, /workerCount/);
  assert.match(app, /percentLess/);
  assert.match(app, /cachedRebuild/);
  assert.match(app, /No cache or simulated delay was used/);
  assert.match(app, /no build work reran/);
  assert.match(app, /Reconnected to a build already in progress/);
  assert.doesNotMatch(app, /setTimeout/);
  assert.match(game, /requestAnimationFrame/);
  assert.match(game, /pointerdown/);
  assert.match(game, /ArrowUp/);
});

test("macOS launcher checks the installed Node major version", () => {
  assert.match(
    launcher,
    /node -p 'Number\(process\.versions\.node\.split\("\."\)\[0\]\)'/
  );
  assert.doesNotMatch(launcher, /split\(\\"/);
});
