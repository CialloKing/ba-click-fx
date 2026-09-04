/**
 * ba-click-fx — Blue Archive 的 UI/FX_Touch 浏览器移植。
 *
 * 这不是“相似风格”参数化引擎。实现直接复刻 Unity 中 FXTouch、
 * ParticleSystem 和 TrailRenderer 的生命周期，只保留宿主接入所需的最小 API。
 */

import {
  CONFIG,
  DEFAULT_THEME_COLOR,
  DEFAULT_THEME_COLOR_MODE,
  FX_PARAM_MIGRATIONS,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  UNITY_FX_TOUCH,
  assertConfigOverrides,
  createConfig,
  isBloomBackend,
  isEffectBackend,
  isInputSamplingRate,
  isInputSource,
  isHostCompositing,
  isHostCompositingSurface,
  isIndependentHostCompositing,
  isOverlayAlphaPolicy,
  isOverlayColorCompensation,
  isOutputCompositing,
  isTimeScale,
  isThemeColorMode,
  normalizeBloomBackend,
  normalizeEffectBackend,
  normalizeHostCompositing,
  normalizeHostCompositingSurface,
  normalizeInputSamplingRate,
  normalizeOverlayAlphaLimit,
  normalizeOverlayAlphaPolicyConfig,
  normalizeOverlayColorCompensationConfig,
  normalizeThemeColor,
  normalizeThemeColorMode,
  normalizeTimeScale,
  normalizeWebGPUHdrPresentation,
  resolveHostCompositing,
  SIZE_CORRECTION,
} from './config.js';
import {
  applyRelativeOklchTheme,
  createRelativeOklchTheme,
} from './theme-color.js';
import { applyFxParamPatch as prepareFxParamPatch } from './fx-param-patch.js';
import { gammaToLinear } from './bloom-color-space.js';
import {
  SoftwareBloomRenderer,
  calculateBloomContribution,
  linearToSrgb,
  limitCanvasAlpha,
} from './software-bloom.js';
import {
  BRIGHT_CORE_CHANNEL_MIX,
  applyOverlayColorCompensationToImageData,
  applyOverlayAlphaPolicyToImageData,
  compensateBrightCorePremultipliedRgb,
} from './overlay-compositing.js';
import { WebGL2EffectRenderer } from './webgl2-effect.js';
import { WebGPUEffectRenderer } from './webgpu-effect.js';
import { WebGL2CanvasSceneRenderer } from './webgl2-canvas-scene.js';
import { sampleRing3Alpha } from './ring3-alpha.js';
import {
  CIRCLE_TEXTURE_SIZE,
  CIRCLE_TEXTURE_RGBA,
  createCircleTextureSources,
} from './circle-texture.js';
import {
  TRIANGLE_TEXTURE_COVERAGE,
  TRIANGLE_TEXTURE_SIZE,
  TRIANGLE_TEXTURE_RGBA,
  createRoundedTriangleCoverage,
  createTriangleTextureSources,
  mapRoundedTriangleTextureUv,
} from './triangle-texture.js';
import { traceRoundedTrianglePath } from './triangle-path.js';
import {
  evaluateTrailLongitudinalCoverage,
  evaluateTrailTextureCoverageProfile,
} from './trail-coverage.js';

const TAU = Math.PI * 2;
const LIGHT_BACKGROUND_CONTRAST_COLOR = [76, 255, 255];
const BLOOM_BACKEND_CHANGE_EVENT = 'baclickfxbackendchange';
const EFFECT_BACKEND_CHANGE_EVENT = 'baclickfxeffectbackendchange';
const HOST_COMPOSITING_CHANGE_EVENT = 'baclickfxhostcompositingchange';
const MAX_SCALED_TIME_DELTA_MS = Number.MAX_SAFE_INTEGER;
const MAX_TRAIL_INNER_MITER_RATIO = 4;
const MIN_TRAIL_SEGMENT_LENGTH = 0.000001;
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

