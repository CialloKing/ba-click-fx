const FIXTURE_WIDTH = 320;
const FIXTURE_HEIGHT = 240;
const CLICK_X = 160;
const CLICK_Y = 96;
const SAMPLE_TIME_MS = 120;
const RADIAL_SAMPLE_RADII = [0, 4, 8, 12, 16, 24, 32, 48, 64];
const STRAIGHT_TRAIL_START_X = 48;
const STRAIGHT_TRAIL_END_X = 272;
const STRAIGHT_TRAIL_Y = 120;
const STRAIGHT_TRAIL_TRANSMISSION_X = 200;
const STRAIGHT_TRAIL_HEAD_U = 0.08;
const STRAIGHT_TRAIL_ASYMMETRY_U = 0.15;
const STRAIGHT_TRAIL_EDGE_V = 0.05;
const TRANSPARENT_CONTRACT_GUARD_RADIUS = 72;

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
const runtimeKind = new URLSearchParams(window.location.search)
  .get('runtime') === 'iife'
  ? 'iife'
  : 'source';

async function loadIifeRuntime()
{
  const script = document.createElement('script');

  script.src = '/dist/ba-click-fx.iife.js';
  script.async = true;
  await new Promise((resolve, reject) =>
  {
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error(`IIFE 运行时加载失败: ${script.src}`)),
      { once: true },
    );
    document.head.appendChild(script);
  });

  // HTTP 成功也可能是 Vite 的 HTML 回退，必须验证真实包根导出。
  if (typeof window.BAClickFX?.BAClickFX !== 'function')
  {
    throw new Error('IIFE 运行时没有暴露 BAClickFX.BAClickFX');
  }

  return window.BAClickFX;
}

const runtimeExports = runtimeKind === 'iife'
  ? await loadIifeRuntime()
  : await import('../../src/fx.js');
