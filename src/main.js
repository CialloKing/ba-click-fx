import './style.css';
import { clamp01, rand, pick, easeOutCubic, smoothstep, distance, lerp, rgbToCss, mixColor, getArcWeight } from './utils.js';
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
  blur = 0,
  useFakeGlow,
)
{
  if (alpha <= 0) {
    return;
  }

  context.save();
  context.translate(x, y);
  context.rotate(rotation);

  if (useFakeGlow && CONFIG.glow.fake) {
    context.fillStyle = rgbToCss(color, alpha * 0.18);
    context.beginPath();
    context.moveTo(0, -size * 1.55);
    context.lineTo(size * 0.95, size * 0.9);
    context.lineTo(-size * 0.95, size * 0.9);
    context.closePath();
    context.fill();
  }

  if (CONFIG.glow.enabled && blur > 0) {
    context.shadowColor = rgbToCss(color, alpha);
    context.shadowBlur = blur * 0.28;
  }

  const sideX = useFakeGlow ? 0.62 : 0.6;
  const sideY = useFakeGlow ? 0.58 : 0.6;

  context.fillStyle = rgbToCss(color, alpha);
  context.beginPath();
  context.moveTo(0, -size);
  context.lineTo(size * sideX, size * sideY);
  context.lineTo(-size * sideX, size * sideY);
  context.closePath();
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
  context.lineCap = 'butt';
  context.strokeStyle = rgbToCss(color, alpha);
  context.lineWidth = widthValue;

  context.beginPath();
  context.arc(x, y, radius, start, end);
  context.stroke();

  context.restore();
}

class ClickWave {
  constructor() {
    this.dead = true;
  }

  reset(x, y) {
    const rings = CONFIG.rings;

    this.x = x;
    this.y = y;
    this.life = 0;
    this.r = 0;
    this.dead = false;

    this.ring = {
      ang: Math.random() * Math.PI * 2,
      rs: pick(rings.rsList),
      segs: [
        {
          off: 0,
          len: rings.len,
          rRoundRate: pick(rings.rRoundRateList),
        },
        {
          off: rand(-1.5, 1.5) * Math.PI,
          len: rings.len,
          rRoundRate: pick(rings.rRoundRateList),
        },
      ],
    };
  }

  update(context, frameScale) {
    this.life += frameScale;

    this.drawFilledCircle(context);
    this.drawRings(context, frameScale);

    const maxLife = Math.max(
      CONFIG.filledCircle.maxLife,
      CONFIG.rings.maxLife,
    );

    if (this.life >= maxLife) {
      this.dead = true;
    }
  }

  drawFilledCircle(context) {
    const cfg = CONFIG.filledCircle;
    const clickScale = getClickScale();
    const progress = clamp01(this.life / cfg.maxLife);

    if (progress >= 1) {
      return;
    }

    // 游戏原作：从可见小圆快速扩展到大圆，同时白色闪变为蓝
    const expandT = Math.min(progress * 8, 1);
    const scale = 0.25 + 0.75 * expandT;
    const radius = cfg.rAddRate * clickScale * scale;
    const color = mixColor(CONFIG.startColor, CONFIG.color, expandT);
    const alpha = (1 - progress) * CONFIG.opacity;

    this.r = radius;

    // BASpark 只绘制一层中心圆，点击反馈比多层光晕更利落。
    // blur 用于真实发光和可选的点击伪发光
    const blur = (CONFIG.glow.clickFake || CONFIG.glow.enabled) ? radius * 0.65 : 0;
    drawCircle(
      context,
      this.x,
      this.y,
      radius,
      color,
      alpha,
      blur,
      CONFIG.glow.clickFake,
    );
  }

