import './style.css';
import { clamp01, rand, easeOutCubic, smoothstep, distance, lerp, rgbToCss, mixColor, getArcWeight } from './utils.js';
import { CONFIG, getClickScale, getClickRingEndColor, getTrailColor, getTrailCoreColor, getTrailHotColor } from './config.js';

const canvas = document.getElementById('sparkCanvas');

if (!canvas)
{
  throw new Error('[ba-click-fx] 找不到 #sparkCanvas 元素');
}

const ctx = canvas.getContext('2d', {
  alpha: true,
  desynchronized: true,
});

if (!ctx)
{
  throw new Error('[ba-click-fx] 无法获取 Canvas 2D 上下文');
}

// 拖尾专用离屏画布：每帧清空后根据 trailStrokes 重绘。
// 注意：这版不是“整张残影图一起淡出”，而是每个轨迹点有自己的寿命。
// 每次按下鼠标都会创建一段新的 stroke，避免松开后再次点击时把两个位置连接起来。
const trailCanvas = document.createElement('canvas');
const trailCtx = trailCanvas.getContext('2d', {
  alpha: true,
  desynchronized: true,
});

let width = 0;
let height = 0;
let dpr = 1;

let waves = [];
let sparks = [];
let trailStrokes = [];
let currentTrailStroke = null;

let wavePool = [];
let sparkPool = [];

let isDown = false;
let lastTrailPos = null;
let lastTrailEventTime = 0;
let trailSpeedFactor = 0;
let trailShardDistance = 0;

// 指数平滑：过滤鼠标手动直线移动时的手抖微颤
let trailSmoothX = null;
let trailSmoothY = null;

let lastTime = performance.now();
let running = false;

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();

  width = rect.width || window.innerWidth;
  height = rect.height || window.innerHeight;

  dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  trailCanvas.width = Math.floor(width * dpr * CONFIG.trailRenderScale);
  trailCanvas.height = Math.floor(height * dpr * CONFIG.trailRenderScale);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  trailCtx.setTransform(
    dpr * CONFIG.trailRenderScale,
    0,
    0,
    dpr * CONFIG.trailRenderScale,
    0,
    0,
  );

  clearCanvas();
  clearTrailCanvas();

  requestRender();
}

let resizeTimer = 0;

function debouncedResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeCanvas, 150);
}

window.addEventListener('resize', debouncedResize);
resizeCanvas();

function requestRender() {
  if (running) {
    return;
  }

  running = true;
  lastTime = performance.now();
  requestAnimationFrame(animationLoop);
}































function clearCanvas() {
  ctx.clearRect(0, 0, width, height);
}

function clearTrailCanvas() {
  trailCtx.save();
  trailCtx.setTransform(1, 0, 0, 1, 0, 0);
  trailCtx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
  trailCtx.restore();

  trailCtx.setTransform(
    dpr * CONFIG.trailRenderScale,
    0,
    0,
    dpr * CONFIG.trailRenderScale,
    0,
    0,
  );
}

function resetTrailInput()
{
  lastTrailPos = null;
  lastTrailEventTime = 0;
  trailShardDistance = 0;
}

function endTrailStroke() {
  if (currentTrailStroke) {
    currentTrailStroke.released = true;
  }

  currentTrailStroke = null;
}

function resetTrailAll() {
  resetTrailInput();
  endTrailStroke();
  trailSpeedFactor = 0;
  trailStrokes.length = 0;
  trailSmoothX = null;
  trailSmoothY = null;
  clearTrailCanvas();
}

function updateTrailSpeed(from, to, eventTime) {
  const dist = distance(from, to);

  if (lastTrailEventTime <= 0) {
    lastTrailEventTime = eventTime;
    return 0;
  }

  const dt = Math.max(1, eventTime - lastTrailEventTime);
  const speed = dist / dt;

  const factor = clamp01(
    (speed - CONFIG.trail.speedMin) /
      (CONFIG.trail.speedMax - CONFIG.trail.speedMin),
  );

  // 速度上升要快，下降交给每帧慢慢衰减
  trailSpeedFactor = Math.max(trailSpeedFactor, factor);
  lastTrailEventTime = eventTime;

  return factor;
}

function drawCircle(context, x, y, r, color, alpha, blur = 0, useFakeGlow = true) {
  if (alpha <= 0 || r <= 0) {
    return;
  }

  context.save();

  if (useFakeGlow && CONFIG.glow.fake && blur > 0) {
    context.fillStyle = rgbToCss(color, alpha * 0.12);
    context.beginPath();
    context.arc(x, y, r + blur * 1.2, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = rgbToCss(color, alpha * 0.16);
    context.beginPath();
    context.arc(x, y, r + blur * 0.55, 0, Math.PI * 2);
    context.fill();
  }

  if (CONFIG.glow.enabled && blur > 0) {
    context.shadowColor = rgbToCss(color, alpha);
    context.shadowBlur = blur * 0.28;
  }

  context.fillStyle = rgbToCss(color, alpha);
  context.beginPath();
  context.arc(x, y, r, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawTriangle(
  context,
  x,
  y,
  size,
  rotation,
  color,
  alpha,
)
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

  // 原作碎片是纯色 Sprite，本体边缘不做描边、阴影或独立 glow。
  context.fillStyle = rgbToCss(color, alpha);
  drawEquilateralPath(size);
  context.fill();

  context.restore();
}

function drawArcSegment(
  context,
  x,
  y,
  radius,
  start,
  end,
  widthValue,
  color,
  alpha,
)
{
  if (alpha <= 0 || widthValue <= 0 || Math.abs(end - start) < 0.001) {
    return;
  }

  context.save();

  // BASpark 的点击圆环是单层线条；多层 fake glow 会让点击反馈显得发糊。
  context.lineCap = 'round';
  context.strokeStyle = rgbToCss(color, alpha);
  context.lineWidth = widthValue;

  context.beginPath();
  context.arc(x, y, radius, start, end);
  context.stroke();

  context.restore();
}

function drawRadialGlow(context, x, y, radius, color, alpha)
{
  if (alpha <= 0 || radius <= 0)
  {
    return;
  }

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

function drawClickDisk(context, x, y, radius, color, alpha)
{
  if (alpha <= 0 || radius <= 0)
  {
    return;
  }

  context.save();

  // 游戏里的中心圆盘本体是纯色 Sprite，边缘差异由独立 glow 层承担。
  context.fillStyle = rgbToCss(color, alpha);
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawClickArcSegment(
  context,
  x,
  y,
  radius,
  start,
  end,
  widthValue,
  color,
  alpha,
)
{
  if (alpha <= 0 || widthValue <= 0 || Math.abs(end - start) < 0.001)
  {
    return;
  }

  drawArcSegment(
    context,
    x,
    y,
    radius,
    start,
    end,
    widthValue,
    color,
    alpha,
  );
}

function drawClickRingGlow(context, x, y, radius, color, alpha)
{
  if (alpha <= 0 || radius <= 0)
  {
    return;
  }

  if (!CONFIG.glow.clickFake && !CONFIG.glow.enabled)
  {
    return;
  }

  const cfg = CONFIG.rings;

  // 只保留自发光面光，避免出现原作里没有的完整浅圆环线条。
  drawRadialGlow(
    context,
    x,
    y,
    radius + cfg.softGlowRadiusAdd * getClickScale(),
    color,
    alpha * cfg.softGlowAlpha,
  );

  drawRadialGlow(
    context,
    x,
    y,
    radius + cfg.glowRadiusAdd * getClickScale(),
    mixColor(color, [255, 255, 255], 0.38),
    alpha * cfg.glowAlpha,
  );
}

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

      // Unity 粒子 Burst 的随机感并不均匀，允许弧段偶尔靠近同一侧。
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
      alphaMul: rand(0.62, 1.08),
      widthMul: rand(0.68, 1.24),
      collapseBias: rand(-0.16, 0.2),
    });
  }

  return segments;
}

class ClickWave
{
  constructor()
  {
    this.dead = true;
  }

