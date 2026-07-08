import { mixColor } from './utils.js';

// 游戏原始拖尾更偏蓝，不是偏白的蓝白色。
// 所有可调参数集中于此，运行时可被 BAClickFX API 修改。
export const CONFIG = {
  color: [105, 161, 255],
  startColor: [250, 252, 252],

  scale: 1.10,
  opacity: 0.5,

  // 点击特效开关，设为 false 可仅保留拖尾轨迹。
  clickEnabled: true,

  clickSpeed: 1,
  trailSpeed: 1.05,

  maxDpr: 1,

  // 拖尾层缩放。1 最清晰；0.75 更省性能。
  trailRenderScale: 1,

  // Canvas 的 touch-action CSS 属性。'auto' 时页面滚动正常但拖尾会被中断；
  // 如需移动端拖尾，设置为 'none'。
  touchAction: 'auto',

  maxDeltaMs: 80,
  baseFrameMs: 1000 / 60,

  filledCircle: {
    rAddRate: 26,
    // 120fps 视频基准：圆盘存在 25 帧(→12.5@60fps)，第 21 帧扩张到最大(21/25=0.84)
    maxLife: 12.5,
    expandEnd: 0.84,
    colorEnd: 0.34,
    fadeStart: 0.78,
    glowRadiusMul: 4.2,
    glowAlpha: 0.13,
  },

  click: {
    // BASpark 的点击波纹按 1.5 左右绘制；这里单独放大点击，避免影响拖尾手感。
    scaleMul: 1.3,
    // 原始点击特效总时长约为 54 帧 @120fps，即 450ms。
    totalLife: 27,
    haloRadius: 96,
    // 120fps 录像下碎片 16 帧完成 暗 -> 亮 -> 暗；换算为 60fps 基准是 8 帧。
    shardFlickerPeriod: 8,
    shardFlickerMinAlpha: 0.38,
  },

  rings: {
    // 120fps 视频基准：圆环在第 4 帧出现 → 60fps 基准延迟 2 帧
    delay: 2,
    maxLife: 27,
    rotationSpeed: 0.008,
    // 圆环起始半径 = 圆盘第4帧半径(120fps) ≈ 圆盘最大半径的 47%
    baseRadiusMul: 0.47,
    // 圆盘消失(帧25)后12帧(帧37@120fps)达最大半径 → ringLife=16.5/25=0.66
    radiusGrowEnd: 0.66,
    // 圆环最终半径约为圆盘的 1.2 倍
    postDiskGrow: 24,
    emissionAlpha: 0.35,
    glowRadiusAdd: 54,
    glowAlpha: 0.15,
    softGlowRadiusAdd: 96,
    softGlowAlpha: 0.08,
    segmentCountMin: 2,
    segmentCountMax: 2,
    segmentExtraChance: 0,
    segmentClusterChance: 0.38,
    lenFull: 1.5 * Math.PI,
    // 圆环消散时弧长为整个圆的 1/6 = π/3
    lenEnd: Math.PI / 3,
    lenMulMin: 0.46,
    lenMulMax: 1.38,
    // 段间半径差异很小，仅微微错开以模拟手绘感
    radiusJitterMin: -1.5,
    radiusJitterMax: 2.0,
    segmentRadiusGrowSmallMin: 0.85,
    segmentRadiusGrowSmallMax: 0.95,
    segmentRadiusGrowMin: 0.95,
    segmentRadiusGrowMax: 1.08,
    rotationMulMin: 0.54,
    rotationMulMax: 1.58,
    // 第12帧(120fps)达最大弧长 → ringLife=4@60fps → growEnd=4/25=0.16
    growEnd: 0.16,
    collapseStart: 0.16,
    // 全生命周期始终满亮度，不做淡出
    fadeStart: 1.0,
    // 圆环颜色中白色的混合比例，0=纯主题色，1=纯白
    whiteMix: 0.75,
    minW: 0.9,
    maxW: 4.0,
    alpha: 0.9,
  },

  // Unity ParticleSystem Burst 风格：点击时从圆环附近随机散出三角碎片。
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
    // 拖尾分段渐变长度：沿路径每隔多少 px 采样透明度/宽度。
    // 值越小渐变越细腻，但 stroke 调用越多。1.5≈与旧版兼容。
    gradientChunkLength: 1.5,
    // TrailRenderer.time 主导长度；这里主要作为异常长路径的保险上限。
    lengthSlow: 900,
    lengthFast: 4200,

    // 点数上限必须更大，否则 lengthFast 还没生效就被截断
    maxPoints: 12000,

    // 关键调整：
    // 轨迹寿命不再跟速度一起变长。
    // 鼠标移动越快，只会让"长度"变长，不会让"消散时间"变长。
    // 约 0.3s 的 TrailRenderer.time；速度只影响几何长度，不影响点寿命。
    lifeSlow: 22,
    lifeFast: 22,

    // 尾部比头部先消散，形成从尾部向终点连续收掉的效果。
    tailDecayMul: 1.28,
    headDecayMul: 0.95,

    // 松开鼠标后略微加速收尾，但仍保持从尾部连续消散。
    releaseDecayMul: 1.18,

    // 速度因子下降稍快一点：松手后只影响宽度/长度，不拖慢寿命。
    speedDecay: 0.988,

    // 轨迹本体更像 Unity TrailRenderer 的细线，宽度主要交给发光层表现。
    baseWidthSlow: 3,
    baseWidthFast: 3,

    coreWidthSlow: 0.3,
    coreWidthFast: 0.52,

    hotWidthSlow: 0.1,
    hotWidthFast: 0.24,

    ribbonWidthMul: 0,
    glowWidthMul: 1.7,
    softGlowWidthMul: 2.4,
    railWidthSlow: 0.22,
    railWidthFast: 0.36,

    // 亮度与偏白程度：
    // whiteMix 越大越白；轨迹本体需要偏 cyan，白色只留给极细中心高光。
    alpha: 0.96,
    whiteMix: 0.08,

    mainAlpha: 1,
    ribbonAlpha: 0,
    coreAlpha: 0.78,
    hotAlpha: 0.34,
    glowAlpha: 0.18,
    softGlowAlpha: 0.045,
    railAlpha: 0.02,

    // 鼠标速度范围，单位 px/ms
    speedMin: 0.035,
    speedMax: 2.2,

    // 沿轨迹散布的三角碎片；截图里碎片不是只跟在鼠标头部。
    shardSpacing: 220,
    // 距离到达间隔时一定发射 1 个；这里控制额外碎片概率。
    shardChanceSlow: 0.04,
    shardChanceFast: 0.18,
    shardOffsetMin: 2,
    shardOffsetMax: 36,
    shardLargeChance: 0.62,
    maxSparkParticles: 38,
    // Unity ParticleSystem 常见做法：Color over Lifetime 叠加随机相位闪烁。
    // 120fps 视频基准：闪烁完整周期 16 帧 → 60fps 基准 8 帧。
    shardFlickerPeriod: 8,
    shardFlickerMinAlpha: 0.3,
    shardFlickerSizePulse: 0.12,

    // 游戏截图里的碎片主要沿轨迹分布；关闭头部随机撒点以免范围变宽。
    moveSparkChance: 0,
  },

  glow: {
    enabled: false,
    fake: true,
    // 原作点击反馈包含明显蓝白径向光，默认开启点击伪发光。
    clickFake: true,
  },
};

