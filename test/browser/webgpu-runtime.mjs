import assert from 'node:assert/strict';
import { accessSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';

const rootDir = resolve(import.meta.dirname, '../..');
const FIXTURE_WIDTH = 320;
const FIXTURE_HEIGHT = 240;
const DIRECT_CASES = [1, 2].flatMap((dpr) =>
  ['scene', 'browser-overlay'].flatMap((outputCompositing) =>
    [true, false].map((preferHdr) =>
    ({
      id: [
        preferHdr ? 'preferred' : 'standard',
        outputCompositing,
        `dpr${dpr}`,
      ].join('-'),
      dpr,
      outputCompositing,
      preferHdr,
      // DPR=1 验证未知背景，DPR=2 同时验证真实栅格参考上传。
      knownBackground: dpr === 2,
    }))),
);

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
    let alphaPixels = 0;
    let maximum = 0;

    for (let index = 0; index < pixels.length; index += 4)
    {
      const energy = Math.max(
        pixels[index],
        pixels[index + 1],
        pixels[index + 2],
      );

      if (energy > 0)
      {
        visiblePixels++;
      }

      if (pixels[index + 3] > 0)
      {
        alphaPixels++;
      }

      maximum = Math.max(maximum, energy);
    }

    return {
      width: image.width,
      height: image.height,
      visiblePixels,
      alphaPixels,
      maximum,
    };
  }, screenshot.toString('base64'));
}

function assertVisiblePixels(label, pixels)
{
  assert.equal(pixels.width, FIXTURE_WIDTH, `${label} 截图宽度`);
  assert.equal(pixels.height, FIXTURE_HEIGHT, `${label} 截图高度`);
  assert.ok(
    pixels.visiblePixels >= 100 &&
      pixels.alphaPixels >= 100 &&
      pixels.maximum >= 32,
    `${label} Canvas 像素为空: ${JSON.stringify(pixels)}`,
  );
}

function assertDirectCase(specification, result, pixels)
{
  const detail = JSON.stringify({ specification, result, pixels });

  assert.ok(result.ready, `WebGPU 初始化失败: ${detail}`);
  assert.ok(
    result.referenceSet && result.resized && result.scene && result.rendered,
    `WebGPU 提交未完成: ${detail}`,
  );
  assert.equal(result.status, 'ready', `Renderer 状态错误: ${detail}`);
  assert.deepEqual(
    result.validationErrors,
    [],
    `WebGPU Validation 错误: ${detail}`,
  );
  assert.equal(
    result.hasSceneBackground,
    specification.knownBackground,
    `合成参考状态错误: ${detail}`,
  );
  assert.equal(result.dpr, specification.dpr, `DPR 状态错误: ${detail}`);
  assert.equal(
    result.sourceWidth,
    FIXTURE_WIDTH * specification.dpr,
    `WebGPU 源宽度错误: ${detail}`,
  );
  assert.equal(
    result.sourceHeight,
    FIXTURE_HEIGHT * specification.dpr,
    `WebGPU 源高度错误: ${detail}`,
  );

  if (specification.preferHdr)
  {
    assert.ok(
      result.outputMode === 'extended' || result.outputMode === 'standard',
      `HDR 协商没有形成可用输出: ${detail}`,
    );
  }
  else
  {
    assert.equal(
      result.outputMode,
      'standard',
      `强制 SDR 没有使用 standard 输出: ${detail}`,
    );
  }

  const expectedFormat = result.outputMode === 'extended'
    ? 'rgba16float'
    : result.preferredFormat;

  assert.equal(result.format, expectedFormat, `Canvas 格式错误: ${detail}`);
  assert.ok(
    result.stats.sceneVertexCount > 0 &&
      result.stats.sceneDiskVertexCount > 0 &&
      result.stats.sceneRingVertexCount > 0 &&
      result.stats.sceneTriangleVertexCount > 0 &&
      result.stats.sceneTrailVertexCount > 0 &&
      result.stats.levelCount > 0 &&
      result.stats.bloomPixels > 0,
    `WebGPU 几何或 Bloom 批次缺失: ${detail}`,
  );
  assertVisiblePixels(specification.id, pixels);
}

