const FIXTURE_WIDTH = 320;
const FIXTURE_HEIGHT = 240;
const CLICK_X = 160;
const CLICK_Y = 96;
const SAMPLE_TIME_MS = 120;
const RADIAL_SAMPLE_RADII = [0, 4, 8, 12, 16, 24, 32, 48, 64];
const STRAIGHT_TRAIL_START_X = 48;
const STRAIGHT_TRAIL_END_X = 272;
const STRAIGHT_TRAIL_Y = 120;
const STRAIGHT_TRAIL_HEAD_U = 0.08;
const STRAIGHT_TRAIL_ASYMMETRY_U = 0.15;
const STRAIGHT_TRAIL_EDGE_V = 0.05;

window.__BACLICKFX_PIXEL_PROGRESS__ = 'suite-started';

const MODE_CONFIGS = Object.freeze(
  {
    'full-webgl2':
    {
      effectBackend: 'webgl2',
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
      expectedEffectBackend: 'webgl2',
      expectedBloomBackend: 'webgl2',
    },
    'webgl2-bloom':
    {
      effectBackend: 'canvas2d',
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
      expectedEffectBackend: 'canvas2d',
      expectedBloomBackend: 'webgl2',
    },
    'software-bloom':
    {
      effectBackend: 'canvas2d',
      renderingMode: 'enhanced',
      bloomBackend: 'software',
      expectedEffectBackend: 'canvas2d',
      expectedBloomBackend: 'software',
    },
    native:
    {
      effectBackend: 'canvas2d',
      renderingMode: 'enhanced',
      bloomBackend: 'native',
      expectedEffectBackend: 'canvas2d',
      expectedBloomBackend: 'native',
    },
    legacy:
    {
      effectBackend: 'canvas2d',
      renderingMode: 'legacy',
      bloomBackend: 'native',
      expectedEffectBackend: 'canvas2d',
      expectedBloomBackend: 'legacy',
    },
  },
);

let virtualNow = 0;
let nextAnimationFrameId = 1;
let randomState = 0x6d2b79f5;
let activeFixture = null;
const animationFrames = new Map();
const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);

// 渲染输入必须完全可重复，否则碎片随机数会把像素回归变成概率测试。
Math.random = () =>
{
  randomState |= 0;
  randomState = randomState + 0x6d2b79f5 | 0;
  let value = Math.imul(randomState ^ randomState >>> 15, 1 | randomState);

  value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
};

Object.defineProperty(
  performance,
  'now',
  {
    configurable: true,
    value: () => virtualNow,
  },
);

window.requestAnimationFrame = (callback) =>
{
  const id = nextAnimationFrameId++;

  animationFrames.set(id, callback);
  return id;
};

window.cancelAnimationFrame = (id) =>
{
  animationFrames.delete(id);
};

window.__BACLICKFX_PIXEL_PROGRESS__ = 'importing-runtime';
const {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
} = await import('../../src/fx.js');
window.__BACLICKFX_PIXEL_PROGRESS__ = 'runtime-imported';

function setRandomSeed(seed)
{
  randomState = seed >>> 0;
}

function resetVirtualRuntime()
{
  virtualNow = 0;
  nextAnimationFrameId = 1;
  animationFrames.clear();
  setRandomSeed(0x4ba5f17);
}

async function runAnimationFrame(timeMs)
{
  virtualNow = timeMs;
  const callbacks = [...animationFrames.values()];

  animationFrames.clear();

  for (const callback of callbacks)
  {
    callback(timeMs);
  }

  // Shader compilation and browser event dispatch may enqueue microtasks.
  await Promise.resolve();
}

function applyBackground(target, background)
{
  target.style.background = '';
  target.style.backgroundColor = '';
  target.style.backgroundImage = '';
  target.style.backgroundPosition = '';
  target.style.backgroundSize = '';

  if (background === 'black')
  {
    target.style.backgroundColor = '#000';
  }
  else if (background === 'white')
  {
    target.style.backgroundColor = '#fff';
  }
  else if (background === 'checker')
  {
    target.style.backgroundColor = '#fff';
    target.style.backgroundImage = [
      'linear-gradient(45deg, #000 25%, transparent 25%)',
      'linear-gradient(-45deg, #000 25%, transparent 25%)',
      'linear-gradient(45deg, transparent 75%, #000 75%)',
      'linear-gradient(-45deg, transparent 75%, #000 75%)',
    ].join(',');
    target.style.backgroundPosition = '0 0, 0 8px, 8px -8px, -8px 0';
    target.style.backgroundSize = '16px 16px';
  }
}

function createFixture(specification)
{
  const stage = document.getElementById('stage');
  const shell = document.createElement('section');
  let target = null;

  stage.replaceChildren();
  shell.className = 'fixture-shell';
  stage.appendChild(shell);

  if (specification.shadow)
  {
    const shadowHost = document.createElement('div');
    const shadowRoot = shadowHost.attachShadow(
      {
        mode: 'open',
      },
    );

    shadowHost.style.display = 'block';
    shadowHost.style.width = `${FIXTURE_WIDTH}px`;
    shadowHost.style.height = `${FIXTURE_HEIGHT}px`;
    target = document.createElement('div');
    shadowRoot.appendChild(target);
    shell.appendChild(shadowHost);
  }
  else
  {
    target = document.createElement('div');
    shell.appendChild(target);
  }

  target.className = 'fixture-target';
  target.style.position = 'relative';
  target.style.width = `${FIXTURE_WIDTH}px`;
  target.style.height = `${FIXTURE_HEIGHT}px`;
  target.style.overflow = 'hidden';

  if (specification.containStrict)
  {
    target.style.contain = 'strict';
  }

  applyBackground(target, specification.background ?? 'checker');
  return {
    stage,
    shell,
    target,
  };
}

