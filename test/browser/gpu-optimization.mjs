import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { normalizeProfile } from '../../scripts/build-profile.mjs';
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
        (await import('/test/browser/custom-fixture.js')).runCustomFixture(parameters), parameters);
      assert(!result.skipped, result.skipped);
      assert.deepEqual(result.errors, []);
      return result;
    }
    finally { await page.close(); }
  };
  for (const backend of ['webgl2', 'webgpu'])
  {
    for (const entry of benchmark ? cases.slice(1, 2) : cases)
    {
      const profile = normalizeProfile({ backend, runtime: 'dom',
        config: { hostCompositing: 'source-over', maxDpr: 2, ...entry.config },
        ...(benchmark ? { fxParams: { 'bloom.intensity': 0 } } : {}) });
      const parameters = { profile, full: true, reference: entry.reference,
        restoreContext: !benchmark && backend === 'webgl2' && entry.name === 'coverage',
        gpuOptimization: !benchmark, benchmark };
      const baseline = baselineUrl && await run({ ...parameters, url: baselineUrl });
      const candidate = await run({ ...parameters, url: candidateUrl });
      if (!benchmark)
      {
        const probe = candidate.gpuOptimization;
        assert(probe.initiallyLazy, 'Zero texture must not be allocated for positive intensity');
        for (const [index, stage] of probe.intensity.entries())
        {
          assert.equal(stage.bloomPasses === 0, stage.intensity === 0, `${backend}: filter pass routing`);
          assert.equal(stage.allocations, 0, 'Intensity changes must reuse targets');
          assert(stage.targetsReused);
          if (baseline) assert.equal(stage.hash, baseline.gpuOptimization.intensity[index].hash, `${backend}/${entry.name}: independent pixel parity`);
        }
        assert.equal(probe.intensity[0].hash, probe.intensity.at(-1).hash, 'Restored positive intensity pixels');
        if (parameters.restoreContext)
        {
          assert.equal(candidate.contextRestored, 'passed');
          assert(probe.zeroTextureRestored && probe.zeroTextureReleased, 'Zero texture lifecycle');
          if (baseline) assert.equal(probe.restoredHash, baseline.gpuOptimization.restoredHash);
        }
      }
      else if (baseline) assert.equal(candidate.hash, baseline.hash, 'Benchmark workload pixel parity');
      results.push({ backend, case: entry.name, candidate, baseline });
      console.log(`${backend}/${entry.name}: passed${baseline ? ', independent baseline matched' : ''}`);
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