  reset(x, y)
  {
    const rings = CONFIG.rings;

    this.x = x;
    this.y = y;
    this.life = 0;
    this.r = 0;
    this.dead = false;

    this.ring = {
      // 每次点击重新采样圆环弧段，避免高亮总落在固定两侧。
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

    if (this.life >= CONFIG.click.totalLife)
    {
      this.dead = true;
    }
  }

  getDiskRadius()
  {
    return CONFIG.filledCircle.rAddRate * getClickScale();
  }

  getRingStaticRadius()
  {
    return this.getDiskRadius() * CONFIG.rings.baseRadiusMul;
  }

  getRingRadiusGrow(progress = 0)
  {
    const cfg = CONFIG.rings;
    // easeOutCubic 使扩张先快后慢，半径越大速度越平缓
    const t = easeOutCubic(clamp01(progress / cfg.radiusGrowEnd));
    return t * cfg.postDiskGrow * CONFIG.scale;
  }

  getRingRadius(progress = 0)
  {
    return this.getRingStaticRadius() + this.getRingRadiusGrow(progress);
  }

  drawHalo(context)
  {
    if (!CONFIG.glow.clickFake && !CONFIG.glow.enabled)
    {
      return;
    }

    const progress = clamp01(this.life / CONFIG.click.totalLife);
    const diskProgress = clamp01(this.life / CONFIG.filledCircle.maxLife);
    const appear = smoothstep(0.01, 0.2, progress);
    const fade = 1 - smoothstep(0.84, 1, progress);
    const color = mixColor(
      CONFIG.startColor,
      CONFIG.color,
      smoothstep(0.08, CONFIG.filledCircle.colorEnd, diskProgress),
    );
    const radius = lerp(
      this.getDiskRadius() * 2.1,
      CONFIG.click.haloRadius * getClickScale(),
      smoothstep(0.04, 0.54, progress),
    );
    const alpha = 0.2 * CONFIG.opacity * appear * fade;

    drawRadialGlow(context, this.x, this.y, radius, color, alpha);
  }

  drawFilledCircle(context)
  {
    const cfg = CONFIG.filledCircle;
    const progress = clamp01(this.life / cfg.maxLife);

    this.r = this.getDiskRadius();

    if (progress >= 1)
    {
      return;
    }

    // 原作圆盘很快长到目标尺寸，随后短暂停留，再在第 24 帧附近消失。
    const expandT = easeOutCubic(clamp01(progress / cfg.expandEnd));
    const fade = 1 - smoothstep(cfg.fadeStart, 1, progress);
    const colorT = smoothstep(0.06, cfg.colorEnd, progress);
    const radius = this.r * expandT;
    const color = mixColor(CONFIG.startColor, CONFIG.color, colorT);
    const alpha = CONFIG.opacity * fade;

    if (CONFIG.glow.clickFake || CONFIG.glow.enabled)
    {
      // 中心圆盘自己的光晕只跟随圆盘 24 帧生命周期。
      drawRadialGlow(
        context,
        this.x,
        this.y,
        radius * cfg.glowRadiusMul,
        color,
        alpha * cfg.glowAlpha,
      );
    }

    drawClickDisk(context, this.x, this.y, radius, color, alpha);
  }

  drawRings(context, frameScale)
  {
    const cfg = CONFIG.rings;
    // 圆环在第 4 帧（120fps）出现，相对时间轴偏移 2 帧（60fps）
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
    // 始终使用明度极高的亮色，不作颜色渐变
    const color = getClickRingEndColor();
    // 原作圆环像独立 Additive Sprite，本体亮度不跟随全局透明度滑块变暗。
    // ringAlpha 用 grow 控制出现；glow 加地板避免初期完全不可见
    const ringAlpha = cfg.alpha * grow * fade;
    const glowGrow = Math.max(grow, 0.15);
    const ringGlowAlpha = cfg.emissionAlpha * glowGrow * fade;
    const staticRadius = this.getRingStaticRadius();
    const radiusGrow = this.getRingRadiusGrow(progress);
    const baseRadius = staticRadius + radiusGrow;
    const lineWidthMul = lerp(1, 0.72, collapse);

    // 原作没有完整弱圆环；这里只画自发光，清晰圆环由随机弧段组成。
    drawClickRingGlow(
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
      // start 固定，end 逆时针回缩减少弧长（模拟游戏里逆时针消散）
      const baseAngle = this.ring.ang * seg.rotationMul + seg.off;
      const fullLen = cfg.lenFull * seg.lenMul * grow;
      const targetLen = lerp(fullLen, cfg.lenEnd, segCollapse);
      const start = baseAngle;
      const end = baseAngle + targetLen;
      const currentLen = targetLen;
      const radius =
        staticRadius +
        radiusGrow * seg.radiusGrowMul +
        seg.radiusOffset * CONFIG.scale;
      const segAlpha = ringAlpha * seg.alphaMul;
      const segLineWidthMul = lineWidthMul * seg.widthMul;

      for (let i = 0; i < cfg.segNum; i++)
      {
        const t0 = i / cfg.segNum;
        const t1 = (i + 1) / cfg.segNum;
        const a0 = start + (end - start) * t0;
        const a1 = start + (end - start) * t1;
        const weight = getArcWeight(t0);
        const lineWidth =
          (cfg.minW * (1 - weight) + cfg.maxW * weight) *
          segLineWidthMul *
          CONFIG.scale;

        drawClickArcSegment(
          context,
          this.x,
          this.y,
          radius,
          a0,
          a1,
          lineWidth,
          color,
          segAlpha,
        );
      }
    }
  }

  drawCenterDot(context)
  {
    const progress = clamp01(this.life / CONFIG.click.totalLife);
    const dotAlpha =
      smoothstep(0.43, 0.52, progress) *
      (1 - smoothstep(0.82, 1, progress)) *
      CONFIG.opacity *
      0.72;

    if (dotAlpha <= 0)
    {
      return;
    }

    const radius = lerp(1.5, 0.75, smoothstep(0.52, 1, progress)) * CONFIG.scale;

    drawCircle(
      context,
      this.x,
      this.y,
      radius,
      CONFIG.color,
      dotAlpha,
      radius * 1.8,
      true,
    );
  }
}

class SparkParticle
{
  constructor()
  {
    this.dead = true;
  }

