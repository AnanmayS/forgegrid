import { createHash } from "node:crypto";
import { brotliCompressSync, constants, deflateSync } from "node:zlib";
import { digest } from "./canonical.js";
import { ENEMIES, WEAPONS, WORLDS } from "./presets.js";

export const TASK_VERSION = 5;

export function taskGraph(config) {
  return [
    {
      name: "compile-scripts",
      label: "Compile game scripts",
      input: { weapon: config.weapon, enemies: config.enemies },
      dependencies: []
    },
    {
      name: "compile-shaders",
      label: "Compile shaders",
      input: { world: config.world, weapon: config.weapon },
      dependencies: []
    },
    {
      name: "process-textures",
      label: "Process textures",
      input: { world: config.world },
      dependencies: []
    },
    {
      name: "process-audio",
      label: "Process game audio",
      input: { weapon: config.weapon, enemies: config.enemies },
      dependencies: []
    },
    {
      name: "package-level",
      label: "Package level",
      input: { world: config.world, enemies: config.enemies },
      dependencies: []
    },
    {
      name: "generate-navigation",
      label: "Generate navigation",
      input: { world: config.world, enemies: config.enemies },
      dependencies: []
    },
    {
      name: "bundle-game",
      label: "Bundle playable game",
      input: { config },
      dependencies: [
        "compile-scripts",
        "compile-shaders",
        "process-textures",
        "process-audio",
        "package-level",
        "generate-navigation"
      ]
    }
  ];
}

export function keyForTask(task, dependencyKeys = []) {
  return digest({
    version: TASK_VERSION,
    name: task.name,
    input: task.input,
    dependencies: [...dependencyKeys].sort()
  });
}

function hashBuffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function phase(progress, value, label) {
  if (progress) return progress(value, label);
  return Promise.resolve();
}

