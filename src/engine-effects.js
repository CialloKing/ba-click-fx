// 内部职责层不增加构造函数，初始化顺序由公开入口统一维护。
import {
  themeHueShift, relativeOklchTheme,
} from './engine-render-state.js';
import {
  TAU, random,
} from './engine-math.js';
import {
  distance, invalidateTrailPoints, lerp, releaseTrailGradients,
} from './engine-shared.js';
import {
  getTrailRenderPoints, updateTrailRenderPoints,
} from './trail-lifetime.js';
import {
  BUILD_CANVAS, BUILD_CLICK, BUILD_TRAIL, BUILD_SHARDS,
} from './build-capabilities.js';
import {
  ClickWave, createShard,
} from './engine-particles.js';
import {
  hasVisibleTrailPoints, createTrailFrameData,
} from './engine-trail.js';
import {
  ConfigRuntime,
} from './engine-config.js';

export class EffectRuntime extends ConfigRuntime
{

  _spawnTrailShards(from, to, scale, fromTime, toTime)
  {
    if (!BUILD_TRAIL)
    {
      return false;
    }

    if (!BUILD_SHARDS)
    {
      return;
    }
    const segmentLength = distance(from, to);
    const spacing = Math.max(1, this.fxConfig.shards.trailSpacing * scale);
    let nextDistance = spacing - this.trailDistanceSinceShard;
    const ownerId = this.currentTrailStroke?.ownerId ??
      this.activeTrailOwnerId;
    let ownerShardCount = Number.isFinite(ownerId)
      ? this.trailShardCounts.get(ownerId) ?? 0
      : 0;

    while (
      Number.isFinite(ownerId) &&
      nextDistance <= segmentLength &&
      ownerShardCount < this.fxConfig.shards.maxCount
    )
    {
      const progress = segmentLength > 0 ? nextDistance / segmentLength : 0;
      const x = lerp(from.x, to.x, progress);
      const y = lerp(from.y, to.y, progress);
      const angle = random(0, TAU);

      this.shards.push(createShard(
        x,
        y,
        angle,
        'trail',
        scale,
        this.fxConfig.shards,
        lerp(fromTime, toTime, progress),
        ownerId,
      ));
      ownerShardCount++;
      this.trailShardCounts.set(ownerId, ownerShardCount);

      nextDistance += spacing;
    }

    this.trailDistanceSinceShard = (this.trailDistanceSinceShard + segmentLength) % spacing;
  }

  _spawnClick(x, y)
  {
    if (!BUILD_CLICK)
    {
      return false;
    }

    const scale = this._getScale();
    const clickTimeMs = this._getClickInputTime();

    this.waves.push(new ClickWave(x, y, this.fxConfig, clickTimeMs));

    for (let index = 0; BUILD_SHARDS && index < this.fxConfig.shards.clickCount; index++)
    {
      this.shards.push(createShard(
        x,
        y,
        random(0, TAU),
        'click',
        scale,
        this.fxConfig.shards,
        clickTimeMs,
      ));
    }
  }

  _getTrailFrameData(stroke, materialIntensity)
  {
    if (!BUILD_TRAIL)
    {
      return false;
    }

    const cached = stroke.trailFrameCache;
    const valid = cached && cached.points === getTrailRenderPoints(stroke) &&
      cached.pointsVersion === stroke.pointsVersion &&
      cached.configVersion === this._fxConfigVersion &&
      cached.themeVersion === this._themeVersion &&
      cached.hueShift === themeHueShift && cached.relativeTheme === relativeOklchTheme;
    let data = valid ? stroke.trailFrameData : null;
    if (!data)
    {
      releaseTrailGradients(stroke.trailFrameData);
      data = createTrailFrameData(getTrailRenderPoints(stroke), this.fxConfig.trail, materialIntensity, true, null, stroke.trailWork);
      stroke.trailWork = data;
      const nextCache = data.frameCache ??= {};
      nextCache.points = getTrailRenderPoints(stroke);
      nextCache.pointsVersion = stroke.pointsVersion;
      nextCache.configVersion = this._fxConfigVersion;
      nextCache.themeVersion = this._themeVersion;
      // 同步后端事件可能改主题，记录实际渲染上下文而非只依赖实例版本。
      nextCache.hueShift = themeHueShift;
      nextCache.relativeTheme = relativeOklchTheme;
      nextCache.materialIntensity = materialIntensity;
      stroke.trailFrameCache = nextCache;
    }
    else if (materialIntensity !== null &&
      (cached.materialIntensity !== materialIntensity || !data.materialReady))
    {
      // 几何缓存可跨后端复用，材质只在 Canvas 路径确实需要时补齐。
      data = createTrailFrameData(getTrailRenderPoints(stroke), this.fxConfig.trail, materialIntensity, true, data);
      cached.materialIntensity = materialIntensity;
    }
    stroke.trailFrameData = data;
    return data;
  }

