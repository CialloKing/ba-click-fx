declare module 'ba-click-fx'
{
  export type BAClickFXInputFilter = (event: PointerEvent) => boolean;
  export type BAClickFXInputSource = 'dom' | 'manual';
  export type BAClickFXPointerType = 'mouse' | 'touch' | 'pen';
  /** 保留旧版纯色相行为，或按 OKLCH 相对映射完整主题颜色。 */
  export type BAClickFXThemeColorMode = 'hue-only' | 'relative-oklch';
  /** Scene 精确路径或普通网页透明覆盖层输出。 */
  export type BAClickFXOutputCompositing =
    'scene' | 'browser-overlay';
  /** 网页覆盖层 Alpha 使用独立传输和，或恢复旧版最大传输分配。 */
  export type BAClickFXOverlayAlphaPolicy = 'coverage' | 'visual-max';
  /** 未知背景颜色不补偿，或仅补偿高能核心。 */
  export type BAClickFXOverlayColorCompensation = 'none' | 'bright-core';
  /** 宿主使用普通覆盖，或由 DOM 执行一次 SDR 亮度近似。 */
  export type BAClickFXHostCompositing =
    | 'source-over'
    | 'screen'
    | 'plus-lighter';
  /** 最终混合发生在网页背景、透明窗口边界或宿主原生合成器。 */
  export type BAClickFXHostCompositingSurface =
    | 'dom-backdrop'
    | 'transparent-window'
    | 'native';
  export type BAClickFXCompositingWarning =
    | 'screen-requires-visible-backdrop'
    | 'plus-lighter-requires-visible-backdrop';
  export type BAClickFXEffectBackend =
    'canvas2d' | 'webgl2' | 'webgpu' | 'auto';
  export type BAClickFXResolvedEffectBackend =
    Exclude<BAClickFXEffectBackend, 'auto'> | 'pending';
  /** WebGPU Canvas 的实际输出协商结果；extended 才代表 HDR 超白输出。 */
  export type BAClickFXWebGPUOutputMode =
    'extended' | 'standard' | 'pending' | 'unavailable';
  export type BAClickFXBloomBackend = 'auto' | 'software' | 'webgl2' | 'native';
  export type BAClickFXResolvedBloomBackend =
    Exclude<BAClickFXBloomBackend, 'auto'> |
    'webgpu' | 'legacy' | 'pending';
  export type BAClickFXRenderingMode = 'enhanced' | 'legacy';

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

  export interface BAClickFXHostCompositingChangeDetail
  {
    readonly requestedHostCompositing: BAClickFXHostCompositing;
    readonly resolvedHostCompositing: BAClickFXHostCompositing;
    readonly hostCompositingSurface: BAClickFXHostCompositingSurface;
    readonly compositingWarning: BAClickFXCompositingWarning | null;
  }

  export type BAClickFXHostCompositingChangeEvent =
    CustomEvent<BAClickFXHostCompositingChangeDetail>;

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

  export interface BAClickFXCompositingReferenceOptions
  {
    /** 当前仅支持与 CSS background-size: cover 对齐的居中裁剪。 */
    fit?: 'cover';
  }

  export interface BAClickFXOptions
  {
    /** CSS 选择器、定位容器或已有 Canvas / OffscreenCanvas；普通容器建议设置 position: relative，省略时创建全屏覆盖层。 */
    target?: string | HTMLElement | OffscreenCanvas;
    /** 相对 Unity 原始尺寸的倍率，默认 1。 */
    scale?: number;
    /** 整体透明度，默认 1。 */
    opacity?: number;
    /** 主题色，默认游戏蓝 '#4ca7ff'；仅接受六位十六进制颜色。 */
    themeColor?: string;
    /** 主题颜色映射模式；公共库默认为兼容旧版的 'hue-only'。 */
    themeColorMode?: BAClickFXThemeColorMode;
    /**
     * 输出合成，默认 'scene'。已知背景的精确路径应配合
     * setCompositingReference()；透明桌面的未知背景使用 'browser-overlay'。
     */
    outputCompositing?: BAClickFXOutputCompositing;
    /** browser-overlay 的 Alpha 分配策略，默认 'coverage'。 */
    overlayAlphaPolicy?: BAClickFXOverlayAlphaPolicy;
    /** 未知背景的颜色补偿，默认 'none'。 */
    overlayColorCompensation?: BAClickFXOverlayColorCompensation;
    /**
     * browser-overlay + source-over 的最终 Alpha 上限。有限值钳制到 0..1，
     * 默认 250/255；与 opacity、HDR 发射和 Bloom 强度相互独立。
     * hostCompositing 为 'screen' 或 'plus-lighter' 时忽略此项。
     */
    overlayAlphaLimit?: number;
    /**
     * 覆盖层与宿主的合成方式，默认 'source-over'。'screen' 与
     * 'plus-lighter' 使用独立完整载荷；screen 会随亮底收敛，plus-lighter
     * 保留暗底激进加色。库自有覆盖层会由 DOM 执行 SDR 近似，外部 Canvas
     * 的样式不会被修改，调用方必须完成最终混合。严格 Unity 一致要求宿主
     * 在线性 HDR 目标中执行 Add。已激活已知合成参考时恢复 source-over。
     */
    hostCompositing?: BAClickFXHostCompositing;
    /**
     * 最终宿主表面，默认 'dom-backdrop' 以保持 1.x 网页行为。透明
     * WebView2/Electron 窗口应显式使用 'transparent-window'；原生合成器
     * 能执行 Screen/Add 时使用 'native'。
     */
    hostCompositingSurface?: BAClickFXHostCompositingSurface;
    clickEnabled?: boolean;
    trailEnabled?: boolean;
    /** 无需按下鼠标，移动即显示拖尾。默认 false。 */
    trailAlways?: boolean;
    /** 'dom' 自动监听 Pointer 事件；'manual' 仅接受宿主注入。默认 'dom'。 */
    inputSource?: BAClickFXInputSource;
    /** 移动输入采样率上限（Hz）；0 不限频，或使用 1..1000 模拟折线拖尾。默认 0。 */
    inputSamplingRate?: number;
    /** 点击波纹、旋转和点击碎片的时间倍率，必须有限且不小于 0.01。默认 1。 */
    clickTimeScale?: number;
    /** 拖尾衰减和拖尾碎片的时间倍率，必须有限且不小于 0.01。默认 1。 */
    trailTimeScale?: number;
    /** 完整特效后端；默认 'webgl2'，WebGPU/WebGL2 不可用时安全回退 Canvas2D。 */
    effectBackend?: BAClickFXEffectBackend;
    /** 是否优先请求 WebGPU Extended HDR Canvas；false 强制标准 SDR 输出。默认 true。 */
    webgpuPreferHdr?: boolean;
    /** WebGPU Extended 输出的线性峰值，范围 2..4，默认 3。 */
    webgpuHdrPeak?: number;
    /** WebGPU Extended 映射后特效增量的整体倍率，范围 0..32，默认 1。 */
    webgpuHdrBrightness?: number;
    /** 高亮增量保持原始线性 RGB 色度方向的程度，范围 0..1，默认 0。 */
    webgpuHdrColorPreservation?: number;
    /** 高能颜色向中性白核混合的强度，范围 0..1，默认 0.6。 */
    webgpuHdrWhiteCore?: number;
    /** 白核混合开始的 SDR 超额线性能量，范围 0..15.99，默认 1。 */
    webgpuHdrWhiteStart?: number;
    /** 白核混合完成的 SDR 超额线性能量，范围 0.01..16，默认 5。 */
    webgpuHdrWhiteEnd?: number;
    /** 渲染模式：'enhanced'（默认，完整 Bloom）或 'legacy'（Unity 材质主体 + Canvas shadowBlur）。 */
    renderingMode?: BAClickFXRenderingMode;
    /** Bloom 后端。默认 'webgl2'；GPU 不可用时回退原生辉光，Software 仅显式选择。 */
    bloomBackend?: BAClickFXBloomBackend;
    /** 兼容旧 API：true 等价于 'software'，false 等价于 'native'。 */
    softwareBloomEnabled?: boolean;
    /** 在透明组内合成多 Canvas 后再覆盖页面，默认 false；已有 Canvas target 不支持。 */
    isolatedCompositing?: boolean;
    /**
     * 浅色背景的非 Bloom 淡青轮廓强度，默认 0；建议与隔离合成一起显式开启。
     * outputCompositing 为 'browser-overlay' 时忽略此项。
     */
    lightBackgroundContrastAlpha?: number;
    /** Canvas backing store 的设备像素比上限，默认 1；可按设备性能显式提高。 */
    maxDpr?: number;
    /**
     * DOM 自动输入的 CSS touch-action 策略。除设置 Canvas CSS 外，覆盖层会
     * 在禁止方向或缩放上阻止原生手势，以避免浏览器 pointercancel 中断拖尾；
     * auto/manipulation 和显式允许全部方向的组合保留原生快速滚动。
     */
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
    themeColor: string;
    themeColorMode: BAClickFXThemeColorMode;
    outputCompositing: BAClickFXOutputCompositing;
    overlayAlphaPolicy: BAClickFXOverlayAlphaPolicy;
    overlayColorCompensation: BAClickFXOverlayColorCompensation;
    overlayAlphaLimit: number;
    hostCompositing: BAClickFXHostCompositing;
    hostCompositingSurface: BAClickFXHostCompositingSurface;
    clickEnabled: boolean;
    trailEnabled: boolean;
    trailAlways: boolean;
    inputSource: BAClickFXInputSource;
    inputSamplingRate: number;
    clickTimeScale: number;
    trailTimeScale: number;
    effectBackend: BAClickFXEffectBackend;
    webgpuPreferHdr: boolean;
    webgpuHdrPeak: number;
    webgpuHdrBrightness: number;
    webgpuHdrColorPreservation: number;
    webgpuHdrWhiteCore: number;
    webgpuHdrWhiteStart: number;
    webgpuHdrWhiteEnd: number;
    renderingMode: BAClickFXRenderingMode;
    bloomBackend: BAClickFXBloomBackend;
    /** 兼容旧 API；仅显式选择软件 Bloom 时为 true。 */
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
    /** 保留兼容字段 hostCompositing，并显式标出调用方请求值。 */
    readonly requestedHostCompositing: BAClickFXHostCompositing;
    /** 根据输出路径、活动参考和宿主表面解析出的实际载荷/混合合同。 */
    readonly resolvedHostCompositing: BAClickFXHostCompositing;
    readonly compositingWarning: BAClickFXCompositingWarning | null;
    /** 最近一次解析的完整特效后端；首次 Scene 提交和恢复验证期间可为 'pending'。 */
    readonly resolvedEffectBackend: BAClickFXResolvedEffectBackend;
    /** WebGPU 可用不等于 HDR；只有 extended 会以扩展 sRGB 保留超白高光。 */
    readonly resolvedWebGPUOutputMode: BAClickFXWebGPUOutputMode;
    /** 最近一次解析的实际后端；WebGL2/auto 首次延迟探测前为 'pending'。 */
    readonly resolvedBloomBackend: BAClickFXResolvedBloomBackend;
    readonly unity: UnityFxTouchConfig;
  }

  export type BAClickFXParamType = 'number' | 'boolean';
  export type BAClickFXParamUnit =
    | 'boolean'
    | 'count'
    | 'direction'
    | 'gamma-hdr'
    | 'linear-hdr'
    | 'ms'
    | 'multiplier'
    | 'px'
    | 'px-per-second'
    | 'ratio'
    | 'samples'
    | 'scalar';

  export type BAClickFXParamGroup =
    | 'hit'
    | 'flare'
    | 'disk'
    | 'rings'
    | 'shards'
    | 'trail'
    | 'bloom';

  /** 参数的宿主控件推荐范围；不代替 min/max 硬校验边界。 */
  export interface BAClickFXParamDisplay
  {
    readonly min: number;
    readonly max: number;
    readonly step: number;
  }

  /** 各渲染模式重置时应恢复的参数基线。 */
  export interface BAClickFXParamModeDefaults
  {
    readonly enhanced: number | boolean;
    readonly legacy: number | boolean;
  }

  /** 可安全交给宿主配置界面的只读标量参数描述。 */
  export interface BAClickFXParamDescriptor
  {
    readonly path: string;
    readonly type: BAClickFXParamType;
    readonly default: number | boolean;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly unit: BAClickFXParamUnit;
    /** 跨版本稳定的全局展示顺序。 */
    readonly order: number;
    readonly group: BAClickFXParamGroup;
    readonly groupOrder: number;
    readonly labelKey: `baClickFx.params.${string}`;
    readonly groupLabelKey: `baClickFx.paramGroups.${BAClickFXParamGroup}`;
    readonly display?: Readonly<BAClickFXParamDisplay>;
    /** 需要在同一界面中协同校验或展示的参数路径。 */
    readonly linkedParams: readonly string[];
    readonly modeDefaults: Readonly<BAClickFXParamModeDefaults>;
  }

  export interface BAClickFXParamRenameMigration
  {
    readonly kind: 'rename';
    readonly from: string;
    readonly to: string;
  }

  export interface BAClickFXParamMigrationSource
  {
    readonly type: BAClickFXParamType;
    readonly min?: number;
    readonly max?: number;
  }

  export interface BAClickFXParamReplaceMigration
  {
    readonly kind: 'replace';
    readonly from: string;
    readonly to: string;
    /** 替换前先验证的旧 Schema 数值契约。 */
    readonly source: Readonly<BAClickFXParamMigrationSource>;
    /** 无可靠等价换算时写入的新 Schema 默认值。 */
    readonly value: BAClickFXParamValue;
  }

  export interface BAClickFXParamMigration
  {
    readonly fromVersion: number;
    readonly toVersion: number;
    readonly changes: readonly (
      BAClickFXParamRenameMigration | BAClickFXParamReplaceMigration
    )[];
  }

  export type BAClickFXParamValue = number | boolean;

  export interface BAClickFXStandalonePatchOptions
  {
    /** 传入持久化补丁所使用的 Schema 版本，默认当前版本。 */
    schemaVersion?: number;
    /** 有任一拒绝项时回滚整批，默认 false。 */
    strict?: boolean;
  }

  export interface BAClickFXParamPatchOptions extends
    BAClickFXStandalonePatchOptions
  {
    /** 应用补丁前先恢复当前渲染模式的默认基线，默认 false。 */
    reset?: boolean;
  }

  export interface BAClickFXParamAppliedEntry
  {
    readonly path: string;
    readonly value: BAClickFXParamValue;
  }

  export type BAClickFXParamNormalizationReason =
    | 'renamed'
    | 'defaulted'
    | 'clamped'
    | 'boolean-coercion';

  export interface BAClickFXParamNormalizedEntry
  {
    readonly path: string;
    readonly from: unknown;
    readonly to: unknown;
    readonly reason: BAClickFXParamNormalizationReason;
  }

  export type BAClickFXParamRejectionReason =
    | 'destroyed'
    | 'duplicate-path'
    | 'invalid-patch'
    | 'invalid-type'
    | 'migration-conflict'
    | 'missing-migration'
    | 'non-finite-number'
    | 'out-of-range'
    | 'unknown-path'
    | 'unsupported-schema-version';

  export interface BAClickFXParamRejectedEntry
  {
    readonly path: string;
    readonly value: unknown;
    readonly reason: BAClickFXParamRejectionReason;
    readonly targetPath?: string;
  }

  export interface BAClickFXParamPatchResult
  {
    readonly applied: readonly BAClickFXParamAppliedEntry[];
    readonly normalized: readonly BAClickFXParamNormalizedEntry[];
    readonly rejected: readonly BAClickFXParamRejectedEntry[];
    readonly committed: boolean;
    readonly schemaVersion: number;
  }

  export const CONFIG: Readonly<BAClickFXConfig>;
  export const DEFAULT_THEME_COLOR: '#4ca7ff';
  export const DEFAULT_THEME_COLOR_MODE: 'hue-only';
  export const FX_PARAM_SCHEMA_VERSION: 2;
  export const FX_PARAM_SCHEMA: readonly BAClickFXParamDescriptor[];
  export const FX_PARAM_MIGRATIONS: readonly BAClickFXParamMigration[];
  /** 主 Canvas 在 Bloom 后端解析状态变化时派发的事件名。 */
  export const BLOOM_BACKEND_CHANGE_EVENT: 'baclickfxbackendchange';
  /** 主 Canvas 在完整特效后端解析状态变化时派发的事件名。 */
  export const EFFECT_BACKEND_CHANGE_EVENT: 'baclickfxeffectbackendchange';
  /** 主 Canvas 在宿主合成解析状态变化时派发的事件名。 */
  export const HOST_COMPOSITING_CHANGE_EVENT: 'baclickfxhostcompositingchange';
  export const UNITY_FX_TOUCH: UnityFxTouchConfig;
  export const SIZE_CORRECTION: number;
  export function createConfig(overrides?: Partial<BAClickFXConfig>): BAClickFXConfig;
  /**
   * 无需 DOM 或渲染实例即可迁移并校验持久化参数补丁。
   * 返回值不会暴露或修改内部 Unity 配置树。
   */
  export function applyFxParamPatch(
    patch: Readonly<Record<string, unknown>>,
    options?: BAClickFXStandalonePatchOptions,
  ): BAClickFXParamPatchResult;

  export class BAClickFX
  {
    constructor(options?: BAClickFXOptions);

    readonly canvas: HTMLCanvasElement | OffscreenCanvas;
    readonly width: number;
    readonly height: number;

    /** 调整画布尺寸与 DPR。在 Worker 或离屏模式下可由宿主主动调用。 */
    resize(width?: number, height?: number, dpr?: number): void;

    /** 在 Canvas 局部坐标触发一次游戏原版 FX_Touch 点击。 */
    boom(x?: number, y?: number): void;

    /** 开始一次点击与拖尾生命周期；两种 inputSource 下均可调用。 */
    pointerDown(input: BAClickFXPointerInput): boolean;

    /** 为当前逻辑指针追加一个拖尾采样点；限频丢弃时仍返回 true。 */
    pointerMove(input: BAClickFXPointerInput): boolean;

    /** 正常结束逻辑指针，已有拖尾继续自然消失。 */
    pointerUp(pointerId?: number): boolean;

    /** 强制取消逻辑指针，并立即移除当前轨迹。 */
    pointerCancel(pointerId?: number): boolean;

    /** 暂停或恢复输入与动画调度；clear 仅在 paused 为 true 时生效。 */
    setPaused(paused: boolean, options?: BAClickFXPauseOptions): void;

    /**
     * 提供与特效下方实际画面逐像素匹配的已解码不透明栅格合成参考。纯
     * WebGL2 与 WebGL2 Bloom 在同一线性 HDR Scene 合成；Native / Legacy
     * 使用 Canvas Final Pass。
     * 当前仅支持居中 cover。调用方负责图片 CORS，并须在替换或销毁前
     * 保持可释放源有效以支持 Context 恢复。Canvas、Video 等动态源上传
     * 调用时的当前帧；内容变化后需再次调用。传入 null 清除合成参考并进入
     * 未知背景路径，不会修改宿主页面 CSS 背景。返回 false 时旧参考保持不变；
     * 延迟创建的 Renderer 仍可能安全回退。
     */
    setCompositingReference(
      source: TexImageSource | null,
      options?: BAClickFXCompositingReferenceOptions,
    ): boolean;

    /** 返回当前实际生效的宿主合成模式。 */
    getEffectiveHostCompositing(): BAClickFXHostCompositing;

    /**
     * 运行时更新合成合同、输入来源/采样率、时间倍率、渲染后端、DPR 与触摸行为。
     * 直接 OffscreenCanvas 会忽略需要切换 Canvas context 类型的后端或渲染模式。
     */
    updateConfig(overrides: BAClickFXUpdateOptions): void;

    /** 设置并保存主题色；传入空字符串或非法值恢复默认游戏蓝。 */
    setThemeColor(hex: string): void;

    /** 设置主题颜色映射模式；非法值返回 false 且保持当前模式不变。 */
    setThemeColorMode(mode: BAClickFXThemeColorMode): boolean;

    /** 设置移动输入采样率上限（Hz）；接受 0 或 1..1000，非法值返回 false。 */
    setInputSamplingRate(rateHz: number): boolean;

    /** 通过点号路径修改特效参数；未知路径或非法值返回 false 且保持配置不变。 */
    setFxParam(path: string, value: BAClickFXParamValue): boolean;

    /** 设置全部三角碎片圆角比例；0 保持原图集，1 变为同尺寸圆形。 */
    setTriangleRoundness(roundness: number): boolean;

    /** 原子验证并批量应用扁平点号路径补丁。 */
    setFxParams(
      patch: Readonly<Record<string, BAClickFXParamValue>>,
      options?: BAClickFXParamPatchOptions,
    ): BAClickFXParamPatchResult;

    /** 返回当前完整特效配置的深拷贝（与 UNITY_FX_TOUCH 同结构）。 */
    getFxConfig(): Record<string, unknown>;

    /** 重置所有特效参数为当前 Enhanced 或 Legacy 模式的默认基线。 */
    resetFxConfig(): void;

    clearTrail(): void;
    clear(): void;
    getConfig(): BAClickFXConfigSnapshot;
    destroy(): void;
  }

  export default BAClickFX;
}