function requestRenderFrame(callback)
{
  if (typeof requestAnimationFrame === 'function')
  {
    return requestAnimationFrame(callback);
  }

  // 部分 Dedicated Worker 没有 RAF；定时器只负责帧调度，不接管 Worker 协议。
  return setTimeout(() => callback(performance.now()), 1000 / 60);
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

function shouldUseTouchInputFallback()
{
  if (typeof window === 'undefined')
  {
    return false;
  }

  if (typeof window.PointerEvent === 'function')
  {
    return false;
  }

  // 旧版 Safari/WebView 可能只暴露 TouchEvent 或 ontouchstart；这些宿主
  // 不会生成 PointerEvent，Touch 仲裁监听必须同时承担实际输入转发。
  return typeof window.TouchEvent === 'function' ||
    'ontouchstart' in window ||
    Number(window.navigator?.maxTouchPoints) > 0;
}

let triangleTextureResources = null;
let triangleTextureUnavailable = false;
let circleTextureResources = null;
let circleTextureUnavailable = false;

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

// ── 共享 HSL 转换 ──────────────────────────────────────────────────────
function rgbToHsl(r, g, b)
{
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;

  if (d === 0)
  {
    return [0, 0, l];
  }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;

  if (max === r)
  {
    h = (g - b) / d + (g < b ? 6 : 0);
  }
  else if (max === g)
  {
    h = (b - r) / d + 2;
  }
  else
  {
    h = (r - g) / d + 4;
  }

  return [h / 6, s, l];
}

function hslToRgb(h, s, l)
{
  const hueToRgb = (p, q, t) =>
  {
    if (t < 0)
    {
      t += 1;
    }

    if (t > 1)
    {
      t -= 1;
    }

    if (t < 1 / 6)
    {
      return p + (q - p) * 6 * t;
    }

    if (t < 1 / 2)
    {
      return q;
    }

    if (t < 2 / 3)
    {
      return p + (q - p) * (2 / 3 - t) * 6;
    }

    return p;
  };

  if (s === 0)
  {
    return [l, l, l];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}


// ── 主题色偏移 ──────────────────────────────────────────────────────────
// 游戏中代表蓝色的关键色 (76,167,255)，hue≈212°；以此为基准计算偏移量。
// 模块级缓存，_renderFrame 前推入实例值，渲染后清空，保证多实例安全。

let themeHueShift = 0;
let relativeOklchTheme = null;
const BASE_BLUE = [76, 167, 255];
const BASE_BLUE_HUE = rgbToHsl(BASE_BLUE[0] / 255, BASE_BLUE[1] / 255, BASE_BLUE[2] / 255)[0];

/** 将主题色 hex 转为 hue 偏移量，返回计算值供实例存储。 */
function computeThemeHueShift(hex)
{
  if (!/^#[0-9a-f]{6}$/i.test(hex))
  {
    return 0;
  }

  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const [h, s] = rgbToHsl(r, g, b);
  if (s < 0.02)
  {
    return 0;
  }

  return h - BASE_BLUE_HUE;
}

/**
 * 对 RGB 数组应用主题色 hue 偏移；灰度色（饱和度极低）保持原样。
 * @param {number[]} rgb — [r, g, b]，可能超过 0~255（HDR 中间值）
 * @returns {number[]}
 */
function applyThemeHue(rgb)
{
  if (themeHueShift === 0)
  {
    return rgb;
  }

  const [h, s, l] = rgbToHsl(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);

  if (s < 0.02)
  {
    return rgb;
  }

  let newHue = h + themeHueShift;
  newHue = newHue - Math.floor(newHue);
  const [nr, ng, nb] = hslToRgb(newHue, s, l);
  return [Math.round(nr * 255), Math.round(ng * 255), Math.round(nb * 255)];
}

function applyThemeColor(rgb)
{
  if (relativeOklchTheme)
  {
    return applyRelativeOklchTheme(rgb, relativeOklchTheme);
  }

  return applyThemeHue(rgb);
}

function clamp(value, min, max)
{
  return Math.max(min, Math.min(max, value));
}

function clamp01(value)
{
  return clamp(value, 0, 1);
}

function smoothstep(edge0, edge1, value)
{
  const progress = clamp01((value - edge0) / (edge1 - edge0));
  return progress * progress * (3 - 2 * progress);
}

function scaleTimeDelta(elapsedMs, timeScale)
{
  const scaledDeltaMs = elapsedMs * timeScale;

  // 极大但合法的有限倍率可能在乘法时溢出；安全上限仍足以结算全部视觉对象。
  return Number.isFinite(scaledDeltaMs)
    ? scaledDeltaMs
    : MAX_SCALED_TIME_DELTA_MS;
}

function boundsIntersect(left, right)
{
  return left.x <= right.x + right.width &&
    right.x <= left.x + left.width &&
    left.y <= right.y + right.height &&
    right.y <= left.y + left.height;
}

function mergeBloomRegion(regions, nextRegion)
{
  let index = 0;

  while (index < regions.length)
  {
    const current = regions[index];

    if (!boundsIntersect(current, nextRegion))
    {
      index++;
      continue;
    }

    const minimumX = Math.min(current.x, nextRegion.x);
    const minimumY = Math.min(current.y, nextRegion.y);
    const maximumX = Math.max(
      current.x + current.width,
      nextRegion.x + nextRegion.width,
    );
    const maximumY = Math.max(
      current.y + current.height,
      nextRegion.y + nextRegion.height,
    );

    nextRegion.x = minimumX;
    nextRegion.y = minimumY;
    nextRegion.width = maximumX - minimumX;
    nextRegion.height = maximumY - minimumY;

    const currentEmission = current.emissionBounds;
    const nextEmission = nextRegion.emissionBounds;
    const emissionMinimumX = Math.min(currentEmission.x, nextEmission.x);
    const emissionMinimumY = Math.min(currentEmission.y, nextEmission.y);
    const emissionMaximumX = Math.max(
      currentEmission.x + currentEmission.width,
      nextEmission.x + nextEmission.width,
    );
    const emissionMaximumY = Math.max(
      currentEmission.y + currentEmission.height,
      nextEmission.y + nextEmission.height,
    );

    nextEmission.x = emissionMinimumX;
    nextEmission.y = emissionMinimumY;
    nextEmission.width = emissionMaximumX - emissionMinimumX;
    nextEmission.height = emissionMaximumY - emissionMinimumY;

    for (const wave of current.waves)
    {
      if (!nextRegion.waves.includes(wave))
      {
        nextRegion.waves.push(wave);
      }
    }

    for (const batch of current.trailBatches)
    {
      if (!nextRegion.trailBatches.includes(batch))
      {
        nextRegion.trailBatches.push(batch);
      }
    }

    for (const shard of current.shards ?? [])
    {
      if (!nextRegion.shards.includes(shard))
      {
        nextRegion.shards.push(shard);
      }
    }

    regions.splice(index, 1);
    // 合并后的矩形可能触及更早跳过的区域，因此重新扫描以完成传递合并。
    index = 0;
  }

  regions.push(nextRegion);
}

function combineBloomRegionBounds(regions)
{
  if (regions.length === 0)
  {
    return null;
  }

  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;

  for (const region of regions)
  {
    minimumX = Math.min(minimumX, region.x);
    minimumY = Math.min(minimumY, region.y);
    maximumX = Math.max(maximumX, region.x + region.width);
    maximumY = Math.max(maximumY, region.y + region.height);
  }

  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  };
}

function random(min, max)
{
  return min + Math.random() * (max - min);
}

function lerp(from, to, progress)
{
  return from + (to - from) * progress;
}

function distance(from, to)
{
  return Math.hypot(to.x - from.x, to.y - from.y);
}

function evaluateNumber(keys, progress)
{
  if (!keys || keys.length === 0)
  {
    return 0;
  }

  const t = clamp01(progress);

  if (t <= keys[0][0])
  {
    return keys[0][1];
  }

  for (let index = 1; index < keys.length; index++)
  {
    const previous = keys[index - 1];
    const current = keys[index];

    if (t <= current[0])
    {
      const span = current[0] - previous[0];
      const localProgress = span > 0 ? (t - previous[0]) / span : 1;

      return lerp(previous[1], current[1], localProgress);
    }
  }

  return keys[keys.length - 1][1];
}

function evaluateUnityHermiteCurve(keys, progress)
{
  if (!keys || keys.length === 0)
  {
    return 0;
  }

  const t = clamp01(progress);

  if (t <= keys[0][0])
  {
    return keys[0][1];
  }

  for (let index = 1; index < keys.length; index++)
  {
    const previous = keys[index - 1];
    const current = keys[index];

    if (t <= current[0])
    {
      const span = current[0] - previous[0];
      const localProgress = span > 0 ? (t - previous[0]) / span : 1;
      const squared = localProgress * localProgress;
      const cubed = squared * localProgress;
      const previousOutSlope = previous[3] ?? 0;
      const currentInSlope = current[2] ?? 0;
      const h00 = 2 * cubed - 3 * squared + 1;
      const h10 = cubed - 2 * squared + localProgress;
      const h01 = -2 * cubed + 3 * squared;
      const h11 = cubed - squared;

      // Unity 的切线以“每单位曲线时间的变化量”保存，需乘当前关键帧跨度。
      return h00 * previous[1] + h10 * previousOutSlope * span +
        h01 * current[1] + h11 * currentInSlope * span;
    }
  }

  return keys[keys.length - 1][1];
}

function evaluateUnitySmoothCurve(keys, progress)
{
  if (!keys || keys.length === 0)
  {
    return 0;
  }

  const t = clamp01(progress);

  if (t <= keys[0][0])
  {
    return keys[0][1];
  }

  for (let index = 1; index < keys.length; index++)
  {
    const previous = keys[index - 1];
    const current = keys[index];

    if (t <= current[0])
    {
      const span = current[0] - previous[0];
      const localProgress = span > 0 ? (t - previous[0]) / span : 1;
      // 原 AnimationCurve 两端切线均为 0，因此区间插值就是 Hermite smoothstep。
      const easedProgress = localProgress * localProgress *
        (3 - 2 * localProgress);

      return lerp(previous[1], current[1], easedProgress);
    }
  }

  return keys[keys.length - 1][1];
}

function evaluateColor(keys, progress, output = [0, 0, 0])
{
  if (!keys || keys.length === 0)
  {
    output[0] = 0;
    output[1] = 0;
    output[2] = 0;
    return output;
  }

  const t = clamp01(progress);

  if (t <= keys[0][0])
  {
    output[0] = keys[0][1][0];
    output[1] = keys[0][1][1];
    output[2] = keys[0][1][2];
    return output;
  }

  for (let index = 1; index < keys.length; index++)
  {
    const previous = keys[index - 1];
    const current = keys[index];

    if (t <= current[0])
    {
      const span = current[0] - previous[0];
      const localProgress = span > 0 ? (t - previous[0]) / span : 1;

      output[0] = lerp(previous[1][0], current[1][0], localProgress);
      output[1] = lerp(previous[1][1], current[1][1], localProgress);
      output[2] = lerp(previous[1][2], current[1][2], localProgress);
      return output;
    }
  }

  const finalColor = keys[keys.length - 1][1];

  output[0] = finalColor[0];
  output[1] = finalColor[1];
  output[2] = finalColor[2];
  return output;
}

function colorToCss(color, alpha = 1)
{
  // 在 clamp 之前统一应用主题映射，默认模式仍精确保留旧 hue 偏移。
  const themed = applyThemeColor(color);
  const red = Math.round(clamp(themed[0], 0, 255));
  const green = Math.round(clamp(themed[1], 0, 255));
  const blue = Math.round(clamp(themed[2], 0, 255));

  return `rgba(${red}, ${green}, ${blue}, ${clamp01(alpha)})`;
}

function scaleNativeGlowAlpha(alpha, emissionScale)
{
  const baseAlpha = clamp01(alpha);
  const safeScale = Math.max(0, emissionScale);

  // Canvas 阴影只能使用 0..1 Alpha。按重复覆盖的等效增益映射，可让
  // 0..4 的控制范围保持单调，同时确保倍率 1 精确保留原生标定值。
  return 1 - (1 - baseAlpha) ** safeScale;
}

function srgbToLinearChannel(channel)
{
  const normalized = clamp01(channel / 255);

  if (normalized <= 0.04045)
  {
    return normalized / 12.92;
  }

  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function colorToLinearEnergy(color, intensity = 1, decodeSrgb = false)
{
  const safeIntensity = Math.max(0, intensity);

  if (relativeOklchTheme && !relativeOklchTheme.identity)
  {
    // TrailRenderer Gradient 已处于项目的线性活动色彩空间。OKLCH 只接受
    // 普通 sRGB，因此先编码主题输入，映射后再统一解码回线性能量。
    const themeInput = decodeSrgb
      ? color
      : color.map((channel) =>
        linearToSrgb(clamp01(channel / 255)) * 255);
    const themed = applyRelativeOklchTheme(themeInput, relativeOklchTheme);

    return themed.map((channel) =>
      srgbToLinearChannel(channel) * safeIntensity);
  }

  const themed = relativeOklchTheme?.identity
    ? color
    : applyThemeHue(color);

  return themed.map((channel) =>
  {
    const linear = decodeSrgb
      ? srgbToLinearChannel(channel)
      : clamp01(channel / 255);

    return linear * safeIntensity;
  });
}

function evaluateSrgbGradientEnergy(
  keys,
  progress,
  intensity,
  startColor = null,
)
{
  const linearKeys = keys.map(([time, color]) =>
  [
    time,
    applyThemeColor(color).map(srgbToLinearChannel),
  ]);
  const safeIntensity = Math.max(0, intensity);
  const linearStartColor = startColor
    ? startColor.map((channel) => srgbToLinearChannel(channel * 255))
    : [1, 1, 1];

  // ParticleSystem 在 Linear 项目中先转换各 Gradient key，再在 active space 插值。
  return evaluateColor(linearKeys, progress).map((channel, index) =>
    channel * linearStartColor[index] * safeIntensity);
}

/**
 * 将 Shader 线性能量按 Unity 捕获图的通道值编码为预乘加色贡献；
 * 清晰本体不做额外 gamma 提亮，零 RGB 必然得到零 Alpha。
 */
function linearEnergyToAdditiveCss(color, opacity = 1)
{
  const safeOpacity = clamp01(opacity);
  const red = clamp01(color[0] * safeOpacity);
  const green = clamp01(color[1] * safeOpacity);
  const blue = clamp01(color[2] * safeOpacity);
  const alpha = Math.max(red, green, blue);

  if (alpha <= 0.00001)
  {
    return 'rgba(0, 0, 0, 0)';
  }

  return `rgba(${Math.round(red / alpha * 255)}, ${
    Math.round(green / alpha * 255)}, ${
    Math.round(blue / alpha * 255)}, ${alpha})`;
}

/**
 * 为 DOM plus-lighter/宿主 Add 保存完整的 sRGB 发射载荷。
 *
 * scene Canvas 允许把 Linear 能量直接相加，最终由 Scene Final Pass
 * 统一编码；普通 Canvas 回退没有这个 Final Pass，若继续写 Linear 数值，
 * CSS 会把它当作 sRGB 解释，低能量尤其容易变暗。因此这里在每个回退
 * 图层边界编码一次，并用独立 Coverage 作为最小传输 Alpha。
 */
function resolveHostAdditivePayload(
  color,
  contributionOpacity = 1,
  coverageAlpha = contributionOpacity,
)
{
  const contribution = Math.max(0, contributionOpacity);
  const red = linearToSrgb(Math.max(0, color[0]) * contribution);
  const green = linearToSrgb(Math.max(0, color[1]) * contribution);
  const blue = linearToSrgb(Math.max(0, color[2]) * contribution);
  const alpha = clamp01(Math.max(
    red,
    green,
    blue,
    clamp01(coverageAlpha),
  ));

  if (alpha <= 0.00001)
  {
    return [0, 0, 0, 0];
  }

  // alpha 至少覆盖三个 sRGB 通道，Canvas 预乘后仍满足 RGB <= Alpha。
  return [red / alpha, green / alpha, blue / alpha, alpha];
}

function linearEnergyToHostAdditiveCss(
  color,
  contributionOpacity = 1,
  coverageAlpha = contributionOpacity,
)
{
  const [red, green, blue, alpha] = resolveHostAdditivePayload(
    color,
    contributionOpacity,
    coverageAlpha,
  );

  if (alpha <= 0.00001)
  {
    return 'rgba(0, 0, 0, 0)';
  }

  return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${
    Math.round(blue * 255)}, ${alpha})`;
}

function resolveOverlayStraightColor(
  color,
  contributionOpacity,
  coverageAlpha,
  overlayColorCompensation = 'none',
  globalOpacity = 1,
)
{
  const requestedAlpha = clamp01(coverageAlpha);

  if (requestedAlpha <= 0.00001)
  {
    return [0, 0, 0];
  }

  const contribution = Math.max(0, contributionOpacity);
  // Canvas CSS 颜色位于 sRGB 空间。这里的材质颜色是 Unity Linear
  // 能量，必须先完成最终编码，再除以 Coverage 得到直通道颜色。
  let red = clamp01(
    linearToSrgb(Math.max(0, color[0]) * contribution) / requestedAlpha,
  );
  let green = clamp01(
    linearToSrgb(Math.max(0, color[1]) * contribution) / requestedAlpha,
  );
  let blue = clamp01(
    linearToSrgb(Math.max(0, color[2]) * contribution) / requestedAlpha,
  );

  if (overlayColorCompensation === 'bright-core')
  {
    const compensated = compensateBrightCorePremultipliedRgb(
      [
        red * requestedAlpha,
        green * requestedAlpha,
        blue * requestedAlpha,
      ],
      requestedAlpha,
      globalOpacity,
    );

    red = compensated[0] / requestedAlpha;
    green = compensated[1] / requestedAlpha;
    blue = compensated[2] / requestedAlpha;
  }

  return [red, green, blue];
}

function resolveOverlayCompensation(
  color,
  contributionOpacity,
  coverageAlpha,
  globalOpacity = 1,
)
{
  const safeOpacity = Math.max(clamp01(globalOpacity), 0.000001);
  const normalizedCoverage = clamp01(
    clamp01(coverageAlpha) / safeOpacity,
  );
  const normalizedEnergy = linearToSrgb(
    Math.max(...color) * Math.max(0, contributionOpacity) / safeOpacity,
  );
  const energyRatio = normalizedEnergy /
    Math.max(normalizedCoverage, 0.000001);

  return smoothstep(0.25, 0.75, energyRatio) *
    smoothstep(0.03125, 0.25, normalizedEnergy);
}

function colorToCanvasOutputCss(color, alpha, linearOutput = false)
{
  if (!linearOutput)
  {
    return colorToCss(color, alpha);
  }

  // Final Pass 把 Canvas 数值直接解释为线性能量，阴影颜色也必须先解码。
  return linearEnergyToAdditiveCss(
    colorToLinearEnergy(color, 1, true),
    alpha,
  );
}

/**
 * 将线性能量编码为指定 Coverage 的预乘颜色。超出 Coverage 可承载范围的
 * HDR 能量在清晰层钳制，完整能量仍由独立 Bloom 发射路径保留。
 */
function linearEnergyToOverlayCss(
  color,
  contributionOpacity,
  coverageAlpha,
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
  globalOpacity = 1,
)
{
  const requestedAlpha = clamp01(coverageAlpha);
  const alpha = Math.min(
    requestedAlpha,
    clamp01(overlayAlphaLimit),
  );

  if (alpha <= 0.00001)
  {
    return 'rgba(0, 0, 0, 0)';
  }

  const [red, green, blue] = resolveOverlayStraightColor(
    color,
    contributionOpacity,
    requestedAlpha,
    overlayColorCompensation,
    globalOpacity,
  );

  return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${
    Math.round(blue * 255)}, ${alpha})`;
}

/**
 * 原生 Canvas 无法保留 HDR，因此先按 Unity MXFinalBloom 提取高亮，
 * 再用回退强度映射到可模糊的加色源，避免低能尾段也产生均匀光雾。
 */
function linearEnergyToNativeTrailBloomCss(
  color,
  opacity,
  intensity,
  bloomCfg,
  outputCompositing = 'scene',
  coverageOpacity = opacity,
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const sourceScale = clamp01(opacity) * Math.max(0, intensity);
  const source = color.map((channel) => Math.max(0, channel * sourceScale));
  const brightness = Math.max(...source);

  if (brightness <= 0)
  {
    return 'rgba(0, 0, 0, 0)';
  }

  const contribution = calculateBloomContribution(
    brightness,
    gammaToLinear(bloomCfg.threshold),
    bloomCfg.softKnee,
  );

  if (contribution <= 0)
  {
    return 'rgba(0, 0, 0, 0)';
  }

  const contributionScale = contribution / brightness;
  const brightPass = source.map((channel) => channel * contributionScale);

  if (outputCompositing === 'browser-overlay')
  {
    // Native blur 的 Alpha 取自几何 Coverage，而不是 HDR 明度；发射倍率只
    // 改变 RGB，不能把透明桌面的轨迹变成实心遮挡。
    const coverage = clamp01(coverageOpacity);

    return linearEnergyToOverlayCss(
      brightPass,
      bloomCfg.trailAlpha,
      coverage,
      overlayColorCompensation,
      overlayAlphaLimit,
      opacity,
    );
  }

  if (outputCompositing === 'host-additive')
  {
    return linearEnergyToHostAdditiveCss(
      brightPass,
      bloomCfg.trailAlpha,
      coverageOpacity,
    );
  }

  return linearEnergyToAdditiveCss(brightPass, bloomCfg.trailAlpha);
}

function linearEnergyToEmissionCss(
  color,
  opacity,
  emissionRange,
  energyScale = 1,
)
{
  // 发射增益属于阈值提取前的线性能量，不能并入会钳制到 1 的 opacity。
  const scale = clamp01(opacity) * Math.max(0, energyScale) /
    Math.max(1, emissionRange);
  const red = Math.round(clamp(color[0] * scale * 255, 0, 255));
  const green = Math.round(clamp(color[1] * scale * 255, 0, 255));
  const blue = Math.round(clamp(color[2] * scale * 255, 0, 255));

  return `rgb(${red}, ${green}, ${blue})`;
}

/**
 * 将已知的材质发射强度压入 8 位遮罩；软件 Bloom 回读后会乘回 emissionRange。
 * Alpha 被预先烘入 RGB，Canvas 自身的 Alpha 只负责路径边缘的抗锯齿覆盖率。
 */
function colorToEmissionCss(
  color,
  alpha,
  emission,
  emissionRange,
  energyScale = 1,
)
{
  return linearEnergyToEmissionCss(
    colorToLinearEnergy(color, emission),
    alpha,
    emissionRange,
    energyScale,
  );
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

function getCompositingReferenceDimensions(source)
{
  if (!source)
  {
    return null;
  }

  let width;
  let height;

  try
  {
    width = source.naturalWidth ??
      source.videoWidth ??
      source.displayWidth ??
      source.width;
    height = source.naturalHeight ??
      source.videoHeight ??
      source.displayHeight ??
      source.height;
  }
  catch
  {
    return null;
  }

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
  {
    return null;
  }

  return { width, height };
}

function resolveTarget(target)
{
  if (typeof target === 'string')
  {
    return typeof document !== 'undefined' && typeof document.querySelector === 'function'
      ? document.querySelector(target)
      : null;
  }

  return target ?? null;
}

function createCanvas(width = 300, height = 150)
{
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

function getTriangleTextureResources()
{
  if (triangleTextureResources)
  {
    return triangleTextureResources;
  }

  if (triangleTextureUnavailable)
  {
    return null;
  }

  const sources = createTriangleTextureSources(createCanvas);
  const canvas = createCanvas();
  const context = canvas.getContext('2d');

  if (!sources || !context)
  {
    triangleTextureUnavailable = true;
    return null;
  }

  canvas.width = TRIANGLE_TEXTURE_SIZE;
  canvas.height = TRIANGLE_TEXTURE_SIZE;
  triangleTextureResources = {
    ...sources,
    canvas,
    context,
    linearTextureRgba: TRIANGLE_TEXTURE_RGBA,
    linearTextureCoverage: TRIANGLE_TEXTURE_COVERAGE,
    linearTextureCoverageFromSrgbRed: false,
    linearTextureRgb: null,
    linearTextureEnergyRgb: null,
    linearTintFrameCount: 2,
    linearTintFrames: null,
    linearTintUnavailable: false,
  };
  return triangleTextureResources;
}

function getCircleTextureResources()
{
  if (circleTextureResources)
  {
    return circleTextureResources;
  }

  if (circleTextureUnavailable)
  {
    return null;
  }

  const sources = createCircleTextureSources(createCanvas);

  if (!sources)
  {
    circleTextureUnavailable = true;
    return null;
  }

  const tintCanvas = createCanvas();
  const outputCanvas = createCanvas();
  const tintContext = tintCanvas.getContext('2d');
  const outputContext = outputCanvas.getContext('2d');

  if (!tintContext || !outputContext)
  {
    circleTextureUnavailable = true;
    return null;
  }

  tintCanvas.width = CIRCLE_TEXTURE_SIZE;
  tintCanvas.height = CIRCLE_TEXTURE_SIZE;
  outputCanvas.width = CIRCLE_TEXTURE_SIZE;
  outputCanvas.height = CIRCLE_TEXTURE_SIZE;
  circleTextureResources = {
    ...sources,
    tintCanvas,
    tintContext,
    outputCanvas,
    outputContext,
    linearTextureRgba: CIRCLE_TEXTURE_RGBA,
    linearTextureCoverage: null,
    linearTextureCoverageFromSrgbRed: true,
    linearTextureRgb: null,
    linearTextureEnergyRgb: null,
    linearTintFrameCount: 1,
    linearTintFrames: null,
    linearTintUnavailable: false,
  };
  return circleTextureResources;
}

function prepareLinearTextureData(resources)
{
  if (resources.linearTextureEnergyRgb)
  {
    return;
  }

  const rgba = resources.linearTextureRgba;
  const pixelCount = rgba.length / 4;
  const coverage = resources.linearTextureCoverage ??
    new Uint8Array(pixelCount);
  const textureRgb = new Float32Array(pixelCount * 3);
  const energyRgb = new Float32Array(pixelCount * 3);

  for (let sourceOffset = 0, pixelIndex = 0, targetOffset = 0;
    sourceOffset < rgba.length;
    sourceOffset += 4, pixelIndex++, targetOffset += 3)
  {
    const exactCoverage = resources.linearTextureCoverageFromSrgbRed
      ? srgbToLinearChannel(rgba[sourceOffset])
      : coverage[pixelIndex] / 255;

    if (resources.linearTextureCoverageFromSrgbRed)
    {
      coverage[pixelIndex] = Math.round(clamp01(exactCoverage) * 255);
    }

    // Unity 先在线性空间把纹理 Coverage 乘入发射 RGB，之后才由 Final
    // Pass 编码 sRGB。把 Coverage 留给 Canvas Alpha 才相乘会压暗半覆盖
    // texel，因此这里缓存 Shader 乘法后的逐 texel 线性能量。
    textureRgb[targetOffset] = srgbToLinearChannel(rgba[sourceOffset]);
    textureRgb[targetOffset + 1] = srgbToLinearChannel(
      rgba[sourceOffset + 1],
    );
    textureRgb[targetOffset + 2] = srgbToLinearChannel(
      rgba[sourceOffset + 2],
    );
    energyRgb[targetOffset] = textureRgb[targetOffset] * exactCoverage;
    energyRgb[targetOffset + 1] =
      textureRgb[targetOffset + 1] * exactCoverage;
    energyRgb[targetOffset + 2] =
      textureRgb[targetOffset + 2] * exactCoverage;
  }

  resources.linearTextureCoverage = coverage;
  resources.linearTextureRgb = textureRgb;
  resources.linearTextureEnergyRgb = energyRgb;
}

function sampleTextureChannel(
  data,
  textureSize,
  stride,
  u,
  v,
  channel = 0,
)
{
  const sourceX = clamp(u * textureSize - 0.5, 0, textureSize - 1);
  const sourceY = clamp(v * textureSize - 0.5, 0, textureSize - 1);
  const left = Math.floor(sourceX);
  const top = Math.floor(sourceY);
  const right = Math.min(textureSize - 1, left + 1);
  const bottom = Math.min(textureSize - 1, top + 1);
  const horizontal = sourceX - left;
  const vertical = sourceY - top;
  const topLeft = data[(top * textureSize + left) * stride + channel];
  const topRight = data[(top * textureSize + right) * stride + channel];
  const bottomLeft = data[(bottom * textureSize + left) * stride + channel];
  const bottomRight = data[
    (bottom * textureSize + right) * stride + channel
  ];
  const topSample = topLeft + (topRight - topLeft) * horizontal;
  const bottomSample = bottomLeft +
    (bottomRight - bottomLeft) * horizontal;

  return topSample + (bottomSample - topSample) * vertical;
}

// 12 位线性索引的最大 sRGB 误差低于一个 8 位通道步长，同时避免在
// Context 回退首帧同步计算 65536 次幂函数造成可见卡顿。
const LINEAR_TO_SRGB_LUT_SIZE = 4096;
let linearToSrgbLut = null;

function getLinearToSrgbLut()
{
  if (linearToSrgbLut)
  {
    return linearToSrgbLut;
  }

  linearToSrgbLut = new Float32Array(LINEAR_TO_SRGB_LUT_SIZE);

  for (let index = 0; index < LINEAR_TO_SRGB_LUT_SIZE; index++)
  {
    linearToSrgbLut[index] = linearToSrgb(
      index / (LINEAR_TO_SRGB_LUT_SIZE - 1),
    );
  }

  return linearToSrgbLut;
}

function createLinearTintFrames(textureSize, frameCount)
{
  const frames = [];

  try
  {
    for (let index = 0; index < frameCount; index++)
    {
      const canvas = createCanvas();

      canvas.width = textureSize;
      canvas.height = textureSize;
      const context = canvas.getContext('2d');

      if (
        !context ||
        typeof context.createImageData !== 'function' ||
        typeof context.putImageData !== 'function'
      )
      {
        throw new Error('Canvas ImageData is unavailable');
      }

      frames.push(
        {
          canvas,
          context,
          image: context.createImageData(textureSize, textureSize),
          key: null,
        },
      );
    }
  }
  catch
  {
    for (const frame of frames)
    {
      frame.canvas.width = 0;
      frame.canvas.height = 0;
    }

    return null;
  }

  return frames;
}

/**
 * Canvas 没有 Unity 的线性采样/材质乘法状态；透明回退必须在写入 8 位
 * Canvas 前完成逐 texel 的 Linear(texture) × Linear(material)，否则 WebGL2
 * 丢失后会把已编码 sRGB 材质再次相乘而明显变暗。
 */
function prepareLinearTintedTextureCanvas(
  resources,
  textureSize,
  materialEnergy,
  contribution,
  alphaDivisor,
  frameIndex = 0,
  compensation = 0,
  shape = null,
)
{
  const safeContribution = Math.max(0, Number(contribution) || 0);
  const safeDivisor = Math.max(0, Number(alphaDivisor) || 0);
  const safeMaterialEnergy = [0, 1, 2].map((channel) =>
    Math.max(0, Number(materialEnergy[channel]) || 0));
  const safeCompensation = clamp01(Number(compensation) || 0);
  const roundness = clamp01(Number(shape?.roundness) || 0);
  const shapeCoverage = shape?.coverage ?? null;
  const useTextureAlpha = shape?.useTextureAlpha === true;
  const useRoundedShape = roundness > 0 && shapeCoverage !== null;

  if (
    safeContribution <= 0.000001 ||
    safeDivisor <= 0.000001 ||
    Math.max(...safeMaterialEnergy) <= 0.000001 ||
    resources.linearTintUnavailable
  )
  {
    return null;
  }

  if (!resources.linearTintFrames)
  {
    resources.linearTintFrames = createLinearTintFrames(
      textureSize,
      resources.linearTintFrameCount,
    );

    if (!resources.linearTintFrames)
    {
      resources.linearTintUnavailable = true;
      return null;
    }
  }

  prepareLinearTextureData(resources);

  const rawFrameIndex = Number.isFinite(frameIndex)
    ? Math.trunc(frameIndex)
    : 0;
  const frameSlot = (
    (rawFrameIndex % resources.linearTintFrameCount) +
      resources.linearTintFrameCount
  ) % resources.linearTintFrameCount;
  const frame = resources.linearTintFrames[frameSlot];
  const key = [
    safeDivisor,
    safeContribution,
    ...safeMaterialEnergy,
    safeCompensation,
    roundness,
    useTextureAlpha,
  ].join(',');

  if (frame.key === key)
  {
    return frame.canvas;
  }

  const { context, image } = frame;
  const sourceEnergyRgb = resources.linearTextureEnergyRgb;
  const sourceTextureRgb = resources.linearTextureRgb;
  const sourceCoverage = resources.linearTextureCoverage;
  const sourceRgba = resources.linearTextureRgba;
  const srgbLut = getLinearToSrgbLut();
  const flipVertical = frameSlot === 1;
  const encodeChannel = (sourceOffset, channel, straightDivisor) =>
  {
    const linear = clamp01(
      sourceEnergyRgb[sourceOffset + channel] *
        safeMaterialEnergy[channel] * safeContribution,
    );
    const lookupIndex = Math.round(
      linear * (LINEAR_TO_SRGB_LUT_SIZE - 1),
    );

    return srgbLut[lookupIndex] / straightDivisor;
  };

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.filter = 'none';
  context.imageSmoothingEnabled = false;

  for (let y = 0; y < textureSize; y++)
  {
    const sourceY = flipVertical ? textureSize - 1 - y : y;

    for (let x = 0; x < textureSize; x++)
    {
      const sourcePixelIndex = sourceY * textureSize + x;
      const sourceOffset = sourcePixelIndex * 3;
      const sourceRgbaOffset = sourcePixelIndex * 4;
      const outputOffset = (y * textureSize + x) * 4;
      const originalCoverage = useTextureAlpha
        ? sourceRgba[sourceRgbaOffset + 3] / 255
        : sourceCoverage[sourcePixelIndex] / 255;
      let sampleU = (x + 0.5) / textureSize;
      let sampleV = (sourceY + 0.5) / textureSize;

      if (useRoundedShape)
      {
        [sampleU, sampleV] = mapRoundedTriangleTextureUv(
          sampleU,
          sampleV,
          roundness,
        );
      }

      const textureSupport = useRoundedShape
        ? (useTextureAlpha
            ? sampleTextureChannel(
                sourceRgba,
                textureSize,
                4,
                sampleU,
                sampleV,
                3,
              )
            : sampleTextureChannel(
                sourceCoverage,
                textureSize,
                1,
                sampleU,
                sampleV,
              )) / 255
        : originalCoverage;
      const targetCoverage = useRoundedShape
        ? shapeCoverage[sourcePixelIndex] / 255
        : originalCoverage;
      const coverageByte = Math.round(clamp01(targetCoverage) * 255);

      if (coverageByte === 0)
      {
        image.data[outputOffset] = 0;
        image.data[outputOffset + 1] = 0;
        image.data[outputOffset + 2] = 0;
        image.data[outputOffset + 3] = 0;
        continue;
      }

      const effectiveAlpha = coverageByte / 255;
      const straightDivisor = safeDivisor * effectiveAlpha;
      const encodeRoundedChannel = (channel) =>
      {
        if (roundness <= 0)
        {
          return encodeChannel(sourceOffset, channel, straightDivisor);
        }

        const textureChannel = sampleTextureChannel(
          sourceTextureRgb,
          textureSize,
          3,
          sampleU,
          sampleV,
          channel,
        );
        const supportedChannel = 1 +
          (textureChannel - 1) * clamp01(textureSupport);
        const shapeChannel = supportedChannel +
          (1 - supportedChannel) * roundness;
        // 圆角 Coverage 是唯一边界；纹理先向三角内部重映射，再随
        // 圆角比例淡到材质白，避免保留第二层尖三角。
        const roundedPremultiplied = shapeChannel * targetCoverage;
        const linear = clamp01(
          roundedPremultiplied *
            safeMaterialEnergy[channel] * safeContribution,
        );
        const lookupIndex = Math.round(
          linear * (LINEAR_TO_SRGB_LUT_SIZE - 1),
        );

        return srgbLut[lookupIndex] / straightDivisor;
      };
      const red = encodeRoundedChannel(0);
      const green = encodeRoundedChannel(1);
      const blue = encodeRoundedChannel(2);
      const maximum = Math.max(red, green, blue);
      // 保留每个 texel 的峰值，只让弱通道有限靠近主通道。这里仍以纹理
      // 能量衰减门控，兼容直接调用路径也不会填白低能细节。
      const mixAmount = BRIGHT_CORE_CHANNEL_MIX * safeCompensation *
        clamp01(maximum);

      image.data[outputOffset] = Math.round(
        clamp01(red + (maximum - red) * mixAmount) * 255,
      );
      image.data[outputOffset + 1] = Math.round(
        clamp01(green + (maximum - green) * mixAmount) * 255,
      );
      image.data[outputOffset + 2] = Math.round(
        clamp01(blue + (maximum - blue) * mixAmount) * 255,
      );
      image.data[outputOffset + 3] = coverageByte;
    }
  }

  context.putImageData(image, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.filter = 'none';
  frame.key = key;
  return frame.canvas;
}

/**
 * 用固定大小的 Canvas 合成 Circle_01 二维 RGB 与 R Coverage。
 *
 * 动态材质只触发局部 GPU/Canvas 操作，不重新遍历 512x512 texel；这样既
 * 保留 G 通道的非径向细节，也不会重新引入旧逐帧 CPU 卡顿。
 */
function prepareCircleTextureCanvas(channelScales, srgbOutput = false)
{
  const resources = getCircleTextureResources();
  const maximumScale = Math.max(0, ...channelScales);

  if (!resources || maximumScale <= 0.00001)
  {
    return null;
  }

  const normalizedChannels = channelScales.map((channel) =>
    Math.round(clamp01(channel / maximumScale) * 255));
  const {
    tintCanvas,
    tintContext,
    outputCanvas,
    outputContext,
  } = resources;

  tintContext.setTransform(1, 0, 0, 1, 0, 0);
  tintContext.globalAlpha = 1;
  tintContext.globalCompositeOperation = 'source-over';
  tintContext.filter = 'none';
  tintContext.clearRect(0, 0, CIRCLE_TEXTURE_SIZE, CIRCLE_TEXTURE_SIZE);
  tintContext.drawImage(
    srgbOutput ? resources.srgbColorCanvas : resources.colorCanvas,
    0,
    0,
  );
  tintContext.globalCompositeOperation = 'multiply';
  tintContext.fillStyle = `rgb(${normalizedChannels[0]}, ${
    normalizedChannels[1]}, ${normalizedChannels[2]})`;
  tintContext.fillRect(0, 0, CIRCLE_TEXTURE_SIZE, CIRCLE_TEXTURE_SIZE);

  outputContext.setTransform(1, 0, 0, 1, 0, 0);
  outputContext.globalAlpha = 1;
  outputContext.globalCompositeOperation = 'source-over';
  // brightness 在纹理采样后逐通道放大并钳制，等价于 Shader 的 RGBA8 清晰输出。
  // 8 位纹理的最小非零通道在 255 倍时已经饱和，限制滤镜参数可避免
  // 生命周期最后一帧把无意义的超大倍率交给浏览器滤镜实现。
  outputContext.filter = `brightness(${Math.min(maximumScale, 255)})`;
  outputContext.clearRect(0, 0, CIRCLE_TEXTURE_SIZE, CIRCLE_TEXTURE_SIZE);
  outputContext.drawImage(tintCanvas, 0, 0);
  outputContext.filter = 'none';
  outputContext.globalCompositeOperation = 'destination-in';
  outputContext.drawImage(resources.coverageCanvas, 0, 0);
  return outputCanvas;
}

function createOverlayRoot(fixed)
{
  const root = document.createElement('div');

  root.setAttribute('aria-hidden', 'true');
  root.style.position = fixed ? 'fixed' : 'absolute';
  root.style.inset = '0';
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.pointerEvents = 'none';
  root.style.zIndex = '2147483647';
  // 显式建立混合隔离组，避免依赖 position/contain 的隐式 stacking-context 规则。
  root.style.isolation = 'isolate';
  return root;
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

function evaluateRingTextureAlpha(
  angularProgress,
  radialProgress,
  ringCfg,
)
{
  const uvSpan = ringCfg.textureUvMax - ringCfg.textureUvMin;
  const u = ringCfg.textureUvMin + uvSpan * clamp01(angularProgress);
  const v = ringCfg.textureUvMin + uvSpan * clamp01(radialProgress);

  // 原网格 UV、Bilinear 和 Clamp 均在采样器内显式还原；Alpha 不经过 sRGB 解码。
  return sampleRing3Alpha(u, v);
}

function evaluateRingLuminance(
  angularProgress,
  radialProgress,
  threshold,
  ringCfg,
)
{
  const textureAlpha = evaluateRingTextureAlpha(
    angularProgress,
    radialProgress,
    ringCfg,
  );
  // 原始 Fragment Shader 只执行二值 clip；通过测试的像素仍保留纹理 Alpha，
  // 所以环带中心与内外沿不会被压成相同颜色。
  return textureAlpha >= threshold ? textureAlpha : 0;
}

function resolveRingTextureProgress(angularProgress, direction)
{
  return direction > 0 ? angularProgress : 1 - angularProgress;
}

function findRingClipBoundary(
  angularStart,
  angularEnd,
  radialProgress,
  threshold,
  direction,
  ringCfg,
)
{
  let start = angularStart;
  let end = angularEnd;
  const startTextureProgress = resolveRingTextureProgress(start, direction);
  const startVisible = evaluateRingTextureAlpha(
    startTextureProgress,
    radialProgress,
    ringCfg,
  ) >= threshold;

  // 相邻主采样之间再二分原纹理，避免 conic gradient 把 Shader clip
  // 的不连续边界重新插值成一段软透明过渡。
  for (let iteration = 0; iteration < 8; iteration++)
  {
    const middle = (start + end) * 0.5;
    const middleTextureProgress = resolveRingTextureProgress(
      middle,
      direction,
    );
    const middleVisible = evaluateRingTextureAlpha(
      middleTextureProgress,
      radialProgress,
      ringCfg,
    ) >= threshold;

    if (middleVisible === startVisible)
    {
      start = middle;
    }
    else
    {
      end = middle;
    }
  }

  return (start + end) * 0.5;
}

function createDissolvedRingGradient(
  context,
  ringCfg,
  threshold,
  radialProgress,
  colorForLuminance,
)
{
  if (typeof context.createConicGradient !== 'function')
  {
    return null;
  }

  const gradient = context.createConicGradient(0, 0, 0);
  const sampleCount = Math.max(32, ringCfg.arcSamples);
  const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;
  let previousLuminance = null;

  for (let sample = 0; sample <= sampleCount; sample++)
  {
    const angularProgress = sample / sampleCount;
    const textureProgress = resolveRingTextureProgress(
      angularProgress,
      direction,
    );
    const luminance = evaluateRingLuminance(
      textureProgress,
      radialProgress,
      threshold,
      ringCfg,
    );

    if (previousLuminance !== null &&
        (previousLuminance > 0) !== (luminance > 0))
    {
      const previousProgress = (sample - 1) / sampleCount;
      const boundary = findRingClipBoundary(
        previousProgress,
        angularProgress,
        radialProgress,
        threshold,
        direction,
        ringCfg,
      );
      const visibleBoundary = colorForLuminance(threshold);
      const transparentBoundary = colorForLuminance(0);

      if (previousLuminance > 0)
      {
        gradient.addColorStop(boundary, visibleBoundary);
        gradient.addColorStop(boundary, transparentBoundary);
      }
      else
      {
        gradient.addColorStop(boundary, transparentBoundary);
        gradient.addColorStop(boundary, visibleBoundary);
      }
    }

    gradient.addColorStop(
      angularProgress,
      colorForLuminance(luminance),
    );
    previousLuminance = luminance;
  }

  return gradient;
}

function fillDissolvedRingFallback(
  context,
  radius,
  width,
  threshold,
  ringCfg,
  radialProgress,
  colorForLuminance,
)
{
  const circumference = TAU * radius;
  const segmentCount = Math.max(
    ringCfg.arcSamples,
    Math.ceil(circumference),
  );
  const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;

  for (let segment = 0; segment < segmentCount; segment++)
  {
    const angularStart = segment / segmentCount;
    const angularEnd = (segment + 1) / segmentCount;
    const angularProgress = (angularStart + angularEnd) * 0.5;
    const textureProgress = resolveRingTextureProgress(
      angularProgress,
      direction,
    );
    const luminance = evaluateRingLuminance(
      textureProgress,
      radialProgress,
      threshold,
      ringCfg,
    );

    if (luminance <= 0)
    {
      continue;
    }

    context.beginPath();
    context.arc(
      0,
      0,
      radius,
      angularStart * TAU,
      angularEnd * TAU,
      false,
    );
    context.lineCap = 'butt';
    context.lineWidth = Math.max(0.5, width);
    context.strokeStyle = colorForLuminance(luminance);
    context.stroke();
  }
}

function fillDissolvedRing(
  context,
  radius,
  width,
  threshold,
  ringCfg,
  colorForLuminance,
  nativeShadow = null,
)
{
  const radialSamples = Math.max(1, Math.round(ringCfg.radialSamples));
  const innerEdge = Math.max(0, radius - width * 0.5);
  const bandWidth = width / radialSamples;

  for (let band = 0; band < radialSamples; band++)
  {
    const innerRadius = innerEdge + bandWidth * band;
    const outerRadius = innerEdge + bandWidth * (band + 1);
    const radialProgress = (band + 0.5) / radialSamples;
    const gradient = createDissolvedRingGradient(
      context,
      ringCfg,
      threshold,
      radialProgress,
      colorForLuminance,
    );

    if (!gradient)
    {
      fillDissolvedRingFallback(
        context,
        (innerRadius + outerRadius) * 0.5,
        bandWidth,
        threshold,
        ringCfg,
        radialProgress,
        colorForLuminance,
      );
      continue;
    }

    // 只有中线带产生一次原生 shadow，避免多条 V 采样带重复叠亮光晕。
    const isCenterBand = band === Math.floor(radialSamples * 0.5);

    context.shadowBlur = isCenterBand && nativeShadow
      ? nativeShadow.blur
      : 0;
    context.shadowColor = isCenterBand && nativeShadow
      ? nativeShadow.color
      : 'transparent';
    context.beginPath();
    context.arc(0, 0, outerRadius, 0, TAU, false);
    context.arc(0, 0, innerRadius, TAU, 0, true);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
  }
}

function resolveRingGeometry(ring, progress, scale, ringCfg)
{
  const size = evaluateUnityHermiteCurve(ringCfg.sizeKeys, progress);
  const outerRadius = ring.radius * size * scale;
  const widthMultiplier = lerp(
    ringCfg.widthStart,
    ringCfg.widthEnd,
    progress,
  );
  const width = outerRadius * ringCfg.bandToOuterRadius * widthMultiplier;

  return {
    radius: outerRadius - width * 0.5,
    width,
    threshold: clamp01(evaluateUnityHermiteCurve(
      ringCfg.dissolveKeys,
      progress,
    )),
  };
}

function drawDissolvedCircle(
  context,
  ring,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  useNativeBloom = true,
  sharedMaterialEnergy = null,
  outputCompositing = 'scene',
  linearNativeGlow = false,
  dpr = 1,
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const ringCfg = fxConfig.rings;
  const bloomCfg = fxConfig.bloom;
  const geometry = resolveRingGeometry(ring, progress, scale, ringCfg);
  const particleColor = evaluateColor(ringCfg.colorKeys, progress);

  if (geometry.width <= 0.001)
  {
    return;
  }

  // 同一圆环的所有径向带和渐变 stop 使用相同材质能量。若在回调中计算，
  // 每帧会重复执行上千次主题变换和 sRGB 解码。
  const materialEnergy = sharedMaterialEnergy ?? evaluateSrgbGradientEnergy(
    ringCfg.colorKeys,
    progress,
    ringCfg.hdrIntensity,
  );
  // Canvas 只替换 Bloom 为 shadow；Tri3 本体仍必须保留原材质的
  // Linear 色彩空间与 HDR 强度，否则清晰环带会比 Unity 明显偏蓝、偏暗。
  const colorForLuminance = (luminance) =>
  {
    const coverage = opacity * luminance;

    if (outputCompositing === 'browser-overlay')
    {
      return linearEnergyToOverlayCss(
        materialEnergy,
        coverage,
        coverage,
        overlayColorCompensation,
        overlayAlphaLimit,
        opacity,
      );
    }

    return outputCompositing === 'host-additive'
      ? linearEnergyToHostAdditiveCss(
          materialEnergy,
          coverage,
          coverage,
        )
      : linearEnergyToAdditiveCss(materialEnergy, coverage);
  };

  context.save();
  context.translate(ring.x, ring.y);
  context.rotate(ring.rotation);
  const ringGlowAlpha = scaleNativeGlowAlpha(
    opacity * bloomCfg.ringAlpha,
    bloomCfg.clickEmissionScale,
  );
  let ringGlowColor;

  if (outputCompositing === 'browser-overlay')
  {
    ringGlowColor = linearEnergyToOverlayCss(
      colorToLinearEnergy(particleColor, 1, true),
      ringGlowAlpha,
      ringGlowAlpha,
      overlayColorCompensation,
      overlayAlphaLimit,
      opacity,
    );
  }
  else if (outputCompositing === 'host-additive')
  {
    ringGlowColor = linearEnergyToHostAdditiveCss(
      colorToLinearEnergy(particleColor, 1, true),
      ringGlowAlpha,
      ringGlowAlpha,
    );
  }
  else
  {
    ringGlowColor = colorToCanvasOutputCss(
      particleColor,
      ringGlowAlpha,
      linearNativeGlow,
    );
  }

  fillDissolvedRing(
    context,
    geometry.radius,
    geometry.width,
    geometry.threshold,
    ringCfg,
    colorForLuminance,
    useNativeBloom
      ? {
          // Canvas shadowBlur 不跟随当前变换矩阵，必须显式换算到物理像素。
          blur: bloomCfg.ringBlur * scale * dpr,
          color: ringGlowColor,
        }
      : null,
  );

  context.restore();
}

function drawDissolvedCircleEmission(
  context,
  ring,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  sharedMaterialEnergy = null,
)
{
  const ringCfg = fxConfig.rings;
  const bloomCfg = fxConfig.bloom;
  const geometry = resolveRingGeometry(ring, progress, scale, ringCfg);

  if (geometry.width <= 0.001)
  {
    return;
  }

  const materialEnergy = sharedMaterialEnergy ?? evaluateSrgbGradientEnergy(
    ringCfg.colorKeys,
    progress,
    ringCfg.hdrIntensity,
  );

  context.save();
  context.translate(ring.x, ring.y);
  context.rotate(ring.rotation);
  fillDissolvedRing(
    context,
    geometry.radius,
    geometry.width,
    geometry.threshold,
    ringCfg,
    (luminance) => linearEnergyToEmissionCss(
      materialEnergy,
      opacity * luminance * bloomCfg.ringEmissionAlpha,
      bloomCfg.emissionRange,
      bloomCfg.clickEmissionScale,
    ),
  );
  context.restore();
}

function drawDisk(
  context,
  wave,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  useNativeBloom = true,
  dpr = 1,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const diskCfg = fxConfig.disk;
  const bloomCfg = fxConfig.bloom;
  // Size over Lifetime 是带切线的 Unity AnimationCurve；所有后端必须
  // 共享 Hermite 求值，否则清晰圆盘与 Bloom 发射会在扩张阶段错位。
  const size = evaluateUnityHermiteCurve(diskCfg.sizeKeys, progress);
  const radius = diskCfg.radius * size * scale;
  const color = evaluateColor(diskCfg.colorKeys, progress);
  const particleAlpha = evaluateNumber(
    diskCfg.alphaKeys,
    progress,
  );

  if (radius <= 0 || particleAlpha <= 0)
  {
    return;
  }

  const materialEnergy = evaluateSrgbGradientEnergy(
    diskCfg.colorKeys,
    progress,
    bloomCfg.diskEmission,
  );
  const coverageAlpha = particleAlpha * opacity;
  let textureAlpha = clamp01(coverageAlpha);
  let textureCanvas;

  if (outputCompositing === 'browser-overlay')
  {
    textureAlpha = Math.min(textureAlpha, clamp01(overlayAlphaLimit));
    const resources = getCircleTextureResources();
    const compensation = overlayColorCompensation === 'bright-core'
      ? resolveOverlayCompensation(
          materialEnergy,
          opacity,
          coverageAlpha,
          opacity,
        )
      : 0;

    if (resources && textureAlpha > 0.000001)
    {
      textureCanvas = prepareLinearTintedTextureCanvas(
        resources,
        CIRCLE_TEXTURE_SIZE,
        materialEnergy,
        opacity,
        coverageAlpha,
        0,
        compensation,
      );
    }
  }
  else if (outputCompositing === 'host-additive')
  {
    const payload = resolveHostAdditivePayload(
      materialEnergy,
      opacity,
      coverageAlpha,
    );

    textureAlpha = payload[3];
    const resources = getCircleTextureResources();

    if (resources)
    {
      textureCanvas = prepareLinearTintedTextureCanvas(
        resources,
        CIRCLE_TEXTURE_SIZE,
        materialEnergy,
        opacity,
        textureAlpha,
      );
    }
  }
  else
  {
    const textureScales = materialEnergy.map((channel) =>
      channel / Math.max(particleAlpha, 0.00001));
    textureCanvas = prepareCircleTextureCanvas(textureScales);
  }

  if (!textureCanvas)
  {
    return;
  }

  context.save();
  // Cross2 的 Blend One / OneMinusSrcAlpha 与最终输出模式无关；清晰层
  // 始终按 Coverage 衰减目标，超过 8 位范围的能量由独立 Bloom 保留。
  context.globalCompositeOperation = 'source-over';
  context.translate(wave.x, wave.y);
  context.rotate(wave.diskRotation);
  context.globalAlpha = textureAlpha;
  const shadowAlpha = scaleNativeGlowAlpha(
    opacity * bloomCfg.diskAlpha,
    bloomCfg.clickEmissionScale,
  );
  if (outputCompositing === 'browser-overlay')
  {
    context.shadowColor = linearEnergyToOverlayCss(
      colorToLinearEnergy(color, 1, true),
      shadowAlpha,
      shadowAlpha,
      overlayColorCompensation,
      overlayAlphaLimit,
      opacity,
    );
  }
  else if (outputCompositing === 'host-additive')
  {
    context.shadowColor = linearEnergyToHostAdditiveCss(
      colorToLinearEnergy(color, 1, true),
      shadowAlpha,
      shadowAlpha,
    );
  }
  else
  {
    context.shadowColor = colorToCss(color, shadowAlpha);
  }
  // Canvas shadowBlur 不受 DPR 变换影响；按物理像素缩放才能保持 CSS 尺寸。
  context.shadowBlur = useNativeBloom
    ? bloomCfg.diskBlur * scale * dpr
    : 0;
  context.drawImage(
    textureCanvas,
    0,
    0,
    CIRCLE_TEXTURE_SIZE,
    CIRCLE_TEXTURE_SIZE,
    -radius,
    -radius,
    radius * 2,
    radius * 2,
  );
  context.restore();
}

function drawDiskNativeGlow(
  context,
  wave,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  dpr = 1,
)
{
  const diskCfg = fxConfig.disk;
  const bloomCfg = fxConfig.bloom;
  const radius = diskCfg.radius * evaluateUnityHermiteCurve(
    diskCfg.sizeKeys,
    progress,
  ) * scale;
  const blur = bloomCfg.diskBlur * scale * dpr;

  if (radius <= 0 || blur <= 0)
  {
    return;
  }

  const color = evaluateColor(diskCfg.colorKeys, progress);
  const shadowAlpha = scaleNativeGlowAlpha(
    opacity * bloomCfg.diskAlpha,
    bloomCfg.clickEmissionScale,
  );

  context.save();
  context.globalCompositeOperation = 'lighter';
  context.beginPath();
  context.arc(wave.x, wave.y, radius, 0, TAU);
  // 黑色源在 lighter 下不增加 RGB；Final Pass 不读取其 Alpha，因此可以
  // 保留零偏移阴影的完整内外卷积，而不会重新遮挡宿主背景。
  context.fillStyle = 'rgb(0, 0, 0)';
  context.shadowColor = colorToCanvasOutputCss(color, shadowAlpha, true);
  context.shadowBlur = blur;
  context.fill();
  context.restore();
}

function drawDiskEmission(
  context,
  wave,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
)
{
  const diskCfg = fxConfig.disk;
  const bloomCfg = fxConfig.bloom;
  const radius = diskCfg.radius * evaluateUnityHermiteCurve(
    diskCfg.sizeKeys,
    progress,
  ) * scale;
  const materialEnergy = evaluateSrgbGradientEnergy(
    diskCfg.colorKeys,
    progress,
    bloomCfg.diskEmission,
  );
  const textureCanvas = prepareCircleTextureCanvas(
    materialEnergy.map((channel) =>
      channel * bloomCfg.clickEmissionScale / bloomCfg.emissionRange),
  );

  if (radius <= 0 || !textureCanvas)
  {
    return;
  }

  context.save();
  context.translate(wave.x, wave.y);
  context.rotate(wave.diskRotation);
  // Cross2 生命周期 Alpha 不进入 RGB；Bloom 发射持续到粒子真正死亡。
  context.globalAlpha = clamp01(opacity * bloomCfg.diskEmissionAlpha);
  context.drawImage(
    textureCanvas,
    0,
    0,
    CIRCLE_TEXTURE_SIZE,
    CIRCLE_TEXTURE_SIZE,
    -radius,
    -radius,
    radius * 2,
    radius * 2,
  );
  context.restore();
}

function drawDiskCoverage(
  context,
  wave,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
)
{
  const diskCfg = fxConfig.disk;
  const radius = diskCfg.radius * evaluateUnityHermiteCurve(
    diskCfg.sizeKeys,
    progress,
  ) * scale;
  const lifecycleAlpha = evaluateNumber(diskCfg.alphaKeys, progress) * opacity;

  if (radius <= 0 || lifecycleAlpha <= 0)
  {
    return;
  }

  const resources = getCircleTextureResources();

  if (!resources)
  {
    // Software Bloom 依赖同样的 ImageData 能力；资源不可用时由外层
    // renderer 失败策略切换 Native，不能用径向近似掩盖纹理细节缺失。
    return;
  }

  context.save();
  context.globalCompositeOperation = 'source-over';
  context.translate(wave.x, wave.y);
  context.rotate(wave.diskRotation);
  context.globalAlpha = clamp01(lifecycleAlpha);
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  // 直接采样完整 Circle_01，保留径向表无法表达的逐像素 Coverage 细节。
  context.drawImage(
    resources.coverageCanvas,
    0,
    0,
    CIRCLE_TEXTURE_SIZE,
    CIRCLE_TEXTURE_SIZE,
    -radius,
    -radius,
    radius * 2,
    radius * 2,
  );
  context.restore();
}

function resolveShardTextureFrameIndex(particle, shardCfg)
{
  const frames = shardCfg.textureFrames;
  const frameCount = Array.isArray(frames) && frames.length > 0
    ? frames.length
    : 2;
  const rawIndex = Number.isInteger(particle.textureFrame)
    ? particle.textureFrame
    : 0;

  return ((rawIndex % frameCount) + frameCount) % frameCount;
}

function resolveShardTextureFrame(particle, shardCfg)
{
  const frames = shardCfg.textureFrames;

  if (!Array.isArray(frames) || frames.length === 0)
  {
    // 保留旧配置的兼容轮廓；默认配置始终使用 Unity 图集的实测边界。
    return [
      [0, -0.58],
      [0.52, 0.45],
      [-0.52, 0.45],
    ];
  }

  return frames[resolveShardTextureFrameIndex(particle, shardCfg)];
}

function drawTriangleTextureFrame(context, canvas, frameIndex)
{
  context.save();

  if (frameIndex % 2 === 1)
  {
    // Unity 图集的第二帧与第一帧 RGBA 完全相同，仅 V 方向翻转。
    context.translate(0, TRIANGLE_TEXTURE_SIZE);
    context.scale(1, -1);
  }

  context.drawImage(canvas, 0, 0);
  context.restore();
}

function resolveShardRoundness(shardCfg)
{
  return clamp01(shardCfg.roundness);
}

function getRoundedTriangleCoverage(resources, roundness)
{
  const key = clamp01(roundness);

  if (key <= 0)
  {
    return null;
  }

  if (!resources.roundedCoverages)
  {
    resources.roundedCoverages = new Map();
  }

  if (resources.roundedCoverages.has(key))
  {
    return resources.roundedCoverages.get(key);
  }

  // 宿主可能连续拖动参数，限制缓存避免把全部浮点中间值永久保留。
  if (resources.roundedCoverages.size >= 32)
  {
    resources.roundedCoverages.delete(
      resources.roundedCoverages.keys().next().value,
    );
  }

  const coverage = createRoundedTriangleCoverage(key);

  resources.roundedCoverages.set(key, coverage);
  return coverage;
}

function prepareSceneRoundedTriangleCanvas(
  resources,
  materialEnergy,
  roundness,
  frameIndex,
)
{
  const amount = clamp01(roundness);
  const shapeCoverage = getRoundedTriangleCoverage(resources, amount);

  if (!shapeCoverage)
  {
    return null;
  }

  if (!resources.roundedSceneFrames)
  {
    resources.roundedSceneFrames = createLinearTintFrames(
      TRIANGLE_TEXTURE_SIZE,
      2,
    );
  }

  if (!resources.roundedSceneFrames)
  {
    return null;
  }

  const frameSlot = ((Math.trunc(frameIndex) % 2) + 2) % 2;
  const frame = resources.roundedSceneFrames[frameSlot];
  const safeMaterialEnergy = materialEnergy.map((channel) =>
    Math.max(0, Number(channel) || 0));
  const key = [amount, ...safeMaterialEnergy].join(',');

  if (frame.key === key)
  {
    return frame.canvas;
  }

  prepareLinearTextureData(resources);

  const flipVertical = frameSlot === 1;
  const sourceRgba = resources.linearTextureRgba;
  const sourceTextureRgb = resources.linearTextureRgb;

  for (let y = 0; y < TRIANGLE_TEXTURE_SIZE; y++)
  {
    const sourceY = flipVertical ? TRIANGLE_TEXTURE_SIZE - 1 - y : y;

    for (let x = 0; x < TRIANGLE_TEXTURE_SIZE; x++)
    {
      const sourceIndex = sourceY * TRIANGLE_TEXTURE_SIZE + x;
      const outputOffset = (y * TRIANGLE_TEXTURE_SIZE + x) * 4;
      const targetAlpha = shapeCoverage[sourceIndex] / 255;
      const [sampleU, sampleV] = mapRoundedTriangleTextureUv(
        (x + 0.5) / TRIANGLE_TEXTURE_SIZE,
        (sourceY + 0.5) / TRIANGLE_TEXTURE_SIZE,
        amount,
      );
      const textureSupport = sampleTextureChannel(
        sourceRgba,
        TRIANGLE_TEXTURE_SIZE,
        4,
        sampleU,
        sampleV,
        3,
      ) / 255;

      for (let channel = 0; channel < 3; channel++)
      {
        const textureChannel = sampleTextureChannel(
          sourceTextureRgb,
          TRIANGLE_TEXTURE_SIZE,
          3,
          sampleU,
          sampleV,
          channel,
        );
        const supportedChannel = 1 +
          (textureChannel - 1) * clamp01(textureSupport);
        const roundedChannel = supportedChannel +
          (1 - supportedChannel) * amount;

        frame.image.data[outputOffset + channel] = Math.round(
          clamp01(roundedChannel * safeMaterialEnergy[channel]) * 255,
        );
      }

      frame.image.data[outputOffset + 3] = Math.round(
        clamp01(targetAlpha) * 255,
      );
    }
  }

  frame.context.putImageData(frame.image, 0, 0);
  frame.key = key;
  return frame.canvas;
}

function drawTexturedTriangle(
  context,
  particle,
  size,
  materialEnergy,
  particleAlpha,
  frameIndex,
  energyScale = 1,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
  opacity = 1,
  roundness = 0,
)
{
  const resources = getTriangleTextureResources();

  if (!resources)
  {
    return false;
  }

  const scaledEnergy = materialEnergy.map((channel) =>
    channel * Math.max(0, energyScale));
  const transparentPayload = outputCompositing === 'browser-overlay' ||
    outputCompositing === 'host-additive';
  const shapeCoverage = getRoundedTriangleCoverage(resources, roundness);
  const shape = shapeCoverage
    ? {
        coverage: shapeCoverage,
        roundness,
        useTextureAlpha: outputCompositing === 'scene',
      }
    : null;
  let payloadAlpha = clamp01(particleAlpha);
  let textureCanvas;

  if (outputCompositing === 'browser-overlay')
  {
    payloadAlpha = Math.min(payloadAlpha, clamp01(overlayAlphaLimit));
    const compensation = overlayColorCompensation === 'bright-core'
      ? resolveOverlayCompensation(
          scaledEnergy,
          particleAlpha,
          particleAlpha,
          opacity,
        )
      : 0;

    if (payloadAlpha > 0.000001)
    {
      textureCanvas = prepareLinearTintedTextureCanvas(
        resources,
        TRIANGLE_TEXTURE_SIZE,
        scaledEnergy,
        particleAlpha,
        particleAlpha,
        frameIndex,
        compensation,
        shape,
      );
    }
  }
  else if (outputCompositing === 'host-additive')
  {
    const payload = resolveHostAdditivePayload(
      scaledEnergy,
      particleAlpha,
      particleAlpha,
    );

    payloadAlpha = payload[3];
    textureCanvas = prepareLinearTintedTextureCanvas(
      resources,
      TRIANGLE_TEXTURE_SIZE,
      scaledEnergy,
      particleAlpha,
      payloadAlpha,
      frameIndex,
      0,
      shape,
    );
  }
  else
  {
    const textureContext = resources.context;
    const scaledColor = scaledEnergy.map((channel) =>
      Math.round(clamp01(channel) * 255));
    if (roundness > 0)
    {
      textureCanvas = prepareSceneRoundedTriangleCanvas(
        resources,
        scaledEnergy,
        roundness,
        frameIndex,
      );
    }

    if (!textureCanvas)
    {
      textureContext.setTransform(1, 0, 0, 1, 0, 0);
      textureContext.globalAlpha = 1;
      textureContext.globalCompositeOperation = 'source-over';
      textureContext.imageSmoothingEnabled = true;
      textureContext.clearRect(
        0,
        0,
        TRIANGLE_TEXTURE_SIZE,
        TRIANGLE_TEXTURE_SIZE,
      );
      drawTriangleTextureFrame(
        textureContext,
        resources.colorCanvas,
        frameIndex,
      );

      // Scene Final Pass 读取线性字节；这里继续按 Unity 线性材质乘法绘制。
      textureContext.globalCompositeOperation = 'multiply';
      textureContext.fillStyle = `rgb(${scaledColor[0]}, ${
        scaledColor[1]}, ${scaledColor[2]})`;
      textureContext.fillRect(
        0,
        0,
        TRIANGLE_TEXTURE_SIZE,
        TRIANGLE_TEXTURE_SIZE,
      );
      textureContext.globalCompositeOperation = 'destination-in';
      drawTriangleTextureFrame(
        textureContext,
        resources.alphaCanvas,
        frameIndex,
      );
      textureCanvas = resources.canvas;
    }
  }

  if (transparentPayload && (!textureCanvas || payloadAlpha <= 0.00001))
  {
    // source-over 下黑色纹理仍会遮挡宿主；零能量必须完全跳过。
    return true;
  }

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.globalAlpha = payloadAlpha;
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.drawImage(textureCanvas, -size * 0.5, -size * 0.5, size, size);
  context.restore();
  return true;
}

function drawTriangle(
  context,
  particle,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const shardCfg = fxConfig.shards;
  const progress = clamp01(particle.ageMs / particle.lifetimeMs);
  const size = particle.size * evaluateUnityHermiteCurve(
    shardCfg.sizeKeys,
    progress,
  ) * scale;
  const alpha = evaluateNumber(shardCfg.alphaKeys, progress) * opacity;
  const materialEnergy = evaluateSrgbGradientEnergy(
    shardCfg.colorKeys,
    progress,
    shardCfg.hdrIntensity,
    shardCfg.startColor,
  );
  const textureFrameIndex = resolveShardTextureFrameIndex(particle, shardCfg);
  const textureFrame = resolveShardTextureFrame(particle, shardCfg);
  const roundness = resolveShardRoundness(shardCfg);

  if (size <= 0 || alpha <= 0)
  {
    return;
  }

  if (drawTexturedTriangle(
    context,
    particle,
    size,
    materialEnergy,
    alpha,
    textureFrameIndex,
    1,
    outputCompositing,
    overlayColorCompensation,
    overlayAlphaLimit,
    opacity,
    roundness,
  ))
  {
    return;
  }

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.beginPath();
  traceRoundedTrianglePath(context, textureFrame, size, shardCfg.roundness);
  if (outputCompositing === 'browser-overlay')
  {
    context.fillStyle = linearEnergyToOverlayCss(
      materialEnergy,
      alpha,
      alpha,
      overlayColorCompensation,
      overlayAlphaLimit,
      opacity,
    );
  }
  else if (outputCompositing === 'host-additive')
  {
    context.fillStyle = linearEnergyToHostAdditiveCss(
      materialEnergy,
      alpha,
      alpha,
    );
  }
  else
  {
    context.fillStyle = linearEnergyToAdditiveCss(materialEnergy, alpha);
  }
  // 三角碎片在原图中是清晰本体；显式清空阴影，避免继承上一层发光状态。
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.fill();
  context.restore();
}

function drawTriangleCoverage(
  context,
  particle,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
)
{
  const shardCfg = fxConfig.shards;
  const progress = clamp01(particle.ageMs / particle.lifetimeMs);
  const size = particle.size * evaluateUnityHermiteCurve(
    shardCfg.sizeKeys,
    progress,
  ) * scale;
  const alpha = evaluateNumber(shardCfg.alphaKeys, progress) * opacity;
  const textureFrameIndex = resolveShardTextureFrameIndex(particle, shardCfg);
  const textureFrame = resolveShardTextureFrame(particle, shardCfg);
  const roundness = resolveShardRoundness(shardCfg);

  if (size <= 0 || alpha <= 0)
  {
    return;
  }

  if (drawTexturedTriangle(
    context,
    particle,
    size,
    [1, 1, 1],
    alpha,
    textureFrameIndex,
    1,
    'browser-overlay',
    'none',
    1,
    opacity,
    roundness,
  ))
  {
    return;
  }

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.beginPath();
  traceRoundedTrianglePath(context, textureFrame, size, shardCfg.roundness);
  context.fillStyle = `rgba(255, 255, 255, ${clamp01(alpha)})`;
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.fill();
  context.restore();
}

function drawTriangleEmission(
  context,
  particle,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
)
{
  const shardCfg = fxConfig.shards;
  const bloomCfg = fxConfig.bloom;
  const progress = clamp01(particle.ageMs / particle.lifetimeMs);
  const size = particle.size * evaluateUnityHermiteCurve(
    shardCfg.sizeKeys,
    progress,
  ) * scale;
  const alpha = evaluateNumber(shardCfg.alphaKeys, progress) * opacity;
  const materialEnergy = evaluateSrgbGradientEnergy(
    shardCfg.colorKeys,
    progress,
    shardCfg.hdrIntensity,
    shardCfg.startColor,
  );
  const textureFrameIndex = resolveShardTextureFrameIndex(particle, shardCfg);
  const textureFrame = resolveShardTextureFrame(particle, shardCfg);
  const roundness = resolveShardRoundness(shardCfg);

  if (size <= 0 || alpha <= 0)
  {
    return;
  }

  if (drawTexturedTriangle(
    context,
    particle,
    size,
    materialEnergy,
    alpha,
    textureFrameIndex,
    1 / Math.max(1, bloomCfg.emissionRange),
    'scene',
    'none',
    1,
    opacity,
    roundness,
  ))
  {
    return;
  }

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.beginPath();
  traceRoundedTrianglePath(context, textureFrame, size, shardCfg.roundness);
  context.fillStyle = linearEnergyToEmissionCss(
    materialEnergy,
    alpha,
    bloomCfg.emissionRange,
  );
  context.fill();
  context.restore();
}

function evaluateRingAngularVelocity(angularBlend, progress, ringCfg = UNITY_FX_TOUCH.rings)
{
  const minVelocity = evaluateUnitySmoothCurve(
    ringCfg.angularVelocityMinKeys,
    progress,
  );
  const maxVelocity = evaluateUnitySmoothCurve(
    ringCfg.angularVelocityMaxKeys,
    progress,
  );
  // 保留 maxCurve 末端的微小负值；它属于资源本身，不能人为钳成停转。
  const velocity = lerp(minVelocity, maxVelocity, angularBlend);

  return velocity * ringCfg.angularVelocityMultiplier * ringCfg.rotationDirection;
}

function drawHit(
  context,
  wave,
  progress,
  scale,
  opacity,
  fxConfig,
  linearOutput = false,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const cfg = fxConfig.hit;
  const radius = cfg.radius * scale;
  const alpha = evaluateNumber(cfg.alphaKeys, progress) * opacity;
  const color = evaluateColor(cfg.colorKeys, progress);

  if (alpha <= 0)
  {
    return;
  }

  context.save();
  context.beginPath();
  context.arc(wave.x, wave.y, radius, 0, TAU);
  if (outputCompositing === 'browser-overlay')
  {
    context.fillStyle = linearEnergyToOverlayCss(
      colorToLinearEnergy(color, 1, true),
      alpha,
      alpha,
      overlayColorCompensation,
      overlayAlphaLimit,
      opacity,
    );
  }
  else if (outputCompositing === 'host-additive')
  {
    context.fillStyle = linearEnergyToHostAdditiveCss(
      colorToLinearEnergy(color, 1, true),
      alpha,
      alpha,
    );
  }
  else
  {
    context.fillStyle = colorToCanvasOutputCss(color, alpha, linearOutput);
  }
  context.fill();
  context.restore();
}

function drawFlare(
  context,
  wave,
  progress,
  scale,
  opacity,
  fxConfig,
  linearOutput = false,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const cfg = fxConfig.flare;
  const radius = cfg.radius * scale;
  const alpha = evaluateNumber(cfg.alphaKeys, progress) * opacity;
  const color = evaluateColor(cfg.colorKeys, progress);

  if (alpha <= 0)
  {
    return;
  }

  context.save();
  context.translate(wave.x, wave.y);
  // Final Pass 直接采样 Canvas 预乘颜色，因此附加粒子也必须写入线性能量。
  if (outputCompositing === 'browser-overlay')
  {
    context.strokeStyle = linearEnergyToOverlayCss(
      colorToLinearEnergy(color, 1, true),
      alpha,
      alpha,
      overlayColorCompensation,
      overlayAlphaLimit,
      opacity,
    );
  }
  else if (outputCompositing === 'host-additive')
  {
    context.strokeStyle = linearEnergyToHostAdditiveCss(
      colorToLinearEnergy(color, 1, true),
      alpha,
      alpha,
    );
  }
  else
  {
    context.strokeStyle = colorToCanvasOutputCss(color, alpha, linearOutput);
  }

  for (let i = 0; i < cfg.rayCount; i++)
  {
    const angle = (TAU / cfg.rayCount) * i;
    const endX = Math.cos(angle) * radius;
    const endY = Math.sin(angle) * radius;

    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(endX, endY);
    context.lineWidth = 1.5 * scale;
    context.stroke();
  }

  context.restore();
}



class ClickWave
{
  constructor(x, y, fxConfig, lastUpdateTimeMs = null)
  {
    this.fx = fxConfig;
    this.x = x;
    this.y = y;
    this.ageMs = 0;
    this.lastUpdateTimeMs = Number.isFinite(lastUpdateTimeMs)
      ? lastUpdateTimeMs
      : null;
    // Cross2 的 Start Rotation 是 0..2pi；同一粒子的 Scene 与 Bloom
    // 必须复用这次采样，不能在不同渲染阶段分别随机。
    this.diskRotation = random(0, TAU);
    this.rings = [];

    const ringCfg = fxConfig.rings;

    for (let index = 0; index < ringCfg.count; index++)
    {
      const angularBlend = Math.random();

      this.rings.push(
        {
          x,
          y,
          radius: random(ringCfg.radiusMin, ringCfg.radiusMax),
          rotation: random(0, TAU),
          angularBlend,
          angularVelocity: evaluateRingAngularVelocity(angularBlend, 0, ringCfg),
        },
      );
    }
  }

  update(deltaMs)
  {
    const ringCfg = this.fx.rings;
    const previousAgeMs = this.ageMs;

    this.ageMs += deltaMs;

    for (const ring of this.rings)
    {
      const sampleAgeMs = (previousAgeMs + this.ageMs) * 0.5;
      const progress = sampleAgeMs / ringCfg.lifetimeMs;

      ring.angularVelocity = evaluateRingAngularVelocity(
        ring.angularBlend,
        progress,
        ringCfg,
      );
      ring.rotation += ring.angularVelocity * (deltaMs / 1000);
    }
  }

  updateTo(timeMs)
  {
    if (!Number.isFinite(timeMs) || !Number.isFinite(this.lastUpdateTimeMs))
    {
      return;
    }

    const deltaMs = Math.max(0, timeMs - this.lastUpdateTimeMs);

    if (deltaMs <= 0)
    {
      return;
    }

    // 点击可能在两个 RAF 之间出生；对象级锚点避免继承出生前的整帧时间。
    this.lastUpdateTimeMs = timeMs;
    this.update(deltaMs);
  }

  drawAdditiveBase(
    context,
    scale,
    opacity,
    linearOutput = false,
    outputCompositing = 'scene',
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    // Hit：撞击爆发，极短极亮
    const hitProgress = this.ageMs / this.fx.hit.lifetimeMs;

    if (this.fx.hit.enabled && hitProgress < 1)
    {
      drawHit(
        context,
        this,
        hitProgress,
        scale,
        opacity,
        this.fx,
        linearOutput,
        outputCompositing,
        overlayColorCompensation,
        overlayAlphaLimit,
      );
    }

    // Flare：星形闪光
    const flareProgress = this.ageMs / this.fx.flare.lifetimeMs;

    if (this.fx.flare.enabled && flareProgress < 1)
    {
      drawFlare(
        context,
        this,
        flareProgress,
        scale,
        opacity,
        this.fx,
        linearOutput,
        outputCompositing,
        overlayColorCompensation,
        overlayAlphaLimit,
      );
    }
  }

  drawDiskLayer(
    context,
    scale,
    opacity,
    useNativeBloom = true,
    dpr = 1,
    outputCompositing = 'scene',
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      drawDisk(
        context,
        this,
        diskProgress,
        scale,
        opacity,
        this.fx,
        useNativeBloom,
        dpr,
        outputCompositing,
        overlayColorCompensation,
        overlayAlphaLimit,
      );
    }
  }

  drawDiskGlow(context, scale, opacity, dpr = 1)
  {
    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      drawDiskNativeGlow(
        context,
        this,
        diskProgress,
        scale,
        opacity,
        this.fx,
        dpr,
      );
    }
  }

  drawBase(
    context,
    scale,
    opacity,
    useNativeBloom = true,
    outputCompositing = 'scene',
    dpr = 1,
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    // 旧 Canvas 回退保持既有绘制顺序；精确 Scene 路径按材质队列分层调用。
    this.drawAdditiveBase(
      context,
      scale,
      opacity,
      false,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
    this.drawDiskLayer(
      context,
      scale,
      opacity,
      useNativeBloom,
      dpr,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
  }

  drawRings(
    context,
    scale,
    opacity,
    useNativeBloom = true,
    dpr = 1,
    outputCompositing = 'scene',
    linearNativeGlow = false,
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress < 1)
    {
      const ringMaterialEnergy = evaluateSrgbGradientEnergy(
        this.fx.rings.colorKeys,
        ringProgress,
        this.fx.rings.hdrIntensity,
      );

      for (const ring of this.rings)
      {
        drawDissolvedCircle(
          context,
          ring,
          ringProgress,
          scale,
          opacity,
          this.fx,
          useNativeBloom,
          ringMaterialEnergy,
          outputCompositing,
          linearNativeGlow,
          dpr,
          overlayColorCompensation,
          overlayAlphaLimit,
        );
      }
    }
  }

  draw(
    context,
    scale,
    opacity,
    useNativeBloom = true,
    outputCompositing = 'scene',
    dpr = 1,
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    this.drawBase(
      context,
      scale,
      opacity,
      useNativeBloom,
      outputCompositing,
      dpr,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
    this.drawRings(
      context,
      scale,
      opacity,
      useNativeBloom,
      dpr,
      outputCompositing,
      false,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
  }

  drawBloom(context, scale, opacity)
  {
    if (this.fx.bloom.clickEmissionScale <= 0)
    {
      // 强度为零时跳过整套点击发射几何，轨迹 Bloom 仍由独立路径绘制。
      return;
    }

    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      drawDiskEmission(context, this, diskProgress, scale, opacity, this.fx);
    }

    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress < 1)
    {
      const ringMaterialEnergy = evaluateSrgbGradientEnergy(
        this.fx.rings.colorKeys,
        ringProgress,
        this.fx.rings.hdrIntensity,
      );

      for (const ring of this.rings)
      {
        drawDissolvedCircleEmission(
          context,
          ring,
          ringProgress,
          scale,
          opacity,
          this.fx,
          ringMaterialEnergy,
        );
      }
    }
  }

  drawBloomCoverage(context, scale, opacity)
  {
    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      drawDiskCoverage(
        context,
        this,
        diskProgress,
        scale,
        opacity,
        this.fx,
      );
    }

    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress >= 1)
    {
      return;
    }

    for (const ring of this.rings)
    {
      // Ring3 的纹理 Alpha 与粒子 opacity 构成 Coverage；HDR 材质能量
      // 只写 Bloom 发射源，不能反向抬高透明桌面的遮挡度。
      drawDissolvedCircle(
        context,
        ring,
        ringProgress,
        scale,
        opacity,
        this.fx,
        false,
        [1, 1, 1],
        'browser-overlay',
      );
    }
  }

  appendCanvasSceneCoverage(renderer, scale, opacity)
  {
    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress >= 1)
    {
      return;
    }

    const diskCfg = this.fx.disk;
    const radius = diskCfg.radius * evaluateUnityHermiteCurve(
      diskCfg.sizeKeys,
      diskProgress,
    ) * scale;
    const particleAlpha = evaluateNumber(
      diskCfg.alphaKeys,
      diskProgress,
    ) * opacity;

    renderer.addCoverageDisk(
      this.x,
      this.y,
      radius,
      particleAlpha,
      this.diskRotation,
    );
  }

  appendWebGLSceneDiskLayer(renderer, scale, opacity)
  {
    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress >= 1)
    {
      return;
    }

    const diskCfg = this.fx.disk;
    const bloomCfg = this.fx.bloom;
    const radius = diskCfg.radius * evaluateUnityHermiteCurve(
      diskCfg.sizeKeys,
      diskProgress,
    ) * scale;
    const materialEnergy = evaluateSrgbGradientEnergy(
      diskCfg.colorKeys,
      diskProgress,
      bloomCfg.diskEmission,
    );
    const particleAlpha = evaluateNumber(
      diskCfg.alphaKeys,
      diskProgress,
    );

    renderer.addAlphaBlendDisk(
      this.x,
      this.y,
      radius,
      materialEnergy,
      opacity,
      particleAlpha,
      this.diskRotation,
    );
  }

  appendWebGLSceneAdditiveLayer(renderer, scale, opacity)
  {
    const hitProgress = this.ageMs / this.fx.hit.lifetimeMs;

    if (this.fx.hit.enabled && hitProgress < 1)
    {
      const hitCfg = this.fx.hit;
      const alpha = evaluateNumber(hitCfg.alphaKeys, hitProgress) * opacity;

      renderer.addSolidDisk(
        this.x,
        this.y,
        hitCfg.radius * scale,
        colorToLinearEnergy(
          evaluateColor(hitCfg.colorKeys, hitProgress),
          1,
          true,
        ),
        alpha,
      );
    }

    const flareProgress = this.ageMs / this.fx.flare.lifetimeMs;

    if (this.fx.flare.enabled && flareProgress < 1)
    {
      const flareCfg = this.fx.flare;
      const alpha = evaluateNumber(flareCfg.alphaKeys, flareProgress) * opacity;
      const color = colorToLinearEnergy(
        evaluateColor(flareCfg.colorKeys, flareProgress),
        1,
        true,
      );
      const radius = flareCfg.radius * scale;

      for (let index = 0; index < flareCfg.rayCount; index++)
      {
        const angle = TAU / flareCfg.rayCount * index;

        renderer.addTrailSegment(
          { x: this.x, y: this.y },
          {
            x: this.x + Math.cos(angle) * radius,
            y: this.y + Math.sin(angle) * radius,
          },
          1.5 * scale,
          color,
          alpha,
        );
      }
    }

    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress >= 1)
    {
      return;
    }

    const ringCfg = this.fx.rings;
    const ringMaterialEnergy = evaluateSrgbGradientEnergy(
      ringCfg.colorKeys,
      ringProgress,
      ringCfg.hdrIntensity,
    );
    const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;

    for (const ring of this.rings)
    {
      const geometry = resolveRingGeometry(
        ring,
        ringProgress,
        scale,
        ringCfg,
      );

      renderer.addDissolveRing(
        ring.x,
        ring.y,
        geometry.radius,
        geometry.width,
        ring.rotation,
        ringCfg.radialSamples,
        ringCfg.arcSamples,
        ringMaterialEnergy,
        opacity,
        geometry.threshold,
        ringCfg.textureUvMin,
        ringCfg.textureUvMax,
        direction,
      );
    }
  }

  appendWebGLBloom(renderer, scale, opacity)
  {
    if (this.fx.bloom.clickEmissionScale <= 0)
    {
      return;
    }

    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      const diskCfg = this.fx.disk;
      const bloomCfg = this.fx.bloom;
      const radius = diskCfg.radius * evaluateUnityHermiteCurve(
        diskCfg.sizeKeys,
        diskProgress,
      ) * scale;
      const emissionOpacity = opacity * bloomCfg.diskEmissionAlpha *
        bloomCfg.clickEmissionScale;
      const materialEnergy = evaluateSrgbGradientEnergy(
        diskCfg.colorKeys,
        diskProgress,
        bloomCfg.diskEmission,
      );

      renderer.addDisk(
        this.x,
        this.y,
        radius,
        materialEnergy,
        emissionOpacity,
        this.diskRotation,
      );
    }

    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress >= 1)
    {
      return;
    }

    const ringCfg = this.fx.rings;
    const bloomCfg = this.fx.bloom;
    const ringMaterialEnergy = evaluateSrgbGradientEnergy(
      ringCfg.colorKeys,
      ringProgress,
      ringCfg.hdrIntensity,
    );
    const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;

    for (const ring of this.rings)
    {
      const geometry = resolveRingGeometry(
        ring,
        ringProgress,
        scale,
        ringCfg,
      );

      renderer.addRing(
        ring.x,
        ring.y,
        geometry.radius,
        geometry.width,
        ring.rotation,
        ringCfg.radialSamples,
        ringCfg.arcSamples,
        ringMaterialEnergy,
        opacity * bloomCfg.ringEmissionAlpha * bloomCfg.clickEmissionScale,
        (angularProgress, radialProgress) =>
        {
          const textureProgress = direction > 0
            ? angularProgress
            : 1 - angularProgress;

          return evaluateRingLuminance(
            textureProgress,
            radialProgress,
            geometry.threshold,
            ringCfg,
          );
        },
      );
    }
  }

  get dead()
  {
    let lifetimeMs = this.fx.disk.lifetimeMs;

    if (this.fx.hit.enabled)
    {
      lifetimeMs = Math.max(lifetimeMs, this.fx.hit.lifetimeMs);
    }

    if (this.fx.flare.enabled)
    {
      lifetimeMs = Math.max(lifetimeMs, this.fx.flare.lifetimeMs);
    }

    if (this.rings.length > 0)
    {
      // count=0 时没有圆环可见，不能让不存在的 600ms 粒子继续占用 RAF。
      lifetimeMs = Math.max(lifetimeMs, this.fx.rings.lifetimeMs);
    }

    return this.ageMs >= lifetimeMs;
  }
}

