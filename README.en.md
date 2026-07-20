# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami)

> 📖 [中文版](./README.md)

**A parameter-level port of the Blue Archive Unity UI/FX_Touch click effect and cursor trail for the web.**

`ba-click-fx` faithfully reproduces the ParticleSystem and TrailRenderer from the game's `FX_Touch.prefab` — colour curves, size curves, rotation speed, dissolve thresholds, HDR intensity, and TrailRenderer timing/width — all implemented in pure **Canvas 2D**. Zero external runtime dependencies.

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
- Pure Canvas 2D — no images, no WebGL, zero runtime dependencies
- Pure JavaScript software Bloom — a URP 12-compatible Float32 mip pyramid, enabled by default with automatic fallback
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
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.5/dist/ba-click-fx.iife.js"></script>
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
  softwareBloomEnabled?: boolean, // JavaScript software Bloom, default true
  lightBackgroundContrastAlpha?: number, // light-background compatibility layer, default 0.08; 0 disables it
  maxDpr?: number,               // default 2
  touchAction?: string,          // default 'auto'
  inputFilter?: (e: PointerEvent) => boolean,
})
```

### Instance Methods

| Method | Description |
|---|---|
| `boom(x, y)` | Trigger a click effect at the given coordinates |
| `clear()` | Remove all visual objects |
| `clearTrail()` | Clear trail and shards only |
| `destroy()` | Destroy instance, remove listeners and canvas |
| `updateConfig({...})` | Update config at runtime, including `softwareBloomEnabled` and `lightBackgroundContrastAlpha` |
| `setThemeColor('#ff6969')` | Set theme colour via HSL hue-shift |
| `setFxParam('rings.hdrIntensity', 5.992157)` | Modify any FX parameter by dot-path |
| `getFxConfig()` | Deep copy of current FX configuration |
| `resetFxConfig()` | Reset all FX parameters to game defaults |
| `getConfig()` | Current config including read-only Unity params snapshot |

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
| `bloom.intensity` | 0.45 | Software Bloom composite intensity |
| `bloom.scatter` | 0.35 | Glow spread |
| `bloom.resolutionScale` | 0.5 | Bloom buffer scale (internally clamped to 0.1–0.75) |
| `bloom.skipIterations` | 1 | Number of deepest mip iterations to skip |
| `bloom.highQualityFiltering` | true | Enable high-quality bicubic scatter upsampling |
| `bloom.ringEmissionAlpha` | 0.65 | HDR ring emission scale for software Bloom |
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

The original shader uses `Blend SrcAlpha One, One One`. ParticleSystemRenderer's Apply Active Color Space decodes the particle's sRGB vertex colour to Linear before multiplying it by the white HDR material, so the ring colour cannot be treated as an ordinary sRGB multiplication. Dissolve applies a binary threshold clip to the two-dimensional texture alpha instead of continuously reducing every pixel's opacity; pixels that pass the clip retain their sampled texture alpha. Size and dissolve thresholds use the source keyframes and their in/out tangents with Unity cubic Hermite interpolation, rather than linear interpolation or a generic smoothstep.

### Cursor Trail

The trail follows the same rendering chain as the Unity source asset:

| Layer | Description |
|---|---|
| Geometry and core | Draw the original 2px HDR strip directly, then let Bloom expand it into a soft core |
| Longitudinal envelope | The original TrailRenderer gradient is reversed into Canvas point order, then multiplied by the stretched `FX_TEX_Trail_03` brightness converted from sRGB to linear energy |
| Bloom | Only the HDR emission buffer is blurred; triangle shards never enter that buffer |

Shards scatter along the trail at distance intervals.

### JavaScript Software Bloom

With the default `softwareBloomEnabled: true`, the renderer draws HDR emission from rings, disks, and trails into a local mask, reads the pixels back, and follows a URP 12-compatible Bloom structure in JavaScript. Triangular shards keep their crisp body colour and do not participate in Bloom:

1. Decode the 8-bit mask into reusable Float32 RGB buffers.
2. Run a high-quality 13-tap prefilter with a soft-knee threshold to produce half-resolution mip0.
3. Build the mip pyramid with separable 9-tap Gaussian downsampling; `bloom.skipIterations` controls how many deepest iterations are omitted.
4. Mix from low-resolution mips back upward according to `bloom.scatter`, using bicubic sampling when `bloom.highQualityFiltering` is enabled.
5. Convert linear Bloom energy to additive sRGB RGBA, apply `bloom.intensity`, composite it onto the main canvas with `lighter`, then blend the main FX layer over the DOM background with `plus-lighter`.

Strict additive blending necessarily loses all contrast over a pure-white background. When the library owns the overlay, it therefore places an independent `darken` compatibility layer above the main FX layer. This layer uses a pale-cyan mask at `0.08` alpha to restore only the crisp silhouette and neither receives nor generates Bloom. It must remain above the additive layer; otherwise the main layer would add the recovered cyan contrast straight back to white. This is a deliberate web-compatibility deviation, not part of Unity's additive pipeline; set `lightBackgroundContrastAlpha` to `0` to disable it. An existing Canvas supplied as the target cannot receive this separate backdrop-compositing layer.

This pipeline targets the visual character of URP 12 Bloom rather than a pixel-identical GPU post-process. The renderer merges effects whose full blur support overlaps and processes independent effect regions separately, avoiding readback of the large empty spans between them. Inside each region it reads back only the emission geometry instead of the transparent outer padding, then encodes and uploads only the active Bloom output. Its renderer pool and Float32 mip buffers are reused across frames, while the HQ 13-tap prefilter uses equivalent scalar accumulation to reduce hot-loop overhead. The two rings share one Linear Gradient energy calculation within each rendering pass, while trail distances and segment emission energies are also computed only once. Before software Bloom is composited, the crisp main Canvas is reused as the light-background contrast mask. Lifetimes continue to follow real elapsed time under load, preventing slow frames from keeping old effects alive and increasing the backlog. These optimizations do not alter the Bloom threshold, resolution, mip count, scatter, or high-quality filtering. Bloom working canvases are never attached to the DOM, and the implementation uses neither WebGL, float16 Canvas, nor external dependencies. If Canvas pixel readback/writeback is unavailable, rings and disks fall back to native `shadowBlur`; trail emission is written into a local offscreen buffer using true path distance and blurred once as a whole. This avoids both segment-density accumulation and false highlights at the tail of looping paths. Triangle shards always render only their crisp body and never write to the Bloom emission buffer.

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

- **Main FX layer:** effects use `lighter` internally, then the main canvas blends over the DOM background with `plus-lighter`.
- **Light-background compatibility layer:** owned-overlay mode adds a non-Bloom `darken` canvas with a pale-cyan mask at 0.08 alpha so effects remain visible on pure white.
- **Software Bloom:** local working canvases plus a Float32 Gaussian mip pyramid, with a `shadowBlur` fallback when pixel readback is unavailable.
- **On-demand rendering:** `requestAnimationFrame` stops when no effects are active.
- **Zero external dependencies:** standard Canvas 2D APIs only; no WebGL.

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
