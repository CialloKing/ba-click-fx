declare module 'ba-click-fx' {
  export interface BAClickFXOptions {
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
  }

  export class BAClickFX {
    constructor(options?: BAClickFXOptions);

    /** 销毁实例：移除 Canvas、事件监听、停止动画 */
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
    /** Canvas touch-action CSS 属性 */
    setTouchAction(value?: 'auto' | 'none' | 'pan-y' | 'pan-x' | 'manipulation'): void;

    // ═══ 发光 ═══

    /** 开关 shadowBlur 真实发光（性能开销大） */
    setGlow(enabled: boolean): void;
    /** 开关多层叠加伪发光 */
    setFakeGlow(enabled: boolean): void;
    /** 开关点击特效伪发光 */
    setClickFakeGlow(enabled: boolean): void;

    // ═══ 点击特效 ═══

    /** 开关点击特效 */
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

    /** 开关拖尾 */
    setTrail(enabled: boolean): void;
    /** 移动时也显示拖尾 */
    setTrailAlways(enabled: boolean): void;
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

    /** 清除所有拖尾轨迹 */
    clearTrail(): void;
    /**
     * 手动触发点击特效
     * @param x - 默认屏幕中心
     * @param y - 默认屏幕中心
     */
    boom(x?: number, y?: number): void;
    /** 获取当前配置的深拷贝 */
    getConfig(): object;
    /** 恢复所有配置为默认值 */
    resetConfig(): void;

    /** 当前实例的只读配置引用 */
    readonly CONFIG: object;
  }

  export default BAClickFX;
}