  _clearTrailStrokes()
  {
    if (!BUILD_TRAIL)
    {
      return false;
    }

    if (BUILD_TRAIL)
    {
      for (const stroke of this.trailStrokes)
      {
        invalidateTrailPoints(stroke);
        stroke.trailWork = null;
      }
    }
    this.trailStrokes.length = 0;
  }

  _updateTrail(
    trailTimeMs,
    scale,
    useNativeBloom,
    drawCanvas = true,
    useTexturedWebGL = false,
  )
  {
    if (!BUILD_TRAIL)
    {
      return false;
    }

    const lifetime = this.fxConfig.trail.lifetimeMs;

    for (let strokeIndex = this.trailStrokes.length - 1; strokeIndex >= 0; strokeIndex--)
    {
      const stroke = this.trailStrokes[strokeIndex];
      if (updateTrailRenderPoints(stroke, trailTimeMs, lifetime))
      {
        // 即使没有输入，过期边界仍会移动；几何和渐变缓存必须一起失效。
        invalidateTrailPoints(stroke);
        stroke.renderPointCache.version = stroke.pointsVersion;
      }
      if (getTrailRenderPoints(stroke).length >= 2)
      {
        const materialIntensity = useTexturedWebGL ? null : this.fxConfig.bloom.trailEmission;
        this._getTrailFrameData(stroke, materialIntensity);
      }
      else
      {
        releaseTrailGradients(stroke.trailFrameData);
        stroke.trailFrameData = null;
        stroke.trailFrameCache = null;
        stroke.trailWork = null;
      }
      if (!stroke.active && getTrailRenderPoints(stroke).length < 2)
      {
        this.trailStrokes.splice(strokeIndex, 1);
      }
    }
    if (BUILD_CANVAS && drawCanvas)
    {
      this._drawCanvasTrails(scale, useNativeBloom);
    }
  }

  _updateWaves(
    clickTimeMs,
    scale,
    useNativeBloom,
    drawCanvas = true,
  )
  {
    if (!BUILD_CLICK)
    {
      return false;
    }

    for (let index = this.waves.length - 1; index >= 0; index--)
    {
      const wave = this.waves[index];

      wave.updateTo(clickTimeMs);

      if (wave.dead)
      {
        this.waves.splice(index, 1);
        continue;
      }

      if (BUILD_CANVAS && drawCanvas)
      {
        const outputCompositing = this._getCanvasOutputCompositing();

        wave.drawBase(
          this.context,
          scale,
          this._getEffectiveOpacity(),
          useNativeBloom,
          outputCompositing,
          this.dpr,
          'none',
          this._getEffectiveOverlayAlphaLimit(),
        );
      }
    }
  }

  _updateShards(clickTimeMs, trailTimeMs, scale, drawCanvas = true)
  {
    if (!BUILD_SHARDS)
    {
      return false;
    }

    for (let index = this.shards.length - 1; index >= 0; index--)
    {
      const shard = this.shards[index];

      if (shard.kind === 'trail')
      {
        shard.updateTo(trailTimeMs);
      }
      else
      {
        shard.updateTo(clickTimeMs);
      }

      if (shard.dead)
      {
        this._releaseTrailShardOwner(shard);
        this.shards.splice(index, 1);
        continue;
      }

      if (BUILD_CANVAS && drawCanvas)
      {
        const outputCompositing = this._getCanvasOutputCompositing();

        shard.draw(
          this.context,
          scale,
          this._getEffectiveOpacity(),
          this.fxConfig,
          outputCompositing,
          'none',
          this._getEffectiveOverlayAlphaLimit(),
        );
      }
    }
  }

  _hasVisibleEffects()
  {
    return (
      this.waves.length > 0 ||
      this.shards.length > 0 ||
      this.trailStrokes.some((stroke) => hasVisibleTrailPoints(getTrailRenderPoints(stroke)))
    );
  }
}
