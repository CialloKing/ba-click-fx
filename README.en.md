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
- Pure JavaScript software Bloom — half-resolution Float32 bright-pass and separable blur, enabled by default with automatic fallback
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
| `updateConfig({...})` | Update config at runtime, including `softwareBloomEnabled` |
| `setThemeColor('#ff6969')` | Set theme colour via HSL hue-shift |
| `setFxParam('rings.hdrIntensity', 1.5)` | Modify any FX parameter by dot-path |
| `getFxConfig()` | Deep copy of current FX configuration |
| `resetFxConfig()` | Reset all FX parameters to game defaults |
| `getConfig()` | Current config including read-only Unity params snapshot |

### Tunable FX Parameters

| Path | Default | Description |
|---|---|---|
| `rings.hdrIntensity` | 1.0 | Ring HDR intensity |
| `rings.radiusMin` / `rings.radiusMax` | 51 / 59 | Ring radius range |
| `rings.widthStart` / `rings.widthEnd` | 5.2 / 2.4 | Ring width range |
| `rings.lifetimeMs` | 600 | Ring lifetime (ms) |
| `shards.clickCount` | 4 | Click shard count |
| `shards.maxCount` | 96 | Max shards |
| `shards.trailSpacing` | 80 | Trail shard spacing |
| `bloom.threshold` | 1.0 | Bright-pass threshold |
| `bloom.softKnee` | 0.5 | Soft transition around the threshold |
| `bloom.intensity` | 0.45 | Software Bloom composite intensity |
| `bloom.scatter` | 0.35 | Glow spread |
| `bloom.resolutionScale` | 0.5 | Bloom buffer scale (internally clamped to 0.1–0.75) |
| `bloom.iterations` | 3 | Separable box-blur iterations |
| `bloom.ringBlur` | 80 | Ring glow blur |
| `bloom.ringAlpha` | 0.35 | Ring glow intensity |
| `bloom.diskBlur` | 65 | Disk glow blur |
| `bloom.diskAlpha` | 0.65 | Disk glow intensity |
| `bloom.trailEmissionAlpha` | 1.0 | HDR trail emission scale for software Bloom |
| `bloom.trailAlpha` | 0.18 | Native single-path blur fallback intensity |
| `trail.width` | 4 | Trail gradient layer width |
| `trail.coreWidth` | 1.7 | Trail core layer width |
| `trail.outerGlowWidth` | 9 | Native single-path fallback glow radius |
| `trail.lifetimeMs` | 300 | Trail lifetime (ms) |

---

## Effects

### Click FX

| Element | Behaviour |
|---|---|
| Center disk | White→blue gradient, rapid expansion, 200ms |
| Dissolve rings | 2 rotating ring bands, arc shrinks to zero, 600ms |
| Click shards | 4 triangle particles burst from click point |

### Cursor Trail

The trail follows the same rendering chain as the Unity source asset:

| Layer | Description |
|---|---|
| Geometry and core | The original 2px strip is approximated by a 4px gradient body and a 1.7px core |
| Longitudinal envelope | The original TrailRenderer gradient is reversed into Canvas point order, then multiplied by the stretched `FX_TEX_Trail_03` brightness converted from sRGB to linear energy |
| Bloom | Only the HDR emission buffer is blurred; triangle shards never enter that buffer |

Shards scatter along the trail at distance intervals.

### JavaScript Software Bloom

With the default `softwareBloomEnabled: true`, the renderer draws HDR emission from rings, disks, and trails into a local half-resolution mask, reads the pixels back, and processes them in JavaScript. Triangular shards keep their crisp body colour and do not participate in Bloom:

1. Decode the 8-bit mask into reusable Float32 RGB buffers.
2. Extract highlights with a soft-knee threshold.
3. Build a Gaussian-like glow through continuous separable box-blur passes, outputting only the completed convolution chain so intermediate box kernels cannot leave hard bands.
4. Apply `bloom.intensity` and `bloom.scatter`, then add the result back to the main canvas with `lighter` compositing.

This pipeline targets the visual character of Unity Bloom rather than a pixel-identical URP post-process. The renderer processes only a quantised bounding region covering the active effects and the full blur support, so the higher sampling rate does not require a full-frame readback. The page still exposes only one visible canvas: Bloom working canvases are never attached to the DOM, and the implementation uses neither WebGL, float16 Canvas, nor external dependencies. If Canvas pixel readback/writeback is unavailable, rings and disks fall back to native `shadowBlur`; the trail uses one filtered full-path stroke so glow cannot accumulate with segment density.

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
│   ├── software-bloom.js # Float32 bright-pass, separable blur, additive composite
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

- **One visible canvas:** all effects are ultimately composited onto the same main canvas with `lighter`.
- **Software Bloom:** local half-resolution working canvases plus Float32 JavaScript buffers, with a `shadowBlur` fallback when pixel readback is unavailable.
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
