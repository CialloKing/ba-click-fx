import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeBrowserRuntime, findChromiumExecutable, startViteServer } from './harness.mjs';
import { normalizeProfile } from '../../scripts/build-profile.mjs';
import { buildCustomFixture, withCustomBuildSession } from '../custom-build-fixture.mjs';
import { isMain } from '../cli.mjs';

export async function runCanvasTextureCache(args = [])
{
  const output = resolve('test-results/shared-canvas-cache');
  mkdirSync(output, { recursive: true });
  let browser, vite;
  let complete = false;
  const results = [];
  assert(args.every(value => value === '--source' || value.startsWith('--baseline=')));
  const baseline = args.find(value => value.startsWith('--baseline='))?.slice('--baseline='.length);
  if (baseline)
  {
    for (const file of JSON.parse(readFileSync(resolve(baseline, 'manifest.json'), 'utf8')).files)
      assert.equal(createHash('sha256').update(readFileSync(resolve(baseline, file.name))).digest('hex'), file.sha256);
  }
  try
  {
    const runtime = await startViteServer(resolve('.')); vite = runtime.server;
    await vite.watcher.close();
    browser = await chromium.launch({ executablePath: findChromiumExecutable(), headless: true });
    for (const worker of [false, true])
    {
      const page = await browser.newPage();
      try
      {
        await page.goto(runtime.baseUrl + '/test/browser/custom.html');
        const result = await page.evaluate(async worker =>
        {
          if (!worker) return (await import('/test/browser/canvas-texture-probe.js')).probeCanvasTextureCache();
          return new Promise((done, fail) =>
          {
            const url = URL.createObjectURL(new Blob([`import { probeCanvasTextureCache } from ${JSON.stringify(location.origin + '/test/browser/canvas-texture-probe.js')};
              probeCanvasTextureCache().then(result => postMessage({ result }), error => postMessage({ error: error.stack }));`], { type: 'text/javascript' }));
            const task = new Worker(url, { type: 'module' });
            const timer = setTimeout(() => finish(null, 'Cache Worker timeout'), 30000);
            const finish = (result, error) =>
            { clearTimeout(timer); task.terminate(); URL.revokeObjectURL(url); error ? fail(Error(error)) : done(result); };
            task.onmessage = event => finish(event.data.result, event.data.error);
            task.onerror = error => finish(null, error.message);
          });
        }, worker);
        assert.equal(result.released.bytes, 0); assert(result.reentered && result.failurePreserved);
        results.push({ worker, ...result });
        console.log(`Shared Canvas cache: ${worker ? 'Worker' : 'DOM'} passed`);
      }
      finally { await page.close(); }
    }
    const run = async parameters =>
    {
      const page = await browser.newPage();
      try
      {
        await page.goto(runtime.baseUrl + '/test/browser/custom.html');
        return await page.evaluate(async parameters =>
        {
          if (parameters.profile.runtime !== 'worker')
            return (await import('/test/browser/custom-fixture.js')).runCustomFixture(parameters);
          return new Promise((done, fail) =>
          {
            const url = URL.createObjectURL(new Blob([`import { runCustomFixture } from ${JSON.stringify(location.origin + '/test/browser/custom-fixture.js')};
              onmessage = event => runCustomFixture(event.data).then(result => postMessage({ result }), error => postMessage({ error: error.stack }));`], { type: 'text/javascript' }));
            const task = new Worker(url, { type: 'module' });
            const canvas = document.createElement('canvas').transferControlToOffscreen();
            const timer = setTimeout(() => finish(null, 'Pixel Worker timeout'), 30000);
            const finish = (result, error) =>
            { clearTimeout(timer); task.terminate(); URL.revokeObjectURL(url); error ? fail(Error(error)) : done(result); };
            task.onmessage = event => finish(event.data.result, event.data.error);
            task.onerror = error => finish(null, error.message);
            task.postMessage({ ...parameters, targetCanvas: canvas }, [canvas]);
          });
        }, parameters);
      }
      finally { await page.close(); }
    };
    const compare = async (profile, options = {}, custom = false) =>
    {
      const parameters = { profile, canvasTextureIdle: true, ...options };
      const old = baseline && await run({ ...parameters, full: true, url: '/' + baseline.replaceAll('\\', '/') + '/ba-click-fx.js' });
      const url = custom ? buildCustomFixture({ backend: profile.backend, runtime: profile.runtime,
        config: { outputCompositing: 'browser-overlay', maxDpr: 2 }, fxParams: { 'shards.roundness': 0.5 } }).url
        : args.includes('--source') ? '/src/fx.js' : '/dist/ba-click-fx.js';
      const candidate = await run({ ...parameters, full: !custom, url });
      assert.deepEqual(candidate.errors, []);
      assert.equal(candidate.canvasTextureIdle[0].hash, candidate.canvasTextureIdle[1].hash, 'Paused pixels retained');
      if (old)
      {
        assert.equal(candidate.hash, old.hash, 'Independent initial pixels');
        assert.deepEqual(candidate.canvasTextureIdle, old.canvasTextureIdle, 'Independent idle and rebuilt pixels');
      }
      results.push({ backend: profile.backend, runtime: profile.runtime, custom, options, candidate, baseline: old });
      console.log(`Canvas cache pixels: ${profile.backend}/${profile.runtime}/${custom ? 'custom' : 'full'} passed`);
    };
    for (const backend of ['software', 'native'])
    {
      for (const maxDpr of [1, 2])
      for (const config of [{}, { overlayAlphaPolicy: 'visual-max' },
        { overlayColorCompensation: 'bright-core', overlayAlphaLimit: 0.4, themeColor: '#7f4dc4' }])
        await compare(normalizeProfile({ backend, runtime: 'manual',
          config: { outputCompositing: 'browser-overlay', maxDpr, ...config }, fxParams: { 'shards.roundness': 0.5 } }));
      const profile = normalizeProfile({ backend, runtime: 'manual',
        config: { outputCompositing: 'browser-overlay', maxDpr: 2 }, fxParams: { 'shards.roundness': 0.5 } });
      await compare(profile, { deterministicCanvas: true, reference: true });
      for (const runtime of ['manual', 'worker'])
        await compare({ ...profile, runtime }, {}, true);
    }
    complete = true;
  }
  finally
  {
    writeFileSync(resolve(output, 'behavior.json'), JSON.stringify({ complete, results }, null, 2) + '\n');
    await closeBrowserRuntime({ browser, vite });
  }
}

if (isMain(import.meta))
{
  await withCustomBuildSession(() => runCanvasTextureCache(process.argv.slice(2)));
}