class ShardParticle
{
  constructor(specification)
  {
    Object.assign(this, specification);
    this.ageMs = 0;
    this.lastUpdateTimeMs = Number.isFinite(specification.lastUpdateTimeMs)
      ? specification.lastUpdateTimeMs
      : null;
  }

  update(deltaMs)
  {
    const deltaSeconds = deltaMs / 1000;

    this.ageMs += deltaMs;
    this.x += this.velocityX * deltaSeconds;
    this.y += this.velocityY * deltaSeconds;
  }

  updateTo(timeMs)
  {
    if (!Number.isFinite(timeMs) || !Number.isFinite(this.lastUpdateTimeMs))
    {
      return;
    }

    const deltaMs = Math.max(0, timeMs - this.lastUpdateTimeMs);

    if (deltaMs <= 0)
    {
      return;
    }

    // 输入事件也会推进拖尾虚拟时钟。每枚碎片保存自己的消费位置，
    // 确保下一帧补算完整时间，同时不继承出生前的空闲时段。
    this.lastUpdateTimeMs = timeMs;
    this.update(deltaMs);
  }

  draw(
    context,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
    outputCompositing = 'scene',
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    drawTriangle(
      context,
      this,
      scale,
      opacity,
      fxConfig,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
  }

  drawBloom(
    context,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
  )
  {
    drawTriangleEmission(context, this, scale, opacity, fxConfig);
  }

  drawBloomCoverage(
    context,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
  )
  {
    drawTriangleCoverage(context, this, scale, opacity, fxConfig);
  }

  appendWebGLScene(
    renderer,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
  )
  {
    // 碎片材质本身就是加色 HDR，Scene 与 Bloom 发射可共享同一套三角几何。
    this.appendWebGLBloom(renderer, scale, opacity, fxConfig);
  }

  appendWebGLBloom(
    renderer,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
  )
  {
    const shardCfg = fxConfig.shards;
    const progress = clamp01(this.ageMs / this.lifetimeMs);
    const size = this.size * evaluateUnityHermiteCurve(
      shardCfg.sizeKeys,
      progress,
    ) * scale;
    const alpha = evaluateNumber(shardCfg.alphaKeys, progress) * opacity;
    const materialEnergy = evaluateSrgbGradientEnergy(
      shardCfg.colorKeys,
      progress,
      shardCfg.hdrIntensity,
      shardCfg.startColor,
    );
    const textureFrameIndex = resolveShardTextureFrameIndex(this, shardCfg);

    renderer.addTriangle(
      this.x,
      this.y,
      size,
      this.rotation,
      materialEnergy,
      alpha,
      textureFrameIndex,
      resolveShardRoundness(shardCfg),
    );
  }

  get dead()
  {
    return this.ageMs >= this.lifetimeMs;
  }
}

function createShard(
  x,
  y,
  originAngle,
  kind,
  scale,
  shardCfg = UNITY_FX_TOUCH.shards,
  lastUpdateTimeMs = null,
  ownerId = null,
)
{
  const isClick = kind === 'click';
  const radius = (isClick ? shardCfg.clickRadius : shardCfg.trailRadius) * scale;
  const speed = (isClick
    ? random(shardCfg.clickSpeedMin, shardCfg.clickSpeedMax)
    : random(shardCfg.trailSpeedMin, shardCfg.trailSpeedMax)) * scale;
  const lifetimeMs = isClick
    ? random(shardCfg.clickLifetimeMinMs, shardCfg.clickLifetimeMaxMs)
    : random(shardCfg.trailLifetimeMinMs, shardCfg.trailLifetimeMaxMs);

  return new ShardParticle(
    {
      kind,
      x: x + Math.cos(originAngle) * radius,
      y: y + Math.sin(originAngle) * radius,
      velocityX: Math.cos(originAngle) * speed,
      velocityY: Math.sin(originAngle) * speed,
      // 原 ParticleSystem 不旋转粒子，而是在 2×1 图集中随机选择朝上或朝下帧。
      rotation: 0,
      textureFrame: Math.random() < 0.5 ? 0 : 1,
      lifetimeMs,
      size: random(shardCfg.sizeMin, shardCfg.sizeMax),
      lastUpdateTimeMs,
      ownerId,
    },
  );
}

function createTrailPoint(x, y, bornAt)
{
  return {
    x,
    y,
    bornAt,
  };
}

function hasVisibleTrailPoints(points)
{
  for (let index = 1; index < points.length; index++)
  {
    if (
      points[index].x !== points[index - 1].x ||
      points[index].y !== points[index - 1].y
    )
    {
      return true;
    }
  }

  return false;
}

function interpolateTrailColor(progress, trailCfg = UNITY_FX_TOUCH.trail)
{
  return evaluateColor(trailCfg.gradient, progress);
}

function measureTrail(points, cacheSegmentLengths = false)
{
  let totalLength = 0;
  const distances = [0];
  const segmentLengths = cacheSegmentLengths ? [0] : null;

  for (let index = 1; index < points.length; index++)
  {
    const segmentLength = distance(points[index - 1], points[index]);

    totalLength += segmentLength;
    distances.push(totalLength);

    if (segmentLengths)
    {
      segmentLengths.push(segmentLength);
    }
  }

  return {
    distances,
    segmentLengths,
    totalLength,
  };
}

function createTrailFrameData(
  points,
  trailCfg,
  materialIntensity = null,
  cacheSegmentLengths = materialIntensity !== null,
)
{
  // Canvas 与 WebGL2 共享同一份段长测量，避免后端切换改变轨迹采样。
  const measurement = measureTrail(points, cacheSegmentLengths);
  const pointProgresses = measurement.distances.map((distanceAlongTrail) =>
    measurement.totalLength > 0
      ? distanceAlongTrail / measurement.totalLength
      : 0);
  const segmentProgresses = new Array(Math.max(0, points.length - 1));

  for (let index = 1; index < points.length; index++)
  {
    segmentProgresses[index - 1] = measurement.totalLength > 0
      ? (measurement.distances[index - 1] + measurement.distances[index]) *
        0.5 / measurement.totalLength
      : 0;
  }

  const coverageKeys = trailCfg.coverageLongitudinalKeys;
  const pointCoverageFactors = pointProgresses.map((progress) =>
    evaluateTrailLongitudinalCoverage(coverageKeys, progress));
  const segmentCoverageFactors = segmentProgresses.map((progress) =>
    evaluateTrailLongitudinalCoverage(coverageKeys, progress));
  const sharedData =
  {
    measurement,
    pointProgresses,
    segmentProgresses,
    pointCoverageFactors,
    segmentCoverageFactors,
  };

  if (materialIntensity === null)
  {
    return sharedData;
  }

  const pointEnergies = [];
  const pointTransverseProfiles = new Array(points.length);
  const pointCoverageProfiles = new Array(points.length);
  const segmentEnergies = [];
  const segmentMaximumEnergies = [];
  const segmentTransverseProfiles = [];
  const segmentCoverageProfiles = [];
  const textureLongitudinalKeys = trailCfg.textureLongitudinalKeys;

  if (measurement.totalLength <= 0)
  {
    return {
      ...sharedData,
      pointEnergies,
      pointTransverseProfiles,
      pointCoverageProfiles,
      segmentEnergies,
      segmentMaximumEnergies,
      segmentTransverseProfiles,
      segmentCoverageProfiles,
      textureLongitudinalKeys,
    };
  }

  for (let index = 0; index < points.length; index++)
  {
    const progress = pointProgresses[index];

    pointEnergies.push(
      evaluateTrailLinearEnergy(
        progress,
        trailCfg,
        materialIntensity,
        textureLongitudinalKeys,
      ),
    );
  }

  for (let index = 1; index < points.length; index++)
  {
    const progress = segmentProgresses[index - 1];
    const energy = evaluateTrailLinearEnergy(
      progress,
      trailCfg,
      materialIntensity,
      textureLongitudinalKeys,
    );

    segmentEnergies.push(energy);
    // Bloom 的量化裁剪仍使用原规则，但必须覆盖端点插值的峰值。
    segmentMaximumEnergies.push(
      Math.max(
        ...pointEnergies[index - 1],
        ...energy,
        ...pointEnergies[index],
      ),
    );
    segmentTransverseProfiles.push(
      evaluateTrailTransverseProfile(
        progress,
        trailCfg,
        textureLongitudinalKeys,
      ),
    );
    segmentCoverageProfiles.push(
      evaluateTrailTextureCoverageProfile(progress),
    );
  }

  return {
    ...sharedData,
    pointEnergies,
    pointTransverseProfiles,
    pointCoverageProfiles,
    segmentEnergies,
    segmentMaximumEnergies,
    segmentTransverseProfiles,
    segmentCoverageProfiles,
    textureLongitudinalKeys,
  };
}

function evaluateTrailLinearEnergy(
  progress,
  trailCfg,
  materialIntensity,
  textureLongitudinalKeys = trailCfg.textureLongitudinalKeys,
)
{
  const textureIntensity = evaluateNumber(
    textureLongitudinalKeys,
    progress,
  );
  const materialColor = evaluateTrailMaterialColor(
    progress,
    trailCfg,
    materialIntensity,
  );

  // 原 Shader 先将线性顶点色与已解码的 Stretch 纹理相乘，再施加 _Intensity。
  return materialColor.map((channel) => channel * textureIntensity);
}

function evaluateTrailMaterialColor(progress, trailCfg, materialIntensity)
{
  // Gradient 已按网页的旧点到新点顺序反转；纹理 U 的反向由 WebGL 顶点处理。
  return colorToLinearEnergy(
    interpolateTrailColor(progress, trailCfg),
    materialIntensity,
  );
}

function evaluateTrailTransverseProfile(
  progress,
  trailCfg,
  textureLongitudinalKeys = trailCfg.textureLongitudinalKeys,
)
{
  const keys = trailCfg.textureTransverseProfileKeys;

  if (!Array.isArray(keys) || keys.length === 0)
  {
    return [[0, 1], [1, 1]];
  }

  const t = clamp01(progress);
  let previous = keys[0];
  let current = keys[0];
  let localProgress = 0;

  for (let index = 1; index < keys.length; index++)
  {
    current = keys[index];

    if (t <= current[0])
    {
      previous = keys[index - 1];
      const span = current[0] - previous[0];

      localProgress = span > 0 ? (t - previous[0]) / span : 1;
      break;
    }

    previous = current;
    localProgress = 0;
  }

  const previousCenter = evaluateNumber(
    textureLongitudinalKeys,
    previous[0],
  );
  const currentCenter = evaluateNumber(
    textureLongitudinalKeys,
    current[0],
  );
  const interpolatedCenter = evaluateNumber(
    textureLongitudinalKeys,
    t,
  );
  const centerToEdge = previous[1].map((value, index) =>
  {
    const previousEnergy = value * previousCenter;
    const currentEnergy = current[1][index] * currentCenter;
    const absoluteEnergy = lerp(
      previousEnergy,
      currentEnergy,
      clamp01(localProgress),
    );

    // 分别插值绝对纹理能量，最后再恢复相对中心值，等价于二维双线性采样。
    return interpolatedCenter > 0.0000001
      ? clamp01(absoluteEnergy / interpolatedCenter)
      : 0;
  });
  const edgeIndex = centerToEdge.length - 1;
  const profile = [];

  for (let index = edgeIndex; index >= 0; index--)
  {
    profile.push(
      [
        (edgeIndex - index) / (edgeIndex * 2),
        centerToEdge[index],
      ],
    );
  }

  for (let index = 1; index <= edgeIndex; index++)
  {
    profile.push(
      [
        0.5 + index / (edgeIndex * 2),
        centerToEdge[index],
      ],
    );
  }

  return profile;
}

function createTrailMesh(
  points,
  width,
  numCornerVertices = 0,
  numCapVertices = 0,
  segmentLengths = null,
)
{
  const halfWidth = Math.max(0, width) * 0.5;
  const segments = new Array(points.length).fill(null);
  const caps = [];

  if (halfWidth <= 0)
  {
    return { segments, caps };
  }

  for (let index = 1; index < points.length; index++)
  {
    const from = points[index - 1];
    const to = points[index];
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    // 弧长测量已计算同一段长度；复用原值可保持累计距离与网格完全一致。
    const length = segmentLengths?.[index] ?? Math.hypot(deltaX, deltaY);

    if (length <= MIN_TRAIL_SEGMENT_LENGTH)
    {
      continue;
    }

    const tangent = { x: deltaX / length, y: deltaY / length };
    const normal = { x: -tangent.y, y: tangent.x };
    const offsetX = normal.x * halfWidth;
    const offsetY = normal.y * halfWidth;

    segments[index] =
    {
      index,
      from,
      to,
      length,
      tangent,
      normal,
      fromLeft: { x: from.x + offsetX, y: from.y + offsetY },
      fromRight: { x: from.x - offsetX, y: from.y - offsetY },
      toLeft: { x: to.x + offsetX, y: to.y + offsetY },
      toRight: { x: to.x - offsetX, y: to.y - offsetY },
    };
  }

  const cornerVertexCount = Math.max(0, Math.floor(numCornerVertices));

  for (let pointIndex = 1; pointIndex < points.length - 1; pointIndex++)
  {
    const previous = segments[pointIndex];
    const next = segments[pointIndex + 1];

    if (!previous || !next)
    {
      continue;
    }

    const turn = previous.tangent.x * next.tangent.y -
      previous.tangent.y * next.tangent.x;
    const directionDot = previous.tangent.x * next.tangent.x +
      previous.tangent.y * next.tangent.y;

    if (Math.abs(turn) <= 0.000001)
    {
      // 直线自然共享截面；精确折返没有稳定内角，保留独立边界。
      continue;
    }

    const point = points[pointIndex];
    const innerSign = turn > 0 ? 1 : -1;
    const outerSign = -innerSign;
    const previousInner =
    {
      x: point.x + previous.normal.x * halfWidth * innerSign,
      y: point.y + previous.normal.y * halfWidth * innerSign,
    };
    const nextInner =
    {
      x: point.x + next.normal.x * halfWidth * innerSign,
      y: point.y + next.normal.y * halfWidth * innerSign,
    };
    const innerScale = (
      (nextInner.x - previousInner.x) * next.tangent.y -
      (nextInner.y - previousInner.y) * next.tangent.x
    ) / turn;
    const inner =
    {
      x: previousInner.x + previous.tangent.x * innerScale,
      y: previousInner.y + previous.tangent.y * innerScale,
    };
    const innerDistance = Math.hypot(
      inner.x - point.x,
      inner.y - point.y,
    );
    const previousProjection =
      (inner.x - point.x) * previous.tangent.x +
      (inner.y - point.y) * previous.tangent.y;
    const nextProjection =
      (inner.x - point.x) * next.tangent.x +
      (inner.y - point.y) * next.tangent.y;

    if (
      !Number.isFinite(innerDistance) ||
      innerDistance > halfWidth * MAX_TRAIL_INNER_MITER_RATIO ||
      previousProjection < -previous.length - 0.000001 ||
      previousProjection > 0.000001 ||
      nextProjection < -0.000001 ||
      nextProjection > next.length + 0.000001
    )
    {
      // 无穷 miter 或超出短段的交点会使轮廓回折自交，此时保留独立截面。
      continue;
    }

    const turnAngle = Math.atan2(turn, directionDot);
    const outerStartAngle = Math.atan2(
      previous.normal.y * outerSign,
      previous.normal.x * outerSign,
    );
    const arcStepCount = cornerVertexCount + 1;
    const outerArc = [];

    for (let step = 0; step <= arcStepCount; step++)
    {
      const angle = outerStartAngle + turnAngle * step / arcStepCount;

      outerArc.push(
        {
          x: point.x + Math.cos(angle) * halfWidth,
          y: point.y + Math.sin(angle) * halfWidth,
        },
      );
    }

    if (innerSign > 0)
    {
      previous.toLeft = inner;
      next.fromLeft = inner;
      previous.toRight = outerArc[0];
      next.fromRight = outerArc.at(-1);
    }
    else
    {
      previous.toRight = inner;
      next.fromRight = inner;
      previous.toLeft = outerArc[0];
      next.fromLeft = outerArc.at(-1);
    }

    // Unity 的数量表示端点间的插入点；记在前一段上可合并等价 fan 轮廓。
    previous.endJoin =
    {
      nextSegmentIndex: next.index,
      inner,
      innerSide: innerSign > 0 ? 'left' : 'right',
      outerArc,
    };
  }

  if (Math.floor(numCapVertices) > 0)
  {
    const first = segments.find((segment) => segment);
    let last = null;

    for (let index = segments.length - 1; index >= 1; index--)
    {
      if (segments[index])
      {
        last = segments[index];
        break;
      }
    }

    if (first)
    {
      caps.push(
        {
          position: 'start',
          segmentIndex: first.index,
          pointIndex: first.index - 1,
          points:
          [
            first.fromLeft,
            first.fromRight,
            {
              x: first.from.x - first.tangent.x * halfWidth,
              y: first.from.y - first.tangent.y * halfWidth,
            },
          ],
        },
      );
    }

    if (last)
    {
      caps.push(
        {
          position: 'end',
          segmentIndex: last.index,
          pointIndex: last.index,
          points:
          [
            last.toLeft,
            {
              x: last.to.x + last.tangent.x * halfWidth,
              y: last.to.y + last.tangent.y * halfWidth,
            },
            last.toRight,
          ],
        },
      );
    }
  }

  return { segments, caps };
}

function getTrailMesh(trailData, points, width, trailCfg)
{
  if (!trailData.meshCache)
  {
    trailData.meshCache = new Map();
  }

  const cornerVertices = Math.max(
    0,
    Math.floor(trailCfg.numCornerVertices ?? 0),
  );
  const capVertices = Math.max(
    0,
    Math.floor(trailCfg.numCapVertices ?? 0),
  );
  const cacheKey = `${width}:${cornerVertices}:${capVertices}`;

  if (!trailData.meshCache.has(cacheKey))
  {
    trailData.meshCache.set(
      cacheKey,
      createTrailMesh(
        points,
        width,
        cornerVertices,
        capVertices,
        trailData.measurement.segmentLengths,
      ),
    );
  }

  return trailData.meshCache.get(cacheKey);
}

function resolveTrailTransverseProfile(profile)
{
  return Array.isArray(profile) && profile.length >= 2
    ? profile
    : [[0, 1], [1, 1]];
}

function createTrailCrossSectionGradient(
  context,
  from,
  to,
  transverseProfile,
  colorAtIntensity,
)
{
  const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);

  for (const [position, intensity] of resolveTrailTransverseProfile(
    transverseProfile,
  ))
  {
    gradient.addColorStop(
      clamp01(position),
      colorAtIntensity(intensity, position),
    );
  }

  return gradient;
}

function fillTrailMeshSegment(
  context,
  segment,
  endJoin,
  transverseProfile,
  colorAtIntensity,
)
{
  const gradient = createTrailCrossSectionGradient(
    context,
    segment.fromLeft,
    segment.fromRight,
    transverseProfile,
    colorAtIntensity,
  );

  // CanvasGradient 只有一个插值轴；使用段中点能量保留横截面，避免每段拆成 16 次填充。
  context.beginPath();
  context.moveTo(segment.fromLeft.x, segment.fromLeft.y);

  if (!endJoin)
  {
    context.lineTo(segment.toLeft.x, segment.toLeft.y);
    context.lineTo(segment.toRight.x, segment.toRight.y);
  }
  else if (endJoin.innerSide === 'left')
  {
    context.lineTo(endJoin.inner.x, endJoin.inner.y);

    for (let index = endJoin.outerArc.length - 1; index >= 0; index--)
    {
      const point = endJoin.outerArc[index];

      context.lineTo(point.x, point.y);
    }
  }
  else
  {
    for (const point of endJoin.outerArc)
    {
      context.lineTo(point.x, point.y);
    }

    context.lineTo(endJoin.inner.x, endJoin.inner.y);
  }

  // fan 与前一段共享一条边，将外轮廓并入同一路径不会改变覆盖区域。
  context.lineTo(segment.fromRight.x, segment.fromRight.y);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();
}

function fillTrailMeshCap(
  context,
  cap,
  transverseProfile,
  colorAtIntensity,
)
{
  const left = cap.points[0];
  const right = cap.position === 'start' ? cap.points[1] : cap.points[2];
  const gradient = createTrailCrossSectionGradient(
    context,
    left,
    right,
    transverseProfile,
    colorAtIntensity,
  );

  context.beginPath();
  context.moveTo(cap.points[0].x, cap.points[0].y);
  context.lineTo(cap.points[1].x, cap.points[1].y);
  context.lineTo(cap.points[2].x, cap.points[2].y);
  context.closePath();
  // numCapVertices=1 对应三角端帽，端点颜色不能复用段中点。
  context.fillStyle = gradient;
  context.fill();
}

function resolveTrailPointEnergy(
  trailData,
  pointIndex,
  trailCfg,
  materialIntensity,
)
{
  if (trailData.pointEnergies?.[pointIndex])
  {
    return trailData.pointEnergies[pointIndex];
  }

  return evaluateTrailLinearEnergy(
    trailData.measurement.distances[pointIndex] /
      trailData.measurement.totalLength,
    trailCfg,
    materialIntensity,
  );
}

function resolveTrailPointTransverseProfile(
  trailData,
  pointIndex,
  trailCfg,
)
{
  const profiles = trailData.pointTransverseProfiles;

  if (profiles?.[pointIndex])
  {
    return profiles[pointIndex];
  }

  const profile = evaluateTrailTransverseProfile(
    trailData.measurement.distances[pointIndex] /
      trailData.measurement.totalLength,
    trailCfg,
    trailData.textureLongitudinalKeys,
  );

  // 端帽可能被 Native 与清晰层重复使用；按实际点索引只求值一次。
  if (profiles)
  {
    profiles[pointIndex] = profile;
  }

  return profile;
}

function resolveTrailPointCoverageFactor(trailData, pointIndex, trailCfg)
{
  const cached = trailData.pointCoverageFactors?.[pointIndex];

  if (Number.isFinite(cached))
  {
    return cached;
  }

  const progress = trailData.pointProgresses?.[pointIndex] ??
    trailData.measurement.distances[pointIndex] /
      trailData.measurement.totalLength;

  return evaluateTrailLongitudinalCoverage(
    trailCfg.coverageLongitudinalKeys,
    progress,
  );
}

function resolveTrailPointCoverageProfile(trailData, pointIndex)
{
  const profiles = trailData.pointCoverageProfiles;

  if (profiles?.[pointIndex])
  {
    return profiles[pointIndex];
  }

  const progress = trailData.pointProgresses?.[pointIndex] ??
    trailData.measurement.distances[pointIndex] /
      trailData.measurement.totalLength;
  const profile = evaluateTrailTextureCoverageProfile(progress);

  if (profiles)
  {
    profiles[pointIndex] = profile;
  }

  return profile;
}

