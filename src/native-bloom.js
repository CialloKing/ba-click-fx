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
  let radius = 0;

  for (const source of active)
  {
    // 各 mip 都会加回最终 Bloom，不能把能量除以层数。用同一金字塔的
    // 尺寸与采样跨度建立 Gaussian 近似，保留近场亮度和远场扩散。
    const sourceVariance = source.moment / source.transport * 0.5;

    for (let level = 0; level < levels; level++)
    {
      const texel = 2 ** level / (resolution * dpr);
      const blurScale = source.blurScale ?? 1;
      // Box 金字塔的尾部比 Gaussian 更短；方差校准避免原生回退
      // 扩大可见光晕面积，导致切换后反而比 GPU 更亮。
      const blurVariance = texel * texel * (1 / 3 + sampleScale * sampleScale) *
        blurScale * blurScale * 0.85;
      const variance = Math.max(0.25, sourceVariance + blurVariance);

      kernels.push({ source, variance, weight: intensity / (2 * Math.PI * variance) });
      radius = Math.max(radius, Math.sqrt(variance) * 4);
    }
  }

  // 非均匀 stop 给中心保留更多采样；在线性空间合并全部 mip 后才编码，
  // 避免先钳制阴影 Alpha 再模糊造成灰暗、偏色和低强度失真。
  const stops = [];
  for (let index = 0; index <= 48; index++)
  {
    const position = (index / 48) ** 2;
    const distanceSquared = (radius * position) ** 2;
    const energy = [0, 0, 0];
    let transport = 0;

    if (index < 48)
    {
      for (const kernel of kernels)
      {
        const weight = kernel.weight * Math.exp(-distanceSquared / (2 * kernel.variance));
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
