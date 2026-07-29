const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

function circleRectangleCollision(circle, rectangle) {
  const closestX = clamp(circle.x, rectangle.x, rectangle.x + rectangle.width);
  const closestY = clamp(circle.y, rectangle.y, rectangle.y + rectangle.height);
  const dx = circle.x - closestX;
  const dy = circle.y - closestY;
  return dx * dx + dy * dy < circle.radius * circle.radius;
}

class ForgeGridGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.manifest = null;
    this.running = false;
    this.lastFrame = 0;
    this.score = 0;
    this.health = 100;
    this.status = "Ready";
    this.keys = new Set();
    this.pointer = { x: 0.75, y: 0.5, down: false };
    this.lastShot = 0;
    this.player = { x: 0.5, y: 0.5, radius: 0.018 };
    this.enemies = [];
    this.projectiles = [];
    this.animationFrame = null;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.bindInput();
  }

  setManifest(manifest) {
    this.manifest = manifest;
    this.reset();
    this.draw();
  }

  bindInput() {
    window.addEventListener("keydown", (event) => {
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
          event.code
        )
      ) {
        event.preventDefault();
      }
      this.keys.add(event.code);
      if (event.code === "Space") this.fireAtNearest();
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    this.canvas.addEventListener("pointermove", (event) => {
      const rectangle = this.canvas.getBoundingClientRect();
      this.pointer.x = (event.clientX - rectangle.left) / rectangle.width;
      this.pointer.y = (event.clientY - rectangle.top) / rectangle.height;
    });
    this.canvas.addEventListener("pointerdown", (event) => {
      this.canvas.setPointerCapture(event.pointerId);
      this.pointer.down = true;
    });
    this.canvas.addEventListener("pointerup", () => {
      this.pointer.down = false;
    });
    this.canvas.addEventListener("pointercancel", () => {
      this.pointer.down = false;
    });
    for (const control of document.querySelectorAll("[data-move]")) {
      const code = control.dataset.move;
      const press = (event) => {
        event.preventDefault();
        this.keys.add(code);
      };
      const release = (event) => {
        event.preventDefault();
        this.keys.delete(code);
      };
      control.addEventListener("pointerdown", press);
      control.addEventListener("pointerup", release);
      control.addEventListener("pointercancel", release);
      control.addEventListener("pointerleave", release);
    }
    document.querySelector("#touch-fire")?.addEventListener("click", () => {
      this.fireAtNearest();
    });
  }

  resize() {
    const rectangle = this.canvas.getBoundingClientRect();
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rectangle.width * scale));
    const height = Math.max(1, Math.round(rectangle.height * scale));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.draw();
    }
  }

  start() {
    if (!this.manifest) return;
    if (this.status === "Defeat" || this.status === "Arena clear") this.reset();
    this.running = true;
    this.status = "Playing";
    this.lastFrame = performance.now();
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = requestAnimationFrame((time) => this.loop(time));
    this.emitState();
  }

  pause() {
    this.running = false;
    this.status = "Paused";
    cancelAnimationFrame(this.animationFrame);
    this.emitState();
    this.draw();
  }

  reset() {
    this.running = false;
    this.score = 0;
    this.health = 100;
    this.status = "Ready";
    this.player = { x: 0.5, y: 0.5, radius: 0.018 };
    this.projectiles = [];
    this.lastShot = 0;
    this.spawnEnemies();
    this.emitState();
  }

  spawnEnemies() {
    if (!this.manifest) {
      this.enemies = [];
      return;
    }
    const count = this.manifest.enemy.count;
    this.enemies = Array.from({ length: count }, (_, index) => {
      const side = index % 4;
      const position = (index * 0.173 + 0.13) % 0.74 + 0.13;
      const coordinate = [
        { x: position, y: 0.055 },
        { x: 0.945, y: position },
        { x: position, y: 0.945 },
        { x: 0.055, y: position }
      ][side];
      return {
        ...coordinate,
        radius: this.manifest.enemy.health > 2 ? 0.025 : 0.019,
        health: this.manifest.enemy.health,
        flash: 0
      };
    });
  }

  loop(time) {
    if (!this.running) return;
    const delta = Math.min((time - this.lastFrame) / 1000, 0.04);
    this.lastFrame = time;
    this.update(delta, time);
    this.draw();
    this.animationFrame = requestAnimationFrame((next) => this.loop(next));
  }

  update(delta, time) {
    const direction = { x: 0, y: 0 };
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) direction.y -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) direction.y += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) direction.x -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) direction.x += 1;
    const magnitude = Math.hypot(direction.x, direction.y) || 1;
    this.movePlayer(
      (direction.x / magnitude) * delta * 0.28,
      (direction.y / magnitude) * delta * 0.28
    );

    if (this.pointer.down && time - this.lastShot >= this.manifest.weapon.fireInterval) {
      this.fire(this.pointer.x, this.pointer.y, time);
    }

    for (const projectile of this.projectiles) {
      projectile.x += projectile.vx * delta;
      projectile.y += projectile.vy * delta;
      projectile.life -= delta;
    }
    this.projectiles = this.projectiles.filter(
      (projectile) =>
        projectile.life > 0 &&
        projectile.x > 0 &&
        projectile.x < 1 &&
        projectile.y > 0 &&
        projectile.y < 1
    );

    const speed = this.manifest.enemy.speed / 1000;
    for (const enemy of this.enemies) {
      enemy.flash = Math.max(0, enemy.flash - delta);
      const dx = this.player.x - enemy.x;
      const dy = this.player.y - enemy.y;
      const distance = Math.hypot(dx, dy) || 1;
      enemy.x += (dx / distance) * speed * delta;
      enemy.y += (dy / distance) * speed * delta;
      if (distance < enemy.radius + this.player.radius) {
        this.health = Math.max(0, this.health - 24 * delta);
      }
    }

    for (const projectile of this.projectiles) {
      for (const enemy of this.enemies) {
        const distance = Math.hypot(
          projectile.x - enemy.x,
          projectile.y - enemy.y
        );
        if (!projectile.hit && distance < projectile.radius + enemy.radius) {
          projectile.hit = true;
          enemy.health -= projectile.damage;
          enemy.flash = 0.12;
        }
      }
    }
    const defeated = this.enemies.filter((enemy) => enemy.health <= 0).length;
    if (defeated > 0) {
      this.score += defeated * 100;
      this.enemies = this.enemies.filter((enemy) => enemy.health > 0);
    }
    this.projectiles = this.projectiles.filter((projectile) => !projectile.hit);

    if (this.health <= 0) {
      this.running = false;
      this.status = "Defeat";
      this.emitState();
    } else if (this.enemies.length === 0) {
      this.running = false;
      this.status = "Arena clear";
      this.emitState();
    } else {
      this.emitState();
    }
  }

  movePlayer(dx, dy) {
    const original = { x: this.player.x, y: this.player.y };
    this.player.x = clamp(this.player.x + dx, 0.035, 0.965);
    this.player.y = clamp(this.player.y + dy, 0.055, 0.945);
    for (const obstacle of this.manifest.obstacles) {
      if (circleRectangleCollision(this.player, obstacle)) {
        this.player.x = original.x;
        this.player.y = original.y;
        break;
      }
    }
  }

  fire(targetX, targetY, time = performance.now()) {
    const dx = targetX - this.player.x;
    const dy = targetY - this.player.y;
    const baseAngle = Math.atan2(dy, dx);
    const spread = this.manifest.weapon.spread;
    const angles = spread ? [-spread, 0, spread] : [0];
    const speed = this.manifest.weapon.projectileSpeed / 1000;
    for (const offset of angles) {
      const angle = baseAngle + offset;
      this.projectiles.push({
        x: this.player.x,
        y: this.player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 0.006,
        damage: this.manifest.weapon.damage,
        life: 1.6,
        hit: false
      });
    }
    this.lastShot = time;
  }

  fireAtNearest() {
    if (!this.running || this.enemies.length === 0) return;
    let nearest = this.enemies[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const enemy of this.enemies) {
      const distance = Math.hypot(
        enemy.x - this.player.x,
        enemy.y - this.player.y
      );
      if (distance < nearestDistance) {
        nearest = enemy;
        nearestDistance = distance;
      }
    }
    const now = performance.now();
    if (now - this.lastShot >= this.manifest.weapon.fireInterval) {
      this.fire(nearest.x, nearest.y, now);
    }
  }

  draw() {
    if (!this.manifest || !this.context) return;
    const context = this.context;
    const width = this.canvas.width;
    const height = this.canvas.height;
    const x = (value) => value * width;
    const y = (value) => value * height;
    const radius = (value) => value * Math.min(width, height);
    const theme = this.manifest.theme.palette;

    context.fillStyle = theme.floor;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = theme.grid;
    context.lineWidth = Math.max(1, width / 900);
    context.globalAlpha = 0.42;
    for (let index = 0; index <= 20; index += 1) {
      context.beginPath();
      context.moveTo((index / 20) * width, 0);
      context.lineTo((index / 20) * width, height);
      context.stroke();
    }
    for (let index = 0; index <= 13; index += 1) {
      context.beginPath();
      context.moveTo(0, (index / 13) * height);
      context.lineTo(width, (index / 13) * height);
      context.stroke();
    }
    context.globalAlpha = 1;

    context.fillStyle = theme.wall;
    for (const obstacle of this.manifest.obstacles) {
      context.fillRect(
        x(obstacle.x),
        y(obstacle.y),
        x(obstacle.width),
        y(obstacle.height)
      );
      context.strokeStyle = theme.accent;
      context.globalAlpha = 0.3;
      context.strokeRect(
        x(obstacle.x),
        y(obstacle.y),
        x(obstacle.width),
        y(obstacle.height)
      );
      context.globalAlpha = 1;
    }

    for (const hazard of this.manifest.hazards) {
      context.beginPath();
      context.fillStyle = theme.hazard;
      context.globalAlpha = 0.72;
      context.arc(x(hazard.x), y(hazard.y), radius(hazard.radius), 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
    }

    for (const projectile of this.projectiles) {
      context.beginPath();
      context.fillStyle = "oklch(92% 0.16 95)";
      context.arc(
        x(projectile.x),
        y(projectile.y),
        radius(projectile.radius),
        0,
        Math.PI * 2
      );
      context.fill();
    }

    for (const enemy of this.enemies) {
      context.beginPath();
      context.fillStyle =
        enemy.flash > 0
          ? "oklch(92% 0.03 55)"
          : "oklch(58% 0.2 31)";
      context.arc(
        x(enemy.x),
        y(enemy.y),
        radius(enemy.radius),
        0,
        Math.PI * 2
      );
      context.fill();
      context.strokeStyle = "oklch(30% 0.08 31)";
      context.lineWidth = Math.max(2, width / 420);
      context.stroke();
    }

    context.beginPath();
    context.fillStyle = "oklch(56% 0.18 255)";
    context.arc(
      x(this.player.x),
      y(this.player.y),
      radius(this.player.radius),
      0,
      Math.PI * 2
    );
    context.fill();
    context.strokeStyle = "oklch(94% 0.04 255)";
    context.lineWidth = Math.max(2, width / 360);
    context.stroke();

    const aimAngle = Math.atan2(
      this.pointer.y - this.player.y,
      this.pointer.x - this.player.x
    );
    context.beginPath();
    context.strokeStyle = "oklch(94% 0.04 255)";
    context.moveTo(x(this.player.x), y(this.player.y));
    context.lineTo(
      x(this.player.x) + Math.cos(aimAngle) * radius(0.04),
      y(this.player.y) + Math.sin(aimAngle) * radius(0.04)
    );
    context.stroke();

    if (!this.running) {
      context.fillStyle = "oklch(18% 0.02 65 / 0.68)";
      context.fillRect(0, 0, width, height);
      context.fillStyle = "oklch(96% 0.01 80)";
      context.textAlign = "center";
      context.font = `700 ${Math.max(18, width / 34)}px system-ui`;
      context.fillText(this.status, width / 2, height / 2 - 8);
      context.font = `500 ${Math.max(12, width / 62)}px system-ui`;
      context.fillText(
        this.status === "Ready"
          ? "Press Play, then move and fire"
          : "Press Play to try again",
        width / 2,
        height / 2 + Math.max(20, height / 18)
      );
    }
  }

  emitState() {
    document.dispatchEvent(
      new CustomEvent("forgegrid-game-state", {
        detail: {
          score: this.score,
          health: Math.round(this.health),
          enemies: this.enemies.length,
          status: this.status,
          running: this.running
        }
      })
    );
  }
}

const canvas = document.querySelector("#game-canvas");
export const game = canvas ? new ForgeGridGame(canvas) : null;
window.forgeGridGame = game;
