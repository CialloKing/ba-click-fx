import {
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
} from './engine-shared.js';
import { ConfigRuntime } from './engine-config.js';
/**
 * ba-click-fx — Blue Archive 的 UI/FX_Touch 浏览器移植。
 *
 * 这不是“相似风格”参数化引擎。实现移植 Unity 中 FXTouch、
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
import { getTrailRenderPoints, updateTrailRenderPoints } from './trail-lifetime.js';
import {
  gammaToLinear,
  linearToSrgb,
  resolveUnityBloomClamp,
  resolveUnityBloomIntensity,
} from './bloom-color-space.js';
import { SoftwareBloomRenderer } from './software-bloom.js';
import { calculateBloomContribution, limitCanvasAlpha } from './bloom-math.js';
import {
  BRIGHT_CORE_CHANNEL_MIX,
  applyOverlayColorCompensationToImageData,
  applyOverlayAlphaPolicyToImageData,
  compensateBrightCorePremultipliedRgb,
} from './overlay-compositing.js';
import { WebGL2EffectRenderer } from './webgl2-effect.js';
import { WebGPUEffectRenderer } from './webgpu-effect.js';
import { WebGL2CanvasSceneRenderer } from './webgl2-canvas-scene.js';
import {
  addNativeBloomSample,
  createNativeBloomProfile,
  createNativeBloomSource,
} from './native-bloom.js';
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
  getRoundedTriangleTextureDivisor,
  mapRoundedTriangleTextureUv,
} from './triangle-texture.js';
import { traceRoundedTrianglePath } from './triangle-path.js';
import {
  CUSTOM_BUILD, BUILD_DOM, BUILD_WORKER, BUILD_WEBGL, BUILD_WEBGPU, BUILD_WEBGL_BLOOM,
  BUILD_SOFTWARE, BUILD_NATIVE, BUILD_CANVAS, BUILD_CLICK, BUILD_TRAIL,
  BUILD_SHARDS, BUILD_BLOOM, BUILD_REFERENCE, FIXED_CONFIG, FIXED_FX, FIXED_THEME,
} from './build-capabilities.js';
import {
  evaluateTrailLongitudinalCoverage,
  evaluateTrailTextureCoverageProfile,
} from './trail-coverage.js';

const TAU = Math.PI * 2;
const LIGHT_BACKGROUND_CONTRAST_COLOR = [76, 255, 255];

const HOST_COMPOSITING_CHANGE_EVENT = 'baclickfxhostcompositingchange';

const MAX_TRAIL_INNER_MITER_RATIO = 4;
const MIN_TRAIL_SEGMENT_LENGTH = 0.000001;
const TRAIL_MESH_CACHE_CAPACITY = 4;
const TRAIL_GRADIENT_CACHE_CAPACITY = 8;

function requestRenderFrame(callback)
{
  if (typeof requestAnimationFrame === 'function')
  {
    return requestAnimationFrame(callback);
  }

  // 部分 Dedicated Worker 没有 RAF；定时器只负责帧调度，不接管 Worker 协议。
  return setTimeout(() => callback(performance.now()), 1000 / 60);
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
let gradientEnergyCache = null;
let ringSampleCache = null;
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

function smoothstep(edge0, edge1, value)
{
  const progress = clamp01((value - edge0) / (edge1 - edge0));
  return progress * progress * (3 - 2 * progress);
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

function srgbToLinearChannel(channel)
{
  const normalized = clamp01(channel / 255);

  if (normalized <= 0.04045)
  {
    return normalized / 12.92;
  }

  return ((normalized + 0.055) / 1.055) ** 2.4;
}

const NATIVE_BLOOM_DISK_SAMPLES = 16;
let nativeCircleBloomSamples = null;

function getNativeCircleBloomSamples()
{
  if (!nativeCircleBloomSamples)
  {
    // 固定纹理与网格不随实例或主题改变；Float64 保留原 JavaScript 数值精度。
    const count = NATIVE_BLOOM_DISK_SAMPLES;
    const samples = new Float64Array(count * count * 4);
    let destination = 0;
    for (let y = 0; y < count; y++)
    {
      for (let x = 0; x < count; x++)
      {
        const u = (x + 0.5) / count;
        const v = (y + 0.5) / count;
        const offset = (Math.floor(v * CIRCLE_TEXTURE_SIZE) *
          CIRCLE_TEXTURE_SIZE + Math.floor(u * CIRCLE_TEXTURE_SIZE)) * 4;
        samples[destination++] = srgbToLinearChannel(CIRCLE_TEXTURE_RGBA[offset]);
        samples[destination++] = srgbToLinearChannel(CIRCLE_TEXTURE_RGBA[offset + 1]);
        samples[destination++] = srgbToLinearChannel(CIRCLE_TEXTURE_RGBA[offset + 2]);
        samples[destination++] = (u * 2 - 1) ** 2 + (v * 2 - 1) ** 2;
      }
    }
    nativeCircleBloomSamples = samples;
  }
  return nativeCircleBloomSamples;
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
  let linearKeys = gradientEnergyCache?.get(keys);
  if (!linearKeys)
  {
    linearKeys = keys.map(([time, color]) =>
    [
      time,
      applyThemeColor(color).map(srgbToLinearChannel),
    ]);
    gradientEnergyCache?.set(keys, linearKeys);
  }
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
  // GPU Final Pass 会把 Unity 序列化 Intensity 转为线性曝光倍率；原生
  // Canvas 没有独立合成阶段，因此必须在写入模糊源前应用同一倍率。
  const sourceScale = clamp01(opacity) * Math.max(0, intensity) *
    bloomCfg.trailEmissionAlpha;
  const exposure = resolveUnityBloomIntensity(bloomCfg.intensity) /
    resolveUnityBloomIntensity(1.7);
  const source = color.map((channel) => Math.min(resolveUnityBloomClamp(bloomCfg.clamp),
    Math.max(0, channel * sourceScale)));
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

  const contributionScale = contribution / brightness * exposure;
  const brightPass = source.map((channel) => channel * contributionScale);

  if (outputCompositing === 'browser-overlay')
  {
    // Native blur 的 Alpha 取自几何 Coverage，而不是 HDR 明度；发射倍率只
    // 改变 RGB，不能把透明桌面的轨迹变成实心遮挡。
    const coverage = clamp01(coverageOpacity * exposure * bloomCfg.trailEmissionAlpha);

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
    const host = typeof document !== 'undefined' && typeof document.querySelector === 'function'
      ? document.querySelector(target)
      : null;
    // 显式选择器查找失败不能与省略 target 混为一谈，否则会意外挂载全屏层。
    if (!host)
    {
      throw new Error('BAClickFX 找不到 target');
    }
    return host;
  }

  return target ?? null;
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

function prepareTextureSample(sample, textureSize, u, v)
{
  const sourceX = clamp(u * textureSize - 0.5, 0, textureSize - 1);
  const sourceY = clamp(v * textureSize - 0.5, 0, textureSize - 1);
  const left = Math.floor(sourceX);
  const top = Math.floor(sourceY);
  const right = Math.min(textureSize - 1, left + 1);
  const bottom = Math.min(textureSize - 1, top + 1);
  sample.topLeft = top * textureSize + left;
  sample.topRight = top * textureSize + right;
  sample.bottomLeft = bottom * textureSize + left;
  sample.bottomRight = bottom * textureSize + right;
  sample.horizontal = sourceX - left;
  sample.vertical = sourceY - top;
}

function samplePreparedTextureChannel(data, stride, sample, channel = 0)
{
  const topLeft = data[sample.topLeft * stride + channel];
  const topRight = data[sample.topRight * stride + channel];
  const bottomLeft = data[sample.bottomLeft * stride + channel];
  const bottomRight = data[sample.bottomRight * stride + channel];
  // 保留原来的两次横向插值再纵向插值，不改成权重加和以免改变最终字节。
  const topSample = topLeft + (topRight - topLeft) * sample.horizontal;
  const bottomSample = bottomLeft + (bottomRight - bottomLeft) * sample.horizontal;
  return topSample + (bottomSample - topSample) * sample.vertical;
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
  preserveCoverageColor = false,
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
    preserveCoverageColor,
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
  // 工作区属于本次染色调用；多实例及重入不会共享可变采样状态。
  const textureSample = roundness > 0 ? {} : null;
  const textureDivisor = useRoundedShape ? getRoundedTriangleTextureDivisor(roundness) : 1;
  const encodeLinearChannel = (energy, straightDivisor) =>
  {
    const lookupIndex = Math.round(
      clamp01(energy) * (LINEAR_TO_SRGB_LUT_SIZE - 1),
    );
    return srgbLut[lookupIndex] / straightDivisor;
  };
  const encodeRoundedChannel = (channel, textureSupport, targetCoverage, straightDivisor) =>
  {
    const textureChannel = samplePreparedTextureChannel(
      sourceTextureRgb, 3, textureSample, channel,
    );
    const supportedChannel = 1 + (textureChannel - 1) * clamp01(textureSupport);
    const shapeChannel = supportedChannel + (1 - supportedChannel) * roundness;
    // 圆角 Coverage 是唯一边界；纹理映射及通道乘法顺序保持不变。
    const roundedPremultiplied = shapeChannel * targetCoverage;
    return encodeLinearChannel(
      roundedPremultiplied * safeMaterialEnergy[channel] * safeContribution,
      straightDivisor,
    );
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

      let sampleU = (x + 0.5) / textureSize;
      let sampleV = (sourceY + 0.5) / textureSize;

      if (useRoundedShape)
      {
        sampleU = 0.5 + (sampleU - 0.5) / textureDivisor;
        sampleV = 0.5 + (sampleV - 0.5) / textureDivisor;
      }

      if (textureSample) prepareTextureSample(textureSample, textureSize, sampleU, sampleV);

      const textureSupport = useRoundedShape
        ? (useTextureAlpha
            ? samplePreparedTextureChannel(
                sourceRgba,
                4,
                textureSample,
                3,
              )
            : samplePreparedTextureChannel(
                sourceCoverage,
                1,
                textureSample,
              )) / 255
        : originalCoverage;

      const effectiveAlpha = coverageByte / 255;
      const straightDivisor = safeDivisor * effectiveAlpha;
      let red;
      let green;
      let blue;
      if (roundness <= 0)
      {
        let energyScale = 1;
        if (preserveCoverageColor)
        {
          // RGB 共用同一 Coverage 容量，每个 texel 只算一次，保留原峰值乘法顺序。
          const maximum = Math.max(
            safeMaterialEnergy[0] * sourceEnergyRgb[sourceOffset] * safeContribution,
            safeMaterialEnergy[1] * sourceEnergyRgb[sourceOffset + 1] * safeContribution,
            safeMaterialEnergy[2] * sourceEnergyRgb[sourceOffset + 2] * safeContribution,
          );
          energyScale = Math.min(1, srgbToLinearChannel(straightDivisor * 255) /
            Math.max(maximum, 0.000001));
        }
        red = encodeLinearChannel(
          sourceEnergyRgb[sourceOffset] * safeMaterialEnergy[0] * safeContribution * energyScale,
          straightDivisor,
        );
        green = encodeLinearChannel(
          sourceEnergyRgb[sourceOffset + 1] * safeMaterialEnergy[1] * safeContribution * energyScale,
          straightDivisor,
        );
        blue = encodeLinearChannel(
          sourceEnergyRgb[sourceOffset + 2] * safeMaterialEnergy[2] * safeContribution * energyScale,
          straightDivisor,
        );
      }
      else
      {
        red = encodeRoundedChannel(0, textureSupport, targetCoverage, straightDivisor);
        green = encodeRoundedChannel(1, textureSupport, targetCoverage, straightDivisor);
        blue = encodeRoundedChannel(2, textureSupport, targetCoverage, straightDivisor);
      }
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

function prepareRingGradientSamples(ringCfg, threshold, radialProgress, sampleCount, direction)
{
  const count = Math.floor(sampleCount) + 1;
  // 保留原 Number 的双精度，不能用 Float32 工作区提前舍入亮度或 clip 边界。
  const luminances = new Float64Array(count);
  const boundaries = new Float64Array(count);
  const transitions = new Uint8Array(count);
  let previousLuminance = null;

  for (let sample = 0; sample <= sampleCount; sample++)
  {
    const angularProgress = sample / sampleCount;
    const textureProgress = resolveRingTextureProgress(angularProgress, direction);
    const luminance = evaluateRingLuminance(textureProgress, radialProgress, threshold, ringCfg);
    luminances[sample] = luminance;

    if (previousLuminance !== null && (previousLuminance > 0) !== (luminance > 0))
    {
      boundaries[sample] = findRingClipBoundary(
        (sample - 1) / sampleCount, angularProgress, radialProgress, threshold, direction, ringCfg,
      );
      transitions[sample] = previousLuminance > 0 ? 1 : 2;
    }
    previousLuminance = luminance;
  }
  return { sampleCount, luminances, boundaries, transitions };
}

function getRingGradientSamples(ringCfg, threshold, radialProgress)
{
  const sampleCount = Math.max(32, resolveRingIntegrationArcSamples(ringCfg));
  const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;
  if (!ringSampleCache)
  {
    return prepareRingGradientSamples(ringCfg, threshold, radialProgress, sampleCount, direction);
  }
  let entries = ringSampleCache.get(ringCfg);
  if (!entries)
  {
    entries = new Map();
    ringSampleCache.set(ringCfg, entries);
  }
  // 颜色、半径和 Canvas 变换不参与纹理 Alpha 与 clip 边界计算；实际 UV 和阈值必须参与。
  const key = `${sampleCount}:${direction}:${radialProgress}:${threshold}:${ringCfg.textureUvMin}:${ringCfg.textureUvMax}`;
  let samples = entries.get(key);
  if (!samples)
  {
    samples = prepareRingGradientSamples(ringCfg, threshold, radialProgress, sampleCount, direction);
    entries.set(key, samples);
  }
  return samples;
}

function createRingStopDescriptor(purpose, materialEnergy, ...parameters)
{
  return { theme: relativeOklchTheme,
    key: `${purpose}:${themeHueShift}:${materialEnergy.join(':')}:${parameters.join(':')}` };
}

function getRingGradientStops(samples, descriptor)
{
  return ringSampleCache && descriptor
    ? samples.stopSequences?.get(descriptor.theme)?.get(descriptor.key)
    : null;
}

function prepareRingGradientStops(gradient, samples, threshold, colorForLuminance, retain)
{
  const stops = retain ? [] : null;
  const sampleCount = samples.sampleCount;
  const writeStop = (position, color) =>
  {
    gradient.addColorStop(position, color);
    if (stops) stops.push(position, color);
  };

  for (let sample = 0; sample <= sampleCount; sample++)
  {
    const angularProgress = sample / sampleCount;
    const luminance = samples.luminances[sample];

    if (samples.transitions[sample])
    {
      const boundary = samples.boundaries[sample];
      const visibleBoundary = colorForLuminance(threshold);
      const transparentBoundary = colorForLuminance(0);

      if (samples.transitions[sample] === 1)
      {
        writeStop(boundary, visibleBoundary);
        writeStop(boundary, transparentBoundary);
      }
      else
      {
        writeStop(boundary, transparentBoundary);
        writeStop(boundary, visibleBoundary);
      }
    }

    writeStop(
      angularProgress,
      colorForLuminance(luminance),
    );
  }
  return stops;
}

function createDissolvedRingGradient(
  context,
  ringCfg,
  threshold,
  radialProgress,
  colorForLuminance,
  stopDescriptor = null,
)
{
  if (typeof context.createConicGradient !== 'function')
  {
    return null;
  }

  const gradient = context.createConicGradient(0, 0, 0);
  const samples = getRingGradientSamples(ringCfg, threshold, radialProgress);
  const cached = getRingGradientStops(samples, stopDescriptor);
  if (cached)
  {
    for (let index = 0; index < cached.length; index += 2)
    {
      gradient.addColorStop(cached[index], cached[index + 1]);
    }
  }
  else
  {
    // 首次准备仍按原顺序交错求值与写入；失败时不能留下半成品。
    const stops = prepareRingGradientStops(gradient, samples, threshold,
      colorForLuminance, Boolean(ringSampleCache && stopDescriptor));
    if (stops)
    {
      samples.stopSequences ??= new Map();
      let sequences = samples.stopSequences.get(stopDescriptor.theme);
      if (!sequences)
      {
        sequences = new Map();
        samples.stopSequences.set(stopDescriptor.theme, sequences);
      }
      // 序列依附同帧采样数据，随既存范围的 finally 释放，不保留历史帧。
      sequences.set(stopDescriptor.key, stops);
    }
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
    resolveRingIntegrationArcSamples(ringCfg),
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

function resolveRingIntegrationSamples(ringCfg)
{
  // GPU 的原始单层网格不等于一次纹理积分；Canvas/Native 默认继续取八条径向带。
  const samples = Math.max(1, Math.round(ringCfg.radialSamples));
  return samples === 1 && Math.round(ringCfg.arcSamples) === 64 ? 8 : samples;
}

function resolveRingIntegrationArcSamples(ringCfg)
{
  return Math.round(ringCfg.radialSamples) === 1 && Math.round(ringCfg.arcSamples) === 64
    ? 96 : ringCfg.arcSamples;
}

function fillDissolvedRing(
  context,
  radius,
  width,
  threshold,
  ringCfg,
  colorForLuminance,
  stopDescriptor = null,
)
{
  const radialSamples = resolveRingIntegrationSamples(ringCfg);
  const innerEdge = Math.max(0, radius - width * 0.5);
  const bandWidth = width / radialSamples;
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';

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
      stopDescriptor,
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
  gradientPurpose = 'clear',
)
{
  const ringCfg = fxConfig.rings;
  const geometry = resolveRingGeometry(ring, progress, scale, ringCfg);

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
  // Canvas 独立近似 Bloom；Tri3 本体仍必须保留原材质的
  // Linear 色彩空间与 HDR 强度，否则清晰环带会比 Unity 明显偏蓝、偏暗。
  const colorForLuminance = (luminance) =>
  {
    const coverage = opacity * luminance;

    if (outputCompositing === 'browser-overlay')
    {
      const energyScale = useNativeBloom
        ? Math.min(1, srgbToLinearChannel(coverage * 255) /
            Math.max(Math.max(...materialEnergy) * coverage, 0.000001))
        : 1;
      return linearEnergyToOverlayCss(
        materialEnergy,
        coverage * energyScale,
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

  fillDissolvedRing(
    context,
    geometry.radius,
    geometry.width,
    geometry.threshold,
    ringCfg,
    colorForLuminance,
    createRingStopDescriptor(gradientPurpose, materialEnergy, opacity, useNativeBloom,
      outputCompositing, overlayColorCompensation, overlayAlphaLimit),
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
    createRingStopDescriptor('emission', materialEnergy, opacity, bloomCfg.ringEmissionAlpha,
      bloomCfg.emissionRange, bloomCfg.clickEmissionScale),
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
        null,
        useNativeBloom,
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
  context.shadowBlur = 0;
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
        false,
        1,
        'none',
        1,
        'coverage',
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
  sharedData = null,
)
{
  if (!sharedData)
  {
    // 重建时保留原来的求和顺序；GPU 当帧回退则补材质，不再次测量。
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
    sharedData = {
      measurement,
      pointProgresses,
      segmentProgresses,
      pointCoverageFactors: pointProgresses.map((progress) =>
        evaluateTrailLongitudinalCoverage(coverageKeys, progress)),
      segmentCoverageFactors: segmentProgresses.map((progress) =>
        evaluateTrailLongitudinalCoverage(coverageKeys, progress)),
    };
  }
  const { measurement, pointProgresses, segmentProgresses } = sharedData;

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

  let mesh = trailData.meshCache.get(cacheKey);
  if (mesh)
  {
    trailData.meshCache.delete(cacheKey);
  }
  else
  {
    mesh = createTrailMesh(
      points,
      width,
      cornerVertices,
      capVertices,
      trailData.measurement.segmentLengths,
    );
  }
  trailData.meshCache.set(cacheKey, mesh);
  // 清晰层和 Bloom 可保留各自宽度，但连续缩放不能积累全部历史网格。
  if (trailData.meshCache.size > TRAIL_MESH_CACHE_CAPACITY)
  {
    releaseMeshGradients(trailData.meshCache.values().next().value);
    trailData.meshCache.delete(trailData.meshCache.keys().next().value);
  }
  return mesh;
}

function getTrailGradientGroup(mesh, context, data, trailCfg, layer, opacity)
{
  // 未知变换的轻量 Context 保持原路径；真实 Canvas 以当前变换和尺寸识别渐变。
  if (!layer.gradientPurpose || typeof context.getTransform !== 'function') return null;
  const transform = context.getTransform();
  const signature = [data.pointEnergies, data.segmentEnergies, data.pointTransverseProfiles,
    data.segmentTransverseProfiles, data.pointCoverageProfiles, data.segmentCoverageProfiles,
    trailCfg, themeHueShift, relativeOklchTheme, opacity, layer.alpha, layer.materialIntensity,
    layer.outputCompositing, layer.overlayColorCompensation, layer.overlayAlphaLimit,
    layer.globalOpacity, context.canvas.width, context.canvas.height,
    transform.a, transform.b, transform.c, transform.d, transform.e, transform.f,
    ...(layer.gradientParameters ?? [])];
  const groups = mesh.canvasGradientCache ??= [];
  const index = groups.findIndex(group => group.context === context && group.purpose === layer.gradientPurpose);
  let group = index < 0 ? null : groups.splice(index, 1)[0];
  if (!group || !group.signature.every((value, i) => Object.is(value, signature[i]))
    || group.signature.length !== signature.length)
  {
    if (group) { group.segments.clear(); group.caps.clear(); }
    group = { context, purpose: layer.gradientPurpose, signature, segments: new Map(), caps: new Map() };
  }
  groups.push(group);
  if (groups.length > TRAIL_GRADIENT_CACHE_CAPACITY)
  {
    const expired = groups.shift();
    expired.segments.clear(); expired.caps.clear();
    expired.context = null; expired.signature = null;
  }
  return group;
}

function cachedTrailGradient(records, key, context, from, to, profile, colorAtIntensity)
{
  const record = records?.get(key);
  if (record && record.x1 === from.x && record.y1 === from.y && record.x2 === to.x && record.y2 === to.y)
    return record.gradient;
  const gradient = createTrailCrossSectionGradient(context, from, to, profile, colorAtIntensity);
  // 只有完整写入所有 stop 的渐变才能成为下一帧可复用资源。
  records?.set(key, { gradient, x1: from.x, y1: from.y, x2: to.x, y2: to.y });
  return gradient;
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
  records = null,
)
{
  const gradient = cachedTrailGradient(
    records,
    segment,
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
  records = null,
)
{
  const left = cap.points[0];
  const right = cap.position === 'start' ? cap.points[1] : cap.points[2];
  const gradient = cachedTrailGradient(
    records,
    cap,
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
  const gradientGroup = getTrailGradientGroup(mesh, context, trailData, trailCfg, layer, opacity);
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
      gradientGroup?.segments,
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
      gradientGroup?.caps,
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
    bloomCfg.trailEmissionAlpha <= 0 ||
    bloomCfg.intensity <= 0 ||
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
  // 与 WebGL Bloom 的覆盖宽度保持一致；Native 直接模糊过窄几何会
  // 形成中心亮线和两侧断裂的光晕，尤其在低 DPR 下更明显。
  const bloomWidth = Math.max(0.5,
    trailCfg.geometryWidth * bloomCfg.trailCoverageScale);
  // GPU 金字塔的近场半径约为几何外扩的一半；过大的 Canvas blur
  // 会在高能量尾端叠成椭圆光斑，和 WebGL2/WebGPU 的细长拖尾不一致。
  const blurRadius = Math.max(0, trailCfg.outerGlowWidth * scale * 0.65);
  const halfWidth = bloomWidth * scale * 0.5;
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
      width: bloomWidth,
      gradientPurpose: 'native-bloom',
      gradientParameters: [bloomCfg, outputCompositing, overlayColorCompensation, overlayAlphaLimit],
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
      gradientPurpose: 'clear',
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
      gradientPurpose: 'coverage',
      gradientParameters: [trailOpacity],
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
      gradientPurpose: 'emission',
      gradientParameters: [trailOpacity, bloomCfg.emissionRange],
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
  renderer._addTrailMeshTriangle(
    segment.fromLeft, fromSample, 1,
    segment.toLeft, toSample, 1,
    segment.toRight, toSample, 0,
    opacity,
  );
  renderer._addTrailMeshTriangle(
    segment.fromLeft, fromSample, 1,
    segment.toRight, toSample, 0,
    segment.fromRight, fromSample, 0,
    opacity,
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
  for (let arcIndex = 1; arcIndex < join.outerArc.length; arcIndex++)
  {
    // Unity 的圆角插入点只细分几何；同一折点的 Stretch U 必须保持不变。
    renderer._addTrailMeshTriangle(
      join.inner, sample, innerV,
      join.outerArc[arcIndex - 1], sample, outerV,
      join.outerArc[arcIndex], sample, outerV,
      opacity,
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
    // numCapVertices=1 形成一个三角端帽；尖端位于纹理横截面中心。
    renderer._addTrailMeshTriangle(
      cap.points[0], sample, 1,
      cap.points[1], sample, cap.position === 'start' ? 0 : 0.5,
      cap.points[2], sample, cap.position === 'start' ? 0.5 : 0,
      opacity,
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

function getTrailGpuPointSamples(trailData, points, trailCfg, materialIntensity)
{
  const cached = trailData.gpuPointCache;
  if (cached && cached.trailCfg === trailCfg && cached.materialIntensity === materialIntensity &&
    cached.hueShift === themeHueShift && cached.relativeTheme === relativeOklchTheme)
  {
    return cached.samples;
  }

  const samples = new Array(points.length);
  for (let index = 0; index < points.length; index++)
  {
    const progress = trailData.pointProgresses?.[index] ??
      trailData.measurement.distances[index] / trailData.measurement.totalLength;
    samples[index] = {
      // 点集版本由 trailData 管理；保持先插值再映射主题，不能插值已映射的关键帧。
      // Unity 的 U=0 位于最新点，项目点序则是旧点到新点。
      u: 1 - progress,
      color: evaluateTrailMaterialColor(progress, trailCfg, materialIntensity),
      coverage: resolveTrailPointCoverageFactor(trailData, index, trailCfg),
    };
  }
  trailData.gpuPointCache = {
    trailCfg, materialIntensity, hueShift: themeHueShift, relativeTheme: relativeOklchTheme, samples,
  };
  return samples;
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
  if (!mesh.visibleSegments)
  {
    // 可见段只依赖该宽度的网格；缩放或端帽配置改变时由网格缓存选择新对象。
    mesh.visibleSegments = new Set();
    for (let index = 1; index < points.length; index++)
    {
      if (mesh.segments[index])
      {
        mesh.visibleSegments.add(index);
      }
    }
  }
  const visibleSegments = mesh.visibleSegments;
  const pointSamples = getTrailGpuPointSamples(trailData, points, trailCfg, bloomCfg.trailEmission);

  for (const index of visibleSegments)
  {
    const segment = mesh.segments[index];
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

export class BAClickFX extends ConfigRuntime
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
    super();

    if (CUSTOM_BUILD)
    {
      const allowed = BUILD_DOM ? ['target', 'inputFilter', 'onError'] : ['target', 'onError'];
      if (!options || typeof options !== 'object' || Array.isArray(options))
      {
        throw new TypeError('BAClickFX 构造参数必须是对象');
      }
      for (const [key, value] of Object.entries(options))
      {
        if (!allowed.includes(key) || (key !== 'target' && value !== undefined && typeof value !== 'function'))
        {
          throw new TypeError(`BAClickFX 定制版不接受构造参数: ${key}`);
        }
      }
      this.onError = options.onError ?? null;
      this.buildFailed = false;
      if (options.inputFilter !== undefined && typeof options.inputFilter !== 'function')
      {
        throw new TypeError('BAClickFX inputFilter 必须是函数');
      }
      if (BUILD_DOM ? isCanvas(options.target) : !isCanvas(options.target))
      {
        throw new TypeError('BAClickFX target 与构建的 runtime 不匹配');
      }
      if (!BUILD_DOM && (BUILD_WORKER !== isOffscreenCanvas(options.target)))
      {
        throw new TypeError('BAClickFX target 的 Canvas 类型与构建的 runtime 不匹配');
      }
    }
    else
    {
      assertConfigOverrides(options, { allowInstanceOptions: true });
    }
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

    this.config = CUSTOM_BUILD ? FIXED_CONFIG : createConfig(configOptions);
    this.inputFilter = typeof options.inputFilter === 'function'
      ? options.inputFilter
      : null;
    this.host = resolveTarget(options.target);
    this.ownsCanvas = !isCanvas(this.host);
    if (CUSTOM_BUILD && BUILD_DOM && isCanvas(this.host))
    {
      throw new TypeError('DOM 定制版需要容器 target，已有 Canvas 请选择 manual 构建');
    }
    if (!CUSTOM_BUILD && !this.ownsCanvas)
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

    }
    else
    {
      this.overlayMountParent = null;
      this.overlayRoot = null;
      this.overlayParent = null;
    }

    const isDirectOffscreen = isOffscreenCanvas(this.canvas);
    const requiresCanvas2D = CUSTOM_BUILD
      ? BUILD_CANVAS
      : !isDirectOffscreen || this.config.effectBackend === 'canvas2d';

    // Canvas 上下文类型一旦确定便不能切换；GPU 模式必须把首次请求留给 WebGL2。
    try
    {
      this.context = requiresCanvas2D ? this.canvas.getContext('2d') : null;
      this.contrastContext = this.contrastCanvas?.getContext('2d') ?? null;
      if (!this.context && requiresCanvas2D)
      {
        throw new Error('BAClickFX 无法创建 Canvas 2D 上下文');
      }
    }
    catch (cause)
    {
      const error = new Error('BAClickFX 无法创建 Canvas 2D 上下文', { cause });
      if (CUSTOM_BUILD)
      {
        error.code = 'initialization-failed';
        this.onError?.(error);
      }
      throw error;
    }

    // 确认上下文可用后才挂载节点和修改宿主样式，构造失败不会留下孤立覆盖层。
    this._applyCompositingMount();
    if (this.canvas.style)
    {
      this.canvas.style.touchAction = this.config.touchAction;
    }

    // 内部 Canvas 仅承担发射遮罩和 ImageData 暂存，不会插入 DOM。
    this.bloomRenderer = BUILD_SOFTWARE && BUILD_BLOOM
      ? new SoftwareBloomRenderer(() => createCanvas()) : null;
    this.bloomRenderers = this.bloomRenderer ? [this.bloomRenderer] : [];
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
    this.nativeClickBloomSurface = null;

    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.fxConfig = CUSTOM_BUILD ? FIXED_FX : structuredClone(UNITY_FX_TOUCH);
    this._gradientEnergyCache = new WeakMap();
    this._fxConfigVersion = 0;
    this._softwareBloomConfigSignature = null;
    this._themeVersion = 0;
    this._themeHueShift = computeThemeHueShift(this.config.themeColor);
    this._relativeOklchTheme = CUSTOM_BUILD ? FIXED_THEME : this.config.themeColorMode === 'relative-oklch'
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
    if (BUILD_DOM)
    {
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
    }
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
    if (!CUSTOM_BUILD &&
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
    if (BUILD_DOM && typeof window !== 'undefined')
    {
      window.addEventListener('resize', this._onResize);
    }
    if (BUILD_DOM && this.config.inputSource === 'dom' && typeof window !== 'undefined')
    {
      this._attachDomPointerListeners();
    }
    if (BUILD_DOM && typeof window !== 'undefined')
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
    this._invalidateCanvasBoundsScope();
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

  _spawnTrailShards(from, to, scale, fromTime, toTime)
  {
    if (!BUILD_TRAIL)
    {
      return false;
    }

    if (!BUILD_SHARDS)
    {
      return;
    }
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

  _spawnClick(x, y)
  {
    if (!BUILD_CLICK)
    {
      return false;
    }

    const scale = this._getScale();
    const clickTimeMs = this._getClickInputTime();

    this.waves.push(new ClickWave(x, y, this.fxConfig, clickTimeMs));

    for (let index = 0; BUILD_SHARDS && index < this.fxConfig.shards.clickCount; index++)
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
    this._invalidateCanvasBoundsScope();
    if (this.destroyed || this.paused || this.animationFrame !== null || (CUSTOM_BUILD && this.buildFailed))
    {
      return;
    }

    this.lastFrameTime = this.lastFrameTime ?? performance.now();
    this.animationFrame = requestRenderFrame(this._onFrame);
  }

  _renderFrame(now)
  {
    // 同步通知允许重入；外层范围一旦被打断，不能恢复成仍然有效的缓存。
    this._invalidateCanvasBoundsScope();
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
    if (CUSTOM_BUILD && !BUILD_CANVAS && effectBackend === null)
    {
      // WebGPU 的 pending 由 ready 回调唤醒；没有备用后端，也不空转 RAF。
      const pending = this.webgpuEffectRenderer?.status === 'pending';
      const lost = this.webglEffectRenderer?.contextLost;
      if (!pending && !lost)
      {
        this._reportBuildError('initialization-failed');
      }
      return;
    }
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

    let useSoftwareBloom = BUILD_SOFTWARE && BUILD_BLOOM && bloomBackend === 'software';
    let useWebGL2Bloom = BUILD_WEBGL_BLOOM && bloomBackend === 'webgl2';
    let useNativeBloom = BUILD_NATIVE && BUILD_BLOOM && bloomBackend === 'native';
    const useCanvasScene = BUILD_CANVAS && BUILD_REFERENCE && this._prepareCanvasSceneBackend(
      useGpuClickEffects,
      bloomBackend,
    );
    if (CUSTOM_BUILD && BUILD_CANVAS && BUILD_NATIVE && BUILD_REFERENCE &&
        this._hasCompositingReference() && !useCanvasScene)
    {
      if (!this.canvasSceneRenderer?.contextLost) this._reportBuildError('compositing-initialization-failed');
      return;
    }
    const reuseCachedSoftwareBloom =
      !CUSTOM_BUILD && !useGpuClickEffects &&
      bloomBackend === 'native' &&
      !useCanvasScene &&
      this._hasCachedSoftwareBloomFrame(scale);

    if (!useSoftwareBloom && !reuseCachedSoftwareBloom)
    {
      // 故障同一时刻仍可复用完整输出；输入推进或 GPU 接管后归还快照。
      this._releaseSoftwareBloomFrame();
    }

    if (reuseCachedSoftwareBloom)
    {
      // Software 回读刚失败但输入尚未推进时，复用上一张完整 Bloom。
      // 这避免 Native 近似在同一帧状态下产生可见的透明 Coverage 跳变。
      useNativeBloom = false;
    }
    // WebGL2 Bloom 已复用完整 Scene Renderer。成功路径无需先栅格一份
    // 随后会被隐藏的 Canvas；GPU 当帧失败时再由回退路径补画即可。
    const drawCanvasOutput =
      BUILD_CANVAS && !useGpuClickEffects && !useCanvasScene && !useWebGL2Bloom;
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
    if (BUILD_CANVAS && !this.context && !useGpuClickEffects)
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
    const previousGradientEnergyCache = gradientEnergyCache;
    const previousRingSampleCache = ringSampleCache;
    const previousBoundsScope = this._canvasBoundsScope;
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
      gradientEnergyCache = this._gradientEnergyCache;
      // 每次渲染独立准备，包括重入；finally 恢复外层范围，不跨帧保存历史阈值。
      ringSampleCache = new WeakMap();
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

      if (BUILD_CANVAS && drawCanvasDuringUpdate)
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

      if (BUILD_CANVAS && drawCanvasDuringUpdate && useNativeBloom)
      {
        this._drawNativeClickBloom(scale);
      }

      if (useGpuClickEffects)
      {
        if (!this._renderGPUClickEffects(effectBackend, scale))
        {
          if (CUSTOM_BUILD)
          {
            this._reportBuildError('render-failed');
            return;
          }
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
            if (CUSTOM_BUILD)
            {
              this._reportBuildError('compositing-render-failed');
              return;
            }
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

      if (useSoftwareBloom && !hasDedicatedSceneOutput)
      {
        // 对象更新已完成；只复用这次合成与整帧收尾的范围，不保存任何像素。
        this._canvasBoundsScope = { valid: true, ready: false, scale, dpr: this.dpr,
          width: this.canvas.width, height: this.canvas.height };
      }

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
      if (CUSTOM_BUILD)
      {
        this._reportBuildError('render-failed', error);
        return;
      }
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
      gradientEnergyCache = previousGradientEnergyCache;
      ringSampleCache = previousRingSampleCache;
      this._canvasBoundsScope = previousBoundsScope;

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
      this._releaseSoftwareBloomFrame();
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
    if (!BUILD_DOM)
    {
      return false;
    }

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

      if (BUILD_TRAIL)
      {
        for (const stroke of this.trailStrokes)
        {
          if (getTrailRenderPoints(stroke).length >= 2)
          {
            drawTrail(
              context,
              getTrailRenderPoints(stroke),
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
      }

      if (BUILD_CLICK)
      {
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
      }

      if (BUILD_SHARDS)
      {
        for (const shard of this.shards)
        {
          shard.draw(
            context,
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
          );
        }
      }

      if (BUILD_CLICK)
      {
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

    if (BUILD_CLICK)
    {
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
    }

    const trailRadius = Math.max(
      1,
      this.fxConfig.trail.geometryWidth * scale *
        bloomCfg.trailCoverageScale * 0.5,
    );

    if (BUILD_TRAIL)
    {
      for (const stroke of this.trailStrokes)
      {
        if (getTrailRenderPoints(stroke).length < 2)
        {
          continue;
        }

        const trailData = this._getTrailFrameData(stroke, bloomCfg.trailEmission);
        const trailOpacity = this._getEffectiveOpacity() *
          (this.fxConfig.trail.trailOpacity ?? 1) *
          bloomCfg.trailEmissionAlpha;
        const emissionQuantizationScale = trailOpacity /
          Math.max(1, bloomCfg.emissionRange) * 255;
        const bloomRuns = [];
        let activeRun = null;

        for (let index = 1; index < getTrailRenderPoints(stroke).length; index++)
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

          const previousPoint = getTrailRenderPoints(stroke)[index - 1];
          const point = getTrailRenderPoints(stroke)[index];

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
    }

    if (BUILD_SHARDS)
    {
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

    if (BUILD_CLICK)
    {
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
    }

    if (BUILD_SHARDS)
    {
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
    }

    const trailCfg = this.fxConfig.trail;
    const trailMargin = Math.max(
      trailCfg.width * scale * 0.5,
      trailCfg.outerGlowWidth * scale * 3 + 2,
    );

    if (BUILD_TRAIL)
    {
      for (const stroke of this.trailStrokes)
      {
        if (getTrailRenderPoints(stroke).length < 2)
        {
          continue;
        }

        let minimumX = Infinity;
        let minimumY = Infinity;
        let maximumX = -Infinity;
        let maximumY = -Infinity;

        for (const point of getTrailRenderPoints(stroke))
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
    }

    return combineBloomRegionBounds(bounds);
  }

  _getCanvasOverlayPixelBounds(scale)
  {
    const scope = this._canvasBoundsScope;
    if (scope?.valid && scope.scale === scale && scope.dpr === this.dpr
      && scope.width === this.canvas.width && scope.height === this.canvas.height)
    {
      if (!scope.ready)
      {
        const value = this._computeCanvasOverlayPixelBounds(scale);
        // 计算过程中若发生同步状态变化，结果不进入缓存。
        if (scope.valid) { scope.value = value; scope.ready = true; }
        return value;
      }
      return scope.value;
    }
    return this._computeCanvasOverlayPixelBounds(scale);
  }

  _invalidateCanvasBoundsScope()
  {
    if (this._canvasBoundsScope) this._canvasBoundsScope.valid = false;
  }

  _computeCanvasOverlayPixelBounds(scale)
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
    if (this._softwareBloomConfigSignature?.version !== this._fxConfigVersion)
    {
      // 公共调参均原子提交并递增版本；保留原序列化字节，只省去稳定帧重复遍历。
      this._softwareBloomConfigSignature = {
        version: this._fxConfigVersion,
        value: JSON.stringify(this.fxConfig),
      };
    }
    const trailSignature = this.trailStrokes.map((stroke) =>
    {
      const first = getTrailRenderPoints(stroke)[0];
      const last = getTrailRenderPoints(stroke).at(-1);

      return [
        getTrailRenderPoints(stroke).length,
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
      this._softwareBloomConfigSignature.value,
      trailSignature,
      waveSignature,
      shardSignature,
    ].join(':');
  }

  _releaseSoftwareBloomFrame()
  {
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

    const canvas = this.lastSoftwareBloomFrame?.canvas;

    this.lastSoftwareBloomFrame = null;
    if (canvas && canvas !== this.canvas)
    {
      // 解除引用之外也归还像素缓冲，宿主保留已销毁实例时不继续占用整屏内存。
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  _cacheSoftwareBloomFrame(scale)
  {
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

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
      this._releaseSoftwareBloomFrame();
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
      this._releaseSoftwareBloomFrame();
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
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

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
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

    return this.config.outputCompositing === 'browser-overlay' &&
      this.lastSoftwareBloomFrame?.canvas !== undefined &&
      this.lastSoftwareBloomFrame.signature ===
        this._getSoftwareBloomFrameSignature(scale);
  }

  _renderSoftwareBloom(scale)
  {
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

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

        if (getTrailRenderPoints(stroke).length >= 2)
        {
          drawTrailEmission(
            bloomContext,
            getTrailRenderPoints(stroke),
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

          if (getTrailRenderPoints(stroke).length >= 2)
          {
            drawTrailCoverage(
              coverageContext,
              getTrailRenderPoints(stroke),
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
      if (CUSTOM_BUILD)
      {
        this._reportBuildError('software-bloom-failed');
        return;
      }
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

    const hasVisibleTrail = BUILD_TRAIL && this.trailStrokes.some(
      (stroke) => getTrailRenderPoints(stroke).length >= 2,
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
      if (BUILD_TRAIL)
      {
        for (const stroke of this.trailStrokes)
        {
          if (getTrailRenderPoints(stroke).length < 2)
          {
            continue;
          }

          appendTrailWebGLScene(
            renderer,
            getTrailRenderPoints(stroke),
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
            stroke.trailFrameData,
          );
        }
      }

      // Cross2 使用 One / OneMinusSrcAlpha，必须先于普通加色粒子提交。
      if (BUILD_CLICK)
      {
        for (const wave of this.waves)
        {
          wave.appendWebGLSceneDiskLayer(
            renderer,
            scale,
            this._getEffectiveOpacity(),
          );
        }
      }

      // Dissolve MeshTri 与 Cross2、Trail 同为 4499，先完成这一队列。
      if (BUILD_CLICK)
      {
        for (const wave of this.waves)
        {
          wave.appendWebGLSceneAdditiveLayer(
            renderer,
            scale,
            this._getEffectiveOpacity(),
          );
        }
      }

      // Tri2 的 RenderQueue=4550，必须在全部 4499 材质之后提交。
      if (BUILD_SHARDS)
      {
        for (const shard of this.shards)
        {
          shard.appendWebGLScene(
            renderer,
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
          );
        }
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
    if (!BUILD_REFERENCE)
    {
      return false;
    }

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
      if (BUILD_CLICK)
      {
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
      }

      if (BUILD_CLICK)
      {
        for (const wave of this.waves)
        {
          wave.drawAdditiveBase(
            this.context,
            scale,
            this._getEffectiveOpacity(),
            true,
          );
        }
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
      if (BUILD_SHARDS)
      {
        for (const shard of this.shards)
        {
          shard.draw(
            this.context,
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
          );
        }
      }

      if (useNativeBloom)
      {
        if (!this.nativeClickBloomSurface)
        {
          const canvas = createCanvas();
          const context = canvas.getContext('2d');
          if (!context)
          {
            return false;
          }
          this.nativeClickBloomSurface = { canvas, context };
        }
        const { canvas, context } = this.nativeClickBloomSurface;
        const width = Math.max(1, Math.ceil(this.canvas.width * 0.5));
        const height = Math.max(1, Math.ceil(this.canvas.height * 0.5));
        if (canvas.width !== width || canvas.height !== height)
        {
          canvas.width = width;
          canvas.height = height;
        }
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, width, height);
        context.setTransform(width / this.width, 0, 0, height / this.height, 0, 0);
        this._drawNativeClickBloom(scale, context, 'host-additive');
      }
      const rendered = renderer.render(this.canvas,
        useNativeBloom ? this.nativeClickBloomSurface.canvas : null);
      if (CUSTOM_BUILD && rendered && !this.ownsCanvas)
      {
        // 外部 Canvas 只容纳一个 context；辅助 GPU 合成完成后复制最终像素。
        this.context.setTransform(1, 0, 0, 1, 0, 0);
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.context.drawImage(this.canvasSceneCanvas, 0, 0);
        this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
      return rendered;
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
    if (!(BUILD_CANVAS)) return false;

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
    if (!(BUILD_CANVAS)) return false;

    this._invalidateCanvasBoundsScope();
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
    if (!(BUILD_CANVAS)) return false;

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
    if (!(!CUSTOM_BUILD)) return false;

    this._invalidateCanvasBoundsScope();
    const scale = this._getScale();
    const previousHueShift = themeHueShift;
    const previousRelativeOklchTheme = relativeOklchTheme;
    const previousGradientEnergyCache = gradientEnergyCache;
    const previousRingSampleCache = ringSampleCache;
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
      gradientEnergyCache = this._gradientEnergyCache;
      ringSampleCache = new WeakMap();
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
      gradientEnergyCache = previousGradientEnergyCache;
      ringSampleCache = previousRingSampleCache;

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
    if (!(BUILD_CANVAS)) return false;

    if (!BUILD_CLICK)
    {
      return false;
    }

    const outputCompositing = this._getCanvasOutputCompositing();
    // 最终 Canvas 载荷会在所有图元聚合后统一补偿一次。
    const overlayColorCompensation = 'none';
    const overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit();

    if (BUILD_CLICK)
    {
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
    if (BUILD_SHARDS)
    {
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

    if (useNativeBloom)
    {
      this._drawNativeClickBloom(scale);
    }
  }

  _drawNativeClickBloom(
    scale,
    context = this.context,
    outputCompositing = this._getCanvasOutputCompositing(),
  )
  {
    if (!(BUILD_NATIVE && BUILD_BLOOM)) return false;

    if (!BUILD_CLICK)
    {
      return false;
    }

    const settings = this.fxConfig.bloom;
    const opacity = this._getEffectiveOpacity();

    if (settings.intensity <= 0 || settings.clickEmissionScale <= 0 || opacity <= 0)
    {
      return;
    }

    const emission = settings.clickEmissionScale;
    const sampleColor = [0, 0, 0];
    context.save();
    // 光晕是独立的 Final Bloom 增量，不能重画 Cross2 本体或让后来的圆盘
    // 遮住先前的光晕；所有清晰材质提交完毕后只进行一次加色。
    context.globalCompositeOperation = 'lighter';
    // 原生路径先确定发光源，再应用宿主透明度，避免半透明时细环因
    // 近似预过滤跌出阈值而突然失去整层 Bloom。
    context.globalAlpha = opacity;
    context.shadowBlur = 0;

    if (BUILD_CLICK)
    {
      for (const wave of this.waves)
      {
        const sources = [];
        const diskCfg = this.fxConfig.disk;
        const diskProgress = wave.ageMs / diskCfg.lifetimeMs;

        if (diskProgress < 1 && settings.diskAlpha > 0 && settings.diskBlur > 0)
        {
          const radius = diskCfg.radius * evaluateUnityHermiteCurve(
            diskCfg.sizeKeys, diskProgress,
          ) * scale;
          const material = evaluateSrgbGradientEnergy(
            diskCfg.colorKeys, diskProgress,
            settings.diskEmission * emission * settings.diskEmissionAlpha,
          );
          const source = createNativeBloomSource(settings);
          source.blurScale = settings.diskBlur / 65;
          // 小型固定网格来自原 Circle_01，保留纹理面积与 HDR RGB。
          // Cross2 生命周期 Alpha 只衰减背景，不应提前削弱 Bloom 发射。
          const samples = getNativeCircleBloomSamples();
          const area = (2 * radius / NATIVE_BLOOM_DISK_SAMPLES) ** 2 * settings.diskAlpha / 0.65;
          for (let offset = 0; offset < samples.length; offset += 4)
          {
            sampleColor[0] = material[0] * samples[offset];
            sampleColor[1] = material[1] * samples[offset + 1];
            sampleColor[2] = material[2] * samples[offset + 2];
            addNativeBloomSample(source, sampleColor, area, samples[offset + 3] * radius ** 2);
          }
          sources.push(source);
        }

        const ringCfg = this.fxConfig.rings;
        const ringProgress = wave.ageMs / ringCfg.lifetimeMs;
        if (ringProgress < 1 && settings.ringAlpha > 0 && settings.ringBlur > 0)
        {
          const material = evaluateSrgbGradientEnergy(
            ringCfg.colorKeys, ringProgress,
            ringCfg.hdrIntensity * emission * settings.ringEmissionAlpha,
          );
          for (const ring of wave.rings)
          {
            const geometry = resolveRingGeometry(ring, ringProgress, scale, ringCfg);
            const source = createNativeBloomSource(settings);
            source.blurScale = settings.ringBlur / 80;
            source.radius = geometry.radius;
            source.width = geometry.width;
            const radialSamples = resolveRingIntegrationSamples(ringCfg);
            const angularSamples = 64;
            // GPU 在阈值提取前先缩小 Scene；亚像素环带会与周围黑色平均。
            // 同时扩大样本面积以守恒能量，避免细碎溶解末期仍发出完整圆形光雾。
            const prefilterCoverage = Math.min(1, Math.max(0.000001,
              geometry.width * this.dpr * settings.resolutionScale * 0.75));
            const area = TAU * geometry.radius * geometry.width / angularSamples *
              settings.ringAlpha / 0.35 / prefilterCoverage;
            for (let sample = 0; sample < angularSamples; sample++)
            {
              let coverage = 0;
              for (let band = 0; band < radialSamples; band++)
              {
                coverage += evaluateRingLuminance(
                  (sample + 0.5) / angularSamples, (band + 0.5) / radialSamples,
                  geometry.threshold, ringCfg,
                );
              }
              coverage *= prefilterCoverage / radialSamples;
              sampleColor[0] = material[0] * coverage;
              sampleColor[1] = material[1] * coverage;
              sampleColor[2] = material[2] * coverage;
              addNativeBloomSample(source, sampleColor, area, geometry.radius * geometry.radius);
            }
            sources.push(source);
          }
        }

        const x = wave.x;
        const y = wave.y;
        const profile = createNativeBloomProfile(sources, this.width, this.height, this.dpr, settings);
        if (!profile)
        {
          continue;
        }
        // 保持原有各向同性扩散，只绘制径向 Profile。
        const gain = 1;
        const gradient = context.createRadialGradient(x, y, 0, x, y, profile.radius);
        for (const stop of profile.stops)
        {
          const color = outputCompositing === 'scene'
            ? linearEnergyToAdditiveCss(stop.energy, gain)
            : outputCompositing === 'browser-overlay'
              ? linearEnergyToOverlayCss(stop.energy, gain, linearToSrgb(stop.transport * gain),
                  'none', this._getEffectiveOverlayAlphaLimit(), opacity)
              : linearEnergyToHostAdditiveCss(stop.energy, gain, linearToSrgb(stop.transport * gain));
          gradient.addColorStop(stop.position, color);
        }
        context.fillStyle = gradient;
        context.fillRect(x - profile.radius, y - profile.radius,
          profile.radius * 2, profile.radius * 2);
      }
    }
    context.restore();
  }

  _drawCanvasTrails(
    scale,
    useNativeBloom,
    linearOutput = false,
  )
  {
    if (!BUILD_TRAIL)
    {
      return false;
    }

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

      if (getTrailRenderPoints(stroke).length < 2)
      {
        continue;
      }

      this._getTrailFrameData(stroke, this.fxConfig.bloom.trailEmission);

      drawTrail(
        this.context,
        getTrailRenderPoints(stroke),
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
    if (!BUILD_WEBGL_BLOOM)
    {
      return false;
    }

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

  _getTrailFrameData(stroke, materialIntensity)
  {
    if (!BUILD_TRAIL)
    {
      return false;
    }

    const cached = stroke.trailFrameCache;
    const valid = cached && cached.points === getTrailRenderPoints(stroke) &&
      cached.pointsVersion === stroke.pointsVersion &&
      cached.configVersion === this._fxConfigVersion &&
      cached.themeVersion === this._themeVersion &&
      cached.hueShift === themeHueShift && cached.relativeTheme === relativeOklchTheme;
    let data = valid ? stroke.trailFrameData : null;
    if (!data)
    {
      releaseTrailGradients(stroke.trailFrameData);
      data = createTrailFrameData(getTrailRenderPoints(stroke), this.fxConfig.trail, materialIntensity, true);
      stroke.trailFrameCache = {
        points: getTrailRenderPoints(stroke),
        pointsVersion: stroke.pointsVersion,
        configVersion: this._fxConfigVersion,
        themeVersion: this._themeVersion,
        // 后端事件可在帧内改主题；版本之外还记录本次实际使用的渲染上下文。
        hueShift: themeHueShift,
        relativeTheme: relativeOklchTheme,
        materialIntensity,
      };
    }
    else if (materialIntensity !== null &&
      (cached.materialIntensity !== materialIntensity || !Array.isArray(data.segmentEnergies)))
    {
      // 几何缓存可跨后端复用，材质只在 Canvas 路径确实需要时补齐。
      data = createTrailFrameData(getTrailRenderPoints(stroke), this.fxConfig.trail, materialIntensity, true, data);
      cached.materialIntensity = materialIntensity;
    }
    stroke.trailFrameData = data;
    return data;
  }

  _clearTrailStrokes()
  {
    if (!BUILD_TRAIL)
    {
      return false;
    }

    if (BUILD_TRAIL)
    {
      for (const stroke of this.trailStrokes)
      {
        invalidateTrailPoints(stroke);
      }
    }
    this.trailStrokes.length = 0;
  }

  _updateTrail(
    trailTimeMs,
    scale,
    useNativeBloom,
    drawCanvas = true,
    useTexturedWebGL = false,
  )
  {
    if (!BUILD_TRAIL)
    {
      return false;
    }

    const lifetime = this.fxConfig.trail.lifetimeMs;

    for (let strokeIndex = this.trailStrokes.length - 1; strokeIndex >= 0; strokeIndex--)
    {
      const stroke = this.trailStrokes[strokeIndex];
      if (updateTrailRenderPoints(stroke, trailTimeMs, lifetime))
      {
        // 即使没有输入，过期边界仍会移动；几何和渐变缓存必须一起失效。
        invalidateTrailPoints(stroke);
        stroke.renderPointCache.version = stroke.pointsVersion;
      }
      if (getTrailRenderPoints(stroke).length >= 2)
      {
        const materialIntensity = useTexturedWebGL ? null : this.fxConfig.bloom.trailEmission;
        this._getTrailFrameData(stroke, materialIntensity);
      }
      else
      {
        releaseTrailGradients(stroke.trailFrameData);
        stroke.trailFrameData = null;
        stroke.trailFrameCache = null;
      }
      if (!stroke.active && getTrailRenderPoints(stroke).length < 2)
      {
        this.trailStrokes.splice(strokeIndex, 1);
      }
    }
    if (BUILD_CANVAS && drawCanvas)
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
    if (!BUILD_CLICK)
    {
      return false;
    }

    for (let index = this.waves.length - 1; index >= 0; index--)
    {
      const wave = this.waves[index];

      wave.updateTo(clickTimeMs);

      if (wave.dead)
      {
        this.waves.splice(index, 1);
        continue;
      }

      if (BUILD_CANVAS && drawCanvas)
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
    if (!(BUILD_CANVAS)) return false;

    if (!BUILD_CLICK)
    {
      return false;
    }

    if (BUILD_CLICK)
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
  }

  _updateShards(clickTimeMs, trailTimeMs, scale, drawCanvas = true)
  {
    if (!BUILD_SHARDS)
    {
      return false;
    }

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

      if (BUILD_CANVAS && drawCanvas)
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
      this.trailStrokes.some((stroke) => hasVisibleTrailPoints(getTrailRenderPoints(stroke)))
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

  _applyThemeColor(hex)
  {
    const themeColor = normalizeThemeColor(hex, DEFAULT_THEME_COLOR);

    // 映射只缓存到所属实例；两个渲染入口会随主题上下文一起保存与恢复。
    this._gradientEnergyCache = new WeakMap();
    this.config.themeColor = themeColor;
    this._themeVersion++;
    this._themeHueShift = computeThemeHueShift(themeColor);
    this._relativeOklchTheme = this.config.themeColorMode === 'relative-oklch'
      ? createRelativeOklchTheme(themeColor)
      : null;
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
    if (!BUILD_REFERENCE)
    {
      return false;
    }

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
    this._releaseSoftwareBloomFrame();
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
      this._releaseNativeClickBloomSurface();
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
      unity: structuredClone(CUSTOM_BUILD ? this.fxConfig : UNITY_FX_TOUCH),
    };
  }

  _getResolvedWebGPUOutputMode()
  {
    if (CUSTOM_BUILD && BUILD_WEBGPU)
    {
      const mode = this.webgpuEffectRenderer?.deviceManager.outputMode;
      return mode === 'standard' || mode === 'extended' ? mode : this.buildFailed ? 'unavailable' : 'pending';
    }
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


