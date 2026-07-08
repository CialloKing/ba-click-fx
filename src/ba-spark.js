/**
 * ba-spark — 蔚蓝档案点击与拖拽特效引擎
 *
 * 纯 Canvas 2D 实现，零外部资源依赖。
 * 作为 ES Module 导入使用，也可通过 Vite 构建为 CJS / IIFE 格式。
 *
 * @example
 *   import { BAClickFX } from './ba-spark.js';
 *   const spark = new BAClickFX();
 *   spark.boom(300, 200);
 *
 * @license MIT
 */

import { clamp01, rand, easeOutCubic, smoothstep, distance, lerp, rgbToCss, mixColor } from './utils.js';
import { cloneConfig, createConfig, getClickScale, getTrailColor, getTrailCoreColor, getTrailHotColor } from './config.js';

// ═══════════════════════════════════════════════════════════════════════════
// 辅助函数（不依赖实例状态，保持为模块级函数）
// ═══════════════════════════════════════════════════════════════════════════

function createClickRingSegments(rings)
{
  const minCount = Math.max(1, Math.floor(rings.segmentCountMin ?? 2));
  const maxCount = Math.max(
    minCount,
    Math.floor(rings.segmentCountMax ?? minCount),
  );
  const extraCount =
    maxCount > minCount &&
    Math.random() < (rings.segmentExtraChance ?? 0)
      ? 1
      : 0;
  const count = Math.min(maxCount, minCount + extraCount);
  const segments = [];
  const smallRadiusIndex = Math.floor(Math.random() * count);

  while (segments.length < count)
  {
    const index = segments.length;
    const shouldCluster =
      index > 0 &&
      Math.random() < (rings.segmentClusterChance ?? 0);
    const shouldUseSmallRadius = index === smallRadiusIndex;
    let off = Math.random() * Math.PI * 2;

    if (shouldCluster)
    {
      const base = segments[Math.floor(Math.random() * segments.length)];
      const direction = Math.random() < 0.5 ? -1 : 1;

      off = base.off + direction * rand(0.3 * Math.PI, 0.92 * Math.PI);
    }

    segments.push({
      off,
      lenMul: rand(rings.lenMulMin, rings.lenMulMax),
      radiusOffset: rand(rings.radiusJitterMin, rings.radiusJitterMax),
      radiusGrowMul: shouldUseSmallRadius
        ? rand(rings.segmentRadiusGrowSmallMin, rings.segmentRadiusGrowSmallMax)
        : rand(rings.segmentRadiusGrowMin, rings.segmentRadiusGrowMax),
      rotationMul: rand(rings.rotationMulMin, rings.rotationMulMax),
      alphaMul: rand(0.92, 1.1),
      widthMul: rand(0.68, 1.24),
      collapseBias: rand(-0.16, 0.2),
    });
  }

  return segments;
}

function getTrailStopValue(stops, progress, fallback = 0)
{
  if (!stops || stops.length === 0)
  {
    return fallback;
  }

  const t = clamp01(progress);

  if (stops.length === 1)
  {
    return clamp01(stops[0][1]);
  }

  const first = stops[0];
  if (t <= first[0])
  {
    return clamp01(first[1]);
  }

  for (let i = 1; i < stops.length; i++)
  {
    const prev = stops[i - 1];
    const next = stops[i];

    if (t <= next[0])
    {
      const range = next[0] - prev[0];
      const localT = range === 0 ? 1 : (t - prev[0]) / range;

      return clamp01(lerp(prev[1], next[1], localT));
    }
  }

  return clamp01(stops[stops.length - 1][1]);
}

// ═══════════════════════════════════════════════════════════════════════════
// 内部类
// ═══════════════════════════════════════════════════════════════════════════

class ClickWave
{
  constructor(engine)
  {
    this._engine = engine;
    this.dead = true;
  }

  reset(x, y)
  {
    const rings = this._engine.config.rings;

    this.x = x;
    this.y = y;
    this.life = 0;
    this.r = 0;
    this.dead = false;

    this.ring = {
      ang: Math.random() * Math.PI * 2,
      rs: rings.rotationSpeed,
      segs: createClickRingSegments(rings),
    };
  }

  update(context, frameScale)
  {
    this.life += frameScale;

    this.drawHalo(context);
    this.drawFilledCircle(context);
    this.drawRings(context, frameScale);
    this.drawCenterDot(context);

    if (this.life >= this._engine.config.click.totalLife)
    {
      this.dead = true;
    }
  }

  getDiskRadius()
  {
    return this._engine.config.filledCircle.rAddRate * getClickScale(this._engine.config);
  }

  getRingStaticRadius()
  {
    return this.getDiskRadius() * this._engine.config.rings.baseRadiusMul;
  }

  getRingRadiusGrow(progress = 0)
  {
    const cfg = this._engine.config.rings;
    const t = easeOutCubic(clamp01(progress / cfg.radiusGrowEnd));

    return t * cfg.postDiskGrow * this._engine.config.scale;
  }

  getRingRadius(progress = 0)
  {
    return this.getRingStaticRadius() + this.getRingRadiusGrow(progress);
  }

  drawHalo(context)
  {
    if (!this._engine.config.glow.clickFake && !this._engine.config.glow.enabled)
    {
      return;
    }

    const progress = clamp01(this.life / this._engine.config.click.totalLife);
    const diskProgress = clamp01(this.life / this._engine.config.filledCircle.maxLife);
    const appear = smoothstep(0.01, 0.2, progress);
    const fade = 1 - smoothstep(0.84, 1, progress);
    // 根据主题色动态计算浅色起点，避免纯白与其他主题色叠加时色相冲突
    const startColor = mixColor(this._engine.config.color, [255, 255, 255], 0.95);
    const color = mixColor(
      startColor,
      this._engine.config.color,
      smoothstep(0.08, this._engine.config.filledCircle.colorEnd, diskProgress),
    );
    const radius = lerp(
      this.getDiskRadius() * 2.1,
      this._engine.config.click.haloRadius * getClickScale(this._engine.config),
      smoothstep(0.04, 0.54, progress),
    );
    const alpha = 0.2 * this._engine.config.opacity * appear * fade;

    this._engine._drawRadialGlow(context, this.x, this.y, radius, color, alpha);
  }

  drawFilledCircle(context)
  {
    const cfg = this._engine.config.filledCircle;
    const progress = clamp01(this.life / cfg.maxLife);

    this.r = this.getDiskRadius();

    if (progress >= 1)
    {
      return;
    }

    const expandT = easeOutCubic(clamp01(progress / cfg.expandEnd));
    const fade = 1 - smoothstep(cfg.fadeStart, 1, progress);
    const colorT = smoothstep(0.06, cfg.colorEnd, progress);
    const radius = this.r * expandT;
    const startColor = mixColor(this._engine.config.color, [255, 255, 255], 0.95);
    const color = mixColor(startColor, this._engine.config.color, colorT);
    const alpha = this._engine.config.opacity * fade;

    if (this._engine.config.glow.clickFake || this._engine.config.glow.enabled)
    {
      this._engine._drawRadialGlow(
        context,
        this.x,
        this.y,
        radius * cfg.glowRadiusMul,
        color,
        alpha * cfg.glowAlpha,
      );
    }

    this._engine._drawClickDisk(context, this.x, this.y, radius, color, alpha);
  }

  drawRings(context, frameScale)
  {
    const cfg = this._engine.config.rings;
    const ringLife = this.life - cfg.delay;

    if (ringLife <= 0)
    {
      return;
    }

    const progress = clamp01(ringLife / (cfg.maxLife - cfg.delay));

    if (progress >= 1)
    {
      return;
    }

    this.ring.ang -= this.ring.rs * frameScale;

    const grow = smoothstep(0.02, cfg.growEnd, progress);
    const collapse = smoothstep(cfg.collapseStart, 1, progress);
    const fade = 1 - smoothstep(cfg.fadeStart, 1, progress);
    // 圆环大部分时间维持纯白，最后 colorFadeStart 内渐变至基于主题色的浅色
    const ringEndColor = mixColor(this._engine.config.color, [255, 255, 255], cfg.colorEndWhiteMix);
    const colorFadeT = smoothstep(cfg.colorFadeStart, 1, progress);
    const color = mixColor([255, 255, 255], ringEndColor, colorFadeT);
    const ringAlpha = cfg.alpha * grow * fade;
    const glowGrow = Math.max(grow, 0.15);
    const ringGlowAlpha = cfg.emissionAlpha * glowGrow * fade;
    const staticRadius = this.getRingStaticRadius();
    const radiusGrow = this.getRingRadiusGrow(progress);
    const baseRadius = staticRadius + radiusGrow;
    const lineWidthMul = lerp(1, 0.72, collapse);

    this._engine._drawClickRingGlow(
      context,
      this.x,
      this.y,
      baseRadius,
      color,
      ringGlowAlpha,
    );

    for (const seg of this.ring.segs)
    {
      const segCollapse = smoothstep(
        cfg.collapseStart + seg.collapseBias,
        1,
        progress,
      );
      const baseAngle = this.ring.ang * seg.rotationMul + seg.off;
      const fullLen = cfg.lenFull * seg.lenMul * grow;
      const targetLen = lerp(fullLen, cfg.lenEnd, segCollapse);
      const start = baseAngle;
      const end = baseAngle + targetLen;
      const radius =
        staticRadius +
        radiusGrow * seg.radiusGrowMul +
        seg.radiusOffset * this._engine.config.scale;
      const segAlpha = ringAlpha * seg.alphaMul;
      const segLineWidthMul = lineWidthMul * seg.widthMul;
      const minWidth = cfg.minW * segLineWidthMul * this._engine.config.scale;
      const maxWidth = cfg.maxW * segLineWidthMul * this._engine.config.scale;

      this._engine._drawClickArcRibbon(
        context,
        this.x,
        this.y,
        radius,
        start,
        end,
        minWidth,
        maxWidth,
        color,
        segAlpha,
      );
    }
  }

