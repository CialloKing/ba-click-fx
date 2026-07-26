/**
 * ba-click-fx — Blue Archive 的 UI/FX_Touch 浏览器移植。
 *
 * 这不是“相似风格”参数化引擎。实现直接复刻 Unity 中 FXTouch、
 * ParticleSystem 和 TrailRenderer 的生命周期，只保留宿主接入所需的最小 API。
 */

import {
  CONFIG,
  UNITY_FX_TOUCH,
  createConfig,
  isBloomBackend,
  isEffectBackend,
  isInputSource,
  normalizeBloomBackend,
  normalizeEffectBackend,
  normalizeTimeScale,
  SIZE_CORRECTION,
} from './config.js';
import { SoftwareBloomRenderer } from './software-bloom.js';
import { WebGL2BloomRenderer } from './webgl2-bloom.js';

const TAU = Math.PI * 2;
const LIGHT_BACKGROUND_CONTRAST_COLOR = [76, 255, 255];
const BLOOM_BACKEND_CHANGE_EVENT = 'baclickfxbackendchange';
const EFFECT_BACKEND_CHANGE_EVENT = 'baclickfxeffectbackendchange';
const MAX_SCALED_TIME_DELTA_MS = Number.MAX_SAFE_INTEGER;
const DEFAULT_BLOOM_CLAMP = 65472;
const HALF_FLOAT_MAX = 65504;
const MAX_TRAIL_INNER_MITER_RATIO = 4;

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
let renderDpr = 1;
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

function evaluateColor(keys, progress)
{
  if (!keys || keys.length === 0)
  {
    return [0, 0, 0];
  }

  const t = clamp01(progress);

  if (t <= keys[0][0])
  {
    return [...keys[0][1]];
  }

  for (let index = 1; index < keys.length; index++)
  {
    const previous = keys[index - 1];
    const current = keys[index];

    if (t <= current[0])
    {
      const span = current[0] - previous[0];
      const localProgress = span > 0 ? (t - previous[0]) / span : 1;

      return [
        lerp(previous[1][0], current[1][0], localProgress),
        lerp(previous[1][1], current[1][1], localProgress),
        lerp(previous[1][2], current[1][2], localProgress),
      ];
    }
  }

  return [...keys[keys.length - 1][1]];
}