function getCanvasZIndex(canvas)
{
  const value = Number.parseInt(getComputedStyle(canvas).zIndex, 10);

  return Number.isFinite(value) ? value : 0;
}

function getVisibleCanvases(target)
{
  return [...target.querySelectorAll('canvas')]
    .filter((canvas) =>
    {
      const style = getComputedStyle(canvas);

      return style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity || '1') > 0;
    })
    .sort((left, right) =>
    {
      const zIndexDifference = getCanvasZIndex(left) - getCanvasZIndex(right);

      if (zIndexDifference !== 0)
      {
        return zIndexDifference;
      }

      return left.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING
        ? -1
        : 1;
    });
}

function finishWebGLRenderers(effect)
{
  const contexts = [
    effect.webglEffectRenderer?.gl,
    effect.webglBloomRenderer?.gl,
    effect.canvasSceneRenderer?.gl,
  ];

  for (const context of contexts)
  {
    context?.finish();
  }
}

function paintCaptureBackground(context, background, width, height, dpr)
{
  if (background === 'transparent')
  {
    return;
  }

  if (background === 'black' || background === 'white')
  {
    context.fillStyle = background === 'black' ? '#000' : '#fff';
    context.fillRect(0, 0, width, height);
    return;
  }

  const square = Math.max(1, Math.round(8 * dpr));

  for (let y = 0; y < height; y += square)
  {
    for (let x = 0; x < width; x += square)
    {
      context.fillStyle = ((x / square + y / square) & 1) === 0
        ? '#000'
        : '#fff';
      context.fillRect(x, y, square, square);
    }
  }
}

function captureLayers(effect, target, background = 'transparent')
{
  finishWebGLRenderers(effect);
  const dpr = effect.dpr;
  const width = Math.round(FIXTURE_WIDTH * dpr);
  const height = Math.round(FIXTURE_HEIGHT * dpr);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext(
    '2d',
    {
      willReadFrequently: true,
    },
  );

  canvas.width = width;
  canvas.height = height;
  paintCaptureBackground(context, background, width, height, dpr);

  for (const layer of getVisibleCanvases(target))
  {
    context.drawImage(layer, 0, 0, width, height);
  }

  return context.getImageData(0, 0, width, height);
}

function captureContrastLayer(effect)
{
  if (!effect.contrastContext || !effect.contrastCanvas)
  {
    return null;
  }

  const image = effect.contrastContext.getImageData(
    0,
    0,
    effect.contrastCanvas.width,
    effect.contrastCanvas.height,
  );

  return summarizePixels(image, effect.dpr);
}

function getPixel(imageData, x, y, dpr)
{
  const pixelX = Math.max(
    0,
    Math.min(imageData.width - 1, Math.round(x * dpr)),
  );
  const pixelY = Math.max(
    0,
    Math.min(imageData.height - 1, Math.round(y * dpr)),
  );
  const offset = (pixelY * imageData.width + pixelX) * 4;

  return Array.from(imageData.data.slice(offset, offset + 4));
}

function sampleHorizontalEnergy(imageData, x, y, dpr, radius = 2)
{
  let energy = 0;
  let count = 0;

  for (let offset = -radius; offset <= radius; offset++)
  {
    const pixel = getPixel(imageData, x + offset, y, dpr);

    // getImageData 返回解预乘 RGB；乘回 Alpha 才是桌面合成器收到的能量。
    energy += Math.max(pixel[0], pixel[1], pixel[2]) / 255 *
      (pixel[3] / 255);
    count++;
  }

  return energy / Math.max(1, count);
}

function summarizeStraightTrail(imageData, effect)
{
  const dpr = effect.dpr;
  const width = effect.fxConfig.trail.width * effect._getScale();
  const halfWidth = width * 0.5;
  const headProgress = 1 - STRAIGHT_TRAIL_HEAD_U;
  const headX = STRAIGHT_TRAIL_START_X +
    (STRAIGHT_TRAIL_END_X - STRAIGHT_TRAIL_START_X) * headProgress;
  const asymmetryProgress = 1 - STRAIGHT_TRAIL_ASYMMETRY_U;
  const asymmetryX = STRAIGHT_TRAIL_START_X +
    (STRAIGHT_TRAIL_END_X - STRAIGHT_TRAIL_START_X) * asymmetryProgress;
  const tailX = STRAIGHT_TRAIL_START_X +
    (STRAIGHT_TRAIL_END_X - STRAIGHT_TRAIL_START_X) * 0.2;
  const edgeOffset = halfWidth * (1 - STRAIGHT_TRAIL_EDGE_V * 2);

  return {
    width,
    headEnergy: sampleHorizontalEnergy(
      imageData,
      headX,
      STRAIGHT_TRAIL_Y,
      dpr,
    ),
    tailEnergy: sampleHorizontalEnergy(
      imageData,
      tailX,
      STRAIGHT_TRAIL_Y,
      dpr,
    ),
    upperEdgeEnergy: sampleHorizontalEnergy(
      imageData,
      asymmetryX,
      STRAIGHT_TRAIL_Y - edgeOffset,
      dpr,
    ),
    lowerEdgeEnergy: sampleHorizontalEnergy(
      imageData,
      asymmetryX,
      STRAIGHT_TRAIL_Y + edgeOffset,
      dpr,
    ),
  };
}

