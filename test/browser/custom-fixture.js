const measurementNow = performance.now.bind(performance);
const measurementFrame = globalThis.requestAnimationFrame?.bind(globalThis);

export async function runCustomFixture({ url, profile, full = false, fault = false, reference = false, pendingDestroy = false, deviceLost = false, restoreContext = false, forceStandard = false, benchmark = false, gpuPerformance = false, targetCanvas = null })
{
  const realNow = measurementNow;
  const importStart = realNow();
  const heapBeforeImport = performance.memory?.usedJSHeapSize ?? null;
  const { default: BAClickFX } = await import(url);
  const importMs = realNow() - importStart;
  const heapAfterImport = performance.memory?.usedJSHeapSize ?? null;
  let now = 1000;
  let randomState = 73;
  Math.random = () => ((randomState = (randomState * 1664525 + 1013904223) >>> 0) / 4294967296);
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const hasDom = typeof document !== 'undefined';
  const dom = profile.runtime === 'dom' || (full && ['webgpu', 'webgpu-hdr', 'webgl2-bloom'].includes(profile.backend)) ||
    (full && profile.runtime === 'manual' && profile.backend === 'webgl2') || (full && reference && profile.backend === 'native');
  const target = targetCanvas ?? (dom ? document.createElement('div')
    : hasDom ? document.createElement('canvas') : new OffscreenCanvas(320, 240));
  if (dom)
  {
    target.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:240px';
    document.body.append(target);
  }
  else
  {
    target.width = 320; target.height = 240;
    if (hasDom) document.body.append(target);
  }
  if (fault === 'context') target.getContext = () => null;
  if (fault === 'gpu') Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
  if (forceStandard)
  {
    const getContext = target.getContext.bind(target);
    let wrapped = false;
    target.getContext = (...args) =>
    {
      const context = getContext(...args);
      if (args[0] === 'webgpu' && context && !wrapped)
      {
        wrapped = true;
        const configure = context.configure.bind(context);
        context.configure = options =>
        {
          if (options.toneMapping?.mode === 'extended') throw Error('fixture rejects Extended output');
          configure(options);
        };
      }
      return context;
    };
  }
  const errors = [];
  const initStart = realNow();
  let fx;
  try
  {
    fx = new BAClickFX(full ? { ...profile.config, target, inputSource: 'manual' }
      : { target, onError: error => errors.push(error.code) });
  }
  catch (error)
  {
    if (!fault) throw error;
    target.remove?.();
    return { errors, stopped: errors.length === 1, synchronousFailure: true };
  }
  if (full)
  {
    // Build feature flags correspond to omission of the same emissions in the baseline.
    Object.assign(fx.fxConfig, structuredClone(profile.fxParams));
    if (!profile.features.shards) { fx.fxConfig.shards.clickCount = 0; fx.fxConfig.shards.maxCount = 0; }
  }
  fx.resize(320, 240, Math.min(2, profile.config.maxDpr));
  if (reference)
  {
    const source = hasDom ? document.createElement('canvas') : new OffscreenCanvas(320, 240);
    source.width = 320; source.height = 240;
    const context = source.getContext('2d');
    context.fillStyle = '#1d3757'; context.fillRect(0, 0, 320, 240);
    if (!fx.setCompositingReference(source)) throw Error('reference rejected');
  }
  fx._renderFrame(now);
  const gpu = fx.webgpuEffectRenderer;
  if (pendingDestroy)
  {
    const synchronous = !!gpu && gpu.status === 'pending';
    fx.destroy();
    await gpu?.ready;
    if (!synchronous || !fx.destroyed || gpu?.status !== 'destroyed' || errors.length) throw Error('destroy during initialization');
    target.remove?.();
    return { pendingDestroy: true };
  }
  if (gpu)
  {
    const ready = await gpu.ready;
    if (!ready && gpu.deviceManager.status === 'unavailable' && !fault)
    {
      const failure = gpu.deviceManager.getDiagnostics?.().failure ?? gpu.deviceManager.failureStage;
      fx.destroy(); target.remove?.();
      return { skipped: 'WebGPU device unavailable', failure, errors };
    }
    fx._renderFrame(now);
  }
  if (deviceLost)
  {
    gpu.device.destroy();
    await gpu.device.lost;
    await Promise.resolve(); await Promise.resolve();
    const stopped = fx.buildFailed && fx.paused && fx.animationFrame === null;
    const outputMode = fx.getConfig().resolvedWebGPUOutputMode;
    fx.destroy(); target.remove?.();
    return { errors, stopped, outputMode };
  }
  const initMs = realNow() - initStart;
  const heapAfterInit = performance.memory?.usedJSHeapSize ?? null;
  if (fault)
  {
    fx._renderFrame(now + 10);
    const stopped = fx.buildFailed && fx.animationFrame === null;
    fx.setPaused(false);
    if (!fx.paused) throw Error('failed instance resumed');
    fx.destroy(); target.remove?.();
    return { errors, stopped };
  }
  // 接口验收不计入初始化耗时，保持两种产物的计时范围一致。
  if (!full)
  {
    for (const invalid of [{ scale: 2 }, { onError: 3 }, ...(profile.runtime === 'dom' ? [{ inputFilter: 3 }] : [])])
    {
      let rejected = false;
      try { new BAClickFX({ target, ...invalid }); } catch (error) { rejected = error instanceof TypeError; }
      if (!rejected) throw Error('invalid constructor option accepted');
    }
    if (!Object.isFrozen(fx.config) || !Object.isFrozen(fx.fxConfig.bloom)) throw Error('mutable fixed parameters');
    const copy = fx.getFxConfig(); copy.bloom.intensity = 999;
    if (fx.getFxConfig().bloom.intensity !== profile.fxParams.bloom.intensity) throw Error('query exposed fixed parameters');
    if (profile.runtime === 'dom')
    {
      fx.canvas.id = 'custom-canvas-target';
      let rejected = false;
      try { new BAClickFX({ target: '#custom-canvas-target' }); } catch (error) { rejected = error instanceof TypeError; }
      if (!rejected) throw Error('DOM selector accepted existing Canvas');
    }
  }
  if (errors.length) throw new Error(`custom initialization: ${errors} available=${fx.webglEffectRenderer?.available} unavailable=${fx.webglEffectUnavailable} canvas=${fx.canvas.constructor.name} owns=${fx.ownsCanvas} width=${fx.width}/${fx.height}`);
  const input = (type, x, y) =>
  {
    if (!full && profile.runtime === 'dom')
    {
      const rect = target.getBoundingClientRect();
      const event = new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'mouse', isPrimary: true,
        button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x + rect.left, clientY: y + rect.top });
      Object.defineProperty(event, 'timeStamp', { value: now });
      target.dispatchEvent(event);
    }
    else if (fx[type === 'pointerdown' ? 'pointerDown' : type === 'pointermove' ? 'pointerMove' : 'pointerUp'])
    {
      if (type === 'pointerup') fx.pointerUp(7);
      else fx[type === 'pointerdown' ? 'pointerDown' : 'pointerMove']({ x, y, pointerId: 7 });
    }
  };
  input('pointerdown', 110, 105);
  now += 30; input('pointermove', 130, 108);
  now += 30; input('pointermove', 155, 123);
  now += 20; input('pointerup', 155, 123);
  const frameTimes = [];
  for (let frame = 0; frame < 3; frame++)
  {
    now += 12;
    const start = realNow(); fx._renderFrame(now); frameTimes.push(realNow() - start);
  }
  if (errors.length) throw new Error(`custom render: ${errors}`);
  const renderer = fx.webgpuEffectRenderer ?? fx.webglEffectRenderer ?? fx.webglBloomRenderer ?? fx.canvasSceneRenderer;
  const output = fx.webgpuEffectVisible ? fx.webgpuEffectCanvas : fx.webglEffectVisible ? fx.webglEffectCanvas
    : fx.webglBloomVisible ? fx.webglBloomCanvas : fx.canvasSceneVisible && fx.ownsCanvas ? fx.canvasSceneCanvas : fx.canvas;
  const pixelWidth = output.width, pixelHeight = output.height;
  let pixels;
  if (renderer?.gl && output === renderer.canvas && !(reference && profile.backend === 'native'))
  {
    pixels = new Uint8Array(pixelWidth * pixelHeight * 4);
    const gl = renderer.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.finish();
    gl.readPixels(0, 0, pixelWidth, pixelHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const flipped = new Uint8Array(pixels.length);
    const stride = pixelWidth * 4;
    for (let row = 0; row < pixelHeight; row++) flipped.set(pixels.subarray(row * stride, (row + 1) * stride), (pixelHeight - 1 - row) * stride);
    pixels = flipped;
  }
  else
  {
    const read = hasDom ? document.createElement('canvas') : new OffscreenCanvas(320, 240);
    read.width = pixelWidth; read.height = pixelHeight;
    const context = read.getContext('2d');
    context.drawImage(output, 0, 0);
    pixels = context.getImageData(0, 0, pixelWidth, pixelHeight).data;
  }
  const digest = await crypto.subtle.digest('SHA-256', pixels);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  const lit = pixels.reduce((count, value, index) => count + (index % 4 !== 3 && value > 8 ? 1 : 0), 0);
  const config = fx.getConfig();
  const state = { clickTimeMs: fx.clickTimeMs, trailTimeMs: fx.trailTimeMs,
    waves: fx.waves.map(wave => ({ x: wave.x, y: wave.y, ageMs: wave.ageMs, rings: wave.rings })),
    shards: fx.shards.map(shard => ({ x: shard.x, y: shard.y, ageMs: shard.ageMs })),
    trail: fx.trailStrokes.map(stroke => stroke.points), stats: structuredClone(renderer?.stats) };
  // 压测只由显式基准命令启用，避免每次像素和生命周期回归都支付采样成本。
  const cpuFrameMs = [];
  if (benchmark)
  {
    fx.clear(); input('pointerdown', 40, 50);
    for (let frame = 0; frame < 90; frame++)
    {
      now += 12;
      input('pointermove', 40 + frame % 40 * 4, 50 + frame % 20 * 3);
      if (frame % 10 === 0) fx.boom?.(110, 105);
      const start = realNow(); fx._renderFrame(now); cpuFrameMs.push(realNow() - start);
    }
    input('pointerup', 110, 105);
  }
  let gpuFrames;
  if (benchmark && gpuPerformance)
  {
    if (!renderer?.gl && !gpu?.device) gpuFrames = { skipped: 'selected mode has no GPU renderer' };
    else if (!measurementFrame) gpuFrames = { skipped: 'native requestAnimationFrame unavailable' };
    else
    {
      const waits = [], start = realNow();
      for (let frame = 0; frame < 30; frame++)
      {
        const scheduled = await new Promise(done =>
        {
          const timer = setTimeout(() => done(false), 3000);
          measurementFrame(() => { clearTimeout(timer); done(true); });
        });
        if (!scheduled)
        {
          gpuFrames = { skipped: 'native requestAnimationFrame did not advance' };
          break;
        }
        now += 12;
        if (frame % 5 === 0) fx.boom?.(110, 105);
        fx._renderFrame(now);
        const submitted = realNow();
        if (gpu?.device) await gpu.device.queue.onSubmittedWorkDone();
        else renderer.gl.finish();
        waits.push(realNow() - submitted);
      }
      const elapsedMs = realNow() - start;
      if (!gpuFrames) gpuFrames = { frames: 30, elapsedMs, scheduledFps: 30000 / elapsedMs, completionWaitMs: waits,
        environment: 'headless browser RAF with GPU completion; physical display FPS unverified' };
    }
  }
  let contextRestored;
  if (restoreContext)
  {
    const extension = renderer.gl.getExtension('WEBGL_lose_context');
    if (!extension) contextRestored = 'skipped: WEBGL_lose_context unavailable';
    else
    {
      const event = type => new Promise((done, fail) =>
      {
        const timer = setTimeout(() => fail(Error(`${type} timeout`)), 5000);
        renderer.canvas.addEventListener(type, () => { clearTimeout(timer); done(); }, { once: true });
      });
      const lost = event('webglcontextlost'); extension.loseContext(); await lost;
      fx._renderFrame(now);
      if (!renderer.contextLost || fx.buildFailed) throw Error('context loss changed fixed backend');
      // Chromium 与现有完整版恢复测试一样，需要等丢失事件完成后再请求恢复。
      await new Promise(done => setTimeout(done, 120));
      const restored = event('webglcontextrestored'); extension.restoreContext(); await restored;
      fx._renderFrame(now);
      if (renderer.contextLost || errors.length) throw Error('context restoration failed');
      contextRestored = 'passed';
    }
  }
  const otherTarget = hasDom ? target.cloneNode(false) : new OffscreenCanvas(160, 120);
  if (hasDom) document.body.append(otherTarget);
  const other = new BAClickFX(full ? { ...profile.config, target: otherTarget, inputSource: 'manual' }
    : { target: otherTarget, onError: error => errors.push(error.code) });
  other.resize(160, 120, 1); other.boom?.(30, 30); other._renderFrame(now);
  if (other.webgpuEffectRenderer) { await other.webgpuEffectRenderer.ready; other._renderFrame(now); }
  const originalCounts = [fx.waves.length, fx.shards.length];
  if ((other.fxConfig === fx.fxConfig && full) || other.waves === fx.waves || other.trailStrokes === fx.trailStrokes) throw Error('shared mutable instance state');
  other.destroy(); otherTarget.remove?.();
  if (errors.length || fx.destroyed || JSON.stringify(originalCounts) !== JSON.stringify([fx.waves.length, fx.shards.length])) throw Error('destroy affected another instance');
  fx.setPaused(true);
  const counts = [fx.waves.length, fx.trailStrokes.length, fx.shards.length];
  fx.boom?.(20, 20);
  if (JSON.stringify(counts) !== JSON.stringify([fx.waves.length, fx.trailStrokes.length, fx.shards.length])) throw Error('paused input changed state');
  fx.resize(240, 180, 2);
  if (fx.width !== 240 || fx.height !== 180 || fx.dpr !== Math.min(2, profile.config.maxDpr) ||
      fx.canvas.width !== Math.round(240 * fx.dpr) || fx.canvas.height !== Math.round(180 * fx.dpr)) throw Error('resize/DPR contract');
  fx.clearTrail?.(); fx.clear(); fx.setPaused(false); fx.destroy(); fx.destroy(); target.remove?.();
  if (!fx.destroyed || fx.animationFrame !== null || fx.waves.length || fx.shards.length) throw Error('destroy contract');
  return { hash, lit, pixelWidth, pixelHeight, state, config, actualRuntime: hasDom ? (dom ? 'dom' : 'manual') : 'worker',
    ...(benchmark ? { importMs, initMs, frameTimes, cpuFrameMs,
      heap: { beforeImport: heapBeforeImport, afterImport: heapAfterImport, afterInit: heapAfterInit }, gpuFrames } : {}),
    contextRestored, errors };
}