  drawCenterDot(context)
  {
    const progress = clamp01(this.life / this._engine.config.click.totalLife);
    const dotAlpha =
      smoothstep(0.43, 0.52, progress) *
      (1 - smoothstep(0.82, 1, progress)) *
      this._engine.config.opacity *
      0.72;

    if (dotAlpha <= 0)
    {
      return;
    }

    const radius = lerp(1.5, 0.75, smoothstep(0.52, 1, progress)) * this._engine.config.scale;

    this._engine._drawCircle(
      context,
      this.x,
      this.y,
      radius,
      this._engine.config.color,
      dotAlpha,
      radius * 1.8,
      true,
    );
  }
}

class SparkParticle
{
  constructor(engine)
  {
    this._engine = engine;
    this.dead = true;
  }

  reset(x, y, fromClick = true)
  {
    const particleScale = fromClick ? getClickScale(this._engine.config) : this._engine.config.scale;
    const speedAdjust = particleScale / 1.5;
    const angle = Math.random() * Math.PI * 2;
    const speed = fromClick
      ? rand(4.8, 6.8) * speedAdjust
      : rand(0.85, 1.8) * speedAdjust;

    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;

    this.rotation = Math.random() * Math.PI * 2;
    this.rotationSpeed = fromClick ? rand(-0.14, 0.14) : rand(-0.08, 0.18);

    this.size = fromClick
      ? rand(4, 7) * particleScale
      : rand(2.4, 8.8) * particleScale;

    this.alpha = fromClick ? 1 : rand(0.28, 0.78);
    this.maxAlpha = this.alpha;
    this.alphaMul = 1;
    this.alphaDecay = 0.032;
    this.friction = fromClick ? 0.9 : 0.95;
    this.color = fromClick
      ? [255, 255, 255]
      : mixColor(this._engine.config.color, [255, 255, 255], rand(0.28, 0.82));
    this.blur = fromClick ? (2.0 * particleScale) : (2.8 * this._engine.config.scale);
    this.useFakeGlow = fromClick ? this._engine.config.glow.clickFake : true;
    this.delay = 0;
    this.age = 0;
    this.flickerPeriod = 0;
    this.flickerMinAlpha = 1;
    this.flickerPhase = 0;
    this.flickerSizePulse = 0;
    this.sizeGrowEnd = 0;
    this.sizeShrinkStart = 1;
    this.spawnSizeMul = 1;
    this.endSizeMul = 1;
    this.fromClick = fromClick;
    this.dead = false;
  }

  update(context, frameScale)
  {
    if (this.delay > 0)
    {
      this.delay -= frameScale;
      return;
    }

    this.x += this.vx * frameScale;
    this.y += this.vy * frameScale;

    this.vx *= Math.pow(this.friction, frameScale);
    this.vy *= Math.pow(this.friction, frameScale);

    this.rotation += this.rotationSpeed * frameScale;
    this.alpha -= this.alphaDecay * frameScale;

    let drawAlpha = this.alpha * this.alphaMul;
    let flickerPulse = 1;

    if (this.flickerPeriod > 0)
    {
      const cycle =
        ((this.age + this.flickerPhase) % this.flickerPeriod) /
        this.flickerPeriod;

      flickerPulse = Math.pow(Math.sin(cycle * Math.PI), 2);
      drawAlpha *= lerp(this.flickerMinAlpha, 1, flickerPulse);
    }

    const lifeProgress =
      this.maxAlpha > 0
        ? clamp01(1 - this.alpha / this.maxAlpha)
        : 1;
    const growMul = lerp(
      this.spawnSizeMul,
      1,
      smoothstep(0, this.sizeGrowEnd, lifeProgress),
    );
    // 消散阶段加速缩水：越接近消失缩小越快
    const rawShrinkT = clamp01((lifeProgress - this.sizeShrinkStart) / (1 - this.sizeShrinkStart));
    const shrinkT = rawShrinkT * rawShrinkT;
    const shrinkMul = lerp(1, this.endSizeMul, shrinkT);
    const sizeByLife = this.size * growMul * shrinkMul;
    const size =
      this.flickerPeriod > 0 && this.flickerSizePulse > 0
        ? sizeByLife *
          lerp(1 - this.flickerSizePulse, 1 + this.flickerSizePulse, flickerPulse)
        : sizeByLife;

    this._engine._drawTriangle(
      context,
      this.x,
      this.y,
      size,
      this.rotation,
      this.color,
      drawAlpha,
    );

    this.age += frameScale;

    if (this.alpha <= 0)
    {
      this.dead = true;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BAClickFX — 特效引擎
// ═══════════════════════════════════════════════════════════════════════════

export class BAClickFX
{
  /**
   * @param {object} [options={}]
   * @param {string|HTMLElement} [options.target] - 挂载目标元素或选择器。
   *   不传则自动创建全屏 Canvas 并插入 body。
   *   传入已有 `<canvas>` 元素则直接复用。
   */
  constructor(options = {})
  {
    // 每个实例都持有独立配置，避免多 Canvas/多实例互相污染运行时参数。
    this.config = createConfig();

    // ── 应用初始配置 ──
    if (options.color)
    {
      this.setColor(...options.color);
    }

    if (options.scale !== undefined)
    {
      this.setScale(options.scale);
    }

    if (options.opacity !== undefined)
    {
      this.setOpacity(options.opacity);
    }

    if (options.trailAlways !== undefined)
    {
      this.setTrailAlways(options.trailAlways);
    }

    if (options.trailEnabled !== undefined)
    {
      this.setTrail(options.trailEnabled);
    }

    if (options.clickEnabled !== undefined)
    {
      this.setClick(options.clickEnabled);
    }

    if (options.touchAction !== undefined)
    {
      this.setTouchAction(options.touchAction);
    }

    // ── Canvas 创建 ──
    this._resolveCanvas(options.target);

    this.ctx = this.canvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
    });

    if (!this.ctx)
    {
      throw new Error('[ba-click-fx] 无法获取 Canvas 2D 上下文');
    }

    this.trailCanvas = document.createElement('canvas');
    this.trailCtx = this.trailCanvas.getContext('2d', {
      alpha: true,
      desynchronized: true,
    });

    // ── 状态初始化 ──
    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    this.waves = [];
    this.sparks = [];
    this.trailStrokes = [];
    this.currentTrailStroke = null;

    this.wavePool = [];
    this.sparkPool = [];

    this.isDown = false;
    this.lastTrailPos = null;
    this.lastTrailEventTime = 0;
    this.trailSpeedFactor = 0;
    this.trailShardDistance = 0;

    this.trailSmoothX = null;
    this.trailSmoothY = null;

    this.lastTime = performance.now();
    this.running = false;
    this._resizeTimer = 0;
    this._renderPointCache = [];
    this._radialGradCache = new Map();

    // ── 启动 ──
    this._onResize = this._debouncedResize.bind(this);
    this._animationLoopBound = this._animationLoop.bind(this);
    window.addEventListener('resize', this._onResize);
    this._resizeCanvas();

    this._setupInput();
    this._requestRender();
  }

  // ═══════════════════════════════════════════════════════
  // Canvas 管理
  // ═══════════════════════════════════════════════════════

  _resolveCanvas(target)
  {
    if (target)
    {
      if (typeof target === 'string')
      {
        this.canvas = document.querySelector(target);
      }
      else if (target instanceof HTMLElement)
      {
        this.canvas = target;
      }

      if (!this.canvas)
      {
        throw new Error(`[ba-click-fx] 未找到目标元素: ${target}`);
      }

      if (this.canvas.tagName !== 'CANVAS')
      {
        throw new Error('[ba-click-fx] 目标元素必须是 <canvas>');
      }

      this._ownsCanvas = false;
      this.canvas.style.touchAction = this.config.touchAction;
      return;
    }

    // 尝试复用已有的 #sparkCanvas
    const existing = document.getElementById('sparkCanvas');

    if (existing && existing.tagName === 'CANVAS')
    {
      this.canvas = existing;
      this._ownsCanvas = false;
      this.canvas.style.touchAction = this.config.touchAction;
      return;
    }

    // 自动创建全屏 Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'sparkCanvas';
    this.canvas.style.cssText =
      `position:fixed;inset:0;z-index:999999;width:100vw;height:100vh;pointer-events:none;display:block;touch-action:${this.config.touchAction};`;

    const parent = document.body || document.documentElement;
    if (!parent)
    {
      throw new Error('[ba-click-fx] 无法挂载 Canvas：请在 DOM 加载完成后初始化');
    }
    parent.appendChild(this.canvas);
    this._ownsCanvas = true;
  }

  _resizeCanvas()
  {
    const rect = this.canvas.getBoundingClientRect();

    this.width = rect.width || window.innerWidth;
    this.height = rect.height || window.innerHeight;

    this.dpr = Math.min(window.devicePixelRatio || 1, this.config.maxDpr);

    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);

    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.trailCanvas.width = Math.floor(this.width * this.dpr * this.config.trailRenderScale);
    this.trailCanvas.height = Math.floor(this.height * this.dpr * this.config.trailRenderScale);

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.trailCtx.setTransform(
      this.dpr * this.config.trailRenderScale,
      0,
      0,
      this.dpr * this.config.trailRenderScale,
      0,
      0,
    );

    this._clearCanvas();
    this._clearTrailCanvas();
    this._requestRender();
  }

