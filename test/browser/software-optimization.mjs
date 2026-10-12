import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { normalizeProfile } from '../../scripts/build-profile.mjs';
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
  { name: 'alpha-low', config: { outputCompositing: 'browser-overlay', overlayAlphaLimit: 0.4 } },
  { name: 'scene', config: { outputCompositing: 'scene' } },
  { name: 'reference', config: { outputCompositing: 'browser-overlay' }, reference: true },
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
        config: { hostCompositing: 'source-over', maxDpr: dpr, ...entry.config } });
      const parameters = { profile, full: true, reference: entry.reference, benchmark,
        deterministicCanvas: !benchmark, softwareOptimization: !benchmark };
      const baseline = baselineUrl && await run({ ...parameters, url: baselineUrl });
      const candidate = await run({ ...parameters, url: args.includes('--source') ? '/src/fx.js' : '/dist/ba-click-fx.js' });
      results.push({ case: entry.name, dpr, candidate, baseline });
      assert.deepEqual(candidate.errors, []);
      if (baseline) assert.equal(candidate.hash, baseline.hash, `${entry.name}/${dpr}: independent pixels`);
      if (!benchmark)
      {
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
        if (entry.name === 'alpha-one') assert.equal(normal.reads.finalFrameStages.regionAlpha.calls, 0, 'Alpha 255 needs no regional readback');
      }
      console.log(`Software optimization: ${entry.name} DPR=${dpr} passed`);
    }
  }
  complete = true;
}
finally
{
  writeFileSync(resolve(output, benchmark ? 'benchmark.json' : 'results.json'), JSON.stringify({ complete, benchmark, browser: browser?.version(), results }, null, 2));
  await closeBrowserRuntime({ browser, vite });
}
