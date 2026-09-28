// 仅由开发基准加载：计时、计数和采样各自使用全新夹具，不进入发布运行时。
export async function diagnoseSoftware(page)
{
  let session;
  let profiling = false;
  try
  {
    await page.evaluate(async () =>
    {
      const { BAClickFX } = await import('/src/fx.js');
      const { SoftwareBloomRenderer } = await import('/src/software-bloom.js');
      const { trackCanvasReadbacks, seedRoundedShards } = await import('/scripts/runtime-readback-diagnostics.mjs');
      const realNow = performance.now.bind(performance);
      const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
      const originalRandom = Math.random;
      const originalRaf = window.requestAnimationFrame;
      const originalCancel = window.cancelAnimationFrame;
      let fx;
      let restores = [];
      const cleanup = () =>
      {
        for (const restore of restores.reverse()) restore();
        restores = [];
        fx?.destroy();
        fx = null;
        if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor);
        else delete performance.now;
        Math.random = originalRandom;
        window.requestAnimationFrame = originalRaf;
        window.cancelAnimationFrame = originalCancel;
      };
      const work = () =>
      {
        for (let i = 0; i < 20; i++)
        {
          fx._renderFrame(220);
          if (fx.resolvedBloomBackend !== 'software' || !fx.lastSoftwareBloomFrame)
            throw new Error('Software 诊断发生回退或缺少最终快照');
        }
      };
      const prepare = (rounded = false, visualMax = false) =>
      {
        cleanup();
        let seed = 12345;
        Object.defineProperty(performance, 'now', { configurable: true, value: () => 100 });
        Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
        window.requestAnimationFrame = () => 1;
        window.cancelAnimationFrame = () => {};
        fx = new BAClickFX({ inputSource: 'manual', effectBackend: 'canvas2d',
          bloomBackend: 'software', outputCompositing: 'browser-overlay',
          ...(visualMax ? { overlayAlphaPolicy: 'visual-max' } : {}) });
        if (rounded) seedRoundedShards(fx);
        else
        {
          fx.setFxParam('shards.maxCount', 0);
          fx.pointerDown({ x: 10, y: 80, pointerId: 1 });
          fx._appendPointerSample({ x: 300, y: 120 }, fx._getTrailInputTime(100));
          for (let i = 0; i < 2; i++) fx.boom(70 + i * 30, 120);
        }
        work();
      };
      const measure = (timing, rounded = false, visualMax = false) =>
      {
        prepare(rounded, visualMax);
        const phases = {};
        const stack = [];
        const wrap = (object, name, phase, accepts = () => true) =>
        {
          const original = object[name];
          const descriptor = Object.getOwnPropertyDescriptor(object, name);
          phases[phase] = { calls: 0, ...(timing ? { inclusiveMs: 0, exclusiveMs: 0 } : {}) };
          object[name] = function (...args)
          {
            if (!accepts(args)) return original.apply(this, args);
            const record = phases[phase];
            record.calls++;
            const frame = { phase, start: timing ? realNow() : 0, childrenMs: 0 };
            stack.push(frame);
            try { return original.apply(this, args); }
            finally
            {
              const duration = timing ? realNow() - frame.start : 0;
              stack.pop();
              if (timing)
              {
                record.inclusiveMs += duration;
                record.exclusiveMs += duration - frame.childrenMs;
                if (stack.length) stack.at(-1).childrenMs += duration;
              }
            }
          };
          restores.push(() =>
          {
            if (descriptor) Object.defineProperty(object, name, descriptor);
            else delete object[name];
          });
        };
        try
        {
          wrap(fx, '_renderFrame', 'frame');
          wrap(fx, '_renderSoftwareBloom', 'softwarePass');
          wrap(SoftwareBloomRenderer.prototype, 'composite', 'softwareComposite');
          wrap(fx, '_cacheSoftwareBloomFrame', 'snapshot');
          wrap(fx, '_getSoftwareBloomFrameSignature', 'signature');
          wrap(fx, '_captureCanvasOverlayAlpha', 'captureSceneAlpha');
          wrap(fx, '_limitCanvasOverlayAlpha', 'limitOverlayAlpha');
          wrap(JSON, 'stringify', 'configurationSerialization', args => args[0] === fx.fxConfig);
          const canvas = CanvasRenderingContext2D.prototype;
          wrap(canvas, 'getImageData', 'pixelReadback');
          wrap(canvas, 'putImageData', 'pixelWriteback');
          wrap(canvas, 'drawImage', 'canvasDrawImage');
          const readbacks = trackCanvasReadbacks(canvas, {
            now: timing ? realNow : null,
            classify: context =>
            {
              if (context === fx.context)
              {
                if (stack.some(frame => frame.phase === 'captureSceneAlpha')) return 'sceneAlpha';
                if (stack.some(frame => ['limitOverlayAlpha', 'softwareComposite'].includes(frame.phase))) return 'finalFrame';
              }
              if (context === fx.canvasBloomTransportContext) return 'bloomTransport';
              for (const renderer of fx.bloomRenderers)
              {
                if (context === renderer.sourceContext) return 'emission';
                if (context === renderer.coverageContext) return 'coverage';
              }
              return 'unclassified';
            },
          });
          restores.push(readbacks.restore);
          work();
          if (phases.frame.calls !== 20 || phases.snapshot.calls !== 20)
            throw new Error('Software 诊断夹具的帧数或快照数量不一致');
          phases.pixelReadback.details = readbacks.stats;
          for (const key of ['calls', 'requestedPixels', 'returnedBytes', 'failures'])
          {
            const sum = Object.values(readbacks.stats.byRole).reduce((value, role) => value + role[key], 0);
            if (sum !== readbacks.stats.total[key]) throw new Error(`回读分类总计不一致：${key}`);
          }
          if (readbacks.stats.total.calls !== phases.pixelReadback.calls || readbacks.stats.collectionErrors)
            throw new Error('回读诊断不完整');
          return phases;
        }
        finally { cleanup(); }
      };
      window.__baSoftwareDiagnostic = { prepare, work, measure, cleanup };
    });
    const timings = [];
    for (let round = 0; round < 7; round++)
      timings.push(await page.evaluate(() => window.__baSoftwareDiagnostic.measure(true)));
    const counts = await page.evaluate(() => window.__baSoftwareDiagnostic.measure(false));
    const roundedTimings = [];
    for (let round = 0; round < 7; round++)
      roundedTimings.push(await page.evaluate(() => window.__baSoftwareDiagnostic.measure(true, true)));
    const roundedCounts = await page.evaluate(() => window.__baSoftwareDiagnostic.measure(false, true));
    const visualMaxCounts = await page.evaluate(() => window.__baSoftwareDiagnostic.measure(false, false, true));
    if (Object.entries(visualMaxCounts.pixelReadback.details.byRole).some(([role, value]) =>
      role === 'unclassified' ? value.calls !== 0 : value.calls === 0))
      throw new Error('visual-max 未完整覆盖五种回读用途');
    await page.evaluate(() => window.__baSoftwareDiagnostic.prepare());
    session = await page.context().newCDPSession(page);
    await session.send('Profiler.enable');
    await session.send('Profiler.setSamplingInterval', { interval: 1000 });
    await session.send('Profiler.start');
    profiling = true;
    await page.evaluate(() => window.__baSoftwareDiagnostic.work());
    const { profile } = await session.send('Profiler.stop');
    profiling = false;
    return {
      diagnostics: { iterations: 20, warmupIterations: 20, rounds: 7, timings, counts,
        roundedShards: { timings: roundedTimings, counts: roundedCounts },
        visualMaxCounts,
        note: '诊断包装有开销，不代替正式耗时。inclusiveMs 包含子调用，不能相加；exclusiveMs 排除已记录子调用，仍包含包装开销。frame/软件阶段的剩余时间未细分归因。CPU 采样独立运行。' },
      profile,
    };
  }
  finally
  {
    // 清理不能覆盖原始错误，尤其是浏览器已退出或 Profiler 启动失败时。
    if (profiling) await session.send('Profiler.stop').catch(() => {});
    if (session) await session.detach().catch(() => {});
    await page.evaluate(() =>
    {
      window.__baSoftwareDiagnostic?.cleanup();
      delete window.__baSoftwareDiagnostic;
    }).catch(() => {});
  }
}
