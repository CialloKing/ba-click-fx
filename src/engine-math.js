// 纯数值计算；保留求值顺序以保证跨后端几何一致。
import { clamp, clamp01, lerp } from './engine-shared.js';

const TAU = Math.PI * 2;

function rgbToHsl(r, g, b)
{
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;

  if (d === 0)
  {
    return [0, 0, l];
  }

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;

  if (max === r)
  {
    h = (g - b) / d + (g < b ? 6 : 0);
  }
  else if (max === g)
  {
    h = (b - r) / d + 2;
  }
  else
  {
    h = (r - g) / d + 4;
  }

  return [h / 6, s, l];
}

function hslToRgb(h, s, l)
{
  const hueToRgb = (p, q, t) =>
  {
    if (t < 0)
    {
      t += 1;
    }

    if (t > 1)
    {
      t -= 1;
    }

    if (t < 1 / 6)
    {
      return p + (q - p) * 6 * t;
    }

    if (t < 1 / 2)
    {
      return q;
    }

    if (t < 2 / 3)
    {
      return p + (q - p) * (2 / 3 - t) * 6;
    }

    return p;
  };

  if (s === 0)
  {
    return [l, l, l];
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

function smoothstep(edge0, edge1, value)
{
  const progress = clamp01((value - edge0) / (edge1 - edge0));
  return progress * progress * (3 - 2 * progress);
}

function boundsIntersect(left, right)
{
  return left.x <= right.x + right.width &&
    right.x <= left.x + left.width &&
    left.y <= right.y + right.height &&
    right.y <= left.y + left.height;
}

function mergeBloomRegion(regions, nextRegion)
{
  let index = 0;

  while (index < regions.length)
  {
    const current = regions[index];

    if (!boundsIntersect(current, nextRegion))
    {
      index++;
      continue;
    }

    const minimumX = Math.min(current.x, nextRegion.x);
    const minimumY = Math.min(current.y, nextRegion.y);
    const maximumX = Math.max(
      current.x + current.width,
      nextRegion.x + nextRegion.width,
    );
    const maximumY = Math.max(
      current.y + current.height,
      nextRegion.y + nextRegion.height,
    );

    nextRegion.x = minimumX;
    nextRegion.y = minimumY;
    nextRegion.width = maximumX - minimumX;
    nextRegion.height = maximumY - minimumY;

    const currentEmission = current.emissionBounds;
    const nextEmission = nextRegion.emissionBounds;
    const emissionMinimumX = Math.min(currentEmission.x, nextEmission.x);
    const emissionMinimumY = Math.min(currentEmission.y, nextEmission.y);
    const emissionMaximumX = Math.max(
      currentEmission.x + currentEmission.width,
      nextEmission.x + nextEmission.width,
    );
    const emissionMaximumY = Math.max(
      currentEmission.y + currentEmission.height,
      nextEmission.y + nextEmission.height,
    );

    nextEmission.x = emissionMinimumX;
    nextEmission.y = emissionMinimumY;
    nextEmission.width = emissionMaximumX - emissionMinimumX;
    nextEmission.height = emissionMaximumY - emissionMinimumY;

    for (const wave of current.waves)
    {
      if (!nextRegion.waves.includes(wave))
      {
        nextRegion.waves.push(wave);
      }
    }

    for (const batch of current.trailBatches)
    {
      if (!nextRegion.trailBatches.includes(batch))
      {
        nextRegion.trailBatches.push(batch);
      }
    }

    for (const shard of current.shards ?? [])
    {
      if (!nextRegion.shards.includes(shard))
      {
        nextRegion.shards.push(shard);
      }
    }

    regions.splice(index, 1);
    // 合并后的矩形可能触及更早跳过的区域，因此重新扫描以完成传递合并。
    index = 0;
  }

  regions.push(nextRegion);
}

function combineBloomRegionBounds(regions)
{
  if (regions.length === 0)
  {
    return null;
  }

  let minimumX = Infinity;
  let minimumY = Infinity;
  let maximumX = -Infinity;
  let maximumY = -Infinity;

  for (const region of regions)
  {
    minimumX = Math.min(minimumX, region.x);
    minimumY = Math.min(minimumY, region.y);
    maximumX = Math.max(maximumX, region.x + region.width);
    maximumY = Math.max(maximumY, region.y + region.height);
  }

  return {
    x: minimumX,
    y: minimumY,
    width: maximumX - minimumX,
    height: maximumY - minimumY,
  };
}

function random(min, max)
{
  return min + Math.random() * (max - min);
}

function evaluateNumber(keys, progress)
{
  if (!keys || keys.length === 0)
  {
    return 0;
  }

  const t = clamp01(progress);

  if (t <= keys[0][0])
  {
    return keys[0][1];
  }

  for (let index = 1; index < keys.length; index++)
  {
    const previous = keys[index - 1];
    const current = keys[index];

    if (t <= current[0])
    {
      const span = current[0] - previous[0];
      const localProgress = span > 0 ? (t - previous[0]) / span : 1;

      return lerp(previous[1], current[1], localProgress);
    }
  }

  return keys[keys.length - 1][1];
}

function evaluateUnityHermiteCurve(keys, progress)
{
  if (!keys || keys.length === 0)
  {
    return 0;
  }

  const t = clamp01(progress);

  if (t <= keys[0][0])
  {
    return keys[0][1];
  }

  for (let index = 1; index < keys.length; index++)
  {
    const previous = keys[index - 1];
    const current = keys[index];

    if (t <= current[0])
    {
      const span = current[0] - previous[0];
      const localProgress = span > 0 ? (t - previous[0]) / span : 1;
      const squared = localProgress * localProgress;
      const cubed = squared * localProgress;
      const previousOutSlope = previous[3] ?? 0;
      const currentInSlope = current[2] ?? 0;
      const h00 = 2 * cubed - 3 * squared + 1;
      const h10 = cubed - 2 * squared + localProgress;
      const h01 = -2 * cubed + 3 * squared;
      const h11 = cubed - squared;

      // Unity 的切线以“每单位曲线时间的变化量”保存，需乘当前关键帧跨度。
      return h00 * previous[1] + h10 * previousOutSlope * span +
        h01 * current[1] + h11 * currentInSlope * span;
    }
  }

  return keys[keys.length - 1][1];
}

function evaluateUnitySmoothCurve(keys, progress)
{
  if (!keys || keys.length === 0)
  {
    return 0;
  }

  const t = clamp01(progress);

  if (t <= keys[0][0])
  {
    return keys[0][1];
  }

  for (let index = 1; index < keys.length; index++)
  {
    const previous = keys[index - 1];
    const current = keys[index];

    if (t <= current[0])
    {
      const span = current[0] - previous[0];
      const localProgress = span > 0 ? (t - previous[0]) / span : 1;
      // 原 AnimationCurve 两端切线均为 0，因此区间插值就是 Hermite smoothstep。
      const easedProgress = localProgress * localProgress *
        (3 - 2 * localProgress);

      return lerp(previous[1], current[1], easedProgress);
    }
  }

  return keys[keys.length - 1][1];
}

function evaluateColor(keys, progress, output = [0, 0, 0])
{
  if (!keys || keys.length === 0)
  {
    output[0] = 0;
    output[1] = 0;
    output[2] = 0;
    return output;
  }

  const t = clamp01(progress);

  if (t <= keys[0][0])
  {
    output[0] = keys[0][1][0];
    output[1] = keys[0][1][1];
    output[2] = keys[0][1][2];
    return output;
  }

  for (let index = 1; index < keys.length; index++)
  {
    const previous = keys[index - 1];
    const current = keys[index];

    if (t <= current[0])
    {
      const span = current[0] - previous[0];
      const localProgress = span > 0 ? (t - previous[0]) / span : 1;

      output[0] = lerp(previous[1][0], current[1][0], localProgress);
      output[1] = lerp(previous[1][1], current[1][1], localProgress);
      output[2] = lerp(previous[1][2], current[1][2], localProgress);
      return output;
    }
  }

  const finalColor = keys[keys.length - 1][1];

  output[0] = finalColor[0];
  output[1] = finalColor[1];
  output[2] = finalColor[2];
  return output;
}

export { TAU, rgbToHsl, hslToRgb, smoothstep, boundsIntersect, mergeBloomRegion, combineBloomRegionBounds, random, evaluateNumber, evaluateUnityHermiteCurve, evaluateUnitySmoothCurve, evaluateColor };
