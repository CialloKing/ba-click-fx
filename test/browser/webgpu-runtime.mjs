import { accessSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';

const rootDir = resolve(import.meta.dirname, '../..');

function findExecutable()
{
  const candidates =
  [
    process.env.BACLICKFX_CHROMIUM_PATH,
    process.env['ProgramFiles(x86)'] && join(
      process.env['ProgramFiles(x86)'],
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    process.env.ProgramFiles && join(
      process.env.ProgramFiles,
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    process.env.ProgramFiles && join(
      process.env.ProgramFiles,
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
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
      // 继续查找下一个系统浏览器。
    }
  }

  return null;
}

async function getAvailablePort()
{
  const server = createNetServer();

  await new Promise((resolvePromise, rejectPromise) =>
  {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const { port } = server.address();

  await new Promise((resolvePromise) => server.close(resolvePromise));
  return port;
}

async function decodeScreenshot(page, screenshot)
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
    let maximum = 0;

    for (let index = 0; index < pixels.length; index += 4)
    {
      const energy = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);

      if (energy > 0)
      {
        visiblePixels++;
      }

      maximum = Math.max(maximum, energy);
    }

    return { visiblePixels, maximum };
  }, screenshot.toString('base64'));
}

const executablePath = findExecutable();

if (!executablePath)
{
  throw new Error('找不到用于 WebGPU 测试的 Chrome 或 Edge');
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
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist',
      ],
    },
  );
  const page = await browser.newPage(
    { viewport: { width: 320, height: 240 }, deviceScaleFactor: 1 },
  );
  const browserErrors = [];

  page.on('console', (message) =>
  {
    const text = message.text();
    const expectedAdapterWarning = text.includes(
      'powerPreference option is currently ignored',
    );

    if (
      message.type() === 'error' ||
      (message.type() === 'warning' && !expectedAdapterWarning)
    )
    {
      browserErrors.push(text);
    }
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/test/browser/webgpu.html`);
  const result = await page.evaluate(async () =>
  {
    const { WebGPUEffectRenderer } = await import(
      '/src/webgpu-effect.js'
    );
    const canvas = document.createElement('canvas');

    canvas.width = 320;
    canvas.height = 240;
    canvas.dataset.test = 'direct-webgpu';
    document.body.appendChild(canvas);
    const renderer = new WebGPUEffectRenderer(canvas);
    const ready = await renderer.ready;

    if (!ready)
    {
      return {
        ready,
        status: renderer.status,
        failure: String(renderer.failure?.message ?? renderer.failure ?? ''),
      };
    }

    const resized = renderer.resize(320, 240, 1, 0.5, 7);

    renderer.beginFrame();
    renderer.addSolidDisk(160, 120, 48, [4, 1, 0.25], 1, 64);
    renderer.addDissolveRing(
      160,
      120,
      72,
      12,
      0,
      4,
      96,
      [2, 4, 8],
      1,
      0.25,
      0,
      1,
      1,
    );
    const scene = renderer.renderScene(
      {
        outputCompositing: 'scene',
        hostCompositing: 'source-over',
        diskEmissionScale: 1,
        ringEmissionScale: 1,
      },
    );

    renderer.beginFrame({ preserveSceneStats: true });
    const rendered = renderer.render(
      {
        threshold: 0.9,
        softKnee: 0.5,
        clamp: 65472,
        intensity: 8,
        opacity: 1,
        outputCompositing: 'scene',
        overlayAlphaPolicy: 'coverage',
        overlayColorCompensation: 'none',
        overlayAlphaLimit: 250 / 255,
        hostCompositing: 'source-over',
      },
      { preserveCanvas: true },
    );

    await renderer.device.queue.onSubmittedWorkDone();
    return {
      ready,
      resized,
      scene,
      rendered,
      status: renderer.status,
      outputMode: renderer.deviceManager.outputMode,
      format: renderer.deviceManager.canvasFormat,
      stats: renderer.stats,
    };
  });

  if (!result.ready)
  {
    throw new Error(`WebGPU 初始化失败: ${JSON.stringify(result)}`);
  }

  if (!result.resized || !result.scene || !result.rendered)
  {
    throw new Error(`WebGPU 提交未完成: ${JSON.stringify(result)}`);
  }

  await page.waitForTimeout(100);
  const canvas = page.locator('canvas[data-test="direct-webgpu"]');
  const pixels = await decodeScreenshot(page, await canvas.screenshot());

  if (pixels.visiblePixels < 100 || pixels.maximum < 32)
  {
    throw new Error(`WebGPU Canvas 像素为空: ${JSON.stringify(pixels)}`);
  }

  const integration = await page.evaluate(async () =>
  {
    const { BAClickFX } = await import('/src/fx.js');
    const changes = [];
    const effect = new BAClickFX(
      {
        effectBackend: 'webgpu',
        inputSource: 'manual',
        maxDpr: 1,
      },
    );

    effect.canvas.addEventListener(
      'baclickfxeffectbackendchange',
      (event) => changes.push(event.detail.resolvedEffectBackend),
    );
    effect.boom(160, 120);
    const deadline = performance.now() + 4000;

    while (
      effect.getConfig().resolvedEffectBackend === 'pending' &&
      performance.now() < deadline
    )
    {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }

    const config = effect.getConfig();
    const initial =
    {
      requested: config.effectBackend,
      resolvedEffectBackend: config.resolvedEffectBackend,
      resolvedBloomBackend: config.resolvedBloomBackend,
      resolvedWebGPUOutputMode: config.resolvedWebGPUOutputMode,
      outputMode: effect.webgpuEffectRenderer?.deviceManager.outputMode,
      visible: effect.webgpuEffectVisible,
      changes,
    };

    effect.webgpuEffectRenderer.device.destroy();
    const fallbackDeadline = performance.now() + 4000;

    while (
      effect.getConfig().resolvedEffectBackend !== 'webgl2' &&
      performance.now() < fallbackDeadline
    )
    {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }

    const fallbackConfig = effect.getConfig();
    const fallback =
    {
      resolvedEffectBackend: fallbackConfig.resolvedEffectBackend,
      resolvedBloomBackend: fallbackConfig.resolvedBloomBackend,
      resolvedWebGPUOutputMode: fallbackConfig.resolvedWebGPUOutputMode,
      webglVisible: effect.webglEffectVisible,
      changes: [...changes],
    };

    effect.destroy();
    return { initial, fallback };
  });

  if (
    integration.initial.requested !== 'webgpu' ||
    integration.initial.resolvedEffectBackend !== 'webgpu' ||
    integration.initial.resolvedBloomBackend !== 'webgpu' ||
    integration.initial.resolvedWebGPUOutputMode !==
      integration.initial.outputMode ||
    !integration.initial.visible
  )
  {
    throw new Error(`BAClickFX WebGPU 路由错误: ${JSON.stringify(integration)}`);
  }

  if (
    integration.fallback.resolvedEffectBackend !== 'webgl2' ||
    integration.fallback.resolvedBloomBackend !== 'webgl2' ||
    integration.fallback.resolvedWebGPUOutputMode !== 'unavailable' ||
    !integration.fallback.webglVisible ||
    integration.fallback.changes.join(',') !== 'webgpu,pending,webgl2'
  )
  {
    throw new Error(`WebGPU Device 丢失回退错误: ${JSON.stringify(integration)}`);
  }

  if (browserErrors.length > 0)
  {
    throw new Error(`WebGPU 浏览器错误:\n${browserErrors.join('\n')}`);
  }

  console.log('WebGPU Chromium 运行测试通过');
  console.log(JSON.stringify({ ...result, pixels, integration }, null, 2));
}
finally
{
  await browser?.close();
  await vite.close();
}
