import {
  TAU, evaluateNumber, evaluateUnityHermiteCurve, evaluateColor,
} from './engine-math.js';
import {
  clamp01, lerp,
} from './engine-shared.js';
import {
  UNITY_FX_TOUCH,
} from './config.js';
import {
  sampleRing3Alpha,
} from './ring3-alpha.js';
import {
  CIRCLE_TEXTURE_SIZE, CIRCLE_TEXTURE_RGBA,
} from './circle-texture.js';
import {
  TRIANGLE_TEXTURE_SIZE,
} from './triangle-texture.js';
import {
  traceRoundedTrianglePath,
} from './triangle-path.js';
import {
  themeHueShift, relativeOklchTheme, ringSampleCache,
} from './engine-render-state.js';
import {
  srgbToLinearChannel,
  colorToLinearEnergy,
  evaluateSrgbGradientEnergy,
  linearEnergyToAdditiveCss,
  resolveHostAdditivePayload,
  linearEnergyToHostAdditiveCss,
  resolveOverlayCompensation,
  colorToCanvasOutputCss,
  linearEnergyToOverlayCss,
  linearEnergyToEmissionCss,
} from './engine-materials.js';
import {
  getTriangleTextureResources,
  getCircleTextureResources,
  prepareLinearTintedTextureCanvas,
  prepareCircleTextureCanvas,
  getRoundedTriangleCoverage,
  prepareSceneRoundedTriangleCanvas,
} from './engine-canvas-textures.js';

const NATIVE_BLOOM_DISK_SAMPLES = 16;

let nativeCircleBloomSamples = null;

function getNativeCircleBloomSamples()
{
  if (!nativeCircleBloomSamples)
  {
    // 固定纹理与网格不随实例或主题改变；Float64 保留原 JavaScript 数值精度。
    const count = NATIVE_BLOOM_DISK_SAMPLES;
    const samples = new Float64Array(count * count * 4);
    let destination = 0;
    for (let y = 0; y < count; y++)
    {
      for (let x = 0; x < count; x++)
      {
        const u = (x + 0.5) / count;
        const v = (y + 0.5) / count;
        const offset = (Math.floor(v * CIRCLE_TEXTURE_SIZE) *
          CIRCLE_TEXTURE_SIZE + Math.floor(u * CIRCLE_TEXTURE_SIZE)) * 4;
        samples[destination++] = srgbToLinearChannel(CIRCLE_TEXTURE_RGBA[offset]);
        samples[destination++] = srgbToLinearChannel(CIRCLE_TEXTURE_RGBA[offset + 1]);
        samples[destination++] = srgbToLinearChannel(CIRCLE_TEXTURE_RGBA[offset + 2]);
        samples[destination++] = (u * 2 - 1) ** 2 + (v * 2 - 1) ** 2;
      }
    }
    nativeCircleBloomSamples = samples;
  }
  return nativeCircleBloomSamples;
}

function evaluateRingTextureAlpha(
  angularProgress,
  radialProgress,
  ringCfg,
)
{
  const uvSpan = ringCfg.textureUvMax - ringCfg.textureUvMin;
  const u = ringCfg.textureUvMin + uvSpan * clamp01(angularProgress);
  const v = ringCfg.textureUvMin + uvSpan * clamp01(radialProgress);

  // 原网格 UV、Bilinear 和 Clamp 均在采样器内显式还原；Alpha 不经过 sRGB 解码。
  return sampleRing3Alpha(u, v);
}

function evaluateRingLuminance(
  angularProgress,
  radialProgress,
  threshold,
  ringCfg,
)
{
  const textureAlpha = evaluateRingTextureAlpha(
    angularProgress,
    radialProgress,
    ringCfg,
  );
  // 原始 Fragment Shader 只执行二值 clip；通过测试的像素仍保留纹理 Alpha，
  // 所以环带中心与内外沿不会被压成相同颜色。
  return textureAlpha >= threshold ? textureAlpha : 0;
}

function resolveRingTextureProgress(angularProgress, direction)
{
  return direction > 0 ? angularProgress : 1 - angularProgress;
}