export async function executeTask(task, dependencyArtifacts, options = {}) {
  const requestedScale = Number(options.workScale ?? 1);
  const rounds = Math.max(
    1,
    Math.round(Number.isFinite(requestedScale) ? requestedScale : 1)
  );
  const progress = options.progress;

  if (task.name === "compile-scripts") {
    const weapon = WEAPONS[task.input.weapon];
    const enemy = ENEMIES[task.input.enemies];
    await phase(progress, 0.12, "Generating combat tables");
    const length = 1_100_000;
    const table = new Float64Array(length);
    for (let round = 0; round < rounds; round += 1) {
      for (let index = 0; index < length; index += 1) {
        const distance = (index % 1200) / 1200;
        table[index] =
          Math.sin(index * 0.013 + weapon.damage) *
          Math.exp(-distance * enemy.speed * 0.006);
      }
      const complete = (round + 1) / rounds;
      await phase(
        progress,
        0.12 + complete * 0.28,
        `Combat analysis ${Math.round(complete * 100)}%`
      );
    }
    let packed;
    for (let round = 0; round < rounds; round += 1) {
      packed = brotliCompressSync(Buffer.from(table.buffer), {
        params: { [constants.BROTLI_PARAM_QUALITY]: 5 }
      });
      const complete = (round + 1) / rounds;
      await phase(
        progress,
        0.42 + complete * 0.46,
        `Optimizer pass ${round + 1} of ${rounds}`
      );
    }
    await phase(progress, 0.9, "Verifying module output");
    return {
      type: "script-bundle",
      weapon,
      enemy,
      bytes: packed.byteLength,
      checksum: hashBuffer(packed)
    };
  }

  if (task.name === "compile-shaders") {
    const theme = WORLDS[task.input.world];
    const weapon = WEAPONS[task.input.weapon];
    await phase(progress, 0.1, "Expanding shader variants");
    const variants = new Uint32Array(1_500_000);
    for (let round = 0; round < rounds; round += 1) {
      let state = (weapon.damage * 2654435761) >>> 0;
      for (let index = 0; index < variants.length; index += 1) {
        state = (Math.imul(state ^ index, 1664525) + 1013904223) >>> 0;
        variants[index] = state ^ (index >>> 3);
      }
      const complete = (round + 1) / rounds;
      await phase(
        progress,
        0.1 + complete * 0.5,
        `Shader pass ${round + 1} of ${rounds}`
      );
    }
    let packed;
    for (let round = 0; round < rounds; round += 1) {
      packed = deflateSync(Buffer.from(variants.buffer), { level: 5 });
      const complete = (round + 1) / rounds;
      await phase(
        progress,
        0.62 + complete * 0.3,
        `Link pass ${round + 1} of ${rounds}`
      );
    }
    return {
      type: "shader-bundle",
      world: theme.id,
      weapon: weapon.id,
      bytes: packed.byteLength,
      checksum: hashBuffer(packed)
    };
  }

  if (task.name === "process-textures") {
    const theme = WORLDS[task.input.world];
    await phase(progress, 0.1, "Drawing procedural atlas");
    const side = 820;
    const pixels = Buffer.allocUnsafe(side * side * 4);
    for (let round = 0; round < rounds; round += 1) {
      for (let y = 0; y < side; y += 1) {
        for (let x = 0; x < side; x += 1) {
          const offset = (y * side + x) * 4;
          const grain = (x * 17 + y * 31 + ((x * y) % 29)) & 31;
          pixels[offset] = 72 + grain;
          pixels[offset + 1] = 84 + ((grain * 3) & 31);
          pixels[offset + 2] = 64 + ((grain * 5) & 31);
          pixels[offset + 3] = 255;
        }
      }
      const complete = (round + 1) / rounds;
      await phase(
        progress,
        0.1 + complete * 0.34,
        `Atlas render ${round + 1} of ${rounds}`
      );
    }
    let packed;
    for (let round = 0; round < rounds; round += 1) {
      packed = deflateSync(pixels, { level: 7 });
      const complete = (round + 1) / rounds;
      await phase(
        progress,
        0.48 + complete * 0.42,
        `Compression pass ${round + 1} of ${rounds}`
      );
    }
    await phase(progress, 0.92, "Writing texture manifest");
    return {
      type: "texture-atlas",
      theme,
      sourceBytes: pixels.byteLength,
      bytes: packed.byteLength,
      checksum: hashBuffer(packed)
    };
  }

  if (task.name === "process-audio") {
    const weapon = WEAPONS[task.input.weapon];
    const enemy = ENEMIES[task.input.enemies];
    await phase(progress, 0.1, "Synthesizing game audio");
    const samples = new Int16Array(1_500_000);
    for (let round = 0; round < rounds; round += 1) {
      for (let index = 0; index < samples.length; index += 1) {
        const carrier = Math.sin(index * 0.018 * weapon.damage);
        const envelope = 1 - ((index % 4096) / 4096);
        samples[index] = Math.round(
          carrier * envelope * (12_000 + enemy.speed * 30)
        );
      }
      const complete = (round + 1) / rounds;
      await phase(
        progress,
        0.1 + complete * 0.5,
        `Audio mix ${round + 1} of ${rounds}`
      );
    }
    let packed;
    for (let round = 0; round < rounds; round += 1) {
      packed = deflateSync(Buffer.from(samples.buffer), { level: 6 });
      const complete = (round + 1) / rounds;
      await phase(
        progress,
        0.62 + complete * 0.3,
        `Audio encode ${round + 1} of ${rounds}`
      );
    }
    return {
      type: "audio-bank",
      weapon: weapon.id,
      enemyStyle: enemy.id,
      bytes: packed.byteLength,
      checksum: hashBuffer(packed)
    };
  }

  if (task.name === "package-level") {
    await phase(progress, 0.1, "Generating arena geometry");
    const seed = Number.parseInt(
      digest(task.input).slice(0, 8),
      16
    );
    let state = seed >>> 0;
    const random = () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const sampleCount = 650_000;
    const sample = Buffer.allocUnsafe(sampleCount * 2);
    for (let round = 0; round < rounds; round += 1) {
      state = seed >>> 0;
      for (let index = 0; index < sampleCount; index += 1) {
        sample.writeUInt16LE(Math.floor(random() * 65535), index * 2);
      }
      const complete = (round + 1) / rounds;
      await phase(
        progress,
        0.1 + complete * 0.42,
        `Navigation pass ${round + 1} of ${rounds}`
      );
    }
    await phase(progress, 0.58, "Validating navigation space");
    const obstacles = [];
    while (obstacles.length < 14) {
      const obstacle = {
        x: 0.08 + random() * 0.78,
        y: 0.1 + random() * 0.72,
        width: 0.05 + random() * 0.08,
        height: 0.045 + random() * 0.07,
        id: `wall-${obstacles.length + 1}`
      };
      const coversSpawn =
        obstacle.x < 0.56 &&
        obstacle.x + obstacle.width > 0.44 &&
        obstacle.y < 0.59 &&
        obstacle.y + obstacle.height > 0.41;
      if (!coversSpawn) obstacles.push(obstacle);
    }
    const hazards = Array.from({ length: 7 }, (_, index) => ({
      x: 0.1 + random() * 0.8,
      y: 0.12 + random() * 0.7,
      radius: 0.012 + random() * 0.012,
      id: `hazard-${index + 1}`
    }));
    await phase(progress, 0.9, "Packaging level data");
    return {
      type: "level-package",
      seed,
      obstacles,
      hazards,
      checksum: hashBuffer(sample)
    };
  }

  if (task.name === "generate-navigation") {
    await phase(progress, 0.1, "Sampling navigation space");
    const seed = Number.parseInt(digest(task.input).slice(8, 16), 16);
    const field = new Uint32Array(1_800_000);
    for (let round = 0; round < rounds; round += 1) {
      let state = seed >>> 0;
      for (let index = 0; index < field.length; index += 1) {
        state = (Math.imul(state, 1103515245) + 12345) >>> 0;
        field[index] = state ^ Math.imul(index, 2246822519);
      }
      const complete = (round + 1) / rounds;
      await phase(
        progress,
        0.1 + complete * 0.65,
        `Pathfinding pass ${round + 1} of ${rounds}`
      );
    }
    await phase(progress, 0.8, "Compressing navigation mesh");
    const packed = deflateSync(Buffer.from(field.buffer), { level: 4 });
    await phase(progress, 0.94, "Verifying navigation mesh");
    return {
      type: "navigation-mesh",
      cells: field.length,
      bytes: packed.byteLength,
      checksum: hashBuffer(packed)
    };
  }

  if (task.name === "bundle-game") {
    await phase(progress, 0.15, "Collecting build artifacts");
    const gameplay = dependencyArtifacts["compile-scripts"];
    const shaders = dependencyArtifacts["compile-shaders"];
    const textures = dependencyArtifacts["process-textures"];
    const audio = dependencyArtifacts["process-audio"];
    const level = dependencyArtifacts["package-level"];
    const navigation = dependencyArtifacts["generate-navigation"];
    if (
      !gameplay ||
      !shaders ||
      !textures ||
      !audio ||
      !level ||
      !navigation
    ) {
      throw new Error("bundle task is missing a dependency");
    }
    const manifest = {
      version: 1,
      config: task.input.config,
      theme: textures.theme,
      weapon: gameplay.weapon,
      enemy: gameplay.enemy,
      obstacles: level.obstacles,
      hazards: level.hazards,
      provenance: {
        gameplay: gameplay.checksum,
        shaders: shaders.checksum,
        textures: textures.checksum,
        audio: audio.checksum,
        level: level.checksum,
        navigation: navigation.checksum
      }
    };
    await phase(progress, 0.65, "Writing playable manifest");
    const encoded = Buffer.from(JSON.stringify(manifest));
    const packed = brotliCompressSync(encoded);
    await phase(progress, 0.94, "Verifying final bundle");
    return {
      type: "game-bundle",
      manifest,
      bytes: packed.byteLength,
      checksum: hashBuffer(packed)
    };
  }

  throw new Error(`unsupported task ${task.name}`);
}
