import { TAU, random, evaluateNumber, evaluateUnityHermiteCurve, evaluateUnitySmoothCurve, evaluateColor } from './engine-math.js';
import { clamp01, lerp } from './engine-shared.js';
import { UNITY_FX_TOUCH } from './config.js';
import { colorToLinearEnergy, evaluateSrgbGradientEnergy } from './engine-materials.js';
import { evaluateRingLuminance, resolveRingGeometry, drawDissolvedCircle, drawDissolvedCircleEmission, drawDisk, drawDiskEmission, drawDiskCoverage, resolveShardTextureFrameIndex, resolveShardRoundness, drawTriangle, drawTriangleCoverage, drawTriangleEmission, drawHit, drawFlare } from './engine-canvas-primitives.js';

function evaluateRingAngularVelocity(angularBlend, progress, ringCfg = UNITY_FX_TOUCH.rings)
{
  const minVelocity = evaluateUnitySmoothCurve(
    ringCfg.angularVelocityMinKeys,
    progress,
  );
  const maxVelocity = evaluateUnitySmoothCurve(
    ringCfg.angularVelocityMaxKeys,
    progress,
  );
  // 保留 maxCurve 末端的微小负值；它属于资源本身，不能人为钳成停转。
  const velocity = lerp(minVelocity, maxVelocity, angularBlend);

  return velocity * ringCfg.angularVelocityMultiplier * ringCfg.rotationDirection;
}

class ClickWave
{
  constructor(x, y, fxConfig, lastUpdateTimeMs = null)
  {
    this.fx = fxConfig;
    this.x = x;
    this.y = y;
    this.ageMs = 0;
    this.lastUpdateTimeMs = Number.isFinite(lastUpdateTimeMs)
      ? lastUpdateTimeMs
      : null;
    // Cross2 的 Start Rotation 是 0..2pi；同一粒子的 Scene 与 Bloom
    // 必须复用这次采样，不能在不同渲染阶段分别随机。
    this.diskRotation = random(0, TAU);
    this.rings = [];

    const ringCfg = fxConfig.rings;

    for (let index = 0; index < ringCfg.count; index++)
    {
      const angularBlend = Math.random();

      this.rings.push(
        {
          x,
          y,
          radius: random(ringCfg.radiusMin, ringCfg.radiusMax),
          rotation: random(0, TAU),
          angularBlend,
          angularVelocity: evaluateRingAngularVelocity(angularBlend, 0, ringCfg),
        },
      );
    }
  }

  update(deltaMs)
  {
    const ringCfg = this.fx.rings;
    const previousAgeMs = this.ageMs;

    this.ageMs += deltaMs;

    for (const ring of this.rings)
    {
      const sampleAgeMs = (previousAgeMs + this.ageMs) * 0.5;
      const progress = sampleAgeMs / ringCfg.lifetimeMs;

      ring.angularVelocity = evaluateRingAngularVelocity(
        ring.angularBlend,
        progress,
        ringCfg,
      );
      ring.rotation += ring.angularVelocity * (deltaMs / 1000);
    }
  }

  updateTo(timeMs)
  {
    if (!Number.isFinite(timeMs) || !Number.isFinite(this.lastUpdateTimeMs))
    {
      return;
    }

    const deltaMs = Math.max(0, timeMs - this.lastUpdateTimeMs);

    if (deltaMs <= 0)
    {
      return;
    }

    // 点击可能在两个 RAF 之间出生；对象级锚点避免继承出生前的整帧时间。
    this.lastUpdateTimeMs = timeMs;
    this.update(deltaMs);
  }

