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
  normalizeBloomBackend,
  SIZE_CORRECTION,
} from './config.js';
import { SoftwareBloomRenderer } from './software-bloom.js';
import { WebGL2BloomRenderer } from './webgl2-bloom.js';

const TAU = Math.PI * 2;
const LIGHT_BACKGROUND_CONTRAST_COLOR = [76, 255, 255];
const BLOOM_BACKEND_CHANGE_EVENT = 'baclickfxbackendchange';

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

function evaluateSrgbGradientEnergy(keys, progress, intensity)
{
  const linearKeys = keys.map(([time, color]) =>
  [
    time,
    applyThemeHue(color).map(srgbToLinearChannel),
  ]);
  const safeIntensity = Math.max(0, intensity);

  // ParticleSystem 在 Linear 项目中先转换各 Gradient key，再在 active space 插值。
  return evaluateColor(linearKeys, progress).map((channel) =>
    channel * safeIntensity);
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

function linearEnergyToEmissionCss(color, opacity, emissionRange)
{
  const scale = clamp01(opacity) / Math.max(1, emissionRange);
  const red = Math.round(clamp(color[0] * scale * 255, 0, 255));
  const green = Math.round(clamp(color[1] * scale * 255, 0, 255));
  const blue = Math.round(clamp(color[2] * scale * 255, 0, 255));

  return `rgb(${red}, ${green}, ${blue})`;
}

/**
 * 将已知的材质发射强度压入 8 位遮罩；软件 Bloom 回读后会乘回 emissionRange。
 * Alpha 被预先烘入 RGB，Canvas 自身的 Alpha 只负责路径边缘的抗锯齿覆盖率。
 */
function colorToEmissionCss(color, alpha, emission, emissionRange)
{
  return linearEnergyToEmissionCss(
    colorToLinearEnergy(color, emission),
    alpha,
    emissionRange,
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

/**
 * Legacy 圆环沿用 v1.2.5 的双端收尖算法；增强模式改用纹理采样后仍需保留此函数。
 */
function smoothstep(edge0, edge1, value)
{
  if (edge0 === edge1)
  {
    return value < edge0 ? 0 : 1;
  }

  const progress = clamp01((value - edge0) / (edge1 - edge0));

  return progress * progress * (3 - 2 * progress);
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

// main 分支的圆环参数（2 元素 keyframe、像素宽度、hdrIntensity=1.0）
const LEGACY_RING_SIZE_KEYS = [[0.007209778, 0.420509], [0.2139282, 0.7159773], [1, 1]];
const LEGACY_RING_DISSOLVE_KEYS = [[0, 1], [0.2, 0], [1, 1]];
const LEGACY_RING_WIDTH_START = 5.2;
const LEGACY_RING_WIDTH_END = 2.4;
const LEGACY_RING_HDR = 1.0;
const LEGACY_RING_EDGE_RATIO = 0.1;

/**
 * main 分支风格的圆环绘制：简单弧带 + 双向 taper + 径向 ridge 叠加。
 * 不使用 2D 纹理采样和 conic gradient。
 */
function drawLegacyDissolvedCircle(
  context,
  ring,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
)
{
  const ringCfg = fxConfig.rings;
  const bloomCfg = fxConfig.bloom;
  const radius = ring.radius * evaluateNumber(LEGACY_RING_SIZE_KEYS, progress) * scale;
  const yProgress = clamp01(progress / 0.07908168);
  const yCurve = evaluateUnitySmoothCurve([[0, 0], [1, 0.9972414]], yProgress);
  const width = lerp(LEGACY_RING_WIDTH_START, LEGACY_RING_WIDTH_END, progress) * yCurve * scale;
  const threshold = evaluateNumber(LEGACY_RING_DISSOLVE_KEYS, progress);
  const visibleRatio = 1 - threshold;
  const particleColor = evaluateColor(ringCfg.colorKeys, progress);
  const hdrColor = particleColor.map((ch) => ch * LEGACY_RING_HDR);
  const arcLength = TAU * visibleRatio;
  const sweep = ringCfg.dissolveDirection * arcLength;

  if (arcLength <= 0.001)
  {
    return;
  }

  const steps = Math.max(6, Math.ceil(ringCfg.arcSamples * visibleRatio));
  const shouldTaper = visibleRatio < 0.995;

  context.save();
  context.translate(ring.x, ring.y);
  context.rotate(ring.rotation);
  context.beginPath();

  for (let index = 0; index <= steps; index++)
  {
    const localProgress = index / steps;
    const angle = sweep * localProgress;
    const taper = shouldTaper
      ? smoothstep(0, LEGACY_RING_EDGE_RATIO, localProgress) *
        smoothstep(0, LEGACY_RING_EDGE_RATIO, 1 - localProgress)
      : 1;
    const outerRadius = radius + width * 0.5 * taper;
    const x = Math.cos(angle) * outerRadius;
    const y = Math.sin(angle) * outerRadius;

    if (index === 0) { context.moveTo(x, y); }
    else { context.lineTo(x, y); }
  }

  for (let index = steps; index >= 0; index--)
  {
    const localProgress = index / steps;
    const angle = sweep * localProgress;
    const taper = shouldTaper
      ? smoothstep(0, LEGACY_RING_EDGE_RATIO, localProgress) *
        smoothstep(0, LEGACY_RING_EDGE_RATIO, 1 - localProgress)
      : 1;
    const innerRadius = Math.max(0, radius - width * 0.5 * taper);

    context.lineTo(Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius);
  }

  context.closePath();
  context.fillStyle = colorToCss(hdrColor, opacity);
  context.shadowColor = colorToCss(particleColor, opacity * bloomCfg.ringAlpha);
  context.shadowBlur = bloomCfg.ringBlur * scale;
  context.fill();

  // 径向 ridge 叠加：环带中央比两侧亮约 12%
  {
    const ridgeRatio = 0.6;
    const ridgeAlphaBoost = 1.12;

    context.beginPath();

    for (let index = 0; index <= steps; index++)
    {
      const localProgress = index / steps;
      const angle = sweep * localProgress;
      const ridgeTaper = shouldTaper
        ? smoothstep(0, LEGACY_RING_EDGE_RATIO, localProgress) *
          smoothstep(0, LEGACY_RING_EDGE_RATIO, 1 - localProgress)
        : 1;
      const outerRidge = radius + width * 0.5 * ridgeRatio * ridgeTaper;
      const x = Math.cos(angle) * outerRidge;
      const y = Math.sin(angle) * outerRidge;

      if (index === 0) { context.moveTo(x, y); }
      else { context.lineTo(x, y); }
    }

    for (let index = steps; index >= 0; index--)
    {
      const localProgress = index / steps;
      const angle = sweep * localProgress;
      const ridgeTaper = shouldTaper
        ? smoothstep(0, LEGACY_RING_EDGE_RATIO, localProgress) *
          smoothstep(0, LEGACY_RING_EDGE_RATIO, 1 - localProgress)
        : 1;
      const innerRidge = Math.max(0, radius - width * 0.5 * ridgeRatio * ridgeTaper);

      context.lineTo(Math.cos(angle) * innerRidge, Math.sin(angle) * innerRidge);
    }

    context.closePath();
    context.fillStyle = colorToCss(hdrColor, opacity * ridgeAlphaBoost);
    context.shadowBlur = 0;
    context.fill();
  }

  context.restore();
}

function drawDissolvedCircle(
  context,
  ring,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  useNativeBloom = true,
  legacy = false,
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
  const materialEnergy = legacy
    ? null
    : sharedMaterialEnergy ?? evaluateSrgbGradientEnergy(
      ringCfg.colorKeys,
      progress,
      ringCfg.hdrIntensity,
    );
  const colorForLuminance = legacy
    ? (luminance) => colorToCss(particleColor, opacity * luminance)
    : (luminance) => linearEnergyToAdditiveCss(
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
          blur: bloomCfg.ringBlur * scale,
          color: colorToCss(
            particleColor,
            opacity * bloomCfg.ringAlpha,
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
  legacy = false,
)
{
  const diskCfg = fxConfig.disk;
  const bloomCfg = fxConfig.bloom;
  const radius = diskCfg.radius * evaluateNumber(diskCfg.sizeKeys, progress) * scale;
  const color = evaluateColor(diskCfg.colorKeys, progress);
  const alpha = evaluateNumber(diskCfg.alphaKeys, progress) * opacity;
  const gradient = context.createRadialGradient(
    wave.x,
    wave.y,
    0,
    wave.x,
    wave.y,
    Math.max(radius, 0.01),
  );

  if (legacy)
  {
    // main 分支风格：sRGB 颜色 + 标准 alpha
    gradient.addColorStop(0, colorToCss(color, alpha));
    gradient.addColorStop(0.88, colorToCss(color, alpha));
    gradient.addColorStop(0.97, colorToCss(color, alpha * 0.55));
    gradient.addColorStop(1, colorToCss(color, 0));
  }
  else
  {
    const materialEnergy = colorToLinearEnergy(color, bloomCfg.diskEmission);

    gradient.addColorStop(0, linearEnergyToAdditiveCss(materialEnergy, alpha));
    gradient.addColorStop(0.88, linearEnergyToAdditiveCss(materialEnergy, alpha));
    gradient.addColorStop(
      0.97,
      linearEnergyToAdditiveCss(materialEnergy, alpha * 0.55),
    );
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  }

  context.save();
  context.beginPath();
  context.arc(wave.x, wave.y, radius, 0, TAU);
  context.fillStyle = gradient;
  context.shadowColor = colorToCss(color, alpha * (legacy ? 0.5 : bloomCfg.diskAlpha));
  context.shadowBlur = useNativeBloom ? bloomCfg.diskBlur * scale : 0;
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
  const radius = diskCfg.radius * evaluateNumber(diskCfg.sizeKeys, progress) * scale;
  const color = evaluateColor(diskCfg.colorKeys, progress);
  const alpha = evaluateNumber(diskCfg.alphaKeys, progress) * opacity *
    bloomCfg.diskEmissionAlpha;
  const gradient = context.createRadialGradient(
    wave.x,
    wave.y,
    0,
    wave.x,
    wave.y,
    Math.max(radius, 0.01),
  );

  gradient.addColorStop(
    0,
    colorToEmissionCss(
      color,
      alpha,
      bloomCfg.diskEmission,
      bloomCfg.emissionRange,
    ),
  );
  gradient.addColorStop(
    0.88,
    colorToEmissionCss(
      color,
      alpha,
      bloomCfg.diskEmission,
      bloomCfg.emissionRange,
    ),
  );
  gradient.addColorStop(1, 'rgb(0, 0, 0)');

  context.save();
  context.beginPath();
  context.arc(wave.x, wave.y, radius, 0, TAU);
  context.fillStyle = gradient;
  context.fill();
  context.restore();
}

function drawTriangle(
  context,
  particle,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
)
{
  const shardCfg = fxConfig.shards;
  const progress = clamp01(particle.ageMs / particle.lifetimeMs);
  const size = particle.size * evaluateNumber(shardCfg.sizeKeys, progress) * scale;
  const alpha = evaluateNumber(shardCfg.alphaKeys, progress) * opacity;
  const color = evaluateColor(shardCfg.colorKeys, progress);

  if (size <= 0 || alpha <= 0)
  {
    return;
  }

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.beginPath();
  context.moveTo(0, -size * 0.58);
  context.lineTo(size * 0.52, size * 0.45);
  context.lineTo(-size * 0.52, size * 0.45);
  context.closePath();
  context.fillStyle = colorToCss(color, alpha);
  // 三角碎片在原图中是清晰本体；显式清空阴影，避免继承上一层发光状态。
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
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
  constructor(x, y, fxConfig)
  {
    this.fx = fxConfig;
    this.x = x;
    this.y = y;
    this.ageMs = 0;
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

  draw(context, scale, opacity, useNativeBloom = true, legacy = false)
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
        legacy,
      );
    }

    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress < 1)
    {
      const ringMaterialEnergy = legacy
        ? null
        : evaluateSrgbGradientEnergy(
          this.fx.rings.colorKeys,
          ringProgress,
          this.fx.rings.hdrIntensity,
        );

      for (const ring of this.rings)
      {
        if (legacy)
        {
          drawLegacyDissolvedCircle(context, ring, ringProgress, scale, opacity, this.fx);
        }
        else
        {
          drawDissolvedCircle(
            context,
            ring,
            ringProgress,
            scale,
            opacity,
            this.fx,
            useNativeBloom,
            false,
            ringMaterialEnergy,
          );
        }
      }
    }
  }

  drawBloom(context, scale, opacity)
  {
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

  appendWebGLBloom(renderer, scale, opacity)
  {
    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      const diskCfg = this.fx.disk;
      const bloomCfg = this.fx.bloom;
      const radius = diskCfg.radius * evaluateNumber(
        diskCfg.sizeKeys,
        diskProgress,
      ) * scale;
      const color = evaluateColor(diskCfg.colorKeys, diskProgress);
      const alpha = evaluateNumber(diskCfg.alphaKeys, diskProgress) *
        opacity * bloomCfg.diskEmissionAlpha;
      const materialEnergy = colorToLinearEnergy(
        color,
        bloomCfg.diskEmission,
      );

      renderer.addDisk(this.x, this.y, radius, materialEnergy, alpha);
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
        opacity * bloomCfg.ringEmissionAlpha,
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
    return this.ageMs >= this.fx.rings.lifetimeMs;
  }
}

class ShardParticle
{
  constructor(specification)
  {
    Object.assign(this, specification);
    this.ageMs = 0;
  }

  update(deltaMs)
  {
    const deltaSeconds = deltaMs / 1000;

    this.ageMs += deltaMs;
    this.x += this.velocityX * deltaSeconds;
    this.y += this.velocityY * deltaSeconds;
  }

  draw(
    context,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
  )
  {
    drawTriangle(context, this, scale, opacity, fxConfig);
  }

  get dead()
  {
    return this.ageMs >= this.lifetimeMs;
  }
}

function createShard(x, y, originAngle, kind, scale, shardCfg = UNITY_FX_TOUCH.shards)
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
      rotation: Math.random() < 0.5 ? 0 : Math.PI,
      lifetimeMs,
      size: random(shardCfg.sizeMin, shardCfg.sizeMax),
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
  const segmentEnergies = [];
  const segmentMaximumEnergies = [];

  if (measurement.totalLength <= 0 || materialIntensity === null)
  {
    return {
      measurement,
      segmentEnergies,
      segmentMaximumEnergies,
    };
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
    );

    segmentEnergies.push(energy);
    segmentMaximumEnergies.push(Math.max(energy[0], energy[1], energy[2]));
  }

  return {
    measurement,
    segmentEnergies,
    segmentMaximumEnergies,
  };
}

function evaluateTrailLinearEnergy(
  progress,
  trailCfg,
  materialIntensity,
)
{
  const gradientColor = interpolateTrailColor(progress, trailCfg);
  const textureIntensity = evaluateNumber(
    trailCfg.textureLongitudinalKeys,
    progress,
  );

  const gradientEnergy = colorToLinearEnergy(gradientColor);

  // 原 Shader 先将线性顶点色与已解码的 Stretch 纹理相乘，再施加 _Intensity。
  return gradientEnergy.map((channel) =>
    channel * textureIntensity * materialIntensity);
}

function drawTrailLayer(
  context,
  points,
  measurement,
  scale,
  opacity,
  trailCfg,
  layer,
  segmentEnergies = null,
)
{
  if (measurement.totalLength <= 0)
  {
    return;
  }

  context.save();
  context.lineJoin = 'round';
  context.lineCap = 'butt';
  context.lineWidth = layer.width * scale;

  for (let index = 1; index < points.length; index++)
  {
    const progress = (
      measurement.distances[index - 1] + measurement.distances[index]
    ) * 0.5 / measurement.totalLength;
    const color = segmentEnergies?.[index - 1] ??
      evaluateTrailLinearEnergy(
        progress,
        trailCfg,
        layer.materialIntensity,
      );

    context.beginPath();
    context.moveTo(points[index - 1].x, points[index - 1].y);
    context.lineTo(points[index].x, points[index].y);
    context.strokeStyle = linearEnergyToAdditiveCss(
      color,
      layer.alpha * opacity,
    );
    context.shadowBlur = 0;
    context.shadowColor = 'transparent';
    context.stroke();
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
    measurement,
    scale,
    opacity,
    trailCfg,
    {
      width: trailCfg.geometryWidth,
      alpha: bloomCfg.trailAlpha,
      materialIntensity: bloomCfg.trailEmission,
    },
    trailData.segmentEnergies,
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

/**
 * main 分支风格的拖尾层：sRGB 颜色 + 标准 alpha，无 HDR 编码。
 * layer.color 为固定颜色时整条一次描边（round cap）；
 * 无 color 时按路径距离采样 gradient（butt cap 逐段）。
 */
function drawLegacyTrailLayer(context, points, measurement, scale, opacity, trailCfg, layer)
{
  if (measurement.totalLength <= 0)
  {
    return;
  }

  context.save();
  context.lineJoin = 'round';
  context.lineWidth = Math.max(0.5, layer.width * scale);

  if (layer.color)
  {
    context.lineCap = 'round';
    context.strokeStyle = colorToCss(layer.color, layer.alpha * opacity);
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);

    for (let index = 1; index < points.length; index++)
    {
      context.lineTo(points[index].x, points[index].y);
    }

    context.stroke();
    context.restore();
    return;
  }

  // 渐变色：逐段 butt cap
  context.lineCap = 'butt';
  const distances = measurement.distances;
  const totalLength = measurement.totalLength;

  for (let index = 1; index < points.length; index++)
  {
    const progress = ((distances[index - 1] + distances[index]) * 0.5) / totalLength;
    const color = layer.gradient
      ? evaluateColor(layer.gradient, progress)
      : interpolateTrailColor(progress, trailCfg);
    const fadeAlpha = Math.pow(progress, 0.5);

    context.beginPath();
    context.moveTo(points[index - 1].x, points[index - 1].y);
    context.lineTo(points[index].x, points[index].y);
    context.strokeStyle = colorToCss(color, layer.alpha * opacity * fadeAlpha);
    context.shadowBlur = 0;
    context.shadowColor = 'transparent';
    context.stroke();
  }

  context.restore();
}

function drawTrail(
  context,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  useNativeBloom = true,
  legacy = false,
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
    legacy ? null : bloomCfg.trailEmission,
  );
  const measurement = trailData.measurement;

  if (legacy)
  {
    // main 分支风格：三层 sRGB 描边，使用 main 分支的宽度和渐变色
    const LEGACY_TRAIL_WIDTH = 4;
    const LEGACY_TRAIL_CORE_WIDTH = 1.7;
    const LEGACY_TRAIL_GRADIENT = [
      [0, [0, 100, 220]],
      [0.5794156, [0, 150, 235]],
      [0.9794156, [0, 238, 255]],
      [1, [0, 238, 255]],
    ];

    drawLegacyTrailLayer(context, points, measurement, scale, trailOpacity, trailCfg,
      {
        width: trailCfg.outerGlowWidth,
        alpha: bloomCfg.trailAlpha,
        color: [0, 88, 224],
      });
    drawLegacyTrailLayer(context, points, measurement, scale, trailOpacity, trailCfg,
      {
        width: LEGACY_TRAIL_WIDTH,
        alpha: 1,
        gradient: LEGACY_TRAIL_GRADIENT,
      });
    drawLegacyTrailLayer(context, points, measurement, scale, trailOpacity, trailCfg,
      {
        width: LEGACY_TRAIL_CORE_WIDTH,
        alpha: 0.72,
        color: [116, 225, 255],
      });
    return;
  }

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
  drawTrailLayer(context, points, measurement, scale, trailOpacity, trailCfg,
    {
      width: trailCfg.width,
      alpha: 1,
      materialIntensity: bloomCfg.trailEmission,
    },
    trailData.segmentEnergies,
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

  context.save();
  context.lineJoin = 'round';
  // 相邻段在 lighter 遮罩中不得以 round cap 重叠，否则每个采样点都会变亮。
  context.lineCap = 'butt';
  context.lineWidth = Math.max(
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

  for (let index = firstSegment; index <= lastSegment; index++)
  {
    const progress = (
      measurement.distances[index - 1] + measurement.distances[index]
    ) * 0.5 / measurement.totalLength;
    const energy = trailData.segmentEnergies[index - 1] ??
      evaluateTrailLinearEnergy(
        progress,
        trailCfg,
        bloomCfg.trailEmission,
      );

    context.beginPath();
    context.moveTo(points[index - 1].x, points[index - 1].y);
    context.lineTo(points[index].x, points[index].y);
    context.strokeStyle = linearEnergyToEmissionCss(
      energy,
      trailOpacity,
      bloomCfg.emissionRange,
    );
    context.stroke();
  }

  context.restore();
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
    );
  }
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

    const bloomBackend = normalizeBloomBackend(
      options.bloomBackend,
      options.softwareBloomEnabled === false
        ? 'native'
        : CONFIG.bloomBackend,
    );

    this.config = createConfig(
      {
        scale: Number.isFinite(options.scale) ? Math.max(0.01, options.scale) : CONFIG.scale,
        opacity: Number.isFinite(options.opacity) ? clamp01(options.opacity) : CONFIG.opacity,
        clickEnabled: options.clickEnabled ?? CONFIG.clickEnabled,
        trailEnabled: options.trailEnabled ?? CONFIG.trailEnabled,
        trailAlways: options.trailAlways ?? CONFIG.trailAlways,
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
    if (this.config.renderingMode === 'legacy')
    {
      this._applyLegacyParams();
    }
    this.waves = [];
    this.shards = [];
    this.trailStrokes = [];
    this.currentTrailStroke = null;
    this.activePointerId = null;
    this.lastPointerPosition = null;
    this.lastPointerTime = 0;
    this.trailDistanceSinceShard = 0;
    this.animationFrame = null;
    this.lastFrameTime = null;
    this.destroyed = false;

    this._onResize = this._resize.bind(this);
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onBlur = this._cancelPointer.bind(this);
    this._onFrame = this._renderFrame.bind(this);
    this._onWebGLContextLost = this._handleWebGLContextLost.bind(this);
    this._onWebGLContextRestored = this._handleWebGLContextRestored.bind(this);

    this._resize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove,
      {
        passive: true,
      });
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
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

  _applyLegacyParams()
  {
    this.fxConfig.rings.hdrIntensity = 1.0;
    this.fxConfig.rings.widthStart = 5.2;
    this.fxConfig.rings.widthEnd = 2.4;
    this.fxConfig.rings.radiusMin = 51;
    this.fxConfig.rings.radiusMax = 59;
    this.fxConfig.rings.sizeKeys = [[0.007209778, 0.420509], [0.2139282, 0.7159773], [1, 1]];
    this.fxConfig.rings.dissolveKeys = [[0, 1], [0.2, 0], [1, 1]];
    this.fxConfig.rings.arcSamples = 96;
    delete this.fxConfig.rings.bandToOuterRadius;
    delete this.fxConfig.rings.textureAlphaKeys;
    delete this.fxConfig.rings.textureRadialAlphaKeys;
    this.fxConfig.trail.gradient = [
      [0, [0, 100, 220]],
      [0.5794156, [0, 150, 235]],
      [0.9794156, [0, 238, 255]],
      [1, [0, 238, 255]],
    ];
    this.fxConfig.trail.coreWidth = 1.7;
    this.fxConfig.trail.width = 4;
    this.fxConfig.bloom.trailAlpha = 0.00;
    this.fxConfig.bloom.ringAlpha = 0.9;
    this.fxConfig.bloom.ringBlur = 80;
    this.fxConfig.bloom.diskBlur = 65;
    this.fxConfig.bloom.shardBlur = 0;
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

  _getScale()
  {
    return this.config.scale * (this.height / UNITY_FX_TOUCH.referenceHeight) * SIZE_CORRECTION;
  }

  _acceptPointerDown(event)
  {
    // button: 0=左键, -1=未按键(移动事件)；仅 >0 的非左键实际点击需拦截
    if (event.pointerType === 'mouse' && event.button > 0)
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
    if (this.destroyed || !this._acceptPointerDown(event))
    {
      return;
    }

    // TouchEffectCreater 的 MaxActiveDragEffectCount 为 1：第二根手指不生成点击，
    // 也不能接管第一根手指正在驱动的 TrailRenderer。
    // 例外：始终显示模式下的拖尾可以被实际点击接管。
    if (this.activePointerId !== null && !this.config.trailAlways)
    {
      return;
    }

    const position = this._getPointerPosition(event);
    const pointerId = event.pointerId ?? 1;

    // 始终显示模式下点击：停止旧 stroke 发射顶点，旧顶点仍按 0.3 秒自然过期
    if (this.activePointerId !== null && this.config.trailAlways && this.currentTrailStroke)
    {
      this.currentTrailStroke.active = false;
    }

    this.activePointerId = pointerId;
    this.lastPointerPosition = position;
    this.lastPointerTime = performance.now();
    this.trailDistanceSinceShard = 0;

    if (this.config.trailEnabled)
    {
      this.currentTrailStroke = {
        active: true,
        points: [createTrailPoint(position.x, position.y, this.lastPointerTime)],
      };
      this.trailStrokes.push(this.currentTrailStroke);
    }

    if (this.config.clickEnabled)
    {
      this._spawnClick(position.x, position.y);
    }

    this._requestRender();
  }

  _handlePointerMove(event)
  {
    if (this.destroyed || !this.config.trailEnabled)
    {
      return;
    }

    // 始终显示模式：无激活指针时自动开始拖尾
    if (
      this.activePointerId === null &&
      this.config.trailAlways &&
      this._acceptPointerDown(event)
    )
    {
      const position = this._getPointerPosition(event);
      const now = performance.now();

      this.activePointerId = event.pointerId ?? 1;
      this.lastPointerPosition = position;
      this.lastPointerTime = now;
      this.trailDistanceSinceShard = 0;
      this.currentTrailStroke = {
        active: true,
        points: [
          createTrailPoint(position.x, position.y, now),
          createTrailPoint(position.x + 0.5, position.y + 0.5, now),
        ],
      };
      this.trailStrokes.push(this.currentTrailStroke);
      this._requestRender();
      return;
    }

    if (
      this.activePointerId === null ||
      (event.pointerId ?? 1) !== this.activePointerId
    )
    {
      return;
    }

    const coalesced = typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : [event];
    const events = coalesced.length > 0 ? coalesced : [event];

    for (const sample of events)
    {
      this._appendPointerSample(
        this._getPointerPosition(sample),
        performance.now(),
      );
    }

    this._requestRender();
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

    this._spawnTrailShards(from, position, scale);
    this.lastPointerPosition = position;
    this.lastPointerTime = now;
  }

  _spawnTrailShards(from, to, scale)
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
        this.shards.push(createShard(x, y, angle, 'trail', scale, this.fxConfig.shards));
      }

      nextDistance += spacing;
      spawned++;
    }

    this.trailDistanceSinceShard = (this.trailDistanceSinceShard + segmentLength) % spacing;
  }

  _handlePointerUp(event)
  {
    if (
      this.destroyed ||
      this.activePointerId === null ||
      (event.pointerId ?? 1) !== this.activePointerId
    )
    {
      return;
    }

    this._releaseActivePointer();
  }

  _cancelPointer()
  {
    if (this.activePointerId !== null)
    {
      this._releaseActivePointer();
    }
  }

  _releaseActivePointer()
  {
    if (this.currentTrailStroke)
    {
      // Unity 松开时只停止更新根节点；已有 TrailRenderer 顶点仍按 0.3 秒自然过期。
      this.currentTrailStroke.active = false;
    }

    this.currentTrailStroke = null;
    this.activePointerId = null;
    this.lastPointerPosition = null;
    this.lastPointerTime = 0;
    this.trailDistanceSinceShard = 0;
    this._requestRender();
  }

  _spawnClick(x, y)
  {
    const scale = this._getScale();

    this.waves.push(new ClickWave(x, y, this.fxConfig));

    for (let index = 0; index < this.fxConfig.shards.clickCount; index++)
    {
      this.shards.push(createShard(x, y, random(0, TAU), 'click', scale, this.fxConfig.shards));
    }
  }

  _requestRender()
  {
    if (this.destroyed || this.animationFrame !== null)
    {
      return;
    }

    this.lastFrameTime = this.lastFrameTime ?? performance.now();
    this.animationFrame = requestAnimationFrame(this._onFrame);
  }

  _renderFrame(now)
  {
    if (this.destroyed)
    {
      return;
    }

    this.animationFrame = null;
    // Unity 生命周期跟随真实时间。低帧率时限制 delta 会让旧特效异常延寿，
    // 进一步增加同时存活的 Bloom 区域并形成性能反馈循环。
    const deltaMs = Math.max(0, now - (this.lastFrameTime ?? now));
    const scale = this._getScale();
    const legacy = this._isLegacy;
    const bloomBackend = legacy ? 'legacy' : this._resolveBloomBackend();
    const useSoftwareBloom = bloomBackend === 'software';
    const useWebGL2Bloom = bloomBackend === 'webgl2';
    const useNativeBloom = bloomBackend === 'native';

    this.lastFrameTime = now;
    this._setResolvedBloomBackend(bloomBackend);
    this._setWebGLBloomVisible(useWebGL2Bloom);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.context.clearRect(0, 0, this.width, this.height);
    // 推入当前实例的主题色偏移，渲染完成后清空，保证多实例安全
    const prevHueShift = themeHueShift;
    themeHueShift = this._themeHueShift;
    this.context.save();
    this.context.globalCompositeOperation = 'lighter';

    try
    {
      this._updateTrail(now, scale, useNativeBloom, legacy);
      this._updateWaves(deltaMs, scale, useNativeBloom, legacy);
      this._updateShards(deltaMs, scale);

      if (!legacy)
      {
        this._renderLightBackgroundContrast(
          scale,
          useSoftwareBloom || useWebGL2Bloom,
        );
      }

      if (useSoftwareBloom && this._hasVisibleEffects())
      {
        this._renderSoftwareBloom(scale);
      }
      else if (useWebGL2Bloom && this._hasVisibleEffects())
      {
        this._renderWebGL2Bloom(scale);
      }
      else if (useWebGL2Bloom)
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

  _getRequestedBloomBackendState()
  {
    if (this.config.renderingMode === 'legacy')
    {
      return 'legacy';
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
      return this.webglBloomRenderer.available ? 'webgl2' : fallback;
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

    if (requested !== 'webgl2' && requested !== 'auto')
    {
      return;
    }

    this._setWebGLBloomVisible(false);
    this._setResolvedBloomBackend(
      this.bloomRenderer.available ? 'software' : 'native',
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

    if (requested !== 'webgl2' && requested !== 'auto')
    {
      return;
    }

    // Renderer 会先在自己的 restored 监听器中重建资源；下一帧再验证完整链路。
    this._setResolvedBloomBackend('pending');
    this._requestRender();
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
      renderer = new WebGL2BloomRenderer(canvas);

      if (
        !renderer.available ||
        !renderer.resize(
          this.width,
          this.height,
          this.dpr,
          this.fxConfig.bloom.resolutionScale,
          this.fxConfig.bloom.skipIterations,
        )
      )
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

    if (this._ensureWebGLBloomRenderer())
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

      // 原生辉光只在首次使用时分配缓冲，默认软件 Bloom 不承担额外内存。
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

      for (const stroke of this.trailStrokes)
      {
        if (stroke.points.length >= 2)
        {
          drawTrail(
            context,
            stroke.points,
            scale,
            this.config.opacity,
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
        wave.draw(context, scale, this.config.opacity, false);
      }

      for (const shard of this.shards)
      {
        shard.draw(context, scale, this.config.opacity, this.fxConfig);
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
    // 区域必须覆盖卷积核完整支撑范围，否则边界会把光晕切成硬边。
    const padding = bloomCfg.ringBlur * scale *
      (0.55 + bloomCfg.scatter) + 8;
    const regions = [];
    const addRegion = (
      minimumX,
      minimumY,
      maximumX,
      maximumY,
      wave,
      trailBatches = [],
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
        },
      );
    };

    for (const wave of this.waves)
    {
      const diskProgress = wave.ageMs / this.fxConfig.disk.lifetimeMs;
      const ringProgress = wave.ageMs / this.fxConfig.rings.lifetimeMs;
      let sourceRadius = diskProgress < 1
        ? this.fxConfig.disk.radius * evaluateNumber(
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

    // 固定空间顺序使同一批 renderer 更可能连续复用相近尺寸的缓冲。
    regions.sort((left, right) =>
      left.x - right.x || left.y - right.y);

    return regions;
  }

  _getSoftwareBloomBounds(scale)
  {
    return combineBloomRegionBounds(this._getSoftwareBloomRegions(scale));
  }

  _renderSoftwareBloom(scale)
  {
    const bloomCfg = this.fxConfig.bloom;
    const regions = this._getSoftwareBloomRegions(scale);
    const combinedBounds = combineBloomRegionBounds(regions);
    const settings = {
      encodingRange: bloomCfg.emissionRange,
      threshold: bloomCfg.threshold,
      softKnee: bloomCfg.softKnee,
      clamp: bloomCfg.clamp,
      intensity: bloomCfg.intensity,
      scatter: bloomCfg.scatter,
      highQualityFiltering: bloomCfg.highQualityFiltering,
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
        bloomCfg.skipIterations,
        this.dpr,
        region.emissionBounds,
      );

      if (!bloomContext)
      {
        if (!renderer.available)
        {
          // 任一局部回读失败后，下一帧统一切换原生回退，不能只丢一块辉光。
          this.bloomRenderer.available = false;
          failed = true;
        }

        continue;
      }

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
            this.config.opacity,
            this.fxConfig,
            stroke.trailFrameData,
            batch.firstSegment,
            batch.lastSegment,
          );
        }
      }

      for (const wave of region.waves)
      {
        wave.drawBloom(bloomContext, scale, this.config.opacity);
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
        ? Math.ceil(combinedBounds.width * this.dpr) *
          Math.ceil(combinedBounds.height * this.dpr)
        : 0,
    };
    // 峰值结束后释放过量局部缓冲，同时保留少量余量避免区域数抖动时反复创建。
    this._trimBloomRendererPool(regions.length);

    if (failed)
    {
      this._setResolvedBloomBackend('native');
    }
  }

  _renderWebGL2Bloom(scale)
  {
    const renderer = this.webglBloomRenderer;
    const bloomCfg = this.fxConfig.bloom;

    if (
      !renderer ||
      !renderer.resize(
        this.width,
        this.height,
        this.dpr,
        bloomCfg.resolutionScale,
        bloomCfg.skipIterations,
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

    const rendered = renderer.render(
      {
        threshold: bloomCfg.threshold,
        softKnee: bloomCfg.softKnee,
        clamp: bloomCfg.clamp,
        intensity: bloomCfg.intensity,
        scatter: bloomCfg.scatter,
        highQualityFiltering: bloomCfg.highQualityFiltering,
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

  _updateTrail(now, scale, useNativeBloom, legacy = false)
  {
    const lifetime = this.fxConfig.trail.lifetimeMs;
    const nativeBloomSurface = useNativeBloom && !legacy
      ? this._getNativeTrailBloomSurface()
      : null;

    for (let strokeIndex = this.trailStrokes.length - 1; strokeIndex >= 0; strokeIndex--)
    {
      const stroke = this.trailStrokes[strokeIndex];
      let expiredPointCount = 0;

      while (
        expiredPointCount < stroke.points.length &&
        now - stroke.points[expiredPointCount].bornAt >= lifetime
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
        const materialIntensity = legacy
          ? null
          : this.fxConfig.bloom.trailEmission;

        stroke.trailFrameData = createTrailFrameData(
          stroke.points,
          this.fxConfig.trail,
          materialIntensity,
        );
        drawTrail(
          this.context,
          stroke.points,
          scale,
          this.config.opacity,
          this.fxConfig,
          useNativeBloom,
          legacy,
          nativeBloomSurface,
          stroke.trailFrameData,
        );
      }
      else
      {
        stroke.trailFrameData = null;
      }

      if (!stroke.active && stroke.points.length === 0)
      {
        this.trailStrokes.splice(strokeIndex, 1);
      }
    }
  }

  _updateWaves(deltaMs, scale, useNativeBloom, legacy = false)
  {
    for (let index = this.waves.length - 1; index >= 0; index--)
    {
      const wave = this.waves[index];

      wave.update(deltaMs);

      if (wave.dead)
      {
        this.waves.splice(index, 1);
        continue;
      }

      wave.draw(
        this.context,
        scale,
        this.config.opacity,
        useNativeBloom,
        legacy,
      );
    }
  }

  _updateShards(deltaMs, scale)
  {
    for (let index = this.shards.length - 1; index >= 0; index--)
    {
      const shard = this.shards[index];

      shard.update(deltaMs);

      if (shard.dead)
      {
        this.shards.splice(index, 1);
        continue;
      }

      shard.draw(
        this.context,
        scale,
        this.config.opacity,
        this.fxConfig,
      );
    }
  }

  _hasVisibleEffects()
  {
    return (
      this.activePointerId !== null ||
      this.waves.length > 0 ||
      this.shards.length > 0 ||
      this.trailStrokes.length > 0
    );
  }

  /** 在 Canvas 局部坐标触发一次 FX_Touch 点击粒子。 */
  boom(x = this.width / 2, y = this.height / 2)
  {
    if (this.destroyed || !this.config.clickEnabled)
    {
      return;
    }

    this._spawnClick(
      clamp(Number(x) || 0, 0, this.width),
      clamp(Number(y) || 0, 0, this.height),
    );
    this._requestRender();
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
   * @param {object} overrides — 与构造函数 options 相同字段的子集
   */
  updateConfig(overrides = {})
  {
    if (this.destroyed)
    {
      return;
    }

    const previousRenderingMode = this.config.renderingMode;
    const previousBloomBackend = this.config.bloomBackend;

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
        this.clearTrail();
      }
    }

    if (typeof overrides.trailAlways === 'boolean')
    {
      this.config.trailAlways = overrides.trailAlways;
    }

    if (overrides.renderingMode === 'enhanced' || overrides.renderingMode === 'legacy')
    {
      const wasLegacy = this.config.renderingMode === 'legacy';
      const nowLegacy = overrides.renderingMode === 'legacy';

      this.config.renderingMode = overrides.renderingMode;

      if (wasLegacy !== nowLegacy && this.ownsCanvas)
      {
        if (nowLegacy)
        {
          // 切到 legacy：移除 plus-lighter，隐藏对比画布
          this.canvas.style.mixBlendMode = '';
          this.canvas.style.zIndex = '2147483647';
          this._setWebGLBloomVisible(false);
          if (this.contrastCanvas)
          {
            this.contrastCanvas.style.display = 'none';
          }
          this._applyLegacyParams();
        }
        else
        {
          // 切回 enhanced：恢复 plus-lighter，显示对比画布，重置参数
          this.canvas.style.mixBlendMode = 'plus-lighter';
          this.canvas.style.zIndex = '2147483646';
          if (this.contrastCanvas)
          {
            this.contrastCanvas.style.display = '';
          }
          this.fxConfig = structuredClone(UNITY_FX_TOUCH);
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
      previousRenderingMode !== this.config.renderingMode ||
      previousBloomBackend !== this.config.bloomBackend
    )
    {
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

      const isTimeOrDistance = /(Ms|Spacing|Count|Radius|Width|Blur)$/.test(lastKey);
      const min = isTimeOrDistance ? 1 : 0;

      target[lastKey] = Math.max(min, value);
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
    window.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
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
  UNITY_FX_TOUCH,
  createConfig,
  SIZE_CORRECTION,
};

export default BAClickFX;