  drawRings(context, frameScale) {
    const cfg = CONFIG.rings;
    const clickScale = getClickScale();
    const progress = clamp01(this.life / cfg.maxLife);

    if (progress >= 1) {
      return;
    }

    this.ring.ang -= this.ring.rs * frameScale;

    const colorT = Math.min(1.2 * progress, 1);
    const color = mixColor(CONFIG.startColor, getClickRingEndColor(), colorT);

    const ringAlpha = Math.min(1.1 - 0.3 * progress, 1) * CONFIG.opacity;
    const lineWidthMul = Math.min(-0.8 * (progress - 0.8) + 1, 1);

    for (const seg of this.ring.segs) {
      const base = this.ring.ang + seg.off;

      let start;
      let end;

      if (progress <= cfg.lenStopAddPoint) {
        const currentLen = seg.len * (progress / cfg.lenStopAddPoint);
        end = base + seg.len;
        start = end - currentLen;
      } else if (progress > cfg.lenStartDimPoint) {
        const currentLen =
          seg.len *
          (1 -
            (progress - cfg.lenStartDimPoint) /
              (1 - cfg.lenStartDimPoint));

        start = base;
        end = start + currentLen;
      } else {
        start = base;
        end = start + seg.len;
      }

      const radius = this.r + seg.rRoundRate * clickScale;

      for (let i = 0; i < cfg.segNum; i++) {
        const t0 = i / cfg.segNum;
        const t1 = (i + 1) / cfg.segNum;

        const a0 = start + (end - start) * t0;
        const a1 = start + (end - start) * t1;

        const weight = getArcWeight(t0);
        const lineWidth =
          (cfg.minW * (1 - weight) + cfg.maxW * weight) *
          lineWidthMul;

        drawArcSegment(
          context,
          this.x,
          this.y,
          radius,
          a0,
          a1,
          lineWidth,
          color,
          ringAlpha,
        );
      }
    }
  }
}

class SparkParticle {
  constructor() {
    this.dead = true;
  }

  reset(x, y, fromClick = true) {
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
    this.alphaDecay = 0.032;
    this.friction = fromClick ? 0.9 : 0.95;
    this.color = fromClick
      ? [255, 255, 255]
      : mixColor(CONFIG.color, [255, 255, 255], rand(0.28, 0.82));
    this.blur = fromClick ? (2.0 * particleScale) : (2.8 * CONFIG.scale);
    this.useFakeGlow = fromClick ? CONFIG.glow.clickFake : true;
    this.fromClick = fromClick;
    this.dead = false;
  }

