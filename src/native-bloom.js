import {
  gammaToLinear,
  resolveUnityBloomClamp,
  resolveUnityBloomIntensity,
} from './bloom-color-space.js';
import { calculateBloomContribution } from './software-bloom.js';

/**
 * 用材质样本的能量与二阶矩近似局部 Bloom 源。只采样已有纹理/几何，
 * 不回读 Canvas，也不分配全视口像素缓冲。
 */
export function createNativeBloomSource(settings)
{
  return {
    energy: [0, 0, 0], transport: 0, moment: 0,
    threshold: gammaToLinear(settings.threshold),
    clampMax: resolveUnityBloomClamp(settings.clamp),
    softKnee: settings.softKnee,
  };
}

export function addNativeBloomSample(source, color, area, radiusSquared)
{
  const channels = color.map((channel) => Math.min(source.clampMax, Math.max(0, channel)));
  const brightness = Math.max(...channels);

  if (brightness <= 0 || area <= 0)
  {
    return;
  }

  const contribution = calculateBloomContribution(
    brightness,
    source.threshold,
    source.softKnee,
  );
  const mass = contribution * area;

  for (let channel = 0; channel < 3; channel++)
  {
    source.energy[channel] += channels[channel] / brightness * mass;
  }
  source.transport += mass;
  source.moment += radiusSquared * mass;
}

/**
 * 圆周与二维 Gaussian 的卷积。直接积分 exp(-a * (1 - cos(theta)))
 * 避免大半径时先计算 Bessel I0 再乘极小指数造成溢出。
 */
function sampleRingKernel(distance, radius, variance)
{
  const a = distance * radius / variance;
  const limit = a > 0 ? Math.min(Math.PI, 8 / Math.sqrt(a)) : Math.PI;
  const steps = 32;
  const step = limit / steps;
  let integral = 0;

  for (let index = 0; index <= steps; index++)
  {
    const weight = index === 0 || index === steps ? 1 : index % 2 === 0 ? 2 : 4;
    integral += weight * Math.exp(-a * (1 - Math.cos(index * step)));
  }
  return Math.exp(-((distance - radius) ** 2) / (2 * variance)) *
    integral * step / (3 * Math.PI);
}

export function createNativeBloomAngularMask(sources, dpr, settings)
{
  const active = sources.filter((source) => source.transport > 0);
  if (active.length === 0 || active.some((source) => !source.angularMass))
  {
    return null;
  }

  const count = 64;
  const values = new Float64Array(count);
  let total = 0;
  let radiusMass = 0;
  for (const source of active)
  {
    total += source.transport;
    radiusMass += source.radius * source.transport;
    // 原生近场以几像素为支撑，缺口边缘也必须渐变，不能用硬扇形裁剪光晕。
    const sigma = Math.max(1, count / (2 * Math.PI) *
      2.5 / (Math.max(1, source.radius) * dpr * settings.resolutionScale));
    const reach = Math.min(count / 2, Math.ceil(sigma * 3));
    const weights = [];
    let weightSum = 0;
    for (let offset = -reach; offset <= reach; offset++)
    {
      const weight = Math.exp(-0.5 * (offset / sigma) ** 2);
      weights.push(weight);
      weightSum += weight;
    }
    for (let index = 0; index < count; index++)
    {
      for (let offset = -reach; offset <= reach; offset++)
      {
        values[index] += source.angularMass[(index + offset + count) % count] *
          weights[offset + reach] / weightSum;
      }
    }
  }
  const peak = Math.max(...values);
  if (peak <= 0)
  {
    return null;
  }
  return {
    // 径向部分按峰值补偿，Alpha 遮罩只分配角向能量，不降低剩余亮弧的强度。
    gain: peak * count / total,
    radius: radiusMass / total,
    values: Array.from(values, (value) => value / peak),
  };
}

export function createNativeBloomProfile(sources, width, height, dpr, settings)
{
  const intensity = resolveUnityBloomIntensity(settings.intensity);
  const active = sources.filter((source) => source.transport > 0);

  if (intensity <= 0 || active.length === 0)
  {
    return null;
  }

  const resolution = Math.max(0.1, Math.min(0.75, settings.resolutionScale));
  const size = Math.max(1, Math.floor(Math.max(width, height) * dpr * resolution));
  const iterations = Math.log2(size) + Math.max(0, Math.min(10, settings.diffusion)) - 10;
  const levels = Math.max(1, Math.min(16, Math.floor(iterations)));
  const sampleScale = 0.5 + iterations - Math.floor(iterations);
  const kernels = [];
  const sampleDistances = [];
  let radius = 0;

  for (const source of active)
  {
    // 各 mip 都会加回最终 Bloom，不能把能量除以层数。用同一金字塔的
    // 尺寸与采样跨度建立 Gaussian 近似，保留近场亮度和远场扩散。
    // 环带保留空心几何；把 R²/2 混进 Gaussian 方差会把整个圆环变成实心光团。
    const sourceRadius = source.radius ?? 0;
    const sourceVariance = source.radius === undefined
      ? source.moment / source.transport * 0.5
      // GPU Bloom 的多级下采样会把环带能量向内外共同扩散；仅使用
      // 几何宽度方差会保留过窄空心环，Native 视觉上因此明显发硬。
      : Math.max((source.width ?? 0) ** 2 / 12,
        sourceRadius * sourceRadius * 0.9);

    for (let level = 0; level < levels; level++)
    {
      const texel = 2 ** level / (resolution * dpr);
      const blurScale = source.blurScale ?? 1;
      // Box 金字塔的尾部比 Gaussian 更短；方差校准避免原生回退
      // 扩大可见光晕面积，导致切换后反而比 GPU 更亮。
      const blurVariance = texel * texel * (1 / 3 + sampleScale * sampleScale) *
        blurScale * blurScale * 0.85;
      const variance = Math.max(0.25, sourceVariance + blurVariance);

      const sigma = Math.sqrt(variance);
      kernels.push({ source, radius: sourceRadius, variance,
        weight: intensity / (2 * Math.PI * variance) });
      radius = Math.max(radius, sourceRadius + sigma * 4);
      if (sourceRadius > 0)
      {
        // 大环的近场只有几像素宽，需要在亮环附近加密 stop，不能只按外径均分。
        for (let offset = -3; offset <= 3; offset++)
        {
          sampleDistances.push(Math.max(0, sourceRadius + offset * sigma));
        }
      }
    }
  }

  // 非均匀 stop 给中心保留更多采样；在线性空间合并全部 mip 后才编码，
  // 避免先钳制阴影 Alpha 再模糊造成灰暗、偏色和低强度失真。
  const stops = [];
  for (let index = 0; index <= 48; index++)
  {
    sampleDistances.push(radius * (index / 48) ** 2);
  }
  const positions = [...new Set(sampleDistances.map((distance) => distance / radius))]
    .sort((left, right) => left - right);
  for (const position of positions)
  {
    const distanceSquared = (radius * position) ** 2;
    const energy = [0, 0, 0];
    let transport = 0;

    if (position < 1)
    {
      for (const kernel of kernels)
      {
        const weight = kernel.weight * (kernel.radius > 0
          ? sampleRingKernel(radius * position, kernel.radius, kernel.variance)
          : Math.exp(-distanceSquared / (2 * kernel.variance)));
        for (let channel = 0; channel < 3; channel++)
        {
          energy[channel] += kernel.source.energy[channel] * weight;
        }
        transport += kernel.source.transport * weight;
      }
    }
    stops.push({ position, energy, transport });
  }
  return { radius, stops };
}