function findRingClipBoundary(
  angularStart,
  angularEnd,
  radialProgress,
  threshold,
  direction,
  ringCfg,
)
{
  let start = angularStart;
  let end = angularEnd;
  const startTextureProgress = resolveRingTextureProgress(start, direction);
  const startVisible = evaluateRingTextureAlpha(
    startTextureProgress,
    radialProgress,
    ringCfg,
  ) >= threshold;

  // 相邻主采样之间再二分原纹理，避免 conic gradient 把 Shader clip
  // 的不连续边界重新插值成一段软透明过渡。
  for (let iteration = 0; iteration < 8; iteration++)
  {
    const middle = (start + end) * 0.5;
    const middleTextureProgress = resolveRingTextureProgress(
      middle,
      direction,
    );
    const middleVisible = evaluateRingTextureAlpha(
      middleTextureProgress,
      radialProgress,
      ringCfg,
    ) >= threshold;

    if (middleVisible === startVisible)
    {
      start = middle;
    }
    else
    {
      end = middle;
    }
  }

  return (start + end) * 0.5;
}

function prepareRingGradientSamples(ringCfg, threshold, radialProgress, sampleCount, direction)
{
  const count = Math.floor(sampleCount) + 1;
  // 保留原 Number 的双精度，不能用 Float32 工作区提前舍入亮度或 clip 边界。
  const luminances = new Float64Array(count);
  const boundaries = new Float64Array(count);
  const transitions = new Uint8Array(count);
  let previousLuminance = null;

  for (let sample = 0; sample <= sampleCount; sample++)
  {
    const angularProgress = sample / sampleCount;
    const textureProgress = resolveRingTextureProgress(angularProgress, direction);
    const luminance = evaluateRingLuminance(textureProgress, radialProgress, threshold, ringCfg);
    luminances[sample] = luminance;

    if (previousLuminance !== null && (previousLuminance > 0) !== (luminance > 0))
    {
      boundaries[sample] = findRingClipBoundary(
        (sample - 1) / sampleCount, angularProgress, radialProgress, threshold, direction, ringCfg,
      );
      transitions[sample] = previousLuminance > 0 ? 1 : 2;
    }
    previousLuminance = luminance;
  }
  return { sampleCount, luminances, boundaries, transitions };
}

function getRingGradientSamples(ringCfg, threshold, radialProgress)
{
  const sampleCount = Math.max(32, resolveRingIntegrationArcSamples(ringCfg));
  const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;
  if (!ringSampleCache)
  {
    return prepareRingGradientSamples(ringCfg, threshold, radialProgress, sampleCount, direction);
  }
  let entries = ringSampleCache.get(ringCfg);
  if (!entries)
  {
    entries = new Map();
    ringSampleCache.set(ringCfg, entries);
  }
  // 颜色、半径和 Canvas 变换不参与纹理 Alpha 与 clip 边界计算；实际 UV 和阈值必须参与。
  const key = `${sampleCount}:${direction}:${radialProgress}:${threshold}:${ringCfg.textureUvMin}:${ringCfg.textureUvMax}`;
  let samples = entries.get(key);
  if (!samples)
  {
    samples = prepareRingGradientSamples(ringCfg, threshold, radialProgress, sampleCount, direction);
    entries.set(key, samples);
  }
  return samples;
}

function createRingStopDescriptor(purpose, materialEnergy, ...parameters)
{
  return { theme: relativeOklchTheme,
    key: `${purpose}:${themeHueShift}:${materialEnergy.join(':')}:${parameters.join(':')}` };
}

function getRingGradientStops(samples, descriptor)
{
  return ringSampleCache && descriptor
    ? samples.stopSequences?.get(descriptor.theme)?.get(descriptor.key)
    : null;
}

function prepareRingGradientStops(gradient, samples, threshold, colorForLuminance, retain)
{
  const stops = retain ? [] : null;
  const sampleCount = samples.sampleCount;
  const writeStop = (position, color) =>
  {
    gradient.addColorStop(position, color);
    if (stops) stops.push(position, color);
  };

  for (let sample = 0; sample <= sampleCount; sample++)
  {
    const angularProgress = sample / sampleCount;
    const luminance = samples.luminances[sample];

    if (samples.transitions[sample])
    {
      const boundary = samples.boundaries[sample];
      const visibleBoundary = colorForLuminance(threshold);
      const transparentBoundary = colorForLuminance(0);

      if (samples.transitions[sample] === 1)
      {
        writeStop(boundary, visibleBoundary);
        writeStop(boundary, transparentBoundary);
      }
      else
      {
        writeStop(boundary, transparentBoundary);
        writeStop(boundary, visibleBoundary);
      }
    }

    writeStop(
      angularProgress,
      colorForLuminance(luminance),
    );
  }
  return stops;
}

