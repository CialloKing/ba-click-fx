# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) [![Edge Add-on](https://img.shields.io/badge/Edge_Add--on-Install-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) [![Firefox Add-on](https://img.shields.io/badge/Firefox_Add--on-Install-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/)

> 📖 [中文版](./README.md)

**A parameter-level port of the Blue Archive Unity UI/FX_Touch click effect and cursor trail for the web.**

`ba-click-fx` faithfully reproduces the ParticleSystem and TrailRenderer from the game's `FX_Touch.prefab` — colour curves, size curves, rotation speed, dissolve thresholds, HDR intensity, and TrailRenderer timing/width. **Full WebGL2** owns the complete Scene, Coverage, and MXFinalBloom output by default. Optional WebGPU modes provide a guaranteed standard SDR Canvas or, when the browser and display chain support it, real highlights above SDR white. WebGL2, Canvas 2D, Software Bloom, and Native Glow remain automatic fallbacks. Zero external runtime dependencies.

**Live Demo:** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

> 🖱 Click, drag, or move your mouse on the demo page to preview.

<p align="center">
  <img src="https://github.com/CialloKing/ba-click-fx/releases/download/v1.2.12/ba-click-fx-demo.gif" alt="demo" width="45%">
  &nbsp;&nbsp;
  <img src="./docs/assets/blue-archive-reference.gif" alt="game reference" width="45%">
</p>
<p align="center"><sub>ba-click-fx demo (left) · In-game reference (right)</sub></p>

