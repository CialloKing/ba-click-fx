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
  export function createConfig(overrides?: Partial<BAClickFXConfig>): BAClickFXConfig;

  export class BAClickFX
  {
    constructor(options?: BAClickFXOptions);

    readonly canvas: HTMLCanvasElement;
    readonly width: number;
    readonly height: number;

    /** 在 Canvas 局部坐标触发一次游戏原版 FX_Touch 点击。 */
    boom(x?: number, y?: number): void;
    clearTrail(): void;
    clear(): void;
    getConfig(): BAClickFXConfig & { readonly unity: UnityFxTouchConfig };
    destroy(): void;
  }

  export default BAClickFX;
}
