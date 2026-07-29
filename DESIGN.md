# ForgeGrid Design System

## Direction

The interface uses the **Workshop** visual direction selected from the initial
probe. Picture a recruiter trying the project on a laptop at a career fair:
bright ambient light, limited time, curious but unfamiliar with build systems.
This forces a light interface with immediate hierarchy and high legibility.

The surface borrows from physical game-development workbenches, cutting mats,
build tickets, console-dev-kit labels, and friendly professional tools. It is
tactile but code-native; no bitmap mockup assets are required.

## Color Strategy

Committed light palette with warm mineral neutrals, cobalt as the primary
action color, orange for active build work, and green reserved for verified
success.

All implementation colors use OKLCH:

- Canvas: `oklch(95.5% 0.014 80)`
- Work surface: `oklch(98.5% 0.010 80)`
- Recessed surface: `oklch(91.5% 0.018 75)`
- Ink: `oklch(24% 0.025 65)`
- Muted ink: `oklch(48% 0.025 65)`
- Line: `oklch(79% 0.025 70)`
- Cobalt: `oklch(49% 0.18 255)`
- Cobalt hover: `oklch(42% 0.17 255)`
- Build orange: `oklch(67% 0.17 48)`
- Success: `oklch(55% 0.14 145)`
- Failure: `oklch(54% 0.18 28)`
- Cache blue: `oklch(63% 0.13 220)`

## Typography

Use the system sans stack for all interface copy and the system monospace stack
for hashes, durations, task identifiers, and build logs. Product typography
uses a fixed scale:

- Page title: 2rem / 1.05, 750
- Section title: 1.35rem / 1.15, 720
- Panel title: 1rem / 1.25, 700
- Body: 0.9375rem / 1.55, 450
- Label: 0.75rem / 1.25, 700, uppercase with measured tracking
- Data: 0.78rem / 1.45, monospace

Keep explanatory prose under 70 characters per line.

## Spatial System

Use a 4 px base rhythm. Major page sections use 32 to 48 px gaps; workbench
internals use 12 to 20 px. The desktop workspace is asymmetric:

- Main playable game and configuration: roughly two-thirds
- Worker/build bench: roughly one-third

At tablet width the build bench moves below the game. At mobile width all
controls form one column, and the game preserves a 16:10 aspect ratio.

## Surfaces and Components

- **Top workflow rail:** Customize, Build Game, Play. Standard buttons with a
  clear current step, not decorative cards.
- **Game viewport:** one dominant framed canvas with a compact HUD.
- **Preset strip:** three visually distinct environment choices with concise
  descriptions.
- **Worker ticket:** worker name, current task, status word, progress, and
  duration. A full border and subtle recessed background, never a colored side
  stripe.
- **Build timeline:** chronological event list generated from actual server
  events.
- **Evidence drawer:** cache key, input digest, output digest, worker, and
  duration for technical readers.
- **Status language:** queued, running, cached, completed, retrying, failed.
  Every state includes text and iconography in addition to color.

Controls have 44 px minimum targets, 6 px corner radii, visible focus rings,
and complete hover, active, disabled, loading, error, and success states.

## Motion

Use 160 to 220 ms ease-out transitions only for state changes. Worker progress
may interpolate between real progress events but must never advance beyond
reported backend state. Respect `prefers-reduced-motion` and avoid page-load
choreography.

## Game Visuals

The game is a small top-down arena rendered directly in Canvas. Environments
are procedural and code-native:

- Foundry: warm floor, barriers, ember hazards
- Glacier: cool floor, ice blocks, crystal hazards
- Garden: moss floor, hedges, seed-pod hazards

Characters use simple geometric silhouettes with clear team colors. This keeps
the project reproducible and focuses visual effort on gameplay clarity rather
than generated art.

## Copy

Lead with plain language. Prefer “Reused 3 finished tasks” over “3 CAS hits.”
Technical terms can appear alongside explanations in the evidence view. Never
use em dashes in UI copy.
