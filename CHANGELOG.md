# Changelog

## v1.2.2 — 类型定义同步

- 补全 .d.ts：BAClickFXOptions/BAClickFXConfig 新增 trailAlways
- 补全 .d.ts：BAClickFX 类新增 updateConfig/setThemeColor/setFxParam/getFxConfig/resetFxConfig 声明

## v1.2.1 — 修复 trailAlways 功能缺失

- 恢复 trailAlways 功能（v1.2.0 git 回退时被误删）
- 修复 _acceptPointerDown 将 button=-1（移动未按键）误拦截

## v1.2.0 — Unity FX_Touch Direct Port

- **Architecture**: Replaced the fully parameterized engine with a direct parameter-level port of the Blue Archive `FX_Touch.prefab` ParticleSystem and TrailRenderer.
- All visual parameters (colour curves, size curves, rotation speed, dissolve thresholds, HDR intensity, TrailRenderer time/width) are now locked to the game's original values.
- New constructor API: `scale`, `opacity`, `clickEnabled`, `trailEnabled`, `trailAlways`, `maxDpr`, `touchAction`, `inputFilter`.
- New runtime configuration: `updateConfig()`, `setThemeColor()`, `setFxParam()`, `getFxConfig()`, `resetFxConfig()`.
- Control panel updated with sliders for key parameters: ring HDR/radius/width/lifetime, shard count/max/spacing, trail width/glow/lifetime, bloom blur/alpha.
- Bidirectional taper on dissolve ring endpoints matching `FX_TEX_Grad_Ring3` texture alpha falloff.
- Ring width now follows the game's `sizeOverLifetime.y` curve (fast inflation in first 8% of lifetime).
- Global `SIZE_CORRECTION` factor (0.92) compensates for orthographicSize deviation.
- Trail gradient layer uses alpha-based fade-out (`progress^0.5`) with uniform blue tint to prevent dark artifacts on light backgrounds.
- Bloom glow significantly increased: ring blur 80, disk blur 65, ring alpha 0.9.
- Shard glow removed.
- I18N bilingual support for the demo page.
- 48 smoke tests covering all Unity parameter assertions and lifecycle behaviours.

## v1.1.14 - 2026-07-16

- Restored the v1.1.12 trail layers, widths, colors, multi-layer glow, radial glow profile, and default glow range and intensity after visual review.
- Reduced the default trail white mix to `0.10` so the line keeps more of the configured blue color.
- Adjusted every visible trail layer to increase toward its endpoint, preventing the middle of the trail from appearing brighter than the cursor head.
- Added regression coverage for the restored v1.1.12 defaults and the trail-head brightness invariant.
- No public API or TypeScript declaration changes.

## v1.1.13 - 2026-07-15

- Reworked the trail width and opacity profiles so the cursor head is the brightest and widest point, followed by a monotonic fade toward the tail.
- Added a path-progress blue-to-cyan color ramp, reduced white mixing, and kept the short head highlight without washing out the main trail.
- Changed the default trail base width to `4.00` and replaced the default multi-layer fake glow with a width-coupled real radial glow.
- Softened the real glow edge with denser sampling, a ten-stop radial falloff, and higher precision for very low alpha values while keeping the outer radius bounded.
- Fixed the RGBA string cache so its quantized key and stored alpha always use the same precision, eliminating call-order-dependent low-alpha output.
- Preserved the previous trail shard size, count, spacing, and random distribution, and made no public API, click-effect geometry, or click timing changes.

## v1.1.12 - 2026-07-15

- Replaced the demo's unstyled Mouse Leave selector with an accessible themed native select, including dark options, focus states, a custom arrow, forced-colors fallback, and bilingual option labels.
- Fixed five stale `readDefaults()` config paths that displayed `NaN` after resetting rotation jitter, small-radius ring, and trail-gradient controls.
- Aligned the shard-spacing and ring-alpha HTML defaults with the actual config, and preserved each range output's declared decimal precision during input and reset.
- Centralized demo setting restoration so invalid range, color, and select values safely restore only the affected control without clearing other preferences.
- Hardened `BAClickFXDemo.loadSettings()` against malformed JSON roots and reused the same validated restoration path as startup settings.
- Extended the demo synchronization check to resolve every direct `createConfig()` reference, reject missing or non-finite defaults, and cross-check range HTML values, outputs, and reset config values before release.
- No Canvas effect configuration, geometry, timing, easing, randomness, drawing, compositing, core API, or TypeScript changes.

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