async function runDirectCase(page, specification)
{
  const result = await page.evaluate(async (specificationInPage) =>
  {
    const { WebGPUEffectRenderer } = await import('/src/webgpu-effect.js');
    const canvas = document.createElement('canvas');

    canvas.dataset.test = specificationInPage.id;
    canvas.style.width = `${specificationInPage.width}px`;
    canvas.style.height = `${specificationInPage.height}px`;
    document.body.appendChild(canvas);
    const renderer = new WebGPUEffectRenderer(
      canvas,
      { preferHdr: specificationInPage.preferHdr },
    );
    const ready = await renderer.ready;

    if (!ready)
    {
      return {
        ready,
        status: renderer.status,
        failure: String(renderer.failure?.message ?? renderer.failure ?? ''),
      };
    }

    const validationErrors = [];
    const handleUncapturedError = (event) =>
    {
      validationErrors.push(
        String(event.error?.message ?? event.error ?? 'unknown WebGPU error'),
      );
      event.preventDefault?.();
    };

    renderer.device.addEventListener?.(
      'uncapturederror',
      handleUncapturedError,
    );
    renderer.device.pushErrorScope?.('validation');
    let referenceSet = true;
    let background = null;

    if (specificationInPage.knownBackground)
    {
      background = document.createElement('canvas');
      background.width = specificationInPage.width;
      background.height = specificationInPage.height;
      const context = background.getContext('2d');

      context.fillStyle = '#183a52';
      context.fillRect(0, 0, background.width, background.height);
      context.fillStyle = '#6a8f72';
      context.fillRect(
        background.width / 2,
        0,
        background.width / 2,
        background.height,
      );
      referenceSet = renderer.setCompositingReference(background);
    }

    const resized = renderer.resize(
      specificationInPage.width,
      specificationInPage.height,
      specificationInPage.dpr,
      0.5,
      7,
    );

    renderer.beginFrame();
    renderer.addSolidDisk(160, 120, 30, [4, 1, 0.25], 1, 48);
    renderer.addAlphaBlendDisk(160, 120, 42, [2, 3, 6], 1, 0.85, 0.2);
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
    renderer.addTriangle(104, 96, 52, 0.3, [3, 2, 6], 0.9, 0);
    renderer.addTexturedTrailTriangle(
      { x: 44, y: 184, u: 0, v: 0 },
      { x: 160, y: 166, u: 0.5, v: 1 },
      { x: 276, y: 190, u: 1, v: 0 },
      [2, 4, 8],
      0.85,
      1,
    );
    const sceneSettings =
    {
      outputCompositing: specificationInPage.outputCompositing,
      hostCompositing: 'source-over',
      diskEmissionScale: 1,
      ringEmissionScale: 1,
    };
    const scene = renderer.renderScene(sceneSettings);

    renderer.beginFrame({ preserveSceneStats: true });
    const rendered = renderer.render(
      {
        threshold: 0.9,
        softKnee: 0.5,
        clamp: 65472,
        intensity: 8,
        opacity: 1,
        outputCompositing: specificationInPage.outputCompositing,
        overlayAlphaPolicy: 'coverage',
        overlayColorCompensation: 'none',
        overlayAlphaLimit: 250 / 255,
        hostCompositing: 'source-over',
      },
      { preserveCanvas: true },
    );

    await renderer.device.queue.onSubmittedWorkDone();
    const scopedError = await renderer.device.popErrorScope?.();

    if (scopedError)
    {
      validationErrors.push(String(scopedError.message ?? scopedError));
    }

    renderer.device.removeEventListener?.(
      'uncapturederror',
      handleUncapturedError,
    );
    window.__BACLICKFX_WEBGPU_CASES__ ??= new Map();
    window.__BACLICKFX_WEBGPU_CASES__.set(
      specificationInPage.id,
      { renderer, canvas, background },
    );
    return {
      ready,
      referenceSet,
      resized,
      scene,
      rendered,
      status: renderer.status,
      outputMode: renderer.deviceManager.outputMode,
      format: renderer.deviceManager.canvasFormat,
      preferredFormat: navigator.gpu.getPreferredCanvasFormat(),
      hasSceneBackground: renderer.hasSceneBackground,
      dpr: renderer.dpr,
      sourceWidth: renderer.sourceWidth,
      sourceHeight: renderer.sourceHeight,
      stats: renderer.stats,
      validationErrors,
    };
  }, {
    ...specification,
    width: FIXTURE_WIDTH,
    height: FIXTURE_HEIGHT,
  });

  if (!result.ready)
  {
    throw new Error(`WebGPU 初始化失败: ${JSON.stringify(result)}`);
  }

  const canvas = page.locator(`canvas[data-test="${specification.id}"]`);
  const pixels = await decodeScreenshot(page, await canvas.screenshot());

  assertDirectCase(specification, result, pixels);
  await page.evaluate((caseId) =>
  {
    const entry = window.__BACLICKFX_WEBGPU_CASES__?.get(caseId);

    entry?.renderer.destroy();
    entry?.canvas.remove();
    window.__BACLICKFX_WEBGPU_CASES__?.delete(caseId);
  }, specification.id);
  return { ...result, pixels };
}

async function startIntegration(page)
{
  return page.evaluate(async () =>
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

    await effect.webgpuEffectRenderer?.device.queue.onSubmittedWorkDone();
    const config = effect.getConfig();

    effect.webgpuEffectCanvas.dataset.test = 'integration-webgpu';
    window.__BACLICKFX_WEBGPU_INTEGRATION__ = { effect, changes };
    return {
      requested: config.effectBackend,
      resolvedEffectBackend: config.resolvedEffectBackend,
      resolvedBloomBackend: config.resolvedBloomBackend,
      resolvedWebGPUOutputMode: config.resolvedWebGPUOutputMode,
      outputMode: effect.webgpuEffectRenderer?.deviceManager.outputMode,
      format: effect.webgpuEffectRenderer?.deviceManager.canvasFormat,
      visible: effect.webgpuEffectVisible,
      changes: [...changes],
    };
  });
}

