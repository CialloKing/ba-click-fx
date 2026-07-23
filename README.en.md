# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami)

> 📖 [中文版](./README.md)

**A parameter-level port of the Blue Archive Unity UI/FX_Touch click effect and cursor trail for the web.**

`ba-click-fx` faithfully reproduces the ParticleSystem and TrailRenderer from the game's `FX_Touch.prefab` — colour curves, size curves, rotation speed, dissolve thresholds, HDR intensity, and TrailRenderer timing/width. Crisp geometry uses **Canvas 2D**; Bloom defaults to the JavaScript software pipeline and can optionally use WebGL2 GPU acceleration. Zero external runtime dependencies.

**Live Demo:** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

> 🖱 Click, drag, or move your mouse on the demo page to preview.

<p align="center">
  <img src="./docs/assets/ba-click-fx-demo.gif" alt="demo" width="45%">
  &nbsp;&nbsp;
  <img src="./docs/assets/blue-archive-reference.gif" alt="game reference" width="45%">
</p>
<p align="center"><sub>ba-click-fx demo (left) · In-game reference (right)</sub></p>

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Common Usage](#common-usage)
- [API Reference](#api-reference)
- [Effects](#effects)
- [How It Differs](#how-it-differs)
- [Project Structure](#project-structure)
- [Development](#development)
- [Credits](#credits)
- [License](#license)

---

## Features

- Parameter-level port from the Unity FX_Touch.prefab — not a "lookalike"
- Dissolve rings (MeshTri), centre disk (ring), click shards (Ring 3/4), drag trail (TrailRenderer)
- All particle parameters locked to the game's original values: colour curves, size curves, rotation speed, dissolve thresholds, HDR intensity
- Canvas 2D crisp geometry — no image assets and zero external runtime dependencies
- Four demo rendering choices: WebGL2 Bloom, Software Bloom (the default reference), Native Glow, and Legacy
- Optional WebGL2 GPU Bloom, with automatic fallback to Software Bloom and then Native Glow
- Browser extension, npm, CDN, and direct download
- Custom theme colour via HSL hue shifting
- Runtime-tweakable FX parameters via `setFxParam()`
- Auto-scales with window height, matching the game's UI-relative proportions

---

## Installation

### 1. Browser Extension

Install [ba-click-fx-extension](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) from the Chrome Web Store. Source: [ba-click-fx-extension](https://github.com/CialloKing/ba-click-fx-extension).

### 2. npm

```bash
npm install ba-click-fx
```

```js
import { BAClickFX } from 'ba-click-fx';
const fx = new BAClickFX();
```

### 3. CDN

```html
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.7/dist/ba-click-fx.iife.js"></script>
<script>
  const fx = new BAClickFX.BAClickFX();
</script>
```

The IIFE build exposes the module as `BAClickFX`; the constructor is at `BAClickFX.BAClickFX`.

### 4. Direct Download

Download from [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases) (`ba-click-fx.js`, `ba-click-fx.iife.js`, `ba-click-fx.cjs`, `ba-click-fx.d.ts`):

```html
<canvas id="myCanvas"></canvas>
<script type="module">
  import { BAClickFX } from './ba-click-fx.js';
  const fx = new BAClickFX({ target: '#myCanvas' });
</script>
```

---

## Common Usage

```js
const fx = new BAClickFX({ target: '#myCanvas' });
fx.boom(window.innerWidth / 2, window.innerHeight / 2);
fx.destroy();
```

---

## API Reference

### Constructor

```ts
new BAClickFX(options?: {
  target?: string | HTMLElement,
  scale?: number,                // default 1
  opacity?: number,              // default 1
  clickEnabled?: boolean,        // default true
  trailEnabled?: boolean,        // default true
  trailAlways?: boolean,         // default false
  renderingMode?: 'enhanced' | 'legacy', // default enhanced
  bloomBackend?: 'auto' | 'software' | 'webgl2' | 'native', // default software
  softwareBloomEnabled?: boolean, // compatibility alias: true = software, false = native
  isolatedCompositing?: boolean,  // default true; false blends directly with the page
  lightBackgroundContrastAlpha?: number, // light-background compatibility layer, default 0.35; 0 disables it
  maxDpr?: number,               // default 2
  touchAction?: string,          // default 'auto'
  inputFilter?: (e: PointerEvent) => boolean,
})
```

In enhanced mode, `bloomBackend` selects the Bloom implementation. The demo combines these backends with Legacy into four direct choices:

| Demo choice | API configuration | Behaviour |
|---|---|---|
| WebGL2 Bloom | `{ renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | Runs thresholding, Gaussian mips, and scatter on the GPU; falls back automatically when unavailable |
| Software Bloom | `{ renderingMode: 'enhanced', bloomBackend: 'software' }` | Default and most precise reference/compatibility implementation, using Canvas 2D pixel readback and Float32 buffers |
| Native Glow | `{ renderingMode: 'enhanced', bloomBackend: 'native' }` | Uses Canvas 2D `shadowBlur`; cheaper, but visually different from post-process Bloom |
| Legacy | `{ renderingMode: 'legacy' }` | Preserves the older sRGB, compositing, and glow behaviour; the Bloom backend is ignored |

The demo exposes Isolated Compositing as a separate switch beside the four rendering choices. It is enabled by default and is orthogonal to Software, WebGL2, Native, and Legacy rendering: it changes only the final CSS compositing boundary for the canvases, not Bloom thresholds, filtering, colour calculations, or Bloom compute cost.

`bloomBackend: 'auto'` tries WebGL2 first, then Software Bloom, then Native Glow. Explicit `'webgl2'` uses the same fallback chain; explicit `'software'` falls back to Native Glow when pixel readback is unavailable. The default remains `'software'`, so the library does not eagerly create a WebGL context. If both `bloomBackend` and the old `softwareBloomEnabled` field are provided, `bloomBackend` wins.

With `isolatedCompositing: true`, the library-owned main FX canvas, WebGL2 Bloom canvas, and light-background compatibility canvas blend inside one transparent isolated group before that group is composited over the page. This prevents `plus-lighter` from clipping cyan-blue output to white when it meets a pure-white page backdrop. Set it to `false` to mount the canvases directly into the target or page and restore strict direct-page compositing. The option can be changed at runtime through `updateConfig()`.

WebGL2 Bloom and isolated compositing both require a library-owned DOM overlay. When `target` is an existing `<canvas>`, the library cannot safely insert the extra WebGL2, contrast, or isolation layers, so `'webgl2'` / `'auto'` falls back to Software Bloom and `isolatedCompositing` is forced to `false`; `getConfig()` reports this effective value. The default fullscreen overlay has no such limitation. A regular container is also supported, but it must establish its own positioning context, normally with `position: relative`; the library does not silently modify host styles.

Each `BAClickFX` instance owns a separate isolation group. Multiple isolated instances on the same page do not run `plus-lighter` across group boundaries, and switching or destroying one instance does not move or remove another instance's canvases.

### Instance Methods

| Method | Description |
|---|---|
| `boom(x, y)` | Trigger a click effect at the given coordinates |
| `clear()` | Remove all visual objects |
| `clearTrail()` | Clear trail and shards only |
| `destroy()` | Destroy instance, remove listeners and canvas |
| `updateConfig({...})` | Update base config, `renderingMode`, `bloomBackend`, `isolatedCompositing`, DPR, and touch behaviour at runtime |
| `setThemeColor('#ff6969')` | Set theme colour via HSL hue-shift |
| `setFxParam('rings.hdrIntensity', 5.992157)` | Modify any FX parameter by dot-path |
| `getFxConfig()` | Deep copy of current FX configuration |
| `resetFxConfig()` | Reset all FX parameters to game defaults |
| `getConfig()` | Current config; `resolvedBloomBackend` reports the latest resolution result and is `pending` before the first deferred WebGL2/auto probe |

The main canvas dispatches `baclickfxbackendchange` whenever backend resolution state changes. Use the exported event name to track deferred probing, runtime fallback, and WebGL context recovery:

```js
import {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
} from 'ba-click-fx';

const fx = new BAClickFX({ bloomBackend: 'webgl2' });

fx.canvas.addEventListener(BLOOM_BACKEND_CHANGE_EVENT, (event) =>
{
  console.log(event.detail.resolvedBloomBackend);
});
```

Click glow can be tuned independently from the trail. This scale changes only
the ring and center-disk Bloom emission in enhanced mode; Native Glow uses the
same scale through a monotonic bounded-alpha mapping, while Legacy keeps its
compatibility output:

```js
fx.setFxParam('bloom.clickEmissionScale', 1.25);
```

### Tunable FX Parameters

| Path | Default | Description |
|---|---|---|
| `rings.hdrIntensity` | 5.992157 | Ring HDR intensity |
| `rings.radiusMin` / `rings.radiusMax` | 51.0560832 / 59.5654304 | Random MeshTri outer-radius range before the lifetime size curve |
| `rings.bandToOuterRadius` | 0.0598573766 | Fixed source-mesh band-width-to-outer-radius ratio |
| `rings.widthStart` / `rings.widthEnd` | 1 / 1 | Source ring-width multipliers, not independent pixel widths |
| `rings.lifetimeMs` | 600 | Ring lifetime (ms) |
| `shards.clickCount` | 4 | Click shard count |
| `shards.maxCount` | 96 | Max shards |
| `shards.trailSpacing` | 80 | Trail shard spacing |
| `bloom.threshold` | 1.0 | Bright-pass threshold |
| `bloom.softKnee` | 0.5 | Soft transition around the threshold |
| `bloom.clamp` | 65472 | URP prefilter HDR clamp |
| `bloom.intensity` | 1.0 | Bloom intensity calibrated for transparent sRGB web compositing against the game capture |
| `bloom.scatter` | 0.7 | Glow spread compensating for the locally cropped mip chain |
| `bloom.resolutionScale` | 0.5 | Bloom buffer scale (internally clamped to 0.1–0.75) |
| `bloom.skipIterations` | 1 | Number of deepest mip iterations to skip |
| `bloom.highQualityFiltering` | true | Enable high-quality bicubic scatter upsampling |
| `bloom.clickEmissionScale` | 1.0 | Independent glow scale for click rings and the center disk, recommended range `0–4`; does not affect crisp geometry or the trail |
| `bloom.ringEmissionAlpha` | 1.0 | HDR ring emission aligned with the FX_MAT_Touch_Tri3 material alpha |
| `bloom.diskEmissionAlpha` | 1.0 | HDR disk emission scale for software Bloom |
| `bloom.ringBlur` | 80 | Native ring blur radius when pixel readback is unavailable |
| `bloom.ringAlpha` | 0.35 | Native ring blur intensity when pixel readback is unavailable |
| `bloom.diskBlur` | 65 | Native disk blur radius when pixel readback is unavailable |
| `bloom.diskAlpha` | 0.65 | Native disk blur intensity when pixel readback is unavailable |
| `bloom.trailCoverageScale` | 1.75 | Canvas trail-geometry calibration for Unity strip subpixel coverage |
| `bloom.trailEmissionAlpha` | 1.0 | HDR trail emission scale for software Bloom |
| `bloom.trailAlpha` | 0.18 | Native local offscreen-blur fallback intensity |
| `trail.width` | 2 | Crisp trail geometry width |
| `trail.outerGlowWidth` | 9 | Native local offscreen fallback glow radius |
| `trail.lifetimeMs` | 300 | Trail lifetime (ms) |

---

## Effects

### Click FX

| Element | Behaviour |
|---|---|
| Center disk | White→blue gradient, rapid expansion, 200ms |
| Dissolve rings | 2 rotating ring bands, arc shrinks to zero, 600ms |
| Click shards | 4 triangle particles burst from click point |

`radiusMin` and `radiusMax` are the outer-radius baselines converted from the MeshTri Start Size and camera scale; the rendered outer radius also follows Unity's lifetime size curve. The default `widthStart` and `widthEnd` values are both `1` and only scale the source band. Actual band width is always calculated as `outer radius × 0.0598573766 × width multiplier`.

The original shader uses `Blend SrcAlpha One, One One`. ParticleSystemRenderer's Apply Active Color Space decodes the enabled Color over Lifetime vertex stream to Linear before multiplying it by the white 5.992157 HDR material in `FX_MAT_Touch_Tri3`. Dissolve thresholds the two-dimensional texture alpha instead of continuously reducing every pixel's opacity, while surviving pixels retain the sampled coverage. Size and dissolve thresholds use the source keyframes and their in/out tangents with Unity cubic Hermite interpolation, rather than linear interpolation or a generic smoothstep.

### Cursor Trail

The trail follows the same rendering chain as the Unity source asset:

| Layer | Description |
|---|---|
| Geometry and core | Draw the original 2px HDR strip directly, then let Bloom expand it into a soft core |
| Longitudinal envelope | The original TrailRenderer gradient is reversed into Canvas point order, then multiplied by the stretched `FX_TEX_Trail_03` brightness converted from sRGB to linear energy |
| Bloom | Only the HDR emission buffer is processed by the selected Bloom backend; triangle shards never enter it |

Shards scatter along the trail at distance intervals.

### Bloom Rendering Backends

WebGL2 and Software Bloom share the same HDR emission parameters and Bloom settings. The WebGL2 branch draws ring, disk, and trail emission into transparent GPU framebuffers, then applies threshold/soft knee, a Gaussian mip pyramid, scatter upsampling, and additive output. Crisp geometry and the light-background contrast silhouette remain on Canvas 2D. This moves the main Bloom workload away from CPU pixel readback when many effects overlap, while keeping Software Bloom as the precise reference and compatibility implementation.

Availability is determined by actually creating a WebGL2 context, checking `EXT_color_buffer_float`, and validating the `RGBA16F` framebuffer. Read the requested backend and latest resolution result through `getConfig().bloomBackend` and `getConfig().resolvedBloomBackend` respectively. WebGL2/auto briefly reports `pending` before the first deferred probe and while a restored context is being validated.

### JavaScript Software Bloom

With the default `bloomBackend: 'software'`, the renderer draws HDR emission from rings, disks, and trails into a local mask, reads the pixels back, and follows a URP 12-compatible Bloom structure in JavaScript. Triangular shards keep their crisp body colour and do not participate in Bloom:

1. Decode the 8-bit mask into reusable Float32 RGB buffers.
2. Run a high-quality 13-tap prefilter with a soft-knee threshold to produce half-resolution mip0.
3. Build the mip pyramid with separable 9-tap Gaussian downsampling; `bloom.skipIterations` controls how many deepest iterations are omitted.
4. Mix from low-resolution mips back upward according to `bloom.scatter`, using bicubic sampling when `bloom.highQualityFiltering` is enabled.
5. Convert linear Bloom energy to additive sRGB RGBA, apply `bloom.intensity`, and composite it onto the main canvas with `lighter`; `isolatedCompositing` determines the subsequent CSS compositing boundary.

The default `isolatedCompositing: true` first resolves the main layer's `plus-lighter`, the WebGL2 Bloom layer's `plus-lighter`, and the compatibility layer's `darken` inside a transparent group, then composites the coloured result and its alpha over the page. This does not change the Bloom algorithm, but preserves cyan-blue colour, saturation, and soft glow over pure white. With `false`, the main layer blends directly against the DOM background; strict additive blending then loses its colour and contrast on pure white, which preserves the previous output for comparison.

When the library owns the overlay, it also places an independent `darken` compatibility layer above the main FX layer. This layer uses a pale-cyan mask at `0.35` alpha by default to restore only the crisp silhouette and neither receives nor generates Bloom. It must remain above the additive layer; otherwise the main layer would add the recovered cyan contrast straight back to white. This is a deliberate web-compatibility deviation, not part of Unity's additive pipeline; set `lightBackgroundContrastAlpha` to `0` to disable it. An existing Canvas supplied as the target can receive neither this separate backdrop-compositing layer nor isolated compositing.

This software pipeline targets the visual character of URP 12 Bloom rather than a pixel-identical GPU post-process. The renderer merges effects whose full blur support overlaps and processes independent effect regions separately, avoiding readback of the large empty spans between them. Inside each region it reads back only the emission geometry instead of the transparent outer padding, then encodes and uploads only the active Bloom output. Its renderer pool and Float32 mip buffers are reused across frames; when an active region shrinks, the full-capacity Canvas is cleared so stale glow cannot be smoothed into a rectangular edge line. The HQ 13-tap prefilter and Gaussian downsampling use equivalent scalar accumulation, and redundant buffer clears are skipped when a pass overwrites the entire mip. The two rings share one Linear Gradient energy calculation within each rendering pass. Trail distances and segment emission energies are also computed only once, dark tail segments that quantize to a strictly zero emission mask are not drawn again, and expired vertices are removed in one batch. Before software Bloom is composited, the crisp main Canvas is reused as the light-background contrast mask. Lifetimes continue to follow real elapsed time under load, preventing slow frames from keeping old effects alive and increasing the backlog. These optimizations do not alter the Bloom threshold, resolution, mip count, scatter, or high-quality filtering. Software Bloom working canvases are never attached to the DOM, and that backend uses neither WebGL, float16 Canvas, nor external dependencies. If Canvas pixel readback/writeback is unavailable, rings and disks fall back to native `shadowBlur`; trail emission is written into a local offscreen buffer using true path distance and blurred once as a whole. This avoids both segment-density accumulation and false highlights at the tail of looping paths. Triangle shards always render only their crisp body and never write to the Bloom emission buffer.

---

## How It Differs

`ba-click-fx` focuses on faithfully recreating the Blue Archive in-game click FX with pixel-level accuracy.

Compared to generic cursor effects:

- Game-accurate dissolve rings, center disk, and shard burst
- Parameter-level reproduction of Unity ParticleSystem curves
- Trail fades continuously from head to tail, not all at once
- Auto-scales with window height for consistent UI proportions
- 20+ tunable parameters + custom theme colour

Related projects:

- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor)
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark)
- [ZM-Kimu/Blue-Archive-Touch-Effect](https://github.com/ZM-Kimu/Blue-Archive-Touch-Effect)

---

## Project Structure

```
ba-click-fx/
├── src/
│   ├── fx.js            # Engine: ParticleSystem + TrailRenderer lifecycle
│   ├── main.js           # Demo page + control panel UI
│   ├── config.js         # Unity FX_Touch parameter snapshot
│   ├── software-bloom.js # URP 12-style Float32 mip Bloom and additive composite
│   ├── webgl2-bloom.js   # WebGL2 HDR emission, Gaussian mips, and scatter composite
│   ├── utils.js          # Pure math utilities
│   └── style.css         # Demo page styles
├── scripts/
│   ├── build.mjs         # Build script
│   └── verify-*.mjs/cjs  # Release verification
├── test/
│   └── smoke.js          # 48 port-verification tests
├── index.html            # Demo page
├── dist/                 # Build output (ESM / CJS / IIFE)
└── package.json
```

### Architecture

- **Isolated compositing layer:** by default, the main FX, WebGL2 Bloom, and light-background compatibility canvases blend in a transparent isolated group before the result is placed over the page; disable it to restore direct-page additive compositing.
- **Main FX layer:** effects use `lighter` internally and the main canvas uses `plus-lighter`; `isolatedCompositing` selects its backdrop.
- **Light-background compatibility layer:** owned-overlay mode adds a non-Bloom `darken` canvas with a pale-cyan mask at 0.35 alpha so effects remain visible on pure white.
- **Software Bloom:** local working canvases plus a Float32 Gaussian mip pyramid, with a `shadowBlur` fallback when pixel readback is unavailable.
- **WebGL2 Bloom:** an optional transparent GPU overlay performs HDR prefiltering, Gaussian mips, and scatter, falling back when capabilities are insufficient.
- **On-demand rendering:** `requestAnimationFrame` stops when no effects are active.
- **Zero external dependencies:** browser-native Canvas 2D / WebGL2 APIs only; no third-party runtime.

---

## Development

```bash
git clone https://github.com/CialloKing/ba-click-fx.git
cd ba-click-fx
npm install
npm run dev
npm run build
npm test
```

---

## Acknowledgements and Third-Party Licenses

The early Canvas 2D click-effect implementation of this project was developed
with reference to the implementation approach, parameter design, and visual
behavior of the following MIT-licensed projects:

- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark)
- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor)

The current version has since been substantially refactored, including its
trail sampling, speed response, curve reconstruction, length control, and
dissipation systems.

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the applicable
copyright notices and MIT license text.

---

## License

MIT
