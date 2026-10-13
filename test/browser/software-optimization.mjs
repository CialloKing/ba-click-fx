import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { normalizeProfile } from '../../scripts/build-profile.mjs';
import { buildCustomFixture } from '../custom-build-fixture.mjs';
import { closeBrowserRuntime, findChromiumExecutable, startViteServer } from './harness.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
assert(args.every(value => value === '--source' || value === '--benchmark' || value.startsWith('--baseline=')), 'Unknown Software optimization option');
const benchmark = args.includes('--benchmark');
const baselineDirectory = args.find(value => value.startsWith('--baseline='))?.slice('--baseline='.length);
let baselineUrl;
if (baselineDirectory)
{
  const directory = resolve(root, baselineDirectory);
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
  for (const file of manifest.files)
    assert.equal(createHash('sha256').update(readFileSync(resolve(directory, file.name))).digest('hex'), file.sha256, 'Independent Software baseline checksum');
  baselineUrl = '/' + baselineDirectory.replaceAll('\\', '/') + '/ba-click-fx.js';
}
const output = resolve(root, 'test-results/software-optimization');
mkdirSync(output, { recursive: true });
const cases = [
  { name: 'coverage', config: { outputCompositing: 'browser-overlay' } },
  { name: 'visual-max', config: { outputCompositing: 'browser-overlay', overlayAlphaPolicy: 'visual-max' } },
  { name: 'bright-core', config: { outputCompositing: 'browser-overlay', overlayColorCompensation: 'bright-core' } },
  { name: 'alpha-one', config: { outputCompositing: 'browser-overlay', overlayAlphaLimit: 1 } },
  { name: 'alpha-one-default', config: { outputCompositing: 'browser-overlay', overlayAlphaLimit: 1 }, deterministicCanvas: false },
  { name: 'alpha-low', config: { outputCompositing: 'browser-overlay', overlayAlphaLimit: 0.4 } },
  { name: 'scene', config: { outputCompositing: 'scene' } },
  { name: 'reference', config: { outputCompositing: 'browser-overlay' }, reference: true },
  { name: 'single-level', config: { outputCompositing: 'browser-overlay' }, fxParams: { 'bloom.diffusion': 1 } },
  { name: 'empty', config: { outputCompositing: 'browser-overlay' }, fxParams: { 'bloom.threshold': 100 } },
  { name: 'cold-zero', config: { outputCompositing: 'browser-overlay' }, fxParams: { 'bloom.intensity': 0 } },
];
const results = [];
let browser;
let vite;
let complete = false;
try
{
  const runtime = await startViteServer(root);
  vite = runtime.server;
  await vite.watcher.close();
  browser = await chromium.launch({ executablePath: findChromiumExecutable(), headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
  const run = async parameters =>
  {
    const page = await browser.newPage();
    try
    {
      await page.goto(runtime.baseUrl + '/test/browser/custom.html');
      if (parameters.profile.runtime === 'worker') return await page.evaluate(parameters => new Promise((done, fail) =>
      {
        const source = `import { runCustomFixture } from ${JSON.stringify(location.origin + '/test/browser/custom-fixture.js')};
          onmessage = async event => { try { postMessage(await runCustomFixture(event.data)); } catch(error) { postMessage({ error: error.stack }); } };`;
        const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(url, { type: 'module' });
        const canvas = document.createElement('canvas').transferControlToOffscreen();
        const cleanup = () => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); };
        const timer = setTimeout(() => { cleanup(); fail(Error('Software Worker timeout')); }, 30000);
        worker.onerror = error => { cleanup(); fail(Error(error.message)); };
        worker.onmessage = event => { cleanup(); event.data.error ? fail(Error(event.data.error)) : done(event.data); };
        worker.postMessage({ ...parameters, targetCanvas: canvas }, [canvas]);
      }), parameters);
      return await page.evaluate(async parameters =>
        (await import('/test/browser/custom-fixture.js')).runCustomFixture(parameters), parameters);
    }
    finally { await page.close(); }
  };
  for (const dpr of benchmark ? [1] : [1, 2])
  {
    for (const entry of benchmark ? cases.slice(0, 1) : cases)
    {
      const profile = normalizeProfile({ backend: 'software', runtime: 'manual',
        config: { hostCompositing: 'source-over', maxDpr: dpr, ...entry.config },
        fxParams: { ...entry.fxParams, ...(benchmark ? { 'bloom.intensity': 0 } : {}) } });
      const deterministicCanvas = entry.deterministicCanvas ?? !benchmark;
      const parameters = { profile, full: true, reference: entry.reference, benchmark,
        deterministicCanvas, softwareOptimization: !benchmark, softwareZero: !benchmark };
      const baseline = baselineUrl && await run({ ...parameters, url: baselineUrl });
      const candidate = await run({ ...parameters, url: args.includes('--source') ? '/src/fx.js' : '/dist/ba-click-fx.js' });
      results.push({ case: entry.name, dpr, deterministicCanvas, candidate, baseline });
      assert.deepEqual(candidate.errors, []);
      if (baseline) assert.equal(candidate.hash, baseline.hash, `${entry.name}/${dpr}: independent pixels`);
      if (!benchmark)
      {
        for (const [index, stage] of candidate.softwareZero.entries())
        {
          assert.equal(stage.allocations, 0, 'Intensity changes retain Software allocations');
          assert(stage.buffersReused, 'Intensity changes retain Software buffer identity');
          if (stage.intensity === 0) assert.equal(stage.laterPlans, 0, 'Zero strength skips all later sampling stages');
          else if (entry.name !== 'empty') assert(stage.laterPlans > 0, 'Positive strength restores the pyramid');
          if (entry.name !== 'empty') assert.equal(stage.prefilterPlans, 1, 'Keep prefilter activity and Canvas submission semantics');
          if (baseline)
          {
            const old = baseline.softwareZero[index];
            assert.equal(stage.hash, old.hash, `${entry.name}/${dpr}/zero-${index}: independent pixels`);
            assert.equal(stage.reads, old.reads, 'Zero shortcut retains required readbacks');
            assert.deepEqual(stage.outputBounds, old.outputBounds, 'Zero output preserves dirty bounds');
          }
        }
        assert.equal(candidate.softwareZero[0].hash, candidate.softwareZero[3].hash, 'Positive Software restoration');
        for (const [index, stage] of candidate.softwareOptimization.entries())
        {
          if (baseline) assert.equal(stage.hash, baseline.softwareOptimization[index].hash, `${entry.name}/${dpr}/${stage.name}: independent pixels`);
          if (stage.name === 'emission-failure') assert.equal(stage.resolvedBloomBackend, 'native', 'Readback fault must retain Native fallback');
        }
        const normal = candidate.softwareOptimization[0];
        if (entry.name === 'coverage') assert.equal(normal.reads.total.calls, 4, 'Default Software frame needs four readbacks');
        if (['coverage', 'visual-max', 'alpha-low'].includes(entry.name))
        {
          assert.equal(normal.reads.finalFrameStages.frameFinalize.calls, 0, 'Completed Alpha needs no duplicate final readback');
          for (const stage of candidate.softwareOptimization.slice(1, 3))
            assert.equal(stage.reads.finalFrameStages.frameFinalize.calls, 1, 'Failure or state change must restore final readback');
          assert.equal(candidate.softwareOptimization[1].reads.total.failures, 1, 'Alpha readback fault was exercised');
        }
        if (entry.name === 'bright-core') assert.equal(normal.reads.finalFrameStages.frameFinalize.calls, 1, 'Bright-core still needs color compensation');
        if (entry.name.startsWith('alpha-one')) assert.equal(normal.reads.finalFrameStages.regionAlpha.calls, deterministicCanvas ? 0 : 1,
          'Alpha 255 skips explicit readback contexts and preserves default Canvas raster behavior');
        console.log(`Software optimization: ${entry.name} DPR=${dpr} passed`);
      }
    }
    if (!benchmark)
    {
      // 所有零强度策略在默认 Canvas 再对照一次，不能用频繁回读掩盖栅格差异。
      for (const entry of cases.filter(entry => !['alpha-one-default', 'empty', 'cold-zero'].includes(entry.name)))
      {
        const profile = normalizeProfile({ backend: 'software', runtime: 'manual',
          config: { hostCompositing: 'source-over', maxDpr: dpr, ...entry.config }, fxParams: entry.fxParams });
        const parameters = { profile, full: true, reference: entry.reference, deterministicCanvas: false, softwareZero: true };
        const baseline = baselineUrl && await run({ ...parameters, url: baselineUrl });
        const candidate = await run({ ...parameters, url: args.includes('--source') ? '/src/fx.js' : '/dist/ba-click-fx.js' });
        for (const [index, stage] of candidate.softwareZero.entries())
        {
          if (stage.intensity === 0) assert.equal(stage.laterPlans, 0);
          if (baseline) assert.equal(stage.hash, baseline.softwareZero[index].hash, `default Canvas/${entry.name}/${dpr}/${index}`);
        }
        results.push({ case: entry.name, dpr, deterministicCanvas: false, candidate, baseline });
      }
    }
  }
  if (!benchmark)
  {
    for (const runtime of ['manual', 'worker'])
    {
      const input = { backend: 'software', runtime, config: { outputCompositing: 'browser-overlay' },
        fxParams: { 'bloom.intensity': 0 } };
      const { info: profile, url } = buildCustomFixture(input);
      const parameters = { profile, deterministicCanvas: true, softwareZero: true };
      const baseline = await run({ ...parameters, url: args.includes('--source') ? '/src/fx.js' : '/dist/ba-click-fx.js', full: true });
      const candidate = await run({ ...parameters, url });
      assert.equal(candidate.hash, baseline.hash, 'First zero frame in a fixed Software build');
      assert.equal(candidate.softwareZero[0].laterPlans, 0);
      assert.equal(candidate.softwareZero[0].prefilterPlans, 1);
      results.push({ case: 'fixed-zero', runtime, candidate, baseline });
    }
    for (const runtime of ['manual', 'worker'])
    {
      const input = { backend: 'software', runtime,
        config: { hostCompositing: 'source-over', outputCompositing: 'browser-overlay', overlayAlphaPolicy: 'visual-max' } };
      const { info: profile, url: customUrl } = buildCustomFixture(input);
      const parameters = { profile, deterministicCanvas: true, softwareCache: true };
      const baseline = baselineUrl && await run({ ...parameters, url: baselineUrl, full: true });
      for (const [kind, url, full] of [['full', args.includes('--source') ? '/src/fx.js' : '/dist/ba-click-fx.js', true], ['custom', customUrl, false]])
      {
        const candidate = await run({ ...parameters, url, full });
        results.push({ case: 'cache', runtime, kind, candidate, baseline });
        assert.deepEqual(candidate.errors, []);
        const cache = candidate.softwareCache;
        assert.equal(cache.delay, 30000, 'Natural idle uses one 30 second timeout');
        assert(cache.small.floatBytes > 60 * 1024 * 1024, 'Large-to-small high water workload exercised');
        assert.equal(cache.active.floatBytes, cache.warm.floatBytes);
        assert.equal(cache.active.allocations, cache.warm.allocations, 'Stable frames retain allocations');
        assert.equal(cache.active.hash, cache.paused.hash, 'Paused visible frame preserved');
        assert.equal(cache.active.floatBytes, cache.paused.floatBytes, 'Paused visible frame retains resources');
        assert.equal(cache.idle.pendingTimers, 1);
        assert.equal(cache['before-deadline'].floatBytes, cache.idle.floatBytes, 'No early release');
        assert.equal(cache.resumed.pendingTimers, 0, 'Input cancels idle timeout');
        assert.equal(cache.resumed.allocations, cache.idle.allocations, 'Short input gaps reuse capacities');
        for (const state of [cache.released, cache.cleared, cache.destroyed])
          for (const key of ['floatBytes', 'canvasPixels', 'samplingBytes', 'outputBytes', 'auxiliaryPixels', 'pendingTimers'])
            assert.equal(state[key], 0, `${kind}/${runtime}: ${key} released`);
        assert(cache.released.available && cache.rebuilt.allocations > cache.released.allocations, 'First click rebuilds available renderer');
        assert(cache.failurePreserved && cache.destroyPending, 'Failure state retained and destroy cancels pending timeout');
        if (baseline)
        {
          assert.equal(candidate.hash, baseline.hash, 'Cache fixture initial independent pixels');
          for (const name of ['active', 'warm', 'paused', 'idle', 'before-deadline', 'resumed', 'released', 'rebuilt', 'cleared'])
            assert.equal(cache[name].hash, baseline.softwareCache[name].hash, `${kind}/${runtime}/${name}: independent pixels`);
        }
        console.log(`Software cache: ${kind}/${runtime} passed`);
      }
    }
  }
  complete = true;
}
finally
{
  writeFileSync(resolve(output, benchmark ? 'benchmark.json' : 'results.json'), JSON.stringify({ complete, benchmark, browser: browser?.version(), results }, null, 2));
  await closeBrowserRuntime({ browser, vite });
}
