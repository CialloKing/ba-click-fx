# Rendering and Compositing Guide

[Back to README](https://github.com/CialloKing/ba-click-fx/blob/main/README.en.md) · [简体中文](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md)

[API reference](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md) · [Rendering and compositing](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md) · [Worker integration](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.en.md)

## Web Integration Configuration

Most ordinary web pages cannot reliably read and upload the real pixels beneath the effect on every frame. Layered CSS backgrounds, scrolling content, animation, video, cross-origin images, and browser security rules all make a live background reference unavailable. When the host cannot provide an opaque `setCompositingReference()` image that matches the effect position pixel for pixel, use this combination for web integration:

| Demo option | API configuration | Purpose |
|---|---|---|
| Output Compositing: **Transparent Overlay** | `outputCompositing: 'browser-overlay'` | Emits an independent alpha-bearing overlay for the web host to composite once |
| Effect Reference: **Unknown Transparent Background (Compatibility)** | Omit the reference, or call `setCompositingReference(null)` | Does not assume that the library can read the page background |
| Host Compositing: **DOM Add (Approximate)** | `hostCompositing: 'screen'` | Recommended default for unknown mid-tone, light, or changing backdrops; the increment contracts over light content |
| Host Compositing: **Plus-lighter (Original Additive)** | `hostCompositing: 'plus-lighter'` | Suited to black, dark, or controlled hosts; preserves more aggressive additive output but saturates early over light content |

The host surface determines where the final blend occurs:

| Host surface | API configuration | Compositing boundary |
|---|---|---|
| DOM backdrop (default) | `hostCompositingSurface: 'dom-backdrop'` | A library-owned overlay can let the DOM apply `screen` / `plus-lighter` |
| Transparent window | `hostCompositingSurface: 'transparent-window'` | CSS blending cannot cross the operating-system window boundary; unknown-background independent blending resolves to `source-over` |
| Native compositor | `hostCompositingSurface: 'native'` | An external WebView/native compositor performs the final blend; the host still owns external Canvas styles |

With `browser-overlay`, an unknown background, and a requested `screen` or `plus-lighter`, a transparent window reports `resolvedHostCompositing: 'source-over'` through `getConfig()` and sets `compositingWarning` to `screen-requires-visible-backdrop` or `plus-lighter-requires-visible-backdrop`. A compositing reference restores `source-over` only when the current output path actually uses it, preventing a second blend. A `true` result from `setCompositingReference()` means the reference was accepted, not that the current path already uses it; inspect `getEffectiveHostCompositing()` or `getConfig().resolvedHostCompositing` for the effective host blend.

This is the recommended combination; library defaults remain `scene + source-over`.

Minimal example (`screen` and `plus-lighter` are alternatives chosen by the page backdrop):

```js
const fx = new BAClickFX(
{
  outputCompositing: 'browser-overlay',
  hostCompositing: 'screen', // DOM Add (Approximate); use 'plus-lighter' for dark hosts
  hostCompositingSurface: 'dom-backdrop',
});

fx.setCompositingReference(null);
```

This path is an SDR visual approximation at the browser/DOM boundary, not a pixel-equivalent reproduction of Unity's linear HDR Scene. Use the default `scene` path only when a live, pixel-matched background reference is available or the host performs the composite in a linear HDR render target.

## Backend Selection

`effectBackend` decides whether WebGPU or WebGL2 owns the complete crisp scene and Bloom. `webgpuPreferHdr` only controls whether the final WebGPU Canvas attempts Extended HDR; `false` forces Standard SDR. The Canvas 2D path then uses `bloomBackend` to select its Bloom implementation. The demo exposes six direct combinations:

| Demo choice | API configuration | Behaviour |
|---|---|---|
| WebGPU | `{ effectBackend: 'webgpu', webgpuPreferHdr: false, bloomBackend: 'webgl2' }` | Formal ordinary WebGPU mode. It configures only the browser-preferred Standard SDR Canvas and never requests `toneMapping: extended`, while retaining the Unity-aligned linear Scene and MXFinalBloom |
| WebGPU HDR (experimental) | `{ effectBackend: 'webgpu', webgpuPreferHdr: true, bloomBackend: 'webgl2' }` | Requests WebGPU asynchronously and prefers `rgba16float + toneMapping: extended`; if HDR Canvas configuration is unavailable it keeps WebGPU with standard SDR output, while an unavailable or lost device falls back to Full WebGL2 |
| Full WebGL2 | `{ effectBackend: 'webgl2', bloomBackend: 'webgl2' }` | Default; builds the complete Scene, Coverage, and MXFinalBloom output in one WebGL2 HDR pipeline; falls back to the Canvas 2D chain on failure |
| WebGL2 Bloom | `{ effectBackend: 'canvas2d', bloomBackend: 'webgl2' }` | Compatibility selector; when the GPU is available it reuses the same complete HDR Scene as Full WebGL2, then falls back to Canvas 2D with Native Glow on failure |
| Software Bloom | `{ effectBackend: 'canvas2d', bloomBackend: 'software' }` | Compatibility implementation using an 8-bit Canvas mask, pixel readback, and full-viewport Float32 Bloom buffers |
| Native Glow | `{ effectBackend: 'canvas2d', bloomBackend: 'native' }` | Approximates click Bloom with Canvas 2D multi-scale halos and blurs trails locally; no canvas readback, with remaining differences from full GPU post-processing |

The demo exposes Isolated Compositing as a separate switch beside the six rendering choices. It is disabled by default and orthogonal to the rendering backend: it changes only the final CSS compositing boundary for the canvases, not Bloom thresholds, filtering, colour calculations, or Bloom compute cost.

### Native Glow

Native click glow estimates emission from the shared materials, Circle texture, and dissolved rings. It applies Threshold, Soft Knee, Clamp, and exposure before approximating multiple scales from the viewport, DPR, and Diffusion. Ring energy is estimated from its radius and width, then spread isotropically in the radial direction; the current implementation does not apply an angular mask to visible arcs. Halos are added separately without redrawing the disk; native `opacity` is applied afterward to avoid abrupt disappearance at partial opacity. With a known background, the Canvas Final Pass uses a separate half-resolution sRGB halo buffer to reduce dark banding. Source area, ring convolution, and radial diffusion remain approximations, so fragmented arcs, overlapping clicks, and HDR highlights are not pixel-equivalent to WebGPU/WebGL2.

### WebGPU and HDR

WebGPU availability does not imply HDR display output. Only `getConfig().resolvedWebGPUOutputMode === 'extended'` means that the Canvas negotiated extended dynamic range, encodes the linear HDR result as extended sRGB, and preserves highlights above SDR white. `'standard'` means the WebGPU Scene and Bloom are running but the final Canvas remains SDR, `'pending'` means device or first-frame work is in progress, and `'unavailable'` means no WebGPU output is active. Visible super-white highlights additionally require an HDR display, system HDR enabled, browser support for WebGPU HDR Canvas, and successful `rgba16float + toneMapping: extended` configuration.

Setting `webgpuPreferHdr: false` skips Extended configuration on every browser and uses the browser-preferred Standard SDR Canvas directly; this is the fixed contract of the demo's ordinary “WebGPU” mode. The internal `rgba16float` Scene remains necessary to retain emission energy before prefiltering and preserve Unity MXFinalBloom precision. It is not HDR display output; `resolvedWebGPUOutputMode` remains the only output verdict.

Below the HDR summary, the demo provides a collapsed WebGPU Diagnostics section. It reports the secure context, WebGPU API, Canvas context, adapter, device, Extended Canvas, Standard SDR, first-frame pipeline, graphics/video dynamic range, and CSS HDR syntax support, while retaining stable failure-stage codes and browser exception text. `(video-dynamic-range: high)` is only a video-output environment hint and does not participate in the WebGPU HDR success verdict. `CSS.supports()` likewise proves only that the browser accepts the relevant syntax, not that the current display is producing HDR output. A webpage cannot reliably read the operating-system HDR switch or display luminance in nits; the final browser-side criterion remains `resolvedWebGPUOutputMode === 'extended'`.

The demo's UI HDR controls are demo-only. In addition to an effect that actually resolves to WebGPU Extended, the browser must support extended `color(srgb-linear ...)` values and `dynamic-range-limit: no-limit`; otherwise the controls are disabled. The demo applies CSS HDR outlines and glows directly to the title, status area, panel edges, and interactive controls, without creating a second full-screen Canvas or using `mix-blend-mode`. The `1..16` UI HDR Brightness multiplier is not part of the `BAClickFX` public API and does not change `webgpuHdrBrightness`, Unity FX parameters, or click-effect pixels.

`webgpuHdrPeak`, `webgpuHdrBrightness`, `webgpuHdrColorPreservation`, `webgpuHdrWhiteCore`, `webgpuHdrWhiteStart`, and `webgpuHdrWhiteEnd` calibrate only the final HDR presentation mapping of a WebGPU Extended Canvas. WebGPU Standard, WebGL2, and Canvas 2D output are unaffected, and these options do not change Unity FX parameters, particle counts, geometry, or the Bloom algorithm. `webgpuHdrBrightness` is a linear multiplier in the `0..32` range. When a matching compositing reference is present, it amplifies only the effect increment above that background and does not brighten the reference itself. High values let advanced users target more display highlight headroom, but the browser, operating system, or display may clip, compress, or tone-map them, so the value is not a fixed nit target.

`webgpuHdrColorPreservation` controls how strongly the highlight increment is restored towards the original linear RGB chromatic direction. Its range is `0..1`; the default `0` preserves the existing gradual white-core presentation. At `1`, the HDR shoulder still determines the peak, while high brightness multipliers no longer amplify white-core colour drift introduced by the renderer. The demo's Preserve Original Hue preset sets this option to `1` and `webgpuHdrWhiteCore` to `0`. This removes renderer-induced whitening, but it cannot prevent the browser, operating system, or display from reducing saturation when the requested output exceeds its actual HDR colour volume.

### Backend Fallback and Status

Explicit `effectBackend: 'webgpu'` and `'auto'` both resolve the complete-effect backend in WebGPU → WebGL2 → Canvas 2D order. The default remains the stable `'webgl2'`, so upgrading does not silently switch existing pages to WebGPU.

`bloomBackend: 'auto'` and the default `'webgl2'` try the GPU first, then fall directly back to Native Glow without enabling Software Bloom. Software Bloom requires an explicit `'software'` request and falls back to Native Glow if pixel readback is unavailable. A successful complete GPU Scene computes Bloom on that backend; `bloomBackend` selects Bloom for the Canvas 2D path.

To preserve the already reviewed colour, transparency, and edge sampling, a successful WebGL2 Bloom frame intentionally reuses the complete `WebGL2EffectRenderer` Scene instead of uploading an 8-bit Canvas Scene. It therefore uses the same shaders and pixel pipeline as Full WebGL2 and does not pre-rasterise a Canvas that will be hidden. The distinction is the compatibility contract: WebGL2 Bloom retains the `effectBackend: 'canvas2d'` request and its Native fallback chain, while Full WebGL2 is owned directly by the complete-effect backend.

## Output and Host Compositing

`outputCompositing: 'scene'` is the default and preserves Unity's direct additive RGB semantics for a Scene render target. The demo and integrations that require strict game reproduction should use it together with a `setCompositingReference()` image that pixel-matches the displayed background; this is the contract under which the complete GPU paths evaluate Scene RGB precisely. `'browser-overlay'` serves ordinary web overlays and transparent desktop hosts such as BASpark, WebView2, and Electron. HDR emission and Bloom energy remain independent, while final alpha is no longer inferred from the largest final RGB channel.

The following options define transparent output over an unknown background. Alpha allocation and colour compensation never switch one another implicitly:

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

`hostCompositingSurface` resolves the actual host contract together with the output mode and compositing reference. `getConfig()` reports the caller's `requestedHostCompositing`, the effective `resolvedHostCompositing`, `hostCompositingSurface`, and `compositingWarning`; `getEffectiveHostCompositing()` returns only the effective mode. The main Canvas dispatches `HOST_COMPOSITING_CHANGE_EVENT` (event name `baclickfxhostcompositingchange`) when this state changes.

Both `screen` and `plus-lighter` are SDR DOM-compositing approximations and vary with browser colour management and implementation details. Unity composites the backdrop and effect together in linear HDR before one final encoding step. An unknown desktop is outside the overlay process, so no single transparent payload can be pixel-equivalent over every backdrop. `screen` preserves the full payload over black and automatically reduces its increment towards white; it is used by the demo's “DOM Add (Approximate)” option and is recommended for unknown mid-tone or light backdrops. `plus-lighter` remains available for known black or dark hosts, but directly adds the sRGB payload and saturates early over light content.

For a library-owned overlay, the selected host blend is applied once to the complete layer group. With a caller-owned `<canvas>`, the library emits the independent full payload without modifying `mix-blend-mode`; CSS, WebView, or native host compositing remains the caller's responsibility. Strict agreement with Unity requires a matching compositing reference so the complete WebGPU/WebGL2 backend can evaluate the linear HDR Scene, or a host that performs the final composite in a linear HDR render target. When the current output path actually uses the reference, it restores a normal `source-over` output and prevents a second host blend. Merely retaining an accepted source without using it in the current path does not disable the host blend.

The [DOM Add light-background overexposure postmortem](https://github.com/CialloKing/ba-click-fx/blob/main/docs/dom-add-light-background-regression.md) (Chinese) records the root cause and host-selection contract. Use `screen` for unknown mid-tone or light backdrops, use `plus-lighter` only after confirming a black or dark host, and do not lower Bloom intensity to hide a host-compositing error.

`isolatedCompositing` defaults to `false`, so canvases mount directly into the target or page. With `true`, the library-owned main FX canvas, WebGPU/WebGL2 canvases, and light-background compatibility canvas resolve inside one transparent isolated group before that group is composited over the page. This prevents the browser from resolving compatibility layers independently against pure white and losing cyan-blue contrast. The default `source-over` contract does not blend again at the outer boundary; an explicitly selected independent full-payload contract applies its chosen `screen` or `plus-lighter` blend once to the complete group. Isolated compositing is a non-game web compatibility option and can be changed at runtime through `updateConfig()`.

When `target` is an existing `HTMLCanvasElement`, the library cannot safely insert the additional DOM layers required for the complete effect, Bloom, contrast, and isolation. Full Effect `'webgpu'` / `'webgl2'` / `'auto'` therefore falls back to `canvas2d`, Bloom `'webgl2'` / `'auto'` falls back to Native Glow, and `isolatedCompositing` is forced to `false`. In `getConfig()`, `effectBackend` / `bloomBackend` retain the requested values; read `resolvedEffectBackend` / `resolvedBloomBackend` for the actual backends. A directly supplied `OffscreenCanvas` is an intentionally supported exception: Full WebGL2 can own that surface directly, as can an explicit `'canvas2d'` path, but WebGPU, isolated compositing, and other features that require a DOM/CSS layer tree are unavailable. The caller always owns external Canvas CSS and final host compositing. The default fullscreen overlay has no `HTMLCanvasElement` limitation. A regular container is also supported, but it must establish its own positioning context, normally with `position: relative`.

Each `BAClickFX` instance owns a separate isolation group. Multiple isolated instances on the same page do not mix their internal compatibility layers across group boundaries, and switching or destroying one instance does not move or remove another instance's canvases.

When keeping `scene` output on a pure-white page, isolated compositing is an optional compatibility path. If `outputCompositing: 'scene'` still needs an extra crisp silhouette, opt into the light-background compatibility layer as well:

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
  hostCompositingSurface: 'transparent-window',
  lightBackgroundContrastAlpha: 0,
});
```

For a transparent occlusion appearance closer to v1.2.15, change `overlayAlphaPolicy` to `'visual-max'`. This only changes alpha allocation between independent Coverage and Bloom transport quantities; it never generates alpha from `maxRGB`. When visibility of high-energy cores matters over an unknown light desktop, independently change `overlayColorCompensation` to `'bright-core'` without changing the alpha policy. A DOM host that must not darken an unknown light backdrop can instead select `hostCompositing: 'screen'`; reserve the more aggressive `'plus-lighter'` mode for known black or dark backdrops. Both ignore the alpha policy, colour compensation, and alpha limit and remain SDR approximations.

These compatibility controls have separate responsibilities. `isolatedCompositing` only decides whether library-owned canvases first resolve inside one transparent group; it does not sample page or desktop pixels. `lightBackgroundContrastAlpha` adds a non-game `darken` silhouette only for `scene` output and is ignored by `browser-overlay`. Only `setCompositingReference()` supplies a known opaque raster reference to the rendering pipeline. None of these controls replaces another.

## Compositing Reference and Linear Compositing

`setCompositingReference()` supplies the renderer with a real opaque raster reference that pixel-matches the content beneath the effect; it does not set or modify the host page's CSS background. `scene + setCompositingReference()` is the precise known-background path. Strict final-RGB Scene equivalence may only be claimed when WebGPU, Full WebGL2, or WebGL2 Bloom successfully resolved to the GPU receives that known reference. Native Glow uses a Canvas Final Pass; Software Bloom continues to use the normal DOM-background path. Those capability-limited fallback paths must not be treated as pixel-equivalent to the complete GPU Scene or Unity.

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
| Canvas compatibility texture | Software Bloom and Native Glow use a compact 2D LUT approximation of longitudinal brightness, transverse feathering, and non-zero edges to avoid costly software triangle texture rasterisation |
| Bloom | Ring, disk, trail, and triangle-shard HDR emission is processed by the selected Bloom backend |

Full WebGL2 and a WebGL2 Bloom frame that resolves successfully to the GPU use the same complete texture batch: a regular segment submits only two textured triangles, corner inserts retain the corner U, and the single-triangle cap tip stays at `V=0.5`. The complete RGB texture preserves per-channel and top/bottom-asymmetric detail that cannot be represented by a symmetric scalar profile. Capability-limited Canvas paths preserve parameters, geometry, lifetime, and overall energy relationships, but do not claim per-texture-pixel equivalence.

Shards scatter along the trail at distance intervals.

### Bloom Rendering Backends

The WebGPU backend uses its own WGSL Scene, `rgba16float` emission targets, and multi-level Bloom pyramid while reusing the reviewed CPU particle mesh builders from WebGL2. It creates no WebGL context and uploads no Canvas 2D intermediate. Scene rendering, prefiltering, downsampling, cumulative upsampling, and the Final Pass are submitted entirely through WebGPU. In `extended` mode the Final Pass encodes linear RGB as extended sRGB without clipping super-white values; `standard` uses the same encoding limited to SDR along with the existing transparency contract.

Full WebGL2 and WebGL2 Bloom share `WebGL2EffectRenderer`, HDR emission parameters, and Bloom settings, and build ring, disk, trail, and shard geometry on the GPU. Successful frames output the crisp Scene, Coverage, and Bloom in one Final Pass; WebGL2 Bloom still retains its separate compatibility fallback chain without building or uploading a hidden 8-bit Canvas Scene.

Bloom thresholding, exposure conversion, mip construction, and cumulative upsampling follow the Unity `Hidden/MXFinalBloom` contract. Before changing that math or any pixel baseline, read the [Bloom Intensity 13.6x overexposure regression postmortem](https://github.com/CialloKing/ba-click-fx/blob/main/docs/bloom-intensity-regression.md) (Chinese) and the [Bloom upsample texture-order regression postmortem](https://github.com/CialloKing/ba-click-fx/blob/main/docs/bloom-upsample-order-regression.md) (Chinese).

WebGPU availability is determined by actually requesting an adapter and device, creating a `webgpu` Canvas context, and building the resource pipelines. HDR output is decided separately by whether `rgba16float + toneMapping: extended` succeeds in `configure()`. WebGL2 availability still requires a context, `EXT_color_buffer_float`, and a valid `RGBA16F` framebuffer. Full Effect state uses `effectBackend` / `resolvedEffectBackend`, WebGPU output uses `resolvedWebGPUOutputMode`, and Bloom uses `bloomBackend` / `resolvedBloomBackend`; asynchronous probing, first-frame submission, and recovery validation briefly report `pending`. Device or context loss immediately removes the old GPU Canvas, and the next backend takes ownership only after its complete resource chain succeeds.

### JavaScript Software Bloom

Only when `bloomBackend: 'software'` is selected explicitly, the renderer draws HDR emission into a full-viewport mask and uses reusable Float32 mip buffers to approximate the main MXFinalBloom structure in JavaScript. If Canvas pixel readback/writeback is unavailable, rings and disks fall back to native multi-scale halos, while trail emission is blurred in a local offscreen buffer. This path preserves parameters, geometry, lifetime, and overall energy relationships, but its 8-bit Canvas input and premultiplied-alpha transport prevent a claim of pixel equivalence with the complete GPU Scene. Its threshold, exposure, and upsample contract is maintained in the Bloom postmortems above.

The default `isolatedCompositing: false` composites output layers directly against the DOM background; Unity's additive output necessarily loses colour and contrast on pure white. With `true`, the output layers first resolve inside a transparent group, then composite their coloured result and alpha over the page. This does not change the Bloom algorithm and exists only as a non-game compatibility path for pure-white web backgrounds. Use `setCompositingReference()` when the background must participate in the same linear Scene as it does in the game; isolation is not a substitute for background sampling.

`lightBackgroundContrastAlpha` defaults to `0`, so no visible silhouette outside the game resource is added. Setting it to `0.35` gives a library-owned overlay an independent pale-cyan `darken` mask above the main FX layer. The mask neither receives nor generates Bloom and exists only to recover a crisp silhouette on pure white. It and isolated compositing are both non-game web compatibility options. An existing Canvas supplied as the target can receive neither this separate backdrop-compositing layer nor isolated compositing.

### Backend Capability Boundaries

| Path | Capability boundary |
|---|---|
| WebGPU Extended HDR | When `rgba16float + toneMapping: extended` succeeds, Scene, Coverage, and MXFinalBloom stay in a linear floating-point pipeline and the final Canvas can submit highlights above SDR white |
| WebGPU Standard | The WebGPU Scene and Bloom still run in floating point, but the final Canvas uses the browser's preferred standard format and maps to SDR; this is not real HDR output |
| Full WebGL2 | Default selector; keeps geometry, Coverage, the HDR Scene, and MXFinalBloom in one floating-point pipeline when a matching background is supplied |
| WebGL2 Bloom | On GPU success, reuses the same complete floating-point Scene as Full WebGL2; the difference is its Canvas 2D request state and Native failure-fallback contract |
| Software Bloom | The Bloom pyramid uses Float32 buffers, but its input comes from an 8-bit Canvas; a transparent overlay can only approximate Bloom with residual Coverage and cannot preserve arbitrary HDR RGB independently |
| Native Glow | Samples material emission and dissolved geometry, then approximates multiple scales with the same threshold and exposure rules; lacks a complete `RGBA16F` Scene and per-pixel cumulative upsampling |

Consequently, “ported from the Unity project” describes the source of parameter values, texture sampling, curves, blend intent, and the known-Scene complete GPU implementations. It does not mean every browser backend, arbitrary web background, or transparent desktop composition can be pixel-identical to an in-game screenshot. Fallbacks prioritise lifecycle, geometry relationships, monotonic Coverage, and availability without pretending that missing HDR Scene or display capabilities exist.

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
│   ├── webgl2-canvas-scene.js # Canvas Scene Final Pass for Native
│   ├── webgl2-bloom.js   # WebGL2 Bloom reference and regression baseline
│   └── style.css         # Demo page styles
├── scripts/
│   ├── build.mjs         # Build script
│   └── verify-*.mjs/cjs  # Release verification
├── test/
│   ├── smoke.js          # dist runtime wiring and lifecycle verification
│   ├── source-contract.js # source entry and Unity resource contracts
│   └── browser/          # core, lifecycle, Demo, and Unity browser gates
├── index.html            # Demo page
├── dist/                 # Build output (ESM)
└── package.json
```