// resetConfig 必须回到模块初始默认值，不能受运行时或外部误改 CONFIG 的影响。
const DEFAULT_CONFIG = JSON.parse(JSON.stringify(CONFIG));

/**
 * 深拷贝配置对象。
 * 运行时配置必须按实例隔离，避免多个 BAClickFX 互相覆盖参数。
 * @param {object} [config=CONFIG]
 * @returns {object}
 */
export function cloneConfig(config = CONFIG)
{
  return JSON.parse(JSON.stringify(config));
}

/**
 * 创建运行时配置副本。
 * CONFIG 只保留为默认模板和兼容导出，不直接作为实例状态使用。
 * @returns {object}
 */
export function createConfig()
{
  return cloneConfig(DEFAULT_CONFIG);
}

/**
 * 点击特效专用缩放 = scale × click.scaleMul
 * @param {object} [config=CONFIG]
 * @returns {number}
 */
export function getClickScale(config = CONFIG)
{
  return config.scale * config.click.scaleMul;
}

/**
 * 点击圆环颜色 — 主题色与白色 1:3 混合，明度极高
 * @param {object} [config=CONFIG]
 * @returns {number[]} [r, g, b]
 */
export function getClickRingEndColor(config = CONFIG)
{
  return mixColor(config.color, [255, 255, 255], config.rings.whiteMix);
}

/**
 * 拖尾主色调 = 主题色按 whiteMix 混合白色
 * @param {object} [config=CONFIG]
 * @returns {number[]} [r, g, b]
 */
export function getTrailColor(config = CONFIG)
{
  return mixColor(config.color, [255, 255, 255], config.trail.whiteMix);
}

/**
 * 拖尾中心高光色 = 主题色 + 56% 白（浅蓝，避免纯白过于刺眼）
 * @param {object} [config=CONFIG]
 * @returns {number[]} [r, g, b]
 */
export function getTrailCoreColor(config = CONFIG)
{
  return mixColor(config.color, [255, 255, 255], 0.36);
}

/**
 * 拖尾头部热点色 = 主题色 + 74% 白（蓝白，保留蓝色基底）
 * @param {object} [config=CONFIG]
 * @returns {number[]} [r, g, b]
 */
export function getTrailHotColor(config = CONFIG)
{
  return mixColor(config.color, [255, 255, 255], 0.58);
}