function createDissolvedRingGradient(
  context,
  ringCfg,
  threshold,
  radialProgress,
  colorForLuminance,
  stopDescriptor = null,
)
{
  if (typeof context.createConicGradient !== 'function')
  {
    return null;
  }

  const gradient = context.createConicGradient(0, 0, 0);
  const samples = getRingGradientSamples(ringCfg, threshold, radialProgress);
  const cached = getRingGradientStops(samples, stopDescriptor);
  if (cached)
  {
    for (let index = 0; index < cached.length; index += 2)
    {
      gradient.addColorStop(cached[index], cached[index + 1]);
    }
  }
  else
  {
    // 首次准备仍按原顺序交错求值与写入；失败时不能留下半成品。
    const stops = prepareRingGradientStops(gradient, samples, threshold,
      colorForLuminance, Boolean(ringSampleCache && stopDescriptor));
    if (stops)
    {
      samples.stopSequences ??= new Map();
      let sequences = samples.stopSequences.get(stopDescriptor.theme);
      if (!sequences)
      {
        sequences = new Map();
        samples.stopSequences.set(stopDescriptor.theme, sequences);
      }
      // 序列依附同帧采样数据，随既存范围的 finally 释放，不保留历史帧。
      sequences.set(stopDescriptor.key, stops);
    }
  }

  return gradient;
}

function fillDissolvedRingFallback(
  context,
  radius,
  width,
  threshold,
  ringCfg,
  radialProgress,
  colorForLuminance,
)
{
  const circumference = TAU * radius;
  const segmentCount = Math.max(
    resolveRingIntegrationArcSamples(ringCfg),
    Math.ceil(circumference),
  );
  const direction = ringCfg.dissolveDirection >= 0 ? 1 : -1;

  for (let segment = 0; segment < segmentCount; segment++)
  {
    const angularStart = segment / segmentCount;
    const angularEnd = (segment + 1) / segmentCount;
    const angularProgress = (angularStart + angularEnd) * 0.5;
    const textureProgress = resolveRingTextureProgress(
      angularProgress,
      direction,
    );
    const luminance = evaluateRingLuminance(
      textureProgress,
      radialProgress,
      threshold,
      ringCfg,
    );

    if (luminance <= 0)
    {
      continue;
    }

    context.beginPath();
    context.arc(
      0,
      0,
      radius,
      angularStart * TAU,
      angularEnd * TAU,
      false,
    );
    context.lineCap = 'butt';
    context.lineWidth = Math.max(0.5, width);
    context.strokeStyle = colorForLuminance(luminance);
    context.stroke();
  }
}

function resolveRingIntegrationSamples(ringCfg)
{
  // GPU 的原始单层网格不等于一次纹理积分；Canvas/Native 默认继续取八条径向带。
  const samples = Math.max(1, Math.round(ringCfg.radialSamples));
  return samples === 1 && Math.round(ringCfg.arcSamples) === 64 ? 8 : samples;
}

function resolveRingIntegrationArcSamples(ringCfg)
{
  return Math.round(ringCfg.radialSamples) === 1 && Math.round(ringCfg.arcSamples) === 64
    ? 96 : ringCfg.arcSamples;
}

function fillDissolvedRing(
  context,
  radius,
  width,
  threshold,
  ringCfg,
  colorForLuminance,
  stopDescriptor = null,
)
{
  const radialSamples = resolveRingIntegrationSamples(ringCfg);
  const innerEdge = Math.max(0, radius - width * 0.5);
  const bandWidth = width / radialSamples;
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';

  for (let band = 0; band < radialSamples; band++)
  {
    const innerRadius = innerEdge + bandWidth * band;
    const outerRadius = innerEdge + bandWidth * (band + 1);
    const radialProgress = (band + 0.5) / radialSamples;
    const gradient = createDissolvedRingGradient(
      context,
      ringCfg,
      threshold,
      radialProgress,
      colorForLuminance,
      stopDescriptor,
    );

    if (!gradient)
    {
      fillDissolvedRingFallback(
        context,
        (innerRadius + outerRadius) * 0.5,
        bandWidth,
        threshold,
        ringCfg,
        radialProgress,
        colorForLuminance,
      );
      continue;
    }

    context.beginPath();
    context.arc(0, 0, outerRadius, 0, TAU, false);
    context.arc(0, 0, innerRadius, TAU, 0, true);
    context.closePath();
    context.fillStyle = gradient;
    context.fill();
  }
}

