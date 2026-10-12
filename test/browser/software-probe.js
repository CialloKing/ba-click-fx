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