> 🖥 **Desktop (Windows test build):** [ba-click-fx-desktop](https://github.com/CialloKing/ba-click-fx-desktop) reimplements the same effect from scratch in C++ / Win32 API / Direct3D 11. See the [Desktop Edition](#desktop-edition-windows-test-build) section.

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Desktop Edition (Windows Test Build)](#desktop-edition-windows-test-build)
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
- Canvas 2D, Full WebGL2, and WebGPU share the reviewed effect geometry with zero external runtime dependencies
- Seven demo rendering choices: WebGPU, WebGPU HDR (experimental), Full WebGL2 (default), WebGL2 Bloom, Software Bloom, Native Glow, and Legacy
- WebGPU uses an `rgba16float` linear Scene and multi-level Bloom; the ordinary mode forces a standard SDR Canvas, while the HDR mode may request `extended` output that preserves highlights above SDR white
- An unavailable or lost WebGPU device falls back to Full WebGL2, then through Canvas 2D, Software Bloom, and Native Glow
- Advanced hosts can place the core in a Worker with direct `OffscreenCanvas`, Full WebGL2, manual input, and explicit sizing
- Browser extension, npm, CDN, and direct download
- Theme colours support compatible HSL hue shifting and recommended relative-OKLCH full-colour mapping
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
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.3.0/dist/ba-click-fx.iife.js"></script>
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

## Desktop Edition (Windows Test Build)

[ba-click-fx-desktop](https://github.com/CialloKing/ba-click-fx-desktop) is an independently implemented Windows-native desktop edition. It does not reuse this project's JavaScript / WebGL / WebGPU code; instead it reimplements the same Blue Archive click effect and cursor trail from scratch with **C++20, Win32 API, Direct3D 11, HLSL, and DirectComposition**. Unity/game assets remain the visual ground truth, while the web version only serves as the behavioural and parameter-semantics reference.

The current release is the **first test build (Alpha)**, and its support contract covers the single-primary-monitor FX-only / SDR path only:

- Single-file runtime: the Visual C++ runtime is statically linked, and only Windows system components such as D3D11, DirectComposition, WIC, and D3DCompiler are used
- The overlay is click-through and never steals focus; quit via the notification-area icon's right-click menu, or press `Ctrl+Alt+F12`
- Ships with a standalone Control Center (`BAFX.ControlCenter.exe`, pure Win32 Common Controls, no Windows App SDK): it connects to the Host over a local Named Pipe and can pause/resume effects as well as tweak effect size, trail length/width, Bloom strength/quality, and more
- Build and tests are driven by CMake presets (Visual Studio 2026 + Windows SDK); architecture and decision documents live in `ARCHITECTURE.md` and `docs/adr` of the desktop repository

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
  target?: string | HTMLElement | OffscreenCanvas,
  scale?: number,                // default 1
  opacity?: number,              // default 1
  themeColor?: string,           // six-digit hex, default #4ca7ff
  themeColorMode?: 'hue-only' | 'relative-oklch', // public-library default: hue-only
  outputCompositing?: 'scene' | 'browser-overlay', // default scene
  overlayAlphaPolicy?: 'coverage' | 'visual-max', // default coverage
  overlayColorCompensation?: 'none' | 'bright-core', // default none
  overlayAlphaLimit?: number,    // overlay alpha limit, default 250/255
  hostCompositing?: 'source-over' | 'screen' | 'plus-lighter', // default source-over
  clickEnabled?: boolean,        // default true
  trailEnabled?: boolean,        // default true
  trailAlways?: boolean,         // default false
  inputSource?: 'dom' | 'manual', // default dom
  inputSamplingRate?: number,     // move-input rate limit; 0 unlimited, 1..1000 Hz, default 0
  clickTimeScale?: number,       // minimum 0.01, default 1
  trailTimeScale?: number,       // minimum 0.01, default 1
  effectBackend?: 'canvas2d' | 'webgl2' | 'webgpu' | 'auto', // default webgl2
  webgpuPreferHdr?: boolean,      // true prefers HDR; false forces standard SDR; default true
  webgpuHdrPeak?: number,        // Extended linear peak 2..4, default 3
  webgpuHdrBrightness?: number,  // Extended effect brightness multiplier 0..32, default 1
  webgpuHdrColorPreservation?: number, // Extended highlight hue preservation 0..1, default 0
  webgpuHdrWhiteCore?: number,   // Extended white-core strength 0..1, default 0.6
  webgpuHdrWhiteStart?: number,  // Extended white-core start 0..15.99, default 1
  webgpuHdrWhiteEnd?: number,    // Extended white-core end 0.01..16, default 5
  renderingMode?: 'enhanced' | 'legacy', // default enhanced
  bloomBackend?: 'auto' | 'software' | 'webgl2' | 'native', // default webgl2
  softwareBloomEnabled?: boolean, // compatibility alias: true = software, false = native
  isolatedCompositing?: boolean,  // default false; true enables non-game white-background compatibility
  lightBackgroundContrastAlpha?: number, // light-background compatibility strength, default 0
  maxDpr?: number,               // default 1; raise explicitly for capable devices
  touchAction?: string,          // DOM touch-gesture policy; default 'auto'
  inputFilter?: (e: PointerEvent) => boolean,
})
```

`touchAction` accepts CSS `touch-action` keywords and space-separated combinations, including `none`, `pan-x`, `pan-y`, `pan-left`, `pan-right`, `pan-up`, `pan-down`, and `pinch-zoom`. DOM input installs capture Touch arbitration only when the policy must block a direction or pinch; `auto`, `manipulation`, and combinations that explicitly allow every axis and pinch retain the browser's compositor-friendly scrolling. When an overlay Canvas is not hit-testable, the library locks the gesture direction at its first meaningful move and applies `inputFilter` to exclude host controls; `inputSource: 'manual'` does not install these DOM listeners.

`effectBackend` decides whether WebGPU or WebGL2 owns the complete crisp scene and Bloom. `webgpuPreferHdr` only controls whether the final WebGPU Canvas attempts Extended HDR; `false` forces Standard SDR. The Canvas 2D path then uses `bloomBackend` to select its Bloom implementation. The demo exposes seven direct combinations:

| Demo choice | API configuration | Behaviour |
|---|---|---|
| WebGPU | `{ effectBackend: 'webgpu', webgpuPreferHdr: false, renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | Formal ordinary WebGPU mode. It configures only the browser-preferred Standard SDR Canvas and never requests `toneMapping: extended`, while retaining the Unity-aligned linear Scene and MXFinalBloom |
| WebGPU HDR (experimental) | `{ effectBackend: 'webgpu', webgpuPreferHdr: true, renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | Requests WebGPU asynchronously and prefers `rgba16float + toneMapping: extended`; if HDR Canvas configuration is unavailable it keeps WebGPU with standard SDR output, while an unavailable or lost device falls back to Full WebGL2 |
| Full WebGL2 | `{ effectBackend: 'webgl2', renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | Default; builds the complete Scene, Coverage, and MXFinalBloom output in one WebGL2 HDR pipeline; falls back to the Canvas 2D chain on failure |
| WebGL2 Bloom | `{ effectBackend: 'canvas2d', renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | Compatibility selector; when the GPU is available it reuses the same complete HDR Scene as Full WebGL2, then falls back through the Canvas 2D Software / Native chain on failure |
| Software Bloom | `{ effectBackend: 'canvas2d', renderingMode: 'enhanced', bloomBackend: 'software' }` | Compatibility implementation using an 8-bit Canvas mask, pixel readback, and full-viewport Float32 Bloom buffers |
| Native Glow | `{ effectBackend: 'canvas2d', renderingMode: 'enhanced', bloomBackend: 'native' }` | Uses Canvas 2D `shadowBlur`; cheaper, but visually different from post-process Bloom |
| Legacy | `{ effectBackend: 'canvas2d', renderingMode: 'legacy' }` | Uses Unity material energy and texture profiles with Canvas `shadowBlur` compatibility glow; WebGL backend requests are ignored |

The demo exposes Isolated Compositing as a separate switch beside the seven rendering choices. It is disabled by default and orthogonal to the rendering backend: it changes only the final CSS compositing boundary for the canvases, not Bloom thresholds, filtering, colour calculations, or Bloom compute cost.

WebGPU availability does not imply HDR display output. Only `getConfig().resolvedWebGPUOutputMode === 'extended'` means that the Canvas negotiated extended dynamic range, encodes the linear HDR result as extended sRGB, and preserves highlights above SDR white. `'standard'` means the WebGPU Scene and Bloom are running but the final Canvas remains SDR, `'pending'` means device or first-frame work is in progress, and `'unavailable'` means no WebGPU output is active. Visible super-white highlights additionally require an HDR display, system HDR enabled, browser support for WebGPU HDR Canvas, and successful `rgba16float + toneMapping: extended` configuration.

Setting `webgpuPreferHdr: false` skips Extended configuration on every browser and uses the browser-preferred Standard SDR Canvas directly; this is the fixed contract of the demo's ordinary “WebGPU” mode. The internal `rgba16float` Scene remains necessary to retain emission energy before prefiltering and preserve Unity MXFinalBloom precision. It is not HDR display output; `resolvedWebGPUOutputMode` remains the only output verdict.

Below the HDR summary, the demo provides a collapsed WebGPU Diagnostics section. It reports the secure context, WebGPU API, Canvas context, adapter, device, Extended Canvas, Standard SDR, first-frame pipeline, graphics/video dynamic range, and CSS HDR syntax support, while retaining stable failure-stage codes and browser exception text. `(video-dynamic-range: high)` is only a video-output environment hint and does not participate in the WebGPU HDR success verdict. `CSS.supports()` likewise proves only that the browser accepts the relevant syntax, not that the current display is producing HDR output. A webpage cannot reliably read the operating-system HDR switch or display luminance in nits; the final browser-side criterion remains `resolvedWebGPUOutputMode === 'extended'`.

The demo's UI HDR controls are demo-only. In addition to an effect that actually resolves to WebGPU Extended, the browser must support extended `color(srgb-linear ...)` values and `dynamic-range-limit: no-limit`; otherwise the controls are disabled. The demo applies CSS HDR outlines and glows directly to the title, status area, panel edges, and interactive controls, without creating a second full-screen Canvas or using `mix-blend-mode`. The `1..16` UI HDR Brightness multiplier is not part of the `BAClickFX` public API and does not change `webgpuHdrBrightness`, Unity FX parameters, or click-effect pixels.

`webgpuHdrPeak`, `webgpuHdrBrightness`, `webgpuHdrColorPreservation`, `webgpuHdrWhiteCore`, `webgpuHdrWhiteStart`, and `webgpuHdrWhiteEnd` calibrate only the final HDR presentation mapping of a WebGPU Extended Canvas. WebGPU Standard, WebGL2, and Canvas 2D output are unaffected, and these options do not change Unity FX parameters, particle counts, geometry, or the Bloom algorithm. `webgpuHdrBrightness` is a linear multiplier in the `0..32` range. When a matching compositing reference is present, it amplifies only the effect increment above that background and does not brighten the reference itself. High values let advanced users target more display highlight headroom, but the browser, operating system, or display may clip, compress, or tone-map them, so the value is not a fixed nit target.

`webgpuHdrColorPreservation` controls how strongly the highlight increment is restored towards the original linear RGB chromatic direction. Its range is `0..1`; the default `0` preserves the existing gradual white-core presentation. At `1`, the HDR shoulder still determines the peak, while high brightness multipliers no longer amplify white-core colour drift introduced by the renderer. The demo's Preserve Original Hue preset sets this option to `1` and `webgpuHdrWhiteCore` to `0`. This removes renderer-induced whitening, but it cannot prevent the browser, operating system, or display from reducing saturation when the requested output exceeds its actual HDR colour volume.

Explicit `effectBackend: 'webgpu'` and `'auto'` both resolve the complete-effect backend in WebGPU → WebGL2 → Canvas 2D order. The default remains the stable `'webgl2'`, so upgrading does not silently switch existing pages to WebGPU.

`bloomBackend: 'auto'` tries WebGL2 first, then Software Bloom, then Native Glow. The default `'webgl2'` uses the same fallback chain; explicit `'software'` falls back to Native Glow when pixel readback is unavailable. For compatibility with 1.2.13 and earlier, constructor options or `createConfig()` that explicitly provide `bloomBackend` / `softwareBloomEnabled` without `effectBackend` retain the `effectBackend: 'canvas2d'` configuration and fallback-state contract; an explicit `effectBackend` always wins. If both `bloomBackend` and the old `softwareBloomEnabled` field are provided, `bloomBackend` wins. The compatibility field still maps `true` to `'software'` and `false` to `'native'`.

To preserve the already reviewed colour, transparency, and edge sampling, a successful WebGL2 Bloom frame intentionally reuses the complete `WebGL2EffectRenderer` Scene instead of uploading an 8-bit Canvas Scene. It therefore uses the same shaders and pixel pipeline as Full WebGL2 and does not pre-rasterise a Canvas that will be hidden. The distinction is the compatibility contract: WebGL2 Bloom retains the `effectBackend: 'canvas2d'` request and its Software / Native fallback chain, while Full WebGL2 is owned directly by the complete-effect backend.

`outputCompositing: 'scene'` is the default and preserves Unity's direct additive RGB semantics for a Scene render target. The demo and integrations that require strict game reproduction should use it together with a `setCompositingReference()` image that pixel-matches the displayed background; this is the contract under which the complete GPU paths evaluate Scene RGB precisely. `'browser-overlay'` is selected explicitly by transparent desktop hosts such as BASpark, WebView2, and Electron. HDR emission and Bloom energy remain independent, while final alpha is no longer inferred from the largest final RGB channel.

Four orthogonal options further define transparent output over an unknown background. Alpha allocation and colour compensation never switch one another implicitly:

| Configuration | Contract |
|---|---|
| `overlayAlphaPolicy: 'coverage'` | Default transparent contract. Requested alpha sums crisp Scene Coverage and independent Bloom transport alpha before lifetime, `opacity`, and the final limit are applied. Use it when stable occlusion and cross-backend continuity matter most |
| `overlayAlphaPolicy: 'visual-max'` | A v1.2.15-style visual approximation. Requested alpha takes the larger of crisp Scene Coverage and Bloom transport alpha, preserving lower occlusion where they overlap. Alpha still comes only from those independent transport quantities and is never generated from final `maxRGB` |
| `overlayColorCompensation: 'none'` | Default; preserves the transparent payload's colour relationships without compensation |
| `overlayColorCompensation: 'bright-core'` | A visibility approximation for unknown light backgrounds. It compensates only high-energy cores, gated independently by crisp emission and Bloom energy. It neither mixes all RGB towards white nor turns low-energy trail tips grey-white. The premultiplied `RGB <= Alpha` constraint is preserved, but pixel equivalence with Unity is not claimed |
| `overlayAlphaLimit` | Final alpha capacity for `browser-overlay + source-over`, default `250 / 255`, with finite values clamped to `0..1`. Premultiplied RGB contracts proportionally when capacity is insufficient. The option does not change effect `opacity`, HDR emission strength, or Bloom strength |
| `hostCompositing: 'source-over'` | Default host contract; uses the alpha policy, colour compensation, and alpha limit above |
| `hostCompositing: 'screen'` | Independent full-payload contract for unknown mid-tone and light backgrounds. A library-owned layer group uses CSS `screen` once, so the increment contracts as the backdrop gets brighter; alpha policy, colour compensation, and alpha limit are ignored |
| `hostCompositing: 'plus-lighter'` | Independent Add-payload contract for unknown backgrounds. The renderer emits the complete additive payload for the host to composite once with `plus-lighter`, so `overlayAlphaPolicy`, `overlayColorCompensation`, and `overlayAlphaLimit` are ignored |

The old `unknownBackgroundAppearance` field has been removed from constructor options, `updateConfig()`, `getConfig()`, and the type declarations. Colour compensation is controlled only by `overlayColorCompensation`, while alpha allocation is controlled only by `overlayAlphaPolicy`; no compatibility mirror links the two settings.

Both `screen` and `plus-lighter` are SDR DOM-compositing approximations and vary with browser colour management and implementation details. Unity composites the backdrop and effect together in linear HDR before one final encoding step. An unknown desktop is outside the overlay process, so no single transparent payload can be pixel-equivalent over every backdrop. `screen` preserves the full payload over black and automatically reduces its increment towards white; it is used by the demo's “DOM Add (Approximate)” option and is recommended for unknown mid-tone or light backdrops. `plus-lighter` remains available for known black or dark hosts, but directly adds the sRGB payload and saturates early over light content.

For a library-owned overlay, the selected host blend is applied once to the complete layer group. With a caller-owned `<canvas>`, the library emits the independent full payload without modifying `mix-blend-mode`; CSS, WebView, or native host compositing remains the caller's responsibility. Strict agreement with Unity requires a matching compositing reference so the complete WebGPU/WebGL2 backend can evaluate the linear HDR Scene, or a host that performs the final composite in a linear HDR render target. An active reference restores a normal `source-over` output and prevents a second host blend.

> Maintainer note: never lower the shared Bloom intensity to hide light-background overexposure. Read the [DOM Add light-background overexposure postmortem](https://github.com/CialloKing/ba-click-fx/blob/main/docs/dom-add-light-background-regression.md) (Chinese) before changing host compositing, transparent payloads, or light-background pixel baselines.

`isolatedCompositing` defaults to `false`, so canvases mount directly into the target or page. With `true`, the library-owned main FX canvas, WebGPU/WebGL2 canvases, and light-background compatibility canvas resolve inside one transparent isolated group before that group is composited over the page. This prevents the browser from resolving compatibility layers independently against pure white and losing cyan-blue contrast. The default `source-over` contract does not blend again at the outer boundary; an explicitly selected independent full-payload contract applies its chosen `screen` or `plus-lighter` blend once to the complete group. Isolated compositing is a non-game web compatibility option and can be changed at runtime through `updateConfig()`.

When `target` is an existing `HTMLCanvasElement`, the library cannot safely insert the additional DOM layers required for the complete effect, Bloom, contrast, and isolation. Full Effect `'webgpu'` / `'webgl2'` / `'auto'` therefore falls back to `canvas2d`, Bloom `'webgl2'` / `'auto'` falls back to Software Bloom, and `isolatedCompositing` is forced to `false`; `getConfig()` reports these effective values. A directly supplied `OffscreenCanvas` is an intentionally supported exception: Full WebGL2 can own that surface directly, as can an explicit `'canvas2d'` path, but WebGPU, isolated compositing, and other features that require a DOM/CSS layer tree are unavailable. The caller always owns external Canvas CSS and final host compositing. The default fullscreen overlay has no `HTMLCanvasElement` limitation. A regular container is also supported, but it must establish its own positioning context, normally with `position: relative`.

Each `BAClickFX` instance owns a separate isolation group. Multiple isolated instances on the same page do not mix their internal compatibility layers across group boundaries, and switching or destroying one instance does not move or remove another instance's canvases.

On a pure-white page, enable isolated compositing. If `outputCompositing: 'scene'` still needs an extra crisp silhouette, opt into the light-background compatibility layer as well:

```js
const fx = new BAClickFX(
{
  isolatedCompositing: true,
  lightBackgroundContrastAlpha: 0.35,
});
```

For a transparent desktop host, explicitly select Full WebGL2 and browser-overlay output, and disable the non-game light-background silhouette:

```js
const fx = new BAClickFX(
{
  effectBackend: 'webgl2',
  bloomBackend: 'webgl2',
  outputCompositing: 'browser-overlay',
  overlayAlphaPolicy: 'coverage',
  overlayColorCompensation: 'none',
  overlayAlphaLimit: 250 / 255,
  hostCompositing: 'source-over',
  lightBackgroundContrastAlpha: 0,
});
```

For a transparent occlusion appearance closer to v1.2.15, change `overlayAlphaPolicy` to `'visual-max'`. This only changes alpha allocation between independent Coverage and Bloom transport quantities; it never generates alpha from `maxRGB`. When visibility of high-energy cores matters over an unknown light desktop, independently change `overlayColorCompensation` to `'bright-core'` without changing the alpha policy. A DOM host that must not darken an unknown light backdrop can instead select `hostCompositing: 'screen'`; reserve the more aggressive `'plus-lighter'` mode for known black or dark backdrops. Both ignore the alpha policy, colour compensation, and alpha limit and remain SDR approximations.

These compatibility controls have separate responsibilities. `isolatedCompositing` only decides whether library-owned canvases first resolve inside one transparent group; it does not sample page or desktop pixels. `lightBackgroundContrastAlpha` adds a non-game `darken` silhouette only for `scene` output and is ignored by `browser-overlay`. Only `setCompositingReference()` supplies a known opaque raster reference to the rendering pipeline. None of these controls replaces another.

### Compositing Reference and Linear Compositing

`setCompositingReference()` supplies the renderer with a real opaque raster reference that pixel-matches the content beneath the effect; it does not set or modify the host page's CSS background. `scene + setCompositingReference()` is the precise known-background path. Strict final-RGB Scene equivalence may only be claimed when WebGPU, Full WebGL2, or WebGL2 Bloom successfully resolved to the GPU receives that known reference. Native Glow and Legacy use a Canvas Final Pass; Software Bloom continues to use the normal DOM-background path. Those capability-limited fallback paths must not be treated as pixel-equivalent to the complete GPU Scene or Unity.

The real desktop is normally invisible to a transparent overlay. `setCompositingReference(null)` clears the reference and enters the unknown-background path; the renderer can then only emit an alpha-bearing overlay for the host or operating system to composite later. An unknown background cannot mathematically reproduce Unity's result over a known opaque HDR Scene. `browser-overlay` keeps alpha derived from independent Coverage and Bloom transport quantities and makes their allocation an explicit `overlayAlphaPolicy`; it does not remove that information boundary.

Standard premultiplied `source-over` satisfies `Cout = Coverlay + Cbackground × (1 - A)`, while strict Unity additive output targets `Cbackground + E`. The required `Coverlay = E + A × Cbackground` therefore depends on background pixels that the library cannot read. For an unknown background, one transparent overlay cannot simultaneously guarantee strict Unity additive RGB, final alpha that represents only Coverage, and no darkening over pure white. `browser-overlay + overlayAlphaPolicy: 'coverage'` explicitly prioritises the Coverage transport sum and cross-backend continuity; `'visual-max'` only provides a lower-occlusion, v1.2.15-style visual approximation. For strict Scene RGB, keep the default `scene` mode and provide a pixel-matched known reference through `setCompositingReference()`.

The implementation does not cap final alpha with `min(coverage, maxRGB)`. Although that approximation can hide some white-background darkening, it reinterprets emission brightness as occlusion, removes Coverage from black or low-energy trail regions, and breaks linear `opacity` and backend-transition continuity.

The extracted Additive shader fixes target alpha to `1`, while Dissolve specifies separate alpha blend factors. Those values describe writes into the game's already opaque camera target; they are not occlusion coverage for a transparent desktop window. Copying them mechanically without a matching background would turn particle quads into opaque rectangles. The background-free `scene` Final Pass therefore uses transport alpha capable of carrying premultiplied RGB, while `browser-overlay` combines crisp Coverage and Bloom transport alpha according to the selected policy. Neither claims to reproduce the Unity camera target's visually irrelevant final alpha. The strict-equivalence statement above applies only to final RGB under its stated conditions.

```js
const image = new Image();
image.crossOrigin = 'anonymous';
image.src = 'https://example.com/background.jpg';
await image.decode();

fx.setCompositingReference(image, { fit: 'cover' });
// Clear the reference and enter the unknown-background path without changing page CSS.
fx.setCompositingReference(null);
```

Only centred `cover` is currently supported, matching CSS `background-size: cover` cropping. The caller owns decoding and CORS: a cross-origin server must allow anonymous reads or WebGL cannot upload the texture, in which case the method returns `false` or a deferred backend remains on its safe fallback. Passing `null` clears the reference and releases viewport-sized resources used only by the Canvas Final Pass. The Renderer retains an accepted reference source for WebGL context recovery, so do not close releasable sources such as `ImageBitmap` or `VideoFrame` before replacing the reference or destroying the instance. Canvas and video sources upload their current frame at call time; call the method again after their content changes.

The demo's Local Image picker converts a `File` into a document-session `blob:` URL, then sets its CSS page background and `setCompositingReference(image)` separately, so no external CORS header is needed. The URL is not written to `localStorage`; it is released when the background changes or the page unloads, and the file must be selected again after a reload. A typed `file://` URL is saved as ordinary custom-background text and passed to a trusted desktop host that permits both local-protocol reads and Canvas/WebGL texture use. Regular HTTP/HTTPS pages remain subject to browser local-resource permissions and should use the picker.

Backend and mode changes release idle viewport-sized textures and FBOs while retaining the WebGL context, programs, static textures, and accepted compositing reference source. Re-enabling a backend rebuilds only the frame resources needed at the current size. Reference replacement is atomic across existing Renderers: if one rejects the new source, accepted Renderers roll back to the old reference; a candidate that cannot roll back is discarded and rebuilt lazily when needed.

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

### Host-owned Worker and OffscreenCanvas

`BAClickFX` can receive an `OffscreenCanvas` directly inside a Dedicated Worker, but it does not create the Worker, transfer the Canvas, proxy DOM input, or manage the Worker lifecycle. Those responsibilities remain with the host so the application protocol and bundling strategy do not become library policy. The following is a minimal host-owned protocol.

Worker means a browser `DedicatedWorker` here, not Node.js `worker_threads`. Node.js 24 is only the development and CI toolchain for this project; browser Worker support depends on the available `Worker`, module-script, `OffscreenCanvas`, and selected Canvas-context implementations.

The main thread reads the real Canvas geometry, converts DOM coordinates into Canvas-local CSS pixels, and forwards size, DPR, and pointer lifecycle changes:

```js
// main.js
const canvas = document.querySelector('#fx');
const worker = new Worker(new URL('./fx-worker.js', import.meta.url),
{
  type: 'module',
});

function post(type, payload = {})
{
  worker.postMessage({ type, payload });
}

function getViewport()
{
  const rect = canvas.getBoundingClientRect();

  return {
    width: rect.width,
    height: rect.height,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };
}

function getPointer(event)
{
  const rect = canvas.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
  };
}

const offscreen = canvas.transferControlToOffscreen();

worker.postMessage(
  {
    type: 'init',
    payload: { canvas: offscreen, ...getViewport() },
  },
  [offscreen],
);

const resizeObserver = new ResizeObserver(() => post('resize', getViewport()));

resizeObserver.observe(canvas);
worker.addEventListener('message', (event) =>
{
  if (event.data.type === 'destroyed')
  {
    resizeObserver.disconnect();
    worker.terminate();
  }
});
canvas.addEventListener('pointerdown', (event) =>
  post('pointerDown', getPointer(event)));
window.addEventListener('pointermove', (event) =>
  post('pointerMove', getPointer(event)));
window.addEventListener('pointerup', (event) =>
  post('pointerUp', { pointerId: event.pointerId }));
window.addEventListener('pointercancel', (event) =>
  post('pointerCancel', { pointerId: event.pointerId }));

// Other public controls can use the same host protocol.
function boom(x, y)
{
  post('boom', { x, y });
}

function setOpacity(opacity)
{
  post('updateConfig', { opacity });
}

function setPaused(paused, clear = false)
{
  post('setPaused', { paused, options: { clear } });
}

// During teardown, let the instance release resources before the host terminates the Worker.
function destroy()
{
  post('destroy');
}
```

The Worker imports the normal ESM build, selects manual input, and pins Full WebGL2 explicitly:

```js
// fx-worker.js
import { BAClickFX } from 'ba-click-fx';

let fx = null;

self.addEventListener('message', (event) =>
{
  const { type, payload } = event.data;

  switch (type)
  {
    case 'init':
      fx = new BAClickFX(
        {
          target: payload.canvas,
          inputSource: 'manual',
          effectBackend: 'webgl2',
          maxDpr: 2,
        },
      );
      fx.resize(payload.width, payload.height, payload.dpr);
      break;
    case 'resize':
      fx.resize(payload.width, payload.height, payload.dpr);
      break;
    case 'pointerDown':
      fx.pointerDown(payload);
      break;
    case 'pointerMove':
      fx.pointerMove(payload);
      break;
    case 'pointerUp':
      fx.pointerUp(payload.pointerId);
      break;
    case 'pointerCancel':
      fx.pointerCancel(payload.pointerId);
      break;
    case 'boom':
      fx.boom(payload.x, payload.y);
      break;
    case 'updateConfig':
      fx.updateConfig(payload);
      break;
    case 'setPaused':
      fx.setPaused(payload.paused, payload.options);
      break;
    case 'destroy':
      fx?.destroy();
      fx = null;
      self.postMessage({ type: 'destroyed' });
      break;
  }
});
```

The width and height passed to `resize(width, height, dpr)`, as well as manual input coordinates, are Canvas-local CSS pixels. The library scales the backing store by `dpr`, still capped by `maxDpr`. An `OffscreenCanvas` has no DOM layout information, so a Worker cannot discover CSS resize or device-DPR changes automatically.

A Canvas context type is locked by its first `getContext()` call. Choose `effectBackend: 'webgl2'` (recommended) or explicit `'canvas2d'` when constructing a direct Offscreen instance; do not switch between those context types later through `updateConfig()`. Destroy the instance and transfer a new Canvas when such a switch is required. WebGPU, DOM multi-layer compositing, and automatic input proxying are outside the current Worker contract.

`inputSamplingRate` limits the maximum `pointerMove` sampling rate on the real input clock. It simulates the polygonal trail produced when a mobile game client reads touch positions less frequently:

- `0` is the default and keeps every input sample, preserving existing trail pixels.
- `1..1000` is measured in Hz. Start with `30` for a mobile-like result, use `15` for stronger polygonal turns, or `60` for a smoother trail.
- Only move samples are filtered; `pointerDown()`, `pointerUp()`, and `pointerCancel()` are never delayed. DOM coalesced events use each sample's `timeStamp`, while manual input uses API arrival time.
- This is a maximum input sampling rate, not a new rendering frame rate or synthetic fixed clock. The actual rate still depends on the host event stream. It is independent from `trailTimeScale` and Unity's `trail.minVertexDistance`; spatial vertices inserted between retained samples remain collinear and therefore do not erase low-rate turns.

```js
const fx = new BAClickFX({ inputSamplingRate: 30 });

fx.setInputSamplingRate(15);   // stronger mobile-like polygonal turns
fx.setInputSamplingRate(1000); // high-polling-rate limit
fx.setInputSamplingRate(0);    // restore unlimited input
```

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
| `resize(width?, height?, dpr?)` | Explicitly synchronize Canvas CSS size and DPR, primarily for Worker / OffscreenCanvas hosts |
| `boom(x, y)` | Trigger one click effect without creating trail state |
| `pointerDown(input)` | Start one click-and-trail lifecycle |
| `pointerMove(input)` | Append a trail sample for the current logical pointer |
| `pointerUp(pointerId?)` | End the pointer normally and let its trail decay |
| `pointerCancel(pointerId?)` | Force-cancel the pointer and remove its current trail immediately |
| `setPaused(paused, options?)` | Pause or resume input and animation scheduling, optionally clearing on pause |
| `setInputSamplingRate(rateHz)` | Set the move-input sampling-rate limit; accepts `0` or `1..1000` and returns `true` on success |
| `setCompositingReference(source, { fit: 'cover' })` | Share a known raster compositing reference across rendering backends; pass `null` to clear it and enter the unknown-background path |
| `clear()` | Remove all visual objects |
| `clearTrail()` | Clear trail and shards only |
| `destroy()` | Destroy instance, remove listeners and canvas |
| `updateConfig({...})` | Update base config, input source/rate, time scales, Full Effect/Bloom backends, DPR, and touch behaviour at runtime |
| `setThemeColor('#4ca7ff')` | Set and persist the theme colour; invalid input restores the default game blue |
| `setThemeColorMode(mode)` | Switch the theme-colour mapping mode; accepts `hue-only` or `relative-oklch` and returns `true` on success |
| `setTriangleRoundness(value)` | Set the triangle-shard roundness ratio; equivalent to `setFxParam('shards.roundness', value)` |
| `setFxParam('rings.hdrIntensity', 5.992157)` | Modify one dot-path; returns `true` on success and `false` when rejected |
| `setFxParams(patch, options?)` | Validate and batch-apply a dot-path patch through the public Schema, returning per-entry results |
| `getFxConfig()` | Deep copy of current FX configuration |
| `resetFxConfig()` | Reset all FX parameters to the current Enhanced or Legacy mode baseline |
| `getConfig()` | Current config; besides Full Effect and Bloom resolution, `resolvedWebGPUOutputMode` independently reports `extended`, `standard`, `pending`, or `unavailable` |

The main canvas dispatches `baclickfxeffectbackendchange` and `baclickfxbackendchange` when the Full Effect and Bloom resolution states change. Use the exported event names to track deferred probing, runtime fallback, WebGPU device loss, and WebGL context recovery:

```js
import {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
} from 'ba-click-fx';

const fx = new BAClickFX(
{
  effectBackend: 'webgpu',
  webgpuPreferHdr: false,
  bloomBackend: 'webgl2',
});

fx.canvas.addEventListener(EFFECT_BACKEND_CHANGE_EVENT, (event) =>
{
  console.log(event.detail.resolvedEffectBackend);
  console.log(fx.getConfig().resolvedWebGPUOutputMode);
});

fx.canvas.addEventListener(BLOOM_BACKEND_CHANGE_EVENT, (event) =>
{
  console.log(event.detail.resolvedBloomBackend);
});
```

`resolvedEffectBackend === 'webgpu'` proves only that the WebGPU Scene owns the current output. Real HDR requires `resolvedWebGPUOutputMode === 'extended'` as well; do not substitute `matchMedia('(dynamic-range: high)')` for the actual Canvas configuration result.

### Parameter Schema and Batch Updates

The library exports the read-only `FX_PARAM_SCHEMA`, the current `FX_PARAM_SCHEMA_VERSION`, and `FX_PARAM_MIGRATIONS`. Each public scalar path describes its type, hard bounds, default, unit, group, stable display order, localisation keys, recommended control range, linked parameters, and Enhanced/Legacy mode baselines. Hosts can build settings UIs without copying an independent control list. `step` and `display.step` only guide host UI controls. `setFxParam()` / `setFxParams()` do not quantise or round to those steps; they validate type, finiteness, and the hard `min` / `max` bounds. Hosts that require integer controls should round before submission.

The current `FX_PARAM_SCHEMA_VERSION` is `2`. The old `bloom.scatter` value has no proven visual equivalence to MXFinalBloom's `bloom.diffusion`. Migrating from version `0` to `1` therefore renames the path to `bloom.diffusion`, explicitly restores the Unity default value `7`, and reports both `renamed` and `defaulted` in `normalized`. Version `1` to `2` is an empty migration that does not rewrite existing paths and uses the default value `0` for the new `shards.roundness` path. Persisted patches should pass their original `schemaVersion`, allowing the library to apply `FX_PARAM_MIGRATIONS` in order. A future version, a missing migration chain, or a post-migration conflict is rejected explicitly rather than being dropped silently.

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

`themeColor` and `themeColorMode` are both instance configuration state. They can be supplied to the constructor or `updateConfig()`; `setThemeColor()` and `setThemeColorMode()` use the same normalisation path; and `getConfig()` returns their current values. Only six-digit hexadecimal colours are accepted. An empty string or invalid colour restores the exported `DEFAULT_THEME_COLOR` (`#4ca7ff`). An invalid mode is rejected: `setThemeColorMode()` returns `false` and leaves the current mode unchanged. Neither setting mutates the Unity parameter baseline in `UNITY_FX_TOUCH` or `FX_PARAM_SCHEMA`.

The public library exports `DEFAULT_THEME_COLOR_MODE` as `hue-only` to preserve existing configurations and pixel output. This mode applies only the theme colour's HSL hue difference to the original Unity colours, retaining their authored saturation, lightness, and HDR emission energy. Existing configurations without a `themeColorMode` field are interpreted the same way. The demo selects the recommended `relative-oklch` mode only for new users without saved settings; it does not silently migrate a persisted mode.

`relative-oklch` uses the default game blue `#4ca7ff` as its reference and maps the theme colour's relative OKLCH hue, chroma, and perceptual-lightness changes onto the original Unity colours. Lightness adjusts linear-RGB HDR emission energy before Bloom prefiltering, so a darker theme naturally emits less energy above the Bloom threshold instead of dimming an already-generated halo in the Final Pass. For a transparent overlay transported with `source-over` against an unknown background, the engine separately limits Coverage Alpha by the target colour's peak sRGB channel so that dark themes cannot become solid occluding shapes; this limit does not scale Scene, Screen/Plus-lighter, or HDR emission energy. The default game blue must remain an identity mapping and preserve the default Unity pixels. A pure-black theme has zero emissive energy and creates no black mask or residual halo in an unknown-background transparent overlay. A known Scene still preserves the Unity material's original alpha-blending semantics.

`setTriangleRoundness(value)` is a convenience API for `setFxParam('shards.roundness', value)`. The default `0` preserves the current triangle atlas exactly; values from `0..1` continuously trim its corners with arcs tangent to the original straight sides and remap the texture so no sharp inner triangle remains; `1` turns every click and trail triangle shard into a same-size circle. Runtime changes affect existing particles on the next frame. Finite out-of-range values are clamped to `0..1` by the Schema, while non-finite values are rejected.

```js
fx.setTriangleRoundness(0.5);
fx.setFxParam('shards.roundness', 0.5);
```

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
| `shards.roundness` | 0 | Triangle-shard roundness ratio; `0` preserves the source atlas and `1` produces same-size circles |
| `shards.clickCount` | 4 | Click shard count |
| `shards.maxCount` | 50 | Trail-shard limit per press; click shards and older instances do not consume it |
| `shards.trailSpacing` | 108 | Trail shard spacing |
| `bloom.threshold` | 1.0 | Unity-serialized Gamma-space bright-pass threshold; converted to Linear before prefiltering |
| `bloom.softKnee` | 0 | Soft transition around the threshold |
| `bloom.clamp` | 65472 | Unity-serialized Gamma-space prefilter limit; CPU-converted and capped to the half-float maximum of 65504 |
| `bloom.intensity` | 1.7 | Serialized in-game MXFinalBloom exposure; converted by the CPU before reaching the shader |
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

The WebGPU backend uses its own WGSL Scene, `rgba16float` emission targets, and multi-level Bloom pyramid while reusing the reviewed CPU particle mesh builders from WebGL2. It creates no WebGL context and uploads no Canvas 2D intermediate. Scene rendering, prefiltering, downsampling, cumulative upsampling, and the Final Pass are submitted entirely through WebGPU. In `extended` mode the Final Pass encodes linear RGB as extended sRGB without clipping super-white values; `standard` uses the same encoding limited to SDR along with the existing transparency contract.

Full WebGL2 and WebGL2 Bloom share `WebGL2EffectRenderer`, HDR emission parameters, and Bloom settings, and both build ring, disk, trail, and shard geometry directly on the GPU. They then follow the game's `Hidden/MXFinalBloom` path — four-tap prefiltering, Box4 mips, cumulative upsampling, and linear multiplication by the CPU-converted exposure — and output the crisp Scene, Coverage, and Bloom in one Final Pass. WebGL2 Bloom remains a compatibility selector with separate backend state and a Canvas fallback chain, but successful frames no longer build or upload an 8-bit Canvas Scene.

Both `bloom.threshold` and `bloom.clamp` are converted with Unity's `GammaToLinearSpace` before the linear-HDR prefilter. Clamp is then limited to the shader `half` maximum of `65504`, so the serialized default `65472` resolves to `65504`. `bloom.intensity` is a serialized exposure scale: the CPU first evaluates `2^(Intensity / 10) - 1` (about `0.125058` for the default `1.7`), then the shader multiplies Bloom by that linear value.

> Maintainer note: passing `1.7` directly to the Final Pass amplifies Bloom by about 13.6 times. Before changing Intensity, the Final Pass, shader uniforms, or pixel baselines, read the [Bloom Intensity 13.6x overexposure regression postmortem](https://github.com/CialloKing/ba-click-fx/blob/main/docs/bloom-intensity-regression.md) (Chinese).

> Maintainer note: every upsample pass must four-tap the accumulated coarse level, then center-sample and add the current fine level. Reversing them hardens the near field and distorts the halo falloff. Before changing mip names, texture bindings, texel sizes, or the upsample shader, read the [Bloom upsample texture-order regression postmortem](https://github.com/CialloKing/ba-click-fx/blob/main/docs/bloom-upsample-order-regression.md) (Chinese).

WebGPU availability is determined by actually requesting an adapter and device, creating a `webgpu` Canvas context, and building the resource pipelines. HDR output is decided separately by whether `rgba16float + toneMapping: extended` succeeds in `configure()`. WebGL2 availability still requires a context, `EXT_color_buffer_float`, and a valid `RGBA16F` framebuffer. Full Effect state uses `effectBackend` / `resolvedEffectBackend`, WebGPU output uses `resolvedWebGPUOutputMode`, and Bloom uses `bloomBackend` / `resolvedBloomBackend`; asynchronous probing, first-frame submission, and recovery validation briefly report `pending`. Device or context loss immediately removes the old GPU Canvas, and the next backend takes ownership only after its complete resource chain succeeds.

### JavaScript Software Bloom

When `bloomBackend: 'software'` is selected explicitly or WebGL2 is unavailable, the renderer draws HDR emission into a full-viewport mask, reads the pixels back, and reproduces the main MXFinalBloom structure in JavaScript:

1. Decode the 8-bit mask into reusable Float32 RGB buffers.
2. Run four-tap threshold prefiltering to produce half-resolution mip0.
3. Build a Box4 mip pyramid whose level count is derived from `bloom.diffusion`.
4. Accumulate upward by four-tapping the accumulated coarse level, then center-sampling and adding the current fine level; the two inputs are not interchangeable.
5. Convert `bloom.intensity` with the game's CPU exposure mapping, multiply by the resulting linear value, then perform final four-tap sampling and the additive sRGB composite.

The default `isolatedCompositing: false` composites output layers directly against the DOM background; Unity's additive output necessarily loses colour and contrast on pure white. With `true`, the output layers first resolve inside a transparent group, then composite their coloured result and alpha over the page. This does not change the Bloom algorithm and exists only as a non-game compatibility path for pure-white web backgrounds. Use `setCompositingReference()` when the background must participate in the same linear Scene as it does in the game; isolation is not a substitute for background sampling.

`lightBackgroundContrastAlpha` defaults to `0`, so no visible silhouette outside the game resource is added. Setting it to `0.35` gives a library-owned overlay an independent pale-cyan `darken` mask above the main FX layer. The mask neither receives nor generates Bloom and exists only to recover a crisp silhouette on pure white. It and isolated compositing are both non-game web compatibility options. An existing Canvas supplied as the target can receive neither this separate backdrop-compositing layer nor isolated compositing.

The software backend uses one full-viewport mip pyramid and reuses its Float32 buffers between frames while limiting emission readback to the geometry's actual subregion. It shares the WebGL2 backend's mip-count formula, SampleScale, four-tap sampling, and CPU-converted linear intensity multiplier, but its input first passes through an 8-bit Canvas encoding and transparent output is constrained by premultiplied alpha. If Canvas pixel readback/writeback is unavailable, rings and disks fall back to native `shadowBlur`, while trail emission is blurred once in a local offscreen buffer.

### Backend Capability Boundaries

| Path | Capability boundary |
|---|---|
| WebGPU Extended HDR | When `rgba16float + toneMapping: extended` succeeds, Scene, Coverage, and MXFinalBloom stay in a linear floating-point pipeline and the final Canvas can submit highlights above SDR white |
| WebGPU Standard | The WebGPU Scene and Bloom still run in floating point, but the final Canvas uses the browser's preferred standard format and maps to SDR; this is not real HDR output |
| Full WebGL2 | Default selector; keeps geometry, Coverage, the HDR Scene, and MXFinalBloom in one floating-point pipeline when a matching background is supplied |
| WebGL2 Bloom | On GPU success, reuses the same complete floating-point Scene as Full WebGL2; the difference is its Canvas 2D request state and Software / Native failure-fallback contract |
| Software Bloom | The Bloom pyramid uses Float32 buffers, but its input comes from an 8-bit Canvas; a transparent overlay can only approximate Bloom with residual Coverage and cannot preserve arbitrary HDR RGB independently |
| Native Glow | A bounded Canvas `shadowBlur` approximation without `RGBA16F`, threshold prefiltering, or cumulative multi-level upsampling; it does not equal MXFinalBloom |
| Legacy | Retains compatibility parameter mappings and the older Canvas compositing style; reset restores its Legacy baseline, while glow remains constrained by `shadowBlur` and Canvas blending |

Consequently, “ported from the Unity project” describes the source of parameter values, texture sampling, curves, blend intent, and the known-Scene complete GPU implementations. It does not mean every browser backend, arbitrary web background, or transparent desktop composition can be pixel-identical to an in-game screenshot. Fallbacks prioritise lifecycle, geometry relationships, monotonic Coverage, and availability without pretending that missing HDR Scene or display capabilities exist.

---

## FAQ

### Does WebGPU mode always produce real HDR?

No. The demo's ordinary “WebGPU” mode is fixed to `standard` SDR, and “WebGPU HDR (experimental)” can also fall back to `standard` when Extended configuration is unavailable. Only `getConfig().resolvedWebGPUOutputMode === 'extended'` means that the Canvas preserves highlights above SDR white in its extended sRGB encoding. The display, system HDR setting, browser WebGPU HDR Canvas support, and successful `rgba16float + extended` configuration are all required. A screenshot, Canvas pixel readback, or an SDR display cannot prove the panel's final luminance in nits.

### Why does dragging fail to leave a trail in a mobile browser?

The demo defaults Touch Action to Auto so native browser scrolling remains available. Once the browser takes over the gesture it sends `pointercancel`, ending the current trail. Switch Touch Action to Disable Default Gestures to keep trails active in every drag direction; the equivalent API is `touchAction: 'none'`. If the page still needs one-axis scrolling, choose Pan X Only or Pan Y Only: browser-allowed directions continue to scroll and end the trail, while directions the browser does not take over retain it. This setting also changes native page scroll and zoom gestures.

### Why does the effect lose colour on a pure-white background?

The Unity effect uses additive blending. A nearly white target has little channel headroom left, so direct composition loses cyan-blue contrast. Enable `isolatedCompositing: true` on pure-white web pages so library-owned output layers resolve inside a transparent group first. If `scene` output still needs a clearer non-game silhouette, opt into `lightBackgroundContrastAlpha`; keep it at `0` for transparent-desktop `browser-overlay` output.

### Can isolated compositing replace a compositing reference?

No. Isolation only changes the CSS compositing boundary for multiple canvases. It neither samples page or desktop pixels nor changes the Bloom algorithm. To make the background participate in the game's linear HDR Scene calculation, a complete GPU Scene (WebGPU, Full WebGL2, or WebGL2 Bloom successfully resolved to the GPU) must receive a `setCompositingReference()` source that matches the displayed content. An unknown or changing desktop cannot be reproduced pixel for pixel.

### Can an unknown background have strict Unity additive RGB, pure Coverage alpha, and no white-background darkening at the same time?

No. `source-over` only receives overlay RGB and alpha, while the RGB needed for strict additive output depends on the background colour underneath; a transparent desktop does not expose those pixels to the library. Keep the default `scene` mode for the demo and strict reproduction, pass known backgrounds through `setCompositingReference()`, and select `browser-overlay` explicitly for transparent desktop hosts. Its default `overlayAlphaPolicy: 'coverage'` prioritises the Coverage transport sum and alpha continuity rather than claiming pixel equivalence over every background.

### How can I restore the transparent-overlay appearance of v1.2.15?

Use `overlayAlphaPolicy: 'visual-max'`. It takes the larger of crisp Scene Coverage and Bloom transport alpha, restoring the older lower-occlusion visual approximation. Final `maxRGB` is used only to contract premultiplied RGB into the available alpha capacity and never generates alpha. Colour remains an independent choice: keep `overlayColorCompensation: 'none'` to change only alpha allocation, or enable `'bright-core'` separately when high-energy cores need more visibility over an unknown light background. The latter does not whiten low-energy trail regions globally.

### Which configuration should a transparent desktop host use?

The recommended default is `effectBackend: 'webgl2'`, `bloomBackend: 'webgl2'`, `outputCompositing: 'browser-overlay'`, `overlayAlphaPolicy: 'coverage'`, `overlayColorCompensation: 'none'`, `overlayAlphaLimit: 250 / 255`, `hostCompositing: 'source-over'`, and `lightBackgroundContrastAlpha: 0`. Select only `'visual-max'` when a lower-occlusion, v1.2.15-style visual approximation is required. Independently enable `'bright-core'` over unknown light backgrounds to compensate only emission- and Bloom-gated high-energy cores. When a DOM approximation must not darken the backdrop, use `'screen'` for unknown mid-tone, light, or changing backgrounds and reserve `'plus-lighter'` for black or dark backgrounds. Neither uses the alpha policy, colour compensation, or alpha limit. Strict Unity agreement requires a matching background reference or a host-side linear HDR composite. A host selecting WebGPU should also listen for backend-resolution events and read `resolvedWebGPUOutputMode`, because device or context loss enters a compatibility fallback. Fallbacks preserve the transparency contract but cannot promise real HDR or the exact same Bloom as a complete GPU path.

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
│   ├── webgpu-device.js   # WebGPU adapter/device and HDR Canvas negotiation
│   ├── webgpu-effect.js   # WebGPU Scene, Bloom pyramid, and Final Pass
│   ├── webgpu-shaders.js  # WGSL geometry and post-process shaders
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
- **WebGPU Scene:** asynchronously requests a device and uses an `rgba16float` linear Scene with WGSL Bloom; ordinary mode stays on Standard SDR, while HDR mode preserves real super-white highlights only after successful `extended` output and falls back to WebGL2 on device failure.
- **Full WebGL2 Scene:** complete geometry, Coverage, background, and MXFinalBloom resolve through one HDR pipeline and one output pass.
- **Canvas Scene Final Pass:** Native Glow and Legacy reuse a Canvas-built Scene approximation; with a supplied background they share background attenuation and colour encoding, without claiming complete-WebGL2 floating-point precision.
- **Main FX layer:** Canvas paths accumulate emission with `lighter` internally and use premultiplied-alpha overlay output to avoid a second CSS brightness increase.
- **Light-background compatibility layer:** defaults to zero strength; set it explicitly to 0.35 to add a non-Bloom `darken` canvas for visibility on pure white.
- **Software Bloom:** full-viewport working canvases plus a Float32 MXFinalBloom pyramid, with a `shadowBlur` fallback when pixel readback is unavailable.
- **WebGL2 Bloom:** on GPU success the compatibility selector reuses the complete WebGL2 Scene without redundantly rasterising a hidden Canvas; insufficient capabilities fall back through Software / Native.
- **Resource lifecycle:** WebGPU device or WebGL context loss falls back immediately; mode changes release full-size frame targets while retaining reusable static GPU resources.
- **On-demand rendering:** `requestAnimationFrame` stops when no effects are active.
- **Zero external dependencies:** browser-native Canvas 2D / WebGL2 / WebGPU APIs only; no third-party runtime.

---

## Development

Local development and CI use **Node.js 24 LTS**. The currently verified toolchain is Node.js `24.19.0` (Krypton) with npm `11.17.0`. The `node >=18` entry in `package.json` remains the runtime compatibility floor for consumers of the built library; it is not the development-toolchain version.

### Unity source-of-truth gate

The current `UnityMouseFxLab` is the only fixed UI Pass baseline: `Matrix4x4.Ortho(-aspect, aspect, -1, 1)` is equivalent to `orthographicSize = 1.0`. The `1.35` camera in the old `提取资产2` project belongs to an earlier preview scene and cannot override the newer machine-code and serialized-resource evidence. The Prefab contract is 2 rings, 4 click shards, and at most 50 trail shards per press instance.

Before changing Unity-derived parameters, projection conversion, or particle creation, read the [Unity fixed UI Pass source-of-truth and verification contract](https://github.com/CialloKing/ba-click-fx/blob/main/docs/unity-reference-baseline.md), then run:

```powershell
npm run verify:unity-reference -- --project "D:\WebProjects\BA鼠标输入与点击特效系统\UnityMouseFxLab\UnityMouseFxLab"
npm run test:browser:unity-counts
npm run build
npm run test:browser:built
npm run test:browser:webgpu:optional
```

The focused count gate reuses the complete browser matrix's assertions and can run even when an unrelated pixel case fails first. The standard matrix covers the WebGL2, Canvas, and Legacy paths; the separate optional WebGPU runtime gate checks the same count contract whenever a device is available. If the resource audit and cross-backend count assertions all pass, investigate pixel conversion, DPR, timing, colour space, compositing, and Bloom. Do not rewrite confirmed Unity values to match a visual symptom.

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
