export function gpuResources(renderer)
{
  const targets = [renderer.sourceTarget, renderer.sceneOverlayTarget, renderer.bloomSourceTarget,
    renderer.sceneBackgroundTarget, ...renderer.levels.flatMap(level => [level.down, level.up])].filter(Boolean);
  return { targetBytes: targets.reduce((sum, target) => sum + target.width * target.height * 8, 0),
    targetCount: targets.length, uniformCount: renderer.levels.reduce((sum, level) =>
      sum + Number(!!level.downUniform) + Number(!!level.upUniform), 0),
    bindGroups: renderer.bindGroups?.size ?? 0 };
}

export async function probeGpuCache(fx, renderer, renderFrame, capture, createInstance)
{
  const timeout = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const timers = new Map();
  let clock = 0, nextId = 100;
  const results = {};
  fx._cancelGpuFrameRelease?.();
  globalThis.setTimeout = (callback, delay) =>
  {
    const id = nextId++;
    timers.set(id, { callback, delay, due: clock + delay });
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  const advance = ms =>
  {
    clock += ms;
    for (const [id, timer] of [...timers])
    {
      if (timer.due <= clock) { timers.delete(id); timer.callback(); }
    }
  };
  const status = () =>
  {
    const config = fx.getConfig();
    return { width: renderer.canvas.width, height: renderer.canvas.height,
      effect: config.resolvedEffectBackend, bloom: config.resolvedBloomBackend,
      output: config.resolvedWebGPUOutputMode, available: renderer.available,
      failedResizeSignature: renderer.failedResizeSignature };
  };
  const record = async name =>
  {
    results[name] = { ...gpuResources(renderer), status: status(), hash: (await capture()).hash,
      pending: timers.has(fx.gpuFrameIdleTimer), animationFrame: fx.animationFrame };
  };
  let other;
  try
  {
    renderFrame(); await record('active');
    fx.setPaused(true); advance(30000); await record('paused');
    fx.setPaused(false); renderFrame(10000); await record('idle');
    const firstTimer = timers.get(fx.gpuFrameIdleTimer);
    results.delay = firstTimer?.delay ?? null;
    fx._scheduleGpuFrameRelease?.();
    results.singleTimer = !firstTimer || timers.get(fx.gpuFrameIdleTimer) === firstTimer;
    advance(29999); await record('before-deadline');
    fx.boom(110, 105); renderFrame();
    firstTimer?.callback(); await record('resumed');
    renderFrame(10000); advance(30000); await record('released');
    fx.boom(110, 105); renderFrame(); await record('rebuilt');

    other = await createInstance();
    const otherRenderer = other.fx.webgpuEffectRenderer ?? other.fx.webglEffectRenderer ?? other.fx.webglBloomRenderer;
    other.fx.boom(80, 80); other.fx._renderFrame(performance.now()); other.fx.setPaused(true);
    const otherSource = otherRenderer.sourceTarget;
    fx.clear(); await record('cleared');
    advance(30000); await record('clear-released');
    results.otherPreserved = otherSource === otherRenderer.sourceTarget && !!otherSource;
    other.fx.clear();
    const doomedTimer = timers.get(other.fx.gpuFrameIdleTimer);
    results.destroyPending = !!doomedTimer;
    other.dispose(); doomedTimer?.callback();
    results.destroyed = other.fx.destroyed && !timers.has(other.fx.gpuFrameIdleTimer) && !otherRenderer.sourceTarget;
    other = null;

    fx.boom(110, 105); renderFrame();
    const available = renderer.available, signature = renderer.failedResizeSignature;
    try
    {
      renderer.available = false; renderer.failedResizeSignature = 'injected-idle-failure';
      fx.clear(); advance(30000);
      results.failurePreserved = renderer.available === false && renderer.failedResizeSignature === 'injected-idle-failure';
      results.failedResources = gpuResources(renderer);
    }
    finally { renderer.available = available; renderer.failedResizeSignature = signature; }
    fx.boom(110, 105); renderFrame();
    return results;
  }
  finally
  {
    other?.dispose(); fx._cancelGpuFrameRelease?.();
    globalThis.setTimeout = timeout; globalThis.clearTimeout = clear;
  }
}

// CPU 提交计时不包含 GPU 完成等待；用同一虚拟空闲边界比较旧版与新版。
export async function benchmarkGpuCache(fx, renderer, renderFrame, now)
{
  const timeout = globalThis.setTimeout, clear = globalThis.clearTimeout;
  const timers = new Map();
  let id = 100;
  fx._cancelGpuFrameRelease?.();
  globalThis.setTimeout = (callback, delay, ...args) =>
  {
    if (delay !== 30000) return timeout(callback, delay, ...args);
    const handle = ++id; timers.set(handle, callback); return handle;
  };
  globalThis.clearTimeout = handle => timers.delete(handle) || clear(handle);
  const flush = () => renderer.gl ? renderer.gl.finish() : renderer.device.queue.onSubmittedWorkDone();
  const firstFrames = [], warmFrames = [], resources = [];
  try
  {
    await flush();
    for (let round = 0; round < 7; round++)
    {
      fx.clear();
      const callback = timers.get(fx.gpuFrameIdleTimer);
      timers.delete(fx.gpuFrameIdleTimer); callback?.();
      const idle = gpuResources(renderer);
      fx.boom(110, 105);
      await flush();
      const start = now(); renderFrame(); firstFrames.push(now() - start);
      await flush();
      resources.push({ idle, active: gpuResources(renderer) });
      for (let frame = 0; frame < 20; frame++)
      {
        const start = now(); renderFrame(); warmFrames.push(now() - start);
        await flush();
      }
    }
    return { firstFrames, warmFrames, resources };
  }
  finally
  {
    fx._cancelGpuFrameRelease?.(); globalThis.setTimeout = timeout; globalThis.clearTimeout = clear;
  }
}