function resolveRingGeometry(ring, progress, scale, ringCfg)
{
  const size = evaluateUnityHermiteCurve(ringCfg.sizeKeys, progress);
  const outerRadius = ring.radius * size * scale;
  const widthMultiplier = lerp(
    ringCfg.widthStart,
    ringCfg.widthEnd,
    progress,
  );
  const width = outerRadius * ringCfg.bandToOuterRadius * widthMultiplier;

  return {
    radius: outerRadius - width * 0.5,
    width,
    threshold: clamp01(evaluateUnityHermiteCurve(
      ringCfg.dissolveKeys,
      progress,
    )),
  };
}

function drawDissolvedCircle(
  context,
  ring,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  useNativeBloom = true,
  sharedMaterialEnergy = null,
  outputCompositing = 'scene',
  linearNativeGlow = false,
  dpr = 1,
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
  gradientPurpose = 'clear',
)
{
  const ringCfg = fxConfig.rings;
  const geometry = resolveRingGeometry(ring, progress, scale, ringCfg);

  if (geometry.width <= 0.001)
  {
    return;
  }

  // 同一圆环的所有径向带和渐变 stop 使用相同材质能量。若在回调中计算，
  // 每帧会重复执行上千次主题变换和 sRGB 解码。
  const materialEnergy = sharedMaterialEnergy ?? evaluateSrgbGradientEnergy(
    ringCfg.colorKeys,
    progress,
    ringCfg.hdrIntensity,
  );
  // Canvas 独立近似 Bloom；Tri3 本体仍必须保留原材质的
  // Linear 色彩空间与 HDR 强度，否则清晰环带会比 Unity 明显偏蓝、偏暗。
  const colorForLuminance = (luminance) =>
  {
    const coverage = opacity * luminance;

    if (outputCompositing === 'browser-overlay')
    {
      const energyScale = useNativeBloom
        ? Math.min(1, srgbToLinearChannel(coverage * 255) /
            Math.max(Math.max(...materialEnergy) * coverage, 0.000001))
        : 1;
      return linearEnergyToOverlayCss(
        materialEnergy,
        coverage * energyScale,
        coverage,
        overlayColorCompensation,
        overlayAlphaLimit,
        opacity,
      );
    }

    return outputCompositing === 'host-additive'
      ? linearEnergyToHostAdditiveCss(
          materialEnergy,
          coverage,
          coverage,
        )
      : linearEnergyToAdditiveCss(materialEnergy, coverage);
  };

  context.save();
  context.translate(ring.x, ring.y);
  context.rotate(ring.rotation);

  fillDissolvedRing(
    context,
    geometry.radius,
    geometry.width,
    geometry.threshold,
    ringCfg,
    colorForLuminance,
    createRingStopDescriptor(gradientPurpose, materialEnergy, opacity, useNativeBloom,
      outputCompositing, overlayColorCompensation, overlayAlphaLimit),
  );

  context.restore();
}

function drawDissolvedCircleEmission(
  context,
  ring,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  sharedMaterialEnergy = null,
)
{
  const ringCfg = fxConfig.rings;
  const bloomCfg = fxConfig.bloom;
  const geometry = resolveRingGeometry(ring, progress, scale, ringCfg);

  if (geometry.width <= 0.001)
  {
    return;
  }

  const materialEnergy = sharedMaterialEnergy ?? evaluateSrgbGradientEnergy(
    ringCfg.colorKeys,
    progress,
    ringCfg.hdrIntensity,
  );

  context.save();
  context.translate(ring.x, ring.y);
  context.rotate(ring.rotation);
  fillDissolvedRing(
    context,
    geometry.radius,
    geometry.width,
    geometry.threshold,
    ringCfg,
    (luminance) => linearEnergyToEmissionCss(
      materialEnergy,
      opacity * luminance * bloomCfg.ringEmissionAlpha,
      bloomCfg.emissionRange,
      bloomCfg.clickEmissionScale,
    ),
    createRingStopDescriptor('emission', materialEnergy, opacity, bloomCfg.ringEmissionAlpha,
      bloomCfg.emissionRange, bloomCfg.clickEmissionScale),
  );
  context.restore();
}

