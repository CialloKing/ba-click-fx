import assert from 'node:assert/strict';
import { accessSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';

const rootDir = resolve(import.meta.dirname, '../..');

function findExecutable()
{
  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;
  const candidates =
  [
    process.env.BACLICKFX_CHROMIUM_PATH,
    programFilesX86 && join(
      programFilesX86,
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    programFiles && join(
      programFiles,
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    localAppData && join(
      localAppData,
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    programFiles && join(
      programFiles,
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];

  for (const candidate of candidates)
  {
    if (!candidate)
    {
      continue;
    }

    try
    {
      accessSync(candidate, constants.X_OK);
      return candidate;
    }
    catch
    {
      // Continue with the next system browser candidate.
    }
  }

  return null;
}

async function getAvailablePort()
{
  const probe = createNetServer();

  await new Promise((resolvePromise, rejectPromise) =>
  {
    probe.once('error', rejectPromise);
    probe.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = probe.address();

  await new Promise((resolvePromise) => probe.close(resolvePromise));
  return port;
}

async function waitForWorkerPixels(
  page,
  predicate,
  timeout = 3000,
)
{
  const deadline = Date.now() + timeout;
  let pixels = null;

  // Poll inside the Worker because Edge headless screenshots do not reliably
  // composite a transferred OffscreenCanvas backed by software WebGL2.
  do
  {
    pixels = await page.evaluate(() =>
      window.offscreenWorkerTest.request('pixels'));
    if (predicate(pixels))
    {
      return pixels;
    }
    await page.waitForTimeout(25);
  }
  while (Date.now() < deadline);

  return pixels;
}

async function main()
{
  const executablePath = findExecutable();

  if (!executablePath)
  {
    throw new Error(
      'No Chrome or Edge found; set BACLICKFX_CHROMIUM_PATH for the OffscreenCanvas test',
    );
  }

  const port = await getAvailablePort();
  const vite = await createViteServer(
    {
      appType: 'spa',
      clearScreen: false,
      logLevel: 'error',
      root: rootDir,
      server:
      {
        host: '127.0.0.1',
        port,
        strictPort: true,
      },
    },
  );
  let browser = null;

  try
  {
    await vite.listen();
    browser = await chromium.launch(
      {
        executablePath,
        headless: true,
        args:
        [
          '--disable-background-networking',
          '--disable-extensions',
          '--force-color-profile=srgb',
          '--ignore-gpu-blocklist',
          '--use-angle=swiftshader',
        ],
      },
    );
    const page = await browser.newPage(
      { viewport: { width: 360, height: 280 } },
    );
    const browserErrors = [];

    page.on('console', (message) =>
    {
      if (message.type() === 'error' || message.type() === 'warning')
      {
        browserErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.goto(
      `http://127.0.0.1:${port}/test/browser/offscreen-worker.html`,
      { waitUntil: 'load' },
    );
    const ready = await page.evaluate(() => window.offscreenWorkerReady);

    assert.equal(ready.width, 320);
    assert.equal(ready.height, 240);
    assert.equal(ready.backingWidth, 320);
    assert.equal(ready.backingHeight, 240);
    assert.match(ready.resolvedEffectBackend, /^(pending|webgl2)$/);

    await page.waitForFunction(async () =>
    {
      const state = await window.offscreenWorkerTest.request('state');

      return state.resolvedEffectBackend === 'webgl2';
    }, null, { timeout: 5000 });

    await page.evaluate(() => window.offscreenWorkerTest.request(
      'boom',
      { x: 160, y: 120 },
    ));
    const clickPixels = await waitForWorkerPixels(
      page,
      (pixels) => pixels.visiblePixels > 50 && pixels.maximumChannel > 80,
    );

    assert.ok(clickPixels.visiblePixels > 50, JSON.stringify(clickPixels));
    assert.ok(clickPixels.maximumChannel > 80, JSON.stringify(clickPixels));
    const activeState = await page.evaluate(() =>
      window.offscreenWorkerTest.request('state'));

    assert.equal(activeState.resolvedEffectBackend, 'webgl2');
    let routeSwitchError = null;

    try
    {
      await page.evaluate(() =>
        window.offscreenWorkerTest.request(
          'updateConfig',
          {
            effectBackend: 'canvas2d',
          },
        ));
    }
    catch (error)
    {
      routeSwitchError = String(error?.message ?? error);
    }

    assert.match(
      routeSwitchError ?? '',
      /无法切换 OffscreenCanvas context 类型/,
    );
    const lockedRouteState = await page.evaluate(() =>
      window.offscreenWorkerTest.request('state'));

    assert.equal(lockedRouteState.effectBackend, 'webgl2');
    assert.equal(lockedRouteState.resolvedEffectBackend, 'webgl2');

    await page.waitForTimeout(750);
    await page.evaluate(async () =>
    {
      const api = window.offscreenWorkerTest;
      const pointerId = 7;

      await api.request('pointerDown',
        { x: 24, y: 210, pointerId, pointerType: 'mouse' });
      for (const [x, y] of [[80, 180], [145, 140], [215, 95], [296, 32]])
      {
        await api.request('pointerMove',
          { x, y, pointerId, pointerType: 'mouse' });
      }
      await api.request('pointerUp', { pointerId });
    });
    const trailPixels = await waitForWorkerPixels(
      page,
      (pixels) => pixels.visiblePixels > 100 && pixels.visibleWidth > 180,
    );

    assert.ok(trailPixels.visiblePixels > 100, JSON.stringify(trailPixels));
    assert.ok(trailPixels.visibleWidth > 180, JSON.stringify(trailPixels));

    await page.evaluate(() =>
      window.offscreenWorkerTest.request('clearTrail'));
    await page.waitForTimeout(750);
    const resized = await page.evaluate(() =>
      window.offscreenWorkerTest.resize(200, 120, 2));

    assert.equal(resized.width, 200);
    assert.equal(resized.height, 120);
    assert.equal(resized.dpr, 2);
    assert.equal(resized.backingWidth, 400);
    assert.equal(resized.backingHeight, 240);
    await page.evaluate(() => window.offscreenWorkerTest.request(
      'boom',
      { x: 100, y: 60 },
    ));
    const resizedPixels = await waitForWorkerPixels(
      page,
      (pixels) => pixels.visiblePixels > 30,
    );
    const stageSize = await page.locator('#stage').evaluate((canvas) =>
    {
      const rect = canvas.getBoundingClientRect();

      return { width: rect.width, height: rect.height };
    });

    assert.equal(stageSize.width, 200);
    assert.equal(stageSize.height, 120);
    assert.equal(resizedPixels.width, 400);
    assert.equal(resizedPixels.height, 240);
    assert.ok(resizedPixels.visiblePixels > 30, JSON.stringify(resizedPixels));

    const destroyed = await page.evaluate(() =>
      window.offscreenWorkerTest.request('destroy'));

    assert.equal(destroyed.destroyed, true);
    await page.evaluate(() => window.offscreenWorkerTest.terminate());
    assert.deepEqual(browserErrors, []);
    console.log('OffscreenCanvas DedicatedWorker browser test passed.');
  }
  finally
  {
    await browser?.close();
    await vite.close();
  }
}

main().catch((error) =>
{
  console.error(error);
  process.exitCode = 1;
});