  update(context, frameScale) {
    this.x += this.vx * frameScale;
    this.y += this.vy * frameScale;

    this.vx *= Math.pow(this.friction, frameScale);
    this.vy *= Math.pow(this.friction, frameScale);

    this.rotation += this.rotationSpeed * frameScale;
    this.alpha -= this.alphaDecay * frameScale;

    drawTriangle(
      context,
      this.x,
      this.y,
      this.size,
      this.rotation,
      this.color,
      this.alpha * CONFIG.opacity,
      this.blur,
      this.useFakeGlow,
    );

    if (this.alpha <= 0) {
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

function getSpark(x, y, fromClick) {
  const spark = sparkPool.pop() ?? new SparkParticle();
  spark.reset(x, y, fromClick);
  return spark;
}

function tuneTrailShard(spark, tangentAngle, normalAngle, speedFactor)
{
  const cfg = CONFIG.trail;
  const isLarge = Math.random() < cfg.shardLargeChance;
  const scale = CONFIG.scale;
  const drift = rand(0.04, 0.36) * (0.72 + speedFactor * 0.5);
  const tangentDrift = rand(-0.14, 0.22);
  const whiteMix = isLarge ? rand(0.56, 0.92) : rand(0.24, 0.76);

  spark.vx = Math.cos(normalAngle) * drift + Math.cos(tangentAngle) * tangentDrift;
  spark.vy = Math.sin(normalAngle) * drift + Math.sin(tangentAngle) * tangentDrift;

  // 大碎片更慢、更亮，能形成截图里沿轨迹漂浮的三角片。
  spark.size = (isLarge ? rand(7.4, 12.2) : rand(4.2, 6.4)) * scale;
  spark.alpha = isLarge ? rand(0.42, 0.76) : rand(0.28, 0.56);
  spark.alphaDecay = isLarge ? rand(0.016, 0.028) : rand(0.026, 0.046);
  spark.friction = isLarge ? rand(0.978, 0.99) : rand(0.965, 0.982);
  spark.rotation = normalAngle + rand(-1.2, 1.2);
  spark.rotationSpeed = rand(-0.055, 0.075);
  spark.color = mixColor(CONFIG.color, [255, 255, 255], whiteMix);
  spark.blur = (isLarge ? rand(0.7, 1.6) : rand(0.15, 0.65)) * scale;
  spark.useFakeGlow = true;
}

function spawnTrailShards(from, to, speedFactor)
{
  const cfg = CONFIG.trail;
  const dist = distance(from, to);

  if (dist < 2 || sparks.length >= cfg.maxSparkParticles)
  {
    return;
  }

  const spacing = cfg.shardSpacing * CONFIG.scale;
  trailShardDistance += dist;

  if (trailShardDistance < spacing)
  {
    return;
  }

  const attempts = Math.max(1, Math.floor(trailShardDistance / spacing));

  trailShardDistance %= spacing;

  const spawnChance = lerp(
    cfg.shardChanceSlow,
    cfg.shardChanceFast,
    clamp01(speedFactor),
  );
  const tangentAngle = Math.atan2(to.y - from.y, to.x - from.x);

  for (let i = 0; i < attempts; i++)
  {
    if (sparks.length >= cfg.maxSparkParticles || Math.random() > spawnChance)
    {
      continue;
    }

    const t = rand(0.25, 0.95);
    const side = Math.random() < 0.5 ? -1 : 1;
    const normalAngle = tangentAngle + side * Math.PI / 2;
    const offset =
      rand(cfg.shardOffsetMin, cfg.shardOffsetMax) *
      CONFIG.scale *
      (0.9 + speedFactor * 0.18);
    const x = lerp(from.x, to.x, t) + Math.cos(normalAngle) * offset;
    const y = lerp(from.y, to.y, t) + Math.sin(normalAngle) * offset;
    const spark = getSpark(x, y, false);

    tuneTrailShard(spark, tangentAngle, normalAngle, speedFactor);
    sparks.push(spark);
  }
}

function releaseSpark(spark) {
  spark.dead = true;

  if (sparkPool.length < 256) {
    sparkPool.push(spark);
  }
}

function createClickEffect(x, y) {
  waves.push(getWave(x, y));

  for (let i = 0; i < CONFIG.sparksCount; i++) {
    sparks.push(getSpark(x, y, true));
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

function getTrailStopAlpha(stops, offset)
{
  const progress = clamp01(offset);

  if (stops.length === 0)
  {
    return 0;
  }

  const first = stops[0];

  if (progress <= first[0])
  {
    return clamp01(first[1]);
  }

  for (let i = 1; i < stops.length; i++)
  {
    const prev = stops[i - 1];
    const next = stops[i];

    if (progress <= next[0])
    {
      const range = next[0] - prev[0];
      const t = range === 0 ? 1 : (progress - prev[0]) / range;

      return clamp01(lerp(prev[1], next[1], t));
    }
  }

  return clamp01(stops[stops.length - 1][1]);
}

function getTrailStopValue(stops, offset, fallback = 1)
{
  if (!stops || stops.length === 0)
  {
    return fallback;
  }

  return getTrailStopAlpha(stops, offset);
}

function strokeTrailChunk(
  context,
  points,
  startIndex,
  endIndex,
  options,
  alpha,
  widthScale,
)
{
  const {
    widthValue,
    color,
    minWidth = 0,
  } = options;
  const lineWidth = Math.max(minWidth, widthValue * widthScale);

  if (alpha <= 0 || lineWidth <= 0 || endIndex <= startIndex)
  {
    return;
  }

  context.strokeStyle = rgbToCss(color, alpha);
  context.lineWidth = lineWidth;
  context.lineCap = 'butt';
  context.lineJoin = 'round';

  context.beginPath();
  context.moveTo(points[startIndex].x, points[startIndex].y);

  for (let i = startIndex + 1; i <= endIndex; i++)
  {
    context.lineTo(points[i].x, points[i].y);
  }

  context.stroke();
}

function strokeFullTrailPath(context, points, options)
{
  const {
    widthValue,
    stops,
    widthStops,
  } = options;

  const totalLength =
    points.totalLength ??
    points[points.length - 1]?.distanceFromTail ??
    0;

  if (points.length < 2 || widthValue <= 0 || totalLength <= 0)
  {
    return;
  }

  const chunkLength = Math.max(1, CONFIG.trail.gradientChunkLength);

  context.save();

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

    // Canvas 的线性渐变按首尾直线投影，不按真实路径长度计算。
    // 圆形轨迹里首尾点靠近时会让端帽被错误点亮，所以这里分段沿路径采样透明度。
    const midpointDistance =
      (points[startIndex].distanceFromTail + points[i].distanceFromTail) / 2;
    const progress = midpointDistance / totalLength;
    const alpha = getTrailStopAlpha(stops, progress);
    const widthScale = getTrailStopValue(widthStops, progress);

    strokeTrailChunk(
      context,
      points,
      startIndex,
      i,
      options,
      alpha,
      widthScale,
    );

    startIndex = i;
  }

  context.restore();
}

function renderTrailStrokeToCanvas(stroke) {
  if (!stroke || stroke.length < 2) {
    return;
  }

  const renderPoints = buildTrailRenderPoints(stroke);

  if (renderPoints.length < 2) {
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

  // stroke 快结束时整体稍微淡出，避免最后一个头部亮点突然消失。
  const headLifeRatio = head.maxLife > 0 ? clamp01(head.life / head.maxLife) : 1;
  const fadeMul = smoothstep(0.05, 0.45, headLifeRatio);

  // 1. 细暗轨道：截图里旧轨迹会保留一条很细的蓝线。
  strokeFullTrailPath(trailCtx, renderPoints, {
    widthValue: railWidth,
    minWidth: 0.22 * CONFIG.scale,
    color: CONFIG.color,
    widthStops: [
      [0.0, 0.38],
      [0.35, 0.52],
      [0.72, 0.72],
      [1.0, 0.52],
    ],
    stops: [
      [0.0, CONFIG.trail.railAlpha * 0.16 * CONFIG.trail.alpha * fadeMul],
      [0.22, CONFIG.trail.railAlpha * 0.34 * CONFIG.trail.alpha * fadeMul],
      [0.62, CONFIG.trail.railAlpha * 0.58 * CONFIG.trail.alpha * fadeMul],
      [1.0, CONFIG.trail.railAlpha * 0.3 * CONFIG.trail.alpha * fadeMul],
    ],
  });

  // 2. 柔和外光：用更宽、更淡的分段线模拟截图里的蓝色扩散。
  if (CONFIG.glow.fake) {
    strokeFullTrailPath(trailCtx, renderPoints, {
      widthValue: baseWidth * CONFIG.trail.softGlowWidthMul,
      color: CONFIG.color,
      widthStops: [
        [0.0, 0.18],
        [0.42, 0.55],
        [0.78, 0.92],
        [1.0, 1.0],
      ],
      stops: [
        [0.0, 0.0],
        [0.22, CONFIG.trail.softGlowAlpha * 0.18 * CONFIG.trail.alpha * fadeMul],
        [0.52, CONFIG.trail.softGlowAlpha * 0.58 * CONFIG.trail.alpha * fadeMul],
        [0.82, CONFIG.trail.softGlowAlpha * CONFIG.trail.alpha * fadeMul],
        [1.0, CONFIG.trail.softGlowAlpha * 0.72 * CONFIG.trail.alpha * fadeMul],
      ],
    });

    strokeFullTrailPath(trailCtx, renderPoints, {
      widthValue: baseWidth * CONFIG.trail.glowWidthMul,
      color: trailColor,
      widthStops: [
        [0.0, 0.22],
        [0.38, 0.54],
        [0.76, 0.88],
        [1.0, 1.0],
      ],
      stops: [
        [0.0, 0.0],
        [0.2, CONFIG.trail.glowAlpha * 0.16 * CONFIG.trail.alpha * fadeMul],
        [0.5, CONFIG.trail.glowAlpha * 0.48 * CONFIG.trail.alpha * fadeMul],
        [0.82, CONFIG.trail.glowAlpha * CONFIG.trail.alpha * fadeMul],
        [1.0, CONFIG.trail.glowAlpha * 0.82 * CONFIG.trail.alpha * fadeMul],
      ],
    });
  }

  // 3. 主蓝色轨迹：宽度沿路径变细，避免尾部像等宽线。
  strokeFullTrailPath(trailCtx, renderPoints, {
    widthValue: baseWidth,
    color: trailColor,
    widthStops: [
      [0.0, 0.24],
      [0.28, 0.46],
      [0.58, 0.82],
      [0.86, 1.0],
      [1.0, 0.88],
    ],
    stops: [
      [0.0, CONFIG.trail.mainAlpha * 0.04 * CONFIG.trail.alpha * fadeMul],
      [0.16, CONFIG.trail.mainAlpha * 0.14 * CONFIG.trail.alpha * fadeMul],
      [0.44, CONFIG.trail.mainAlpha * 0.48 * CONFIG.trail.alpha * fadeMul],
      [0.74, CONFIG.trail.mainAlpha * CONFIG.trail.alpha * fadeMul],
      [1.0, CONFIG.trail.mainAlpha * 0.86 * CONFIG.trail.alpha * fadeMul],
    ],
  });

  // 4. 中心浅蓝高光，覆盖更长的亮弧。
  strokeFullTrailPath(trailCtx, renderPoints, {
    widthValue: coreWidth,
    color: trailCoreColor,
    widthStops: [
      [0.0, 0.16],
      [0.42, 0.42],
      [0.72, 0.9],
      [1.0, 0.75],
    ],
    stops: [
      [0.0, 0.0],
      [0.34, CONFIG.trail.coreAlpha * 0.08 * CONFIG.trail.alpha * fadeMul],
      [0.58, CONFIG.trail.coreAlpha * 0.42 * CONFIG.trail.alpha * fadeMul],
      [0.86, CONFIG.trail.coreAlpha * CONFIG.trail.alpha * fadeMul],
      [1.0, CONFIG.trail.coreAlpha * 0.62 * CONFIG.trail.alpha * fadeMul],
    ],
  });

  // 5. 蓝白高光：不是只亮头部，而是让最近一段弧线持续发亮。
  strokeFullTrailPath(trailCtx, renderPoints, {
    widthValue: hotWidth,
    color: trailHotColor,
    widthStops: [
      [0.0, 0.0],
      [0.52, 0.35],
      [0.78, 1.0],
      [1.0, 0.62],
    ],
    stops: [
      [0.0, 0.0],
      [0.46, 0.0],
      [0.66, CONFIG.trail.hotAlpha * 0.28 * CONFIG.trail.alpha * fadeMul],
      [0.86, CONFIG.trail.hotAlpha * CONFIG.trail.alpha * fadeMul],
      [1.0, CONFIG.trail.hotAlpha * 0.48 * CONFIG.trail.alpha * fadeMul],
    ],
  });

  const headRadius = lerp(1.1, 2.1, speedFactor) * CONFIG.scale;

  // 头部使用 drawCircle 以支持真实发光 (shadowBlur)
  drawCircle(
    trailCtx,
    head.x,
    head.y,
    headRadius * 3.2,
    CONFIG.color,
    0.14 * CONFIG.trail.alpha * fadeMul,
    headRadius * 2.8,
  );

  drawCircle(
    trailCtx,
    head.x,
    head.y,
    headRadius * 1.9,
    trailColor,
    0.28 * CONFIG.trail.alpha * fadeMul,
    headRadius * 1.6,
  );

  drawCircle(
    trailCtx,
    head.x,
    head.y,
    headRadius * 0.62,
    trailHotColor,
    0.42 * CONFIG.trail.alpha * fadeMul,
    headRadius * 0.5,
  );
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
    CONFIG.scale = Math.max(0.5, Math.min(3, Number(scale) ?? 1.15));
    requestRender();
  },

  setOpacity(opacity) {
    CONFIG.opacity = Math.max(0.1, Math.min(1, Number(opacity) ?? 0.95));
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

  setTrailBrightness(alpha = 0.96, whiteMix = 0.26) {
    CONFIG.trail.alpha = Math.max(
      0.1,
      Math.min(1, Number(alpha) ?? 1),
    );

    CONFIG.trail.whiteMix = Math.max(
      0,
      Math.min(0.9, Number(whiteMix) ?? 0.26),
    );

    requestRender();
  },

  setTrailWidth(baseFast = 1.00, baseSlow = 1.28) {
    CONFIG.trail.baseWidthFast = Math.max(
      0.5,
      Math.min(6, Number(baseFast) ?? 1.00),
    );

    CONFIG.trail.baseWidthSlow = Math.max(
      0.3,
      Math.min(CONFIG.trail.baseWidthFast, Number(baseSlow) ?? 1.28),
    );

    requestRender();
  },

  setTrailLayerAlpha(
    main = 0.98,
    core = 0.58,
    hot = 0.38,
    glow = 0.34,
    softGlow = 0.16,
    rail = 0.28,
  ) {
    CONFIG.trail.mainAlpha = Math.max(0, Math.min(1, Number(main) ?? 0.98));
    CONFIG.trail.coreAlpha = Math.max(0, Math.min(1, Number(core) ?? 0.58));
    CONFIG.trail.hotAlpha = Math.max(0, Math.min(1, Number(hot) ?? 0.38));
    CONFIG.trail.glowAlpha = Math.max(0, Math.min(1, Number(glow) ?? 0.34));
    CONFIG.trail.softGlowAlpha = Math.max(
      0,
      Math.min(1, Number(softGlow) ?? 0.16),
    );
    CONFIG.trail.railAlpha = Math.max(0, Math.min(1, Number(rail) ?? 0.28));

    requestRender();
  },

  // 轨迹长度：速度越快越接近 lengthFast
  setTrailLength(lengthSlow = 260, lengthFast = 8000) {
    CONFIG.trail.lengthSlow = Math.max(
      20,
      Math.min(1500, Number(lengthSlow) ?? 260),
    );

    CONFIG.trail.lengthFast = Math.max(
      CONFIG.trail.lengthSlow + 20,
      Math.min(3200, Number(lengthFast) ?? 8000),
    );

    requestRender();
  },

  // 轨迹寿命：决定松开鼠标后消散持续时间。
  // 默认 slow/fast 相同：移动速度只影响轨迹长度，不影响消散时间。
  setTrailLife(lifeSlow = 30, lifeFast = 30) {
    CONFIG.trail.lifeSlow = Math.max(
      5,
      Math.min(400, Number(lifeSlow) ?? 30),
    );

    CONFIG.trail.lifeFast = Math.max(
      CONFIG.trail.lifeSlow,
      Math.min(600, Number(lifeFast) ?? 30),
    );

    requestRender();
  },

  // 控制从尾部到头部的消散速度
  setTrailDecay(tailDecayMul = 1.85, headDecayMul = 1.0, releaseDecayMul = 1) {
    CONFIG.trail.tailDecayMul = Math.max(
      0.1,
      Math.min(5, Number(tailDecayMul) ?? 1.85),
    );

    CONFIG.trail.headDecayMul = Math.max(
      0.1,
      Math.min(CONFIG.trail.tailDecayMul, Number(headDecayMul) ?? 1.0),
    );

    CONFIG.trail.releaseDecayMul = Math.max(
      0.5,
      Math.min(12, Number(releaseDecayMul) ?? 1),
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

  setShardSpacing(value = 112) {
    CONFIG.trail.shardSpacing = Math.max(20, Math.min(500, Number(value) ?? 112));
    requestRender();
  },

  setShardChance(slow = 0.28, fast = 0.68) {
    CONFIG.trail.shardChanceSlow = Math.max(0, Math.min(1, Number(slow) ?? 0.28));
    CONFIG.trail.shardChanceFast = Math.max(CONFIG.trail.shardChanceSlow, Math.min(1, Number(fast) ?? 0.68));
    requestRender();
  },

  setShardLargeChance(value = 0.45) {
    CONFIG.trail.shardLargeChance = Math.max(0, Math.min(1, Number(value) ?? 0.45));
    requestRender();
  },

  setTrailSmooth(value = 0.5) {
    CONFIG.trail.smoothFactor = Math.max(0, Math.min(0.9, Number(value) ?? 0.5));
    trailSmoothX = null;
    trailSmoothY = null;
    requestRender();
  },

  setMaxShards(value = 56) {
    CONFIG.trail.maxSparkParticles = Math.max(0, Math.min(200, Number(value) ?? 56));
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

  // -- 默认值（用于重置）--
  const DEFAULTS = {
    color: '#189eff',
    scale: 1.15,
    opacity: 0.95,
    clickSpeed: 1.15,
    trailSpeed: 1.05,
    trail: true,
    trailAlways: false,
    trailWidth: 1.00,
    trailLength: 260,
    trailLife: 30,
    fakeGlow: true,
    clickFake: false,
    glow: false,
    shardSpacing: 112,
    shardChanceSlow: 0.28,
    shardChanceFast: 0.68,
    shardLargeChance: 0.45,
    maxShards: 56,
    smooth: 0.5,
    dpr: 1,
    trailRenderScale: 1,
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
