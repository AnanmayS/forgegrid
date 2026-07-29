# Product

## Register

product

## Users

ForgeGrid is primarily for recruiters and software engineers evaluating a
student systems project. Many visitors will not know distributed build-system
terminology. They should be able to customize a small game, watch real work
move across several workers, play the resulting build, and understand the
benefit of caching without reading source code first.

Secondary users are systems-minded developers who want to inspect the build
graph, content hashes, scheduling decisions, failure recovery, benchmarks, and
tests.

## Product Purpose

ForgeGrid demonstrates a real distributed build and game-asset pipeline through
a playable browser experience. A visitor chooses a world, weapon, and enemy
profile; ForgeGrid turns those choices into script, shader, texture, audio,
level, navigation, and bundle tasks; workers execute those tasks concurrently;
the final artifact becomes a playable game.

Success means a nontechnical visitor understands the project in under a minute,
while a technical visitor can verify that progress, caching, and recovery are
driven by real backend state rather than decorative animation.

## Brand Personality

Tactile, playful, credible. ForgeGrid should feel like a well-used game studio
workbench: inviting enough to explore, precise enough to trust, and energetic
without becoming childish.

## Anti-references

ForgeGrid must not look like a cryptocurrency terminal, generic dark DevOps
dashboard, code editor with a game hidden behind it, identical SaaS card grid,
fake monitoring visualization, or overproduced game landing page. The build
animation must never invent progress or use arbitrary delays disconnected from
actual work.

## Design Principles

1. **Let people play first.** The built game is the clearest proof and receives
   the most visual space.
2. **Make invisible infrastructure legible.** Translate scheduling, cache hits,
   retries, and artifacts into plain language without removing their technical
   truth.
3. **Show real evidence.** Every worker state, duration, hash, and result comes
   from the running system.
4. **Reward repetition.** The second identical build should visibly teach why
   content-addressed caching matters.
5. **Progressive technical depth.** Recruiter-friendly explanations lead;
   architecture, metrics, and logs remain available for engineers.

## Accessibility & Inclusion

Target WCAG AA. All workflows must work with a keyboard, focus must remain
visible, status changes must be announced, and color cannot be the only carrier
of build state. Respect reduced-motion preferences. Maintain readable copy,
semantic controls, and responsive layouts from mobile through wide desktop.
