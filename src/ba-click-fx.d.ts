declare module 'ba-click-fx'
{
  export type BAClickFXInputFilter = (event: PointerEvent) => boolean;

  export interface BAClickFXOptions
  {
    /** CSS 选择器、容器元素或已有 Canvas；省略时创建全屏覆盖层。 */
    target?: string | HTMLElement;
    /** 相对 Unity 原始尺寸的倍率，默认 1。 */
    scale?: number;
    /** 整体透明度，默认 1。 */
    opacity?: number;
    clickEnabled?: boolean;
    trailEnabled?: boolean;
    /** 无需按下鼠标，移动即显示拖尾。默认 false。 */
    trailAlways?: boolean;
    /** 渲染模式：'enhanced'（默认，线性能量；Bloom 由 softwareBloomEnabled 选择软件或原生）或 'legacy'（sRGB + shadowBlur，main 分支风格）。 */
    renderingMode?: 'enhanced' | 'legacy';
    /** 使用 Float32 中间缓冲执行纯 JavaScript 软件 Bloom。默认 true。 */
    softwareBloomEnabled?: boolean;
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
    softwareBloomEnabled: boolean;
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

  export const CONFIG: Readonly<BAClickFXConfig>;
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

    /** 运行时更新基础开关、软件 Bloom、DPR 与触摸行为。 */
    updateConfig(overrides: Partial<BAClickFXOptions>): void;

    /** 设置主题色（CSS 十六进制），所有蓝色系特效的 hue 将以此偏移。传入空字符串恢复默认。 */
    setThemeColor(hex: string): void;

    /** 通过点号路径修改特效参数，如 'rings.hdrIntensity'。 */
    setFxParam(path: string, value: number): void;

    /** 返回当前完整特效配置的深拷贝（与 UNITY_FX_TOUCH 同结构）。 */
    getFxConfig(): Record<string, unknown>;

    /** 重置所有特效参数为游戏默认值。 */
    resetFxConfig(): void;

    clearTrail(): void;
    clear(): void;
    getConfig(): BAClickFXConfig & { readonly unity: UnityFxTouchConfig };
    destroy(): void;
  }

  export default BAClickFX;
}