  drawAdditiveBase(
    context,
    scale,
    opacity,
    linearOutput = false,
    outputCompositing = 'scene',
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    // Hit：撞击爆发，极短极亮
    const hitProgress = this.ageMs / this.fx.hit.lifetimeMs;

    if (this.fx.hit.enabled && hitProgress < 1)
    {
      drawHit(
        context,
        this,
        hitProgress,
        scale,
        opacity,
        this.fx,
        linearOutput,
        outputCompositing,
        overlayColorCompensation,
        overlayAlphaLimit,
      );
    }

    // Flare：星形闪光
    const flareProgress = this.ageMs / this.fx.flare.lifetimeMs;

    if (this.fx.flare.enabled && flareProgress < 1)
    {
      drawFlare(
        context,
        this,
        flareProgress,
        scale,
        opacity,
        this.fx,
        linearOutput,
        outputCompositing,
        overlayColorCompensation,
        overlayAlphaLimit,
      );
    }
  }

  drawDiskLayer(
    context,
    scale,
    opacity,
    useNativeBloom = true,
    dpr = 1,
    outputCompositing = 'scene',
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      drawDisk(
        context,
        this,
        diskProgress,
        scale,
        opacity,
        this.fx,
        useNativeBloom,
        dpr,
        outputCompositing,
        overlayColorCompensation,
        overlayAlphaLimit,
      );
    }
  }

  drawBase(
    context,
    scale,
    opacity,
    useNativeBloom = true,
    outputCompositing = 'scene',
    dpr = 1,
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    // 旧 Canvas 回退保持既有绘制顺序；精确 Scene 路径按材质队列分层调用。
    this.drawAdditiveBase(
      context,
      scale,
      opacity,
      false,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
    this.drawDiskLayer(
      context,
      scale,
      opacity,
      useNativeBloom,
      dpr,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
  }

  drawRings(
    context,
    scale,
    opacity,
    useNativeBloom = true,
    dpr = 1,
    outputCompositing = 'scene',
    linearNativeGlow = false,
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress < 1)
    {
      const ringMaterialEnergy = evaluateSrgbGradientEnergy(
        this.fx.rings.colorKeys,
        ringProgress,
        this.fx.rings.hdrIntensity,
      );

      for (const ring of this.rings)
      {
        drawDissolvedCircle(
          context,
          ring,
          ringProgress,
          scale,
          opacity,
          this.fx,
          useNativeBloom,
          ringMaterialEnergy,
          outputCompositing,
          linearNativeGlow,
          dpr,
          overlayColorCompensation,
          overlayAlphaLimit,
        );
      }
    }
  }

  draw(
    context,
    scale,
    opacity,
    useNativeBloom = true,
    outputCompositing = 'scene',
    dpr = 1,
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    this.drawBase(
      context,
      scale,
      opacity,
      useNativeBloom,
      outputCompositing,
      dpr,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
    this.drawRings(
      context,
      scale,
      opacity,
      useNativeBloom,
      dpr,
      outputCompositing,
      false,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
  }

  drawBloom(context, scale, opacity)
  {
    if (this.fx.bloom.clickEmissionScale <= 0)
    {
      // 强度为零时跳过整套点击发射几何，轨迹 Bloom 仍由独立路径绘制。
      return;
    }

    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      drawDiskEmission(context, this, diskProgress, scale, opacity, this.fx);
    }

    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress < 1)
    {
      const ringMaterialEnergy = evaluateSrgbGradientEnergy(
        this.fx.rings.colorKeys,
        ringProgress,
        this.fx.rings.hdrIntensity,
      );

      for (const ring of this.rings)
      {
        drawDissolvedCircleEmission(
          context,
          ring,
          ringProgress,
          scale,
          opacity,
          this.fx,
          ringMaterialEnergy,
        );
      }
    }
  }

  drawBloomCoverage(context, scale, opacity)
  {
    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      drawDiskCoverage(
        context,
        this,
        diskProgress,
        scale,
        opacity,
        this.fx,
      );
    }

    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress >= 1)
    {
      return;
    }

    for (const ring of this.rings)
    {
      // Ring3 的纹理 Alpha 与粒子 opacity 构成 Coverage；HDR 材质能量
      // 只写 Bloom 发射源，不能反向抬高透明桌面的遮挡度。
      drawDissolvedCircle(
        context,
        ring,
        ringProgress,
        scale,
        opacity,
        this.fx,
        false,
        [1, 1, 1],
        'browser-overlay',
        false,
        1,
        'none',
        1,
        'coverage',
      );
    }
  }

  appendCanvasSceneCoverage(renderer, scale, opacity)
  {
    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress >= 1)
    {
      return;
    }

    const diskCfg = this.fx.disk;
    const radius = diskCfg.radius * evaluateUnityHermiteCurve(
      diskCfg.sizeKeys,
      diskProgress,
    ) * scale;
    const particleAlpha = evaluateNumber(
      diskCfg.alphaKeys,
      diskProgress,
    ) * opacity;

    renderer.addCoverageDisk(
      this.x,
      this.y,
      radius,
      particleAlpha,
      this.diskRotation,
    );
  }

  appendWebGLSceneDiskLayer(renderer, scale, opacity)
  {
    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress >= 1)
    {
      return;
    }

    const diskCfg = this.fx.disk;
    const bloomCfg = this.fx.bloom;
    const radius = diskCfg.radius * evaluateUnityHermiteCurve(
      diskCfg.sizeKeys,
      diskProgress,
    ) * scale;
    const materialEnergy = evaluateSrgbGradientEnergy(
      diskCfg.colorKeys,
      diskProgress,
      bloomCfg.diskEmission,
    );
    const particleAlpha = evaluateNumber(
      diskCfg.alphaKeys,
      diskProgress,
    );

    renderer.addAlphaBlendDisk(
      this.x,
      this.y,
      radius,
      materialEnergy,
      opacity,
      particleAlpha,
      this.diskRotation,
    );
  }

  appendWebGLSceneAdditiveLayer(renderer, scale, opacity)
  {
    const hitProgress = this.ageMs / this.fx.hit.lifetimeMs;

    if (this.fx.hit.enabled && hitProgress < 1)
    {
      const hitCfg = this.fx.hit;
      const alpha = evaluateNumber(hitCfg.alphaKeys, hitProgress) * opacity;

      renderer.addSolidDisk(
        this.x,
        this.y,
        hitCfg.radius * scale,
        colorToLinearEnergy(
          evaluateColor(hitCfg.colorKeys, hitProgress),
          1,
          true,
        ),
        alpha,
      );
    }

    const flareProgress = this.ageMs / this.fx.flare.lifetimeMs;

    if (this.fx.flare.enabled && flareProgress < 1)
    {
      const flareCfg = this.fx.flare;
      const alpha = evaluateNumber(flareCfg.alphaKeys, flareProgress) * opacity;
      const color = colorToLinearEnergy(
        evaluateColor(flareCfg.colorKeys, flareProgress),
        1,
        true,
      );
      const radius = flareCfg.radius * scale;

      for (let index = 0; index < flareCfg.rayCount; index++)
      {
        const angle = TAU / flareCfg.rayCount * index;

        renderer.addTrailSegment(
          { x: this.x, y: this.y },
          {
            x: this.x + Math.cos(angle) * radius,
            y: this.y + Math.sin(angle) * radius,
          },
          1.5 * scale,
          color,
          alpha,
        );
      }
    }

    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress >= 1)
    {
      return;
    }

    const ringCfg = this.fx.rings;
    const ringMaterialEnergy = evaluateSrgbGradientEnergy(
      ringCfg.colorKeys,
      ringProgress,
      ringCfg.hdrIntensity,
    );
    const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;

    for (const ring of this.rings)
    {
      const geometry = resolveRingGeometry(
        ring,
        ringProgress,
        scale,
        ringCfg,
      );

      renderer.addDissolveRing(
        ring.x,
        ring.y,
        geometry.radius,
        geometry.width,
        ring.rotation,
        ringCfg.radialSamples,
        ringCfg.arcSamples,
        ringMaterialEnergy,
        opacity,
        geometry.threshold,
        ringCfg.textureUvMin,
        ringCfg.textureUvMax,
        direction,
      );
    }
  }

  appendWebGLBloom(renderer, scale, opacity)
  {
    if (this.fx.bloom.clickEmissionScale <= 0)
    {
      return;
    }

    const diskProgress = this.ageMs / this.fx.disk.lifetimeMs;

    if (diskProgress < 1)
    {
      const diskCfg = this.fx.disk;
      const bloomCfg = this.fx.bloom;
      const radius = diskCfg.radius * evaluateUnityHermiteCurve(
        diskCfg.sizeKeys,
        diskProgress,
      ) * scale;
      const emissionOpacity = opacity * bloomCfg.diskEmissionAlpha *
        bloomCfg.clickEmissionScale;
      const materialEnergy = evaluateSrgbGradientEnergy(
        diskCfg.colorKeys,
        diskProgress,
        bloomCfg.diskEmission,
      );

      renderer.addDisk(
        this.x,
        this.y,
        radius,
        materialEnergy,
        emissionOpacity,
        this.diskRotation,
      );
    }

    const ringProgress = this.ageMs / this.fx.rings.lifetimeMs;

    if (ringProgress >= 1)
    {
      return;
    }

    const ringCfg = this.fx.rings;
    const bloomCfg = this.fx.bloom;
    const ringMaterialEnergy = evaluateSrgbGradientEnergy(
      ringCfg.colorKeys,
      ringProgress,
      ringCfg.hdrIntensity,
    );
    const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;

    for (const ring of this.rings)
    {
      const geometry = resolveRingGeometry(
        ring,
        ringProgress,
        scale,
        ringCfg,
      );

      renderer.addRing(
        ring.x,
        ring.y,
        geometry.radius,
        geometry.width,
        ring.rotation,
        ringCfg.radialSamples,
        ringCfg.arcSamples,
        ringMaterialEnergy,
        opacity * bloomCfg.ringEmissionAlpha * bloomCfg.clickEmissionScale,
        (angularProgress, radialProgress) =>
        {
          const textureProgress = direction > 0
            ? angularProgress
            : 1 - angularProgress;

          return evaluateRingLuminance(
            textureProgress,
            radialProgress,
            geometry.threshold,
            ringCfg,
          );
        },
      );
    }
  }

  get dead()
  {
    let lifetimeMs = this.fx.disk.lifetimeMs;

    if (this.fx.hit.enabled)
    {
      lifetimeMs = Math.max(lifetimeMs, this.fx.hit.lifetimeMs);
    }

    if (this.fx.flare.enabled)
    {
      lifetimeMs = Math.max(lifetimeMs, this.fx.flare.lifetimeMs);
    }

    if (this.rings.length > 0)
    {
      // count=0 时没有圆环可见，不能让不存在的 600ms 粒子继续占用 RAF。
      lifetimeMs = Math.max(lifetimeMs, this.fx.rings.lifetimeMs);
    }

    return this.ageMs >= lifetimeMs;
  }
}

