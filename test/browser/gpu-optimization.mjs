import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { normalizeProfile } from '../../scripts/build-profile.mjs';
import { buildCustomFixture } from '../custom-build-fixture.mjs';
import { closeBrowserRuntime, findChromiumExecutable, startViteServer } from './harness.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
assert(args.every(value => value === '--source' || value === '--benchmark' || value.startsWith('--baseline=')), 'Unknown GPU optimization option');
const baselineDirectory = args.find(value => value.startsWith('--baseline='))?.slice('--baseline='.length);
const benchmark = args.includes('--benchmark');
const candidateUrl = args.includes('--source') ? '/src/fx.js' : '/dist/ba-click-fx.js';
let baselineUrl;
if (baselineDirectory)
{
  const directory = resolve(root, baselineDirectory);
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
  const bytes = readFileSync(resolve(directory, 'ba-click-fx.js'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),
    manifest.full.files.find(file => file.name === 'ba-click-fx.js').sha256, 'Independent baseline checksum');
  baselineUrl = '/' + baselineDirectory.replaceAll('\\', '/') + '/ba-click-fx.js';
}
const output = resolve(root, 'test-results/gpu-optimization');
mkdirSync(output, { recursive: true });
const cases = [
  { name: 'scene', config: { outputCompositing: 'scene' } },
  { name: 'coverage', config: { outputCompositing: 'browser-overlay' } },
  { name: 'visual-max', config: { outputCompositing: 'browser-overlay', overlayAlphaPolicy: 'visual-max' } },
  { name: 'bright-core', config: { outputCompositing: 'browser-overlay', overlayColorCompensation: 'bright-core' } },
  { name: 'screen', config: { outputCompositing: 'browser-overlay', hostCompositing: 'screen' } },
  { name: 'reference', config: { outputCompositing: 'browser-overlay' }, reference: true },
  { name: 'cold-zero', config: { outputCompositing: 'browser-overlay' }, cold: true },
];
const results = [];
let browser;
let vite;
let complete = false;
let failure;
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
      const result = await page.evaluate(async parameters =>
      {
        if (parameters.profile.runtime !== 'worker')
          return (await import('/test/browser/custom-fixture.js')).runCustomFixture(parameters);
        return new Promise((done, fail) =>
        {
          const url = URL.createObjectURL(new Blob([`import { runCustomFixture } from ${JSON.stringify(location.origin + '/test/browser/custom-fixture.js')};
            onmessage = async event => { try { postMessage(await runCustomFixture(event.data)); } catch(error) { postMessage({ error: error.stack }); } };`], { type: 'text/javascript' }));
          const worker = new Worker(url, { type: 'module' });
          const finish = (value, error) =>
          { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); error ? fail(Error(error)) : done(value); };
          const timer = setTimeout(() => finish(null, 'GPU cache Worker timeout'), 30000);
          worker.onmessage = event => finish(event.data, event.data.error);
          worker.onerror = error => finish(null, error.message);
          const canvas = document.createElement('canvas').transferControlToOffscreen();
          worker.postMessage({ ...parameters, targetCanvas: canvas }, [canvas]);
        });
      }, parameters);
      assert(!result.skipped, result.skipped);
      assert.deepEqual(result.errors, []);
      return result;
    }
    finally { await page.close(); }
  };
  for (const backend of ['webgl2', 'webgpu', 'webgl2-bloom'])
  {
    for (const entry of benchmark ? [
      { ...cases[1], name: 'coverage-zero', intensity: 0 },
      { ...cases[1], name: 'coverage-positive', intensity: 1.7 },
    ] : cases)
    {
      const input = { backend, runtime: 'dom',
        config: { hostCompositing: 'source-over', maxDpr: 2, ...entry.config },
        fxParams: { 'bloom.clickEmissionScale': 2, ...(benchmark ? { 'bloom.intensity': entry.intensity }
          : entry.cold ? { 'bloom.intensity': 0 } : {}) } };
      const profile = normalizeProfile(input);
      const parameters = { profile, full: true, reference: entry.reference,
        restoreContext: !benchmark && backend === 'webgl2' && entry.name === 'coverage',
        gpuOptimization: !benchmark, benchmark };
      const baseline = baselineUrl && await run({ ...parameters, url: baselineUrl });
      const candidate = await run({ ...parameters, url: candidateUrl });
      results.push({ backend, case: entry.name, candidate, baseline });
      if (!benchmark)
      {
        const probe = candidate.gpuOptimization;
        if (!entry.cold) assert(probe.initiallyLazy, 'Zero texture must not be allocated for positive intensity');
        else assert.equal(probe.initialScaledSource, false, 'First zero frame must not allocate a scaled Bloom source');
        assert.equal(probe.initialCoverage, !['scene', 'screen'].includes(entry.name), 'Coverage is allocated only for its consumer');
        if (entry.cold) assert.equal(probe.initialLevelCount, 0, 'Cold zero intensity has no pyramid');
        assert.equal(probe.integrityChecks, 3 + Number(probe.initialCoverage) + Number(backend === 'webgpu'),
          'Every allocated target must reject incomplete resources');
        for (const [index, stage] of probe.intensity.entries())
        {
          assert.equal(stage.bloomPasses === 0, stage.intensity === 0, `${backend}: filter pass routing`);
          assert.equal(stage.allocations, 0, 'Intensity changes must reuse targets');
          assert(stage.targetsReused);
          assert.equal(stage.sourceDraws, stage.intensity > 0 || stage.omitBloomFlag ? 1 : 0, 'Scaled source draw routing');
          assert.equal(stage.sourceReady, stage.sourceDraws > 0, 'No stale scaled source readiness');
          assert(stage.sourceReused && stage.sourceAllocations === 0, 'Scaled source survives zero strength');
          if (baseline) assert.equal(stage.hash, baseline.gpuOptimization.intensity[index].hash, `${backend}/${entry.name}: independent pixel parity`);
        }
        assert.equal(probe.intensity[0].hash, probe.intensity[3].hash, 'Restored positive intensity pixels');
        for (const [index, stage] of (probe.demand ?? []).entries())
        {
          assert.equal(stage.coverage, index > 0, 'Coverage starts absent and is retained after first use');
          assert.equal(stage.levels > 0, index >= 3, 'Pyramid starts absent and is retained after first positive intensity');
          assert(stage.sourceReused && stage.coverageReused && stage.pyramidReused, 'Optional allocation preserves existing resources');
          if (baseline) assert.equal(stage.hash, baseline.gpuOptimization.demand[index].hash, 'Compositing transitions match independent baseline');
        }
        if (entry.cold)
        {
          const { info: fixed, url } = buildCustomFixture(input);
          const custom = await run({ profile: fixed, url });
          assert.equal(custom.hash, candidate.hash, 'Fixed zero-strength build pixel parity');
        }
        for (const [index, stage] of probe.layout.entries())
        {
          assert.equal(stage.targetsReused, stage.reuse, `${backend}/${stage.name}: target identity`);
          assert.equal(stage.allocations, stage.reuse ? 0 : 1, `${backend}/${stage.name}: allocation count`);
          if (baseline)
          {
            const previous = baseline.gpuOptimization.layout[index];
            assert.equal(stage.hash, previous.hash, `${backend}/${entry.name}/${stage.name}: independent pixel parity`);
            assert.equal(stage.sampleScale, previous.sampleScale, 'Fractional parameters must update sampling');
            assert.equal(stage.levelCount, previous.levelCount, 'Effective pyramid level count');
          }
        }
        if (parameters.restoreContext)
        {
          assert.equal(candidate.contextRestored, 'passed');
          assert(probe.zeroTextureRestored && probe.zeroTextureReleased, 'Zero texture lifecycle');
          if (baseline) assert.equal(probe.restoredHash, baseline.gpuOptimization.restoredHash);
        }
      }
      else if (baseline) assert.equal(candidate.hash, baseline.hash, 'Benchmark workload pixel parity');
      console.log(`${backend}/${entry.name}: passed${baseline ? ', independent baseline matched' : ''}`);
    }
  }
  if (!benchmark)
  {
    const backends = ['webgl2', 'webgpu', 'webgl2-bloom'];
    const cacheCases = backends.flatMap(backend => ['scene', 'coverage', 'reference'].map(mode =>
      ({ backend, runtime: 'dom', full: true, mode })));
    cacheCases.push({ backend: 'webgl2', runtime: 'worker', full: true, mode: 'coverage' });
    cacheCases.push(...backends.flatMap(backend => (backend === 'webgl2-bloom' ? ['dom'] : ['dom', 'worker']).map(runtime =>
      ({ backend, runtime, full: false, mode: 'coverage' }))));
    const baselineManifest = baselineDirectory && JSON.parse(readFileSync(resolve(root, baselineDirectory, 'manifest.json'), 'utf8'));
    for (const entry of cacheCases)
    {
      const input = { backend: entry.backend, runtime: entry.runtime,
        config: { hostCompositing: 'source-over', maxDpr: 2, outputCompositing: entry.mode === 'scene' ? 'scene' : 'browser-overlay' },
        fxParams: { 'bloom.clickEmissionScale': 2, 'bloom.intensity': entry.full ? 1.7 : 0 } };
      const profile = normalizeProfile(input);
      const url = entry.full ? candidateUrl : buildCustomFixture(input).url;
      const parameters = { profile, full: entry.full, gpuCache: true, reference: entry.mode === 'reference' };
      const oldCustom = !entry.full && baselineManifest?.custom?.find(item => item.backend === entry.backend && item.runtime === entry.runtime);
      let oldUrl = entry.full ? baselineUrl : undefined;
      if (oldCustom)
      {
        const bytes = readFileSync(resolve(root, oldCustom.path, 'ba-click-fx.js'));
        assert.equal(createHash('sha256').update(bytes).digest('hex'), oldCustom.sha256, 'Independent custom baseline');
        assert.deepEqual(normalizeProfile(oldCustom.input), profile, 'Custom baseline uses the same profile');
        oldUrl = '/' + relative(root, resolve(root, oldCustom.path, 'ba-click-fx.js')).replaceAll('\\', '/');
      }
      const baseline = oldUrl && await run({ ...parameters, url: oldUrl });
      const candidate = await run({ ...parameters, url });
      const probe = candidate.gpuCache;
      assert.equal(probe.delay, 30000);
      assert(probe.singleTimer && probe.otherPreserved && probe.destroyPending && probe.destroyed && probe.failurePreserved);
      assert(probe.geometryReused && probe.switchRetainedGeometry && probe.glBindingsRetained && probe.retiredTimer);
      assert.equal(probe.active.geometryCpuBytes, probe.paused.geometryCpuBytes);
      assert.equal(probe.active.geometryGpuBytes, probe.paused.geometryGpuBytes);
      assert.equal(probe.idle.geometryCpuBytes, probe['before-deadline'].geometryCpuBytes);
      assert(probe.burst.geometryCpuBytes > probe.active.geometryCpuBytes);
      for (const state of [probe.released, probe['clear-released'], probe['burst-released'], probe['retired-released'], probe.failedResources, probe.destroyedGeometry])
      {
        assert.equal(state.geometryCpuBytes, 0, '空闲或销毁归还 CPU 几何容量');
        assert.equal(state.geometryGpuBytes, 0, '空闲或销毁归还 GPU 几何存储');
      }
      assert.equal(probe.active.targetBytes, probe.paused.targetBytes, 'Visible pause retains resources');
      assert.equal(probe.active.hash, probe.paused.hash, 'Visible pause retains pixels');
      assert.equal(probe.idle.targetBytes, probe['before-deadline'].targetBytes);
      assert(!probe.resumed.pending && probe.resumed.targetBytes > 0, 'Interaction cancels stale idle callback');
      for (const name of ['released', 'clear-released'])
      {
        assert.equal(probe[name].targetCount, 0);
        assert.equal(probe[name].uniformCount, 0);
        assert.equal(probe[name].bindGroups, 0);
        assert(!probe[name].pending);
      }
      assert.deepEqual(probe.idle.status, probe.released.status, 'Idle release preserves presentation and backend state');
      assert.equal(probe.idle.animationFrame, probe.released.animationFrame, 'Idle release does not request RAF');
      assert(probe.rebuilt.targetBytes > 0 && probe.cleared.pending);
      assert.equal(probe.failedResources.targetCount, 0, 'Failed backend can release resources without being revived');
      if (baseline)
      {
        assert.equal(candidate.hash, baseline.hash);
        for (const name of ['active', 'paused', 'idle', 'before-deadline', 'resumed', 'released', 'rebuilt', 'cleared', 'clear-released', 'burst', 'burst-released', 'burst-rebuilt', 'retired-released', 'retired-rebuilt'])
          assert.equal(probe[name].hash, baseline.gpuCache[name].hash, `${entry.backend}/${name}: independent cache pixel parity`);
      }
      results.push({ cache: entry, candidate, baseline });
      console.log(`GPU cache ${entry.backend}/${entry.runtime}/${entry.full ? 'full' : 'custom'}/${entry.mode}: passed`);
    }
  }
  complete = true;
}
catch (error)
{
  failure = error.stack;
  console.error(failure);
  process.exitCode = 1;
}
finally
{
  await closeBrowserRuntime({ browser, vite });
  writeFileSync(resolve(output, benchmark ? 'benchmark.json' : 'results.json'),
    JSON.stringify({ complete, failure, candidateUrl, baselineUrl, benchmark, results }, null, 2) + '\n');
}