const {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
} = runtimeExports;
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
  else if (background === 'color')
  {
    target.style.backgroundColor = '#4a7f62';
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

  if (background === 'color')
  {
    context.fillStyle = '#4a7f62';
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

function sampleHorizontalAlpha(imageData, x, y, dpr, radius = 2)
{
  let alpha = 0;
  let count = 0;

  for (let offset = -radius; offset <= radius; offset++)
  {
    alpha += getPixel(imageData, x + offset, y, dpr)[3] / 255;
    count++;
  }

  return alpha / Math.max(1, count);
}

function sampleHorizontalPremultipliedColor(
  imageData,
  x,
  y,
  dpr,
  radius = 2,
)
{
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;

  for (let offset = -radius; offset <= radius; offset++)
  {
    const pixel = getPixel(imageData, x + offset, y, dpr);
    const pixelAlpha = pixel[3] / 255;

    // Canvas 回读会解预乘；乘回 Alpha 后才是 source-over 实际传输载荷。
    red += pixel[0] / 255 * pixelAlpha;
    green += pixel[1] / 255 * pixelAlpha;
    blue += pixel[2] / 255 * pixelAlpha;
    alpha += pixelAlpha;
    count++;
  }

  const divisor = Math.max(1, count);
  const channels = [red / divisor, green / divisor, blue / divisor];
  const maximum = Math.max(...channels);
  const minimum = Math.min(...channels);

  return {
    alpha: alpha / divisor,
    blue: channels[2],
    chroma: maximum - minimum,
    energy: maximum,
    green: channels[1],
    neutralEnergy: minimum,
    red: channels[0],
    saturation: maximum > 0 ? (maximum - minimum) / maximum : 0,
  };
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
    tailColor: sampleHorizontalPremultipliedColor(
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

function summarizeOutsideEffectGuard(imageData, effect)
{
  const specification = activeFixture?.specification ?? {};
  const anchors = [];

  if (specification.includeClick !== false)
  {
    anchors.push([CLICK_X, CLICK_Y]);
  }

  for (const stroke of effect.trailStrokes)
  {
    for (const point of stroke.points)
    {
      anchors.push([point.x, point.y]);
    }
  }

  if (anchors.length === 0)
  {
    return {
      bounds: null,
      maximumAlpha: 0,
      maximumEnergy: 0,
      sampleCount: 0,
      visiblePixelCount: 0,
    };
  }

  // _getScale() 是 Unity 世界到参考像素的比例，不是 CSS 坐标倍率；
  // 保护框必须使用夹具坐标中的固定余量，避免把合法 Bloom 误判为底色。
  const padding = TRANSPARENT_CONTRACT_GUARD_RADIUS;
  const minimumX = Math.max(
    0,
    Math.floor((Math.min(...anchors.map(([x]) => x)) - padding) * effect.dpr),
  );
  const minimumY = Math.max(
    0,
    Math.floor((Math.min(...anchors.map(([, y]) => y)) - padding) * effect.dpr),
  );
  const maximumX = Math.min(
    imageData.width - 1,
    Math.ceil((Math.max(...anchors.map(([x]) => x)) + padding) * effect.dpr),
  );
  const maximumY = Math.min(
    imageData.height - 1,
    Math.ceil((Math.max(...anchors.map(([, y]) => y)) + padding) * effect.dpr),
  );
  let maximumAlpha = 0;
  let maximumEnergy = 0;
  let sampleCount = 0;
  let visiblePixelCount = 0;

  for (let y = 0; y < imageData.height; y++)
  {
    for (let x = 0; x < imageData.width; x++)
    {
      if (
        x >= minimumX && x <= maximumX &&
        y >= minimumY && y <= maximumY
      )
      {
        continue;
      }

      const offset = (y * imageData.width + x) * 4;
      const alpha = imageData.data[offset + 3];
      const straightEnergy = Math.max(
        imageData.data[offset],
        imageData.data[offset + 1],
        imageData.data[offset + 2],
      );
      const energy = straightEnergy * alpha / 255;

      maximumAlpha = Math.max(maximumAlpha, alpha);
      maximumEnergy = Math.max(maximumEnergy, energy);
      sampleCount++;

      if (alpha > 1 || energy > 1)
      {
        visiblePixelCount++;
      }
    }
  }

  return {
    bounds:
    {
      maximumX: maximumX / effect.dpr,
      maximumY: maximumY / effect.dpr,
      minimumX: minimumX / effect.dpr,
      minimumY: minimumY / effect.dpr,
    },
    maximumAlpha: maximumAlpha / 255,
    maximumEnergy: maximumEnergy / 255,
    sampleCount,
    visiblePixelCount,
  };
}

function readWebGLTargetPixel(renderer, target, x, y)
{
  const gl = renderer?.gl;

  if (!gl || !target?.framebuffer || target.width <= 0 || target.height <= 0)
  {
    return null;
  }

  const targetX = Math.max(
    0,
    Math.min(
      target.width - 1,
      Math.floor(x / renderer.displayWidth * target.width),
    ),
  );
  // WebGL RenderTarget 以左下为原点，夹具坐标以左上为原点。
  const targetY = Math.max(
    0,
    Math.min(
      target.height - 1,
      Math.floor((1 - y / renderer.displayHeight) * target.height),
    ),
  );
  const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  const pixel = new Float32Array(4);

  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.readPixels(targetX, targetY, 1, 1, gl.RGBA, gl.FLOAT, pixel);
  gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);

  if (gl.getError() !== gl.NO_ERROR)
  {
    return null;
  }

  return Array.from(pixel);
}

function captureWebGLTransport(effect, x, y)
{
  const renderer = effect.webglEffectVisible
    ? effect.webglEffectRenderer
    : effect.webglBloomVisible
      ? effect.webglBloomRenderer
      : null;

  if (!renderer?.available || !renderer.sourceTarget)
  {
    return null;
  }

  const bloomTarget = renderer.levels.length === 1
    ? renderer.levels[0]?.down
    : renderer.levels[0]?.up;
  const diskConfig = effect.getFxConfig().disk;

  return {
    bloom: readWebGLTargetPixel(renderer, bloomTarget, x, y),
    disk:
    {
      alphaKeys: diskConfig.alphaKeys,
      lifetimeMs: diskConfig.lifetimeMs,
    },
    scene: readWebGLTargetPixel(renderer, renderer.sourceTarget, x, y),
    sceneOverlay: readWebGLTargetPixel(
      renderer,
      renderer.sceneOverlayTarget,
      x,
      y,
    ),
    waveAges: effect.waves.map((wave) => wave.ageMs),
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

function createCompositingReference()
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
  const effectOptions =
  {
    target: fixture.target,
    inputSource: 'manual',
    trailAlways: true,
    outputCompositing: specification.outputCompositing ??
      'browser-overlay',
    hostCompositing: specification.hostCompositing,
    opacity: specification.opacity,
    scale: specification.scale ?? 1,
    isolatedCompositing: specification.isolatedCompositing,
    lightBackgroundContrastAlpha:
      specification.lightBackgroundContrastAlpha ?? 0,
    maxDpr: 2,
    effectBackend: mode.effectBackend,
    renderingMode: mode.renderingMode,
    bloomBackend: mode.bloomBackend,
  };

  // 只把调用方实际提供的透明配置传入；传入 undefined 会让归一化器把
  // 兼容字段误认为已被新字段覆盖，破坏 unknownBackgroundAppearance 映射。
  for (const key of [
    'unknownBackgroundAppearance',
    'overlayAlphaPolicy',
    'overlayAlphaLimit',
    'overlayColorCompensation',
  ])
  {
    if (
      Object.hasOwn(specification, key) &&
      specification[key] !== undefined
    )
    {
      effectOptions[key] = specification[key];
    }
  }

  const effect = new BAClickFX(effectOptions);

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
    webglTransport: specification.inspectWebGLTransport
      ? captureWebGLTransport(fixture.effect, CLICK_X, CLICK_Y)
      : null,
  };
}

async function runCompositingReferenceReset()
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
  const compositingReference = createCompositingReference();
  const beforeReference = captureLayers(
    fixture.effect,
    fixture.target,
    'transparent',
  );
  const referenceSet = fixture.effect.setCompositingReference(
    compositingReference,
    { fit: 'cover' },
  );

  await runAnimationFrame(SAMPLE_TIME_MS);
  const withReference = captureLayers(
    fixture.effect,
    fixture.target,
    'transparent',
  );
  const referenceCleared = fixture.effect.setCompositingReference(null);

  await runAnimationFrame(SAMPLE_TIME_MS);

  const withoutReference = captureLayers(
    fixture.effect,
    fixture.target,
    'transparent',
  );
  const referenceClearedFromEffect =
    fixture.effect.compositingReferenceSource === null;
  const referenceRestored = fixture.effect.setCompositingReference(
    compositingReference,
    { fit: 'cover' },
  );

  await runAnimationFrame(SAMPLE_TIME_MS);

  const restoredReference = captureLayers(
    fixture.effect,
    fixture.target,
    'transparent',
  );
  const referenceRestoredInEffect =
    fixture.effect.compositingReferenceSource === compositingReference;
  const referenceClearedAgain = fixture.effect.setCompositingReference(null);
  const referenceClearedAgainFromEffect =
    fixture.effect.compositingReferenceSource === null;

  await runAnimationFrame(SAMPLE_TIME_MS);
  const withoutReferenceAgain = captureLayers(
    fixture.effect,
    fixture.target,
    'transparent',
  );

  return {
    referenceSet,
    referenceCleared,
    referenceClearedAgain,
    referenceClearedFromEffect,
    referenceClearedAgainFromEffect,
    referenceRestored,
    referenceRestoredInEffect,
    beforeReference: summarizePixels(beforeReference, fixture.effect.dpr),
    withReference: summarizePixels(withReference, fixture.effect.dpr),
    withoutReference: summarizePixels(
      withoutReference,
      fixture.effect.dpr,
    ),
    restoredReference: summarizePixels(restoredReference, fixture.effect.dpr),
    withoutReferenceAgain: summarizePixels(
      withoutReferenceAgain,
      fixture.effect.dpr,
    ),
  };
}

function captureTransparentContractPhase(effect, target)
{
  const capture = captureCompositingPhases(effect, target);
  const snapshot = effect.getConfig();
  const transparent = capture.images.transparent;

  return {
    config:
    {
      hostCompositing: snapshot.hostCompositing,
      opacity: snapshot.opacity,
      outputCompositing: snapshot.outputCompositing,
      overlayAlphaPolicy: snapshot.overlayAlphaPolicy,
      overlayAlphaLimit: snapshot.overlayAlphaLimit,
      overlayColorCompensation: snapshot.overlayColorCompensation,
      unknownBackgroundAppearance: snapshot.unknownBackgroundAppearance,
    },
    route:
    {
      bloom: snapshot.resolvedBloomBackend,
      effect: snapshot.resolvedEffectBackend,
    },
    lifecycle:
    {
      clickTimeMs: effect.clickTimeMs,
      shardAges: effect.shards.map((shard) => shard.ageMs),
      trailPointBirthTimes: effect.trailStrokes.flatMap((stroke) =>
        stroke.points.map((point) => point.bornAt)),
      trailTimeMs: effect.trailTimeMs,
      waveAges: effect.waves.map((wave) => wave.ageMs),
    },
    mount:
    {
      canvasBlendMode: effect.canvas.style.mixBlendMode,
      overlayRootBlendMode: effect.overlayRoot?.style.mixBlendMode ?? '',
      overlayRootConnected: effect.overlayRoot?.isConnected === true,
    },
    outside: capture.pixels.outside,
    pixels: capture.pixels,
    trailProfile: activeFixture?.specification.straightTrailProbe
      ? summarizeStraightTrail(transparent, effect)
      : null,
  };
}

async function beginTransparentContractTransitions(specification)
{
  const fixture = await prepareEffect(
    {
      ...specification,
      background: specification.background ?? 'checker',
      containStrict: false,
      includeTrail: specification.includeTrail ?? true,
      isolatedCompositing: specification.isolatedCompositing ?? true,
      outputCompositing: 'browser-overlay',
      shadow: false,
    },
  );

  return captureTransparentContractPhase(fixture.effect, fixture.target);
}

async function transitionTransparentContract(specification = {})
{
  if (!activeFixture)
  {
    throw new Error('透明合同热切换夹具尚未建立');
  }

  const effect = activeFixture.effect;
  const patch = {};

  for (const key of [
    'hostCompositing',
    'opacity',
    'outputCompositing',
    'overlayAlphaPolicy',
    'overlayAlphaLimit',
    'overlayColorCompensation',
    'unknownBackgroundAppearance',
  ])
  {
    if (
      Object.hasOwn(specification, key) &&
      specification[key] !== undefined
    )
    {
      patch[key] = specification[key];
    }
  }

  if (Object.hasOwn(specification, 'background'))
  {
    applyBackground(activeFixture.target, specification.background);
  }

  if (Object.keys(patch).length > 0)
  {
    effect.updateConfig(patch);
  }

  // 使用相同虚拟时间重绘，模式切换不能借生命周期推进掩盖亮度跳变。
  await runAnimationFrame(activeFixture.sampleTimeMs);
  return captureTransparentContractPhase(effect, activeFixture.target);
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

function summarizeBackgroundTransmission(
  images,
  dpr,
  centerX = CLICK_X,
  centerY = CLICK_Y,
)
{
  const samples = RADIAL_SAMPLE_RADII.map((radius) =>
  {
    const x = centerX + radius;
    const y = centerY;
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

    return (
      {
        radius,
        alpha: transparent[3],
        checkerError,
        checkerUsesBlack,
        transmissionError,
      }
    );
  });

  return (
    {
      maximumCheckerError: Math.max(...samples.map((sample) =>
        sample.checkerError)),
      maximumTransmissionError: Math.max(...samples.map((sample) =>
        sample.transmissionError)),
      maximumSampleAlpha: Math.max(...samples.map((sample) => sample.alpha)),
      samples,
      visibleSampleCount: samples.filter((sample) => sample.alpha > 0).length,
    }
  );
}

function compareAlphaImages(reference, current)
{
  let absoluteDeltaSum = 0;
  let visibleAbsoluteDeltaSum = 0;
  let visiblePixelCount = 0;
  let maximumAbsoluteDelta = 0;
  let maximumDifference = null;

  for (let offset = 3; offset < reference.data.length; offset += 4)
  {
    const delta = Math.abs(reference.data[offset] - current.data[offset]) / 255;

    absoluteDeltaSum += delta;

    if (delta > maximumAbsoluteDelta)
    {
      const pixelIndex = (offset - 3) / 4;

      maximumAbsoluteDelta = delta;
      maximumDifference =
      {
        current: current.data[offset],
        reference: reference.data[offset],
        x: pixelIndex % reference.width,
        y: Math.floor(pixelIndex / reference.width),
      };
    }

    if (reference.data[offset] > 0 || current.data[offset] > 0)
    {
      visibleAbsoluteDeltaSum += delta;
      visiblePixelCount++;
    }
  }

  const pixelCount = reference.width * reference.height;

  return (
    {
      meanAbsoluteDelta: absoluteDeltaSum / pixelCount,
      maximumAbsoluteDelta,
      maximumDifference,
      visibleMeanAbsoluteDelta: visibleAbsoluteDeltaSum /
        Math.max(1, visiblePixelCount),
      visiblePixelCount,
    }
  );
}

function captureCanvasLayerState(canvas, target)
{
  if (!canvas)
  {
    return {
      coversTarget: false,
      directChild: false,
      exists: false,
      position: '',
      visible: false,
    };
  }

  const style = getComputedStyle(canvas);
  const bounds = canvas.getBoundingClientRect();
  const targetBounds = target.getBoundingClientRect();
  const visible = style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    Number.parseFloat(style.opacity || '1') > 0;

  return {
    coversTarget: visible &&
      Math.abs(bounds.left - targetBounds.left) <= 0.5 &&
      Math.abs(bounds.top - targetBounds.top) <= 0.5 &&
      Math.abs(bounds.width - targetBounds.width) <= 0.5 &&
      Math.abs(bounds.height - targetBounds.height) <= 0.5,
    directChild: canvas.parentElement === target,
    exists: true,
    position: style.position,
    visible,
  };
}

function captureCompositingState(effect, target)
{
  const canvases = [...target.querySelectorAll('canvas')];
  const snapshot = effect.getConfig();
  const layerStates =
  {
    contrast: captureCanvasLayerState(effect.contrastCanvas, target),
    main: captureCanvasLayerState(effect.canvas, target),
    webglBloom: captureCanvasLayerState(effect.webglBloomCanvas, target),
    webglEffect: captureCanvasLayerState(effect.webglEffectCanvas, target),
  };
  const visibleLayers = Object.values(layerStates)
    .filter((layer) => layer.exists && layer.visible);

  return {
    hostCompositing: snapshot.hostCompositing,
    isolatedCompositing: snapshot.isolatedCompositing,
    outputCompositing: snapshot.outputCompositing,
    overlayAlphaPolicy: snapshot.overlayAlphaPolicy,
    overlayAlphaLimit: snapshot.overlayAlphaLimit,
    overlayColorCompensation: snapshot.overlayColorCompensation,
    overlayRootBlendMode: effect.overlayRoot?.style.mixBlendMode ?? '',
    unknownBackgroundAppearance: snapshot.unknownBackgroundAppearance,
    overlayParentIsTarget: effect.overlayParent === target,
    overlayRootConnected: effect.overlayRoot?.isConnected === true,
    allCanvasLayersAbsolute: canvases.every((canvas) =>
      getComputedStyle(canvas).position === 'absolute'),
    allCanvasLayersDirectChildren: canvases.every((canvas) =>
      canvas.parentElement === target),
    visibleLayersCoverTarget: visibleLayers.length > 0 &&
      visibleLayers.every((layer) => layer.coversTarget),
    layers: layerStates,
  };
}

function captureCompositingPhases(effect, target, transmissionCenter = null)
{
  const images =
  {
  };
  const pixels =
  {
  };

  for (const background of [
    'transparent',
    'black',
    'white',
    'color',
    'checker',
  ])
  {
    images[background] = captureLayers(effect, target, background);
    pixels[background] = summarizePixels(images[background], effect.dpr);
  }

  pixels.backgroundTransmission = summarizeBackgroundTransmission(
    images,
    effect.dpr,
    transmissionCenter?.x,
    transmissionCenter?.y,
  );
  pixels.transparent.trailProbeAlpha = sampleHorizontalAlpha(
    images.transparent,
    (112 + 184) * 0.5,
    STRAIGHT_TRAIL_Y,
    effect.dpr,
  );
  pixels.outside = summarizeOutsideEffectGuard(images.transparent, effect);
  return (
    {
      compositing: captureCompositingState(effect, target),
      images,
      pixels,
    }
  );
}

async function runContextLifecycle(specification)
{
  const options = typeof specification === 'string'
    ? { mode: specification }
    : specification;
  const mode = options.mode;
  const opacity = options.opacity ?? 1;
  const isolatedCompositing = options.isolatedCompositing !== false;
  const fixture = await prepareEffect(
    {
      mode,
      opacity,
      isolatedCompositing,
      background: 'transparent',
      outputCompositing: 'browser-overlay',
      overlayAlphaPolicy: options.overlayAlphaPolicy,
      overlayColorCompensation: options.overlayColorCompensation,
      unknownBackgroundAppearance: options.unknownBackgroundAppearance,
      overlayAlphaLimit: options.overlayAlphaLimit,
      hostCompositing: options.hostCompositing,
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
    effect.updateConfig(
      {
        bloomBackend: 'software',
      },
    );
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
  const restoringRoute = effect.getConfig();
  const restoring = captureCompositingPhases(effect, fixture.target);
  await runAnimationFrame(SAMPLE_TIME_MS);
  const restoredRoute = effect.getConfig();
  const restored = captureCompositingPhases(effect, fixture.target);

  return {
    mode,
    opacity,
    isolatedCompositing,
    contract:
    {
      hostCompositing: beforeRoute.hostCompositing,
      outputCompositing: beforeRoute.outputCompositing,
      overlayAlphaPolicy: beforeRoute.overlayAlphaPolicy,
      overlayAlphaLimit: beforeRoute.overlayAlphaLimit,
      overlayColorCompensation: beforeRoute.overlayColorCompensation,
      unknownBackgroundAppearance:
        beforeRoute.unknownBackgroundAppearance,
    },
    before: before.pixels,
    fallback: fallback.pixels,
    fallbackSteady: fallbackSteady.pixels,
    restoring: restoring.pixels,
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
      restoring: compareAlphaImages(
        before.images.transparent,
        restoring.images.transparent,
      ),
      restoringToRestored: compareAlphaImages(
        restoring.images.transparent,
        restored.images.transparent,
      ),
      restored: compareAlphaImages(
        before.images.transparent,
        restored.images.transparent,
      ),
    },
    compositing:
    {
      before: before.compositing,
      fallback: fallback.compositing,
      fallbackSteady: fallbackSteady.compositing,
      restoring: restoring.compositing,
      restored: restored.compositing,
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
    restoringRoute:
    {
      effect: restoringRoute.resolvedEffectBackend,
      bloom: restoringRoute.resolvedBloomBackend,
    },
    restoredRoute:
    {
      effect: restoredRoute.resolvedEffectBackend,
      bloom: restoredRoute.resolvedBloomBackend,
    },
  };
}

async function runCompositingReferenceContextLifecycle()
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
      includeTrail: false,
      fxParams:
      {
        'shards.clickCount': 0,
        'shards.maxCount': 0,
      },
    },
  );
  const effect = fixture.effect;
  const compositingReference = createCompositingReference();
  const referenceSet = effect.setCompositingReference(
    compositingReference,
    { fit: 'cover' },
  );

  await runAnimationFrame(SAMPLE_TIME_MS);

  const canvas = effect.webglEffectCanvas;
  const context = canvas?.getContext('webgl2');
  const extension = context?.getExtension('WEBGL_lose_context');

  if (!referenceSet || !canvas || !context || !extension)
  {
    throw new Error('纯 WebGL2 无法建立合成参考 Context 生命周期');
  }

  const capturePhase = () =>
    (
      {
        overlay: summarizePixels(
          captureLayers(effect, fixture.target, 'transparent'),
          effect.dpr,
        ),
        composited: summarizePixels(
          captureLayers(effect, fixture.target, 'checker'),
          effect.dpr,
        ),
      }
    );
  const beforeRoute = effect.getConfig();
  const before = capturePhase();
  const lostEvent = waitForCanvasEvent(canvas, 'webglcontextlost');

  extension.loseContext();
  await lostEvent;
  await runAnimationFrame(SAMPLE_TIME_MS);
  const fallbackRoute = effect.getConfig();
  const fallback = capturePhase();
  const restoredEvent = waitForCanvasEvent(canvas, 'webglcontextrestored');

  // Chromium 需要先完成丢失后的 GPU 清理，立即恢复会被忽略。
  await new Promise((resolve) => setTimeout(resolve, 100));
  extension.restoreContext();
  await restoredEvent;
  await runAnimationFrame(SAMPLE_TIME_MS);
  const restoringRoute = effect.getConfig();
  const restoring = capturePhase();
  await runAnimationFrame(SAMPLE_TIME_MS);
  const restoredRoute = effect.getConfig();
  const restored = capturePhase();

  return (
    {
      referenceSet,
      referencePreserved:
        effect.compositingReferenceSource === compositingReference,
      before,
      fallback,
      restoring,
      restored,
      routes:
      {
        before:
        {
          effect: beforeRoute.resolvedEffectBackend,
          bloom: beforeRoute.resolvedBloomBackend,
        },
        fallback:
        {
          effect: fallbackRoute.resolvedEffectBackend,
          bloom: fallbackRoute.resolvedBloomBackend,
        },
        restoring:
        {
          effect: restoringRoute.resolvedEffectBackend,
          bloom: restoringRoute.resolvedBloomBackend,
        },
        restored:
        {
          effect: restoredRoute.resolvedEffectBackend,
          bloom: restoredRoute.resolvedBloomBackend,
        },
      },
    }
  );
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

  return (
    {
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
    }
  );
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

  return (
    {
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
    }
  );
}

async function runBackendFailureChain(specification)
{
  const mode = specification.mode;
  const opacity = specification.opacity;
  const trailOnly = specification.trailOnly === true;
  const isolatedCompositing = specification.isolatedCompositing !== false;
  const fixture = await prepareEffect(
    {
      mode,
      opacity,
      isolatedCompositing,
      background: 'transparent',
      outputCompositing: 'browser-overlay',
      overlayAlphaPolicy: specification.overlayAlphaPolicy,
      overlayColorCompensation: specification.overlayColorCompensation,
      overlayAlphaLimit: specification.overlayAlphaLimit,
      hostCompositing: specification.hostCompositing,
      shadow: false,
      containStrict: false,
      includeClick: !trailOnly,
      includeTrail: trailOnly,
      includeTrailShards: false,
      straightTrailProbe: trailOnly,
      scale: trailOnly ? 3 : 1,
      fxParams:
      {
        'shards.clickCount': 0,
        'shards.maxCount': 0,
      },
    },
  );
  const effect = fixture.effect;
  const capturePhase = () => captureCompositingPhases(
    effect,
    fixture.target,
    trailOnly
      ? {
          x: STRAIGHT_TRAIL_TRANSMISSION_X,
          y: STRAIGHT_TRAIL_Y,
        }
      : null,
  );
  const originalDrawCanvasFallbackFrame =
    effect._drawCanvasFallbackFrame.bind(effect);
  let nativeFallbackDrawCount = 0;

  effect._drawCanvasFallbackFrame = (scale, useNativeBloom, legacy) =>
  {
    if (useNativeBloom && !legacy)
    {
      nativeFallbackDrawCount++;
    }

    return originalDrawCanvasFallbackFrame(scale, useNativeBloom, legacy);
  };

  if (mode === 'full-webgl2')
  {
    // 完整特效 Context 丢失后必须固定经过 Software，再注入回读故障。
    effect.updateConfig(
      {
        bloomBackend: 'software',
      },
    );
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
  const before = capturePhase();
  const backendEvents = recordBackendEvents(effect);
  const lostEvent = waitForCanvasEvent(canvas, 'webglcontextlost');

  extension.loseContext();
  await lostEvent;
  const softwareRoute = effect.getConfig();
  const software = capturePhase();
  let sourceContext = softwareRenderer.sourceContext;
  let coverageContext = softwareRenderer.coverageContext;

  if (opacity === 0 && (!sourceContext || !coverageContext))
  {
    // 零透明拖尾不会建立 Software 发射区域；短暂预热仅用于命中真实回读
    // 故障，后续截图会先恢复请求的 opacity，不能伪造透明阶段像素。
    effect.updateConfig({ opacity: 1 });
    await runAnimationFrame(SAMPLE_TIME_MS);
    sourceContext = softwareRenderer.sourceContext;
    coverageContext = softwareRenderer.coverageContext;
  }

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
  const nativeFallbackDrawCountBeforeFault = nativeFallbackDrawCount;

  await runAnimationFrame(SAMPLE_TIME_MS);
  const nativeFaultRedrawCount =
    nativeFallbackDrawCount - nativeFallbackDrawCountBeforeFault;

  if (opacity === 0)
  {
    effect.updateConfig({ opacity });
    await runAnimationFrame(SAMPLE_TIME_MS);
  }

  const faultRoute = effect.getConfig();
  const fault = capturePhase();
  await runAnimationFrame(SAMPLE_TIME_MS);
  const nativeRoute = effect.getConfig();
  const native = capturePhase();
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
  const restoringRoute = effect.getConfig();
  const restoring = capturePhase();
  await runAnimationFrame(SAMPLE_TIME_MS);
  const restoredRoute = effect.getConfig();
  const restored = capturePhase();
  const events = backendEvents.events.slice();

  backendEvents.stop();

  return (
    {
      mode,
      opacity,
      isolatedCompositing,
      variant: trailOnly ? 'trail-only' : 'click-only',
      contract:
      {
        hostCompositing: beforeRoute.hostCompositing,
        outputCompositing: beforeRoute.outputCompositing,
        overlayAlphaPolicy: beforeRoute.overlayAlphaPolicy,
        overlayAlphaLimit: beforeRoute.overlayAlphaLimit,
        overlayColorCompensation: beforeRoute.overlayColorCompensation,
      },
      before: before.pixels,
      software: software.pixels,
      fault: fault.pixels,
      native: native.pixels,
      restoring: restoring.pixels,
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
        restoring: compareAlphaImages(
          before.images.transparent,
          restoring.images.transparent,
        ),
        restoringToRestored: compareAlphaImages(
          restoring.images.transparent,
          restored.images.transparent,
        ),
        restored: compareAlphaImages(
          before.images.transparent,
          restored.images.transparent,
        ),
      },
      compositing:
      {
        before: before.compositing,
        software: software.compositing,
        fault: fault.compositing,
        native: native.compositing,
        restoring: restoring.compositing,
        restored: restored.compositing,
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
        restoring:
        {
          effect: restoringRoute.resolvedEffectBackend,
          bloom: restoringRoute.resolvedBloomBackend,
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
        nativeFaultRedrawCount,
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

async function runBackendReentrantNative(specification)
{
  const mode = typeof specification === 'string'
    ? specification
    : specification.mode;
  const isolatedCompositing = typeof specification === 'string'
    ? true
    : specification.isolatedCompositing !== false;
  const fixture = await prepareEffect(
    {
      mode,
      opacity: 1,
      isolatedCompositing,
      background: 'transparent',
      outputCompositing: 'browser-overlay',
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
  const canvas = mode === 'full-webgl2'
    ? effect.webglEffectCanvas
    : effect.webglBloomCanvas;
  const context = canvas?.getContext('webgl2');
  const extension = context?.getExtension('WEBGL_lose_context');

  if (!canvas || !context || !extension)
  {
    throw new Error(`${mode} 无法建立后端事件重入夹具`);
  }

  const backendEvents = recordBackendEvents(effect);
  const originalRenderSoftwareBloom =
    effect._renderSoftwareBloom.bind(effect);
  let softwareRenderCalls = 0;
  const switchToNative = (event) =>
  {
    if (event.detail.resolvedBloomBackend === 'software')
    {
      effect.updateConfig({ bloomBackend: 'native' });
    }
  };

  effect._renderSoftwareBloom = (...args) =>
  {
    softwareRenderCalls++;
    return originalRenderSoftwareBloom(...args);
  };
  effect.canvas.addEventListener(
    BLOOM_BACKEND_CHANGE_EVENT,
    switchToNative,
  );

  const lostEvent = waitForCanvasEvent(canvas, 'webglcontextlost');

  extension.loseContext();
  await lostEvent;
  const fallbackRoute = effect.getConfig();
  const fallback = captureCompositingPhases(effect, fixture.target);
  await runAnimationFrame(SAMPLE_TIME_MS);
  const steadyRoute = effect.getConfig();
  const steady = captureCompositingPhases(effect, fixture.target);
  const events = backendEvents.events.slice();

  effect.canvas.removeEventListener(
    BLOOM_BACKEND_CHANGE_EVENT,
    switchToNative,
  );
  backendEvents.stop();

  const restoredEvent = waitForCanvasEvent(canvas, 'webglcontextrestored');

  await new Promise((resolve) => setTimeout(resolve, 100));
  extension.restoreContext();
  await restoredEvent;
  await runAnimationFrame(SAMPLE_TIME_MS);

  return (
    {
      mode,
      isolatedCompositing,
      softwareRenderCalls,
      events,
      fallback: fallback.pixels,
      steady: steady.pixels,
      compositing:
      {
        fallback: fallback.compositing,
        steady: steady.compositing,
      },
      routes:
      {
        fallback:
        {
          requested: fallbackRoute.bloomBackend,
          effect: fallbackRoute.resolvedEffectBackend,
          bloom: fallbackRoute.resolvedBloomBackend,
        },
        steady:
        {
          requested: steadyRoute.bloomBackend,
          effect: steadyRoute.resolvedEffectBackend,
          bloom: steadyRoute.resolvedBloomBackend,
        },
      },
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

function captureTrailContextPhase(effect, target)
{
  const capture = captureCompositingPhases(
    effect,
    target,
    {
      x: STRAIGHT_TRAIL_TRANSMISSION_X,
      y: STRAIGHT_TRAIL_Y,
    },
  );

  return {
    ...capture,
    profile: summarizeStraightTrail(capture.images.transparent, effect),
  };
}

async function runTrailContextLifecycle(specification)
{
  const mode = typeof specification === 'string'
    ? specification
    : specification.mode;
  const outputCompositing = typeof specification === 'string'
    ? 'scene'
    : specification.outputCompositing ?? 'scene';
  const fixture = await prepareEffect(
    {
      mode,
      opacity: 1,
      isolatedCompositing: true,
      background: 'transparent',
      outputCompositing,
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
  const resolvedOutputCompositing = effect.getConfig().outputCompositing;
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

  const beforeRoute = effect.getConfig();
  const before = captureTrailContextPhase(effect, fixture.target);
  const originalTextureValid = context.isTexture(originalTexture);
  const lostEvent = waitForCanvasEvent(canvas, 'webglcontextlost');

  extension.loseContext();
  await lostEvent;
  const fallbackRoute = effect.getConfig();
  const fallback = captureTrailContextPhase(effect, fixture.target);
  await runAnimationFrame(SAMPLE_TIME_MS);
  const fallbackSteadyRoute = effect.getConfig();
  const fallbackSteady = captureTrailContextPhase(effect, fixture.target);

  const restoredEvent = waitForCanvasEvent(canvas, 'webglcontextrestored');

  // Chromium 需要先完成一次丢失后的 GPU 任务清理，立即 restore 会被忽略。
  await new Promise((resolve) => setTimeout(resolve, 100));
  extension.restoreContext();
  await restoredEvent;
  // 同一虚拟时间采集恢复首帧和稳定帧，避免 Trail 生命周期推进掩盖跳变。
  await runAnimationFrame(SAMPLE_TIME_MS);
  const restoringRoute = effect.getConfig();
  const restoring = captureTrailContextPhase(effect, fixture.target);
  await runAnimationFrame(SAMPLE_TIME_MS);

  const restoredResources = getWebGLModeResources(effect, mode);
  const restoredTexture = restoredResources.renderer?.trailTexture;
  const restoredRoute = effect.getConfig();
  const restored = captureTrailContextPhase(effect, fixture.target);

  return {
    mode,
    outputCompositing: resolvedOutputCompositing,
    before: before.pixels,
    fallback: fallback.pixels,
    fallbackSteady: fallbackSteady.pixels,
    restoring: restoring.pixels,
    restored: restored.pixels,
    profiles:
    {
      before: before.profile,
      fallback: fallback.profile,
      fallbackSteady: fallbackSteady.profile,
      restoring: restoring.profile,
      restored: restored.profile,
    },
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
      restoring: compareAlphaImages(
        before.images.transparent,
        restoring.images.transparent,
      ),
      restoringToRestored: compareAlphaImages(
        restoring.images.transparent,
        restored.images.transparent,
      ),
      restored: compareAlphaImages(
        before.images.transparent,
        restored.images.transparent,
      ),
    },
    compositing:
    {
      before: before.compositing,
      fallback: fallback.compositing,
      fallbackSteady: fallbackSteady.compositing,
      restoring: restoring.compositing,
      restored: restored.compositing,
    },
    texture:
    {
      originalValid: originalTextureValid,
      originalInvalidAfterRestore: !context.isTexture(originalTexture),
      rendererReused: restoredResources.renderer === renderer,
      replaced: restoredTexture !== originalTexture,
      restoredValid: Boolean(
        restoredTexture && context.isTexture(restoredTexture),
      ),
    },
    routes:
    {
      before:
      {
        effect: beforeRoute.resolvedEffectBackend,
        bloom: beforeRoute.resolvedBloomBackend,
      },
      fallback:
      {
        effect: fallbackRoute.resolvedEffectBackend,
        bloom: fallbackRoute.resolvedBloomBackend,
      },
      fallbackSteady:
      {
        effect: fallbackSteadyRoute.resolvedEffectBackend,
        bloom: fallbackSteadyRoute.resolvedBloomBackend,
      },
      restoring:
      {
        effect: restoringRoute.resolvedEffectBackend,
        bloom: restoringRoute.resolvedBloomBackend,
      },
      restored:
      {
        effect: restoredRoute.resolvedEffectBackend,
        bloom: restoredRoute.resolvedBloomBackend,
      },
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
    runtimeKind,
    modeNames: Object.keys(MODE_CONFIGS),
    beginTransparentContractTransitions,
    runCase,
    runCompositingReferenceReset,
    runContextLifecycle,
    runCompositingReferenceContextLifecycle,
    runBackendFailureChain,
    runBackendReentrantNative,
    runTrailTextureResourceLifecycle,
    runTrailContextLifecycle,
    transitionTransparentContract,
    waitForCompositorFrame,
    getStageClip,
    dispose: disposeActiveFixture,
  },
);
window.__BACLICKFX_PIXEL_READY__ = true;
window.__BACLICKFX_PIXEL_PROGRESS__ = 'ready';
