/**
 * ba-click-fx — Blue Archive 的 UI/FX_Touch 浏览器移植。
 *
 * 这不是“相似风格”参数化引擎。实现直接复刻 Unity 中 FXTouch、
 * ParticleSystem 和 TrailRenderer 的生命周期，只保留宿主接入所需的最小 API。
 */

import { CONFIG, UNITY_FX_TOUCH, createConfig, SIZE_CORRECTION } from './config.js';
import { SoftwareBloomRenderer } from './software-bloom.js';

const TAU = Math.PI * 2;
const DEFAULT_FRAME_MS = 1000 / 60;
const LIGHT_BACKGROUND_CONTRAST_COLOR = [76, 255, 255];
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
)
{
  const ringCfg = fxConfig.rings;
  const bloomCfg = fxConfig.bloom;
  const geometry = resolveRingGeometry(ring, progress, scale, ringCfg);
  const particleColor = evaluateColor(ringCfg.colorKeys, progress);
  // Apply Active Color Space 会先把粒子 sRGB 顶点色解码到 Linear，再送入 Shader。
  const materialEnergy = evaluateSrgbGradientEnergy(
    ringCfg.colorKeys,
    progress,
    ringCfg.hdrIntensity,
  );

  if (geometry.width <= 0.001)
  {
    return;
  }

  context.save();
  context.translate(ring.x, ring.y);
  context.rotate(ring.rotation);
  fillDissolvedRing(
    context,
    geometry.radius,
    geometry.width,
    geometry.threshold,
    ringCfg,
    (luminance) => linearEnergyToAdditiveCss(
      materialEnergy,
      opacity * luminance,
    ),
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
)
{
  const ringCfg = fxConfig.rings;
  const bloomCfg = fxConfig.bloom;
  const geometry = resolveRingGeometry(ring, progress, scale, ringCfg);

  if (geometry.width <= 0.001)
  {
    return;
  }

  const materialEnergy = evaluateSrgbGradientEnergy(
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
)
{
  const diskCfg = fxConfig.disk;
  const bloomCfg = fxConfig.bloom;
  const radius = diskCfg.radius * evaluateNumber(diskCfg.sizeKeys, progress) * scale;
  const color = evaluateColor(diskCfg.colorKeys, progress);
  const alpha = evaluateNumber(diskCfg.alphaKeys, progress) * opacity;
  const materialEnergy = colorToLinearEnergy(
    color,
    bloomCfg.diskEmission,
  );
  const gradient = context.createRadialGradient(
    wave.x,
    wave.y,
    0,
    wave.x,
    wave.y,
    Math.max(radius, 0.01),
  );

  // FX_TEX_Circle_01 的主体接近纯白遮罩，颜色由 Color over Lifetime 整体相乘；
  // 中心不能额外保留白点，否则蓝色阶段会变成旧版的发光球。
  gradient.addColorStop(0, linearEnergyToAdditiveCss(materialEnergy, alpha));
  gradient.addColorStop(0.88, linearEnergyToAdditiveCss(materialEnergy, alpha));
  gradient.addColorStop(
    0.97,
    linearEnergyToAdditiveCss(materialEnergy, alpha * 0.55),
  );
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');

  context.save();
  context.beginPath();
  context.arc(wave.x, wave.y, radius, 0, TAU);
  context.fillStyle = gradient;
  context.shadowColor = colorToCss(color, alpha * bloomCfg.diskAlpha);
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

  draw(context, scale, opacity, useNativeBloom = true)
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
      );
    }

    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress < 1)
    {
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
        );
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
      for (const ring of this.rings)
      {
        drawDissolvedCircleEmission(
          context,
          ring,
          ringProgress,
          scale,
          opacity,
          this.fx,
        );
      }
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
    const color = evaluateTrailLinearEnergy(
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
 * 原生回退只模糊一次完整路径，避免每个采样段的 shadowBlur 在接缝处累加。
 * CanvasGradient 沿首尾弦近似 Stretch UV；默认软件 Bloom 仍使用精确弧长采样。
 */
function drawNativeTrailBloom(
  context,
  points,
  measurement,
  scale,
  opacity,
  trailCfg,
  bloomCfg,
)
{
  if (
    measurement.totalLength <= 0 ||
    typeof context.createLinearGradient !== 'function' ||
    typeof context.filter !== 'string'
  )
  {
    return;
  }

  const first = points[0];
  const last = points[points.length - 1];

  // 首尾重合时线性渐变会退化成纯色；宁可省略回退光晕，也不要把暗尾提亮。
  if (distance(first, last) <= 0.5)
  {
    return;
  }

  const gradient = context.createLinearGradient(
    first.x,
    first.y,
    last.x,
    last.y,
  );
  const sampleCount = 16;

  for (let sample = 0; sample <= sampleCount; sample++)
  {
    const progress = sample / sampleCount;
    const color = evaluateTrailLinearEnergy(
      progress,
      trailCfg,
      bloomCfg.trailEmission,
    );

    gradient.addColorStop(
      progress,
      linearEnergyToAdditiveCss(
        color,
        bloomCfg.trailAlpha * opacity,
      ),
    );
  }

  context.save();
  context.filter = `blur(${trailCfg.outerGlowWidth * scale}px)`;
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = trailCfg.geometryWidth * scale;
  context.beginPath();
  context.moveTo(first.x, first.y);

  for (let index = 1; index < points.length; index++)
  {
    context.lineTo(points[index].x, points[index].y);
  }

  context.strokeStyle = gradient;
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  context.stroke();
  context.restore();
}

function drawTrail(
  context,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  useNativeBloom = true,
)
{
  const trailCfg = fxConfig.trail;
  const bloomCfg = fxConfig.bloom;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1.0);
  const measurement = measureTrail(points);

  if (useNativeBloom)
  {
    drawNativeTrailBloom(
      context,
      points,
      measurement,
      scale,
      trailOpacity,
      trailCfg,
      bloomCfg,
    );
  }

  // Unity 只绘制一条 2px HDR 几何带；可见宽度由后续 Bloom 自然扩张。
  drawTrailLayer(context, points, measurement, scale, trailOpacity, trailCfg,
    {
      width: trailCfg.width,
      alpha: 1,
      materialIntensity: bloomCfg.trailEmission,
    });
}

