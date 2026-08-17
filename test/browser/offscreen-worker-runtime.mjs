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

async function inspectScreenshot(page, screenshot)
{
  return page.evaluate(async (base64) =>
  {
    const image = new Image();

    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');

    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    let visiblePixels = 0;
    let maximumChannel = 0;
    let minimumX = image.width;
    let maximumX = -1;

    for (let index = 0; index < pixels.length; index += 4)
    {
      const energy = Math.max(
        pixels[index],
        pixels[index + 1],
        pixels[index + 2],
      );

      if (energy <= 8)
      {
        continue;
      }

      const pixelIndex = index / 4;
      const x = pixelIndex % image.width;

      visiblePixels++;
      maximumChannel = Math.max(maximumChannel, energy);
      minimumX = Math.min(minimumX, x);
      maximumX = Math.max(maximumX, x);
    }

    return {
      width: image.width,
      height: image.height,
      visiblePixels,
      maximumChannel,
      visibleWidth: maximumX >= minimumX ? maximumX - minimumX + 1 : 0,
    };
  }, screenshot.toString('base64'));
}

async function waitForScreenshotPixels(
  page,
  locator,
  predicate,
  timeout = 3000,
)
{
  const deadline = Date.now() + timeout;
  let pixels = null;

  // Software GPU startup can take several frames in CI. Poll the presented
  // canvas while retaining the same pixel thresholds and a bounded timeout.
  do
  {
    pixels = await inspectScreenshot(page, await locator.screenshot());
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
    const stage = page.locator('#stage');
    const clickPixels = await waitForScreenshotPixels(
      page,
      stage,
      (pixels) => pixels.visiblePixels > 50 && pixels.maximumChannel > 80,
    );

    assert.ok(clickPixels.visiblePixels > 50, JSON.stringify(clickPixels));
    assert.ok(clickPixels.maximumChannel > 80, JSON.stringify(clickPixels));
    const activeState = await page.evaluate(() =>
      window.offscreenWorkerTest.request('state'));

    assert.equal(activeState.resolvedEffectBackend, 'webgl2');

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
    const trailPixels = await waitForScreenshotPixels(
      page,
      stage,
      (pixels) => pixels.visiblePixels > 100 && pixels.visibleWidth > 180,
    );

    assert.ok(trailPixels.visiblePixels > 100, JSON.stringify(trailPixels));
    assert.ok(trailPixels.visibleWidth > 180, JSON.stringify(trailPixels));

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
    const resizedPixels = await waitForScreenshotPixels(
      page,
      stage,
      (pixels) => pixels.visiblePixels > 30,
    );

    assert.equal(resizedPixels.width, 200);
    assert.equal(resizedPixels.height, 120);
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
