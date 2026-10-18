# Independent core modularization comparison

[中文](./core-modularization-report.md)

Date: 2026-10-18. Baseline: `a8817da31a5cef80d5c9cc89d44888aabed6d8b0`. Implementation branch: `codex/core-modularization`; runtime changes completed at `38b708d`. This report records independent acceptance before release preparation. At that point the version was 1.3.14 and nothing had been pushed, merged, or published; these changes were subsequently included in v1.3.15.

## Scope and source audit

The core entry decreased from 9,272 to 1,255 lines. See the [module responsibilities](./core-modules.en.md) / [中文说明](./core-modules.md) for responsibilities and dependencies. Two responsibility layers were added without constructors. Public APIs, types, defaults, synchronous construction, and single-file distribution remain unchanged.

Before the first modification, an independent baseline was saved under `test-results/core-baseline-a8817da/`, including source files, full/slim artifacts, seven custom artifacts, build configurations, and SHA-256 hashes. Corresponding hashes were verified before comparisons; the old baseline was not replaced by rebuilt candidate code.

- Baseline full JS: `778088440991c8c3ac0bf1ebd6fa4049eb791ed87282376bf2a2f6481fb3b22d`.
- Baseline slim JS: `65d7582a237b570bdcbd93d4420746f4e795d05c6f1d55743c4993bc849e51f6`.
- Baseline manifest: `52550ecffd0285d1172eb18e4a134a3dcde259863eac17e16a05519c2b520d7b`.
- All 214 original functions/methods were located. Ignoring whitespace, 210 retain their original text; the remaining four only change shared-state or texture-scope access. Numeric operation order, random calls, object reuse, and draw order are preserved.
- All 200 curve evaluations and 216 mesh comparisons match, including endpoints, duplicate keys, empty/duplicate/reversing points, very short segments, zero/negative widths, and mesh reuse.
- Shaders, texture data/precision, sampling density, dynamic geometry allocation, and idle reclamation implementations are unchanged. Golden data and pixel thresholds are unchanged.

## Acceptance

The complete `npm run check:release` passed: 12 stages, 79 custom builds, 35 cache reuses, 147.7 seconds of cumulative build time, and 530.5 seconds overall. Type, license, main/Worker entry, capability pruning, pixel, lifecycle, fault, device, and context recovery checks remain in place. The lifecycle suite passed 1,587 assertions; the Unity browser suite passed 29 assertions.

All final independent geometry-byte and pixel comparisons passed against actual full and custom build artifacts. Release attachments were generated locally from clean commit `e25ff0e042cc6d418c1b60ffbe7dd9d94261d7fd`; slim runtime and Zopfli attachment checks passed. Both JS hashes exactly match the candidates used for performance sampling. Only this report was added afterward; runtime code and release attachments did not change.

- Candidate full JS: `449b3f44b453b5e2f9699956af61bba4e56ade15b7616ce296a18649a32fdf3d`.
- Candidate slim JS: `117845401a74eddcb069c66f51295b761eb4e8b1aae0ce532a9f2ed02757bc0c`.
- Gate and attachment records: `test-results/core-release-verification.json` and `test-results/core-release-assets.json`.

Local comparison files are `core-independent-gpu.json` (36 results), `core-independent-trail.json` (9), `core-independent-software.json` (44), and `core-independent-canvas.json` (20, including DOM/Worker cache probes). Together, these checks cover capacity reuse, rebuilding after reclamation, visible paused frames, synchronous reentry, and repeated destruction. Capacity counters do not represent process memory or actual VRAM.

## Single-file raw bytes

These are uncompressed sizes of individual self-contained JS files, rather than gzip/Brotli sizes. Full and slim builds grew by 451 bytes (about 0.09%) and 38 bytes (about 0.02%), respectively. Custom configurations are saved in the baseline manifest; each comparison uses matching configurations.

| Artifact | a8817da | After split | Delta |
|---|---:|---:|---:|
| Full | 495940 | 496391 | +451 |
| Slim | 202062 | 202100 | +38 |
| WebGL2 / DOM | 239143 | 239177 | +34 |
| WebGPU / DOM | 234312 | 234346 | +34 |
| WebGL2 Bloom / DOM | 275558 | 275596 | +38 |
| Software / DOM | 237125 | 237263 | +138 |
| Native / DOM | 208563 | 208693 | +130 |
| WebGL2 / Worker | 220940 | 220975 | +35 |
| WebGPU / Worker | 216476 | 216513 | +37 |

## Independent timing samples

