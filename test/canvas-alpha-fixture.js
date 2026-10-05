// 同环境改动前/后运行并比较完整帧哈希；不把 Canvas 后端差异固化成跨机器像素阈值。
export async function canvasAlphaFixture({ includeBytes = false, bloomBackend = 'software', bentTrail = false,
  ringVariant = false } = {})
{
  const { BAClickFX } = await import('../src/fx.js');
  const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  const random = Math.random, raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;width:320px;height:240px;left:0;top:0';
  document.body.appendChild(host);
  let fx;
  const records = [];
  try
  {
    Object.defineProperty(performance, 'now', { configurable: true, value: () => 100 });
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
    for (const [limit, policy, compensation, opacity, theme] of [
      [250 / 255, 'coverage', 'none', 1, '#4ca7ff'],
      [1, 'coverage', 'none', 1, '#4ca7ff'],
      [1, 'coverage', 'bright-core', 0.4, '#ff6699'],
      [1 - 1e-4, 'coverage', 'bright-core', 1, '#4ca7ff'],
      [1, 'visual-max', 'none', 0.4, '#ff6699'],
      [1, 'visual-max', 'bright-core', 1, '#ff6699'],
    ])
    {
      let seed = 12345;
      Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
      fx = new BAClickFX({ target: host, inputSource: 'manual', effectBackend: 'canvas2d', bloomBackend,
        outputCompositing: 'browser-overlay', overlayAlphaLimit: limit, overlayAlphaPolicy: policy,
        overlayColorCompensation: compensation, opacity, themeColor: theme, themeColorMode: 'relative-oklch' });
      fx.setFxParam('shards.maxCount', 0);
      if (ringVariant)
      {
        fx.setThemeColorMode('hue-only');
        const update = fx.setFxParams({ 'rings.arcSamples': 33, 'rings.radialSamples': 3,
          'rings.dissolveDirection': -1 }, { strict: true });
        if (!update.committed) throw Error('圆环边界参数夹具未成功提交');
      }
      fx.pointerDown({ x: 20, y: 80, pointerId: 1 });
      fx._appendPointerSample({ x: 280, y: 140 }, fx._getTrailInputTime(100));
      if (bentTrail)
      {
        // 两侧转角、折返及重复点与直线使用同一完整帧字节对照。
        for (const [x, y] of [[180, 40], [80, 160], [180, 40], [180, 40]])
          fx._appendPointerSample({ x, y }, fx._getTrailInputTime(100));
      }
      fx.boom(90, 110); fx.boom(160, 120);
      for (let i = 0; i < 20; i++) fx._renderFrame(220);
      const frames = [];
      const capture = async () =>
      {
        const bytes = fx.context.getImageData(0, 0, fx.canvas.width, fx.canvas.height).data;
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        let binary = '';
        if (includeBytes)
          for (let start = 0; start < bytes.length; start += 16384)
            binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
        frames.push({ hash, byteLength: bytes.byteLength, visible: bytes.some(value => value !== 0), backend: fx.resolvedBloomBackend,
          ...(includeBytes ? { bytes: btoa(binary) } : {}) });
      };
      const times = ringVariant ? [220, 420, 600] : [220, 236, 260];
      for (const time of times)
      {
        fx._renderFrame(time);
        if (fx.resolvedBloomBackend !== bloomBackend || (bloomBackend === 'software' && !fx.lastSoftwareBloomFrame))
          throw Error('Alpha 字节夹具发生意外后端回退');
        await capture();
      }
      // 模拟源回读失败，检查同帧回退在相同输入下仍保持输出。
      const context = bloomBackend === 'software' ? fx.bloomRenderers[0].sourceContext : null;
      if (context)
      {
      const descriptor = Object.getOwnPropertyDescriptor(context, 'getImageData');
      context.getImageData = () => { throw Error('injected Software readback failure'); };
      try { fx._renderFrame(times.at(-1)); await capture(); }
      finally
      {
        if (descriptor) Object.defineProperty(context, 'getImageData', descriptor);
        else delete context.getImageData;
      }
      }
      records.push({ limit, policy, compensation, opacity, theme, width: fx.canvas.width, height: fx.canvas.height, frames });
      fx.destroy(); fx = null;
    }
    return records;
  }
  finally
  {
    try { fx?.destroy(); }
    finally
    {
      host.remove();
      if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor);
      else delete performance.now;
      Math.random = random; window.requestAnimationFrame = raf; window.cancelAnimationFrame = cancel;
    }
  }
}

