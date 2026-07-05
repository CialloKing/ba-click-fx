import { mixColor } from './utils.js';

// 游戏原始拖尾更偏蓝，不是偏白的蓝白色。
// 所有可调参数集中于此，运行时可被 BASparkDemo API 修改。
export const CONFIG = {
  color: [24, 158, 255],
  startColor: [250, 252, 252],

  scale: 1.15,
  opacity: 0.95,

  clickSpeed: 1.15,
  trailSpeed: 1.05,

  maxDpr: 1,

  // 拖尾层缩放。1 最清晰；0.75 更省性能。
  trailRenderScale: 1,

  maxDeltaMs: 80,
  baseFrameMs: 1000 / 60,

  filledCircle: {
    rAddRate: 26,
    maxLife: 16,
  },

  click: {
    // BASpark 的点击波纹按 1.5 左右绘制；这里单独放大点击，避免影响拖尾手感。
    scaleMul: 1.3,
  },

  rings: {
    // BASpark 创建点击波纹时使用较慢角速度，圆环看起来更稳。
    rsList: [0, 0.03, 0.06],
    rRoundRateList: [0, 1, 1.5, 2],
    len: 1.1 * Math.PI,
    maxLife: 23,
    segNum: 10,
    minW: 0.4,
    maxW: 3.3,
    lenStopAddPoint: 0.1,
    lenStartDimPoint: 0.4,
  },

  sparksCount: 4,

  trail: {
    enabled: true,

    // false：只有按住鼠标拖动才有轨迹
    // true：鼠标移动时也有轨迹
    always: false,

    // 输入采样
    minDistance: 0.06,
    sampleStep: 0.85,
    maxInterpolatedPoints: 80,
    maxCoalescedEvents: 24,
    maxJumpDistance: 420,

    // 指数平滑：削减鼠标手动移动时的微颤（0=不平滑，越大越平滑，推荐 0.35~0.55）
    smoothFactor: 0.5,

    // 渲染重采样（renderMaxPoints 限制最终渲染点数，区别于上面 maxPoints 限制原始采样存储点）
    renderStep: 0.75,
    renderMaxPoints: 2400,
    // 沿真实路径分段上色，避免首尾直线渐变在回环轨迹里误亮尾端。
    gradientChunkLength: 1.5,

    // 快速移动时允许轨迹明显更长
    lengthSlow: 260,
    lengthFast: 8000,

    // 点数上限必须更大，否则 lengthFast 还没生效就被截断
    maxPoints: 12000,

    // 关键调整：
    // 轨迹寿命不再跟速度一起变长。
    // 鼠标移动越快，只会让"长度"变长，不会让"消散时间"变长。
    // 36 帧约等于 0.6 秒；松开后会乘 releaseDecayMul，所以实际收尾约 0.25~0.35 秒。
    lifeSlow: 30,
    lifeFast: 30,

    // 尾部比头部先消散，形成从尾部向终点连续收掉的效果。
    tailDecayMul: 1.85,
    headDecayMul: 1.0,

    // 松开鼠标后加速收尾，但不要太大，否则会瞬间断掉。
    releaseDecayMul: 1,

    // 速度因子下降稍快一点：松手后只影响宽度/长度，不拖慢寿命。
    speedDecay: 0.988,

    // 轨迹宽度
    baseWidthSlow: 1.28,
    baseWidthFast: 1.00,

    coreWidthSlow: 0.5,
    coreWidthFast: 1.05,

    hotWidthSlow: 0.18,
    hotWidthFast: 0.46,

    glowWidthMul: 3.3,
    softGlowWidthMul: 6.8,
    railWidthSlow: 0.45,
    railWidthFast: 0.78,

    // 亮度与偏白程度：
    // whiteMix 越大越白。原来 0.68 会明显偏白，这里降到 0.26。
    alpha: 0.96,
    whiteMix: 0.26,

    mainAlpha: 0.98,
    coreAlpha: 0.58,
    hotAlpha: 0.38,
    glowAlpha: 0.34,
    softGlowAlpha: 0.16,
    railAlpha: 0.28,

    // 鼠标速度范围，单位 px/ms
    speedMin: 0.035,
    speedMax: 2.2,

    // 沿轨迹散布的三角碎片；截图里碎片不是只跟在鼠标头部。
    shardSpacing: 112,
    shardChanceSlow: 0.28,
    shardChanceFast: 0.68,
    shardOffsetMin: 8,
    shardOffsetMax: 28,
    shardLargeChance: 0.45,
    maxSparkParticles: 56,

    // 游戏截图里的碎片主要沿轨迹分布；关闭头部随机撒点以免范围变宽。
    moveSparkChance: 0,
  },

  glow: {
    enabled: false,
    fake: true,
    // 点击特效是否启用伪发光（拖尾线段由 fake 控制，点击默认关闭保持利落）
    clickFake: false,
  },
};

export function getClickScale()
{
  return CONFIG.scale * CONFIG.click.scaleMul;
}

// BASpark 使用主题色与两份白色混合，环线末端比纯主题色更轻、更接近原作 UI。
export function getClickRingEndColor()
{
  return CONFIG.color.map((channel) =>
    Math.round((channel + 255 * 2) / 3),
  );
}

export function getTrailColor() {
  return mixColor(CONFIG.color, [255, 255, 255], CONFIG.trail.whiteMix);
}

// 中心线使用浅蓝而不是纯白，避免整条拖尾发白。
export function getTrailCoreColor() {
  return mixColor(CONFIG.color, [255, 255, 255], 0.56);
}

// 原作亮段接近蓝白，但仍保留蓝色基底。
export function getTrailHotColor() {
  return mixColor(CONFIG.color, [255, 255, 255], 0.74);
}
