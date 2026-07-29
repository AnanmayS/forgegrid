export const WORLDS = {
  foundry: {
    id: "foundry",
    name: "Foundry Run",
    description: "Hot floor, steel barriers, ember hazards.",
    palette: {
      floor: "oklch(47% 0.035 65)",
      grid: "oklch(55% 0.04 65)",
      wall: "oklch(29% 0.025 65)",
      hazard: "oklch(64% 0.19 42)",
      accent: "oklch(78% 0.15 78)"
    }
  },
  glacier: {
    id: "glacier",
    name: "Crystal Divide",
    description: "Icy lanes, crystal blocks, slippery space.",
    palette: {
      floor: "oklch(72% 0.065 210)",
      grid: "oklch(81% 0.055 210)",
      wall: "oklch(42% 0.07 215)",
      hazard: "oklch(82% 0.12 205)",
      accent: "oklch(95% 0.035 205)"
    }
  },
  garden: {
    id: "garden",
    name: "Overgrown Outpost",
    description: "Mossy paths, hedge walls, seed-pod hazards.",
    palette: {
      floor: "oklch(57% 0.07 125)",
      grid: "oklch(65% 0.07 125)",
      wall: "oklch(34% 0.065 135)",
      hazard: "oklch(73% 0.14 78)",
      accent: "oklch(88% 0.11 118)"
    }
  }
};

export const WEAPONS = {
  pulse: {
    id: "pulse",
    name: "Pulse Carbine",
    description: "Fast, forgiving, steady damage.",
    fireInterval: 190,
    damage: 1,
    projectileSpeed: 520,
    spread: 0
  },
  scatter: {
    id: "scatter",
    name: "Scatter Blaster",
    description: "Three projectiles at close range.",
    fireInterval: 520,
    damage: 1,
    projectileSpeed: 430,
    spread: 0.2
  },
  rail: {
    id: "rail",
    name: "Rail Driver",
    description: "Slow shots that hit hard.",
    fireInterval: 760,
    damage: 3,
    projectileSpeed: 760,
    spread: 0
  }
};

export const ENEMIES = {
  balanced: {
    id: "balanced",
    name: "Balanced",
    description: "A readable mix of speed and pressure.",
    count: 8,
    speed: 62,
    health: 2
  },
  swarm: {
    id: "swarm",
    name: "Swarm",
    description: "More enemies with less health.",
    count: 15,
    speed: 78,
    health: 1
  },
  brutes: {
    id: "brutes",
    name: "Heavy Units",
    description: "Fewer enemies that take more hits.",
    count: 5,
    speed: 45,
    health: 5
  }
};

export const DEFAULT_CONFIG = {
  world: "foundry",
  weapon: "pulse",
  enemies: "balanced"
};

export function validateConfig(input) {
  const config = {
    world: input?.world,
    weapon: input?.weapon,
    enemies: input?.enemies
  };
  if (!WORLDS[config.world]) throw new Error("unknown world preset");
  if (!WEAPONS[config.weapon]) throw new Error("unknown weapon preset");
  if (!ENEMIES[config.enemies]) throw new Error("unknown enemy preset");
  return config;
}

export function publicPresets() {
  return {
    worlds: Object.values(WORLDS),
    weapons: Object.values(WEAPONS),
    enemies: Object.values(ENEMIES),
    defaults: DEFAULT_CONFIG
  };
}
