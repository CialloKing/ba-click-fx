# Changelog

## v1.1.11 - 2026-07-14

- Added the opt-in `clamp` trail boundary mode, which attempts Pointer Capture and clamps each delivered trail sample to the Canvas edge before smoothing and interpolation.
- Added the optional constructor `inputFilter` and `setInputFilter()` API so host pages can reject Pointer input before layout reads, coalesced-event sampling, and particle creation.
- Kept `pointerup`, `pointercancel`, and `blur` cleanup independent from input filtering, safely rejected filter exceptions, and released the host callback reference during destruction.
- Added the `clamp` option and working mode binding to the demo selector, plus complete TypeScript, package-consumer, and smoke-test coverage.
- Completed bindings, defaults, bilingual labels, and reset handling for the existing advanced demo controls so the repository synchronization check passes again.
- No default configuration, existing boundary-mode behavior, color, opacity, geometry, timing, easing, random distribution, drawing formula, draw order, or compositing changes.

## v1.1.10 - 2026-07-13

- Centralized finite-number normalization across constructor options, render options, `boom()`, colors, and every public numeric setter.
- Invalid numeric conversions, `NaN`, `Infinity`, and `Symbol` inputs now fall back safely; existing finite values, numeric strings, and `null` conversion behavior are unchanged.
- Added complete TypeScript types for the configuration returned by `getConfig()` and marked the live `CONFIG` reference as deprecated.
- Added strict TypeScript consumer compilation and ESM/CommonJS default-export checks against the packed npm tarball.
- Reused the trail update's live-point count and bounded the trail render cache without changing forward sampling, deduplication, suffix retention, or Canvas command order.
- Made fractional `renderMaxPoints` values safe by applying the existing integer point-limit meaning at the internal allocation boundary.
- No default configuration, public runtime API, color, opacity, geometry, timing, easing, random distribution, drawing formula, draw order, or compositing changes.

## v1.1.9 - 2026-07-13

- Added opt-in Canvas render budgets and runtime render metrics for large surfaces.
- Added explicit size refresh support for externally managed Canvas elements.
- Added debounced `ResizeObserver`, `visualViewport`, and device-pixel-ratio monitoring with complete teardown.
- Paused rendering while an external Canvas has a zero-sized layout box and resumed after its size is refreshed.
- Prevented multiple live engines from clearing or resizing the same main Canvas.
- Kept the default, no-budget rendering dimensions and visual output for non-zero Canvas layouts identical to v1.1.8.
- Deferred local click-wave scratch canvases to preserve the existing production drawing path and strict visual equivalence.

## v1.1.8 - 2026-07-13

- Added `auto`, `pause-connect`, and `continue` trail behavior outside the Canvas.
- Made trail disabling and clearing release their trail-only input and particle state.
- Hardened construction, destruction, Pointer Capture, RAF, timer, and Canvas cleanup.
- Added package metadata, exact file-list, CI, prepack, and prepublish verification.
- Corrected the IIFE examples to use `BAClickFX.BAClickFX`.
- No color, opacity, geometry, timing, easing, random distribution, drawing formula, or default visual changes.

## v1.1.7 - 2026-07-13

- Reused the Canvas bounds across each batch of coalesced pointer events.
- Fixed the `maxCoalescedEvents = 1` sampling edge case.
- Removed unused internal allocation and dead code.
- No visual effect, default configuration, or public API changes.

## v1.1.0 - 2026-07-09

- Published `ba-click-fx` to npm.
- Added Blue Archive style mouse click effect and cursor trail animation.
- Added ESM, CommonJS, IIFE and TypeScript declaration builds.
- Added online demo, CDN usage and direct download support.
- Added SEO optimization: meta tags, Open Graph, robots.txt, sitemap.xml.
- Added npm version and downloads badges to README.
