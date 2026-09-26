import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import {
  findChromiumExecutable, startViteServer, closeBrowserRuntime,
} from '../test/browser/harness.mjs';

const rootDir = resolve(import.meta.dirname, '..');
const label = (process.argv[2] ?? 'current').replace(/[^a-zA-Z0-9_-]/g, '-');
const executablePath = findChromiumExecutable();
if (!executablePath)
{
  throw new Error('运行时微基准需要本机 Chrome 或 Edge');
}
const result = {
  label, commit: execFileSync('git', ['describe', '--always', '--dirty'], {
    cwd: rootDir, encoding: 'utf8',
  }).trim(),
  node: process.version, platform: process.platform, cpu: cpus()[0]?.model,
  executablePath,
  viewport: { width: 320, height: 240 }, randomSeed: 12345,
  targetBatchMs: 20, maximumIterations: 1_000_000,
  note: 'CPU/提交微基准；计数与耗时分开采集，不代表真实 GPU 帧率。',
};
let browser;
let vite;
try
{
  const runtime = await startViteServer(rootDir);
  vite = runtime.server;
  browser = await chromium.launch({
    executablePath, headless: true,
    args: ['--disable-background-networking', '--disable-extensions',
      '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });
  result.browser = browser.version();
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  await page.goto(`${runtime.baseUrl}/test/browser/webgpu.html`);
  result.cases = await page.evaluate(async () =>
  {
    const { BAClickFX, UNITY_FX_TOUCH } = await import('/src/fx.js');
    const { WebGL2EffectRenderer } = await import('/src/webgl2-effect.js');
    const { WebGPUEffectRenderer } = await import('/src/webgpu-effect.js');
    const nativeNow = performance.now.bind(performance);
    const nativeNowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    const nativeRandom = Math.random;
    const nativeRaf = window.requestAnimationFrame;
    const nativeCancelRaf = window.cancelAnimationFrame;
    let now = 100;
    let seed = 12345;
    Object.defineProperty(performance, 'now', { configurable: true, value: () => now });
    Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
    const results = {};
    const effects = new Set();
    const renderers = [];
    const effect = options =>
    {
      const fx = new BAClickFX({ effectBackend: 'canvas2d', bloomBackend: 'native',
        inputSource: 'manual', ...options });
      effects.add(fx);
      return fx;
    };
    const destroyEffect = fx => { fx.destroy(); effects.delete(fx); };
    const instrument = (object, name, count, restores) =>
    {
      const original = object[name];
      object[name] = function (...args) { count(...args); return original.apply(this, args); };
      restores.push(() => { object[name] = original; });
    };
    const countGpu = renderer =>
    {
      const counts = { uniformLookups: 0, bindGroups: 0, vertexWrites: 0, vertexBytes: 0 };
      const restores = [];
      if (renderer.gl)
      {
        instrument(renderer.gl, 'getUniformLocation', () => counts.uniformLookups++, restores);
        instrument(renderer.gl, 'bufferData', (target, data) =>
        {
          if (target === renderer.gl.ARRAY_BUFFER)
          {
            counts.vertexWrites++;
            counts.vertexBytes += data.byteLength ?? data;
          }
        }, restores);
      }
      else
      {
        instrument(renderer.device, 'createBindGroup', () => counts.bindGroups++, restores);
        instrument(renderer.device.queue, 'writeBuffer', (buffer, offset, data, dataOffset, size) =>
        {
          if (buffer.label.endsWith(' vertices'))
          {
            counts.vertexWrites++;
            counts.vertexBytes += size;
          }
        }, restores);
      }
      return { counts, restore: () => restores.reverse().forEach(restore => restore()) };
    };
    const flushGpu = renderer => renderer.gl
      ? renderer.gl.finish() : renderer.device.queue.onSubmittedWorkDone();
    const countFloat64 = key =>
    {
      const Float64 = globalThis.Float64Array;
      const counts = { [key]: 0 };
      globalThis.Float64Array = new Proxy(Float64, {
        construct(target, args) { counts[key]++; return new target(...args); },
      });
      return { counts, restore: () => { globalThis.Float64Array = Float64; } };
    };
    const measure = async (initialIterations, create) =>
    {
      const batch = async (iterations, counting = false) =>
      {
        // 每轮从相同逻辑状态预热，避免移动轨迹和随机粒子逐轮改变工作量。
        now = 100; seed = 12345;
        const fixture = await create();
        let counter;
        try
        {
          for (let i = 0; i < initialIterations; i++) fixture.work(i);
          await fixture.flush?.();
          if (counting) counter = fixture.count?.();
          const started = nativeNow();
          for (let i = 0; i < iterations; i++) fixture.work(i);
          const duration = nativeNow() - started;
          // GPU 完成等待不进入 CPU 提交计时，也不把队列积压带到下一轮。
          await fixture.flush?.();
          return { duration, counts: counter?.counts, details: fixture.details?.() };
        }
        finally
        {
          counter?.restore();
          fixture.destroy?.();
        }
      };
      let iterations = initialIterations;
      while ((await batch(iterations)).duration < 20 && iterations < 1_000_000)
      {
        iterations = Math.min(1_000_000, iterations * 2);
      }
      const durationsMs = [];
      for (let round = 0; round < 7; round++) durationsMs.push((await batch(iterations)).duration);
      const medianMs = [...durationsMs].sort((a, b) => a - b)[3];
      const counted = await batch(initialIterations, true);
      return { iterations, rounds: 7, durationsMs, medianMs,
        msPerIteration: medianMs / iterations,
        belowTargetDuration: medianMs < 20,
        resolutionLimited: iterations === 1_000_000 && medianMs < 20,
        ...counted.details, ...counted.counts };
    };
    const ring = renderer => renderer.addDissolveRing(
      160, 120, 50, 10, 0.35, 8, 96, [1, 0.6, 2], 0.7, 0.5, 0.1, 0.9, -1,
    );
    const seedTrail = fx =>
    {
      fx.setFxParam('shards.maxCount', 0);
      fx.pointerDown({ x: 10, y: 80, pointerId: 1 });
      fx._appendPointerSample({ x: 300, y: 120 }, now);
    };
    const moveTrail = (fx, i) =>
    {
      now += 16;
      fx._appendPointerSample({ x: i % 2 ? 150 : 170, y: 100 }, now);
    };
    try
    {
      for (const throttled of [false, true])
      {
        results[throttled ? 'throttledInput' : 'idleInput'] = await measure(1000, () =>
        {
          const fx = effect({ clickEnabled: false });
          const sample = { pointerId: 1, pointerType: 'mouse', clientX: 100, clientY: 100, timeStamp: now };
          if (throttled)
          {
            fx.pointerDown({ x: 100, y: 100, pointerId: 1 });
            fx.setInputSamplingRate(60);
          }
          const event = throttled ? { ...sample, getCoalescedEvents: () => Array(100).fill(sample) } : sample;
          return {
            work: () => { if (throttled) fx.lastInputSampleSourceTime = now; fx._handlePointerMove(event); },
            destroy: () => destroyEffect(fx),
            count: () =>
            {
              const counts = { layoutReadsPer1000: 0 }, restores = [];
              instrument(fx, '_getCanvasRect', () => counts.layoutReadsPer1000++, restores);
              return { counts, restore: restores[0] };
            },
          };
        });
      }
      results.rings = await measure(1000, () =>
      {
        const geometry = new WebGL2EffectRenderer(null, { initialize: false });
        return {
          work: () => { geometry.beginFrame(); ring(geometry); ring(geometry); },
          destroy: () => geometry.destroy(),
          count: () => countFloat64('float64AllocationsPer1000'),
          details: () => ({ vertexBytes: geometry.ringVertexCount * 9 * 4 }),
        };
      });
      for (const moving of [false, true])
      {
        results[moving ? 'changingTrail' : 'fixedTrail'] = await measure(moving ? 100 : 500, () =>
        {
          const fx = effect({ clickEnabled: false });
          seedTrail(fx);
          return {
            work: i => { if (moving) moveTrail(fx, i); fx._updateTrail(now, 1, false, false, false); },
            destroy: () => destroyEffect(fx),
            count: () =>
            {
              const counts = { measurementRebuilds: 0 };
              const original = fx._updateTrail;
              fx._updateTrail = function (...args)
              {
                const before = this.currentTrailStroke.trailFrameData?.measurement;
                original.apply(this, args);
                counts.measurementRebuilds += before !== this.currentTrailStroke.trailFrameData?.measurement ? 1 : 0;
              };
              return { counts, restore: () => { fx._updateTrail = original; } };
            },
          };
        });
      }
      results.fixedTrail.measurementsPer500 = results.fixedTrail.measurementRebuilds;
      for (const software of [false, true])
      {
        results[software ? 'softwareOverlay' : 'denseClicks'] = await measure(20, () =>
        {
          const fx = effect({ trailEnabled: software, bloomBackend: software ? 'software' : 'native',
            outputCompositing: software ? 'browser-overlay' : 'scene' });
          if (software) seedTrail(fx);
          for (let i = 0; i < (software ? 2 : 6); i++) fx.boom(70 + i * 30, 120);
          return {
            work: () =>
            {
              fx._renderFrame(now + 120);
              if (fx.resolvedBloomBackend !== (software ? 'software' : 'native')) throw new Error('Canvas 微基准发生意外后端回退');
              if (software && !fx.lastSoftwareBloomFrame) throw new Error('Software 微基准未生成完整输出快照');
            },
            destroy: () => destroyEffect(fx),
            count: () => countFloat64('float64AllocationsPer20'),
          };
        });
      }
      for (const backend of ['webgl2', 'webgpu'])
      {
        const canvas = document.createElement('canvas');
        const renderer = backend === 'webgl2' ? new WebGL2EffectRenderer(canvas) : new WebGPUEffectRenderer(canvas);
        renderers.push(renderer);
        if (backend === 'webgpu') await renderer.ready;
        if (!renderer.available)
        {
          results[backend] = { skipped: true, reason: renderer.deviceManager?.diagnostics ?? 'WebGL2 上下文或必需渲染能力不可用' };
          continue;
        }
        if (!renderer.resize(320, 240, 1, 0.5, 5)) throw new Error(`${backend} 微基准尺寸准备失败`);
        const info = renderer.gl?.getExtension('WEBGL_debug_renderer_info');
        results[backend] = { skipped: false, outputMode: renderer.deviceManager?.outputMode,
          renderer: info ? renderer.gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : undefined,
          adapter: backend === 'webgpu' ? Object.fromEntries(['vendor', 'architecture', 'device', 'description'].map(key =>
            [key, renderer.deviceManager.adapter?.info?.[key] ?? null])) : undefined };
        for (const separate of [false, true])
        {
          const settings = { ...UNITY_FX_TOUCH.bloom, outputCompositing: 'scene',
            diskEmissionScale: separate ? 2 : 1, ringEmissionScale: separate ? 2 : 1 };
          results[backend][separate ? 'separateEmission' : 'normal'] = await measure(50, () => ({
            work: () =>
            {
              renderer.beginFrame(); ring(renderer); ring(renderer);
              if (!renderer.renderScene(settings) || !renderer.render(settings, { preserveCanvas: true }))
                throw new Error(`${backend} 微基准提交失败`);
            },
            flush: () => flushGpu(renderer),
            count: () =>
            {
              const counter = countGpu(renderer);
              return { ...counter, counts: { countsPer50: counter.counts } };
            },
          }));
        }
        results[backend].trails = {};
        for (const themed of [false, true])
        {
          for (const moving of [false, true])
          {
            results[backend].trails[`${themed ? 'relativeOklch' : 'default'}-${moving ? 'moving' : 'fixed'}`] = await measure(50, async () =>
            {
              const fx = effect({ clickEnabled: false, effectBackend: backend, bloomBackend: 'webgl2',
                themeColor: themed ? '#ff6699' : '#4ca7ff', themeColorMode: 'relative-oklch' });
              if (backend === 'webgpu')
              {
                fx._ensureWebGPUEffectRenderer();
                if (!(await fx.webgpuEffectRenderer?.ready)) throw new Error('WebGPU 拖尾实例初始化失败');
              }
              seedTrail(fx);
              const activeRenderer = () => backend === 'webgl2' ? fx.webglEffectRenderer : fx.webgpuEffectRenderer;
              return {
                work: i =>
                {
                  if (moving) moveTrail(fx, i);
                  fx._renderFrame(now);
                  if (fx.resolvedEffectBackend !== backend) throw new Error(`${backend} 拖尾微基准发生意外后端回退`);
                },
                flush: () => flushGpu(activeRenderer()),
                destroy: () => destroyEffect(fx),
                count: () =>
                {
                  const counter = countGpu(activeRenderer());
                  return { ...counter, counts: { countsPer50: counter.counts } };
                },
                details: () => ({ pointCount: fx.currentTrailStroke.points.length }),
              };
            });
          }
        }
      }
      return results;
    }
    finally
    {
      for (const renderer of renderers) renderer.destroy();
      for (const fx of effects) fx.destroy();
      if (nativeNowDescriptor) Object.defineProperty(performance, 'now', nativeNowDescriptor);
      else delete performance.now;
      Math.random = nativeRandom;
      window.requestAnimationFrame = nativeRaf;
      window.cancelAnimationFrame = nativeCancelRaf;
    }
  });
}
finally { await closeBrowserRuntime({ browser, vite }); }
const directory = resolve(rootDir, 'test-results');
mkdirSync(directory, { recursive: true });
const output = resolve(directory, `runtime-benchmark-${label}.json`);
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
console.log(`性能记录：${output}`);
