# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)

> 📖 [中文版](./README.md)

**A parameter-level port of the Blue Archive Unity UI/FX_Touch click effect and cursor trail for the web.**

`ba-click-fx` faithfully reproduces the ParticleSystem and TrailRenderer from the game's `FX_Touch.prefab` — colour curves, size curves, rotation speed, dissolve thresholds, HDR intensity, and TrailRenderer timing/width — all implemented in pure **Canvas 2D**. Zero external runtime dependencies.

**Live Demo:** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

<p align="center">
  <img src="./docs/assets/ba-click-fx-demo.gif" alt="demo" width="45%">
  &nbsp;&nbsp;
  <img src="./docs/assets/blue-archive-reference.gif" alt="game reference" width="45%">
</p>

---

## Features

- Parameter-level port from the Unity FX_Touch.prefab — not a "lookalike"
- Dissolve rings (MeshTri), centre disk (ring), click shards (Ring 3/4), drag trail (TrailRenderer)
- All particle parameters locked to the game's original values
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
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.0/dist/ba-click-fx.iife.js"></script>
<script>
  const fx = new BAClickFX.BAClickFX();
</script>
```

### 4. Direct Download

Download from [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases):

```html
<script type="module">
  import { BAClickFX } from './ba-click-fx.js';
  const fx = new BAClickFX();
</script>
```

---

## Common Usage

Mount to a specific canvas:

```js
const fx = new BAClickFX({ target: '#myCanvas' });
```

Trigger a click effect manually:

```js
fx.boom(window.innerWidth / 2, window.innerHeight / 2);
```

Destroy on page unload:

```js
fx.destroy();
```

---

## API

### Constructor

```ts
new BAClickFX(options?: {
  target?: string | HTMLElement,
  scale?: number,                // default 1
  opacity?: number,              // default 1
  clickEnabled?: boolean,        // default true
  trailEnabled?: boolean,        // default true
  trailAlways?: boolean,         // default false — show trail on mouse move without pressing
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
| `updateConfig({...})` | Update scale/opacity/clickEnabled/trailEnabled/trailAlways/maxDpr/touchAction at runtime |
| `setThemeColor('#ff6969')` | Set a theme colour — hue-shifts all blue-tinted effects |
| `setFxParam('rings.hdrIntensity', 1.5)` | Modify any FX parameter by dot-path |
| `getFxConfig()` | Return a deep copy of the current FX configuration |
| `resetFxConfig()` | Reset all FX parameters to game defaults |
| `getConfig()` | Return current instance config including a read-only snapshot of Unity params |

### Tunable FX Parameters (setFxParam paths)

| Path | Default | Description |
|---|---|---|
| `rings.hdrIntensity` | 1.0 | Ring HDR intensity |
| `rings.radiusMin` | 51 | Ring start radius |
| `rings.radiusMax` | 59 | Ring end radius |
| `rings.widthStart` | 5.2 | Ring start width |
| `rings.widthEnd` | 2.4 | Ring end width |
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

On click:

- **Center disk** — white→blue gradient short disk, 200ms
- **Dissolve rings** — 2 rotating ring bands, arc shortens until disappearance, 600ms
- **Click shards** — 4 triangle particles burst from click point, 600~700ms

On drag:

- **Cursor trail** — 0.3s TrailRenderer, gradient blue light trail + Bloom glow
- **Moving shards** — triangle particles generated at distance intervals

All parameters extracted directly from the game's `FX_Touch.prefab` Unity ParticleSystem / TrailRenderer configuration.

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

- Blue Archive UI effects as the original design reference
- Particle parameters extracted from the global server `uiuserinteraction_fx` Bundle (2026-04-06)
- Unity source reference: FXTouch.cs, TouchEffectCreater.cs, InputWrapper.cs

---

## License

MIT
