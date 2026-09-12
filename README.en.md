# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![GitHub Stars](https://img.shields.io/github/stars/CialloKing/ba-click-fx.svg)](https://github.com/CialloKing/ba-click-fx/stargazers)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) [![Edge Add-on](https://img.shields.io/badge/Edge_Add--on-Install-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) [![Firefox Add-on](https://img.shields.io/badge/Firefox_Add--on-Install-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/)

> 📖 [中文版](./README.md)

**Add Blue Archive-style click rings, particles, and cursor trails to web pages.** Default parameters come from the game's Unity resources. Theme colours and runtime tuning need no external runtime dependencies. WebGL2 is the default; WebGPU is optional, with Canvas 2D and Native Glow available when the GPU path fails.

**Live demo:** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

Click, drag, or move the pointer to preview. The historical GIF is a visual reference; use the live demo for current behaviour.

<p align="center">
  <img src="https://github.com/CialloKing/ba-click-fx/releases/download/v1.2.12/ba-click-fx-demo.gif" alt="demo (historical recording)" width="45%">
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/CialloKing/ba-click-fx/main/docs/assets/blue-archive-reference.gif" alt="game reference" width="45%">
</p>
<p align="center"><sub>ba-click-fx demo (left, v1.2.12 historical recording) · In-game reference (right)</sub></p>

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Common Usage](#common-usage)
- [API Reference](#api-reference)
- [Detailed Documentation](#detailed-documentation)
- [FAQ](#faq)
- [Development](#development)
- [Desktop and Related Projects](#desktop-edition-windows-test-build)
- [Star History](#star-history)
- [Acknowledgements and Licenses](#acknowledgements-and-third-party-licenses)

## Features

- Dissolve rings, a centre disk, shard bursts, and continuous trails.
- Unity-derived defaults with theme colours and runtime tuning.
- WebGL2 by default, with optional WebGPU and experimental HDR output.
- Canvas 2D and Native Glow when GPU capabilities are insufficient.
- Container mounting, manual input, and Dedicated Worker support.
- Animation scheduling stops while no effects are active.

## Installation

<a id="2-npm"></a>

### npm

```bash
npm install ba-click-fx
```

```js
import { BAClickFX } from 'ba-click-fx';
const fx = new BAClickFX();
```

<a id="3-cdn"></a>

### CDN

```html
<script type="module">
  import { BAClickFX } from 'https://cdn.jsdelivr.net/npm/ba-click-fx@1.3.3/dist/ba-click-fx.js';
  const fx = new BAClickFX();
</script>
```

<a id="4-direct-download"></a>

### Direct Download

Download the ESM builds from [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases) (`ba-click-fx.js`, `config.js`, `worker.js`, and their `.d.ts` declarations):

The package and CDN builds are ESM-only. Browser direct imports require `type="module"`; `require()` and ordinary `<script>` tags are not published formats and must be bundled first.

```html
<div id="fx-host"></div>
<style>#fx-host { position: relative; min-height: 240px; }</style>
<script type="module">
  import { BAClickFX } from './ba-click-fx.js';
  const fx = new BAClickFX({ target: '#fx-host' });
</script>
```

Omitting `target` creates a full-screen overlay. A normal web container should establish a positioning context. An existing `HTMLCanvasElement` is intended for hosts that manage one Canvas themselves, but it disables multi-layer DOM compositing and safely downgrades the complete GPU/Bloom path.

<a id="1-browser-extension"></a>

### Browser Extension

Install the browser extension for any of the supported stores:

| Store | Link |
|-------|------|
| **Chrome** | [Chrome Web Store](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) |
| **Edge** | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) |
| **Firefox** | [Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/) |

Source: [ba-click-fx-extension](https://github.com/CialloKing/ba-click-fx-extension).

## Common Usage

### Recommended Web Integration: Unknown-Background Compositing

Ordinary pages usually cannot provide a pixel-matched compositing reference. Set the following combination explicitly; library defaults remain `scene + source-over`:

```js
import { BAClickFX } from 'ba-click-fx';

const fx = new BAClickFX(
{
  outputCompositing: 'browser-overlay',
  hostCompositing: 'screen',
  hostCompositingSurface: 'dom-backdrop',
});
```

`screen` is an SDR approximation for unknown, mid-tone, or light DOM backdrops. Consider `plus-lighter` only for a known dark host. Transparent desktop windows should use `transparent-window + source-over`; CSS blending cannot cross an operating-system window boundary. See [the rendering guide](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md).

### Trails, Colours, and Switches

These examples reuse the `fx` instance above. Trails require a held pointer by default; `trailAlways` also enables them while moving without a pressed button:

```js
fx.updateConfig({ trailAlways: true });
fx.setThemeColor('#ff80b5');
fx.updateConfig({ scale: 0.8, opacity: 0.7 });
fx.setFxParam('bloom.intensity', 1.7);
fx.boom(fx.width / 2, fx.height / 2);
fx.updateConfig({ clickEnabled: true, trailEnabled: true });
```

Set `clickEnabled` or `trailEnabled` to `false` to disable the corresponding effect. `boom()` takes Canvas-local CSS pixel coordinates. Theme colours accept six-digit hexadecimal values; invalid values restore the default game blue.

### Sampling and Playback Speed

```js
fx.updateConfig({ inputSamplingRate: 30 });
fx.updateConfig({ clickTimeScale: 1.5, trailTimeScale: 0.8 });
```

The sampling rate accepts `0` (unlimited) or `1..1000` Hz and limits movement input, not rendering frames. A time scale of `1` is normal speed and `2` is twice as fast; use `setPaused()` to pause.

### Pause and Unmount Cleanup

```js
fx.setPaused(true, { clear: true });
fx.setPaused(false);
fx.clearTrail();
fx.clear();
fx.destroy();
```

`clearTrail()` preserves click effects and click shards. `destroy()` releases instance resources and listeners, removing only library-created canvases. In an SPA or component framework, create the instance on client-side mount and destroy it on unmount; create a new instance when remounting.

## API Reference

This is a quick reference; complete signatures, return values, and runtime rules are in [the API reference](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md).

### Constructor

These are library defaults; the recommended web integration explicitly overrides the relevant options.

| Option | Default | Description |
|---|---|---|
| `target` | Fullscreen overlay | A positioned container, existing Canvas, or OffscreenCanvas |
| `scale` / `opacity` | `1` / `1` | Size multiplier / opacity |
| `themeColor` | `#4ca7ff` | Six-digit hexadecimal colour |
| `themeColorMode` | `relative-oklch` | Full colour mapping; `hue-only` keeps the legacy hue shift |
| `clickEnabled` / `trailEnabled` | `true` / `true` | Independent effect switches |
| `trailAlways` | `false` | Set `true` for a trail without holding a button |
| `effectBackend` / `bloomBackend` | `webgl2` / `webgl2` | GPU failure falls back to Native Glow; Software is opt-in |
| `outputCompositing` | `scene` | Ordinary unknown-background pages should choose `browser-overlay` |
| `hostCompositing` | `source-over` | Use `screen` with the recommended web overlay |
| `hostCompositingSurface` | `dom-backdrop` | Use `transparent-window` for a transparent desktop window |
| `maxDpr` | `1` | Maximum device pixel ratio; higher values cost more rendering work |
| `touchAction` | `auto` | Preserve native gestures by default |

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
| `clearTrail()` | Clear trail points and trail shards; preserve click effects and click shards |
| `destroy()` | Destroy the instance and its listeners; remove only library-created canvases |
| `updateConfig({...})` | Update base config, input source/rate, time scales, Full Effect/Bloom backends, DPR, and touch behaviour at runtime |
| `setThemeColor('#4ca7ff')` | Set and persist the theme colour; invalid input restores the default game blue |
| `setThemeColorMode(mode)` | Switch the theme-colour mapping mode; accepts `hue-only` or `relative-oklch` and returns `true` on success |
| `setTriangleRoundness(value)` | Set the triangle-shard roundness ratio; equivalent to `setFxParam('shards.roundness', value)` |
| `setFxParam('rings.hdrIntensity', 5.992157)` | Modify one dot-path; returns `true` on success and `false` when rejected |
| `setFxParams(patch, options?)` | Validate and batch-apply a dot-path patch through the public Schema, returning per-entry results |
| `getFxConfig()` | Deep copy of current FX configuration |
| `resetFxConfig()` | Reset all FX parameters to the Unity baseline |
| `getConfig()` | Current config; besides Full Effect and Bloom resolution, it reports the effective WebGPU output and host-compositing state |
| `getEffectiveHostCompositing()` | Return the effective host compositing mode |

Backend state may be `pending` during lazy probing. Read `resolvedEffectBackend` / `resolvedBloomBackend` from `getConfig()` for the actual backend, and use the exported backend-change events to follow fallback and recovery.

## Detailed Documentation

The entries below preserve the old section names for existing links. Each guide is available in Chinese and English.

### Compositing Reference and Linear Compositing

[Compositing Reference and Linear Compositing](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#compositing-reference-and-linear-compositing)

### Host Input and Pointer Lifecycle

[Host Input and Pointer Lifecycle](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#host-input-and-pointer-lifecycle)

### Host-owned Worker and OffscreenCanvas

[Complete Worker example and teardown](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.en.md)

### Independent Time Scales

[Independent time scales](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#independent-time-scales)

### Pause and Resume

[Pause, resume, and on-demand rendering](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#pause-and-resume)

### Parameter Schema and Batch Updates

[Schema, migration, and persistence examples](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#parameter-schema-and-batch-updates)

### Common Tunable FX Parameters (see FX_PARAM_SCHEMA for the complete list)

[Common parameter table and defaults](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#common-tunable-fx-parameters-see-fx_param_schema-for-the-complete-list)

### Effects

[Click FX, trails, and backend boundaries](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#effects)

#### Click FX

[Click FX](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#click-fx)

#### Cursor Trail

[Cursor Trail](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#cursor-trail)

#### Bloom Rendering Backends

[Bloom Rendering Backends](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#bloom-rendering-backends)

#### JavaScript Software Bloom

[JavaScript Software Bloom](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#javascript-software-bloom)

#### Backend Capability Boundaries

[Backend Capability Boundaries](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#backend-capability-boundaries)

### Project Structure

[Project structure and rendering architecture](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#project-structure)

#### Architecture

[Architecture](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#architecture)

## FAQ

### Does WebGPU mode always produce real HDR?

No. Only `resolvedWebGPUOutputMode === 'extended'` indicates successful Canvas negotiation, and display, system, and browser support are still required. Ordinary WebGPU SDR mode uses `webgpuPreferHdr: false`.

### Why does dragging fail to leave a trail in a mobile browser?

The demo defaults Touch Action to Auto so native browser scrolling remains available. Once the browser takes over the gesture it sends `pointercancel`, ending the current trail. Switch Touch Action to Disable Default Gestures to keep trails active in every drag direction; the equivalent API is `touchAction: 'none'`. If the page still needs one-axis scrolling, choose Pan X Only or Pan Y Only: browser-allowed directions continue to scroll and end the trail, while directions the browser does not take over retain it. This setting also changes native page scroll and zoom gestures.

### Why does the effect lose colour on a pure-white background?

A white background has no channel headroom left for additive light. For ordinary unknown-background pages, start with the recommended configuration above. If keeping `scene` output, isolated compositing offers a non-game colour-preservation option. See [the rendering guide](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md).

### Can isolated compositing replace a compositing reference?

No. Isolation changes only the DOM layer boundary. Exact known-Scene evaluation requires a matching background reference; see [setCompositingReference()](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#compositing-reference-and-linear-compositing).

### Can an unknown background have strict Unity additive RGB, pure Coverage alpha, and no white-background darkening at the same time?

These guarantees cannot all hold simultaneously; see [Output and Host Compositing](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#output-and-host-compositing).

### How can I restore the transparent-overlay appearance of v1.2.15?

For transparent overlays, select `overlayAlphaPolicy: 'visual-max'`; colour compensation is independent. See [overlay output policies](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#output-and-host-compositing).

### Which configuration should a transparent desktop host use?

[Transparent-window configuration and boundaries](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#output-and-host-compositing).

## Development

Source development requires Node.js `>=24.0.0`; CI uses `24.19.0`. Browsers consuming built ESM do not require Node.js.

```bash
git clone https://github.com/CialloKing/ba-click-fx.git
cd ba-click-fx
npm ci
npm run dev
```

While the development server runs, use another terminal for checks:

```bash
npm run check
```

`check` runs the build, tests, synchronization checks, and package-install checks. Use `npm run test:browser` for the core-pixel and Worker browser checks.

Browser checks require Chrome / Edge; set `BACLICKFX_CHROMIUM_PATH` to select an executable.

## Desktop Edition (Windows Test Build)

[ba-click-fx-desktop](https://github.com/CialloKing/ba-click-fx-desktop) is an independently implemented Windows-native edition and does not reuse this project's JavaScript / WebGL / WebGPU runtime.

It is still the **first test build (Alpha)**. The verified support boundary is single-primary-monitor, FX-only, SDR: the overlay is click-through and never steals focus, can be exited from the notification-area menu or with `Ctrl+Alt+F12`, and the Control Center can pause/resume effects and adjust the core effect parameters. Do not infer multi-monitor, HDR, capture, or recording support from this build.

Installation packages, build instructions, test status, and architecture decisions belong to the [external desktop repository](https://github.com/CialloKing/ba-click-fx-desktop).

## How It Differs

`ba-click-fx` focuses on faithfully recreating the Blue Archive in-game click FX from Unity project evidence. Final pixel equivalence still depends on the backend, a known scene background, colour management, and the host compositor.

Compared to generic cursor effects:

- Game-accurate dissolve rings, center disk, and shard burst
- Parameter-level reproduction of Unity ParticleSystem curves
- Older trail points disappear first, shortening the trail along its path rather than fading it all at once
- Particle sizes keep scaling with canvas height to preserve Unity UI proportions
- 20+ tunable parameters + custom theme colour

Related projects:

- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor)
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark)
- [ZM-Kimu/Blue-Archive-Touch-Effect](https://github.com/ZM-Kimu/Blue-Archive-Touch-Effect)

## Star History

This repository maintains its Star-count history on the dedicated `star-history` branch and updates it once per day.

<p align="center">
  <a href="https://github.com/CialloKing/ba-click-fx/blob/star-history/stars.csv">
    <img src="https://raw.githubusercontent.com/CialloKing/ba-click-fx/refs/heads/star-history/star-history.svg" alt="ba-click-fx Star history" width="960">
  </a>
</p>

[View the raw CSV data](https://github.com/CialloKing/ba-click-fx/blob/star-history/stars.csv). Missed dates remain absent; no interpolated or fabricated snapshots are inserted.

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
