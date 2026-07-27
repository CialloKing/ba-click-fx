# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) [![Edge Add-on](https://img.shields.io/badge/Edge_Add--on-Install-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) [![Firefox Add-on](https://img.shields.io/badge/Firefox_Add--on-Install-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/)

> 📖 [中文版](./README.md)

**A parameter-level port of the Blue Archive Unity UI/FX_Touch click effect and cursor trail for the web.**

`ba-click-fx` faithfully reproduces the ParticleSystem and TrailRenderer from the game's `FX_Touch.prefab` — colour curves, size curves, rotation speed, dissolve thresholds, HDR intensity, and TrailRenderer timing/width. Crisp geometry uses **Canvas 2D**; Bloom defaults to the WebGL2 GPU pipeline and automatically falls back to Software Bloom and Native Glow. Zero external runtime dependencies.

**Live Demo:** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

> 🖱 Click, drag, or move your mouse on the demo page to preview.

<p align="center">
  <img src="https://github.com/CialloKing/ba-click-fx/releases/download/v1.2.12/ba-click-fx-demo.gif" alt="demo" width="45%">
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
- Four demo rendering choices: WebGL2 Bloom (default), Software Bloom, Native Glow, and Legacy
- WebGL2 GPU Bloom by default, with automatic fallback to Software Bloom and then Native Glow
- Browser extension, npm, CDN, and direct download
- Demo theme defaults to `#4ca7ff`, with custom HSL hue shifting
- Runtime-tweakable FX parameters via `setFxParam()`
- Particle sizes keep scaling with canvas height to preserve the Unity UI proportions

---

## Installation

### 1. Browser Extension

Install the browser extension for any of the supported stores:

| Store | Link |
|-------|------|
| **Chrome** | [Chrome Web Store](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) |
| **Edge** | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) |
| **Firefox** | [Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/) |

