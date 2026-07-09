# ba-click-fx

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)

> 📖 [中文版](./README.md)

**Blue Archive / 蔚蓝档案 style mouse click effect and cursor trail animation for web.**

`ba-click-fx` is a web-based **Blue Archive** click and drag effect library. It uses pure **Canvas 2D** to render game-style mouse click animations, blue disks, spinning rings, particle shards, glowing cursor trails, and drag trail effects.

A lightweight **Blue Archive style cursor effect** library for the web. It provides **mouse click effects**, **touch effects**, **cursor trail animation**, **particle sparks**, **glowing rings**, and **drag trails** with zero external runtime dependencies.

**Online Demo:** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

> Click, drag, or move your mouse on the demo page to preview the Blue Archive style click effect and cursor trail.

<!-- TODO: add a demo GIF
<p align="center">
  <img src="./docs/assets/ba-click-fx-demo.gif" alt="Blue Archive click effect and cursor trail demo" width="720">
</p>
-->

---

## Table of Contents

- [Online Demo](#online-demo)
- [Features](#features)
- [Quick Start](#quick-start)
- [Three Ways to Use](#three-ways-to-use)
  - [npm Install](#1-npm-install)
  - [CDN](#2-cdn)
  - [Direct Download](#3-direct-download)
- [Common Usage](#common-usage)
- [API Reference](#api-reference)
- [Effect Details](#effect-details)
- [Comparison with Other Projects](#comparison-with-other-projects)
- [Project Structure](#project-structure)
- [Development Notes](#development-notes)
- [Acknowledgments](#acknowledgments)
- [License](#license)

---

## Online Demo

Open [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top), click and drag freely to preview. Click ⚙ in the top-right corner to open the control panel and adjust color, size, trail length, particle count, and other parameters in real time.

---

## Features

- Blue Archive / 蔚蓝档案 style click effects
- Mouse click effect / touch effect / cursor trail effect
- Blue disk, spinning rings, particle shards, glowing cursor trails
- Supports click, drag, move trail, and manual trigger
- Pure Canvas 2D — no image assets required
- Zero external runtime dependencies — works on blogs, personal sites, and frontend projects
- Three integration methods: npm, CDN, direct download
- Extensive configurable parameters for color, scale, opacity, speed, trail length, rings, shards, glow, and more
- 60+ adjustable parameters, real-time preview via control panel

---

## Quick Start

Just want to see the effect? Open the [online demo](https://ba-click-fx.cialloking.top) and click or drag.

Run locally:

```bash
git clone https://github.com/CialloKing/ba-click-fx.git
cd ba-click-fx
npm install
npm run dev
```

Build:

```bash
npm run build
```

---

## Three Ways to Use

### 1. npm Install

```bash
npm install ba-click-fx
```

Basic usage:

```js
import { BAClickFX } from 'ba-click-fx';

const spark = new BAClickFX();
```

With custom options:

```js
import { BAClickFX } from 'ba-click-fx';

const spark = new BAClickFX({
  color: [105, 161, 255],
  scale: 1.1,
  opacity: 0.5,
  trailEnabled: true,
  trailAlways: false,
});
```

### 2. CDN

Drop a single `<script>` tag — no build tools required:

Fixed version (recommended):

```html
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.1.0/dist/ba-click-fx.iife.js"></script>
<script>
  const spark = new BAClickFX();
</script>
```

Always use the latest version:

```html
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx/dist/ba-click-fx.iife.js"></script>
```

### 3. Direct Download

Download build artifacts (`ba-click-fx.js`, `ba-click-fx.iife.js`, `ba-click-fx.cjs`, `ba-click-fx.d.ts`) from [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases), or clone the repo and use the `dist/` folder directly — ideal for static sites:

```html
<canvas id="myCanvas"></canvas>
<script type="module">
  import { BAClickFX } from './ba-click-fx.js';
  const spark = new BAClickFX({ target: '#myCanvas' });
</script>
```

---

## Common Usage

Attach to a specific canvas:

```js
const fx = new BAClickFX({
  target: '#myCanvas',
});
```

Manually trigger a click effect:

```js
fx.boom(window.innerWidth / 2, window.innerHeight / 2);
```

Destroy on page unload:

```js
fx.destroy();
```

---

## API Reference

### Constructor

```ts
new BAClickFX(options?: BAClickFXOptions)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `target` | `string \| HTMLElement` | auto-created | Mount target: CSS selector or existing `<canvas>` |
| `color` | `[r, g, b]` | `[105, 161, 255]` | Theme color |
| `scale` | `number` | `1.10` | Global scale (0.5~3) |
| `opacity` | `number` | `0.50` | Opacity (0.1~1) |
| `trailAlways` | `boolean` | `false` | Show trail on mouse move |
| `trailEnabled` | `boolean` | `true` | Enable cursor trail |
| `clickEnabled` | `boolean` | `true` | Enable click effects |
| `touchAction` | `string` | `'auto'` | Canvas touch-action CSS (`'none'` for trail on mobile) |

### Instance Methods

#### Basic

| Method | Description |
|---|---|
| `setColor(r, g, b)` | Theme color (0~255) |
| `setScale(s)` | Global scale (0.5~3) |
| `setOpacity(o)` | Opacity (0.1~1) |
| `setClick(enabled)` | Toggle click effects |
| `setSpeed(click, trail?)` | Click/drag speed (0.2~3) |
| `setDpr(d)` | Max device pixel ratio (1~2) |
| `setTrailRenderScale(s)` | Trail offscreen canvas scale (0.5~1) |
| `setTouchAction(value)` | Mobile touch-action (`'auto'` / `'none'` / `'pan-y'`) |

#### Glow

| Method | Description |
|---|---|
| `setGlow(enabled)` | shadowBlur glow (higher performance cost) |
| `setFakeGlow(enabled)` | Multi-layer soft glow (recommended) |
| `setClickFakeGlow(enabled)` | Click effect soft glow |

#### Rings

| Method | Description | Default |
|---|---|---|
| `setRingRotationSpeed(v)` | Rotation speed (0~0.05) | `0.008` |
| `setRingEmission(v)` | Glow intensity (0~1) | `0.35` |
| `setRingWidth(v)` | Arc width (0.3~3) | `0.9` |
| `setRingAlpha(v)` | Ring opacity (0.1~1) | `0.9` |
| `setRingDelay(v)` | Appearance delay (0~10) | `2` |
| `setRingMaxLife(v)` | Total lifetime (10~60) | `27` |
| `setRingBaseRadiusMul(v)` | Initial radius multiplier (0.2~1) | `0.47` |
| `setRingPostDiskGrow(v)` | Expansion amount (5~60) | `24` |
| `setRingGlowRadiusAdd(v)` | Glow radius (10~150) | `54` |
| `setRingSoftGlowRadiusAdd(v)` | Soft glow radius (20~200) | `96` |
| `setRingRadiusGrowEnd(v)` | Expansion progress threshold (0.2~1) | `0.66` |

#### Trail

| Method | Description | Default |
|---|---|---|
| `setTrail(enabled)` | Toggle trail | `true` |
| `setTrailAlways(enabled)` | Show on move | `false` |
| `setTrailBrightness(a)` | Overall brightness (0.1~1) | `0.96` |
| `setTrailWhiteMix(v)` | Whiteness amount (0~1) | `0.08` |
| `setTrailWidth(fast, slow?)` | Base line width (0.5~6) | `3` |
| `setTrailLength(slow, fast?)` | Max trail length | `900, 4200` |
| `setTrailLife(slow, fast?)` | Fade speed (5~400) | `22` |
| `setTrailDecay(tail, head, release)` | Tail/head/release decay multipliers | `1.28, 0.95, 1.18` |
| `setTrailSmooth(f)` | Mouse smoothing (0~0.9) | `0.5` |
| `setTrailSpeedRange(min, max)` | Speed mapping range (px/ms) | `0.035, 2.2` |
| `setTrailSpeedMin(v)` | Min speed threshold (0.005~0.5) | `0.035` |
| `setTrailSpeedMax(v)` | Max speed threshold (0.5~5) | `2.2` |
| `setTrailSpeedDecay(d)` | Speed decay rate (0.8~0.999) | `0.988` |
| `setTrailTailDecayMul(v)` | Tail decay | `1.28` |
| `setTrailHeadDecayMul(v)` | Head decay | `0.95` |
| `setTrailReleaseDecayMul(v)` | Release decay | `1.18` |
| `setTrailSampling(step, max)` | Input sampling spacing & max points | `0.85, 80` |
| `setTrailRenderSampling(step, max)` | Render resample spacing & max points | `0.75, 2400` |

#### Trail Layer Opacity

| Method | Description | Default |
|---|---|---|
| `setTrailMainAlpha(v)` | Main trail | `1` |
| `setTrailCoreAlpha(v)` | Center highlight | `0.78` |
| `setTrailHotAlpha(v)` | Blue-white hotspot | `0.34` |
| `setTrailGlowAlpha(v)` | Blue glow | `0.18` |
| `setTrailSoftGlowAlpha(v)` | Soft outer glow | `0.045` |
| `setTrailRailAlpha(v)` | Thin rail | `0.02` |
| `setTrailGlowWidthMul(v)` | Glow width (0.3~8) | `1.7` |
| `setTrailSoftGlowWidthMul(v)` | Soft glow width (0.5~15) | `2.4` |

#### Shards

| Method | Description | Default |
|---|---|---|
| `setSparksCount(n)` | Click particle count (0~12) | `4` |
| `setMaxShards(n)` | Max shard count (0~200) | `38` |
| `setShardSpacing(d)` | Spacing (20~500) | `220` |
| `setShardChance(slow, fast)` | Extra chance | `0.04, 0.18` |
| `setShardLargeChance(p)` | Large shard probability | `0.62` |
| `setMoveSparkChance(v)` | Random spark on move (0~0.05) | `0` |

#### Lifecycle

| Method | Description |
|---|---|
| `boom(x?, y?)` | Manually trigger click effect (center by default) |
| `clearTrail()` | Clear all trails |
| `getConfig()` | Return a deep copy of the current config |
| `resetConfig()` | Restore default config |
| `destroy()` | Destroy instance: remove canvas, events, animations |

---

## Effect Details

### Click Effect

| Element | Behavior |
|---|---|
| Disk | White flash → blue disk, expands rapidly then fades |
| Ring | 2 highlighted arcs, counterclockwise rotation, shrinking |
| Shards | Triangular particles burst from disk edge, pulsing flicker |

### Cursor Trail

6-layer composite rendering, simulating Unity TrailRenderer + ParticleSystem:

| Layer | Description |
|---|---|
| Dark rail | Thin blue line lingering on old trajectory |
| Soft outer glow | Wide, faint diffused glow |
| Ribbon energy band | Semi-transparent ribbon material |
| Main blue trail | Core trail, width tapers along the path |
| Center highlight | Light blue bright core line |
| Blue-white hotspot | Persistent glow on recent arc segments |

Shards are scattered along the trail by distance, with large/small size random mixing.

---

## Comparison with Other Projects

`ba-click-fx` focuses on faithfully reproducing **Blue Archive** click feedback details, rather than generic firework or simple mouse trailing effects.

Compared to general-purpose cursor effects, this project prioritizes:

- Game-style click disk, spinning ring, and shard burst
- Blue glow trail closer to the original game's look
- Tail-to-head continuous fade rather than whole-trail simultaneous fade
- Continuous trail during fast mouse movement
- Click, drag, move trail, and manual trigger all independently controllable
- 60+ adjustable parameters for fine-tuning

Related projects:

- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor)
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark)
- [ZM-Kimu/Blue-Archive-Touch-Effect](https://github.com/ZM-Kimu/Blue-Archive-Touch-Effect)

---

## Project Structure

```
ba-click-fx/
├── src/
│   ├── ba-spark.js      # Effect engine (BAClickFX class)
│   ├── main.js           # Demo page entry + control panel UI
│   ├── config.js         # All configurable parameters
│   ├── utils.js          # Pure math utilities
│   ├── style.css         # Demo page styles
│   └── ba-click-fx.d.ts  # TypeScript declarations
├── scripts/
│   └── build.mjs         # Build script
├── test/
│   └── smoke.js          # Smoke test
├── index.html            # Demo page
├── dist/                 # Build output
│   ├── index.html        # Demo page
│   ├── ba-click-fx.js    # ESM library
│   ├── ba-click-fx.cjs   # CommonJS
│   ├── ba-click-fx.iife.js  # IIFE CDN
│   └── ba-click-fx.d.ts  # TypeScript declarations
├── vite.config.js        # Demo Vite config
├── vite.lib.config.js    # Library mode Vite config
└── package.json
```

### Architecture Highlights

- **Dual Canvas**: Main canvas renders click effects; offscreen trailCanvas independently renders trails → `lighter` blend
- **Object Pool**: ClickWave and SparkParticle are recycled to avoid GC jitter
- **On-demand Rendering**: `requestAnimationFrame` stops automatically when no effects are active
- **60fps Baseline**: All frame parameters normalized to 60fps, scaled at runtime for any refresh rate
- **Zero External Dependencies**: Relies solely on standard Canvas 2D API

---

## Development Notes

This project was primarily developed and iterated with AI assistance, and has undergone real-world testing, parameter tuning, and effect calibration. The goal is to faithfully reproduce the Blue Archive style web click effects and cursor trails while maintaining pure Canvas 2D rendering, zero runtime dependencies, and easy integration.

---

## Acknowledgments

- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor) — Blue Archive cursor effect implementation
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark) — Early web implementation of Blue Archive click effects

The two projects above did not fully match the in-game look for mouse trails. This project optimizes both the click effect and trail effect on top of those foundations, and adds extensive customization options.

---

## License

MIT
