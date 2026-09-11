# Worker and OffscreenCanvas Integration

[Back to README](https://github.com/CialloKing/ba-click-fx/blob/main/README.en.md) · [简体中文](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.md)

[API reference](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md) · [Rendering and compositing](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md) · [Worker integration](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.en.md)

## Host Protocol and Complete Example

`BAClickFX` can receive an `OffscreenCanvas` directly inside a Dedicated Worker, but it does not create the Worker, transfer the Canvas, proxy DOM input, or manage the Worker lifecycle. Those responsibilities remain with the host so the application protocol and bundling strategy do not become library policy. The following is a minimal host-owned protocol.

Worker means a browser `DedicatedWorker` here, not Node.js `worker_threads`. Node.js 24 is only the development and CI toolchain for this project; browser Worker support depends on the available `Worker`, module-script, `OffscreenCanvas`, and selected Canvas-context implementations.

The main thread reads the real Canvas geometry, converts DOM coordinates into Canvas-local CSS pixels, and forwards size, DPR, and pointer lifecycle changes:

This complete example uses a Canvas with an explicit CSS size. `touch-action: none` gives the effect control of gestures inside that Canvas; change it if the host needs native scrolling. Bundle both modules with Vite or an equivalent bundler so the Worker package import resolves. The bare package specifier does not work in an unbundled browser Worker; in that case use the absolute ESM URL `https://cdn.jsdelivr.net/npm/ba-click-fx@1.3.3/dist/worker.js`.

```html
<canvas id="fx"></canvas>
<style>
  #fx { display: block; width: 100%; height: 320px; touch-action: none; }
</style>
<script type="module" src="./main.js"></script>
```

```js
// main.js — bundle this module and fx-worker.js with Vite or an equivalent bundler.
export function mountWorkerFX(canvas)
{
  const worker = new Worker(new URL('./fx-worker.js', import.meta.url),
  {
    type: 'module',
  });
  const input = new AbortController();
  let stopped = false;
  let resolveDestroyed;
  const destroyed = new Promise((resolve) => { resolveDestroyed = resolve; });

  function post(type, payload = {})
  {
    if (!stopped)
    {
      worker.postMessage({ type, payload });
    }
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

  const resizeObserver = new ResizeObserver(() => post('resize', getViewport()));

  function stopInput()
  {
    stopped = true;
    input.abort();
    resizeObserver.disconnect();
  }

  function finish()
  {
    stopInput();
    worker.removeEventListener('message', onMessage);
    worker.removeEventListener('error', onError);
    worker.removeEventListener('messageerror', onError);
    worker.terminate();
    resolveDestroyed();
  }

  function onMessage(event)
  {
    if (event.data.type === 'destroyed')
    {
      finish();
    }
    else if (event.data.type === 'error')
    {
      console.error(event.data.message);
      finish();
    }
  }

  function onError(event)
  {
    console.error('FX Worker failed', event);
    finish();
  }

  worker.addEventListener('message', onMessage);
  worker.addEventListener('error', onError);
  worker.addEventListener('messageerror', onError);

  try
  {
    const offscreen = canvas.transferControlToOffscreen();
    worker.postMessage(
      { type: 'init', payload: { canvas: offscreen, ...getViewport() } },
      [offscreen],
    );
  }
  catch (error)
  {
    finish();
    throw error;
  }

  resizeObserver.observe(canvas);
  const options = { signal: input.signal };
  window.addEventListener('resize', () => post('resize', getViewport()), options);
  canvas.addEventListener('pointerdown', (event) =>
  {
    if (event.isPrimary && event.button === 0)
    {
      post('pointerDown', getPointer(event));
    }
  }, options);
  window.addEventListener('pointermove', (event) =>
    post('pointerMove', getPointer(event)), options);
  window.addEventListener('pointerup', (event) =>
    post('pointerUp', { pointerId: event.pointerId }), options);
  window.addEventListener('pointercancel', (event) =>
    post('pointerCancel', { pointerId: event.pointerId }), options);
  window.addEventListener('blur', () => post('pointerCancel'), options);

  return {
    boom: (x, y) => post('boom', { x, y }),
    updateConfig: (patch) => post('updateConfig', patch),
    setPaused: (paused, clear = false) =>
      post('setPaused', { paused, options: { clear } }),
    resize: () => post('resize', getViewport()),
    destroy()
    {
      if (!stopped)
      {
        // Stop producers first, but keep the acknowledgement listener alive.
        stopInput();
        worker.postMessage({ type: 'destroy', payload: {} });
      }
      return destroyed;
    },
  };
}

export const fx = mountWorkerFX(document.querySelector('#fx'));
// On unmount: await fx.destroy(); use a new Canvas for the next mount.
```

The Worker uses the dedicated package entry and accepts only the explicit host protocol:

```js
// fx-worker.js
import { BAClickFX } from 'ba-click-fx/worker';

let fx = null;

self.addEventListener('message', (event) =>
{
  const { type, payload = {} } = event.data;

  try
  {
    if (type === 'init')
    {
      fx = new BAClickFX(
      {
        target: payload.canvas,
        inputSource: 'manual',
        effectBackend: 'webgl2',
        maxDpr: 2,
      });
      fx.resize(payload.width, payload.height, payload.dpr);
      return;
    }
    if (type === 'destroy')
    {
      fx?.destroy();
      fx = null;
      self.postMessage({ type: 'destroyed' });
      return;
    }
    if (!fx)
    {
      return;
    }
    switch (type)
    {
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
    }
  }
  catch (error)
  {
    fx?.destroy();
    fx = null;
    self.postMessage({ type: 'error', message: String(error) });
  }
});
```

Call `await fx.destroy()` during unmount. It stops input and resize forwarding immediately, waits for the Worker to release the instance, then terminates the Worker. Repeated calls share the same completion promise; Worker errors also clean up host listeners. Remount with a new Canvas because an already transferred Canvas cannot be transferred again. `fx.resize()` explicitly resends dimensions and DPR when the host detects an additional display change.

The width and height passed to `resize(width, height, dpr)`, as well as manual input coordinates, are Canvas-local CSS pixels. The library scales the backing store by `dpr`, still capped by `maxDpr`. An `OffscreenCanvas` has no DOM layout information, so a Worker cannot discover CSS resize or device-DPR changes automatically.

A Canvas context type is locked by its first `getContext()` call. Choose `effectBackend: 'webgl2'` (recommended) or explicit `'canvas2d'` when constructing a direct Offscreen instance; do not switch between those context types later through `updateConfig()`. Destroy the instance and transfer a new Canvas when such a switch is required. WebGPU, DOM multi-layer compositing, and automatic input proxying are outside the current Worker contract.
