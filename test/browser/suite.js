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

  if (!mode)
  {
    throw new Error(`未知渲染模式: ${specification.mode}`);
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
      lightBackgroundContrastAlpha: 0,
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

  activeFixture = {
    ...fixture,
    effect,
    specification,
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

  await runAnimationFrame(SAMPLE_TIME_MS);

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

async function runContextLifecycle(mode)
{
  const withSceneBackground = mode === 'full-webgl2';
  const fixture = await prepareEffect(
    {
      mode,
      opacity: 1,
      isolatedCompositing: true,
      background: withSceneBackground ? 'transparent' : 'checker',
      outputCompositing: withSceneBackground
        ? 'scene'
        : 'transparent-overlay',
      shadow: false,
      containStrict: false,
    },
  );
  const effect = fixture.effect;
  const sceneBackgroundAccepted = withSceneBackground
    ? effect.setSceneBackground(createSceneBackground())
    : null;

  if (withSceneBackground)
  {
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

  const before = summarizePixels(
    captureLayers(effect, fixture.target, 'transparent'),
    effect.dpr,
  );
  const lostEvent = waitForCanvasEvent(canvas, 'webglcontextlost');

  extension.loseContext();
  await lostEvent;
  await runAnimationFrame(SAMPLE_TIME_MS + 1);
  const fallbackRoute = effect.getConfig();
  const fallback = summarizePixels(
    captureLayers(effect, fixture.target, 'transparent'),
    effect.dpr,
  );
  const restoredEvent = waitForCanvasEvent(canvas, 'webglcontextrestored');

  // Chromium 需要先完成一次丢失后的 GPU 任务清理，立即 restore 会被忽略。
  await new Promise((resolve) => setTimeout(resolve, 100));
  extension.restoreContext();
  await restoredEvent;
  await runAnimationFrame(SAMPLE_TIME_MS + 2);
  await runAnimationFrame(SAMPLE_TIME_MS + 3);
  const restoredRoute = effect.getConfig();
  const restored = summarizePixels(
    captureLayers(effect, fixture.target, 'transparent'),
    effect.dpr,
  );

  return {
    mode,
    sceneBackgroundAccepted,
    before,
    fallback,
    restored,
    fallbackRoute:
    {
      effect: fallbackRoute.resolvedEffectBackend,
      bloom: fallbackRoute.resolvedBloomBackend,
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
    waitForCompositorFrame,
    getStageClip,
    dispose: disposeActiveFixture,
  },
);
window.__BACLICKFX_PIXEL_READY__ = true;
window.__BACLICKFX_PIXEL_PROGRESS__ = 'ready';
