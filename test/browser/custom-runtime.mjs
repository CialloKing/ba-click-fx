import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { BACKENDS, RUNTIMES } from '../../scripts/build-profile.mjs';
import { findChromiumExecutable, startViteServer } from './harness.mjs';

const root = resolve(import.meta.dirname, '../..');
const dir = resolve(root, 'test-results/custom-browser');
mkdirSync(dir, { recursive: true });
const vite = await startViteServer(root);
const browser = await chromium.launch({ executablePath: findChromiumExecutable(), headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-precise-memory-info'] });
const results = [];
let complete = false;
const profiles = BACKENDS.flatMap(backend => RUNTIMES.map(runtime => ({ backend, runtime })));
profiles.push(...['click', 'trail', 'shards', 'bloom', 'compositingReference'].map(feature => ({
  backend: 'webgl2', runtime: 'manual', features: { [feature]: false },
})));
profiles.push(...BACKENDS.map(backend => ({ backend, runtime: 'manual',
  config: { themeColor: '#e178bd', themeColorMode: 'hue-only', opacity: 0.78, outputCompositing: 'browser-overlay', overlayAlphaPolicy: 'visual-max' },
  fxParams: { 'hit.enabled': true, 'flare.enabled': true, 'shards.roundness': 0.35, 'bloom.intensity': 2.1 },
})));
profiles.push(...['native', 'webgl2', 'webgpu-hdr'].flatMap(backend => RUNTIMES.map(runtime => ({ backend, runtime, testReference: true }))));
profiles.push(...BACKENDS.filter(backend => backend !== 'webgl2').flatMap(backend => ['trail', 'bloom'].map(feature => ({
  backend, runtime: 'manual', features: { [feature]: false },
}))));
profiles.push(...BACKENDS.map(backend => ({ backend, runtime: 'manual', features: { trail: false }, fxParams: { 'flare.enabled': true } })));
profiles.push({ backend: 'webgl2', runtime: 'manual', config: { maxDpr: 2 } });
profiles.push(...BACKENDS.filter(backend => backend !== 'webgl2').flatMap(backend => ['click', 'shards'].map(feature => ({
  backend, runtime: 'manual', features: { [feature]: false },
}))));
for (const name of ['native-click-dom', 'webgl2-worker'])
  profiles.push(JSON.parse(readFileSync(resolve(root, `examples/build-profiles/${name}.json`), 'utf8')));
const selection = process.argv[2];
async function run(page, args, worker)
{
  if (!worker) return page.evaluate(async args => (await import('/test/browser/custom-fixture.js')).runCustomFixture(args), args);
  return page.evaluate(args => new Promise((done, fail) =>
  {
    const source = `import {runCustomFixture} from ${JSON.stringify(location.origin + '/test/browser/custom-fixture.js')};
      onmessage = async event => { try { postMessage(await runCustomFixture(event.data)); } catch(error) { postMessage({ error: error.stack }); } };`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url, { type: 'module' });
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const offscreen = canvas.transferControlToOffscreen();
    const cleanup = () => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); };
    const timer = setTimeout(() => { cleanup(); fail(Error('Worker fixture timeout')); }, 30000);
    worker.onerror = error => { cleanup(); fail(Error(error.message)); };
    worker.onmessage = event => { cleanup(); event.data.error ? fail(Error(event.data.error)) : done(event.data); };
    worker.postMessage({ ...args, targetCanvas: offscreen }, [offscreen]);
  }), args);
}
try
{
  for (const [index, entry] of profiles.entries())
  {
    if (selection && (/^\d+$/.test(selection) ? index < Number(selection) : !JSON.stringify(entry).includes(selection))) continue;
    const { testReference = false, ...input } = entry;
    const profilePath = resolve(dir, 'profile.json');
    writeFileSync(profilePath, JSON.stringify(input));
    execFileSync(process.execPath, ['scripts/build.mjs', '--profile', profilePath], { cwd: root, stdio: 'pipe' });
    const file = `custom-${index}.js`;
    copyFileSync(resolve(root, 'dist-custom/ba-click-fx.js'), resolve(dir, file));
    const profile = JSON.parse(readFileSync(resolve(root, 'dist-custom/build-info.json'), 'utf8'));
    const page = await browser.newPage();
    await page.goto(vite.baseUrl + '/test/browser/custom.html');
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.log(message.text()); });
    const baseProfile = !input.features && !input.config && !input.fxParams && !testReference;
    // 压测会影响同页后续 Canvas 的栅格路径；独立上下文同时保证冷导入和像素对照隔离。
    const baselinePage = await browser.newPage();
    await baselinePage.goto(vite.baseUrl + '/test/browser/custom.html');
    baselinePage.on('pageerror', error => errors.push(error.message));
    const baseArgs = { profile, url: vite.baseUrl + '/dist/ba-click-fx.js', full: true, reference: testReference, gpuPerformance: baseProfile };
    const baseline = await run(baselinePage, baseArgs, input.runtime === 'worker' && !['webgpu', 'webgpu-hdr', 'webgl2-bloom'].includes(input.backend) && !(testReference && input.backend === 'native'));
    await baselinePage.close();
    const args = { profile, url: vite.baseUrl + '/test-results/custom-browser/' + file, reference: testReference,
      restoreContext: baseProfile && input.backend === 'webgl2', gpuPerformance: baseProfile };
    const custom = await run(page, args, input.runtime === 'worker');
    assert.deepEqual(errors, []);
    results.push({ input, reference: testReference, baseline, custom, sizes: profile.sizes });
    if (!baseline.skipped && !custom.skipped)
    {
      assert(custom.lit > 0, `${input.backend}/${input.runtime} empty output`);
      assert.equal(custom.hash, baseline.hash, `exact pixel parity: ${JSON.stringify(input)}`);
      for (const measurement of [baseline, custom])
      {
        assert(measurement.importMs > 0 && measurement.initMs > 0, 'native performance clock');
        assert.equal(measurement.cpuFrameMs.length, 90);
        assert(measurement.cpuFrameMs.some(time => time > 0));
      }
    }
    else console.log(`SKIP ${input.backend}/${input.runtime}: ${baseline.skipped ?? custom.skipped}`);
    if (input.runtime === 'worker' && input.backend === 'webgpu' && !testReference && !custom.skipped)
    {
      assert.deepEqual(await run(page, { ...args, pendingDestroy: true }, true), { pendingDestroy: true });
      const loss = await run(page, { ...args, deviceLost: true }, true);
      assert.deepEqual(loss.errors, ['device-lost']); assert(loss.stopped); assert.equal(loss.outputMode, 'unavailable');
    }
    if (baseProfile && input.runtime === 'worker')
    {
      const failure = await run(page, { ...args, restoreContext: false, fault: input.backend.startsWith('webgpu') ? 'gpu' : 'context' }, true);
      assert.deepEqual(failure.errors, ['initialization-failed']); assert(failure.stopped);
      results.at(-1).initializationFailure = failure;
    }
    if (baseProfile && input.backend === 'webgpu-hdr' && input.runtime === 'worker' && !custom.skipped)
    {
      const standard = await run(page, { ...args, forceStandard: true }, true);
      assert.deepEqual(standard.errors, []);
      assert.equal(standard.config.resolvedEffectBackend, 'webgpu');
      assert.equal(standard.config.resolvedWebGPUOutputMode, 'standard');
      results.at(-1).standardFallback = 'passed';
    }
    console.log(`custom runtime checked: ${JSON.stringify(input)} pixels=${custom.lit ?? 'skipped'}`);
    await page.close();
  }
  complete = true;
}
finally
{
  const full = readFileSync(resolve(root, 'dist/ba-click-fx.js'));
  writeFileSync(resolve(dir, 'results.json'), JSON.stringify({ browser: browser.version(), selection: selection ?? null,
    gpu: 'Browser default adapter; headless RAF with GPU completion measured; physical display FPS and HDR unverified',
    memory: 'Heap snapshots where exposed; Worker heap is unavailable and reported as null',
    acceptance: { complete, pixelPassed: results.filter(item => !item.baseline.skipped && !item.custom.skipped).length,
      pixelSkipped: results.filter(item => item.baseline.skipped || item.custom.skipped).map(item => ({ input: item.input, reason: item.baseline.skipped ?? item.custom.skipped })) },
    fullSizes: { raw: full.length, gzip: gzipSync(full).length, brotli: brotliCompressSync(full).length }, results }, null, 2));
  await browser.close(); await vite.server.close();
}
