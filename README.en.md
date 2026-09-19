# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![GitHub Stars](https://img.shields.io/github/stars/CialloKing/ba-click-fx.svg)](https://github.com/CialloKing/ba-click-fx/stargazers)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm lifetime downloads](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FCialloKing%2Fba-click-fx%2Fstats%2Fnpm-downloads.json&logo=npm)](https://www.npmjs.com/package/ba-click-fx)
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

## Desktop Edition (Windows Test Build)

[ba-click-fx-desktop](https://github.com/CialloKing/ba-click-fx-desktop) is an independently implemented native edition for Windows 10/11 x64, with click effects, mouse trails, a Control Center, background-aware rendering, and transparent FX output for OBS.

Control effects through the Control Center or notification-area menu. Global shortcuts are unbound by default and can be configured in the Control Center. Current manual visual review covers a single primary SDR display; background capture and OBS output have additional environment requirements.

The desktop edition does not reuse this project's JavaScript / WebGL / WebGPU runtime. See the [desktop repository](https://github.com/CialloKing/ba-click-fx-desktop) for downloads, usage, and the current support scope.

## Table of Contents

- [Desktop Edition (Windows Test Build)](#desktop-edition-windows-test-build)
- [Features](#features)
- [Installation](#installation)
- [Web Integration](#recommended-web-integration-unknown-background-compositing)
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

Choose one of the three setups below. Each example includes the recommended overlay configuration for ordinary pages. Click the page or drag while holding a pointer to see the effect; see [common usage](#trails-colours-and-switches) for trails without pressing.

### npm

```bash
npm install ba-click-fx
```

```js
import { BAClickFX } from 'ba-click-fx';

const fx = new BAClickFX(
{
  outputCompositing: 'browser-overlay',
  hostCompositing: 'screen',
  hostCompositingSurface: 'dom-backdrop',
});
```

Place this code in the client entry of a build tool such as Vite. In a component framework, create the instance after mounting and call `fx.destroy()` on unmount.

### CDN

```html
<script type="module">
  import { BAClickFX } from 'https://cdn.jsdelivr.net/npm/ba-click-fx@1.3.3/dist/ba-click-fx.js';

  const fx = new BAClickFX(
  {
    outputCompositing: 'browser-overlay',
    hostCompositing: 'screen',
    hostCompositingSurface: 'dom-backdrop',
  });
</script>
```

Place this snippet just before the page's closing `</body>` tag.

### Direct Download

Download the ESM entries you need from [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases). Ordinary pages only need the main `ba-click-fx.js` entry; see the note below the table before using the declarations.

| Entry | JavaScript | Declarations (package imports) |
|---|---|---|
| Main | [ba-click-fx.js](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/ba-click-fx.js) | [ba-click-fx.d.ts](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/ba-click-fx.d.ts) |
| Config | [config.js](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/config.js) | [config.d.ts](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/config.d.ts) |
| Worker | [worker.js](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/worker.js) | [worker.d.ts](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/worker.d.ts) |

**TypeScript:** Use the [npm setup](#npm) above with `import { BAClickFX } from 'ba-click-fx'` for automatic type resolution. For self-hosting, build and deploy the static files with your bundler. The downloaded main declaration currently uses `declare module 'ba-click-fx'`, and the Config and Worker declarations also reference that package name. Placing the `.d.ts` beside the downloaded JS does not make it a usable module declaration for `import ... from './ba-click-fx.js'`; that import produces TS2306 (the declaration file is not a module).

The package and CDN builds are ESM-only. The browser JavaScript example below uses `type="module"` and `import`. Serve downloaded files alongside your page over HTTP(S); no IIFE or UMD global build is provided.

```html
<div id="fx-host"></div>
<style>#fx-host { position: relative; min-height: 240px; }</style>
<script type="module">
  import { BAClickFX } from './ba-click-fx.js';

  const fx = new BAClickFX(
  {
    target: '#fx-host',
    outputCompositing: 'browser-overlay',
    hostCompositing: 'screen',
    hostCompositingSurface: 'dom-backdrop',
  });
</script>
```

Place `ba-click-fx.js` beside the page, then click or drag inside the container to preview the effect.

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

The examples above already use the recommended `browser-overlay + screen + dom-backdrop` configuration for ordinary pages; no additional setup is needed. Library defaults remain `scene + source-over`, and the library does not automatically read the page background.

Use these corresponding options in the online demo:

| Demo option | API configuration | When to use it |
|---|---|---|
| Output Compositing: **Transparent Overlay** | `outputCompositing: 'browser-overlay'` | Emits an independent overlay for the page to composite |
| Effect Reference: **Unknown Background** | Omit the reference, or call `setCompositingReference(null)` | Use when a pixel-matched page reference cannot be supplied continuously |
| Host Compositing: **DOM Add (Approximate)** | `hostCompositing: 'screen'` | Recommended for ordinary pages with unknown, mid-tone, light, or changing backdrops |
| Host Compositing: **Plus-lighter (Original Additive)** | `hostCompositing: 'plus-lighter'` | Consider only for known black or dark backdrops; saturates early over light content |

Choose either `screen` or `plus-lighter`. Pure white has no headroom for further brightening, so `screen` cannot guarantee colour contrast on white either. Check the backdrop and blend mode before adjusting glow intensity.

New instances have no background reference. When reusing an instance with a previous reference, clear it with `fx.setCompositingReference(null)`. The recommended configuration is an SDR visual approximation at the browser/DOM boundary; strict Unity Scene RGB requires a matching known background or host compositing in linear HDR.

[Host surfaces and state diagnostics](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#output-and-host-compositing) covers existing canvases, transparent windows, effective modes, and alpha-option boundaries. See [compositing reference and linear compositing](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md#compositing-reference-and-linear-compositing) for known-background integration.

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

Use this table for common operations. The API reference contains the complete [constructor options and defaults](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#constructor) and [method signatures and return values](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#instance-methods).

| API | Purpose |
|---|---|
| `new BAClickFX(options?)` | Create an instance; omitting `target` creates a fullscreen overlay |
| `updateConfig(patch)` | Update base options and return a snapshot; `target` and `inputFilter` are constructor-only |
| `setThemeColor(color)` | Set a six-digit hexadecimal theme colour; invalid input restores the default game blue |
| `setFxParam(path, value)` | Adjust one FX parameter; return `true` on success or `false` when rejected |
| `boom(x?, y?)` | Trigger one click using canvas-local CSS pixels; omitted coordinates default to the centre |
| `setPaused(paused, options?)` | Pause or resume; `{ clear: true }` also clears on pause |
| `clear()` / `clearTrail()` | Clear all effects / only trails and trail shards, without pausing |
| `getConfig()` | Read current configuration, resolved backends, and host-compositing state |
| `destroy()` | Release resources and listeners on unmount, removing only library-created canvases |

Backend state may be `pending` during lazy probing; read `resolvedEffectBackend` / `resolvedBloomBackend` from `getConfig()` for the actual result. See the detailed guides below for manual input, batch parameter updates, configuration resets, and state-change events.

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

The download badge is recalculated daily by calendar year, from the first publication through yesterday in UTC. See [download statistics](https://github.com/CialloKing/ba-click-fx/blob/main/badges/README.md) for manual updates and counting rules.

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
