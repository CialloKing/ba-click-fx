// 内部职责边界；完整版与定制构建使用这些同一份方法。
import { InputRuntime } from './engine-input.js';
import {
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
  createCanvas,
  isOffscreenCanvas,
  releaseTrailGradients,
  setOverlayStyle,
} from './engine-shared.js';
import {
  BUILD_CANVAS,
  BUILD_REFERENCE,
  BUILD_SOFTWARE,
  BUILD_TRAIL,
  BUILD_WEBGL,
  BUILD_WEBGL_BLOOM,
  BUILD_WEBGPU,
  CUSTOM_BUILD,
} from './build-capabilities.js';
import { SoftwareBloomRenderer } from './software-bloom.js';
import { WebGL2CanvasSceneRenderer } from './webgl2-canvas-scene.js';
import { WebGL2EffectRenderer } from './webgl2-effect.js';
import { WebGPUEffectRenderer } from './webgpu-effect.js';
import { normalizeBloomBackend, normalizeEffectBackend } from './config.js';

export class BackendRuntime extends InputRuntime
{

  _getRequestedEffectBackendState()
  {
    if (CUSTOM_BUILD)
    {
      return BUILD_CANVAS ? 'canvas2d' : 'pending';
    }
    const requested = normalizeEffectBackend(this.config.effectBackend);
    const isDirectCanvas = CUSTOM_BUILD ? !this.ownsCanvas : isOffscreenCanvas(this.canvas);

    if (
      requested === 'canvas2d' ||
      (!this.ownsCanvas && !isDirectCanvas) ||
      (this.ownsCanvas && !this.overlayParent)
    )
    {
      return 'canvas2d';
    }

    if (requested === 'webgpu' || requested === 'auto')
    {
      if (
        this.webgpuEffectVisible &&
        this.webgpuEffectRenderer?.available
      )
      {
        return 'webgpu';
      }

      if (
        !this.webgpuEffectUnavailable &&
        (
          !this.webgpuEffectRenderer ||
          this.webgpuEffectRenderer.status === 'pending' ||
          this.webgpuEffectRenderer.status === 'ready'
        )
      )
      {
        return 'pending';
      }
    }

    if (
      this.webglEffectVisible &&
      this.webglEffectRenderer?.available
    )
    {
      return 'webgl2';
    }

    if (
      this.webglEffectUnavailable ||
      this.webglEffectRenderer &&
      (
        !this.webglEffectRenderer.available ||
        this.webglEffectRenderer.contextLost
      )
    )
    {
      return 'canvas2d';
    }

    // Renderer 和完整浮点目标都在首个 Scene 提交时验证。
    return 'pending';
  }

  _getRequestedBloomBackendState()
  {
    if (CUSTOM_BUILD)
    {
      return BUILD_CANVAS ? this.config.bloomBackend : 'pending';
    }
    const requested = normalizeBloomBackend(this.config.bloomBackend);
    const fallback = this._resolveCanvasFallbackBloomBackend();

    if (
      this.webgpuEffectVisible &&
      this.webgpuEffectRenderer?.available
    )
    {
      return 'webgpu';
    }

    if (
      this.webglEffectVisible &&
      this.webglEffectRenderer?.available
    )
    {
      return 'webgl2';
    }

    if (requested === 'native')
    {
      return 'native';
    }

    if (requested === 'software')
    {
      return fallback;
    }

    if (this.webglBloomRenderer)
    {
      const renderer = this.webglBloomRenderer;

      return (
        renderer.available &&
        renderer.sourceTarget &&
        renderer.levels?.length > 0
      )
        ? 'webgl2'
        : fallback;
    }

    if (
      this.webglBloomUnavailable ||
      !this.ownsCanvas ||
      !this.overlayParent
    )
    {
      return fallback;
    }

    // WebGL2 Canvas 延迟到首个渲染帧创建，构造完成时不能伪报某个实际后端。
    return 'pending';
  }

