import { beginCanvasTextureFrame, enterCanvasTextureFrame, endCanvasTextureFrame, flushCanvasTextureRelease, canvasTextureOwners, scheduleCanvasTextureRelease, releaseCanvasTextureCache } from './engine-canvas-textures.js';
import { setRenderState, themeHueShift, relativeOklchTheme, gradientEnergyCache, ringSampleCache } from './engine-render-state.js';
import { TAU, mergeBloomRegion, combineBloomRegionBounds, random, evaluateUnityHermiteCurve } from './engine-math.js';
import { BLOOM_BACKEND_CHANGE_EVENT, EFFECT_BACKEND_CHANGE_EVENT, cancelRenderFrame, clamp, clamp01, createCanvas, distance, invalidateTrailPoints, isCanvas, isOffscreenCanvas, lerp, releaseTrailGradients, setOverlayStyle } from './engine-shared.js';
import { EffectRuntime } from './engine-effects.js';
import { CONFIG, DEFAULT_THEME_COLOR, DEFAULT_THEME_COLOR_MODE, FX_PARAM_MIGRATIONS, FX_PARAM_SCHEMA, FX_PARAM_SCHEMA_VERSION, UNITY_FX_TOUCH, assertConfigOverrides, createConfig, isIndependentHostCompositing, normalizeEffectBackend, normalizeThemeColor, resolveHostCompositing, SIZE_CORRECTION } from './config.js';
import { createRelativeOklchTheme } from './theme-color.js';
import { applyFxParamPatch as prepareFxParamPatch } from './fx-param-patch.js';
import { getTrailRenderPoints, updateTrailRenderPoints } from './trail-lifetime.js';
import { linearToSrgb, resolveUnityBloomIntensity } from './bloom-color-space.js';
import { SoftwareBloomRenderer } from './software-bloom.js';
import { limitCanvasAlpha } from './bloom-math.js';
import { applyOverlayColorCompensationToImageData, applyOverlayAlphaPolicyToImageData } from './overlay-compositing.js';
import { addNativeBloomSample, createNativeBloomProfile, createNativeBloomSource } from './native-bloom.js';
import { CUSTOM_BUILD, BUILD_DOM, BUILD_WORKER, BUILD_WEBGL, BUILD_WEBGPU, BUILD_WEBGL_BLOOM, BUILD_SOFTWARE, BUILD_NATIVE, BUILD_CANVAS, BUILD_CLICK, BUILD_TRAIL, BUILD_SHARDS, BUILD_BLOOM, BUILD_REFERENCE, FIXED_CONFIG, FIXED_FX, FIXED_THEME } from './build-capabilities.js';
import { computeThemeHueShift, colorToCss, evaluateSrgbGradientEnergy, linearEnergyToAdditiveCss, linearEnergyToHostAdditiveCss, linearEnergyToOverlayCss } from './engine-materials.js';
import { NATIVE_BLOOM_DISK_SAMPLES, getNativeCircleBloomSamples, evaluateRingLuminance, resolveRingIntegrationSamples, resolveRingGeometry } from './engine-canvas-primitives.js';
import { ClickWave, createShard } from './engine-particles.js';
import { hasVisibleTrailPoints, createTrailFrameData, drawTrail, drawTrailCoverage, drawTrailEmission, appendTrailWebGLScene } from './engine-trail.js';

/**
 * ba-click-fx — Blue Archive 的 UI/FX_Touch 浏览器移植。
 *
 * 这不是“相似风格”参数化引擎。实现移植 Unity 中 FXTouch、
 * ParticleSystem 和 TrailRenderer 的生命周期，只保留宿主接入所需的最小 API。
 */

const LIGHT_BACKGROUND_CONTRAST_COLOR = [76, 255, 255];

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

