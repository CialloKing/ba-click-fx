// 内部职责边界；完整版与定制构建使用这些同一份方法。
import { BackendRuntime } from './engine-backends.js';
import { cancelRenderFrame, resolvePositiveFinite } from './engine-shared.js';
import { CUSTOM_BUILD } from './build-capabilities.js';

export class LifecycleRuntime extends BackendRuntime
{

  resize(width, height, dpr)
  {
    this._invalidateCanvasBoundsScope();
    this._resize(width, height, dpr);
  }

  _resize(overrideWidth, overrideHeight, overrideDpr)
  {
    this._invalidateCanvasBoundsScope();
    if (this.destroyed)
    {
      return;
    }

    const rect = this._getCanvasRect();
    const defaultWidth = typeof window !== 'undefined' ? window.innerWidth : this.canvas?.width;
    const defaultHeight = typeof window !== 'undefined' ? window.innerHeight : this.canvas?.height;
    const defaultDpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
    const measuredWidth = resolvePositiveFinite(rect.width, resolvePositiveFinite(defaultWidth, 1));
    const measuredHeight = resolvePositiveFinite(rect.height, resolvePositiveFinite(defaultHeight, 1));
    const width = resolvePositiveFinite(overrideWidth, measuredWidth);
    const height = resolvePositiveFinite(overrideHeight, measuredHeight);
    const dpr = Math.min(
      resolvePositiveFinite(overrideDpr, resolvePositiveFinite(defaultDpr, 1)),
      this.config.maxDpr,
    );
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    const layers = [
      [this.canvas, this.context],
      [this.contrastCanvas, this.contrastContext],
    ];

    if (
      this.width === width && this.height === height && this.dpr === dpr &&
      layers.every(([canvas]) => !canvas ||
        (canvas.width === pixelWidth && canvas.height === pixelHeight))
    )
    {
      return;
    }

    this._releaseSoftwareBloomFrame();
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    for (const [canvas, context] of layers)
    {
      if (!canvas)
      {
        continue;
      }
      // 即使赋入相同值也会清空 Canvas；暂停时没有下一帧可以恢复像素。
      if (canvas.width !== pixelWidth)
      {
        canvas.width = pixelWidth;
      }
      if (canvas.height !== pixelHeight)
      {
        canvas.height = pixelHeight;
      }
      // DPR 改变后物理尺寸可能仍相同，坐标变换必须独立更新。
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // WebGL RenderTarget 可能很大，只在真正进入 WebGL 渲染帧时调整，
    // 避免 Software 或 Native 模式因窗口 resize 触发无用 GPU 分配。
    this._requestRender();
  }

  /** 暂停或恢复输入与动画调度；clear 仅在进入暂停时生效。 */
  setPaused(paused, options = {})
  {
    this._invalidateCanvasBoundsScope();
    if (this.destroyed)
    {
      return;
    }

    const nextPaused = paused === true;
    if (CUSTOM_BUILD && this.buildFailed && !nextPaused)
    {
      return;
    }

    if (nextPaused)
    {
      if (!this.paused)
      {
        const pauseTime = performance.now();

        // 先结算进入暂停前的有效时间，随后冻结两个虚拟时钟。
        this._advanceClickTime(pauseTime);
        this._advanceTrailTime(pauseTime);
        this.paused = true;

        // 暂停不能保留可继续追加的宿主指针，否则恢复后会连接跨环境轨迹。
        this.touchGestureStarts.clear();
        this.touchPointerFilterResults.length = 0;
        this.closedShadowPointerDecisions = new WeakMap();
        if (this.activePointerId !== null)
        {
          this._releaseActivePointer();
        }

        if (this.animationFrame !== null)
        {
          cancelRenderFrame(this.animationFrame);
          this.animationFrame = null;
        }

        // 点击与拖尾各自使用虚拟时钟；两者都会从恢复时重新计时。
        this.lastFrameTime = null;
        this.lastClickTimeSource = null;
        this.lastTrailTimeSource = null;
      }

      if (options?.clear === true)
      {
        this.clear();
      }

      return;
    }

    if (!this.paused)
    {
      return;
    }

    const resumeTime = performance.now();

    this.paused = false;
    this.lastFrameTime = null;
    this.lastClickTimeSource = resumeTime;
    this.lastTrailTimeSource = resumeTime;

    if (this._hasVisibleEffects())
    {
      this._requestRender();
    }
    else
    {
      this._flushCompositingMountRefresh();
    }
  }

  /** 清除拖尾顶点和拖拽产生的碎片，不影响仍在播放的点击。 */
  clearTrail()
  {
    this._invalidateCanvasBoundsScope();
    this._clearTrailStrokes();
    this.currentTrailStroke = null;
    this.shards = this.shards.filter((shard) => shard.kind !== 'trail');
    this.trailShardCounts.clear();
    // 清轨迹后下一次合法 move 必须能立即重建，不能被旧采样相位挡住。
    this.lastInputSampleSourceTime = null;

    if (this.activeTrailOwnerId !== null)
    {
      this.trailShardCounts.set(this.activeTrailOwnerId, 0);
    }

    // 不在此处 clearRect；_requestRender 下一帧会完整重绘，不影响点击特效
    this._requestRender();
  }

  /** 立即清除所有视觉对象。 */
  clear()
  {
    this._invalidateCanvasBoundsScope();
    this._releaseSoftwareBloomFrame();
    this.waves.length = 0;
    this.shards.length = 0;
    this._clearTrailStrokes();
    this.currentTrailStroke = null;
    this.trailShardCounts.clear();
    this.lastInputSampleSourceTime = null;
    this._trimBloomRendererPool(0, 0);
    // 直接 WebGL2 OffscreenCanvas 不创建 2D context，由对应 Renderer 清屏。
    this.context?.clearRect(0, 0, this.width, this.height);
    this.contrastContext?.clearRect(0, 0, this.width, this.height);
    this.webglBloomRenderer?.clear();
    this.webgpuEffectRenderer?.clear();
    this.webglEffectRenderer?.clear();
    this.canvasSceneRenderer?.clear();
    this._flushCompositingMountRefresh();
  }

  destroy()
  {
    this._invalidateCanvasBoundsScope();
    if (this.destroyed)
    {
      return;
    }

    this.destroyed = true;
    this._gradientEnergyCache = null;
    this._softwareBloomConfigSignature = null;
    if (typeof window !== 'undefined')
    {
      window.removeEventListener('resize', this._onResize);
    }
    this._detachDomPointerListeners();
    if (typeof window !== 'undefined')
    {
      window.removeEventListener('blur', this._onBlur);
    }
    this.resizeObserver?.disconnect();

    if (this.animationFrame !== null)
    {
      cancelRenderFrame(this.animationFrame);
      this.animationFrame = null;
    }

    this.clear();
    for (const renderer of this.bloomRenderers)
    {
      renderer.destroy();
    }

    this._destroyWebGLBloomRenderer();
    this._destroyWebGPUEffectRenderer();
    this._destroyWebGLEffectRenderer();
    this._destroyCanvasSceneRenderer();

    if (this.nativeTrailBloomSurface)
    {
      this.nativeTrailBloomSurface.canvas.width = 0;
      this.nativeTrailBloomSurface.canvas.height = 0;
      this.nativeTrailBloomSurface = null;
    }

    if (this.canvasBloomTransportCanvas)
    {
      this.canvasBloomTransportCanvas.width = 0;
      this.canvasBloomTransportCanvas.height = 0;
      this.canvasBloomTransportCanvas = null;
      this.canvasBloomTransportContext = null;
    }

    this.canvasNativeSceneAlphaSnapshot = null;

    if (this.ownsCanvas)
    {
      this.webglBloomCanvas?.remove();
      this.contrastCanvas?.remove();
      this.canvas.remove();
      this.overlayRoot?.remove();
      this.canvas.width = 0;
      this.canvas.height = 0;
      if (this.contrastCanvas)
      {
        this.contrastCanvas.width = 0;
        this.contrastCanvas.height = 0;
      }
    }

    this.webglBloomCanvas = null;
    this.webglBloomVisible = false;
    this.canvasSceneCanvas = null;
    this.canvasSceneVisible = false;
    this.compositingReferenceSource = null;
    this.overlayParent = null;
    this.overlayMountParent = null;
    this.overlayRoot = null;
  }

  _reportBuildError(code, cause = null)
  {
    if (!CUSTOM_BUILD || this.destroyed || this.buildFailed)
    {
      return;
    }
    this.buildFailed = true;
    this.resolvedEffectBackend = 'unavailable';
    this.resolvedBloomBackend = 'unavailable';
    this.setPaused(true, { clear: true });
    this._setWebGPUEffectVisible(false);
    this._setWebGLEffectVisible(false);
    this._setCanvasSceneVisible(false);
    this._setCanvasOutputVisible(false);
    const error = new Error(`BAClickFX 定制版 ${code}`, { cause });
    error.code = code;
    // 通知前完成停止，允许宿主在回调中同步销毁实例。
    this.onError?.(error);
  }
}
