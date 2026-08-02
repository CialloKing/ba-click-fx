import assert from 'node:assert/strict';
import { accessSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';

const rootDir = resolve(import.meta.dirname, '../..');
const FIXTURE_WIDTH = 320;
const FIXTURE_HEIGHT = 240;
const TRAIL_SHARD_LIMIT_SEGMENTS = 24;
const OPTIONAL = process.argv.includes('--optional');
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

    const centerOffset = (
      Math.floor(image.height / 2) * image.width +
      Math.floor(image.width / 2)
    ) * 4;

    return {
      width: image.width,
      height: image.height,
      visiblePixels,
      alphaPixels,
      maximum,
      center: Array.from(pixels.slice(centerOffset, centerOffset + 4)),
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

async function runSdrColorProbe(page, preferHdr)
{
  const result = await page.evaluate(async (preferHdrInPage) =>
  {
    const { WebGPUEffectRenderer } = await import('/src/webgpu-effect.js');
    const canvas = document.createElement('canvas');

    canvas.dataset.test = preferHdrInPage
      ? 'sdr-color-extended'
      : 'sdr-color-standard';
    canvas.style.width = '96px';
    canvas.style.height = '96px';
    document.body.appendChild(canvas);
    const renderer = new WebGPUEffectRenderer(canvas, { preferHdr: preferHdrInPage });
    const ready = await renderer.ready;

    if (!ready)
    {
      return {
        ready,
        status: renderer.status,
        failure: String(renderer.failure?.message ?? renderer.failure ?? ''),
      };
    }

    const resized = renderer.resize(96, 96, 1, 0.5, 7);

    renderer.beginFrame();
    renderer.addSolidDisk(48, 48, 36, [0.18, 0.08, 0.5], 1, 48);
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
        threshold: 65504,
        softKnee: 0,
        clamp: 65504,
        intensity: 0,
        opacity: 1,
        outputCompositing: 'scene',
        overlayAlphaPolicy: 'coverage',
        overlayColorCompensation: 'none',
        overlayAlphaLimit: 1,
        hostCompositing: 'source-over',
      },
      { preserveCanvas: true },
    );

    await renderer.device.queue.onSubmittedWorkDone();
    window.__BACLICKFX_WEBGPU_COLOR_PROBE__ ??= new Map();
    window.__BACLICKFX_WEBGPU_COLOR_PROBE__.set(
      preferHdrInPage,
      { renderer, canvas },
    );
    return {
      ready,
      resized,
      scene,
      rendered,
      status: renderer.status,
      outputMode: renderer.deviceManager.outputMode,
    };
  }, preferHdr);

  assert.ok(
    result.ready && result.resized && result.scene && result.rendered,
    `WebGPU SDR 颜色探针提交失败: ${JSON.stringify(result)}`,
  );
  const selector = preferHdr
    ? 'canvas[data-test="sdr-color-extended"]'
    : 'canvas[data-test="sdr-color-standard"]';
  const canvas = page.locator(selector);
  const screenshot = await canvas.screenshot();
  const pixels = await decodeScreenshot(page, screenshot);

  await page.evaluate((preferHdrInPage) =>
  {
    const entry = window.__BACLICKFX_WEBGPU_COLOR_PROBE__?.get(preferHdrInPage);

    entry?.renderer.destroy();
    entry?.canvas.remove();
    window.__BACLICKFX_WEBGPU_COLOR_PROBE__?.delete(preferHdrInPage);
  }, preferHdr);
  return { ...result, pixels };
}

function assertSdrColorParity(preferred, standard)
{
  assert.equal(
    standard.outputMode,
    'standard',
    `SDR 颜色探针没有使用 standard: ${JSON.stringify(standard)}`,
  );

  if (preferred.outputMode !== 'extended')
  {
    return;
  }

  const expected = [0.461356, 0.313304, 0.735357].map((value) =>
    Math.round(value * 255));
  const standardDelta = standard.pixels.center
    .slice(0, 3)
    .map((value, channel) => Math.abs(value - expected[channel]));
  const modeDelta = preferred.pixels.center
    .slice(0, 3)
    .map((value, channel) =>
      Math.abs(value - standard.pixels.center[channel]));
  const detail = JSON.stringify({ preferred, standard, expected });

  assert.ok(
    Math.max(...standardDelta) <= 3,
    `Standard/WebGL2 SDR 编码基线错误: ${detail}`,
  );
  assert.ok(
    Math.max(...modeDelta) <= 3,
    `Extended 的 SDR 中间调颜色比 Standard 更深: ${detail}`,
  );
}

