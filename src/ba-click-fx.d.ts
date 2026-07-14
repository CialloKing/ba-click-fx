declare module 'ba-click-fx'
{
  /** Canvas 边界外的拖尾输入策略 */
  export type TrailOutsideBehavior = 'auto' | 'pause-connect' | 'continue' | 'clamp';

  /** 返回 true 接受该次 Pointer 输入，返回 false 忽略；终止事件始终由引擎清理。 */
  export type BAClickFXInputFilter = (event: PointerEvent) => boolean;

  /** Canvas backing store 的画质与总像素预算。 */
  export interface BAClickFXRenderOptions
  {
    /** 最大设备像素比；默认 1，与 v1.1.8 相同。 */
    maxDpr?: number;
    /** 启用像素预算时允许使用的最低渲染倍率；默认 0.5。 */
    minRenderScale?: number;
    /** 拖尾离屏 Canvas 相对主 Canvas 的渲染倍率；默认 1。 */
    trailRenderScale?: number;
    /** 所有 backing store 的总像素预算；null 表示不启用预算，默认 null。 */
    maxBackingPixels?: number | null;
  }

  /** 当前 Canvas 尺寸、实际渲染倍率和理论 backing store 开销快照。 */
  export interface BAClickFXRenderMetrics
  {
    /** Canvas 的 CSS 布局宽度。 */
    readonly cssWidth: number;
    /** Canvas 的 CSS 布局高度。 */
    readonly cssHeight: number;
    /** 浏览器报告的设备像素比。 */
    readonly devicePixelRatio: number;
    /** 应用 maxDpr 与像素预算后的实际主渲染像素比。 */
    readonly effectivePixelRatio: number;
    /** 当前实际拖尾渲染倍率。 */
    readonly trailRenderScale: number;
    /** 主 Canvas 与内部 Canvas backing store 的总像素数。 */
    readonly totalBackingPixels: number;
    /** 按每像素 4 字节估算的理论 RGBA 下限，不代表浏览器实际内存占用。 */
    readonly nominalRgbaBytes: number;
    /** 当前总像素预算；null 表示未启用。 */
    readonly maxBackingPixels: number | null;
    /** 达到最低渲染倍率后是否仍超过预算。 */
    readonly budgetExceeded: boolean;
  }

  /** 圆盘绘制与生命周期配置。 */
  export interface BAClickFXFilledCircleConfig
  {
    rAddRate: number;
    maxLife: number;
    expandEnd: number;
    colorEnd: number;
    fadeStart: number;
    glowRadiusMul: number;
    glowAlpha: number;
  }

  /** 点击波纹与点击碎片配置。 */
  export interface BAClickFXClickConfig
  {
    scaleMul: number;
    totalLife: number;
    haloRadius: number;
    shardFlickerPeriod: number;
    shardFlickerMinAlpha: number;
  }

  /** 圆环绘制、随机分段和生命周期配置。 */
  export interface BAClickFXRingsConfig
  {
    delay: number;
    maxLife: number;
    rotationSpeed: number;
    baseRadiusMul: number;
    radiusGrowEnd: number;
    postDiskGrow: number;
    emissionAlpha: number;
    glowRadiusAdd: number;
    glowAlpha: number;
    softGlowRadiusAdd: number;
    softGlowAlpha: number;
    segmentCountMin: number;
    segmentCountMax: number;
    segmentExtraChance: number;
    segmentClusterChance: number;
    lenFull: number;
    lenEnd: number;
    lenMulMin: number;
    lenMulMax: number;
    radiusJitterMin: number;
    radiusJitterMax: number;
    segmentRadiusGrowSmallMin: number;
    segmentRadiusGrowSmallMax: number;
    segmentRadiusGrowMin: number;
    segmentRadiusGrowMax: number;
    rotationMulMin: number;
    rotationMulMax: number;
    growEnd: number;
    collapseStart: number;
    fadeStart: number;
    whiteMix: number;
    colorFadeStart: number;
    colorEndWhiteMix: number;
    minW: number;
    maxW: number;
    widthEndMul: number;
    alpha: number;
  }

  /** 拖尾输入、重采样、分层绘制、衰减和碎片配置。 */
  export interface BAClickFXTrailConfig
  {
    enabled: boolean;
    always: boolean;
    outsideBehavior: TrailOutsideBehavior;
    minDistance: number;
    sampleStep: number;
    maxInterpolatedPoints: number;
    maxCoalescedEvents: number;
    maxJumpDistance: number;
    smoothFactor: number;
    renderStep: number;
    renderMaxPoints: number;
    gradientChunkLength: number;
    lengthSlow: number;
    lengthFast: number;
    maxPoints: number;
    lifeSlow: number;
    lifeFast: number;
    tailDecayMul: number;
    headDecayMul: number;
    releaseDecayMul: number;
    speedDecay: number;
    baseWidthSlow: number;
    baseWidthFast: number;
    coreWidthSlow: number;
    coreWidthFast: number;
    hotWidthSlow: number;
    hotWidthFast: number;
    ribbonWidthMul: number;
    glowWidthMul: number;
    softGlowWidthMul: number;
    railWidthSlow: number;
    railWidthFast: number;
    alpha: number;
    whiteMix: number;
    mainAlpha: number;
    ribbonAlpha: number;
    coreAlpha: number;
    hotAlpha: number;
    glowAlpha: number;
    softGlowAlpha: number;
    railAlpha: number;
    speedMin: number;
    speedMax: number;
    shardSpacing: number;
    shardChanceSlow: number;
    shardChanceFast: number;
    shardOffsetMin: number;
    shardOffsetMax: number;
    shardLargeChance: number;
    maxSparkParticles: number;
    shardFlickerPeriod: number;
    shardFlickerMinAlpha: number;
    shardFlickerSizePulse: number;
    moveSparkChance: number;
    glowRadiusMul: number;
    glowIntensity: number;
  }

  /** 发光实现开关配置。 */
  export interface BAClickFXGlowConfig
  {
    enabled: boolean;
    fake: boolean;
    clickFake: boolean;
  }

  /** `getConfig()` 返回的完整实例配置。 */
  export interface BAClickFXConfig
  {
    color: [number, number, number];
    scale: number;
    opacity: number;
    clickEnabled: boolean;
    clickSpeed: number;
    trailSpeed: number;
    maxDpr: number;
    minRenderScale: number;
    maxBackingPixels: number | null;
    trailRenderScale: number;
    touchAction: 'auto' | 'none' | 'pan-y' | 'pan-x' | 'manipulation';
    maxDeltaMs: number;
    baseFrameMs: number;
    filledCircle: BAClickFXFilledCircleConfig;
    click: BAClickFXClickConfig;
    rings: BAClickFXRingsConfig;
    sparksCount: number;
    trail: BAClickFXTrailConfig;
    glow: BAClickFXGlowConfig;
  }

  export interface BAClickFXOptions
  {
    /** 挂载目标：CSS 选择器或已有 <canvas> 元素。不传则自动创建全屏 Canvas */
    target?: string | HTMLElement;
    /** 主题颜色 [r, g, b]，默认 [105, 161, 255] */
    color?: [number, number, number];
    /** 全局缩放 0.5~3，默认 1.10 */
    scale?: number;
    /** 透明度 0.1~1，默认 0.50 */
    opacity?: number;
    /** 启用拖尾，默认 true */
    trailEnabled?: boolean;
    /** 移动时也显示拖尾，默认 false */
    trailAlways?: boolean;
    /** 启用点击特效，默认 true */
    clickEnabled?: boolean;
    /** Canvas touch-action CSS 属性，默认 'auto' */
    touchAction?: 'auto' | 'none' | 'pan-y' | 'pan-x' | 'manipulation';
    /** 可选宿主输入过滤器；默认 null，接受全部 Pointer 输入。 */
    inputFilter?: BAClickFXInputFilter | null;
    /** Canvas 画质、缩放下限与可选总像素预算。 */
    render?: BAClickFXRenderOptions;
  }

  export class BAClickFX
  {
    constructor(options?: BAClickFXOptions);

    /**
     * 幂等销毁实例并释放监听器、RAF、定时器、Pointer Capture 和内部 Canvas。
     * 自动创建的主 Canvas 会被移除；调用方传入的 Canvas 节点和尺寸会保留。
     */
    destroy(): void;

    // ═══ 基础设置 ═══

    /** 设置主题颜色 */
    setColor(r: number, g: number, b: number): void;
    /** 全局缩放 0.5~3 */
    setScale(scale: number): void;
    /** 透明度 0.1~1 */
    setOpacity(opacity: number): void;
    /** 点击/拖尾动画速度 0.2~3 */
    setSpeed(clickSpeed: number, trailSpeed?: number): void;
    /** 最大设备像素比 1~2 */
    setDpr(maxDpr: number): void;
    /** 拖尾离屏 Canvas 渲染缩放 0.5~1 */
    setTrailRenderScale(value: number): void;
    /** 批量更新 Canvas 渲染选项并重新计算 backing store 尺寸。 */
    setRenderOptions(options: BAClickFXRenderOptions): void;
    /** 立即按当前 CSS 布局尺寸和 DPR 刷新 Canvas；销毁后调用无操作。 */
    refreshSize(): void;
    /** 获取当前渲染尺寸、预算状态和理论 RGBA 开销快照。 */
    getRenderMetrics(): BAClickFXRenderMetrics;
    /** Canvas touch-action CSS 属性 */
    setTouchAction(value?: 'auto' | 'none' | 'pan-y' | 'pan-x' | 'manipulation'): void;
    /** 设置宿主输入过滤器；传入 null 恢复接受全部输入。 */
    setInputFilter(filter?: BAClickFXInputFilter | null): void;

    // ═══ 发光 ═══

    /** 开关 shadowBlur 真实发光（性能开销大） */
    setGlow(enabled: boolean): void;
    /** 开关多层叠加伪发光 */
    setFakeGlow(enabled: boolean): void;
    /** 开关点击特效伪发光 */
    setClickFakeGlow(enabled: boolean): void;

    // ═══ 点击特效 ═══

    /**
     * 开关后续点击特效；关闭不会中断已经开始的点击动画，也不影响拖尾。
     */
    setClick(enabled: boolean): void;
    /** 点击特效总帧数 10~60 */
    setClickTotalLife(value?: number): void;
    /** 点击缩放倍率 0.5~3 */
    setClickScaleMul(value?: number): void;
    /** 点击光晕半径 30~200 */
    setClickHaloRadius(value?: number): void;
    /** 点击碎片闪烁周期与最低亮度 */
    setClickShardFlicker(period?: number, minAlpha?: number): void;
    /** 点击时散出的碎片数量 0~12 */
    setSparksCount(value?: number): void;

    // ═══ 圆盘 ═══

    /** 圆盘增长速度 10~50 */
    setDiskSize(value?: number): void;
    /** 圆盘柔光范围倍数与透明度 */
    setDiskGlow(radiusMul?: number, alpha?: number): void;
    /**
     * 圆盘动画时序参数
     * @param maxLife - 圆盘存在帧数 (5~30, 默认 12.5)
     * @param expandEnd - 扩张到最大的时间比例 (0.1~1, 默认 0.84)
     * @param colorEnd - 白→蓝颜色过渡终点 (0.05~1, 默认 0.34)
     * @param fadeStart - 开始淡出的时机 (0.1~1, 默认 0.78)
     */
    setDiskTiming(maxLife?: number, expandEnd?: number, colorEnd?: number, fadeStart?: number): void;

    // ═══ 圆环 ═══

    /** 旋转速度 0~0.05 */
    setRingRotationSpeed(value?: number): void;
    /** 圆环光晕强度 0~1 */
    setRingEmission(value?: number): void;
    /** 圆环最小/最大线宽 */
    setRingWidth(value?: number, maxValue?: number): void;
    /** 圆环宽度随生命周期收缩的终点倍率 0.05~1 */
    setRingWidthEndMul(value?: number): void;
    /** 圆环透明度 0.1~1 */
    setRingAlpha(value?: number): void;
    /** 圆环颜色中白色的混合比例 0~1 */
    setRingWhiteMix(value?: number): void;
    /** 圆环出现延迟（帧）0~10 */
    setRingDelay(value?: number): void;
    /** 圆环最大帧数 10~60 */
    setRingMaxLife(value?: number): void;
    /** 圆环起始半径倍率 0.2~1 */
    setRingBaseRadiusMul(value?: number): void;
    /** 圆环半径增长结束时间比例 0.2~1 */
    setRingRadiusGrowEnd(value?: number): void;
    /** 圆盘消失后圆环额外增长像素 5~60 */
    setRingPostDiskGrow(value?: number): void;
    /** 圆环内层光晕半径增量 10~150 */
    setRingGlowRadiusAdd(value?: number): void;
    /** 圆环外层光晕半径增量 20~200 */
    setRingSoftGlowRadiusAdd(value?: number): void;
    /** 圆环内层光晕透明度 0~1 */
    setRingGlowAlpha(value?: number): void;
    /** 圆环外层光晕透明度 0~1 */
    setRingSoftGlowAlpha(value?: number): void;
    /** 圆环颜色衰减起始进度 0~1 */
    setRingColorFadeStart(value?: number): void;
    /** 圆环消失时的白混合比例 0~1 */
    setRingColorEndWhiteMix(value?: number): void;
    /** 圆环弧长（饱满弧度与消散弧度） */
    setRingArcLength(lenFull?: number, lenEnd?: number): void;
    /** 圆环旋转速度随机抖动范围 */
    setRingRotationJitter(min?: number, max?: number): void;
    /** 圆环弧段数量范围 */
    setRingSegmentCount(min?: number, max?: number): void;
    /** 小半径弧段的 growMul 范围 */
    setRingSmallRadius(min?: number, max?: number): void;
    /**
     * 圆环弧段细节：额外弧段概率、聚拢概率、弧长随机倍率范围
     * @param extraChance - 额外弧段出现概率 0~1
     * @param clusterChance - 弧段聚拢概率 0~1
     * @param lenMulMin - 弧长倍率下限 0.1~1
     * @param lenMulMax - 弧长倍率上限 1~3
     */
    setRingSegmentDetail(extraChance?: number, clusterChance?: number, lenMulMin?: number, lenMulMax?: number): void;
    /** 圆环半径抖动范围（模拟手绘感） */
    setRingRadiusJitter(min?: number, max?: number): void;
    /** 正常弧段半径增长率范围 */
    setRingNormalGrow(min?: number, max?: number): void;
    /**
     * 圆环收缩/淡出时序
     * @param growEnd - 弧长增长终点 0.05~0.5
     * @param collapseStart - 开始收缩的时间点 0.05~1
     * @param fadeStart - 开始淡出的时间点 0.1~1
     */
    setRingCollapseTiming(growEnd?: number, collapseStart?: number, fadeStart?: number): void;

    // ═══ 拖尾 ═══

    /**
     * 开关拖尾；关闭会立即停止采样并清理拖尾轨迹和拖尾碎片，点击特效不受影响。
     */
    setTrail(enabled: boolean): void;
    /** 移动时也显示拖尾 */
    setTrailAlways(enabled: boolean): void;
    /**
     * 设置 Canvas 边界外的拖尾策略。
     * auto 保持浏览器原始分发行为；pause-connect 忽略边界外样本并在重新进入时连接；
     * continue 在下一次有效按压时尝试 Pointer Capture，但不提供系统级全局鼠标追踪；
     * clamp 同样尝试捕获，并在平滑与插值前把拖尾样本限制到 Canvas 边缘。
     */
    setTrailOutsideBehavior(mode: TrailOutsideBehavior): void;
    /** 拖尾整体亮度 0.1~1 */
    setTrailBrightness(value?: number): void;
    /** 拖尾偏白程度 0~1 */
    setTrailWhiteMix(value?: number): void;
    /** 拖尾基础线宽 (高速, 低速) */
    setTrailWidth(baseFast?: number, baseSlow?: number): void;
    /** 拖尾几何长度上限 (低速, 高速) */
    setTrailLength(lengthSlow?: number, lengthFast?: number): void;
    /** 拖尾点寿命帧数 (低速, 高速) */
    setTrailLife(lifeSlow?: number, lifeFast?: number): void;
    /** 拖尾衰减倍率 (尾部, 头部, 松手) */
    setTrailDecay(tailDecayMul?: number, headDecayMul?: number, releaseDecayMul?: number): void;
    /** 速度因子衰减系数 0.8~0.999 */
    setTrailSpeedDecay(value?: number): void;
    /** 鼠标速度映射范围 (min, max) px/ms */
    setTrailSpeedRange(speedMin?: number, speedMax?: number): void;
    /** 输入采样参数 (步长, 最大插值点数) */
    setTrailSampling(sampleStep?: number, maxInterpolatedPoints?: number): void;
    /** 渲染重采样参数 (步长, 最大点数) */
    setTrailRenderSampling(renderStep?: number, renderMaxPoints?: number): void;
    /** 指数平滑系数 0~0.9 */
    setTrailSmooth(value?: number): void;
    /** 分段渐变长度，越小越细腻 0.3~10 */
    setTrailGradientChunk(value?: number): void;
    /** 拖尾原始点数上限 500~30000 */
    setTrailMaxPoints(value?: number): void;
    /** 拖尾中心高光线宽 (低速, 高速) */
    setTrailCoreWidth(slow?: number, fast?: number): void;
    /** 拖尾蓝白热点线宽 (低速, 高速) */
    setTrailHotWidth(slow?: number, fast?: number): void;
    /** 轨迹采样最小间距 0.01~5 */
    setTrailMinDistance(value?: number): void;
    /** 轨迹断笔距离阈值 50~2000 */
    setTrailMaxJumpDistance(value?: number): void;
    /** 高频事件处理上限 1~100 */
    setTrailMaxCoalescedEvents(value?: number): void;
    /** 轨道线层宽度 (低速, 高速) */
    setTrailRailWidth(slow?: number, fast?: number): void;
    /** 能量带层(ribbon)宽度倍率和透明度，默认关闭 */
    setTrailRibbon(widthMul?: number, alpha?: number): void;
    /** 轨迹真实光晕半径倍率 (4~30, 默认 25) */
    setTrailGlowRadius(value?: number): void;
    /** 轨迹真实光晕强度 (0.02~0.5, 默认 0.13) */
    setTrailGlowIntensity(value?: number): void;

    // ═══ 拖尾分层透明度 ═══

    /** 一次性设置所有拖尾层透明度 */
    setTrailLayerAlpha(
      main?: number,
      core?: number,
      hot?: number,
      glow?: number,
      softGlow?: number,
      rail?: number,
    ): void;
    setTrailMainAlpha(value?: number): void;
    setTrailCoreAlpha(value?: number): void;
    setTrailHotAlpha(value?: number): void;
    setTrailGlowAlpha(value?: number): void;
    setTrailSoftGlowAlpha(value?: number): void;
    setTrailRailAlpha(value?: number): void;
    /** 光晕层宽度倍率 0.3~8 */
    setTrailGlowWidthMul(value?: number): void;
    /** 柔光层宽度倍率 0.5~15 */
    setTrailSoftGlowWidthMul(value?: number): void;

    // ═══ 拖尾独立衰减/速度 ═══

    setTrailTailDecayMul(value?: number): void;
    setTrailHeadDecayMul(value?: number): void;
    setTrailReleaseDecayMul(value?: number): void;
    setTrailSpeedMin(value?: number): void;
    setTrailSpeedMax(value?: number): void;

    // ═══ 碎片/粒子 ═══

    /** 鼠标移动时头部撒碎片概率 0~0.05 */
    setMoveSparkChance(value?: number): void;
    /** 轨迹碎片间距 20~500 */
    setShardSpacing(value?: number): void;
    /** 轨迹碎片概率 (低速, 高速) */
    setShardChance(slow?: number, fast?: number): void;
    /** 大碎片概率 0~1 */
    setShardLargeChance(value?: number): void;
    /** 碎片最大数量 0~200 */
    setMaxShards(value?: number): void;
    /** 轨迹碎片闪烁参数 (周期, 最低亮度, 尺寸脉冲) */
    setTrailShardFlicker(period?: number, minAlpha?: number, sizePulse?: number): void;
    /** 轨迹碎片偏移范围 */
    setTrailShardOffset(min?: number, max?: number): void;

    // ═══ 操作 ═══

    /**
     * 清除拖尾轨迹和拖尾碎片，但保留拖尾开关、当前按压状态及全部点击特效。
     */
    clearTrail(): void;
    /**
     * 手动触发点击特效
     * @param x - 默认屏幕中心
     * @param y - 默认屏幕中心
     */
    boom(x?: number, y?: number): void;
    /** 获取当前配置的深拷贝 */
    getConfig(): BAClickFXConfig;
    /** 恢复所有配置为默认值 */
    resetConfig(): void;

    /**
     * @deprecated 该属性暴露实例内部的可变引用，会绕过 setter 校验和尺寸刷新副作用。
     * 请使用 getConfig() 读取快照，并通过 setter 或 setRenderOptions() 修改配置。
     */
    readonly CONFIG: BAClickFXConfig;
  }

  export default BAClickFX;
}
