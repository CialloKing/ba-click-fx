declare module 'ba-click-fx'
{
  export type BAClickFXInputFilter = (event: PointerEvent) => boolean;
  export type BAClickFXBloomBackend = 'auto' | 'software' | 'webgl2' | 'native';
  export type BAClickFXResolvedBloomBackend =
    Exclude<BAClickFXBloomBackend, 'auto'> | 'legacy' | 'pending';

  export interface BAClickFXBackendChangeDetail
  {
    readonly requestedBloomBackend: BAClickFXBloomBackend;
    readonly resolvedBloomBackend: BAClickFXResolvedBloomBackend;
  }

  export type BAClickFXBackendChangeEvent =
    CustomEvent<BAClickFXBackendChangeDetail>;

  export interface BAClickFXOptions
  {
    /** CSS 选择器、定位容器或已有 Canvas；普通容器建议设置 position: relative，省略时创建全屏覆盖层。 */
    target?: string | HTMLElement;
    /** 相对 Unity 原始尺寸的倍率，默认 1。 */
    scale?: number;
    /** 整体透明度，默认 1。 */
    opacity?: number;
    clickEnabled?: boolean;
    trailEnabled?: boolean;
    /** 无需按下鼠标，移动即显示拖尾。默认 false。 */
    trailAlways?: boolean;
    /** 渲染模式：'enhanced'（默认，线性能量）或 'legacy'（sRGB + shadowBlur，main 分支风格）。 */
    renderingMode?: 'enhanced' | 'legacy';
    /** Bloom 后端。默认 'software'；'auto' 和 'webgl2' 不可用时会自动回退。 */
    bloomBackend?: BAClickFXBloomBackend;
    /** 兼容旧 API：true 等价于 'software'，false 等价于 'native'。 */
    softwareBloomEnabled?: boolean;
    /** 在透明组内合成多 Canvas 后再覆盖页面，默认 true；已有 Canvas target 不支持。 */
    isolatedCompositing?: boolean;
    /** 浅色背景的非 Bloom 淡青轮廓强度，默认 0.35；设为 0 可关闭。 */
    lightBackgroundContrastAlpha?: number;
    /** Canvas backing store 的设备像素比上限，默认 2。 */
    maxDpr?: number;
    touchAction?: CSSStyleDeclaration['touchAction'];
    /** 仅用于过滤按下事件；已开始的拖拽会继续跟随到松开。 */
    inputFilter?: BAClickFXInputFilter;
  }

  export interface BAClickFXConfig
  {
    scale: number;
    opacity: number;
    clickEnabled: boolean;
    trailEnabled: boolean;
    trailAlways: boolean;
    renderingMode: 'enhanced' | 'legacy';
    bloomBackend: BAClickFXBloomBackend;
    /** 兼容旧 API；WebGL2 与软件 Bloom 后端均为 true。 */
    softwareBloomEnabled: boolean;
    isolatedCompositing: boolean;
    lightBackgroundContrastAlpha: number;
    maxDpr: number;
    touchAction: string;
  }

  export interface UnityFxTouchConfig
  {
    readonly referenceHeight: 1080;
    readonly rootDurationMs: 1000;
    readonly disk: Readonly<Record<string, unknown>>;
    readonly rings: Readonly<Record<string, unknown>>;
    readonly shards: Readonly<Record<string, unknown>>;
    readonly trail: Readonly<Record<string, unknown>>;
    readonly bloom: Readonly<Record<string, unknown>>;
  }

  export interface BAClickFXConfigSnapshot extends BAClickFXConfig
  {
    /** 最近一次解析的实际后端；WebGL2/auto 首次延迟探测前为 'pending'。 */
    readonly resolvedBloomBackend: BAClickFXResolvedBloomBackend;
    readonly unity: UnityFxTouchConfig;
  }

  export const CONFIG: Readonly<BAClickFXConfig>;
  /** 主 Canvas 在 Bloom 后端解析状态变化时派发的事件名。 */
  export const BLOOM_BACKEND_CHANGE_EVENT: 'baclickfxbackendchange';
  export const UNITY_FX_TOUCH: UnityFxTouchConfig;
  export const SIZE_CORRECTION: number;
  export function createConfig(overrides?: Partial<BAClickFXConfig>): BAClickFXConfig;

  export class BAClickFX
  {
    constructor(options?: BAClickFXOptions);

    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;

    /** 在 Canvas 局部坐标触发一次游戏原版 FX_Touch 点击。 */
    boom(x?: number, y?: number): void;

    /** 运行时更新基础开关、Bloom 后端、DPR 与触摸行为。 */
    updateConfig(overrides: Partial<BAClickFXOptions>): void;

    /** 设置主题色（CSS 十六进制），所有蓝色系特效的 hue 将以此偏移。传入空字符串恢复默认。 */
    setThemeColor(hex: string): void;

    /** 通过点号路径修改特效参数，如 'bloom.clickEmissionScale' 或 'hit.enabled'。 */
    setFxParam(path: string, value: number | boolean): void;

    /** 返回当前完整特效配置的深拷贝（与 UNITY_FX_TOUCH 同结构）。 */
    getFxConfig(): Record<string, unknown>;

    /** 重置所有特效参数为游戏默认值。 */
    resetFxConfig(): void;

    clearTrail(): void;
    clear(): void;
    getConfig(): BAClickFXConfigSnapshot;
    destroy(): void;
  }

  export default BAClickFX;
}