### Architecture

- **Isolated compositing layer:** disabled by default; enable the transparent isolated group explicitly to preserve colour on non-game pure-white web backgrounds.
- **WebGPU Scene:** asynchronously requests a device and uses an `rgba16float` linear Scene with WGSL Bloom; ordinary mode stays on Standard SDR, while HDR mode preserves real super-white highlights only after successful `extended` output and falls back to WebGL2 on device failure.
- **Full WebGL2 Scene:** complete geometry, Coverage, background, and MXFinalBloom resolve through one HDR pipeline and one output pass.
- **Canvas Scene Final Pass:** Native Glow reuses a Canvas-built Scene approximation; with a supplied background it shares background attenuation and colour encoding, without claiming complete-WebGL2 floating-point precision.
- **Main FX layer:** Canvas paths accumulate emission with `lighter` internally and use premultiplied-alpha overlay output to avoid a second CSS brightness increase.
- **Light-background compatibility layer:** defaults to zero strength; set it explicitly to 0.35 to add a non-Bloom `darken` canvas for visibility on pure white.
- **Software Bloom:** full-viewport working canvases plus a Float32 MXFinalBloom pyramid, with native multi-scale halos when pixel readback is unavailable.
- **WebGL2 Bloom:** on GPU success the compatibility selector reuses the complete WebGL2 Scene without redundantly rasterising a hidden Canvas; insufficient capabilities fall directly back to Native Glow.
- **Resource lifecycle:** WebGPU device or WebGL context loss falls back immediately; mode changes release full-size frame targets while retaining reusable static GPU resources.
- **On-demand rendering:** `requestAnimationFrame` stops when no effects are active.
- **Zero external dependencies:** browser-native Canvas 2D / WebGL2 / WebGPU APIs only; no third-party runtime.