function summarizePixels(imageData, dpr)
{
  const data = imageData.data;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let alphaSum = 0;
  let energySum = 0;
  let maximumAlpha = 0;
  let visiblePixels = 0;
  let minimumX = imageData.width;
  let minimumY = imageData.height;
  let maximumX = -1;
  let maximumY = -1;

  for (let offset = 0; offset < data.length; offset += 4)
  {
    const alpha = data[offset + 3];
    const energy = Math.max(data[offset], data[offset + 1], data[offset + 2]);

    redSum += data[offset];
    greenSum += data[offset + 1];
    blueSum += data[offset + 2];
    alphaSum += alpha;
    energySum += energy;
    maximumAlpha = Math.max(maximumAlpha, alpha);

    if (alpha > 1 || energy > 1)
    {
      const pixel = offset / 4;
      const x = pixel % imageData.width;
      const y = Math.floor(pixel / imageData.width);

      visiblePixels++;
      minimumX = Math.min(minimumX, x);
      minimumY = Math.min(minimumY, y);
      maximumX = Math.max(maximumX, x);
      maximumY = Math.max(maximumY, y);
    }
  }

  const pixelCount = imageData.width * imageData.height;
  const radialAlpha = RADIAL_SAMPLE_RADII.map((radius) =>
    getPixel(imageData, CLICK_X + radius, CLICK_Y, dpr)[3] / 255,
  );

  return {
    meanRed: redSum / pixelCount / 255,
    meanGreen: greenSum / pixelCount / 255,
    meanBlue: blueSum / pixelCount / 255,
    meanAlpha: alphaSum / pixelCount / 255,
    meanEnergy: energySum / pixelCount / 255,
    maximumAlpha: maximumAlpha / 255,
    visibleRatio: visiblePixels / pixelCount,
    bounds:
    {
      width: maximumX >= minimumX ? (maximumX - minimumX + 1) / dpr : 0,
      height: maximumY >= minimumY ? (maximumY - minimumY + 1) / dpr : 0,
    },
    center: getPixel(imageData, CLICK_X, CLICK_Y, dpr),
    radialAlpha,
  };
}

function createSceneBackground()
{
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = 32;
  canvas.height = 32;
  paintCaptureBackground(context, 'checker', 32, 32, 1);
  return canvas;
}

async function prepareEffect(specification)
{
  disposeActiveFixture();
  resetVirtualRuntime();
  const mode = MODE_CONFIGS[specification.mode];
  const sampleTimeMs = specification.sampleTimeMs ?? SAMPLE_TIME_MS;

  if (!mode)
  {
    throw new Error(`未知渲染模式: ${specification.mode}`);
  }

  if (!Number.isFinite(sampleTimeMs) || sampleTimeMs < 0)
  {
    throw new Error(`无效像素采样时间: ${sampleTimeMs}`);
  }

  const fixture = createFixture(specification);
  const effect = new BAClickFX(
    {
      target: fixture.target,
      inputSource: 'manual',
      trailAlways: true,
      outputCompositing: specification.outputCompositing ??
        'transparent-overlay',
      opacity: specification.opacity,
      scale: specification.scale ?? 1,
      isolatedCompositing: specification.isolatedCompositing,
      lightBackgroundContrastAlpha:
        specification.lightBackgroundContrastAlpha ?? 0,
      maxDpr: 2,
      effectBackend: mode.effectBackend,
      renderingMode: mode.renderingMode,
      bloomBackend: mode.bloomBackend,
    },
  );

  if (specification.includeTrailShards === false)
  {
    // 方向探针只测 TrailRenderer 纹理，距离粒子会污染边缘采样。
    effect.setFxParam('shards.maxCount', 0);
  }

  if (specification.inspectTrailTexture === true)
  {
    // Unity 的默认 23.97x HDR 会把两侧边缘同时钳到白色。诊断帧只降低
    // 发射倍率并关闭 Bloom，保留相同 GPU 纹理、UV、Gradient 和网格路径。
    effect.setFxParams(
      {
        'bloom.trailEmission': 1,
        'bloom.intensity': 0,
      },
    );
  }

  if (specification.fxParams)
  {
    const patchResult = effect.setFxParams(
      specification.fxParams,
      {
        strict: true,
      },
    );

    if (!patchResult.committed)
    {
      throw new Error(
        `浏览器夹具参数补丁被拒绝: ${JSON.stringify(patchResult.rejected)}`,
      );
    }
  }

  activeFixture = {
    ...fixture,
    effect,
    specification,
    sampleTimeMs,
  };

  if (specification.includeClick !== false)
  {
    effect.boom(CLICK_X, CLICK_Y);
  }
  await runAnimationFrame(0);

  if (specification.includeTrail !== false)
  {
    const trailSamples = specification.straightTrailProbe
      ? [
          [20, STRAIGHT_TRAIL_START_X, STRAIGHT_TRAIL_Y],
          [40, 112, STRAIGHT_TRAIL_Y],
          [60, 184, STRAIGHT_TRAIL_Y],
          [80, STRAIGHT_TRAIL_END_X, STRAIGHT_TRAIL_Y],
        ]
      : [
          [20, 48, 204],
          [40, 112, 184],
          [60, 184, 202],
          [80, 272, 176],
        ];

    for (const [timeMs, x, y] of trailSamples)
    {
      if (timeMs > sampleTimeMs)
      {
        continue;
      }

      virtualNow = timeMs;
      effect.pointerMove(
        {
          x,
          y,
          pointerId: 17,
          pointerType: 'mouse',
        },
      );

      if (timeMs === 60)
      {
        // 保留原夹具的中间提交，覆盖跨帧追加 TrailRenderer 顶点的路径。
        await runAnimationFrame(timeMs);
      }
    }
  }

  if (sampleTimeMs > 0)
  {
    await runAnimationFrame(sampleTimeMs);
  }

  return activeFixture;
}

