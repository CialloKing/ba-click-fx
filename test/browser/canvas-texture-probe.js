// 测试副本暴露私有缓存；发布入口不增加诊断 API。
export async function probeCanvasTextureCache()
{
  const sourceUrl = new URL('/src/engine-core.js', import.meta.url);
  let source = await (await fetch(sourceUrl)).text();
  source = source.replace(/from ['"]((?:\.\/|\/)[^'"]+)['"]/g,
    (_, path) => `from '${new URL(path, sourceUrl).href}'`);
  source = source.replace(/(const sources = create(?:Circle|Triangle)TextureSources\(createCanvas\);)/g,
    '$1 cacheWork.rebuilds++;');
  source = source.replace('const rgba = resources.linearTextureRgba;',
    'cacheWork.cpuRebuilds++; const rgba = resources.linearTextureRgba;');
  source += `\nexport { getCircleTextureResources, prepareLinearTintedTextureCanvas, prepareSceneRoundedTriangleCanvas };
    export const cacheWork = { rebuilds: 0, cpuRebuilds: 0 };
    export const inspectCache = () => ({ circle: circleTextureResources, triangle: triangleTextureResources,
      lut: linearToSrgbLut, owners: canvasTextureOwners.size, depth: canvasTextureReadDepth });`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const { BAClickFX, inspectCache, cacheWork, getCircleTextureResources,
    prepareLinearTintedTextureCanvas, prepareSceneRoundedTriangleCanvas } = await import(url);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const instances = [];
  const raf = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
  const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  let now = 100;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const create = (Constructor = BAClickFX) =>
  {
    const canvas = typeof document === 'undefined' ? new OffscreenCanvas(240, 180) : document.createElement('canvas');
    canvas.width = 240; canvas.height = 180;
    const fx = new Constructor({ target: canvas, effectBackend: 'canvas2d', bloomBackend: 'native',
      inputSource: 'manual', trailEnabled: false, outputCompositing: 'browser-overlay' });
    fx.resizeObserver?.disconnect(); fx.resize(240, 180, 1);
    fx.setFxParam('shards.roundness', 0.5);
    instances.push(fx); return fx;
  };
  const draw = fx => { fx.boom(110, 80); now += 120; fx._renderFrame(now); };
  const resources = () => [inspectCache().circle, inspectCache().triangle].filter(Boolean);
  const surfaces = () => resources().flatMap(resource => [
    ...Object.values(resource).filter(value => typeof value?.getContext === 'function'),
    ...(resource.linearTintFrames ?? []).map(frame => frame.canvas),
    ...(resource.roundedSceneFrames ?? []).map(frame => frame.canvas),
  ]);
  const capacity = () =>
  {
    const buffers = new Set();
    for (const resource of resources())
    {
      for (const key of ['linearTextureRgb', 'linearTextureEnergyRgb'])
        if (resource[key]) buffers.add(resource[key].buffer);
      if (resource.linearTextureCoverageFromSrgbRed && resource.linearTextureCoverage)
        buffers.add(resource.linearTextureCoverage.buffer);
      for (const frames of [resource.linearTintFrames, resource.roundedSceneFrames])
        for (const frame of frames ?? []) if (frame.image) buffers.add(frame.image.data.buffer);
      for (const value of resource.roundedCoverages?.values() ?? []) buffers.add(value.buffer);
    }
    if (inspectCache().lut) buffers.add(inspectCache().lut.buffer);
    return { bytes: [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0),
      canvasPixels: surfaces().reduce((sum, canvas) => sum + canvas.width * canvas.height, 0) };
  };
  try
  {
    const first = create(), second = create();
    draw(first); const warm = inspectCache();
    const sceneScope = first._beginCanvasTextureFrame();
    try { assert(prepareSceneRoundedTriangleCanvas(warm.triangle, [1, 1, 1], 0.5, 0), 'Exercise rounded scene frames'); }
    finally { first._endCanvasTextureFrame(sceneScope); }
    const held = capacity(); const canvases = surfaces();
    const warmRgb = warm.circle.linearTextureRgb;
    const warmRebuilds = cacheWork.rebuilds;
    const warmCpuRebuilds = cacheWork.cpuRebuilds;
    assert(warm.circle && warm.triangle && warm.lut && held.bytes > 6 * 1024 * 1024, 'Exercise derived texture caches');
    draw(second); draw(first);
    assert(inspectCache().circle === warm.circle && inspectCache().triangle === warm.triangle && inspectCache().owners === 2,
      'Active instances share stable resources');
    assert(capacity().bytes === held.bytes && surfaces().every((canvas, index) => canvas === canvases[index]),
      'Warm frames retain derived capacity and Canvas identity');
    assert(cacheWork.rebuilds === warmRebuilds, 'Warm frames allocate no new texture resources');
    assert(cacheWork.cpuRebuilds === warmCpuRebuilds, 'Warm frames allocate no new linear texture buffers');
    first.clear(); first.destroy();
    assert(inspectCache().circle === warm.circle && inspectCache().owners === 1, 'One instance cannot release another owner');
    second.clear();
    assert(capacity().bytes === 0 && !inspectCache().lut, 'Last clear releases CPU working storage');
    assert(capacity().canvasPixels === held.canvasPixels && surfaces().every((canvas, index) => canvas === canvases[index]),
      'Retain Canvas bitmaps for byte-identical raster output');
    draw(second);
    assert(inspectCache().circle === warm.circle && inspectCache().triangle === warm.triangle &&
      capacity().bytes > 0 && warm.circle.linearTextureRgb !== warmRgb, 'Rebuild CPU buffers while retaining Canvas resources');
    second.destroy();

    const outer = create(), inner = create(); draw(outer);
    const before = inspectCache().circle;
    const finalize = outer._finalizeCanvasOverlayAlpha;
    let reentered = false;
    outer._finalizeCanvasOverlayAlpha = function (...args)
    {
      if (!reentered)
      {
        reentered = true; outer.clear(); draw(inner); inner.clear();
        assert(inspectCache().circle === before && inspectCache().depth > 0, 'Defer release across nested rendering');
      }
      return finalize.apply(this, args);
    };
    outer._renderFrame(performance.now() + 150);
    outer._finalizeCanvasOverlayAlpha = finalize;
    assert(reentered && inspectCache().depth === 0 && capacity().bytes === 0, 'Flush release at outermost finally');
    outer.destroy(); inner.destroy();

    const timeout = globalThis.setTimeout, clearTimeout = globalThis.clearTimeout;
    const timers = new Map();
    let clock = 0, nextId = 10;
    globalThis.setTimeout = (callback, delay) =>
    { const id = nextId++; timers.set(id, { callback, due: clock + delay, delay }); return id; };
    globalThis.clearTimeout = id => timers.delete(id);
    const advance = ms =>
    {
      clock += ms;
      for (const [id, timer] of [...timers])
        if (timer.due <= clock) { timers.delete(id); timer.callback(); }
    };
    const idle = create(), active = create();
    let idleReleased, idleRebuilds, idleCpuRebuilds;
    try
    {
      draw(idle); draw(active); const retained = inspectCache().circle;
      active.setPaused(true); now += 10000; idle._renderFrame(now); advance(30000);
      assert(timers.size === 0 && inspectCache().circle === retained, 'Paused visible owner blocks group release');
      active.setPaused(false); now += 10000; active._renderFrame(now);
      assert(timers.size === 1 && [...timers.values()][0].delay === 30000, 'All idle owners share one 30 second timer');
      const stale = [...timers.values()][0]; advance(29999);
      assert(inspectCache().circle === retained, 'No early release');
      idle.boom(110, 80);
      assert(timers.size === 0, 'Input cancels timeout before drawing');
      stale.callback();
      assert(inspectCache().circle === retained, 'Stale callback cannot release resumed resources');
      now += 120; idle._renderFrame(now);
      assert(inspectCache().circle === retained, 'Short gap reuses resources');
      now += 10000; idle._renderFrame(now); advance(30000);
      idleReleased = capacity();
      assert(idleReleased.bytes === 0 && idleReleased.canvasPixels === held.canvasPixels && inspectCache().owners === 0,
        'Natural idle releases CPU storage and retains bitmaps');
      const beforeRebuild = cacheWork.rebuilds;
      const beforeCpuRebuild = cacheWork.cpuRebuilds;
      draw(idle); idleRebuilds = cacheWork.rebuilds - beforeRebuild;
      idleCpuRebuilds = cacheWork.cpuRebuilds - beforeCpuRebuild;
      assert(inspectCache().circle === retained && idleRebuilds === 0 && idleCpuRebuilds === 2 && capacity().bytes > 0,
        'First click rebuilds CPU data without reallocating Canvas resources');
      now += 10000; idle._renderFrame(now); assert(timers.size === 1, 'Rebuilt resources can become idle again');
      const idleScope = active._beginCanvasTextureFrame();
      try { advance(30000); assert(capacity().bytes > 0, 'Idle callback cannot release an open rendering scope'); }
      finally { active._endCanvasTextureFrame(idleScope); }
      assert(capacity().bytes === 0 && timers.size === 0, 'Deferred idle release completes at outermost finally');
      draw(idle); now += 10000; idle._renderFrame(now);
      idle.destroy(); active.destroy();
      assert(timers.size === 0 && capacity().bytes === 0, 'Last destroy cancels pending release');
    }
    finally
    {
      idle.destroy(); active.destroy();
      globalThis.setTimeout = timeout; globalThis.clearTimeout = clearTimeout;
    }

    const failed = create();
    const previous = failed._beginCanvasTextureFrame();
    const circle = getCircleTextureResources();
    const prototype = Object.getPrototypeOf(circle.context ?? circle.outputContext);
    const createImageData = prototype.createImageData;
    circle.linearTintFrames[0].key = null;
    prototype.createImageData = () => { throw Error('fixture tint allocation failure'); };
    try { assert(prepareLinearTintedTextureCanvas(circle, 512, [1, 1, 1], 1, 1) === null, 'Exercise tint allocation failure'); }
    finally { prototype.createImageData = createImageData; failed._endCanvasTextureFrame(previous); }
    assert(circle.linearTintUnavailable, 'Remember tint failure'); failed.clear();
    const restored = failed._beginCanvasTextureFrame();
    try { assert(getCircleTextureResources().linearTintUnavailable, 'Cache release preserves tint failure'); }
    finally { failed._endCanvasTextureFrame(restored); }
    failed.destroy();
    // 原始资源仍保留，因此用独立模块验证首次资源失败及失败状态的生命周期。
    const failureUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const fresh = await import(failureUrl);
    const unavailable = create(fresh.BAClickFX);
    const canvasPrototype = Object.getPrototypeOf(unavailable.canvas);
    const getContext = canvasPrototype.getContext;
    let sourceAttempts = 0;
    canvasPrototype.getContext = function (...args)
    {
      if (this.width === 512) { sourceAttempts++; return null; }
      return getContext.apply(this, args);
    };
    const unavailableScope = unavailable._beginCanvasTextureFrame();
    try { assert(fresh.getCircleTextureResources() === null, 'Exercise source creation failure'); }
    finally { canvasPrototype.getContext = getContext; unavailable._endCanvasTextureFrame(unavailableScope); }
    unavailable.clear();
    const retryScope = unavailable._beginCanvasTextureFrame();
    try { assert(fresh.getCircleTextureResources() === null && sourceAttempts === 3, 'Release preserves source failure'); }
    finally { unavailable._endCanvasTextureFrame(retryScope); unavailable.destroy(); URL.revokeObjectURL(failureUrl); }
    assert(inspectCache().owners === 0 && capacity().bytes === 0, 'Destroy releases group');
    return { held, released: capacity(), idleReleased, warmRebuilds: 0, warmCpuRebuilds: 0,
      idleRebuilds, idleCpuRebuilds, reentered, failurePreserved: true };
  }
  finally
  {
    for (const fx of instances) fx.destroy();
    globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel;
    if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor); else delete performance.now;
    URL.revokeObjectURL(url);
  }
}

// 同一夹具可运行旧产物；只比较实际画面，缓存行为由上面的私有源码探针断言。
export async function probeCanvasTextureIdle(fx, renderFrame, capture)
{
  const timeout = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const timers = new Map(); const results = [];
  let clock = 0, nextId = 10;
  globalThis.setTimeout = (callback, delay) =>
  { const id = nextId++; timers.set(id, { callback, due: clock + delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  const advance = ms =>
  {
    clock += ms;
    for (const [id, timer] of [...timers])
      if (timer.due <= clock) { timers.delete(id); timer.callback(); }
  };
  const record = async name => results.push({ name, hash: (await capture()).hash });
  try
  {
    await record('active'); fx.setPaused(true); advance(30000); await record('paused'); fx.setPaused(false);
    renderFrame(10000); advance(29999); await record('before-deadline');
    fx.boom(110, 105); renderFrame(120); await record('resumed');
    renderFrame(10000); advance(30000); await record('released');
    fx.boom(110, 105); renderFrame(120); await record('rebuilt');
    fx.clear(); await record('cleared'); return results;
  }
  finally
  {
    fx.clear(); globalThis.setTimeout = timeout; globalThis.clearTimeout = clear;
  }
}
