import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { closeBrowserRuntime, findChromiumExecutable, startViteServer } from './harness.mjs';

const output = resolve('test-results/shared-canvas-cache');
mkdirSync(output, { recursive: true });
let browser, vite;
const results = [];
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
}
finally
{
  writeFileSync(resolve(output, 'behavior.json'), JSON.stringify({ results }, null, 2) + '\n');
  await closeBrowserRuntime({ browser, vite });
}
