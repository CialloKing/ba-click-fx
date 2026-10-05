// 内部职责边界；完整版与定制构建使用这些同一份方法。
import { LifecycleRuntime } from './engine-lifecycle.js';
import { clamp01 } from './engine-shared.js';
import {
  DEFAULT_THEME_COLOR_MODE,
  FX_PARAM_SCHEMA_VERSION,
  UNITY_FX_TOUCH,
  assertConfigOverrides,
  isBloomBackend,
  isEffectBackend,
  isHostCompositing,
  isHostCompositingSurface,
  isInputSamplingRate,
  isInputSource,
  isOutputCompositing,
  isOverlayAlphaPolicy,
  isOverlayColorCompensation,
  isThemeColorMode,
  isTimeScale,
  normalizeOverlayAlphaLimit,
  normalizeOverlayAlphaPolicyConfig,
  normalizeOverlayColorCompensationConfig,
  normalizeThemeColorMode,
  normalizeWebGPUHdrPresentation,
} from './config.js';
import { createRelativeOklchTheme } from './theme-color.js';
import { applyFxParamPatch as prepareFxParamPatch } from './fx-param-patch.js';

export class ConfigRuntime extends LifecycleRuntime
{

  _createFxParamResetBaseline()
  {
    return structuredClone(UNITY_FX_TOUCH);
  }

  _commitFxParamConfig(nextConfig)
  {
    this._invalidateCanvasBoundsScope();
    // 活动 ClickWave 持有配置根对象引用；保留根身份才能让运行时调参
    // 同时作用于已经生成的点击，而候选树仍保证校验阶段不泄露半成品。
    for (const key of Object.keys(this.fxConfig))
    {
      delete this.fxConfig[key];
    }

    Object.assign(this.fxConfig, nextConfig);
    this._gradientEnergyCache = new WeakMap();
    this._fxConfigVersion++;
    this._softwareBloomConfigSignature = null;
  }

  /**
   * 设置主题色；具体映射由 themeColorMode 决定。
   * 传入空字符串或无效值可恢复默认蓝色。
   * @param {string} hex — CSS 十六进制颜色，如 "#ff6969"
   */
  setThemeColor(hex)
  {
    if (this.destroyed)
    {
      return;
    }

    this._applyThemeColor(hex);
    this._requestRender();
  }

  /** 切换主题颜色映射；合法值即视为已接受，包括与当前模式相同。 */
  setThemeColorMode(mode)
  {
    if (this.destroyed || !isThemeColorMode(mode))
    {
      return false;
    }

    this.config.themeColorMode = mode;
    this._gradientEnergyCache = new WeakMap();
    this._themeVersion++;
    this._relativeOklchTheme = mode === 'relative-oklch'
      ? createRelativeOklchTheme(this.config.themeColor)
      : null;
    this._requestRender();
    return true;
  }

  /** 设置移动输入采样率上限；0 表示保留全部输入样本。 */
  setInputSamplingRate(rateHz)
  {
    if (this.destroyed || !isInputSamplingRate(rateHz))
    {
      return false;
    }

    this.updateConfig({ inputSamplingRate: rateHz });
    return true;
  }

