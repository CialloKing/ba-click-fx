/**
 * ba-click-fx — Blue Archive 的 UI/FX_Touch 浏览器移植。
 *
 * 这不是“相似风格”参数化引擎。实现直接复刻 Unity 中 FXTouch、
 * ParticleSystem 和 TrailRenderer 的生命周期，只保留宿主接入所需的最小 API。
 */

import { CONFIG, UNITY_FX_TOUCH, createConfig, SIZE_CORRECTION } from './config.js';

const TAU = Math.PI * 2;
const DEFAULT_FRAME_MS = 1000 / 60;

// ── 主题色偏移 ──────────────────────────────────────────────────────────
// 游戏中代表蓝色的关键色 (76,167,255)，hue≈212°；以此为基准计算偏移量。

let themeHueShift = 0;
const BASE_BLUE = [76, 167, 255];
const BASE_BLUE_HUE = (() =>
{
  // 预计算基准蓝色的 hue（归一化 0~1）
  const r = BASE_BLUE[0] / 255;
  const g = BASE_BLUE[1] / 255;
  const b = BASE_BLUE[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  if (max === min)
  {
    return 0;
  }

  const d = max - min;
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

  return h / 6;
})();

/** 将主题色 hex 转为 hue 偏移量存储到模块变量。 */
export function setThemeHueShift(hex)
{
  if (!/^#[0-9a-f]{6}$/i.test(hex))
  {
    themeHueShift = 0;
    return;
  }

  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  if (max === min)
  {
    // 灰度主题色不偏移
    themeHueShift = 0;
    return;
  }

  const d = max - min;
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

  themeHueShift = (h / 6) - BASE_BLUE_HUE;
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

  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  // 饱和度极低（< 2%）视为灰度，不偏移
  if (d < 0.02)
  {
    return rgb;
  }

  const l = (max + min) / 2;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;

  if (d === 0)
  {
    return rgb;
  }

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

  let newHue = (h / 6) + themeHueShift;

  // hue 环绕
  newHue = newHue - Math.floor(newHue);

  // HSL → RGB
  const hueToRgb = (p, q, t) =>
  {
    if (t < 0) { t += 1; }

    if (t > 1) { t -= 1; }

    if (t < 1 / 6) { return p + (q - p) * 6 * t; }

    if (t < 1 / 2) { return q; }

    if (t < 2 / 3) { return p + (q - p) * (2 / 3 - t) * 6; }

    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const newR = hueToRgb(p, q, newHue + 1 / 3);
  const newG = hueToRgb(p, q, newHue);
  const newB = hueToRgb(p, q, newHue - 1 / 3);

  return [Math.round(newR * 255), Math.round(newG * 255), Math.round(newB * 255)];
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

function evaluateUnitySmoothCurve(keys, progress)
{
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

      return [
        lerp(previous[1][0], current[1][0], localProgress),
        lerp(previous[1][1], current[1][1], localProgress),
        lerp(previous[1][2], current[1][2], localProgress),
      ];
    }
  }

  return keys[keys.length - 1][1];
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

function setOverlayStyle(canvas, fixed)
{
  canvas.style.position = fixed ? 'fixed' : 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '2147483647';
}

function smoothstep(edge0, edge1, value)
{
  if (edge0 === edge1)
  {
    return value < edge0 ? 0 : 1;
  }

  const progress = clamp01((value - edge0) / (edge1 - edge0));

  return progress * progress * (3 - 2 * progress);
}

function drawDissolvedCircle(context, ring, progress, scale, opacity, fxConfig = UNITY_FX_TOUCH)
{
  const ringCfg = fxConfig.rings;
  const bloomCfg = fxConfig.bloom;
  const radius = ring.radius * evaluateNumber(ringCfg.sizeKeys, progress) * scale;
  // 游戏 sizeOverLifetime.y 曲线：环带厚度在生命周期前 8% 从 0 快速膨胀到全厚，
  // 之后随直径持续增长而相对变细。yCurve 在 0.079 进度后保持 ≈1。
  const yProgress = clamp01(progress / 0.07908168);
  const yCurve = evaluateUnitySmoothCurve([[0, 0], [1, 0.9972414]], yProgress);
  const width = lerp(ringCfg.widthStart, ringCfg.widthEnd, progress) * yCurve * scale;
  const threshold = evaluateNumber(ringCfg.dissolveKeys, progress);
  const visibleRatio = 1 - threshold;
  const particleColor = evaluateColor(ringCfg.colorKeys, progress);
  // 游戏 Tonemap 对各通道非均匀压缩；Canvas 2D 的均匀乘法会让红色通道
  // 相对偏高。降为 1.0 让粒子自身的蓝色调主导，shadowBlur 辉光不受影响。
  const hdrColor = particleColor.map((channel) =>
    channel * ringCfg.hdrIntensity);
  const arcLength = TAU * visibleRatio;
  // 正向 sweep 在弧长下降时让活动端角度下降，即沿 Canvas 的逆时针方向
  // 追向固定端；使用负向 sweep 会和圆环旋转对冲，视觉上变成两头消失。
  const sweep = ringCfg.dissolveDirection * arcLength;

  if (arcLength <= 0.001)
  {
    return;
  }

  const steps = Math.max(
    6,
    Math.ceil(ringCfg.arcSamples * visibleRatio),
  );
  const shouldTaper = visibleRatio < 0.995;

  context.save();
  context.translate(ring.x, ring.y);
  context.rotate(ring.rotation);
  context.beginPath();

  // 外沿和内沿组成一条连续弧带。Unity 溶解阈值沿 UV 单向推进控制弧长；
  // 纹理 FX_TEX_Grad_Ring3 的 alpha 在环带两端均自然衰减，形成双尖角。
  for (let index = 0; index <= steps; index++)
  {
    const localProgress = index / steps;
    const angle = sweep * localProgress;
    // 双向 taper：两端 smoothstep 乘积确保 localProgress=0 和 =1 处均为尖角
    const taper = shouldTaper
      ? smoothstep(0, ringCfg.dissolveEdgeRatio, localProgress) *
        smoothstep(0, ringCfg.dissolveEdgeRatio, 1 - localProgress)
      : 1;
    const outerRadius = radius + width * 0.5 * taper;
    const x = Math.cos(angle) * outerRadius;
    const y = Math.sin(angle) * outerRadius;

    if (index === 0)
    {
      context.moveTo(x, y);
    }
    else
    {
      context.lineTo(x, y);
    }
  }

  for (let index = steps; index >= 0; index--)
  {
    const localProgress = index / steps;
    const angle = sweep * localProgress;
    const taper = shouldTaper
      ? smoothstep(0, ringCfg.dissolveEdgeRatio, localProgress) *
        smoothstep(0, ringCfg.dissolveEdgeRatio, 1 - localProgress)
      : 1;
    const innerRadius = Math.max(0, radius - width * 0.5 * taper);

    context.lineTo(
      Math.cos(angle) * innerRadius,
      Math.sin(angle) * innerRadius,
    );
  }

  context.closePath();
  context.fillStyle = colorToCss(hdrColor, opacity);
  context.shadowColor = colorToCss(
    particleColor,
    opacity * UNITY_FX_TOUCH.bloom.ringAlpha,
  );
  context.shadowBlur = UNITY_FX_TOUCH.bloom.ringBlur * scale;
  context.fill();

  // FX_TEX_Grad_Ring3 的 V 方向在环带中央比两侧亮约 12%；
  // 在均匀填充之上再叠加一层居中窄环带，模拟材质的径向亮度变化。
  {
    const ridgeRatio = 0.6;
    const ridgeAlphaBoost = 1.12;

    context.beginPath();

    for (let index = 0; index <= steps; index++)
    {
      const localProgress = index / steps;
      const angle = sweep * localProgress;
      const ridgeTaper = shouldTaper
        ? smoothstep(0, ringCfg.dissolveEdgeRatio, localProgress) *
          smoothstep(0, ringCfg.dissolveEdgeRatio, 1 - localProgress)
        : 1;
      const outerRidge = radius + width * 0.5 * ridgeRatio * ridgeTaper;
      const x = Math.cos(angle) * outerRidge;
      const y = Math.sin(angle) * outerRidge;

      if (index === 0)
      {
        context.moveTo(x, y);
      }
      else
      {
        context.lineTo(x, y);
      }
    }

    for (let index = steps; index >= 0; index--)
    {
      const localProgress = index / steps;
      const angle = sweep * localProgress;
      const ridgeTaper = shouldTaper
        ? smoothstep(0, ringCfg.dissolveEdgeRatio, localProgress) *
          smoothstep(0, ringCfg.dissolveEdgeRatio, 1 - localProgress)
        : 1;
      const innerRidge = Math.max(0, radius - width * 0.5 * ridgeRatio * ridgeTaper);

      context.lineTo(
        Math.cos(angle) * innerRidge,
        Math.sin(angle) * innerRidge,
      );
    }

    context.closePath();
    context.fillStyle = colorToCss(hdrColor, opacity * ridgeAlphaBoost);
    context.shadowBlur = 0;
    context.fill();
  }

  context.restore();
}

function drawDisk(context, wave, progress, scale, opacity, fxConfig = UNITY_FX_TOUCH)
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

  // FX_TEX_Circle_01 的主体接近纯白遮罩，颜色由 Color over Lifetime 整体相乘；
  // 中心不能额外保留白点，否则蓝色阶段会变成旧版的发光球。
  gradient.addColorStop(0, colorToCss(color, alpha));
  gradient.addColorStop(0.88, colorToCss(color, alpha));
  gradient.addColorStop(0.97, colorToCss(color, alpha * 0.55));
  gradient.addColorStop(1, colorToCss(color, 0));

  context.save();
  context.beginPath();
  context.arc(wave.x, wave.y, radius, 0, TAU);
  context.fillStyle = gradient;
  context.shadowColor = colorToCss(color, alpha * 0.5);
  context.shadowBlur = bloomCfg.diskBlur * scale;
  context.fill();
  context.restore();
}

function drawTriangle(context, particle, scale, opacity, fxConfig = UNITY_FX_TOUCH)
{
  const shardCfg = fxConfig.shards;
  const bloomCfg = fxConfig.bloom;
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
  context.shadowColor = colorToCss(color, alpha * 0.75);
  context.shadowBlur = bloomCfg.shardBlur * scale;
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
  // maxCurve 末端有极小负值；游戏画面在该阶段只表现为停转，没有可见反转。
  const velocity = Math.max(0, lerp(minVelocity, maxVelocity, angularBlend));

  return velocity * ringCfg.angularVelocityMultiplier * ringCfg.rotationDirection;
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

  draw(context, scale, opacity)
  {
    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      drawDisk(context, this, diskProgress, scale, opacity, this.fx);
    }

    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress < 1)
    {
      for (const ring of this.rings)
      {
        drawDissolvedCircle(context, ring, ringProgress, scale, opacity, this.fx);
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

  draw(context, scale, opacity, fxConfig = UNITY_FX_TOUCH)
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

function drawTrailLayer(context, points, scale, opacity, layer)
{
  let totalLength = 0;
  const distances = [0];

  for (let index = 1; index < points.length; index++)
  {
    totalLength += distance(points[index - 1], points[index]);
    distances.push(totalLength);
  }

  if (totalLength <= 0)
  {
    return;
  }

  context.save();
  context.lineJoin = 'round';
  context.lineWidth = layer.width * scale;

  if (layer.color)
  {
    // 固定颜色的光晕和线芯必须整条只描边一次；逐段 round cap 会在每个
    // TrailRenderer 顶点叠出一颗亮点，形成用户看到的“珍珠项链”。
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

  // 颜色渐变仍按路径距离采样，但使用 butt cap，邻接段不会生成圆形光点。
  context.lineCap = 'butt';

  for (let index = 1; index < points.length; index++)
  {
    const progress = ((distances[index - 1] + distances[index]) * 0.5) / totalLength;
    const color = interpolateTrailColor(progress);
    // 尾部 fadeAlpha→0 透明融入背景，颜色保持蓝色调不产生灰色伪影
    const fadeAlpha = Math.pow(progress, 0.5);

    context.beginPath();
    context.moveTo(points[index - 1].x, points[index - 1].y);
    context.lineTo(points[index].x, points[index].y);
    context.strokeStyle = colorToCss(color, layer.alpha * opacity * fadeAlpha);
    context.stroke();
  }

  context.restore();
}

function drawTrail(context, points, scale, opacity, fxConfig = UNITY_FX_TOUCH)
{
  const trailCfg = fxConfig.trail;
  const bloomCfg = fxConfig.bloom;

  drawTrailLayer(context, points, scale, opacity,
    {
      width: trailCfg.outerGlowWidth,
      alpha: bloomCfg.trailAlpha,
      color: [0, 88, 224],
    });
  drawTrailLayer(context, points, scale, opacity,
    {
      width: trailCfg.width,
      alpha: 1,
    });
  drawTrailLayer(context, points, scale, opacity,
    {
      width: trailCfg.coreWidth,
      alpha: 0.72,
      color: [116, 225, 255],
    });
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

    if (!this.canvas)
    {
      throw new Error('BAClickFX 找不到 target');
    }

    if (this.ownsCanvas)
    {
      const parent = this.host ?? document.body;

      setOverlayStyle(this.canvas, !this.host);
      parent.appendChild(this.canvas);
    }

    this.canvas.style.touchAction = this.config.touchAction;
    this.context = this.canvas.getContext('2d');

    if (!this.context)
    {
      throw new Error('BAClickFX 无法创建 Canvas 2D 上下文');
    }

    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.fxConfig = JSON.parse(JSON.stringify(UNITY_FX_TOUCH));
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

    this.lastFrameTime = now;
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.context.clearRect(0, 0, this.width, this.height);
    this.context.save();
    this.context.globalCompositeOperation = 'lighter';

    this._updateTrail(now, scale);
    this._updateWaves(deltaMs, scale);
    this._updateShards(deltaMs, scale);

    this.context.restore();

    if (this._hasVisibleEffects())
    {
      this._requestRender();
    }
    else
    {
      this.lastFrameTime = null;
    }
  }

  _updateTrail(now, scale)
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
        drawTrail(this.context, stroke.points, scale, this.config.opacity, this.fxConfig);
      }

      if (!stroke.active && stroke.points.length === 0)
      {
        this.trailStrokes.splice(strokeIndex, 1);
      }
    }
  }

  _updateWaves(deltaMs, scale)
  {
    for (let index = this.waves.length - 1; index >= 0; index--)
    {
      const wave = this.waves[index];

      wave.update(deltaMs);
      wave.draw(this.context, scale, this.config.opacity, this.fxConfig);

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
      shard.draw(this.context, scale, this.config.opacity, this.fxConfig);

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
    setThemeHueShift(hex);
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
    if (this.destroyed || !Number.isFinite(value))
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

    if (typeof target[lastKey] === 'number')
    {
      target[lastKey] = value;
      this._requestRender();
    }
  }

  /** @returns {object} 当前完整特效配置的深拷贝 */
  getFxConfig()
  {
    return JSON.parse(JSON.stringify(this.fxConfig));
  }

  /** 重置所有特效参数为游戏默认值 */
  resetFxConfig()
  {
    this.fxConfig = JSON.parse(JSON.stringify(UNITY_FX_TOUCH));
    this._requestRender();
  }

  /** 清除拖尾顶点和拖拽产生的碎片，不影响仍在播放的点击。 */
  clearTrail()
  {
    this.trailStrokes.length = 0;
    this.currentTrailStroke = null;
    this.shards = this.shards.filter((shard) => shard.kind !== 'trail');
    this.context.clearRect(0, 0, this.width, this.height);
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
  }

  getConfig()
  {
    return {
      ...this.config,
      unity: UNITY_FX_TOUCH,
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

    if (this.ownsCanvas)
    {
      this.canvas.remove();
    }
  }
}

export { CONFIG, UNITY_FX_TOUCH, createConfig, SIZE_CORRECTION };

export default BAClickFX;