  reset(x, y, fromClick = true)
  {
    const particleScale = fromClick ? getClickScale() : CONFIG.scale;
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
      : mixColor(CONFIG.color, [255, 255, 255], rand(0.28, 0.82));
    this.blur = fromClick ? (2.0 * particleScale) : (2.8 * CONFIG.scale);
    this.useFakeGlow = fromClick ? CONFIG.glow.clickFake : true;
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

    // 碎片不跟随全局透明度，与圆环/拖尾一致保持 Additive 独立亮度。
    let drawAlpha = this.alpha * this.alphaMul;
    let flickerPulse = 1;

    if (this.flickerPeriod > 0)
    {
      const cycle =
        ((this.age + this.flickerPhase) % this.flickerPeriod) /
        this.flickerPeriod;
      flickerPulse = (1 - Math.cos(cycle * Math.PI * 2)) / 2;

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
    const shrinkMul = lerp(
      1,
      this.endSizeMul,
      smoothstep(this.sizeShrinkStart, 1, lifeProgress),
    );
    const sizeByLife = this.size * growMul * shrinkMul;
    const size =
      this.flickerPeriod > 0 && this.flickerSizePulse > 0
        ? sizeByLife *
          lerp(1 - this.flickerSizePulse, 1 + this.flickerSizePulse, flickerPulse)
        : sizeByLife;

    drawTriangle(
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

function getWave(x, y) {
  const wave = wavePool.pop() ?? new ClickWave();
  wave.reset(x, y);
  return wave;
}

function releaseWave(wave) {
  wave.dead = true;

  if (wavePool.length < 64) {
    wavePool.push(wave);
  }
}

function getSpark(x, y, fromClick)
{
  const spark = sparkPool.pop() ?? new SparkParticle();
  spark.reset(x, y, fromClick);
  return spark;
}

function tuneClickShard(spark, centerX, centerY)
{
  const angle = Math.random() * Math.PI * 2;
  const tangentAngle = angle + Math.PI / 2;
  // 固定产生 4 个碎片（sparksCount），产生半径 = 圆盘最大半径
  const ringRadius =
    CONFIG.filledCircle.rAddRate *
    getClickScale();
  // 径向速度与圆环扩张速度相近（~0.55 px/帧 @60fps），碎片随环外扩
  const radialSpeed = rand(0.4, 0.7) * CONFIG.scale;
  const tangentSpeed = rand(-0.4, 0.4) * CONFIG.scale;
  // 偏向白色以模拟 Unity Additive + Bloom 下的明亮蓝白闪光
  const whiteMix = rand(0.65, 0.95);

  spark.x = centerX + Math.cos(angle) * ringRadius;
  spark.y = centerY + Math.sin(angle) * ringRadius;
  spark.vx =
    Math.cos(angle) * radialSpeed +
    Math.cos(tangentAngle) * tangentSpeed;
  spark.vy =
    Math.sin(angle) * radialSpeed +
    Math.sin(tangentAngle) * tangentSpeed;

  // 120fps 视频基准：碎片在第 3 帧出现 → 60fps 基准延迟 1.5 帧
  spark.delay = 1.5;
  spark.size = rand(5.2, 10.0) * CONFIG.scale;
  spark.alpha = rand(0.78, 1);
  spark.maxAlpha = spark.alpha;
  spark.alphaMul = rand(1.35, 1.6);
  spark.alphaDecay = rand(0.028, 0.044);
  spark.friction = rand(0.96, 0.985);
  spark.rotation = angle + Math.PI + rand(-1.3, 1.3);
  // 点击碎片不自身旋转，保持发射朝向
  spark.rotationSpeed = 0;
  spark.color = mixColor(CONFIG.color, [255, 255, 255], whiteMix);
  spark.blur = rand(0.8, 2.2) * CONFIG.scale;
  spark.useFakeGlow = CONFIG.glow.clickFake;
  spark.flickerPeriod = CONFIG.click.shardFlickerPeriod;
  spark.flickerMinAlpha = CONFIG.click.shardFlickerMinAlpha;
  spark.flickerPhase = 0;
  spark.flickerSizePulse = 0.08;
  spark.sizeGrowEnd = rand(0.16, 0.28);
  spark.sizeShrinkStart = rand(0.62, 0.76);
  spark.spawnSizeMul = rand(0.02, 0.1);
  spark.endSizeMul = rand(0.18, 0.36);
}

function tuneTrailShard(spark, tangentAngle, normalAngle, speedFactor)
{
  const cfg = CONFIG.trail;
  const isLarge = Math.random() < cfg.shardLargeChance;
  const scale = CONFIG.scale;
  const drift = rand(0.02, 0.28) * (0.72 + speedFactor * 0.45);
  const tangentDrift = rand(-0.22, 0.26);
  // 拖尾碎片只做辅助点缀，避免比轨迹本体更抢眼。
  const whiteMix = isLarge ? rand(0.48, 0.82) : rand(0.28, 0.62);

  spark.vx = Math.cos(normalAngle) * drift + Math.cos(tangentAngle) * tangentDrift;
  spark.vy = Math.sin(normalAngle) * drift + Math.sin(tangentAngle) * tangentDrift;

  // 大碎片更慢、更亮，能形成截图里沿轨迹漂浮的三角片。
  spark.size = (isLarge ? rand(6.2, 9.8) : rand(3.6, 5.6)) * scale;
  spark.alpha = isLarge ? rand(0.42, 0.74) : rand(0.28, 0.52);
  spark.maxAlpha = spark.alpha;
  spark.alphaMul = isLarge ? rand(1.08, 1.32) : rand(0.96, 1.18);
  // 120fps 视频基准：生命周期随机 25~40 帧 → 60fps 基准 12.5~20 帧。
  // 从目标生命周期反推衰减速度，保证每个碎片存活时间落在区间内。
  const lifetime = rand(12.5, 20);
  spark.alphaDecay = spark.alpha / lifetime;
  spark.friction = isLarge ? rand(0.978, 0.99) : rand(0.965, 0.982);
  spark.rotation = normalAngle + rand(-1.2, 1.2);
  spark.rotationSpeed = rand(-0.055, 0.075);
  spark.color = mixColor(CONFIG.color, [255, 255, 255], whiteMix);
  spark.blur = (isLarge ? rand(0.7, 1.6) : rand(0.15, 0.65)) * scale;
  spark.useFakeGlow = true;
  spark.flickerPeriod = cfg.shardFlickerPeriod;
  spark.flickerMinAlpha = isLarge
    ? cfg.shardFlickerMinAlpha
    : Math.min(0.34, cfg.shardFlickerMinAlpha + 0.1);
  spark.flickerPhase = rand(0, cfg.shardFlickerPeriod);
  spark.flickerSizePulse = cfg.shardFlickerSizePulse;
  spark.sizeGrowEnd = isLarge ? rand(0.14, 0.26) : rand(0.1, 0.22);
  spark.sizeShrinkStart = isLarge ? rand(0.62, 0.78) : rand(0.52, 0.72);
  spark.spawnSizeMul = isLarge ? rand(0.5, 0.72) : rand(0.4, 0.65);
  spark.endSizeMul = isLarge ? rand(0.2, 0.38) : rand(0.12, 0.3);
}

function spawnTrailShards(from, to, speedFactor)
{
  const cfg = CONFIG.trail;
  const dist = distance(from, to);

  if (dist < 2 || sparks.length >= cfg.maxSparkParticles)
  {
    return;
  }

  // spacing 为平均值，实际生成间距在 0.5~1.5 倍之间随机浮动，模拟游戏里不规则的碎片分布。
  const baseSpacing =
    cfg.shardSpacing *
    CONFIG.scale *
    lerp(1.15, 0.72, clamp01(speedFactor));
  trailShardDistance += dist;

  if (trailShardDistance < baseSpacing)
  {
    return;
  }

  const actualSpacing = baseSpacing * rand(0.5, 1.5);
  const attempts = Math.min(6, Math.max(1, Math.round(trailShardDistance / actualSpacing)));

  trailShardDistance %= baseSpacing;

  const extraChance = lerp(
    cfg.shardChanceSlow,
    cfg.shardChanceFast,
    clamp01(speedFactor),
  );
  const tangentAngle = Math.atan2(to.y - from.y, to.x - from.x);

  for (let i = 0; i < attempts; i++)
  {
    if (sparks.length >= cfg.maxSparkParticles)
    {
      return;
    }

    const spawnCount =
      Math.random() < extraChance && sparks.length < cfg.maxSparkParticles - 1
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
        CONFIG.scale *
        (0.82 + speedFactor * 0.22);
      const tangentOffset = rand(-8, 10) * CONFIG.scale;
      const x =
        lerp(from.x, to.x, t) +
        Math.cos(normalAngle) * offset +
        Math.cos(tangentAngle) * tangentOffset;
      const y =
        lerp(from.y, to.y, t) +
        Math.sin(normalAngle) * offset +
        Math.sin(tangentAngle) * tangentOffset;
      const spark = getSpark(x, y, false);

      tuneTrailShard(spark, tangentAngle, normalAngle, speedFactor);
      sparks.push(spark);
    }
  }
}

function releaseSpark(spark) {
  spark.dead = true;

  if (sparkPool.length < 256) {
    sparkPool.push(spark);
  }
}

function createClickEffect(x, y)
{
  waves.push(getWave(x, y));

  for (let i = 0; i < CONFIG.sparksCount; i++)
  {
    const spark = getSpark(x, y, true);

    tuneClickShard(spark, x, y);
    sparks.push(spark);
  }

  requestRender();
}

// stroke 结构：点对象数组，同时通过 .speedFactor / .released 携带元数据
// 避免额外对象包装开销，数组方法（push/shift/length）直接操作轨迹点
function createTrailStroke(initialSpeedFactor = 0) {
  const stroke = [];

  stroke.speedFactor = clamp01(initialSpeedFactor);
  stroke.released = false;

  trailStrokes.push(stroke);
  currentTrailStroke = stroke;

  return stroke;
}

function beginTrailStroke(x, y, speedFactor = 0) {
  const stroke = createTrailStroke(speedFactor);
  addTrailPoint(x, y, speedFactor, stroke);
  return stroke;
}

function getTrailMaxLength(stroke = currentTrailStroke) {
  const speedFactor = stroke ? (stroke.speedFactor ?? 0) : trailSpeedFactor;

  return lerp(
    CONFIG.trail.lengthSlow,
    CONFIG.trail.lengthFast,
    clamp01(speedFactor),
  );
}

function getTotalTrailPointCount() {
  let count = 0;

  for (const stroke of trailStrokes) {
    count += stroke.length;
  }

  return count;
}

function trimOldestTrailPointsByCount() {
  let count = getTotalTrailPointCount();

  while (count > CONFIG.trail.maxPoints && trailStrokes.length > 0) {
    const oldest = trailStrokes[0];

    if (oldest.length > 0) {
      oldest.shift();
      count--;
    }

    if (oldest.length === 0) {
      if (oldest === currentTrailStroke) {
        currentTrailStroke = null;
      }

      trailStrokes.shift();
    }
  }

  // 极端情况下防止旧 stroke 无限堆积。
  while (trailStrokes.length > 64) {
    const removed = trailStrokes.shift();

    if (removed === currentTrailStroke) {
      currentTrailStroke = null;
    }
  }
}

function trimTrailPoints(stroke = currentTrailStroke) {
  if (!stroke || stroke.length < 2) {
    return;
  }

  let totalLength = 0;

  for (let i = stroke.length - 1; i > 0; i--) {
    totalLength += distance(stroke[i], stroke[i - 1]);
  }

  const maxLength = getTrailMaxLength(stroke);

  // 只裁剪当前 stroke 的尾部，不会影响其它已经松开的旧 stroke。
  while (totalLength > maxLength && stroke.length > 8) {
    const removedLength = distance(stroke[0], stroke[1]);
    stroke.shift();
    totalLength -= removedLength;
  }

  trimOldestTrailPointsByCount();
}

function addTrailPoint(x, y, speedFactor = 0, stroke = currentTrailStroke) {
  const targetStroke = stroke || createTrailStroke(speedFactor);

  targetStroke.speedFactor = Math.max(
    targetStroke.speedFactor ?? 0,
    clamp01(speedFactor),
  );

  // 默认 lifeSlow === lifeFast，所以速度不会拉长消散时间。
  // 鼠标移动越快只会让 stroke 更长，不会让 stroke 消失得更慢。
  const life = lerp(
    CONFIG.trail.lifeSlow,
    CONFIG.trail.lifeFast,
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

  trimTrailPoints(targetStroke);
  requestRender();
}

function addInterpolatedTrailPoints(from, to, speedFactor) {
  const dist = distance(from, to);

  if (dist < CONFIG.trail.minDistance) {
    return;
  }

  if (dist > CONFIG.trail.maxJumpDistance) {
    // 大跳变一般来自窗口切换、指针捕获丢失或重新点击。
    // 这里必须断开旧 stroke，不能从旧位置连到新位置。
    endTrailStroke();
    beginTrailStroke(to.x, to.y, speedFactor);
    lastTrailPos = to;
    return;
  }

  const stroke = currentTrailStroke || createTrailStroke(speedFactor);

  // 这里仍然做线性插值，只是为了补齐浏览器采样间隔。
  // 不再使用 Catmull-Rom 或二次贝塞尔拟合，避免轨迹偏离鼠标真实经过的位置。
  const steps = Math.min(
    CONFIG.trail.maxInterpolatedPoints,
    Math.max(2, Math.ceil(dist / CONFIG.trail.sampleStep)),
  );

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;

    addTrailPoint(
      lerp(from.x, to.x, t),
      lerp(from.y, to.y, t),
      speedFactor,
      stroke,
    );
  }
}

function updateTrailPoints(frameScale) {
  if (trailStrokes.length === 0) {
    return;
  }

  const aliveStrokes = [];

  for (const stroke of trailStrokes) {
    if (stroke.length === 0) {
      continue;
    }

    const isActiveStroke =
      stroke === currentTrailStroke &&
      !stroke.released &&
      (isDown || CONFIG.trail.always);

    const releaseMul = isActiveStroke ? 1 : CONFIG.trail.releaseDecayMul;

    for (let i = 0; i < stroke.length; i++) {
      const p = stroke[i];

      const indexFactor =
        stroke.length > 1 ? i / (stroke.length - 1) : 1;

      // 越靠近尾部，衰减越快；越靠近头部，衰减越慢。
      // 每个 stroke 独立消散，所以新点击不会和旧点击连接成一条线。
      const decayMul = lerp(
        CONFIG.trail.tailDecayMul,
        CONFIG.trail.headDecayMul,
        indexFactor,
      );

      p.life -= frameScale * decayMul * releaseMul;
    }

    // 只能从当前 stroke 的尾部删除死亡点。
    // 不删除中间点，避免轨迹内部出现断裂。
    while (stroke.length > 0 && stroke[0].life <= 0) {
      stroke.shift();
    }

    stroke.speedFactor = clamp01(
      (stroke.speedFactor ?? 0) * Math.pow(CONFIG.trail.speedDecay, frameScale),
    );

    trimTrailPoints(stroke);

    if (stroke.length > 0) {
      aliveStrokes.push(stroke);
    } else if (stroke === currentTrailStroke) {
      currentTrailStroke = null;
    }
  }

  trailStrokes = aliveStrokes;

  if (currentTrailStroke && !trailStrokes.includes(currentTrailStroke)) {
    currentTrailStroke = null;
  }

  // 全局速度只用于下一次新 stroke 的初始速度参考。
  trailSpeedFactor *= Math.pow(CONFIG.trail.speedDecay, frameScale);
}

function mixTrailPointMeta(a, b, t, x, y) {
  return {
    x,
    y,
    life: lerp(a.life, b.life, t),
    maxLife: lerp(a.maxLife, b.maxLife, t),
    speedFactor: lerp(a.speedFactor ?? 0, b.speedFactor ?? 0, t),
    distanceFromTail: 0,
  };
}

function pushRenderPoint(list, point) {
  const last = list[list.length - 1];

  if (last && distance(last, point) < 0.2) {
    return;
  }

  list.push(point);
}

function buildTrailRenderPoints(points) {
  if (points.length < 2) {
    return points;
  }

  const result = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const segLen = distance(p1, p2);

    const steps = Math.max(
      1,
      Math.ceil(segLen / CONFIG.trail.renderStep),
    );

    for (let s = 0; s < steps; s++) {
      const t = s / steps;

      pushRenderPoint(
        result,
        mixTrailPointMeta(
          p1,
          p2,
          t,
          lerp(p1.x, p2.x, t),
          lerp(p1.y, p2.y, t),
        ),
      );
    }
  }

  const last = points[points.length - 1];

  pushRenderPoint(result, {
    ...last,
    distanceFromTail: 0,
  });

  while (result.length > CONFIG.trail.renderMaxPoints) {
    result.shift();
  }

  if (result.length === 0) {
    return points;
  }

  let total = 0;
  result[0].distanceFromTail = 0;

  for (let i = 1; i < result.length; i++) {
    total += distance(result[i - 1], result[i]);
    result[i].distanceFromTail = total;
  }

  result.totalLength = total;

  return result;
}

function getTrailPathSlice(points, startProgress)
{
  const progress = clamp01(startProgress);

  if (progress <= 0)
  {
    return points;
  }

  if (progress >= 1)
  {
    const empty = [];
    empty.totalLength = 0;

    return empty;
  }

  const totalLength =
    points.totalLength ??
    points[points.length - 1]?.distanceFromTail ??
    0;

  if (points.length < 2 || totalLength <= 0)
  {
    return points;
  }

  const startDistance = totalLength * progress;

  for (let i = 1; i < points.length; i++)
  {
    const prev = points[i - 1];
    const current = points[i];

    if (current.distanceFromTail < startDistance)
    {
      continue;
    }

    const segmentLength = current.distanceFromTail - prev.distanceFromTail;
    const t =
      segmentLength <= 0
        ? 0
        : (startDistance - prev.distanceFromTail) / segmentLength;
    const startPoint = {
      ...current,
      x: lerp(prev.x, current.x, clamp01(t)),
      y: lerp(prev.y, current.y, clamp01(t)),
      distanceFromTail: 0,
    };
    const sliced = [
      startPoint,
      ...points.slice(i).map((point) => ({ ...point })),
    ];

    let slicedLength = 0;

    sliced[0].distanceFromTail = 0;

    for (let j = 1; j < sliced.length; j++)
    {
      slicedLength += distance(sliced[j - 1], sliced[j]);
      sliced[j].distanceFromTail = slicedLength;
    }

    sliced.totalLength = slicedLength;

    return sliced;
  }

  const empty = [];
  empty.totalLength = 0;

  return empty;
}

function getTrailStopValue(stops, progress, fallback = 0)
{
  if (!Array.isArray(stops) || stops.length === 0)
  {
    return fallback;
  }

  const value = clamp01(progress);
  const first = stops[0];

  if (value <= first[0])
  {
    return first[1];
  }

  for (let i = 1; i < stops.length; i++)
  {
    const prev = stops[i - 1];
    const next = stops[i];

    if (value > next[0])
    {
      continue;
    }

    const range = next[0] - prev[0];
    const t = range <= 0 ? 1 : (value - prev[0]) / range;

    return lerp(prev[1], next[1], clamp01(t));
  }

  return stops[stops.length - 1][1];
}

function strokeTaperedTrailPath(context, points, options)
{
  const {
    widthValue,
    color,
    stops,
    widthStops,
    minWidth = 0,
    lineCap = 'round',
    shadowBlur = 0,
    shadowColor = color,
    shadowAlpha = 0,
    startProgress = 0,
    chunkLength = 12 * CONFIG.scale,
    maxChunks = 96,
  } = options;
  const pathPoints = getTrailPathSlice(points, startProgress);
  const totalLength =
    pathPoints.totalLength ??
    pathPoints[pathPoints.length - 1]?.distanceFromTail ??
    0;

  if (pathPoints.length < 2 || widthValue <= 0 || totalLength <= 0)
  {
    return;
  }

  const startDistance = pathPoints[0].distanceFromTail ?? 0;
  const maxAlpha = Math.max(...stops.map((stop) => stop[1]), 0.001);
  const effectiveChunkLength = Math.max(
    chunkLength,
    totalLength / Math.max(8, maxChunks),
  );
  let startIndex = 0;

  context.save();
  context.lineCap = lineCap;
  context.lineJoin = 'round';

  for (let i = 1; i < pathPoints.length; i++)
  {
    const currentLength =
      pathPoints[i].distanceFromTail - pathPoints[startIndex].distanceFromTail;
    const isLastPoint = i === pathPoints.length - 1;

    if (currentLength < effectiveChunkLength && !isLastPoint)
    {
      continue;
    }

    const midpoint =
      (pathPoints[startIndex].distanceFromTail + pathPoints[i].distanceFromTail) / 2;
    const localProgress = clamp01((midpoint - startDistance) / totalLength);
    const alpha = getTrailStopValue(stops, localProgress);
    const widthScale = getTrailStopValue(widthStops, localProgress, 1);
    const lineWidth = Math.max(minWidth, widthValue * widthScale);

    if (alpha > 0 && lineWidth > 0)
    {
      context.strokeStyle = rgbToCss(color, alpha);
      context.lineWidth = lineWidth;

      if (shadowBlur > 0 && shadowAlpha > 0)
      {
        // 分段宽度和透明度模拟 Unity TrailRenderer 的 width/color over lifetime。
        context.shadowBlur = shadowBlur;
        context.shadowColor = rgbToCss(
          shadowColor,
          shadowAlpha * clamp01(alpha / maxAlpha),
        );
      }

      context.beginPath();
      context.moveTo(pathPoints[startIndex].x, pathPoints[startIndex].y);

      for (let j = startIndex + 1; j <= i; j++)
      {
        context.lineTo(pathPoints[j].x, pathPoints[j].y);
      }

      context.stroke();
    }

    startIndex = i;
  }

  context.restore();
}

function strokeSolidTrailPath(context, points, options)
{
  const {
    widthValue,
    color,
    alpha,
    minWidth = 0,
    lineCap = 'butt',
    shadowBlur = 0,
    shadowColor = color,
    shadowAlpha = 0,
    startProgress = 0,
  } = options;
  const pathPoints = getTrailPathSlice(points, startProgress);
  const lineWidth = Math.max(minWidth, widthValue);

  if (pathPoints.length < 2 || lineWidth <= 0 || alpha <= 0)
  {
    return;
  }

  context.save();
  context.strokeStyle = rgbToCss(color, alpha);
  context.lineWidth = lineWidth;
  context.lineCap = lineCap;
  context.lineJoin = 'round';

  if (shadowBlur > 0 && shadowAlpha > 0)
  {
    // 大范围柔光用整条路径一次绘制，避免每个小段都触发 expensive shadowBlur。
    context.shadowBlur = shadowBlur;
    context.shadowColor = rgbToCss(shadowColor, shadowAlpha);
  }

  context.beginPath();
  context.moveTo(pathPoints[0].x, pathPoints[0].y);

  for (let i = 1; i < pathPoints.length; i++)
  {
    context.lineTo(pathPoints[i].x, pathPoints[i].y);
  }

  context.stroke();
  context.restore();
}

function renderTrailStrokeToCanvas(stroke)
{
  if (!stroke || stroke.length < 2)
  {
    return;
  }

  const renderPoints = buildTrailRenderPoints(stroke);

  if (renderPoints.length < 2)
  {
    return;
  }

  const trailColor = getTrailColor();
  const trailCoreColor = getTrailCoreColor();
  const trailHotColor = getTrailHotColor();
  const head = renderPoints[renderPoints.length - 1];
  const speedFactor = Math.max(head.speedFactor ?? 0, stroke.speedFactor ?? 0);

  const baseWidth = lerp(
    CONFIG.trail.baseWidthSlow,
    CONFIG.trail.baseWidthFast,
    speedFactor,
  ) * CONFIG.scale;

  const coreWidth = lerp(
    CONFIG.trail.coreWidthSlow,
    CONFIG.trail.coreWidthFast,
    speedFactor,
  ) * CONFIG.scale;

  const hotWidth = lerp(
    CONFIG.trail.hotWidthSlow,
    CONFIG.trail.hotWidthFast,
    speedFactor,
  ) * CONFIG.scale;

  const railWidth = lerp(
    CONFIG.trail.railWidthSlow,
    CONFIG.trail.railWidthFast,
    speedFactor,
  ) * CONFIG.scale;
  const glowBaseWidth = Math.max(
    CONFIG.scale,
    Math.min(baseWidth, 2.2 * CONFIG.scale),
  );

  // stroke 快结束时整体稍微淡出，避免最后一个头部亮点突然消失。
  const headLifeRatio = head.maxLife > 0 ? clamp01(head.life / head.maxLife) : 1;
  const fadeMul = smoothstep(0.05, 0.45, headLifeRatio);

  // 1. 细暗轨道：按路径长度采样，避免回环轨迹被首尾线性渐变误亮。
  strokeTaperedTrailPath(trailCtx, renderPoints, {
    widthValue: railWidth,
    minWidth: 0.08 * CONFIG.scale,
    lineCap: 'butt',
    color: CONFIG.color,
    stops: [
      [0.0, CONFIG.trail.railAlpha * 0.04 * CONFIG.trail.alpha * fadeMul],
      [0.45, CONFIG.trail.railAlpha * 0.08 * CONFIG.trail.alpha * fadeMul],
      [0.82, CONFIG.trail.railAlpha * 0.18 * CONFIG.trail.alpha * fadeMul],
      [1.0, CONFIG.trail.railAlpha * 0.06 * CONFIG.trail.alpha * fadeMul],
    ],
    widthStops: [
      [0.0, 0.5],
      [0.5, 0.72],
      [1.0, 0.58],
    ],
    chunkLength: 14 * CONFIG.scale,
    maxChunks: 56,
  });

  // 2. 柔和外光：让细线自身发光，而不是画出一条可见宽色带。
  if (CONFIG.glow.fake)
  {
    strokeSolidTrailPath(trailCtx, renderPoints, {
      widthValue: glowBaseWidth * CONFIG.trail.softGlowWidthMul * 2.9,
      minWidth: glowBaseWidth * 0.36,
      lineCap: 'butt',
      color: CONFIG.color,
      alpha: CONFIG.trail.softGlowAlpha * 0.16 * CONFIG.trail.alpha * fadeMul,
      shadowBlur: glowBaseWidth * 60,
      shadowColor: CONFIG.color,
      shadowAlpha: CONFIG.trail.softGlowAlpha * 0.9 * CONFIG.trail.alpha * fadeMul,
      startProgress: 0.7,
    });

    strokeSolidTrailPath(trailCtx, renderPoints, {
      widthValue: glowBaseWidth * CONFIG.trail.glowWidthMul * 1.25,
      minWidth: glowBaseWidth * 0.22,
      lineCap: 'butt',
      color: trailColor,
      alpha: CONFIG.trail.glowAlpha * 0.22 * CONFIG.trail.alpha * fadeMul,
      shadowBlur: glowBaseWidth * 20,
      shadowColor: trailColor,
      shadowAlpha: CONFIG.trail.glowAlpha * 0.42 * CONFIG.trail.alpha * fadeMul,
      startProgress: 0.74,
    });
  }

  // 3. 主蓝色轨迹：沿路径长度分段，避免圆形轨迹尾部被头部渐变拖亮。
  strokeTaperedTrailPath(trailCtx, renderPoints, {
    widthValue: baseWidth,
    minWidth: baseWidth * 0.14,
    lineCap: 'butt',
    color: trailColor,
    stops: [
      [0.0, CONFIG.trail.mainAlpha * 0.03 * CONFIG.trail.alpha * fadeMul],
      [0.24, CONFIG.trail.mainAlpha * 0.09 * CONFIG.trail.alpha * fadeMul],
      [0.5, CONFIG.trail.mainAlpha * 0.26 * CONFIG.trail.alpha * fadeMul],
      [0.78, CONFIG.trail.mainAlpha * 0.74 * CONFIG.trail.alpha * fadeMul],
      [1.0, CONFIG.trail.mainAlpha * 0.9 * CONFIG.trail.alpha * fadeMul],
    ],
    widthStops: [
      [0.0, 0.18],
      [0.4, 0.42],
      [0.82, 1.0],
      [1.0, 0.86],
    ],
    chunkLength: 12 * CONFIG.scale,
    maxChunks: 88,
  });

  // 4. 中心浅蓝高光：只是一条很细的亮芯，避免出现双轨。
  strokeTaperedTrailPath(trailCtx, renderPoints, {
    widthValue: coreWidth,
    minWidth: coreWidth * 0.12,
    lineCap: 'butt',
    color: trailCoreColor,
    stops: [
      [0.0, 0.0],
      [0.34, CONFIG.trail.coreAlpha * 0.02 * CONFIG.trail.alpha * fadeMul],
      [0.62, CONFIG.trail.coreAlpha * 0.18 * CONFIG.trail.alpha * fadeMul],
      [0.86, CONFIG.trail.coreAlpha * 0.7 * CONFIG.trail.alpha * fadeMul],
      [1.0, CONFIG.trail.coreAlpha * 0.36 * CONFIG.trail.alpha * fadeMul],
    ],
    widthStops: [
      [0.0, 0.1],
      [0.55, 0.42],
      [0.9, 1.0],
      [1.0, 0.72],
    ],
    chunkLength: 9 * CONFIG.scale,
    maxChunks: 80,
  });

  // 5. 蓝白高光：同样按路径长度采样，回环时不会从尾端错误延长。
  strokeTaperedTrailPath(trailCtx, renderPoints, {
    widthValue: hotWidth,
    minWidth: hotWidth * 0.1,
    lineCap: 'butt',
    color: trailHotColor,
    stops: [
      [0.0, 0.0],
      [0.52, 0.0],
      [0.72, CONFIG.trail.hotAlpha * 0.2 * CONFIG.trail.alpha * fadeMul],
      [0.92, CONFIG.trail.hotAlpha * 0.92 * CONFIG.trail.alpha * fadeMul],
      [1.0, CONFIG.trail.hotAlpha * 0.3 * CONFIG.trail.alpha * fadeMul],
    ],
    widthStops: [
      [0.0, 0],
      [0.72, 0.38],
      [0.92, 1.0],
      [1.0, 0.55],
    ],
    chunkLength: 7 * CONFIG.scale,
    maxChunks: 72,
  });
}

function renderTrailToCanvas() {
  clearTrailCanvas();

  if (!CONFIG.trail.enabled || trailStrokes.length === 0) {
    return;
  }

  trailCtx.save();
  trailCtx.globalCompositeOperation = 'lighter';

  for (const stroke of trailStrokes) {
    renderTrailStrokeToCanvas(stroke);
  }

  trailCtx.restore();
}

function updateWaves(context, frameScale) {
  for (let i = waves.length - 1; i >= 0; i--) {
    const wave = waves[i];

    wave.update(context, frameScale);

    if (wave.dead) {
      waves.splice(i, 1);
      releaseWave(wave);
    }
  }
}

function updateSparks(context, clickFrameScale, trailFrameScale) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const spark = sparks[i];
    const frameScale = spark.fromClick ? clickFrameScale : trailFrameScale;

    spark.update(context, frameScale);

    if (spark.dead) {
      sparks.splice(i, 1);
      releaseSpark(spark);
    }
  }
}

function hasActiveEffects() {
  return (
    waves.length > 0 ||
    sparks.length > 0 ||
    trailStrokes.length > 0 ||
    isDown
  );
}

function animationLoop(now) {
  const deltaMs = Math.min(now - lastTime, CONFIG.maxDeltaMs);
  lastTime = now;

  const baseFrameScale = deltaMs / CONFIG.baseFrameMs;
  const clickFrameScale = baseFrameScale * CONFIG.clickSpeed;
  const trailFrameScale = baseFrameScale * CONFIG.trailSpeed;

  clearCanvas();

  updateTrailPoints(trailFrameScale);
  renderTrailToCanvas();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  ctx.drawImage(trailCanvas, 0, 0, width, height);

  updateWaves(ctx, clickFrameScale);
  updateSparks(ctx, clickFrameScale, trailFrameScale);

  ctx.restore();

  if (hasActiveEffects()) {
    requestAnimationFrame(animationLoop);
  } else {
    running = false;
    clearCanvas();
    clearTrailCanvas();
  }
}

function getPointerPos(event) {
  const rect = canvas.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function handlePointerMove(event)
{
  let events =
    typeof event.getCoalescedEvents === 'function'
      ? event.getCoalescedEvents()
      : [event];

  if (events.length === 0)
  {
    events = [event];
  }

  if (events.length > CONFIG.trail.maxCoalescedEvents)
  {
    const max = CONFIG.trail.maxCoalescedEvents;
    const sampled = [];

    for (let i = 0; i < max; i++)
    {
      const index = Math.round((events.length - 1) * (i / (max - 1)));
      sampled.push(events[index]);
    }

    events = sampled;
  }

  const shouldDrawTrail = CONFIG.trail.always || isDown;

  if (!shouldDrawTrail)
  {
    resetTrailInput();
    endTrailStroke();
    return;
  }

  let latestPos = null;

  for (const e of events)
  {
    let pos = getPointerPos(e);
    latestPos = pos;

    // 指数平滑：削减手动直线移动时的手抖微颤
    const sf = CONFIG.trail.smoothFactor;

    if (sf > 0)
    {
      if (trailSmoothX == null)
      {
        trailSmoothX = pos.x;
        trailSmoothY = pos.y;
      }
      else
      {
        trailSmoothX = trailSmoothX * sf + pos.x * (1 - sf);
        trailSmoothY = trailSmoothY * sf + pos.y * (1 - sf);
      }

      pos = { x: trailSmoothX, y: trailSmoothY };
    }

    if (!lastTrailPos)
    {
      lastTrailPos = pos;
      lastTrailEventTime = e.timeStamp || performance.now();

      if (!currentTrailStroke)
      {
        beginTrailStroke(pos.x, pos.y, trailSpeedFactor);
      }

      continue;
    }

    const eventTime = e.timeStamp || performance.now();
    const speedFactor = updateTrailSpeed(lastTrailPos, pos, eventTime);

    addInterpolatedTrailPoints(lastTrailPos, pos, speedFactor);
    spawnTrailShards(lastTrailPos, pos, speedFactor);

    lastTrailPos = pos;
  }

  if (latestPos && Math.random() < CONFIG.trail.moveSparkChance)
  {
    const angle = Math.random() * Math.PI * 2;
    const offset = rand(5, 22) * CONFIG.scale;
    const spark = getSpark(
      latestPos.x + Math.cos(angle) * offset,
      latestPos.y + Math.sin(angle) * offset,
      false,
    );

    tuneTrailShard(spark, angle, angle, trailSpeedFactor);
    sparks.push(spark);
  }

  requestRender();
}

window.addEventListener('pointerdown', (event) => {
  isDown = true;

  const pos = getPointerPos(event);

  // 重置平滑状态，避免新一笔被旧平滑值拖偏起始位置
  trailSmoothX = null;
  trailSmoothY = null;

  lastTrailPos = pos;
  lastTrailEventTime = event.timeStamp || performance.now();
  trailSpeedFactor = Math.max(trailSpeedFactor, 0.15);

  // 每次点击都创建新的 stroke。
  // 旧 stroke 继续自己消散，但不会和新点击位置连成一条“无中生有”的线。
  endTrailStroke();
  beginTrailStroke(pos.x, pos.y, trailSpeedFactor);

  createClickEffect(pos.x, pos.y);
});

window.addEventListener('pointermove', handlePointerMove, {
  passive: true,
});

window.addEventListener('pointerup', () => {
  isDown = false;

  // 松开时只结束当前 stroke，不清空旧 stroke。
  // 这样旧轨迹会正常从尾部消散，而下一次点击会创建新 stroke。
  resetTrailInput();
  endTrailStroke();
  requestRender();
});

window.addEventListener('pointercancel', () => {
  isDown = false;
  resetTrailInput();
  endTrailStroke();
  requestRender();
});

window.addEventListener('blur', () => {
  isDown = false;
  resetTrailInput();
  endTrailStroke();
  requestRender();
});

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'b') {
    createClickEffect(window.innerWidth / 2, window.innerHeight / 2);
  }
});

