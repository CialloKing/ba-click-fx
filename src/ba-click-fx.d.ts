declare module 'ba-click-fx'
{
  export type BAClickFXInputFilter = (event: PointerEvent) => boolean;
  export type BAClickFXInputSource = 'dom' | 'manual';
  export type BAClickFXPointerType = 'mouse' | 'touch' | 'pen';
  export type BAClickFXOutputCompositing =
    'scene' | 'transparent-overlay';
  export type BAClickFXEffectBackend = 'canvas2d' | 'webgl2' | 'auto';
  export type BAClickFXResolvedEffectBackend =
    Exclude<BAClickFXEffectBackend, 'auto'> | 'pending';
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

  export interface BAClickFXEffectBackendChangeDetail
  {
    readonly requestedEffectBackend: BAClickFXEffectBackend;
    readonly resolvedEffectBackend: BAClickFXResolvedEffectBackend;
  }

  export type BAClickFXEffectBackendChangeEvent =
    CustomEvent<BAClickFXEffectBackendChangeDetail>;

  export interface BAClickFXPointerInput
  {
    /** Canvas 局部 CSS 像素坐标。 */
    x: number;
    /** Canvas 局部 CSS 像素坐标。 */
    y: number;
    /** 逻辑指针 ID，默认 1。 */
    pointerId?: number;
    pointerType?: BAClickFXPointerType;
  }

  export interface BAClickFXPauseOptions
  {
    /** 暂停时是否同时清除全部视觉对象，默认 false。 */
    clear?: boolean;
  }

  export interface BAClickFXSceneBackgroundOptions
  {
    /** 当前仅支持与 CSS background-size: cover 对齐的居中裁剪。 */
    fit?: 'cover';
  }

  export interface BAClickFXOptions
  {
    /** CSS 选择器、定位容器或已有 Canvas；普通容器建议设置 position: relative，省略时创建全屏覆盖层。 */
    target?: string | HTMLElement;
    /** 相对 Unity 原始尺寸的倍率，默认 1。 */
    scale?: number;
    /** 整体透明度，默认 1。 */
    opacity?: number;
    /** 输出合成：默认 'scene'；透明桌面覆盖层使用 'transparent-overlay'。 */
    outputCompositing?: BAClickFXOutputCompositing;
    clickEnabled?: boolean;
    trailEnabled?: boolean;
    /** 无需按下鼠标，移动即显示拖尾。默认 false。 */
    trailAlways?: boolean;
    /** 'dom' 自动监听 Pointer 事件；'manual' 仅接受宿主注入。默认 'dom'。 */
    inputSource?: BAClickFXInputSource;
    /** 点击波纹、旋转和点击碎片的时间倍率，必须有限且大于 0。默认 1。 */
    clickTimeScale?: number;
    /** 拖尾衰减和拖尾碎片的时间倍率，必须有限且大于 0。默认 1。 */
    trailTimeScale?: number;
    /** 完整特效后端；默认 'webgl2'，未就绪或丢失时安全回退 Canvas2D。 */
    effectBackend?: BAClickFXEffectBackend;
    /** 渲染模式：'enhanced'（默认，完整 Bloom）或 'legacy'（Unity 材质主体 + Canvas shadowBlur）。 */
    renderingMode?: 'enhanced' | 'legacy';
    /** Bloom 后端。默认 'webgl2'；不可用时会自动回退软件 Bloom 与原生辉光。 */
    bloomBackend?: BAClickFXBloomBackend;
    /** 兼容旧 API：true 等价于 'software'，false 等价于 'native'。 */
    softwareBloomEnabled?: boolean;
    /** 在透明组内合成多 Canvas 后再覆盖页面，默认 false；已有 Canvas target 不支持。 */
    isolatedCompositing?: boolean;
    /** 浅色背景的非 Bloom 淡青轮廓强度，默认 0；建议与隔离合成一起显式开启。 */
    lightBackgroundContrastAlpha?: number;
    /** Canvas backing store 的设备像素比上限，默认 2。 */
    maxDpr?: number;
    touchAction?: CSSStyleDeclaration['touchAction'];
    /** 仅用于自动 DOM 输入准入；手动指针方法不会调用此过滤器。 */
    inputFilter?: BAClickFXInputFilter;
  }

  /** 可在实例存续期间安全修改的配置；目标元素和 DOM 过滤器仅在构造时生效。 */
  export type BAClickFXUpdateOptions = Partial<
    Omit<BAClickFXOptions, 'target' | 'inputFilter'>
  >;

  export interface BAClickFXConfig
  {
    scale: number;
    opacity: number;
    outputCompositing: BAClickFXOutputCompositing;
    clickEnabled: boolean;
    trailEnabled: boolean;
    trailAlways: boolean;
    inputSource: BAClickFXInputSource;
    clickTimeScale: number;
    trailTimeScale: number;
    effectBackend: BAClickFXEffectBackend;
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
    /** 原根 ParticleSystem 的对象池释放元数据，不是网页视觉时间轴。 */
    readonly rootDurationMs: 1000;
    readonly disk: Readonly<Record<string, unknown>>;
    readonly rings: Readonly<Record<string, unknown>>;
    readonly shards: Readonly<Record<string, unknown>>;
    readonly trail: Readonly<Record<string, unknown>>;
    readonly bloom: Readonly<Record<string, unknown>>;
  }

  export interface BAClickFXConfigSnapshot extends BAClickFXConfig
  {
    /** 最近一次解析的完整特效后端；首次 Scene 提交和恢复验证期间可为 'pending'。 */
    readonly resolvedEffectBackend: BAClickFXResolvedEffectBackend;
    /** 最近一次解析的实际后端；WebGL2/auto 首次延迟探测前为 'pending'。 */
    readonly resolvedBloomBackend: BAClickFXResolvedBloomBackend;
    readonly unity: UnityFxTouchConfig;
  }

  export const CONFIG: Readonly<BAClickFXConfig>;
  /** 主 Canvas 在 Bloom 后端解析状态变化时派发的事件名。 */
  export const BLOOM_BACKEND_CHANGE_EVENT: 'baclickfxbackendchange';
  /** 主 Canvas 在完整特效后端解析状态变化时派发的事件名。 */
  export const EFFECT_BACKEND_CHANGE_EVENT: 'baclickfxeffectbackendchange';
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

    /** 开始一次点击与拖尾生命周期；两种 inputSource 下均可调用。 */
    pointerDown(input: BAClickFXPointerInput): boolean;

    /** 为当前逻辑指针追加一个拖尾采样点。 */
    pointerMove(input: BAClickFXPointerInput): boolean;

    /** 正常结束逻辑指针，已有拖尾继续自然消失。 */
    pointerUp(pointerId?: number): boolean;

    /** 强制取消逻辑指针，并立即移除当前轨迹。 */
    pointerCancel(pointerId?: number): boolean;

    /** 暂停或恢复输入与动画调度；clear 仅在 paused 为 true 时生效。 */
    setPaused(paused: boolean, options?: BAClickFXPauseOptions): void;

    /**
     * 提供特效下方的已解码不透明栅格场景。纯 WebGL2 与 WebGL2 Bloom
     * 在同一线性 HDR Scene 合成；Native / Legacy 使用 Canvas Final Pass。
     * 当前仅支持居中 cover。调用方负责图片 CORS，并须在替换或销毁前
     * 保持可释放源有效以支持 Context 恢复。Canvas、Video 等动态源上传
     * 调用时的当前帧；内容变化后需再次调用。传入 null 恢复透明 DOM 背景。
     * 返回 false 时旧背景保持不变；延迟创建的 Renderer 仍可能安全回退。
     */
    setSceneBackground(
      source: TexImageSource | null,
      options?: BAClickFXSceneBackgroundOptions,
    ): boolean;

    /** 运行时更新输入来源、时间倍率、特效后端、Bloom 后端、DPR 与触摸行为。 */
    updateConfig(overrides: BAClickFXUpdateOptions): void;

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