export class BAClickFX extends EffectRuntime
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

  _hasActiveCompositingReference()
  {
    if (this.compositingReferenceSource === null)
    {
      return false;
    }

    return (
      this.webgpuEffectVisible &&
      this.webgpuEffectRenderer?.hasSceneBackground === true
    ) || (
      this.webglEffectVisible &&
      this.webglEffectRenderer?.hasSceneBackground === true
    ) || (
      this.webglBloomVisible &&
      this.webglBloomRenderer?.hasSceneBackground === true
    ) || (
      this.canvasSceneVisible &&
      this.canvasSceneRenderer?.hasSceneBackground === true
    );
  }

  _usesUnknownBrowserOverlay()
  {
    return this.config.outputCompositing === 'browser-overlay' &&
      !this._hasActiveCompositingReference();
  }

  _usesIndependentHostPayload()
  {
    return isIndependentHostCompositing(
      this._getEffectiveHostCompositing(),
    );
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

  _getCanvasOutputCompositing()
  {
    // 独立宿主混合需要完整发射载荷，但普通 Canvas 没有 Scene Final Pass；
    // 内部合同先完成 sRGB 编码，避免 Linear 数值被 CSS 当作 sRGB。
    return this._usesIndependentHostPayload()
      ? 'host-additive'
      : this.config.outputCompositing;
  }

  _getOverlayColorCompensation()
  {
    return this._usesUnknownBrowserOverlay() &&
      !this._usesIndependentHostPayload()
      ? this.config.overlayColorCompensation
      : 'none';
  }

  _getOverlayAlphaPolicy()
  {
    return this._usesUnknownBrowserOverlay() &&
      !this._usesIndependentHostPayload()
      ? this.config.overlayAlphaPolicy
      : 'coverage';
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

  _getEffectiveOpacity()
  {
    // 主题亮度属于 RGB contribution；Scene、Add 与 HDR 必须保留原能量。
    return this.config.opacity;
  }

  _getEffectiveOverlayAlphaLimit()
  {
    if (
      !this._usesUnknownBrowserOverlay() ||
      this._usesIndependentHostPayload()
    )
    {
      return this.config.overlayAlphaLimit;
    }

    // 未知背景只能用 source-over 传输。限制 Alpha 而不改 Scene RGB，
    // 可让暗主题的白底遮挡最多等于其自身峰值，同时保持 Add/HDR 能量。
    return this.config.overlayAlphaLimit *
      (this._relativeOklchTheme?.coverageScale ?? 1);
  }

  _beginCanvasTextureFrame()
  {
    if (!BUILD_CANVAS) return null;
    const owner = this._canvasTextureOwner ??= { closed: false, visible: false };
    const previous = beginCanvasTextureFrame(owner);
    owner.visible = this._hasVisibleEffects();
    enterCanvasTextureFrame();
    return previous;
  }

  _endCanvasTextureFrame(previous)
  {
    if (!BUILD_CANVAS) return false;
    endCanvasTextureFrame(previous);
    this._syncCanvasTextureOwner();
    flushCanvasTextureRelease();
  }

  _syncCanvasTextureOwner()
  {
    if (!BUILD_CANVAS) return false;
    if (!canvasTextureOwners.has(this._canvasTextureOwner)) return;
    this._canvasTextureOwner.visible = this._hasVisibleEffects();
    scheduleCanvasTextureRelease();
  }

  _releaseCanvasTextureOwner()
  {
    if (!BUILD_CANVAS) return false;
    const owner = this._canvasTextureOwner;
    if (!owner) return;
    owner.closed = true;
    canvasTextureOwners.delete(owner);
    this._canvasTextureOwner = null;
    releaseCanvasTextureCache();
    scheduleCanvasTextureRelease();
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

  _getNativeTrailBloomSurface()
  {
    if (this.nativeTrailBloomSurface === undefined)
    {
      const canvas = createCanvas();
      const context = canvas.getContext('2d');

      // 原生辉光只在首次回退或显式选择时分配缓冲。
      this.nativeTrailBloomSurface = context
        ? { canvas, context, dpr: this.dpr }
        : null;
    }

    if (this.nativeTrailBloomSurface)
    {
      this.nativeTrailBloomSurface.dpr = this.dpr;
    }

    return this.nativeTrailBloomSurface;
  }

  _renderLightBackgroundContrast(scale, reuseMainCanvas = false)
  {
    if (!BUILD_DOM)
    {
      return false;
    }

    const context = this.contrastContext;

    if (!context || !this.contrastCanvas)
    {
      return;
    }

    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);

    if (
      this.config.outputCompositing === 'browser-overlay' ||
      this.config.lightBackgroundContrastAlpha <= 0
    )
    {
      // 桌面透明模式的 Alpha 合同已经提供可见度；额外 darken 层只会遮挡宿主。
      return;
    }

    if (reuseMainCanvas)
    {
      // 软件 Bloom 合成前，主 Canvas 只包含清晰本体。直接复制其 Alpha 遮罩，
      // 与重新绘制同一套几何等价，并省去圆环渐变与拖尾的第二次构建。
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = 'source-over';
      context.drawImage(this.canvas, 0, 0);
      context.restore();
    }
    else
    {
      context.save();
      context.globalCompositeOperation = 'lighter';

      if (BUILD_TRAIL)
      {
        for (const stroke of this.trailStrokes)
        {
          if (getTrailRenderPoints(stroke).length >= 2)
          {
            drawTrail(
              context,
              getTrailRenderPoints(stroke),
              scale,
              this._getEffectiveOpacity(),
              this.fxConfig,
              false,
              false,
              null,
              stroke.trailFrameData,
            );
          }
        }
      }

      if (BUILD_CLICK)
      {
        for (const wave of this.waves)
        {
          wave.drawBase(
            context,
            scale,
            this._getEffectiveOpacity(),
            false,
            this.config.outputCompositing,
            this.dpr,
          );
        }
      }

      if (BUILD_SHARDS)
      {
        for (const shard of this.shards)
        {
          shard.draw(
            context,
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
          );
        }
      }

      if (BUILD_CLICK)
      {
        for (const wave of this.waves)
        {
          wave.drawRings(
            context,
            scale,
            this._getEffectiveOpacity(),
            false,
            false,
            null,
            this.dpr,
            this.config.outputCompositing,
          );
        }
      }

      context.restore();
    }
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = colorToCss(
      LIGHT_BACKGROUND_CONTRAST_COLOR,
      this.config.lightBackgroundContrastAlpha,
    );
    context.fillRect(0, 0, this.contrastCanvas.width, this.contrastCanvas.height);
    context.restore();
  }

  _getSoftwareBloomRegions(scale)
  {
    const bloomCfg = this.fxConfig.bloom;
    const diffusion = bloomCfg.diffusion;
    // 区域必须覆盖卷积核完整支撑范围，否则边界会把光晕切成硬边。
    const padding = 2 ** diffusion * scale + 8;
    const regions = [];
    const addRegion = (
      minimumX,
      minimumY,
      maximumX,
      maximumY,
      wave,
      trailBatches = [],
      shards = [],
    ) =>
    {
      mergeBloomRegion(
        regions,
        {
          x: minimumX - padding,
          y: minimumY - padding,
          width: maximumX - minimumX + padding * 2,
          height: maximumY - minimumY + padding * 2,
          emissionBounds:
          {
            x: minimumX,
            y: minimumY,
            width: maximumX - minimumX,
            height: maximumY - minimumY,
          },
          waves: wave ? [wave] : [],
          trailBatches,
          shards,
        },
      );
    };

    if (BUILD_CLICK)
    {
      for (const wave of this.waves)
      {
        if (wave.fx.bloom.clickEmissionScale <= 0)
        {
          continue;
        }

        const diskProgress = wave.ageMs / this.fxConfig.disk.lifetimeMs;
        const ringProgress = wave.ageMs / this.fxConfig.rings.lifetimeMs;
        let sourceRadius = diskProgress < 1
          ? this.fxConfig.disk.radius * evaluateUnityHermiteCurve(
            this.fxConfig.disk.sizeKeys,
            diskProgress,
          ) * scale
          : 0;

        if (ringProgress < 1)
        {
          for (const ring of wave.rings)
          {
            const geometry = resolveRingGeometry(
              ring,
              ringProgress,
              scale,
              this.fxConfig.rings,
            );

            sourceRadius = Math.max(
              sourceRadius,
              geometry.radius + geometry.width * 0.5,
            );
          }
        }

        if (sourceRadius <= 0)
        {
          continue;
        }

        addRegion(
          wave.x - sourceRadius,
          wave.y - sourceRadius,
          wave.x + sourceRadius,
          wave.y + sourceRadius,
          wave,
          [],
        );
      }
    }

    const trailRadius = Math.max(
      1,
      this.fxConfig.trail.geometryWidth * scale *
        bloomCfg.trailCoverageScale * 0.5,
    );

    if (BUILD_TRAIL)
    {
      for (const stroke of this.trailStrokes)
      {
        if (getTrailRenderPoints(stroke).length < 2)
        {
          continue;
        }

        const trailData = this._getTrailFrameData(stroke, bloomCfg.trailEmission);
        const trailOpacity = this._getEffectiveOpacity() *
          (this.fxConfig.trail.trailOpacity ?? 1) *
          bloomCfg.trailEmissionAlpha;
        const emissionQuantizationScale = trailOpacity /
          Math.max(1, bloomCfg.emissionRange) * 255;
        const bloomRuns = [];
        let activeRun = null;

        for (let index = 1; index < getTrailRenderPoints(stroke).length; index++)
        {
          // 只排除写入 8 位发射遮罩后所有通道都严格量化为 0 的段。
          // 不能按 Bloom 阈值提前裁剪：多个微弱发射源叠加后仍可能越过阈值。
          if (
            trailData.segmentMaximumEnergies[index - 1] *
              emissionQuantizationScale < 0.5
          )
          {
            if (activeRun)
            {
              bloomRuns.push(activeRun);
              activeRun = null;
            }

            continue;
          }

          const previousPoint = getTrailRenderPoints(stroke)[index - 1];
          const point = getTrailRenderPoints(stroke)[index];

          if (!activeRun)
          {
            activeRun = {
              firstSegment: index,
              lastSegment: index,
              minimumX: Math.min(previousPoint.x, point.x),
              minimumY: Math.min(previousPoint.y, point.y),
              maximumX: Math.max(previousPoint.x, point.x),
              maximumY: Math.max(previousPoint.y, point.y),
            };
            continue;
          }

          activeRun.lastSegment = index;
          activeRun.minimumX = Math.min(
            activeRun.minimumX,
            previousPoint.x,
            point.x,
          );
          activeRun.minimumY = Math.min(
            activeRun.minimumY,
            previousPoint.y,
            point.y,
          );
          activeRun.maximumX = Math.max(
            activeRun.maximumX,
            previousPoint.x,
            point.x,
          );
          activeRun.maximumY = Math.max(
            activeRun.maximumY,
            previousPoint.y,
            point.y,
          );
        }

        if (activeRun)
        {
          bloomRuns.push(activeRun);
        }

        if (bloomRuns.length > 0)
        {
          const minimumX = Math.min(...bloomRuns.map((run) => run.minimumX));
          const minimumY = Math.min(...bloomRuns.map((run) => run.minimumY));
          const maximumX = Math.max(...bloomRuns.map((run) => run.maximumX));
          const maximumY = Math.max(...bloomRuns.map((run) => run.maximumY));

          addRegion(
            minimumX - trailRadius,
            minimumY - trailRadius,
            maximumX + trailRadius,
            maximumY + trailRadius,
            null,
            bloomRuns.map((run) =>
            ({
              stroke,
              firstSegment: run.firstSegment,
              lastSegment: run.lastSegment,
            })),
          );
        }
      }
    }

    if (BUILD_SHARDS)
    {
      for (const shard of this.shards)
      {
        const shardCfg = this.fxConfig.shards;
        const progress = clamp01(shard.ageMs / shard.lifetimeMs);
        const size = shard.size * evaluateUnityHermiteCurve(
          shardCfg.sizeKeys,
          progress,
        ) * scale;

        if (size <= 0)
        {
          continue;
        }

        addRegion(
          shard.x - size,
          shard.y - size,
          shard.x + size,
          shard.y + size,
          null,
          [],
          [shard],
        );
      }
    }

    if (regions.length === 0)
    {
      return [];
    }

    // 局部 mip 的最低层会把低频能量铺满裁剪区域，在浅色背景上形成矩形。
    // 软件后端改用单个全视口金字塔，让能量在真实画面边界内自然扩散。
    return [
      {
        x: 0,
        y: 0,
        width: this.width,
        height: this.height,
        emissionBounds: combineBloomRegionBounds(
          regions.map((region) => region.emissionBounds),
        ),
        waves: regions.flatMap((region) => region.waves),
        trailBatches: regions.flatMap((region) => region.trailBatches),
        shards: regions.flatMap((region) => region.shards),
      },
    ];
  }

  _getCanvasOverlayBounds(scale)
  {
    const bounds = [];
    const addBounds = (minimumX, minimumY, maximumX, maximumY) =>
    {
      if (
        !Number.isFinite(minimumX) ||
        !Number.isFinite(minimumY) ||
        !Number.isFinite(maximumX) ||
        !Number.isFinite(maximumY) ||
        maximumX < minimumX ||
        maximumY < minimumY
      )
      {
        return;
      }

      bounds.push(
        {
          x: minimumX,
          y: minimumY,
          width: maximumX - minimumX,
          height: maximumY - minimumY,
        },
      );
    };
    const bloomCfg = this.fxConfig.bloom;

    if (BUILD_CLICK)
    {
      for (const wave of this.waves)
      {
        let radius = 0;
        const hitProgress = wave.ageMs / wave.fx.hit.lifetimeMs;
        const flareProgress = wave.ageMs / wave.fx.flare.lifetimeMs;
        const diskProgress = wave.ageMs / wave.fx.disk.lifetimeMs;
        const ringProgress = wave.ageMs / wave.fx.rings.lifetimeMs;

        if (wave.fx.hit.enabled && hitProgress < 1)
        {
          radius = Math.max(radius, wave.fx.hit.radius * scale);
        }

        if (wave.fx.flare.enabled && flareProgress < 1)
        {
          radius = Math.max(radius, wave.fx.flare.radius * scale);
        }

        if (diskProgress < 1)
        {
          const diskRadius = wave.fx.disk.radius * evaluateUnityHermiteCurve(
            wave.fx.disk.sizeKeys,
            diskProgress,
          ) * scale;
          // Canvas blur 的实现支撑范围没有标准化；三倍配置半径覆盖所有
          // 可能高于网页 Alpha 上限的像素，同时保持回读区域局部化。
          const diskBlur = bloomCfg.diskAlpha > 0
            ? bloomCfg.diskBlur * scale * 3
            : 0;

          radius = Math.max(radius, diskRadius + diskBlur);
        }

        if (ringProgress < 1)
        {
          const ringBlur = bloomCfg.ringAlpha > 0
            ? bloomCfg.ringBlur * scale * 3
            : 0;

          for (const ring of wave.rings)
          {
            const geometry = resolveRingGeometry(
              ring,
              ringProgress,
              scale,
              wave.fx.rings,
            );

            radius = Math.max(
              radius,
              geometry.radius + geometry.width * 0.5 + ringBlur,
            );
          }
        }

        if (radius > 0)
        {
          addBounds(
            wave.x - radius,
            wave.y - radius,
            wave.x + radius,
            wave.y + radius,
          );
        }
      }
    }

    if (BUILD_SHARDS)
    {
      for (const shard of this.shards)
      {
        const progress = clamp01(shard.ageMs / shard.lifetimeMs);
        const size = shard.size * evaluateUnityHermiteCurve(
          this.fxConfig.shards.sizeKeys,
          progress,
        ) * scale;

        if (size > 0)
        {
          // 纹理 Quad 的实际半径是 size/2；保守使用完整 size 容纳旋转。
          addBounds(
            shard.x - size,
            shard.y - size,
            shard.x + size,
            shard.y + size,
          );
        }
      }
    }

    const trailCfg = this.fxConfig.trail;
    const trailMargin = Math.max(
      trailCfg.width * scale * 0.5,
      trailCfg.outerGlowWidth * scale * 3 + 2,
    );

    if (BUILD_TRAIL)
    {
      for (const stroke of this.trailStrokes)
      {
        if (getTrailRenderPoints(stroke).length < 2)
        {
          continue;
        }

        let minimumX = Infinity;
        let minimumY = Infinity;
        let maximumX = -Infinity;
        let maximumY = -Infinity;

        for (const point of getTrailRenderPoints(stroke))
        {
          minimumX = Math.min(minimumX, point.x);
          minimumY = Math.min(minimumY, point.y);
          maximumX = Math.max(maximumX, point.x);
          maximumY = Math.max(maximumY, point.y);
        }

        addBounds(
          minimumX - trailMargin,
          minimumY - trailMargin,
          maximumX + trailMargin,
          maximumY + trailMargin,
        );
      }
    }

    return combineBloomRegionBounds(bounds);
  }

  _getCanvasOverlayPixelBounds(scale)
  {
    const scope = this._canvasBoundsScope;
    if (scope?.valid && scope.scale === scale && scope.dpr === this.dpr
      && scope.width === this.canvas.width && scope.height === this.canvas.height)
    {
      if (!scope.ready)
      {
        const value = this._computeCanvasOverlayPixelBounds(scale);
        // 计算过程中若发生同步状态变化，结果不进入缓存。
        if (scope.valid) { scope.value = value; scope.ready = true; }
        return value;
      }
      return scope.value;
    }
    return this._computeCanvasOverlayPixelBounds(scale);
  }

  _invalidateCanvasBoundsScope()
  {
    if (this._canvasBoundsScope) this._canvasBoundsScope.valid = false;
  }

  _computeCanvasOverlayPixelBounds(scale)
  {
    const bounds = this._getCanvasOverlayBounds(scale);

    if (!bounds)
    {
      return null;
    }

    const minimumX = Math.max(0, Math.floor(bounds.x * this.dpr));
    const minimumY = Math.max(0, Math.floor(bounds.y * this.dpr));
    const maximumX = Math.min(
      this.canvas.width,
      Math.ceil((bounds.x + bounds.width) * this.dpr),
    );
    const maximumY = Math.min(
      this.canvas.height,
      Math.ceil((bounds.y + bounds.height) * this.dpr),
    );

    return {
      minimumX,
      minimumY,
      maximumX,
      maximumY,
      width: Math.max(0, maximumX - minimumX),
      height: Math.max(0, maximumY - minimumY),
    };
  }

  _captureCanvasOverlayAlpha(scale)
  {
    if (
      this._getOverlayAlphaPolicy() !== 'visual-max' ||
      typeof this.context?.getImageData !== 'function'
    )
    {
      return null;
    }

    const bounds = this._getCanvasOverlayPixelBounds(scale);

    if (!bounds || bounds.width <= 0 || bounds.height <= 0)
    {
      return null;
    }

    try
    {
      return {
        ...bounds,
        data: this.context.getImageData(
          bounds.minimumX,
          bounds.minimumY,
          bounds.width,
          bounds.height,
        ).data,
      };
    }
    catch
    {
      return null;
    }
  }

  _prepareCanvasBloomTransportContext()
  {
    if (this._getOverlayAlphaPolicy() !== 'visual-max')
    {
      return null;
    }

    if (!this.canvasBloomTransportCanvas)
    {
      const canvas = createCanvas();
      const context = canvas?.getContext?.(
        '2d',
        {
          alpha: true,
          willReadFrequently: true,
        },
      );

      if (!canvas || !context)
      {
        return null;
      }

      this.canvasBloomTransportCanvas = canvas;
      this.canvasBloomTransportContext = context;
    }

    const canvas = this.canvasBloomTransportCanvas;
    const context = this.canvasBloomTransportContext;

    if (
      canvas.width !== this.canvas.width ||
      canvas.height !== this.canvas.height
    )
    {
      canvas.width = this.canvas.width;
      canvas.height = this.canvas.height;
    }

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // 多个 Bloom 区域与主 Canvas 使用相同的累计规则；超过 1 的部分对
    // 最终不高于 1 的 Alpha 容量没有额外信息价值。
    context.globalCompositeOperation = 'lighter';
    return context;
  }

  _limitCanvasOverlayAlpha(
    scale,
    sceneAlphaSnapshot = null,
    bloomTransportContext = null,
    bloomCompositing = 'lighter',
    applyColorCompensation = true,
  )
  {
    const overlayAlphaPolicy = this._getOverlayAlphaPolicy();
    const overlayColorCompensation = this._getOverlayColorCompensation();
    const overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit();
    const compensateBrightCore =
      overlayColorCompensation === 'bright-core';
    const adjustAlpha = overlayAlphaPolicy === 'visual-max' ||
      overlayAlphaLimit < 1;

    if (
      !this._usesUnknownBrowserOverlay() ||
      this._usesIndependentHostPayload() ||
      (!adjustAlpha && !compensateBrightCore) ||
      this.webgpuEffectVisible ||
      this.webglEffectVisible ||
      this.webglBloomVisible ||
      this.canvasSceneVisible ||
      (this.ownsCanvas && this.canvas.style.visibility === 'hidden')
    )
    {
      return true;
    }

    const bounds = this._getCanvasOverlayPixelBounds(scale);

    if (!bounds || bounds.width <= 0 || bounds.height <= 0)
    {
      return true;
    }

    try
    {
      const imageData = this.context.getImageData(
        bounds.minimumX,
        bounds.minimumY,
        bounds.width,
        bounds.height,
      );

      if (overlayAlphaPolicy === 'visual-max')
      {
        const matchingSnapshot = sceneAlphaSnapshot &&
          sceneAlphaSnapshot.minimumX === bounds.minimumX &&
          sceneAlphaSnapshot.minimumY === bounds.minimumY &&
          sceneAlphaSnapshot.width === bounds.width &&
          sceneAlphaSnapshot.height === bounds.height
          ? sceneAlphaSnapshot.data
          : null;
        const bloomTransportData = bloomTransportContext
          ? bloomTransportContext.getImageData(
            bounds.minimumX,
            bounds.minimumY,
            bounds.width,
            bounds.height,
          ).data
          : null;

        applyOverlayAlphaPolicyToImageData(
          imageData,
          matchingSnapshot,
          bloomTransportData,
          overlayAlphaLimit,
          overlayAlphaPolicy,
          bloomCompositing,
        );
      }
      else if (overlayAlphaLimit < 1)
      {
        const maximumAlpha = Math.round(
          clamp01(overlayAlphaLimit) * 255,
        );

        for (let index = 3; index < imageData.data.length; index += 4)
        {
          imageData.data[index] = Math.min(
            imageData.data[index],
            maximumAlpha,
          );
        }
      }

      if (applyColorCompensation)
      {
        applyOverlayColorCompensationToImageData(
          imageData,
          overlayColorCompensation,
          this._getEffectiveOpacity(),
        );
      }
      this.context.putImageData(
        imageData,
        bounds.minimumX,
        bounds.minimumY,
      );
      return true;
    }
    catch
    {
      // 受污染 Canvas 无法回读时保留颜色；Coverage 仍尽力执行原 Alpha 上限。
    }

    if (overlayAlphaPolicy === 'visual-max')
    {
      return false;
    }

    // getImageData 使用物理像素；只处理活跃特效脏区，避免 Native
    // 回退为了一个 Alpha 上限读取整个视口。
    limitCanvasAlpha(
      this.context,
      {
        minimumX: bounds.minimumX,
        minimumY: bounds.minimumY,
        maximumX: bounds.maximumX - 1,
        maximumY: bounds.maximumY - 1,
      },
      overlayAlphaLimit,
    );
    // 失败后的尽力限制不能证明完整 Alpha 处理成功，帧收尾仍需重试。
    return false;
  }

  _getSoftwareBloomFrameSignature(scale)
  {
    if (this._softwareBloomConfigSignature?.version !== this._fxConfigVersion)
    {
      // 公共调参均原子提交并递增版本；保留原序列化字节，只省去稳定帧重复遍历。
      this._softwareBloomConfigSignature = {
        version: this._fxConfigVersion,
        value: JSON.stringify(this.fxConfig),
      };
    }
    const trailSignature = this.trailStrokes.map((stroke) =>
    {
      const first = getTrailRenderPoints(stroke)[0];
      const last = getTrailRenderPoints(stroke).at(-1);

      return [
        getTrailRenderPoints(stroke).length,
        first?.x,
        first?.y,
        first?.bornAt,
        last?.x,
        last?.y,
        last?.bornAt,
      ].join(',');
    }).join('|');
    const waveSignature = this.waves.map((wave) =>
      [
        wave.x,
        wave.y,
        wave.ageMs,
        wave.diskRotation,
        ...wave.rings.flatMap((ring) =>
          [ring.radius, ring.rotation, ring.angularVelocity]),
      ].join(',')).join('|');
    const shardSignature = this.shards.map((shard) =>
      [
        shard.kind,
        shard.x,
        shard.y,
        shard.ageMs,
        shard.rotation,
        shard.size,
        shard.textureFrame,
      ].join(',')).join('|');
    const bloomCfg = this.fxConfig.bloom;
    const trailCfg = this.fxConfig.trail;

    return [
      this.width,
      this.height,
      this.dpr,
      scale,
      this.clickTimeMs,
      this.trailTimeMs,
      this._getEffectiveOpacity(),
      this.config.outputCompositing,
      this._getOverlayColorCompensation(),
      this._getEffectiveOverlayAlphaLimit(),
      this._getEffectiveHostCompositing(),
      this.compositingReferenceSource === null ? 'unknown' : 'known',
      this.config.themeColorMode,
      this.config.themeColor,
      this._themeHueShift,
      bloomCfg.threshold,
      bloomCfg.softKnee,
      bloomCfg.intensity,
      bloomCfg.diffusion,
      bloomCfg.resolutionScale,
      bloomCfg.trailEmission,
      bloomCfg.trailEmissionAlpha,
      trailCfg.width,
      trailCfg.geometryWidth,
      this._softwareBloomConfigSignature.value,
      trailSignature,
      waveSignature,
      shardSignature,
    ].join(':');
  }

  _releaseSoftwareBloomFrame()
  {
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

    const canvas = this.lastSoftwareBloomFrame?.canvas;

    this.lastSoftwareBloomFrame = null;
    if (canvas && canvas !== this.canvas)
    {
      // 解除引用之外也归还像素缓冲，宿主保留已销毁实例时不继续占用整屏内存。
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  _cacheSoftwareBloomFrame(scale)
  {
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

    if (
      this.config.outputCompositing !== 'browser-overlay' ||
      this.canvas.width <= 0 ||
      this.canvas.height <= 0
    )
    {
      return;
    }

    const previousCanvas = this.lastSoftwareBloomFrame?.canvas;
    const canvas = previousCanvas && previousCanvas !== this.canvas
      ? previousCanvas
      : createCanvas();
    const context = canvas.getContext?.('2d', { alpha: true });

    if (!context)
    {
      this._releaseSoftwareBloomFrame();
      return;
    }

    try
    {
      if (
        canvas.width !== this.canvas.width ||
        canvas.height !== this.canvas.height
      )
      {
        canvas.width = this.canvas.width;
        canvas.height = this.canvas.height;
      }

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      // 软件输出已按透明容量收敛。冻结主画布而非 renderer 工作面，才能在
      // 回读故障后同时保留清晰层与 Bloom 的最终预乘 Alpha。
      context.drawImage(
        this.canvas,
        0,
        0,
        this.canvas.width,
        this.canvas.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    }
    catch
    {
      this._releaseSoftwareBloomFrame();
      return;
    }

    this.lastSoftwareBloomFrame = {
      canvas,
      height: canvas.height,
      signature: this._getSoftwareBloomFrameSignature(scale),
      width: canvas.width,
    };
  }

  _drawCachedSoftwareBloomFrame(scale)
  {
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

    const frame = this.lastSoftwareBloomFrame;

    if (
      !frame?.canvas ||
      frame.signature !== this._getSoftwareBloomFrameSignature(scale)
    )
    {
      return false;
    }

    try
    {
      this.context.save();
      this.context.setTransform(1, 0, 0, 1, 0, 0);
      this.context.globalAlpha = 1;
      // 快照覆盖完整主画布，copy 不会再次按 source-over/lighter 叠加 Alpha。
      this.context.globalCompositeOperation = 'copy';

      this.context.drawImage(
        frame.canvas,
        0,
        0,
        frame.width,
        frame.height,
        0,
        0,
        this.canvas.width,
        this.canvas.height,
      );
      this.context.restore();
      return true;
    }
    catch
    {
      this.context.restore();
      return false;
    }
  }

  _hasCachedSoftwareBloomFrame(scale)
  {
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

    return this.config.outputCompositing === 'browser-overlay' &&
      this.lastSoftwareBloomFrame?.canvas !== undefined &&
      this.lastSoftwareBloomFrame.signature ===
        this._getSoftwareBloomFrameSignature(scale);
  }

  _renderSoftwareBloom(scale)
  {
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

    this._cancelSoftwareBloomRelease();

    const bloomCfg = this.fxConfig.bloom;
    const diffusion = bloomCfg.diffusion;
    const regions = this._getSoftwareBloomRegions(scale);
    const combinedBounds = combineBloomRegionBounds(regions);
    const sceneAlphaSnapshot = this._captureCanvasOverlayAlpha(scale);
    const bloomTransportContext =
      this._prepareCanvasBloomTransportContext();
    const settings = {
      encodingRange: bloomCfg.emissionRange,
      threshold: bloomCfg.threshold,
      softKnee: bloomCfg.softKnee,
      clamp: bloomCfg.clamp,
      intensity: bloomCfg.intensity,
      diffusion,
      opacity: this._getEffectiveOpacity(),
      outputCompositing: this.config.outputCompositing,
      // Canvas 在清晰层与 Bloom 聚合后统一补偿，避免各层重复混色。
      overlayColorCompensation: 'none',
      overlayAlphaPolicy: this._getOverlayAlphaPolicy(),
      overlayAlphaLimit: this._getEffectiveOverlayAlphaLimit(),
      hostCompositing: this._getEffectiveHostCompositing(),
      enforceOverlayAlphaLimit:
        this._usesUnknownBrowserOverlay(),
    };
    let processedSourcePixels = 0;
    let failed = false;

    for (let index = 0; index < regions.length; index++)
    {
      const region = regions[index];
      const renderer = this._getBloomRenderer(index);
      const bloomContext = renderer.beginFrame(
        this.width,
        this.height,
        bloomCfg.resolutionScale,
        region,
        diffusion,
        this.dpr,
        region.emissionBounds,
      );

      if (!bloomContext)
      {
        if (!renderer.available)
        {
          // 像素回读失败后，下一帧统一切换原生回退。
          this.bloomRenderer.available = false;
          failed = true;
        }

        continue;
      }

      const coverageContext = renderer.beginCoverageFrame(
        this.config.outputCompositing,
      );

      processedSourcePixels += renderer.sourceWidth * renderer.sourceHeight;
      bloomContext.save();

      for (const batch of region.trailBatches)
      {
        const stroke = batch.stroke;

        if (getTrailRenderPoints(stroke).length >= 2)
        {
          drawTrailEmission(
            bloomContext,
            getTrailRenderPoints(stroke),
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
            stroke.trailFrameData,
            batch.firstSegment,
            batch.lastSegment,
          );
        }
      }

      for (const wave of region.waves)
      {
        wave.drawBloom(bloomContext, scale, this._getEffectiveOpacity());
      }

      for (const shard of region.shards)
      {
        shard.drawBloom(
          bloomContext,
          scale,
          this._getEffectiveOpacity(),
          this.fxConfig,
        );
      }

      bloomContext.restore();

      if (coverageContext)
      {
        coverageContext.save();

        for (const batch of region.trailBatches)
        {
          const stroke = batch.stroke;

          if (getTrailRenderPoints(stroke).length >= 2)
          {
            drawTrailCoverage(
              coverageContext,
              getTrailRenderPoints(stroke),
              scale,
              this._getEffectiveOpacity(),
              this.fxConfig,
              stroke.trailFrameData,
              batch.firstSegment,
              batch.lastSegment,
            );
          }
        }

        for (const wave of region.waves)
        {
          wave.drawBloomCoverage(
            coverageContext,
            scale,
            this._getEffectiveOpacity(),
          );
        }

        for (const shard of region.shards)
        {
          shard.drawBloomCoverage(
            coverageContext,
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
          );
        }

        coverageContext.restore();
      }

      let compositeSucceeded = false;

      this.context.save();

      try
      {
        if (this.config.outputCompositing === 'browser-overlay')
        {
          // Bloom ImageData 已按清晰层剩余 Alpha 容量编码；lighter 同时
          // 累加预乘 RGB 与传输 Alpha，避免 source-over 吞掉已有清晰能量。
          this.context.globalCompositeOperation = 'lighter';
        }

        compositeSucceeded = renderer.composite(this.context, settings);

        if (compositeSucceeded && bloomTransportContext)
        {
          renderer.drawCurrentOutput(bloomTransportContext);
        }
      }
      finally
      {
        this.context.restore();
      }

      if (!compositeSucceeded)
      {
        this.bloomRenderer.available = false;
        failed = true;
      }
    }

    if (!failed)
    {
      // Software Bloom 需要在本阶段提交 visual-max 的 Alpha；颜色补偿延后到
      // 帧收尾且只执行一次，避免 Bloom 与清晰层连续抬高同一核心。
      const scope = this._canvasBoundsScope;
      const alphaComplete = this._limitCanvasOverlayAlpha(
        scale,
        sceneAlphaSnapshot,
        bloomTransportContext,
        'lighter',
        false,
      );
      if (alphaComplete && scope?.valid && scope === this._canvasBoundsScope &&
          this._getOverlayColorCompensation() === 'none')
      {
        // 此后没有新的主画布绘制；复用当前帧的完成状态，保留已有写回舍入。
        scope.softwareAlphaComplete = true;
      }
      this._cacheSoftwareBloomFrame(scale);
    }

    this.softwareBloomFrameStats = {
      regionCount: regions.length,
      processedSourcePixels,
      combinedBoundsPixels: combinedBounds
        ? Math.max(1, Math.round(combinedBounds.width * this.dpr)) *
          Math.max(1, Math.round(combinedBounds.height * this.dpr))
        : 0,
    };
    // 全视口模式固定只保留一个 Software Bloom renderer。
    this._trimBloomRendererPool(regions.length);

    if (failed)
    {
      if (CUSTOM_BUILD)
      {
        this._reportBuildError('software-bloom-failed');
        return;
      }
      const hasCachedSoftwareBloom = this._hasCachedSoftwareBloomFrame(scale);

      // 即使同一时刻可以复用软件结果，也必须完成一次 Native 重画。这样下一
      // 帧输入变化时，局部缓冲已经准备好，不会把回读故障变成第二次分配抖动。
      this._drawCanvasFallbackFrame(scale, true, false);

      if (hasCachedSoftwareBloom)
      {
        // Native 先完成生命周期切换，再清掉近似层并复用同输入的已完成输出。
        // 缓存失效或无法绘制时则保留刚才的 Native 帧。
        this._drawCanvasFallbackFrame(scale, false, false);

        if (!this._drawCachedSoftwareBloomFrame(scale))
        {
          this._drawCanvasFallbackFrame(scale, true, false);
        }
      }

      this._renderLightBackgroundContrast(scale, false);
      this._setResolvedBloomBackend('native');
    }
  }

  _renderWebGL2Scene(renderer, scale)
  {
    const bloomCfg = this.fxConfig.bloom;

    if (!renderer?.available || renderer.contextLost)
    {
      return false;
    }

    const hasVisibleTrail = BUILD_TRAIL && this.trailStrokes.some(
      (stroke) => getTrailRenderPoints(stroke).length >= 2,
    );

    if (
      !hasVisibleTrail &&
      this.waves.length === 0 &&
      this.shards.length === 0
    )
    {
      renderer.clear();
      return true;
    }

    try
    {
      renderer.beginFrame();

      // 原游戏将 2px HDR TrailRenderer 与点击粒子写入同一 Scene，
      // 后续 Bloom 必须从这份完整 HDR 颜色缓冲统一提取。
      if (BUILD_TRAIL)
      {
        for (const stroke of this.trailStrokes)
        {
          if (getTrailRenderPoints(stroke).length < 2)
          {
            continue;
          }

          appendTrailWebGLScene(
            renderer,
            getTrailRenderPoints(stroke),
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
            stroke.trailFrameData,
          );
        }
      }

      // Cross2 使用 One / OneMinusSrcAlpha，必须先于普通加色粒子提交。
      if (BUILD_CLICK)
      {
        for (const wave of this.waves)
        {
          wave.appendWebGLSceneDiskLayer(
            renderer,
            scale,
            this._getEffectiveOpacity(),
          );
        }
      }

      // Dissolve MeshTri 与 Cross2、Trail 同为 4499，先完成这一队列。
      if (BUILD_CLICK)
      {
        for (const wave of this.waves)
        {
          wave.appendWebGLSceneAdditiveLayer(
            renderer,
            scale,
            this._getEffectiveOpacity(),
          );
        }
      }

      // Tri2 的 RenderQueue=4550，必须在全部 4499 材质之后提交。
      if (BUILD_SHARDS)
      {
        for (const shard of this.shards)
        {
          shard.appendWebGLScene(
            renderer,
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
          );
        }
      }

      if (!renderer.renderScene(
        {
          outputCompositing: this.config.outputCompositing,
          hostCompositing: this._getEffectiveHostCompositing(),
          ...(BUILD_BLOOM ? {
            bloomEnabled: resolveUnityBloomIntensity(bloomCfg.intensity) > 0,
          } : {}),
          // Unity 默认倍率为 1；偏离默认值时 renderer 只为 Bloom 重绘点击
          // 材质，不能缩放供清晰 Scene 与 Coverage 使用的 HDR 颜色。
          diskEmissionScale: bloomCfg.clickEmissionScale *
            bloomCfg.diskEmissionAlpha,
          ringEmissionScale: bloomCfg.clickEmissionScale *
            bloomCfg.ringEmissionAlpha,
        },
      ))
      {
        return false;
      }

      renderer.beginFrame(
        {
          preserveSceneStats: true,
        },
      );

      const rendered = renderer.render(
        {
          threshold: bloomCfg.threshold,
          softKnee: bloomCfg.softKnee,
          clamp: bloomCfg.clamp,
          intensity: bloomCfg.intensity,
          diffusion: bloomCfg.diffusion,
          opacity: this._getEffectiveOpacity(),
          outputCompositing: this.config.outputCompositing,
          overlayColorCompensation:
            this._getOverlayColorCompensation(),
          overlayAlphaPolicy: this._getOverlayAlphaPolicy(),
          overlayAlphaLimit: this._getEffectiveOverlayAlphaLimit(),
          hostCompositing: this._getEffectiveHostCompositing(),
          webgpuHdrPeak: this.config.webgpuHdrPeak,
          webgpuHdrBrightness: this.config.webgpuHdrBrightness,
          webgpuHdrColorPreservation:
            this.config.webgpuHdrColorPreservation,
          webgpuHdrWhiteCore: this.config.webgpuHdrWhiteCore,
          webgpuHdrWhiteStart: this.config.webgpuHdrWhiteStart,
          webgpuHdrWhiteEnd: this.config.webgpuHdrWhiteEnd,
        },
        { preserveCanvas: true },
      );

      this.webglBloomFrameStats =
      {
        available: renderer.available,
        ...renderer.stats,
      };

      return rendered;
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL2 Scene 渲染失败:', error);
      renderer.clear();
      return false;
    }
  }

  _renderWebGL2ClickEffects(scale)
  {
    return this._renderWebGL2Scene(this.webglEffectRenderer, scale);
  }

  _renderGPUClickEffects(backend, scale)
  {
    if (backend === 'webgl2')
    {
      // 保留既有故障注入和宿主诊断钩子，不改变 WebGL2 可观察调用面。
      return this._renderWebGL2ClickEffects(scale);
    }

    return this._renderWebGL2Scene(this.webgpuEffectRenderer, scale);
  }

  _clearLightBackgroundContrast()
  {
    if (!this.contrastContext)
    {
      return;
    }

    this.contrastContext.setTransform(
      this.dpr,
      0,
      0,
      this.dpr,
      0,
      0,
    );
    this.contrastContext.clearRect(0, 0, this.width, this.height);
  }

  _renderCanvasSceneEffects(scale, useNativeBloom)
  {
    if (!BUILD_REFERENCE)
    {
      return false;
    }

    const renderer = this.canvasSceneRenderer;

    if (!renderer?.available || renderer.contextLost)
    {
      return false;
    }

    try
    {
      renderer.beginFrame();
      // 精确 Scene Canvas 保存线性 HDR 发射，连续帧不能继承网页覆盖层的
      // source-over；Unity 的 Additive 与 Dissolve 都要求先按 One/One 累加。
      this.context.globalCompositeOperation = 'lighter';
      this._drawCanvasTrails(scale, useNativeBloom, true);

      // Cross2 是唯一会衰减已有场景颜色的材质，必须在普通加色粒子之前
      // 按旧到新顺序完成本体与 Coverage 提交。
      if (BUILD_CLICK)
      {
        for (const wave of this.waves)
        {
          wave.drawDiskLayer(
            this.context,
            scale,
            this._getEffectiveOpacity(),
            false,
            this.dpr,
          );
          wave.appendCanvasSceneCoverage(
            renderer,
            scale,
            this._getEffectiveOpacity(),
          );
        }
      }

      if (BUILD_CLICK)
      {
        for (const wave of this.waves)
        {
          wave.drawAdditiveBase(
            this.context,
            scale,
            this._getEffectiveOpacity(),
            true,
          );
        }
      }

      // Tri3 与 Cross2、Trail 同为 4499，先完成这一队列。
      this._drawWaveRings(
        scale,
        useNativeBloom,
        true,
        'scene',
        'coverage',
        1,
      );

      // Tri2 的 RenderQueue=4550，必须在全部 4499 材质之后提交。
      if (BUILD_SHARDS)
      {
        for (const shard of this.shards)
        {
          shard.draw(
            this.context,
            scale,
            this._getEffectiveOpacity(),
            this.fxConfig,
          );
        }
      }

      if (useNativeBloom)
      {
        if (!this.nativeClickBloomSurface)
        {
          const canvas = createCanvas();
          const context = canvas.getContext('2d');
          if (!context)
          {
            return false;
          }
          this.nativeClickBloomSurface = { canvas, context };
        }
        const { canvas, context } = this.nativeClickBloomSurface;
        const width = Math.max(1, Math.ceil(this.canvas.width * 0.5));
        const height = Math.max(1, Math.ceil(this.canvas.height * 0.5));
        if (canvas.width !== width || canvas.height !== height)
        {
          canvas.width = width;
          canvas.height = height;
        }
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, width, height);
        context.setTransform(width / this.width, 0, 0, height / this.height, 0, 0);
        this._drawNativeClickBloom(scale, context, 'host-additive');
      }
      const rendered = renderer.render(this.canvas,
        useNativeBloom ? this.nativeClickBloomSurface.canvas : null);
      if (CUSTOM_BUILD && rendered && !this.ownsCanvas)
      {
        // 外部 Canvas 只容纳一个 context；辅助 GPU 合成完成后复制最终像素。
        this.context.setTransform(1, 0, 0, 1, 0, 0);
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.context.drawImage(this.canvasSceneCanvas, 0, 0);
        this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      }
      return rendered;
    }
    catch (error)
    {
      console.warn('[BAClickFX] Canvas Scene Final Pass 渲染失败:', error);
      renderer.clear();
      return false;
    }
  }

  _drawCanvasFallbackPass(scale, useNativeBloom)
  {
    if (!(BUILD_CANVAS)) return false;

    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.context.clearRect(0, 0, this.width, this.height);
    // Context 丢失回退必须沿用正常帧的透明 Coverage 兼容合同。
    this.context.globalCompositeOperation =
      this._getCanvasOutputCompositing() === 'browser-overlay'
        ? 'source-over'
        : 'lighter';
    this._drawCanvasTrails(scale, useNativeBloom);
    this._drawCanvasClickEffects(scale, useNativeBloom);
  }

  _drawCanvasFallbackFrame(scale, useNativeBloom)
  {
    if (!(BUILD_CANVAS)) return false;

    this._invalidateCanvasBoundsScope();
    this.canvasNativeSceneAlphaSnapshot = null;

    if (
      useNativeBloom &&
      this._usesUnknownBrowserOverlay() &&
      !this._usesIndependentHostPayload() &&
      this._getOverlayAlphaPolicy() === 'visual-max'
    )
    {
      // Canvas shadowBlur 使用 source-over。先保存无阴影清晰层 Coverage，
      // Final Pass 才能从完整帧 Alpha 精确分离聚合辉光传输量。
      this._drawCanvasFallbackPass(scale, false);
      this.canvasNativeSceneAlphaSnapshot =
        this._captureCanvasOverlayAlpha(scale);
    }

    this._drawCanvasFallbackPass(scale, useNativeBloom);
  }

  _finalizeCanvasOverlayAlpha(scale)
  {
    if (!(BUILD_CANVAS)) return false;

    const sceneAlphaSnapshot = this.canvasNativeSceneAlphaSnapshot;

    this.canvasNativeSceneAlphaSnapshot = null;
    const scope = this._canvasBoundsScope;
    if (BUILD_SOFTWARE && scope?.valid && scope.softwareAlphaComplete &&
        scope.scale === scale && scope.dpr === this.dpr &&
        scope.width === this.canvas.width && scope.height === this.canvas.height)
    {
      return;
    }
    this._limitCanvasOverlayAlpha(
      scale,
      sceneAlphaSnapshot,
      null,
      sceneAlphaSnapshot ? 'source-over' : 'lighter',
    );
  }

  _restoreCanvasOutputAfterContextLoss(bloomBackend)
  {
    if (!(!CUSTOM_BUILD)) return false;

    this._invalidateCanvasBoundsScope();
    const scale = this._getScale();
    const previousHueShift = themeHueShift;
    const previousRelativeOklchTheme = relativeOklchTheme;
    const previousGradientEnergyCache = gradientEnergyCache;
    const previousRingSampleCache = ringSampleCache;
    let resolvedBloomBackend = bloomBackend;

    this._setResolvedBloomBackend(resolvedBloomBackend);

    if (this.resolvedBloomBackend === 'native')
    {
      // Context 事件监听器可同步拒绝 Software，避免当前回退帧触发像素回读。
      resolvedBloomBackend = 'native';
    }

    let contextSaved = false;

    const previousTextureOwner = BUILD_CANVAS ? this._beginCanvasTextureFrame() : null;
    try
    {
      this.context.save();
      contextSaved = true;
      setRenderState(this._themeHueShift, this._relativeOklchTheme, this._gradientEnergyCache, new WeakMap());
      this._drawCanvasFallbackFrame(
        scale,
        resolvedBloomBackend === 'native',
      );

      this._renderLightBackgroundContrast(
        scale,
        resolvedBloomBackend === 'software',
      );

      if (
        resolvedBloomBackend === 'software' &&
        this._hasVisibleEffects()
      )
      {
        this._renderSoftwareBloom(scale);

        if (!this.bloomRenderer.available)
        {
          // _renderSoftwareBloom 已完成同帧 Native 重画；这里只同步本方法
          // 最终提交的后端，避免 Context 恢复路径重复绘制整帧。
          resolvedBloomBackend = 'native';
        }
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL Context 丢失回退失败:', error);
      resolvedBloomBackend = 'native';

      try
      {
        this._drawCanvasFallbackFrame(scale, true);
        this._renderLightBackgroundContrast(scale, false);
      }
      catch (fallbackError)
      {
        // Canvas 自身不可用时保留透明输出，不能让异常逃出浏览器事件回调。
        console.warn('[BAClickFX] 原生 Canvas 回退失败:', fallbackError);
      }
    }
    finally
    {
      setRenderState(previousHueShift, previousRelativeOklchTheme, previousGradientEnergyCache, previousRingSampleCache);

      try
      {
        if (contextSaved) this.context.restore();
      }
      finally
      {
        if (BUILD_CANVAS) this._endCanvasTextureFrame(previousTextureOwner);
      }
    }

    this._finalizeCanvasOverlayAlpha(scale);
    this._setResolvedBloomBackend(resolvedBloomBackend);
    this._setCanvasOutputVisible(true);
    this._flushCompositingMountRefresh();
  }

  _drawCanvasClickEffects(scale, useNativeBloom)
  {
    if (!(BUILD_CANVAS)) return false;

    if (!BUILD_CLICK)
    {
      return false;
    }

    const outputCompositing = this._getCanvasOutputCompositing();
    // 最终 Canvas 载荷会在所有图元聚合后统一补偿一次。
    const overlayColorCompensation = 'none';
    const overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit();

    if (BUILD_CLICK)
    {
      for (const wave of this.waves)
      {
        wave.drawBase(
          this.context,
          scale,
          this._getEffectiveOpacity(),
          useNativeBloom,
          outputCompositing,
          this.dpr,
          overlayColorCompensation,
          overlayAlphaLimit,
        );
      }
    }

    this._drawWaveRings(
      scale,
      useNativeBloom,
      false,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    );

    // Tri2 的 RenderQueue=4550，必须在全部 4499 材质之后提交。
    if (BUILD_SHARDS)
    {
      for (const shard of this.shards)
      {
        shard.draw(
          this.context,
          scale,
          this._getEffectiveOpacity(),
          this.fxConfig,
          outputCompositing,
          overlayColorCompensation,
          overlayAlphaLimit,
        );
      }
    }

    if (useNativeBloom)
    {
      this._drawNativeClickBloom(scale);
    }
  }

  _drawNativeClickBloom(
    scale,
    context = this.context,
    outputCompositing = this._getCanvasOutputCompositing(),
  )
  {
    if (!(BUILD_NATIVE && BUILD_BLOOM)) return false;

    if (!BUILD_CLICK)
    {
      return false;
    }

    const settings = this.fxConfig.bloom;
    const opacity = this._getEffectiveOpacity();

    if (settings.intensity <= 0 || settings.clickEmissionScale <= 0 || opacity <= 0)
    {
      return;
    }

    const emission = settings.clickEmissionScale;
    const sampleColor = [0, 0, 0];
    context.save();
    // 光晕是独立的 Final Bloom 增量，不能重画 Cross2 本体或让后来的圆盘
    // 遮住先前的光晕；所有清晰材质提交完毕后只进行一次加色。
    context.globalCompositeOperation = 'lighter';
    // 原生路径先确定发光源，再应用宿主透明度，避免半透明时细环因
    // 近似预过滤跌出阈值而突然失去整层 Bloom。
    context.globalAlpha = opacity;
    context.shadowBlur = 0;

    if (BUILD_CLICK)
    {
      for (const wave of this.waves)
      {
        const sources = [];
        const diskCfg = this.fxConfig.disk;
        const diskProgress = wave.ageMs / diskCfg.lifetimeMs;

        if (diskProgress < 1 && settings.diskAlpha > 0 && settings.diskBlur > 0)
        {
          const radius = diskCfg.radius * evaluateUnityHermiteCurve(
            diskCfg.sizeKeys, diskProgress,
          ) * scale;
          const material = evaluateSrgbGradientEnergy(
            diskCfg.colorKeys, diskProgress,
            settings.diskEmission * emission * settings.diskEmissionAlpha,
          );
          const source = createNativeBloomSource(settings);
          source.blurScale = settings.diskBlur / 65;
          // 小型固定网格来自原 Circle_01，保留纹理面积与 HDR RGB。
          // Cross2 生命周期 Alpha 只衰减背景，不应提前削弱 Bloom 发射。
          const samples = getNativeCircleBloomSamples();
          const area = (2 * radius / NATIVE_BLOOM_DISK_SAMPLES) ** 2 * settings.diskAlpha / 0.65;
          for (let offset = 0; offset < samples.length; offset += 4)
          {
            sampleColor[0] = material[0] * samples[offset];
            sampleColor[1] = material[1] * samples[offset + 1];
            sampleColor[2] = material[2] * samples[offset + 2];
            addNativeBloomSample(source, sampleColor, area, samples[offset + 3] * radius ** 2);
          }
          sources.push(source);
        }

        const ringCfg = this.fxConfig.rings;
        const ringProgress = wave.ageMs / ringCfg.lifetimeMs;
        if (ringProgress < 1 && settings.ringAlpha > 0 && settings.ringBlur > 0)
        {
          const material = evaluateSrgbGradientEnergy(
            ringCfg.colorKeys, ringProgress,
            ringCfg.hdrIntensity * emission * settings.ringEmissionAlpha,
          );
          for (const ring of wave.rings)
          {
            const geometry = resolveRingGeometry(ring, ringProgress, scale, ringCfg);
            const source = createNativeBloomSource(settings);
            source.blurScale = settings.ringBlur / 80;
            source.radius = geometry.radius;
            source.width = geometry.width;
            const radialSamples = resolveRingIntegrationSamples(ringCfg);
            const angularSamples = 64;
            // GPU 在阈值提取前先缩小 Scene；亚像素环带会与周围黑色平均。
            // 同时扩大样本面积以守恒能量，避免细碎溶解末期仍发出完整圆形光雾。
            const prefilterCoverage = Math.min(1, Math.max(0.000001,
              geometry.width * this.dpr * settings.resolutionScale * 0.75));
            const area = TAU * geometry.radius * geometry.width / angularSamples *
              settings.ringAlpha / 0.35 / prefilterCoverage;
            for (let sample = 0; sample < angularSamples; sample++)
            {
              let coverage = 0;
              for (let band = 0; band < radialSamples; band++)
              {
                coverage += evaluateRingLuminance(
                  (sample + 0.5) / angularSamples, (band + 0.5) / radialSamples,
                  geometry.threshold, ringCfg,
                );
              }
              coverage *= prefilterCoverage / radialSamples;
              sampleColor[0] = material[0] * coverage;
              sampleColor[1] = material[1] * coverage;
              sampleColor[2] = material[2] * coverage;
              addNativeBloomSample(source, sampleColor, area, geometry.radius * geometry.radius);
            }
            sources.push(source);
          }
        }

        const x = wave.x;
        const y = wave.y;
        const profile = createNativeBloomProfile(sources, this.width, this.height, this.dpr, settings);
        if (!profile)
        {
          continue;
        }
        // 保持原有各向同性扩散，只绘制径向 Profile。
        const gain = 1;
        const gradient = context.createRadialGradient(x, y, 0, x, y, profile.radius);
        for (const stop of profile.stops)
        {
          const color = outputCompositing === 'scene'
            ? linearEnergyToAdditiveCss(stop.energy, gain)
            : outputCompositing === 'browser-overlay'
              ? linearEnergyToOverlayCss(stop.energy, gain, linearToSrgb(stop.transport * gain),
                  'none', this._getEffectiveOverlayAlphaLimit(), opacity)
              : linearEnergyToHostAdditiveCss(stop.energy, gain, linearToSrgb(stop.transport * gain));
          gradient.addColorStop(stop.position, color);
        }
        context.fillStyle = gradient;
        context.fillRect(x - profile.radius, y - profile.radius,
          profile.radius * 2, profile.radius * 2);
      }
    }
    context.restore();
  }

  _drawCanvasTrails(
    scale,
    useNativeBloom,
    linearOutput = false,
  )
  {
    if (!BUILD_TRAIL)
    {
      return false;
    }

    const nativeBloomSurface = useNativeBloom
      ? this._getNativeTrailBloomSurface()
      : null;
    const outputCompositing = linearOutput
      ? 'scene'
      : this._getCanvasOutputCompositing();
    // 线性目标不需要补偿；透明 Canvas 也延迟到 Final Pass 统一处理。
    const overlayColorCompensation = 'none';
    const overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit();

    for (
      let strokeIndex = this.trailStrokes.length - 1;
      strokeIndex >= 0;
      strokeIndex--
    )
    {
      const stroke = this.trailStrokes[strokeIndex];

      if (getTrailRenderPoints(stroke).length < 2)
      {
        continue;
      }

      this._getTrailFrameData(stroke, this.fxConfig.bloom.trailEmission);

      drawTrail(
        this.context,
        getTrailRenderPoints(stroke),
        scale,
        this._getEffectiveOpacity(),
        this.fxConfig,
        useNativeBloom,
        nativeBloomSurface,
        stroke.trailFrameData,
        linearOutput,
        outputCompositing,
        overlayColorCompensation,
        overlayAlphaLimit,
      );
    }
  }

  _renderWebGL2Bloom(scale)
  {
    if (!BUILD_WEBGL_BLOOM)
    {
      return false;
    }

    const renderer = this.webglBloomRenderer;

    if (
      !renderer ||
      !this._resizeWebGLBloomRenderer()
    )
    {
      this._fallbackFromWebGL2(scale);
      return;
    }

    if (!this._renderWebGL2Scene(renderer, scale))
    {
      this._fallbackFromWebGL2(scale);
      return;
    }

    // Scene 与 Bloom 已写入同一个预乘输出，隐藏旧 Canvas 可避免重复叠加。
    this._setWebGLBloomVisible(true);
    this._setCanvasOutputVisible(false);
  }

  _fallbackFromWebGL2(scale)
  {
    this._setWebGLBloomVisible(false);
    let fallbackBackend = this._resolveCanvasFallbackBloomBackend();

    this._setResolvedBloomBackend(fallbackBackend);
    // 状态监听器可以同步显式选择 Software 或 Native；当前失败帧必须服从
    // 更新后的请求，但绝不自行把 GPU 故障升级为 Software。
    fallbackBackend = this._resolveCanvasFallbackBloomBackend();

    if (fallbackBackend === 'software')
    {
      this._drawCanvasFallbackFrame(scale, false, false);
      this._renderLightBackgroundContrast(scale, true);
      this._setResolvedBloomBackend('software');
      this._renderSoftwareBloom(scale);
      return;
    }

    this._drawCanvasFallbackFrame(scale, true, false);
    this._renderLightBackgroundContrast(scale, false);
    this._setResolvedBloomBackend('native');
  }

  _drawWaveRings(
    scale,
    useNativeBloom,
    linearNativeGlow = false,
    outputCompositing = this._getCanvasOutputCompositing(),
    overlayColorCompensation = 'none',
    overlayAlphaLimit = this._getEffectiveOverlayAlphaLimit(),
  )
  {
    if (!(BUILD_CANVAS)) return false;

    if (!BUILD_CLICK)
    {
      return false;
    }

    if (BUILD_CLICK)
    {
      for (const wave of this.waves)
      {
        wave.drawRings(
          this.context,
          scale,
          this._getEffectiveOpacity(),
          useNativeBloom,
          this.dpr,
          outputCompositing,
          linearNativeGlow,
          overlayColorCompensation,
          overlayAlphaLimit,
        );
      }
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

  _hasCompositingReference()
  {
    return this.compositingReferenceSource !== null;
  }

  _applyCompositingReferenceToRenderers(
    source,
    fit,
    previousSource,
    previousFit,
    invalidatesVisibleOutput,
  )
  {
    if (!BUILD_REFERENCE)
    {
      return false;
    }

    const entries = [
      {
        name: 'WebGPU',
        renderer: this.webgpuEffectRenderer,
        discard: () =>
        {
          this._setWebGPUEffectVisible(false);
          this._destroyWebGPUEffectRenderer();
        },
      },
      {
        name: '纯 WebGL2',
        renderer: this.webglEffectRenderer,
        discard: () =>
        {
          this._setWebGLEffectVisible(false);
          this._destroyWebGLEffectRenderer();
        },
      },
      {
        name: 'WebGL2 Bloom',
        renderer: this.webglBloomRenderer,
        discard: () =>
        {
          this._setWebGLBloomVisible(false);
          this._destroyWebGLBloomRenderer();
        },
      },
      {
        name: 'Canvas Final Pass',
        renderer: this.canvasSceneRenderer,
        discard: () =>
        {
          this._setCanvasSceneVisible(false);
          this._destroyCanvasSceneRenderer();
        },
      },
    ].filter((entry) => entry.renderer);
    const appliedEntries = [];
    let failedEntry = null;

    for (const entry of entries)
    {
      let accepted = false;

      try
      {
        accepted = entry.renderer.setCompositingReference(source, { fit });
      }
      catch (error)
      {
        console.warn(`[BAClickFX] ${entry.name} 背景更新失败:`, error);
      }

      if (!accepted)
      {
        failedEntry = entry;
        break;
      }

      appliedEntries.push(entry);
    }

    if (!failedEntry)
    {
      return true;
    }

    let rollbackFailed = false;

    for (let index = appliedEntries.length - 1; index >= 0; index--)
    {
      const entry = appliedEntries[index];
      let restored = false;

      try
      {
        restored = entry.renderer.setCompositingReference(
          previousSource,
          { fit: previousFit },
        );
      }
      catch (error)
      {
        console.warn(`[BAClickFX] ${entry.name} 背景回滚失败:`, error);
      }

      if (!restored)
      {
        // 无法回滚的 Renderer 不得继续持有与主状态不一致的背景。
        entry.discard();
        rollbackFailed = true;
      }
    }

    if (rollbackFailed)
    {
      if (invalidatesVisibleOutput)
      {
        this._invalidateSceneBackgroundOutputs();
      }

      this._requestRender();
    }

    return false;
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

  _getResolvedWebGPUOutputMode()
  {
    if (CUSTOM_BUILD && BUILD_WEBGPU)
    {
      const mode = this.webgpuEffectRenderer?.deviceManager.outputMode;
      return mode === 'standard' || mode === 'extended' ? mode : this.buildFailed ? 'unavailable' : 'pending';
    }
    const requested = normalizeEffectBackend(this.config.effectBackend);

    if (
      (requested !== 'webgpu' && requested !== 'auto') ||
      !this.ownsCanvas ||
      !this.overlayParent
    )
    {
      return 'unavailable';
    }

    const renderer = this.webgpuEffectRenderer;

    if (renderer?.deviceManager.outputMode === 'extended')
    {
      return 'extended';
    }

    if (renderer?.deviceManager.outputMode === 'standard')
    {
      return 'standard';
    }

    if (renderer?.status === 'pending' || renderer?.status === 'ready')
    {
      return 'pending';
    }

    if (
      !this.webgpuEffectUnavailable &&
      (requested === 'webgpu' || requested === 'auto')
    )
    {
      return 'pending';
    }

    return 'unavailable';
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