function drawTrailLayer(
  context,
  points,
  trailData,
  scale,
  opacity,
  trailCfg,
  layer,
  segmentStart = 1,
  segmentEnd = points.length - 1,
)
{
  const measurement = trailData.measurement;

  if (measurement.totalLength <= 0)
  {
    return;
  }

  context.save();
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  const width = layer.scaledWidth ?? layer.width * scale;
  const mesh = getTrailMesh(trailData, points, width, trailCfg);
  const firstSegment = clamp(
    Math.floor(segmentStart),
    1,
    points.length - 1,
  );
  const lastSegment = clamp(
    Math.floor(segmentEnd),
    firstSegment,
    points.length - 1,
  );
  const resolveCss = layer.colorAtIntensity ??
    ((color, intensity, textureCoverage, longitudinalCoverage) =>
    {
      const contribution = layer.alpha * opacity * intensity;
      const coverage = layer.alpha * opacity * textureCoverage *
        longitudinalCoverage;

      return layer.outputCompositing === 'browser-overlay'
        ? linearEnergyToOverlayCss(
            color,
            contribution,
            coverage,
            layer.overlayColorCompensation,
            layer.overlayAlphaLimit,
            layer.globalOpacity ?? opacity,
          )
        : layer.outputCompositing === 'host-additive'
          ? linearEnergyToHostAdditiveCss(
              color,
              contribution,
              coverage,
            )
          : linearEnergyToAdditiveCss(color, contribution);
    });

  for (let index = firstSegment; index <= lastSegment; index++)
  {
    const segment = mesh.segments[index];

    if (!segment)
    {
      continue;
    }

    const progress = (
      measurement.distances[index - 1] + measurement.distances[index]
    ) * 0.5 / measurement.totalLength;
    const color = trailData.segmentEnergies?.[index - 1] ??
      evaluateTrailLinearEnergy(
        progress,
        trailCfg,
        layer.materialIntensity,
      );
    const transverseProfile =
      trailData.segmentTransverseProfiles?.[index - 1] ??
        evaluateTrailTransverseProfile(progress, trailCfg);
    const coverageProfile =
      trailData.segmentCoverageProfiles?.[index - 1] ??
        evaluateTrailTextureCoverageProfile(progress);
    const longitudinalCoverage =
      trailData.segmentCoverageFactors?.[index - 1] ??
        evaluateTrailLongitudinalCoverage(
          trailCfg.coverageLongitudinalKeys,
          progress,
        );

    fillTrailMeshSegment(
      context,
      segment,
      segment.endJoin?.nextSegmentIndex <= lastSegment
        ? segment.endJoin
        : null,
      transverseProfile,
      (intensity, position) => resolveCss(
        color,
        intensity,
        evaluateNumber(coverageProfile, position),
        longitudinalCoverage,
      ),
    );
  }

  for (const cap of mesh.caps)
  {
    if (
      cap.segmentIndex < firstSegment ||
      cap.segmentIndex > lastSegment
    )
    {
      continue;
    }

    const color = resolveTrailPointEnergy(
      trailData,
      cap.pointIndex,
      trailCfg,
      layer.materialIntensity,
    );
    const transverseProfile = resolveTrailPointTransverseProfile(
      trailData,
      cap.pointIndex,
      trailCfg,
    );
    const coverageProfile = resolveTrailPointCoverageProfile(
      trailData,
      cap.pointIndex,
    );
    const longitudinalCoverage = resolveTrailPointCoverageFactor(
      trailData,
      cap.pointIndex,
      trailCfg,
    );

    fillTrailMeshCap(
      context,
      cap,
      transverseProfile,
      (intensity, position) => resolveCss(
        color,
        intensity,
        evaluateNumber(coverageProfile, position),
        longitudinalCoverage,
      ),
    );
  }

  context.restore();
}

function hasPositiveTrailEnergy(energy)
{
  return Array.isArray(energy) && energy.some((channel) => channel > 0);
}

function hasDrawableNativeTrailEnergy(trailData, trailCfg)
{
  const segmentLengths = trailData.measurement.segmentLengths;
  const segmentEnergies = trailData.segmentEnergies;

  if (
    !segmentLengths ||
    !Array.isArray(segmentEnergies) ||
    segmentLengths.length !== segmentEnergies.length + 1
  )
  {
    // 缓存不完整时无法证明透明，继续绘制以兼容外部传入的帧数据。
    return true;
  }

  let startCapPointIndex = null;
  let endCapPointIndex = null;

  for (let index = 1; index < segmentLengths.length; index++)
  {
    if (segmentLengths[index] <= MIN_TRAIL_SEGMENT_LENGTH)
    {
      continue;
    }

    if (startCapPointIndex === null)
    {
      startCapPointIndex = index - 1;
    }

    endCapPointIndex = index;
    const energy = segmentEnergies[index - 1];

    if (!Array.isArray(energy) || hasPositiveTrailEnergy(energy))
    {
      return true;
    }
  }

  if (
    startCapPointIndex === null ||
    !(Math.floor(trailCfg.numCapVertices ?? 0) > 0)
  )
  {
    return false;
  }

  const startCapEnergy = trailData.pointEnergies?.[startCapPointIndex];
  const endCapEnergy = trailData.pointEnergies?.[endCapPointIndex];

  if (!Array.isArray(startCapEnergy) || !Array.isArray(endCapEnergy))
  {
    // 端帽可按需求值；缺少缓存时必须保守保留 Native 绘制。
    return true;
  }

  // 端帽绑定到首尾真实网格段，退化短段对应的全局端点不会参与绘制。
  return hasPositiveTrailEnergy(startCapEnergy) ||
    hasPositiveTrailEnergy(endCapEnergy);
}

/**
 * 将按真实弧长着色的发射带绘入局部缓冲，再整体模糊一次。
 * 不能使用首尾弦线性渐变：回环轨迹会把暗尾投影到高亮区，产生异常光晕。
 */
function drawNativeTrailBloom(
  context,
  points,
  trailData,
  scale,
  opacity,
  trailCfg,
  bloomCfg,
  surface,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const measurement = trailData.measurement;

  if (
    measurement.totalLength <= 0 ||
    opacity <= 0 ||
    bloomCfg.trailAlpha <= 0 ||
    bloomCfg.trailEmission <= 0 ||
    typeof context.filter !== 'string' ||
    !surface?.context ||
    !hasDrawableNativeTrailEnergy(trailData, trailCfg)
  )
  {
    return;
  }

  // 只裁剪 Unity Stretch 的零能量前缀；宿主自定义可见 start cap 时保留完整范围。
  const firstVisibleSegmentOffset = trailData.segmentEnergies.findIndex(
    (energy) => energy.some((channel) => channel !== 0),
  );
  const startCapIsTransparent = trailData.pointEnergies[0]?.every(
    (channel) => channel === 0,
  ) === true;
  const firstVisibleSegment =
    startCapIsTransparent && firstVisibleSegmentOffset >= 0
      ? firstVisibleSegmentOffset + 1
      : 1;
  const blurRadius = Math.max(0, trailCfg.outerGlowWidth * scale);
  const halfWidth = Math.max(0.5, trailCfg.geometryWidth * scale * 0.5);
  const margin = Math.ceil(blurRadius * 3 + halfWidth + 2);
  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;
  const firstBoundPointIndex = firstVisibleSegment - 1;

  // 首个可见段仍需要前一个端点；更早的零能量点不应扩大局部模糊缓冲。
  for (let index = firstBoundPointIndex; index < points.length; index++)
  {
    const point = points[index];

    minimumX = Math.min(minimumX, point.x);
    minimumY = Math.min(minimumY, point.y);
    maximumX = Math.max(maximumX, point.x);
    maximumY = Math.max(maximumY, point.y);
  }

  const originX = Math.floor(minimumX - margin);
  const originY = Math.floor(minimumY - margin);
  const regionWidth = Math.max(1, Math.ceil(maximumX + margin) - originX);
  const regionHeight = Math.max(1, Math.ceil(maximumY + margin) - originY);
  const dpr = Math.max(1, surface.dpr || 1);
  const requiredWidth = Math.max(1, Math.ceil(regionWidth * dpr));
  const requiredHeight = Math.max(1, Math.ceil(regionHeight * dpr));
  const canvas = surface.canvas;
  const bufferContext = surface.context;
  const capacityWidth = Math.max(
    canvas.width,
    2 ** Math.ceil(Math.log2(requiredWidth)),
  );
  const capacityHeight = Math.max(
    canvas.height,
    2 ** Math.ceil(Math.log2(requiredHeight)),
  );

  if (canvas.width !== capacityWidth || canvas.height !== capacityHeight)
  {
    canvas.width = capacityWidth;
    canvas.height = capacityHeight;
  }

  bufferContext.setTransform(1, 0, 0, 1, 0, 0);
  bufferContext.clearRect(0, 0, requiredWidth, requiredHeight);
  bufferContext.setTransform(
    dpr,
    0,
    0,
    dpr,
    -originX * dpr,
    -originY * dpr,
  );
  bufferContext.globalCompositeOperation = 'lighter';
  bufferContext.filter = 'none';
  drawTrailLayer(
    bufferContext,
    points,
    trailData,
    scale,
    opacity,
    trailCfg,
    {
      width: trailCfg.geometryWidth,
      materialIntensity: bloomCfg.trailEmission,
      colorAtIntensity: (
        color,
        intensity,
        textureCoverage,
        longitudinalCoverage,
      ) =>
        linearEnergyToNativeTrailBloomCss(
          color,
          opacity,
          intensity,
          bloomCfg,
          outputCompositing,
          opacity * textureCoverage * longitudinalCoverage,
          overlayColorCompensation,
          overlayAlphaLimit,
        ),
    },
    firstVisibleSegment,
  );

  context.save();
  // Canvas filter 的 px 位于输出位图空间，不会随主 Context 的 DPR 变换放大。
  context.filter = `blur(${blurRadius * dpr}px)`;
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  context.drawImage(
    canvas,
    0,
    0,
    requiredWidth,
    requiredHeight,
    originX,
    originY,
    regionWidth,
    regionHeight,
  );
  context.restore();
}

/**
 * main 分支风格的拖尾层：普通 Canvas 使用 sRGB，Final Pass 使用线性能量。
 * layer.color 为固定颜色时整条一次描边（round cap）；
 * 无 color 时按路径距离采样 gradient（butt cap 逐段）。
 */
function drawTrail(
  context,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  useNativeBloom = true,
  nativeBloomSurface = null,
  sharedTrailData = null,
  linearOutput = false,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const trailCfg = fxConfig.trail;
  const bloomCfg = fxConfig.bloom;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1.0);
  const trailData = sharedTrailData ?? createTrailFrameData(
    points,
    trailCfg,
    bloomCfg.trailEmission,
  );

  if (useNativeBloom)
  {
    drawNativeTrailBloom(
      context,
      points,
      trailData,
      scale,
      trailOpacity,
      trailCfg,
      bloomCfg,
      nativeBloomSurface,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
  }

  // Unity 只绘制一条 2px HDR 几何带；可见宽度由后续 Bloom 自然扩张。
  drawTrailLayer(context, points, trailData, scale, trailOpacity, trailCfg,
    {
      width: trailCfg.width,
      alpha: 1,
      materialIntensity: bloomCfg.trailEmission,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    },
  );
}

function drawTrailCoverage(
  context,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  sharedTrailData = null,
  segmentStart = 1,
  segmentEnd = points.length - 1,
)
{
  const trailCfg = fxConfig.trail;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1);
  const trailData = sharedTrailData ?? createTrailFrameData(
    points,
    trailCfg,
    1,
  );

  if (trailData.measurement.totalLength <= 0 || trailOpacity <= 0)
  {
    return;
  }

  drawTrailLayer(
    context,
    points,
    trailData,
    scale,
    1,
    trailCfg,
    {
      width: trailCfg.width,
      // Additive Shader 的目标 Alpha 固定为 1；透明适配层只保留实际
      // TrailRenderer 几何与全局透明度，不混入材质 HDR 发射倍率。
      colorAtIntensity: (
        _color,
        _intensity,
        textureCoverage,
        longitudinalCoverage,
      ) => `rgba(255, 255, 255, ${clamp01(
        trailOpacity * textureCoverage * longitudinalCoverage,
      )})`,
    },
    segmentStart,
    segmentEnd,
  );
}

function drawTrailEmission(
  context,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  sharedTrailData = null,
  segmentStart = 1,
  segmentEnd = points.length - 1,
)
{
  const trailCfg = fxConfig.trail;
  const bloomCfg = fxConfig.bloom;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1.0) *
    bloomCfg.trailEmissionAlpha;
  const trailData = sharedTrailData ?? createTrailFrameData(
    points,
    trailCfg,
    bloomCfg.trailEmission,
  );
  const measurement = trailData.measurement;

  if (measurement.totalLength <= 0 || trailOpacity <= 0)
  {
    return;
  }

  const width = Math.max(
    0.5,
    trailCfg.geometryWidth * scale * bloomCfg.trailCoverageScale,
  );

  const firstSegment = clamp(
    Math.floor(segmentStart),
    1,
    points.length - 1,
  );
  const lastSegment = clamp(
    Math.floor(segmentEnd),
    firstSegment,
    points.length - 1,
  );

  drawTrailLayer(
    context,
    points,
    trailData,
    scale,
    1,
    trailCfg,
    {
      scaledWidth: width,
      alpha: 1,
      materialIntensity: bloomCfg.trailEmission,
      colorAtIntensity: (color, intensity) =>
        linearEnergyToEmissionCss(
          color,
          trailOpacity * intensity,
          bloomCfg.emissionRange,
        ),
    },
    firstSegment,
    lastSegment,
  );
}

function createTexturedTrailVertex(point, u, v)
{
  return {
    x: point.x,
    y: point.y,
    u,
    v,
  };
}

function appendTexturedTrailMeshSegment(
  renderer,
  segment,
  fromSample,
  toSample,
  opacity,
)
{
  // Unity BakeMesh 的屏幕下侧为语义 V=0；嵌入字节保持 PNG 顶行优先，
  // WebGL typed-array 上传不会代替图片源翻行，因此下侧需补偿到采样 v=1。
  const fromLeft = createTexturedTrailVertex(
    segment.fromLeft,
    fromSample.u,
    1,
  );
  const fromRight = createTexturedTrailVertex(
    segment.fromRight,
    fromSample.u,
    0,
  );
  const toLeft = createTexturedTrailVertex(
    segment.toLeft,
    toSample.u,
    1,
  );
  const toRight = createTexturedTrailVertex(
    segment.toRight,
    toSample.u,
    0,
  );

  renderer.addTexturedTrailTriangle(
    fromLeft,
    toLeft,
    toRight,
    [fromSample.color, toSample.color, toSample.color],
    opacity,
    [fromSample.coverage, toSample.coverage, toSample.coverage],
  );
  renderer.addTexturedTrailTriangle(
    fromLeft,
    toRight,
    fromRight,
    [fromSample.color, toSample.color, fromSample.color],
    opacity,
    [fromSample.coverage, toSample.coverage, fromSample.coverage],
  );
}

function appendTexturedTrailMeshJoin(
  renderer,
  join,
  sample,
  opacity,
)
{
  const innerV = join.innerSide === 'left' ? 1 : 0;
  const outerV = 1 - innerV;
  const inner = createTexturedTrailVertex(join.inner, sample.u, innerV);

  for (let arcIndex = 1; arcIndex < join.outerArc.length; arcIndex++)
  {
    const previousOuter = createTexturedTrailVertex(
      join.outerArc[arcIndex - 1],
      sample.u,
      outerV,
    );
    const nextOuter = createTexturedTrailVertex(
      join.outerArc[arcIndex],
      sample.u,
      outerV,
    );

    // Unity 的圆角插入点只细分几何；同一折点的 Stretch U 必须保持不变。
    renderer.addTexturedTrailTriangle(
      inner,
      previousOuter,
      nextOuter,
      sample.color,
      opacity,
      sample.coverage,
    );
  }
}

function appendTexturedTrailMeshCaps(
  renderer,
  mesh,
  visibleSegments,
  pointSamples,
  opacity,
)
{
  for (const cap of mesh.caps)
  {
    if (!visibleSegments.has(cap.segmentIndex))
    {
      continue;
    }

    const sample = pointSamples[cap.pointIndex];
    const vCoordinates = cap.position === 'start'
      ? [1, 0, 0.5]
      : [1, 0.5, 0];
    const vertices = cap.points.map((point, index) =>
      createTexturedTrailVertex(point, sample.u, vCoordinates[index]));

    // numCapVertices=1 形成一个三角端帽；尖端位于纹理横截面中心。
    renderer.addTexturedTrailTriangle(
      vertices[0],
      vertices[1],
      vertices[2],
      sample.color,
      opacity,
      sample.coverage,
    );
  }
}

function appendTexturedTrailMeshJoins(
  renderer,
  mesh,
  visibleSegments,
  pointSamples,
  opacity,
)
{
  for (let segmentIndex = 1; segmentIndex < mesh.segments.length; segmentIndex++)
  {
    const join = mesh.segments[segmentIndex]?.endJoin;

    if (
      !join ||
      !visibleSegments.has(segmentIndex) ||
      !visibleSegments.has(join.nextSegmentIndex)
    )
    {
      continue;
    }

    appendTexturedTrailMeshJoin(
      renderer,
      join,
      pointSamples[segmentIndex],
      opacity,
    );
  }
}

function appendTrailWebGLScene(
  renderer,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  sharedTrailData = null,
)
{
  const trailCfg = fxConfig.trail;
  const bloomCfg = fxConfig.bloom;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1);
  const trailData = sharedTrailData ?? createTrailFrameData(
    points,
    trailCfg,
    bloomCfg.trailEmission,
  );
  const width = trailCfg.width * scale;

  if (
    trailData.measurement.totalLength <= 0 ||
    trailOpacity <= 0 ||
    width <= 0
  )
  {
    return;
  }

  const mesh = getTrailMesh(trailData, points, width, trailCfg);
  const visibleSegments = new Set();
  const pointSamples = new Array(points.length);

  for (let index = 0; index < points.length; index++)
  {
    const progress = trailData.pointProgresses?.[index] ??
      trailData.measurement.distances[index] /
        trailData.measurement.totalLength;

    pointSamples[index] =
    {
      // Unity TrailRenderer 的 U=0 位于最新点，而项目点序是旧点到新点。
      u: 1 - progress,
      color: evaluateTrailMaterialColor(
        progress,
        trailCfg,
        bloomCfg.trailEmission,
      ),
      coverage: resolveTrailPointCoverageFactor(
        trailData,
        index,
        trailCfg,
      ),
    };
  }

  for (let index = 1; index < points.length; index++)
  {
    const segment = mesh.segments[index];

    if (!segment)
    {
      continue;
    }

    visibleSegments.add(index);
    appendTexturedTrailMeshSegment(
      renderer,
      segment,
      pointSamples[index - 1],
      pointSamples[index],
      trailOpacity,
    );
  }

  appendTexturedTrailMeshJoins(
    renderer,
    mesh,
    visibleSegments,
    pointSamples,
    trailOpacity,
  );
  appendTexturedTrailMeshCaps(
    renderer,
    mesh,
    visibleSegments,
    pointSamples,
    trailOpacity,
  );
}

function appendTrailWebGLBloom(
  renderer,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  sharedTrailData = null,
)
{
  const trailCfg = fxConfig.trail;
  const bloomCfg = fxConfig.bloom;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1.0) *
    bloomCfg.trailEmissionAlpha;
  const trailData = sharedTrailData ?? createTrailFrameData(
    points,
    trailCfg,
    bloomCfg.trailEmission,
  );

  if (trailData.measurement.totalLength <= 0 || trailOpacity <= 0)
  {
    return;
  }

  const width = Math.max(
    0.5,
    trailCfg.geometryWidth * scale * bloomCfg.trailCoverageScale,
  );
  const emissionQuantizationScale = trailOpacity /
    Math.max(1, bloomCfg.emissionRange) * 255;

  for (let index = 1; index < points.length; index++)
  {
    // Software 参考实现先经过 8-bit Canvas 发射遮罩；保留相同的半量化裁剪，
    // 避免 WebGL2 在轨迹尾端额外显示参考实现中不存在的微弱光晕。
    if (
      trailData.segmentMaximumEnergies[index - 1] *
        emissionQuantizationScale < 0.5
    )
    {
      continue;
    }

    const energy = trailData.segmentEnergies[index - 1];

    renderer.addTrailSegment(
      points[index - 1],
      points[index],
      width,
      energy,
      trailOpacity,
      trailData.segmentTransverseProfiles[index - 1],
    );
  }
}

