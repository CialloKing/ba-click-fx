import {
  setRenderState, themeHueShift, relativeOklchTheme, gradientEnergyCache, ringSampleCache,
} from './engine-render-state.js';

import {
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
  cancelRenderFrame,
  clamp,
  createCanvas,
  isCanvas,
  isOffscreenCanvas,
  releaseTrailGradients,
  setOverlayStyle,
} from './engine-shared.js';
import {
  RenderRuntime,
} from './engine-render.js';
import {
  CONFIG,
  DEFAULT_THEME_COLOR,
  DEFAULT_THEME_COLOR_MODE,
  FX_PARAM_MIGRATIONS,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  UNITY_FX_TOUCH,
  assertConfigOverrides,
  createConfig,
  normalizeThemeColor,
  resolveHostCompositing,
  SIZE_CORRECTION,
} from './config.js';
import {
  createRelativeOklchTheme,
} from './theme-color.js';
import {
  applyFxParamPatch as prepareFxParamPatch,
} from './fx-param-patch.js';
import {
  getTrailRenderPoints,
} from './trail-lifetime.js';

import {
  SoftwareBloomRenderer,
} from './software-bloom.js';

import {
  CUSTOM_BUILD,
  BUILD_DOM,
  BUILD_WORKER,
  BUILD_WEBGL,
  BUILD_WEBGPU,
  BUILD_WEBGL_BLOOM,
  BUILD_SOFTWARE,
  BUILD_NATIVE,
  BUILD_CANVAS,
  BUILD_TRAIL,
  BUILD_BLOOM,
  BUILD_REFERENCE,
  FIXED_CONFIG,
  FIXED_FX,
  FIXED_THEME,
} from './build-capabilities.js';
import {
  computeThemeHueShift,
} from './engine-materials.js';

/**
 * ba-click-fx — Blue Archive 的 UI/FX_Touch 浏览器移植。
 *
 * 这不是“相似风格”参数化引擎。实现移植 Unity 中 FXTouch、
 * ParticleSystem 和 TrailRenderer 的生命周期，只保留宿主接入所需的最小 API。
 */

const HOST_COMPOSITING_CHANGE_EVENT = 'baclickfxhostcompositingchange';

function requestRenderFrame(callback)
{
  if (typeof requestAnimationFrame === 'function')
  {
    return requestAnimationFrame(callback);
  }

  // 部分 Dedicated Worker 没有 RAF；定时器只负责帧调度，不接管 Worker 协议。
  return setTimeout(() => callback(performance.now()), 1000 / 60);
}

function shouldUseTouchInputFallback()
{
  if (typeof window === 'undefined')
  {
    return false;
  }

  if (typeof window.PointerEvent === 'function')
  {
    return false;
  }

  // 旧版 Safari/WebView 可能只暴露 TouchEvent 或 ontouchstart；这些宿主
  // 不会生成 PointerEvent，Touch 仲裁监听必须同时承担实际输入转发。
  return typeof window.TouchEvent === 'function' ||
    'ontouchstart' in window ||
    Number(window.navigator?.maxTouchPoints) > 0;
}

function getCompositingReferenceDimensions(source)
{
  if (!source)
  {
    return null;
  }

  let width;
  let height;

  try
  {
    width = source.naturalWidth ??
      source.videoWidth ??
      source.displayWidth ??
      source.width;
    height = source.naturalHeight ??
      source.videoHeight ??
      source.displayHeight ??
      source.height;
  }
  catch
  {
    return null;
  }

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
  {
    return null;
  }

  return { width, height };
}

function resolveTarget(target)
{
  if (typeof target === 'string')
  {
    const host = typeof document !== 'undefined' && typeof document.querySelector === 'function'
      ? document.querySelector(target)
      : null;
    // 显式选择器查找失败不能与省略 target 混为一谈，否则会意外挂载全屏层。
    if (!host)
    {
      throw new Error('BAClickFX 找不到 target');
    }
    return host;
  }

  return target ?? null;
}

function createOverlayRoot(fixed)
{
  const root = document.createElement('div');

  root.setAttribute('aria-hidden', 'true');
  root.style.position = fixed ? 'fixed' : 'absolute';
  root.style.inset = '0';
  root.style.width = '100%';
  root.style.height = '100%';
  root.style.pointerEvents = 'none';
  root.style.zIndex = '2147483647';
  // 显式建立混合隔离组，避免依赖 position/contain 的隐式 stacking-context 规则。
  root.style.isolation = 'isolate';
  return root;
}