  /**
   * 运行时更新部分配置，无需销毁重建实例。
   * target 与 inputFilter 只在构造时生效；直接 OffscreenCanvas 的 context
   * 类型也在构造时固定，不兼容的后端与渲染模式切换会明确失败。
   * @param {object} overrides
   * @returns {object}
   */
  updateConfig(overrides = {})
  {
    if (this.destroyed)
    {
      throw new Error('BAClickFX 实例已销毁');
    }

    assertConfigOverrides(overrides, { fallback: this.config });

    const previousEffectBackend = this.config.effectBackend;
    const previousWebGPUPreferHdr = this.config.webgpuPreferHdr;
    const previousBloomBackend = this.config.bloomBackend;
    const previousOutputCompositing = this.config.outputCompositing;
    const previousHostCompositing = this.config.hostCompositing;
    const previousHostCompositingSurface =
      this.config.hostCompositingSurface;
    const nextEffectBackend = isEffectBackend(overrides.effectBackend)
      ? overrides.effectBackend
      : this.config.effectBackend;
    const nextOffscreenContextType =
      nextEffectBackend === 'canvas2d'
        ? '2d'
        : 'webgl2';
    const canChangeOffscreenRoute =
      this._directOffscreenContextType === null ||
      this._directOffscreenContextType === nextOffscreenContextType;

    if (
      !canChangeOffscreenRoute &&
      overrides.effectBackend !== undefined
    )
    {
      throw new Error(
        'BAClickFX 无法切换 OffscreenCanvas context 类型；请销毁实例并使用新的画布',
      );
    }

    let transparentContractChanged = false;

    if (
      isInputSource(overrides.inputSource) &&
      overrides.inputSource !== this.config.inputSource
    )
    {
      // 输入所有权切换时先结束旧来源的逻辑指针，避免宿主接手半条轨迹。
      this._cancelPointer();
      this.config.inputSource = overrides.inputSource;

      if (overrides.inputSource === 'dom')
      {
        this._attachDomPointerListeners();
      }
      else
      {
        this._detachDomPointerListeners();
      }
    }

    if (
      isInputSamplingRate(overrides.inputSamplingRate) &&
      overrides.inputSamplingRate !== this.config.inputSamplingRate
    )
    {
      this.config.inputSamplingRate = overrides.inputSamplingRate;
      // 新设置从下一次匹配 move 立即建立相位，不跨两种采样率继承旧锚点。
      this.lastInputSampleSourceTime = null;
    }

    if (isTimeScale(overrides.clickTimeScale))
    {
      // 倍率只作用于配置变更后的时间，不能追溯重算上一帧后的区间。
      this._advanceClickTime();
      this.config.clickTimeScale = overrides.clickTimeScale;
    }

    if (isTimeScale(overrides.trailTimeScale))
    {
      // 先用旧倍率结算到配置变更时刻，避免把此前的空闲时间追溯套用新倍率。
      this._advanceTrailTime();
      this.config.trailTimeScale = overrides.trailTimeScale;
    }

    if (Number.isFinite(overrides.scale))
    {
      this.config.scale = Math.max(0.01, overrides.scale);
    }

    if (Number.isFinite(overrides.opacity))
    {
      this.config.opacity = clamp01(overrides.opacity);
    }

    if (isThemeColorMode(overrides.themeColorMode))
    {
      this.config.themeColorMode = normalizeThemeColorMode(
        overrides.themeColorMode,
        DEFAULT_THEME_COLOR_MODE,
      );
    }

    if (
      overrides.themeColor !== undefined ||
      isThemeColorMode(overrides.themeColorMode)
    )
    {
      this._applyThemeColor(
        overrides.themeColor === undefined
          ? this.config.themeColor
          : overrides.themeColor,
      );
    }

    if (isOutputCompositing(overrides.outputCompositing))
    {
      transparentContractChanged = transparentContractChanged ||
        overrides.outputCompositing !== this.config.outputCompositing;
      this.config.outputCompositing = overrides.outputCompositing;
    }

    if (isOverlayAlphaPolicy(overrides.overlayAlphaPolicy))
    {
      const overlayAlphaPolicy = normalizeOverlayAlphaPolicyConfig(
        overrides.overlayAlphaPolicy,
        this.config.overlayAlphaPolicy,
      );

      transparentContractChanged = transparentContractChanged ||
        overlayAlphaPolicy !== this.config.overlayAlphaPolicy;
      this.config.overlayAlphaPolicy = overlayAlphaPolicy;
    }

    if (isOverlayColorCompensation(overrides.overlayColorCompensation))
    {
      const overlayColorCompensation =
        normalizeOverlayColorCompensationConfig(
          overrides.overlayColorCompensation,
          this.config.overlayColorCompensation,
        );

      transparentContractChanged = transparentContractChanged ||
        overlayColorCompensation !== this.config.overlayColorCompensation;
      this.config.overlayColorCompensation = overlayColorCompensation;
    }

    if (Number.isFinite(overrides.overlayAlphaLimit))
    {
      const overlayAlphaLimit = normalizeOverlayAlphaLimit(
        overrides.overlayAlphaLimit,
        this.config.overlayAlphaLimit,
      );

      transparentContractChanged = transparentContractChanged ||
        overlayAlphaLimit !== this.config.overlayAlphaLimit;
      this.config.overlayAlphaLimit = overlayAlphaLimit;
    }

    if (isHostCompositing(overrides.hostCompositing))
    {
      transparentContractChanged = transparentContractChanged ||
        overrides.hostCompositing !== this.config.hostCompositing;
      this.config.hostCompositing = overrides.hostCompositing;
    }

    if (isHostCompositingSurface(overrides.hostCompositingSurface))
    {
      transparentContractChanged = transparentContractChanged ||
        overrides.hostCompositingSurface !==
          this.config.hostCompositingSurface;
      this.config.hostCompositingSurface = overrides.hostCompositingSurface;
    }

    if (typeof overrides.clickEnabled === 'boolean')
    {
      this.config.clickEnabled = overrides.clickEnabled;
    }

    if (typeof overrides.trailEnabled === 'boolean')
    {
      this.config.trailEnabled = overrides.trailEnabled;

      if (!overrides.trailEnabled)
      {
        if (this.activePointerSource === 'hover')
        {
          this._releaseActivePointer();
        }

        this.clearTrail();
      }
    }

    if (typeof overrides.trailAlways === 'boolean')
    {
      if (!overrides.trailAlways && this.activePointerSource === 'hover')
      {
        this._releaseActivePointer();
      }

      this.config.trailAlways = overrides.trailAlways;
    }

    if (isEffectBackend(overrides.effectBackend) && canChangeOffscreenRoute)
    {
      this.config.effectBackend = overrides.effectBackend;
    }

    if (typeof overrides.webgpuPreferHdr === 'boolean')
    {
      this.config.webgpuPreferHdr = overrides.webgpuPreferHdr;
    }

    if (
      overrides.webgpuHdrPeak !== undefined ||
      overrides.webgpuHdrBrightness !== undefined ||
      overrides.webgpuHdrColorPreservation !== undefined ||
      overrides.webgpuHdrWhiteCore !== undefined ||
      overrides.webgpuHdrWhiteStart !== undefined ||
      overrides.webgpuHdrWhiteEnd !== undefined
    )
    {
      Object.assign(
        this.config,
        normalizeWebGPUHdrPresentation(overrides, this.config),
      );
    }

    if (isBloomBackend(overrides.bloomBackend))
    {
      this.config.bloomBackend = overrides.bloomBackend;
    }

    const webgpuPresentationChanged =
      previousWebGPUPreferHdr !== this.config.webgpuPreferHdr &&
      (
        previousEffectBackend === 'webgpu' ||
        previousEffectBackend === 'auto' ||
        this.config.effectBackend === 'webgpu' ||
        this.config.effectBackend === 'auto'
      );
    const effectRouteChanged =
      previousEffectBackend !== this.config.effectBackend ||
      webgpuPresentationChanged;
    const bloomRouteChanged =
      previousBloomBackend !== this.config.bloomBackend;

    if (effectRouteChanged)
    {
      if (webgpuPresentationChanged)
      {
        this.webgpuEffectRenderer?.setPreferHdr(this.config.webgpuPreferHdr);
      }

      if (
        previousEffectBackend !== this.config.effectBackend &&
        (this.config.effectBackend === 'webgpu' ||
          this.config.effectBackend === 'auto') &&
        (
          this.webgpuEffectRenderer?.status === 'lost' ||
          this.webgpuEffectRenderer?.status === 'unavailable'
        )
      )
      {
        // Device 丢失不可恢复；重新选择 WebGPU 时允许申请全新设备。
        this._destroyWebGPUEffectRenderer();
        this.webgpuEffectUnavailable = false;
      }

      this._releaseBackendFrameResources();
      this._setResolvedEffectBackend(this._getRequestedEffectBackendState());
      this._setResolvedBloomBackend(this._getRequestedBloomBackendState());
    }
    else if (
      bloomRouteChanged &&
      this.resolvedEffectBackend !== 'webgl2' &&
      this.resolvedEffectBackend !== 'webgpu'
    )
    {
      this._releaseBloomBackendFrameResources();
      this._setResolvedBloomBackend(this._getRequestedBloomBackendState());
    }

    if (Number.isFinite(overrides.lightBackgroundContrastAlpha))
    {
      this.config.lightBackgroundContrastAlpha = clamp01(
        overrides.lightBackgroundContrastAlpha,
      );
    }

    if (typeof overrides.isolatedCompositing === 'boolean')
    {
      const isolated = this.ownsCanvas ? overrides.isolatedCompositing : false;

      if (isolated !== this.config.isolatedCompositing)
      {
        this.config.isolatedCompositing = isolated;
      }
    }

    if (
      previousOutputCompositing !== this.config.outputCompositing ||
      previousHostCompositing !== this.config.hostCompositing ||
      previousHostCompositingSurface !== this.config.hostCompositingSurface
    )
    {
      this._requestCompositingMountRefresh();
    }
    else if (typeof overrides.isolatedCompositing === 'boolean')
    {
      // 隔离开关只改变图层分组和定位，不改变当前 Canvas 像素合同。
      this._applyCompositingMount();
    }

    if (transparentContractChanged)
    {
      // 故障回退快照携带最终 Alpha/颜色合同，切换后不得复用旧模式像素。
      this._releaseSoftwareBloomFrame();
    }

    if (Number.isFinite(overrides.maxDpr))
    {
      this.config.maxDpr = Math.max(1, overrides.maxDpr);
      this._resize();
    }

    if (overrides.touchAction !== undefined)
    {
      this.config.touchAction = overrides.touchAction;
      if (this.canvas.style)
      {
        this.canvas.style.touchAction = overrides.touchAction;
      }
      this._syncTouchActionListeners();
    }

    this._requestRender();
    return this.getConfig();
  }