export class BAClickFX
{
  /**
   * @param {object} [options]
   * @param {string|HTMLElement|OffscreenCanvas} [options.target]
   * @param {number} [options.scale]
   * @param {number} [options.opacity]
   * @param {string} [options.themeColor]
   * @param {'hue-only'|'relative-oklch'} [options.themeColorMode]
   * @param {boolean} [options.clickEnabled]
   * @param {boolean} [options.trailEnabled]
   * @param {boolean} [options.trailAlways]
   * @param {'dom'|'manual'} [options.inputSource]
   * @param {number} [options.inputSamplingRate]
   * @param {number} [options.clickTimeScale]
   * @param {number} [options.trailTimeScale]
   * @param {'scene'|'browser-overlay'} [options.outputCompositing]
   * @param {'coverage'|'visual-max'} [options.overlayAlphaPolicy]
   * @param {'none'|'bright-core'} [options.overlayColorCompensation]
   * @param {number} [options.overlayAlphaLimit]
   * @param {'source-over'|'screen'|'plus-lighter'} [options.hostCompositing]
   * @param {'dom-backdrop'|'transparent-window'|'native'} [options.hostCompositingSurface]
   * @param {'canvas2d'|'webgl2'|'webgpu'|'auto'} [options.effectBackend]
   * @param {boolean} [options.webgpuPreferHdr]
   * @param {number} [options.webgpuHdrPeak]
   * @param {number} [options.webgpuHdrBrightness]
   * @param {number} [options.webgpuHdrColorPreservation]
   * @param {number} [options.webgpuHdrWhiteCore]
   * @param {number} [options.webgpuHdrWhiteStart]
   * @param {number} [options.webgpuHdrWhiteEnd]
   * @param {'auto'|'software'|'webgl2'|'native'} [options.bloomBackend]
   * @param {boolean} [options.isolatedCompositing]
   * @param {number} [options.lightBackgroundContrastAlpha]
   * @param {number} [options.maxDpr]
   * @param {string} [options.touchAction]
   * @param {(event: PointerEvent) => boolean} [options.inputFilter]
   */
  constructor(options = {})
  {
    assertConfigOverrides(options, { allowInstanceOptions: true });
    const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
    const hasOffscreen = typeof OffscreenCanvas !== 'undefined';

    if (!hasDom && !hasOffscreen)
    {
      throw new Error('BAClickFX 需要浏览器 DOM 或 Web Worker (OffscreenCanvas) 环境');
    }

    if (!hasDom && !isOffscreenCanvas(options.target))
    {
      throw new Error('BAClickFX 在 Worker 中需要显式传入 OffscreenCanvas target');
    }

    const { target: _target, inputFilter: _inputFilter, ...configOptions } = options;

    this.config = createConfig(configOptions);
    this.inputFilter = typeof options.inputFilter === 'function'
      ? options.inputFilter
      : null;
    this.host = resolveTarget(options.target);
    this.ownsCanvas = !isCanvas(this.host);
    if (!this.ownsCanvas)
    {
      // 已有 Canvas 无法承载主层、Bloom 层和对比层组成的独立合成组。
      this.config.isolatedCompositing = false;
    }
    this.canvas = isCanvas(this.host) ? this.host : createCanvas();
    this.contrastCanvas = this.ownsCanvas ? createCanvas() : null;
    this.webglBloomCanvas = null;
    this.webglBloomRenderer = null;
    this.webglBloomUnavailable = false;
    this.webglBloomVisible = false;
    this.webglEffectCanvas = null;
    this.webglEffectRenderer = null;
    this.webglEffectUnavailable = false;
    this.webglEffectVisible = false;
    this.webgpuEffectCanvas = null;
    this.webgpuEffectRenderer = null;
    this.webgpuEffectUnavailable = false;
    this.webgpuEffectVisible = false;
    this.canvasSceneCanvas = null;
    this.canvasSceneRenderer = null;
    this.canvasSceneUnavailable = false;
    this.canvasSceneVisible = false;
    this.compositingReferenceSource = null;
    this.compositingReferenceFit = 'cover';
    this.compositingMountPending = false;
    this.hostCompositingState = this._resolveHostCompositingState();

    if (!this.canvas)
    {
      throw new Error('BAClickFX 找不到 target');
    }

    if (this.ownsCanvas)
    {
      const parent = this.host ?? document.body;

      this.overlayMountParent = parent;
      this.overlayRoot = createOverlayRoot(!this.host);

      // 粒子与 Bloom 已在各后端内部完成加色；最终覆盖层统一使用普通
      // source-over，避免 CSS plus-lighter 再次抬高桌面亮度。
      setOverlayStyle(this.canvas, false, '2147483646', '');
      setOverlayStyle(this.contrastCanvas, false, '2147483647', 'darken');

      this._applyCompositingMount();
    }
    else
    {
      this.overlayMountParent = null;
      this.overlayRoot = null;
      this.overlayParent = null;
      this._applyCompositingMount();
    }

    if (this.canvas.style)
    {
      this.canvas.style.touchAction = this.config.touchAction;
    }
    const isDirectOffscreen = isOffscreenCanvas(this.canvas);
    const requiresCanvas2D = !isDirectOffscreen ||
      this.config.effectBackend === 'canvas2d';

    // Canvas 上下文类型一旦确定便不能切换；GPU 模式必须把首次请求留给 WebGL2。
    this.context = requiresCanvas2D ? this.canvas.getContext('2d') : null;
    this.contrastContext = this.contrastCanvas?.getContext('2d') ?? null;

    if (!this.context && requiresCanvas2D)
    {
      throw new Error('BAClickFX 无法创建 Canvas 2D 上下文');
    }

    // 内部 Canvas 仅承担发射遮罩和 ImageData 暂存，不会插入 DOM。
    this.bloomRenderer = new SoftwareBloomRenderer(() => createCanvas());
    this.bloomRenderers = [this.bloomRenderer];
    // WebGL Scene 延迟到首帧创建；能力尚未探测时必须报告 pending，
    // 避免宿主先收到一次并不存在的 Canvas2D 回退。
    this.resolvedEffectBackend = this._getRequestedEffectBackendState();
    this.resolvedBloomBackend = this._getRequestedBloomBackendState();
    this.softwareBloomFrameStats = {
      regionCount: 0,
      processedSourcePixels: 0,
      combinedBoundsPixels: 0,
    };
    // Canvas 回读在同一渲染时刻失败时，保留上一张已经完成的 Bloom 输出。
    // 它只用于相同输入的过渡帧，避免故障瞬间把透明拖尾降成细线。
    this.lastSoftwareBloomFrame = null;
    // visual-max 必须保留独立 Bloom transport；该离屏层按需创建，不进入 DOM。
    this.canvasBloomTransportCanvas = null;
    this.canvasBloomTransportContext = null;
    this.canvasNativeSceneAlphaSnapshot = null;
    this.webglBloomFrameStats =
    {
      available: false,
      vertexCount: 0,
      levelCount: 0,
      bloomPixels: 0,
    };
    this.nativeTrailBloomSurface = undefined;

    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.fxConfig = structuredClone(UNITY_FX_TOUCH);
    this._themeHueShift = computeThemeHueShift(this.config.themeColor);
    this._relativeOklchTheme = this.config.themeColorMode === 'relative-oklch'
      ? createRelativeOklchTheme(this.config.themeColor)
      : null;
    this.waves = [];
    this.shards = [];
    this.trailStrokes = [];
    this.currentTrailStroke = null;
    this.activeTrailOwnerId = null;
    this.nextTrailOwnerId = 1;
    this.trailShardCounts = new Map();
    this.activePointerId = null;
    this.activePointerSource = null;
    // 仅由 Touch-only fallback 写入；兜底结束事件不能误释放手动指针。
    this.fallbackTouchPointerId = null;
    this.lastPointerPosition = null;
    this.lastPointerTime = 0;
    // 输入采样率使用未缩放的 source time，不能复用拖尾虚拟时钟。
    this.lastInputSampleSourceTime = null;
    this.trailDistanceSinceShard = 0;
    this.touchGestureStarts = new Map();
    this.touchPointerFilterResults = [];
    this.closedShadowPointerDecisions = new WeakMap();
    this.usesTouchInputFallback = shouldUseTouchInputFallback();
    this.touchActionListenersAttached = false;
    this.closedShadowTouchListenersAttached = false;
    const initialTimeSource = performance.now();

    this.clickTimeMs = 0;
    this.trailTimeMs = 0;
    this.lastClickTimeSource = initialTimeSource;
    this.lastTrailTimeSource = initialTimeSource;
    this.animationFrame = null;
    this.lastFrameTime = null;
    this.renderingFrame = false;
    this.paused = false;
    this.destroyed = false;
    this.domPointerListenersAttached = false;

    // 浏览器事件和 ResizeObserver 都会传入参数，不能让它们进入公开尺寸覆盖值。
    this._onResize = () => this._resize();
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onPointerCancel = this._handlePointerCancel.bind(this);
    this._onClosedShadowPointerDown =
      this._handleClosedShadowPointerDown.bind(this);
    this._onTouchStart = this._handleTouchStart.bind(this);
    this._onTouchMove = this._handleTouchMove.bind(this);
    this._onTouchEnd = this._handleTouchEnd.bind(this);
    this._onBlur = this._cancelPointer.bind(this);
    this._onFrame = this._renderFrame.bind(this);
    this._onWebGLContextLost = this._handleWebGLContextLost.bind(this);
    this._onWebGLContextRestored = this._handleWebGLContextRestored.bind(this);
    this._onWebGLEffectContextLost =
      this._handleWebGLEffectContextLost.bind(this);
    this._onWebGLEffectContextRestored =
      this._handleWebGLEffectContextRestored.bind(this);
    this._onCanvasSceneContextLost =
      this._handleCanvasSceneContextLost.bind(this);
    this._onCanvasSceneContextRestored =
      this._handleCanvasSceneContextRestored.bind(this);

    this._resize();
    if (
      isDirectOffscreen &&
      !requiresCanvas2D &&
      !this._prepareWebGLEffectBackend()
    )
    {
      // getContext('webgl2') 返回 null 时画布仍可回退 2D；若 WebGL2 已经
      // 锁定但完整 Scene 初始化失败，则必须让宿主换一张画布重建实例。
      this.context = this.canvas.getContext('2d');
      if (!this.context)
      {
        if (this.animationFrame !== null)
        {
          cancelRenderFrame(this.animationFrame);
          this.animationFrame = null;
        }
        throw new Error(
          'BAClickFX 无法在 OffscreenCanvas 上初始化 WebGL2；请使用新的画布并显式选择 Canvas2D',
        );
      }
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    // OffscreenCanvas 的首次 context 请求决定其终身类型；记录实际结果，
    // 防止后续配置把可用实例切换到无法创建的另一种 context。
    this._directOffscreenContextType = isDirectOffscreen
      ? this.context
        ? '2d'
        : 'webgl2'
      : null;
    if (typeof window !== 'undefined')
    {
      window.addEventListener('resize', this._onResize);
    }
    if (this.config.inputSource === 'dom' && typeof window !== 'undefined')
    {
      this._attachDomPointerListeners();
    }
    if (typeof window !== 'undefined')
    {
      window.addEventListener('blur', this._onBlur);
    }

    if (this.host && !isCanvas(this.host) && typeof ResizeObserver !== 'undefined')
    {
      this.resizeObserver = new ResizeObserver(this._onResize);
      this.resizeObserver.observe(this.host);
    }
    else
    {
      this.resizeObserver = null;
    }
  }

  _attachDomPointerListeners()
  {
    if (this.domPointerListenersAttached)
    {
      return;
    }

    if (!this.usesTouchInputFallback)
    {
      // 页面控件可能在目标阶段停止冒泡；输入采样必须先于宿主事件处理。
      window.addEventListener('pointerdown', this._onPointerDown,
        { capture: true });
      window.addEventListener('pointermove', this._onPointerMove,
        {
          capture: true,
          passive: true,
        });
      window.addEventListener('pointerup', this._onPointerUp,
        {
          capture: true,
        });
      window.addEventListener('pointercancel', this._onPointerCancel,
        {
          capture: true,
        });
    }
    this.domPointerListenersAttached = true;
    this._syncTouchActionListeners();
  }

  _attachTouchActionListeners()
  {
    if (this.touchActionListenersAttached)
    {
      return;
    }

    window.addEventListener('touchstart', this._onTouchStart,
      {
        capture: true,
        passive: false,
      });
    window.addEventListener('touchmove', this._onTouchMove,
      {
        // Canvas 不参与命中测试时，只有非 passive Touch Event 才能在
        // 浏览器接管滚动前兑现 touchAction 的禁止方向。
        capture: true,
        passive: false,
      });
    window.addEventListener('touchend', this._onTouchEnd,
      {
        capture: true,
        passive: true,
      });
    window.addEventListener('touchcancel', this._onTouchEnd,
      {
        capture: true,
        passive: true,
      });
    const hostInClosedShadowRoot = this._isHostInClosedShadowRoot();

    if (hostInClosedShadowRoot && !this.usesTouchInputFallback)
    {
      // Window 侧看不到 closed ShadowRoot 的内部 target；先在真实作用域
      // 内记录同一个 PointerEvent 的过滤决定，窗口监听随后复用。
      this.host.addEventListener(
        'pointerdown',
        this._onClosedShadowPointerDown,
        { capture: true },
      );
    }

    if (hostInClosedShadowRoot &&
      typeof this.host?.addEventListener === 'function')
    {
      // closed Shadow 外部看不到真实 Touch target；不论是否支持
      // PointerEvent，都必须在内部作用域完成方向仲裁和 fallback 转发。
      this.host.addEventListener('touchstart', this._onTouchStart,
        {
          capture: true,
          passive: false,
        });
      this.host.addEventListener('touchmove', this._onTouchMove,
        {
          capture: true,
          passive: false,
        });
      this.host.addEventListener('touchend', this._onTouchEnd,
        {
          capture: true,
          passive: true,
        });
      this.host.addEventListener('touchcancel', this._onTouchEnd,
        {
          capture: true,
          passive: true,
        });
      this.closedShadowTouchListenersAttached = true;
    }
    this.touchActionListenersAttached = true;
  }

  _detachTouchActionListeners()
  {
    if (!this.touchActionListenersAttached)
    {
      this.touchGestureStarts.clear();
      this.touchPointerFilterResults.length = 0;
      this.closedShadowPointerDecisions = new WeakMap();
      this.closedShadowTouchListenersAttached = false;
      return;
    }

    if (typeof window !== 'undefined')
    {
      window.removeEventListener('touchstart', this._onTouchStart, true);
      window.removeEventListener('touchmove', this._onTouchMove, true);
      window.removeEventListener('touchend', this._onTouchEnd, true);
      window.removeEventListener('touchcancel', this._onTouchEnd, true);
    }
    if (this.closedShadowTouchListenersAttached)
    {
      this.host?.removeEventListener?.('touchstart', this._onTouchStart, true);
      this.host?.removeEventListener?.('touchmove', this._onTouchMove, true);
      this.host?.removeEventListener?.('touchend', this._onTouchEnd, true);
      this.host?.removeEventListener?.('touchcancel', this._onTouchEnd, true);
      this.closedShadowTouchListenersAttached = false;
    }
    this.host?.removeEventListener?.(
      'pointerdown',
      this._onClosedShadowPointerDown,
      true,
    );
    this.touchGestureStarts.clear();
    this.touchPointerFilterResults.length = 0;
    this.closedShadowPointerDecisions = new WeakMap();
    this.touchActionListenersAttached = false;
  }

  _syncTouchActionListeners()
  {
    const shouldAttach = this.domPointerListenersAttached &&
      (
        this.usesTouchInputFallback ||
        createTouchActionPolicy(this.config.touchAction).requiresShim
      );

    if (shouldAttach)
    {
      this._attachTouchActionListeners();
    }
    else
    {
      this._detachTouchActionListeners();
    }
  }

  _detachDomPointerListeners()
  {
    if (!this.domPointerListenersAttached)
    {
      return;
    }

    this._detachTouchActionListeners();
    if (typeof window !== 'undefined')
    {
      if (!this.usesTouchInputFallback)
      {
        window.removeEventListener('pointerdown', this._onPointerDown, true);
        window.removeEventListener('pointermove', this._onPointerMove, true);
      }
      window.removeEventListener('pointerup', this._onPointerUp, true);
      window.removeEventListener('pointercancel', this._onPointerCancel, true);
    }
    this.domPointerListenersAttached = false;
  }

  _touchTargetsMatch(event, left, right)
  {
    if (!left || !right || left === right)
    {
      return true;
    }

    const path = typeof event.composedPath === 'function'
      ? event.composedPath()
      : [];

    return path.includes(left) && path.includes(right);
  }

  _touchInputsMatch(event, input, clientX, clientY, target)
  {
    const eventTargetsMatch = input.eventTarget && event.target &&
      input.eventTarget === event.target;

    return Math.abs(input.clientX - clientX) <= TOUCH_INPUT_MATCH_TOLERANCE &&
      Math.abs(input.clientY - clientY) <= TOUCH_INPUT_MATCH_TOLERANCE &&
      (
        eventTargetsMatch ||
        this._touchTargetsMatch(event, input.target, target)
      );
  }

  _rememberTouchPointerFilterResult(
    event,
    accepted,
    filterAccepted = accepted,
  )
  {
    this.touchPointerFilterResults.push(
      {
        accepted,
        clientX: event.clientX,
        clientY: event.clientY,
        createdAt: performance.now(),
        eventTarget: event.target,
        filterAccepted,
        target: event.target,
      },
    );

    if (this.touchPointerFilterResults.length > 8)
    {
      this.touchPointerFilterResults.shift();
    }
  }

  _consumeTouchPointerFilterResult(event, touch)
  {
    const now = performance.now();
    const target = touch.target ?? event.target;

    for (let index = this.touchPointerFilterResults.length - 1; index >= 0; index--)
    {
      const result = this.touchPointerFilterResults[index];

      if (now - result.createdAt > TOUCH_FILTER_CACHE_MS)
      {
        this.touchPointerFilterResults.splice(index, 1);
        continue;
      }

      if (!this._touchInputsMatch(
        event,
        result,
        touch.clientX,
        touch.clientY,
        target,
      ))
      {
        continue;
      }

      this.touchPointerFilterResults.splice(index, 1);
      return result;
    }

    return undefined;
  }

  _consumeTouchGestureState(event)
  {
    for (const state of this.touchGestureStarts.values())
    {
      if (
        state.pointerDecisionConsumed ||
        !this._touchInputsMatch(
          event,
          state,
          event.clientX,
          event.clientY,
          event.target,
        )
      )
      {
        continue;
      }

      state.pointerDecisionConsumed = true;
      return state;
    }

    return null;
  }

  _isTouchEventInScope(event, touchTarget = null)
  {
    if (!this.host)
    {
      return true;
    }

    const target = touchTarget ?? event.target;

    if (
      target === this.host ||
      (
        target &&
        typeof this.host.contains === 'function' &&
        this.host.contains(target)
      )
    )
    {
      return true;
    }

    const path = typeof event.composedPath === 'function'
      ? event.composedPath()
      : [];

    return path.includes(this.host);
  }

  _isClosedShadowWindowTouchEvent(event)
  {
    if (!this._isHostInClosedShadowRoot())
    {
      return false;
    }

    // 真实 DOM 会提供 currentTarget；测试夹具的简化 EventTarget 不会，
    // 此时只有 scope 失败的 window 目标才应视作重定向事件。
    const isWindowDispatch = event.currentTarget === undefined ||
      event.currentTarget === (typeof window !== 'undefined' ? window : null);

    return isWindowDispatch &&
      !this._isTouchEventInScope(event, event.target);
  }

  _isHostInClosedShadowRoot()
  {
    let node = this.host;

    // Window 会跨过 open ShadowRoot，但任意外层 closed 边界都会隐藏真实
    // Pointer target，因此必须沿宿主链检查，而不只检查最近的一层。
    while (typeof node?.getRootNode === 'function')
    {
      const root = node.getRootNode();

      if (!root?.host)
      {
        return false;
      }

      if (root.mode === 'closed')
      {
        return true;
      }

      node = root.host;
    }

    return false;
  }

  _handleClosedShadowPointerDown(event)
  {
    if (
      this.destroyed ||
      this.paused ||
      event.pointerType !== 'touch'
    )
    {
      return;
    }

    const accepted = !this.inputFilter || this.inputFilter(event);

    this.closedShadowPointerDecisions.set(event, accepted);
    // Window capture 先于 closed Shadow 内部 target；在真实作用域内立即
    // 完成启动，随后不再依赖被重定向 target 的窗口冒泡阶段。
    this._handlePointerDown(event);
  }

  _createTouchPointerEvent(
    event,
    touch,
    type = 'pointermove',
    isPrimary = null,
  )
  {
    const target = touch.target ?? event.target;
    const activeTouches = event.touches ?? event.changedTouches;
    const primaryTouchIdentifier = activeTouches?.[0]?.identifier;
    const resolvedIsPrimary = isPrimary === null
      ? touch.identifier === primaryTouchIdentifier
      : isPrimary === true;
    const pageX = Number.isFinite(touch.pageX)
      ? touch.pageX
      : touch.clientX + (typeof window !== 'undefined' ? (window.pageXOffset || 0) : 0);
    const pageY = Number.isFinite(touch.pageY)
      ? touch.pageY
      : touch.clientY + (typeof window !== 'undefined' ? (window.pageYOffset || 0) : 0);

    return {
      type,
      target,
      currentTarget: event.currentTarget ?? (typeof window !== 'undefined' ? window : null),
      pointerId: touch.identifier,
      pointerType: 'touch',
      isPrimary: resolvedIsPrimary,
      button: type === 'pointermove' ? -1 : 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: touch.clientX,
      clientY: touch.clientY,
      pageX,
      pageY,
      screenX: touch.screenX ?? touch.clientX,
      screenY: touch.screenY ?? touch.clientY,
      width: touch.radiusX ? touch.radiusX * 2 : 1,
      height: touch.radiusY ? touch.radiusY * 2 : 1,
      pressure: Number.isFinite(touch.force) ? touch.force : 0.5,
      timeStamp: event.timeStamp,
      cancelable: event.cancelable ?? false,
      defaultPrevented: event.defaultPrevented ?? false,
      composedPath: typeof event.composedPath === 'function'
        ? event.composedPath.bind(event)
        : () => [],
      preventDefault: () => event.preventDefault?.(),
      stopPropagation: () => event.stopPropagation?.(),
      stopImmediatePropagation: () => event.stopImmediatePropagation?.(),
    };
  }

  _acceptTouchStart(event, touch, isPrimary = null)
  {
    const target = touch.target ?? event.target;
    const pointerFilterResult = this._consumeTouchPointerFilterResult(
      event,
      touch,
    );

    if (!this._isTouchEventInScope(event, target))
    {
      return {
        accepted: false,
        filterAccepted: false,
        isPrimary,
        pointerDecisionConsumed: false,
        pointerFilterPending: false,
        target,
      };
    }

    if (pointerFilterResult !== undefined)
    {
      const accepted = pointerFilterResult.accepted;
      const filterAccepted = pointerFilterResult.filterAccepted ?? accepted;

      return {
        accepted,
        filterAccepted,
        isPrimary,
        pointerDecisionConsumed: true,
        pointerFilterPending: false,
        target,
      };
    }

    if (this.usesTouchInputFallback && this.inputFilter)
    {
      // Touch-only 宿主没有后续 PointerEvent 可回填过滤结果；使用同一组
      // 坐标和 target 构造 pointer-like 事件，保持 inputFilter 合同。
      const accepted = this.inputFilter(
        this._createTouchPointerEvent(
          event,
          touch,
          'pointerdown',
          isPrimary,
        ),
      );

      return {
        accepted,
        filterAccepted: accepted,
        isPrimary,
        pointerDecisionConsumed: true,
        pointerFilterPending: false,
        target,
      };
    }

    if (!this.inputFilter)
    {
      return {
        accepted: true,
        filterAccepted: true,
        isPrimary,
        pointerDecisionConsumed: false,
        pointerFilterPending: false,
        target,
      };
    }

    // Pointer 与 Touch 的先后顺序因浏览器而异。Touch 先到时暂不伪造
    // PointerEvent；由随后的真实 pointerdown 完成过滤并回填本次手势。
    return {
      accepted: false,
      filterAccepted: false,
      isPrimary,
      pointerDecisionConsumed: false,
      pointerFilterPending: true,
      target,
    };
  }

  _handleTouchStart(event)
  {
    if (
      this.destroyed ||
      this.paused
    )
    {
      return;
    }

    if (this._isClosedShadowWindowTouchEvent(event))
    {
      return;
    }

    const touches = event.changedTouches;
    const policy = createTouchActionPolicy(this.config.touchAction);
    const activeTouches = event.touches ?? touches;
    const primaryTouchIdentifier = activeTouches?.[0]?.identifier;

    for (let index = 0; index < (touches?.length ?? 0); index++)
    {
      const touch = touches[index];
      const isPrimary = touch.identifier === primaryTouchIdentifier;
      const acceptance = this._acceptTouchStart(event, touch, isPrimary);

      this.touchGestureStarts.set(
        touch.identifier,
        {
          ...acceptance,
          clientX: touch.clientX,
          clientY: touch.clientY,
          eventTarget: event.target,
          filterAccepted: acceptance.filterAccepted ?? acceptance.accepted,
          isPrimary,
          policy,
          preventDefault: null,
          x: touch.clientX,
          y: touch.clientY,
        },
      );

      if (this.usesTouchInputFallback && acceptance.filterAccepted)
      {
        const started = this._startDomPointer(
          this._createTouchPointerEvent(
            event,
            touch,
            'pointerdown',
            isPrimary,
          ),
        );
        const state = this.touchGestureStarts.get(touch.identifier);

        // 单活动指针限制可能拒绝第二根手指；Touch 仲裁必须跟随实际
        // pointerDown 结果，否则会错误阻止宿主的多指手势。
        if (state)
        {
          state.accepted = started;
          state.pointerFilterPending = false;

          if (started)
          {
            this.fallbackTouchPointerId = touch.identifier;
          }
        }
      }
    }

    // none 已经在 touchstart 阶段确定不会让浏览器接管手势；提前阻止
    // 默认行为可避免部分移动浏览器在首个 touchmove 前抢先发送 pointercancel。
    if (policy.blockAll && event.cancelable)
    {
      const accepted = Array.from(this.touchGestureStarts.values())
        .some((state) => state.accepted);

      if (accepted)
      {
        event.preventDefault();
      }
    }
  }

  _getAcceptedTouchCount(event)
  {
    const touches = event.touches ?? event.changedTouches;
    let count = 0;

    for (let index = 0; index < (touches?.length ?? 0); index++)
    {
      if (this.touchGestureStarts.get(touches[index].identifier)?.filterAccepted)
      {
        count++;
      }
    }

    return count;
  }

  _isTouchDirectionAllowed(policy, axis, delta)
  {
    if (axis === 'x')
    {
      if (!policy.allowX)
      {
        return false;
      }

      return policy.xDirections.has(
        delta < 0
          ? TOUCH_ACTION_DIRECTIONS.negative
          : TOUCH_ACTION_DIRECTIONS.positive,
      );
    }

    if (!policy.allowY)
    {
      return false;
    }

    return policy.yDirections.has(
      delta < 0
        ? TOUCH_ACTION_DIRECTIONS.negative
        : TOUCH_ACTION_DIRECTIONS.positive,
    );
  }

  _shouldPreventTouchMove(state, touch, acceptedTouchCount)
  {
    const policy = state.policy;

    if (policy.blockAll)
    {
      return true;
    }

    if (acceptedTouchCount > 1)
    {
      return !policy.allowPinch;
    }

    if (state.preventDefault !== null)
    {
      return state.preventDefault;
    }

    const deltaX = touch.clientX - state.x;
    const deltaY = touch.clientY - state.y;
    const absoluteX = Math.abs(deltaX);
    const absoluteY = Math.abs(deltaY);

    if (Math.max(absoluteX, absoluteY) < TOUCH_DIRECTION_THRESHOLD)
    {
      return false;
    }

    if (!policy.allowX && !policy.allowY)
    {
      state.preventDefault = true;
      return true;
    }

    if (absoluteX === absoluteY)
    {
      return false;
    }

    const axis = absoluteX > absoluteY ? 'x' : 'y';
    const delta = axis === 'x' ? deltaX : deltaY;

    // 与 CSS touch-action 一样，首次可判定方向后锁定本次手势；后续
    // 折返不能重新开启浏览器滚动并触发迟到的 pointercancel。
    state.preventDefault = !this._isTouchDirectionAllowed(
      policy,
      axis,
      delta,
    );
    return state.preventDefault;
  }

  _handleTouchMove(event)
  {
    if (this.destroyed || this.paused)
    {
      return;
    }

    if (this._isClosedShadowWindowTouchEvent(event))
    {
      return;
    }

    const touches = event.changedTouches;
    let shouldPreventDefault = false;

    if (event.cancelable)
    {
      const acceptedTouchCount = this._getAcceptedTouchCount(event);

      for (let index = 0; index < (touches?.length ?? 0); index++)
      {
        const touch = touches[index];
        const start = this.touchGestureStarts.get(touch.identifier);

        if (!start?.accepted)
        {
          continue;
        }

        shouldPreventDefault = this._shouldPreventTouchMove(
          start,
          touch,
          acceptedTouchCount,
        );

        if (shouldPreventDefault)
        {
          break;
        }
      }
    }

    if (this.usesTouchInputFallback)
    {
      const sourceNow = performance.now();
      const trailNow = this._getTrailInputTime(sourceNow);
      const sampleSourceTime = this._getDomInputSourceTime(
        event.timeStamp,
        sourceNow,
      );
      const sampleTime = this._getDomTrailSampleTime(
        sampleSourceTime,
        sourceNow,
        trailNow,
      );

      for (let index = 0; index < (touches?.length ?? 0); index++)
      {
        const touch = touches[index];
        const state = this.touchGestureStarts.get(touch.identifier);

        if (!state?.accepted)
        {
          continue;
        }

        this._pointerMoveAtTime(
          this._getDomPointerInput(
            this._createTouchPointerEvent(
              event,
              touch,
              'pointermove',
              state.isPrimary,
            ),
          ),
          sampleTime,
          sampleSourceTime,
        );
      }
    }

    if (shouldPreventDefault && event.cancelable)
    {
      event.preventDefault();
    }
  }

  _handleTouchEnd(event)
  {
    if (this._isClosedShadowWindowTouchEvent(event))
    {
      return;
    }

    const touches = event.changedTouches;
    const pointerType = event.type === 'touchcancel'
      ? 'pointercancel'
      : 'pointerup';

    for (let index = 0; index < (touches?.length ?? 0); index++)
    {
      const touch = touches[index];
      const state = this.touchGestureStarts.get(touch.identifier);

      if (this.usesTouchInputFallback && state?.accepted)
      {
        const pointerEvent = this._createTouchPointerEvent(
          event,
          touch,
          pointerType,
          state.isPrimary,
        );

        if (pointerType === 'pointercancel')
        {
          this.pointerCancel(pointerEvent.pointerId);
        }
        else
        {
          this.pointerUp(pointerEvent.pointerId);
        }

        if (this.fallbackTouchPointerId === pointerEvent.pointerId)
        {
          this.fallbackTouchPointerId = null;
        }
      }

      this.touchGestureStarts.delete(touch.identifier);
    }

    if (event.touches?.length === 0)
    {
      const fallbackPointerId = this.fallbackTouchPointerId;

      if (
        this.usesTouchInputFallback &&
        fallbackPointerId !== null &&
        this.activePointerId === fallbackPointerId &&
        this.activePointerSource === 'press'
      )
      {
        if (pointerType === 'pointercancel')
        {
          this.pointerCancel(fallbackPointerId);
        }
        else
        {
          this.pointerUp(fallbackPointerId);
        }
      }

      this.fallbackTouchPointerId = null;

      this.touchGestureStarts.clear();
      this.touchPointerFilterResults.length = 0;
    }
  }

  _getOverlayLayers()
  {
    return [
      this.canvas,
      this.webglBloomCanvas,
      this.webglEffectCanvas,
      this.webgpuEffectCanvas,
      this.canvasSceneCanvas,
      this.contrastCanvas,
    ]
      .filter(Boolean);
  }

  _hasActiveCompositingReference()
  {
    if (this.compositingReferenceSource === null)
    {
      return false;
    }

    return (
      this.webgpuEffectVisible &&
      this.webgpuEffectRenderer?.hasSceneBackground === true
    ) || (
      this.webglEffectVisible &&
      this.webglEffectRenderer?.hasSceneBackground === true
    ) || (
      this.webglBloomVisible &&
      this.webglBloomRenderer?.hasSceneBackground === true
    ) || (
      this.canvasSceneVisible &&
      this.canvasSceneRenderer?.hasSceneBackground === true
    );
  }

  _usesUnknownBrowserOverlay()
  {
    return this.config.outputCompositing === 'browser-overlay' &&
      !this._hasActiveCompositingReference();
  }

  _usesIndependentHostPayload()
  {
    return isIndependentHostCompositing(
      this._getEffectiveHostCompositing(),
    );
  }

  _getEffectiveHostCompositing()
  {
    return this._resolveHostCompositingState().resolvedHostCompositing;
  }

  getEffectiveHostCompositing()
  {
    return this._getEffectiveHostCompositing();
  }

  _resolveHostCompositingState()
  {
    const resolution = resolveHostCompositing(
      {
        outputCompositing: this.config.outputCompositing,
        requestedHostCompositing: this.config.hostCompositing,
        hostCompositingSurface: this.config.hostCompositingSurface,
        hasCompositingReference: this._hasActiveCompositingReference(),
      },
    );

    return {
      requestedHostCompositing: this.config.hostCompositing,
      hostCompositingSurface: this.config.hostCompositingSurface,
      ...resolution,
    };
  }

  _syncHostCompositingState()
  {
    const previous = this.hostCompositingState;
    const next = this._resolveHostCompositingState();
    const unchanged = previous &&
      previous.requestedHostCompositing === next.requestedHostCompositing &&
      previous.resolvedHostCompositing === next.resolvedHostCompositing &&
      previous.hostCompositingSurface === next.hostCompositingSurface &&
      previous.compositingWarning === next.compositingWarning;

    this.hostCompositingState = next;

    if (
      unchanged ||
      typeof CustomEvent !== 'function' ||
      typeof this.canvas?.dispatchEvent !== 'function'
    )
    {
      return;
    }

    try
    {
      this.canvas.dispatchEvent(
        new CustomEvent(
          HOST_COMPOSITING_CHANGE_EVENT,
          { detail: { ...next } },
        ),
      );
    }
    catch
    {
      // 状态通知不能中断渲染；旧 DOM 环境仍可通过 getConfig() 查询。
    }
  }

  _getCanvasOutputCompositing()
  {
    // 独立宿主混合需要完整发射载荷，但普通 Canvas 没有 Scene Final Pass；
    // 内部合同先完成 sRGB 编码，避免 Linear 数值被 CSS 当作 sRGB。
    return this._usesIndependentHostPayload()
      ? 'host-additive'
      : this.config.outputCompositing;
  }

  _getOverlayColorCompensation()
  {
    return this._usesUnknownBrowserOverlay() &&
      !this._usesIndependentHostPayload()
      ? this.config.overlayColorCompensation
      : 'none';
  }

  _getOverlayAlphaPolicy()
  {
    return this._usesUnknownBrowserOverlay() &&
      !this._usesIndependentHostPayload()
      ? this.config.overlayAlphaPolicy
      : 'coverage';
  }

  _requestCompositingMountRefresh()
  {
    this._syncHostCompositingState();

    // 只要还有可见对象，就必须让当前像素先按新合同重绘，再改变根节点
    // 的混合模式；否则暂停帧或 Context 回退会被错误的 CSS 重新解释。
    if (this._hasVisibleEffects())
    {
      this.compositingMountPending = true;
      return;
    }

    this.compositingMountPending = false;
    this._applyCompositingMount();
  }

  _flushCompositingMountRefresh()
  {
    if (!this.compositingMountPending)
    {
      return;
    }

    this.compositingMountPending = false;
    this._applyCompositingMount();
  }

  _applyCompositingMount()
  {
    const hostIndependent = this._usesIndependentHostPayload();
    const usesDomBackdrop = this.config.hostCompositingSurface ===
      'dom-backdrop';

    if (!this.ownsCanvas)
    {
      // 外部 Canvas 的样式归调用方所有。渲染器仍按 hostCompositing 输出
      // 完整独立载荷，但 CSS、WebView 或原生宿主的混合由调用方执行。
      return;
    }

    if (!this.overlayMountParent || !this.overlayRoot)
    {
      return;
    }

    const isolated = this.config.isolatedCompositing;
    const grouped = isolated || hostIndependent;
    const parent = grouped ? this.overlayRoot : this.overlayMountParent;

    // 子层先按普通 source-over 解析；宿主混合只允许在完整组上执行一次。
    this.overlayRoot.style.mixBlendMode = hostIndependent && usesDomBackdrop
      ? this._getEffectiveHostCompositing()
      : '';

    for (const canvas of this._getOverlayLayers())
    {
      const contrastBlend = canvas === this.contrastCanvas &&
        !hostIndependent;

      canvas.style.mixBlendMode = contrastBlend
        ? 'darken'
        : '';
    }

    if (grouped)
    {
      this.overlayMountParent.appendChild(this.overlayRoot);
    }

    for (const canvas of this._getOverlayLayers())
    {
      // 直接合成时恢复旧版 fixed/absolute 定位；隔离组内一律相对根层铺满。
      canvas.style.position = grouped || this.host ? 'absolute' : 'fixed';
      parent.appendChild(canvas);
    }

    if (!grouped)
    {
      this.overlayRoot.remove();
    }

    this.overlayParent = parent;
  }

  _createFxParamResetBaseline()
  {
    return structuredClone(UNITY_FX_TOUCH);
  }

  _commitFxParamConfig(nextConfig)
  {
    // 活动 ClickWave 持有配置根对象引用；保留根身份才能让运行时调参
    // 同时作用于已经生成的点击，而候选树仍保证校验阶段不泄露半成品。
    for (const key of Object.keys(this.fxConfig))
    {
      delete this.fxConfig[key];
    }

    Object.assign(this.fxConfig, nextConfig);
  }

  resize(width, height, dpr)
  {
    this._resize(width, height, dpr);
  }

  _resize(overrideWidth, overrideHeight, overrideDpr)
  {
    if (this.destroyed)
    {
      return;
    }

    const rect = this._getCanvasRect();
    const defaultWidth = typeof window !== 'undefined' ? window.innerWidth : this.canvas?.width;
    const defaultHeight = typeof window !== 'undefined' ? window.innerHeight : this.canvas?.height;
    const defaultDpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const measuredWidth = resolvePositiveFinite(rect.width, resolvePositiveFinite(defaultWidth, 1));
    const measuredHeight = resolvePositiveFinite(rect.height, resolvePositiveFinite(defaultHeight, 1));
    const width = resolvePositiveFinite(overrideWidth, measuredWidth);
    const height = resolvePositiveFinite(overrideHeight, measuredHeight);
    const dpr = Math.min(
      resolvePositiveFinite(overrideDpr, resolvePositiveFinite(defaultDpr, 1)),
      this.config.maxDpr,
    );

    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    if (this.context)
    {
      this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (this.contrastCanvas && this.contrastContext)
    {
      this.contrastCanvas.width = this.canvas.width;
      this.contrastCanvas.height = this.canvas.height;
      this.contrastContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // WebGL RenderTarget 可能很大，只在真正进入 WebGL 渲染帧时调整，
    // 避免 Software 或 Native 模式因窗口 resize 触发无用 GPU 分配。
    this._requestRender();
  }

  _getCanvasRect()
  {
    if (this.host && !isCanvas(this.host) && typeof this.host.getBoundingClientRect === 'function')
    {
      return this.host.getBoundingClientRect();
    }

    if (typeof this.canvas?.getBoundingClientRect === 'function')
    {
      return this.canvas.getBoundingClientRect();
    }

    return {
      left: 0,
      top: 0,
      width: this.canvas?.width || 0,
      height: this.canvas?.height || 0,
    };
  }

  _getPointerPosition(event)
  {
    const rect = this._getCanvasRect();

    return {
      x: clamp(event.clientX - rect.left, 0, this.width),
      y: clamp(event.clientY - rect.top, 0, this.height),
    };
  }

  _normalizePointerInput(input)
  {
    if (
      !input ||
      !Number.isFinite(input.x) ||
      !Number.isFinite(input.y) ||
      (input.pointerId !== undefined && !Number.isFinite(input.pointerId)) ||
      (
        input.pointerType !== undefined &&
        input.pointerType !== 'mouse' &&
        input.pointerType !== 'touch' &&
        input.pointerType !== 'pen'
      )
    )
    {
      return null;
    }

    return {
      x: clamp(input.x, 0, this.width),
      y: clamp(input.y, 0, this.height),
      pointerId: input.pointerId ?? 1,
      pointerType: input.pointerType ?? 'mouse',
    };
  }

  _getDomPointerInput(event, fallbackEvent = event)
  {
    const position = this._getPointerPosition(event);
    const pointerType = event.pointerType || fallbackEvent.pointerType || 'mouse';

    return {
      ...position,
      pointerId: event.pointerId ?? fallbackEvent.pointerId ?? 1,
      pointerType,
    };
  }

  _getDomInputSourceTime(timeStamp, sourceNow)
  {
    if (!Number.isFinite(timeStamp) || timeStamp <= 0)
    {
      return sourceNow;
    }

    let sampleSourceTime = timeStamp;

    if (
      sampleSourceTime > sourceNow + 1000 &&
      Number.isFinite(performance.timeOrigin)
    )
    {
      // 兼容仍以 Unix epoch 提供 Event.timeStamp 的旧宿主。
      sampleSourceTime -= performance.timeOrigin;
    }

    if (sampleSourceTime < 0 || sampleSourceTime > sourceNow + 1000)
    {
      return sourceNow;
    }

    // 未来时间戳对轨迹 bornAt 等价于当前时刻，但若直接作为限频锚点，
    // 会让后续真实样本长时间无法通过，因此统一钳到 sourceNow。
    return Math.min(sampleSourceTime, sourceNow);
  }

  _getDomTrailSampleTime(sampleSourceTime, sourceNow, trailNow)
  {
    const elapsedMs = Math.max(0, sourceNow - sampleSourceTime);

    return Math.max(
      0,
      trailNow - scaleTimeDelta(elapsedMs, this.config.trailTimeScale),
    );
  }

  _getTrailInputTime(now = performance.now())
  {
    this._advanceTrailTime(now);
    return this.trailTimeMs;
  }

  _getClickInputTime(now = performance.now())
  {
    this._advanceClickTime(now);
    return this.clickTimeMs;
  }

  _advanceClickTime(now = performance.now())
  {
    if (this.paused || !Number.isFinite(now))
    {
      return 0;
    }

    if (this.lastClickTimeSource === null)
    {
      this.lastClickTimeSource = now;
      return 0;
    }

    const elapsedMs = now - this.lastClickTimeSource;

    if (elapsedMs <= 0)
    {
      return 0;
    }

    const scaledDeltaMs = scaleTimeDelta(
      elapsedMs,
      this.config.clickTimeScale,
    );

    this.clickTimeMs += scaledDeltaMs;
    this.lastClickTimeSource = now;
    return scaledDeltaMs;
  }

  _advanceTrailTime(now = performance.now())
  {
    if (this.paused || !Number.isFinite(now))
    {
      return 0;
    }

    if (this.lastTrailTimeSource === null)
    {
      this.lastTrailTimeSource = now;
      return 0;
    }

    // RAF 空闲时真实时间仍要推进衰减；暂停则通过清空时间源显式冻结。
    // 测试或宿主提供的时间若短暂回退，保留原锚点避免下一次重复累计。
    const elapsedMs = now - this.lastTrailTimeSource;

    if (elapsedMs <= 0)
    {
      return 0;
    }

    const scaledDeltaMs = scaleTimeDelta(
      elapsedMs,
      this.config.trailTimeScale,
    );

    this.trailTimeMs += scaledDeltaMs;
    this.lastTrailTimeSource = now;
    return scaledDeltaMs;
  }

  _getScale()
  {
    return this.config.scale *
      (this.height / UNITY_FX_TOUCH.referenceHeight) *
      SIZE_CORRECTION;
  }

  _getEffectiveOpacity()
  {
    // 主题亮度属于 RGB contribution；Scene、Add 与 HDR 必须保留原能量。
    return this.config.opacity;
  }

  _getEffectiveOverlayAlphaLimit()
  {
    if (
      !this._usesUnknownBrowserOverlay() ||
      this._usesIndependentHostPayload()
    )
    {
      return this.config.overlayAlphaLimit;
    }

    // 未知背景只能用 source-over 传输。限制 Alpha 而不改 Scene RGB，
    // 可让暗主题的白底遮挡最多等于其自身峰值，同时保持 Add/HDR 能量。
    return this.config.overlayAlphaLimit *
      (this._relativeOklchTheme?.coverageScale ?? 1);
  }

  _getPointerDownDecision(event)
  {
    const decision =
    {
      accepted: false,
      rememberTouchPointerFilterResult: false,
      touchState: null,
    };
    const pointerType = event.pointerType || 'mouse';
    const isTouchStart = pointerType === 'touch' &&
      event.type === 'pointerdown';
    const usesTouchShim = isTouchStart &&
      this.touchActionListenersAttached;
    const hasClosedShadowDecision = usesTouchShim &&
      this.closedShadowPointerDecisions.has(event);
    const closedShadowDecision = hasClosedShadowDecision
      ? this.closedShadowPointerDecisions.get(event)
      : undefined;
    const isClosedShadowRetarget = usesTouchShim &&
      this._isHostInClosedShadowRoot() &&
      !this._isTouchEventInScope(event, event.target);

    if (hasClosedShadowDecision)
    {
      this.closedShadowPointerDecisions.delete(event);
    }

    if (usesTouchShim)
    {
      // Touch-first 先在 window capture 看到 closed Shadow 的重定向宿主；
      // 保留 pending 状态，让内部 host capture 用真实 target 回填决定。
      const touchState = isClosedShadowRetarget
        ? null
        : this._consumeTouchGestureState(event);
      decision.touchState = touchState;

      if (touchState && !touchState.pointerFilterPending)
      {
        decision.accepted = touchState.accepted;
        return decision;
      }

      if (touchState)
      {
        decision.accepted = hasClosedShadowDecision
          ? closedShadowDecision
          : !this.inputFilter || this.inputFilter(event);

        touchState.accepted = decision.accepted;
        touchState.filterAccepted = decision.accepted;
        touchState.pointerFilterPending = false;
        return decision;
      }
    }

    if (hasClosedShadowDecision)
    {
      decision.accepted = closedShadowDecision;
      decision.rememberTouchPointerFilterResult = usesTouchShim;
      return decision;
    }

    // button: 0=左键, -1=未按键(移动事件)；仅 >0 的非左键实际点击需拦截
    if (pointerType === 'mouse' && event.button > 0)
    {
      return decision;
    }

    if (
      usesTouchShim &&
      !this._isTouchEventInScope(event, event.target)
    )
    {
      // closed Shadow 的真实 target 会在内部 capture 监听中完成决定；
      // Window capture 此时只负责让路，不能缓存一个伪造的拒绝结果。
      decision.rememberTouchPointerFilterResult =
        !this._isHostInClosedShadowRoot();
      return decision;
    }

    decision.accepted = !this.inputFilter || this.inputFilter(event);
    decision.rememberTouchPointerFilterResult = usesTouchShim;
    return decision;
  }

  _startDomPointer(event)
  {
    const accepted = this.pointerDown(this._getDomPointerInput(event));

    if (accepted && this.config.inputSamplingRate > 0)
    {
      this.lastInputSampleSourceTime = this._getDomInputSourceTime(
        event.timeStamp,
        performance.now(),
      );
    }

    return accepted;
  }

  _handlePointerDown(event)
  {
    if (this.destroyed || this.paused)
    {
      return;
    }

    const decision = this._getPointerDownDecision(event);

    if (!decision.accepted)
    {
      if (decision.touchState)
      {
        decision.touchState.accepted = false;
        decision.touchState.filterAccepted = false;
        decision.touchState.pointerFilterPending = false;
      }

      if (decision.rememberTouchPointerFilterResult)
      {
        this._rememberTouchPointerFilterResult(event, false, false);
      }

      return;
    }

    const started = this._startDomPointer(event);
    const accepted = started && decision.accepted;

    // 过滤器接受不代表实例一定能接管指针；例如已有另一根真实指针时，
    // 必须把实际启动结果回填，否则 Touch 仲裁会阻止一个并不存在的拖尾。
    if (decision.touchState)
    {
      decision.touchState.accepted = accepted;
      decision.touchState.filterAccepted = decision.accepted;
      decision.touchState.pointerFilterPending = false;
    }

    if (decision.rememberTouchPointerFilterResult)
    {
      this._rememberTouchPointerFilterResult(
        event,
        accepted,
        decision.accepted,
      );
    }
  }

  /**
   * 使用 Canvas 局部 CSS 像素开始一次点击和拖尾生命周期。
   * 手动输入由宿主完成按键和环境过滤，因此不会经过 inputFilter。
   */
  pointerDown(input)
  {
    if (this.destroyed || this.paused)
    {
      return false;
    }

    const pointer = this._normalizePointerInput(input);

    if (!pointer)
    {
      return false;
    }

    // 只有无按键的悬停轨迹允许被一次真实按下接管；真实按下之间仍保持单指针上限。
    if (
      this.activePointerId !== null &&
      this.activePointerSource !== 'hover'
    )
    {
      return false;
    }

    if (this.activePointerId !== null && this.currentTrailStroke)
    {
      // 点击接管悬停时只停止旧 stroke 发射，已有顶点仍自然衰减。
      this.currentTrailStroke.active = false;
    }

    this.activePointerId = pointer.pointerId;
    this.activePointerSource = 'press';
    this._beginTrailOwner();
    const inputSourceTime = performance.now();

    this.lastPointerPosition = { x: pointer.x, y: pointer.y };
    this.lastPointerTime = this._getTrailInputTime(inputSourceTime);
    this.lastInputSampleSourceTime = inputSourceTime;
    this.trailDistanceSinceShard = 0;

    if (this.config.trailEnabled)
    {
      this._startTrailStroke(this.lastPointerPosition, this.lastPointerTime);
    }

    if (this.config.clickEnabled)
    {
      this._spawnClick(pointer.x, pointer.y);
    }

    this._requestRender();
    return true;
  }

  _handlePointerMove(event)
  {
    if (this.destroyed || this.paused || !this.config.trailEnabled)
    {
      return;
    }

    if (
      this.activePointerId === null &&
      this.config.trailAlways &&
      !this._getPointerDownDecision(event).accepted
    )
    {
      return;
    }

    const coalesced = typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : [event];
    const events = coalesced.length > 0 ? coalesced : [event];
    const sourceNow = performance.now();
    const trailNow = this._getTrailInputTime(sourceNow);

    for (const sample of events)
    {
      const sampleSourceTime = this._getDomInputSourceTime(
        sample.timeStamp ?? event.timeStamp,
        sourceNow,
      );
      const sampleTime = this._getDomTrailSampleTime(
        sampleSourceTime,
        sourceNow,
        trailNow,
      );

      this._pointerMoveAtTime(
        this._getDomPointerInput(sample, event),
        sampleTime,
        sampleSourceTime,
      );
    }
  }

  /** 追加一个手动指针采样点；采样 Hz 与空间阈值都不受时间倍率影响。 */
  pointerMove(input)
  {
    const inputSourceTime = performance.now();

    return this._pointerMoveAtTime(
      input,
      this._getTrailInputTime(inputSourceTime),
      inputSourceTime,
    );
  }

  _pointerMoveAtTime(input, sampleTime = null, sampleSourceTime = null)
  {
    if (this.destroyed || this.paused || !this.config.trailEnabled)
    {
      return false;
    }

    const pointer = this._normalizePointerInput(input);

    if (!pointer)
    {
      return false;
    }

    const position = { x: pointer.x, y: pointer.y };
    const requestedTime = Number.isFinite(sampleTime)
      ? sampleTime
      : this._getTrailInputTime();
    const inputSourceTime = Number.isFinite(sampleSourceTime)
      ? sampleSourceTime
      : performance.now();
    const now = Math.max(this.lastPointerTime, requestedTime);

    // trailAlways 的悬停轨迹没有按下事件；首个移动样本负责创建逻辑指针。
    if (this.activePointerId === null && this.config.trailAlways)
    {
      this.activePointerId = pointer.pointerId;
      this.activePointerSource = 'hover';
      this._beginTrailOwner();
      this.lastPointerPosition = position;
      this.lastPointerTime = now;
      this.lastInputSampleSourceTime = inputSourceTime;
      this.trailDistanceSinceShard = 0;
      this._startTrailStroke(position, now, true);
      this._requestRender();
      return true;
    }

    if (
      this.activePointerId === null ||
      pointer.pointerId !== this.activePointerId
    )
    {
      return false;
    }

    if (!this._acceptInputSample(inputSourceTime))
    {
      // 返回值表示逻辑指针已接受；限频样本与空间阈值 no-op 一样仍返回 true。
      return true;
    }

    this._ensureCurrentTrailStroke(now);
    this._appendPointerSample(position, now);

    this._requestRender();
    return true;
  }

  _acceptInputSample(inputSourceTime)
  {
    const rate = this.config.inputSamplingRate;

    if (rate <= 0)
    {
      return true;
    }

    if (!Number.isFinite(this.lastInputSampleSourceTime))
    {
      this.lastInputSampleSourceTime = inputSourceTime;
      return true;
    }

    const intervalMs = 1000 / rate;

    if (inputSourceTime - this.lastInputSampleSourceTime < intervalMs)
    {
      return false;
    }

    // 即使空间位移不足 minVertexDistance，也要推进独立的时间采样相位。
    this.lastInputSampleSourceTime = inputSourceTime;
    return true;
  }

  _startTrailStroke(position, now, includeVisibleSeed = false)
  {
    const points = [createTrailPoint(position.x, position.y, now)];

    if (includeVisibleSeed)
    {
      // 向画布内部偏移可保证右下角也不会生成两个完全重合的伪顶点。
      const seedX = position.x < this.width
        ? position.x + 0.5
        : position.x - 0.5;

      points.push(createTrailPoint(seedX, position.y, now));
    }

    this.currentTrailStroke = {
      active: true,
      ownerId: this.activeTrailOwnerId,
      points,
    };
    this.trailStrokes.push(this.currentTrailStroke);
  }

  _beginTrailOwner()
  {
    const ownerId = this.nextTrailOwnerId;

    // 每次按下对应官方对象池中的一个 FX_Touch 实例，粒子上限不能跨实例共享。
    this.nextTrailOwnerId++;
    this.activeTrailOwnerId = ownerId;
    this.trailShardCounts.set(ownerId, 0);
  }

  _releaseTrailShardOwner(shard)
  {
    if (shard.kind !== 'trail' || !Number.isFinite(shard.ownerId))
    {
      return;
    }

    const nextCount = Math.max(
      0,
      (this.trailShardCounts.get(shard.ownerId) ?? 0) - 1,
    );

    if (nextCount === 0 && shard.ownerId !== this.activeTrailOwnerId)
    {
      this.trailShardCounts.delete(shard.ownerId);
      return;
    }

    this.trailShardCounts.set(shard.ownerId, nextCount);
  }

  _ensureCurrentTrailStroke(now)
  {
    if (!this.lastPointerPosition)
    {
      return;
    }

    if (!this.currentTrailStroke)
    {
      this._startTrailStroke(this.lastPointerPosition, now);
      this.lastPointerTime = now;
      this.trailDistanceSinceShard = 0;
    }
    else if (
      this.currentTrailStroke.points.length === 0 ||
      (
        this.currentTrailStroke.points.length === 1 &&
        now - this.currentTrailStroke.points[0].bornAt >=
          this.fxConfig.trail.lifetimeMs
      )
    )
    {
      // 空闲裁剪后的首个移动必须从当前时刻重新起算，不能跨空闲期插值。
      this.currentTrailStroke.points.length = 0;
      this.currentTrailStroke.points.push(createTrailPoint(
        this.lastPointerPosition.x,
        this.lastPointerPosition.y,
        now,
      ));
      this.lastPointerTime = now;
      this.trailDistanceSinceShard = 0;
    }
  }

  _appendPointerSample(position, now)
  {
    if (!this.currentTrailStroke || !this.lastPointerPosition)
    {
      return;
    }

    const from = this.lastPointerPosition;
    const segmentLength = distance(from, position);
    const scale = this._getScale();
    const vertexDistance = Math.max(
      0.5,
      this.fxConfig.trail.minVertexDistance * scale,
    );

    if (segmentLength < vertexDistance)
    {
      return;
    }

    const count = Math.min(512, Math.floor(segmentLength / vertexDistance));

    for (let index = 1; index <= count; index++)
    {
      const progress = index / count;
      const x = lerp(from.x, position.x, progress);
      const y = lerp(from.y, position.y, progress);
      const bornAt = lerp(this.lastPointerTime, now, progress);

      this.currentTrailStroke.points.push(createTrailPoint(x, y, bornAt));
    }

    this._spawnTrailShards(
      from,
      position,
      scale,
      this.lastPointerTime,
      now,
    );
    this.lastPointerPosition = position;
    this.lastPointerTime = now;
  }

  _spawnTrailShards(from, to, scale, fromTime, toTime)
  {
    const segmentLength = distance(from, to);
    const spacing = Math.max(1, this.fxConfig.shards.trailSpacing * scale);
    let nextDistance = spacing - this.trailDistanceSinceShard;
    const ownerId = this.currentTrailStroke?.ownerId ??
      this.activeTrailOwnerId;
    let ownerShardCount = Number.isFinite(ownerId)
      ? this.trailShardCounts.get(ownerId) ?? 0
      : 0;

    while (
      Number.isFinite(ownerId) &&
      nextDistance <= segmentLength &&
      ownerShardCount < this.fxConfig.shards.maxCount
    )
    {
      const progress = segmentLength > 0 ? nextDistance / segmentLength : 0;
      const x = lerp(from.x, to.x, progress);
      const y = lerp(from.y, to.y, progress);
      const angle = random(0, TAU);

      this.shards.push(createShard(
        x,
        y,
        angle,
        'trail',
        scale,
        this.fxConfig.shards,
        lerp(fromTime, toTime, progress),
        ownerId,
      ));
      ownerShardCount++;
      this.trailShardCounts.set(ownerId, ownerShardCount);

      nextDistance += spacing;
    }

    this.trailDistanceSinceShard = (this.trailDistanceSinceShard + segmentLength) % spacing;
  }

  _handlePointerUp(event)
  {
    this.pointerUp(event.pointerId ?? 1);
  }

  _handlePointerCancel(event)
  {
    this.pointerCancel(event.pointerId ?? 1);
  }

  /** 结束指针；已有拖尾顶点继续自然消失。 */
  pointerUp(pointerId = 1)
  {
    if (
      this.destroyed ||
      this.paused ||
      !Number.isFinite(pointerId) ||
      this.activePointerId === null ||
      pointerId !== this.activePointerId
    )
    {
      return false;
    }

    this._releaseActivePointer(false);
    return true;
  }

  /** 强制结束异常指针状态，并立即移除当前轨迹。 */
  pointerCancel(pointerId = 1)
  {
    if (
      this.destroyed ||
      this.paused ||
      !Number.isFinite(pointerId) ||
      this.activePointerId === null ||
      pointerId !== this.activePointerId
    )
    {
      return false;
    }

    this._releaseActivePointer(true);
    return true;
  }

  _cancelPointer()
  {
    this.touchGestureStarts.clear();
    this.touchPointerFilterResults.length = 0;
    this.closedShadowPointerDecisions = new WeakMap();

    if (this.activePointerId !== null)
    {
      this._releaseActivePointer(true);
    }
  }

  _releaseActivePointer(discardCurrentStroke = false)
  {
    const releasedPointerId = this.activePointerId;
    const releasedOwnerId = this.activeTrailOwnerId;

    if (this.currentTrailStroke)
    {
      // 正常松开保留顶点自然衰减；异常取消必须丢弃当前 stroke。
      this.currentTrailStroke.active = false;

      if (discardCurrentStroke || this.currentTrailStroke.points.length < 2)
      {
        // 单点不能形成 TrailRenderer 几何，保留它只会让 RAF 空转。
        const strokeIndex = this.trailStrokes.indexOf(this.currentTrailStroke);

        if (strokeIndex >= 0)
        {
          this.trailStrokes.splice(strokeIndex, 1);
        }
      }
    }

    this.currentTrailStroke = null;
    this.activeTrailOwnerId = null;

    if (
      releasedOwnerId !== null &&
      (this.trailShardCounts.get(releasedOwnerId) ?? 0) === 0
    )
    {
      // 无存活粒子的 Unity 实例可以随指针一起释放，避免按点击次数积累空计数。
      this.trailShardCounts.delete(releasedOwnerId);
    }

    if (this.fallbackTouchPointerId === releasedPointerId)
    {
      this.fallbackTouchPointerId = null;
    }

    this.activePointerId = null;
    this.activePointerSource = null;
    this.lastPointerPosition = null;
    this.lastPointerTime = 0;
    this.lastInputSampleSourceTime = null;
    this.trailDistanceSinceShard = 0;
    this._requestRender();
  }

  _spawnClick(x, y)
  {
    const scale = this._getScale();
    const clickTimeMs = this._getClickInputTime();

    this.waves.push(new ClickWave(x, y, this.fxConfig, clickTimeMs));

    for (let index = 0; index < this.fxConfig.shards.clickCount; index++)
    {
      this.shards.push(createShard(
        x,
        y,
        random(0, TAU),
        'click',
        scale,
        this.fxConfig.shards,
        clickTimeMs,
      ));
    }
  }

  _requestRender()
  {
    if (this.destroyed || this.paused || this.animationFrame !== null)
    {
      return;
    }

    this.lastFrameTime = this.lastFrameTime ?? performance.now();
    this.animationFrame = requestRenderFrame(this._onFrame);
  }

  _renderFrame(now)
  {
    if (this.destroyed || this.paused)
    {
      this.animationFrame = null;
      this.lastFrameTime = null;
      return;
    }

    this.animationFrame = null;
    // Unity 生命周期跟随真实时间。低帧率时限制 delta 会让旧特效异常延寿，
    // 进一步增加同时存活的 Bloom 区域并形成性能反馈循环。
    this._advanceClickTime(now);
    this._advanceTrailTime(now);
    const scale = this._getScale();
    let effectBackend = this._prepareEffectBackend();
    let useGpuClickEffects = effectBackend !== null;
    let bloomBackend = useGpuClickEffects
      ? effectBackend
      : this._resolveBloomBackend();
    this._setResolvedBloomBackend(bloomBackend);

    if (
      !useGpuClickEffects &&
      this.resolvedBloomBackend !== bloomBackend
    )
    {
      // 宿主可在同步状态事件中立即切换后端；后续绘制必须读取新路由。
      bloomBackend = this._resolveBloomBackend();
    }

    let useSoftwareBloom = bloomBackend === 'software';
    let useWebGL2Bloom = bloomBackend === 'webgl2';
    let useNativeBloom = bloomBackend === 'native';
    const useCanvasScene = this._prepareCanvasSceneBackend(
      useGpuClickEffects,
      bloomBackend,
    );
    const reuseCachedSoftwareBloom =
      !useGpuClickEffects &&
      bloomBackend === 'native' &&
      !useCanvasScene &&
      this._hasCachedSoftwareBloomFrame(scale);

    if (reuseCachedSoftwareBloom)
    {
      // Software 回读刚失败但输入尚未推进时，复用上一张完整 Bloom。
      // 这避免 Native 近似在同一帧状态下产生可见的透明 Coverage 跳变。
      useNativeBloom = false;
    }
    // WebGL2 Bloom 已复用完整 Scene Renderer。成功路径无需先栅格一份
    // 随后会被隐藏的 Canvas；GPU 当帧失败时再由回退路径补画即可。
    const drawCanvasOutput =
      !useGpuClickEffects && !useCanvasScene && !useWebGL2Bloom;
    const deferNativeVisualMaxDraw =
      drawCanvasOutput &&
      useNativeBloom &&
      this._usesUnknownBrowserOverlay() &&
      !this._usesIndependentHostPayload() &&
      this._getOverlayAlphaPolicy() === 'visual-max';
    const drawCanvasDuringUpdate =
      drawCanvasOutput && !deferNativeVisualMaxDraw;
    let canvasSceneRendered = false;

    this.lastFrameTime = now;

    if (!useGpuClickEffects)
    {
      this._setWebGLEffectVisible(false);
      this._setWebGPUEffectVisible(false);
    }

    if (!useCanvasScene)
    {
      const canvasSceneWasVisible = this.canvasSceneVisible;

      this._setCanvasSceneVisible(false);

      if (canvasSceneWasVisible)
      {
        this._setCanvasOutputVisible(true);
      }
    }

    this._setWebGLBloomVisible(!useGpuClickEffects && useWebGL2Bloom);
    if (!this.context && !useGpuClickEffects)
    {
      this.context = this.canvas.getContext?.('2d') ?? null;
    }
    if (this.context)
    {
      // DOM 的 GPU 层恢复时备用 Canvas 仍可能参与合成，必须清掉旧回退帧。
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.context.clearRect(0, 0, this.width, this.height);
    }
    // 推入当前实例的主题变换，渲染完成后恢复，保证多实例安全。
    const prevHueShift = themeHueShift;
    const previousRelativeOklchTheme = relativeOklchTheme;
    let contextSaved = false;

    this.canvasNativeSceneAlphaSnapshot = null;

    try
    {
      // Context 异常也不能泄漏模块级主题状态；先建立 Canvas
      // 恢复点，再推入当前实例配置。
      if (!useGpuClickEffects && this.context)
      {
        this.context.save();
        contextSaved = true;
      }
      themeHueShift = this._themeHueShift;
      relativeOklchTheme = this._relativeOklchTheme;
      // 透明 Canvas 无法独立保存 Additive RGB 与 Coverage Alpha；在 residual
      // Coverage Final Pass 完成前保留兼容 source-over，避免多个粒子把 Alpha 相加。
      if (this.context)
      {
        this.context.globalCompositeOperation =
          this._getCanvasOutputCompositing() === 'browser-overlay'
            ? 'source-over'
            : 'lighter';
      }
      this.renderingFrame = true;
      this._updateTrail(
        this.trailTimeMs,
        scale,
        useNativeBloom,
        drawCanvasDuringUpdate,
        useGpuClickEffects || useWebGL2Bloom,
      );
      this._updateWaves(
        this.clickTimeMs,
        scale,
        useNativeBloom,
        drawCanvasDuringUpdate,
      );

      if (drawCanvasDuringUpdate)
      {
        // Tri3 与 Cross2、Trail 同为 4499，必须先于 4550 的 Tri2 碎片提交。
        this._drawWaveRings(scale, useNativeBloom);
      }

      this._updateShards(
        this.clickTimeMs,
        this.trailTimeMs,
        scale,
        drawCanvasDuringUpdate,
      );

      if (useGpuClickEffects)
      {
        if (!this._renderGPUClickEffects(effectBackend, scale))
        {
          const failedBackend = effectBackend;

          useGpuClickEffects = false;
          effectBackend = null;
          this._setResolvedEffectBackend(
            failedBackend === 'webgpu' ? 'pending' : 'canvas2d',
          );
          this._setWebGLEffectVisible(false);
          this._setWebGPUEffectVisible(false);
          bloomBackend = this._resolveBloomBackend();
          useSoftwareBloom = bloomBackend === 'software';
          useWebGL2Bloom = bloomBackend === 'webgl2';
          useNativeBloom = bloomBackend === 'native';
          this._setResolvedBloomBackend(bloomBackend);

          if (this.resolvedBloomBackend !== bloomBackend)
          {
            // 状态监听器可能同步释放旧后端资源，不能继续使用缓存路由。
            bloomBackend = this._resolveBloomBackend();
            useSoftwareBloom = bloomBackend === 'software';
            useWebGL2Bloom = bloomBackend === 'webgl2';
            useNativeBloom = bloomBackend === 'native';
          }

          this._setWebGLBloomVisible(useWebGL2Bloom);
          // 活动参考失效后，未知背景宿主 Add 需要从 source-over 切回
          // lighter；统一入口会按已经解析的新后端重新建立 Canvas 状态。
          this._drawCanvasFallbackFrame(scale, useNativeBloom);
        }
        else
        {
          // Scene 与 Bloom 都成功写入默认帧缓冲后才切换可见层，
          // 避免初始化或失败回退时暴露空白、旧帧或半成品帧。
          this._setWebGLEffectVisible(effectBackend === 'webgl2');
          this._setWebGPUEffectVisible(effectBackend === 'webgpu');
          this._setResolvedEffectBackend(effectBackend);
        }
      }
      else
      {
        if (useCanvasScene)
        {
          canvasSceneRendered = this._renderCanvasSceneEffects(
            scale,
            useNativeBloom,
          );

          if (!canvasSceneRendered)
          {
            // Final Pass 候选帧使用线性能量编码，失败后不能直接作为普通
            // Canvas 显示；对象已在本帧更新，只需用 sRGB 路径重新绘制。
            this._setCanvasSceneVisible(false);
            this._drawCanvasFallbackFrame(scale, useNativeBloom);
          }

          this._setCanvasSceneVisible(canvasSceneRendered);
          this._setCanvasOutputVisible(!canvasSceneRendered);
        }
        else if (!useWebGL2Bloom && deferNativeVisualMaxDraw)
        {
          this._drawCanvasFallbackFrame(scale, useNativeBloom);
        }
      }

      const hasDedicatedSceneOutput =
        useGpuClickEffects || useWebGL2Bloom || canvasSceneRendered;

      // GPU 与场景 Final Pass 不会保留可复用的主 Canvas 遮罩；对比层
      // 必须按同一帧几何重绘，否则纯白隔离合成会在成功后端上失去轮廓。
      this._renderLightBackgroundContrast(
        scale,
        useSoftwareBloom && !hasDedicatedSceneOutput,
      );

      if (reuseCachedSoftwareBloom)
      {
        if (!this._drawCachedSoftwareBloomFrame(scale))
        {
          // 快照绘制失败时退回完整 Native 帧，不能保留缺少辉光的清晰层。
          this._drawCanvasFallbackFrame(scale, true, false);
          this._renderLightBackgroundContrast(scale, false);
        }
      }
      else if (
        !useGpuClickEffects &&
        useSoftwareBloom &&
        this._hasVisibleEffects()
      )
      {
        this._renderSoftwareBloom(scale);
      }
      else if (
        !useGpuClickEffects &&
        useWebGL2Bloom &&
        this._hasVisibleEffects()
      )
      {
        this._renderWebGL2Bloom(scale);
      }
      else if (!useGpuClickEffects && useWebGL2Bloom)
      {
        this.webglBloomRenderer?.clear();
      }

      this._finalizeCanvasOverlayAlpha(scale);
    }
    catch (error)
    {
      console.error('[BAClickFX] render error:', error);

      if (useCanvasScene)
      {
        this._setCanvasSceneVisible(false);
        this._setCanvasOutputVisible(true);
      }
    }
    finally
    {
      this.renderingFrame = false;
      themeHueShift = prevHueShift;
      relativeOklchTheme = previousRelativeOklchTheme;

      if (contextSaved)
      {
        this.context.restore();
      }
    }

    // 合成合同可能在本帧内因后端成功/失败而改变；此时像素已经完成，
    // 现在切换根节点混合模式不会让浏览器用新合同解释旧帧。
    this._flushCompositingMountRefresh();

    if (this._hasVisibleEffects())
    {
      this._requestRender();
    }
    else
    {
      this.lastFrameTime = null;
    }
  }

  _getRequestedEffectBackendState()
  {
    const requested = normalizeEffectBackend(this.config.effectBackend);
    const isDirectCanvas = isOffscreenCanvas(this.canvas);

    if (
      requested === 'canvas2d' ||
      (!this.ownsCanvas && !isDirectCanvas) ||
      (this.ownsCanvas && !this.overlayParent)
    )
    {
      return 'canvas2d';
    }

    if (requested === 'webgpu' || requested === 'auto')
    {
      if (
        this.webgpuEffectVisible &&
        this.webgpuEffectRenderer?.available
      )
      {
        return 'webgpu';
      }

      if (
        !this.webgpuEffectUnavailable &&
        (
          !this.webgpuEffectRenderer ||
          this.webgpuEffectRenderer.status === 'pending' ||
          this.webgpuEffectRenderer.status === 'ready'
        )
      )
      {
        return 'pending';
      }
    }

    if (
      this.webglEffectVisible &&
      this.webglEffectRenderer?.available
    )
    {
      return 'webgl2';
    }

    if (
      this.webglEffectUnavailable ||
      this.webglEffectRenderer &&
      (
        !this.webglEffectRenderer.available ||
        this.webglEffectRenderer.contextLost
      )
    )
    {
      return 'canvas2d';
    }

    // Renderer 和完整浮点目标都在首个 Scene 提交时验证。
    return 'pending';
  }

  _getRequestedBloomBackendState()
  {
    const requested = normalizeBloomBackend(this.config.bloomBackend);
    const fallback = this._resolveCanvasFallbackBloomBackend();

    if (
      this.webgpuEffectVisible &&
      this.webgpuEffectRenderer?.available
    )
    {
      return 'webgpu';
    }

    if (
      this.webglEffectVisible &&
      this.webglEffectRenderer?.available
    )
    {
      return 'webgl2';
    }

    if (requested === 'native')
    {
      return 'native';
    }

    if (requested === 'software')
    {
      return fallback;
    }

    if (this.webglBloomRenderer)
    {
      const renderer = this.webglBloomRenderer;

      return (
        renderer.available &&
        renderer.sourceTarget &&
        renderer.levels?.length > 0
      )
        ? 'webgl2'
        : fallback;
    }

    if (
      this.webglBloomUnavailable ||
      !this.ownsCanvas ||
      !this.overlayParent
    )
    {
      return fallback;
    }

    // WebGL2 Canvas 延迟到首个渲染帧创建，构造完成时不能伪报某个实际后端。
    return 'pending';
  }

  _setResolvedEffectBackend(backend)
  {
    if (this.resolvedEffectBackend === backend)
    {
      return;
    }

    this.resolvedEffectBackend = backend;

    if (
      typeof CustomEvent !== 'function' ||
      typeof this.canvas?.dispatchEvent !== 'function'
    )
    {
      return;
    }

    try
    {
      this.canvas.dispatchEvent(
        new CustomEvent(
          EFFECT_BACKEND_CHANGE_EVENT,
          {
            detail:
            {
              requestedEffectBackend: this.config.effectBackend,
              resolvedEffectBackend: backend,
            },
          },
        ),
      );
    }
    catch
    {
      // 状态通知不能中断渲染；旧 DOM 环境仍可通过 getConfig() 查询。
    }
  }

  _setResolvedBloomBackend(backend)
  {
    if (this.resolvedBloomBackend === backend)
    {
      return;
    }

    this.resolvedBloomBackend = backend;

    if (
      typeof CustomEvent !== 'function' ||
      typeof this.canvas?.dispatchEvent !== 'function'
    )
    {
      return;
    }

    try
    {
      this.canvas.dispatchEvent(
        new CustomEvent(
          BLOOM_BACKEND_CHANGE_EVENT,
          {
            detail:
            {
              requestedBloomBackend: this.config.bloomBackend,
              resolvedBloomBackend: backend,
            },
          },
        ),
      );
    }
    catch
    {
      // 状态通知不能中断特效渲染；极旧 DOM 实现仍可通过 getConfig() 查询。
    }
  }

  _handleWebGPUEffectStateChange(renderer, status)
  {
    if (this.destroyed || renderer !== this.webgpuEffectRenderer)
    {
      return;
    }

    const requested = normalizeEffectBackend(this.config.effectBackend);

    if (status === 'ready')
    {
      this.webgpuEffectUnavailable = false;

      if (requested === 'webgpu' || requested === 'auto')
      {
        // Device 就绪不等于首帧已提交；可见性仍由完整 Scene 成功后切换。
        this._setResolvedEffectBackend('pending');
        this._requestRender();
      }

      return;
    }

    if (status !== 'lost' && status !== 'unavailable')
    {
      return;
    }

    const wasVisible = this.webgpuEffectVisible;

    this.webgpuEffectUnavailable = true;
    this._setWebGPUEffectVisible(false);

    if (wasVisible && (this.paused || !this.renderingFrame))
    {
      const fallbackBackend = this._resolveCanvasFallbackBloomBackend();

      this._restoreCanvasOutputAfterContextLoss(fallbackBackend);
    }
    else
    {
      this._setCanvasOutputVisible(true);
    }

    // WebGPU 失败后仍有 WebGL2 探测阶段，不能提前宣称最终 Canvas 回退。
    this._setResolvedEffectBackend(this._getRequestedEffectBackendState());
    this._setResolvedBloomBackend(this._getRequestedBloomBackendState());
    this._requestRender();
  }

  _ensureWebGPUEffectRenderer()
  {
    if (this.webgpuEffectRenderer)
    {
      this.webgpuEffectRenderer.setPreferHdr(this.config.webgpuPreferHdr);
      return this.webgpuEffectRenderer.available;
    }

    if (
      this.webgpuEffectUnavailable ||
      !this.ownsCanvas ||
      !this.overlayParent
    )
    {
      return false;
    }

    const canvas = createCanvas();

    setOverlayStyle(
      canvas,
      !this.host && !this.config.isolatedCompositing,
      '2147483646',
      '',
    );
    // Adapter/Device 初始化是异步的；旧输出必须保留到首个完整帧提交成功。
    canvas.style.display = 'none';
    this.overlayParent.appendChild(canvas);
    let renderer = null;

    try
    {
      renderer = new WebGPUEffectRenderer(
        canvas,
        {
          preferHdr: this.config.webgpuPreferHdr,
          onStateChange: (status, candidate) =>
            this._handleWebGPUEffectStateChange(candidate, status),
        },
      );
      const compositingReference = this.compositingReferenceSource;

      if (
        compositingReference !== null &&
        !renderer.setCompositingReference(
          compositingReference,
          { fit: this.compositingReferenceFit },
        )
      )
      {
        throw new Error('WebGPU 无法接入当前合成参考');
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGPU 创建失败:', error);
      this.webgpuEffectUnavailable = true;
      renderer?.destroy();
      canvas.remove();
      return false;
    }

    this.webgpuEffectCanvas = canvas;
    this.webgpuEffectRenderer = renderer;
    return renderer.available;
  }

  _resizeWebGPUEffectRenderer()
  {
    return !!this.webgpuEffectRenderer?.resize(
      this.width,
      this.height,
      this.dpr,
      this.fxConfig.bloom.resolutionScale,
      this.fxConfig.bloom.diffusion,
    );
  }

  _prepareWebGPUEffectBackend()
  {
    const ready = this._ensureWebGPUEffectRenderer() &&
      this._resizeWebGPUEffectRenderer();

    if (ready)
    {
      if (this.resolvedEffectBackend !== 'webgpu')
      {
        this._setResolvedEffectBackend('pending');
      }

      return true;
    }

    if (
      this.webgpuEffectRenderer?.status === 'pending' ||
      this.webgpuEffectRenderer?.status === 'ready'
    )
    {
      this._setResolvedEffectBackend('pending');
    }

    return false;
  }

  _prepareEffectBackend()
  {
    const requested = normalizeEffectBackend(this.config.effectBackend);

    if (requested === 'canvas2d')
    {
      this._setResolvedEffectBackend('canvas2d');
      return null;
    }

    if (requested === 'webgpu' || requested === 'auto')
    {
      if (this._prepareWebGPUEffectBackend())
      {
        return 'webgpu';
      }

      if (
        !this.webgpuEffectUnavailable &&
        this.webgpuEffectRenderer?.status === 'pending'
      )
      {
        return null;
      }
    }

    return this._prepareWebGLEffectBackend() ? 'webgl2' : null;
  }

  _setWebGPUEffectVisible(visible)
  {
    if (
      !visible &&
      this.webgpuEffectRenderer &&
      !this.webgpuEffectRenderer.suspendPresentation()
    )
    {
      const changed = this.webgpuEffectVisible;

      // 无法解除 Extended Surface 时必须释放 Device，避免隐藏 Canvas
      // 继续影响浏览器对后续 SDR Canvas 的页面合成判断。
      console.warn('[BAClickFX] WebGPU Canvas 暂停失败，已释放该 Renderer');
      this._destroyWebGPUEffectRenderer();
      this.webgpuEffectUnavailable = false;

      if (changed)
      {
        this._requestCompositingMountRefresh();
      }

      return;
    }

    if (!this.webgpuEffectCanvas)
    {
      const changed = this.webgpuEffectVisible;

      this.webgpuEffectVisible = false;

      if (changed)
      {
        this._requestCompositingMountRefresh();
      }

      return;
    }

    if (this.webgpuEffectVisible === visible)
    {
      return;
    }

    this.webgpuEffectVisible = visible;
    this.webgpuEffectCanvas.style.display = visible ? '' : 'none';

    this._requestCompositingMountRefresh();
  }

  _destroyWebGPUEffectRenderer()
  {
    const renderer = this.webgpuEffectRenderer;

    this.webgpuEffectRenderer = null;
    this.webgpuEffectCanvas?.remove();
    this.webgpuEffectCanvas = null;
    this.webgpuEffectVisible = false;
    renderer?.destroy();
  }

  _handleWebGLContextLost()
  {
    if (this.destroyed || !this.webglBloomVisible)
    {
      return;
    }

    const fallbackBackend = this._resolveCanvasFallbackBloomBackend();

    this._setWebGLBloomVisible(false);

    if (this.paused || !this.renderingFrame)
    {
      this._restoreCanvasOutputAfterContextLoss(fallbackBackend);
    }
    else
    {
      // 活跃帧会在当前或下一次 RAF 走原有回退，避免事件回调与帧渲染
      // 同时向 Canvas 叠加一次 Software Bloom。
      this._setResolvedBloomBackend(fallbackBackend);
    }

    this._requestRender();
  }

  _handleWebGLContextRestored()
  {
    if (this.destroyed)
    {
      return;
    }

    if (!this.webglBloomRenderer?.available)
    {
      // 恢复初始化失败的实例无法自行再次初始化；丢弃后允许下一帧
      // 用新 Canvas 进行一次正常的懒创建重试。
      this._destroyWebGLBloomRenderer();
      this.webglBloomUnavailable = false;
    }

    if (
      this.paused ||
      !this._hasVisibleEffects() ||
      normalizeEffectBackend(this.config.effectBackend) !== 'canvas2d'
    )
    {
      return;
    }

    const requested = normalizeBloomBackend(this.config.bloomBackend);

    if (requested !== 'webgl2' && requested !== 'auto')
    {
      return;
    }

    // Renderer 会先在自己的 restored 监听器中重建资源；下一帧再验证完整链路。
    this._setResolvedBloomBackend('pending');
    this._requestRender();
  }

  _handleWebGLEffectContextLost()
  {
    if (this.destroyed || !this.webglEffectVisible)
    {
      return;
    }

    this._setWebGLEffectVisible(false);
    this._setResolvedEffectBackend('canvas2d');
    const fallbackBackend = this._resolveCanvasFallbackBloomBackend();

    if (this.paused || !this.renderingFrame)
    {
      this._restoreCanvasOutputAfterContextLoss(fallbackBackend);
    }
    else
    {
      this._setResolvedBloomBackend(fallbackBackend);
      this._setCanvasOutputVisible(true);
    }

    this._requestRender();
  }

  _handleWebGLEffectContextRestored()
  {
    if (this.destroyed)
    {
      return;
    }

    if (!this.webglEffectRenderer?.available)
    {
      // 失败实例留在 ensure 路径会永久阻断重建，因此只保留最新背景源，
      // 下一次需要纯 WebGL2 时再创建完整 Renderer。
      this._destroyWebGLEffectRenderer();
      this.webglEffectUnavailable = false;
    }

    if (this.paused || !this._hasVisibleEffects())
    {
      return;
    }

    const requested = normalizeEffectBackend(this.config.effectBackend);

    if (requested !== 'canvas2d')
    {
      // Renderer 先恢复 Program；下一帧再重新验证完整浮点目标。
      this._setResolvedEffectBackend('pending');
      this._requestRender();
    }
  }

  _ensureWebGLEffectRenderer()
  {
    if (this.webglEffectRenderer)
    {
      return this.webglEffectRenderer.available;
    }

    if (this.webglEffectUnavailable)
    {
      return false;
    }

    const isDirectCanvas = isOffscreenCanvas(this.canvas);
    if (!this.ownsCanvas && !isDirectCanvas)
    {
      return false;
    }

    if (this.ownsCanvas && !this.overlayParent)
    {
      return false;
    }

    const canvas = this.ownsCanvas ? createCanvas() : this.canvas;

    if (this.ownsCanvas && this.overlayParent)
    {
      setOverlayStyle(
        canvas,
        !this.host && !this.config.isolatedCompositing,
        '2147483646',
        '',
      );
      // 纯 WebGL2 已把加色 RGB 与 Cross2 Coverage 编码为预乘输出；普通
      // DOM 合成才能执行 Unity 的 OneMinusSrcAlpha 背景衰减。
      // 独立 Canvas 在 Scene 后端接管前保持隐藏，避免与稳定 Bloom 层叠加。
      canvas.style.display = 'none';
      this.overlayParent.appendChild(canvas);
    }

    let renderer = null;

    try
    {
      renderer = new WebGL2EffectRenderer(canvas);

      if (!renderer.available)
      {
        this.webglEffectUnavailable = true;
        renderer.destroy();
        if (this.ownsCanvas)
        {
          canvas.remove();
        }
        return false;
      }

      const compositingReference = this.compositingReferenceSource;

      if (compositingReference !== null)
      {
        const referenceReady = renderer.setCompositingReference(
          compositingReference,
          { fit: this.compositingReferenceFit },
        );

        if (!referenceReady)
        {
          // 候选 Renderer 未接入规范背景时不能宣称 Scene 已就绪。
          this.webglEffectUnavailable = true;
          renderer.destroy();
          if (this.ownsCanvas)
          {
            canvas.remove();
          }
          return false;
        }
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] 纯 WebGL2 创建失败:', error);
      this.webglEffectUnavailable = true;
      renderer?.destroy();
      if (this.ownsCanvas)
      {
        canvas.remove();
      }
      return false;
    }

    this.webglEffectCanvas = canvas;
    this.webglEffectRenderer = renderer;
    canvas.addEventListener?.(
      'webglcontextlost',
      this._onWebGLEffectContextLost,
    );
    canvas.addEventListener?.(
      'webglcontextrestored',
      this._onWebGLEffectContextRestored,
    );
    return true;
  }

  _resizeWebGLEffectRenderer()
  {
    const renderer = this.webglEffectRenderer;

    return !!renderer?.resize(
      this.width,
      this.height,
      this.dpr,
      this.fxConfig.bloom.resolutionScale,
      this.fxConfig.bloom.diffusion,
    );
  }

  _prepareWebGLEffectBackend()
  {
    const requested = normalizeEffectBackend(this.config.effectBackend);

    if (requested === 'canvas2d')
    {
      this._setResolvedEffectBackend('canvas2d');
      return false;
    }

    const ready = this._ensureWebGLEffectRenderer() &&
      this._resizeWebGLEffectRenderer();

    if (!ready)
    {
      this._setResolvedEffectBackend('canvas2d');
    }
    else if (this.resolvedEffectBackend !== 'webgl2')
    {
      // 首个可见 Scene 提交成功前保持 pending；成功后不在每帧重复降级。
      this._setResolvedEffectBackend('pending');
    }

    return ready;
  }

  _setWebGLEffectVisible(visible)
  {
    if (!this.webglEffectCanvas)
    {
      const changed = this.webglEffectVisible;

      this.webglEffectVisible = false;

      if (changed)
      {
        this._requestCompositingMountRefresh();
      }
      return;
    }

    if (this.webglEffectVisible === visible)
    {
      return;
    }

    this.webglEffectVisible = visible;
    if (this.webglEffectCanvas.style)
    {
      this.webglEffectCanvas.style.display = visible ? '' : 'none';
    }

    if (!visible)
    {
      this.webglEffectRenderer?.clear();
    }

    this._requestCompositingMountRefresh();
  }

  _destroyWebGLEffectRenderer()
  {
    this.webglEffectCanvas?.removeEventListener?.(
      'webglcontextlost',
      this._onWebGLEffectContextLost,
    );
    this.webglEffectCanvas?.removeEventListener?.(
      'webglcontextrestored',
      this._onWebGLEffectContextRestored,
    );
    this.webglEffectRenderer?.destroy?.();
    if (this.ownsCanvas)
    {
      this.webglEffectCanvas?.remove?.();
    }
    this.webglEffectRenderer = null;
    this.webglEffectCanvas = null;
    this.webglEffectVisible = false;
  }

  _handleCanvasSceneContextLost()
  {
    if (this.destroyed || !this.canvasSceneVisible)
    {
      return;
    }

    // 仅当前输出所有者可以切换图层；帧外事件同步重绘稳定 Canvas。
    this._setCanvasSceneVisible(false);

    if (this.paused || !this.renderingFrame)
    {
      this._restoreCanvasOutputAfterContextLoss(
        'native',
      );
    }

    this._requestRender();
  }

  _handleCanvasSceneContextRestored()
  {
    if (this.destroyed)
    {
      return;
    }

    if (!this.canvasSceneRenderer?.available)
    {
      // Canvas Final Pass 与主 Scene 使用相同的懒重建约定，避免一次
      // Context 恢复分配失败永久关闭原生辉光的场景合成。
      this._destroyCanvasSceneRenderer();
      this.canvasSceneUnavailable = false;
    }

    if (
      !this._hasCompositingReference() ||
      !this._hasVisibleEffects()
    )
    {
      return;
    }

    const needsCanvasScene =
      this.resolvedEffectBackend === 'canvas2d' &&
      this.resolvedBloomBackend === 'native';

    if (needsCanvasScene)
    {
      // Renderer 先重建 Program；下一帧再按当前尺寸验证全部目标。
      this._requestRender();
    }
  }

  _ensureCanvasSceneRenderer()
  {
    if (this.canvasSceneRenderer)
    {
      return this.canvasSceneRenderer.available;
    }

    if (
      this.canvasSceneUnavailable ||
      !this.ownsCanvas ||
      !this.overlayParent
    )
    {
      return false;
    }

    const canvas = createCanvas();

    setOverlayStyle(
      canvas,
      !this.host && !this.config.isolatedCompositing,
      // Scene Final Pass 是常规输出层；必须低于对比层，避免延迟创建后以
      // 相同层级覆盖纯白隔离合成的淡青轮廓。
      '2147483646',
      '',
    );
    // 首个完整帧成功前保持旧 Canvas 可见，避免资源创建时闪烁。
    canvas.style.display = 'none';
    this.overlayParent.appendChild(canvas);

    let renderer = null;

    try
    {
      renderer = new WebGL2CanvasSceneRenderer(canvas);

      if (!renderer.available)
      {
        this.canvasSceneUnavailable = true;
        renderer.destroy();
        canvas.remove();
        return false;
      }

      const compositingReference = this.compositingReferenceSource;

      if (compositingReference !== null)
      {
        const referenceReady = renderer.setCompositingReference(
          compositingReference,
          { fit: this.compositingReferenceFit },
        );

        if (!referenceReady)
        {
          this.canvasSceneUnavailable = true;
          renderer.destroy();
          canvas.remove();
          return false;
        }
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] Canvas Scene Final Pass 创建失败:', error);
      this.canvasSceneUnavailable = true;
      renderer?.destroy();
      canvas.remove();
      return false;
    }

    this.canvasSceneCanvas = canvas;
    this.canvasSceneRenderer = renderer;
    canvas.addEventListener(
      'webglcontextlost',
      this._onCanvasSceneContextLost,
    );
    canvas.addEventListener(
      'webglcontextrestored',
      this._onCanvasSceneContextRestored,
    );
    return true;
  }

  _resizeCanvasSceneRenderer()
  {
    return !!this.canvasSceneRenderer?.resize(
      this.width,
      this.height,
      this.dpr,
    );
  }

  _prepareCanvasSceneBackend(useGpuClickEffects, bloomBackend)
  {
    if (
      useGpuClickEffects ||
      bloomBackend !== 'native' ||
      !this._hasCompositingReference()
    )
    {
      return false;
    }

    return this._ensureCanvasSceneRenderer() &&
      this._resizeCanvasSceneRenderer() &&
      this.canvasSceneRenderer.hasSceneBackground;
  }

  _setCanvasSceneVisible(visible)
  {
    if (!this.canvasSceneCanvas)
    {
      const changed = this.canvasSceneVisible;

      this.canvasSceneVisible = false;

      if (changed)
      {
        this._requestCompositingMountRefresh();
      }
      return;
    }

    if (this.canvasSceneVisible === visible)
    {
      return;
    }

    this.canvasSceneVisible = visible;
    this.canvasSceneCanvas.style.display = visible ? '' : 'none';

    if (!visible)
    {
      this.canvasSceneRenderer?.clear();
    }

    this._requestCompositingMountRefresh();
  }

  _destroyCanvasSceneRenderer()
  {
    this.canvasSceneCanvas?.removeEventListener(
      'webglcontextlost',
      this._onCanvasSceneContextLost,
    );
    this.canvasSceneCanvas?.removeEventListener(
      'webglcontextrestored',
      this._onCanvasSceneContextRestored,
    );
    this.canvasSceneRenderer?.destroy();
    this.canvasSceneCanvas?.remove();
    this.canvasSceneRenderer = null;
    this.canvasSceneCanvas = null;
    this.canvasSceneVisible = false;
  }

  _destroyWebGLBloomRenderer()
  {
    this.webglBloomCanvas?.removeEventListener(
      'webglcontextlost',
      this._onWebGLContextLost,
    );
    this.webglBloomCanvas?.removeEventListener(
      'webglcontextrestored',
      this._onWebGLContextRestored,
    );
    this.webglBloomRenderer?.destroy();
    this.webglBloomCanvas?.remove();
    this.webglBloomRenderer = null;
    this.webglBloomCanvas = null;
    this.webglBloomVisible = false;
  }

  _ensureWebGLBloomRenderer()
  {
    if (this.webglBloomRenderer)
    {
      return this.webglBloomRenderer.available;
    }

    if (
      this.webglBloomUnavailable ||
      !this.ownsCanvas ||
      !this.overlayParent
    )
    {
      return false;
    }

    const canvas = createCanvas();

    // WebGL2 Bloom 复用完整 Scene Renderer，确保清晰层和 Bloom 只经过
    // 一次线性到 sRGB 的最终输出，不再交给浏览器拆成两个图层合成。
    setOverlayStyle(
      canvas,
      !this.host && !this.config.isolatedCompositing,
      '2147483646',
      '',
    );
    canvas.style.display = 'none';
    this.overlayParent.appendChild(canvas);

    let renderer = null;

    try
    {
      renderer = new WebGL2EffectRenderer(canvas);

      // Context 与 Program 初始化失败才是永久故障；当前尺寸分配失败仍可缩小恢复。
      if (!renderer.available)
      {
        this.webglBloomUnavailable = true;
        renderer.destroy();
        canvas.remove();
        return false;
      }

      const compositingReference = this.compositingReferenceSource;

      if (compositingReference !== null)
      {
        const referenceReady = renderer.setCompositingReference(
          compositingReference,
          { fit: this.compositingReferenceFit },
        );

        if (!referenceReady)
        {
          this.webglBloomUnavailable = true;
          renderer.destroy();
          canvas.remove();
          return false;
        }
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL2 Bloom 创建失败，回退软件 Bloom:', error);
      this.webglBloomUnavailable = true;
      renderer?.destroy();
      canvas.remove();
      return false;
    }

    this.webglBloomCanvas = canvas;
    this.webglBloomRenderer = renderer;
    canvas.addEventListener('webglcontextlost', this._onWebGLContextLost);
    canvas.addEventListener('webglcontextrestored', this._onWebGLContextRestored);
    return renderer.available;
  }

  _resizeWebGLBloomRenderer()
  {
    const renderer = this.webglBloomRenderer;

    return !!renderer?.resize(
      this.width,
      this.height,
      this.dpr,
      this.fxConfig.bloom.resolutionScale,
      this.fxConfig.bloom.diffusion,
    );
  }

  _resolveBloomBackend()
  {
    const requested = normalizeBloomBackend(this.config.bloomBackend);

    if (requested === 'native')
    {
      return 'native';
    }

    if (requested === 'software')
    {
      return this.bloomRenderer.available ? 'software' : 'native';
    }

    if (
      this._ensureWebGLBloomRenderer() &&
      this._resizeWebGLBloomRenderer()
    )
    {
      return 'webgl2';
    }

    return 'native';
  }

  _resolveCanvasFallbackBloomBackend()
  {
    // Software 会分配全视口 Float32 金字塔并触发像素回读，只有调用方
    // 明确请求时才允许进入；GPU 自动/故障链统一回退低成本 Native。
    return normalizeBloomBackend(this.config.bloomBackend) === 'software' &&
      this.bloomRenderer?.available
      ? 'software'
      : 'native';
  }

  _setWebGLBloomVisible(visible)
  {
    if (!this.webglBloomCanvas)
    {
      const changed = this.webglBloomVisible;

      this.webglBloomVisible = false;

      if (changed)
      {
        this._requestCompositingMountRefresh();
      }
      return;
    }

    const wasVisible = this.webglBloomVisible;

    if (!visible && wasVisible)
    {
      // 只有当前输出所有者退出时才能恢复 Canvas；隐藏后端丢失上下文
      // 不应干扰纯 WebGL2 或 Canvas Final Pass 的可见层。
      this._setCanvasOutputVisible(true);
    }

    if (this.webglBloomVisible === visible)
    {
      return;
    }

    this.webglBloomVisible = visible;
    this.webglBloomCanvas.style.display = visible ? '' : 'none';

    if (!visible)
    {
      this.webglBloomRenderer?.clear();
    }

    this._requestCompositingMountRefresh();
  }

  _setCanvasOutputVisible(visible)
  {
    if (!this.ownsCanvas)
    {
      return;
    }

    const visibility = visible ? '' : 'hidden';

    // 使用 visibility 保留 Canvas 尺寸和内容，WebGL 失败时无需重建回退帧。
    this.canvas.style.visibility = visibility;

    if (this.contrastCanvas)
    {
      const contrastEnabled =
        this.config.outputCompositing !== 'browser-overlay' &&
        this.config.lightBackgroundContrastAlpha > 0;

      // 普通场景继续跟随主 Canvas 的输出所有权；启用淡青轮廓后则由
      // 独立层保持可见，避免 GPU 或 Scene Final Pass 隐藏主层时一并消失。
      this.contrastCanvas.style.visibility =
        visible || contrastEnabled ? '' : 'hidden';
    }
  }

  _invalidateSceneBackgroundOutputs()
  {
    this._setWebGPUEffectVisible(false);
    this._setWebGLEffectVisible(false);
    this._setWebGLBloomVisible(false);
    this._setCanvasSceneVisible(false);
    this.webglEffectRenderer?.clear();
    this.webglBloomRenderer?.clear();
    this.canvasSceneRenderer?.clear();

    if (this.context)
    {
      this.context.save();
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.context.clearRect(0, 0, this.width, this.height);
      this.context.restore();
    }
    this._clearLightBackgroundContrast();
    // 暂停时不会申请 RAF；同步清空后再恢复 Canvas，避免旧背景残差常驻。
    this._setCanvasOutputVisible(true);
  }

  _releaseBackendFrameResources()
  {
    // 配置事务已经选择了新的渲染链；先撤下所有旧输出，再释放仅与
    // 画布尺寸绑定的目标。下一帧只会为实际接管输出的后端重新分配。
    this._setWebGPUEffectVisible(false);
    this._setWebGLEffectVisible(false);
    this._setWebGLBloomVisible(false);
    this._setCanvasSceneVisible(false);
    this.webgpuEffectRenderer?.releaseFrameResources();
    this.webglEffectRenderer?.releaseFrameResources();
    this.webglBloomRenderer?.releaseFrameResources();
    this.canvasSceneRenderer?.releaseFrameResources();
    this._setCanvasOutputVisible(true);
  }

  _releaseBloomBackendFrameResources()
  {
    // 完整 GPU Scene 已接管时，Bloom 配置只是回退策略，不能
    // 为它释放当前 Effect 目标；这里只清理 Canvas 回退链的帧资源。
    this._setWebGLBloomVisible(false);
    this._setCanvasSceneVisible(false);
    this.webglBloomRenderer?.releaseFrameResources();
    this.canvasSceneRenderer?.releaseFrameResources();

    if (!this.webglEffectVisible && !this.webgpuEffectVisible)
    {
      this._setCanvasOutputVisible(true);
    }
  }

  _usesSoftwareBloom()
  {
    return this._resolveBloomBackend() === 'software';
  }

  _getBloomRenderer(index)
  {
    while (this.bloomRenderers.length <= index)
    {
      this.bloomRenderers.push(
        new SoftwareBloomRenderer(() => createCanvas()),
      );
    }

    return this.bloomRenderers[index];
  }

  _trimBloomRendererPool(activeCount, reserve = 2)
  {
    const retainedCount = activeCount === 0
      ? 1
      : Math.max(1, activeCount + reserve);

    if (this.bloomRenderers.length <= retainedCount)
    {
      return;
    }

    const removed = this.bloomRenderers.splice(retainedCount);

    for (const renderer of removed)
    {
      renderer.destroy();
    }
  }

  _getNativeTrailBloomSurface()
  {
    if (this.nativeTrailBloomSurface === undefined)
    {
      const canvas = createCanvas();
      const context = canvas.getContext('2d');

      // 原生辉光只在首次回退或显式选择时分配缓冲。
      this.nativeTrailBloomSurface = context
        ? { canvas, context, dpr: this.dpr }
        : null;
    }

    if (this.nativeTrailBloomSurface)
    {
      this.nativeTrailBloomSurface.dpr = this.dpr;
    }

    return this.nativeTrailBloomSurface;
  }

  _renderLightBackgroundContrast(scale, reuseMainCanvas = false)
  {
    const context = this.contrastContext;

    if (!context || !this.contrastCanvas)
    {
      return;
    }

    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);

    if (
      this.config.outputCompositing === 'browser-overlay' ||
      this.config.lightBackgroundContrastAlpha <= 0
    )
    {
      // 桌面透明模式的 Alpha 合同已经提供可见度；额外 darken 层只会遮挡宿主。
      return;
    }

    if (reuseMainCanvas)
    {
      // 软件 Bloom 合成前，主 Canvas 只包含清晰本体。直接复制其 Alpha 遮罩，
      // 与重新绘制同一套几何等价，并省去圆环渐变与拖尾的第二次构建。
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = 'source-over';
      context.drawImage(this.canvas, 0, 0);
      context.restore();
    }
    else
    {
      context.save();
      context.globalCompositeOperation = 'lighter';

      for (const stroke of this.trailStrokes)
      {
        if (stroke.points.length >= 2)
        {
          drawTrail(
            context,
            stroke.points,
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
            false,
            false,
            null,
            stroke.trailFrameData,
          );
        }
      }

      for (const wave of this.waves)
      {
        wave.drawBase(
          context,
          scale,
          this._getEffectiveOpacity(),
          false,
          this.config.outputCompositing,
          this.dpr,
        );
      }

      for (const shard of this.shards)
      {
        shard.draw(
          context,
          scale,
          this._getEffectiveOpacity(),
          this.fxConfig,
        );
      }

      for (const wave of this.waves)
      {
        wave.drawRings(
          context,
          scale,
          this._getEffectiveOpacity(),
          false,
          false,
          null,
          this.dpr,
          this.config.outputCompositing,
        );
      }

      context.restore();
    }
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = colorToCss(
      LIGHT_BACKGROUND_CONTRAST_COLOR,
      this.config.lightBackgroundContrastAlpha,
    );
    context.fillRect(0, 0, this.contrastCanvas.width, this.contrastCanvas.height);
    context.restore();
  }

  _getSoftwareBloomRegions(scale)
  {
    const bloomCfg = this.fxConfig.bloom;
    const diffusion = bloomCfg.diffusion;
    // 区域必须覆盖卷积核完整支撑范围，否则边界会把光晕切成硬边。
    const padding = 2 ** diffusion * scale + 8;
    const regions = [];
    const addRegion = (
      minimumX,
      minimumY,
      maximumX,
      maximumY,
      wave,
      trailBatches = [],
      shards = [],
    ) =>
    {
      mergeBloomRegion(
        regions,
        {
          x: minimumX - padding,
          y: minimumY - padding,
          width: maximumX - minimumX + padding * 2,
          height: maximumY - minimumY + padding * 2,
          emissionBounds:
          {
            x: minimumX,
            y: minimumY,
            width: maximumX - minimumX,
            height: maximumY - minimumY,
          },
          waves: wave ? [wave] : [],
          trailBatches,
          shards,
        },
      );
    };

    for (const wave of this.waves)
    {
      if (wave.fx.bloom.clickEmissionScale <= 0)
      {
        continue;
      }

      const diskProgress = wave.ageMs / this.fxConfig.disk.lifetimeMs;
      const ringProgress = wave.ageMs / this.fxConfig.rings.lifetimeMs;
      let sourceRadius = diskProgress < 1
        ? this.fxConfig.disk.radius * evaluateUnityHermiteCurve(
          this.fxConfig.disk.sizeKeys,
          diskProgress,
        ) * scale
        : 0;

      if (ringProgress < 1)
      {
        for (const ring of wave.rings)
        {
          const geometry = resolveRingGeometry(
            ring,
            ringProgress,
            scale,
            this.fxConfig.rings,
          );

          sourceRadius = Math.max(
            sourceRadius,
            geometry.radius + geometry.width * 0.5,
          );
        }
      }

      if (sourceRadius <= 0)
      {
        continue;
      }

      addRegion(
        wave.x - sourceRadius,
        wave.y - sourceRadius,
        wave.x + sourceRadius,
        wave.y + sourceRadius,
        wave,
        [],
      );
    }

    const trailRadius = Math.max(
      1,
      this.fxConfig.trail.geometryWidth * scale *
        bloomCfg.trailCoverageScale * 0.5,
    );

    for (const stroke of this.trailStrokes)
    {
      if (stroke.points.length < 2)
      {
        continue;
      }

      const trailData = stroke.trailFrameData ?? createTrailFrameData(
        stroke.points,
        this.fxConfig.trail,
        bloomCfg.trailEmission,
      );
      const trailOpacity = this._getEffectiveOpacity() *
        (this.fxConfig.trail.trailOpacity ?? 1) *
        bloomCfg.trailEmissionAlpha;
      const emissionQuantizationScale = trailOpacity /
        Math.max(1, bloomCfg.emissionRange) * 255;
      const bloomRuns = [];
      let activeRun = null;

      for (let index = 1; index < stroke.points.length; index++)
      {
        // 只排除写入 8 位发射遮罩后所有通道都严格量化为 0 的段。
        // 不能按 Bloom 阈值提前裁剪：多个微弱发射源叠加后仍可能越过阈值。
        if (
          trailData.segmentMaximumEnergies[index - 1] *
            emissionQuantizationScale < 0.5
        )
        {
          if (activeRun)
          {
            bloomRuns.push(activeRun);
            activeRun = null;
          }

          continue;
        }

        const previousPoint = stroke.points[index - 1];
        const point = stroke.points[index];

        if (!activeRun)
        {
          activeRun = {
            firstSegment: index,
            lastSegment: index,
            minimumX: Math.min(previousPoint.x, point.x),
            minimumY: Math.min(previousPoint.y, point.y),
            maximumX: Math.max(previousPoint.x, point.x),
            maximumY: Math.max(previousPoint.y, point.y),
          };
          continue;
        }

        activeRun.lastSegment = index;
        activeRun.minimumX = Math.min(
          activeRun.minimumX,
          previousPoint.x,
          point.x,
        );
        activeRun.minimumY = Math.min(
          activeRun.minimumY,
          previousPoint.y,
          point.y,
        );
        activeRun.maximumX = Math.max(
          activeRun.maximumX,
          previousPoint.x,
          point.x,
        );
        activeRun.maximumY = Math.max(
          activeRun.maximumY,
          previousPoint.y,
          point.y,
        );
      }

      if (activeRun)
      {
        bloomRuns.push(activeRun);
      }

      if (bloomRuns.length > 0)
      {
        const minimumX = Math.min(...bloomRuns.map((run) => run.minimumX));
        const minimumY = Math.min(...bloomRuns.map((run) => run.minimumY));
        const maximumX = Math.max(...bloomRuns.map((run) => run.maximumX));
        const maximumY = Math.max(...bloomRuns.map((run) => run.maximumY));

        addRegion(
          minimumX - trailRadius,
          minimumY - trailRadius,
          maximumX + trailRadius,
          maximumY + trailRadius,
          null,
          bloomRuns.map((run) =>
          ({
            stroke,
            firstSegment: run.firstSegment,
            lastSegment: run.lastSegment,
          })),
        );
      }
    }

    for (const shard of this.shards)
    {
      const shardCfg = this.fxConfig.shards;
      const progress = clamp01(shard.ageMs / shard.lifetimeMs);
      const size = shard.size * evaluateUnityHermiteCurve(
        shardCfg.sizeKeys,
        progress,
      ) * scale;

      if (size <= 0)
      {
        continue;
      }

      addRegion(
        shard.x - size,
        shard.y - size,
        shard.x + size,
        shard.y + size,
        null,
        [],
        [shard],
      );
    }

    if (regions.length === 0)
    {
      return [];
    }

    // 局部 mip 的最低层会把低频能量铺满裁剪区域，在浅色背景上形成矩形。
    // 软件后端改用单个全视口金字塔，让能量在真实画面边界内自然扩散。
    return [
      {
        x: 0,
        y: 0,
        width: this.width,
        height: this.height,
        emissionBounds: combineBloomRegionBounds(
          regions.map((region) => region.emissionBounds),
        ),
        waves: regions.flatMap((region) => region.waves),
        trailBatches: regions.flatMap((region) => region.trailBatches),
        shards: regions.flatMap((region) => region.shards),
      },
    ];
  }

  _getCanvasOverlayBounds(scale)
  {
    const bounds = [];
    const addBounds = (minimumX, minimumY, maximumX, maximumY) =>
    {
      if (
        !Number.isFinite(minimumX) ||
        !Number.isFinite(minimumY) ||
        !Number.isFinite(maximumX) ||
        !Number.isFinite(maximumY) ||
        maximumX < minimumX ||
        maximumY < minimumY
      )
      {
        return;
      }

      bounds.push(
        {
          x: minimumX,
          y: minimumY,
          width: maximumX - minimumX,
          height: maximumY - minimumY,
        },
      );
    };
    const bloomCfg = this.fxConfig.bloom;

    for (const wave of this.waves)
    {
      let radius = 0;
      const hitProgress = wave.ageMs / wave.fx.hit.lifetimeMs;
      const flareProgress = wave.ageMs / wave.fx.flare.lifetimeMs;
      const diskProgress = wave.ageMs / wave.fx.disk.lifetimeMs;
      const ringProgress = wave.ageMs / wave.fx.rings.lifetimeMs;

      if (wave.fx.hit.enabled && hitProgress < 1)
      {
        radius = Math.max(radius, wave.fx.hit.radius * scale);
      }

      if (wave.fx.flare.enabled && flareProgress < 1)
      {
        radius = Math.max(radius, wave.fx.flare.radius * scale);
      }

      if (diskProgress < 1)
      {
        const diskRadius = wave.fx.disk.radius * evaluateUnityHermiteCurve(
          wave.fx.disk.sizeKeys,
          diskProgress,
        ) * scale;
        // Canvas blur 的实现支撑范围没有标准化；三倍配置半径覆盖所有
        // 可能高于网页 Alpha 上限的像素，同时保持回读区域局部化。
        const diskBlur = bloomCfg.diskAlpha > 0
          ? bloomCfg.diskBlur * scale * 3
          : 0;

        radius = Math.max(radius, diskRadius + diskBlur);
      }

      if (ringProgress < 1)
      {
        const ringBlur = bloomCfg.ringAlpha > 0
          ? bloomCfg.ringBlur * scale * 3
          : 0;

        for (const ring of wave.rings)
        {
          const geometry = resolveRingGeometry(
            ring,
            ringProgress,
            scale,
            wave.fx.rings,
          );

          radius = Math.max(
            radius,
            geometry.radius + geometry.width * 0.5 + ringBlur,
          );
        }
      }

      if (radius > 0)
      {
        addBounds(
          wave.x - radius,
          wave.y - radius,
          wave.x + radius,
          wave.y + radius,
        );
      }
    }

    for (const shard of this.shards)
    {
      const progress = clamp01(shard.ageMs / shard.lifetimeMs);
      const size = shard.size * evaluateUnityHermiteCurve(
        this.fxConfig.shards.sizeKeys,
        progress,
      ) * scale;

      if (size > 0)
      {
        // 纹理 Quad 的实际半径是 size/2；保守使用完整 size 容纳旋转。
        addBounds(
          shard.x - size,
          shard.y - size,
          shard.x + size,
          shard.y + size,
        );
      }
    }

    const trailCfg = this.fxConfig.trail;
    const trailMargin = Math.max(
      trailCfg.width * scale * 0.5,
      trailCfg.outerGlowWidth * scale * 3 + 2,
    );

    for (const stroke of this.trailStrokes)
    {
      if (stroke.points.length < 2)
      {
        continue;
      }

      let minimumX = Infinity;
      let minimumY = Infinity;
      let maximumX = -Infinity;
      let maximumY = -Infinity;

      for (const point of stroke.points)
      {
        minimumX = Math.min(minimumX, point.x);
        minimumY = Math.min(minimumY, point.y);
        maximumX = Math.max(maximumX, point.x);
        maximumY = Math.max(maximumY, point.y);
      }

      addBounds(
        minimumX - trailMargin,
        minimumY - trailMargin,
        maximumX + trailMargin,
        maximumY + trailMargin,
      );
    }

    return combineBloomRegionBounds(bounds);
  }

  _getCanvasOverlayPixelBounds(scale)
  {
    const bounds = this._getCanvasOverlayBounds(scale);

    if (!bounds)
    {
      return null;
    }

    const minimumX = Math.max(0, Math.floor(bounds.x * this.dpr));
    const minimumY = Math.max(0, Math.floor(bounds.y * this.dpr));
    const maximumX = Math.min(
      this.canvas.width,
      Math.ceil((bounds.x + bounds.width) * this.dpr),
    );
    const maximumY = Math.min(
      this.canvas.height,
      Math.ceil((bounds.y + bounds.height) * this.dpr),
    );

    return {
      minimumX,
      minimumY,
      maximumX,
      maximumY,
      width: Math.max(0, maximumX - minimumX),
      height: Math.max(0, maximumY - minimumY),
    };
  }

  _captureCanvasOverlayAlpha(scale)
  {
    if (
      this._getOverlayAlphaPolicy() !== 'visual-max' ||
      typeof this.context?.getImageData !== 'function'
    )
    {
      return null;
    }

    const bounds = this._getCanvasOverlayPixelBounds(scale);

    if (!bounds || bounds.width <= 0 || bounds.height <= 0)
    {
      return null;
    }

    try
    {
      return {
        ...bounds,
        data: this.context.getImageData(
          bounds.minimumX,
          bounds.minimumY,
          bounds.width,
          bounds.height,
        ).data,
      };
    }
    catch
    {
      return null;
    }
  }

  _prepareCanvasBloomTransportContext()
  {
    if (this._getOverlayAlphaPolicy() !== 'visual-max')
    {
      return null;
    }

    if (!this.canvasBloomTransportCanvas)
    {
      const canvas = createCanvas();
      const context = canvas?.getContext?.(
        '2d',
        {
          alpha: true,
          willReadFrequently: true,
        },
      );

      if (!canvas || !context)
      {
        return null;
      }

      this.canvasBloomTransportCanvas = canvas;
      this.canvasBloomTransportContext = context;
    }

    const canvas = this.canvasBloomTransportCanvas;
    const context = this.canvasBloomTransportContext;

    if (
      canvas.width !== this.canvas.width ||
      canvas.height !== this.canvas.height
    )
    {
      canvas.width = this.canvas.width;
      canvas.height = this.canvas.height;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // 多个 Bloom 区域与主 Canvas 使用相同的累计规则；超过 1 的部分对
    // 最终不高于 1 的 Alpha 容量没有额外信息价值。
    context.globalCompositeOperation = 'lighter';
    return context;
  }

  _limitCanvasOverlayAlpha(
    scale,
    sceneAlphaSnapshot = null,
    bloomTransportContext = null,
    bloomCompositing = 'lighter',
    applyColorCompensation = true,
  )
  {
    const overlayAlphaPolicy = this._getOverlayAlphaPolicy();
    const overlayColorCompensation = this._getOverlayColorCompensation();
    const overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit();
    const compensateBrightCore =
      overlayColorCompensation === 'bright-core';
    const adjustAlpha = overlayAlphaPolicy === 'visual-max' ||
      overlayAlphaLimit < 1;

    if (
      !this._usesUnknownBrowserOverlay() ||
      this._usesIndependentHostPayload() ||
      (!adjustAlpha && !compensateBrightCore) ||
      this.webgpuEffectVisible ||
      this.webglEffectVisible ||
      this.webglBloomVisible ||
      this.canvasSceneVisible ||
      (this.ownsCanvas && this.canvas.style.visibility === 'hidden')
    )
    {
      return;
    }

    const bounds = this._getCanvasOverlayPixelBounds(scale);

    if (!bounds || bounds.width <= 0 || bounds.height <= 0)
    {
      return;
    }

    try
    {
      const imageData = this.context.getImageData(
        bounds.minimumX,
        bounds.minimumY,
        bounds.width,
        bounds.height,
      );

      if (overlayAlphaPolicy === 'visual-max')
      {
        const matchingSnapshot = sceneAlphaSnapshot &&
          sceneAlphaSnapshot.minimumX === bounds.minimumX &&
          sceneAlphaSnapshot.minimumY === bounds.minimumY &&
          sceneAlphaSnapshot.width === bounds.width &&
          sceneAlphaSnapshot.height === bounds.height
          ? sceneAlphaSnapshot.data
          : null;
        const bloomTransportData = bloomTransportContext
          ? bloomTransportContext.getImageData(
            bounds.minimumX,
            bounds.minimumY,
            bounds.width,
            bounds.height,
          ).data
          : null;

        applyOverlayAlphaPolicyToImageData(
          imageData,
          matchingSnapshot,
          bloomTransportData,
          overlayAlphaLimit,
          overlayAlphaPolicy,
          bloomCompositing,
        );
      }
      else if (overlayAlphaLimit < 1)
      {
        const maximumAlpha = Math.round(
          clamp01(overlayAlphaLimit) * 255,
        );

        for (let index = 3; index < imageData.data.length; index += 4)
        {
          imageData.data[index] = Math.min(
            imageData.data[index],
            maximumAlpha,
          );
        }
      }

      if (applyColorCompensation)
      {
        applyOverlayColorCompensationToImageData(
          imageData,
          overlayColorCompensation,
          this._getEffectiveOpacity(),
        );
      }
      this.context.putImageData(
        imageData,
        bounds.minimumX,
        bounds.minimumY,
      );
      return;
    }
    catch
    {
      // 受污染 Canvas 无法回读时保留颜色；Coverage 仍尽力执行原 Alpha 上限。
    }

    if (overlayAlphaPolicy === 'visual-max')
    {
      return;
    }

    // getImageData 使用物理像素；只处理活跃特效脏区，避免 Native
    // 回退为了一个 Alpha 上限读取整个视口。
    limitCanvasAlpha(
      this.context,
      {
        minimumX: bounds.minimumX,
        minimumY: bounds.minimumY,
        maximumX: bounds.maximumX - 1,
        maximumY: bounds.maximumY - 1,
      },
      overlayAlphaLimit,
    );
  }

  _getSoftwareBloomFrameSignature(scale)
  {
    const trailSignature = this.trailStrokes.map((stroke) =>
    {
      const first = stroke.points[0];
      const last = stroke.points.at(-1);

      return [
        stroke.points.length,
        first?.x,
        first?.y,
        first?.bornAt,
        last?.x,
        last?.y,
        last?.bornAt,
      ].join(',');
    }).join('|');
    const waveSignature = this.waves.map((wave) =>
      [
        wave.x,
        wave.y,
        wave.ageMs,
        wave.diskRotation,
        ...wave.rings.flatMap((ring) =>
          [ring.radius, ring.rotation, ring.angularVelocity]),
      ].join(',')).join('|');
    const shardSignature = this.shards.map((shard) =>
      [
        shard.kind,
        shard.x,
        shard.y,
        shard.ageMs,
        shard.rotation,
        shard.size,
        shard.textureFrame,
      ].join(',')).join('|');
    const bloomCfg = this.fxConfig.bloom;
    const trailCfg = this.fxConfig.trail;

    return [
      this.width,
      this.height,
      this.dpr,
      scale,
      this.clickTimeMs,
      this.trailTimeMs,
      this._getEffectiveOpacity(),
      this.config.outputCompositing,
      this._getOverlayColorCompensation(),
      this._getEffectiveOverlayAlphaLimit(),
      this._getEffectiveHostCompositing(),
      this.compositingReferenceSource === null ? 'unknown' : 'known',
      this.config.themeColorMode,
      this.config.themeColor,
      this._themeHueShift,
      bloomCfg.threshold,
      bloomCfg.softKnee,
      bloomCfg.intensity,
      bloomCfg.diffusion,
      bloomCfg.resolutionScale,
      bloomCfg.trailEmission,
      bloomCfg.trailEmissionAlpha,
      trailCfg.width,
      trailCfg.geometryWidth,
      JSON.stringify(this.fxConfig),
      trailSignature,
      waveSignature,
      shardSignature,
    ].join(':');
  }

  _cacheSoftwareBloomFrame(scale)
  {
    if (
      this.config.outputCompositing !== 'browser-overlay' ||
      this.canvas.width <= 0 ||
      this.canvas.height <= 0
    )
    {
      return;
    }

    const previousCanvas = this.lastSoftwareBloomFrame?.canvas;
    const canvas = previousCanvas && previousCanvas !== this.canvas
      ? previousCanvas
      : createCanvas();
    const context = canvas.getContext?.('2d', { alpha: true });

    if (!context)
    {
      this.lastSoftwareBloomFrame = null;
      return;
    }

    try
    {
      if (
        canvas.width !== this.canvas.width ||
        canvas.height !== this.canvas.height
      )
      {
        canvas.width = this.canvas.width;
        canvas.height = this.canvas.height;
      }

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      // 软件输出已按透明容量收敛。冻结主画布而非 renderer 工作面，才能在
      // 回读故障后同时保留清晰层与 Bloom 的最终预乘 Alpha。
      context.drawImage(
        this.canvas,
        0,
        0,
        this.canvas.width,
        this.canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    }
    catch
    {
      this.lastSoftwareBloomFrame = null;
      return;
    }

    this.lastSoftwareBloomFrame = {
      canvas,
      height: canvas.height,
      signature: this._getSoftwareBloomFrameSignature(scale),
      width: canvas.width,
    };
  }

  _drawCachedSoftwareBloomFrame(scale)
  {
    const frame = this.lastSoftwareBloomFrame;

    if (
      !frame?.canvas ||
      frame.signature !== this._getSoftwareBloomFrameSignature(scale)
    )
    {
      return false;
    }

    try
    {
      this.context.save();
      this.context.setTransform(1, 0, 0, 1, 0, 0);
      this.context.globalAlpha = 1;
      // 快照覆盖完整主画布，copy 不会再次按 source-over/lighter 叠加 Alpha。
      this.context.globalCompositeOperation = 'copy';

      this.context.drawImage(
        frame.canvas,
        0,
        0,
        frame.width,
        frame.height,
        0,
        0,
        this.canvas.width,
        this.canvas.height,
      );
      this.context.restore();
      return true;
    }
    catch
    {
      this.context.restore();
      return false;
    }
  }

  _hasCachedSoftwareBloomFrame(scale)
  {
    return this.config.outputCompositing === 'browser-overlay' &&
      this.lastSoftwareBloomFrame?.canvas !== undefined &&
      this.lastSoftwareBloomFrame.signature ===
        this._getSoftwareBloomFrameSignature(scale);
  }

  _renderSoftwareBloom(scale)
  {
    const bloomCfg = this.fxConfig.bloom;
    const diffusion = bloomCfg.diffusion;
    const regions = this._getSoftwareBloomRegions(scale);
    const combinedBounds = combineBloomRegionBounds(regions);
    const sceneAlphaSnapshot = this._captureCanvasOverlayAlpha(scale);
    const bloomTransportContext =
      this._prepareCanvasBloomTransportContext();
    const settings = {
      encodingRange: bloomCfg.emissionRange,
      threshold: bloomCfg.threshold,
      softKnee: bloomCfg.softKnee,
      clamp: bloomCfg.clamp,
      intensity: bloomCfg.intensity,
      diffusion,
      opacity: this._getEffectiveOpacity(),
      outputCompositing: this.config.outputCompositing,
      // Canvas 在清晰层与 Bloom 聚合后统一补偿，避免各层重复混色。
      overlayColorCompensation: 'none',
      overlayAlphaPolicy: this._getOverlayAlphaPolicy(),
      overlayAlphaLimit: this._getEffectiveOverlayAlphaLimit(),
      hostCompositing: this._getEffectiveHostCompositing(),
      enforceOverlayAlphaLimit:
        this._usesUnknownBrowserOverlay(),
    };
    let processedSourcePixels = 0;
    let failed = false;

    for (let index = 0; index < regions.length; index++)
    {
      const region = regions[index];
      const renderer = this._getBloomRenderer(index);
      const bloomContext = renderer.beginFrame(
        this.width,
        this.height,
        bloomCfg.resolutionScale,
        region,
        diffusion,
        this.dpr,
        region.emissionBounds,
      );

      if (!bloomContext)
      {
        if (!renderer.available)
        {
          // 像素回读失败后，下一帧统一切换原生回退。
          this.bloomRenderer.available = false;
          failed = true;
        }

        continue;
      }

      const coverageContext = renderer.beginCoverageFrame(
        this.config.outputCompositing,
      );

      processedSourcePixels += renderer.sourceWidth * renderer.sourceHeight;
      bloomContext.save();

      for (const batch of region.trailBatches)
      {
        const stroke = batch.stroke;

        if (stroke.points.length >= 2)
        {
          drawTrailEmission(
            bloomContext,
            stroke.points,
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
            stroke.trailFrameData,
            batch.firstSegment,
            batch.lastSegment,
          );
        }
      }

      for (const wave of region.waves)
      {
        wave.drawBloom(bloomContext, scale, this._getEffectiveOpacity());
      }

      for (const shard of region.shards)
      {
        shard.drawBloom(
          bloomContext,
          scale,
          this._getEffectiveOpacity(),
          this.fxConfig,
        );
      }

      bloomContext.restore();

      if (coverageContext)
      {
        coverageContext.save();

        for (const batch of region.trailBatches)
        {
          const stroke = batch.stroke;

          if (stroke.points.length >= 2)
          {
            drawTrailCoverage(
              coverageContext,
              stroke.points,
              scale,
              this._getEffectiveOpacity(),
              this.fxConfig,
              stroke.trailFrameData,
              batch.firstSegment,
              batch.lastSegment,
            );
          }
        }

        for (const wave of region.waves)
        {
          wave.drawBloomCoverage(
            coverageContext,
            scale,
            this._getEffectiveOpacity(),
          );
        }

        for (const shard of region.shards)
        {
          shard.drawBloomCoverage(
            coverageContext,
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
          );
        }

        coverageContext.restore();
      }

      let compositeSucceeded = false;

      this.context.save();

      try
      {
        if (this.config.outputCompositing === 'browser-overlay')
        {
          // Bloom ImageData 已按清晰层剩余 Alpha 容量编码；lighter 同时
          // 累加预乘 RGB 与传输 Alpha，避免 source-over 吞掉已有清晰能量。
          this.context.globalCompositeOperation = 'lighter';
        }

        compositeSucceeded = renderer.composite(this.context, settings);

        if (compositeSucceeded && bloomTransportContext)
        {
          renderer.drawCurrentOutput(bloomTransportContext);
        }
      }
      finally
      {
        this.context.restore();
      }

      if (!compositeSucceeded)
      {
        this.bloomRenderer.available = false;
        failed = true;
      }
    }

    if (!failed)
    {
      // Software Bloom 需要在本阶段提交 visual-max 的 Alpha；颜色补偿延后到
      // 帧收尾且只执行一次，避免 Bloom 与清晰层连续抬高同一核心。
      this._limitCanvasOverlayAlpha(
        scale,
        sceneAlphaSnapshot,
        bloomTransportContext,
        'lighter',
        false,
      );
      this._cacheSoftwareBloomFrame(scale);
    }

    this.softwareBloomFrameStats = {
      regionCount: regions.length,
      processedSourcePixels,
      combinedBoundsPixels: combinedBounds
        ? Math.max(1, Math.round(combinedBounds.width * this.dpr)) *
          Math.max(1, Math.round(combinedBounds.height * this.dpr))
        : 0,
    };
    // 全视口模式固定只保留一个 Software Bloom renderer。
    this._trimBloomRendererPool(regions.length);

    if (failed)
    {
      const hasCachedSoftwareBloom = this._hasCachedSoftwareBloomFrame(scale);

      // 即使同一时刻可以复用软件结果，也必须完成一次 Native 重画。这样下一
      // 帧输入变化时，局部缓冲已经准备好，不会把回读故障变成第二次分配抖动。
      this._drawCanvasFallbackFrame(scale, true, false);

      if (hasCachedSoftwareBloom)
      {
        // Native 先完成生命周期切换，再清掉近似层并复用同输入的已完成输出。
        // 缓存失效或无法绘制时则保留刚才的 Native 帧。
        this._drawCanvasFallbackFrame(scale, false, false);

        if (!this._drawCachedSoftwareBloomFrame(scale))
        {
          this._drawCanvasFallbackFrame(scale, true, false);
        }
      }

      this._renderLightBackgroundContrast(scale, false);
      this._setResolvedBloomBackend('native');
    }
  }

  _renderWebGL2Scene(renderer, scale)
  {
    const bloomCfg = this.fxConfig.bloom;

    if (!renderer?.available || renderer.contextLost)
    {
      return false;
    }

    const hasVisibleTrail = this.trailStrokes.some(
      (stroke) => stroke.points.length >= 2,
    );

    if (
      !hasVisibleTrail &&
      this.waves.length === 0 &&
      this.shards.length === 0
    )
    {
      renderer.clear();
      return true;
    }

    try
    {
      renderer.beginFrame();

      // 原游戏将 2px HDR TrailRenderer 与点击粒子写入同一 Scene，
      // 后续 Bloom 必须从这份完整 HDR 颜色缓冲统一提取。
      for (const stroke of this.trailStrokes)
      {
        if (stroke.points.length < 2)
        {
          continue;
        }

        appendTrailWebGLScene(
          renderer,
          stroke.points,
          scale,
          this._getEffectiveOpacity(),
          this.fxConfig,
          stroke.trailFrameData,
        );
      }

      // Cross2 使用 One / OneMinusSrcAlpha，必须先于普通加色粒子提交。
      for (const wave of this.waves)
      {
        wave.appendWebGLSceneDiskLayer(
          renderer,
          scale,
          this._getEffectiveOpacity(),
        );
      }

      // Dissolve MeshTri 与 Cross2、Trail 同为 4499，先完成这一队列。
      for (const wave of this.waves)
      {
        wave.appendWebGLSceneAdditiveLayer(
          renderer,
          scale,
          this._getEffectiveOpacity(),
        );
      }

      // Tri2 的 RenderQueue=4550，必须在全部 4499 材质之后提交。
      for (const shard of this.shards)
      {
        shard.appendWebGLScene(
          renderer,
          scale,
          this._getEffectiveOpacity(),
          this.fxConfig,
        );
      }

      if (!renderer.renderScene(
        {
          outputCompositing: this.config.outputCompositing,
          hostCompositing: this._getEffectiveHostCompositing(),
          // Unity 默认倍率为 1；偏离默认值时 renderer 只为 Bloom 重绘点击
          // 材质，不能缩放供清晰 Scene 与 Coverage 使用的 HDR 颜色。
          diskEmissionScale: bloomCfg.clickEmissionScale *
            bloomCfg.diskEmissionAlpha,
          ringEmissionScale: bloomCfg.clickEmissionScale *
            bloomCfg.ringEmissionAlpha,
        },
      ))
      {
        return false;
      }

      renderer.beginFrame(
        {
          preserveSceneStats: true,
        },
      );

      const rendered = renderer.render(
        {
          threshold: bloomCfg.threshold,
          softKnee: bloomCfg.softKnee,
          clamp: bloomCfg.clamp,
          intensity: bloomCfg.intensity,
          diffusion: bloomCfg.diffusion,
          opacity: this._getEffectiveOpacity(),
          outputCompositing: this.config.outputCompositing,
          overlayColorCompensation:
            this._getOverlayColorCompensation(),
          overlayAlphaPolicy: this._getOverlayAlphaPolicy(),
          overlayAlphaLimit: this._getEffectiveOverlayAlphaLimit(),
          hostCompositing: this._getEffectiveHostCompositing(),
          webgpuHdrPeak: this.config.webgpuHdrPeak,
          webgpuHdrBrightness: this.config.webgpuHdrBrightness,
          webgpuHdrColorPreservation:
            this.config.webgpuHdrColorPreservation,
          webgpuHdrWhiteCore: this.config.webgpuHdrWhiteCore,
          webgpuHdrWhiteStart: this.config.webgpuHdrWhiteStart,
          webgpuHdrWhiteEnd: this.config.webgpuHdrWhiteEnd,
        },
        { preserveCanvas: true },
      );

      this.webglBloomFrameStats =
      {
        available: renderer.available,
        ...renderer.stats,
      };

      return rendered;
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL2 Scene 渲染失败:', error);
      renderer.clear();
      return false;
    }
  }

  _renderWebGL2ClickEffects(scale)
  {
    return this._renderWebGL2Scene(this.webglEffectRenderer, scale);
  }

  _renderGPUClickEffects(backend, scale)
  {
    if (backend === 'webgl2')
    {
      // 保留既有故障注入和宿主诊断钩子，不改变 WebGL2 可观察调用面。
      return this._renderWebGL2ClickEffects(scale);
    }

    return this._renderWebGL2Scene(this.webgpuEffectRenderer, scale);
  }

  _clearLightBackgroundContrast()
  {
    if (!this.contrastContext)
    {
      return;
    }

    this.contrastContext.setTransform(
      this.dpr,
      0,
      0,
      this.dpr,
      0,
      0,
    );
    this.contrastContext.clearRect(0, 0, this.width, this.height);
  }

  _renderCanvasSceneEffects(scale, useNativeBloom)
  {
    const renderer = this.canvasSceneRenderer;

    if (!renderer?.available || renderer.contextLost)
    {
      return false;
    }

    try
    {
      renderer.beginFrame();
      // 精确 Scene Canvas 保存线性 HDR 发射，连续帧不能继承网页覆盖层的
      // source-over；Unity 的 Additive 与 Dissolve 都要求先按 One/One 累加。
      this.context.globalCompositeOperation = 'lighter';
      this._drawCanvasTrails(scale, useNativeBloom, true);

      // Cross2 是唯一会衰减已有场景颜色的材质，必须在普通加色粒子之前
      // 按旧到新顺序完成本体与 Coverage 提交。
      for (const wave of this.waves)
      {
        wave.drawDiskLayer(
          this.context,
          scale,
          this._getEffectiveOpacity(),
          false,
          this.dpr,
        );
        wave.appendCanvasSceneCoverage(
          renderer,
          scale,
          this._getEffectiveOpacity(),
        );
      }

      if (useNativeBloom)
      {
        // 原生阴影模拟最终 Bloom，必须位于所有 source-over 圆盘之后。
        for (const wave of this.waves)
        {
          wave.drawDiskGlow(
            this.context,
            scale,
            this._getEffectiveOpacity(),
            this.dpr,
          );
        }
      }

      for (const wave of this.waves)
      {
        wave.drawAdditiveBase(
          this.context,
          scale,
          this._getEffectiveOpacity(),
          true,
        );
      }

      // Tri3 与 Cross2、Trail 同为 4499，先完成这一队列。
      this._drawWaveRings(
        scale,
        useNativeBloom,
        true,
        'scene',
        'coverage',
        1,
      );

      // Tri2 的 RenderQueue=4550，必须在全部 4499 材质之后提交。
      for (const shard of this.shards)
      {
        shard.draw(
          this.context,
          scale,
          this._getEffectiveOpacity(),
          this.fxConfig,
        );
      }

      return renderer.render(this.canvas);
    }
    catch (error)
    {
      console.warn('[BAClickFX] Canvas Scene Final Pass 渲染失败:', error);
      renderer.clear();
      return false;
    }
  }

  _drawCanvasFallbackPass(scale, useNativeBloom)
  {
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.context.clearRect(0, 0, this.width, this.height);
    // Context 丢失回退必须沿用正常帧的透明 Coverage 兼容合同。
    this.context.globalCompositeOperation =
      this._getCanvasOutputCompositing() === 'browser-overlay'
        ? 'source-over'
        : 'lighter';
    this._drawCanvasTrails(scale, useNativeBloom);
    this._drawCanvasClickEffects(scale, useNativeBloom);
  }

  _drawCanvasFallbackFrame(scale, useNativeBloom)
  {
    this.canvasNativeSceneAlphaSnapshot = null;

    if (
      useNativeBloom &&
      this._usesUnknownBrowserOverlay() &&
      !this._usesIndependentHostPayload() &&
      this._getOverlayAlphaPolicy() === 'visual-max'
    )
    {
      // Canvas shadowBlur 使用 source-over。先保存无阴影清晰层 Coverage，
      // Final Pass 才能从完整帧 Alpha 精确分离聚合辉光传输量。
      this._drawCanvasFallbackPass(scale, false);
      this.canvasNativeSceneAlphaSnapshot =
        this._captureCanvasOverlayAlpha(scale);
    }

    this._drawCanvasFallbackPass(scale, useNativeBloom);
  }

  _finalizeCanvasOverlayAlpha(scale)
  {
    const sceneAlphaSnapshot = this.canvasNativeSceneAlphaSnapshot;

    this.canvasNativeSceneAlphaSnapshot = null;
    this._limitCanvasOverlayAlpha(
      scale,
      sceneAlphaSnapshot,
      null,
      sceneAlphaSnapshot ? 'source-over' : 'lighter',
    );
  }

  _restoreCanvasOutputAfterContextLoss(bloomBackend)
  {
    const scale = this._getScale();
    const previousHueShift = themeHueShift;
    const previousRelativeOklchTheme = relativeOklchTheme;
    let resolvedBloomBackend = bloomBackend;

    this._setResolvedBloomBackend(resolvedBloomBackend);

    if (this.resolvedBloomBackend === 'native')
    {
      // Context 事件监听器可同步拒绝 Software，避免当前回退帧触发像素回读。
      resolvedBloomBackend = 'native';
    }

    let contextSaved = false;

    try
    {
      this.context.save();
      contextSaved = true;
      themeHueShift = this._themeHueShift;
      relativeOklchTheme = this._relativeOklchTheme;
      this._drawCanvasFallbackFrame(
        scale,
        resolvedBloomBackend === 'native',
      );

      this._renderLightBackgroundContrast(
        scale,
        resolvedBloomBackend === 'software',
      );

      if (
        resolvedBloomBackend === 'software' &&
        this._hasVisibleEffects()
      )
      {
        this._renderSoftwareBloom(scale);

        if (!this.bloomRenderer.available)
        {
          // _renderSoftwareBloom 已完成同帧 Native 重画；这里只同步本方法
          // 最终提交的后端，避免 Context 恢复路径重复绘制整帧。
          resolvedBloomBackend = 'native';
        }
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL Context 丢失回退失败:', error);
      resolvedBloomBackend = 'native';

      try
      {
        this._drawCanvasFallbackFrame(scale, true);
        this._renderLightBackgroundContrast(scale, false);
      }
      catch (fallbackError)
      {
        // Canvas 自身不可用时保留透明输出，不能让异常逃出浏览器事件回调。
        console.warn('[BAClickFX] 原生 Canvas 回退失败:', fallbackError);
      }
    }
    finally
    {
      themeHueShift = previousHueShift;
      relativeOklchTheme = previousRelativeOklchTheme;

      if (contextSaved)
      {
        this.context.restore();
      }
    }

    this._finalizeCanvasOverlayAlpha(scale);
    this._setResolvedBloomBackend(resolvedBloomBackend);
    this._setCanvasOutputVisible(true);
    this._flushCompositingMountRefresh();
  }

  _drawCanvasClickEffects(scale, useNativeBloom)
  {
    const outputCompositing = this._getCanvasOutputCompositing();
    // 最终 Canvas 载荷会在所有图元聚合后统一补偿一次。
    const overlayColorCompensation = 'none';
    const overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit();

    for (const wave of this.waves)
    {
      wave.drawBase(
        this.context,
        scale,
        this._getEffectiveOpacity(),
        useNativeBloom,
        outputCompositing,
        this.dpr,
        overlayColorCompensation,
        overlayAlphaLimit,
      );
    }

    this._drawWaveRings(
      scale,
      useNativeBloom,
      false,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    );

    // Tri2 的 RenderQueue=4550，必须在全部 4499 材质之后提交。
    for (const shard of this.shards)
    {
      shard.draw(
        this.context,
        scale,
        this._getEffectiveOpacity(),
        this.fxConfig,
        outputCompositing,
        overlayColorCompensation,
        overlayAlphaLimit,
      );
    }
  }

  _drawCanvasTrails(
    scale,
    useNativeBloom,
    linearOutput = false,
  )
  {
    const nativeBloomSurface = useNativeBloom
      ? this._getNativeTrailBloomSurface()
      : null;
    const outputCompositing = linearOutput
      ? 'scene'
      : this._getCanvasOutputCompositing();
    // 线性目标不需要补偿；透明 Canvas 也延迟到 Final Pass 统一处理。
    const overlayColorCompensation = 'none';
    const overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit();

    for (
      let strokeIndex = this.trailStrokes.length - 1;
      strokeIndex >= 0;
      strokeIndex--
    )
    {
      const stroke = this.trailStrokes[strokeIndex];

      if (stroke.points.length < 2)
      {
        continue;
      }

      if (
        !Array.isArray(stroke.trailFrameData?.segmentEnergies)
      )
      {
        // WebGL2 正常帧只缓存网格测量；Context 或 GPU 当帧失败时，
        // Canvas 回退在唯一入口按需恢复旧 LUT 数据，避免正常帧重复计算。
        stroke.trailFrameData = createTrailFrameData(
          stroke.points,
          this.fxConfig.trail,
          this.fxConfig.bloom.trailEmission,
        );
      }

      drawTrail(
        this.context,
        stroke.points,
        scale,
        this._getEffectiveOpacity(),
        this.fxConfig,
        useNativeBloom,
        nativeBloomSurface,
        stroke.trailFrameData,
        linearOutput,
        outputCompositing,
        overlayColorCompensation,
        overlayAlphaLimit,
      );
    }
  }

  _renderWebGL2Bloom(scale)
  {
    const renderer = this.webglBloomRenderer;

    if (
      !renderer ||
      !this._resizeWebGLBloomRenderer()
    )
    {
      this._fallbackFromWebGL2(scale);
      return;
    }

    if (!this._renderWebGL2Scene(renderer, scale))
    {
      this._fallbackFromWebGL2(scale);
      return;
    }

    // Scene 与 Bloom 已写入同一个预乘输出，隐藏旧 Canvas 可避免重复叠加。
    this._setWebGLBloomVisible(true);
    this._setCanvasOutputVisible(false);
  }

  _fallbackFromWebGL2(scale)
  {
    this._setWebGLBloomVisible(false);
    let fallbackBackend = this._resolveCanvasFallbackBloomBackend();

    this._setResolvedBloomBackend(fallbackBackend);
    // 状态监听器可以同步显式选择 Software 或 Native；当前失败帧必须服从
    // 更新后的请求，但绝不自行把 GPU 故障升级为 Software。
    fallbackBackend = this._resolveCanvasFallbackBloomBackend();

    if (fallbackBackend === 'software')
    {
      this._drawCanvasFallbackFrame(scale, false, false);
      this._renderLightBackgroundContrast(scale, true);
      this._setResolvedBloomBackend('software');
      this._renderSoftwareBloom(scale);
      return;
    }

    this._drawCanvasFallbackFrame(scale, true, false);
    this._renderLightBackgroundContrast(scale, false);
    this._setResolvedBloomBackend('native');
  }

  _updateTrail(
    trailTimeMs,
    scale,
    useNativeBloom,
    drawCanvas = true,
    useTexturedWebGL = false,
  )
  {
    const lifetime = this.fxConfig.trail.lifetimeMs;

    for (let strokeIndex = this.trailStrokes.length - 1; strokeIndex >= 0; strokeIndex--)
    {
      const stroke = this.trailStrokes[strokeIndex];
      let expiredPointCount = 0;

      while (
        expiredPointCount < stroke.points.length &&
        trailTimeMs - stroke.points[expiredPointCount].bornAt >= lifetime
      )
      {
        expiredPointCount++;
      }

      if (expiredPointCount > 0)
      {
        // 连续 shift 会为每个过期点搬移整个数组；一次 splice 保持相同行为，
        // 快速拖动产生数百顶点时不会在每帧形成 O(n²) 开销。
        stroke.points.splice(0, expiredPointCount);
      }

      if (stroke.points.length >= 2)
      {
        const materialIntensity = useTexturedWebGL
          ? null
          : this.fxConfig.bloom.trailEmission;

        stroke.trailFrameData = createTrailFrameData(
          stroke.points,
          this.fxConfig.trail,
          materialIntensity,
          true,
        );
      }
      else
      {
        stroke.trailFrameData = null;
      }

      if (!stroke.active && stroke.points.length < 2)
      {
        // 已松开的单点无法再形成可见线段；立即移除可避免 RAF 休眠后残留容器。
        this.trailStrokes.splice(strokeIndex, 1);
      }
    }

    if (drawCanvas)
    {
      this._drawCanvasTrails(scale, useNativeBloom);
    }
  }

  _updateWaves(
    clickTimeMs,
    scale,
    useNativeBloom,
    drawCanvas = true,
  )
  {
    for (let index = this.waves.length - 1; index >= 0; index--)
    {
      const wave = this.waves[index];

      wave.updateTo(clickTimeMs);

      if (wave.dead)
      {
        this.waves.splice(index, 1);
        continue;
      }

      if (drawCanvas)
      {
        const outputCompositing = this._getCanvasOutputCompositing();

        wave.drawBase(
          this.context,
          scale,
          this._getEffectiveOpacity(),
          useNativeBloom,
          outputCompositing,
          this.dpr,
          'none',
          this._getEffectiveOverlayAlphaLimit(),
        );
      }
    }
  }

  _drawWaveRings(
    scale,
    useNativeBloom,
    linearNativeGlow = false,
    outputCompositing = this._getCanvasOutputCompositing(),
    overlayColorCompensation = 'none',
    overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit(),
  )
  {
    for (const wave of this.waves)
    {
      wave.drawRings(
        this.context,
        scale,
        this._getEffectiveOpacity(),
        useNativeBloom,
        this.dpr,
        outputCompositing,
        linearNativeGlow,
        overlayColorCompensation,
        overlayAlphaLimit,
      );
    }
  }

  _updateShards(clickTimeMs, trailTimeMs, scale, drawCanvas = true)
  {
    for (let index = this.shards.length - 1; index >= 0; index--)
    {
      const shard = this.shards[index];

      if (shard.kind === 'trail')
      {
        shard.updateTo(trailTimeMs);
      }
      else
      {
        shard.updateTo(clickTimeMs);
      }

      if (shard.dead)
      {
        this._releaseTrailShardOwner(shard);
        this.shards.splice(index, 1);
        continue;
      }

      if (drawCanvas)
      {
        const outputCompositing = this._getCanvasOutputCompositing();

        shard.draw(
          this.context,
          scale,
          this._getEffectiveOpacity(),
          this.fxConfig,
          outputCompositing,
          'none',
          this._getEffectiveOverlayAlphaLimit(),
        );
      }
    }
  }

  _hasVisibleEffects()
  {
    return (
      this.waves.length > 0 ||
      this.shards.length > 0 ||
      this.trailStrokes.some((stroke) => hasVisibleTrailPoints(stroke.points))
    );
  }

  /** 在 Canvas 局部坐标触发一次 FX_Touch 点击粒子。 */
  boom(x = this.width / 2, y = this.height / 2)
  {
    if (this.destroyed || this.paused || !this.config.clickEnabled)
    {
      return;
    }

    this._spawnClick(
      clamp(Number(x) || 0, 0, this.width),
      clamp(Number(y) || 0, 0, this.height),
    );
    this._requestRender();
  }

  /** 暂停或恢复输入与动画调度；clear 仅在进入暂停时生效。 */
  setPaused(paused, options = {})
  {
    if (this.destroyed)
    {
      return;
    }

    const nextPaused = paused === true;

    if (nextPaused)
    {
      if (!this.paused)
      {
        const pauseTime = performance.now();

        // 先结算进入暂停前的有效时间，随后冻结两个虚拟时钟。
        this._advanceClickTime(pauseTime);
        this._advanceTrailTime(pauseTime);
        this.paused = true;

        // 暂停不能保留可继续追加的宿主指针，否则恢复后会连接跨环境轨迹。
        this.touchGestureStarts.clear();
        this.touchPointerFilterResults.length = 0;
        this.closedShadowPointerDecisions = new WeakMap();
        if (this.activePointerId !== null)
        {
          this._releaseActivePointer();
        }

        if (this.animationFrame !== null)
        {
          cancelRenderFrame(this.animationFrame);
          this.animationFrame = null;
        }

        // 点击与拖尾各自使用虚拟时钟；两者都会从恢复时重新计时。
        this.lastFrameTime = null;
        this.lastClickTimeSource = null;
        this.lastTrailTimeSource = null;
      }

      if (options?.clear === true)
      {
        this.clear();
      }

      return;
    }

    if (!this.paused)
    {
      return;
    }

    const resumeTime = performance.now();

    this.paused = false;
    this.lastFrameTime = null;
    this.lastClickTimeSource = resumeTime;
    this.lastTrailTimeSource = resumeTime;

    if (this._hasVisibleEffects())
    {
      this._requestRender();
    }
    else
    {
      this._flushCompositingMountRefresh();
    }
  }

  /**
   * 设置主题色；具体映射由 themeColorMode 决定。
   * 传入空字符串或无效值可恢复默认蓝色。
   * @param {string} hex — CSS 十六进制颜色，如 "#ff6969"
   */
  setThemeColor(hex)
  {
    if (this.destroyed)
    {
      return;
    }

    this._applyThemeColor(hex);
    this._requestRender();
  }

  _applyThemeColor(hex)
  {
    const themeColor = normalizeThemeColor(hex, DEFAULT_THEME_COLOR);

    this.config.themeColor = themeColor;
    this._themeHueShift = computeThemeHueShift(themeColor);
    this._relativeOklchTheme = this.config.themeColorMode === 'relative-oklch'
      ? createRelativeOklchTheme(themeColor)
      : null;
  }

  /** 切换主题颜色映射；合法值即视为已接受，包括与当前模式相同。 */
  setThemeColorMode(mode)
  {
    if (this.destroyed || !isThemeColorMode(mode))
    {
      return false;
    }

    this.config.themeColorMode = mode;
    this._relativeOklchTheme = mode === 'relative-oklch'
      ? createRelativeOklchTheme(this.config.themeColor)
      : null;
    this._requestRender();
    return true;
  }

  /** 设置移动输入采样率上限；0 表示保留全部输入样本。 */
  setInputSamplingRate(rateHz)
  {
    if (this.destroyed || !isInputSamplingRate(rateHz))
    {
      return false;
    }

    this.updateConfig({ inputSamplingRate: rateHz });
    return true;
  }

  /**
   * 运行时更新部分配置，无需销毁重建实例。
   * target 与 inputFilter 只在构造时生效；直接 OffscreenCanvas 的 context
   * 类型也在构造时固定，不兼容的后端与渲染模式切换会明确失败。
   * @param {object} overrides
   * @returns {object}
   */
  updateConfig(overrides = {})
  {
    if (this.destroyed)
    {
      throw new Error('BAClickFX 实例已销毁');
    }

    assertConfigOverrides(overrides, { fallback: this.config });

    const previousEffectBackend = this.config.effectBackend;
    const previousWebGPUPreferHdr = this.config.webgpuPreferHdr;
    const previousBloomBackend = this.config.bloomBackend;
    const previousOutputCompositing = this.config.outputCompositing;
    const previousHostCompositing = this.config.hostCompositing;
    const previousHostCompositingSurface =
      this.config.hostCompositingSurface;
    const nextEffectBackend = isEffectBackend(overrides.effectBackend)
      ? overrides.effectBackend
      : this.config.effectBackend;
    const nextOffscreenContextType =
      nextEffectBackend === 'canvas2d'
        ? '2d'
        : 'webgl2';
    const canChangeOffscreenRoute =
      this._directOffscreenContextType === null ||
      this._directOffscreenContextType === nextOffscreenContextType;

    if (
      !canChangeOffscreenRoute &&
      overrides.effectBackend !== undefined
    )
    {
      throw new Error(
        'BAClickFX 无法切换 OffscreenCanvas context 类型；请销毁实例并使用新的画布',
      );
    }

    let transparentContractChanged = false;

    if (
      isInputSource(overrides.inputSource) &&
      overrides.inputSource !== this.config.inputSource
    )
    {
      // 输入所有权切换时先结束旧来源的逻辑指针，避免宿主接手半条轨迹。
      this._cancelPointer();
      this.config.inputSource = overrides.inputSource;

      if (overrides.inputSource === 'dom')
      {
        this._attachDomPointerListeners();
      }
      else
      {
        this._detachDomPointerListeners();
      }
    }

    if (
      isInputSamplingRate(overrides.inputSamplingRate) &&
      overrides.inputSamplingRate !== this.config.inputSamplingRate
    )
    {
      this.config.inputSamplingRate = overrides.inputSamplingRate;
      // 新设置从下一次匹配 move 立即建立相位，不跨两种采样率继承旧锚点。
      this.lastInputSampleSourceTime = null;
    }

    if (isTimeScale(overrides.clickTimeScale))
    {
      // 倍率只作用于配置变更后的时间，不能追溯重算上一帧后的区间。
      this._advanceClickTime();
      this.config.clickTimeScale = overrides.clickTimeScale;
    }

    if (isTimeScale(overrides.trailTimeScale))
    {
      // 先用旧倍率结算到配置变更时刻，避免把此前的空闲时间追溯套用新倍率。
      this._advanceTrailTime();
      this.config.trailTimeScale = overrides.trailTimeScale;
    }

    if (Number.isFinite(overrides.scale))
    {
      this.config.scale = Math.max(0.01, overrides.scale);
    }

    if (Number.isFinite(overrides.opacity))
    {
      this.config.opacity = clamp01(overrides.opacity);
    }

    if (isThemeColorMode(overrides.themeColorMode))
    {
      this.config.themeColorMode = normalizeThemeColorMode(
        overrides.themeColorMode,
        DEFAULT_THEME_COLOR_MODE,
      );
    }

    if (
      overrides.themeColor !== undefined ||
      isThemeColorMode(overrides.themeColorMode)
    )
    {
      this._applyThemeColor(
        overrides.themeColor === undefined
          ? this.config.themeColor
          : overrides.themeColor,
      );
    }

    if (isOutputCompositing(overrides.outputCompositing))
    {
      transparentContractChanged = transparentContractChanged ||
        overrides.outputCompositing !== this.config.outputCompositing;
      this.config.outputCompositing = overrides.outputCompositing;
    }

    if (isOverlayAlphaPolicy(overrides.overlayAlphaPolicy))
    {
      const overlayAlphaPolicy = normalizeOverlayAlphaPolicyConfig(
        overrides.overlayAlphaPolicy,
        this.config.overlayAlphaPolicy,
      );

      transparentContractChanged = transparentContractChanged ||
        overlayAlphaPolicy !== this.config.overlayAlphaPolicy;
      this.config.overlayAlphaPolicy = overlayAlphaPolicy;
    }

    if (isOverlayColorCompensation(overrides.overlayColorCompensation))
    {
      const overlayColorCompensation =
        normalizeOverlayColorCompensationConfig(
          overrides.overlayColorCompensation,
          this.config.overlayColorCompensation,
        );

      transparentContractChanged = transparentContractChanged ||
        overlayColorCompensation !== this.config.overlayColorCompensation;
      this.config.overlayColorCompensation = overlayColorCompensation;
    }

    if (Number.isFinite(overrides.overlayAlphaLimit))
    {
      const overlayAlphaLimit = normalizeOverlayAlphaLimit(
        overrides.overlayAlphaLimit,
        this.config.overlayAlphaLimit,
      );

      transparentContractChanged = transparentContractChanged ||
        overlayAlphaLimit !== this.config.overlayAlphaLimit;
      this.config.overlayAlphaLimit = overlayAlphaLimit;
    }

    if (isHostCompositing(overrides.hostCompositing))
    {
      transparentContractChanged = transparentContractChanged ||
        overrides.hostCompositing !== this.config.hostCompositing;
      this.config.hostCompositing = overrides.hostCompositing;
    }

    if (isHostCompositingSurface(overrides.hostCompositingSurface))
    {
      transparentContractChanged = transparentContractChanged ||
        overrides.hostCompositingSurface !==
          this.config.hostCompositingSurface;
      this.config.hostCompositingSurface = overrides.hostCompositingSurface;
    }

    if (typeof overrides.clickEnabled === 'boolean')
    {
      this.config.clickEnabled = overrides.clickEnabled;
    }

    if (typeof overrides.trailEnabled === 'boolean')
    {
      this.config.trailEnabled = overrides.trailEnabled;

      if (!overrides.trailEnabled)
      {
        if (this.activePointerSource === 'hover')
        {
          this._releaseActivePointer();
        }

        this.clearTrail();
      }
    }

    if (typeof overrides.trailAlways === 'boolean')
    {
      if (!overrides.trailAlways && this.activePointerSource === 'hover')
      {
        this._releaseActivePointer();
      }

      this.config.trailAlways = overrides.trailAlways;
    }

    if (isEffectBackend(overrides.effectBackend) && canChangeOffscreenRoute)
    {
      this.config.effectBackend = overrides.effectBackend;
    }

    if (typeof overrides.webgpuPreferHdr === 'boolean')
    {
      this.config.webgpuPreferHdr = overrides.webgpuPreferHdr;
    }

    if (
      overrides.webgpuHdrPeak !== undefined ||
      overrides.webgpuHdrBrightness !== undefined ||
      overrides.webgpuHdrColorPreservation !== undefined ||
      overrides.webgpuHdrWhiteCore !== undefined ||
      overrides.webgpuHdrWhiteStart !== undefined ||
      overrides.webgpuHdrWhiteEnd !== undefined
    )
    {
      Object.assign(
        this.config,
        normalizeWebGPUHdrPresentation(overrides, this.config),
      );
    }

    if (isBloomBackend(overrides.bloomBackend))
    {
      this.config.bloomBackend = overrides.bloomBackend;
    }

    const webgpuPresentationChanged =
      previousWebGPUPreferHdr !== this.config.webgpuPreferHdr &&
      (
        previousEffectBackend === 'webgpu' ||
        previousEffectBackend === 'auto' ||
        this.config.effectBackend === 'webgpu' ||
        this.config.effectBackend === 'auto'
      );
    const effectRouteChanged =
      previousEffectBackend !== this.config.effectBackend ||
      webgpuPresentationChanged;
    const bloomRouteChanged =
      previousBloomBackend !== this.config.bloomBackend;

    if (effectRouteChanged)
    {
      if (webgpuPresentationChanged)
      {
        this.webgpuEffectRenderer?.setPreferHdr(this.config.webgpuPreferHdr);
      }

      if (
        previousEffectBackend !== this.config.effectBackend &&
        (this.config.effectBackend === 'webgpu' ||
          this.config.effectBackend === 'auto') &&
        (
          this.webgpuEffectRenderer?.status === 'lost' ||
          this.webgpuEffectRenderer?.status === 'unavailable'
        )
      )
      {
        // Device 丢失不可恢复；重新选择 WebGPU 时允许申请全新设备。
        this._destroyWebGPUEffectRenderer();
        this.webgpuEffectUnavailable = false;
      }

      this._releaseBackendFrameResources();
      this._setResolvedEffectBackend(this._getRequestedEffectBackendState());
      this._setResolvedBloomBackend(this._getRequestedBloomBackendState());
    }
    else if (
      bloomRouteChanged &&
      this.resolvedEffectBackend !== 'webgl2' &&
      this.resolvedEffectBackend !== 'webgpu'
    )
    {
      this._releaseBloomBackendFrameResources();
      this._setResolvedBloomBackend(this._getRequestedBloomBackendState());
    }

    if (Number.isFinite(overrides.lightBackgroundContrastAlpha))
    {
      this.config.lightBackgroundContrastAlpha = clamp01(
        overrides.lightBackgroundContrastAlpha,
      );
    }

    if (typeof overrides.isolatedCompositing === 'boolean')
    {
      const isolated = this.ownsCanvas ? overrides.isolatedCompositing : false;

      if (isolated !== this.config.isolatedCompositing)
      {
        this.config.isolatedCompositing = isolated;
      }
    }

    if (
      previousOutputCompositing !== this.config.outputCompositing ||
      previousHostCompositing !== this.config.hostCompositing ||
      previousHostCompositingSurface !== this.config.hostCompositingSurface
    )
    {
      this._requestCompositingMountRefresh();
    }
    else if (typeof overrides.isolatedCompositing === 'boolean')
    {
      // 隔离开关只改变图层分组和定位，不改变当前 Canvas 像素合同。
      this._applyCompositingMount();
    }

    if (transparentContractChanged)
    {
      // 故障回退快照携带最终 Alpha/颜色合同，切换后不得复用旧模式像素。
      this.lastSoftwareBloomFrame = null;
    }

    if (Number.isFinite(overrides.maxDpr))
    {
      this.config.maxDpr = Math.max(1, overrides.maxDpr);
      this._resize();
    }

    if (overrides.touchAction !== undefined)
    {
      this.config.touchAction = overrides.touchAction;
      if (this.canvas.style)
      {
        this.canvas.style.touchAction = overrides.touchAction;
      }
      this._syncTouchActionListeners();
    }

    this._requestRender();
    return this.getConfig();
  }

  setFxParams(patch, options = {})
  {
    if (this.destroyed)
    {
      return {
        applied: [],
        normalized: [],
        rejected:
        [
          {
            path: '$instance',
            value: null,
            reason: 'destroyed',
          },
        ],
        committed: false,
        schemaVersion: FX_PARAM_SCHEMA_VERSION,
      };
    }

    const prepared = prepareFxParamPatch(
      patch,
      {
        baseline: this.fxConfig,
        reset: options.reset === true,
        resetBaseline: this._createFxParamResetBaseline(),
        strict: options.strict === true,
        schemaVersion: options.schemaVersion ?? FX_PARAM_SCHEMA_VERSION,
      },
    );
    const { nextConfig, ...result } = prepared;

    if (result.committed)
    {
      // 候选树已经完整验证；同步提交期间不会执行渲染或宿主回调。
      this._commitFxParamConfig(nextConfig);
      this._requestRender();
    }

    return result;
  }

  /**
   * 设置单个特效参数。返回 false 时配置保持不变。
   * @param {string} path — 参数路径
   * @param {number|boolean} value — 新值
   */
  setFxParam(path, value)
  {
    const result = this.setFxParams(
      { [path]: value },
      { strict: true },
    );

    return result.committed && result.applied.length === 1;
  }

  /** 设置全部点击与拖尾三角碎片的圆角比例，0 为原形，1 为圆形。 */
  setTriangleRoundness(roundness)
  {
    return this.setFxParam('shards.roundness', roundness);
  }

  /** @returns {object} 当前完整特效配置的深拷贝 */
  getFxConfig()
  {
    return structuredClone(this.fxConfig);
  }

  /** 重置所有特效参数为游戏默认值 */
  resetFxConfig()
  {
    this.setFxParams(
      {},
      {
        reset: true,
        strict: true,
      },
    );
  }

  /** 清除拖尾顶点和拖拽产生的碎片，不影响仍在播放的点击。 */
  clearTrail()
  {
    this.trailStrokes.length = 0;
    this.currentTrailStroke = null;
    this.shards = this.shards.filter((shard) => shard.kind !== 'trail');
    this.trailShardCounts.clear();
    // 清轨迹后下一次合法 move 必须能立即重建，不能被旧采样相位挡住。
    this.lastInputSampleSourceTime = null;

    if (this.activeTrailOwnerId !== null)
    {
      this.trailShardCounts.set(this.activeTrailOwnerId, 0);
    }

    // 不在此处 clearRect；_requestRender 下一帧会完整重绘，不影响点击特效
    this._requestRender();
  }

  /** 立即清除所有视觉对象。 */
  clear()
  {
    this.waves.length = 0;
    this.shards.length = 0;
    this.trailStrokes.length = 0;
    this.currentTrailStroke = null;
    this.trailShardCounts.clear();
    this.lastInputSampleSourceTime = null;
    this._trimBloomRendererPool(0, 0);
    // 直接 WebGL2 OffscreenCanvas 不创建 2D context，由对应 Renderer 清屏。
    this.context?.clearRect(0, 0, this.width, this.height);
    this.contrastContext?.clearRect(0, 0, this.width, this.height);
    this.webglBloomRenderer?.clear();
    this.webgpuEffectRenderer?.clear();
    this.webglEffectRenderer?.clear();
    this.canvasSceneRenderer?.clear();
    this._flushCompositingMountRefresh();
  }

  _hasCompositingReference()
  {
    return this.compositingReferenceSource !== null;
  }

  _applyCompositingReferenceToRenderers(
    source,
    fit,
    previousSource,
    previousFit,
    invalidatesVisibleOutput,
  )
  {
    const entries = [
      {
        name: 'WebGPU',
        renderer: this.webgpuEffectRenderer,
        discard: () =>
        {
          this._setWebGPUEffectVisible(false);
          this._destroyWebGPUEffectRenderer();
        },
      },
      {
        name: '纯 WebGL2',
        renderer: this.webglEffectRenderer,
        discard: () =>
        {
          this._setWebGLEffectVisible(false);
          this._destroyWebGLEffectRenderer();
        },
      },
      {
        name: 'WebGL2 Bloom',
        renderer: this.webglBloomRenderer,
        discard: () =>
        {
          this._setWebGLBloomVisible(false);
          this._destroyWebGLBloomRenderer();
        },
      },
      {
        name: 'Canvas Final Pass',
        renderer: this.canvasSceneRenderer,
        discard: () =>
        {
          this._setCanvasSceneVisible(false);
          this._destroyCanvasSceneRenderer();
        },
      },
    ].filter((entry) => entry.renderer);
    const appliedEntries = [];
    let failedEntry = null;

    for (const entry of entries)
    {
      let accepted = false;

      try
      {
        accepted = entry.renderer.setCompositingReference(source, { fit });
      }
      catch (error)
      {
        console.warn(`[BAClickFX] ${entry.name} 背景更新失败:`, error);
      }

      if (!accepted)
      {
        failedEntry = entry;
        break;
      }

      appliedEntries.push(entry);
    }

    if (!failedEntry)
    {
      return true;
    }

    let rollbackFailed = false;

    for (let index = appliedEntries.length - 1; index >= 0; index--)
    {
      const entry = appliedEntries[index];
      let restored = false;

      try
      {
        restored = entry.renderer.setCompositingReference(
          previousSource,
          { fit: previousFit },
        );
      }
      catch (error)
      {
        console.warn(`[BAClickFX] ${entry.name} 背景回滚失败:`, error);
      }

      if (!restored)
      {
        // 无法回滚的 Renderer 不得继续持有与主状态不一致的背景。
        entry.discard();
        rollbackFailed = true;
      }
    }

    if (rollbackFailed)
    {
      if (invalidatesVisibleOutput)
      {
        this._invalidateSceneBackgroundOutputs();
      }

      this._requestRender();
    }

    return false;
  }

  /**
   * 为 GPU Scene 提供特效下方的真实不透明栅格参考；调用方负责解码与 CORS。
   * 资源对象不进入 getConfig()，避免配置快照持有宿主 DOM 生命周期。
   */
  setCompositingReference(source, options = {})
  {
    if (this.destroyed)
    {
      return false;
    }

    const fit = options.fit ?? 'cover';

    if (fit !== 'cover')
    {
      return false;
    }

    if (source !== null && !getCompositingReferenceDimensions(source))
    {
      return false;
    }

    const previousSource = this.compositingReferenceSource;
    const previousFit = this.compositingReferenceFit;
    const invalidatesVisibleOutput = this.webgpuEffectVisible ||
      this.webglEffectVisible ||
      this.webglBloomVisible ||
      this.canvasSceneVisible;

    if (!this._applyCompositingReferenceToRenderers(
      source,
      fit,
      previousSource,
      previousFit,
      invalidatesVisibleOutput,
    ))
    {
      return false;
    }

    this.compositingReferenceSource = source;
    this.compositingReferenceFit = fit;
    this.lastSoftwareBloomFrame = null;
    // 只有当前输出链真正消费参考时才撤销宿主 Add；Software/Native/外部
    // Canvas 仍按未知背景传输完整 Add 载荷。
    this._requestCompositingMountRefresh();
    if (source !== null)
    {
      // 显式提供新参考后，允许此前单次上传失败的候选后端重新尝试。
      this.webgpuEffectUnavailable = false;
      this.webglEffectUnavailable = false;
      this.webglBloomUnavailable = false;
      this.canvasSceneUnavailable = false;
    }

    if (invalidatesVisibleOutput)
    {
      this._invalidateSceneBackgroundOutputs();
      this._flushCompositingMountRefresh();
    }

    if (source === null)
    {
      // 未知背景合同不需要 Canvas Final Pass；立即归还其全尺寸上传纹理，
      // 保留静态 Program 供下次参考图接入。
      this.canvasSceneRenderer?.releaseFrameResources();
    }

    this._requestRender();
    return true;
  }

  getConfig()
  {
    const hostCompositingState = this._resolveHostCompositingState();

    return {
      ...this.config,
      ...hostCompositingState,
      resolvedEffectBackend: this.resolvedEffectBackend,
      resolvedBloomBackend: this.resolvedBloomBackend,
      resolvedWebGPUOutputMode: this._getResolvedWebGPUOutputMode(),
      unity: structuredClone(UNITY_FX_TOUCH),
    };
  }

  _getResolvedWebGPUOutputMode()
  {
    const requested = normalizeEffectBackend(this.config.effectBackend);

    if (
      (requested !== 'webgpu' && requested !== 'auto') ||
      !this.ownsCanvas ||
      !this.overlayParent
    )
    {
      return 'unavailable';
    }

    const renderer = this.webgpuEffectRenderer;

    if (renderer?.deviceManager.outputMode === 'extended')
    {
      return 'extended';
    }

    if (renderer?.deviceManager.outputMode === 'standard')
    {
      return 'standard';
    }

    if (renderer?.status === 'pending' || renderer?.status === 'ready')
    {
      return 'pending';
    }

    if (
      !this.webgpuEffectUnavailable &&
      (requested === 'webgpu' || requested === 'auto')
    )
    {
      return 'pending';
    }

    return 'unavailable';
  }

  destroy()
  {
    if (this.destroyed)
    {
      return;
    }

    this.destroyed = true;
    if (typeof window !== 'undefined')
    {
      window.removeEventListener('resize', this._onResize);
    }
    this._detachDomPointerListeners();
    if (typeof window !== 'undefined')
    {
      window.removeEventListener('blur', this._onBlur);
    }
    this.resizeObserver?.disconnect();

    if (this.animationFrame !== null)
    {
      cancelRenderFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.clear();
    for (const renderer of this.bloomRenderers)
    {
      renderer.destroy();
    }

    this._destroyWebGLBloomRenderer();
    this._destroyWebGPUEffectRenderer();
    this._destroyWebGLEffectRenderer();
    this._destroyCanvasSceneRenderer();

    if (this.nativeTrailBloomSurface)
    {
      this.nativeTrailBloomSurface.canvas.width = 0;
      this.nativeTrailBloomSurface.canvas.height = 0;
      this.nativeTrailBloomSurface = null;
    }

    if (this.canvasBloomTransportCanvas)
    {
      this.canvasBloomTransportCanvas.width = 0;
      this.canvasBloomTransportCanvas.height = 0;
      this.canvasBloomTransportCanvas = null;
      this.canvasBloomTransportContext = null;
    }

    this.canvasNativeSceneAlphaSnapshot = null;

    if (this.ownsCanvas)
    {
      this.webglBloomCanvas?.remove();
      this.contrastCanvas?.remove();
      this.canvas.remove();
      this.overlayRoot?.remove();
    }

    this.webglBloomCanvas = null;
    this.webglBloomVisible = false;
    this.canvasSceneCanvas = null;
    this.canvasSceneVisible = false;
    this.compositingReferenceSource = null;
    this.overlayParent = null;
    this.overlayMountParent = null;
    this.overlayRoot = null;
  }
}

/**
 * 在不创建渲染实例的情况下迁移并校验持久化参数补丁。
 * 内部候选配置树不属于公共契约；宿主只需持久化返回的 applied 项。
 */
function applyFxParamPatch(patch, options = {})
{
  const prepared = prepareFxParamPatch(
    patch,
    {
      baseline: UNITY_FX_TOUCH,
      schemaVersion: options.schemaVersion ?? FX_PARAM_SCHEMA_VERSION,
      strict: options.strict === true,
    },
  );
  const { nextConfig, ...result } = prepared;

  return result;
}

export {
  applyFxParamPatch,
  BLOOM_BACKEND_CHANGE_EVENT,
  CONFIG,
  DEFAULT_THEME_COLOR,
  DEFAULT_THEME_COLOR_MODE,
  EFFECT_BACKEND_CHANGE_EVENT,
  FX_PARAM_MIGRATIONS,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  HOST_COMPOSITING_CHANGE_EVENT,
  UNITY_FX_TOUCH,
  createConfig,
  SIZE_CORRECTION,
};

export default BAClickFX;