function disposeActiveFixture()
{
  if (!activeFixture)
  {
    return;
  }

  activeFixture.effect.destroy();
  activeFixture.stage.replaceChildren();
  activeFixture = null;
  animationFrames.clear();
}

async function runCase(specification)
{
  const fixture = await prepareEffect(specification);
  const snapshot = fixture.effect.getConfig();
  const transparent = captureLayers(
    fixture.effect,
    fixture.target,
    'transparent',
  );
  const black = captureLayers(fixture.effect, fixture.target, 'black');
  const white = captureLayers(fixture.effect, fixture.target, 'white');
  const checker = captureLayers(fixture.effect, fixture.target, 'checker');
  const targetBounds = fixture.target.getBoundingClientRect();

  return {
    specification,
    sampleTimeMs: fixture.sampleTimeMs,
    outputCompositing: snapshot.outputCompositing,
    route:
    {
      requestedEffectBackend: snapshot.effectBackend,
      resolvedEffectBackend: snapshot.resolvedEffectBackend,
      requestedBloomBackend: snapshot.bloomBackend,
      resolvedBloomBackend: snapshot.resolvedBloomBackend,
      renderingMode: snapshot.renderingMode,
    },
    expectedRoute:
    {
      effectBackend: MODE_CONFIGS[specification.mode].expectedEffectBackend,
      bloomBackend: MODE_CONFIGS[specification.mode].expectedBloomBackend,
    },
    runtime:
    {
      waveCount: fixture.effect.waves.length,
      ringCount: fixture.effect.waves.reduce(
        (count, wave) => count + wave.rings.length,
        0,
      ),
      shardCount: fixture.effect.shards.length,
      trailPointCount: fixture.effect.trailStrokes.reduce(
        (count, stroke) => count + stroke.points.length,
        0,
      ),
      hasVisibleEffects: fixture.effect._hasVisibleEffects(),
    },
    dpr: fixture.effect.dpr,
    layout:
    {
      width: targetBounds.width,
      height: targetBounds.height,
      canvasCount: fixture.target.querySelectorAll('canvas').length,
      visibleCanvasCount: getVisibleCanvases(fixture.target).length,
      insideShadowRoot: fixture.target.getRootNode() instanceof ShadowRoot,
      contain: getComputedStyle(fixture.target).contain,
    },
    pixels:
    {
      transparent: summarizePixels(transparent, fixture.effect.dpr),
      black: summarizePixels(black, fixture.effect.dpr),
      white: summarizePixels(white, fixture.effect.dpr),
      checker: summarizePixels(checker, fixture.effect.dpr),
    },
    contrastLayer: specification.inspectContrast
      ? captureContrastLayer(fixture.effect)
      : null,
    trailProfile: specification.straightTrailProbe
      ? summarizeStraightTrail(transparent, fixture.effect)
      : null,
  };
}

async function runSceneBackgroundReset()
{
  const fixture = await prepareEffect(
    {
      mode: 'full-webgl2',
      opacity: 1,
      isolatedCompositing: true,
      background: 'transparent',
      outputCompositing: 'scene',
      shadow: false,
      containStrict: false,
    },
  );
  const sceneBackground = createSceneBackground();
  const beforeScene = captureLayers(
    fixture.effect,
    fixture.target,
    'transparent',
  );
  const accepted = fixture.effect.setSceneBackground(sceneBackground);

  await runAnimationFrame(SAMPLE_TIME_MS);
  const withScene = captureLayers(
    fixture.effect,
    fixture.target,
    'transparent',
  );
  const cleared = fixture.effect.setSceneBackground(null);

  await runAnimationFrame(SAMPLE_TIME_MS);
  const withoutScene = captureLayers(
    fixture.effect,
    fixture.target,
    'transparent',
  );

  return {
    accepted,
    cleared,
    beforeScene: summarizePixels(beforeScene, fixture.effect.dpr),
    withScene: summarizePixels(withScene, fixture.effect.dpr),
    withoutScene: summarizePixels(withoutScene, fixture.effect.dpr),
  };
}