  _setResolvedEffectBackend(backend)
  {
    if (this.resolvedEffectBackend === backend)
    {
      return;
    }

    this.resolvedEffectBackend = backend;
    this._invalidateCanvasBoundsScope();

    if (
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
          EFFECT_BACKEND_CHANGE_EVENT,
          {
            detail:
            {
              requestedEffectBackend: this.config.effectBackend,
              resolvedEffectBackend: backend,
            },
          },
        ),
      );
    }
    catch
    {
      // 状态通知不能中断渲染；旧 DOM 环境仍可通过 getConfig() 查询。
    }
  }

  _setResolvedBloomBackend(backend)
  {
    if (this.resolvedBloomBackend === backend)
    {
      return;
    }

    this.resolvedBloomBackend = backend;
    this._invalidateCanvasBoundsScope();

    if (
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
          BLOOM_BACKEND_CHANGE_EVENT,
          {
            detail:
            {
              requestedBloomBackend: this.config.bloomBackend,
              resolvedBloomBackend: backend,
            },
          },
        ),
      );
    }
    catch
    {
      // 状态通知不能中断特效渲染；极旧 DOM 实现仍可通过 getConfig() 查询。
    }
  }

  _handleWebGPUEffectStateChange(renderer, status)
  {
    if (!BUILD_WEBGPU)
    {
      return false;
    }

    if (this.destroyed || renderer !== this.webgpuEffectRenderer)
    {
      return;
    }

    const requested = normalizeEffectBackend(this.config.effectBackend);

    if (status === 'ready')
    {
      this.webgpuEffectUnavailable = false;

      if (requested === 'webgpu' || requested === 'auto')
      {
        // Device 就绪不等于首帧已提交；可见性仍由完整 Scene 成功后切换。
        this._setResolvedEffectBackend('pending');
        this._requestRender();
      }

      return;
    }

    if (status !== 'lost' && status !== 'unavailable')
    {
      return;
    }

    if (CUSTOM_BUILD)
    {
      this._reportBuildError(status === 'lost' ? 'device-lost' : 'initialization-failed', renderer.failure ?? renderer.deviceManager.failure);
      return;
    }
    const wasVisible = this.webgpuEffectVisible;

    this.webgpuEffectUnavailable = true;
    this._setWebGPUEffectVisible(false);

    if (wasVisible && (this.paused || !this.renderingFrame))
    {
      const fallbackBackend = this._resolveCanvasFallbackBloomBackend();

      this._restoreCanvasOutputAfterContextLoss(fallbackBackend);
    }
    else
    {
      this._setCanvasOutputVisible(true);
    }

    // WebGPU 失败后仍有 WebGL2 探测阶段，不能提前宣称最终 Canvas 回退。
    this._setResolvedEffectBackend(this._getRequestedEffectBackendState());
    this._setResolvedBloomBackend(this._getRequestedBloomBackendState());
    this._requestRender();
  }

  _ensureWebGPUEffectRenderer()
  {
    if (!BUILD_WEBGPU)
    {
      return false;
    }

    if (this.webgpuEffectRenderer)
    {
      this.webgpuEffectRenderer.setPreferHdr(this.config.webgpuPreferHdr);
      return this.webgpuEffectRenderer.available;
    }

    if (
      this.webgpuEffectUnavailable ||
      (this.ownsCanvas && !this.overlayParent) ||
      (!CUSTOM_BUILD && !this.ownsCanvas)
    )
    {
      return false;
    }

    const canvas = this.ownsCanvas ? createCanvas() : this.canvas;

    if (this.ownsCanvas)
    {
    setOverlayStyle(
      canvas,
      !this.host && !this.config.isolatedCompositing,
      '2147483646',
      '',
    );
    // Adapter/Device 初始化是异步的；旧输出必须保留到首个完整帧提交成功。
    canvas.style.display = 'none';
    this.overlayParent.appendChild(canvas);
    }
    let renderer = null;

    try
    {
      renderer = new WebGPUEffectRenderer(
        canvas,
        {
          preferHdr: this.config.webgpuPreferHdr,
          onStateChange: (status, candidate) =>
            this._handleWebGPUEffectStateChange(candidate, status),
        },
      );
      const compositingReference = this.compositingReferenceSource;

      if (
        compositingReference !== null &&
        !renderer.setCompositingReference(
          compositingReference,
          { fit: this.compositingReferenceFit },
        )
      )
      {
        throw new Error('WebGPU 无法接入当前合成参考');
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGPU 创建失败:', error);
      this.webgpuEffectUnavailable = true;
      renderer?.destroy();
      if (this.ownsCanvas) canvas.remove();
      return false;
    }

    this.webgpuEffectCanvas = canvas;
    this.webgpuEffectRenderer = renderer;
    return renderer.available;
  }

  _resizeWebGPUEffectRenderer()
  {
    if (!BUILD_WEBGPU)
    {
      return false;
    }

    return !!this.webgpuEffectRenderer?.resize(
      this.width,
      this.height,
      this.dpr,
      this.fxConfig.bloom.resolutionScale,
      this.fxConfig.bloom.diffusion,
    );
  }

  _prepareWebGPUEffectBackend()
  {
    if (!BUILD_WEBGPU)
    {
      return false;
    }

    const ready = this._ensureWebGPUEffectRenderer() &&
      this._resizeWebGPUEffectRenderer();

    if (ready)
    {
      if (this.resolvedEffectBackend !== 'webgpu')
      {
        this._setResolvedEffectBackend('pending');
      }

      return true;
    }

    if (
      this.webgpuEffectRenderer?.status === 'pending' ||
      this.webgpuEffectRenderer?.status === 'ready'
    )
    {
      this._setResolvedEffectBackend('pending');
    }

    return false;
  }

  _prepareEffectBackend()
  {
    if (CUSTOM_BUILD)
    {
      if (BUILD_WEBGPU)
      {
        return this._prepareWebGPUEffectBackend() ? 'webgpu' : null;
      }
      if (BUILD_WEBGL)
      {
        return this._prepareWebGLEffectBackend() ? 'webgl2' : null;
      }
      this._setResolvedEffectBackend('canvas2d');
      return null;
    }
    const requested = normalizeEffectBackend(this.config.effectBackend);

    if (!CUSTOM_BUILD && requested === 'canvas2d')
    {
      this._setResolvedEffectBackend('canvas2d');
      return null;
    }

    if (requested === 'webgpu' || requested === 'auto')
    {
      if (this._prepareWebGPUEffectBackend())
      {
        return 'webgpu';
      }

      if (
        !this.webgpuEffectUnavailable &&
        this.webgpuEffectRenderer?.status === 'pending'
      )
      {
        return null;
      }
    }

    return this._prepareWebGLEffectBackend() ? 'webgl2' : null;
  }

  _setWebGPUEffectVisible(visible)
  {
    if (!BUILD_WEBGPU)
    {
      return false;
    }

    if (
      !visible &&
      this.webgpuEffectRenderer &&
      !this.webgpuEffectRenderer.suspendPresentation()
    )
    {
      const changed = this.webgpuEffectVisible;

      // 无法解除 Extended Surface 时必须释放 Device，避免隐藏 Canvas
      // 继续影响浏览器对后续 SDR Canvas 的页面合成判断。
      console.warn('[BAClickFX] WebGPU Canvas 暂停失败，已释放该 Renderer');
      this._destroyWebGPUEffectRenderer();
      this.webgpuEffectUnavailable = false;

      if (changed)
      {
        this._requestCompositingMountRefresh();
      }

      return;
    }

    if (!this.webgpuEffectCanvas)
    {
      const changed = this.webgpuEffectVisible;

      this.webgpuEffectVisible = false;

      if (changed)
      {
        this._requestCompositingMountRefresh();
      }

      return;
    }

    if (this.webgpuEffectVisible === visible)
    {
      return;
    }

    this.webgpuEffectVisible = visible;
    if (this.webgpuEffectCanvas.style) this.webgpuEffectCanvas.style.display = visible ? '' : 'none';

    this._requestCompositingMountRefresh();
  }

  _destroyWebGPUEffectRenderer()
  {
    if (!BUILD_WEBGPU)
    {
      return false;
    }

    const renderer = this.webgpuEffectRenderer;

    this.webgpuEffectRenderer = null;
    if (this.ownsCanvas) this.webgpuEffectCanvas?.remove();
    this.webgpuEffectCanvas = null;
    this.webgpuEffectVisible = false;
    renderer?.destroy();
  }

  _handleWebGLContextLost()
  {
    if (!BUILD_WEBGL_BLOOM)
    {
      return false;
    }

    if (this.destroyed || !this.webglBloomVisible)
    {
      return;
    }

    const fallbackBackend = this._resolveCanvasFallbackBloomBackend();

    this._setWebGLBloomVisible(false);

    if (this.paused || !this.renderingFrame)
    {
      this._restoreCanvasOutputAfterContextLoss(fallbackBackend);
    }
    else
    {
      // 活跃帧会在当前或下一次 RAF 走原有回退，避免事件回调与帧渲染
      // 同时向 Canvas 叠加一次 Software Bloom。
      this._setResolvedBloomBackend(fallbackBackend);
    }

    this._requestRender();
  }

  _handleWebGLContextRestored()
  {
    if (!BUILD_WEBGL_BLOOM)
    {
      return false;
    }

    if (this.destroyed)
    {
      return;
    }

    if (!this.webglBloomRenderer?.available)
    {
      // 恢复初始化失败的实例无法自行再次初始化；丢弃后允许下一帧
      // 用新 Canvas 进行一次正常的懒创建重试。
      this._destroyWebGLBloomRenderer();
      this.webglBloomUnavailable = false;
    }

    if (
      this.paused ||
      !this._hasVisibleEffects() ||
      normalizeEffectBackend(this.config.effectBackend) !== 'canvas2d'
    )
    {
      return;
    }

    const requested = normalizeBloomBackend(this.config.bloomBackend);

    if (requested !== 'webgl2' && requested !== 'auto')
    {
      return;
    }

    // Renderer 会先在自己的 restored 监听器中重建资源；下一帧再验证完整链路。
    this._setResolvedBloomBackend('pending');
    this._requestRender();
  }

  _handleWebGLEffectContextLost()
  {
    if (!BUILD_WEBGL)
    {
      return false;
    }

    if (this.destroyed || !this.webglEffectVisible)
    {
      return;
    }

    if (CUSTOM_BUILD)
    {
      this.webglEffectRenderer?.clear();
      this._setResolvedEffectBackend('pending');
      return;
    }
    this._setWebGLEffectVisible(false);
    this._setResolvedEffectBackend('canvas2d');
    const fallbackBackend = this._resolveCanvasFallbackBloomBackend();

    if (this.paused || !this.renderingFrame)
    {
      this._restoreCanvasOutputAfterContextLoss(fallbackBackend);
    }
    else
    {
      this._setResolvedBloomBackend(fallbackBackend);
      this._setCanvasOutputVisible(true);
    }

    this._requestRender();
  }

  _handleWebGLEffectContextRestored()
  {
    if (!BUILD_WEBGL)
    {
      return false;
    }

    if (this.destroyed)
    {
      return;
    }

    if (!this.webglEffectRenderer?.available)
    {
      // 失败实例留在 ensure 路径会永久阻断重建，因此只保留最新背景源，
      // 下一次需要纯 WebGL2 时再创建完整 Renderer。
      this._destroyWebGLEffectRenderer();
      this.webglEffectUnavailable = false;
    }

    if (this.paused || !this._hasVisibleEffects())
    {
      return;
    }

    const requested = normalizeEffectBackend(this.config.effectBackend);

    if (requested !== 'canvas2d')
    {
      // Renderer 先恢复 Program；下一帧再重新验证完整浮点目标。
      this._setResolvedEffectBackend('pending');
      this._requestRender();
    }
  }

  _ensureWebGLEffectRenderer()
  {
    if (!BUILD_WEBGL)
    {
      return false;
    }

    if (this.webglEffectRenderer)
    {
      return this.webglEffectRenderer.available;
    }

    if (this.webglEffectUnavailable)
    {
      return false;
    }

    const isDirectCanvas = CUSTOM_BUILD ? !this.ownsCanvas : isOffscreenCanvas(this.canvas);
    if (!this.ownsCanvas && !isDirectCanvas)
    {
      return false;
    }

    if (this.ownsCanvas && !this.overlayParent)
    {
      return false;
    }

    const canvas = this.ownsCanvas ? createCanvas() : this.canvas;

    if (this.ownsCanvas && this.overlayParent)
    {
      setOverlayStyle(
        canvas,
        !this.host && !this.config.isolatedCompositing,
        '2147483646',
        '',
      );
      // 纯 WebGL2 已把加色 RGB 与 Cross2 Coverage 编码为预乘输出；普通
      // DOM 合成才能执行 Unity 的 OneMinusSrcAlpha 背景衰减。
      // 独立 Canvas 在 Scene 后端接管前保持隐藏，避免与稳定 Bloom 层叠加。
      canvas.style.display = 'none';
      this.overlayParent.appendChild(canvas);
    }

    let renderer = null;

    try
    {
      renderer = new WebGL2EffectRenderer(canvas);

      if (!renderer.available)
      {
        this.webglEffectUnavailable = true;
        renderer.destroy();
        if (this.ownsCanvas)
        {
          canvas.remove();
        }
        return false;
      }

      const compositingReference = this.compositingReferenceSource;

      if (compositingReference !== null)
      {
        const referenceReady = renderer.setCompositingReference(
          compositingReference,
          { fit: this.compositingReferenceFit },
        );

        if (!referenceReady)
        {
          // 候选 Renderer 未接入规范背景时不能宣称 Scene 已就绪。
          this.webglEffectUnavailable = true;
          renderer.destroy();
          if (this.ownsCanvas)
          {
            canvas.remove();
          }
          return false;
        }
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] 纯 WebGL2 创建失败:', error);
      this.webglEffectUnavailable = true;
      renderer?.destroy();
      if (this.ownsCanvas)
      {
        canvas.remove();
      }
      return false;
    }

    this.webglEffectCanvas = canvas;
    this.webglEffectRenderer = renderer;
    canvas.addEventListener?.(
      'webglcontextlost',
      this._onWebGLEffectContextLost,
    );
    canvas.addEventListener?.(
      'webglcontextrestored',
      this._onWebGLEffectContextRestored,
    );
    return true;
  }

  _resizeWebGLEffectRenderer()
  {
    if (!BUILD_WEBGL)
    {
      return false;
    }

    const renderer = this.webglEffectRenderer;

    return !!renderer?.resize(
      this.width,
      this.height,
      this.dpr,
      this.fxConfig.bloom.resolutionScale,
      this.fxConfig.bloom.diffusion,
    );
  }

  _prepareWebGLEffectBackend()
  {
    if (!BUILD_WEBGL)
    {
      return false;
    }

    const requested = normalizeEffectBackend(this.config.effectBackend);

    if (!CUSTOM_BUILD && requested === 'canvas2d')
    {
      this._setResolvedEffectBackend('canvas2d');
      return false;
    }

    const ready = this._ensureWebGLEffectRenderer() &&
      this._resizeWebGLEffectRenderer();

    if (!ready)
    {
      this._setResolvedEffectBackend('canvas2d');
    }
    else if (this.resolvedEffectBackend !== 'webgl2')
    {
      // 首个可见 Scene 提交成功前保持 pending；成功后不在每帧重复降级。
      this._setResolvedEffectBackend('pending');
    }

    return ready;
  }

  _setWebGLEffectVisible(visible)
  {
    if (!BUILD_WEBGL)
    {
      return false;
    }

    if (!this.webglEffectCanvas)
    {
      const changed = this.webglEffectVisible;

      this.webglEffectVisible = false;

      if (changed)
      {
        this._requestCompositingMountRefresh();
      }
      return;
    }

    if (this.webglEffectVisible === visible)
    {
      return;
    }

    this.webglEffectVisible = visible;
    if (this.webglEffectCanvas.style)
    {
      this.webglEffectCanvas.style.display = visible ? '' : 'none';
    }

    if (!visible)
    {
      this.webglEffectRenderer?.clear();
    }

    this._requestCompositingMountRefresh();
  }

  _destroyWebGLEffectRenderer()
  {
    if (!BUILD_WEBGL)
    {
      return false;
    }

    this.webglEffectCanvas?.removeEventListener?.(
      'webglcontextlost',
      this._onWebGLEffectContextLost,
    );
    this.webglEffectCanvas?.removeEventListener?.(
      'webglcontextrestored',
      this._onWebGLEffectContextRestored,
    );
    this.webglEffectRenderer?.destroy?.();
    if (this.ownsCanvas)
    {
      this.webglEffectCanvas?.remove?.();
    }
    this.webglEffectRenderer = null;
    this.webglEffectCanvas = null;
    this.webglEffectVisible = false;
  }

  _handleCanvasSceneContextLost()
  {
    if (!(BUILD_REFERENCE && BUILD_CANVAS)) return false;

    if (this.destroyed || !this.canvasSceneVisible)
    {
      return;
    }

    // 仅当前输出所有者可以切换图层；帧外事件同步重绘稳定 Canvas。
    this._setCanvasSceneVisible(false);

    if (this.paused || !this.renderingFrame)
    {
      this._restoreCanvasOutputAfterContextLoss(
        'native',
      );
    }

    this._requestRender();
  }

  _handleCanvasSceneContextRestored()
  {
    if (!(BUILD_REFERENCE && BUILD_CANVAS)) return false;

    if (this.destroyed)
    {
      return;
    }

    if (!this.canvasSceneRenderer?.available)
    {
      // Canvas Final Pass 与主 Scene 使用相同的懒重建约定，避免一次
      // Context 恢复分配失败永久关闭原生辉光的场景合成。
      this._destroyCanvasSceneRenderer();
      this.canvasSceneUnavailable = false;
    }

    if (
      !this._hasCompositingReference() ||
      !this._hasVisibleEffects()
    )
    {
      return;
    }

    const needsCanvasScene =
      this.resolvedEffectBackend === 'canvas2d' &&
      this.resolvedBloomBackend === 'native';

    if (needsCanvasScene)
    {
      // Renderer 先重建 Program；下一帧再按当前尺寸验证全部目标。
      this._requestRender();
    }
  }

  _ensureCanvasSceneRenderer()
  {
    if (!BUILD_REFERENCE || !BUILD_CANVAS)
    {
      return false;
    }

    if (this.canvasSceneRenderer)
    {
      return this.canvasSceneRenderer.available;
    }

    if (
      this.canvasSceneUnavailable ||
      (!CUSTOM_BUILD && !this.ownsCanvas) ||
      (this.ownsCanvas && !this.overlayParent)
    )
    {
      return false;
    }

    const canvas = createCanvas();

    if (this.ownsCanvas)
    {
    setOverlayStyle(
      canvas,
      !this.host && !this.config.isolatedCompositing,
      // Scene Final Pass 是常规输出层；必须低于对比层，避免延迟创建后以
      // 相同层级覆盖纯白隔离合成的淡青轮廓。
      '2147483646',
      '',
    );
    // 首个完整帧成功前保持旧 Canvas 可见，避免资源创建时闪烁。
    canvas.style.display = 'none';
    this.overlayParent.appendChild(canvas);

    }
    let renderer = null;

    try
    {
      renderer = new WebGL2CanvasSceneRenderer(canvas);

      if (!renderer.available)
      {
        this.canvasSceneUnavailable = true;
        renderer.destroy();
        canvas.remove?.();
        return false;
      }

      const compositingReference = this.compositingReferenceSource;

      if (compositingReference !== null)
      {
        const referenceReady = renderer.setCompositingReference(
          compositingReference,
          { fit: this.compositingReferenceFit },
        );

        if (!referenceReady)
        {
          this.canvasSceneUnavailable = true;
          renderer.destroy();
          canvas.remove?.();
          return false;
        }
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] Canvas Scene Final Pass 创建失败:', error);
      this.canvasSceneUnavailable = true;
      renderer?.destroy();
      canvas.remove?.();
      return false;
    }

    this.canvasSceneCanvas = canvas;
    this.canvasSceneRenderer = renderer;
    canvas.addEventListener?.(
      'webglcontextlost',
      this._onCanvasSceneContextLost,
    );
    canvas.addEventListener?.(
      'webglcontextrestored',
      this._onCanvasSceneContextRestored,
    );
    return true;
  }

  _resizeCanvasSceneRenderer()
  {
    if (!BUILD_REFERENCE)
    {
      return false;
    }

    return !!this.canvasSceneRenderer?.resize(
      this.width,
      this.height,
      this.dpr,
    );
  }

  _prepareCanvasSceneBackend(useGpuClickEffects, bloomBackend)
  {
    if (!BUILD_REFERENCE)
    {
      return false;
    }

    if (
      useGpuClickEffects ||
      bloomBackend !== 'native' ||
      !this._hasCompositingReference()
    )
    {
      return false;
    }

    return this._ensureCanvasSceneRenderer() &&
      this._resizeCanvasSceneRenderer() &&
      this.canvasSceneRenderer.hasSceneBackground;
  }

  _setCanvasSceneVisible(visible)
  {
    if (!BUILD_REFERENCE)
    {
      return false;
    }

    if (!this.canvasSceneCanvas)
    {
      const changed = this.canvasSceneVisible;

      this.canvasSceneVisible = false;

      if (changed)
      {
        this._requestCompositingMountRefresh();
      }
      return;
    }

    if (this.canvasSceneVisible === visible)
    {
      return;
    }

    this.canvasSceneVisible = visible;
    if (this.canvasSceneCanvas.style) this.canvasSceneCanvas.style.display = visible ? '' : 'none';

    if (!visible)
    {
      this.canvasSceneRenderer?.clear();
    }

    this._requestCompositingMountRefresh();
  }

  _destroyCanvasSceneRenderer()
  {
    if (!BUILD_REFERENCE)
    {
      return false;
    }

    this._releaseNativeClickBloomSurface();
    this.canvasSceneCanvas?.removeEventListener(
      'webglcontextlost',
      this._onCanvasSceneContextLost,
    );
    this.canvasSceneCanvas?.removeEventListener(
      'webglcontextrestored',
      this._onCanvasSceneContextRestored,
    );
    this.canvasSceneRenderer?.destroy();
    this.canvasSceneCanvas?.remove?.();
    this.canvasSceneRenderer = null;
    this.canvasSceneCanvas = null;
    this.canvasSceneVisible = false;
  }

  _destroyWebGLBloomRenderer()
  {
    if (!BUILD_WEBGL_BLOOM)
    {
      return false;
    }

    this.webglBloomCanvas?.removeEventListener(
      'webglcontextlost',
      this._onWebGLContextLost,
    );
    this.webglBloomCanvas?.removeEventListener(
      'webglcontextrestored',
      this._onWebGLContextRestored,
    );
    this.webglBloomRenderer?.destroy();
    this.webglBloomCanvas?.remove();
    this.webglBloomRenderer = null;
    this.webglBloomCanvas = null;
    this.webglBloomVisible = false;
  }

  _ensureWebGLBloomRenderer()
  {
    if (!BUILD_WEBGL_BLOOM)
    {
      return false;
    }

    if (this.webglBloomRenderer)
    {
      return this.webglBloomRenderer.available;
    }

    if (
      this.webglBloomUnavailable ||
      !this.ownsCanvas ||
      !this.overlayParent
    )
    {
      return false;
    }

    const canvas = createCanvas();

    // WebGL2 Bloom 复用完整 Scene Renderer，确保清晰层和 Bloom 只经过
    // 一次线性到 sRGB 的最终输出，不再交给浏览器拆成两个图层合成。
    setOverlayStyle(
      canvas,
      !this.host && !this.config.isolatedCompositing,
      '2147483646',
      '',
    );
    canvas.style.display = 'none';
    this.overlayParent.appendChild(canvas);

    let renderer = null;

    try
    {
      renderer = new WebGL2EffectRenderer(canvas);

      // Context 与 Program 初始化失败才是永久故障；当前尺寸分配失败仍可缩小恢复。
      if (!renderer.available)
      {
        this.webglBloomUnavailable = true;
        renderer.destroy();
        canvas.remove();
        return false;
      }

      const compositingReference = this.compositingReferenceSource;

      if (compositingReference !== null)
      {
        const referenceReady = renderer.setCompositingReference(
          compositingReference,
          { fit: this.compositingReferenceFit },
        );

        if (!referenceReady)
        {
          this.webglBloomUnavailable = true;
          renderer.destroy();
          canvas.remove();
          return false;
        }
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL2 Bloom 创建失败，回退软件 Bloom:', error);
      this.webglBloomUnavailable = true;
      renderer?.destroy();
      canvas.remove();
      return false;
    }

    this.webglBloomCanvas = canvas;
    this.webglBloomRenderer = renderer;
    canvas.addEventListener('webglcontextlost', this._onWebGLContextLost);
    canvas.addEventListener('webglcontextrestored', this._onWebGLContextRestored);
    return renderer.available;
  }

  _resizeWebGLBloomRenderer()
  {
    if (!BUILD_WEBGL_BLOOM)
    {
      return false;
    }

    const renderer = this.webglBloomRenderer;

    return !!renderer?.resize(
      this.width,
      this.height,
      this.dpr,
      this.fxConfig.bloom.resolutionScale,
      this.fxConfig.bloom.diffusion,
    );
  }

  _resolveBloomBackend()
  {
    if (CUSTOM_BUILD)
    {
      return this.config.bloomBackend;
    }
    const requested = normalizeBloomBackend(this.config.bloomBackend);

    if (requested === 'native')
    {
      return 'native';
    }

    if (requested === 'software')
    {
      return this.bloomRenderer.available ? 'software' : 'native';
    }

    if (
      this._ensureWebGLBloomRenderer() &&
      this._resizeWebGLBloomRenderer()
    )
    {
      return 'webgl2';
    }

    return 'native';
  }

  _resolveCanvasFallbackBloomBackend()
  {
    // Software 会分配全视口 Float32 金字塔并触发像素回读，只有调用方
    // 明确请求时才允许进入；GPU 自动/故障链统一回退低成本 Native。
    return normalizeBloomBackend(this.config.bloomBackend) === 'software' &&
      this.bloomRenderer?.available
      ? 'software'
      : 'native';
  }

  _setWebGLBloomVisible(visible)
  {
    if (!BUILD_WEBGL_BLOOM)
    {
      return false;
    }

    if (!this.webglBloomCanvas)
    {
      const changed = this.webglBloomVisible;

      this.webglBloomVisible = false;

      if (changed)
      {
        this._requestCompositingMountRefresh();
      }
      return;
    }

    const wasVisible = this.webglBloomVisible;

    if (!visible && wasVisible)
    {
      // 只有当前输出所有者退出时才能恢复 Canvas；隐藏后端丢失上下文
      // 不应干扰纯 WebGL2 或 Canvas Final Pass 的可见层。
      this._setCanvasOutputVisible(true);
    }

    if (this.webglBloomVisible === visible)
    {
      return;
    }

    this.webglBloomVisible = visible;
    this.webglBloomCanvas.style.display = visible ? '' : 'none';

    if (!visible)
    {
      this.webglBloomRenderer?.clear();
    }

    this._requestCompositingMountRefresh();
  }

  _setCanvasOutputVisible(visible)
  {
    if (!this.ownsCanvas)
    {
      return;
    }

    const visibility = visible ? '' : 'hidden';

    // 使用 visibility 保留 Canvas 尺寸和内容，WebGL 失败时无需重建回退帧。
    this.canvas.style.visibility = visibility;

    if (this.contrastCanvas)
    {
      const contrastEnabled =
        this.config.outputCompositing !== 'browser-overlay' &&
        this.config.lightBackgroundContrastAlpha > 0;

      // 普通场景继续跟随主 Canvas 的输出所有权；启用淡青轮廓后则由
      // 独立层保持可见，避免 GPU 或 Scene Final Pass 隐藏主层时一并消失。
      this.contrastCanvas.style.visibility =
        visible || contrastEnabled ? '' : 'hidden';
    }
  }

  _invalidateSceneBackgroundOutputs()
  {
    this._setWebGPUEffectVisible(false);
    this._setWebGLEffectVisible(false);
    this._setWebGLBloomVisible(false);
    this._setCanvasSceneVisible(false);
    this.webglEffectRenderer?.clear();
    this.webglBloomRenderer?.clear();
    this.canvasSceneRenderer?.clear();

    if (this.context)
    {
      this.context.save();
      this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.context.clearRect(0, 0, this.width, this.height);
      this.context.restore();
    }
    this._clearLightBackgroundContrast();
    // 暂停时不会申请 RAF；同步清空后再恢复 Canvas，避免旧背景残差常驻。
    this._setCanvasOutputVisible(true);
  }

  _releaseBackendFrameResources()
  {
    if (BUILD_TRAIL)
    {
      for (const stroke of this.trailStrokes) releaseTrailGradients(stroke.trailFrameData);
    }
    this._releaseSoftwareBloomFrame();
    // 配置事务已经选择了新的渲染链；先撤下所有旧输出，再释放仅与
    // 画布尺寸绑定的目标。下一帧只会为实际接管输出的后端重新分配。
    this._setWebGPUEffectVisible(false);
    this._setWebGLEffectVisible(false);
    this._setWebGLBloomVisible(false);
    this._setCanvasSceneVisible(false);
    this.webgpuEffectRenderer?.releaseFrameResources();
    this.webglEffectRenderer?.releaseFrameResources();
    this.webglBloomRenderer?.releaseFrameResources();
    this.canvasSceneRenderer?.releaseFrameResources();
    this._releaseNativeClickBloomSurface();
    this._setCanvasOutputVisible(true);
  }

  _releaseBloomBackendFrameResources()
  {
    if (BUILD_TRAIL)
    {
      for (const stroke of this.trailStrokes) releaseTrailGradients(stroke.trailFrameData);
    }
    this._releaseSoftwareBloomFrame();
    // 完整 GPU Scene 已接管时，Bloom 配置只是回退策略，不能
    // 为它释放当前 Effect 目标；这里只清理 Canvas 回退链的帧资源。
    this._setWebGLBloomVisible(false);
    this._setCanvasSceneVisible(false);
    this.webglBloomRenderer?.releaseFrameResources();
    this.canvasSceneRenderer?.releaseFrameResources();
    this._releaseNativeClickBloomSurface();

    if (!this.webglEffectVisible && !this.webgpuEffectVisible)
    {
      this._setCanvasOutputVisible(true);
    }
  }

  _usesSoftwareBloom()
  {
    return this._resolveBloomBackend() === 'software';
  }

  _releaseNativeClickBloomSurface()
  {
    if (this.nativeClickBloomSurface)
    {
      this.nativeClickBloomSurface.canvas.width = 0;
      this.nativeClickBloomSurface.canvas.height = 0;
      this.nativeClickBloomSurface = null;
    }
  }

  _getBloomRenderer(index)
  {
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

    while (this.bloomRenderers.length <= index)
    {
      this.bloomRenderers.push(
        new SoftwareBloomRenderer(() => createCanvas()),
      );
    }

    return this.bloomRenderers[index];
  }

  _trimBloomRendererPool(activeCount, reserve = 2)
  {
    if (!BUILD_SOFTWARE)
    {
      return false;
    }

    const retainedCount = activeCount === 0
      ? 1
      : Math.max(1, activeCount + reserve);

    if (this.bloomRenderers.length <= retainedCount)
    {
      return;
    }

    const removed = this.bloomRenderers.splice(retainedCount);
    if (BUILD_TRAIL)
    {
      for (const stroke of this.trailStrokes) releaseTrailGradients(stroke.trailFrameData);
    }

    for (const renderer of removed)
    {
      renderer.destroy();
    }
  }
}