Environment: Windows, headless Edge 149.0.4022.69, Node v24.16.0, 320×240, with DPR fixed by the corresponding profile. Each case alternated baseline/candidate order over five rounds, using isolated pages or real Workers, deterministic randomness, and fixed logical clocks. Each round ran 90 continuous interaction frames and discarded the first 30 before stable-frame statistics. It also sampled seven first frames after reclamation and 140 subsequent stable frames. GPU recovery samples include synchronous rebuilding after reclamation; Canvas recovery samples rebuild derived working caches released by clear.

CPU frame timing covers `_renderFrame`, excluding input dispatch. Initialization includes waiting for backend readiness. GPU completion waits are outside CPU frame timing, so these values do not represent display frame rates. Native clock resolution was approximately 0.1 ms. Initialization has only five samples per version/configuration. Performance sampling remains outside the default release gate.

Values below are milliseconds, baseline → candidate. The initial measurements are retained rather than replaced by favorable reruns.

| Artifact/backend | Initialization median | Stable-frame median | Stable-frame P95 | Recovery-first-frame median | Recovery-first-frame P95 |
|---|---:|---:|---:|---:|---:|
| Full / WebGL2 | 31.5 → 32.8 | 0.9 → 0.8 | 1.7 → 1.5 | 1.8 → 1.8 | 3.1 → 2.6 |
| Full / WebGPU | 269.5 → 270.6 | 0.5 → 0.5 | 1.3 → 1.0 | 0.5 → 0.5 | 0.8 → 0.6 |
| Slim | 34.5 → 31.8 | 1.1 → 1.1 | 2.1 → 2.2 | 2.2 → 2.1 | 4.1 → 3.3 |
| WebGL2 / DOM | 32.0 → 29.8 | 0.8 → 0.7 | 1.7 → 1.4 | 1.1 → 1.0 | 2.1 → 2.1 |
| WebGPU / DOM | 330.1 → 297.5 | 0.5 → 0.5 | 1.0 → 1.0 | 0.4 → 0.4 | 0.6 → 0.7 |
| WebGL2 Bloom / DOM | 29.4 → 27.1 | 0.7 → 0.7 | 1.2 → 1.3 | 0.9 → 0.9 | 1.9 → 2.2 |
| Software / DOM | 3.1 → 3.5 | 49.3 → 50.7 | 58.4 → 66.9 | 22.0 → 22.1 | 29.7 → 29.0 |
| Native / DOM | 3.0 → 3.4 | 39.2 → 39.1 | 48.6 → 47.7 | 15.0 → 13.9 | 27.6 → 26.2 |
| WebGL2 / Worker | 25.0 → 25.8 | 0.7 → 0.7 | 1.2 → 1.4 | 0.9 → 0.9 | 1.3 → 1.4 |
| WebGPU / Worker | 274.2 → 273.7 | 0.5 → 0.4 | 0.9 → 0.9 | 0.4 → 0.4 | 0.6 → 0.7 |

Software P95 increased by about 14.6% in the first run, prompting a separate five-round Software/Native repeat. The initial results were retained:

| Second 90-frame run | Stable-frame median | Stable-frame P95 |
|---|---:|---:|
| Software / DOM | 50.0 → 51.5 | 70.0 → 74.3 |
| Native / DOM | 37.4 → 37.4 | 45.6 → 48.3 |

Software differences varied across rounds. Cases showing tail variation were then sampled for 300 frames per round, discarding 120 warmup frames and measuring 180 frames. This again used five alternating rounds with identical inputs for the original and candidate:

| Longer warmup and continuous interaction | Stable-frame median | Stable-frame P95 |
|---|---:|---:|
| WebGPU / DOM | 0.2 → 0.2 | 0.5 → 0.4 |
| WebGL2 Bloom / DOM | 0.4 → 0.4 | 0.7 → 0.7 |
| Software / DOM | 61.7 → 60.6 | 75.5 → 73.1 |
| WebGL2 / Worker | 0.4 → 0.4 | 0.8 → 0.7 |

Longer samples include more continuous interaction, so absolute costs should only be compared within a row. Larger stable-frame or tail regressions were not reproduced after longer warmup; early-frame and short-sample variation remains documented. Small initialization sample counts, clock quantization, and system load limit interpretation. No speedup is claimed for this structural refactor, and measurements did not lead to algorithm changes or relaxed acceptance criteria.

Raw samples and execution scripts remain locally in `test-results/core-cost*.json` and `core-cost*.mjs`. Boundary and source audits are in `core-boundaries.json` and `core-source-audit.json`. These independent experiment files are excluded from npm artifacts.