export class BAClickFX extends RenderRuntime
{
  /**
   * @param {object} [options]
   * @param {string|HTMLElement|OffscreenCanvas} [options.target]
   * @param {number} [options.scale]
   * @param {number} [options.opacity]
   * @param {string} [options.themeColor]
   * @param {'hue-only'|'relative-oklch'} [options.themeColorMode]
   * @param {boolean} [options.clickEnabled]
   * @param {boolean} [options.trailEnabled]
   * @param {boolean} [options.trailAlways]
   * @param {'dom'|'manual'} [options.inputSource]
   * @param {number} [options.inputSamplingRate]
   * @param {number} [options.clickTimeScale]
   * @param {number} [options.trailTimeScale]
   * @param {'scene'|'browser-overlay'} [options.outputCompositing]
   * @param {'coverage'|'visual-max'} [options.overlayAlphaPolicy]
   * @param {'none'|'bright-core'} [options.overlayColorCompensation]
   * @param {number} [options.overlayAlphaLimit]
   * @param {'source-over'|'screen'|'plus-lighter'} [options.hostCompositing]
   * @param {'dom-backdrop'|'transparent-window'|'native'} [options.hostCompositingSurface]
   * @param {'canvas2d'|'webgl2'|'webgpu'|'auto'} [options.effectBackend]
   * @param {boolean} [options.webgpuPreferHdr]
   * @param {number} [options.webgpuHdrPeak]
   * @param {number} [options.webgpuHdrBrightness]
   * @param {number} [options.webgpuHdrColorPreservation]
   * @param {number} [options.webgpuHdrWhiteCore]
   * @param {number} [options.webgpuHdrWhiteStart]
   * @param {number} [options.webgpuHdrWhiteEnd]
   * @param {'auto'|'software'|'webgl2'|'native'} [options.bloomBackend]
   * @param {boolean} [options.isolatedCompositing]
   * @param {number} [options.lightBackgroundContrastAlpha]
   * @param {number} [options.maxDpr]
   * @param {string} [options.touchAction]
   * @param {(event: PointerEvent) => boolean} [options.inputFilter]
   */
  constructor(options = {})
  {

    super();

    if (CUSTOM_BUILD)
    {
      const allowed = BUILD_DOM ? ['target', 'inputFilter', 'onError'] : ['target', 'onError'];
      if (!options || typeof options !== 'object' || Array.isArray(options))
      {
        throw new TypeError('BAClickFX 构造参数必须是对象');
      }
      for (const [key, value] of Object.entries(options))
      {
        if (!allowed.includes(key) || (key !== 'target' && value !== undefined && typeof value !== 'function'))
        {
          throw new TypeError(`BAClickFX 定制版不接受构造参数: ${key}`);
        }
      }
      this.onError = options.onError ?? null;
      this.buildFailed = false;
      if (options.inputFilter !== undefined && typeof options.inputFilter !== 'function')
      {
        throw new TypeError('BAClickFX inputFilter 必须是函数');
      }
      if (BUILD_DOM ? isCanvas(options.target) : !isCanvas(options.target))
      {
        throw new TypeError('BAClickFX target 与构建的 runtime 不匹配');
      }
      if (!BUILD_DOM && (BUILD_WORKER !== isOffscreenCanvas(options.target)))
      {
        throw new TypeError('BAClickFX target 的 Canvas 类型与构建的 runtime 不匹配');
      }
    }
    else
    {
      assertConfigOverrides(options, { allowInstanceOptions: true });
    }
    const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
    const hasOffscreen = typeof OffscreenCanvas !== 'undefined';

    if (!hasDom && !hasOffscreen)
    {
      throw new Error('BAClickFX 需要浏览器 DOM 或 Web Worker (OffscreenCanvas) 环境');
    }

    if (!hasDom && !isOffscreenCanvas(options.target))
    {
      throw new Error('BAClickFX 在 Worker 中需要显式传入 OffscreenCanvas target');
    }

    const { target: _target, inputFilter: _inputFilter, ...configOptions } = options;

    this.config = CUSTOM_BUILD ? FIXED_CONFIG : createConfig(configOptions);
    this.inputFilter = typeof options.inputFilter === 'function'
      ? options.inputFilter
      : null;
    this.host = resolveTarget(options.target);
    this.ownsCanvas = !isCanvas(this.host);
    if (CUSTOM_BUILD && BUILD_DOM && isCanvas(this.host))
    {
      throw new TypeError('DOM 定制版需要容器 target，已有 Canvas 请选择 manual 构建');
    }
    if (!CUSTOM_BUILD && !this.ownsCanvas)
    {
      // 已有 Canvas 无法承载主层、Bloom 层和对比层组成的独立合成组。
      this.config.isolatedCompositing = false;
    }
    this.canvas = isCanvas(this.host) ? this.host : createCanvas();
    this.contrastCanvas = this.ownsCanvas ? createCanvas() : null;
    this.webglBloomCanvas = null;
    this.webglBloomRenderer = null;
    this.webglBloomUnavailable = false;
    this.webglBloomVisible = false;
    this.webglEffectCanvas = null;
    this.webglEffectRenderer = null;
    this.webglEffectUnavailable = false;
    this.webglEffectVisible = false;
    this.webgpuEffectCanvas = null;
    this.webgpuEffectRenderer = null;
    this.webgpuEffectUnavailable = false;
    this.webgpuEffectVisible = false;
    this.canvasSceneCanvas = null;
    this.canvasSceneRenderer = null;
    this.canvasSceneUnavailable = false;
    this.canvasSceneVisible = false;
    this.compositingReferenceSource = null;
    this.compositingReferenceFit = 'cover';
    this.compositingMountPending = false;
    this.hostCompositingState = this._resolveHostCompositingState();

    if (!this.canvas)
    {
      throw new Error('BAClickFX 找不到 target');
    }

    if (this.ownsCanvas)
    {
      const parent = this.host ?? document.body;

      this.overlayMountParent = parent;
      this.overlayRoot = createOverlayRoot(!this.host);

      // 粒子与 Bloom 已在各后端内部完成加色；最终覆盖层统一使用普通
      // source-over，避免 CSS plus-lighter 再次抬高桌面亮度。
      setOverlayStyle(this.canvas, false, '2147483646', '');
      setOverlayStyle(this.contrastCanvas, false, '2147483647', 'darken');

    }
    else
    {
      this.overlayMountParent = null;
      this.overlayRoot = null;
      this.overlayParent = null;
    }

    const isDirectOffscreen = isOffscreenCanvas(this.canvas);
    const requiresCanvas2D = CUSTOM_BUILD
      ? BUILD_CANVAS
      : !isDirectOffscreen || this.config.effectBackend === 'canvas2d';

    // Canvas 上下文类型一旦确定便不能切换；GPU 模式必须把首次请求留给 WebGL2。
    try
    {
      this.context = requiresCanvas2D ? this.canvas.getContext('2d') : null;
      this.contrastContext = this.contrastCanvas?.getContext('2d') ?? null;
      if (!this.context && requiresCanvas2D)
      {
        throw new Error('BAClickFX 无法创建 Canvas 2D 上下文');
      }
    }
    catch (cause)
    {
      const error = new Error('BAClickFX 无法创建 Canvas 2D 上下文', { cause });
      if (CUSTOM_BUILD)
      {
        error.code = 'initialization-failed';
        this.onError?.(error);
      }
      throw error;
    }

    // 确认上下文可用后才挂载节点和修改宿主样式，构造失败不会留下孤立覆盖层。
    this._applyCompositingMount();
    if (this.canvas.style)
    {
      this.canvas.style.touchAction = this.config.touchAction;
    }

    // 内部 Canvas 仅承担发射遮罩和 ImageData 暂存，不会插入 DOM。
    this.bloomRenderer = BUILD_SOFTWARE && BUILD_BLOOM
      ? new SoftwareBloomRenderer(() => createCanvas()) : null;
    this.bloomRenderers = this.bloomRenderer ? [this.bloomRenderer] : [];
    // WebGL Scene 延迟到首帧创建；能力尚未探测时必须报告 pending，
    // 避免宿主先收到一次并不存在的 Canvas2D 回退。
    this.resolvedEffectBackend = this._getRequestedEffectBackendState();
    this.resolvedBloomBackend = this._getRequestedBloomBackendState();
    this.softwareBloomFrameStats = {
      regionCount: 0,
      processedSourcePixels: 0,
      combinedBoundsPixels: 0,
    };
    // Canvas 回读在同一渲染时刻失败时，保留上一张已经完成的 Bloom 输出。
    // 它只用于相同输入的过渡帧，避免故障瞬间把透明拖尾降成细线。
    this.lastSoftwareBloomFrame = null;
    if (BUILD_SOFTWARE && BUILD_BLOOM) this.softwareBloomIdleTimer = null;
    if (BUILD_WEBGL || BUILD_WEBGPU || BUILD_WEBGL_BLOOM) this.gpuFrameIdleTimer = null;
    // visual-max 必须保留独立 Bloom transport；该离屏层按需创建，不进入 DOM。
    this.canvasBloomTransportCanvas = null;
    this.canvasBloomTransportContext = null;
    this.canvasNativeSceneAlphaSnapshot = null;
    this.webglBloomFrameStats =
    {
      available: false,
      vertexCount: 0,
      levelCount: 0,
      bloomPixels: 0,
    };
    this.nativeTrailBloomSurface = undefined;
    this.nativeClickBloomSurface = null;

    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.fxConfig = CUSTOM_BUILD ? FIXED_FX : structuredClone(UNITY_FX_TOUCH);
    this._gradientEnergyCache = new WeakMap();
    this._fxConfigVersion = 0;
    this._softwareBloomConfigSignature = null;
    this._themeVersion = 0;
    this._themeHueShift = computeThemeHueShift(this.config.themeColor);
    this._relativeOklchTheme = CUSTOM_BUILD ? FIXED_THEME : this.config.themeColorMode === 'relative-oklch'
      ? createRelativeOklchTheme(this.config.themeColor)
      : null;
    this.waves = [];
    this.shards = [];
    this.trailStrokes = [];
    this.currentTrailStroke = null;
    this.activeTrailOwnerId = null;
    this.nextTrailOwnerId = 1;
    this.trailShardCounts = new Map();
    this.activePointerId = null;
    this.activePointerSource = null;
    // 仅由 Touch-only fallback 写入；兜底结束事件不能误释放手动指针。
    this.fallbackTouchPointerId = null;
    this.lastPointerPosition = null;
    this.lastPointerTime = 0;
    // 输入采样率使用未缩放的 source time，不能复用拖尾虚拟时钟。
    this.lastInputSampleSourceTime = null;
    this.trailDistanceSinceShard = 0;
    this.touchGestureStarts = new Map();
    this.touchPointerFilterResults = [];
    this.closedShadowPointerDecisions = new WeakMap();
    this.usesTouchInputFallback = shouldUseTouchInputFallback();
    this.touchActionListenersAttached = false;
    this.closedShadowTouchListenersAttached = false;
    const initialTimeSource = performance.now();

    this.clickTimeMs = 0;
    this.trailTimeMs = 0;
    this.lastClickTimeSource = initialTimeSource;
    this.lastTrailTimeSource = initialTimeSource;
    this.animationFrame = null;
    this.lastFrameTime = null;
    this.renderingFrame = false;
    this.paused = false;
    this.destroyed = false;
    this.domPointerListenersAttached = false;

    // 浏览器事件和 ResizeObserver 都会传入参数，不能让它们进入公开尺寸覆盖值。
    this._onResize = () => this._resize();
    if (BUILD_DOM)
    {
      this._onPointerDown = this._handlePointerDown.bind(this);
      this._onPointerMove = this._handlePointerMove.bind(this);
      this._onPointerUp = this._handlePointerUp.bind(this);
      this._onPointerCancel = this._handlePointerCancel.bind(this);
      this._onClosedShadowPointerDown =
        this._handleClosedShadowPointerDown.bind(this);
      this._onTouchStart = this._handleTouchStart.bind(this);
      this._onTouchMove = this._handleTouchMove.bind(this);
      this._onTouchEnd = this._handleTouchEnd.bind(this);
      this._onBlur = this._cancelPointer.bind(this);
    }
    this._onFrame = this._renderFrame.bind(this);
    this._onWebGLContextLost = this._handleWebGLContextLost.bind(this);
    this._onWebGLContextRestored = this._handleWebGLContextRestored.bind(this);
    this._onWebGLEffectContextLost =
      this._handleWebGLEffectContextLost.bind(this);
    this._onWebGLEffectContextRestored =
      this._handleWebGLEffectContextRestored.bind(this);
    this._onCanvasSceneContextLost =
      this._handleCanvasSceneContextLost.bind(this);
    this._onCanvasSceneContextRestored =
      this._handleCanvasSceneContextRestored.bind(this);

    this._resize();
    if (!CUSTOM_BUILD &&
      isDirectOffscreen &&
      !requiresCanvas2D &&
      !this._prepareWebGLEffectBackend()
    )
    {
      // getContext('webgl2') 返回 null 时画布仍可回退 2D；若 WebGL2 已经
      // 锁定但完整 Scene 初始化失败，则必须让宿主换一张画布重建实例。
      this.context = this.canvas.getContext('2d');
      if (!this.context)
      {
        if (this.animationFrame !== null)
        {
          cancelRenderFrame(this.animationFrame);
          this.animationFrame = null;
        }
        throw new Error(
          'BAClickFX 无法在 OffscreenCanvas 上初始化 WebGL2；请使用新的画布并显式选择 Canvas2D',
        );
      }
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    // OffscreenCanvas 的首次 context 请求决定其终身类型；记录实际结果，
    // 防止后续配置把可用实例切换到无法创建的另一种 context。
    this._directOffscreenContextType = isDirectOffscreen
      ? this.context
        ? '2d'
        : 'webgl2'
      : null;
    if (BUILD_DOM && typeof window !== 'undefined')
    {
      window.addEventListener('resize', this._onResize);
    }
    if (BUILD_DOM && this.config.inputSource === 'dom' && typeof window !== 'undefined')
    {
      this._attachDomPointerListeners();
    }
    if (BUILD_DOM && typeof window !== 'undefined')
    {
      window.addEventListener('blur', this._onBlur);
    }

    if (this.host && !isCanvas(this.host) && typeof ResizeObserver !== 'undefined')
    {
      this.resizeObserver = new ResizeObserver(this._onResize);
      this.resizeObserver.observe(this.host);
    }
    else
    {
      this.resizeObserver = null;
    }
  
  }

  _getOverlayLayers()
  {
    return [
      this.canvas,
      this.webglBloomCanvas,
      this.webglEffectCanvas,
      this.webgpuEffectCanvas,
      this.canvasSceneCanvas,
      this.contrastCanvas,
    ]
      .filter(Boolean);
  }

  _getEffectiveHostCompositing()
  {
    return this._resolveHostCompositingState().resolvedHostCompositing;
  }

  getEffectiveHostCompositing()
  {
    return this._getEffectiveHostCompositing();
  }

  _resolveHostCompositingState()
  {
    const resolution = resolveHostCompositing(
      {
        outputCompositing: this.config.outputCompositing,
        requestedHostCompositing: this.config.hostCompositing,
        hostCompositingSurface: this.config.hostCompositingSurface,
        hasCompositingReference: this._hasActiveCompositingReference(),
      },
    );

    return {
      requestedHostCompositing: this.config.hostCompositing,
      hostCompositingSurface: this.config.hostCompositingSurface,
      ...resolution,
    };
  }

  _syncHostCompositingState()
  {
    this._invalidateCanvasBoundsScope();
    const previous = this.hostCompositingState;
    const next = this._resolveHostCompositingState();
    const unchanged = previous &&
      previous.requestedHostCompositing === next.requestedHostCompositing &&
      previous.resolvedHostCompositing === next.resolvedHostCompositing &&
      previous.hostCompositingSurface === next.hostCompositingSurface &&
      previous.compositingWarning === next.compositingWarning;

    this.hostCompositingState = next;

    if (
      unchanged ||
      typeof CustomEvent !== 'function' ||
      typeof this.canvas?.dispatchEvent !== 'function'
    )
    {
      return;
    }

    try
    {
      this.canvas.dispatchEvent(
        new CustomEvent(
          HOST_COMPOSITING_CHANGE_EVENT,
          { detail: { ...next } },
        ),
      );
    }
    catch
    {
      // 状态通知不能中断渲染；旧 DOM 环境仍可通过 getConfig() 查询。
    }
  }

  _requestCompositingMountRefresh()
  {
    this._syncHostCompositingState();

    // 只要还有可见对象，就必须让当前像素先按新合同重绘，再改变根节点
    // 的混合模式；否则暂停帧或 Context 回退会被错误的 CSS 重新解释。
    if (this._hasVisibleEffects())
    {
      this.compositingMountPending = true;
      return;
    }

    this.compositingMountPending = false;
    this._applyCompositingMount();
  }

  _flushCompositingMountRefresh()
  {
    if (!this.compositingMountPending)
    {
      return;
    }

    this.compositingMountPending = false;
    this._applyCompositingMount();
  }

  _applyCompositingMount()
  {
    const hostIndependent = this._usesIndependentHostPayload();
    const usesDomBackdrop = this.config.hostCompositingSurface ===
      'dom-backdrop';

    if (!this.ownsCanvas)
    {
      // 外部 Canvas 的样式归调用方所有。渲染器仍按 hostCompositing 输出
      // 完整独立载荷，但 CSS、WebView 或原生宿主的混合由调用方执行。
      return;
    }

    if (!this.overlayMountParent || !this.overlayRoot)
    {
      return;
    }

    const isolated = this.config.isolatedCompositing;
    const grouped = isolated || hostIndependent;
    const parent = grouped ? this.overlayRoot : this.overlayMountParent;

    // 子层先按普通 source-over 解析；宿主混合只允许在完整组上执行一次。
    this.overlayRoot.style.mixBlendMode = hostIndependent && usesDomBackdrop
      ? this._getEffectiveHostCompositing()
      : '';

    for (const canvas of this._getOverlayLayers())
    {
      const contrastBlend = canvas === this.contrastCanvas &&
        !hostIndependent;

      canvas.style.mixBlendMode = contrastBlend
        ? 'darken'
        : '';
    }

    if (grouped)
    {
      this.overlayMountParent.appendChild(this.overlayRoot);
    }

    for (const canvas of this._getOverlayLayers())
    {
      // 直接合成时恢复旧版 fixed/absolute 定位；隔离组内一律相对根层铺满。
      canvas.style.position = grouped || this.host ? 'absolute' : 'fixed';
      parent.appendChild(canvas);
    }

    if (!grouped)
    {
      this.overlayRoot.remove();
    }

    this.overlayParent = parent;
  }

  _getScale()
  {
    return this.config.scale *
      (this.height / UNITY_FX_TOUCH.referenceHeight) *
      SIZE_CORRECTION;
  }

  _requestRender()
  {
    this._invalidateCanvasBoundsScope();
    if (BUILD_CANVAS) this._syncCanvasTextureOwner();
    if (BUILD_SOFTWARE && BUILD_BLOOM && this._hasVisibleEffects()) this._cancelSoftwareBloomRelease();
    if ((BUILD_WEBGL || BUILD_WEBGPU || BUILD_WEBGL_BLOOM) && this._hasVisibleEffects()) this._cancelGpuFrameRelease();
    if (this.destroyed || this.paused || this.animationFrame !== null || (CUSTOM_BUILD && this.buildFailed))
    {
      return;
    }

    this.lastFrameTime = this.lastFrameTime ?? performance.now();
    this.animationFrame = requestRenderFrame(this._onFrame);
  }

  _renderFrame(now)
  {
    // 只有同实例嵌套帧隔离工作区；常规移动帧不复制数组或快照。
    const nested = BUILD_TRAIL && this._trailRenderDepth > 0;
    const saved = nested ? this.trailStrokes.map(stroke =>
      ({ stroke, data: stroke.trailFrameData, cache: stroke.trailFrameCache, work: stroke.trailWork })) : null;
    if (saved)
    {
      for (const { stroke } of saved)
        stroke.trailFrameData = stroke.trailFrameCache = stroke.trailWork = null;
    }
    this._trailRenderDepth = (this._trailRenderDepth ?? 0) + 1;
    try
    {
      return this._renderFrameBody(now);
    }
    finally
    {
      this._trailRenderDepth--;
      if (saved) for (const entry of saved)
      {
        const { stroke, data, cache, work } = entry;
        releaseTrailGradients(stroke.trailWork);
        const retain = !this.destroyed && this.trailStrokes.includes(stroke) && getTrailRenderPoints(stroke).length >= 2;
        stroke.trailFrameData = retain ? data : null;
        stroke.trailFrameCache = retain ? cache : null;
        stroke.trailWork = retain ? work : null;
        if (!retain) releaseTrailGradients(work);
      }
    }
  }

  _renderFrameBody(now)
  {
    // 同步通知允许重入；外层范围一旦被打断，不能恢复成仍然有效的缓存。
    this._invalidateCanvasBoundsScope();
    if (this.destroyed || this.paused)
    {
      this.animationFrame = null;
      this.lastFrameTime = null;
      return;
    }

    this.animationFrame = null;
    // Unity 生命周期跟随真实时间。低帧率时限制 delta 会让旧特效异常延寿，
    // 进一步增加同时存活的 Bloom 区域并形成性能反馈循环。
    this._advanceClickTime(now);
    this._advanceTrailTime(now);
    const scale = this._getScale();
    let effectBackend = this._prepareEffectBackend();
    if (CUSTOM_BUILD && !BUILD_CANVAS && effectBackend === null)
    {
      // WebGPU 的 pending 由 ready 回调唤醒；没有备用后端，也不空转 RAF。
      const pending = this.webgpuEffectRenderer?.status === 'pending';
      const lost = this.webglEffectRenderer?.contextLost;
      if (!pending && !lost)
      {
        this._reportBuildError('initialization-failed');
      }
      return;
    }
    let useGpuClickEffects = effectBackend !== null;
    let bloomBackend = useGpuClickEffects
      ? effectBackend
      : this._resolveBloomBackend();
    this._setResolvedBloomBackend(bloomBackend);

    if (
      !useGpuClickEffects &&
      this.resolvedBloomBackend !== bloomBackend
    )
    {
      // 宿主可在同步状态事件中立即切换后端；后续绘制必须读取新路由。
      bloomBackend = this._resolveBloomBackend();
    }

    let useSoftwareBloom = BUILD_SOFTWARE && BUILD_BLOOM && bloomBackend === 'software';
    let useWebGL2Bloom = BUILD_WEBGL_BLOOM && bloomBackend === 'webgl2';
    let useNativeBloom = BUILD_NATIVE && BUILD_BLOOM && bloomBackend === 'native';
    const useCanvasScene = BUILD_CANVAS && BUILD_REFERENCE && this._prepareCanvasSceneBackend(
      useGpuClickEffects,
      bloomBackend,
    );
    if (CUSTOM_BUILD && BUILD_CANVAS && BUILD_NATIVE && BUILD_REFERENCE &&
        this._hasCompositingReference() && !useCanvasScene)
    {
      if (!this.canvasSceneRenderer?.contextLost) this._reportBuildError('compositing-initialization-failed');
      return;
    }
    const reuseCachedSoftwareBloom =
      !CUSTOM_BUILD && !useGpuClickEffects &&
      bloomBackend === 'native' &&
      !useCanvasScene &&
      this._hasCachedSoftwareBloomFrame(scale);

    if (!useSoftwareBloom && !reuseCachedSoftwareBloom)
    {
      // 故障同一时刻仍可复用完整输出；输入推进或 GPU 接管后归还快照。
      this._releaseSoftwareBloomFrame();
    }

    if (reuseCachedSoftwareBloom)
    {
      // Software 回读刚失败但输入尚未推进时，复用上一张完整 Bloom。
      // 这避免 Native 近似在同一帧状态下产生可见的透明 Coverage 跳变。
      useNativeBloom = false;
    }
    // WebGL2 Bloom 已复用完整 Scene Renderer。成功路径无需先栅格一份
    // 随后会被隐藏的 Canvas；GPU 当帧失败时再由回退路径补画即可。
    const drawCanvasOutput =
      BUILD_CANVAS && !useGpuClickEffects && !useCanvasScene && !useWebGL2Bloom;
    const deferNativeVisualMaxDraw =
      drawCanvasOutput &&
      useNativeBloom &&
      this._usesUnknownBrowserOverlay() &&
      !this._usesIndependentHostPayload() &&
      this._getOverlayAlphaPolicy() === 'visual-max';
    const drawCanvasDuringUpdate =
      drawCanvasOutput && !deferNativeVisualMaxDraw;
    let canvasSceneRendered = false;

    this.lastFrameTime = now;

    if (!useGpuClickEffects)
    {
      this._setWebGLEffectVisible(false);
      this._setWebGPUEffectVisible(false);
    }

    if (!useCanvasScene)
    {
      const canvasSceneWasVisible = this.canvasSceneVisible;

      this._setCanvasSceneVisible(false);

      if (canvasSceneWasVisible)
      {
        this._setCanvasOutputVisible(true);
      }
    }

    this._setWebGLBloomVisible(!useGpuClickEffects && useWebGL2Bloom);
    if (BUILD_CANVAS && !this.context && !useGpuClickEffects)
    {
      this.context = this.canvas.getContext?.('2d') ?? null;
    }
    if (this.context)
    {
      // DOM 的 GPU 层恢复时备用 Canvas 仍可能参与合成，必须清掉旧回退帧。
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.context.clearRect(0, 0, this.width, this.height);
    }
    // 推入当前实例的主题变换，渲染完成后恢复，保证多实例安全。
    const prevHueShift = themeHueShift;
    const previousRelativeOklchTheme = relativeOklchTheme;
    const previousGradientEnergyCache = gradientEnergyCache;
    const previousRingSampleCache = ringSampleCache;
    const previousBoundsScope = this._canvasBoundsScope;
    let contextSaved = false;

    this.canvasNativeSceneAlphaSnapshot = null;

    const previousTextureOwner = BUILD_CANVAS ? this._beginCanvasTextureFrame() : null;
    try
    {
      // Context 异常也不能泄漏模块级主题状态；先建立 Canvas
      // 恢复点，再推入当前实例配置。
      if (!useGpuClickEffects && this.context)
      {
        this.context.save();
        contextSaved = true;
      }
      // 每次渲染独立准备，包括重入；finally 恢复外层范围，不跨帧保存历史阈值。
      setRenderState(this._themeHueShift, this._relativeOklchTheme, this._gradientEnergyCache, new WeakMap());
      // 透明 Canvas 无法独立保存 Additive RGB 与 Coverage Alpha；在 residual
      // Coverage Final Pass 完成前保留兼容 source-over，避免多个粒子把 Alpha 相加。
      if (this.context)
      {
        this.context.globalCompositeOperation =
          this._getCanvasOutputCompositing() === 'browser-overlay'
            ? 'source-over'
            : 'lighter';
      }
      this.renderingFrame = true;
      this._updateTrail(
        this.trailTimeMs,
        scale,
        useNativeBloom,
        drawCanvasDuringUpdate,
        useGpuClickEffects || useWebGL2Bloom,
      );
      this._updateWaves(
        this.clickTimeMs,
        scale,
        useNativeBloom,
        drawCanvasDuringUpdate,
      );

      if (BUILD_CANVAS && drawCanvasDuringUpdate)
      {
        // Tri3 与 Cross2、Trail 同为 4499，必须先于 4550 的 Tri2 碎片提交。
        this._drawWaveRings(scale, useNativeBloom);
      }

      this._updateShards(
        this.clickTimeMs,
        this.trailTimeMs,
        scale,
        drawCanvasDuringUpdate,
      );

      if (BUILD_CANVAS && drawCanvasDuringUpdate && useNativeBloom)
      {
        this._drawNativeClickBloom(scale);
      }

      if (useGpuClickEffects)
      {
        if (!this._renderGPUClickEffects(effectBackend, scale))
        {
          if (CUSTOM_BUILD)
          {
            this._reportBuildError('render-failed');
            return;
          }
          const failedBackend = effectBackend;

          useGpuClickEffects = false;
          effectBackend = null;
          this._setResolvedEffectBackend(
            failedBackend === 'webgpu' ? 'pending' : 'canvas2d',
          );
          this._setWebGLEffectVisible(false);
          this._setWebGPUEffectVisible(false);
          bloomBackend = this._resolveBloomBackend();
          useSoftwareBloom = bloomBackend === 'software';
          useWebGL2Bloom = bloomBackend === 'webgl2';
          useNativeBloom = bloomBackend === 'native';
          this._setResolvedBloomBackend(bloomBackend);

          if (this.resolvedBloomBackend !== bloomBackend)
          {
            // 状态监听器可能同步释放旧后端资源，不能继续使用缓存路由。
            bloomBackend = this._resolveBloomBackend();
            useSoftwareBloom = bloomBackend === 'software';
            useWebGL2Bloom = bloomBackend === 'webgl2';
            useNativeBloom = bloomBackend === 'native';
          }

          this._setWebGLBloomVisible(useWebGL2Bloom);
          // 活动参考失效后，未知背景宿主 Add 需要从 source-over 切回
          // lighter；统一入口会按已经解析的新后端重新建立 Canvas 状态。
          this._drawCanvasFallbackFrame(scale, useNativeBloom);
        }
        else
        {
          // Scene 与 Bloom 都成功写入默认帧缓冲后才切换可见层，
          // 避免初始化或失败回退时暴露空白、旧帧或半成品帧。
          this._setWebGLEffectVisible(effectBackend === 'webgl2');
          this._setWebGPUEffectVisible(effectBackend === 'webgpu');
          this._setResolvedEffectBackend(effectBackend);
        }
      }
      else
      {
        if (useCanvasScene)
        {
          canvasSceneRendered = this._renderCanvasSceneEffects(
            scale,
            useNativeBloom,
          );

          if (!canvasSceneRendered)
          {
            if (CUSTOM_BUILD)
            {
              this._reportBuildError('compositing-render-failed');
              return;
            }
            // Final Pass 候选帧使用线性能量编码，失败后不能直接作为普通
            // Canvas 显示；对象已在本帧更新，只需用 sRGB 路径重新绘制。
            this._setCanvasSceneVisible(false);
            this._drawCanvasFallbackFrame(scale, useNativeBloom);
          }

          this._setCanvasSceneVisible(canvasSceneRendered);
          this._setCanvasOutputVisible(!canvasSceneRendered);
        }
        else if (!useWebGL2Bloom && deferNativeVisualMaxDraw)
        {
          this._drawCanvasFallbackFrame(scale, useNativeBloom);
        }
      }

      const hasDedicatedSceneOutput =
        useGpuClickEffects || useWebGL2Bloom || canvasSceneRendered;

      // GPU 与场景 Final Pass 不会保留可复用的主 Canvas 遮罩；对比层
      // 必须按同一帧几何重绘，否则纯白隔离合成会在成功后端上失去轮廓。
      this._renderLightBackgroundContrast(
        scale,
        useSoftwareBloom && !hasDedicatedSceneOutput,
      );

      if (useSoftwareBloom && !hasDedicatedSceneOutput)
      {
        // 对象更新已完成；只复用这次合成与整帧收尾的范围，不保存任何像素。
        this._canvasBoundsScope = { valid: true, ready: false, scale, dpr: this.dpr,
          width: this.canvas.width, height: this.canvas.height };
      }

      if (reuseCachedSoftwareBloom)
      {
        if (!this._drawCachedSoftwareBloomFrame(scale))
        {
          // 快照绘制失败时退回完整 Native 帧，不能保留缺少辉光的清晰层。
          this._drawCanvasFallbackFrame(scale, true, false);
          this._renderLightBackgroundContrast(scale, false);
        }
      }
      else if (
        !useGpuClickEffects &&
        useSoftwareBloom &&
        this._hasVisibleEffects()
      )
      {
        this._renderSoftwareBloom(scale);
      }
      else if (
        !useGpuClickEffects &&
        useWebGL2Bloom &&
        this._hasVisibleEffects()
      )
      {
        this._renderWebGL2Bloom(scale);
      }
      else if (!useGpuClickEffects && useWebGL2Bloom)
      {
        this.webglBloomRenderer?.clear();
      }

      this._finalizeCanvasOverlayAlpha(scale);
    }
    catch (error)
    {
      if (CUSTOM_BUILD)
      {
        this._reportBuildError('render-failed', error);
        return;
      }
      console.error('[BAClickFX] render error:', error);

      if (useCanvasScene)
      {
        this._setCanvasSceneVisible(false);
        this._setCanvasOutputVisible(true);
      }
    }
    finally
    {
      this.renderingFrame = false;
      setRenderState(prevHueShift, previousRelativeOklchTheme, previousGradientEnergyCache, previousRingSampleCache);
      this._canvasBoundsScope = previousBoundsScope;

      try
      {
        if (contextSaved) this.context.restore();
      }
      finally
      {
        if (BUILD_CANVAS) this._endCanvasTextureFrame(previousTextureOwner);
      }
    }

    // 合成合同可能在本帧内因后端成功/失败而改变；此时像素已经完成，
    // 现在切换根节点混合模式不会让浏览器用新合同解释旧帧。
    this._flushCompositingMountRefresh();

    if (this._hasVisibleEffects())
    {
      this._requestRender();
    }
    else
    {
      this.lastFrameTime = null;
      this._releaseSoftwareBloomFrame();
      this._scheduleSoftwareBloomRelease();
      this._scheduleGpuFrameRelease();
    }
  }

  /** 在 Canvas 局部坐标触发一次 FX_Touch 点击粒子。 */
  boom(x = this.width / 2, y = this.height / 2)
  {
    if (this.destroyed || this.paused || !this.config.clickEnabled)
    {
      return;
    }

    this._spawnClick(
      clamp(Number(x) || 0, 0, this.width),
      clamp(Number(y) || 0, 0, this.height),
    );
    this._requestRender();
  }

  _applyThemeColor(hex)
  {
    const themeColor = normalizeThemeColor(hex, DEFAULT_THEME_COLOR);

    // 映射只缓存到所属实例；两个渲染入口会随主题上下文一起保存与恢复。
    this._gradientEnergyCache = new WeakMap();
    this.config.themeColor = themeColor;
    this._themeVersion++;
    this._themeHueShift = computeThemeHueShift(themeColor);
    this._relativeOklchTheme = this.config.themeColorMode === 'relative-oklch'
      ? createRelativeOklchTheme(themeColor)
      : null;
  }

  /**
   * 为 GPU Scene 提供特效下方的真实不透明栅格参考；调用方负责解码与 CORS。
   * 资源对象不进入 getConfig()，避免配置快照持有宿主 DOM 生命周期。
   */
  setCompositingReference(source, options = {})
  {
    if (this.destroyed)
    {
      return false;
    }

    const fit = options.fit ?? 'cover';

    if (fit !== 'cover')
    {
      return false;
    }

    if (source !== null && !getCompositingReferenceDimensions(source))
    {
      return false;
    }

    const previousSource = this.compositingReferenceSource;
    const previousFit = this.compositingReferenceFit;
    const invalidatesVisibleOutput = this.webgpuEffectVisible ||
      this.webglEffectVisible ||
      this.webglBloomVisible ||
      this.canvasSceneVisible;

    if (!this._applyCompositingReferenceToRenderers(
      source,
      fit,
      previousSource,
      previousFit,
      invalidatesVisibleOutput,
    ))
    {
      return false;
    }

    this.compositingReferenceSource = source;
    this.compositingReferenceFit = fit;
    this._releaseSoftwareBloomFrame();
    // 只有当前输出链真正消费参考时才撤销宿主 Add；Software/Native/外部
    // Canvas 仍按未知背景传输完整 Add 载荷。
    this._requestCompositingMountRefresh();
    if (source !== null)
    {
      // 显式提供新参考后，允许此前单次上传失败的候选后端重新尝试。
      this.webgpuEffectUnavailable = false;
      this.webglEffectUnavailable = false;
      this.webglBloomUnavailable = false;
      this.canvasSceneUnavailable = false;
    }

    if (invalidatesVisibleOutput)
    {
      this._invalidateSceneBackgroundOutputs();
      this._flushCompositingMountRefresh();
    }

    if (source === null)
    {
      // 未知背景合同不需要 Canvas Final Pass；立即归还其全尺寸上传纹理，
      // 保留静态 Program 供下次参考图接入。
      this.canvasSceneRenderer?.releaseFrameResources();
      this._releaseNativeClickBloomSurface();
    }

    this._requestRender();
    return true;
  }

  getConfig()
  {
    const hostCompositingState = this._resolveHostCompositingState();

    return {
      ...this.config,
      ...hostCompositingState,
      resolvedEffectBackend: this.resolvedEffectBackend,
      resolvedBloomBackend: this.resolvedBloomBackend,
      resolvedWebGPUOutputMode: this._getResolvedWebGPUOutputMode(),
      unity: structuredClone(CUSTOM_BUILD ? this.fxConfig : UNITY_FX_TOUCH),
    };
  }
}

/**
 * 在不创建渲染实例的情况下迁移并校验持久化参数补丁。
 * 内部候选配置树不属于公共契约；宿主只需持久化返回的 applied 项。
 */
function applyFxParamPatch(patch, options = {})
{
  const prepared = prepareFxParamPatch(
    patch,
    {
      baseline: UNITY_FX_TOUCH,
      schemaVersion: options.schemaVersion ?? FX_PARAM_SCHEMA_VERSION,
      strict: options.strict === true,
    },
  );
  const { nextConfig, ...result } = prepared;

  return result;
}

export {
  applyFxParamPatch,
  BLOOM_BACKEND_CHANGE_EVENT,
  CONFIG,
  DEFAULT_THEME_COLOR,
  DEFAULT_THEME_COLOR_MODE,
  EFFECT_BACKEND_CHANGE_EVENT,
  FX_PARAM_MIGRATIONS,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  HOST_COMPOSITING_CHANGE_EVENT,
  UNITY_FX_TOUCH,
  createConfig,
  SIZE_CORRECTION,
};

export default BAClickFX;