async function startIntegration(page)
{
  return page.evaluate(async (trailSegmentCount) =>
  {
    const { BAClickFX } = await import('/src/fx.js');
    const changes = [];
    const effect = new BAClickFX(
      {
        effectBackend: 'webgpu',
        inputSource: 'manual',
        maxDpr: 1,
        trailAlways: true,
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

    // 后端初始化耗时不属于粒子生命周期合同；就绪后重建同一帧输入，确保
    // WebGPU 提交和 owner 计数观察的是完整的 4 + 50 个碎片。
    effect.clear();
    effect.boom(160, 120);

    for (let index = 0; index <= trailSegmentCount; index++)
    {
      effect.pointerMove(
        {
          x: index % 2 === 0 ? 8 : effect.width - 8,
          y: effect.height / 2,
          pointerId: 17,
          pointerType: 'mouse',
        },
      );
    }

    await new Promise((resolvePromise) => requestAnimationFrame(resolvePromise));
    await effect.webgpuEffectRenderer?.device.queue.onSubmittedWorkDone();
    const config = effect.getConfig();
    const trailOwnerId = effect.activeTrailOwnerId;
    const trailShards = effect.shards.filter(
      (shard) => shard.kind === 'trail',
    );
    const runtimeGeometry =
    {
      waves: effect.waves.length,
      rings: effect.waves.reduce(
        (count, wave) => count + wave.rings.length,
        0,
      ),
      clickShards: effect.shards.filter((shard) => shard.kind === 'click').length,
      trailShards: trailShards.length,
      trailOwnerCount: new Set(
        trailShards.map((shard) => shard.ownerId),
      ).size,
      trailOwnerShards: trailShards.filter(
        (shard) => shard.ownerId === trailOwnerId,
      ).length,
      trackedTrailOwnerShards: effect.trailShardCounts.get(trailOwnerId) ?? 0,
      sceneRingVertexCount:
        effect.webgpuEffectRenderer?.stats.sceneRingVertexCount,
      sceneTriangleVertexCount:
        effect.webgpuEffectRenderer?.stats.sceneTriangleVertexCount,
    };

    effect.webgpuEffectCanvas.dataset.test = 'integration-webgpu';
    window.__BACLICKFX_WEBGPU_INTEGRATION__ =
    {
      effect,
      changes,
      device: effect.webgpuEffectRenderer?.device,
    };
    return {
      requested: config.effectBackend,
      resolvedEffectBackend: config.resolvedEffectBackend,
      resolvedBloomBackend: config.resolvedBloomBackend,
      resolvedWebGPUOutputMode: config.resolvedWebGPUOutputMode,
      outputMode: effect.webgpuEffectRenderer?.deviceManager.outputMode,
      format: effect.webgpuEffectRenderer?.deviceManager.canvasFormat,
      visible: effect.webgpuEffectVisible,
      changes: [...changes],
      runtimeGeometry,
    };
  }, TRAIL_SHARD_LIMIT_SEGMENTS);
}

async function switchIntegrationToWebGL2(page)
{
  return page.evaluate(async () =>
  {
    const state = window.__BACLICKFX_WEBGPU_INTEGRATION__;
    const { effect, changes, device } = state;

    effect.clear();
    effect.updateConfig({ effectBackend: 'webgl2' });
    effect.boom(160, 120);
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

    effect.webglEffectCanvas.dataset.test = 'integration-webgl2-switch';
    return {
      resolvedEffectBackend: config.resolvedEffectBackend,
      resolvedBloomBackend: config.resolvedBloomBackend,
      resolvedWebGPUOutputMode: config.resolvedWebGPUOutputMode,
      webgpuOutputMode: effect.webgpuEffectRenderer?.deviceManager.outputMode,
      webgpuVisible: effect.webgpuEffectVisible,
      webgpuDisplay: effect.webgpuEffectCanvas?.style.display,
      webglVisible: effect.webglEffectVisible,
      webglDisplay: effect.webglEffectCanvas?.style.display,
      sameDevice: effect.webgpuEffectRenderer?.device === device,
      changes: [...changes],
    };
  });
}

async function switchIntegrationBackToWebGPU(page)
{
  return page.evaluate(async () =>
  {
    const state = window.__BACLICKFX_WEBGPU_INTEGRATION__;
    const { effect, changes, device } = state;

    effect.clear();
    effect.updateConfig({ effectBackend: 'webgpu' });
    effect.boom(160, 120);
    const deadline = performance.now() + 4000;

    while (
      (
        effect.getConfig().resolvedEffectBackend !== 'webgpu' ||
        !effect.webgpuEffectVisible
      ) &&
      performance.now() < deadline
    )
    {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }

    await effect.webgpuEffectRenderer?.device.queue.onSubmittedWorkDone();
    const config = effect.getConfig();

    effect.webgpuEffectCanvas.dataset.test = 'integration-webgpu-resumed';
    return {
      resolvedEffectBackend: config.resolvedEffectBackend,
      resolvedBloomBackend: config.resolvedBloomBackend,
      resolvedWebGPUOutputMode: config.resolvedWebGPUOutputMode,
      outputMode: effect.webgpuEffectRenderer?.deviceManager.outputMode,
      webgpuVisible: effect.webgpuEffectVisible,
      webgpuDisplay: effect.webgpuEffectCanvas?.style.display,
      webglVisible: effect.webglEffectVisible,
      webglDisplay: effect.webglEffectCanvas?.style.display,
      sameDevice: effect.webgpuEffectRenderer?.device === device,
      changes: [...changes],
    };
  });
}

async function loseIntegrationDevice(page)
{
  return page.evaluate(async () =>
  {
    const { effect, changes } = window.__BACLICKFX_WEBGPU_INTEGRATION__;

    // 初始截图解码耗时不稳定；故障注入前重建一组首帧点击，确保测试的是
    // Device lost 当帧重画能力，而不是 700ms 粒子自然结束后的空画布。
    effect.clear();
    effect.boom(160, 120);
    await new Promise((resolvePromise) => requestAnimationFrame(resolvePromise));
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
  assert.deepEqual(
    initial.runtimeGeometry,
    {
      waves: 1,
      rings: 2,
      clickShards: 4,
      trailShards: 50,
      trailOwnerCount: 1,
      trailOwnerShards: 50,
      trackedTrailOwnerShards: 50,
      sceneRingVertexCount: 9216,
      sceneTriangleVertexCount: 324,
    },
    `WebGPU 必须复用 Unity 点击与单实例拖尾几何合同: ${initialDetail}`,
  );

  const webgpuCanvas = page.locator(
    'canvas[data-test="integration-webgpu"]',
  );
  const webgpuPixels = await decodeScreenshot(
    page,
    await webgpuCanvas.screenshot(),
  );

  assertVisiblePixels('BAClickFX WebGPU 首帧', webgpuPixels);
  const switched = await switchIntegrationToWebGL2(page);
  const switchedDetail = JSON.stringify(switched);

  assert.equal(
    switched.resolvedEffectBackend,
    'webgl2',
    `主动切换后没有进入 WebGL2: ${switchedDetail}`,
  );
  assert.equal(
    switched.resolvedBloomBackend,
    'webgl2',
    `主动切换后的 Bloom 路由错误: ${switchedDetail}`,
  );
  assert.equal(
    switched.resolvedWebGPUOutputMode,
    'unavailable',
    `WebGL2 模式仍公开缓存 HDR 状态: ${switchedDetail}`,
  );
  assert.equal(
    switched.webgpuOutputMode,
    'unconfigured',
    `隐藏 WebGPU Canvas 未解除输出配置: ${switchedDetail}`,
  );
  assert.ok(
    !switched.webgpuVisible &&
      switched.webgpuDisplay === 'none' &&
      switched.webglVisible &&
      switched.webglDisplay !== 'none',
    `WebGPU 与 WebGL2 可见层没有原子切换: ${switchedDetail}`,
  );
  assert.ok(switched.sameDevice, `切出 WebGPU 时不应销毁 Device: ${switchedDetail}`);
  assert.equal(
    switched.changes.join(','),
    'webgpu,pending,webgl2',
    `主动切出 WebGPU 的事件顺序错误: ${switchedDetail}`,
  );
  const switchedCanvas = page.locator(
    'canvas[data-test="integration-webgl2-switch"]',
  );
  const switchedPixels = await decodeScreenshot(
    page,
    await switchedCanvas.screenshot(),
  );

  assertVisiblePixels('WebGPU 切出后的 WebGL2', switchedPixels);
  const resumed = await switchIntegrationBackToWebGPU(page);
  const resumedDetail = JSON.stringify(resumed);

  assert.equal(
    resumed.resolvedEffectBackend,
    'webgpu',
    `恢复后没有重新进入 WebGPU: ${resumedDetail}`,
  );
  assert.equal(
    resumed.resolvedBloomBackend,
    'webgpu',
    `恢复后的 Bloom 路由错误: ${resumedDetail}`,
  );
  assert.ok(
    resumed.outputMode === 'extended' || resumed.outputMode === 'standard',
    `恢复后没有重新配置 Canvas 输出: ${resumedDetail}`,
  );
  assert.equal(
    resumed.resolvedWebGPUOutputMode,
    resumed.outputMode,
    `恢复后的公开 HDR 状态错误: ${resumedDetail}`,
  );
  assert.ok(
    resumed.webgpuVisible &&
      resumed.webgpuDisplay !== 'none' &&
      !resumed.webglVisible &&
      resumed.webglDisplay === 'none',
    `恢复 WebGPU 时存在重复可见 GPU 层: ${resumedDetail}`,
  );
  assert.ok(resumed.sameDevice, `恢复 WebGPU 应复用原 Device: ${resumedDetail}`);
  assert.equal(
    resumed.changes.join(','),
    'webgpu,pending,webgl2,pending,webgpu',
    `WebGPU 往返事件顺序错误: ${resumedDetail}`,
  );
  const resumedCanvas = page.locator(
    'canvas[data-test="integration-webgpu-resumed"]',
  );
  const resumedPixels = await decodeScreenshot(
    page,
    await resumedCanvas.screenshot(),
  );

  assertVisiblePixels('恢复后的 WebGPU', resumedPixels);
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
    'webgpu,pending,webgl2,pending,webgpu,pending,webgl2',
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
    switched: { ...switched, pixels: switchedPixels },
    resumed: { ...resumed, pixels: resumedPixels },
    fallback: { ...fallback, pixels: fallbackPixels },
  };
}

async function measureScreenshotDifference(page, before, after)
{
  return page.evaluate(async ({ beforeBase64, afterBase64 }) =>
  {
    async function decode(base64)
    {
      const image = new Image();

      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas');

      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });

      context.drawImage(image, 0, 0);
      return {
        width: image.width,
        height: image.height,
        pixels: context.getImageData(0, 0, image.width, image.height).data,
      };
    }

    const left = await decode(beforeBase64);
    const right = await decode(afterBase64);
    let changedPixels = 0;
    let maximumDifference = 0;

    if (left.width !== right.width || left.height !== right.height)
    {
      return { changedPixels: 0, maximumDifference: 0, sizeMismatch: true };
    }

    for (let index = 0; index < left.pixels.length; index += 4)
    {
      const difference = Math.max(
        Math.abs(left.pixels[index] - right.pixels[index]),
        Math.abs(left.pixels[index + 1] - right.pixels[index + 1]),
        Math.abs(left.pixels[index + 2] - right.pixels[index + 2]),
      );

      if (difference >= 4)
      {
        changedPixels++;
      }

      maximumDifference = Math.max(maximumDifference, difference);
    }

    return { changedPixels, maximumDifference, sizeMismatch: false };
  },
  {
    beforeBase64: before.toString('base64'),
    afterBase64: after.toString('base64'),
  });
}

async function readDemoHdrUiState(page)
{
  return page.evaluate(() =>
  {
    const canvas = document.getElementById('hdrUiCanvas');
    const config = window.BAClickFXDemo?.getConfig?.();

    return {
      requestedBackend: config?.effectBackend,
      resolvedBackend: config?.resolvedEffectBackend,
      outputMode: config?.resolvedWebGPUOutputMode,
      bodyState: document.body.dataset.hdrUiState,
      canvasOutput: canvas?.dataset.hdrUiOutput,
      primitives: Number(canvas?.dataset.hdrUiPrimitives ?? 0),
      display: canvas ? getComputedStyle(canvas).display : 'missing',
      width: canvas?.width ?? 0,
      height: canvas?.height ?? 0,
      enabled: document.getElementById('ctrlHdrUiEnabled')?.checked,
      enabledDisabled: document.getElementById('ctrlHdrUiEnabled')?.disabled,
      brightness: document.getElementById('ctrlHdrUiBrightness')?.value,
      brightnessOutput:
        document.getElementById('outHdrUiBrightness')?.textContent,
      brightnessDisabled:
        document.getElementById('ctrlHdrUiBrightness')?.disabled,
      storedEnabled: localStorage.getItem('bafx-ctrlHdrUiEnabled'),
      storedBrightness: localStorage.getItem('bafx-ctrlHdrUiBrightness'),
    };
  });
}

async function selectDemoRenderMode(page, mode)
{
  await page.selectOption('#ctrlRenderMode', mode);
  await page.waitForFunction((expectedMode) =>
  {
    const config = window.BAClickFXDemo?.getConfig?.();

    if (!config || document.getElementById('ctrlRenderMode')?.value !== expectedMode)
    {
      return false;
    }

    if (expectedMode === 'full-webgpu')
    {
      return config.resolvedEffectBackend === 'webgpu' &&
        (
          config.resolvedWebGPUOutputMode === 'extended' ||
          config.resolvedWebGPUOutputMode === 'standard'
        );
    }

    return config.resolvedEffectBackend !== 'pending';
  }, mode);
}

async function setDemoHdrUiEnabled(page, enabled)
{
  await page.evaluate((nextEnabled) =>
  {
    const control = document.getElementById('ctrlHdrUiEnabled');

    control.checked = nextEnabled;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }, enabled);
}

async function runDemoHdrUiEffectIsolation(page)
{
  const originalViewport = page.viewportSize();
  const original = await page.evaluate(() =>
  {
    const panel = document.getElementById('panel');
    const intro = document.getElementById('introSection');
    const hint = document.getElementById('hintBar');

    return {
      effectBrightness: document.getElementById(
        'ctrlWebGPUHdrBrightness',
      ).value,
      uiBrightness: document.getElementById('ctrlHdrUiBrightness').value,
      panelOpen: panel?.classList.contains('open') ?? false,
      introDisplay: intro?.style.display ?? '',
      hintDisplay: hint?.style.display ?? '',
    };
  });

  await page.setViewportSize({ width: 800, height: 600 });
  await page.fill('#ctrlWebGPUHdrBrightness', '8');
  await page.fill('#ctrlHdrUiBrightness', '16');
  await page.evaluate(() =>
  {
    document.activeElement?.blur?.();
    document.getElementById('panel')?.classList.remove('open');
    const intro = document.getElementById('introSection');
    const hint = document.getElementById('hintBar');

    if (intro)
    {
      intro.style.display = 'none';
    }

    if (hint)
    {
      hint.style.display = 'none';
    }

    window.dispatchEvent(new Event('resize'));
  });
  await page.mouse.move(400, 300);
  await page.waitForTimeout(400);
  const fixedFrame = await page.evaluate(() =>
  {
    const effect = window.BAClickFXDemo;

    effect.setPaused(true, { clear: true });
    effect.setPaused(false);

    if (effect.animationFrame !== null)
    {
      cancelAnimationFrame(effect.animationFrame);
      effect.animationFrame = null;
    }

    effect.clickTimeMs = 0;
    effect.trailTimeMs = 0;
    effect.lastClickTimeSource = null;
    effect.lastTrailTimeSource = null;
    effect._spawnClick(400, 300);
    effect.lastClickTimeSource = 0;
    effect.lastTrailTimeSource = 0;
    effect._renderFrame(120);

    if (effect.animationFrame !== null)
    {
      cancelAnimationFrame(effect.animationFrame);
      effect.animationFrame = null;
    }

    // 保留刚提交的同一帧，后续只改变独立 UI Surface 的可见性。
    effect.paused = true;
    effect.lastClickTimeSource = null;
    effect.lastTrailTimeSource = null;
    const hdrUiCanvas = document.getElementById('hdrUiCanvas');
    const effectCanvas = effect.webgpuEffectCanvas;

    return {
      effectZIndex: Number(getComputedStyle(effectCanvas).zIndex),
      hdrUiZIndex: Number(getComputedStyle(hdrUiCanvas).zIndex),
      waveAges: effect.waves.map((wave) => wave.ageMs),
      waveCount: effect.waves.length,
      shardCount: effect.shards.length,
      fxConfig: JSON.stringify(effect.getFxConfig()),
      webgpuHdrBrightness: effect.getConfig().webgpuHdrBrightness,
    };
  });

  await page.evaluate(() =>
    window.BAClickFXDemo.webgpuEffectRenderer.device.queue.onSubmittedWorkDone());
  const clickClip = { x: 280, y: 180, width: 240, height: 240 };
  const uiClip = { x: 0, y: 0, width: 360, height: 150 };
  const enabledClick = await page.screenshot({ clip: clickClip });
  const enabledUi = await page.screenshot({ clip: uiClip });

  await setDemoHdrUiEnabled(page, false);
  await page.waitForFunction(() =>
    document.body.dataset.hdrUiState === 'disabled');
  const disabledClick = await page.screenshot({ clip: clickClip });
  const disabledUi = await page.screenshot({ clip: uiClip });
  const disabledFrame = await page.evaluate(() =>
  {
    const effect = window.BAClickFXDemo;

    return {
      waveAges: effect.waves.map((wave) => wave.ageMs),
      waveCount: effect.waves.length,
      shardCount: effect.shards.length,
      fxConfig: JSON.stringify(effect.getFxConfig()),
      webgpuHdrBrightness: effect.getConfig().webgpuHdrBrightness,
    };
  });
  const clickDifference = await measureScreenshotDifference(
    page,
    enabledClick,
    disabledClick,
  );
  const uiDifference = await measureScreenshotDifference(
    page,
    enabledUi,
    disabledUi,
  );

  assert.ok(
    fixedFrame.hdrUiZIndex < fixedFrame.effectZIndex,
    `HDR UI 层覆盖了点击特效层: ${JSON.stringify(fixedFrame)}`,
  );
  assert.deepEqual(
    fixedFrame.waveAges,
    [120],
    `没有生成固定 120 ms 点击帧: ${JSON.stringify(fixedFrame)}`,
  );
  assert.deepEqual(
    disabledFrame,
    {
      waveAges: fixedFrame.waveAges,
      waveCount: fixedFrame.waveCount,
      shardCount: fixedFrame.shardCount,
      fxConfig: fixedFrame.fxConfig,
      webgpuHdrBrightness: fixedFrame.webgpuHdrBrightness,
    },
    '关闭 HDR UI 不得修改点击特效状态或参数',
  );
  assert.ok(
    !clickDifference.sizeMismatch &&
      clickDifference.changedPixels === 0 &&
      clickDifference.maximumDifference <= 3,
    `HDR UI 改变了远端点击特效像素: ${JSON.stringify(clickDifference)}`,
  );
  assert.ok(
    !uiDifference.sizeMismatch &&
      uiDifference.changedPixels >= 20 &&
      uiDifference.maximumDifference >= 4,
    `HDR UI 对照区域没有可见贡献: ${JSON.stringify(uiDifference)}`,
  );

  await setDemoHdrUiEnabled(page, true);
  await page.fill('#ctrlWebGPUHdrBrightness', original.effectBrightness);
  await page.fill('#ctrlHdrUiBrightness', original.uiBrightness);
  await page.evaluate((saved) =>
  {
    const effect = window.BAClickFXDemo;
    const panel = document.getElementById('panel');
    const intro = document.getElementById('introSection');
    const hint = document.getElementById('hintBar');

    effect.clear();
    effect.setPaused(false);
    panel?.classList.toggle('open', saved.panelOpen);

    if (intro)
    {
      intro.style.display = saved.introDisplay;
    }

    if (hint)
    {
      hint.style.display = saved.hintDisplay;
    }

    window.dispatchEvent(new Event('resize'));
  }, original);
  await page.setViewportSize(originalViewport);

  return {
    clickDifference,
    fixedFrame:
    {
      effectZIndex: fixedFrame.effectZIndex,
      hdrUiZIndex: fixedFrame.hdrUiZIndex,
      waveAges: fixedFrame.waveAges,
      waveCount: fixedFrame.waveCount,
      shardCount: fixedFrame.shardCount,
      webgpuHdrBrightness: fixedFrame.webgpuHdrBrightness,
    },
    uiDifference,
  };
}

async function runDemoHdrUiIntegration(page, origin)
{
  await page.goto(origin);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.BAClickFXDemo?.getConfig?.());
  await page.waitForFunction(() =>
    window.BAClickFXDemo.getConfig().resolvedEffectBackend !== 'pending');
  const initial = await readDemoHdrUiState(page);
  const initialDetail = JSON.stringify(initial);

  assert.equal(initial.requestedBackend, 'webgl2', `展示页默认后端错误: ${initialDetail}`);
  assert.equal(initial.bodyState, 'inactive', `默认 UI HDR 状态错误: ${initialDetail}`);
  assert.equal(initial.display, 'none', `默认 UI HDR Canvas 未隐藏: ${initialDetail}`);
  assert.ok(
    initial.enabledDisabled && initial.brightnessDisabled,
    `默认 UI HDR 控件不应可用: ${initialDetail}`,
  );

  await selectDemoRenderMode(page, 'full-webgpu');
  const negotiated = await readDemoHdrUiState(page);
  const negotiatedDetail = JSON.stringify(negotiated);

  if (negotiated.outputMode !== 'extended')
  {
    assert.equal(
      negotiated.outputMode,
      'standard',
      `展示页 WebGPU 输出状态错误: ${negotiatedDetail}`,
    );
    assert.ok(
      negotiated.bodyState === 'inactive' &&
        negotiated.display === 'none' &&
        negotiated.enabledDisabled &&
        negotiated.brightnessDisabled,
      `WebGPU SDR 不应启用 UI HDR: ${negotiatedDetail}`,
    );
    return { initial, negotiated, extendedCovered: false };
  }

  await page.waitForFunction(() =>
  {
    const canvas = document.getElementById('hdrUiCanvas');

    return document.body.dataset.hdrUiState === 'extended' &&
      Number(canvas?.dataset.hdrUiPrimitives ?? 0) > 0 &&
      getComputedStyle(canvas).display !== 'none';
  });
  await page.evaluate(() =>
    window.BAClickFXDemo.webgpuEffectRenderer.device.queue.onSubmittedWorkDone());
  const extended = await readDemoHdrUiState(page);
  const extendedDetail = JSON.stringify(extended);

  assert.ok(
    extended.canvasOutput === 'extended' &&
      extended.primitives > 0 &&
      extended.display !== 'none' &&
      extended.width > 0 &&
      extended.height > 0,
    `UI HDR Canvas 未完成可见提交: ${extendedDetail}`,
  );
  assert.ok(
    extended.enabled &&
      !extended.enabledDisabled &&
      extended.brightness === '4' &&
      extended.brightnessOutput === '4.00' &&
      !extended.brightnessDisabled,
    `UI HDR 默认控制状态错误: ${extendedDetail}`,
  );

  const enabledScreenshot = await page.screenshot();

  await setDemoHdrUiEnabled(page, false);
  await page.waitForFunction(() =>
    document.body.dataset.hdrUiState === 'disabled');
  const disabledScreenshot = await page.screenshot();
  const disabled = await readDemoHdrUiState(page);
  const disabledDetail = JSON.stringify(disabled);

  assert.ok(
    !disabled.enabled &&
      disabled.canvasOutput === 'inactive' &&
      disabled.primitives === 0 &&
      disabled.display === 'none' &&
      disabled.storedEnabled === 'false',
    `关闭 UI HDR 后 Surface 仍然活动: ${disabledDetail}`,
  );
  const screenshotDifference = await measureScreenshotDifference(
    page,
    enabledScreenshot,
    disabledScreenshot,
  );

  assert.ok(
    !screenshotDifference.sizeMismatch &&
      screenshotDifference.changedPixels >= 100 &&
      screenshotDifference.maximumDifference >= 16,
    `UI HDR 没有产生可检测的页面像素贡献: ${JSON.stringify(screenshotDifference)}`,
  );

  await setDemoHdrUiEnabled(page, true);
  await page.fill('#ctrlHdrUiBrightness', '8');
  await page.waitForFunction(() =>
    document.getElementById('outHdrUiBrightness')?.textContent === '8.00');
  const adjusted = await readDemoHdrUiState(page);
  const adjustedDetail = JSON.stringify(adjusted);

  assert.ok(
    adjusted.bodyState === 'extended' &&
      adjusted.brightness === '8' &&
      adjusted.brightnessOutput === '8.00' &&
      adjusted.storedEnabled === 'true' &&
      adjusted.storedBrightness === '8',
    `UI HDR 亮度调整或持久化错误: ${adjustedDetail}`,
  );
  const effectIsolation = await runDemoHdrUiEffectIsolation(page);

  await page.evaluate(() =>
  {
    window.__BACLICKFX_DEMO_HDR_UI_DEVICE__ =
      window.BAClickFXDemo.webgpuEffectRenderer.device;
  });

  await selectDemoRenderMode(page, 'full-webgl2');
  const switched = await readDemoHdrUiState(page);
  const switchedDetail = JSON.stringify(switched);

  assert.ok(
    switched.bodyState === 'inactive' &&
      switched.canvasOutput === 'inactive' &&
      switched.primitives === 0 &&
      switched.display === 'none' &&
      switched.brightnessDisabled,
    `切出 WebGPU 后 UI HDR Surface 仍然活动: ${switchedDetail}`,
  );

  await selectDemoRenderMode(page, 'full-webgpu');
  await page.waitForFunction(() =>
    document.body.dataset.hdrUiState === 'extended' &&
      Number(document.getElementById('hdrUiCanvas')?.dataset.hdrUiPrimitives ?? 0) > 0);
  const resumed = await page.evaluate(() =>
  ({
    state: document.body.dataset.hdrUiState,
    sameDevice: window.BAClickFXDemo.webgpuEffectRenderer.device ===
      window.__BACLICKFX_DEMO_HDR_UI_DEVICE__,
  }));

  assert.ok(
    resumed.state === 'extended' && resumed.sameDevice,
    `恢复 WebGPU 后 UI HDR 未复用主 Device: ${JSON.stringify(resumed)}`,
  );

  await page.evaluate(() => document.getElementById('btnReset').click());
  await page.waitForFunction(() =>
    window.BAClickFXDemo.getConfig().resolvedEffectBackend !== 'pending');
  const reset = await readDemoHdrUiState(page);
  const resetDetail = JSON.stringify(reset);

  assert.ok(
    reset.requestedBackend === 'webgl2' &&
      reset.bodyState === 'inactive' &&
      reset.display === 'none' &&
      reset.enabled &&
      reset.brightness === '4' &&
      reset.brightnessOutput === '4.00' &&
      reset.storedEnabled === null &&
      reset.storedBrightness === null,
    `重置未恢复 UI HDR 展示页默认值: ${resetDetail}`,
  );

  return {
    initial,
    negotiated,
    extended,
    disabled,
    adjusted,
    effectIsolation,
    switched,
    resumed,
    reset,
    screenshotDifference,
    extendedCovered: true,
  };
}