class ShardParticle
{
  constructor(specification)
  {
    Object.assign(this, specification);
    this.ageMs = 0;
    this.lastUpdateTimeMs = Number.isFinite(specification.lastUpdateTimeMs)
      ? specification.lastUpdateTimeMs
      : null;
  }

  update(deltaMs)
  {
    const deltaSeconds = deltaMs / 1000;

    this.ageMs += deltaMs;
    this.x += this.velocityX * deltaSeconds;
    this.y += this.velocityY * deltaSeconds;
  }

  updateTo(timeMs)
  {
    if (!Number.isFinite(timeMs) || !Number.isFinite(this.lastUpdateTimeMs))
    {
      return;
    }

    const deltaMs = Math.max(0, timeMs - this.lastUpdateTimeMs);

    if (deltaMs <= 0)
    {
      return;
    }

    // 输入事件也会推进拖尾虚拟时钟。每枚碎片保存自己的消费位置，
    // 确保下一帧补算完整时间，同时不继承出生前的空闲时段。
    this.lastUpdateTimeMs = timeMs;
    this.update(deltaMs);
  }

  draw(
    context,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
    outputCompositing = 'scene',
    overlayColorCompensation = 'none',
    overlayAlphaLimit = 1,
  )
  {
    drawTriangle(
      context,
      this,
      scale,
      opacity,
      fxConfig,
      outputCompositing,
      overlayColorCompensation,
      overlayAlphaLimit,
    );
  }

