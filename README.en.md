# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) [![Edge Add-on](https://img.shields.io/badge/Edge_Add--on-Install-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) [![Firefox Add-on](https://img.shields.io/badge/Firefox_Add--on-Install-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/)

> 📖 [中文版](./README.md)

**A parameter-level port of the Blue Archive Unity UI/FX_Touch click effect and cursor trail for the web.**

`ba-click-fx` faithfully reproduces the ParticleSystem and TrailRenderer from the game's `FX_Touch.prefab` — colour curves, size curves, rotation speed, dissolve thresholds, HDR intensity, and TrailRenderer timing/width. **Full WebGL2** owns the complete Scene, Coverage, and MXFinalBloom output by default; unsupported environments fall back to Canvas 2D, Software Bloom, and Native Glow. Zero external runtime dependencies.

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
- [FAQ](#faq)
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
- Canvas 2D and Full WebGL2 crisp-geometry paths, with zero external runtime dependencies
- Five demo rendering choices: Full WebGL2 (default), WebGL2 Bloom, Software Bloom, Native Glow, and Legacy
- Full WebGL2 Scene by default, with automatic fallback to Canvas 2D, Software Bloom, and then Native Glow
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
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.15/dist/ba-click-fx.iife.js"></script>
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
  themeColor?: string,           // six-digit hex, default #4ca7ff
  outputCompositing?: 'scene' | 'transparent-overlay', // default scene
  clickEnabled?: boolean,        // default true
  trailEnabled?: boolean,        // default true
  trailAlways?: boolean,         // default false
  inputSource?: 'dom' | 'manual', // default dom
  clickTimeScale?: number,       // minimum 0.01, default 1
  trailTimeScale?: number,       // minimum 0.01, default 1
  effectBackend?: 'canvas2d' | 'webgl2' | 'auto', // default webgl2
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

`effectBackend` decides whether WebGL2 owns the complete crisp scene and Bloom. The Canvas 2D path then uses `bloomBackend` to select its Bloom implementation. The demo exposes five direct combinations:

| Demo choice | API configuration | Behaviour |
|---|---|---|
| Full WebGL2 | `{ effectBackend: 'webgl2', renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | Default; builds the complete Scene, Coverage, and MXFinalBloom output in one WebGL2 HDR pipeline; falls back to the Canvas 2D chain on failure |
| WebGL2 Bloom | `{ effectBackend: 'canvas2d', renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | Compatibility selector; when the GPU is available it reuses the same complete HDR Scene as Full WebGL2, then falls back through the Canvas 2D Software / Native chain on failure |
| Software Bloom | `{ effectBackend: 'canvas2d', renderingMode: 'enhanced', bloomBackend: 'software' }` | Compatibility implementation using an 8-bit Canvas mask, pixel readback, and full-viewport Float32 Bloom buffers |
| Native Glow | `{ effectBackend: 'canvas2d', renderingMode: 'enhanced', bloomBackend: 'native' }` | Uses Canvas 2D `shadowBlur`; cheaper, but visually different from post-process Bloom |
| Legacy | `{ effectBackend: 'canvas2d', renderingMode: 'legacy' }` | Uses Unity material energy and texture profiles with Canvas `shadowBlur` compatibility glow; WebGL backend requests are ignored |

The demo exposes Isolated Compositing as a separate switch beside the five rendering choices. It is disabled by default and orthogonal to the rendering backend: it changes only the final CSS compositing boundary for the canvases, not Bloom thresholds, filtering, colour calculations, or Bloom compute cost.

`bloomBackend: 'auto'` tries WebGL2 first, then Software Bloom, then Native Glow. The default `'webgl2'` uses the same fallback chain; explicit `'software'` falls back to Native Glow when pixel readback is unavailable. For compatibility with 1.2.13 and earlier, constructor options or `createConfig()` that explicitly provide `bloomBackend` / `softwareBloomEnabled` without `effectBackend` retain the `effectBackend: 'canvas2d'` configuration and fallback-state contract; an explicit `effectBackend` always wins. If both `bloomBackend` and the old `softwareBloomEnabled` field are provided, `bloomBackend` wins. The compatibility field still maps `true` to `'software'` and `false` to `'native'`.

To preserve the already reviewed colour, transparency, and edge sampling, a successful WebGL2 Bloom frame intentionally reuses the complete `WebGL2EffectRenderer` Scene instead of uploading an 8-bit Canvas Scene. It therefore uses the same shaders and pixel pipeline as Full WebGL2 and does not pre-rasterise a Canvas that will be hidden. The distinction is the compatibility contract: WebGL2 Bloom retains the `effectBackend: 'canvas2d'` request and its Software / Native fallback chain, while Full WebGL2 is owned directly by the complete-effect backend.

`outputCompositing: 'scene'` is the default and preserves Unity's direct additive RGB semantics for a known Scene render target; the demo and integrations that require strict game reproduction should use this mode. `'transparent-overlay'` must be selected explicitly by transparent desktop hosts such as BASpark, WebView2, and Electron: HDR RGB still drives Bloom, while final alpha comes from geometry Coverage, lifetime alpha, and `opacity`, preventing a high-HDR centre disk from fully occluding the desktop. It does not alter Bloom thresholds or emission strength.

`isolatedCompositing` defaults to `false`, so canvases mount directly into the target or page. With `true`, the library-owned main FX canvas, WebGL2 canvases, and light-background compatibility canvas resolve inside one transparent isolated group before that group is composited over the page. This prevents the browser from resolving compatibility layers independently against pure white and losing cyan-blue contrast. Each renderer already performs Unity's additive work internally and emits premultiplied alpha, so the outer layer no longer uses CSS `plus-lighter`, which would brighten the result a second time. Isolated compositing is a non-game web compatibility option and can be changed at runtime through `updateConfig()`.

Full WebGL2, WebGL2 Bloom, scene-background Final Passes, and isolated compositing require a library-owned DOM overlay. When `target` is an existing `<canvas>`, the library cannot safely insert the extra WebGL2, contrast, or isolation layers: Full Effect `'webgl2'` / `'auto'` falls back to `canvas2d`, Bloom `'webgl2'` / `'auto'` falls back to Software Bloom, and `isolatedCompositing` is forced to `false`. `getConfig()` reports these effective values. The default fullscreen overlay has no such limitation. A regular container is also supported, but it must establish its own positioning context, normally with `position: relative`; the library does not silently modify host styles.

Each `BAClickFX` instance owns a separate isolation group. Multiple isolated instances on the same page do not mix their internal compatibility layers across group boundaries, and switching or destroying one instance does not move or remove another instance's canvases.

On a pure-white page, enable isolated compositing. If `outputCompositing: 'scene'` still needs an extra crisp silhouette, opt into the light-background compatibility layer as well:

```js
const fx = new BAClickFX(
{
  isolatedCompositing: true,
  lightBackgroundContrastAlpha: 0.35,
});
```

For a transparent desktop host, explicitly select Full WebGL2 and transparent-overlay output, and disable the non-game light-background silhouette:

```js
const fx = new BAClickFX(
{
  effectBackend: 'webgl2',
  bloomBackend: 'webgl2',
  outputCompositing: 'transparent-overlay',
  lightBackgroundContrastAlpha: 0,
});
```

These controls have separate responsibilities. `isolatedCompositing` only decides whether library-owned canvases first resolve inside one transparent group; it does not sample page or desktop pixels. `lightBackgroundContrastAlpha` adds a non-game `darken` silhouette only for `scene` output and is ignored by `transparent-overlay`. Only `setSceneBackground()` supplies a known opaque background to the rendering pipeline. None of the three replaces another.

### Scene Background and Linear Compositing

`setSceneBackground()` supplies the renderer with a real opaque raster scene underneath the effect. Strict final-RGB Scene equivalence may only be claimed when Full WebGL2, or WebGL2 Bloom successfully resolved to the GPU, receives a known background whose pixels match the displayed content. Native Glow and Legacy use a Canvas Final Pass; Software Bloom continues to use the normal DOM-background path. Those capability-limited fallback paths must not be treated as pixel-equivalent to the complete WebGL2 Scene or Unity.

The real desktop is normally invisible to a transparent overlay. With `setSceneBackground(null)`, or when no background has been supplied, the renderer can only emit an alpha-bearing overlay for the host or operating system to composite later. An unknown background cannot mathematically reproduce Unity's result over a known opaque HDR Scene. `transparent-overlay` keeps Coverage, lifetime, and brightness relationships stable; it does not remove that information boundary.

Standard premultiplied `source-over` satisfies `Cout = Coverlay + Cbackground × (1 - A)`, while strict Unity additive output targets `Cbackground + E`. The required `Coverlay = E + A × Cbackground` therefore depends on background pixels that the library cannot read. For an unknown background, one transparent overlay cannot simultaneously guarantee strict Unity additive RGB, final alpha that represents only Coverage, and no darkening over pure white. `transparent-overlay` explicitly prioritises Coverage alpha and cross-backend continuity. For strict Scene RGB, keep the default `scene` mode and provide a pixel-matched known background through `setSceneBackground()`.

The implementation does not cap final alpha with `min(coverage, maxRGB)`. Although that approximation can hide some white-background darkening, it reinterprets emission brightness as occlusion, removes Coverage from black or low-energy trail regions, and breaks linear `opacity` and backend-transition continuity.

The extracted Additive shader fixes target alpha to `1`, while Dissolve specifies separate alpha blend factors. Those values describe writes into the game's already opaque camera target; they are not occlusion coverage for a transparent desktop window. Copying them mechanically without a matching background would turn particle quads into opaque rectangles. The background-free `scene` Final Pass therefore uses transport alpha capable of carrying premultiplied RGB, while `transparent-overlay` uses Coverage alpha. Neither claims to reproduce the Unity camera target's visually irrelevant final alpha. The strict-equivalence statement above applies only to final RGB under its stated conditions.

```js
const image = new Image();
image.crossOrigin = 'anonymous';
image.src = 'https://example.com/background.jpg';
await image.decode();

fx.setSceneBackground(image, { fit: 'cover' });
// Restore the transparent DOM background and release Canvas Final Pass targets.
fx.setSceneBackground(null);
```

Only centred `cover` is currently supported, matching CSS `background-size: cover` cropping. The caller owns decoding and CORS: a cross-origin server must allow anonymous reads or WebGL cannot upload the texture, in which case the method returns `false` or a deferred backend remains on its safe fallback. The Renderer retains the source object for WebGL context recovery, so do not close releasable sources such as `ImageBitmap` or `VideoFrame` before replacing the background or destroying the instance. Canvas and video sources upload their current frame at call time; call the method again after their content changes.

Backend and mode changes release idle viewport-sized textures and FBOs while retaining the WebGL context, programs, static textures, and accepted background source. Re-enabling a backend rebuilds only the frame resources needed at the current size. Background replacement is atomic across existing Renderers: if one rejects the new source, accepted Renderers roll back to the old background; a candidate that cannot roll back is discarded and rebuilt lazily when needed.

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

`clickTimeScale` and `trailTimeScale` must both be finite numbers no smaller than `0.01`. `1` is the original speed, `2` means twice the speed with half the duration, and `0.5` means half speed with twice the duration; `0` does not mean pause, and values below `0.01` are ignored. Both values can be updated at runtime:

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
| `setSceneBackground(source, { fit: 'cover' })` | Share a real raster scene across rendering backends; pass `null` to restore the transparent DOM background |
| `clear()` | Remove all visual objects |
| `clearTrail()` | Clear trail and shards only |
| `destroy()` | Destroy instance, remove listeners and canvas |
| `updateConfig({...})` | Update base config, input source, time scales, Full Effect/Bloom backends, DPR, and touch behaviour at runtime |
| `setThemeColor('#4ca7ff')` | Set and persist the theme colour; invalid input restores the default game blue |
| `setFxParam('rings.hdrIntensity', 5.992157)` | Modify one dot-path; returns `true` on success and `false` when rejected |
| `setFxParams(patch, options?)` | Validate and batch-apply a dot-path patch through the public Schema, returning per-entry results |
| `getFxConfig()` | Deep copy of current FX configuration |
| `resetFxConfig()` | Reset all FX parameters to the current Enhanced or Legacy mode baseline |
| `getConfig()` | Current config; `resolvedEffectBackend` and `resolvedBloomBackend` report the latest Full Effect and Bloom resolution results |

The main canvas dispatches `baclickfxeffectbackendchange` and `baclickfxbackendchange` when the Full Effect and Bloom resolution states change. Use the exported event names to track deferred probing, runtime fallback, and WebGL context recovery:

```js
import {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
} from 'ba-click-fx';

const fx = new BAClickFX(
{
  effectBackend: 'webgl2',
  bloomBackend: 'webgl2',
});

fx.canvas.addEventListener(EFFECT_BACKEND_CHANGE_EVENT, (event) =>
{
  console.log(event.detail.resolvedEffectBackend);
});

fx.canvas.addEventListener(BLOOM_BACKEND_CHANGE_EVENT, (event) =>
{
  console.log(event.detail.resolvedBloomBackend);
});
```

### Parameter Schema and Batch Updates

The library exports the read-only `FX_PARAM_SCHEMA`, the current `FX_PARAM_SCHEMA_VERSION`, and `FX_PARAM_MIGRATIONS`. Each public scalar path describes its type, hard bounds, default, unit, group, stable display order, localisation keys, recommended control range, linked parameters, and Enhanced/Legacy mode baselines. Hosts can build settings UIs without copying an independent control list. `step` and `display.step` only guide host UI controls. `setFxParam()` / `setFxParams()` do not quantise or round to those steps; they validate type, finiteness, and the hard `min` / `max` bounds. Hosts that require integer controls should round before submission.

The current `FX_PARAM_SCHEMA_VERSION` is `1`. The old `bloom.scatter` value has no proven visual equivalence to MXFinalBloom's `bloom.diffusion`. Migrating from version `0` to `1` therefore renames the path to `bloom.diffusion`, explicitly restores the Unity default value `7`, and reports both `renamed` and `defaulted` in `normalized`. Persisted patches should pass their original `schemaVersion`, allowing the library to apply `FX_PARAM_MIGRATIONS` in order. A future version, a missing migration chain, or a post-migration conflict is rejected explicitly rather than being dropped silently.

```js
import {
  BAClickFX,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  applyFxParamPatch,
} from 'ba-click-fx';

const fx = new BAClickFX();
const result = fx.setFxParams(
{
  'bloom.scatter': 0.35,
  'rings.hdrIntensity': 6.2,
},
{
  schemaVersion: 0,
  strict: true,
  reset: true,
});

console.log(FX_PARAM_SCHEMA.length, FX_PARAM_SCHEMA_VERSION, result);
```

A settings page can also migrate and validate persisted patches without creating DOM state or a renderer instance:

```js
const storedPatch =
{
  'bloom.scatter': 0.35,
};
const migrated = applyFxParamPatch(
  storedPatch,
  {
    schemaVersion: 0,
    strict: true,
  },
);

if (migrated.committed)
{
  const normalizedPatch = Object.fromEntries(
    migrated.applied.map(({ path, value }) => [path, value]),
  );

  localStorage.setItem('ba-click-fx', JSON.stringify(normalizedPatch));
}
```

The package-level `applyFxParamPatch()` uses the game defaults as its private validation baseline and accepts only `schemaVersion` and `strict`. It neither mutates an instance nor exposes the complete Unity configuration tree. Here, `committed` means that the candidate patch is safe to persist; only instance-level `setFxParams()` installs configuration into the current renderer. Mode resets remain an instance-level operation through `reset: true`.

The result contains `applied`, `normalized`, `rejected`, `committed`, and `schemaVersion`. `applied` contains the accepted final paths and values; `normalized` records renames, default restoration, numeric clamping, and Boolean coercion; `rejected` gives the path, original value, and reason; `committed` says whether the candidate configuration was actually installed. The default `strict: false` commits valid entries and reports rejected ones. With `strict: true`, one rejected entry rolls back the entire batch and `applied` is empty. `reset: true` first restores the current Enhanced or Legacy mode baseline and then applies the same patch; even an empty patch commits the reset. `setFxParam()` reuses this validation with strict single-entry semantics.

`themeColor` is also instance configuration state. It can be supplied to the constructor or `updateConfig()`; `setThemeColor()` uses the same normalisation path; and `getConfig()` returns the current value. Only six-digit hexadecimal colours are accepted. An empty string or invalid value restores the exported `DEFAULT_THEME_COLOR` (`#4ca7ff`). Theme state does not mutate the Unity parameter baseline in `UNITY_FX_TOUCH` or `FX_PARAM_SCHEMA`.

Click glow can be tuned independently from the trail. This scale changes only
the ring and center-disk Bloom emission in enhanced mode; Native Glow uses the
same scale through a monotonic bounded-alpha mapping, while Legacy keeps its
compatibility output:

```js
fx.setFxParam('bloom.clickEmissionScale', 1.25);
```

### Common Tunable FX Parameters (see FX_PARAM_SCHEMA for the complete list)

| Path | Default | Description |
|---|---|---|
| `rings.hdrIntensity` | 5.992157 | Ring HDR intensity |
| `rings.radiusMin` / `rings.radiusMax` | 68.92571232 / 80.41333104 | Random MeshTri outer-radius range before the lifetime size curve |
| `rings.bandToOuterRadius` | 0.0598573766 | Fixed source-mesh band-width-to-outer-radius ratio |
| `rings.widthStart` / `rings.widthEnd` | 1 / 1 | Source ring-width multipliers, not independent pixel widths |
| `rings.lifetimeMs` | 600 | Ring lifetime (ms) |
| `shards.hdrIntensity` | 5.992157 | Shard material HDR intensity; the source Start Color is also applied during rendering |
| `shards.clickCount` | 4 | Click shard count |
| `shards.maxCount` | 50 | Trail-shard limit per press; click shards and older instances do not consume it |
| `shards.trailSpacing` | 108 | Trail shard spacing |
| `bloom.threshold` | 1.0 | Unity-serialized Gamma-space bright-pass threshold; converted to Linear before prefiltering |
| `bloom.softKnee` | 0 | Soft transition around the threshold |
| `bloom.clamp` | 65472 | Unity-serialized Gamma-space prefilter limit; converted to Linear and capped to the shader half-float maximum of 65504 |
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

The original shader uses `Blend SrcAlpha One, One One`. ParticleSystemRenderer's Apply Active Color Space decodes the enabled Color over Lifetime vertex stream to Linear before multiplying it by the white 5.992157 HDR material in `FX_MAT_Touch_Tri3`. Dissolve thresholds the two-dimensional texture alpha instead of continuously reducing every pixel's opacity, while surviving pixels retain the sampled coverage. Full WebGL2 now samples Ring3 with the source UVs, Bilinear filtering, and Clamp in the fragment shader before the hard clip; it no longer interpolates pre-sampled alpha at the 96×8 grid vertices. Size and dissolve thresholds use the source keyframes and their in/out tangents with Unity cubic Hermite interpolation, rather than linear interpolation or a generic smoothstep.

The Ring (3)/(4) shards additionally multiply `startColor = 0.5377358` in linear space, so their white-stage peak energy is about `1.50`, not the material value `5.99`. Their random orientation, footprint, and lifetime size curve now come from the two frames in `FX_TEX_Triangle_02_1` instead of an oversized equilateral-triangle approximation.

### Cursor Trail

The trail follows the same rendering chain as the Unity source asset:

| Layer | Description |
|---|---|
| Geometry and core | Draw the original 2.7px HDR strip directly, then let Bloom expand it into a soft core |
| Gradient and Stretch UV | The gradient is reversed into the web's oldest-to-newest point order; texture U is mapped separately as `1 - progress`, keeping Unity's `U=0` at the newest point |
| Full WebGL2 texture | Upload the complete `512×512 RGB` `FX_TEX_Trail_03` and sample it per fragment with the source sRGB, Bilinear, Repeat, and no-mipmap settings; decode sRGB to Linear before multiplying by the Gradient and material intensity `23.968628` |
| Canvas compatibility texture | Software Bloom, Native Glow, and Legacy use a compact 2D LUT approximation of longitudinal brightness, transverse feathering, and non-zero edges to avoid costly software triangle texture rasterisation |
| Bloom | Ring, disk, trail, and triangle-shard HDR emission is processed by the selected Bloom backend |

Full WebGL2 and a WebGL2 Bloom frame that resolves successfully to the GPU use the same complete texture batch: a regular segment submits only two textured triangles, corner inserts retain the corner U, and the single-triangle cap tip stays at `V=0.5`. The complete RGB texture preserves per-channel and top/bottom-asymmetric detail that cannot be represented by a symmetric scalar profile. Capability-limited Canvas paths preserve parameters, geometry, lifetime, and overall energy relationships, but do not claim per-texture-pixel equivalence.

Shards scatter along the trail at distance intervals.

### Bloom Rendering Backends

Full WebGL2 and WebGL2 Bloom share `WebGL2EffectRenderer`, HDR emission parameters, and Bloom settings, and both build ring, disk, trail, and shard geometry directly on the GPU. They then follow the game's `Hidden/MXFinalBloom` path — four-tap prefiltering, Box4 mips, cumulative upsampling, and the original intensity conversion — and output the crisp Scene, Coverage, and Bloom in one Final Pass. WebGL2 Bloom remains a compatibility selector with separate backend state and a Canvas fallback chain, but successful frames no longer build or upload an 8-bit Canvas Scene.

`bloom.threshold` and `bloom.clamp` retain Unity's serialized Gamma-space semantics. Both are converted with Unity's `GammaToLinearSpace` before the linear-HDR prefilter, and Clamp is then limited to the shader `half` maximum of `65504`. The default configuration snapshot therefore still reports the serialized asset value `65472`, whose effective runtime limit is `65504`.

Availability is determined by actually creating a WebGL2 context, checking `EXT_color_buffer_float`, and validating the `RGBA16F` framebuffer. Full Effect state uses `effectBackend` / `resolvedEffectBackend`, while Bloom uses `bloomBackend` / `resolvedBloomBackend`; `auto` briefly reports `pending` before the first deferred probe and while a restored context is being validated. A visible context loss falls back to Canvas immediately and WebGL takes ownership again only after the complete restored resource chain succeeds.

### JavaScript Software Bloom

When `bloomBackend: 'software'` is selected explicitly or WebGL2 is unavailable, the renderer draws HDR emission into a full-viewport mask, reads the pixels back, and reproduces the main MXFinalBloom structure in JavaScript:

1. Decode the 8-bit mask into reusable Float32 RGB buffers.
2. Run four-tap threshold prefiltering to produce half-resolution mip0.
3. Build a Box4 mip pyramid whose level count is derived from `bloom.diffusion`.
4. Accumulate from the coarsest mip upward with SampleScale four-tap sampling.
5. Apply the game's intensity conversion, final four-tap sampling, and additive sRGB composite.

The default `isolatedCompositing: false` composites output layers directly against the DOM background; Unity's additive output necessarily loses colour and contrast on pure white. With `true`, the output layers first resolve inside a transparent group, then composite their coloured result and alpha over the page. This does not change the Bloom algorithm and exists only as a non-game compatibility path for pure-white web backgrounds. Use `setSceneBackground()` when the background must participate in the same linear Scene as it does in the game; isolation is not a substitute for background sampling.

`lightBackgroundContrastAlpha` defaults to `0`, so no visible silhouette outside the game resource is added. Setting it to `0.35` gives a library-owned overlay an independent pale-cyan `darken` mask above the main FX layer. The mask neither receives nor generates Bloom and exists only to recover a crisp silhouette on pure white. It and isolated compositing are both non-game web compatibility options. An existing Canvas supplied as the target can receive neither this separate backdrop-compositing layer nor isolated compositing.

The software backend uses one full-viewport mip pyramid and reuses its Float32 buffers between frames while limiting emission readback to the geometry's actual subregion. It shares the WebGL2 backend's mip-count formula, SampleScale, four-tap sampling, and intensity conversion, but its input first passes through an 8-bit Canvas encoding and transparent output is constrained by premultiplied alpha. If Canvas pixel readback/writeback is unavailable, rings and disks fall back to native `shadowBlur`, while trail emission is blurred once in a local offscreen buffer.

### Backend Capability Boundaries

| Path | Capability boundary |
|---|---|
| Full WebGL2 | Default selector; keeps geometry, Coverage, the HDR Scene, and MXFinalBloom in one floating-point pipeline when a matching background is supplied |
| WebGL2 Bloom | On GPU success, reuses the same complete floating-point Scene as Full WebGL2; the difference is its Canvas 2D request state and Software / Native failure-fallback contract |
| Software Bloom | The Bloom pyramid uses Float32 buffers, but its input comes from an 8-bit Canvas; a transparent overlay can only approximate Bloom with residual Coverage and cannot preserve arbitrary HDR RGB independently |
| Native Glow | A bounded Canvas `shadowBlur` approximation without `RGBA16F`, threshold prefiltering, or cumulative multi-level upsampling; it does not equal MXFinalBloom |
| Legacy | Retains compatibility parameter mappings and the older Canvas compositing style; reset restores its Legacy baseline, while glow remains constrained by `shadowBlur` and Canvas blending |

Consequently, “ported from the Unity project” describes the source of parameter values, texture sampling, curves, blend intent, and the known-Scene Full WebGL2 implementation. It does not mean every browser backend, arbitrary web background, or transparent desktop composition can be pixel-identical to an in-game screenshot. Fallbacks prioritise lifecycle, geometry relationships, monotonic Coverage, and availability without pretending that missing HDR Scene information exists.

---

## FAQ

### Why does the effect lose colour on a pure-white background?

The Unity effect uses additive blending. A nearly white target has little channel headroom left, so direct composition loses cyan-blue contrast. Enable `isolatedCompositing: true` on pure-white web pages so library-owned output layers resolve inside a transparent group first. If `scene` output still needs a clearer non-game silhouette, opt into `lightBackgroundContrastAlpha`; keep it at `0` for transparent-desktop `transparent-overlay` output.

### Can isolated compositing replace a scene background?

No. Isolation only changes the CSS compositing boundary for multiple canvases. It neither samples page or desktop pixels nor changes the Bloom algorithm. To make the background participate in the game's linear HDR Scene calculation, a complete WebGL2 Scene (Full WebGL2 or WebGL2 Bloom successfully resolved to the GPU) must receive a `setSceneBackground()` source that matches the displayed content. An unknown or changing desktop cannot be reproduced pixel for pixel.

### Can an unknown background have strict Unity additive RGB, pure Coverage alpha, and no white-background darkening at the same time?

No. `source-over` only receives overlay RGB and alpha, while the RGB needed for strict additive output depends on the background colour underneath; a transparent desktop does not expose those pixels to the library. Keep the default `scene` mode for the demo and strict reproduction, pass known backgrounds through `setSceneBackground()`, and select `transparent-overlay` explicitly for transparent desktop hosts with the understanding that it prioritises Coverage and alpha continuity rather than claiming pixel equivalence over every background.

### Which configuration should a transparent desktop host use?

Use `effectBackend: 'webgl2'`, `bloomBackend: 'webgl2'`, `outputCompositing: 'transparent-overlay'`, and `lightBackgroundContrastAlpha: 0`. The host should also listen for backend-resolution events because an unavailable or lost WebGL2 context enters a compatibility fallback. Fallbacks preserve the transparent-alpha contract but cannot promise the exact same Bloom as Full WebGL2.

---

## How It Differs

`ba-click-fx` focuses on faithfully recreating the Blue Archive in-game click FX from Unity project evidence. Final pixel equivalence still depends on the backend, a known scene background, colour management, and the host compositor.

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
│   ├── trail-texture.js  # Lossless Trail_03 RGB data for WebGL2
│   ├── software-bloom.js # MXFinalBloom Float32 mips and additive composite
│   ├── webgl2-effect.js  # Shared Full WebGL2 / WebGL2 Bloom Scene and Final Pass
│   ├── webgl2-canvas-scene.js # Canvas Scene Final Pass for Native / Legacy
│   ├── webgl2-bloom.js   # WebGL2 Bloom reference and regression baseline
│   └── style.css         # Demo page styles
├── scripts/
│   ├── build.mjs         # Build script
│   └── verify-*.mjs/cjs  # Release verification
├── test/
│   └── smoke.js          # Port, backend-state, and lifecycle verification
├── index.html            # Demo page
├── dist/                 # Build output (ESM / CJS / IIFE)
└── package.json
```

### Architecture

- **Isolated compositing layer:** disabled by default; enable the transparent isolated group explicitly to preserve colour on non-game pure-white web backgrounds.
- **Full WebGL2 Scene:** complete geometry, Coverage, background, and MXFinalBloom resolve through one HDR pipeline and one output pass.
- **Canvas Scene Final Pass:** Native Glow and Legacy reuse a Canvas-built Scene approximation; with a supplied background they share background attenuation and colour encoding, without claiming complete-WebGL2 floating-point precision.
- **Main FX layer:** Canvas paths accumulate emission with `lighter` internally and use premultiplied-alpha overlay output to avoid a second CSS brightness increase.
- **Light-background compatibility layer:** defaults to zero strength; set it explicitly to 0.35 to add a non-Bloom `darken` canvas for visibility on pure white.
- **Software Bloom:** full-viewport working canvases plus a Float32 MXFinalBloom pyramid, with a `shadowBlur` fallback when pixel readback is unavailable.
- **WebGL2 Bloom:** on GPU success the compatibility selector reuses the complete WebGL2 Scene without redundantly rasterising a hidden Canvas; insufficient capabilities fall back through Software / Native.
- **Resource lifecycle:** context loss falls back immediately and restores lazily; mode changes release full-size frame targets while retaining reusable static GPU resources.
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