function colorToCss(color, alpha = 1)
{
  // 在 clamp 之前应用主题色 hue 偏移，保留 HDR 亮度信息
  const themed = applyThemeHue(color);
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

function resolveNativeBloomIntensityScale(bloomCfg)
{
  const referenceIntensity = Math.max(
    0.000001,
    UNITY_FX_TOUCH.bloom.intensity,
  );

  // 原生阴影参数按游戏默认 1.7 标定；归一化后仍让运行时强度控制生效。
  return Math.max(0, bloomCfg.intensity) / referenceIntensity;
}

function resolveBloomClamp(value)
{
  const finiteValue = Number.isFinite(value)
    ? value
    : DEFAULT_BLOOM_CLAMP;

  return clamp(finiteValue, 0, HALF_FLOAT_MAX);
}

function resolveBloomThresholdContribution(color, opacity, bloomCfg)
{
  const safeOpacity = Math.max(0, opacity);
  const clampMax = resolveBloomClamp(bloomCfg.clamp);
  const clampedColor = color.map((channel) =>
    Math.min(Math.max(0, channel) * safeOpacity, clampMax));
  const brightness = Math.max(...clampedColor);

  if (brightness <= 0)
  {
    return 0;
  }

  const threshold = gammaToLinearValue(Math.max(0, bloomCfg.threshold));
  const knee = threshold * clamp01(bloomCfg.softKnee) + 0.00001;
  let soft = brightness - threshold + knee;

  soft = clamp(soft, 0, knee * 2);
  soft = soft * soft / (knee * 4);

  return Math.max(brightness - threshold, soft, 0) / brightness;
}

function thresholdBloomEnergy(color, opacity, bloomCfg)
{
  const safeOpacity = Math.max(0, opacity);
  const clampMax = resolveBloomClamp(bloomCfg.clamp);
  const contribution = resolveBloomThresholdContribution(
    color,
    safeOpacity,
    bloomCfg,
  );

  return color.map((channel) =>
    Math.min(Math.max(0, channel) * safeOpacity, clampMax) *
      contribution);
}

function srgbToLinearChannel(channel)
{
  const normalized = clamp01(channel / 255);

  return gammaToLinearValue(normalized);
}

function gammaToLinearValue(value)
{
  const normalized = Math.max(0, value);

  if (normalized <= 0.04045)
  {
    return normalized / 12.92;
  }

  // Bloom Threshold 是 Gamma 空间的 HDR 标量，允许大于 1，不能像颜色通道一样钳制。
  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function colorToLinearEnergy(color, intensity = 1, decodeSrgb = false)
{
  const themed = applyThemeHue(color);
  const safeIntensity = Math.max(0, intensity);

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
    applyThemeHue(color).map(srgbToLinearChannel),
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

function isCanvas(value)
{
  return value?.tagName?.toLowerCase?.() === 'canvas';
}

function resolveTarget(target)
{
  if (typeof target === 'string')
  {
    return document.querySelector(target);
  }

  return target ?? null;
}

function createCanvas()
{
  const canvas = document.createElement('canvas');

  canvas.setAttribute('aria-hidden', 'true');
  return canvas;
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
  const angularAlpha = evaluateNumber(
    ringCfg.textureAlphaKeys,
    angularProgress,
  );
  const radialAlpha = evaluateNumber(
    ringCfg.textureRadialAlphaKeys,
    radialProgress,
  );

  // FX_TEX_Grad_Ring3 的二维 Alpha 接近可分离分布；U 控制圆周，
  // V 让环带中央比内外沿约亮 12%。
  return clamp01(angularAlpha * radialAlpha);
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
  const stops = [];

  for (let sample = 0; sample <= sampleCount; sample++)
  {
    const angularProgress = sample / sampleCount;
    const textureProgress = direction > 0
      ? angularProgress
      : 1 - angularProgress;
    const luminance = evaluateRingLuminance(
      textureProgress,
      radialProgress,
      threshold,
      ringCfg,
    );
    stops.push([angularProgress, colorForLuminance(luminance)]);
  }

  for (const [stop, color] of stops)
  {
    gradient.addColorStop(stop, color);
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
    const textureProgress = direction > 0
      ? angularProgress
      : 1 - angularProgress;
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
  const thresholdContribution = resolveBloomThresholdContribution(
    materialEnergy,
    opacity,
    bloomCfg,
  );
  const colorForLuminance = (luminance) => linearEnergyToAdditiveCss(
    materialEnergy,
    opacity * luminance,
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
    colorForLuminance,
    useNativeBloom
      ? {
          // Canvas shadowBlur 不随当前变换缩放，显式乘 DPR 保持 CSS 半径一致。
          blur: bloomCfg.ringBlur * scale * renderDpr,
          color: colorToCss(
            particleColor,
            scaleNativeGlowAlpha(
              opacity * bloomCfg.ringAlpha * thresholdContribution,
              bloomCfg.clickEmissionScale *
                resolveNativeBloomIntensityScale(bloomCfg),
            ),
          ),
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
)
{
  const diskCfg = fxConfig.disk;
  const bloomCfg = fxConfig.bloom;
  const radius = diskCfg.radius * evaluateUnityHermiteCurve(
    diskCfg.sizeKeys,
    progress,
  ) * scale;
  const color = evaluateColor(diskCfg.colorKeys, progress);
  const particleAlpha = evaluateNumber(
    diskCfg.alphaKeys,
    progress,
  ) * opacity;
  const colorGradient = context.createRadialGradient(
    wave.x,
    wave.y,
    0,
    wave.x,
    wave.y,
    Math.max(radius, 0.01),
  );
  const attenuationGradient = context.createRadialGradient(
    wave.x,
    wave.y,
    0,
    wave.x,
    wave.y,
    Math.max(radius, 0.01),
  );

  const materialEnergy = evaluateSrgbGradientEnergy(
    diskCfg.colorKeys,
    progress,
    bloomCfg.diskEmission,
  );
  const thresholdContribution = resolveBloomThresholdContribution(
    materialEnergy,
    opacity,
    bloomCfg,
  );

  for (const [position, energy] of diskCfg.textureRadialEnergyKeys)
  {
    const textureAlpha = evaluateNumber(
      diskCfg.textureRadialAlphaKeys,
      position,
    );

    // AlphaBlendAdd 的 RGB 不乘粒子 Alpha；Alpha 只衰减已有目标颜色。
    colorGradient.addColorStop(
      position,
      linearEnergyToAdditiveCss(materialEnergy, opacity * energy),
    );
    attenuationGradient.addColorStop(
      position,
      `rgba(0, 0, 0, ${clamp01(particleAlpha * textureAlpha)})`,
    );
  }

  context.save();
  // Canvas 没有 One/OneMinusSrcAlpha；先只衰减目标，再独立加上源 RGB。
  context.globalCompositeOperation = 'destination-out';
  context.beginPath();
  context.arc(wave.x, wave.y, radius, 0, TAU);
  context.fillStyle = attenuationGradient;
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.fill();

  context.globalCompositeOperation = 'lighter';
  context.beginPath();
  context.arc(wave.x, wave.y, radius, 0, TAU);
  context.fillStyle = colorGradient;
  context.shadowColor = colorToCss(
    color,
    scaleNativeGlowAlpha(
      opacity * bloomCfg.diskAlpha * thresholdContribution,
      bloomCfg.clickEmissionScale *
        resolveNativeBloomIntensityScale(bloomCfg),
    ),
  );
  context.shadowBlur = useNativeBloom
    ? bloomCfg.diskBlur * scale * renderDpr
    : 0;
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
  const particleAlpha = evaluateNumber(
    diskCfg.alphaKeys,
    progress,
  ) * opacity;
  const materialEnergy = evaluateSrgbGradientEnergy(
    diskCfg.colorKeys,
    progress,
    bloomCfg.diskEmission,
  );
  const colorGradient = context.createRadialGradient(
    wave.x,
    wave.y,
    0,
    wave.x,
    wave.y,
    Math.max(radius, 0.01),
  );
  const attenuationGradient = context.createRadialGradient(
    wave.x,
    wave.y,
    0,
    wave.x,
    wave.y,
    Math.max(radius, 0.01),
  );

  for (const [position, energy] of diskCfg.textureRadialEnergyKeys)
  {
    const textureAlpha = evaluateNumber(
      diskCfg.textureRadialAlphaKeys,
      position,
    );

    colorGradient.addColorStop(
      position,
      linearEnergyToEmissionCss(
        materialEnergy,
        opacity * bloomCfg.diskEmissionAlpha * energy,
        bloomCfg.emissionRange,
        bloomCfg.clickEmissionScale,
      ),
    );
    attenuationGradient.addColorStop(
      position,
      `rgba(0, 0, 0, ${clamp01(particleAlpha * textureAlpha)})`,
    );
  }

  context.save();
  context.globalCompositeOperation = 'destination-out';
  context.beginPath();
  context.arc(wave.x, wave.y, radius, 0, TAU);
  context.fillStyle = attenuationGradient;
  context.fill();

  context.globalCompositeOperation = 'lighter';
  context.beginPath();
  context.arc(wave.x, wave.y, radius, 0, TAU);
  context.fillStyle = colorGradient;
  context.fill();
  context.restore();
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

  const rawIndex = Number.isInteger(particle.textureFrame)
    ? particle.textureFrame
    : 0;
  const frameIndex = ((rawIndex % frames.length) + frames.length) % frames.length;

  return frames[frameIndex];
}

function drawTriangle(
  context,
  particle,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  useNativeBloom = false,
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
  const textureFrame = resolveShardTextureFrame(particle, shardCfg);

  if (size <= 0 || alpha <= 0)
  {
    return;
  }

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.beginPath();
  context.moveTo(textureFrame[0][0] * size, textureFrame[0][1] * size);
  context.lineTo(textureFrame[1][0] * size, textureFrame[1][1] * size);
  context.lineTo(textureFrame[2][0] * size, textureFrame[2][1] * size);
  context.closePath();
  context.fillStyle = linearEnergyToAdditiveCss(materialEnergy, alpha);

  if (useNativeBloom)
  {
    const thresholdContribution = resolveBloomThresholdContribution(
      materialEnergy,
      alpha,
      bloomCfg,
    );

    if (thresholdContribution > 0)
    {
      // Unity Bloom 对所有 HDR UI 粒子使用同一阈值。原生 Canvas 无法建立
      // mip 金字塔，因此用阈值以上的能量驱动低强度阴影，避免碎片被过曝。
      context.shadowColor = colorToCss(
        evaluateColor(shardCfg.colorKeys, progress),
        scaleNativeGlowAlpha(
          alpha * bloomCfg.shardAlpha * thresholdContribution,
          resolveNativeBloomIntensityScale(bloomCfg),
        ),
      );
      context.shadowBlur = bloomCfg.shardBlur * scale * renderDpr;
    }
    else
    {
      context.shadowColor = 'transparent';
      context.shadowBlur = 0;
    }
  }
  else
  {
    // 软件/WebGL2 Bloom 会从 HDR 发射源统一生成辉光，不能再叠加阴影。
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
  }

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
  const textureFrame = resolveShardTextureFrame(particle, shardCfg);

  if (size <= 0 || alpha <= 0)
  {
    return;
  }

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.beginPath();
  context.moveTo(textureFrame[0][0] * size, textureFrame[0][1] * size);
  context.lineTo(textureFrame[1][0] * size, textureFrame[1][1] * size);
  context.lineTo(textureFrame[2][0] * size, textureFrame[2][1] * size);
  context.closePath();
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

function drawHit(context, wave, progress, scale, opacity, fxConfig)
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
  context.fillStyle = colorToCss(color, alpha);
  context.fill();
  context.restore();
}

function drawFlare(context, wave, progress, scale, opacity, fxConfig)
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

  for (let i = 0; i < cfg.rayCount; i++)
  {
    const angle = (TAU / cfg.rayCount) * i;
    const endX = Math.cos(angle) * radius;
    const endY = Math.sin(angle) * radius;

    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(endX, endY);
    context.strokeStyle = colorToCss(color, alpha);
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

  draw(context, scale, opacity, useNativeBloom = true)
  {
    this.drawDiskLayer(context, scale, opacity, useNativeBloom);
    this.drawAdditiveLayer(context, scale, opacity, useNativeBloom);
  }

  drawDiskLayer(context, scale, opacity, useNativeBloom = true)
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
      );
    }
  }

  drawAdditiveLayer(context, scale, opacity, useNativeBloom = true)
  {
    // Hit：撞击爆发，极短极亮
    const hitProgress = this.ageMs / this.fx.hit.lifetimeMs;

    if (this.fx.hit.enabled && hitProgress < 1)
    {
      drawHit(context, this, hitProgress, scale, opacity, this.fx);
    }

    // Flare：星形闪光
    const flareProgress = this.ageMs / this.fx.flare.lifetimeMs;

    if (this.fx.flare.enabled && flareProgress < 1)
    {
      drawFlare(context, this, flareProgress, scale, opacity, this.fx);
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
        drawDissolvedCircle(
          context,
          ring,
          ringProgress,
          scale,
          opacity,
          this.fx,
          useNativeBloom,
          ringMaterialEnergy,
        );
      }
    }
  }

  drawBloom(context, scale, opacity)
  {
    this.drawBloomDiskLayer(context, scale, opacity);
    this.drawBloomAdditiveLayer(context, scale, opacity);
  }

  drawBloomDiskLayer(context, scale, opacity)
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
  }

  drawBloomAdditiveLayer(context, scale, opacity)
  {
    if (this.fx.bloom.clickEmissionScale <= 0)
    {
      return;
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

  appendWebGLScene(renderer, scale, opacity)
  {
    this.appendWebGLSceneDiskLayer(renderer, scale, opacity);
    this.appendWebGLSceneAdditiveLayer(renderer, scale, opacity);
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
    ) * opacity;

    renderer.addAlphaBlendDisk(
      this.x,
      this.y,
      radius,
      materialEnergy,
      opacity,
      particleAlpha,
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
        (angularProgress, radialProgress) =>
        {
          const textureProgress = direction > 0
            ? angularProgress
            : 1 - angularProgress;

          return evaluateRingTextureAlpha(
            textureProgress,
            radialProgress,
            ringCfg,
          );
        },
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
      const sourceOpacity = opacity * bloomCfg.diskEmissionAlpha *
        bloomCfg.clickEmissionScale;
      const particleAlpha = evaluateNumber(
        diskCfg.alphaKeys,
        diskProgress,
      ) * opacity;
      const materialEnergy = evaluateSrgbGradientEnergy(
        diskCfg.colorKeys,
        diskProgress,
        bloomCfg.diskEmission,
      );

      renderer.addAlphaBlendDisk(
        this.x,
        this.y,
        radius,
        materialEnergy,
        sourceOpacity,
        particleAlpha,
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

      renderer.addDissolveRing(
        ring.x,
        ring.y,
        geometry.radius,
        geometry.width,
        ring.rotation,
        ringCfg.radialSamples,
        ringCfg.arcSamples,
        ringMaterialEnergy,
        opacity * bloomCfg.ringEmissionAlpha * bloomCfg.clickEmissionScale,
        geometry.threshold,
        (angularProgress, radialProgress) =>
        {
          const textureProgress = direction > 0
            ? angularProgress
            : 1 - angularProgress;

          return evaluateRingTextureAlpha(
            textureProgress,
            radialProgress,
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
    useNativeBloom = false,
  )
  {
    drawTriangle(
      context,
      this,
      scale,
      opacity,
      fxConfig,
      useNativeBloom,
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

  appendWebGLScene(
    renderer,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
  )
  {
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
    const textureFrame = resolveShardTextureFrame(this, shardCfg);

    renderer.addTriangle(
      this.x,
      this.y,
      size,
      this.rotation,
      materialEnergy,
      alpha,
      textureFrame,
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

function measureTrail(points)
{
  let totalLength = 0;
  const distances = [0];

  for (let index = 1; index < points.length; index++)
  {
    totalLength += distance(points[index - 1], points[index]);
    distances.push(totalLength);
  }

  return {
    distances,
    totalLength,
  };
}

function createTrailFrameData(
  points,
  trailCfg,
  materialIntensity = null,
)
{
  const measurement = measureTrail(points);
  const pointEnergies = [];
  const pointTransverseProfiles = [];
  const segmentEnergies = [];
  const segmentMaximumEnergies = [];
  const segmentTransverseProfiles = [];
  const textureLongitudinalKeys = trailCfg.textureLongitudinalKeys;

  if (measurement.totalLength <= 0 || materialIntensity === null)
  {
    return {
      measurement,
      pointEnergies,
      pointTransverseProfiles,
      segmentEnergies,
      segmentMaximumEnergies,
      segmentTransverseProfiles,
    };
  }

  for (let index = 0; index < points.length; index++)
  {
    const progress = measurement.distances[index] / measurement.totalLength;

    pointEnergies.push(
      evaluateTrailLinearEnergy(
        progress,
        trailCfg,
        materialIntensity,
        textureLongitudinalKeys,
      ),
    );
    pointTransverseProfiles.push(
      evaluateTrailTransverseProfile(
        progress,
        trailCfg,
        textureLongitudinalKeys,
      ),
    );
  }

  for (let index = 1; index < points.length; index++)
  {
    const progress = (
      measurement.distances[index - 1] + measurement.distances[index]
    ) * 0.5 / measurement.totalLength;
    const energy = evaluateTrailLinearEnergy(
      progress,
      trailCfg,
      materialIntensity,
      textureLongitudinalKeys,
    );

    segmentEnergies.push(energy);
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
  }

  return {
    measurement,
    pointEnergies,
    pointTransverseProfiles,
    segmentEnergies,
    segmentMaximumEnergies,
    segmentTransverseProfiles,
  };
}

function evaluateTrailLinearEnergy(
  progress,
  trailCfg,
  materialIntensity,
  textureLongitudinalKeys = trailCfg.textureLongitudinalKeys,
)
{
  const gradientColor = interpolateTrailColor(progress, trailCfg);
  const textureIntensity = evaluateNumber(
    textureLongitudinalKeys,
    progress,
  );

  const gradientEnergy = colorToLinearEnergy(gradientColor);

  // 原 Shader 先将线性顶点色与已解码的 Stretch 纹理相乘，再施加 _Intensity。
  return gradientEnergy.map((channel) =>
    channel * textureIntensity * materialIntensity);
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
)
{
  const halfWidth = Math.max(0, width) * 0.5;
  const segments = new Array(points.length).fill(null);
  const joins = [];
  const caps = [];

  if (halfWidth <= 0)
  {
    return { segments, joins, caps };
  }

  for (let index = 1; index < points.length; index++)
  {
    const from = points[index - 1];
    const to = points[index];
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const length = Math.hypot(deltaX, deltaY);

    if (length <= 0.000001)
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
      tangent,
      normal,
      fromLeft: { x: from.x + offsetX, y: from.y + offsetY },
      fromRight: { x: from.x - offsetX, y: from.y - offsetY },
      toLeft: { x: to.x + offsetX, y: to.y + offsetY },
      toRight: { x: to.x - offsetX, y: to.y - offsetY },
    };
  }

  const cornerVertexCount = Math.max(
    0,
    Math.floor(numCornerVertices),
  );

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
      // 同向直线天然共享截面；精确折返没有稳定内角，保留两段独立边界。
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

    if (
      !Number.isFinite(innerDistance) ||
      innerDistance > halfWidth * MAX_TRAIL_INNER_MITER_RATIO
    )
    {
      // 接近 180° 的折返会把偏移线交点推到无穷远。保留两段各自的稳定
      // 截面比制造超大尖刺更接近 Unity 的退化网格处理。
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

    // Unity 的 numCornerVertices 表示端点之间的插入点数量，因此 4 个
    // 顶点会生成 5 个互不重叠的外角 fan 三角形。
    joins.push(
      {
        pointIndex,
        previousSegmentIndex: previous.index,
        nextSegmentIndex: next.index,
        inner,
        innerSide: innerSign > 0 ? 'left' : 'right',
        outerArc,
      },
    );
  }

  if (Math.round(numCapVertices) > 0)
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

  return { segments, joins, caps };
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
      ),
    );
  }

  return trailData.meshCache.get(cacheKey);
}

function createTrailGradient(
  context,
  from,
  to,
  transverseProfile,
  colorAtIntensity,
)
{
  const gradient = context.createLinearGradient(
    from.x,
    from.y,
    to.x,
    to.y,
  );
  const profile = resolveTrailTransverseProfile(transverseProfile);

  for (const [position, intensity] of profile)
  {
    gradient.addColorStop(clamp01(position), colorAtIntensity(intensity));
  }

  return gradient;
}

function resolveTrailTransverseProfile(profile)
{
  return Array.isArray(profile) && profile.length >= 2
    ? profile
    : [[0, 1], [1, 1]];
}

function resolveTrailTransverseBandPositions(profile)
{
  const positions = resolveTrailTransverseProfile(profile)
    .map(([position]) => clamp01(position))
    .sort((first, second) => first - second);
  const uniquePositions = [];

  for (const position of positions)
  {
    if (
      uniquePositions.length === 0 ||
      Math.abs(position - uniquePositions.at(-1)) > 0.0000001
    )
    {
      uniquePositions.push(position);
    }
  }

  if (uniquePositions[0] > 0)
  {
    uniquePositions.unshift(0);
  }

  if (uniquePositions.at(-1) < 1)
  {
    uniquePositions.push(1);
  }

  return uniquePositions.length >= 2 ? uniquePositions : [0, 1];
}

function createTrailLongitudinalGradient(
  context,
  segment,
  fromColor,
  toColor,
  fromIntensity,
  toIntensity,
  colorAtIntensity,
)
{
  const gradient = context.createLinearGradient(
    segment.from.x,
    segment.from.y,
    segment.to.x,
    segment.to.y,
  );

  gradient.addColorStop(0, colorAtIntensity(fromColor, fromIntensity));
  gradient.addColorStop(1, colorAtIntensity(toColor, toIntensity));
  return gradient;
}

function fillTrailMeshSegment(
  context,
  segment,
  fromColor,
  toColor,
  fromTransverseProfile,
  toTransverseProfile,
  transverseBandPositions,
  colorAtIntensity,
)
{
  const fromProfile = resolveTrailTransverseProfile(fromTransverseProfile);
  const toProfile = resolveTrailTransverseProfile(toTransverseProfile);

  for (let index = 1; index < transverseBandPositions.length; index++)
  {
    const bandStart = transverseBandPositions[index - 1];
    const bandEnd = transverseBandPositions[index];
    const bandCenter = (bandStart + bandEnd) * 0.5;
    const gradient = createTrailLongitudinalGradient(
      context,
      segment,
      fromColor,
      toColor,
      evaluateNumber(fromProfile, bandCenter),
      evaluateNumber(toProfile, bandCenter),
      colorAtIntensity,
    );
    const fromStart = interpolateTrailMeshEdge(
      segment.fromLeft,
      segment.fromRight,
      bandStart,
    );
    const fromEnd = interpolateTrailMeshEdge(
      segment.fromLeft,
      segment.fromRight,
      bandEnd,
    );
    const toStart = interpolateTrailMeshEdge(
      segment.toLeft,
      segment.toRight,
      bandStart,
    );
    const toEnd = interpolateTrailMeshEdge(
      segment.toLeft,
      segment.toRight,
      bandEnd,
    );

    // CanvasGradient 只能表达一个维度。按原纹理横截面拆成窄带后，每条窄带
    // 可沿弧长连续插值两端能量，同时仍共享 TrailRenderer 的同一外轮廓网格。
    context.beginPath();
    context.moveTo(fromStart.x, fromStart.y);
    context.lineTo(toStart.x, toStart.y);
    context.lineTo(toEnd.x, toEnd.y);
    context.lineTo(fromEnd.x, fromEnd.y);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
  }
}

function fillTrailMeshJoin(
  context,
  join,
  transverseProfile,
  colorAtIntensity,
)
{
  const outerMiddle = join.outerArc[
    Math.floor(join.outerArc.length * 0.5)
  ];
  const left = join.innerSide === 'left' ? join.inner : outerMiddle;
  const right = join.innerSide === 'left' ? outerMiddle : join.inner;
  const gradient = createTrailGradient(
    context,
    left,
    right,
    transverseProfile,
    colorAtIntensity,
  );

  for (let index = 1; index < join.outerArc.length; index++)
  {
    context.beginPath();
    context.moveTo(join.inner.x, join.inner.y);
    context.lineTo(
      join.outerArc[index - 1].x,
      join.outerArc[index - 1].y,
    );
    context.lineTo(join.outerArc[index].x, join.outerArc[index].y);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
  }
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
  const gradient = createTrailGradient(
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
  // numCapVertices=1 形成三角端帽；纹理 U 在端点钳制，不复用段中点颜色。
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
  if (trailData.pointTransverseProfiles?.[pointIndex])
  {
    return trailData.pointTransverseProfiles[pointIndex];
  }

  return evaluateTrailTransverseProfile(
    trailData.measurement.distances[pointIndex] /
      trailData.measurement.totalLength,
    trailCfg,
  );
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
    ((color, intensity) => linearEnergyToAdditiveCss(
      color,
      layer.alpha * opacity * intensity,
    ));
  const firstPointProfile = resolveTrailPointTransverseProfile(
    trailData,
    firstSegment - 1,
    trailCfg,
  );
  const transverseBandPositions = resolveTrailTransverseBandPositions(
    firstPointProfile,
  );

  for (let index = firstSegment; index <= lastSegment; index++)
  {
    const segment = mesh.segments[index];

    if (!segment)
    {
      continue;
    }

    const fromColor = resolveTrailPointEnergy(
      trailData,
      index - 1,
      trailCfg,
      layer.materialIntensity,
    );
    const toColor = resolveTrailPointEnergy(
      trailData,
      index,
      trailCfg,
      layer.materialIntensity,
    );
    const fromTransverseProfile = resolveTrailPointTransverseProfile(
      trailData,
      index - 1,
      trailCfg,
    );
    const toTransverseProfile = resolveTrailPointTransverseProfile(
      trailData,
      index,
      trailCfg,
    );

    fillTrailMeshSegment(
      context,
      segment,
      fromColor,
      toColor,
      fromTransverseProfile,
      toTransverseProfile,
      transverseBandPositions,
      resolveCss,
    );
  }

  for (const join of mesh.joins)
  {
    if (
      join.previousSegmentIndex < firstSegment ||
      join.nextSegmentIndex > lastSegment
    )
    {
      continue;
    }

    const color = resolveTrailPointEnergy(
      trailData,
      join.pointIndex,
      trailCfg,
      layer.materialIntensity,
    );
    const transverseProfile = resolveTrailPointTransverseProfile(
      trailData,
      join.pointIndex,
      trailCfg,
    );

    fillTrailMeshJoin(
      context,
      join,
      transverseProfile,
      (intensity) => resolveCss(color, intensity),
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

    fillTrailMeshCap(
      context,
      cap,
      transverseProfile,
      (intensity) => resolveCss(color, intensity),
    );
  }

  context.restore();
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
)
{
  const measurement = trailData.measurement;

  if (
    measurement.totalLength <= 0 ||
    typeof context.filter !== 'string' ||
    !surface?.context
  )
  {
    return;
  }

  const blurRadius = Math.max(0, trailCfg.outerGlowWidth * scale);
  const halfWidth = Math.max(0.5, trailCfg.geometryWidth * scale * 0.5);
  const margin = Math.ceil(blurRadius * 3 + halfWidth + 2);
  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;

  for (const point of points)
  {
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
      alpha: 1,
      materialIntensity: bloomCfg.trailEmission,
      colorAtIntensity(color, intensity)
      {
        const thresholdedEnergy = thresholdBloomEnergy(
          color,
          opacity * intensity,
          bloomCfg,
        );

        // 阈值判断使用真实 HDR 能量；原生 Alpha 只是后置的视觉标定。
        return linearEnergyToAdditiveCss(
          thresholdedEnergy,
          scaleNativeGlowAlpha(
            bloomCfg.trailAlpha,
            resolveNativeBloomIntensityScale(bloomCfg),
          ),
        );
      },
    },
  );

  context.save();
  context.filter = `blur(${blurRadius}px)`;
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

function drawTrail(
  context,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  useNativeBloom = true,
  nativeBloomSurface = null,
  sharedTrailData = null,
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
  const measurement = trailData.measurement;

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
    );
  }

  // Unity 只绘制一条 2px HDR 几何带；可见宽度由后续 Bloom 自然扩张。
  drawTrailLayer(context, points, trailData, scale, trailOpacity, trailCfg,
    {
      width: trailCfg.width,
      alpha: 1,
      materialIntensity: bloomCfg.trailEmission,
    },
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

  const width = trailCfg.geometryWidth * scale *
    bloomCfg.trailCoverageScale;

  if (width <= 0)
  {
    return;
  }

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

function interpolateTrailMeshEdge(left, right, progress)
{
  return {
    x: lerp(left.x, right.x, progress),
    y: lerp(left.y, right.y, progress),
  };
}

function scaleTrailEnergy(color, intensity)
{
  return color.map((channel) => channel * intensity);
}

function appendTrailMeshSegment(
  renderer,
  segment,
  fromColor,
  toColor,
  opacity,
  fromTransverseProfile,
  toTransverseProfile,
)
{
  const fromProfile = Array.isArray(fromTransverseProfile) &&
      fromTransverseProfile.length >= 2
    ? fromTransverseProfile
    : [[0, 1], [1, 1]];
  const toProfile = Array.isArray(toTransverseProfile) &&
      toTransverseProfile.length >= 2
    ? toTransverseProfile
    : [[0, 1], [1, 1]];
  const profileLength = Math.min(fromProfile.length, toProfile.length);

  for (let index = 1; index < profileLength; index++)
  {
    const previousFromSample = fromProfile[index - 1];
    const previousToSample = toProfile[index - 1];
    const currentFromSample = fromProfile[index];
    const currentToSample = toProfile[index];
    const previousFrom = interpolateTrailMeshEdge(
      segment.fromLeft,
      segment.fromRight,
      previousFromSample[0],
    );
    const previousTo = interpolateTrailMeshEdge(
      segment.toLeft,
      segment.toRight,
      previousToSample[0],
    );
    const currentFrom = interpolateTrailMeshEdge(
      segment.fromLeft,
      segment.fromRight,
      currentFromSample[0],
    );
    const currentTo = interpolateTrailMeshEdge(
      segment.toLeft,
      segment.toRight,
      currentToSample[0],
    );
    const previousFromColor = scaleTrailEnergy(
      fromColor,
      previousFromSample[1],
    );
    const previousToColor = scaleTrailEnergy(
      toColor,
      previousToSample[1],
    );
    const currentFromColor = scaleTrailEnergy(
      fromColor,
      currentFromSample[1],
    );
    const currentToColor = scaleTrailEnergy(
      toColor,
      currentToSample[1],
    );

    renderer.addTrailTriangle(
      previousFrom,
      previousTo,
      currentTo,
      [previousFromColor, previousToColor, currentToColor],
      opacity,
    );
    renderer.addTrailTriangle(
      previousFrom,
      currentTo,
      currentFrom,
      [previousFromColor, currentToColor, currentFromColor],
      opacity,
    );
  }
}

function appendTrailMeshJoin(
  renderer,
  join,
  color,
  opacity,
  transverseProfile,
)
{
  const sourceProfile = Array.isArray(transverseProfile) &&
      transverseProfile.length >= 2
    ? transverseProfile
    : [[0, 1], [1, 1]];
  const profile = join.innerSide === 'left'
    ? sourceProfile
    : sourceProfile.slice().reverse().map(([position, intensity]) =>
      [1 - position, intensity]);

  for (let arcIndex = 1; arcIndex < join.outerArc.length; arcIndex++)
  {
    const previousOuter = join.outerArc[arcIndex - 1];
    const nextOuter = join.outerArc[arcIndex];

    for (let profileIndex = 1; profileIndex < profile.length; profileIndex++)
    {
      const previous = profile[profileIndex - 1];
      const current = profile[profileIndex];
      const previousStart = interpolateTrailMeshEdge(
        join.inner,
        previousOuter,
        previous[0],
      );
      const previousEnd = interpolateTrailMeshEdge(
        join.inner,
        nextOuter,
        previous[0],
      );
      const currentStart = interpolateTrailMeshEdge(
        join.inner,
        previousOuter,
        current[0],
      );
      const currentEnd = interpolateTrailMeshEdge(
        join.inner,
        nextOuter,
        current[0],
      );
      const previousColor = scaleTrailEnergy(color, previous[1]);
      const currentColor = scaleTrailEnergy(color, current[1]);

      renderer.addTrailTriangle(
        previousStart,
        currentStart,
        currentEnd,
        [previousColor, currentColor, currentColor],
        opacity,
      );

      if (
        previousStart.x !== previousEnd.x ||
        previousStart.y !== previousEnd.y
      )
      {
        renderer.addTrailTriangle(
          previousStart,
          currentEnd,
          previousEnd,
          [previousColor, currentColor, previousColor],
          opacity,
        );
      }
    }
  }
}

function appendTrailMeshCaps(
  renderer,
  mesh,
  visibleSegments,
  trailData,
  opacity,
)
{
  for (const cap of mesh.caps)
  {
    if (!visibleSegments.has(cap.segmentIndex))
    {
      continue;
    }

    const color = trailData.pointEnergies[cap.pointIndex];
    const profile = trailData.pointTransverseProfiles[
      cap.pointIndex
    ] ?? [[0, 1], [1, 1]];
    const leftColor = scaleTrailEnergy(color, profile[0][1]);
    const rightColor = scaleTrailEnergy(color, profile.at(-1)[1]);
    const centerIntensity = profile.reduce(
      (maximum, [, intensity]) => Math.max(maximum, intensity),
      0,
    );
    const centerColor = scaleTrailEnergy(color, centerIntensity);
    const colors = cap.position === 'start'
      ? [leftColor, rightColor, centerColor]
      : [leftColor, centerColor, rightColor];

    renderer.addTrailTriangle(
      cap.points[0],
      cap.points[1],
      cap.points[2],
      colors,
      opacity,
    );
  }
}

function appendTrailMeshJoins(
  renderer,
  mesh,
  visibleSegments,
  trailData,
  opacity,
)
{
  for (const join of mesh.joins)
  {
    if (
      !visibleSegments.has(join.previousSegmentIndex) ||
      !visibleSegments.has(join.nextSegmentIndex)
    )
    {
      continue;
    }

    const color = trailData.pointEnergies[join.pointIndex];
    const transverseProfile = trailData.pointTransverseProfiles[
      join.pointIndex
    ];

    appendTrailMeshJoin(
      renderer,
      join,
      color,
      opacity,
      transverseProfile,
    );
  }
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

  const width = trailCfg.geometryWidth * scale *
    bloomCfg.trailCoverageScale;

  if (width <= 0)
  {
    return;
  }
  const emissionQuantizationScale = trailOpacity /
    Math.max(1, bloomCfg.emissionRange) * 255;
  const mesh = getTrailMesh(trailData, points, width, trailCfg);
  const visibleSegments = new Set();

  for (let index = 1; index < points.length; index++)
  {
    // Software 参考实现先经过 8-bit Canvas 发射遮罩；保留相同的半量化裁剪，
    // 避免 WebGL2 在轨迹尾端额外显示参考实现中不存在的微弱光晕。
    if (
      !mesh.segments[index] ||
      trailData.segmentMaximumEnergies[index - 1] *
        emissionQuantizationScale < 0.5
    )
    {
      continue;
    }

    visibleSegments.add(index);
    appendTrailMeshSegment(
      renderer,
      mesh.segments[index],
      trailData.pointEnergies[index - 1],
      trailData.pointEnergies[index],
      trailOpacity,
      trailData.pointTransverseProfiles[index - 1],
      trailData.pointTransverseProfiles[index],
    );
  }

  appendTrailMeshJoins(
    renderer,
    mesh,
    visibleSegments,
    trailData,
    trailOpacity,
  );
  appendTrailMeshCaps(
    renderer,
    mesh,
    visibleSegments,
    trailData,
    trailOpacity,
  );
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

  for (let index = 1; index < points.length; index++)
  {
    if (!mesh.segments[index])
    {
      continue;
    }

    visibleSegments.add(index);
    appendTrailMeshSegment(
      renderer,
      mesh.segments[index],
      trailData.pointEnergies[index - 1],
      trailData.pointEnergies[index],
      trailOpacity,
      trailData.pointTransverseProfiles[index - 1],
      trailData.pointTransverseProfiles[index],
    );
  }

  appendTrailMeshJoins(
    renderer,
    mesh,
    visibleSegments,
    trailData,
    trailOpacity,
  );
  appendTrailMeshCaps(
    renderer,
    mesh,
    visibleSegments,
    trailData,
    trailOpacity,
  );
}

export class BAClickFX
{
  /**
   * @param {object} [options]
   * @param {string|HTMLElement} [options.target]
   * @param {number} [options.scale]
   * @param {number} [options.opacity]
   * @param {boolean} [options.clickEnabled]
   * @param {boolean} [options.trailEnabled]
   * @param {boolean} [options.trailAlways]
   * @param {'dom'|'manual'} [options.inputSource]
   * @param {number} [options.clickTimeScale]
   * @param {number} [options.trailTimeScale]
   * @param {'canvas2d'|'webgl2'|'auto'} [options.effectBackend]
   * @param {'enhanced'|'legacy'} [options.renderingMode]
   * @param {'auto'|'software'|'webgl2'|'native'} [options.bloomBackend]
   * @param {boolean} [options.softwareBloomEnabled]
   * @param {boolean} [options.isolatedCompositing]
   * @param {number} [options.lightBackgroundContrastAlpha]
   * @param {number} [options.maxDpr]
   * @param {string} [options.touchAction]
   * @param {(event: PointerEvent) => boolean} [options.inputFilter]
   */
  constructor(options = {})
  {
    if (typeof document === 'undefined' || typeof window === 'undefined')
    {
      throw new Error('BAClickFX 需要浏览器 DOM 环境');
    }

    const compatibilityBloomBackend =
      typeof options.softwareBloomEnabled === 'boolean'
        ? options.softwareBloomEnabled
          ? 'software'
          : 'native'
        : CONFIG.bloomBackend;
    const bloomBackend = normalizeBloomBackend(
      options.bloomBackend,
      compatibilityBloomBackend,
    );

    this.config = createConfig(
      {
        scale: Number.isFinite(options.scale) ? Math.max(0.01, options.scale) : CONFIG.scale,
        opacity: Number.isFinite(options.opacity) ? clamp01(options.opacity) : CONFIG.opacity,
        clickEnabled: options.clickEnabled ?? CONFIG.clickEnabled,
        trailEnabled: options.trailEnabled ?? CONFIG.trailEnabled,
        trailAlways: options.trailAlways ?? CONFIG.trailAlways,
        inputSource: isInputSource(options.inputSource)
          ? options.inputSource
          : CONFIG.inputSource,
        clickTimeScale: normalizeTimeScale(
          options.clickTimeScale,
          CONFIG.clickTimeScale,
        ),
        trailTimeScale: normalizeTimeScale(
          options.trailTimeScale,
          CONFIG.trailTimeScale,
        ),
        effectBackend: normalizeEffectBackend(
          options.effectBackend,
          CONFIG.effectBackend,
        ),
        renderingMode: options.renderingMode === 'legacy' ? 'legacy' : CONFIG.renderingMode,
        bloomBackend,
        // 保留旧布尔字段作为兼容别名；WebGL2 同样属于增强 Bloom。
        softwareBloomEnabled: bloomBackend !== 'native',
        isolatedCompositing: typeof options.isolatedCompositing === 'boolean'
          ? options.isolatedCompositing
          : CONFIG.isolatedCompositing,
        lightBackgroundContrastAlpha: Number.isFinite(
          options.lightBackgroundContrastAlpha,
        )
          ? clamp01(options.lightBackgroundContrastAlpha)
          : CONFIG.lightBackgroundContrastAlpha,
        maxDpr: Number.isFinite(options.maxDpr) ? Math.max(1, options.maxDpr) : CONFIG.maxDpr,
        touchAction: options.touchAction ?? CONFIG.touchAction,
      },
    );
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

    if (!this.canvas)
    {
      throw new Error('BAClickFX 找不到 target');
    }

    if (this.ownsCanvas)
    {
      const parent = this.host ?? document.body;
      const legacy = this.config.renderingMode === 'legacy';

      this.overlayMountParent = parent;
      this.overlayRoot = createOverlayRoot(!this.host);

      if (legacy)
      {
        // main 分支风格：无 CSS mix-blend-mode，canvas 以默认 source-over 叠在页面上
        setOverlayStyle(this.canvas, false, '2147483647', '');
        setOverlayStyle(
          this.contrastCanvas,
          false,
          '2147483647',
          'darken',
        );
        this.contrastCanvas.style.display = 'none';
      }
      else
      {
        setOverlayStyle(
          this.canvas,
          false,
          '2147483646',
          'plus-lighter',
        );
        setOverlayStyle(
          this.contrastCanvas,
          false,
          '2147483647',
          'darken',
        );
      }

      // Legacy 也预挂载兼容层，运行时切回增强模式时无需重建 DOM。
      this._applyCompositingMount();
    }
    else
    {
      this.overlayMountParent = null;
      this.overlayRoot = null;
      this.overlayParent = null;
    }

    this.canvas.style.touchAction = this.config.touchAction;
    this.context = this.canvas.getContext('2d');
    this.contrastContext = this.contrastCanvas?.getContext('2d') ?? null;

    if (!this.context)
    {
      throw new Error('BAClickFX 无法创建 Canvas 2D 上下文');
    }

    // 内部 Canvas 仅承担发射遮罩和 ImageData 暂存，不会插入 DOM。
    this.bloomRenderer = new SoftwareBloomRenderer(() => createCanvas());
    this.bloomRenderers = [this.bloomRenderer];
    this.resolvedEffectBackend = this._getRequestedEffectBackendState();
    this.resolvedBloomBackend = this._getRequestedBloomBackendState();
    this.softwareBloomFrameStats = {
      regionCount: 0,
      processedSourcePixels: 0,
      combinedBoundsPixels: 0,
    };
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
    this._themeHueShift = 0;
    this.waves = [];
    this.shards = [];
    this.trailStrokes = [];
    this.currentTrailStroke = null;
    this.activePointerId = null;
    this.activePointerSource = null;
    this.lastPointerPosition = null;
    this.lastPointerTime = 0;
    this.trailDistanceSinceShard = 0;
    const initialTimeSource = performance.now();

    this.clickTimeMs = 0;
    this.trailTimeMs = 0;
    this.lastClickTimeSource = initialTimeSource;
    this.lastTrailTimeSource = initialTimeSource;
    this.animationFrame = null;
    this.lastFrameTime = null;
    this.paused = false;
    this.destroyed = false;
    this.domPointerListenersAttached = false;

    this._onResize = this._resize.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onPointerCancel = this._handlePointerCancel.bind(this);
    this._onBlur = this._cancelPointer.bind(this);
    this._onFrame = this._renderFrame.bind(this);
    this._onWebGLContextLost = this._handleWebGLContextLost.bind(this);
    this._onWebGLContextRestored = this._handleWebGLContextRestored.bind(this);

    this._resize();
    window.addEventListener('resize', this._onResize);
    if (this.config.inputSource === 'dom')
    {
      this._attachDomPointerListeners();
    }
    window.addEventListener('blur', this._onBlur);

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

    window.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove,
      {
        passive: true,
      });
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerCancel);
    this.domPointerListenersAttached = true;
  }

  _detachDomPointerListeners()
  {
    if (!this.domPointerListenersAttached)
    {
      return;
    }

    window.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerCancel);
    this.domPointerListenersAttached = false;
  }

  _getOverlayLayers()
  {
    return [this.canvas, this.webglBloomCanvas, this.contrastCanvas]
      .filter(Boolean);
  }

  _applyCompositingMount()
  {
    if (!this.ownsCanvas || !this.overlayMountParent || !this.overlayRoot)
    {
      return;
    }

    const isolated = this.config.isolatedCompositing;
    const parent = isolated ? this.overlayRoot : this.overlayMountParent;

    if (isolated)
    {
      this.overlayMountParent.appendChild(this.overlayRoot);
    }

    for (const canvas of this._getOverlayLayers())
    {
      // 直接合成时恢复旧版 fixed/absolute 定位；隔离组内一律相对根层铺满。
      canvas.style.position = isolated || this.host ? 'absolute' : 'fixed';
      parent.appendChild(canvas);
    }

    if (!isolated)
    {
      this.overlayRoot.remove();
    }

    this.overlayParent = parent;
  }

  _resize()
  {
    if (this.destroyed)
    {
      return;
    }

    const rect = this._getCanvasRect();
    const width = Math.max(1, rect.width || window.innerWidth || 1);
    const height = Math.max(1, rect.height || window.innerHeight || 1);
    const dpr = Math.min(window.devicePixelRatio || 1, this.config.maxDpr);

    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this.contrastCanvas && this.contrastContext)
    {
      this.contrastCanvas.width = this.canvas.width;
      this.contrastCanvas.height = this.canvas.height;
      this.contrastContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // WebGL RenderTarget 可能很大，只在真正进入 WebGL 渲染帧时调整，
    // 避免 Software、Native 或 Legacy 模式因窗口 resize 触发无用 GPU 分配。
    this._requestRender();
  }

  _getCanvasRect()
  {
    if (this.host && !isCanvas(this.host))
    {
      return this.host.getBoundingClientRect();
    }

    if (isCanvas(this.host))
    {
      return this.canvas.getBoundingClientRect();
    }

    return {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
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

  _getDomTrailSampleTime(timeStamp, sourceNow, trailNow)
  {
    if (!Number.isFinite(timeStamp) || timeStamp <= 0)
    {
      return trailNow;
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
      return trailNow;
    }

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

  _acceptPointerDown(event)
  {
    const pointerType = event.pointerType || 'mouse';

    // button: 0=左键, -1=未按键(移动事件)；仅 >0 的非左键实际点击需拦截
    if (pointerType === 'mouse' && event.button > 0)
    {
      return false;
    }

    if (this.inputFilter && !this.inputFilter(event))
    {
      return false;
    }

    return true;
  }

  _handlePointerDown(event)
  {
    if (this.destroyed || this.paused || !this._acceptPointerDown(event))
    {
      return;
    }

    this.pointerDown(this._getDomPointerInput(event));
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
    this.lastPointerPosition = { x: pointer.x, y: pointer.y };
    this.lastPointerTime = this._getTrailInputTime();
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
      !this._acceptPointerDown(event)
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
      const sampleTime = this._getDomTrailSampleTime(
        sample.timeStamp ?? event.timeStamp,
        sourceNow,
        trailNow,
      );

      this._pointerMoveAtTime(
        this._getDomPointerInput(sample, event),
        sampleTime,
      );
    }
  }

  /** 追加一个手动指针采样点；空间采样阈值不受时间倍率影响。 */
  pointerMove(input)
  {
    return this._pointerMoveAtTime(input);
  }

  _pointerMoveAtTime(input, sampleTime = null)
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
    const now = Math.max(this.lastPointerTime, requestedTime);

    // trailAlways 的悬停轨迹没有按下事件；首个移动样本负责创建逻辑指针。
    if (this.activePointerId === null && this.config.trailAlways)
    {
      this.activePointerId = pointer.pointerId;
      this.activePointerSource = 'hover';
      this.lastPointerPosition = position;
      this.lastPointerTime = now;
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

    this._ensureCurrentTrailStroke(now);
    this._appendPointerSample(position, now);

    this._requestRender();
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
      points,
    };
    this.trailStrokes.push(this.currentTrailStroke);
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
    let spawned = 0;

    while (nextDistance <= segmentLength && spawned < 32)
    {
      const progress = segmentLength > 0 ? nextDistance / segmentLength : 0;
      const x = lerp(from.x, to.x, progress);
      const y = lerp(from.y, to.y, progress);
      const angle = random(0, TAU);

      if (this.shards.length < this.fxConfig.shards.maxCount)
      {
        this.shards.push(createShard(
          x,
          y,
          angle,
          'trail',
          scale,
          this.fxConfig.shards,
          lerp(fromTime, toTime, progress),
        ));
      }

      nextDistance += spacing;
      spawned++;
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
    if (this.activePointerId !== null)
    {
      this._releaseActivePointer(true);
    }
  }

  _releaseActivePointer(discardCurrentStroke = false)
  {
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
    this.activePointerId = null;
    this.activePointerSource = null;
    this.lastPointerPosition = null;
    this.lastPointerTime = 0;
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
    this.animationFrame = requestAnimationFrame(this._onFrame);
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
    const legacy = this._isLegacy;
    let effectBackend = legacy
      ? 'canvas2d'
      : this._resolveEffectBackend();
    let bloomBackend = legacy
      ? 'legacy'
      : effectBackend === 'webgl2'
        ? 'webgl2'
        : this._resolveBloomBackend();
    let useSoftwareBloom = bloomBackend === 'software';
    let useWebGL2Bloom = bloomBackend === 'webgl2';
    // Legacy 保留旧版 DOM 合成方式，但视觉对象统一使用资源参数与原生辉光回退。
    let useNativeBloom = bloomBackend === 'native' || legacy;
    let useFullWebGL2 = effectBackend === 'webgl2';

    this.lastFrameTime = now;
    this._setResolvedEffectBackend(effectBackend);
    this._setResolvedBloomBackend(bloomBackend);
    this._setWebGLBloomVisible(useWebGL2Bloom || useFullWebGL2);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.context.clearRect(0, 0, this.width, this.height);
    // 推入当前实例的主题色偏移，渲染完成后清空，保证多实例安全
    const prevHueShift = themeHueShift;
    const previousRenderDpr = renderDpr;
    themeHueShift = this._themeHueShift;
    renderDpr = this.dpr;
    this.context.save();
    this.context.globalCompositeOperation = 'lighter';

    try
    {
      this._updateTrail(
        this.trailTimeMs,
        scale,
        useNativeBloom,
        false,
      );
      this._updateWaves(
        this.clickTimeMs,
        scale,
        useNativeBloom,
        false,
      );
      this._updateShards(
        this.clickTimeMs,
        this.trailTimeMs,
        scale,
        useNativeBloom,
        false,
      );

      if (useFullWebGL2)
      {
        let rendered = true;

        if (this._hasVisibleEffects())
        {
          rendered = this._renderWebGL2Effects(scale);
        }
        else
        {
          this.webglBloomRenderer?.clear();
        }

        if (!rendered)
        {
          effectBackend = 'canvas2d';
          useFullWebGL2 = false;
          this._setResolvedEffectBackend(effectBackend);
          this._setWebGLBloomVisible(false);
          bloomBackend = this._resolveBloomBackend();
          useSoftwareBloom = bloomBackend === 'software';
          useWebGL2Bloom = bloomBackend === 'webgl2';
          useNativeBloom = bloomBackend === 'native';
          this._setResolvedBloomBackend(bloomBackend);
          this._setWebGLBloomVisible(useWebGL2Bloom);
          this._renderCanvasEffects(scale, useNativeBloom);
        }
      }
      else
      {
        // Canvas 路径统一在更新完成后按 Unity RenderQueue 顺序绘制。
        this._renderCanvasEffects(scale, useNativeBloom);
      }

      if (!legacy && !useFullWebGL2)
      {
        this._renderLightBackgroundContrast(
          scale,
          useSoftwareBloom || useWebGL2Bloom,
        );
      }
      else if (useFullWebGL2 && this.contrastContext)
      {
        // 完整模式不再通过 Canvas2D 重绘辅助遮罩；切换时必须清掉旧帧。
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

      if (!useFullWebGL2 && useSoftwareBloom && this._hasVisibleEffects())
      {
        this._renderSoftwareBloom(scale);
      }
      else if (
        !useFullWebGL2 &&
        useWebGL2Bloom &&
        this._hasVisibleEffects()
      )
      {
        this._renderWebGL2Bloom(scale);
      }
      else if (!useFullWebGL2 && useWebGL2Bloom)
      {
        this.webglBloomRenderer?.clear();
      }
    }
    catch (error)
    {
      console.error('[BAClickFX] render error:', error);
    }
    finally
    {
      this.context.restore();
      themeHueShift = prevHueShift;
      renderDpr = previousRenderDpr;
    }

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
    if (
      this.config.renderingMode === 'legacy' ||
      normalizeEffectBackend(this.config.effectBackend) === 'canvas2d'
    )
    {
      return 'canvas2d';
    }

    if (
      this.webglBloomRenderer?.sceneEnabled &&
      this.webglBloomRenderer.available &&
      this.webglBloomRenderer.sourceTarget
    )
    {
      return 'webgl2';
    }

    if (
      this.webglBloomUnavailable ||
      !this.ownsCanvas ||
      !this.overlayParent
    )
    {
      return 'canvas2d';
    }

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

  _resolveEffectBackend()
  {
    if (
      this.config.renderingMode === 'legacy' ||
      normalizeEffectBackend(this.config.effectBackend) === 'canvas2d'
    )
    {
      return 'canvas2d';
    }

    if (!this._ensureWebGLBloomRenderer(true))
    {
      return 'canvas2d';
    }

    return this._resizeWebGLBloomRenderer()
      ? 'webgl2'
      : 'canvas2d';
  }

  _getRequestedBloomBackendState()
  {
    if (this.config.renderingMode === 'legacy')
    {
      return 'legacy';
    }

    if (normalizeEffectBackend(this.config.effectBackend) !== 'canvas2d')
    {
      if (this.resolvedEffectBackend === 'webgl2')
      {
        return 'webgl2';
      }

      if (this.resolvedEffectBackend === 'pending')
      {
        return 'pending';
      }
    }

    const requested = normalizeBloomBackend(this.config.bloomBackend);
    const fallback = this.bloomRenderer?.available ? 'software' : 'native';

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
      return (
        this.webglBloomRenderer.available &&
        this.webglBloomRenderer.sourceTarget
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

  _handleWebGLContextLost()
  {
    if (this.destroyed || this.config.renderingMode === 'legacy')
    {
      return;
    }

    const requested = normalizeBloomBackend(this.config.bloomBackend);
    const requestedEffect = normalizeEffectBackend(this.config.effectBackend);
    const usesFullWebGL2 = requestedEffect === 'webgl2' ||
      requestedEffect === 'auto';
    const usesWebGL2Bloom = requested === 'webgl2' || requested === 'auto';

    if (!usesFullWebGL2 && !usesWebGL2Bloom)
    {
      return;
    }

    this._setWebGLBloomVisible(false);

    if (usesFullWebGL2)
    {
      this._setResolvedEffectBackend('canvas2d');
    }

    this._setResolvedBloomBackend(
      requested === 'native'
        ? 'native'
        : this.bloomRenderer.available
          ? 'software'
          : 'native',
    );
    this._requestRender();
  }

  _handleWebGLContextRestored()
  {
    if (this.destroyed || this.config.renderingMode === 'legacy')
    {
      return;
    }

    const requested = normalizeBloomBackend(this.config.bloomBackend);
    const requestedEffect = normalizeEffectBackend(this.config.effectBackend);
    const usesFullWebGL2 = requestedEffect === 'webgl2' ||
      requestedEffect === 'auto';
    const usesWebGL2Bloom = requested === 'webgl2' || requested === 'auto';

    if (!usesFullWebGL2 && !usesWebGL2Bloom)
    {
      return;
    }

    // Renderer 会先在自己的 restored 监听器中重建资源；下一帧再验证完整链路。
    if (usesFullWebGL2)
    {
      this._setResolvedEffectBackend('pending');
    }

    if (usesFullWebGL2 || usesWebGL2Bloom)
    {
      this._setResolvedBloomBackend('pending');
    }

    this._requestRender();
  }

  _ensureWebGLBloomRenderer(requireScene = false)
  {
    if (this.webglBloomRenderer)
    {
      if (!requireScene || this.webglBloomRenderer.sceneEnabled)
      {
        return this.webglBloomRenderer.available;
      }

      // WebGL Context 的抗锯齿属性创建后不可修改；首次进入完整模式时升级。
      this.webglBloomCanvas?.removeEventListener(
        'webglcontextlost',
        this._onWebGLContextLost,
      );
      this.webglBloomCanvas?.removeEventListener(
        'webglcontextrestored',
        this._onWebGLContextRestored,
      );
      this.webglBloomRenderer.destroy();
      this.webglBloomCanvas?.remove();
      this.webglBloomRenderer = null;
      this.webglBloomCanvas = null;
      this.webglBloomVisible = false;
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

    setOverlayStyle(
      canvas,
      !this.host && !this.config.isolatedCompositing,
      '2147483646',
      'plus-lighter',
    );
    canvas.style.display = 'none';
    this.overlayParent.appendChild(canvas);

    let renderer = null;

    try
    {
      renderer = new WebGL2BloomRenderer(
        canvas,
        { sceneEnabled: requireScene },
      );

      if (!renderer.available)
      {
        this.webglBloomUnavailable = true;
        renderer.destroy();
        canvas.remove();
        return false;
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

    return this.bloomRenderer.available ? 'software' : 'native';
  }

  _setWebGLBloomVisible(visible)
  {
    if (!this.webglBloomCanvas)
    {
      this.webglBloomVisible = false;
      return;
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

  get _isLegacy()
  {
    return this.config.renderingMode === 'legacy';
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

    if (this.config.lightBackgroundContrastAlpha <= 0)
    {
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
      this._renderCanvasEffects(scale, false, context);
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
      const trailOpacity = this.config.opacity *
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

  _getSoftwareBloomBounds(scale)
  {
    return combineBloomRegionBounds(this._getSoftwareBloomRegions(scale));
  }

  _renderSoftwareBloom(scale)
  {
    const bloomCfg = this.fxConfig.bloom;
    const diffusion = bloomCfg.diffusion;
    const regions = this._getSoftwareBloomRegions(scale);
    const combinedBounds = combineBloomRegionBounds(regions);
    const settings = {
      encodingRange: bloomCfg.emissionRange,
      threshold: bloomCfg.threshold,
      softKnee: bloomCfg.softKnee,
      clamp: bloomCfg.clamp,
      intensity: bloomCfg.intensity,
      diffusion,
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

      processedSourcePixels += renderer.sourceWidth * renderer.sourceHeight;
      bloomContext.save();

      for (const wave of region.waves)
      {
        wave.drawBloomDiskLayer(
          bloomContext,
          scale,
          this.config.opacity,
        );
      }

      for (const batch of region.trailBatches)
      {
        const stroke = batch.stroke;

        if (stroke.points.length >= 2)
        {
          drawTrailEmission(
            bloomContext,
            stroke.points,
            scale,
            this.config.opacity,
            this.fxConfig,
            stroke.trailFrameData,
            batch.firstSegment,
            batch.lastSegment,
          );
        }
      }

      for (const shard of region.shards)
      {
        shard.drawBloom(
          bloomContext,
          scale,
          this.config.opacity,
          this.fxConfig,
        );
      }

      for (const wave of region.waves)
      {
        wave.drawBloomAdditiveLayer(
          bloomContext,
          scale,
          this.config.opacity,
        );
      }

      bloomContext.restore();

      if (!renderer.composite(this.context, settings))
      {
        this.bloomRenderer.available = false;
        failed = true;
      }
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
      this._setResolvedBloomBackend('native');
    }
  }

  _renderWebGL2Effects(scale)
  {
    const renderer = this.webglBloomRenderer;
    const bloomCfg = this.fxConfig.bloom;
    const diffusion = bloomCfg.diffusion;

    if (
      !renderer?.sceneEnabled ||
      !renderer.resize(
        this.width,
        this.height,
        this.dpr,
        bloomCfg.resolutionScale,
        diffusion,
      )
    )
    {
      return false;
    }

    renderer.beginFrame();

    for (const wave of this.waves)
    {
      wave.appendWebGLSceneDiskLayer(
        renderer,
        scale,
        this.config.opacity,
      );
    }

    for (const stroke of this.trailStrokes)
    {
      if (stroke.points.length >= 2)
      {
        appendTrailWebGLScene(
          renderer,
          stroke.points,
          scale,
          this.config.opacity,
          this.fxConfig,
          stroke.trailFrameData,
        );
      }
    }

    for (const shard of this.shards)
    {
      shard.appendWebGLScene(
        renderer,
        scale,
        this.config.opacity,
        this.fxConfig,
      );
    }

    // Dissolve MeshTri 的 RenderQueue=4499；最后提交，避免普通粒子覆盖圆环。
    for (const wave of this.waves)
    {
      wave.appendWebGLSceneAdditiveLayer(
        renderer,
        scale,
        this.config.opacity,
      );
    }

    if (!renderer.renderScene())
    {
      return false;
    }

    const sceneVertexCount = renderer.stats.sceneVertexCount;

    // Scene 与 Bloom 是同一视觉帧的两个 pass，第二次清空几何时保留
    // 已提交的 Scene 统计，便于宿主准确诊断完整 WebGL2 路径。
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
        diffusion,
      },
      { preserveCanvas: true },
    );

    this.webglBloomFrameStats =
    {
      available: renderer.available,
      ...renderer.stats,
      sceneVertexCount,
    };

    return rendered;
  }

  _renderWebGL2Bloom(scale)
  {
    const renderer = this.webglBloomRenderer;
    const bloomCfg = this.fxConfig.bloom;
    const diffusion = bloomCfg.diffusion;

    if (
      !renderer ||
      !renderer.resize(
        this.width,
        this.height,
        this.dpr,
        bloomCfg.resolutionScale,
        diffusion,
      )
    )
    {
      this._fallbackFromWebGL2(scale);
      return;
    }

    renderer.beginFrame();

    for (const stroke of this.trailStrokes)
    {
      if (stroke.points.length < 2)
      {
        continue;
      }

      appendTrailWebGLBloom(
        renderer,
        stroke.points,
        scale,
        this.config.opacity,
        this.fxConfig,
        stroke.trailFrameData,
      );
    }

    for (const wave of this.waves)
    {
      wave.appendWebGLBloom(renderer, scale, this.config.opacity);
    }

    for (const shard of this.shards)
    {
      shard.appendWebGLBloom(
        renderer,
        scale,
        this.config.opacity,
        this.fxConfig,
      );
    }

    const rendered = renderer.render(
      {
        threshold: bloomCfg.threshold,
        softKnee: bloomCfg.softKnee,
        clamp: bloomCfg.clamp,
        intensity: bloomCfg.intensity,
        diffusion,
      },
    );

    this.webglBloomFrameStats =
    {
      available: renderer.available,
      ...renderer.stats,
    };

    if (!rendered)
    {
      this._fallbackFromWebGL2(scale);
    }
  }

  _fallbackFromWebGL2(scale)
  {
    this._setWebGLBloomVisible(false);

    if (this.bloomRenderer.available)
    {
      this._setResolvedBloomBackend('software');
      this._renderSoftwareBloom(scale);
      return;
    }

    // 原生阴影必须在清晰几何绘制阶段启用；当前帧无法补画，下一帧切换。
    this._setResolvedBloomBackend('native');
  }

  _updateTrail(trailTimeMs, scale, useNativeBloom, drawCanvas = true)
  {
    const lifetime = this.fxConfig.trail.lifetimeMs;
    const nativeBloomSurface = drawCanvas && useNativeBloom
      ? this._getNativeTrailBloomSurface()
      : null;

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
        stroke.trailFrameData = createTrailFrameData(
          stroke.points,
          this.fxConfig.trail,
          this.fxConfig.bloom.trailEmission,
        );

        if (drawCanvas)
        {
          drawTrail(
            this.context,
            stroke.points,
            scale,
            this.config.opacity,
            this.fxConfig,
            useNativeBloom,
            nativeBloomSurface,
            stroke.trailFrameData,
          );
        }
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
  }

  _updateWaves(clickTimeMs, scale, useNativeBloom, drawCanvas = true)
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
        wave.draw(
          this.context,
          scale,
          this.config.opacity,
          useNativeBloom,
        );
      }
    }
  }

  _updateShards(
    clickTimeMs,
    trailTimeMs,
    scale,
    useNativeBloom,
    drawCanvas = true,
  )
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
        this.shards.splice(index, 1);
        continue;
      }

      if (drawCanvas)
      {
        shard.draw(
          this.context,
          scale,
          this.config.opacity,
          this.fxConfig,
          useNativeBloom,
        );
      }
    }
  }

  _renderCanvasEffects(
    scale,
    useNativeBloom,
    context = this.context,
  )
  {
    const nativeBloomSurface = useNativeBloom && context === this.context
      ? this._getNativeTrailBloomSurface()
      : null;

    // Cross2 是普通透明队列中的 AlphaBlendAdd；先绘制它，后续加色粒子
    // 才不会被 OneMinusSrcAlpha 错误衰减。
    for (const wave of this.waves)
    {
      wave.drawDiskLayer(
        context,
        scale,
        this.config.opacity,
        useNativeBloom,
      );
    }

    for (const stroke of this.trailStrokes)
    {
      if (stroke.points.length < 2)
      {
        continue;
      }

      drawTrail(
        context,
        stroke.points,
        scale,
        this.config.opacity,
        this.fxConfig,
        useNativeBloom,
        nativeBloomSurface,
        stroke.trailFrameData,
      );
    }

    for (const shard of this.shards)
    {
      shard.draw(
        context,
        scale,
        this.config.opacity,
        this.fxConfig,
        useNativeBloom,
      );
    }

    // Dissolve MeshTri 的材质 RenderQueue=4499，始终在普通透明粒子后绘制。
    for (const wave of this.waves)
    {
      wave.drawAdditiveLayer(
        context,
        scale,
        this.config.opacity,
        useNativeBloom,
      );
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
        if (this.activePointerId !== null)
        {
          this._releaseActivePointer(false);
        }

        if (this.animationFrame !== null)
        {
          cancelAnimationFrame(this.animationFrame);
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
  }

  /**
   * 设置主题色；所有蓝色系特效的 hue 将以此为基准偏移。
   * 传入空字符串或无效值可恢复默认蓝色。
   * @param {string} hex — CSS 十六进制颜色，如 "#ff6969"
   */
  setThemeColor(hex)
  {
    this._themeHueShift = computeThemeHueShift(hex);
    this._requestRender();
  }

  /**
   * 运行时更新部分配置，无需销毁重建实例。
   * target 与 inputFilter 只在构造时生效，其余公开配置均可按需覆盖。
   * @param {object} overrides
   */
  updateConfig(overrides = {})
  {
    if (this.destroyed)
    {
      return;
    }

    const previousEffectBackend = this.config.effectBackend;
    const previousRenderingMode = this.config.renderingMode;
    const previousBloomBackend = this.config.bloomBackend;

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

    if (Number.isFinite(overrides.clickTimeScale) && overrides.clickTimeScale > 0)
    {
      // 倍率只作用于配置变更后的时间，不能追溯重算上一帧后的区间。
      this._advanceClickTime();
      this.config.clickTimeScale = overrides.clickTimeScale;
    }

    if (Number.isFinite(overrides.trailTimeScale) && overrides.trailTimeScale > 0)
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

    if (isEffectBackend(overrides.effectBackend))
    {
      this.config.effectBackend = overrides.effectBackend;
    }

    if (overrides.renderingMode === 'enhanced' || overrides.renderingMode === 'legacy')
    {
      const wasLegacy = this.config.renderingMode === 'legacy';
      const nowLegacy = overrides.renderingMode === 'legacy';

      this.config.renderingMode = overrides.renderingMode;

      if (wasLegacy !== nowLegacy)
      {
        if (nowLegacy)
        {
          if (this.ownsCanvas)
          {
            // DOM 图层样式只属于库创建的覆盖层，外部 Canvas 仍需切换参数集。
            this.canvas.style.mixBlendMode = '';
            this.canvas.style.zIndex = '2147483647';
            this._setWebGLBloomVisible(false);

            if (this.contrastCanvas)
            {
              this.contrastCanvas.style.display = 'none';
            }
          }

        }
        else
        {
          if (this.ownsCanvas)
          {
            this.canvas.style.mixBlendMode = 'plus-lighter';
            this.canvas.style.zIndex = '2147483646';

            if (this.contrastCanvas)
            {
              this.contrastCanvas.style.display = '';
            }
          }
        }
      }
    }

    if (isBloomBackend(overrides.bloomBackend))
    {
      this.config.bloomBackend = overrides.bloomBackend;
      this.config.softwareBloomEnabled = overrides.bloomBackend !== 'native';
    }
    else if (typeof overrides.softwareBloomEnabled === 'boolean')
    {
      this.config.softwareBloomEnabled = overrides.softwareBloomEnabled;
      this.config.bloomBackend = overrides.softwareBloomEnabled
        ? 'software'
        : 'native';
    }

    if (
      previousEffectBackend !== this.config.effectBackend ||
      previousRenderingMode !== this.config.renderingMode ||
      previousBloomBackend !== this.config.bloomBackend
    )
    {
      this._setResolvedEffectBackend(
        this._getRequestedEffectBackendState(),
      );
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
        this._applyCompositingMount();
      }
    }

    if (Number.isFinite(overrides.maxDpr))
    {
      this.config.maxDpr = Math.max(1, overrides.maxDpr);
      this._resize();
    }

    if (overrides.touchAction !== undefined)
    {
      this.config.touchAction = overrides.touchAction;
      this.canvas.style.touchAction = overrides.touchAction;
    }

    this._requestRender();
  }

  /**
   * 设置特效参数。path 支持点号路径，如 'rings.hdrIntensity'。
   * @param {string} path — 参数路径
   * @param {number|boolean} value — 新值
   */
  setFxParam(path, value)
  {
    if (this.destroyed)
    {
      return;
    }

    const keys = path.split('.');
    let target = this.fxConfig;

    for (let i = 0; i < keys.length - 1; i++)
    {
      if (!target[keys[i]])
      {
        return;
      }

      target = target[keys[i]];
    }

    const lastKey = keys[keys.length - 1];

    if (typeof target[lastKey] === 'boolean')
    {
      target[lastKey] = !!value;
      this._requestRender();
    }
    else if (typeof target[lastKey] === 'number')
    {
      if (!Number.isFinite(value))
      {
        return;
      }

      const isDirection = path === 'rings.rotationDirection' ||
        path === 'rings.dissolveDirection';

      if (isDirection)
      {
        target[lastKey] = clamp(value, -1, 1);
      }
      else
      {
        const requiresPositiveValue = /(Ms|Spacing|Radius|Width)$/.test(
          lastKey,
        );
        const min = requiresPositiveValue ? 1 : 0;

        // Count/maxCount=0 用于禁用发射，Blur=0 用于关闭原生模糊。
        target[lastKey] = Math.max(min, value);
      }

      this._requestRender();
    }
  }

  /** @returns {object} 当前完整特效配置的深拷贝 */
  getFxConfig()
  {
    return structuredClone(this.fxConfig);
  }

  /** 重置所有特效参数为游戏默认值 */
  resetFxConfig()
  {
    this.fxConfig = structuredClone(UNITY_FX_TOUCH);
    this._requestRender();
  }

  /** 清除拖尾顶点和拖拽产生的碎片，不影响仍在播放的点击。 */
  clearTrail()
  {
    this.trailStrokes.length = 0;
    this.currentTrailStroke = null;
    this.shards = this.shards.filter((shard) => shard.kind !== 'trail');
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
    this._trimBloomRendererPool(0, 0);
    this.context.clearRect(0, 0, this.width, this.height);
    this.contrastContext?.clearRect(0, 0, this.width, this.height);
    this.webglBloomRenderer?.clear();
  }

  getConfig()
  {
    return {
      ...this.config,
      resolvedEffectBackend: this.resolvedEffectBackend,
      resolvedBloomBackend: this.resolvedBloomBackend,
      unity: structuredClone(UNITY_FX_TOUCH),
    };
  }

  destroy()
  {
    if (this.destroyed)
    {
      return;
    }

    this.destroyed = true;
    window.removeEventListener('resize', this._onResize);
    this._detachDomPointerListeners();
    window.removeEventListener('blur', this._onBlur);
    this.resizeObserver?.disconnect();

    if (this.animationFrame !== null)
    {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.clear();
    for (const renderer of this.bloomRenderers)
    {
      renderer.destroy();
    }

    this.webglBloomCanvas?.removeEventListener(
      'webglcontextlost',
      this._onWebGLContextLost,
    );
    this.webglBloomCanvas?.removeEventListener(
      'webglcontextrestored',
      this._onWebGLContextRestored,
    );
    this.webglBloomRenderer?.destroy();
    this.webglBloomRenderer = null;

    if (this.nativeTrailBloomSurface)
    {
      this.nativeTrailBloomSurface.canvas.width = 0;
      this.nativeTrailBloomSurface.canvas.height = 0;
      this.nativeTrailBloomSurface = null;
    }

    if (this.ownsCanvas)
    {
      this.webglBloomCanvas?.remove();
      this.contrastCanvas?.remove();
      this.canvas.remove();
      this.overlayRoot?.remove();
    }

    this.webglBloomCanvas = null;
    this.webglBloomVisible = false;
    this.overlayParent = null;
    this.overlayMountParent = null;
    this.overlayRoot = null;
  }
}

export {
  BLOOM_BACKEND_CHANGE_EVENT,
  CONFIG,
  EFFECT_BACKEND_CHANGE_EVENT,
  UNITY_FX_TOUCH,
  createConfig,
  SIZE_CORRECTION,
};

export default BAClickFX;