function drawDisk(
  context,
  wave,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  useNativeBloom = true,
  dpr = 1,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const diskCfg = fxConfig.disk;
  const bloomCfg = fxConfig.bloom;
  // Size over Lifetime 是带切线的 Unity AnimationCurve；所有后端必须
  // 共享 Hermite 求值，否则清晰圆盘与 Bloom 发射会在扩张阶段错位。
  const size = evaluateUnityHermiteCurve(diskCfg.sizeKeys, progress);
  const radius = diskCfg.radius * size * scale;
  const color = evaluateColor(diskCfg.colorKeys, progress);
  const particleAlpha = evaluateNumber(
    diskCfg.alphaKeys,
    progress,
  );

  if (radius <= 0 || particleAlpha <= 0)
  {
    return;
  }

  const materialEnergy = evaluateSrgbGradientEnergy(
    diskCfg.colorKeys,
    progress,
    bloomCfg.diskEmission,
  );
  const coverageAlpha = particleAlpha * opacity;
  let textureAlpha = clamp01(coverageAlpha);
  let textureCanvas;

  if (outputCompositing === 'browser-overlay')
  {
    textureAlpha = Math.min(textureAlpha, clamp01(overlayAlphaLimit));
    const resources = getCircleTextureResources();
    const compensation = overlayColorCompensation === 'bright-core'
      ? resolveOverlayCompensation(
          materialEnergy,
          opacity,
          coverageAlpha,
          opacity,
        )
      : 0;

    if (resources && textureAlpha > 0.000001)
    {
      textureCanvas = prepareLinearTintedTextureCanvas(
        resources,
        CIRCLE_TEXTURE_SIZE,
        materialEnergy,
        opacity,
        coverageAlpha,
        0,
        compensation,
        null,
        useNativeBloom,
      );
    }
  }
  else if (outputCompositing === 'host-additive')
  {
    const payload = resolveHostAdditivePayload(
      materialEnergy,
      opacity,
      coverageAlpha,
    );

    textureAlpha = payload[3];
    const resources = getCircleTextureResources();

    if (resources)
    {
      textureCanvas = prepareLinearTintedTextureCanvas(
        resources,
        CIRCLE_TEXTURE_SIZE,
        materialEnergy,
        opacity,
        textureAlpha,
      );
    }
  }
  else
  {
    const textureScales = materialEnergy.map((channel) =>
      channel / Math.max(particleAlpha, 0.00001));
    textureCanvas = prepareCircleTextureCanvas(textureScales);
  }

  if (!textureCanvas)
  {
    return;
  }

  context.save();
  // Cross2 的 Blend One / OneMinusSrcAlpha 与最终输出模式无关；清晰层
  // 始终按 Coverage 衰减目标，超过 8 位范围的能量由独立 Bloom 保留。
  context.globalCompositeOperation = 'source-over';
  context.translate(wave.x, wave.y);
  context.rotate(wave.diskRotation);
  context.globalAlpha = textureAlpha;
  context.shadowBlur = 0;
  context.drawImage(
    textureCanvas,
    0,
    0,
    CIRCLE_TEXTURE_SIZE,
    CIRCLE_TEXTURE_SIZE,
    -radius,
    -radius,
    radius * 2,
    radius * 2,
  );
  context.restore();
}

function drawDiskEmission(
  context,
  wave,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
)
{
  const diskCfg = fxConfig.disk;
  const bloomCfg = fxConfig.bloom;
  const radius = diskCfg.radius * evaluateUnityHermiteCurve(
    diskCfg.sizeKeys,
    progress,
  ) * scale;
  const materialEnergy = evaluateSrgbGradientEnergy(
    diskCfg.colorKeys,
    progress,
    bloomCfg.diskEmission,
  );
  const textureCanvas = prepareCircleTextureCanvas(
    materialEnergy.map((channel) =>
      channel * bloomCfg.clickEmissionScale / bloomCfg.emissionRange),
  );

  if (radius <= 0 || !textureCanvas)
  {
    return;
  }

  context.save();
  context.translate(wave.x, wave.y);
  context.rotate(wave.diskRotation);
  // Cross2 生命周期 Alpha 不进入 RGB；Bloom 发射持续到粒子真正死亡。
  context.globalAlpha = clamp01(opacity * bloomCfg.diskEmissionAlpha);
  context.drawImage(
    textureCanvas,
    0,
    0,
    CIRCLE_TEXTURE_SIZE,
    CIRCLE_TEXTURE_SIZE,
    -radius,
    -radius,
    radius * 2,
    radius * 2,
  );
  context.restore();
}

