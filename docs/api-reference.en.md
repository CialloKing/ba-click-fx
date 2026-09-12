# API Reference

[Back to README](https://github.com/CialloKing/ba-click-fx/blob/main/README.en.md) · [简体中文](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md)

[API reference](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md) · [Rendering and compositing](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md) · [Worker integration](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.en.md)

Defaults follow the published types and configuration Schema. Use `updateConfig()` for base options and `setFxParam()` / `setFxParams()` for effect parameters.

## Constructor

```ts
new BAClickFX(options?: {
  target?: string | HTMLElement | OffscreenCanvas,
  scale?: number,                // default 1
  opacity?: number,              // default 1
  themeColor?: string,           // six-digit hex, default #4ca7ff
  themeColorMode?: 'hue-only' | 'relative-oklch', // public-library default: relative-oklch
  outputCompositing?: 'scene' | 'browser-overlay', // default scene
  overlayAlphaPolicy?: 'coverage' | 'visual-max', // default coverage
  overlayColorCompensation?: 'none' | 'bright-core', // default none
  overlayAlphaLimit?: number,    // overlay alpha limit, default 250/255
  hostCompositing?: 'source-over' | 'screen' | 'plus-lighter', // default source-over
  hostCompositingSurface?: 'dom-backdrop' | 'transparent-window' | 'native', // final host surface, default dom-backdrop
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
  bloomBackend?: 'auto' | 'software' | 'webgl2' | 'native', // default webgl2
  isolatedCompositing?: boolean,  // default false; true enables non-game white-background compatibility
  lightBackgroundContrastAlpha?: number, // light-background compatibility strength, default 0
  maxDpr?: number,               // default 1; raise explicitly for capable devices
  touchAction?: string,          // DOM touch-gesture policy; default 'auto'
  inputFilter?: (e: PointerEvent) => boolean,
})
```

The old `softwareBloomEnabled` field has been removed from the current configuration API; passing it throws `TypeError`. Use `bloomBackend: 'software'` or `bloomBackend: 'native'`, or use `'auto'` for automatic selection.

`touchAction` accepts CSS `touch-action` keywords and space-separated combinations, including `none`, `pan-x`, `pan-y`, `pan-left`, `pan-right`, `pan-up`, `pan-down`, and `pinch-zoom`. DOM input installs capture Touch arbitration only when the policy must block a direction or pinch; `auto`, `manipulation`, and combinations that explicitly allow every axis and pinch retain the browser's compositor-friendly scrolling. When an overlay Canvas is not hit-testable, the library locks the gesture direction at its first meaningful move and applies `inputFilter` to exclude host controls; `inputSource: 'manual'` does not install these DOM listeners.

`target` and `inputFilter` are constructor-only. For backend, compositing, and HDR selection, see [the rendering guide](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md).

Construction returns a new instance on success. Configuration validation failures throw `TypeError`; initialisation failures such as a missing browser/Worker environment, missing target, or unavailable required Canvas context throw an error. With SSR, create the instance on client mount; Worker hosts must explicitly supply an `OffscreenCanvas`.

## Type Signature Summary

These declarations are for reference; import the actual APIs from the package instead of redeclaring them. See the [TypeScript declarations](https://github.com/CialloKing/ba-click-fx/blob/main/src/ba-click-fx.d.ts) for the complete fields of constructor options, pointer inputs, configuration snapshots, and batch results.

```ts
import type {
  BAClickFXCompositingReferenceOptions,
  BAClickFXConfigSnapshot,
  BAClickFXHostCompositing,
  BAClickFXOptions,
  BAClickFXParamPatchOptions,
  BAClickFXParamPatchResult,
  BAClickFXParamValue,
  BAClickFXPauseOptions,
  BAClickFXPointerInput,
  BAClickFXStandalonePatchOptions,
  BAClickFXThemeColorMode,
  BAClickFXUpdateOptions,
} from 'ba-click-fx';

declare class BAClickFX
{
  constructor(options?: BAClickFXOptions);
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly width: number;
  readonly height: number;
  resize(width?: number, height?: number, dpr?: number): void;
  boom(x?: number, y?: number): void;
  pointerDown(input: BAClickFXPointerInput): boolean;
  pointerMove(input: BAClickFXPointerInput): boolean;
  pointerUp(pointerId?: number): boolean;
  pointerCancel(pointerId?: number): boolean;
  setPaused(paused: boolean, options?: BAClickFXPauseOptions): void;
  setCompositingReference(
    source: TexImageSource | null,
    options?: BAClickFXCompositingReferenceOptions,
  ): boolean;
  getEffectiveHostCompositing(): BAClickFXHostCompositing;
  updateConfig(overrides: BAClickFXUpdateOptions): BAClickFXConfigSnapshot;
  setThemeColor(hex: string): void;
  setThemeColorMode(mode: BAClickFXThemeColorMode): boolean;
  setInputSamplingRate(rateHz: number): boolean;
  setFxParam(path: string, value: BAClickFXParamValue): boolean;
  setTriangleRoundness(roundness: number): boolean;
  setFxParams(
    patch: Readonly<Record<string, BAClickFXParamValue>>,
    options?: BAClickFXParamPatchOptions,
  ): BAClickFXParamPatchResult;
  getFxConfig(): Record<string, unknown>;
  resetFxConfig(): void;
  clearTrail(): void;
  clear(): void;
  getConfig(): BAClickFXConfigSnapshot;
  destroy(): void;
}

declare function applyFxParamPatch(
  patch: Readonly<Record<string, unknown>>,
  options?: BAClickFXStandalonePatchOptions,
): BAClickFXParamPatchResult;
```

`canvas` is the instance's main canvas. Read-only `width` / `height` report its current local CSS pixel dimensions, not the DPR-scaled backing-store dimensions. Methods returning `void` provide no success flag and do not imply that the next frame has finished rendering.

## Instance Methods

| Method | Description |
|---|---|
| `resize(width?, height?, dpr?)` | Explicitly synchronize Canvas CSS size and DPR, primarily for Worker / OffscreenCanvas hosts |
| `boom(x?, y?)` | Trigger one click effect; omitted coordinates default to the canvas centre, without creating trail state |
| `pointerDown(input)` | Start one click-and-trail lifecycle; return whether the input was accepted |
| `pointerMove(input)` | Append a trail sample for the current logical pointer; return whether input was accepted, including `true` for rate-limited samples |
| `pointerUp(pointerId?)` | End the matching pointer normally; return `true` on success and let its existing trail fade |
| `pointerCancel(pointerId?)` | Cancel the matching pointer and immediately remove the current trail; return `true` on success |
| `setPaused(paused, options?)` | Pause or resume input and animation scheduling, optionally clearing on pause |
| `setInputSamplingRate(rateHz)` | Set the move-input sampling-rate limit; accepts `0` or `1..1000` and returns `true` on success |
| `setCompositingReference(source, { fit: 'cover' })` | Return whether the reference was accepted; pass `null` to clear it. A `false` result leaves the previous reference unchanged |
| `clear()` | Remove all visual objects |
| `clearTrail()` | Clear trail points and trail shards; preserve click effects and click shards |
| `destroy()` | Destroy the instance and its listeners; remove only library-created canvases |
| `updateConfig({...})` | Update runtime configuration and return a configuration snapshot; `target` and `inputFilter` are constructor-only |
| `setThemeColor('#4ca7ff')` | Update the current instance's theme colour; invalid input restores the default game blue |
| `setThemeColorMode(mode)` | Switch the theme-colour mapping mode; accepts `hue-only` or `relative-oklch` and returns `true` on success |
| `setTriangleRoundness(value)` | Set the triangle-shard roundness ratio; equivalent to `setFxParam('shards.roundness', value)` and returns whether the change was committed |
| `setFxParam('rings.hdrIntensity', 5.992157)` | Modify one dot-path; returns `true` on success and `false` when rejected |
| `setFxParams(patch, options?)` | Validate and batch-apply a dot-path patch through the public Schema, returning per-entry results |
| `getFxConfig()` | Deep copy of current FX configuration |
| `resetFxConfig()` | Reset all FX parameters to the Unity baseline |
| `getConfig()` | Current config; besides Full Effect and Bloom resolution, it reports the effective WebGPU output and host-compositing state |
| `getEffectiveHostCompositing()` | Return the effective host compositing mode |

### Return Values and Failure Conditions

- `boom()` defaults `x` / `y` independently to `width / 2` / `height / 2`; it produces no effect while paused, destroyed, or clicks are disabled. When dimensions or DPR are omitted, `resize()` uses measurable layout and environment values, with DPR capped by `maxDpr`; Worker hosts should supply explicit dimensions.
- Pointer methods return `false` when the current state rejects input, for example while paused or destroyed, for invalid input, or for a pointer mismatch. `pointerDown()` also rejects another unfinished press; `pointerMove()` also returns `false` when trails are disabled. A `true` result does not guarantee a visible trail point was appended.
- `setInputSamplingRate()` / `setThemeColorMode()` return `true` for accepted values and `false` for invalid values or destroyed instances. `setFxParam()` / `setTriangleRoundness()` report whether the change was committed; finite out-of-range numbers are clamped by the Schema. `setThemeColor()` returns `void` and restores the default for invalid colours.
- `setCompositingReference()` reports whether the reference was accepted. Invalid sources, unsupported `fit` values, renderer rejection, or destroyed instances return `false`. Acceptance does not mean the current output path uses the reference; inspect `getEffectiveHostCompositing()` for the effective blend.
- `updateConfig()` returns a configuration snapshot with the same structure as `getConfig()`. A configuration object, field, or value that fails validation throws `TypeError`; a destroyed instance or a requested change of direct OffscreenCanvas context type throws an error. `getFxConfig()` returns an independent deep copy.
- `setFxParams()` and standalone `applyFxParamPatch()` return `committed`, `applied`, `normalized`, `rejected`, and `schemaVersion`; see [batch updates and migration](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md#parameter-schema-and-batch-updates). On a destroyed instance, `setFxParams()` returns `committed: false` with rejection reason `destroyed`.

### Backend and Compositing Events

The main canvas dispatches `baclickfxeffectbackendchange` and `baclickfxbackendchange` when the Full Effect and Bloom resolution states change. Use the exported event names to track deferred probing, runtime fallback, WebGPU device loss, and WebGL context recovery:

```js
import {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
  HOST_COMPOSITING_CHANGE_EVENT,
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

fx.canvas.addEventListener(HOST_COMPOSITING_CHANGE_EVENT, (event) =>
{
  console.log(event.detail.requestedHostCompositing);
  console.log(event.detail.resolvedHostCompositing);
  console.log(event.detail.hostCompositingSurface);
  console.log(event.detail.compositingWarning);
  console.log(fx.getEffectiveHostCompositing());
});
```

`resolvedEffectBackend === 'webgpu'` proves only that the WebGPU Scene owns the current output. Real HDR requires `resolvedWebGPUOutputMode === 'extended'` as well; do not substitute `matchMedia('(dynamic-range: high)')` for the actual Canvas configuration result.

## Host Input and Pointer Lifecycle

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

## Input Sampling Rate

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

## Independent Time Scales

`clickTimeScale` and `trailTimeScale` must both be finite numbers no smaller than `0.01`. `1` is the original speed, `2` means twice the speed with half the duration, and `0.5` means half speed with twice the duration; `0` does not mean pause, and values below `0.01` are ignored. Both values can be updated at runtime:

```js
fx.updateConfig(
{
  clickTimeScale: 1.5,
  trailTimeScale: 0.8,
});
```

`clickTimeScale` scales click-wave lifetime, rotation, click-shard lifetime, and displacement together. `trailTimeScale` scales trail decay, trail-shard lifetime, and displacement together. Neither changes spatial sampling settings such as `minVertexDistance` or `trailSpacing`.

## Pause and Resume

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

## Parameter Schema and Batch Updates

The library exports the read-only `FX_PARAM_SCHEMA`, the current `FX_PARAM_SCHEMA_VERSION`, and `FX_PARAM_MIGRATIONS`. Each public scalar path describes its type, hard bounds, default, unit, group, stable display order, localisation keys, recommended control range, and linked parameters. Hosts can build settings UIs without copying an independent control list. `step` and `display.step` only guide host UI controls. `setFxParam()` / `setFxParams()` do not quantise or round to those steps; they validate type, finiteness, and the hard `min` / `max` bounds. Hosts that require integer controls should round before submission.

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

Persist the patch together with its schema version, for example `{ schemaVersion: 0, patch: { "bloom.scatter": 0.35 } }`. Read the saved version rather than assuming it is current. The following module migrates and writes back only on success; JSON, schema, and migration errors retain the original record and report the reason. Unversioned legacy data needs the version known by its host; do not guess it.

```js
import { applyFxParamPatch } from 'ba-click-fx';

// Store the version with the patch so a future library can migrate it.
export function migrateStoredFx(storage = localStorage)
{
  const key = 'ba-click-fx';
  try
  {
    const raw = storage.getItem(key);
    if (raw === null)
    {
      return null;
    }
    const stored = JSON.parse(raw);
    if (!stored || !Number.isInteger(stored.schemaVersion) ||
      stored.schemaVersion < 0 || !stored.patch ||
      typeof stored.patch !== 'object' || Array.isArray(stored.patch))
    {
      throw new TypeError('Expected { schemaVersion, patch }');
    }

    const migrated = applyFxParamPatch(stored.patch,
    {
      schemaVersion: stored.schemaVersion,
      strict: true,
    });
    if (!migrated.committed)
    {
      console.error('FX patch rejected', migrated.rejected);
      return null;
    }

    const record =
    {
      schemaVersion: migrated.schemaVersion,
      patch: Object.fromEntries(
        migrated.applied.map(({ path, value }) => [path, value]),
      ),
    };
    storage.setItem(key, JSON.stringify(record));
    return record;
  }
  catch (error)
  {
    // Invalid JSON or unavailable storage must not overwrite the saved record.
    console.error('FX settings could not be restored', error);
    return null;
  }
}
```

In a browser, call `const restored = migrateStoredFx();`; when it returns a record, apply `fx.setFxParams(restored.patch, { schemaVersion: restored.schemaVersion, strict: true, reset: true })` to the instance.

The package-level `applyFxParamPatch()` uses the game defaults as its private validation baseline and accepts only `schemaVersion` and `strict`. It neither mutates an instance nor exposes the complete Unity configuration tree. Here, `committed` means that the candidate patch is safe to persist; only instance-level `setFxParams()` installs configuration into the current renderer. Mode resets remain an instance-level operation through `reset: true`.

The result contains `applied`, `normalized`, `rejected`, `committed`, and `schemaVersion`. `applied` contains the accepted final paths and values; `normalized` records renames, default restoration, numeric clamping, and Boolean coercion; `rejected` gives the path, original value, and reason; `committed` says whether the candidate configuration was actually installed. The default `strict: false` commits valid entries and reports rejected ones. With `strict: true`, one rejected entry rolls back the entire batch and `applied` is empty. `reset: true` first restores the Unity baseline and then applies the same patch; even an empty patch commits the reset. `setFxParam()` reuses this validation with strict single-entry semantics.

## Theme Colours

Theme colours update only the current instance; the library does not automatically write them to browser storage. To restore them after a refresh, the host must save `themeColor` and `themeColorMode`, read them back, and apply them through the constructor or `updateConfig()`.

`themeColor` and `themeColorMode` are both instance configuration state. They can be supplied to the constructor or `updateConfig()`; `setThemeColor()` and `setThemeColorMode()` use the same normalisation path; and `getConfig()` returns their current values. Only six-digit hexadecimal colours are accepted. An empty string or invalid colour restores the exported `DEFAULT_THEME_COLOR` (`#4ca7ff`). An invalid mode is rejected: `setThemeColorMode()` returns `false` and leaves the current mode unchanged. Neither setting mutates the Unity parameter baseline in `UNITY_FX_TOUCH` or `FX_PARAM_SCHEMA`.

The public library exports `DEFAULT_THEME_COLOR_MODE` as `relative-oklch`, applying a complete relative OKLCH mapping to the theme colour. Hosts that need the previous hue-only behaviour must explicitly pass `themeColorMode: 'hue-only'`; the demo uses the new default whenever no explicit mode is persisted.

`relative-oklch` uses the default game blue `#4ca7ff` as its reference and maps the theme colour's relative OKLCH hue, chroma, and perceptual-lightness changes onto the original Unity colours. Lightness adjusts linear-RGB HDR emission energy before Bloom prefiltering, so a darker theme naturally emits less energy above the Bloom threshold instead of dimming an already-generated halo in the Final Pass. For a transparent overlay transported with `source-over` against an unknown background, the engine separately limits Coverage Alpha by the target colour's peak sRGB channel so that dark themes cannot become solid occluding shapes; this limit does not scale Scene, Screen/Plus-lighter, or HDR emission energy. The default game blue must remain an identity mapping and preserve the default Unity pixels. A pure-black theme has zero emissive energy and creates no black mask or residual halo in an unknown-background transparent overlay. A known Scene still preserves the Unity material's original alpha-blending semantics.

## Shard Roundness

`setTriangleRoundness(value)` is a convenience API for `setFxParam('shards.roundness', value)`. The default `0` preserves the current triangle atlas exactly; values from `0..1` continuously trim its corners with arcs tangent to the original straight sides and remap the texture so no sharp inner triangle remains; `1` turns every click and trail triangle shard into a same-size circle. Runtime changes affect existing particles on the next frame. Finite out-of-range values are clamped to `0..1` by the Schema, while non-finite values are rejected.

```js
fx.setTriangleRoundness(0.5);
fx.setFxParam('shards.roundness', 0.5);
```

## Click Glow

Click glow can be tuned independently from the trail. This scale changes only
the ring and center-disk Bloom emission; Native Glow uses the
same scale through a monotonic bounded-alpha mapping:

```js
fx.setFxParam('bloom.clickEmissionScale', 1.25);
```

## Common Tunable FX Parameters (see FX_PARAM_SCHEMA for the complete list)

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