function drawTrailEmission(
  context,
  points,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
)
{
  const trailCfg = fxConfig.trail;
  const bloomCfg = fxConfig.bloom;
  const trailOpacity = opacity * (trailCfg.trailOpacity ?? 1.0) *
    bloomCfg.trailEmissionAlpha;
  const measurement = measureTrail(points);

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

  for (let index = 1; index < points.length; index++)
  {
    const progress = (
      measurement.distances[index - 1] + measurement.distances[index]
    ) * 0.5 / measurement.totalLength;
    const energy = evaluateTrailLinearEnergy(
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

export class BAClickFX
{
  /**
   * @param {object} [options]
   * @param {string|HTMLElement} [options.target]
   * @param {number} [options.scale]
   * @param {number} [options.opacity]
   * @param {boolean} [options.clickEnabled]
   * @param {boolean} [options.trailEnabled]
   * @param {boolean} [options.softwareBloomEnabled]
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

    this.config = createConfig(
      {
        scale: Number.isFinite(options.scale) ? Math.max(0.01, options.scale) : CONFIG.scale,
        opacity: Number.isFinite(options.opacity) ? clamp01(options.opacity) : CONFIG.opacity,
        clickEnabled: options.clickEnabled ?? CONFIG.clickEnabled,
        trailEnabled: options.trailEnabled ?? CONFIG.trailEnabled,
        trailAlways: options.trailAlways ?? CONFIG.trailAlways,
        softwareBloomEnabled: options.softwareBloomEnabled ??
          CONFIG.softwareBloomEnabled,
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
    this.canvas = isCanvas(this.host) ? this.host : createCanvas();
    this.contrastCanvas = this.ownsCanvas ? createCanvas() : null;

    if (!this.canvas)
    {
      throw new Error('BAClickFX 找不到 target');
    }

    if (this.ownsCanvas)
    {
      const parent = this.host ?? document.body;

      // 该层不含 Bloom，只在浅色背景上补足加色混合无法产生的颜色对比。
      setOverlayStyle(
        this.canvas,
        !this.host,
        '2147483646',
        'plus-lighter',
      );
      setOverlayStyle(
        this.contrastCanvas,
        !this.host,
        '2147483647',
        'darken',
      );
      parent.appendChild(this.canvas);
      // 必须置于加色主层上方，否则主层会再次把白底上的微弱青色补偿加回纯白。
      parent.appendChild(this.contrastCanvas);
    }

    this.canvas.style.touchAction = this.config.touchAction;
    this.context = this.canvas.getContext('2d');
    this.contrastContext = this.contrastCanvas?.getContext('2d') ?? null;

    if (!this.context)
    {
      throw new Error('BAClickFX 无法创建 Canvas 2D 上下文');
    }

    // 两个内部 Canvas 仅承担发射遮罩和 ImageData 暂存，不会插入 DOM。
    this.bloomRenderer = new SoftwareBloomRenderer(() => createCanvas());

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
    const deltaMs = clamp(now - (this.lastFrameTime ?? now), 0, DEFAULT_FRAME_MS * 4);
    const scale = this._getScale();
    const useSoftwareBloom = this._usesSoftwareBloom();

    this.lastFrameTime = now;
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.context.clearRect(0, 0, this.width, this.height);
    // 推入当前实例的主题色偏移，渲染完成后清空，保证多实例安全
    const prevHueShift = themeHueShift;
    themeHueShift = this._themeHueShift;
    this.context.save();
    this.context.globalCompositeOperation = 'lighter';

    this._updateTrail(now, scale, !useSoftwareBloom);
    this._updateWaves(deltaMs, scale, !useSoftwareBloom);
    this._updateShards(deltaMs, scale);
    this._renderLightBackgroundContrast(scale);

    if (useSoftwareBloom && this._hasVisibleEffects())
    {
      this._renderSoftwareBloom(scale);
    }

    this.context.restore();
    themeHueShift = prevHueShift;

    if (this._hasVisibleEffects())
    {
      this._requestRender();
    }
    else
    {
      this.lastFrameTime = null;
    }
  }

  _usesSoftwareBloom()
  {
    return this.config.softwareBloomEnabled && this.bloomRenderer.available;
  }

  _renderLightBackgroundContrast(scale)
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

  _getSoftwareBloomBounds(scale)
  {
    let minimumX = Infinity;
    let minimumY = Infinity;
    let maximumX = -Infinity;
    let maximumY = -Infinity;
    const includeCircle = (x, y, radius) =>
    {
      minimumX = Math.min(minimumX, x - radius);
      minimumY = Math.min(minimumY, y - radius);
      maximumX = Math.max(maximumX, x + radius);
      maximumY = Math.max(maximumY, y + radius);
    };

    for (const wave of this.waves)
    {
      let ringRadius = 0;

      for (const ring of wave.rings)
      {
        ringRadius = Math.max(ringRadius, ring.radius);
      }

      const sourceRadius = Math.max(
        this.fxConfig.disk.radius,
        ringRadius,
      ) * scale;

      includeCircle(wave.x, wave.y, sourceRadius);
    }

    const trailRadius = Math.max(
      1,
      this.fxConfig.trail.geometryWidth * scale * 0.5,
    );

    for (const stroke of this.trailStrokes)
    {
      if (stroke.points.length < 2)
      {
        continue;
      }

      const measurement = measureTrail(stroke.points);
      const bloomCfg = this.fxConfig.bloom;
      const minimumBloomEnergy = bloomCfg.threshold *
        (1 - clamp01(bloomCfg.softKnee));
      const trailOpacity = this.config.opacity *
        (this.fxConfig.trail.trailOpacity ?? 1) *
        bloomCfg.trailEmissionAlpha;

      for (let index = 1; index < stroke.points.length; index++)
      {
        const progress = (
          measurement.distances[index - 1] + measurement.distances[index]
        ) * 0.5 / Math.max(measurement.totalLength, 0.0001);
        const energy = evaluateTrailLinearEnergy(
          progress,
          this.fxConfig.trail,
          bloomCfg.trailEmission,
        );

        // Soft-knee 以下严格不会进入 bright pass；排除这段黑尾既不改变画面，
        // 又避免快速横移时为上千像素的零亮度区域建立 Bloom 金字塔。
        if (Math.max(...energy) * trailOpacity <= minimumBloomEnergy)
        {
          continue;
        }

        const previousPoint = stroke.points[index - 1];
        const point = stroke.points[index];

        includeCircle(previousPoint.x, previousPoint.y, trailRadius);
        includeCircle(point.x, point.y, trailRadius);
      }
    }

    if (!Number.isFinite(minimumX))
    {
      return null;
    }

    // 区域必须覆盖卷积核完整支撑范围，否则边界会把光晕切成硬边。
    const bloomCfg = this.fxConfig.bloom;
    const padding = bloomCfg.ringBlur * scale *
      (0.55 + bloomCfg.scatter) + 8;

    return {
      x: minimumX - padding,
      y: minimumY - padding,
      width: maximumX - minimumX + padding * 2,
      height: maximumY - minimumY + padding * 2,
    };
  }

  _renderSoftwareBloom(scale)
  {
    const bloomCfg = this.fxConfig.bloom;
    const bounds = this._getSoftwareBloomBounds(scale);
    const bloomContext = this.bloomRenderer.beginFrame(
      this.width,
      this.height,
      bloomCfg.resolutionScale,
      bounds,
      bloomCfg.skipIterations,
      this.dpr,
    );

    if (!bloomContext)
    {
      return;
    }

    bloomContext.save();

    for (const stroke of this.trailStrokes)
    {
      if (stroke.points.length >= 2)
      {
        drawTrailEmission(
          bloomContext,
          stroke.points,
          scale,
          this.config.opacity,
          this.fxConfig,
        );
      }
    }

    for (const wave of this.waves)
    {
      wave.drawBloom(bloomContext, scale, this.config.opacity);
    }

    bloomContext.restore();
    this.bloomRenderer.composite(
      this.context,
      {
        encodingRange: bloomCfg.emissionRange,
        threshold: bloomCfg.threshold,
        softKnee: bloomCfg.softKnee,
        clamp: bloomCfg.clamp,
        intensity: bloomCfg.intensity,
        scatter: bloomCfg.scatter,
        highQualityFiltering: bloomCfg.highQualityFiltering,
      },
    );
  }

  _updateTrail(now, scale, useNativeBloom)
  {
    const lifetime = this.fxConfig.trail.lifetimeMs;

    for (let strokeIndex = this.trailStrokes.length - 1; strokeIndex >= 0; strokeIndex--)
    {
      const stroke = this.trailStrokes[strokeIndex];

      while (
        stroke.points.length > 0 &&
        now - stroke.points[0].bornAt >= lifetime
      )
      {
        stroke.points.shift();
      }

      if (stroke.points.length >= 2)
      {
        drawTrail(
          this.context,
          stroke.points,
          scale,
          this.config.opacity,
          this.fxConfig,
          useNativeBloom,
        );
      }

      if (!stroke.active && stroke.points.length === 0)
      {
        this.trailStrokes.splice(strokeIndex, 1);
      }
    }
  }

  _updateWaves(deltaMs, scale, useNativeBloom)
  {
    for (let index = this.waves.length - 1; index >= 0; index--)
    {
      const wave = this.waves[index];

      wave.update(deltaMs);
      wave.draw(
        this.context,
        scale,
        this.config.opacity,
        useNativeBloom,
      );

      if (wave.dead)
      {
        this.waves.splice(index, 1);
      }
    }
  }

  _updateShards(deltaMs, scale)
  {
    for (let index = this.shards.length - 1; index >= 0; index--)
    {
      const shard = this.shards[index];

      shard.update(deltaMs);
      shard.draw(
        this.context,
        scale,
        this.config.opacity,
        this.fxConfig,
      );

      if (shard.dead)
      {
        this.shards.splice(index, 1);
      }
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

    if (typeof overrides.softwareBloomEnabled === 'boolean')
    {
      this.config.softwareBloomEnabled = overrides.softwareBloomEnabled;
    }

    if (Number.isFinite(overrides.lightBackgroundContrastAlpha))
    {
      this.config.lightBackgroundContrastAlpha = clamp01(
        overrides.lightBackgroundContrastAlpha,
      );
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
   * @param {number} value — 新值
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
    this.context.clearRect(0, 0, this.width, this.height);
    this.contrastContext?.clearRect(0, 0, this.width, this.height);
  }

  getConfig()
  {
    return {
      ...this.config,
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
    this.bloomRenderer.destroy();

    if (this.ownsCanvas)
    {
      this.contrastCanvas?.remove();
      this.canvas.remove();
    }
  }
}

export { CONFIG, UNITY_FX_TOUCH, createConfig, SIZE_CORRECTION };

export default BAClickFX;