function drawDiskCoverage(
  context,
  wave,
  progress,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
)
{
  const diskCfg = fxConfig.disk;
  const radius = diskCfg.radius * evaluateUnityHermiteCurve(
    diskCfg.sizeKeys,
    progress,
  ) * scale;
  const lifecycleAlpha = evaluateNumber(diskCfg.alphaKeys, progress) * opacity;

  if (radius <= 0 || lifecycleAlpha <= 0)
  {
    return;
  }

  const resources = getCircleTextureResources();

  if (!resources)
  {
    // Software Bloom 依赖同样的 ImageData 能力；资源不可用时由外层
    // renderer 失败策略切换 Native，不能用径向近似掩盖纹理细节缺失。
    return;
  }

  context.save();
  context.globalCompositeOperation = 'source-over';
  context.translate(wave.x, wave.y);
  context.rotate(wave.diskRotation);
  context.globalAlpha = clamp01(lifecycleAlpha);
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  // 直接采样完整 Circle_01，保留径向表无法表达的逐像素 Coverage 细节。
  context.drawImage(
    resources.coverageCanvas,
    0,
    0,
    CIRCLE_TEXTURE_SIZE,
    CIRCLE_TEXTURE_SIZE,
    -radius,
    -radius,
    radius * 2,
    radius * 2,
  );
  context.restore();
}

function resolveShardTextureFrameIndex(particle, shardCfg)
{
  const frames = shardCfg.textureFrames;
  const frameCount = Array.isArray(frames) && frames.length > 0
    ? frames.length
    : 2;
  const rawIndex = Number.isInteger(particle.textureFrame)
    ? particle.textureFrame
    : 0;

  return ((rawIndex % frameCount) + frameCount) % frameCount;
}

function resolveShardTextureFrame(particle, shardCfg)
{
  const frames = shardCfg.textureFrames;

  if (!Array.isArray(frames) || frames.length === 0)
  {
    // 保留旧配置的兼容轮廓；默认配置始终使用 Unity 图集的实测边界。
    return [
      [0, -0.58],
      [0.52, 0.45],
      [-0.52, 0.45],
    ];
  }

  return frames[resolveShardTextureFrameIndex(particle, shardCfg)];
}

function drawTriangleTextureFrame(context, canvas, frameIndex)
{
  context.save();

  if (frameIndex % 2 === 1)
  {
    // Unity 图集的第二帧与第一帧 RGBA 完全相同，仅 V 方向翻转。
    context.translate(0, TRIANGLE_TEXTURE_SIZE);
    context.scale(1, -1);
  }

  context.drawImage(canvas, 0, 0);
  context.restore();
}

function resolveShardRoundness(shardCfg)
{
  return clamp01(shardCfg.roundness);
}

function drawTexturedTriangle(
  context,
  particle,
  size,
  materialEnergy,
  particleAlpha,
  frameIndex,
  energyScale = 1,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
  opacity = 1,
  roundness = 0,
)
{
  const resources = getTriangleTextureResources();

  if (!resources)
  {
    return false;
  }

  const scaledEnergy = materialEnergy.map((channel) =>
    channel * Math.max(0, energyScale));
  const transparentPayload = outputCompositing === 'browser-overlay' ||
    outputCompositing === 'host-additive';
  const shapeCoverage = getRoundedTriangleCoverage(resources, roundness);
  const shape = shapeCoverage
    ? {
        coverage: shapeCoverage,
        roundness,
        useTextureAlpha: outputCompositing === 'scene',
      }
    : null;
  let payloadAlpha = clamp01(particleAlpha);
  let textureCanvas;

  if (outputCompositing === 'browser-overlay')
  {
    payloadAlpha = Math.min(payloadAlpha, clamp01(overlayAlphaLimit));
    const compensation = overlayColorCompensation === 'bright-core'
      ? resolveOverlayCompensation(
          scaledEnergy,
          particleAlpha,
          particleAlpha,
          opacity,
        )
      : 0;

    if (payloadAlpha > 0.000001)
    {
      textureCanvas = prepareLinearTintedTextureCanvas(
        resources,
        TRIANGLE_TEXTURE_SIZE,
        scaledEnergy,
        particleAlpha,
        particleAlpha,
        frameIndex,
        compensation,
        shape,
      );
    }
  }
  else if (outputCompositing === 'host-additive')
  {
    const payload = resolveHostAdditivePayload(
      scaledEnergy,
      particleAlpha,
      particleAlpha,
    );

    payloadAlpha = payload[3];
    textureCanvas = prepareLinearTintedTextureCanvas(
      resources,
      TRIANGLE_TEXTURE_SIZE,
      scaledEnergy,
      particleAlpha,
      payloadAlpha,
      frameIndex,
      0,
      shape,
    );
  }
  else
  {
    const textureContext = resources.context;
    const scaledColor = scaledEnergy.map((channel) =>
      Math.round(clamp01(channel) * 255));
    if (roundness > 0)
    {
      textureCanvas = prepareSceneRoundedTriangleCanvas(
        resources,
        scaledEnergy,
        roundness,
        frameIndex,
      );
    }

    if (!textureCanvas)
    {
      textureContext.setTransform(1, 0, 0, 1, 0, 0);
      textureContext.globalAlpha = 1;
      textureContext.globalCompositeOperation = 'source-over';
      textureContext.imageSmoothingEnabled = true;
      textureContext.clearRect(
        0,
        0,
        TRIANGLE_TEXTURE_SIZE,
        TRIANGLE_TEXTURE_SIZE,
      );
      drawTriangleTextureFrame(
        textureContext,
        resources.colorCanvas,
        frameIndex,
      );

      // Scene Final Pass 读取线性字节；这里继续按 Unity 线性材质乘法绘制。
      textureContext.globalCompositeOperation = 'multiply';
      textureContext.fillStyle = `rgb(${scaledColor[0]}, ${
        scaledColor[1]}, ${scaledColor[2]})`;
      textureContext.fillRect(
        0,
        0,
        TRIANGLE_TEXTURE_SIZE,
        TRIANGLE_TEXTURE_SIZE,
      );
      textureContext.globalCompositeOperation = 'destination-in';
      drawTriangleTextureFrame(
        textureContext,
        resources.alphaCanvas,
        frameIndex,
      );
      textureCanvas = resources.canvas;
    }
  }

  if (transparentPayload && (!textureCanvas || payloadAlpha <= 0.00001))
  {
    // source-over 下黑色纹理仍会遮挡宿主；零能量必须完全跳过。
    return true;
  }

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.globalAlpha = payloadAlpha;
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.drawImage(textureCanvas, -size * 0.5, -size * 0.5, size, size);
  context.restore();
  return true;
}

