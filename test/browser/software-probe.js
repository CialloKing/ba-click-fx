import { trackCanvasReadbacks } from '../../scripts/runtime-readback-diagnostics.mjs';

// 复用真实场景夹具；计数和故障注入只围绕待检查帧，截图不计入工作量。
export async function probeSoftwareReadbacks(fx, renderFrame, capture)
{
  const results = [];
  for (const name of ['normal', 'cleanup-failure', 'state-change', 'emission-failure'])
  {
    let stage = 'unclassified';
    let injected = false;
    const restores = [];
    const wrap = (object, method, callback) =>
    {
      const descriptor = Object.getOwnPropertyDescriptor(object, method);
      const original = object[method];
      object[method] = function (...args) { return callback(original.bind(this), args, this); };
      restores.push(() => descriptor ? Object.defineProperty(object, method, descriptor) : delete object[method]);
    };
    const inStage = (value, call) =>
    {
      const previous = stage;
      stage = value;
      try { return call(); } finally { stage = previous; }
    };
    wrap(fx, '_limitCanvasOverlayAlpha', (call, args) =>
    {
      const result = inStage(args[4] === false ? 'softwareCleanup' : 'frameFinalize', () => call(...args));
      if (name === 'state-change' && args[4] === false && !injected)
      {
        injected = true;
        fx.resize(fx.width, fx.height, fx.dpr);
      }
      return result;
    });
    wrap(fx.bloomRenderer, '_limitTransparentOverlayAlpha', (call, args) => inStage('regionAlpha', () => call(...args)));
    const classify = context => context === fx.bloomRenderer.sourceContext ? 'emission'
      : context === fx.bloomRenderer.coverageContext ? 'coverage'
      : context === fx.canvasBloomTransportContext ? 'bloomTransport'
      : context === fx.context ? 'finalFrame' : 'unclassified';
    const prototypes = new Set([fx.context, fx.bloomRenderer.sourceContext, fx.bloomRenderer.coverageContext,
      fx.canvasBloomTransportContext].filter(Boolean).map(context => Object.getPrototypeOf(context)));
    if (name === 'cleanup-failure') wrap(Object.getPrototypeOf(fx.context), 'getImageData', (call, args, context) =>
    {
      if (context === fx.context && stage === 'softwareCleanup' && !injected) { injected = true; throw Error('injected Alpha readback'); }
      return call(...args);
    });
    if (name === 'emission-failure') wrap(Object.getPrototypeOf(fx.bloomRenderer.sourceContext), 'getImageData', (call, args, context) =>
    {
      if (context === fx.bloomRenderer.sourceContext && !injected) { injected = true; throw Error('injected emission readback'); }
      return call(...args);
    });
    const trackers = [...prototypes].map(prototype => trackCanvasReadbacks(prototype,
      { classify, classifyStage: () => stage }));
    try { renderFrame(); }
    finally
    {
      for (const tracker of trackers) tracker.restore();
      for (const restore of restores.reverse()) restore();
    }
    const stats = structuredClone(trackers[0].stats);
    const add = (target, source) =>
    {
      for (const key of Object.keys(source))
        if (typeof source[key] === 'number') target[key] += source[key];
        else add(target[key], source[key]);
    };
    for (const tracker of trackers.slice(1)) add(stats, tracker.stats);
    results.push({ name, injected, hash: (await capture()).hash, reads: stats,
      resolvedBloomBackend: fx.getConfig().resolvedBloomBackend });
  }
  return results;
}

export function softwareResources(fx)
{
  const buffers = new Set();
  let canvasPixels = 0;
  let allocations = 0;
  for (const renderer of fx.bloomRenderers)
  {
    allocations += renderer.floatBufferAllocationCount;
    for (const value of [renderer.sourceLinear, renderer.sourceCoverage, renderer.sceneCoverageMip0,
      ...[...renderer.levelStorage, ...renderer.coverageLevelStorage].flatMap(level => [level.down, level.up, level.scratch])])
      buffers.add(value.buffer);
    for (const canvas of [renderer.sourceCanvas, renderer.outputCanvas, renderer.coverageCanvas])
      canvasPixels += (canvas?.width ?? 0) * (canvas?.height ?? 0);
  }
  return { floatBytes: [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0), canvasPixels, allocations,
    samplingBytes: fx.bloomRenderers.reduce((sum, renderer) => sum + renderer.samplingTables.reduce(
      (bytes, table) => bytes + (table?.x.byteLength ?? 0) + (table?.y.byteLength ?? 0), 0), 0),
    outputBytes: fx.bloomRenderers.reduce((sum, renderer) => sum + (renderer.outputImageData?.data.byteLength ?? 0), 0),
    auxiliaryPixels: [fx.canvasBloomTransportCanvas, fx.lastSoftwareBloomFrame?.canvas].reduce(
      (sum, canvas) => sum + (canvas?.width ?? 0) * (canvas?.height ?? 0), 0) };
}