async function loseIntegrationDevice(page)
{
  return page.evaluate(async () =>
  {
    const { effect, changes } = window.__BACLICKFX_WEBGPU_INTEGRATION__;

    effect.webgpuEffectRenderer.device.destroy();
    const deadline = performance.now() + 4000;

    while (
      (
        effect.getConfig().resolvedEffectBackend !== 'webgl2' ||
        !effect.webglEffectVisible
      ) &&
      performance.now() < deadline
    )
    {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }

    await new Promise((resolvePromise) => requestAnimationFrame(resolvePromise));
    const config = effect.getConfig();

    effect.webglEffectCanvas.dataset.test = 'integration-webgl2-fallback';
    return {
      resolvedEffectBackend: config.resolvedEffectBackend,
      resolvedBloomBackend: config.resolvedBloomBackend,
      resolvedWebGPUOutputMode: config.resolvedWebGPUOutputMode,
      webglVisible: effect.webglEffectVisible,
      changes: [...changes],
    };
  });
}

async function runIntegration(page)
{
  const initial = await startIntegration(page);
  const initialDetail = JSON.stringify(initial);

  assert.equal(initial.requested, 'webgpu', `请求后端错误: ${initialDetail}`);
  assert.equal(
    initial.resolvedEffectBackend,
    'webgpu',
    `WebGPU 路由错误: ${initialDetail}`,
  );
  assert.equal(
    initial.resolvedBloomBackend,
    'webgpu',
    `WebGPU Bloom 路由错误: ${initialDetail}`,
  );
  assert.equal(
    initial.resolvedWebGPUOutputMode,
    initial.outputMode,
    `WebGPU 输出状态没有透传: ${initialDetail}`,
  );
  assert.ok(initial.visible, `WebGPU Canvas 不可见: ${initialDetail}`);

  const webgpuCanvas = page.locator(
    'canvas[data-test="integration-webgpu"]',
  );
  const webgpuPixels = await decodeScreenshot(
    page,
    await webgpuCanvas.screenshot(),
  );

  assertVisiblePixels('BAClickFX WebGPU 首帧', webgpuPixels);
  const fallback = await loseIntegrationDevice(page);
  const fallbackDetail = JSON.stringify(fallback);

  assert.equal(
    fallback.resolvedEffectBackend,
    'webgl2',
    `Device lost 后没有回退 WebGL2: ${fallbackDetail}`,
  );
  assert.equal(
    fallback.resolvedBloomBackend,
    'webgl2',
    `Device lost 后 Bloom 路由错误: ${fallbackDetail}`,
  );
  assert.equal(
    fallback.resolvedWebGPUOutputMode,
    'unavailable',
    `Device lost 后 HDR 状态错误: ${fallbackDetail}`,
  );
  assert.ok(fallback.webglVisible, `WebGL2 回退 Canvas 不可见: ${fallbackDetail}`);
  assert.equal(
    fallback.changes.join(','),
    'webgpu,pending,webgl2',
    `Device lost 事件顺序错误: ${fallbackDetail}`,
  );

  const fallbackCanvas = page.locator(
    'canvas[data-test="integration-webgl2-fallback"]',
  );
  const fallbackPixels = await decodeScreenshot(
    page,
    await fallbackCanvas.screenshot(),
  );

  assertVisiblePixels('Device lost WebGL2 回退', fallbackPixels);
  await page.evaluate(() =>
  {
    window.__BACLICKFX_WEBGPU_INTEGRATION__?.effect.destroy();
    delete window.__BACLICKFX_WEBGPU_INTEGRATION__;
  });
  return {
    initial: { ...initial, pixels: webgpuPixels },
    fallback: { ...fallback, pixels: fallbackPixels },
  };
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
    { viewport: { width: FIXTURE_WIDTH, height: FIXTURE_HEIGHT } },
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
  const direct = [];

  for (const specification of DIRECT_CASES)
  {
    direct.push(await runDirectCase(page, specification));
  }

  const integration = await runIntegration(page);

  if (browserErrors.length > 0)
  {
    throw new Error(`WebGPU 浏览器错误:\n${browserErrors.join('\n')}`);
  }

  const preferredModes = [...new Set(direct
    .filter((_, index) => DIRECT_CASES[index].preferHdr)
    .map((result) => result.outputMode))];

  console.log(`WebGPU 浏览器矩阵通过：${direct.length} 个直接渲染场景`);
  console.log(JSON.stringify(
    {
      executablePath,
      preferredModes,
      direct: direct.map((result, index) =>
      ({
        id: DIRECT_CASES[index].id,
        outputMode: result.outputMode,
        format: result.format,
        sourceSize: `${result.sourceWidth}x${result.sourceHeight}`,
        levelCount: result.stats.levelCount,
        pixels: result.pixels,
      })),
      integration,
    },
    null,
    2,
  ));
}
finally
{
  await browser?.close();
  await vite.close();
}
