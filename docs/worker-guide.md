# Worker 与 OffscreenCanvas 接入

[返回 README](https://github.com/CialloKing/ba-click-fx/blob/main/README.md) · [English](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.en.md)

[API 参考](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md) · [渲染与合成](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md) · [Worker 接入](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.md)

## 宿主协议与完整示例

`BAClickFX` 可以在 Dedicated Worker 中直接接收 `OffscreenCanvas`，但库不会创建 Worker、转移 Canvas、代理 DOM 输入或管理 Worker 生命周期。这些职责留给宿主，可以避免把应用协议和打包策略固化进库。下面是一个最小的宿主协议。

这里的 Worker 专指浏览器 `DedicatedWorker`，不是 Node.js `worker_threads`。Node.js 24 仅是本项目的开发与 CI 工具链；浏览器端 Worker 是否可用取决于 `Worker`、模块脚本、`OffscreenCanvas` 和所选 Canvas Context 的实现。

主线程负责读取真实 Canvas 几何、把 DOM 坐标转换为 Canvas 局部 CSS 像素，并转发尺寸、DPR 和指针生命周期：

完整示例使用显式 CSS 尺寸的 Canvas。`touch-action: none` 让该画布内的手势交给特效处理；需要原生滚动时应调整此值。两个模块需通过 Vite 等 bundler 构建，以解析 Worker 中的包导入。直接使用浏览器原生模块时，Worker 内不能保留裸包名，应改用绝对 ESM 地址 `https://cdn.jsdelivr.net/npm/ba-click-fx@1.3.3/dist/worker.js`。

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

Worker 使用专用包入口，并仅处理宿主显式转发的协议：

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

卸载时调用 `await fx.destroy()`：先停止输入和尺寸转发，等待 Worker 释放实例的确认，再终止 Worker。重复调用复用同一个完成 Promise，Worker 异常也会清理宿主监听。重新挂载必须使用新 Canvas，因为已转移的画布不能再次转移；宿主检测到额外的显示环境变化时，可调用 `fx.resize()` 重新发送尺寸和 DPR。

`resize(width, height, dpr)` 的宽高与 manual 输入坐标都使用 Canvas 局部 CSS 像素；库再按 `dpr` 调整实际 backing store，且 DPR 仍受 `maxDpr` 限制。`OffscreenCanvas` 没有 DOM 布局信息，因此 Worker 中不会自动获知 CSS resize 或设备 DPR 变化。

Canvas 的上下文类型会被第一次 `getContext()` 锁定。直接 Offscreen 路径应在构造时固定为 `effectBackend: 'webgl2'`（推荐）或显式 `'canvas2d'`；不要再通过 `updateConfig()` 在两种上下文之间切换，需要切换时应销毁实例并转移一张新的 Canvas。当前 Worker 合同不包含 WebGPU、DOM 多图层合成或自动输入代理。