window.BASparkDemo = {
  setColor(r, g, b) {
    CONFIG.color = [r, g, b];
    requestRender();
  },

  setScale(scale) {
    CONFIG.scale = Math.max(0.5, Math.min(3, Number(scale) ?? 1.10));
    requestRender();
  },

  setOpacity(opacity) {
    CONFIG.opacity = Math.max(0.1, Math.min(1, Number(opacity) ?? 0.5));
    requestRender();
  },

  setSpeed(clickSpeed, trailSpeed = clickSpeed) {
    CONFIG.clickSpeed = Math.max(0.2, Math.min(3, Number(clickSpeed) ?? 1));
    CONFIG.trailSpeed = Math.max(0.2, Math.min(3, Number(trailSpeed) ?? 1));
    requestRender();
  },

  setDpr(maxDpr) {
    CONFIG.maxDpr = Math.max(1, Math.min(2, Number(maxDpr) ?? 1));
    resizeCanvas();
  },

  setTrailRenderScale(value) {
    CONFIG.trailRenderScale = Math.max(
      0.5,
      Math.min(1, Number(value) ?? 1),
    );

    resizeCanvas();
  },

  setGlow(enabled) {
    CONFIG.glow.enabled = Boolean(enabled);
    requestRender();
  },

  setFakeGlow(enabled) {
    CONFIG.glow.fake = Boolean(enabled);
    requestRender();
  },

  setClickFakeGlow(enabled) {
    CONFIG.glow.clickFake = Boolean(enabled);
    requestRender();
  },

  setRingRotationSpeed(value = 0.008) {
    CONFIG.rings.rotationSpeed = Math.max(0, Math.min(0.05, Number(value) ?? 0.008));
    requestRender();
  },

  setRingGlow(value = 0.35) {
    CONFIG.rings.emissionAlpha = Math.max(0, Math.min(1, Number(value) ?? 0.35));
    requestRender();
  },

  setRingWidth(value = 0.9) {
    CONFIG.rings.minW = Math.max(0.3, Math.min(3, Number(value) ?? 0.9));
    requestRender();
  },

  setRingAlpha(value = 0.9) {
    CONFIG.rings.alpha = Math.max(0.1, Math.min(1, Number(value) ?? 0.9));
    requestRender();
  },

  setTrailWhiteMix(value = 0.08) {
    CONFIG.trail.whiteMix = Math.max(0, Math.min(1, Number(value) ?? 0.08));
    requestRender();
  },

  setTrail(enabled) {
    CONFIG.trail.enabled = Boolean(enabled);
    requestRender();
  },

  setTrailAlways(enabled) {
    CONFIG.trail.always = Boolean(enabled);
    resetTrailInput();
    endTrailStroke();
    requestRender();
  },

  setTrailBrightness(alpha = 0.96, whiteMix = 0.08) {
    CONFIG.trail.alpha = Math.max(
      0.1,
      Math.min(1, Number(alpha) ?? 1),
    );

    CONFIG.trail.whiteMix = Math.max(
      0,
      Math.min(0.9, Number(whiteMix) ?? 0.08),
    );

    requestRender();
  },

  setTrailWidth(baseFast = 3, baseSlow = baseFast)
  {
    const fast = Number(baseFast);
    const slow = Number(baseSlow);
    const safeFast = Number.isFinite(fast) ? fast : 3;
    const safeSlow = Number.isFinite(slow) ? slow : safeFast;

    CONFIG.trail.baseWidthFast = Math.max(
      0.5,
      Math.min(6, safeFast),
    );

    CONFIG.trail.baseWidthSlow = Math.max(
      0.3,
      Math.min(CONFIG.trail.baseWidthFast, safeSlow),
    );

    requestRender();
  },

  setTrailLayerAlpha(
    main = 1,
    core = 0.92,
    hot = 0.58,
    glow = 0.18,
    softGlow = 0.045,
    rail = 0.02,
  )
  {
    CONFIG.trail.mainAlpha = Math.max(0, Math.min(1, Number(main) ?? 1));
    CONFIG.trail.coreAlpha = Math.max(0, Math.min(1, Number(core) ?? 0.92));
    CONFIG.trail.hotAlpha = Math.max(0, Math.min(1, Number(hot) ?? 0.58));
    CONFIG.trail.glowAlpha = Math.max(0, Math.min(1, Number(glow) ?? 0.18));
    CONFIG.trail.softGlowAlpha = Math.max(
      0,
      Math.min(1, Number(softGlow) ?? 0.045),
    );
    CONFIG.trail.railAlpha = Math.max(0, Math.min(1, Number(rail) ?? 0.02));

    requestRender();
  },

  // 轨迹长度：速度越快越接近 lengthFast
  setTrailLength(lengthSlow = 900, lengthFast = 4200) {
    CONFIG.trail.lengthSlow = Math.max(
      20,
      Math.min(5000, Number(lengthSlow) ?? 900),
    );

    CONFIG.trail.lengthFast = Math.max(
      CONFIG.trail.lengthSlow + 20,
      Math.min(8000, Number(lengthFast) ?? 4200),
    );

    requestRender();
  },

  // 轨迹寿命：决定松开鼠标后消散持续时间。
  // 默认 slow/fast 相同：移动速度只影响轨迹长度，不影响消散时间。
  setTrailLife(lifeSlow = 22, lifeFast = 22) {
    CONFIG.trail.lifeSlow = Math.max(
      5,
      Math.min(400, Number(lifeSlow) ?? 22),
    );

    CONFIG.trail.lifeFast = Math.max(
      CONFIG.trail.lifeSlow,
      Math.min(600, Number(lifeFast) ?? 22),
    );

    requestRender();
  },

  // 控制从尾部到头部的消散速度
  setTrailDecay(tailDecayMul = 1.28, headDecayMul = 0.95, releaseDecayMul = 1.18) {
    CONFIG.trail.tailDecayMul = Math.max(
      0.1,
      Math.min(5, Number(tailDecayMul) ?? 1.28),
    );

    CONFIG.trail.headDecayMul = Math.max(
      0.1,
      Math.min(CONFIG.trail.tailDecayMul, Number(headDecayMul) ?? 0.95),
    );

    CONFIG.trail.releaseDecayMul = Math.max(
      0.5,
      Math.min(12, Number(releaseDecayMul) ?? 1.18),
    );

    requestRender();
  },

  setTrailSpeedDecay(value = 0.988) {
    CONFIG.trail.speedDecay = Math.max(
      0.8,
      Math.min(0.999, Number(value) ?? 0.988),
    );

    requestRender();
  },

  setTrailSpeedRange(speedMin = 0.035, speedMax = 2.2) {
    CONFIG.trail.speedMin = Math.max(0, Number(speedMin) ?? 0.035);

    CONFIG.trail.speedMax = Math.max(
      CONFIG.trail.speedMin + 0.1,
      Number(speedMax) ?? 2.2,
    );

    requestRender();
  },

  setTrailSampling(sampleStep = 0.85, maxInterpolatedPoints = 80) {
    CONFIG.trail.sampleStep = Math.max(
      0.3,
      Math.min(12, Number(sampleStep) ?? 0.85),
    );

    CONFIG.trail.maxInterpolatedPoints = Math.max(
      2,
      Math.min(160, Number(maxInterpolatedPoints) ?? 80),
    );

    requestRender();
  },

  setTrailRenderSampling(renderStep = 0.75, renderMaxPoints = 2400) {
    CONFIG.trail.renderStep = Math.max(
      0.3,
      Math.min(8, Number(renderStep) ?? 0.75),
    );

    CONFIG.trail.renderMaxPoints = Math.max(
      60,
      Math.min(3600, Number(renderMaxPoints) ?? 2400),
    );

    requestRender();
  },

  setMoveSparkChance(value = 0) {
    CONFIG.trail.moveSparkChance = Math.max(
      0,
      Math.min(0.05, Number(value) ?? 0),
    );
  },

  setShardSpacing(value = 220) {
    CONFIG.trail.shardSpacing = Math.max(20, Math.min(500, Number(value) ?? 220));
    requestRender();
  },

  setShardChance(slow = 0.04, fast = 0.18) {
    CONFIG.trail.shardChanceSlow = Math.max(0, Math.min(1, Number(slow) ?? 0.04));
    CONFIG.trail.shardChanceFast = Math.max(CONFIG.trail.shardChanceSlow, Math.min(1, Number(fast) ?? 0.18));
    requestRender();
  },

  setShardLargeChance(value = 0.62)
  {
    CONFIG.trail.shardLargeChance = Math.max(0, Math.min(1, Number(value) ?? 0.62));
    requestRender();
  },

  setTrailSmooth(value = 0.5) {
    CONFIG.trail.smoothFactor = Math.max(0, Math.min(0.9, Number(value) ?? 0.5));
    trailSmoothX = null;
    trailSmoothY = null;
    requestRender();
  },

  setMaxShards(value = 38) {
    CONFIG.trail.maxSparkParticles = Math.max(0, Math.min(200, Number(value) ?? 38));
    requestRender();
  },

  clearTrail() {
    resetTrailAll();
    requestRender();
  },

  boom(x = window.innerWidth / 2, y = window.innerHeight / 2) {
    createClickEffect(x, y);
  },

  // 返回当前配置的深拷贝，方便调试和读取运行时参数
  getConfig() {
    return JSON.parse(JSON.stringify(CONFIG));
  },

  // 恢复所有配置为默认值（等同于点击重置按钮）
  resetConfig() {
    const btn = document.getElementById('btnReset');

    if (btn)
    {
      btn.click();
    }
  },

  // 直接引用 CONFIG 对象（只读推荐，直接修改可能不触发重绘）
  CONFIG,

  // 导出面板设置为 JSON 字符串，方便保存和分享
  saveSettings() {
    const data = {};

    for (let i = 0; i < localStorage.length; i++)
    {
      const key = localStorage.key(i);

      if (key.startsWith('bafx-'))
      {
        data[key.slice(5)] = localStorage.getItem(key);
      }
    }

    return JSON.stringify(data, null, 2);
  },

  // 导入面板设置并立即应用
  loadSettings(json) {
    let data;

    try { data = JSON.parse(json); } catch (e) { return false; }

    for (const [id, val] of Object.entries(data))
    {
      const el = document.getElementById(id);

      if (!el) { continue; }

      if (el.type === 'checkbox')
      {
        el.checked = val === 'true';
      }
      else
      {
        el.value = val;
      }

      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    return true;
  },
};

// ── 控制面板 & 交互提示 ──────────────────────────────────────────────────

(function initUI() {
  const api = window.BASparkDemo;
  const SETTINGS_VERSION = '2026-07-07-trail-render-fast-1';

  if (localStorage.getItem('bafx-version') !== SETTINGS_VERSION)
  {
    for (const key of Object.keys(localStorage))
    {
      if (key.startsWith('bafx-'))
      {
        localStorage.removeItem(key);
      }
    }

    localStorage.setItem('bafx-version', SETTINGS_VERSION);
  }

  // -- 默认值（用于重置）--
  const DEFAULTS = {
    color: '#12b2ff',
    scale: 1.10,
    opacity: 0.5,
    clickSpeed: 1,
    trailSpeed: 1.05,
    trail: true,
    trailAlways: false,
    trailWidth: 3,
    trailLength: 900,
    trailLife: 22,
    fakeGlow: true,
    clickFake: true,
    glow: false,
    shardSpacing: 220,
    shardChanceSlow: 0.04,
    shardChanceFast: 0.18,
    shardLargeChance: 0.62,
    maxShards: 38,
    smooth: 0.5,
    dpr: 1,
    trailRenderScale: 1,
    ringRotation: 0.008,
    ringGlow: 0.35,
    ringWidth: 0.9,
    ringAlpha: 0.9,
    trailBrightness: 0.96,
    trailWhiteMix: 0.08,
  };

  // -- 面板开关 --
  const panel = document.getElementById('panel');
  const toggleBtn = document.getElementById('panelToggle');
  const closeBtn = document.getElementById('panelClose');

  function openPanel() {
    panel.classList.add('open');
    toggleBtn.classList.add('active');
  }
  function closePanel() {
    panel.classList.remove('open');
    toggleBtn.classList.remove('active');
  }

  toggleBtn.addEventListener('click', () => {
    panel.classList.contains('open') ? closePanel() : openPanel();
  });
  closeBtn.addEventListener('click', closePanel);

  // -- 提示栏关闭 --
  const hintBar = document.getElementById('hintBar');
  document.getElementById('hintDismiss').addEventListener('click', () => {
    hintBar.classList.add('hidden');
  });

  // -- 工具函数 --
  function bindRange(id, outputId, setter, intOnly = false) {
    const input = document.getElementById(id);
    const output = document.getElementById(outputId);

    if (!input) { return; }

    input.addEventListener('input', () => {
      const v = intOnly ? parseInt(input.value, 10) : parseFloat(input.value);
      output.textContent = intOnly ? v : v.toFixed(2);
      setter(v);
      localStorage.setItem('bafx-' + id, input.value);
    });
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // -- 绑定控件 --
  const ctrlColor = document.getElementById('ctrlColor');
  ctrlColor.addEventListener('input', () => {
    const [r, g, b] = hexToRgb(ctrlColor.value);
    api.setColor(r, g, b);
    localStorage.setItem('bafx-ctrlColor', ctrlColor.value);
  });

  bindRange('ctrlScale', 'outScale', v => api.setScale(v));
  bindRange('ctrlOpacity', 'outOpacity', v => api.setOpacity(v));
  bindRange('ctrlClickSpeed', 'outClickSpeed', v => {
    const ts = parseFloat(document.getElementById('ctrlTrailSpeed').value);
    api.setSpeed(v, ts);
  });
  bindRange('ctrlTrailSpeed', 'outTrailSpeed', v => {
    const cs = parseFloat(document.getElementById('ctrlClickSpeed').value);
    api.setSpeed(cs, v);
  });

  const ctrlTrail = document.getElementById('ctrlTrail');
  ctrlTrail.addEventListener('change', () => { api.setTrail(ctrlTrail.checked); localStorage.setItem('bafx-ctrlTrail', ctrlTrail.checked); });

  const ctrlTrailAlways = document.getElementById('ctrlTrailAlways');
  ctrlTrailAlways.addEventListener('change', () => { api.setTrailAlways(ctrlTrailAlways.checked); localStorage.setItem('bafx-ctrlTrailAlways', ctrlTrailAlways.checked); });

  bindRange('ctrlTrailWidth', 'outTrailWidth', v => api.setTrailWidth(v));

  bindRange('ctrlTrailLength', 'outTrailLength', v => api.setTrailLength(v), true);
  bindRange('ctrlTrailLife', 'outTrailLife', v => api.setTrailLife(v), true);

  const ctrlFakeGlow = document.getElementById('ctrlFakeGlow');
  ctrlFakeGlow.addEventListener('change', () => { api.setFakeGlow(ctrlFakeGlow.checked); localStorage.setItem('bafx-ctrlFakeGlow', ctrlFakeGlow.checked); });

  const ctrlGlow = document.getElementById('ctrlGlow');
  ctrlGlow.addEventListener('change', () => { api.setGlow(ctrlGlow.checked); localStorage.setItem('bafx-ctrlGlow', ctrlGlow.checked); });

  const ctrlClickFakeGlow = document.getElementById('ctrlClickFakeGlow');
  ctrlClickFakeGlow.addEventListener('change', () => { api.setClickFakeGlow(ctrlClickFakeGlow.checked); localStorage.setItem('bafx-ctrlClickFakeGlow', ctrlClickFakeGlow.checked); });

  bindRange('ctrlShardSpacing', 'outShardSpacing', v => api.setShardSpacing(v), true);

  bindRange('ctrlShardChanceSlow', 'outShardChanceSlow', v => {
    const fast = parseFloat(document.getElementById('ctrlShardChanceFast').value);
    api.setShardChance(v, fast);
  });

  bindRange('ctrlShardChanceFast', 'outShardChanceFast', v => {
    const slow = parseFloat(document.getElementById('ctrlShardChanceSlow').value);
    api.setShardChance(slow, v);
  });

  bindRange('ctrlShardLargeChance', 'outShardLargeChance', v => api.setShardLargeChance(v));
  bindRange('ctrlMaxShards', 'outMaxShards', v => api.setMaxShards(v), true);

  bindRange('ctrlSmooth', 'outSmooth', v => api.setTrailSmooth(v));

  bindRange('ctrlDpr', 'outDpr', v => api.setDpr(v), true);
  bindRange('ctrlTrailRenderScale', 'outTrailRenderScale', v => api.setTrailRenderScale(v));

  bindRange('ctrlRingRotation', 'outRingRotation', v => api.setRingRotationSpeed(v));
  bindRange('ctrlRingGlow', 'outRingGlow', v => api.setRingGlow(v));
  bindRange('ctrlRingWidth', 'outRingWidth', v => api.setRingWidth(v));
  bindRange('ctrlRingAlpha', 'outRingAlpha', v => api.setRingAlpha(v));

  bindRange('ctrlTrailAlpha', 'outTrailAlpha', v => api.setTrailBrightness(v));
  bindRange('ctrlTrailWhiteMix', 'outTrailWhiteMix', v => api.setTrailWhiteMix(v));

  // -- 重置 --
  document.getElementById('btnReset').addEventListener('click', () => {
    ctrlColor.value = DEFAULTS.color;
    const [r, g, b] = hexToRgb(DEFAULTS.color);
    api.setColor(r, g, b);

    const setVal = (id, outId, val, intOnly = false) => {
      const el = document.getElementById(id);
      const out = document.getElementById(outId);

      if (!el || !out) { return; }

      el.value = val;
      out.textContent = intOnly ? val : Number(val).toFixed(2);
    };

    setVal('ctrlScale', 'outScale', DEFAULTS.scale);
    setVal('ctrlOpacity', 'outOpacity', DEFAULTS.opacity);
    setVal('ctrlClickSpeed', 'outClickSpeed', DEFAULTS.clickSpeed);
    setVal('ctrlTrailSpeed', 'outTrailSpeed', DEFAULTS.trailSpeed);
    setVal('ctrlTrailWidth', 'outTrailWidth', DEFAULTS.trailWidth);

    api.setScale(DEFAULTS.scale);
    api.setOpacity(DEFAULTS.opacity);
    api.setSpeed(DEFAULTS.clickSpeed, DEFAULTS.trailSpeed);
    api.setTrailWidth(DEFAULTS.trailWidth);

    setVal('ctrlTrailLength', 'outTrailLength', DEFAULTS.trailLength, true);
    setVal('ctrlTrailLife', 'outTrailLife', DEFAULTS.trailLife, true);
    api.setTrailLength(DEFAULTS.trailLength);
    api.setTrailLife(DEFAULTS.trailLife);

    ctrlTrail.checked = DEFAULTS.trail;
    ctrlTrailAlways.checked = DEFAULTS.trailAlways;
    ctrlFakeGlow.checked = DEFAULTS.fakeGlow;
    ctrlGlow.checked = DEFAULTS.glow;
    ctrlClickFakeGlow.checked = DEFAULTS.clickFake;

    api.setTrail(DEFAULTS.trail);
    api.setTrailAlways(DEFAULTS.trailAlways);
    api.setFakeGlow(DEFAULTS.fakeGlow);
    api.setGlow(DEFAULTS.glow);
    api.setClickFakeGlow(DEFAULTS.clickFake);

    // 碎片
    setVal('ctrlShardSpacing', 'outShardSpacing', DEFAULTS.shardSpacing, true);
    setVal('ctrlMaxShards', 'outMaxShards', DEFAULTS.maxShards, true);
    setVal('ctrlShardChanceSlow', 'outShardChanceSlow', DEFAULTS.shardChanceSlow);
    setVal('ctrlShardChanceFast', 'outShardChanceFast', DEFAULTS.shardChanceFast);
    setVal('ctrlShardLargeChance', 'outShardLargeChance', DEFAULTS.shardLargeChance);

    api.setShardSpacing(DEFAULTS.shardSpacing);
    api.setShardChance(DEFAULTS.shardChanceSlow, DEFAULTS.shardChanceFast);
    api.setShardLargeChance(DEFAULTS.shardLargeChance);
    api.setMaxShards(DEFAULTS.maxShards);

    setVal('ctrlSmooth', 'outSmooth', DEFAULTS.smooth);
    api.setTrailSmooth(DEFAULTS.smooth);

    setVal('ctrlDpr', 'outDpr', DEFAULTS.dpr, true);
    api.setDpr(DEFAULTS.dpr);

    setVal('ctrlTrailRenderScale', 'outTrailRenderScale', DEFAULTS.trailRenderScale);
    api.setTrailRenderScale(DEFAULTS.trailRenderScale);
    setVal('ctrlRingRotation', 'outRingRotation', DEFAULTS.ringRotation);
    api.setRingRotationSpeed(DEFAULTS.ringRotation);
    setVal('ctrlRingGlow', 'outRingGlow', DEFAULTS.ringGlow);
    api.setRingGlow(DEFAULTS.ringGlow);
    setVal('ctrlRingWidth', 'outRingWidth', DEFAULTS.ringWidth);
    api.setRingWidth(DEFAULTS.ringWidth);
    setVal('ctrlRingAlpha', 'outRingAlpha', DEFAULTS.ringAlpha);
    api.setRingAlpha(DEFAULTS.ringAlpha);
    setVal('ctrlTrailAlpha', 'outTrailAlpha', DEFAULTS.trailBrightness);
    api.setTrailBrightness(DEFAULTS.trailBrightness);
    setVal('ctrlTrailWhiteMix', 'outTrailWhiteMix', DEFAULTS.trailWhiteMix);
    api.setTrailWhiteMix(DEFAULTS.trailWhiteMix);
    localStorage.clear();
  });
  const saved = {};

  for (let i = 0; i < localStorage.length; i++)
  {
    const key = localStorage.key(i);

    if (key.startsWith('bafx-'))
    {
      saved[key.slice(5)] = localStorage.getItem(key);
    }
  }

  for (const [id, val] of Object.entries(saved))
  {
    const el = document.getElementById(id);

    if (!el) { continue; }

    if (el.type === 'checkbox')
    {
      el.checked = val === 'true';
    }
    else
    {
      el.value = val;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
})();