// 检查真实帧入口的作用域，而非只验证私有准备函数的命中。
export async function ringScopeContract()
{
  const { loadRingDiagnosticModule } = await import('../scripts/runtime-ring-diagnostics.mjs');
  const module = await loadRingDiagnosticModule();
  const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  const raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
  const instances = [];
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;width:320px;height:240px;left:0;top:0';
  document.body.appendChild(host);
  const result = { reentrant: false, multiInstance: false, restored: false, independentFrames: false,
    stopSequenceReuse: false, parameters: false, cleared: false, destroyed: false, fallback: false, exception: false };
  try
  {
    Object.defineProperty(performance, 'now', { configurable: true, value: () => 100 });
    window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {};
    for (const bloomBackend of ['native', 'software'])
    {
      const fx = new module.BAClickFX({ target: host, inputSource: 'manual', effectBackend: 'canvas2d',
        trailEnabled: false, bloomBackend, outputCompositing: 'browser-overlay',
        themeColor: bloomBackend === 'software' ? '#ff6699' : '#4ca7ff' });
      fx.setFxParam('shards.maxCount', 0); fx.boom(160, 120);
      instances.push(fx);
    }
    const [fx, other] = instances;
    const draw = fx._drawWaveRings, otherDraw = other._drawWaveRings;
    let outer, entered = false, nested = false;
    fx._drawWaveRings = function (...args)
    {
      const current = module.readRingSampleScope();
      if (nested) result.reentrant = current !== outer && current !== null;
      else if (!entered)
      {
        entered = true; outer = current; nested = true;
        this._renderFrame(220);
        other._renderFrame(220);
        result.restored = module.readRingSampleScope() === outer;
        nested = false;
      }
      return draw.apply(this, args);
    };
    other._drawWaveRings = function (...args)
    {
      result.multiInstance = module.readRingSampleScope() !== outer && module.readRingSampleScope() !== null;
      return otherDraw.apply(this, args);
    };
    fx._renderFrame(220);
    result.restored &&= module.readRingSampleScope() === null;
    fx._drawWaveRings = draw; other._drawWaveRings = otherDraw;
    module.resetRingWork(); fx._renderFrame(220);
    const first = module.ringWork.preparations;
    const firstStops = module.ringWork.stopPreparations;
    result.stopSequenceReuse = firstStops > 0 && module.ringWork.stopRequests > firstStops &&
      module.ringWork.stopDataAllocations === firstStops;
    fx._renderFrame(220);
    result.independentFrames = first > 0 && module.ringWork.preparations === first * 2
      && module.ringWork.stopPreparations === firstStops * 2
      && module.readRingSampleScope() === null;
    result.parameters = fx.setFxParam('rings.arcSamples', 33);
    fx._renderFrame(236); fx.resetFxConfig(); fx.setThemeColorMode('hue-only');
    fx.setPaused(true); fx.setPaused(false); fx._renderFrame(240);
    result.parameters &&= module.readRingSampleScope() === null;
    // 独立 Context 丢失回退入口也必须建立自己的范围并恢复。
    other._restoreCanvasOutputAfterContextLoss('software');
    result.fallback = other.resolvedBloomBackend === 'software' && module.readRingSampleScope() === null;
    // 外层已有缓存时，故障帧中的 finally 仍须恢复它；原渲染异常按既有路径记录。
    const error = Error('injected ring scope failure'), log = console.error;
    let captured = false;
    fx._updateTrail = () => { throw error; };
    console.error = (...args) => { if (args.includes(error)) captured = true; else log(...args); };
    try
    {
      module.withRingSampleScope(() =>
      {
        const previous = module.readRingSampleScope();
        fx._renderFrame(250);
        result.exception = captured && module.readRingSampleScope() === previous;
      });
    }
    finally { console.error = log; }
    fx.clear(); other.clear();
    result.cleared = module.readRingSampleScope() === null && instances.every(value => value.waves.length === 0);
    for (const value of instances) { value.destroy(); value.destroy(); }
    result.destroyed = module.readRingSampleScope() === null && instances.every(value => value.destroyed);
    return result;
  }
  finally
  {
    try { for (const fx of instances) fx.destroy(); }
    finally
    {
      host.remove();
      if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor); else delete performance.now;
      window.requestAnimationFrame = raf; window.cancelAnimationFrame = cancel;
    }
  }
}