function waitForCanvasEvent(canvas, eventName, timeoutMs = 5000)
{
  return new Promise((resolve, reject) =>
  {
    const timeout = setTimeout(
      () =>
      {
        reject(new Error(`${eventName} 等待超时`));
      },
      timeoutMs,
    );

    canvas.addEventListener(
      eventName,
      (event) =>
      {
        clearTimeout(timeout);
        resolve(event);
      },
      {
        once: true,
      },
    );
  });
}

function summarizeBackgroundTransmission(images, dpr)
{
  const samples = RADIAL_SAMPLE_RADII.map((radius) =>
  {
    const x = CLICK_X + radius;
    const y = CLICK_Y;
    const transparent = getPixel(images.transparent, x, y, dpr);
    const black = getPixel(images.black, x, y, dpr);
    const white = getPixel(images.white, x, y, dpr);
    const checker = getPixel(images.checker, x, y, dpr);
    const expectedTransmission = 255 - transparent[3];
    const transmissionError = Math.max(
      ...black.slice(0, 3).map((channel, index) =>
        Math.abs(white[index] - channel - expectedTransmission)),
    );
    const checkerUsesBlack = (
      Math.floor(x / 8) + Math.floor(y / 8)
    ) % 2 === 0;
    const expectedChecker = checkerUsesBlack ? black : white;
    const checkerError = Math.max(
      ...checker.slice(0, 3).map((channel, index) =>
        Math.abs(channel - expectedChecker[index])),
    );

    return {
      radius,
      alpha: transparent[3],
      checkerError,
      checkerUsesBlack,
      transmissionError,
    };
  });

  return {
    maximumCheckerError: Math.max(...samples.map((sample) =>
      sample.checkerError)),
    maximumTransmissionError: Math.max(...samples.map((sample) =>
      sample.transmissionError)),
    samples,
  };
}

function compareAlphaImages(reference, current)
{
  let absoluteDeltaSum = 0;
  let visibleAbsoluteDeltaSum = 0;
  let visiblePixelCount = 0;
  let maximumAbsoluteDelta = 0;

  for (let offset = 3; offset < reference.data.length; offset += 4)
  {
    const delta = Math.abs(reference.data[offset] - current.data[offset]) / 255;

    absoluteDeltaSum += delta;
    maximumAbsoluteDelta = Math.max(maximumAbsoluteDelta, delta);

    if (reference.data[offset] > 0 || current.data[offset] > 0)
    {
      visibleAbsoluteDeltaSum += delta;
      visiblePixelCount++;
    }
  }

  const pixelCount = reference.width * reference.height;

  return {
    meanAbsoluteDelta: absoluteDeltaSum / pixelCount,
    maximumAbsoluteDelta,
    visibleMeanAbsoluteDelta: visibleAbsoluteDeltaSum /
      Math.max(1, visiblePixelCount),
    visiblePixelCount,
  };
}

function captureCompositingPhases(effect, target)
{
  const images = {};
  const pixels = {};

  for (const background of ['transparent', 'black', 'white', 'checker'])
  {
    images[background] = captureLayers(effect, target, background);
    pixels[background] = summarizePixels(images[background], effect.dpr);
  }

  pixels.backgroundTransmission = summarizeBackgroundTransmission(
    images,
    effect.dpr,
  );
  return {
    images,
    pixels,
  };
}