function drawTriangle(
  context,
  particle,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const shardCfg = fxConfig.shards;
  const progress = clamp01(particle.ageMs / particle.lifetimeMs);
  const size = particle.size * evaluateUnityHermiteCurve(
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
  const textureFrameIndex = resolveShardTextureFrameIndex(particle, shardCfg);
  const textureFrame = resolveShardTextureFrame(particle, shardCfg);
  const roundness = resolveShardRoundness(shardCfg);

  if (size <= 0 || alpha <= 0)
  {
    return;
  }

  if (drawTexturedTriangle(
    context,
    particle,
    size,
    materialEnergy,
    alpha,
    textureFrameIndex,
    1,
    outputCompositing,
    overlayColorCompensation,
    overlayAlphaLimit,
    opacity,
    roundness,
  ))
  {
    return;
  }

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.beginPath();
  traceRoundedTrianglePath(context, textureFrame, size, shardCfg.roundness);
  if (outputCompositing === 'browser-overlay')
  {
    context.fillStyle = linearEnergyToOverlayCss(
      materialEnergy,
      alpha,
      alpha,
      overlayColorCompensation,
      overlayAlphaLimit,
      opacity,
    );
  }
  else if (outputCompositing === 'host-additive')
  {
    context.fillStyle = linearEnergyToHostAdditiveCss(
      materialEnergy,
      alpha,
      alpha,
    );
  }
  else
  {
    context.fillStyle = linearEnergyToAdditiveCss(materialEnergy, alpha);
  }
  // 三角碎片在原图中是清晰本体；显式清空阴影，避免继承上一层发光状态。
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.fill();
  context.restore();
}

function drawTriangleCoverage(
  context,
  particle,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
)
{
  const shardCfg = fxConfig.shards;
  const progress = clamp01(particle.ageMs / particle.lifetimeMs);
  const size = particle.size * evaluateUnityHermiteCurve(
    shardCfg.sizeKeys,
    progress,
  ) * scale;
  const alpha = evaluateNumber(shardCfg.alphaKeys, progress) * opacity;
  const textureFrameIndex = resolveShardTextureFrameIndex(particle, shardCfg);
  const textureFrame = resolveShardTextureFrame(particle, shardCfg);
  const roundness = resolveShardRoundness(shardCfg);

  if (size <= 0 || alpha <= 0)
  {
    return;
  }

  if (drawTexturedTriangle(
    context,
    particle,
    size,
    [1, 1, 1],
    alpha,
    textureFrameIndex,
    1,
    'browser-overlay',
    'none',
    1,
    opacity,
    roundness,
  ))
  {
    return;
  }

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.beginPath();
  traceRoundedTrianglePath(context, textureFrame, size, shardCfg.roundness);
  context.fillStyle = `rgba(255, 255, 255, ${clamp01(alpha)})`;
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.fill();
  context.restore();
}

function drawTriangleEmission(
  context,
  particle,
  scale,
  opacity,
  fxConfig = UNITY_FX_TOUCH,
)
{
  const shardCfg = fxConfig.shards;
  const bloomCfg = fxConfig.bloom;
  const progress = clamp01(particle.ageMs / particle.lifetimeMs);
  const size = particle.size * evaluateUnityHermiteCurve(
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
  const textureFrameIndex = resolveShardTextureFrameIndex(particle, shardCfg);
  const textureFrame = resolveShardTextureFrame(particle, shardCfg);
  const roundness = resolveShardRoundness(shardCfg);

  if (size <= 0 || alpha <= 0)
  {
    return;
  }

  if (drawTexturedTriangle(
    context,
    particle,
    size,
    materialEnergy,
    alpha,
    textureFrameIndex,
    1 / Math.max(1, bloomCfg.emissionRange),
    'scene',
    'none',
    1,
    opacity,
    roundness,
  ))
  {
    return;
  }

  context.save();
  context.translate(particle.x, particle.y);
  context.rotate(particle.rotation);
  context.beginPath();
  traceRoundedTrianglePath(context, textureFrame, size, shardCfg.roundness);
  context.fillStyle = linearEnergyToEmissionCss(
    materialEnergy,
    alpha,
    bloomCfg.emissionRange,
  );
  context.fill();
  context.restore();
}

function drawHit(
  context,
  wave,
  progress,
  scale,
  opacity,
  fxConfig,
  linearOutput = false,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const cfg = fxConfig.hit;
  const radius = cfg.radius * scale;
  const alpha = evaluateNumber(cfg.alphaKeys, progress) * opacity;
  const color = evaluateColor(cfg.colorKeys, progress);

  if (alpha <= 0)
  {
    return;
  }

  context.save();
  context.beginPath();
  context.arc(wave.x, wave.y, radius, 0, TAU);
  if (outputCompositing === 'browser-overlay')
  {
    context.fillStyle = linearEnergyToOverlayCss(
      colorToLinearEnergy(color, 1, true),
      alpha,
      alpha,
      overlayColorCompensation,
      overlayAlphaLimit,
      opacity,
    );
  }
  else if (outputCompositing === 'host-additive')
  {
    context.fillStyle = linearEnergyToHostAdditiveCss(
      colorToLinearEnergy(color, 1, true),
      alpha,
      alpha,
    );
  }
  else
  {
    context.fillStyle = colorToCanvasOutputCss(color, alpha, linearOutput);
  }
  context.fill();
  context.restore();
}

function drawFlare(
  context,
  wave,
  progress,
  scale,
  opacity,
  fxConfig,
  linearOutput = false,
  outputCompositing = 'scene',
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  const cfg = fxConfig.flare;
  const radius = cfg.radius * scale;
  const alpha = evaluateNumber(cfg.alphaKeys, progress) * opacity;
  const color = evaluateColor(cfg.colorKeys, progress);

  if (alpha <= 0)
  {
    return;
  }

  context.save();
  context.translate(wave.x, wave.y);
  // Final Pass 直接采样 Canvas 预乘颜色，因此附加粒子也必须写入线性能量。
  if (outputCompositing === 'browser-overlay')
  {
    context.strokeStyle = linearEnergyToOverlayCss(
      colorToLinearEnergy(color, 1, true),
      alpha,
      alpha,
      overlayColorCompensation,
      overlayAlphaLimit,
      opacity,
    );
  }
  else if (outputCompositing === 'host-additive')
  {
    context.strokeStyle = linearEnergyToHostAdditiveCss(
      colorToLinearEnergy(color, 1, true),
      alpha,
      alpha,
    );
  }
  else
  {
    context.strokeStyle = colorToCanvasOutputCss(color, alpha, linearOutput);
  }

  for (let i = 0; i < cfg.rayCount; i++)
  {
    const angle = (TAU / cfg.rayCount) * i;
    const endX = Math.cos(angle) * radius;
    const endY = Math.sin(angle) * radius;

    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(endX, endY);
    context.lineWidth = 1.5 * scale;
    context.stroke();
  }

  context.restore();
}

export {
  NATIVE_BLOOM_DISK_SAMPLES,
  getNativeCircleBloomSamples,
  evaluateRingLuminance,
  resolveRingIntegrationSamples,
  resolveRingGeometry,
  drawDissolvedCircle,
  drawDissolvedCircleEmission,
  drawDisk,
  drawDiskEmission,
  drawDiskCoverage,
  resolveShardTextureFrameIndex,
  resolveShardRoundness,
  drawTriangle,
  drawTriangleCoverage,
  drawTriangleEmission,
  drawHit,
  drawFlare,
};