async function inspectWebGPUAvailability(page)
{
  return page.evaluate(async () =>
  {
    if (!navigator.gpu)
    {
      return { available: false, reason: '浏览器未暴露 navigator.gpu' };
    }

    try
    {
      const adapter = await navigator.gpu.requestAdapter(
        { powerPreference: 'high-performance' },
      );

      if (!adapter)
      {
        return { available: false, reason: '浏览器未返回 WebGPU Adapter' };
      }

      const device = await adapter.requestDevice();

      if (!device)
      {
        return { available: false, reason: '浏览器未返回 WebGPU Device' };
      }

      device.destroy();
      return { available: true, reason: '' };
    }
    catch (error)
    {
      return {
        available: false,
        reason: String(error?.message ?? error ?? 'WebGPU 预检失败'),
      };
    }
  });
}

async function main()
{
  const executablePath = findExecutable();

  if (!executablePath)
  {
    if (OPTIONAL)
    {
      console.log('跳过可选 WebGPU 浏览器测试：找不到 Chrome 或 Edge');
      return;
    }

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
    const availability = await inspectWebGPUAvailability(page);

    if (!availability.available)
    {
      if (OPTIONAL)
      {
        console.log(
          `跳过可选 WebGPU 浏览器测试：${availability.reason}`,
        );
        return;
      }

      throw new Error(`WebGPU 预检失败：${availability.reason}`);
    }

    const direct = [];

    for (const specification of DIRECT_CASES)
    {
      direct.push(await runDirectCase(page, specification));
    }

    const colorProbes =
    {
      preferred: await runSdrColorProbe(page, true),
      standard: await runSdrColorProbe(page, false),
    };

    assertSdrColorParity(colorProbes.preferred, colorProbes.standard);

    const integration = await runIntegration(page);
    const demoHdrUi = await runDemoHdrUiIntegration(
      page,
      `http://127.0.0.1:${port}/`,
    );

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
        colorProbes,
        integration,
        demoHdrUi,
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
}

await main();
