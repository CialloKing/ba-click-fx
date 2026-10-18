# Core module responsibilities

`fx.js` remains the public entry. `engine-core.js` owns instance construction, public methods, host integration, and frame scheduling. Internal exports support source collaboration only; they add no npm export paths or type declarations.

| Module | Responsibility |
|---|---|
| `engine-math.js` | Numeric and color interpolation, Hermite curves, and region bounds |
| `engine-render-state.js` | Shared scope for the current theme, gradient energy, and per-frame ring samples |
| `engine-materials.js` | Theme mapping, linear energy, Canvas encoding, and compositing helpers |
| `engine-canvas-textures.js` | Circle/triangle textures, tint workspaces, LUTs, lightweight ownership, and idle reclamation |
| `engine-canvas-primitives.js` | Canvas drawing and sampling for disks, rings, shards, Hit, and Flare |
| `engine-particles.js` | ClickWave, ShardParticle, and shard generation rules |
| `engine-trail-geometry.js` | Trail length, duplicate points, reversals, mesh joins, and the four-entry mesh cache |
| `engine-trail.js` | Per-stroke workspaces, material sampling, Canvas drawing, and GPU geometry submission |
| `engine-effects.js` | Particle generation, time advancement, collection updates, and stroke workspace management |
| `engine-render.js` | Software Bloom, GPU Scene, fallback Canvas, alpha finalization, and failure recovery |

Dependencies flow from basic calculations and state through materials/textures, particles/trails, and render passes to the entry. Internal modules never import the entry. Existing input, backend, lifecycle, and configuration layers retain their responsibilities. The inheritance chain ends with `ConfigRuntime → EffectRuntime → RenderRuntime → BAClickFX`. The two new layers have no constructors; the entry initializes instance fields in their original order without runtime method injection.

## Shared state and resources

- The frame entry and context-loss fallback save four previous state values and restore them at the original `finally` locations. Ordinary frames allocate no state snapshot object. Synchronous reentry restores the outer theme and sample cache; exception cleanup retains its ordering relative to Canvas `restore()`.
- Canvas caches register only `{ closed, visible }` markers, never engine instances. Bitmap identity, failure markers, the 30-second idle window, visible paused frames, and reclamation after the outermost draw remain unchanged.
- Each stroke owns its trail workspace. Measurement arrays, mesh pools, and the four-entry mesh cache remain reusable. Only nested frames temporarily isolate workspaces, releasing temporary data and restoring the outer data on exit.
- Dynamic GPU/CPU geometry capacity, growth, reclamation, and restoration paths are unchanged. Capacity counters describe registered storage, not process memory or actual VRAM.

## Builds and diagnostics

`scripts/engine-module-list.js` is the explicit manifest shared by custom compilation and diagnostics. `engine-source.mjs` statically expands functions and responsibility classes, merges imports while checking name collisions, then runs the existing constant substitution, capability pruning, and particle/Renderer method reachability analysis. Full builds use native ESM dependencies; published builds remain self-contained single files.

`scripts/engine-fixture.js` creates isolated module copies for probes requiring counters or private state. Each internal module has one identity within a copied graph, so the engine and probe access the same cache. Node and browser/Worker probes share the dependency rewriting implementation. Probes are excluded from published artifacts.

Use `npm run check:fast` for daily work and `npm run check:release` before publishing. Module boundaries, pixel goldens, lifecycle, failures, real Workers, capability pruning, types, and licenses remain checked. Performance sampling runs separately. This refactor changes no Shaders, sampling density, texture precision, or public behavior, and does not reintroduce the previously rejected upload/clearing experiments.

See the [core modularization comparison report](./core-modularization-report.en.md) for baseline hashes, acceptance results, single-file sizes, and independent performance samples.
