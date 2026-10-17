// 内部职责层不增加构造函数，初始化顺序由公开入口统一维护。
import {
  beginCanvasTextureFrame,
  enterCanvasTextureFrame,
  endCanvasTextureFrame,
  flushCanvasTextureRelease,
  canvasTextureOwners,
  scheduleCanvasTextureRelease,
  releaseCanvasTextureCache,
} from './engine-canvas-textures.js';
import {
  setRenderState, themeHueShift, relativeOklchTheme, gradientEnergyCache, ringSampleCache,
} from './engine-render-state.js';
import {
  TAU, mergeBloomRegion, combineBloomRegionBounds, evaluateUnityHermiteCurve,
} from './engine-math.js';
import {
  clamp, clamp01, createCanvas,
} from './engine-shared.js';
import {
  isIndependentHostCompositing, normalizeEffectBackend,
} from './config.js';
import {
  getTrailRenderPoints,
} from './trail-lifetime.js';
import {
  linearToSrgb, resolveUnityBloomIntensity,
} from './bloom-color-space.js';
import {
  limitCanvasAlpha,
} from './bloom-math.js';
import {
  applyOverlayColorCompensationToImageData, applyOverlayAlphaPolicyToImageData,
} from './overlay-compositing.js';
import {
  addNativeBloomSample, createNativeBloomProfile, createNativeBloomSource,
} from './native-bloom.js';
import {
  CUSTOM_BUILD,
  BUILD_DOM,
  BUILD_WEBGPU,
  BUILD_WEBGL_BLOOM,
  BUILD_SOFTWARE,
  BUILD_NATIVE,
  BUILD_CANVAS,
  BUILD_CLICK,
  BUILD_TRAIL,
  BUILD_SHARDS,
  BUILD_BLOOM,
  BUILD_REFERENCE,
} from './build-capabilities.js';
import {
  colorToCss,
  evaluateSrgbGradientEnergy,
  linearEnergyToAdditiveCss,
  linearEnergyToHostAdditiveCss,
  linearEnergyToOverlayCss,
} from './engine-materials.js';
import {
  NATIVE_BLOOM_DISK_SAMPLES,
  getNativeCircleBloomSamples,
  evaluateRingLuminance,
  resolveRingIntegrationSamples,
  resolveRingGeometry,
} from './engine-canvas-primitives.js';
import {
  drawTrail, drawTrailCoverage, drawTrailEmission, appendTrailWebGLScene,
} from './engine-trail.js';
import {
  EffectRuntime,
} from './engine-effects.js';

const LIGHT_BACKGROUND_CONTRAST_COLOR = [76, 255, 255];

export class RenderRuntime extends EffectRuntime
{

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
