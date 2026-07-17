/**
 * ba-click-fx — Blue Archive 的 UI/FX_Touch 浏览器移植。
 *
 * 这不是“相似风格”参数化引擎。实现直接复刻 Unity 中 FXTouch、
 * ParticleSystem 和 TrailRenderer 的生命周期，只保留宿主接入所需的最小 API。
 */

import { CONFIG, UNITY_FX_TOUCH, createConfig } from './config.js';

const TAU = Math.PI * 2;
const DEFAULT_FRAME_MS = 1000 / 60;

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
  const red = Math.round(clamp(color[0], 0, 255));
  const green = Math.round(clamp(color[1], 0, 255));
  const blue = Math.round(clamp(color[2], 0, 255));

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

function drawDissolvedCircle(context, ring, progress, scale, opacity)
{
  const config = UNITY_FX_TOUCH.rings;
  const radius = ring.radius * evaluateNumber(config.sizeKeys, progress) * scale;
  const width = lerp(config.widthStart, config.widthEnd, progress) * scale;
  const threshold = evaluateNumber(config.dissolveKeys, progress);
  const visibleRatio = 1 - threshold;
  const color = evaluateColor(config.colorKeys, progress);
  const arcLength = TAU * visibleRatio;

  if (arcLength <= 0.001)
  {
    return;
  }

  const steps = Math.max(
    6,
    Math.ceil(config.arcSamples * visibleRatio),
  );
  const shouldTaper = visibleRatio < 0.995;

  context.save();
  context.translate(ring.x, ring.y);
  context.rotate(ring.rotation);
  context.beginPath();

  // 外沿和内沿组成一条连续弧带。溶解只移动两个端点，不再对每个角度
  // 独立阈值化，因此不会把一枚 MeshTri 切成许多短弧。
  for (let index = 0; index <= steps; index++)
  {
    const localProgress = index / steps;
    const angle = -arcLength * localProgress;
    const taper = shouldTaper
      ? smoothstep(0, config.taperRatio, localProgress) *
        smoothstep(0, config.taperRatio, 1 - localProgress)
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
    const angle = -arcLength * localProgress;
    const taper = shouldTaper
      ? smoothstep(0, config.taperRatio, localProgress) *
        smoothstep(0, config.taperRatio, 1 - localProgress)
      : 1;
    const innerRadius = Math.max(0, radius - width * 0.5 * taper);

    context.lineTo(
      Math.cos(angle) * innerRadius,
      Math.sin(angle) * innerRadius,
    );
  }

  context.closePath();
  context.fillStyle = colorToCss(color, opacity);
  context.shadowColor = colorToCss(color, opacity * UNITY_FX_TOUCH.bloom.ringAlpha);
  context.shadowBlur = UNITY_FX_TOUCH.bloom.ringBlur * scale;
  context.fill();
  context.restore();
}

function drawDisk(context, wave, progress, scale, opacity)
{
  const config = UNITY_FX_TOUCH.disk;
  const radius = config.radius * evaluateNumber(config.sizeKeys, progress) * scale;
  const color = evaluateColor(config.colorKeys, progress);
  const alpha = evaluateNumber(config.alphaKeys, progress) * opacity;
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
  context.shadowColor = colorToCss(color, alpha * 0.32);
  context.shadowBlur = UNITY_FX_TOUCH.bloom.diskBlur * scale;
  context.fill();
  context.restore();
}

function drawTriangle(context, particle, scale, opacity)
{
  const config = UNITY_FX_TOUCH.shards;
  const progress = clamp01(particle.ageMs / particle.lifetimeMs);
  const size = particle.size * evaluateNumber(config.sizeKeys, progress) * scale;
  const alpha = evaluateNumber(config.alphaKeys, progress) * opacity;
  const color = evaluateColor(config.colorKeys, progress);

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
  context.shadowBlur = UNITY_FX_TOUCH.bloom.shardBlur * scale;
  context.fill();
  context.restore();
}

class ClickWave
{
  constructor(x, y)
  {
    this.x = x;
    this.y = y;
    this.ageMs = 0;
    this.rings = [];

    for (let index = 0; index < UNITY_FX_TOUCH.rings.count; index++)
    {
      this.rings.push(
        {
          x,
          y,
          radius: random(
            UNITY_FX_TOUCH.rings.radiusMin,
            UNITY_FX_TOUCH.rings.radiusMax,
          ),
          rotation: random(0, TAU),
          angularVelocity:
            random(
              UNITY_FX_TOUCH.rings.angularVelocityMin,
              UNITY_FX_TOUCH.rings.angularVelocityMax,
            ) * UNITY_FX_TOUCH.rings.rotationDirection,
        },
      );
    }
  }

  update(deltaMs)
  {
    this.ageMs += deltaMs;

    for (const ring of this.rings)
    {
      ring.rotation += ring.angularVelocity * (deltaMs / 1000);
    }
  }

