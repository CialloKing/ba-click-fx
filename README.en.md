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
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.2/dist/ba-click-fx.iife.js"></script>
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
| `updateConfig({...})` | Update config at runtime |
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
| `bloom.ringBlur` | 80 | Ring glow blur |
| `bloom.ringAlpha` | 0.9 | Ring glow intensity |
| `bloom.diskBlur` | 65 | Disk glow blur |
| `bloom.trailAlpha` | 0.18 | Trail glow intensity |
| `trail.width` | 2.5 | Trail gradient layer width |
| `trail.coreWidth` | 1.7 | Trail core layer width |
| `trail.outerGlowWidth` | 9 | Trail outer glow width |
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

3-layer compositing, simulating Unity TrailRenderer + Bloom:

| Layer | Description |
|---|---|
| Core | Gradient blue bright core, alpha fade-out at tail |
| Outer glow | Wide subtle glow simulating Bloom diffusion |
| Gradient fill | Blue→transparent colour ramp along the path |

Shards scatter along the trail at distance intervals.

---

## How It Differs

`ba-click-fx` focuses on faithfully recreating the Blue Archive in-game click FX with pixel-level accuracy.

Compared to generic cursor effects:

- Game-accurate dissolve rings, center disk, and shard burst
- Parameter-level reproduction of Unity ParticleSystem curves
- Trail fades continuously from head to tail, not all at once
- Auto-scales with window height for consistent UI proportions
- 14 tunable parameters + custom theme colour

Related projects:

- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor)
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark)
- [ZM-Kimu/Blue-Archive-Touch-Effect](https://github.com/ZM-Kimu/Blue-Archive-Touch-Effect)

---

## Project Structure

```
ba-click-fx/
├── src/
│   ├── ba-spark.js      # Engine: ParticleSystem + TrailRenderer lifecycle
│   ├── main.js           # Demo page + control panel UI
│   ├── config.js         # Unity FX_Touch parameter snapshot
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

## Credits

- Blue Archive UI effects as original design reference
- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor)
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark)
- [ZM-Kimu/Blue-Archive-Touch-Effect](https://github.com/ZM-Kimu/Blue-Archive-Touch-Effect)

---

## License

MIT