  drawBloom(
    context,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
  )
  {
    drawTriangleEmission(context, this, scale, opacity, fxConfig);
  }

  drawBloomCoverage(
    context,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
  )
  {
    drawTriangleCoverage(context, this, scale, opacity, fxConfig);
  }

  appendWebGLScene(
    renderer,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
  )
  {
    // 碎片材质本身就是加色 HDR，Scene 与 Bloom 发射可共享同一套三角几何。
    this.appendWebGLBloom(renderer, scale, opacity, fxConfig);
  }

  appendWebGLBloom(
    renderer,
    scale,
    opacity,
    fxConfig = UNITY_FX_TOUCH,
  )
  {
    const shardCfg = fxConfig.shards;
    const progress = clamp01(this.ageMs / this.lifetimeMs);
    const size = this.size * evaluateUnityHermiteCurve(
      shardCfg.sizeKeys,
      progress,
    ) * scale;
    const alpha = evaluateNumber(shardCfg.alphaKeys, progress) * opacity;
    const materialEnergy = evaluateSrgbGradientEnergy(
      shardCfg.colorKeys,
      progress,
      shardCfg.hdrIntensity,
      shardCfg.startColor,
    );
    const textureFrameIndex = resolveShardTextureFrameIndex(this, shardCfg);

    renderer.addTriangle(
      this.x,
      this.y,
      size,
      this.rotation,
      materialEnergy,
      alpha,
      textureFrameIndex,
      resolveShardRoundness(shardCfg),
    );
  }

