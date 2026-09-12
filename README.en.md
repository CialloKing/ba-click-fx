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
- [Web Integration](#recommended-web-integration-unknown-background-compositing)
- [Desktop Edition (Windows)](#desktop-edition-windows)
- [Common Usage](#common-usage)
- [API Reference](#api-reference)
- [Detailed Documentation](#detailed-documentation)
- [FAQ](#faq)
- [Development](#development)
- [How It Differs](#how-it-differs)
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

### npm

```bash
npm install ba-click-fx
```

```js
import { BAClickFX } from 'ba-click-fx';
const fx = new BAClickFX();
```

For ordinary unknown-background pages, also apply the [recommended configuration](#recommended-web-integration-unknown-background-compositing): explicitly set `browser-overlay + screen + dom-backdrop`.

### CDN

```html
<script type="module">
  import { BAClickFX } from 'https://cdn.jsdelivr.net/npm/ba-click-fx@1.3.3/dist/ba-click-fx.js';
  const fx = new BAClickFX();
</script>
```

When using the CDN on an ordinary page, also apply the [recommended configuration](#recommended-web-integration-unknown-background-compositing) below.

### Direct Download

Download the ESM files and matching declarations from [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases), or use the links below:

| Entry | JavaScript | TypeScript |
|---|---|---|
| Main | [ba-click-fx.js](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/ba-click-fx.js) | [ba-click-fx.d.ts](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/ba-click-fx.d.ts) |
| Config | [config.js](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/config.js) | [config.d.ts](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/config.d.ts) |
| Worker | [worker.js](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/worker.js) | [worker.d.ts](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/worker.d.ts) |

The package and CDN builds are ESM-only. For static browser imports, use `type="module"` and obtain the API through `import`; no IIFE or UMD global build is provided. Serve downloaded files alongside your page over HTTP(S).

```html
<div id="fx-host"></div>
<style>#fx-host { position: relative; min-height: 240px; }</style>
<script type="module">
  import { BAClickFX } from './ba-click-fx.js';
  const fx = new BAClickFX({ target: '#fx-host' });
</script>
```

Ordinary page containers should also use the [recommended configuration](#recommended-web-integration-unknown-background-compositing); the example above shows minimal initialisation.

Omitting `target` creates a full-screen overlay. A normal web container should establish a positioning context. An existing `HTMLCanvasElement` is intended for hosts that manage one Canvas themselves, but it disables multi-layer DOM compositing and safely downgrades the complete GPU/Bloom path.

### Browser Extension

Install the browser extension for any of the supported stores:

| Store | Link |
|-------|------|
| **Chrome** | [Chrome Web Store](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) |
| **Edge** | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) |
| **Firefox** | [Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/) |

Source: [ba-click-fx-extension](https://github.com/CialloKing/ba-click-fx-extension).

## Recommended Web Integration: Unknown-Background Compositing

For ordinary pages, use `browser-overlay + screen + dom-backdrop`. Layered CSS backgrounds, scrolling content, animation, video, and cross-origin resources usually prevent the host from supplying an opaque reference that matches the pixels beneath the effect on every frame. The library does not automatically read the page background.

Run the following code in the same module after any initialisation example above. It updates the existing `fx`, preserving its target and import path. Library defaults remain `scene + source-over`; the recommended configuration must be set explicitly:

```js
fx.updateConfig(
{
  outputCompositing: 'browser-overlay',
  hostCompositing: 'screen',
  hostCompositingSurface: 'dom-backdrop',
});

// New instances have no reference by default; clear any previous reference when reusing one.
fx.setCompositingReference(null);
```

### Choosing a Background and Blend Mode

Use these corresponding options in the online demo before applying them to your page:

| Demo option | API configuration | When to use it |
|---|---|---|
| Output Compositing: **Transparent Overlay** | `outputCompositing: 'browser-overlay'` | Emits an independent alpha-bearing overlay for the host to composite once |
| Effect Reference: **Unknown Background** | Omit the reference, or call `setCompositingReference(null)` | Use when a pixel-matched page reference cannot be supplied continuously; does not change the page's CSS background |
| Host Compositing: **DOM Add (Approximate)** | `hostCompositing: 'screen'` | Recommended for ordinary pages with unknown, mid-tone, light, or changing backdrops; the added brightness contracts over light content |
| Host Compositing: **Plus-lighter (Original Additive)** | `hostCompositing: 'plus-lighter'` | Consider only for known black or dark backdrops; stronger addition saturates early over light content |

Choose either `screen` or `plus-lighter`. Pure white has no headroom for further brightening, so `screen` cannot guarantee colour contrast on white either. Check the backdrop and blend mode before adjusting glow intensity. While either blend is effective, `overlayAlphaPolicy`, `overlayColorCompensation`, and `overlayAlphaLimit` do not participate in that output path.

### Host Surface and Effective State

`hostCompositingSurface` describes where the final blend occurs; choose it to match the actual host:

| Host surface | API configuration | Compositing boundary |
|---|---|---|
| Ordinary DOM backdrop (default) | `hostCompositingSurface: 'dom-backdrop'` | The DOM applies `screen` / `plus-lighter` once to the library-created overlay |
| Transparent desktop window | `hostCompositingSurface: 'transparent-window'` | Pair with `hostCompositing: 'source-over'`; CSS blending cannot cross the operating-system window boundary |
| External native compositor | `hostCompositingSurface: 'native'` | The host performs the final blend; this setting does not connect a native compositor automatically |

For ordinary pages, prefer the default fullscreen overlay or a [positioned container](#direct-download). With an existing Canvas, the library does not change its `mix-blend-mode`; the host owns the final CSS or native blend. An existing `HTMLCanvasElement` also limits the complete GPU/Bloom path; see [mounting and output boundaries](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#output-and-host-compositing).

A requested configuration value may differ from the effective value. Read the current snapshot when diagnosing the output:

```js
const state = fx.getConfig();
console.table({
  requested: state.requestedHostCompositing,
  resolved: state.resolvedHostCompositing,
  surface: state.hostCompositingSurface,
  warning: state.compositingWarning,
});
```

You can also read the current mode directly with `fx.getEffectiveHostCompositing()`. With `browser-overlay` and an unknown background in a transparent window, a request for `screen` / `plus-lighter` resolves to `source-over` and reports `screen-requires-visible-backdrop` / `plus-lighter-requires-visible-backdrop`. This means the host surface cannot perform the requested blend.

A compositing reference restores `source-over` only when the current output path **actually uses** it, preventing a second blend. A `true` result from `setCompositingReference()` means the reference was accepted; read the effective state again after changing the backend or reference.

The recommended web configuration is an **SDR visual approximation** at the browser/DOM boundary. For strict Unity Scene RGB, use `scene` with a live, pixel-matched background reference on the complete WebGPU/WebGL2 path, or have the host composite in a linear HDR render target. See [compositing reference and linear compositing](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#compositing-reference-and-linear-compositing) for reference loading, cropping, and backend capabilities.

## Desktop Edition (Windows)

[ba-click-fx-desktop](https://github.com/CialloKing/ba-click-fx-desktop) is an independently implemented Windows-native edition and does not reuse this project's JavaScript / WebGL / WebGPU runtime.

The verified support boundary is single-primary-monitor, FX-only, SDR: the overlay is click-through and never steals focus, can be exited from the notification-area menu or with `Ctrl+Alt+F12`, and the Control Center can pause/resume effects and adjust the core effect parameters. Do not infer multi-monitor, HDR, capture, or recording support from this build.

Installation packages, build instructions, test status, and architecture decisions belong to the [external desktop repository](https://github.com/CialloKing/ba-click-fx-desktop).

## Common Usage

### Trails, Colours, and Switches

These examples reuse the `fx` instance above. Trails require a held pointer by default; `trailAlways` also enables them while moving without a pressed button:

```js
fx.updateConfig({ trailAlways: true });
fx.setThemeColor('#ff80b5');
fx.updateConfig({ scale: 0.8, opacity: 0.7 });
// Reduce glow intensity; the default is 1.7.
fx.setFxParam('bloom.intensity', 1.2);
```

To trigger one click effect at the canvas centre:

```js
fx.boom();
```

To disable clicks while keeping trails enabled:

```js
fx.updateConfig({ clickEnabled: false, trailEnabled: true });
```

Each switch controls its own effect; set it to `true` to enable that effect again. `boom()` takes Canvas-local CSS pixel coordinates. Theme colours accept six-digit hexadecimal values; invalid values restore the default game blue. Theme colours update only the current instance; restoring them after a refresh requires the host to save, read, and apply them.

### Sampling and Playback Speed

```js
fx.updateConfig({ inputSamplingRate: 30 });
fx.updateConfig({ clickTimeScale: 1.5, trailTimeScale: 0.8 });
```

The sampling rate accepts `0` (unlimited) or `1..1000` Hz and limits movement input, not rendering frames. A time scale of `1` is normal speed and `2` is twice as fast; use `setPaused()` to pause.

### Pause and Unmount Cleanup

Choose the operation for the current situation. To pause and clear the screen:

```js
fx.setPaused(true, { clear: true });
```

When ready to resume input and animation:

```js
fx.setPaused(false);
```

To clear trails, call `fx.clearTrail()`; to clear all effects, call `fx.clear()`. Neither operation pauses the instance.

Only when unmounting the component or finishing with the instance:

```js
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
| `boom(x?, y?)` | Trigger one click effect; omitted coordinates default to the canvas centre, without creating trail state |
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
| `updateConfig({...})` | Update runtime configuration and return a configuration snapshot; `target` and `inputFilter` are constructor-only |
| `setThemeColor('#4ca7ff')` | Update the current instance's theme colour; invalid input restores the default game blue |
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

### API and Parameters

[Constructor, methods, and return values](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md) · [Manual input](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#host-input-and-pointer-lifecycle) · [Schema and storage](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#parameter-schema-and-batch-updates) · [Theme colours](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#theme-colours)

### Rendering and Compositing

[Backends, HDR, and background compositing](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md) · [Click effects and trails](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#effects) · [Architecture](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#project-structure)

### Worker Integration

[Complete integration example](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.en.md): main thread and Worker, size and coordinate synchronisation, cleanup, and capability boundaries.

## FAQ

### Getting Started

#### Why is there no trail when I only move the pointer?

Set `fx.updateConfig({ trailAlways: true })` and ensure `trailEnabled` is `true`. By default, trails require a pressed pointer; moving alone does not display one. See [trails, colours, and switches](#trails-colours-and-switches).

#### Why does dragging fail to leave a trail in a mobile browser?

For trails in every drag direction, set `touchAction: 'none'`; the demo calls this Touch Action: Disable Default Gestures. The default `auto` preserves native scrolling; when the browser takes over a gesture, it sends `pointercancel` and ends the trail. If one-axis scrolling is still needed, use `pan-x` or `pan-y`; browser-owned directions still end the trail. This setting changes native scroll and zoom gestures. See [touch policies](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#constructor).

#### How do I fix effect size or placement inside a container?

Give the target container `position: relative` and visible, non-zero dimensions, for example `min-height: 240px`, and point `target` to it. After showing a hidden container, call `fx.resize()` to synchronise its size. See the [container example](#direct-download) and [size API](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#instance-methods).

#### How should components manage mounting and cleanup?

Create one instance after client mount and call `fx.destroy()` on unmount. Create a new instance when mounting again and avoid duplicate initialisation. With SSR, do not construct an instance on the server. See [pause and unmount cleanup](#pause-and-unmount-cleanup).

### Rendering and Compatibility

#### Why does the effect lose colour on a pure-white background?

Start with the [recommended configuration](#recommended-web-integration-unknown-background-compositing) for ordinary unknown-background pages. White has no channel headroom left for additive light. If keeping `scene` output, isolated compositing offers a non-game colour-preservation option. See [output and host compositing](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#output-and-host-compositing).

#### Does WebGPU mode always produce real HDR?

First check `fx.getConfig().resolvedWebGPUOutputMode === 'extended'`. Selecting WebGPU alone does not guarantee real HDR; display, system, and browser support are also required. Ordinary SDR mode uses `webgpuPreferHdr: false`. See [WebGPU and HDR](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#webgpu-and-hdr).

#### Can isolated compositing replace a compositing reference?

No. For exact known-Scene evaluation, provide a matching background reference; isolation changes only the DOM layer boundary. See [compositing reference and linear compositing](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#compositing-reference-and-linear-compositing).

#### Can an unknown background have strict Unity additive RGB, pure Coverage alpha, and no white-background darkening at the same time?

These guarantees cannot all hold simultaneously. For strict Unity additive results, use `scene` with a pixel-matched known background reference; use the recommended overlay configuration for unknown-background pages. See [output and host compositing](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#output-and-host-compositing) for the reasoning.

#### How can I restore the transparent-overlay appearance of v1.2.15?

For transparent overlays, select `overlayAlphaPolicy: 'visual-max'`; colour compensation is independent. See [overlay output policies](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#output-and-host-compositing).

#### Which configuration should a transparent desktop host use?

Set `outputCompositing: 'browser-overlay'`, `hostCompositingSurface: 'transparent-window'`, and `hostCompositing: 'source-over'`. CSS blending cannot cross an operating-system window boundary. See [transparent-window configuration and boundaries](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#output-and-host-compositing).

## Development

Source development requires Node.js `>=24.0.0`; CI uses `24.19.0`. Browsers consuming built ESM do not require Node.js.

```bash
git clone https://github.com/CialloKing/ba-click-fx.git
cd ba-click-fx
npm ci
npm run dev
```

Run daily checks independently; starting the development server is not required:

```bash
npm run check
```

`check` runs the build, tests, synchronization checks, and package-install checks. Use `npm run test:browser` for the core-pixel and Worker browser checks.

Browser checks require Chrome / Edge; set `BACLICKFX_CHROMIUM_PATH` to select an executable.

## How It Differs

`ba-click-fx` focuses on faithfully recreating the Blue Archive in-game click FX from Unity project evidence. Final pixel equivalence still depends on the backend, a known scene background, colour management, and the host compositor.

Compared to generic cursor effects:

- Game-accurate dissolve rings, center disk, and shard burst
- Parameter-level reproduction of Unity ParticleSystem curves
- Older trail points disappear first, shortening the trail along its path rather than fading it all at once
- Particle sizes keep scaling with canvas height to preserve Unity UI proportions
- Dozens of tunable parameters and a custom theme colour

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