  draw(context, scale, opacity)
  {
    const diskProgress = this.ageMs / UNITY_FX_TOUCH.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      drawDisk(context, this, diskProgress, scale, opacity);
    }

    const ringProgress = this.ageMs / UNITY_FX_TOUCH.rings.lifetimeMs;

    if (ringProgress < 1)
    {
      for (const ring of this.rings)
      {
        drawDissolvedCircle(context, ring, ringProgress, scale, opacity);
      }
    }
  }

  get dead()
  {
    return this.ageMs >= UNITY_FX_TOUCH.rings.lifetimeMs;
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

  draw(context, scale, opacity)
  {
    drawTriangle(context, this, scale, opacity);
  }

  get dead()
  {
    return this.ageMs >= this.lifetimeMs;
  }
}

function createShard(x, y, originAngle, kind, scale)
{
  const config = UNITY_FX_TOUCH.shards;
  const isClick = kind === 'click';
  const radius = (isClick ? config.clickRadius : config.trailRadius) * scale;
  const speed = (isClick
    ? random(config.clickSpeedMin, config.clickSpeedMax)
    : random(config.trailSpeedMin, config.trailSpeedMax)) * scale;
  const lifetimeMs = isClick
    ? random(config.clickLifetimeMinMs, config.clickLifetimeMaxMs)
    : random(config.trailLifetimeMinMs, config.trailLifetimeMaxMs);

  return new ShardParticle(
    {
      kind,
      x: x + Math.cos(originAngle) * radius,
      y: y + Math.sin(originAngle) * radius,
      velocityX: Math.cos(originAngle) * speed,
      velocityY: Math.sin(originAngle) * speed,
      // TextureSheetAnimation 在 FX_TEX_Triangle_02_1 的两格中随机选一格，
      // 原游戏因此只有朝上/朝下两种贴图方向，位置与速度仍由圆形 Shape 随机。
      rotation: Math.random() < 0.5 ? 0 : Math.PI,
      lifetimeMs,
      size: random(config.sizeMin, config.sizeMax),
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

function interpolateTrailColor(progress)
{
  return evaluateColor(UNITY_FX_TOUCH.trail.gradient, progress);
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

    context.beginPath();
    context.moveTo(points[index - 1].x, points[index - 1].y);
    context.lineTo(points[index].x, points[index].y);
    context.strokeStyle = colorToCss(color, layer.alpha * opacity);
    context.stroke();
  }

  context.restore();
}

function drawTrail(context, points, scale, opacity)
{
  const config = UNITY_FX_TOUCH.trail;

  // 原材质为 Additive 高强度纹理；Canvas 只需一层窄光和两层线芯即可逼近，
  // 不能再叠加旧实现的大半径径向光，否则视觉宽度会明显超过游戏。
  drawTrailLayer(context, points, scale, opacity,
    {
      width: config.outerGlowWidth,
      alpha: UNITY_FX_TOUCH.bloom.trailAlpha,
      color: [0, 88, 224],
    });
  drawTrailLayer(context, points, scale, opacity,
    {
      width: config.width,
      alpha: 1,
    });
  drawTrailLayer(context, points, scale, opacity,
    {
      width: config.coreWidth,
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
    return this.config.scale * (this.height / UNITY_FX_TOUCH.referenceHeight);
  }

  _acceptPointerDown(event)
  {
    if (event.pointerType === 'mouse' && event.button !== 0)
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
    if (this.activePointerId !== null)
    {
      return;
    }

    const position = this._getPointerPosition(event);
    const pointerId = event.pointerId ?? 1;

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
    if (
      this.destroyed ||
      this.activePointerId === null ||
      (event.pointerId ?? 1) !== this.activePointerId ||
      !this.config.trailEnabled
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
      UNITY_FX_TOUCH.trail.minVertexDistance * scale,
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
    const spacing = Math.max(1, UNITY_FX_TOUCH.shards.trailSpacing * scale);
    let nextDistance = spacing - this.trailDistanceSinceShard;
    let spawned = 0;

    while (nextDistance <= segmentLength && spawned < 32)
    {
      const progress = segmentLength > 0 ? nextDistance / segmentLength : 0;
      const x = lerp(from.x, to.x, progress);
      const y = lerp(from.y, to.y, progress);
      const angle = random(0, TAU);

      if (this.shards.length < UNITY_FX_TOUCH.shards.maxCount)
      {
        this.shards.push(createShard(x, y, angle, 'trail', scale));
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

    this.waves.push(new ClickWave(x, y));

    for (let index = 0; index < UNITY_FX_TOUCH.shards.clickCount; index++)
    {
      this.shards.push(createShard(x, y, random(0, TAU), 'click', scale));
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
    const lifetime = UNITY_FX_TOUCH.trail.lifetimeMs;

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
        drawTrail(this.context, stroke.points, scale, this.config.opacity);
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
      wave.draw(this.context, scale, this.config.opacity);

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
      shard.draw(this.context, scale, this.config.opacity);

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

export { CONFIG, UNITY_FX_TOUCH, createConfig };

export default BAClickFX;