async function runContextLifecycle(specification)
{
  const mode = typeof specification === 'string'
    ? specification
    : specification.mode;
  const opacity = typeof specification === 'string'
    ? 1
    : specification.opacity;
  const fixture = await prepareEffect(
    {
      mode,
      opacity,
      isolatedCompositing: true,
      background: 'transparent',
      outputCompositing: 'transparent-overlay',
      shadow: false,
      containStrict: false,
      includeTrail: false,
      fxParams:
      {
        'shards.clickCount': 0,
        'shards.maxCount': 0,
      },
    },
  );
  const effect = fixture.effect;

  if (mode === 'full-webgl2')
  {
    // 完整 GPU 丢失后固定走 Software，避免独立 Bloom Context 掩盖回退帧。
    effect.updateConfig({ bloomBackend: 'software' });
    await runAnimationFrame(SAMPLE_TIME_MS);
  }

  const canvas = mode === 'full-webgl2'
    ? effect.webglEffectCanvas
    : effect.webglBloomCanvas;
  const context = canvas?.getContext('webgl2');
  const extension = context?.getExtension('WEBGL_lose_context');

  if (!canvas || !context || !extension)
  {
    throw new Error(`${mode} 不支持 WEBGL_lose_context`);
  }

  const beforeRoute = effect.getConfig();
  const before = captureCompositingPhases(effect, fixture.target);
  const lostEvent = waitForCanvasEvent(canvas, 'webglcontextlost');

  extension.loseContext();
  await lostEvent;
  const fallbackRoute = effect.getConfig();
  const fallback = captureCompositingPhases(effect, fixture.target);
  await runAnimationFrame(SAMPLE_TIME_MS);
  const fallbackSteadyRoute = effect.getConfig();
  const fallbackSteady = captureCompositingPhases(effect, fixture.target);
  const restoredEvent = waitForCanvasEvent(canvas, 'webglcontextrestored');

  // Chromium 需要先完成一次丢失后的 GPU 任务清理，立即 restore 会被忽略。
  await new Promise((resolve) => setTimeout(resolve, 100));
  extension.restoreContext();
  await restoredEvent;
  // 同一虚拟时间重建两帧，后端切换不能借生命周期推进掩盖 Alpha 跳变。
  await runAnimationFrame(SAMPLE_TIME_MS);
  await runAnimationFrame(SAMPLE_TIME_MS);
  const restoredRoute = effect.getConfig();
  const restored = captureCompositingPhases(effect, fixture.target);

  return {
    mode,
    opacity,
    before: before.pixels,
    fallback: fallback.pixels,
    fallbackSteady: fallbackSteady.pixels,
    restored: restored.pixels,
    alphaContinuity:
    {
      fallback: compareAlphaImages(
        before.images.transparent,
        fallback.images.transparent,
      ),
      fallbackSteady: compareAlphaImages(
        before.images.transparent,
        fallbackSteady.images.transparent,
      ),
      restored: compareAlphaImages(
        before.images.transparent,
        restored.images.transparent,
      ),
    },
    beforeRoute:
    {
      effect: beforeRoute.resolvedEffectBackend,
      bloom: beforeRoute.resolvedBloomBackend,
    },
    fallbackRoute:
    {
      effect: fallbackRoute.resolvedEffectBackend,
      bloom: fallbackRoute.resolvedBloomBackend,
    },
    fallbackSteadyRoute:
    {
      effect: fallbackSteadyRoute.resolvedEffectBackend,
      bloom: fallbackSteadyRoute.resolvedBloomBackend,
    },
    restoredRoute:
    {
      effect: restoredRoute.resolvedEffectBackend,
      bloom: restoredRoute.resolvedBloomBackend,
    },
  };
}

function instrumentImageReadback(context, shouldFail)
{
  const ownDescriptor = Object.getOwnPropertyDescriptor(
    context,
    'getImageData',
  );
  const original = context.getImageData;
  let calls = 0;

  Object.defineProperty(
    context,
    'getImageData',
    {
      configurable: true,
      value(...args)
      {
        calls++;

        if (shouldFail)
        {
          throw new Error('BAClickFX browser readback fault injection');
        }

        return original.apply(context, args);
      },
    },
  );

  return {
    get calls()
    {
      return calls;
    },
    restore()
    {
      if (ownDescriptor)
      {
        Object.defineProperty(context, 'getImageData', ownDescriptor);
        return;
      }

      delete context.getImageData;
    },
  };
}

function recordBackendEvents(effect)
{
  const events = [];
  const onEffectBackendChange = (event) =>
  {
    events.push(
      {
        kind: 'effect',
        requested: event.detail.requestedEffectBackend,
        resolved: event.detail.resolvedEffectBackend,
      },
    );
  };
  const onBloomBackendChange = (event) =>
  {
    events.push(
      {
        kind: 'bloom',
        requested: event.detail.requestedBloomBackend,
        resolved: event.detail.resolvedBloomBackend,
      },
    );
  };

  effect.canvas.addEventListener(
    EFFECT_BACKEND_CHANGE_EVENT,
    onEffectBackendChange,
  );
  effect.canvas.addEventListener(
    BLOOM_BACKEND_CHANGE_EVENT,
    onBloomBackendChange,
  );

  return {
    events,
    stop()
    {
      effect.canvas.removeEventListener(
        EFFECT_BACKEND_CHANGE_EVENT,
        onEffectBackendChange,
      );
      effect.canvas.removeEventListener(
        BLOOM_BACKEND_CHANGE_EVENT,
        onBloomBackendChange,
      );
    },
  };
}

