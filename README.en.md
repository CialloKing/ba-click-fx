# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami)

> 📖 [中文版](./README.md)

**Blue Archive / 蔚蓝档案 style mouse click effect and cursor trail animation for web.**

`ba-click-fx` is a web-based **Blue Archive** click and drag effect library. It uses pure **Canvas 2D** to render game-style mouse click animations, blue disks, spinning rings, particle shards, glowing cursor trails, and drag trail effects.

A lightweight **Blue Archive style cursor effect** library for the web. It provides **mouse click effects**, **touch effects**, **cursor trail animation**, **particle sparks**, **glowing rings**, and **drag trails** with zero external runtime dependencies.

**Online Demo:** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

> Click, drag, or move your mouse on the demo page to preview the Blue Archive style click effect and cursor trail.

<p align="center">
  <img
    src="./docs/assets/ba-click-fx-demo.gif"
    alt="ba-click-fx Blue Archive style click effect and cursor trail demo"
    width="45%"
  >
  &nbsp;&nbsp;
  <img
    src="./docs/assets/blue-archive-reference.gif"
    alt="Blue Archive in-game click effect and cursor trail reference"
    width="45%"
  >
</p>
<p align="center"><sub>ba-click-fx demo (left) · Blue Archive in-game reference (right, for comparison only)</sub></p>

---

## Table of Contents

