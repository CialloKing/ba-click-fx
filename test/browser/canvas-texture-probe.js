// 测试副本暴露私有缓存；发布入口不增加诊断 API。
export async function probeCanvasTextureCache()
{
  const sourceUrl = new URL('/src/engine-core.js', import.meta.url);
  let source = await (await fetch(sourceUrl)).text();
  source = source.replace(/from ['"]((?:\.\/|\/)[^'"]+)['"]/g,
    (_, path) => `from '${new URL(path, sourceUrl).href}'`);
  source += `\nexport { getCircleTextureResources, prepareLinearTintedTextureCanvas };
    export const inspectCache = () => ({ circle: circleTextureResources, triangle: triangleTextureResources,
      lut: linearToSrgbLut, owners: canvasTextureOwners.size, depth: canvasTextureReadDepth });`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const { BAClickFX, inspectCache, getCircleTextureResources, prepareLinearTintedTextureCanvas } = await import(url);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const instances = [];
  const raf = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const create = () =>
  {
    const canvas = typeof document === 'undefined' ? new OffscreenCanvas(240, 180) : document.createElement('canvas');
    canvas.width = 240; canvas.height = 180;
    const fx = new BAClickFX({ target: canvas, effectBackend: 'canvas2d', bloomBackend: 'native',
      inputSource: 'manual', trailEnabled: false, outputCompositing: 'browser-overlay' });
    fx.resizeObserver?.disconnect(); fx.resize(240, 180, 1);
    fx.setFxParam('shards.roundness', 0.5);
    instances.push(fx); return fx;
  };
  const draw = fx => { fx.boom(110, 80); fx._renderFrame(performance.now() + 120); };
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
        for (const frame of frames ?? []) buffers.add(frame.image.data.buffer);
      for (const value of resource.roundedCoverages?.values() ?? []) buffers.add(value.buffer);
    }
    if (inspectCache().lut) buffers.add(inspectCache().lut.buffer);
    return { bytes: [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0),
      canvasPixels: surfaces().reduce((sum, canvas) => sum + canvas.width * canvas.height, 0) };
  };
  try
  {
    const first = create(), second = create();
    draw(first); const warm = inspectCache(); const held = capacity(); const canvases = surfaces();
    assert(warm.circle && warm.triangle && warm.lut && held.bytes > 6 * 1024 * 1024, 'Exercise derived texture caches');
    draw(second); draw(first);
    assert(inspectCache().circle === warm.circle && inspectCache().triangle === warm.triangle && inspectCache().owners === 2,
      'Active instances share stable resources');
    assert(capacity().bytes === held.bytes && surfaces().every((canvas, index) => canvas === canvases[index]),
      'Warm frames retain derived capacity and Canvas identity');
    first.clear(); first.destroy();
    assert(inspectCache().circle === warm.circle && inspectCache().owners === 1, 'One instance cannot release another owner');
    second.clear();
    assert(capacity().bytes === 0 && capacity().canvasPixels === 0 && !inspectCache().lut, 'Last clear releases all derived storage');
    assert(canvases.every(canvas => canvas.width === 0 && canvas.height === 0), 'Release Canvas backing storage');
    draw(second);
    assert(inspectCache().circle !== warm.circle && inspectCache().triangle !== warm.triangle, 'Rebuild after clear');
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

    const failed = create();
    const previous = failed._beginCanvasTextureFrame();
    const circle = getCircleTextureResources();
    const prototype = Object.getPrototypeOf(circle.context ?? circle.outputContext);
    const createImageData = prototype.createImageData;
    prototype.createImageData = () => { throw Error('fixture tint allocation failure'); };
    try { assert(prepareLinearTintedTextureCanvas(circle, 512, [1, 1, 1], 1, 1) === null, 'Exercise tint allocation failure'); }
    finally { prototype.createImageData = createImageData; failed._endCanvasTextureFrame(previous); }
    assert(circle.linearTintUnavailable, 'Remember tint failure'); failed.clear();
    const restored = failed._beginCanvasTextureFrame();
    try { assert(getCircleTextureResources().linearTintUnavailable, 'Cache release preserves tint failure'); }
    finally { failed._endCanvasTextureFrame(restored); }
    failed.destroy();
    assert(inspectCache().owners === 0 && capacity().bytes === 0, 'Destroy releases group');
    return { held, released: capacity(), reentered, failurePreserved: true };
  }
  finally
  {
    for (const fx of instances) fx.destroy();
    globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel;
    URL.revokeObjectURL(url);
  }
}