async function runBackendFailureChain(specification)
{
  const mode = specification.mode;
  const opacity = specification.opacity;
  const fixture = await prepareEffect(
    {
      mode,
      opacity,
      isolatedCompositing: true,
      background: 'transparent',
      outputCompositing: 'transparent-overlay',
      shadow: false,
      containStrict: false,
      includeTrail: false,
      fxParams:
      {
        'shards.clickCount': 0,
        'shards.maxCount': 0,
      },
    },
  );
  const effect = fixture.effect;

  if (mode === 'full-webgl2')
  {
    // 完整特效 Context 丢失后必须固定经过 Software，再注入回读故障。
    effect.updateConfig({ bloomBackend: 'software' });
    await runAnimationFrame(SAMPLE_TIME_MS);
  }

  const canvas = mode === 'full-webgl2'
    ? effect.webglEffectCanvas
    : effect.webglBloomCanvas;
  const context = canvas?.getContext('webgl2');
  const extension = context?.getExtension('WEBGL_lose_context');
  const softwareRenderer = effect.bloomRenderer;

  if (!canvas || !context || !extension || !softwareRenderer)
  {
    throw new Error(`${mode} 无法建立完整后端失败链`);
  }

  const poolIdentityBeforeFailure =
    effect.bloomRenderers[0] === softwareRenderer;
  const beforeRoute = effect.getConfig();
  const before = captureCompositingPhases(effect, fixture.target);
  const backendEvents = recordBackendEvents(effect);
  const lostEvent = waitForCanvasEvent(canvas, 'webglcontextlost');

  extension.loseContext();
  await lostEvent;
  const softwareRoute = effect.getConfig();
  const software = captureCompositingPhases(effect, fixture.target);
  const sourceContext = softwareRenderer.sourceContext;
  const coverageContext = softwareRenderer.coverageContext;

  if (!sourceContext || !coverageContext)
  {
    backendEvents.stop();
    throw new Error(`${mode} Software 回退没有建立透明 Coverage 回读面`);
  }

  const sourceProbe = instrumentImageReadback(
    sourceContext,
    mode === 'full-webgl2',
  );
  const coverageProbe = instrumentImageReadback(
    coverageContext,
    mode === 'webgl2-bloom',
  );

  await runAnimationFrame(SAMPLE_TIME_MS);
  const faultRoute = effect.getConfig();
  const fault = captureCompositingPhases(effect, fixture.target);
  await runAnimationFrame(SAMPLE_TIME_MS);
  const nativeRoute = effect.getConfig();
  const native = captureCompositingPhases(effect, fixture.target);
  const sourceCalls = sourceProbe.calls;
  const coverageCalls = coverageProbe.calls;

  sourceProbe.restore();
  coverageProbe.restore();
  const unavailableAfterFailure = softwareRenderer.available === false;
  const restoredEvent = waitForCanvasEvent(canvas, 'webglcontextrestored');

  // Chromium 会忽略紧跟 loseContext() 的同步恢复请求。
  await new Promise((resolve) => setTimeout(resolve, 100));
  extension.restoreContext();
  await restoredEvent;
  await runAnimationFrame(SAMPLE_TIME_MS);
  await runAnimationFrame(SAMPLE_TIME_MS);
  const restoredRoute = effect.getConfig();
  const restored = captureCompositingPhases(effect, fixture.target);
  const events = backendEvents.events.slice();

  backendEvents.stop();

  return (
    {
      mode,
      opacity,
      before: before.pixels,
      software: software.pixels,
      fault: fault.pixels,
      native: native.pixels,
      restored: restored.pixels,
      alphaContinuity:
      {
        software: compareAlphaImages(
          before.images.transparent,
          software.images.transparent,
        ),
        fault: compareAlphaImages(
          before.images.transparent,
          fault.images.transparent,
        ),
        faultToNative: compareAlphaImages(
          fault.images.transparent,
          native.images.transparent,
        ),
        native: compareAlphaImages(
          before.images.transparent,
          native.images.transparent,
        ),
        restored: compareAlphaImages(
          before.images.transparent,
          restored.images.transparent,
        ),
      },
      routes:
      {
        before:
        {
          effect: beforeRoute.resolvedEffectBackend,
          bloom: beforeRoute.resolvedBloomBackend,
        },
        software:
        {
          effect: softwareRoute.resolvedEffectBackend,
          bloom: softwareRoute.resolvedBloomBackend,
        },
        fault:
        {
          effect: faultRoute.resolvedEffectBackend,
          bloom: faultRoute.resolvedBloomBackend,
        },
        native:
        {
          effect: nativeRoute.resolvedEffectBackend,
          bloom: nativeRoute.resolvedBloomBackend,
        },
        restored:
        {
          effect: restoredRoute.resolvedEffectBackend,
          bloom: restoredRoute.resolvedBloomBackend,
        },
      },
      readback:
      {
        coverageCalls,
        faultTarget: mode === 'full-webgl2' ? 'source' : 'coverage',
        sourceCalls,
      },
      renderer:
      {
        availableAfterRestore: softwareRenderer.available,
        poolIdentityAfterRestore: effect.bloomRenderer === softwareRenderer &&
          effect.bloomRenderers[0] === softwareRenderer,
        poolIdentityBeforeFailure,
        sourceContextPreserved: softwareRenderer.sourceContext === sourceContext,
        coverageContextPreserved:
          softwareRenderer.coverageContext === coverageContext,
        unavailableAfterFailure,
      },
      events,
    }
  );
}

function getWebGLModeResources(effect, mode)
{
  if (mode === 'full-webgl2')
  {
    return {
      canvas: effect.webglEffectCanvas,
      renderer: effect.webglEffectRenderer,
    };
  }

  return {
    canvas: effect.webglBloomCanvas,
    renderer: effect.webglBloomRenderer,
  };
}