  _debouncedResize()
  {
    clearTimeout(this._resizeTimer);
    this._resizeTimer = setTimeout(() => this._resizeCanvas(), 150);
  }

  _clearCanvas()
  {
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  _clearTrailCanvas()
  {
    this.trailCtx.save();
    this.trailCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.trailCtx.clearRect(0, 0, this.trailCanvas.width, this.trailCanvas.height);
    this.trailCtx.restore();

    this.trailCtx.setTransform(
      this.dpr * this.config.trailRenderScale,
      0,
      0,
      this.dpr * this.config.trailRenderScale,
      0,
      0,
    );
  }

  _requestRender()
  {
    if (this.running)
    {
      return;
    }

    this.running = true;
    this.lastTime = performance.now();
    this._rafId = requestAnimationFrame(this._animationLoopBound);
  }

  // ═══════════════════════════════════════════════════════
  // 绘制方法
  // ═══════════════════════════════════════════════════════

  _drawCircle(context, x, y, r, color, alpha, blur = 0, useFakeGlow = true)
  {
    if (alpha <= 0 || r <= 0)
    {
      return;
    }

    context.save();

    if (useFakeGlow && this.config.glow.fake && blur > 0)
    {
      context.fillStyle = rgbToCss(color, alpha * 0.12);
      context.beginPath();
      context.arc(x, y, r + blur * 1.2, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = rgbToCss(color, alpha * 0.16);
      context.beginPath();
      context.arc(x, y, r + blur * 0.55, 0, Math.PI * 2);
      context.fill();
    }

    if (this.config.glow.enabled && blur > 0)
    {
      context.shadowColor = rgbToCss(color, alpha);
      context.shadowBlur = blur * 0.28;
    }

    context.fillStyle = rgbToCss(color, alpha);
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();

    context.restore();
  }

  _drawTriangle(context, x, y, size, rotation, color, alpha)
  {
    if (alpha <= 0)
    {
      return;
    }

    const drawEquilateralPath = (triangleSize) =>
    {
      const halfWidth = triangleSize * Math.sqrt(3) * 0.5;
      const baseY = triangleSize * 0.5;

      context.beginPath();
      context.moveTo(0, -triangleSize);
      context.lineTo(halfWidth, baseY);
      context.lineTo(-halfWidth, baseY);
      context.closePath();
    };

    context.save();
    context.translate(x, y);
    context.rotate(rotation);

    context.fillStyle = rgbToCss(color, alpha);
    drawEquilateralPath(size);
    context.fill();

    context.restore();
  }

  _drawRadialGlow(context, x, y, radius, color, alpha)
  {
    if (alpha <= 0 || radius <= 0)
    {
      return;
    }

    // 不缓存渐变对象：缓存的梯度中心可能与实际绘制位置有微小偏移，导致边缘出现异常圆环
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);

    gradient.addColorStop(0, rgbToCss(color, alpha * 0.68));
    gradient.addColorStop(0.2, rgbToCss(color, alpha * 0.48));
    gradient.addColorStop(0.52, rgbToCss(color, alpha * 0.2));
    gradient.addColorStop(0.82, rgbToCss(color, alpha * 0.055));
    gradient.addColorStop(1, rgbToCss(color, 0));

    context.save();
    context.globalCompositeOperation = 'lighter';
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  _drawClickDisk(context, x, y, radius, color, alpha)
  {
    if (alpha <= 0 || radius <= 0)
    {
      return;
    }

    context.save();
    context.fillStyle = rgbToCss(color, alpha);
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }

  _drawClickArcRibbon(
    context,
    x,
    y,
    radius,
    start,
    end,
    minWidth,
    maxWidth,
    color,
    alpha,
  )
  {
    const arcLength = Math.abs(end - start);

    if (
      alpha <= 0 ||
      radius <= 0 ||
      maxWidth <= 0 ||
      arcLength < 0.001
    )
    {
      return;
    }

    const steps = Math.max(10, Math.min(96, Math.ceil(arcLength / 0.07)));

    context.save();
    context.fillStyle = rgbToCss(color, alpha);
    context.beginPath();

    for (let i = 0; i <= steps; i++)
    {
      const t = i / steps;
      const angle = lerp(start, end, t);
      const widthT = smoothstep(0, 1, Math.sin(Math.PI * t));
      const widthValue = lerp(minWidth, maxWidth, widthT);
      const outerRadius = radius + widthValue * 0.5;
      const px = x + Math.cos(angle) * outerRadius;
      const py = y + Math.sin(angle) * outerRadius;

      if (i === 0)
      {
        context.moveTo(px, py);
      }
      else
      {
        context.lineTo(px, py);
      }
    }

    for (let i = steps; i >= 0; i--)
    {
      const t = i / steps;
      const angle = lerp(start, end, t);
      const widthT = smoothstep(0, 1, Math.sin(Math.PI * t));
      const widthValue = lerp(minWidth, maxWidth, widthT);
      const innerRadius = Math.max(0.1, radius - widthValue * 0.5);

      context.lineTo(
        x + Math.cos(angle) * innerRadius,
        y + Math.sin(angle) * innerRadius,
      );
    }

    context.closePath();
    context.fill();
    context.restore();
  }

  _drawClickRingGlow(context, x, y, radius, color, alpha)
  {
    if (alpha <= 0 || radius <= 0)
    {
      return;
    }

    if (!this.config.glow.clickFake && !this.config.glow.enabled)
    {
      return;
    }

    const cfg = this.config.rings;

    this._drawRadialGlow(
      context,
      x,
      y,
      radius + cfg.softGlowRadiusAdd * getClickScale(this.config),
      color,
      alpha * cfg.softGlowAlpha,
    );

    this._drawRadialGlow(
      context,
      x,
      y,
      radius + cfg.glowRadiusAdd * getClickScale(this.config),
      mixColor(color, [255, 255, 255], 0.38),
      alpha * cfg.glowAlpha,
    );
  }

  // ═══════════════════════════════════════════════════════
  // 对象池
  // ═══════════════════════════════════════════════════════

  _getWave(x, y)
  {
    const wave = this.wavePool.pop() ?? new ClickWave(this);

    wave.reset(x, y);
    return wave;
  }

  _releaseWave(wave)
  {
    wave.dead = true;

    if (this.wavePool.length < 64)
    {
      this.wavePool.push(wave);
    }
  }

  _getSpark(x, y, fromClick)
  {
    const spark = this.sparkPool.pop() ?? new SparkParticle(this);

    spark.reset(x, y, fromClick);
    return spark;
  }

  _releaseSpark(spark)
  {
    spark.dead = true;

    if (this.sparkPool.length < 256)
    {
      this.sparkPool.push(spark);
    }
  }

  // ═══════════════════════════════════════════════════════
  // 碎片生成
  // ═══════════════════════════════════════════════════════

  _tuneClickShard(spark, centerX, centerY)
  {
    const angle = Math.random() * Math.PI * 2;
    const tangentAngle = angle + Math.PI / 2;
    const ringRadius = this.config.filledCircle.rAddRate * getClickScale(this.config);
    const radialSpeed = rand(0.4, 0.7) * this.config.scale;
    const tangentSpeed = rand(-0.4, 0.4) * this.config.scale;
    // 偏向蓝色，保留轻微白色高亮以模拟 Additive 叠加
    const whiteMix = rand(0.3, 0.55);

    spark.x = centerX + Math.cos(angle) * ringRadius;
    spark.y = centerY + Math.sin(angle) * ringRadius;
    spark.vx =
      Math.cos(angle) * radialSpeed +
      Math.cos(tangentAngle) * tangentSpeed;
    spark.vy =
      Math.sin(angle) * radialSpeed +
      Math.sin(tangentAngle) * tangentSpeed;

    spark.delay = 1.5;
    spark.size = rand(5.2, 10.0) * this.config.scale;
    spark.alpha = rand(0.9, 1);
    spark.maxAlpha = spark.alpha;
    spark.alphaMul = rand(1.6, 2.0);
    spark.alphaDecay = rand(0.028, 0.044);
    spark.friction = rand(0.96, 0.985);
    // 游戏原始特效的碎片只有正上和正下两个朝向
    spark.rotation = Math.random() < 0.5 ? 0 : Math.PI;
    spark.rotationSpeed = 0;
    spark.color = mixColor(this.config.color, [255, 255, 255], whiteMix);
    spark.blur = rand(0.8, 2.2) * this.config.scale;
    spark.useFakeGlow = this.config.glow.clickFake;
    spark.flickerPeriod = this.config.click.shardFlickerPeriod;
    spark.flickerMinAlpha = this.config.click.shardFlickerMinAlpha;
    spark.flickerPhase = 0;
    spark.flickerSizePulse = 0.08;
    spark.sizeGrowEnd = rand(0.16, 0.28);
    spark.sizeShrinkStart = rand(0.62, 0.76);
    spark.spawnSizeMul = rand(0.02, 0.1);
    spark.endSizeMul = rand(0.18, 0.36);
  }

  _tuneTrailShard(spark, tangentAngle, normalAngle, speedFactor)
  {
    const cfg = this.config.trail;
    const isLarge = Math.random() < cfg.shardLargeChance;
    const scale = this.config.scale;
    // 速度方向：在轨迹外侧 ±90° 半圆内随机分布，模拟游戏原版碎片向外飘散
    const spreadAngle = rand(-Math.PI / 2, Math.PI / 2);
    const speed = rand(0.04, 0.32) * (0.65 + speedFactor * 0.5) * scale;
    const velAngle = normalAngle + spreadAngle;
    spark.vx = Math.cos(velAngle) * speed;
    spark.vy = Math.sin(velAngle) * speed;

    // 偏向蓝色，大碎片稍亮
    const whiteMix = isLarge ? rand(0.35, 0.6) : rand(0.2, 0.48);

    spark.size = (isLarge ? rand(7.4, 12.2) : rand(4.2, 6.4)) * scale;
    spark.alpha = isLarge ? rand(0.7, 1) : rand(0.55, 0.85);
    spark.maxAlpha = spark.alpha;
    spark.alphaMul = isLarge ? rand(1.6, 2.0) : rand(1.5, 1.8);
    // 120fps 基准 48 帧 ≈ 60fps 24 帧
    const lifetime = rand(20, 28);

    spark.alphaDecay = spark.alpha / lifetime;
    spark.friction = isLarge ? rand(0.978, 0.99) : rand(0.965, 0.982);
    // 游戏原始特效的轨迹碎片只有正上和正下两个朝向
    spark.rotation = Math.random() < 0.5 ? 0 : Math.PI;
    spark.rotationSpeed = 0;
    spark.color = mixColor(this.config.color, [255, 255, 255], whiteMix);
    spark.blur = (isLarge ? rand(0.7, 1.6) : rand(0.15, 0.65)) * scale;
    spark.useFakeGlow = true;
    spark.flickerPeriod = cfg.shardFlickerPeriod;
    spark.flickerMinAlpha = isLarge
      ? cfg.shardFlickerMinAlpha
      : Math.min(0.34, cfg.shardFlickerMinAlpha + 0.1);
    spark.flickerPhase = rand(0, cfg.shardFlickerPeriod);
    spark.flickerSizePulse = cfg.shardFlickerSizePulse;
    // 120fps 基准中增长 7 帧 ≈ 60fps 中 3.5 帧，峰值提前至 ~12%~18%
    const peak = rand(0.12, 0.18);
    spark.sizeGrowEnd = peak;
    spark.sizeShrinkStart = peak;
    spark.spawnSizeMul = isLarge ? rand(0.35, 0.55) : rand(0.25, 0.45);
    spark.endSizeMul = 0;
  }

  _spawnTrailShards(from, to, speedFactor)
  {
    const cfg = this.config.trail;
    const dist = distance(from, to);

    const baseSpacing =
      cfg.shardSpacing *
      this.config.scale *
      lerp(1.8, 0.8, clamp01(speedFactor));

    this.trailShardDistance += dist;
    const rawCount = Math.round(this.trailShardDistance / baseSpacing);
    const attempts = Math.min(6, rawCount);

    if (attempts <= 0)
    {
      return;
    }

    // 按实际 spawn 数量扣除累积距离，防止多 spawn 少扣的累积误差
    this.trailShardDistance -= attempts * baseSpacing;
    if (this.trailShardDistance < 0) { this.trailShardDistance = 0; }

    const extraChance = lerp(
      cfg.shardChanceSlow,
      cfg.shardChanceFast,
      clamp01(speedFactor),
    );
    const tangentAngle = Math.atan2(to.y - from.y, to.x - from.x);

    for (let i = 0; i < attempts; i++)
    {
      if (this.sparks.length >= cfg.maxSparkParticles)
      {
        return;
      }

      const spawnCount =
        Math.random() < extraChance && this.sparks.length < cfg.maxSparkParticles - 1
          ? 2
          : 1;

      for (let j = 0; j < spawnCount; j++)
      {
        const t = rand(0.16, 0.98);
        const side = Math.random() < 0.5 ? -1 : 1;
        const normalAngle =
          tangentAngle +
          side * Math.PI / 2 +
          rand(-0.24, 0.24);
        const offset =
          rand(cfg.shardOffsetMin, cfg.shardOffsetMax) *
          this.config.scale *
          (0.82 + speedFactor * 0.22);
        const tangentOffset = rand(-8, 10) * this.config.scale;
        const x =
          lerp(from.x, to.x, t) +
          Math.cos(normalAngle) * offset +
          Math.cos(tangentAngle) * tangentOffset;
        const y =
          lerp(from.y, to.y, t) +
          Math.sin(normalAngle) * offset +
          Math.sin(tangentAngle) * tangentOffset;
        const spark = this._getSpark(x, y, false);

        this._tuneTrailShard(spark, tangentAngle, normalAngle, speedFactor);
        this.sparks.push(spark);
      }
    }
  }

  _createClickEffect(x, y)
  {
    this.waves.push(this._getWave(x, y));

    for (let i = 0; i < this.config.sparksCount; i++)
    {
      const spark = this._getSpark(x, y, true);

      this._tuneClickShard(spark, x, y);
      this.sparks.push(spark);
    }

    this._requestRender();
  }

  // ═══════════════════════════════════════════════════════
  // 拖尾轨迹管理
  // ═══════════════════════════════════════════════════════

  _resetTrailInput()
  {
    this.lastTrailPos = null;
    this.lastTrailEventTime = 0;
    this.trailShardDistance = 0;
  }

  _endTrailStroke()
  {
    if (this.currentTrailStroke)
    {
      this.currentTrailStroke.released = true;
    }

    this.currentTrailStroke = null;
  }

  _resetTrailAll()
  {
    this._resetTrailInput();
    this._endTrailStroke();
    this.trailSpeedFactor = 0;
    this.trailStrokes.length = 0;
    this.trailSmoothX = null;
    this.trailSmoothY = null;
    this._clearTrailCanvas();
  }

  _updateTrailSpeed(from, to, eventTime)
  {
    const dist = distance(from, to);

    if (this.lastTrailEventTime <= 0)
    {
      this.lastTrailEventTime = eventTime;
      return 0;
    }

    const dt = Math.max(1, eventTime - this.lastTrailEventTime);
    const speed = dist / dt;
    const factor = clamp01(
      (speed - this.config.trail.speedMin) /
        (this.config.trail.speedMax - this.config.trail.speedMin),
    );

    this.trailSpeedFactor = Math.max(this.trailSpeedFactor, factor);
    this.lastTrailEventTime = eventTime;

    return factor;
  }

  _createTrailStroke(initialSpeedFactor = 0)
  {
    const stroke = [];

    stroke.speedFactor = clamp01(initialSpeedFactor);
    stroke.released = false;

    this.trailStrokes.push(stroke);
    this.currentTrailStroke = stroke;

    return stroke;
  }

  _beginTrailStroke(x, y, speedFactor = 0)
  {
    const stroke = this._createTrailStroke(speedFactor);

    this._addTrailPoint(x, y, speedFactor, stroke);
    return stroke;
  }

  _getTrailMaxLength(stroke = this.currentTrailStroke)
  {
    const speedFactor = stroke ? (stroke.speedFactor ?? 0) : this.trailSpeedFactor;

    return lerp(
      this.config.trail.lengthSlow,
      this.config.trail.lengthFast,
      clamp01(speedFactor),
    );
  }

  _getTotalTrailPointCount()
  {
    let count = 0;

    for (const stroke of this.trailStrokes)
    {
      count += stroke.length;
    }

    return count;
  }

  _trimOldestTrailPointsByCount()
  {
    let count = this._getTotalTrailPointCount();

    if (count > this.config.trail.maxPoints && this.trailStrokes.length > 0)
    {
      const oldest = this.trailStrokes[0];
      const excess = count - this.config.trail.maxPoints;

      if (oldest.length > 0)
      {
        const removeCount = Math.min(oldest.length, excess);

        oldest.splice(0, removeCount);
      }

      if (oldest.length === 0)
      {
        if (oldest === this.currentTrailStroke)
        {
          this.currentTrailStroke = null;
        }

        this.trailStrokes.shift();
      }
    }

    while (this.trailStrokes.length > 64)
    {
      const removed = this.trailStrokes.shift();

      if (removed === this.currentTrailStroke)
      {
        this.currentTrailStroke = null;
      }
    }
  }

  _trimTrailPoints(stroke = this.currentTrailStroke)
  {
    if (!stroke || stroke.length < 2)
    {
      return;
    }

    let totalLength = 0;

    for (let i = stroke.length - 1; i > 0; i--)
    {
      totalLength += distance(stroke[i], stroke[i - 1]);
    }

    const maxLength = this._getTrailMaxLength(stroke);
    let excessCount = 0;

    while (totalLength > maxLength && (excessCount + 1) < stroke.length - 7)
    {
      totalLength -= distance(stroke[excessCount], stroke[excessCount + 1]);
      excessCount++;
    }

    if (excessCount > 0)
    {
      stroke.splice(0, excessCount);
    }
  }

  _addTrailPoint(x, y, speedFactor = 0, stroke = this.currentTrailStroke, skipTrim = false)
  {
    const targetStroke = stroke || this._createTrailStroke(speedFactor);

    targetStroke.speedFactor = Math.max(
      targetStroke.speedFactor ?? 0,
      clamp01(speedFactor),
    );

    const life = lerp(
      this.config.trail.lifeSlow,
      this.config.trail.lifeFast,
      clamp01(speedFactor),
    );

    targetStroke.push({
      x,
      y,
      life,
      maxLife: life,
      speedFactor: clamp01(speedFactor),
      distanceFromTail: 0,
    });

    if (!skipTrim)
    {
      this._trimTrailPoints(targetStroke);
    }

    this._requestRender();
  }

  _addInterpolatedTrailPoints(from, to, speedFactor)
  {
    const dist = distance(from, to);

    if (dist < this.config.trail.minDistance)
    {
      return;
    }

    if (dist > this.config.trail.maxJumpDistance)
    {
      this._endTrailStroke();
      this._beginTrailStroke(to.x, to.y, speedFactor);
      this.lastTrailPos = to;
      return;
    }

    const stroke = this.currentTrailStroke || this._createTrailStroke(speedFactor);
    // 高速时动态扩大采样步长，降低点密度避免过载
    const speedAdjustedStep = this.config.trail.sampleStep *
      (1 + clamp01(speedFactor) * 2);
    const steps = Math.min(
      this.config.trail.maxInterpolatedPoints,
      Math.max(2, Math.ceil(dist / speedAdjustedStep)),
    );

    for (let i = 1; i <= steps; i++)
    {
      const t = i / steps;

      this._addTrailPoint(
        lerp(from.x, to.x, t),
        lerp(from.y, to.y, t),
        speedFactor,
        stroke,
        true,
      );
    }

    this._trimTrailPoints(stroke);
  }

  _updateTrailPoints(frameScale)
  {
    if (this.trailStrokes.length === 0)
    {
      return;
    }

    const aliveStrokes = [];

    for (const stroke of this.trailStrokes)
    {
      if (stroke.length === 0)
      {
        continue;
      }

      const isActiveStroke =
        stroke === this.currentTrailStroke &&
        !stroke.released &&
        (this.isDown || this.config.trail.always);

      const releaseMul = isActiveStroke ? 1 : this.config.trail.releaseDecayMul;

      for (let i = 0; i < stroke.length; i++)
      {
        const p = stroke[i];
        const indexFactor =
          stroke.length > 1 ? i / (stroke.length - 1) : 1;
        const decayMul = lerp(
          this.config.trail.tailDecayMul,
          this.config.trail.headDecayMul,
          indexFactor,
        );

        p.life -= frameScale * decayMul * releaseMul;
      }

      let deadCount = 0;

      while (deadCount < stroke.length && stroke[deadCount].life <= 0)
      {
        deadCount++;
      }

      if (deadCount > 0)
      {
        stroke.splice(0, deadCount);
      }

      stroke.speedFactor = clamp01(
        (stroke.speedFactor ?? 0) * Math.pow(this.config.trail.speedDecay, frameScale),
      );

      this._trimTrailPoints(stroke);

      if (stroke.length > 0)
      {
        aliveStrokes.push(stroke);
      }
      else if (stroke === this.currentTrailStroke)
      {
        this.currentTrailStroke = null;
      }
    }

    this.trailStrokes = aliveStrokes;

    if (this.currentTrailStroke && !this.trailStrokes.includes(this.currentTrailStroke))
    {
      this.currentTrailStroke = null;
    }

    this.trailSpeedFactor *= Math.pow(this.config.trail.speedDecay, frameScale);

    // 全局点数上限修剪，仅此一次避免 _trimTrailPoints 内的重复遍历
    this._trimOldestTrailPointsByCount();
  }

  // ═══════════════════════════════════════════════════════
  // 拖尾渲染
  // ═══════════════════════════════════════════════════════

  _buildTrailRenderPoints(points)
  {
    if (points.length < 2)
    {
      return points;
    }

    // 复用缓存数组避免每帧分配新对象
    const result = this._renderPointCache;
    let ri = 0;
    const maxR = this.config.trail.renderMaxPoints;

    for (let i = 0; i < points.length - 1; i++)
    {
      const p1 = points[i];
      const p2 = points[i + 1];
      const segLen = distance(p1, p2);
      const steps = Math.max(1, Math.ceil(segLen / this.config.trail.renderStep));

      for (let s = 0; s < steps; s++)
      {
        const t = s / steps;

        // 复用或创建缓存条目
        if (ri >= result.length)
        {
          result.push({ x: 0, y: 0, life: 0, maxLife: 0, speedFactor: 0, distanceFromTail: 0 });
        }
        const pt = result[ri];
        pt.x = lerp(p1.x, p2.x, t);
        pt.y = lerp(p1.y, p2.y, t);
        pt.life = lerp(p1.life, p2.life, t);
        pt.maxLife = lerp(p1.maxLife, p2.maxLife, t);
        pt.speedFactor = lerp(p1.speedFactor ?? 0, p2.speedFactor ?? 0, t);
        pt.distanceFromTail = 0;

        // 跳过与上一点距离过近的冗余点
        if (ri > 0)
        {
          const prev = result[ri - 1];
          if (Math.hypot(pt.x - prev.x, pt.y - prev.y) < 0.2)
          {
            continue;
          }
        }

        ri++;
      }
    }

    // 追加尾部最后一点
    const last = points[points.length - 1];
    if (ri >= result.length)
    {
      result.push({ x: 0, y: 0, life: 0, maxLife: 0, speedFactor: 0, distanceFromTail: 0 });
    }
    const tailPt = result[ri];
    tailPt.x = last.x;
    tailPt.y = last.y;
    tailPt.life = last.life;
    tailPt.maxLife = last.maxLife;
    tailPt.speedFactor = last.speedFactor ?? 0;
    tailPt.distanceFromTail = 0;

    if (ri === 0 || Math.hypot(tailPt.x - result[ri - 1].x, tailPt.y - result[ri - 1].y) >= 0.2)
    {
      ri++;
    }

    result.length = ri;

    if (result.length > maxR)
    {
      // 超出上限时移动数据到数组头部，避免 O(n) shift
      const keep = maxR;
      const offset = result.length - keep;
      for (let i = 0; i < keep; i++)
      {
        const src = result[offset + i];
        const dst = result[i];
        dst.x = src.x;
        dst.y = src.y;
        dst.life = src.life;
        dst.maxLife = src.maxLife;
        dst.speedFactor = src.speedFactor;
      }
      result.length = keep;
    }

    if (result.length === 0)
    {
      return points;
    }

    let total = 0;
    result[0].distanceFromTail = 0;

    for (let i = 1; i < result.length; i++)
    {
      total += distance(result[i - 1], result[i]);
      result[i].distanceFromTail = total;
    }

    result.totalLength = total;

    return result;
  }

  _strokeSegmentedTrailPath(context, points, options)
  {
    const {
      widthValue,
      stops,
      widthStops,
      minWidth = 0,
      maxChunks = 128,
    } = options;
    const totalLength =
      points.totalLength ??
      points[points.length - 1]?.distanceFromTail ??
      0;

    if (points.length < 2 || widthValue <= 0 || totalLength <= 0)
    {
      return;
    }

    // 分段间距取固定值和动态值中较大者：短拖尾保持细腻，长拖尾自动扩大间距
    const minChunk = Math.max(1, this.config.trail.gradientChunkLength ?? 1.5);
    const chunkLength = Math.max(minChunk, totalLength / maxChunks);

    let startIndex = 0;

    for (let i = 1; i < points.length; i++)
    {
      const currentLength =
        points[i].distanceFromTail - points[startIndex].distanceFromTail;
      const isLastPoint = i === points.length - 1;

      if (currentLength < chunkLength && !isLastPoint)
      {
        continue;
      }

      const midpointDistance =
        (points[startIndex].distanceFromTail + points[i].distanceFromTail) / 2;
      const progress = midpointDistance / totalLength;
      const alpha = getTrailStopValue(stops, progress);
      const widthScale = getTrailStopValue(widthStops, progress, 1);
      const lineWidth = Math.max(minWidth, widthValue * widthScale);

      if (alpha > 0 && lineWidth > 0 && i > startIndex)
      {
        context.strokeStyle = rgbToCss(options.color, alpha);
        context.lineWidth = lineWidth;
        context.lineCap = 'butt';
        context.lineJoin = 'round';

        context.beginPath();
        context.moveTo(points[startIndex].x, points[startIndex].y);

        for (let j = startIndex + 1; j <= i; j++)
        {
          context.lineTo(points[j].x, points[j].y);
        }

        context.stroke();
      }

      startIndex = i;
    }
  }

  _renderTrailStrokeToCanvas(stroke)
  {
    if (!stroke || stroke.length < 2)
    {
      return;
    }

    const renderPoints = this._buildTrailRenderPoints(stroke);

    if (renderPoints.length < 2)
    {
      return;
    }

    const trailColor = getTrailColor(this.config);
    const trailCoreColor = getTrailCoreColor(this.config);
    const trailHotColor = getTrailHotColor(this.config);
    const head = renderPoints[renderPoints.length - 1];
    const speedFactor = Math.max(head.speedFactor ?? 0, stroke.speedFactor ?? 0);

    const baseWidth = lerp(
      this.config.trail.baseWidthSlow,
      this.config.trail.baseWidthFast,
      speedFactor,
    ) * this.config.scale;

    const coreWidth = lerp(
      this.config.trail.coreWidthSlow,
      this.config.trail.coreWidthFast,
      speedFactor,
    ) * this.config.scale;

    const hotWidth = lerp(
      this.config.trail.hotWidthSlow,
      this.config.trail.hotWidthFast,
      speedFactor,
    ) * this.config.scale;

    const railWidth = lerp(
      this.config.trail.railWidthSlow,
      this.config.trail.railWidthFast,
      speedFactor,
    ) * this.config.scale;

    const headLifeRatio = head.maxLife > 0 ? clamp01(head.life / head.maxLife) : 1;
    const fadeMul = smoothstep(0.05, 0.45, headLifeRatio);
    const tf = this.config.trail.alpha * fadeMul;

    // 拖尾图层定义：按渲染顺序排列，condition 为 falsy 时跳过该层
    const layers = [
      // 1. 细暗轨道
      {
        widthValue: railWidth,
        minWidth: 0.08 * this.config.scale,
        color: this.config.color,
        widthStops: [[0.0, 0.38], [0.35, 0.52], [0.72, 0.72], [1.0, 0.52]],
        stops: [[0.0, this.config.trail.railAlpha * 0.16 * tf],
                [0.22, this.config.trail.railAlpha * 0.34 * tf],
                [0.62, this.config.trail.railAlpha * 0.58 * tf],
                [1.0, this.config.trail.railAlpha * 0.3 * tf]],
      },
      // 2. 柔和外光
      {
        condition: this.config.glow.fake,
        widthValue: baseWidth * this.config.trail.softGlowWidthMul,
        minWidth: baseWidth * 0.05,
        color: this.config.color,
        widthStops: [[0.0, 0.18], [0.42, 0.55], [0.78, 0.92], [1.0, 1.0]],
        stops: [[0.0, 0.0],
                [0.22, this.config.trail.softGlowAlpha * 0.18 * tf],
                [0.52, this.config.trail.softGlowAlpha * 0.58 * tf],
                [0.82, this.config.trail.softGlowAlpha * tf],
                [1.0, this.config.trail.softGlowAlpha * 0.72 * tf]],
      },
      // 2b. 蓝色发光
      {
        condition: this.config.glow.fake,
        widthValue: baseWidth * this.config.trail.glowWidthMul,
        minWidth: baseWidth * 0.04,
        color: trailColor,
        widthStops: [[0.0, 0.22], [0.38, 0.54], [0.76, 0.88], [1.0, 1.0]],
        stops: [[0.0, 0.0],
                [0.2, this.config.trail.glowAlpha * 0.16 * tf],
                [0.5, this.config.trail.glowAlpha * 0.48 * tf],
                [0.82, this.config.trail.glowAlpha * tf],
                [1.0, this.config.trail.glowAlpha * 0.82 * tf]],
      },
      // 3. 半透明 Ribbon 层
      {
        condition: this.config.trail.ribbonAlpha > 0 && this.config.trail.ribbonWidthMul > 0,
        widthValue: baseWidth * this.config.trail.ribbonWidthMul,
        minWidth: baseWidth * 0.05,
        color: trailColor,
        widthStops: [[0.0, 0.06], [0.26, 0.36], [0.56, 0.88], [0.86, 1.0], [1.0, 0.72]],
        stops: [[0.0, 0.0],
                [0.18, this.config.trail.ribbonAlpha * 0.08 * tf],
                [0.48, this.config.trail.ribbonAlpha * 0.36 * tf],
                [0.78, this.config.trail.ribbonAlpha * tf],
                [1.0, this.config.trail.ribbonAlpha * 0.52 * tf]],
      },
      // 4. 主蓝色轨迹
      {
        widthValue: baseWidth,
        minWidth: baseWidth * 0.14,
        color: trailColor,
        widthStops: [[0.0, 0.24], [0.28, 0.46], [0.58, 0.82], [0.86, 1.0], [1.0, 0.88]],
        stops: [[0.0, this.config.trail.mainAlpha * 0.04 * tf],
                [0.16, this.config.trail.mainAlpha * 0.14 * tf],
                [0.44, this.config.trail.mainAlpha * 0.48 * tf],
                [0.74, this.config.trail.mainAlpha * tf],
                [1.0, this.config.trail.mainAlpha * 0.86 * tf]],
      },
      // 5. 中心浅蓝高光
      {
        widthValue: coreWidth,
        minWidth: coreWidth * 0.12,
        color: trailCoreColor,
        widthStops: [[0.0, 0.16], [0.42, 0.42], [0.72, 0.9], [1.0, 0.75]],
        stops: [[0.0, 0.0],
                [0.34, this.config.trail.coreAlpha * 0.08 * tf],
                [0.58, this.config.trail.coreAlpha * 0.42 * tf],
                [0.86, this.config.trail.coreAlpha * tf],
                [1.0, this.config.trail.coreAlpha * 0.62 * tf]],
      },
      // 6. 蓝白高光
      {
        widthValue: hotWidth,
        minWidth: hotWidth * 0.1,
        color: trailHotColor,
        widthStops: [[0.0, 0.0], [0.52, 0.35], [0.78, 1.0], [1.0, 0.62]],
        stops: [[0.0, 0.0],
                [0.46, 0.0],
                [0.66, this.config.trail.hotAlpha * 0.28 * tf],
                [0.86, this.config.trail.hotAlpha * tf],
                [1.0, this.config.trail.hotAlpha * 0.48 * tf]],
      },
    ];

    for (const layer of layers)
    {
      if (layer.condition === false) { continue; }

      this._strokeSegmentedTrailPath(this.trailCtx, renderPoints, {
        widthValue: layer.widthValue,
        minWidth: layer.minWidth,
        color: layer.color,
        widthStops: layer.widthStops,
        stops: layer.stops,
      });
    }

    // 头部发光圆点
    const headRadius = lerp(1.1, 2.1, speedFactor) * this.config.scale;

    this._drawCircle(
      this.trailCtx,
      head.x,
      head.y,
      headRadius * 3.2,
      this.config.color,
      0.14 * this.config.trail.alpha * fadeMul,
      headRadius * 2.8,
    );

    this._drawCircle(
      this.trailCtx,
      head.x,
      head.y,
      headRadius * 1.9,
      trailColor,
      0.28 * this.config.trail.alpha * fadeMul,
      headRadius * 1.6,
    );

    this._drawCircle(
      this.trailCtx,
      head.x,
      head.y,
      headRadius * 0.62,
      trailHotColor,
      0.42 * this.config.trail.alpha * fadeMul,
      headRadius * 0.5,
    );
  }

  _renderTrailToCanvas()
  {
    this._clearTrailCanvas();

    if (!this.config.trail.enabled || this.trailStrokes.length === 0)
    {
      return;
    }

    this.trailCtx.save();
    this.trailCtx.globalCompositeOperation = 'lighter';

    for (const stroke of this.trailStrokes)
    {
      this._renderTrailStrokeToCanvas(stroke);
    }

    this.trailCtx.restore();
  }

  // ═══════════════════════════════════════════════════════
  // 动画循环
  // ═══════════════════════════════════════════════════════

  _updateWaves(context, frameScale)
  {
    for (let i = this.waves.length - 1; i >= 0; i--)
    {
      const wave = this.waves[i];

      wave.update(context, frameScale);

      if (wave.dead)
      {
        this.waves.splice(i, 1);
        this._releaseWave(wave);
      }
    }
  }

  _updateSparks(context, clickFrameScale, trailFrameScale)
  {
    for (let i = this.sparks.length - 1; i >= 0; i--)
    {
      const spark = this.sparks[i];
      const frameScale = spark.fromClick ? clickFrameScale : trailFrameScale;

      spark.update(context, frameScale);

      if (spark.dead)
      {
        this.sparks.splice(i, 1);
        this._releaseSpark(spark);
      }
    }
  }

  _hasActiveEffects()
  {
    return (
      this.waves.length > 0 ||
      this.sparks.length > 0 ||
      this.trailStrokes.length > 0 ||
      this.isDown
    );
  }

  _animationLoop(now)
  {
    const deltaMs = Math.min(now - this.lastTime, this.config.maxDeltaMs);

    this.lastTime = now;

    const baseFrameScale = deltaMs / this.config.baseFrameMs;
    const clickFrameScale = baseFrameScale * this.config.clickSpeed;
    const trailFrameScale = baseFrameScale * this.config.trailSpeed;

    this._clearCanvas();

    this._updateTrailPoints(trailFrameScale);
    this._renderTrailToCanvas();

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'lighter';

    this.ctx.drawImage(this.trailCanvas, 0, 0, this.width, this.height);

    this._updateWaves(this.ctx, clickFrameScale);
    this._updateSparks(this.ctx, clickFrameScale, trailFrameScale);

    this.ctx.restore();

    if (this._hasActiveEffects())
    {
      this._rafId = requestAnimationFrame(this._animationLoopBound);
    }
    else
    {
      this.running = false;
      this._clearCanvas();
      this._clearTrailCanvas();
    }
  }

  // ═══════════════════════════════════════════════════════
  // 输入处理
  // ═══════════════════════════════════════════════════════

  // 预分配平滑坐标对象，避免每帧创建新对象
  _smoothPosCache = { x: 0, y: 0 };

  _getPointerPos(event)
  {
    const rect = this.canvas.getBoundingClientRect();

    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  _handlePointerMove(event)
  {
    let events =
      typeof event.getCoalescedEvents === 'function'
        ? event.getCoalescedEvents()
        : [event];

    if (events.length === 0)
    {
      events = [event];
    }

    if (events.length > this.config.trail.maxCoalescedEvents)
    {
      const max = this.config.trail.maxCoalescedEvents;
      const sampled = [];

      for (let i = 0; i < max; i++)
      {
        const index = Math.round((events.length - 1) * (i / (max - 1)));

        sampled.push(events[index]);
      }

      events = sampled;
    }

    const shouldDrawTrail = this.config.trail.always || this.isDown;

    if (!shouldDrawTrail)
    {
      this._resetTrailInput();
      this._endTrailStroke();
      return;
    }

    let latestPos = null;
    let frameNewSteps = 0;
    const MAX_NEW_STEPS = 1024;

    for (const e of events)
    {
      // 本帧插值点数已接近上限，跳过剩余合并事件的轨迹插值
      const skipTrail = frameNewSteps >= MAX_NEW_STEPS;

      let pos = this._getPointerPos(e);

      latestPos = pos;

      const sf = this.config.trail.smoothFactor;

      if (sf > 0)
      {
        if (this.trailSmoothX == null)
        {
          this.trailSmoothX = pos.x;
          this.trailSmoothY = pos.y;
        }
        else
        {
          this.trailSmoothX = this.trailSmoothX * sf + pos.x * (1 - sf);
          this.trailSmoothY = this.trailSmoothY * sf + pos.y * (1 - sf);
        }

        this._smoothPosCache.x = this.trailSmoothX;
        this._smoothPosCache.y = this.trailSmoothY;
        pos = this._smoothPosCache;
      }

      if (!this.lastTrailPos)
      {
        this.lastTrailPos = { x: pos.x, y: pos.y };
        this.lastTrailEventTime = e.timeStamp || performance.now();

        if (!this.currentTrailStroke)
        {
          this._beginTrailStroke(pos.x, pos.y, this.trailSpeedFactor);
        }

        latestPos = pos;
        continue;
      }

      const eventTime = e.timeStamp || performance.now();
      const speedFactor = this._updateTrailSpeed(this.lastTrailPos, pos, eventTime);

      const estDist = distance(this.lastTrailPos, pos);
      const speedStep = this.config.trail.sampleStep * (1 + clamp01(speedFactor) * 2);
      frameNewSteps += Math.ceil(estDist / speedStep);

      if (!skipTrail)
      {
        this._addInterpolatedTrailPoints(this.lastTrailPos, pos, speedFactor);
      }

      // 碎片轻量，不受帧上限限制，始终正常累积距离
      this._spawnTrailShards(this.lastTrailPos, pos, speedFactor);

      this.lastTrailPos = { x: pos.x, y: pos.y };
    }

    if (latestPos && Math.random() < this.config.trail.moveSparkChance)
    {
      const angle = Math.random() * Math.PI * 2;
      const offset = rand(5, 22) * this.config.scale;
      const spark = this._getSpark(
        latestPos.x + Math.cos(angle) * offset,
        latestPos.y + Math.sin(angle) * offset,
        false,
      );

      this._tuneTrailShard(spark, angle, angle, this.trailSpeedFactor);
      this.sparks.push(spark);
    }

    this._requestRender();
  }

  _setupInput()
  {
    this._onPointerDown = (event) =>
    {
      this.isDown = true;

      const pos = this._getPointerPos(event);

      this.trailSmoothX = null;
      this.trailSmoothY = null;

      this.lastTrailPos = pos;
      this.lastTrailEventTime = event.timeStamp || performance.now();
      this.trailSpeedFactor = Math.max(this.trailSpeedFactor, 0.15);

      this._endTrailStroke();
      this._beginTrailStroke(pos.x, pos.y, this.trailSpeedFactor);

      if (this.config.clickEnabled)
      {
        this._createClickEffect(pos.x, pos.y);
      }
    };

    this._onPointerMove = this._handlePointerMove.bind(this);

    this._onPointerUp = () =>
    {
      this.isDown = false;
      this._resetTrailInput();
      this._endTrailStroke();
      this._requestRender();
    };

    this._onBlur = () =>
    {
      this.isDown = false;
      this._resetTrailInput();
      this._endTrailStroke();
      this._requestRender();
    };

    window.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove, { passive: true });
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    window.addEventListener('blur', this._onBlur);
  }

  _teardownInput()
  {
    window.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    window.removeEventListener('blur', this._onBlur);
  }

  // ══════════════════════════════════════════════════════════════════════
  // 公开 API
  // ══════════════════════════════════════════════════════════════════════

  /**
   * 销毁实例：移除 Canvas、事件监听、停止动画。
   * 调用后实例不可再用。
   */
  destroy()
  {
    window.removeEventListener('resize', this._onResize);
    this._teardownInput();

    clearTimeout(this._resizeTimer);
    this.running = false;

    if (this._rafId != null)
    {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    if (this._ownsCanvas && this.canvas.parentNode)
    {
      this.canvas.parentNode.removeChild(this.canvas);
    }
  }

  /** @param {number} r @param {number} g @param {number} b */
  setColor(r, g, b)
  {
    this.config.color = [r, g, b];
    this._requestRender();
  }

  /** @param {number} scale */
  setScale(scale)
  {
    this.config.scale = Math.max(0.5, Math.min(3, Number(scale) ?? 1.10));
    this._requestRender();
  }

  /** @param {number} opacity */
  setOpacity(opacity)
  {
    this.config.opacity = Math.max(0.1, Math.min(1, Number(opacity) ?? 0.5));
    this._requestRender();
  }

  /** @param {number} clickSpeed @param {number} [trailSpeed=clickSpeed] */
  setSpeed(clickSpeed, trailSpeed = clickSpeed)
  {
    this.config.clickSpeed = Math.max(0.2, Math.min(3, Number(clickSpeed) ?? 1));
    this.config.trailSpeed = Math.max(0.2, Math.min(3, Number(trailSpeed) ?? 1));
    this._requestRender();
  }

  /** @param {number} maxDpr */
  setDpr(maxDpr)
  {
    this.config.maxDpr = Math.max(1, Math.min(2, Number(maxDpr) ?? 1));
    this._resizeCanvas();
  }

  /** @param {number} value */
  setTrailRenderScale(value)
  {
    this.config.trailRenderScale = Math.max(0.5, Math.min(1, Number(value) ?? 1));
    this._resizeCanvas();
  }

  /**
   * 设置 Canvas touch-action CSS 属性。
   * 'auto' — 页面滚动正常，拖尾会被中断（默认）
   * 'none' — 拖尾完整，禁止页面滚动
   * @param {'auto'|'none'|'pan-y'|'pan-x'|'manipulation'} value
   */
  setTouchAction(value = 'auto')
  {
    this.config.touchAction = value;
    this.canvas.style.touchAction = value;
    this._requestRender();
  }

  /** @param {boolean} enabled */
  setGlow(enabled)
  {
    this.config.glow.enabled = Boolean(enabled);
    this._requestRender();
  }

  /** @param {boolean} enabled */
  setFakeGlow(enabled)
  {
    this.config.glow.fake = Boolean(enabled);
    this._requestRender();
  }

  /** @param {boolean} enabled */
  setClickFakeGlow(enabled)
  {
    this.config.glow.clickFake = Boolean(enabled);
    this._requestRender();
  }

  /** @param {number} value */
  setRingRotationSpeed(value = 0.008)
  {
    this.config.rings.rotationSpeed = Math.max(0, Math.min(0.05, Number(value) ?? 0.008));
    this._requestRender();
  }

  /** @param {number} value */
  setRingGlow(value = 0.35)
  {
    this.config.rings.emissionAlpha = Math.max(0, Math.min(1, Number(value) ?? 0.35));
    this._requestRender();
  }

  /** @param {number} value */
  setRingWidth(value = 0.9)
  {
    this.config.rings.minW = Math.max(0.3, Math.min(3, Number(value) ?? 0.9));
    this._requestRender();
  }

  /** @param {number} value */
  setRingAlpha(value = 0.9)
  {
    this.config.rings.alpha = Math.max(0.1, Math.min(1, Number(value) ?? 0.9));
    this._requestRender();
  }

  /** @param {number} value 圆环颜色中白色的混合比例 (0~1) */
  setRingWhiteMix(value = 0.75)
  {
    this.config.rings.whiteMix = Math.max(0, Math.min(1, Number(value) ?? 0.75));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailBrightness(value = 0.96)
  {
    this.config.trail.alpha = Math.max(0.1, Math.min(1, Number(value) ?? 0.96));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailWhiteMix(value = 0.08)
  {
    this.config.trail.whiteMix = Math.max(0, Math.min(1, Number(value) ?? 0.08));
    this._requestRender();
  }

  /** @param {boolean} enabled */
  setTrail(enabled)
  {
    this.config.trail.enabled = Boolean(enabled);
    this._requestRender();
  }

  /** @param {boolean} enabled */
  setClick(enabled)
  {
    this.config.clickEnabled = Boolean(enabled);
    this._requestRender();
  }

  /** @param {boolean} enabled */
  setTrailAlways(enabled)
  {
    this.config.trail.always = Boolean(enabled);
    this._resetTrailInput();
    this._endTrailStroke();
    this._requestRender();
  }

  /** @param {number} baseFast @param {number} [baseSlow] */
  setTrailWidth(baseFast = 3, baseSlow = 3)
  {
    this.config.trail.baseWidthFast = Math.max(0.5, Math.min(6, Number(baseFast) ?? 3));
    this.config.trail.baseWidthSlow = Math.max(0.3, Math.min(this.config.trail.baseWidthFast, Number(baseSlow) ?? 3));
    this._requestRender();
  }

  /** @param {number} lengthSlow @param {number} [lengthFast] */
  setTrailLength(lengthSlow = 900, lengthFast = 4200)
  {
    this.config.trail.lengthSlow = Math.max(20, Math.min(5000, Number(lengthSlow) ?? 900));
    this.config.trail.lengthFast = Math.max(this.config.trail.lengthSlow + 20, Math.min(8000, Number(lengthFast) ?? 4200));
    this._requestRender();
  }

  /** @param {number} lifeSlow @param {number} [lifeFast] */
  setTrailLife(lifeSlow = 22, lifeFast = 22)
  {
    this.config.trail.lifeSlow = Math.max(5, Math.min(400, Number(lifeSlow) ?? 22));
    this.config.trail.lifeFast = Math.max(this.config.trail.lifeSlow, Math.min(600, Number(lifeFast) ?? 22));
    this._requestRender();
  }

  /** @param {number} tailDecayMul @param {number} headDecayMul @param {number} releaseDecayMul */
  setTrailDecay(tailDecayMul = 1.28, headDecayMul = 0.95, releaseDecayMul = 1.18)
  {
    this.config.trail.tailDecayMul = Math.max(0.1, Math.min(5, Number(tailDecayMul) ?? 1.28));
    this.config.trail.headDecayMul = Math.max(0.1, Math.min(this.config.trail.tailDecayMul, Number(headDecayMul) ?? 0.95));
    this.config.trail.releaseDecayMul = Math.max(0.5, Math.min(12, Number(releaseDecayMul) ?? 1.18));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailSpeedDecay(value = 0.988)
  {
    this.config.trail.speedDecay = Math.max(0.8, Math.min(0.999, Number(value) ?? 0.988));
    this._requestRender();
  }

  /** @param {number} speedMin @param {number} speedMax */
  setTrailSpeedRange(speedMin = 0.035, speedMax = 2.2)
  {
    this.config.trail.speedMin = Math.max(0, Number(speedMin) ?? 0.035);
    this.config.trail.speedMax = Math.max(this.config.trail.speedMin + 0.1, Number(speedMax) ?? 2.2);
    this._requestRender();
  }

  /** @param {number} sampleStep @param {number} maxInterpolatedPoints */
  setTrailSampling(sampleStep = 0.85, maxInterpolatedPoints = 80)
  {
    this.config.trail.sampleStep = Math.max(0.3, Math.min(12, Number(sampleStep) ?? 0.85));
    this.config.trail.maxInterpolatedPoints = Math.max(2, Math.min(160, Number(maxInterpolatedPoints) ?? 80));
    this._requestRender();
  }

  /** @param {number} renderStep @param {number} renderMaxPoints */
  setTrailRenderSampling(renderStep = 0.75, renderMaxPoints = 2400)
  {
    this.config.trail.renderStep = Math.max(0.3, Math.min(8, Number(renderStep) ?? 0.75));
    this.config.trail.renderMaxPoints = Math.max(60, Math.min(3600, Number(renderMaxPoints) ?? 2400));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailSmooth(value = 0.5)
  {
    this.config.trail.smoothFactor = Math.max(0, Math.min(0.9, Number(value) ?? 0.5));
    this.trailSmoothX = null;
    this.trailSmoothY = null;
    this._requestRender();
  }

  /** @param {number} main @param {number} core @param {number} hot @param {number} glow @param {number} softGlow @param {number} rail */
  setTrailLayerAlpha(main = 1, core = 0.78, hot = 0.34, glow = 0.18, softGlow = 0.045, rail = 0.02)
  {
    this.config.trail.mainAlpha = Math.max(0, Math.min(1, Number(main) ?? 1));
    this.config.trail.coreAlpha = Math.max(0, Math.min(1, Number(core) ?? 0.78));
    this.config.trail.hotAlpha = Math.max(0, Math.min(1, Number(hot) ?? 0.34));
    this.config.trail.glowAlpha = Math.max(0, Math.min(1, Number(glow) ?? 0.18));
    this.config.trail.softGlowAlpha = Math.max(0, Math.min(0.5, Number(softGlow) ?? 0.045));
    this.config.trail.railAlpha = Math.max(0, Math.min(1, Number(rail) ?? 0.02));
    this._requestRender();
  }

  /** @param {number} value */
  setMoveSparkChance(value = 0)
  {
    this.config.trail.moveSparkChance = Math.max(0, Math.min(0.05, Number(value) ?? 0));
  }

  /** @param {number} value */
  setShardSpacing(value = 220)
  {
    this.config.trail.shardSpacing = Math.max(20, Math.min(500, Number(value) ?? 220));
    this._requestRender();
  }

  /** @param {number} slow @param {number} fast */
  setShardChance(slow = 0.04, fast = 0.18)
  {
    this.config.trail.shardChanceSlow = Math.max(0, Math.min(1, Number(slow) ?? 0.04));
    this.config.trail.shardChanceFast = Math.max(this.config.trail.shardChanceSlow, Math.min(1, Number(fast) ?? 0.18));
    this._requestRender();
  }

  /** @param {number} value */
  setShardLargeChance(value = 0.62)
  {
    this.config.trail.shardLargeChance = Math.max(0, Math.min(1, Number(value) ?? 0.62));
    this._requestRender();
  }

  /** @param {number} value */
  setMaxShards(value = 38)
  {
    this.config.trail.maxSparkParticles = Math.max(0, Math.min(200, Number(value) ?? 38));
    this._requestRender();
  }

  /** @param {number} value */
  setSparksCount(value = 4)
  {
    this.config.sparksCount = Math.max(0, Math.min(12, Number(value) ?? 4));
    this._requestRender();
  }

  /** @param {number} value */
  setClickTotalLife(value = 27)
  {
    this.config.click.totalLife = Math.max(10, Math.min(60, Number(value) ?? 27));
    this._requestRender();
  }

  /** @param {number} value */
  setClickScaleMul(value = 1.3)
  {
    this.config.click.scaleMul = Math.max(0.5, Math.min(3, Number(value) ?? 1.3));
    this._requestRender();
  }

  /** @param {number} value */
  setClickHaloRadius(value = 96)
  {
    this.config.click.haloRadius = Math.max(30, Math.min(200, Number(value) ?? 96));
    this._requestRender();
  }

  /** @param {number} value */
  setRingDelay(value = 2)
  {
    this.config.rings.delay = Math.max(0, Math.min(10, Number(value) ?? 2));
    this._requestRender();
  }

  /** @param {number} value */
  setRingMaxLife(value = 27)
  {
    this.config.rings.maxLife = Math.max(10, Math.min(60, Number(value) ?? 27));
    this._requestRender();
  }

  /** @param {number} value */
  setRingBaseRadiusMul(value = 0.47)
  {
    this.config.rings.baseRadiusMul = Math.max(0.2, Math.min(1, Number(value) ?? 0.47));
    this._requestRender();
  }

  /** @param {number} value */
  setRingRadiusGrowEnd(value = 0.66)
  {
    this.config.rings.radiusGrowEnd = Math.max(0.2, Math.min(1, Number(value) ?? 0.66));
    this._requestRender();
  }

  /** @param {number} value */
  setRingPostDiskGrow(value = 24)
  {
    this.config.rings.postDiskGrow = Math.max(5, Math.min(60, Number(value) ?? 24));
    this._requestRender();
  }

  /** @param {number} value */
  setRingGlowRadiusAdd(value = 54)
  {
    this.config.rings.glowRadiusAdd = Math.max(10, Math.min(150, Number(value) ?? 54));
    this._requestRender();
  }

  /** @param {number} value */
  setRingSoftGlowRadiusAdd(value = 96)
  {
    this.config.rings.softGlowRadiusAdd = Math.max(20, Math.min(200, Number(value) ?? 96));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailMainAlpha(value = 1)
  {
    this.config.trail.mainAlpha = Math.max(0, Math.min(1, Number(value) ?? 1));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailCoreAlpha(value = 0.78)
  {
    this.config.trail.coreAlpha = Math.max(0, Math.min(1, Number(value) ?? 0.78));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailHotAlpha(value = 0.34)
  {
    this.config.trail.hotAlpha = Math.max(0, Math.min(1, Number(value) ?? 0.34));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailGlowAlpha(value = 0.18)
  {
    this.config.trail.glowAlpha = Math.max(0, Math.min(1, Number(value) ?? 0.18));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailSoftGlowAlpha(value = 0.045)
  {
    this.config.trail.softGlowAlpha = Math.max(0, Math.min(0.5, Number(value) ?? 0.045));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailRailAlpha(value = 0.02)
  {
    this.config.trail.railAlpha = Math.max(0, Math.min(1, Number(value) ?? 0.02));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailGlowWidthMul(value = 1.7)
  {
    this.config.trail.glowWidthMul = Math.max(0.3, Math.min(8, Number(value) ?? 1.7));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailSoftGlowWidthMul(value = 2.4)
  {
    this.config.trail.softGlowWidthMul = Math.max(0.5, Math.min(15, Number(value) ?? 2.4));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailTailDecayMul(value = 1.28)
  {
    this.config.trail.tailDecayMul = Math.max(0.1, Math.min(5, Number(value) ?? 1.28));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailHeadDecayMul(value = 0.95)
  {
    this.config.trail.headDecayMul = Math.max(0.1, Math.min(5, Number(value) ?? 0.95));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailReleaseDecayMul(value = 1.18)
  {
    this.config.trail.releaseDecayMul = Math.max(0.5, Math.min(12, Number(value) ?? 1.18));
    this._requestRender();
  }

  /** @param {number} value */
  setTrailSpeedMin(value = 0.035)
  {
    this.config.trail.speedMin = Math.max(0.005, Math.min(0.5, Number(value) ?? 0.035));
    // 确保 speedMin < speedMax，防止 _updateTrailSpeed 除零
    if (this.config.trail.speedMin >= this.config.trail.speedMax)
    {
      this.config.trail.speedMax = this.config.trail.speedMin + 0.005;
    }

    this._requestRender();
  }

  /** @param {number} value */
  setTrailSpeedMax(value = 2.2)
  {
    this.config.trail.speedMax = Math.max(0.5, Math.min(5, Number(value) ?? 2.2));
    // 确保 speedMax > speedMin，防止 _updateTrailSpeed 除零
    if (this.config.trail.speedMax <= this.config.trail.speedMin)
    {
      this.config.trail.speedMin = this.config.trail.speedMax - 0.005;
    }

    this._requestRender();
  }

  /** 清除所有拖尾轨迹 */
  clearTrail()
  {
    this._resetTrailAll();
    this._requestRender();
  }

  /**
   * 手动触发点击特效
   * @param {number} [x=window.innerWidth/2]
   * @param {number} [y=window.innerHeight/2]
   */
  boom(x = window.innerWidth / 2, y = window.innerHeight / 2)
  {
    if (this.config.clickEnabled)
    {
      this._createClickEffect(x, y);
    }
  }

  /** @returns {object} 当前配置的深拷贝 */
  getConfig()
  {
    return cloneConfig(this.config);
  }

  /** 恢复所有配置为默认值 */
  resetConfig()
  {
    this.config = createConfig();
    this._resizeCanvas();
    this._requestRender();
  }

  /** 直接引用当前实例配置对象（只读推荐） */
  get CONFIG()
  {
    return this.config;
  }
}


export default BAClickFX;
