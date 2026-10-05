const runtimeModules = new Map();

export async function loadTrailRuntime(prefix = '/src/')
{
  if (!runtimeModules.has(prefix))
  {
    runtimeModules.set(prefix, (async () =>
    {
      const file = `${prefix}fx.js`;
      let source = await (await fetch(file)).text();
      source = source.replace(/from\s*(['"])((?:\.\/|\/)[^'"]+)\1/g,
        (_, quote, path) => `from '${new URL(path, new URL(file, location.href)).href}'`);
      source += '\nexport { appendTrailWebGLScene };';
      if (source.includes('import { getTrailRenderPoints, updateTrailRenderPoints }'))
        source += '\nexport { updateTrailRenderPoints };';
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try { return await import(url); } finally { URL.revokeObjectURL(url); }
    })());
  }
  return runtimeModules.get(prefix);
}

export async function simulateInputTrail(state, renderSize, prefix = '/src/')
{
  const { BAClickFX } = await loadTrailRuntime(prefix);
  const clock = Object.getOwnPropertyDescriptor(performance, 'now');
  const request = window.requestAnimationFrame; const cancel = window.cancelAnimationFrame;
  let now = 0;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {};
  const target = document.createElement('div');
  target.style.cssText = `position:relative;width:${renderSize.width}px;height:${renderSize.height}px`;
  document.body.appendChild(target);
  let fx;
  try
  {
    fx = new BAClickFX({ target, inputSource: 'manual', clickEnabled: false,
      effectBackend: 'canvas2d', bloomBackend: 'native', maxDpr: 1 });
    fx.setFxParam('shards.maxCount', 0);
    const frames = [];
    let released = false;
    for (now = 0; now <= state.timeMs; now += 10)
    {
      for (const input of state.inputs.filter(point => point.timeMs === now))
      {
        const pointer = { x: input.x, y: input.y, pointerId: 1, pointerType: 'mouse', button: 0 };
        if (now === 0) fx.pointerDown(pointer); else fx.pointerMove(pointer);
      }
      if (!released && state.releaseMs > 0 && now >= state.releaseMs)
      {
        fx.pointerUp(1); released = true;
      }
      // 与 RAF 使用同一生产时钟和更新函数；不将 Unity 点集或烘焙结果写回模型。
      fx._advanceTrailTime(now);
      fx._updateTrail(fx.trailTimeMs, fx._getScale(), false, false, true);
      const points = fx.trailStrokes.flatMap(stroke => stroke.renderPoints ?? stroke.points);
      frames.push({ timeMs: now, trailTimeMs: fx.trailTimeMs, visible: points.length > 1,
        start: points.length > 1 ? { x: points[0].x, y: points[0].y } : null,
        end: points.length > 1 ? { x: points.at(-1).x, y: points.at(-1).y } : null,
        pointCount: points.length });
    }
    return { points: fx.trailStrokes.flatMap(stroke => stroke.renderPoints ?? stroke.points).map(point => ({ ...point })),
      frames, source: 'manual-input-api', stepMs: 10 };
  }
  finally
  {
    fx?.destroy(); target.remove();
    if (clock) Object.defineProperty(performance, 'now', clock); else delete performance.now;
    window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel;
  }
}
