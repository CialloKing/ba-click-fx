// 无宿主状态的共用工具；输入和资源生命周期不依赖具体渲染后端。
import { CUSTOM_BUILD, BUILD_WORKER } from './build-capabilities.js';
const BLOOM_BACKEND_CHANGE_EVENT = 'baclickfxbackendchange';

const EFFECT_BACKEND_CHANGE_EVENT = 'baclickfxeffectbackendchange';

const MAX_SCALED_TIME_DELTA_MS = Number.MAX_SAFE_INTEGER;

const TOUCH_DIRECTION_THRESHOLD = 2;

const TOUCH_FILTER_CACHE_MS = 1000;

const TOUCH_INPUT_MATCH_TOLERANCE = 2;

const TOUCH_ACTION_DIRECTIONS = Object.freeze(
  {
    negative: 'negative',
    positive: 'positive',
  },
);

function resolvePositiveFinite(value, fallback)
{
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cancelRenderFrame(handle)
{
  if (typeof cancelAnimationFrame === 'function')
  {
    cancelAnimationFrame(handle);
    return;
  }

  clearTimeout(handle);
}

function createTouchActionPolicy(value)
{
  const raw = String(value ?? 'auto').trim().toLowerCase();
  const tokens = raw ? raw.split(/\s+/) : ['auto'];
  const policy =
  {
    allowX: false,
    allowY: false,
    allowPinch: false,
    xDirections: new Set(),
    yDirections: new Set(),
    blockAll: false,
    requiresShim: true,
  };
  const allowBothAxes = () =>
  {
    policy.allowX = true;
    policy.allowY = true;
    policy.xDirections.add(TOUCH_ACTION_DIRECTIONS.negative);
    policy.xDirections.add(TOUCH_ACTION_DIRECTIONS.positive);
    policy.yDirections.add(TOUCH_ACTION_DIRECTIONS.negative);
    policy.yDirections.add(TOUCH_ACTION_DIRECTIONS.positive);
  };

  if (tokens.includes('auto') || tokens.includes('manipulation'))
  {
    allowBothAxes();
    policy.allowPinch = true;
    policy.requiresShim = false;
    return policy;
  }

  if (tokens.includes('none'))
  {
    policy.blockAll = true;
    return policy;
  }

  let recognized = false;

  for (const token of tokens)
  {
    if (token === 'pinch-zoom')
    {
      policy.allowPinch = true;
      recognized = true;
    }
    else if (token === 'pan-x')
    {
      policy.allowX = true;
      policy.xDirections.add(TOUCH_ACTION_DIRECTIONS.negative);
      policy.xDirections.add(TOUCH_ACTION_DIRECTIONS.positive);
      recognized = true;
    }
    else if (token === 'pan-y')
    {
      policy.allowY = true;
      policy.yDirections.add(TOUCH_ACTION_DIRECTIONS.negative);
      policy.yDirections.add(TOUCH_ACTION_DIRECTIONS.positive);
      recognized = true;
    }
    else if (token === 'pan-left' || token === 'pan-right')
    {
      policy.allowX = true;
      // CSS 关键字描述页面的平移方向，与手指在屏幕上的位移相反。
      policy.xDirections.add(
        token === 'pan-left'
          ? TOUCH_ACTION_DIRECTIONS.positive
          : TOUCH_ACTION_DIRECTIONS.negative,
      );
      recognized = true;
    }
    else if (token === 'pan-up' || token === 'pan-down')
    {
      policy.allowY = true;
      policy.yDirections.add(
        token === 'pan-up'
          ? TOUCH_ACTION_DIRECTIONS.positive
          : TOUCH_ACTION_DIRECTIONS.negative,
      );
      recognized = true;
    }
    else
    {
      recognized = false;
      break;
    }
  }

  if (!recognized)
  {
    allowBothAxes();
    policy.allowPinch = true;
    policy.requiresShim = false;
    return policy;
  }

  policy.requiresShim = policy.blockAll ||
    !policy.allowX ||
    !policy.allowY ||
    !policy.allowPinch ||
    policy.xDirections.size < 2 ||
    policy.yDirections.size < 2;
  return policy;
}

function clamp(value, min, max)
{
  return Math.max(min, Math.min(max, value));
}

function clamp01(value)
{
  return clamp(value, 0, 1);
}

function scaleTimeDelta(elapsedMs, timeScale)
{
  const scaledDeltaMs = elapsedMs * timeScale;

  // 极大但合法的有限倍率可能在乘法时溢出；安全上限仍足以结算全部视觉对象。
  return Number.isFinite(scaledDeltaMs)
    ? scaledDeltaMs
    : MAX_SCALED_TIME_DELTA_MS;
}

function lerp(from, to, progress)
{
  return from + (to - from) * progress;
}

function distance(from, to)
{
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function isOffscreenCanvas(value)
{
  return typeof OffscreenCanvas !== 'undefined' &&
    value instanceof OffscreenCanvas;
}

function isCanvas(value)
{
  if (!value)
  {
    return false;
  }

  if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement)
  {
    return true;
  }

  if (isOffscreenCanvas(value))
  {
    return true;
  }

  return value?.tagName?.toLowerCase?.() === 'canvas';
}

function createCanvas(width = 300, height = 150)
{
  if (CUSTOM_BUILD && BUILD_WORKER)
  {
    // Worker 资源只使用 OffscreenCanvas，省去 DOM 工厂与挂载依赖。
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== 'undefined' && typeof document.createElement === 'function')
  {
    const canvas = document.createElement('canvas');

    canvas.setAttribute?.('aria-hidden', 'true');
    return canvas;
  }

  if (typeof OffscreenCanvas !== 'undefined')
  {
    return new OffscreenCanvas(width, height);
  }

  return null;
}

function setOverlayStyle(
  canvas,
  fixed,
  zIndex = '2147483647',
  mixBlendMode = 'plus-lighter',
)
{
  if (!canvas?.style)
  {
    return;
  }

  canvas.style.position = fixed ? 'fixed' : 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = zIndex;
  canvas.style.mixBlendMode = mixBlendMode;
}

function createTrailPoint(x, y, bornAt)
{
  return {
    x,
    y,
    bornAt,
  };
}

function invalidateTrailPoints(stroke)
{
  releaseTrailGradients(stroke.trailFrameData);
  stroke.pointsVersion = (stroke.pointsVersion ?? 0) + 1;
  stroke.trailFrameData = null;
  stroke.trailFrameCache = null;
}

function releaseMeshGradients(mesh)
{
  if (!mesh?.canvasGradientCache) return;
  for (const group of mesh.canvasGradientCache)
  {
    group.segments.clear();
    group.caps.clear();
    group.context = null;
    group.signature = null;
  }
  mesh.canvasGradientCache.length = 0;
}

function releaseTrailGradients(data)
{
  for (const mesh of data?.meshCache?.values() ?? []) releaseMeshGradients(mesh);
}

export {
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
  MAX_SCALED_TIME_DELTA_MS,
  TOUCH_ACTION_DIRECTIONS,
  TOUCH_DIRECTION_THRESHOLD,
  TOUCH_FILTER_CACHE_MS,
  TOUCH_INPUT_MATCH_TOLERANCE,
  cancelRenderFrame,
  clamp,
  clamp01,
  createCanvas,
  createTouchActionPolicy,
  createTrailPoint,
  distance,
  invalidateTrailPoints,
  isCanvas,
  isOffscreenCanvas,
  lerp,
  releaseMeshGradients,
  releaseTrailGradients,
  resolvePositiveFinite,
  scaleTimeDelta,
  setOverlayStyle,
};
