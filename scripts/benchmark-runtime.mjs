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
    const effects = [];
    let gpu;
    const geometry = new WebGL2EffectRenderer(null, { initialize: false });
    const effect = options =>
    {
      const fx = new BAClickFX({ effectBackend: 'canvas2d', bloomBackend: 'native',
        inputSource: 'manual', ...options });
      effects.push(fx);
      return fx;
    };
    const measure = (iterations, work) =>
    {
      for (let i = 0; i < iterations; i++) work(i);
      const durationsMs = [];
      for (let round = 0; round < 7; round++)
      {
        const started = nativeNow();
        for (let i = 0; i < iterations; i++) work(i);
        durationsMs.push(nativeNow() - started);
      }
      return { iterations, rounds: 7, durationsMs,
        medianMs: [...durationsMs].sort((a, b) => a - b)[3] };
    };
    const ring = renderer => renderer.addDissolveRing(
      160, 120, 50, 10, 0.35, 8, 96, [1, 0.6, 2], 0.7, 0.5, 0.1, 0.9, -1,
    );
    try
    {
      const input = effect({ clickEnabled: false });
      const sample = { pointerId: 1, pointerType: 'mouse', clientX: 100,
        clientY: 100, timeStamp: now };
      const idle = () => input._handlePointerMove(sample);
      results.idleInput = measure(1000, idle);
      let reads = 0;
      const getRect = input._getCanvasRect.bind(input);
      input._getCanvasRect = () => { reads++; return getRect(); };
      for (let i = 0; i < 1000; i++) idle();
      results.idleInput.layoutReadsPer1000 = reads;
      input._getCanvasRect = getRect;

      input.pointerDown({ x: 100, y: 100, pointerId: 1 });
      input.setInputSamplingRate(60);
      const batch = { ...sample, getCoalescedEvents: () => Array(100).fill(sample) };
      const throttled = () =>
      {
        input.lastInputSampleSourceTime = now;
        input._handlePointerMove(batch);
      };
      results.throttledInput = measure(1000, throttled);
      reads = 0;
      input._getCanvasRect = () => { reads++; return getRect(); };
      for (let i = 0; i < 1000; i++) throttled();
      results.throttledInput.layoutReadsPer1000 = reads;
      input._getCanvasRect = getRect;

      const rings = () => { geometry.beginFrame(); ring(geometry); ring(geometry); };
      results.rings = measure(1000, rings);
      let allocations = 0;
      const Float64 = globalThis.Float64Array;
      try
      {
        globalThis.Float64Array = new Proxy(Float64, {
          construct(target, args) { allocations++; return new target(...args); },
        });
        for (let i = 0; i < 1000; i++) rings();
      }
      finally { globalThis.Float64Array = Float64; }
      results.rings.float64AllocationsPer1000 = allocations;
      results.rings.vertexBytes = geometry.ringVertexCount * 9 * 4;

      const trail = effect({ clickEnabled: false });
      trail.setFxParam('shards.maxCount', 0);
      trail.pointerDown({ x: 10, y: 80, pointerId: 1 });
      trail._appendPointerSample({ x: 300, y: 120 }, now);
      const fixed = () => trail._updateTrail(now, 1, false, false, false);
      results.fixedTrail = measure(500, fixed);
      let rebuilds = 0;
      for (let i = 0; i < 500; i++)
      {
        const before = trail.currentTrailStroke.trailFrameData?.measurement;
        fixed();
        rebuilds += before !== trail.currentTrailStroke.trailFrameData?.measurement ? 1 : 0;
      }
      results.fixedTrail.measurementsPer500 = rebuilds;
      results.changingTrail = measure(100, i =>
      {
        now += 16;
        trail._appendPointerSample({ x: i % 2 ? 150 : 170, y: 100 }, now);
        trail._updateTrail(now, 1, false, false, false);
      });

      const clicks = effect({ trailEnabled: false });
      for (let i = 0; i < 6; i++) clicks.boom(70 + i * 30, 120);
      // 固定时间只测同一年龄的颜色与 Native 输出工作，防止对象逐轮过期。
      clicks._renderFrame(now + 120);
      results.denseClicks = measure(20, () => clicks._renderFrame(now + 120));

      const canvas = document.createElement('canvas');
      document.body.appendChild(canvas);
      gpu = new WebGPUEffectRenderer(canvas);
      if (!(await gpu.ready) || !gpu.resize(320, 240, 1, 0.5, 5))
      {
        results.webgpu = { skipped: true, reason: gpu.deviceManager.diagnostics };
      }
      else
      {
        results.webgpu = { skipped: false, outputMode: gpu.deviceManager.outputMode,
          adapter: Object.fromEntries(['vendor', 'architecture', 'device', 'description'].map(key =>
            [key, gpu.deviceManager.adapter?.info?.[key] ?? null])) };
        for (const separateEmission of [false, true])
        {
          const settings = { ...UNITY_FX_TOUCH.bloom, outputCompositing: 'scene',
            diskEmissionScale: separateEmission ? 2 : 1,
            ringEmissionScale: separateEmission ? 2 : 1 };
          const frame = () =>
          {
            gpu.beginFrame(); ring(gpu); ring(gpu);
            if (!gpu.renderScene(settings) || !gpu.render(settings, { preserveCanvas: true }))
              throw new Error('WebGPU 微基准提交失败');
          };
          const measured = measure(50, frame);
          await gpu.device.queue.onSubmittedWorkDone();
          const counts = { bindGroups: 0, vertexWrites: 0, vertexBytes: 0 };
          const bind = gpu.device.createBindGroup.bind(gpu.device);
          const write = gpu.device.queue.writeBuffer.bind(gpu.device.queue);
          try
          {
            gpu.device.createBindGroup = (...args) => { counts.bindGroups++; return bind(...args); };
            gpu.device.queue.writeBuffer = (buffer, ...args) =>
            {
              if (buffer.label.endsWith(' vertices'))
              {
                counts.vertexWrites++;
                counts.vertexBytes += args[3];
              }
              return write(buffer, ...args);
            };
            for (let i = 0; i < 50; i++) frame();
          }
          finally
          {
            gpu.device.createBindGroup = bind;
            gpu.device.queue.writeBuffer = write;
          }
          results.webgpu[separateEmission ? 'separateEmission' : 'normal'] = {
            ...measured, countsPer50: counts,
          };
        }
      }
      return results;
    }
    finally
    {
      gpu?.destroy(); geometry.destroy();
      for (const fx of effects) fx.destroy();
      delete performance.now;
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
