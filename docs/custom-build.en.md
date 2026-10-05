# Build a Custom Version with Fixed Parameters

[Back to README](../README.en.md) · [简体中文](https://github.com/CialloKing/ba-click-fx/blob/main/docs/custom-build.md)

## Build and Profile

Custom versions extend the existing Vite build and share the full version's input, lifecycle, geometry, and rendering implementations. `npm run build` still produces the full library and demo. With `--profile`, only `dist-custom` is generated: `dist` is preserved and custom files stay outside the npm publishing whitelist.

Use Node.js >=24 and run `npm ci` in the source directory. Copy the [Worker profile](../examples/build-profiles/webgl2-worker.json) to your own `ba-click-fx.build.json`, then run:

```bash
npm run build -- --profile ba-click-fx.build.json
```

You can also build the [Native click profile](../examples/build-profiles/native-click-dom.json) directly:

```bash
npm run build -- --profile examples/build-profiles/native-click-dom.json
```

The five top-level fields are below. `backend` and `runtime` are required; the others are optional.

| Field | Contents |
|---|---|
| `backend` | `webgl2`, `webgpu`, `webgpu-hdr`, `webgl2-bloom`, `software`, `native` |
| `runtime` | `dom`, `manual`, `worker`; one per build |
| `features` | Boolean `click`, `trail`, `shards`, `bloom`, `compositingReference`; all enabled by default |
| `config` | Existing ordinary settings, such as theme, scale, DPR cap, and output compositing |
| `fxParams` | Path patches from the existing parameter Schema, such as `"bloom.intensity": 1.7` |

All six modes support all three runtimes. Like the full version, `webgl2-bloom` reuses the complete WebGL2 Scene; successful paths share an implementation. `webgpu-hdr` requests Extended output, while the actual mode depends on the device and browser.

Ordinary settings and FX parameters use the existing defaults, validation, and normalization. Final values are recorded in `build-info.json`. Unknown fields, rejected parameters, and conflicts fail the build. These fields are controlled by the top-level choices and cannot also appear in `config`: `effectBackend`, `bloomBackend`, `webgpuPreferHdr`, `inputSource`, `clickEnabled`, `trailEnabled`.

A disabled feature cannot receive `fxParams` patches. `hit`, `flare`, `disk`, and `rings` belong to click. `trailAlways: true` conflicts with disabled trails. Manual Canvas and Worker reject `isolatedCompositing: true`. Disabling Bloom fixes its final intensity to 0 and removes the associated work.

## Output and API

`dist-custom` contains one self-contained `ba-click-fx.js`, a matching top-level ESM declaration, `build-info.json`, `modules.json`, `LICENSE`, and `THIRD_PARTY_NOTICES.md`. Build information records the version, final ordinary settings and FX parameters, features, included modules, and raw/gzip/Brotli script bytes. Keep the license and third-party notices when deploying.

```js
import BAClickFX, { BAClickFX as NamedBAClickFX } from './ba-click-fx.js';
```

The default and named exports are the same class. Declarations directly support this relative ESM import. Custom output does not export the full version's Schema, configuration tools, or Worker sub-entry.

Constructor options accept only `target` and `onError`, with `inputFilter` also available in DOM builds. Numbers, theme, and backend are determined by the profile and cannot be overridden in the constructor.

| Capability | Available methods |
|---|---|
| Every build | `resize`, `setPaused`, `clear`, `destroy`, `getConfig`, `getFxConfig`, `getEffectiveHostCompositing` |
| Click enabled | `boom` |
| Trail enabled | `clearTrail` |
| Manual/Worker with click or trail enabled | `pointerDown`, `pointerMove`, `pointerUp`, `pointerCancel` |
| Compositing reference enabled | `setCompositingReference` |

`updateConfig`, `setFxParams`, theme setters, parameter reset, and backend switching are omitted. Parameter trees are immutable, animation state belongs to each instance, and queries return copies. Dimensions and actual DPR remain host resource state managed through `resize`, capped by the fixed `maxDpr`.

Only the selected mode and necessary dependencies are included; there is no automatic fallback to other backends. Native's known-background Final Pass still needs WebGL2 helper modules. Keeping `compositingReference` retains those helpers to preserve the image; disabling that capability also removes the helper path.

## Host Integration

`dom` accepts a positioned container, its selector, or no `target` for a fullscreen overlay. Choose `manual` for an existing Canvas. DOM builds manage input listeners and dimensions.

```js
const fx = new BAClickFX({ target: '#fx-host', onError: error => console.error(error) });
// When unmounting: fx.destroy();
```

`manual` requires an `HTMLCanvasElement`. The host owns coordinates, dimensions, DPR, and pointer lifecycle. Do not acquire another Canvas context type before constructing the instance.

```js
const fx = new BAClickFX({ target: canvas, onError: error => console.error(error) });
fx.resize(320, 240, devicePixelRatio);
fx.pointerDown({ x: 100, y: 80, pointerId: 1 });
fx.pointerMove({ x: 120, y: 90, pointerId: 1 });
fx.pointerUp(1);
```

`worker` requires an `OffscreenCanvas` inside a Dedicated Worker. The host creates a module Worker, transfers the Canvas, and maintains its message protocol. The outline below can reuse dimensions and input forwarding from the [complete Worker example](./worker-guide.en.md).

```js
// Main thread
const worker = new Worker(new URL('./fx-worker.js', import.meta.url), { type: 'module' });
const offscreen = canvas.transferControlToOffscreen();
worker.postMessage({ type: 'init', canvas: offscreen, width: 320, height: 240, dpr: devicePixelRatio }, [offscreen]);
// Convert DOM coordinates to Canvas-local CSS pixels before forwarding pointerDown/Move/Up/Cancel.
```

```js
// fx-worker.js, deployed beside the custom ba-click-fx.js
import BAClickFX from './ba-click-fx.js';
let fx;
self.onmessage = ({ data }) =>
{
  switch (data.type)
  {
    case 'init':
      fx = new BAClickFX({ target: data.canvas, onError: error => postMessage({ type: 'error', code: error.code }) });
      fx.resize(data.width, data.height, data.dpr);
      break;
    case 'resize': fx.resize(data.width, data.height, data.dpr); break;
    case 'pointerDown': fx.pointerDown(data.input); break;
    case 'pointerMove': fx.pointerMove(data.input); break;
    case 'pointerUp': fx.pointerUp(data.pointerId); break;
    case 'pointerCancel': fx.pointerCancel(data.pointerId); break;
    case 'pause': fx.setPaused(data.paused); break;
    case 'clear': fx.clear(); break;
    case 'config': postMessage({ type: 'config', config: fx.getConfig() }); break;
    case 'destroy': fx.destroy(); fx = null; postMessage({ type: 'destroyed' }); break;
  }
};
```

Send `init` first and only messages supported by the selected capabilities. On unmount, remove input listeners, send `destroy`, and terminate the Worker after acknowledgment. After a device failure, destroy the old instance and rebuild with a new Canvas.

## Devices and Failures

WebGPU construction stays synchronous and requests a device asynchronously. During preparation, `getConfig().resolvedWebGPUOutputMode` is `pending`; existing input waits for output. Destroying during initialization prevents subsequent output and releases newly acquired resources.

Device unavailability, initialization/render failure, or WebGPU device loss stops custom output and calls the constructor's `onError`. Unpausing cannot revive a failed instance. Synchronous Canvas 2D context failure also calls the callback and throws; invalid constructor options throw directly. Error `code` includes `initialization-failed`, `device-lost`, `render-failed`, and Software/compositing-helper failure codes.

WebGL context restoration uses the existing flow without switching modes. Failed Extended configuration can continue with Standard output on the same WebGPU backend. Query `resolvedWebGPUOutputMode` for the actual `standard` or `extended` mode. Successful Extended configuration does not prove physical HDR display output.

## Validation and Performance

```bash
npm run check:release
```

Release checks include full-build regression, build and type checks through `test:custom`, and actual runtime acceptance through `test:browser:custom -- --required`. Browser validation requires Chrome/Edge; set `BACLICKFX_CHROMIUM_PATH` if needed. Tests cover six modes and three runtimes, feature trimming, non-default settings, known backgrounds, multiple instances, lifecycle, and real Canvas transfers. Fixed input, random numbers, and time enable byte-exact full/custom pixel comparisons without changing golden data or thresholds. WebGPU Worker additionally checks asynchronous preparation, destruction during preparation, device loss, and Standard fallback. Running `npm run test:browser:custom` alone explicitly records unavailable devices as skipped; release checks require every device to run and fail on any skip.

`check:release` runs both custom suites in one process through `test:custom:release`, building each final configuration only once. Standalone build and browser checks retain their complete coverage. Generated files stay in the ignored `test-results/custom-builds` directory. Only artifacts freshly generated in the current process are reused; the next run rebuilds instead of trusting old files or acceptance results.

Default browser acceptance checks pixels and lifecycle only, recording bytes and acceptance results in `test-results/custom-browser/results.json` without running performance workloads. Run benchmarks explicitly when comparing performance:

```bash
npm run benchmark:custom
# Optionally measure only profiles whose names contain webgpu
npm run benchmark:custom -- webgpu
```

The separate `test-results/custom-browser/benchmark.json` report records import/initialization times, 90 CPU frame samples, and exposed browser heap snapshots without overwriting acceptance results. Full and custom builds run in separate browser contexts. Integration combinations unsupported by the full version use its DOM build as the visual reference; `actualRuntime` records the integration used, so initialization and memory results for these combinations cannot be treated as performance comparisons of the same integration. Unavailable Worker heap values are `null`; snapshots do not measure GPU memory. CPU times include updates and GPU submission. Basic GPU profiles separately record 30 native RAF frames and GPU completion waits. Headless scheduling FPS does not validate physical display FPS or HDR output; unavailable environments are explicitly recorded.

Most savings come from omitting unused backends, input handling, tuning systems, and feature resources. Theme mappings and fixed-material Bloom math are also precomputed with the same formulas and double precision. This first stage preserves shaders, texture encoding, and HDR/Bloom algorithms without promising a fixed size or FPS improvement. Builds retaining large textures may still be substantial.