  setFxParams(patch, options = {})
  {
    if (this.destroyed)
    {
      return {
        applied: [],
        normalized: [],
        rejected:
        [
          {
            path: '$instance',
            value: null,
            reason: 'destroyed',
          },
        ],
        committed: false,
        schemaVersion: FX_PARAM_SCHEMA_VERSION,
      };
    }

    const prepared = prepareFxParamPatch(
      patch,
      {
        baseline: this.fxConfig,
        reset: options.reset === true,
        resetBaseline: this._createFxParamResetBaseline(),
        strict: options.strict === true,
        schemaVersion: options.schemaVersion ?? FX_PARAM_SCHEMA_VERSION,
      },
    );
    const { nextConfig, ...result } = prepared;

    if (result.committed)
    {
      // 候选树已经完整验证；同步提交期间不会执行渲染或宿主回调。
      this._commitFxParamConfig(nextConfig);
      this._requestRender();
    }

    return result;
  }

  /**
   * 设置单个特效参数。返回 false 时配置保持不变。
   * @param {string} path — 参数路径
   * @param {number|boolean} value — 新值
   */
  setFxParam(path, value)
  {
    const result = this.setFxParams(
      { [path]: value },
      { strict: true },
    );

    return result.committed && result.applied.length === 1;
  }

  /** 设置全部点击与拖尾三角碎片的圆角比例，0 为原形，1 为圆形。 */
  setTriangleRoundness(roundness)
  {
    return this.setFxParam('shards.roundness', roundness);
  }

  /** @returns {object} 当前完整特效配置的深拷贝 */
  getFxConfig()
  {
    return structuredClone(this.fxConfig);
  }

  /** 重置所有特效参数为游戏默认值 */
  resetFxConfig()
  {
    this.setFxParams(
      {},
      {
        reset: true,
        strict: true,
      },
    );
  }
}