- [Online Demo](#online-demo)
- [Features](#features)
- [Quick Start](#quick-start)
- [Usage](#usage)
  - [Browser Extension](#1-browser-extension)
  - [npm Install](#2-npm-install)
  - [CDN](#3-cdn)
  - [Direct Download](#4-direct-download)
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
- Four integration methods: browser extension, npm, CDN, and direct download
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

## Usage

### 1. Browser Extension

Don't want to write code? Install [ba-click-fx-extension from the Chrome Web Store](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) to get Blue Archive style click effects and cursor trails on ordinary webpages.

- Enabled by default after install — no scripts needed
- Toggle click effects and cursor trails independently, disable per-site
- Adjustable theme color, opacity, effect size, and quality
- Canvas runs inside Shadow DOM — no layout impact
- Pure local rendering, no remote requests

See the [ba-click-fx-extension](https://github.com/CialloKing/ba-click-fx-extension) repository for source code and implementation details.

### 2. npm Install

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

### 3. CDN

Drop a single `<script>` tag — no build tools required:

Fixed version (recommended):

```html
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.1.14/dist/ba-click-fx.iife.js"></script>
<script>
  const spark = new BAClickFX.BAClickFX();
</script>
```

Always use the latest version:

```html
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx/dist/ba-click-fx.iife.js"></script>
<script>
  const spark = new BAClickFX.BAClickFX();
</script>
```

The IIFE build exposes the module object as the global `BAClickFX`, so its
constructor is `BAClickFX.BAClickFX`. ESM and CommonJS imports are unchanged.

### 4. Direct Download

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
| `inputFilter` | `(event: PointerEvent) => boolean` | `null` | Optional host input filter; return `false` to ignore the input |
| `render` | `BAClickFXRenderOptions` | see below | Canvas quality, scale floor, and optional total pixel budget |

#### Render Budget and Canvas Size

Every field in `render` is optional:

| Option | Type | Default | Description |
|---|---|---|---|
| `maxDpr` | `number` | `1` | Maximum device pixel ratio |
| `minRenderScale` | `number` | `0.5` | Lowest render scale allowed when a budget is enabled |
| `trailRenderScale` | `number` | `1` | Trail offscreen Canvas scale relative to the main Canvas |
| `maxBackingPixels` | `number \| null` | `null` | Total backing-pixel budget across the main and internal canvases; `null` disables the budget |

With the default `maxBackingPixels: null`, no render scale is reduced by a budget. For a
non-zero layout, the default visual output and Canvas backing dimensions are identical to
v1.1.8. Enabling a budget only adjusts the internal render resolution. It does not change
colors, opacity,
geometry, timing, easing, random distribution, drawing formulas, or compositing order.

```js
const fx = new BAClickFX({
  target: '#myCanvas',
  render: {
    maxDpr: 2,
    minRenderScale: 0.5,
    trailRenderScale: 1,
    maxBackingPixels: 12_000_000,
  },
});

fx.setRenderOptions({ maxBackingPixels: 8_000_000 });
fx.refreshSize();
console.log(fx.getRenderMetrics());
```

External canvases are tracked with `ResizeObserver`, while an owned full-screen Canvas
tracks window resize. Both also track `visualViewport` and cross-display DPR changes through
one roughly 100 ms debounced refresh path. When an external Canvas has a `0 × 0` CSS layout
box, the engine pauses rendering instead of falling back to the window size and allocating
full-screen backing stores, then resumes automatically after the layout becomes non-zero.
`refreshSize()` is the immediate explicit fallback for tab, collapsed-panel, or host-known
layout changes.

One main Canvas can be bound to only one live `BAClickFX` instance, preventing engines from
clearing each other or overwriting transforms. Multiple instances created without `target`
receive independent canvases; an external Canvas can be claimed again after the previous
instance is destroyed.

`getRenderMetrics()` returns `cssWidth`, `cssHeight`, `devicePixelRatio`,
`effectivePixelRatio`, `trailRenderScale`, `totalBackingPixels`, `nominalRgbaBytes`,
`maxBackingPixels`, and `budgetExceeded`. `nominalRgbaBytes` is the theoretical lower
bound obtained by counting four RGBA bytes per backing pixel; it is not measured browser
RAM or GPU memory. `budgetExceeded` means the budget still cannot be met at the minimum
render scale.

To preserve strict zero visual differences, local click-wave scratch canvases were deferred
in v1.1.9. The production renderer retains the same per-wave full-size isolated compositing
path as v1.1.8.

#### Numeric Inputs and TypeScript Configuration Types

In v1.1.10, constructor options, render options, `boom()`, and every public numeric setter
safely handle `NaN`, `Infinity`, values that cannot be converted, and `Symbol`, falling back
to each API's existing stable default. Invalid color-setter channels retain their current
channel values. Existing conversion and clamping behavior for finite numbers, numeric strings,
and `Number(null) === 0` is unchanged.

`getConfig()` now returns the complete `BAClickFXConfig` type. Its nested structures are also
exported as `BAClickFXFilledCircleConfig`, `BAClickFXClickConfig`, `BAClickFXRingsConfig`,
`BAClickFXTrailConfig`, and `BAClickFXGlowConfig`. `CONFIG` remains available for compatibility,
but it is a live reference that can bypass setter validation and size synchronization, so it is
deprecated. Prefer a `getConfig()` snapshot for reads and setters or `setRenderOptions()` for writes.

These changes only strengthen input boundaries, type hints, and internal cache reuse. They do
not alter any default visual parameter or Canvas drawing result.

### Instance Methods

#### Basic

| Method | Description |
|---|---|
| `setColor(r, g, b)` | Theme color (0~255) |
| `setScale(s)` | Global scale (0.5~3) |
| `setOpacity(o)` | Opacity (0.1~1) |
| `setClick(enabled)` | Toggle future click effects; active click animations finish naturally |
| `setSpeed(click, trail?)` | Click/drag speed (0.2~3) |
| `setDpr(d)` | Max device pixel ratio (1~2) |
| `setTrailRenderScale(s)` | Trail offscreen canvas scale (0.5~1) |
| `setRenderOptions(options)` | Update render options together and recalculate backing-store sizes |
| `refreshSize()` | Immediately refresh the Canvas from its current CSS size and DPR |
| `getRenderMetrics()` | Return current size, effective render scale, budget status, and nominal RGBA cost |
| `setTouchAction(value)` | Mobile touch-action (`'auto'` / `'none'` / `'pan-y'`) |
| `setInputFilter(filter)` | Set the host Pointer input filter; pass `null` to accept all input again |

#### Glow

| Method | Description |
|---|---|
| `setGlow(enabled)` | Real glow (trail radial gradient halo + click shadowBlur) |
| `setFakeGlow(enabled)` | Multi-layer soft glow (recommended) |
| `setClickFakeGlow(enabled)` | Click effect soft glow |

#### Click

| Method | Description | Default |
|---|---|---|
| `setClick(enabled)` | Toggle future click effects without affecting active animations or trails | `true` |
| `setClickTotalLife(v)` | Effect duration (10~60 frames) | `27` |
| `setClickScaleMul(v)` | Click scale multiplier (0.5~3) | `1.3` |
| `setClickHaloRadius(v)` | Halo radius (30~200) | `96` |
| `setClickShardFlicker(period, minAlpha?)` | Shard flicker period/min alpha | `8, 0.45` |
| `setSparksCount(n)` | Click particle count (0~12) | `4` |

#### Disk

| Method | Description | Default |
|---|---|---|
| `setDiskSize(v)` | Disk growth rate (10~50) | `26` |
| `setDiskGlow(radiusMul, alpha?)` | Soft glow radius/opacity | `4.2, 0.13` |
| `setDiskTiming(maxLife, expandEnd?, colorEnd?, fadeStart?)` | Disk animation timing | `12.5, 0.84, 0.34, 0.78` |

#### Rings

| Method | Description | Default |
|---|---|---|
| `setRingRotationSpeed(v)` | Rotation speed (0~0.05) | `0.008` |
| `setRingEmission(v)` | Glow intensity (0~1) | `0.35` |
| `setRingWidth(v, maxValue?)` | Arc min/max width (0.3~3, 1~10) | `0.9, 4.0` |
| `setRingAlpha(v)` | Ring opacity (0.1~1) | `0.9` |
| `setRingDelay(v)` | Appearance delay (0~10) | `2` |
| `setRingMaxLife(v)` | Total lifetime (10~60) | `27` |
| `setRingBaseRadiusMul(v)` | Initial radius multiplier (0.2~1) | `0.47` |
| `setRingPostDiskGrow(v)` | Expansion amount (5~60) | `24` |
| `setRingGlowRadiusAdd(v)` | Glow radius (10~150) | `54` |
| `setRingSoftGlowRadiusAdd(v)` | Soft glow radius (20~200) | `96` |
| `setRingRadiusGrowEnd(v)` | Expansion progress threshold (0.2~1) | `0.66` |
| `setRingWidthEndMul(v)` | Width shrink (0.05~1) | `0.55` |
| `setRingWhiteMix(v)` | Whiteness (0~1) | `0.75` |
| `setRingGlowAlpha(v)` | Inner glow opacity (0~1) | `0.15` |
| `setRingSoftGlowAlpha(v)` | Outer glow opacity (0~0.5) | `0.08` |
| `setRingColorFadeStart(v)` | Color fade start (0~1) | `0.56` |
| `setRingColorEndWhiteMix(v)` | End whiteness (0~1) | `0.97` |
| `setRingArcLength(full, end?)` | Arc length (0.5~6.28) | `4.71, 1.05` |
| `setRingSegmentCount(min, max?)` | Segment count (1~8) | `2` |
| `setRingSegmentDetail(extra, cluster, lenMin, lenMax)` | Segment detail params | `0, 0.38, 0.46, 1.38` |
| `setRingRotationJitter(min, max?)` | Rotation jitter (0.1~5) | `0.54, 1.58` |
| `setRingSmallRadius(min, max?)` | Small radius growth (0.3~1.5) | `0.75, 0.92` |
| `setRingRadiusJitter(min, max?)` | Radius jitter (0~2) | `0.3, 0.8` |
| `setRingNormalGrow(min, max?)` | Normal segment growth (0.3~2) | `1.0` |
| `setRingCollapseTiming(growEnd, collapse, fade)` | Collapse timing | `0.16, 0.16, 1.0` |

#### Trail

| Method | Description | Default |
|---|---|---|
| `setTrail(enabled)` | Toggle trail; disabling immediately clears trails and trail shards | `true` |
| `setTrailAlways(enabled)` | Show on move | `false` |
| `setTrailOutsideBehavior(mode)` | Input behavior outside the Canvas | `'auto'` |
| `setTrailBrightness(a)` | Overall brightness (0.1~1) | `0.96` |
| `setTrailWhiteMix(v)` | Whiteness amount (0~1) | `0.45` |
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
| `setTrailGradientChunk(v)` | Gradient chunk length (0.3~10) | `1.5` |
| `setTrailMaxPoints(v)` | Max raw points (500~30000) | `12000` |
| `setTrailCoreWidth(slow, fast?)` | Core highlight width | `0.3, 0.52` |
| `setTrailHotWidth(slow, fast?)` | Hotspot width | `0.1, 0.24` |
| `setTrailGlowRadius(v)` | Real glow radius multiplier (4~30) | `25` |
| `setTrailGlowIntensity(v)` | Real glow intensity (0.02~0.5) | `0.13` |
| `setTrailMinDistance(v)` | Min sample distance (0.01~5) | `0.06` |
| `setTrailMaxJumpDistance(v)` | Jump distance threshold (50~2000) | `420` |
| `setTrailMaxCoalescedEvents(v)` | Max coalesced events (1~100) | `24` |
| `setTrailRailWidth(slow, fast?)` | Rail line width | `0.22, 0.36` |
| `setTrailRibbon(widthMul, alpha?)` | Ribbon width/opacity | `0, 0` |

`setTrailOutsideBehavior(mode)` only controls trails and does not affect click effects:

- `'auto'`: the default, compatible with 1.1.7. It processes Pointer samples that
  the browser actually dispatches and does not actively capture the pointer.
- `'pause-connect'`: while a trail session is active, samples outside the Canvas
  are ignored while the current anchor, smoothing state, and stroke are retained.
  Re-entry connects through the existing smoothing, jump threshold, and interpolation logic.
- `'continue'`: attempts Pointer Capture during a valid press and processes outside
  samples that the browser dispatches. It is not system-wide global mouse tracking and
  cannot sample after the browser or operating system stops delivering events.
- `'clamp'`: also attempts Pointer Capture during a valid press, but clamps every trail
  sample to the Canvas edge before smoothing, speed calculation, and interpolation.

All four modes end the current input on `blur`, `pointerup`, or `pointercancel`. Switching
modes releases existing Pointer Capture, ends the current stroke, and resets its input
anchor; already rendered visuals continue to decay with their existing timing. After
switching to `'continue'` or `'clamp'`, capture is attempted on the next valid `pointerdown`.
Read the current mode from `getConfig().trail.outsideBehavior`, or verify it with the
Mouse Leave selector on the demo page.

`inputFilter` and `setInputFilter()` let a host page exclude buttons, dialogs, or other
interactive regions from effect input. Filtering happens before `getBoundingClientRect()`,
`getCoalescedEvents()`, and random particle generation. `pointerup`, `pointercancel`, and
`blur` always perform cleanup so a changing filter cannot leave a stuck press. Filter errors
safely reject that input, and the callback is not included in `CONFIG/getConfig()`:

```js
const fx = new BAClickFX({
  inputFilter: event => !event.composedPath().some(
    node => node instanceof Element && node.matches?.('[data-no-click-fx]'),
  ),
});

fx.setInputFilter(null); // Accept all input again
```

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
| `setTrailLayerAlpha(main, core, hot, glow, soft, rail)` | Set all layer alphas at once | — |

#### Shards

| Method | Description | Default |
|---|---|---|
| `setMaxShards(n)` | Max shard count (0~200) | `38` |
| `setShardSpacing(d)` | Spacing (20~500) | `120` |
| `setShardChance(slow, fast)` | Extra chance | `0.04, 0.18` |
| `setShardLargeChance(p)` | Large shard probability | `0.62` |
| `setMoveSparkChance(v)` | Random spark on move (0~0.05) | `0` |
| `setTrailShardFlicker(period, minAlpha?, sizePulse?)` | Trail shard flicker params | `8, 0.35, 0.16` |
| `setTrailShardOffset(min, max?)` | Shard offset range (0~100) | `2, 36` |

#### Lifecycle

| Method | Description |
|---|---|
| `boom(x?, y?)` | Manually trigger click effect (center by default) |
| `clearTrail()` | Clear trails and trail shards while preserving the trail toggle, press state, and click effects |
| `getConfig()` | Return a deep copy of the current config |
| `resetConfig()` | Restore default config |
| `destroy()` | Idempotently release listeners, RAF, timers, Pointer Capture, and owned canvases while preserving an external Canvas node and size |

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
│   ├── build.mjs         # Build script
│   ├── verify-sync.cjs   # Demo control synchronization check
│   ├── verify-package.mjs # Version and entry-point checks
│   ├── verify-pack.mjs   # Exact npm package file check
│   └── verify-tarball.mjs # Local package install and entry-point check
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

Run the unified release checks before publishing:

```bash
npm ci
npm run check
```

`check` runs the build, tests, demo synchronization, version/entry-point checks,
the exact npm file-list check, and a local package installation check in order. `prepack` rebuilds the distributable files,
while `prepublishOnly` runs the complete verification; neither command publishes automatically.

---

## Acknowledgments

- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor) — Blue Archive cursor effect implementation
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark) — Early web implementation of Blue Archive click effects

The two projects above did not fully match the in-game look for mouse trails. This project optimizes both the click effect and trail effect on top of those foundations, and adds extensive customization options.

---

## License

MIT
