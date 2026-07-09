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
    /** 移动时也显示拖尾，默认 false */
    trailAlways?: boolean;
    /** 启用拖尾，默认 true */
    trailEnabled?: boolean;
  }

  export class BAClickFX {
    constructor(options?: BAClickFXOptions);

    /** 销毁实例：移除 Canvas、事件监听、停止动画 */
    destroy(): void;

    // 基础
    setColor(r: number, g: number, b: number): void;
    setScale(scale: number): void;
    setOpacity(opacity: number): void;
    setSpeed(clickSpeed: number, trailSpeed?: number): void;
    setDpr(maxDpr: number): void;
    setTrailRenderScale(value: number): void;

    // 发光
    setGlow(enabled: boolean): void;
    setFakeGlow(enabled: boolean): void;
    setClickFakeGlow(enabled: boolean): void;

    // 圆环
    setRingRotationSpeed(value?: number): void;
    setRingEmission(value?: number): void;
    setRingWidth(value?: number): void;
    setRingAlpha(value?: number): void;
    setRingDelay(value?: number): void;
    setRingMaxLife(value?: number): void;
    setRingBaseRadiusMul(value?: number): void;
    setRingRadiusGrowEnd(value?: number): void;
    setRingPostDiskGrow(value?: number): void;
    setRingGlowRadiusAdd(value?: number): void;
    setRingSoftGlowRadiusAdd(value?: number): void;

    // 拖尾
    setTrail(enabled: boolean): void;
    setTrailAlways(enabled: boolean): void;
    setTrailBrightness(value?: number): void;
    setTrailWhiteMix(value?: number): void;
    setTrailWidth(baseFast?: number, baseSlow?: number): void;
    setTrailLength(lengthSlow?: number, lengthFast?: number): void;
    setTrailLife(lifeSlow?: number, lifeFast?: number): void;
    setTrailDecay(tailDecayMul?: number, headDecayMul?: number, releaseDecayMul?: number): void;
    setTrailSpeedDecay(value?: number): void;
    setTrailSpeedRange(speedMin?: number, speedMax?: number): void;
    setTrailSampling(sampleStep?: number, maxInterpolatedPoints?: number): void;
    setTrailRenderSampling(renderStep?: number, renderMaxPoints?: number): void;
    setTrailSmooth(value?: number): void;
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
    setTrailGlowWidthMul(value?: number): void;
    setTrailSoftGlowWidthMul(value?: number): void;
    setTrailTailDecayMul(value?: number): void;
    setTrailHeadDecayMul(value?: number): void;
    setTrailReleaseDecayMul(value?: number): void;
    setTrailSpeedMin(value?: number): void;
    setTrailSpeedMax(value?: number): void;

    // 碎片
    setMoveSparkChance(value?: number): void;
    setShardSpacing(value?: number): void;
    setShardChance(slow?: number, fast?: number): void;
    setShardLargeChance(value?: number): void;
    setMaxShards(value?: number): void;

    // 点击
    setSparksCount(value?: number): void;
    setClickTotalLife(value?: number): void;
    setClickScaleMul(value?: number): void;
    setClickHaloRadius(value?: number): void;

    // 操作
    clearTrail(): void;
    boom(x?: number, y?: number): void;
    getConfig(): object;
    resetConfig(): void;

    /** 当前实例的只读配置引用 */
    readonly CONFIG: object;
  }

  export default BAClickFX;
}
