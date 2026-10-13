const measurementNow = performance.now.bind(performance);
const measurementFrame = globalThis.requestAnimationFrame?.bind(globalThis);

export async function runCustomFixture({ url, profile, full = false, fault = false, reference = false, pendingDestroy = false, deviceLost = false, restoreContext = false, forceStandard = false, benchmark = false, gpuPerformance = false, targetCanvas = null, capturePixels = false, captureOffsetMs = 0, sustainedTrail = false, deterministicCanvas = false, timing = false, gpuOptimization = false, softwareOptimization = false, softwareCache = false, softwareZero = false, canvasTextureIdle = false })
{
  if (deterministicCanvas)
  {
    // 同一输入的 Canvas 读回会出现个别通道舍入波动；精确画面实验固定
    // 频繁读回上下文。每次运行使用独立上下文，性能继续使用默认光栅路径。
    for (const Constructor of [globalThis.HTMLCanvasElement, globalThis.OffscreenCanvas])
    {
      if (!Constructor)
      {
        continue;
      }
      const getContext = Constructor.prototype.getContext;
      Constructor.prototype.getContext = function(type, options)
      {
        return getContext.call(this, type, type === '2d' ? { ...options, willReadFrequently: true } : options);
      };
    }
  }
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
  if (fault === 'context')
  {
    if (dom)
    {
      // DOM 宿主内部创建 Canvas，故障注入必须作用于实际的 WebGL2 上下文。
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, options)
      {
        return type === 'webgl2' ? null : getContext.call(this, type, options);
      };
    }
    else
    {
      target.getContext = () => null;
    }
  }
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
  if (captureOffsetMs > 0)
  {
    now += captureOffsetMs;
    fx._renderFrame(now);
  }
  if (sustainedTrail)
  {
    input('pointerdown', 40, 80);
    for (let frame = 0; frame < 24; frame++)
    {
      now += 8;
      input('pointermove', 40 + frame * 9, 80 + Math.sin(frame * 0.35) * 50);
      fx._renderFrame(now);
    }
  }
  if (errors.length) throw new Error(`custom render: ${errors}`);
  const renderer = fx.webgpuEffectRenderer ?? fx.webglEffectRenderer ?? fx.webglBloomRenderer ?? fx.canvasSceneRenderer;
  const output = fx.webgpuEffectVisible ? fx.webgpuEffectCanvas : fx.webglEffectVisible ? fx.webglEffectCanvas
    : fx.webglBloomVisible ? fx.webglBloomCanvas : fx.canvasSceneVisible && fx.ownsCanvas ? fx.canvasSceneCanvas : fx.canvas;
  if (!full && !profile.features.bloom && ['webgl2', 'webgpu', 'webgpu-hdr'].includes(profile.backend))
  {
    const previous = renderer.sourceTarget;
    fx._renderFrame(now);
    if (renderer.sourceTarget !== previous || renderer.levels.length !== 0) throw Error('Bloom-disabled layout was reallocated');
  }
  const pixelWidth = output.width, pixelHeight = output.height;
  const capture = async () =>
  {
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
    return { hash, pixels };
  };
  const { hash, pixels } = await capture();
  const lit = pixels.reduce((count, value, index) => count + (index % 4 !== 3 && value > 8 ? 1 : 0), 0);
  const config = fx.getConfig();
  if (capturePixels && dom && profile.config.outputCompositing === 'browser-overlay' && profile.config.hostCompositing === 'screen')
  {
    // 未知背景只混合一次；已知参考已参与 Final Pass 时，DOM 必须停止重复 screen。
    const expected = reference ? 'source-over' : 'screen';
    if (fx.getEffectiveHostCompositing() !== expected ||
        fx.overlayRoot.style.mixBlendMode !== (reference ? '' : 'screen') ||
        (!reference && getComputedStyle(fx.overlayRoot).mixBlendMode !== 'screen'))
    {
      throw Error('webpage DOM compositing contract');
    }
  }
  const state = { clickTimeMs: fx.clickTimeMs, trailTimeMs: fx.trailTimeMs,
    waves: fx.waves.map(wave => ({ x: wave.x, y: wave.y, ageMs: wave.ageMs, rings: wave.rings })),
    shards: fx.shards.map(shard => ({ x: shard.x, y: shard.y, ageMs: shard.ageMs })),
    trail: fx.trailStrokes.map(stroke => stroke.points), stats: structuredClone(renderer?.stats) };
  let softwareOptimizationResults;
  let softwareCacheResults;
  let softwareZeroResults;
  let canvasTextureIdleResults;
  if (canvasTextureIdle)
  {
    fx.resizeObserver?.disconnect();
    const { probeCanvasTextureIdle } = await import('./canvas-texture-probe.js');
    canvasTextureIdleResults = await probeCanvasTextureIdle(fx, delta => { now += delta; fx._renderFrame(now); }, capture);
  }
  if (softwareZero)
  {
    fx.resizeObserver?.disconnect();
    const { probeSoftwareZero } = await import('./software-probe.js');
    softwareZeroResults = await probeSoftwareZero(fx, () => fx._renderFrame(now), capture, full);
  }
  if (softwareCache)
  {
    fx.resizeObserver?.disconnect();
    const { probeSoftwareCache } = await import('./software-probe.js');
    softwareCacheResults = await probeSoftwareCache(fx, (delta = 0) => { now += delta; fx._renderFrame(now); }, capture,
      () =>
      {
        const target = hasDom ? document.createElement('canvas') : new OffscreenCanvas(65, 33);
        target.width = 65; target.height = 33;
        return new BAClickFX(full ? { ...profile.config, target, inputSource: 'manual' } : { target });
      });
  }
  if (softwareOptimization)
  {
    fx.resizeObserver?.disconnect();
    if (full && profile.fxParams.bloom.intensity === 0) fx.setFxParam('bloom.intensity', 0);
    const { probeSoftwareReadbacks } = await import('./software-probe.js');
    softwareOptimizationResults = await probeSoftwareReadbacks(fx, () => fx._renderFrame(now), capture);
  }
  let gpuOptimizationResults;
  if (gpuOptimization)
  {
    if (!full || !['webgl2', 'webgpu', 'webgl2-bloom'].includes(profile.backend)) throw Error('GPU optimization fixture requires a full GPU runtime');
    const initialScaledSource = renderer.bloomSourceTarget != null;
    const initiallyLazy = renderer.transparentBloomTexture == null;
    // 异步设备就绪会刷新 DOM 尺寸；专项从同一显式 DPR 开始，避免把 DPR 切换算作复用。
    fx.resizeObserver?.disconnect();
    fx.setFxParam('bloom.intensity', 1.7);
    fx.resize(320, 240, 2); fx._renderFrame(now);
    const targets = () => [renderer.sourceTarget, renderer.sceneOverlayTarget,
      ...renderer.levels.flatMap(level => [level.down, level.up].filter(Boolean))];
    const originalTargets = targets();
    const scaledSource = renderer.bloomSourceTarget;
    let bloomPasses = 0;
    let allocations = 0;
    let sourceDraws = 0;
    let sourceAllocations = 0;
    let omitBloomFlag = false;
    const restores = [];
    const wrap = (name, count) =>
    {
      const original = renderer[name];
      renderer[name] = function (...args) { count(args); return original.apply(this, args); };
      restores.push(() => { delete renderer[name]; });
    };
    wrap('_allocateTargets', () => allocations++);
    const ensureSource = renderer._ensureBloomSourceTarget;
    renderer._ensureBloomSourceTarget = function (...args)
    {
      const previous = this.bloomSourceTarget;
      const result = ensureSource.apply(this, args);
      if (this.bloomSourceTarget !== previous) sourceAllocations++;
      return result;
    };
    restores.push(() => { delete renderer._ensureBloomSourceTarget; });
    const renderScene = renderer.renderScene;
    renderer.renderScene = function (settings)
    {
      if (omitBloomFlag) { settings = { ...settings }; delete settings.bloomEnabled; }
      return renderScene.call(this, settings);
    };
    restores.push(() => { delete renderer.renderScene; });
    if (renderer.gl)
    {
      for (const name of ['_renderPrefilter', '_renderDownsample', '_renderUpsample']) wrap(name, () => bloomPasses++);
      wrap('_drawGeometryBatches', args => { if (args[2]) sourceDraws++; });
    }
    else
    {
      wrap('_drawFullscreen', args => { if (args.at(-1).includes('WebGPU bloom ')) bloomPasses++; });
      wrap('_renderGeometryTarget', args => { if (args[1] !== renderer.sourceTarget) sourceDraws++; });
    }
    gpuOptimizationResults = { initiallyLazy, initialScaledSource, intensity: [], layout: [] };
    const backendReady = () => profile.backend === 'webgl2-bloom'
      ? fx.resolvedBloomBackend === 'webgl2' : fx.resolvedEffectBackend === profile.backend;
    if (renderer._hasTargetLayout)
    {
      // 不丢弃真实句柄：仅暂时遮蔽引用，验证不完整资源不会被误判为可复用。
      const checks = [[renderer.sourceTarget, 'texture'], [renderer.sceneOverlayTarget, renderer.gl ? 'framebuffer' : 'view'],
        [renderer.levels[0].down, 'texture'], [renderer.levels[0], 'width']];
      if (!renderer.gl) checks.push([renderer.levels[0], 'upUniform']);
      for (const [object, key] of checks)
      {
        const previous = object[key]; object[key] = null;
        try
        {
          if (renderer._hasTargetLayout(renderer.sourceWidth, renderer.sourceHeight,
            renderer.width, renderer.height, renderer.levels.length)) throw Error('Incomplete GPU layout was reused');
        }
        finally { object[key] = previous; }
      }
      gpuOptimizationResults.integrityChecks = checks.length;
    }
    try
    {
      for (const stage of [{ intensity: 1.7 }, { intensity: 0 }, { intensity: 0 },
        { intensity: 1.7 }, { intensity: 0, omitBloomFlag: true }])
      {
        const { intensity } = stage;
        omitBloomFlag = stage.omitBloomFlag ?? false;
        fx.setFxParam('bloom.intensity', intensity);
        bloomPasses = 0; allocations = 0; sourceDraws = 0; sourceAllocations = 0;
        fx._renderFrame(now);
        if (!backendReady()) throw Error('GPU optimization unexpectedly fell back');
        gpuOptimizationResults.intensity.push({ ...stage, bloomPasses, allocations, sourceDraws, sourceAllocations,
          sourceReady: renderer.bloomSourceFrameReady, sourceReused: renderer.bloomSourceTarget === scaledSource,
          targetsReused: targets().every((target, index) => target === originalTargets[index]),
          hash: (await capture()).hash });
      }
      omitBloomFlag = false;
      fx.setFxParam('bloom.intensity', 1.7);
      const changes = [
        { name: 'fractional-diffusion', diffusion: 7.125, reuse: true },
        { name: 'level-boundary', diffusion: 8, reuse: false },
        { name: 'fractional-size', width: 320.2, height: 240.2, dpr: 2, reuse: true },
        { name: 'fractional-dpr', width: 320.2, height: 240.2, dpr: 1.9999, reuse: true },
        { name: 'resize', width: 300, height: 210, dpr: 1, reuse: false },
        { name: 'dpr', width: 300, height: 210, dpr: 2, reuse: false },
        { name: 'tiny', width: 1, height: 1, dpr: 1, reuse: false },
        { name: 'tiny-diffusion', diffusion: 10, reuse: true },
        { name: 'released', release: true, reuse: false },
      ];
      for (const change of changes)
      {
        const previous = targets();
        bloomPasses = 0; allocations = 0;
        if (change.diffusion !== undefined) fx.setFxParam('bloom.diffusion', change.diffusion);
        if (change.width !== undefined) fx.resize(change.width, change.height, change.dpr);
        if (change.release) renderer._deleteTargets();
        fx._renderFrame(now);
        if (!backendReady()) throw Error('GPU layout unexpectedly fell back');
        gpuOptimizationResults.layout.push({ ...change, allocations, sampleScale: renderer.sampleScale,
          levelCount: renderer.levels.length, targetsReused: targets().length === previous.length &&
            targets().every((target, index) => target === previous[index]), hash: (await capture()).hash });
      }
      // 生命周期继续使用原尺寸；缩放专项不改变其输入和黄金场景。
      fx.setFxParam('bloom.diffusion', 7); fx.resize(320, 240, 1); fx._renderFrame(now);
    }
    finally { restores.reverse().forEach(restore => restore()); }
  }
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
  let softwareCacheTiming;
  if (benchmark && profile.backend === 'software' && profile.features.click && profile.features.bloom)
  {
    const { benchmarkSoftwareCache } = await import('./software-probe.js');
    softwareCacheTiming = benchmarkSoftwareCache(fx, () => fx._renderFrame(now), realNow);
  }
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
      let previousZeroTexture;
      let zeroHash;
      if (gpuOptimization)
      {
        fx.setFxParam('bloom.intensity', 0); fx._renderFrame(now);
        previousZeroTexture = renderer.transparentBloomTexture;
        zeroHash = (await capture()).hash;
      }
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
      if (gpuOptimization)
      {
        gpuOptimizationResults.restoredHash = (await capture()).hash;
        gpuOptimizationResults.beforeRestoreHash = zeroHash;
        gpuOptimizationResults.zeroTextureRestored = !!renderer.transparentBloomTexture &&
          renderer.transparentBloomTexture !== previousZeroTexture;
      }
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
  if (gpuOptimization && renderer.gl) gpuOptimizationResults.zeroTextureReleased = renderer.transparentBloomTexture === null;
  if (!fx.destroyed || fx.animationFrame !== null || fx.waves.length || fx.shards.length) throw Error('destroy contract');
  return { hash, lit, pixelWidth, pixelHeight, state, config, actualRuntime: hasDom ? (dom ? 'dom' : 'manual') : 'worker',
    // 仅实验命令请求像素和冷加载计时，默认验收报告保持原有成本和内容。
    ...(capturePixels ? { pixels: Array.from(pixels) } : {}),
    ...(timing && !benchmark ? { importMs, initMs } : {}),
    ...(gpuOptimization ? { gpuOptimization: gpuOptimizationResults } : {}),
    ...(softwareOptimization ? { softwareOptimization: softwareOptimizationResults } : {}),
    ...(softwareCache ? { softwareCache: softwareCacheResults } : {}),
    ...(softwareZero ? { softwareZero: softwareZeroResults } : {}),
    ...(canvasTextureIdle ? { canvasTextureIdle: canvasTextureIdleResults } : {}),
    ...(softwareCacheTiming ? { softwareCacheTiming } : {}),
    ...(benchmark ? { importMs, initMs, frameTimes, cpuFrameMs,
      heap: { beforeImport: heapBeforeImport, afterImport: heapAfterImport, afterInit: heapAfterInit }, gpuFrames } : {}),
    contextRestored, errors };
}