  get dead()
  {
    return this.ageMs >= this.lifetimeMs;
  }
}

function createShard(
  x,
  y,
  originAngle,
  kind,
  scale,
  shardCfg = UNITY_FX_TOUCH.shards,
  lastUpdateTimeMs = null,
  ownerId = null,
)
{
  const isClick = kind === 'click';
  const radius = (isClick ? shardCfg.clickRadius : shardCfg.trailRadius) * scale;
  const speed = (isClick
    ? random(shardCfg.clickSpeedMin, shardCfg.clickSpeedMax)
    : random(shardCfg.trailSpeedMin, shardCfg.trailSpeedMax)) * scale;
  const lifetimeMs = isClick
    ? random(shardCfg.clickLifetimeMinMs, shardCfg.clickLifetimeMaxMs)
    : random(shardCfg.trailLifetimeMinMs, shardCfg.trailLifetimeMaxMs);

  return new ShardParticle(
    {
      kind,
      x: x + Math.cos(originAngle) * radius,
      y: y + Math.sin(originAngle) * radius,
      velocityX: Math.cos(originAngle) * speed,
      velocityY: Math.sin(originAngle) * speed,
      // 原 ParticleSystem 不旋转粒子，而是在 2×1 图集中随机选择朝上或朝下帧。
      rotation: 0,
      textureFrame: Math.random() < 0.5 ? 0 : 1,
      lifetimeMs,
      size: random(shardCfg.sizeMin, shardCfg.sizeMax),
      lastUpdateTimeMs,
      ownerId,
    },
  );
}

export { evaluateRingAngularVelocity, ClickWave, ShardParticle, createShard };