Source: [ba-click-fx-extension](https://github.com/CialloKing/ba-click-fx-extension).

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
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.13/dist/ba-click-fx.iife.js"></script>
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
  inputSource?: 'dom' | 'manual', // default dom
  clickTimeScale?: number,       // default 1
  trailTimeScale?: number,       // default 1
  renderingMode?: 'enhanced' | 'legacy', // default enhanced
  bloomBackend?: 'auto' | 'software' | 'webgl2' | 'native', // default webgl2
  softwareBloomEnabled?: boolean, // compatibility alias: true = software, false = native
  isolatedCompositing?: boolean,  // default false; true enables non-game white-background compatibility
  lightBackgroundContrastAlpha?: number, // light-background compatibility strength, default 0
  maxDpr?: number,               // default 2
  touchAction?: string,          // default 'auto'
  inputFilter?: (e: PointerEvent) => boolean,
})
```

In enhanced mode, `bloomBackend` selects the Bloom implementation. The demo combines these backends with Legacy into four direct choices:

| Demo choice | API configuration | Behaviour |
|---|---|---|
| WebGL2 Bloom | `{ renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | Default; runs the game's MXFinalBloom passes on the GPU and falls back automatically when unavailable |
| Software Bloom | `{ renderingMode: 'enhanced', bloomBackend: 'software' }` | Reference/compatibility implementation using Canvas 2D pixel readback and full-viewport Float32 buffers |
| Native Glow | `{ renderingMode: 'enhanced', bloomBackend: 'native' }` | Uses Canvas 2D `shadowBlur`; cheaper, but visually different from post-process Bloom |
| Legacy | `{ renderingMode: 'legacy' }` | Uses Unity material energy and texture profiles with Canvas `shadowBlur` compatibility glow; the Bloom backend is ignored |

The demo exposes Isolated Compositing as a separate switch beside the four rendering choices. It is disabled by default and is orthogonal to Software, WebGL2, Native, and Legacy rendering: it changes only the final CSS compositing boundary for the canvases, not Bloom thresholds, filtering, colour calculations, or Bloom compute cost.

`bloomBackend: 'auto'` tries WebGL2 first, then Software Bloom, then Native Glow. The default `'webgl2'` uses the same fallback chain; explicit `'software'` falls back to Native Glow when pixel readback is unavailable. If both `bloomBackend` and the old `softwareBloomEnabled` field are provided, `bloomBackend` wins. The compatibility field still maps `true` to `'software'` and `false` to `'native'`.

`isolatedCompositing` defaults to `false`, so canvases mount directly into the target or page and follow Unity's direct additive path. With `true`, the library-owned main FX canvas, WebGL2 Bloom canvas, and light-background compatibility canvas blend inside one transparent isolated group before that group is composited over the page. This prevents `plus-lighter` from clipping cyan-blue output to white against a pure-white page. Isolated compositing is a non-game web compatibility option and can be changed at runtime through `updateConfig()`.

WebGL2 Bloom and isolated compositing both require a library-owned DOM overlay. When `target` is an existing `<canvas>`, the library cannot safely insert the extra WebGL2, contrast, or isolation layers, so `'webgl2'` / `'auto'` falls back to Software Bloom and `isolatedCompositing` is forced to `false`; `getConfig()` reports this effective value. The default fullscreen overlay has no such limitation. A regular container is also supported, but it must establish its own positioning context, normally with `position: relative`; the library does not silently modify host styles.

Each `BAClickFX` instance owns a separate isolation group. Multiple isolated instances on the same page do not run `plus-lighter` across group boundaries, and switching or destroying one instance does not move or remove another instance's canvases.

For extra contrast on a pure-white page, explicitly enable both web compatibility options:

```js
const fx = new BAClickFX(
{
  isolatedCompositing: true,
  lightBackgroundContrastAlpha: 0.35,
});
```

### Host Input and Pointer Lifecycle

`inputSource` defaults to `'dom'` to preserve existing web behaviour:

- `'dom'`: the library automatically listens for DOM Pointer events.
- `'manual'`: automatic DOM pointer listeners are not registered; an Electron, WebView2, browser-extension, or other host calls the public pointer methods. Resize, WebGL Context, and other lifecycle listeners are unaffected.

`pointerDown()`, `pointerMove()`, `pointerUp()`, and `pointerCancel()` remain callable with either `inputSource`; their return values indicate whether the current pointer state accepted the input. Manual `x` / `y` values use Canvas-local CSS pixels and are clamped to the Canvas bounds; `pointerId` defaults to `1`. `inputFilter` applies only when admitting automatic DOM input, never to manual input, so a host-converted logical primary pointer such as a right- or middle-button action is not rejected a second time by the library.

```js
const fx = new BAClickFX(
{
  target: '#myCanvas',
  inputSource: 'manual',
});

fx.pointerDown(
{
  x: 120,
  y: 80,
  pointerId: 7,
  pointerType: 'pen',
});
fx.pointerMove(
{
  x: 148,
  y: 96,
  pointerId: 7,
  pointerType: 'pen',
});
fx.pointerUp(7);
```

`pointerDown()` starts one click-and-trail lifecycle. `pointerUp()` stops appending samples and lets the existing trail decay for the Unity TrailRenderer's `0.3s` duration. `pointerCancel()` is for display switches, suspension, and abnormal recovery, so it also removes the current trail immediately. `boom(x, y)` remains a click-only convenience method and never creates trail pointer state.

`inputSource` can also be switched through `updateConfig()`. A switch first cancels the old source's active pointer, then attaches or removes the automatic DOM pointer listeners for the target mode so the host never inherits a half-finished stroke.

### Independent Time Scales

`clickTimeScale` and `trailTimeScale` must both be finite numbers greater than `0`. `1` is the original speed, `2` means twice the speed with half the duration, and `0.5` means half speed with twice the duration; `0` does not mean pause. Both values can be updated at runtime:

```js
fx.updateConfig(
{
  clickTimeScale: 1.5,
  trailTimeScale: 0.8,
});
```

`clickTimeScale` scales click-wave lifetime, rotation, click-shard lifetime, and displacement together. `trailTimeScale` scales trail decay, trail-shard lifetime, and displacement together. Neither changes spatial sampling settings such as `minVertexDistance` or `trailSpacing`.

### Pause and Resume

```js
const pauseOptions =
{
  clear: true,
};

fx.setPaused(true, pauseOptions);
fx.setPaused(false);
```

Pausing cancels the active pointer, ignores `boom()` and every automatic or manual pointer input, and stops requesting new `requestAnimationFrame` callbacks. `clear` applies only when `paused` is `true`: `clear: true` removes all visual objects, while `setPaused(false, { clear: true })` does not clear. Resuming resets the time baseline so time spent paused is not applied as a large delta on the next frame.

`trailAlways` also renders on demand: an active pointer alone does not count as visible work. RAF stops after waves, shards, and valid trail points are gone, and the next `pointerMove()` wakes rendering again.

### Instance Methods

| Method | Description |
|---|---|
| `boom(x, y)` | Trigger one click effect without creating trail state |
| `pointerDown(input)` | Start one click-and-trail lifecycle |
| `pointerMove(input)` | Append a trail sample for the current logical pointer |
| `pointerUp(pointerId?)` | End the pointer normally and let its trail decay |
| `pointerCancel(pointerId?)` | Force-cancel the pointer and remove its current trail immediately |
| `setPaused(paused, options?)` | Pause or resume input and animation scheduling, optionally clearing on pause |
| `clear()` | Remove all visual objects |
| `clearTrail()` | Clear trail and shards only |
| `destroy()` | Destroy instance, remove listeners and canvas |
| `updateConfig({...})` | Update base config, input source, time scales, Bloom backend, DPR, and touch behaviour at runtime |
| `setThemeColor('#4ca7ff')` | Set the theme colour; this game blue is the demo default |
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
| `rings.radiusMin` / `rings.radiusMax` | 68.92571232 / 80.41333104 | Random MeshTri outer-radius range before the lifetime size curve |
| `rings.bandToOuterRadius` | 0.0598573766 | Fixed source-mesh band-width-to-outer-radius ratio |
| `rings.widthStart` / `rings.widthEnd` | 1 / 1 | Source ring-width multipliers, not independent pixel widths |
| `rings.lifetimeMs` | 600 | Ring lifetime (ms) |
| `shards.hdrIntensity` | 5.992157 | Shard material HDR intensity; the source Start Color is also applied during rendering |
| `shards.clickCount` | 4 | Click shard count |
| `shards.maxCount` | 96 | Max shards |
| `shards.trailSpacing` | 108 | Trail shard spacing |
| `bloom.threshold` | 1.0 | Bright-pass threshold |
| `bloom.softKnee` | 0 | Soft transition around the threshold |
| `bloom.clamp` | 65472 | MXFinalBloom prefilter HDR clamp |
| `bloom.intensity` | 1.7 | In-game MXFinalBloom intensity |
| `bloom.diffusion` | 7 | Diffusion parameter used to derive mip count and SampleScale |
| `bloom.resolutionScale` | 0.5 | Bloom buffer scale (internally clamped to 0.1–0.75) |
| `bloom.clickEmissionScale` | 1.0 | Independent glow scale for click rings and the center disk, recommended range `0–4`; does not affect crisp geometry or the trail |
| `bloom.ringEmissionAlpha` | 1.0 | HDR ring emission aligned with the FX_MAT_Touch_Tri3 material alpha |
| `bloom.diskEmissionAlpha` | 1.0 | HDR disk emission scale for software Bloom |
| `bloom.ringBlur` | 80 | Native ring blur radius when pixel readback is unavailable |
| `bloom.ringAlpha` | 0.35 | Native ring blur intensity when pixel readback is unavailable |
| `bloom.diskBlur` | 65 | Native disk blur radius when pixel readback is unavailable |
| `bloom.diskAlpha` | 0.65 | Native disk blur intensity when pixel readback is unavailable |
| `bloom.trailCoverageScale` | 1.0 | Keeps Bloom emission at the same 2.7px width as the Unity triangle strip |
| `bloom.trailEmissionAlpha` | 1.0 | HDR trail emission scale for software Bloom |
| `bloom.trailAlpha` | 0.18 | Native local offscreen-blur fallback intensity |
| `trail.width` | 2.7 | Crisp trail geometry width |
| `trail.outerGlowWidth` | 9 | Native local offscreen fallback glow radius |
| `trail.lifetimeMs` | 300 | Trail lifetime (ms) |

`rootDurationMs = 1000` is retained only as the original Unity root ParticleSystem's object-pool release metadata. Visible web lifetimes come from the child particles and TrailRenderer themselves; this field is not a visual tuning parameter, and changing it does not alter the rendered result.

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

The Ring (3)/(4) shards additionally multiply `startColor = 0.5377358` in linear space, so their white-stage peak energy is about `1.50`, not the material value `5.99`. Their random orientation, footprint, and lifetime size curve now come from the two frames in `FX_TEX_Triangle_02_1` instead of an oversized equilateral-triangle approximation.

### Cursor Trail

The trail follows the same rendering chain as the Unity source asset:

| Layer | Description |
|---|---|
| Geometry and core | Draw the original 2.7px HDR strip directly, then let Bloom expand it into a soft core |
| Longitudinal envelope | The original TrailRenderer gradient is reversed into Canvas point order, then multiplied by the stretched `FX_TEX_Trail_03` brightness converted from sRGB to linear energy |
| 2D texture envelope | The transverse feather changes along the stretched length; each segment bilinearly interpolates the source samples so the middle is not widened by a fixed bright core |
| Bloom | Ring, disk, trail, and triangle-shard HDR emission is processed by the selected Bloom backend |

Shards scatter along the trail at distance intervals.

### Bloom Rendering Backends

WebGL2 and Software Bloom share the same HDR emission parameters and Bloom settings. The WebGL2 branch draws ring, disk, trail, and shard emission into transparent GPU framebuffers, then follows the game's `Hidden/MXFinalBloom` path: four-tap prefiltering, Box4 mips, cumulative upsampling, and the original intensity conversion.

Availability is determined by actually creating a WebGL2 context, checking `EXT_color_buffer_float`, and validating the `RGBA16F` framebuffer. Read the requested backend and latest resolution result through `getConfig().bloomBackend` and `getConfig().resolvedBloomBackend` respectively. WebGL2/auto briefly reports `pending` before the first deferred probe and while a restored context is being validated.

### JavaScript Software Bloom

When `bloomBackend: 'software'` is selected explicitly or WebGL2 is unavailable, the renderer draws all HDR emission into a full-viewport mask, reads the pixels back, and runs the same MXFinalBloom structure in JavaScript:

1. Decode the 8-bit mask into reusable Float32 RGB buffers.
2. Run four-tap threshold prefiltering to produce half-resolution mip0.
3. Build a Box4 mip pyramid whose level count is derived from `bloom.diffusion`.
4. Accumulate from the coarsest mip upward with SampleScale four-tap sampling.
5. Apply the game's intensity conversion, final four-tap sampling, and additive sRGB composite.

The default `isolatedCompositing: false` blends the main layer directly against the DOM background with `plus-lighter`, preserving Unity's strict additive semantics; additive output necessarily loses colour and contrast on pure white. With `true`, the main layer, WebGL2 Bloom layer, and compatibility layer first resolve inside a transparent group, then composite their coloured result and alpha over the page. This does not change the Bloom algorithm and exists only as a non-game compatibility path for pure-white web backgrounds.

`lightBackgroundContrastAlpha` defaults to `0`, so no visible silhouette outside the game resource is added. Setting it to `0.35` gives a library-owned overlay an independent pale-cyan `darken` mask above the main FX layer. The mask neither receives nor generates Bloom and exists only to recover a crisp silhouette on pure white. It and isolated compositing are both non-game web compatibility options. An existing Canvas supplied as the target can receive neither this separate backdrop-compositing layer nor isolated compositing.

The software backend uses one full-viewport mip pyramid and reuses its Float32 buffers between frames while limiting emission readback to the geometry's actual subregion. It shares the WebGL2 backend's mip-count formula, SampleScale, four-tap sampling, and intensity conversion. If Canvas pixel readback/writeback is unavailable, rings and disks fall back to native `shadowBlur`, while trail emission is blurred once in a local offscreen buffer.

---

## How It Differs

`ba-click-fx` focuses on faithfully recreating the Blue Archive in-game click FX with pixel-level accuracy.

Compared to generic cursor effects:

- Game-accurate dissolve rings, center disk, and shard burst
- Parameter-level reproduction of Unity ParticleSystem curves
- Trail fades continuously from head to tail, not all at once
- Particle sizes keep scaling with canvas height to preserve Unity UI proportions
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
│   ├── software-bloom.js # MXFinalBloom Float32 mips and additive composite
│   ├── webgl2-bloom.js   # WebGL2 HDR emission and MXFinalBloom composite
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

- **Isolated compositing layer:** disabled by default; enable the transparent isolated group explicitly to preserve colour on non-game pure-white web backgrounds.
- **Main FX layer:** effects use `lighter` internally and the main canvas uses `plus-lighter`; `isolatedCompositing` selects its backdrop.
- **Light-background compatibility layer:** defaults to zero strength; set it explicitly to 0.35 to add a non-Bloom `darken` canvas for visibility on pure white.
- **Software Bloom:** full-viewport working canvases plus a Float32 MXFinalBloom pyramid, with a `shadowBlur` fallback when pixel readback is unavailable.
- **WebGL2 Bloom:** the default transparent GPU overlay performs the game's MXFinalBloom passes and falls back when capabilities are insufficient.
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