async function runTrailTextureResourceLifecycle()
{
  const fixture = await prepareEffect(
    {
      mode: 'full-webgl2',
      opacity: 1,
      isolatedCompositing: true,
      background: 'transparent',
      outputCompositing: 'scene',
      shadow: false,
      containStrict: false,
      includeClick: false,
      includeTrail: true,
      includeTrailShards: false,
      straightTrailProbe: true,
      inspectTrailTexture: true,
      scale: 64,
    },
  );
  const effect = fixture.effect;
  const resources = getWebGLModeResources(effect, 'full-webgl2');
  const renderer = resources.renderer;
  const context = renderer?.gl;
  const texture = renderer?.trailTexture;

  if (!renderer || !context || !texture)
  {
    throw new Error('纯 WebGL2 没有建立 Trail 静态纹理');
  }

  const initialTextureValid = context.isTexture(texture);
  const hadFrameTargets = renderer.sourceTarget !== null &&
    renderer.levels.length > 0;

  effect.updateConfig({ effectBackend: 'canvas2d' });

  const releaseRetainedTexture = renderer.trailTexture === texture &&
    context.isTexture(texture);
  const releaseClearedFrameTargets = renderer.sourceTarget === null &&
    renderer.levels.length === 0;
  const canvas = resources.canvas;

  effect.destroy();

  const destroyDeletedTexture = !context.isTexture(texture) &&
    renderer.trailTexture === null;
  const destroyClearedCpuTrail = renderer.trailVertexData.length === 0;

  // destroy() 必须先移除恢复监听；伪恢复事件不能重新建立已销毁资源。
  canvas.dispatchEvent(new Event('webglcontextrestored'));

  return {
    initialTextureValid,
    hadFrameTargets,
    releaseRetainedTexture,
    releaseClearedFrameTargets,
    destroyDeletedTexture,
    destroyClearedCpuTrail,
    restoreIgnoredAfterDestroy: renderer.trailTexture === null &&
      renderer.available === false,
  };
}

async function runTrailContextLifecycle(mode)
{
  const fixture = await prepareEffect(
    {
      mode,
      opacity: 1,
      isolatedCompositing: true,
      background: 'transparent',
      outputCompositing: 'scene',
      shadow: false,
      containStrict: false,
      includeClick: false,
      includeTrail: true,
      includeTrailShards: false,
      straightTrailProbe: true,
      inspectTrailTexture: true,
      scale: 64,
    },
  );
  const effect = fixture.effect;
  const resources = getWebGLModeResources(effect, mode);
  const canvas = resources.canvas;
  const renderer = resources.renderer;
  const context = canvas?.getContext('webgl2');
  const extension = context?.getExtension('WEBGL_lose_context');
  const originalTexture = renderer?.trailTexture;

  if (!canvas || !renderer || !context || !extension || !originalTexture)
  {
    throw new Error(`${mode} 无法建立 Trail Context 生命周期夹具`);
  }

  const beforeImage = captureLayers(
    effect,
    fixture.target,
    'transparent',
  );
  const beforeProfile = summarizeStraightTrail(beforeImage, effect);
  const originalTextureValid = context.isTexture(originalTexture);
  const lostEvent = waitForCanvasEvent(canvas, 'webglcontextlost');

  extension.loseContext();
  await lostEvent;
  await runAnimationFrame(SAMPLE_TIME_MS + 1);

  const restoredEvent = waitForCanvasEvent(canvas, 'webglcontextrestored');

  // Chromium 需要先完成一次丢失后的 GPU 任务清理，立即 restore 会被忽略。
  await new Promise((resolve) => setTimeout(resolve, 100));
  extension.restoreContext();
  await restoredEvent;
  await runAnimationFrame(SAMPLE_TIME_MS + 2);
  await runAnimationFrame(SAMPLE_TIME_MS + 3);

  const restoredResources = getWebGLModeResources(effect, mode);
  const restoredTexture = restoredResources.renderer?.trailTexture;
  const restoredImage = captureLayers(
    effect,
    fixture.target,
    'transparent',
  );
  const restoredProfile = summarizeStraightTrail(restoredImage, effect);
  const restoredRoute = effect.getConfig();

  return {
    mode,
    beforeProfile,
    restoredProfile,
    texture:
    {
      originalValid: originalTextureValid,
      rendererReused: restoredResources.renderer === renderer,
      replaced: restoredTexture !== originalTexture,
      restoredValid: Boolean(
        restoredTexture && context.isTexture(restoredTexture),
      ),
    },
    restoredRoute:
    {
      effect: restoredRoute.resolvedEffectBackend,
      bloom: restoredRoute.resolvedBloomBackend,
    },
  };
}

async function waitForCompositorFrame()
{
  await new Promise((resolve) => nativeRequestAnimationFrame(resolve));
  await new Promise((resolve) => nativeRequestAnimationFrame(resolve));

  if (animationFrames.size > 0)
  {
    // ResizeObserver 在原生合成帧重设 Canvas 尺寸后会请求库 RAF；测试使用
    // 虚拟时钟，必须主动冲刷该帧，否则截图会落在清屏与重绘之间。
    await runAnimationFrame(virtualNow);
  }
}

function getStageClip()
{
  const bounds = document.getElementById('stage').getBoundingClientRect();

  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

window.browserPixelSuite = Object.freeze(
  {
    modeNames: Object.keys(MODE_CONFIGS),
    runCase,
    runSceneBackgroundReset,
    runContextLifecycle,
    runBackendFailureChain,
    runTrailTextureResourceLifecycle,
    runTrailContextLifecycle,
    waitForCompositorFrame,
    getStageClip,
    dispose: disposeActiveFixture,
  },
);
window.__BACLICKFX_PIXEL_READY__ = true;
window.__BACLICKFX_PIXEL_PROGRESS__ = 'ready';