export async function probeSoftwareCache(fx, renderFrame, capture, createInstance)
{
  const results = {};
  const timeout = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const timers = new Map();
  let clock = 0, nextId = 10;
  globalThis.setTimeout = (callback, delay) =>
  {
    const id = nextId++;
    timers.set(id, { callback, due: clock + delay, delay });
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  const advance = ms =>
  {
    clock += ms;
    for (const [id, timer] of [...timers])
      if (timer.due <= clock) { timers.delete(id); timer.callback(); }
  };
  const record = async name =>
  {
    results[name] = { ...softwareResources(fx), hash: (await capture()).hash,
      pendingTimers: timers.size, available: fx.bloomRenderer.available, visible: fx._hasVisibleEffects() };
  };
  try
  {
    const renderer = fx.bloomRenderer;
    for (const [name, width, height] of [['large', 1950, 1097], ['small', 65, 33]])
    {
      renderer.beginFrame(width, height, 0.5, { x: 0, y: 0, width, height }, 7, 1);
      renderer.beginCoverageFrame('browser-overlay'); renderer._ensureCoverageBuffers();
      results[name] = softwareResources(fx);
    }
    renderFrame();
    await record('active');
    renderFrame();
    await record('warm');
    fx.setPaused(true);
    advance(30000);
    await record('paused');
    fx.setPaused(false);
    renderFrame(10000);
    await record('idle');
    const firstTimer = timers.get(fx.softwareBloomIdleTimer);
    results.delay = firstTimer?.delay ?? null;
    advance(29999);
    await record('before-deadline');
    fx.boom(110, 105); renderFrame();
    // 已排队的旧回调在恢复交互后到达，也不能释放新帧资源。
    firstTimer?.callback();
    await record('resumed');
    renderFrame(10000);
    advance(30000);
    await record('released');
    fx.boom(110, 105); renderFrame();
    await record('rebuilt');
    fx.clear();
    await record('cleared');
    fx.bloomRenderer.available = false;
    fx.clear();
    results.failurePreserved = !fx.bloomRenderer.available;

    const doomed = createInstance();
    try
    {
      doomed.bloomRenderer.beginFrame(65, 33, 0.5, { x: 0, y: 0, width: 65, height: 33 }, 7, 1);
      doomed._renderFrame(performance.now());
      const pending = timers.get(doomed.softwareBloomIdleTimer);
      results.destroyPending = !!pending;
      doomed.destroy(); pending?.callback();
      results.destroyed = { ...softwareResources(doomed), pendingTimers: timers.size };
    }
    finally { doomed.destroy(); }
    return results;
  }
  finally
  {
    fx._cancelSoftwareBloomRelease?.();
    globalThis.setTimeout = timeout; globalThis.clearTimeout = clear;
  }
}

// 与验收分开，使用原生计时和默认 Canvas 路径；clear 后首帧展示回收的重建代价。
export function benchmarkSoftwareCache(fx, renderFrame, now)
{
  const firstFrames = [], warmFrames = [];
  const firstAllocations = [], warmAllocations = [];
  for (let round = 0; round < 7; round++)
  {
    fx.clear(); fx.boom(110, 105);
    const allocations = fx.bloomRenderer.floatBufferAllocationCount;
    const started = now(); renderFrame(); firstFrames.push(now() - started);
    firstAllocations.push(fx.bloomRenderer.floatBufferAllocationCount - allocations);
    const warmStart = fx.bloomRenderer.floatBufferAllocationCount;
    for (let frame = 0; frame < 20; frame++)
    {
      const started = now(); renderFrame(); warmFrames.push(now() - started);
    }
    warmAllocations.push(fx.bloomRenderer.floatBufferAllocationCount - warmStart);
  }
  return { firstFrames, warmFrames, firstAllocations, warmAllocations };
}
