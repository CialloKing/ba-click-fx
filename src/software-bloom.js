import {
  HALF_FLOAT_MAX,
  gammaToLinear,
  resolveUnityBloomClamp,
} from './bloom-color-space.js';

const RGB_CHANNELS = 3;
const RGBA_CHANNELS = 4;
const REGION_QUANTUM = 64;
const MAX_PYRAMID_LEVELS = 16;
const DEFAULT_DIFFUSION = 7;

function clamp(value, minimum, maximum)
{
  return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value)
{
  return clamp(value, 0, 1);
}

function calculatePyramidSettings(
  displayWidth,
  displayHeight,
  resolutionScale,
  diffusion,
)
{
  const safeScale = clamp(resolutionScale, 0.1, 0.75);
  const maxSize = Math.max(
    1,
    Math.floor(displayWidth * safeScale),
    Math.floor(displayHeight * safeScale),
  );
  const logIterations = Math.log2(maxSize) +
    Math.min(Math.max(0, diffusion), 10) - 10;

  return {
    levelCount: clamp(
      Math.floor(logIterations),
      1,
      MAX_PYRAMID_LEVELS,
    ),
    sampleScale: 0.5 + logIterations - Math.floor(logIterations),
  };
}

/**
 * 将线性亮度转换为普通 Canvas/ImageData 使用的 sRGB 编码。
 */
export function linearToSrgb(value)
{
  const linear = clamp01(value);

  if (linear <= 0.0031308)
  {
    return linear * 12.92;
  }

  return 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

/**
 * 计算带 Soft Knee 的高亮贡献，与 MXFinalBloom 的预过滤公式一致。
 */
export function calculateBloomContribution(brightness, threshold, softKnee)
{
  const safeThreshold = Math.max(0, threshold);
  const knee = Math.max(safeThreshold * clamp01(softKnee), 0.00001);
  let soft = brightness - safeThreshold + knee;

  soft = clamp(soft, 0, knee * 2);
  soft = (soft * soft) / (knee * 4);

  return Math.max(brightness - safeThreshold, soft, 0);
}

function writeThresholdedColor(
  red,
  green,
  blue,
  output,
  outputIndex,
  threshold,
  softKnee,
)
{
  const brightness = Math.max(red, green, blue);

  if (brightness <= 0)
  {
    output[outputIndex] = 0;
    output[outputIndex + 1] = 0;
    output[outputIndex + 2] = 0;
    return;
  }

  const contribution = calculateBloomContribution(
    brightness,
    threshold,
    softKnee,
  );
  const multiplier = contribution / Math.max(brightness, 0.0001);

  output[outputIndex] = Math.max(0, red * multiplier);
  output[outputIndex + 1] = Math.max(0, green * multiplier);
  output[outputIndex + 2] = Math.max(0, blue * multiplier);
}

/**
 * 小数组测试和非缩放调用使用的直接高亮提取。
 */
export function extractBrightPass(
  source,
  output,
  encodingRange,
  threshold,
  softKnee,
)
{
  const pixelCount = source.length / RGBA_CHANNELS;
  const safeEncodingRange = Math.max(1, encodingRange);

  for (let pixel = 0; pixel < pixelCount; pixel++)
  {
    const sourceIndex = pixel * RGBA_CHANNELS;
    const outputIndex = pixel * RGB_CHANNELS;
    const coverage = source[sourceIndex + 3] / 255;

    writeThresholdedColor(
      source[sourceIndex] / 255 * safeEncodingRange * coverage,
      source[sourceIndex + 1] / 255 * safeEncodingRange * coverage,
      source[sourceIndex + 2] / 255 * safeEncodingRange * coverage,
      output,
      outputIndex,
      threshold,
      softKnee,
    );
  }
}

/**
 * ImageData 被当作线性 HDR 的定点封装；这里只解码，不做显示色彩转换。
 */
export function decodeEmissionMask(
  source,
  output,
  encodingRange,
  width = 0,
  height = 0,
  destinationWidth = width,
  destinationX = 0,
  destinationY = 0,
)
{
  const channelScale = Math.max(1, encodingRange) / (255 * 255);
  const hasDimensions = width > 0 && height > 0;
  const rowWidth = hasDimensions ? width : source.length / RGBA_CHANNELS;
  const rowCount = hasDimensions ? height : 1;
  const targetWidth = hasDimensions ? destinationWidth : rowWidth;
  let minimumX = targetWidth;
  let minimumY = hasDimensions ? destinationY + height : 1;
  let maximumX = -1;
  let maximumY = -1;
  let sourceIndex = 0;

  output.fill(0);

  for (let y = 0; y < rowCount; y++)
  {
    let outputIndex = hasDimensions
      ? ((destinationY + y) * targetWidth + destinationX) * RGB_CHANNELS
      : 0;

    for (let x = 0; x < rowWidth; x++)
    {
      const alpha = source[sourceIndex + 3];
      const hasEnergy = source[sourceIndex] !== 0 ||
        source[sourceIndex + 1] !== 0 ||
        source[sourceIndex + 2] !== 0;

      if (alpha !== 0 && hasEnergy)
      {
        output[outputIndex] = source[sourceIndex] * alpha * channelScale;
        output[outputIndex + 1] = source[sourceIndex + 1] * alpha * channelScale;
        output[outputIndex + 2] = source[sourceIndex + 2] * alpha * channelScale;

        if (hasDimensions)
        {
          const targetX = destinationX + x;
          const targetY = destinationY + y;

          minimumX = Math.min(minimumX, targetX);
          minimumY = Math.min(minimumY, targetY);
          maximumX = Math.max(maximumX, targetX);
          maximumY = Math.max(maximumY, targetY);
        }
      }

      sourceIndex += RGBA_CHANNELS;
      outputIndex += RGB_CHANNELS;
    }
  }

  if (maximumX < minimumX || maximumY < minimumY)
  {
    return null;
  }

  return {
    minimumX,
    minimumY,
    maximumX,
    maximumY,
  };
}

/**
 * 将独立 Coverage Canvas 的 Alpha 解码到单通道缓冲。
 *
 * HDR 发射颜色不能承担 Coverage，因为提高材质强度不应改变桌面遮挡率。
 * 调用方应把几何纹理、生命周期和全局 opacity 全部写入源 Alpha。
 */
export function decodeCoverageMask(
  source,
  output,
  width = 0,
  height = 0,
  destinationWidth = width,
  destinationX = 0,
  destinationY = 0,
)
{
  const hasDimensions = width > 0 && height > 0;
  const rowWidth = hasDimensions ? width : source.length / RGBA_CHANNELS;
  const rowCount = hasDimensions ? height : 1;
  const targetWidth = hasDimensions ? destinationWidth : rowWidth;
  let minimumX = targetWidth;
  let minimumY = hasDimensions ? destinationY + height : 1;
  let maximumX = -1;
  let maximumY = -1;
  let sourceIndex = 0;

  output.fill(0);

  for (let y = 0; y < rowCount; y++)
  {
    let outputIndex = hasDimensions
      ? (destinationY + y) * targetWidth + destinationX
      : 0;

    for (let x = 0; x < rowWidth; x++)
    {
      const coverage = source[sourceIndex + 3] / 255;

      if (coverage > 0)
      {
        output[outputIndex] = coverage;

        if (hasDimensions)
        {
          const targetX = destinationX + x;
          const targetY = destinationY + y;

          minimumX = Math.min(minimumX, targetX);
          minimumY = Math.min(minimumY, targetY);
          maximumX = Math.max(maximumX, targetX);
          maximumY = Math.max(maximumY, targetY);
        }
      }

      sourceIndex += RGBA_CHANNELS;
      outputIndex++;
    }
  }

  if (maximumX < minimumX || maximumY < minimumY)
  {
    return null;
  }

  return {
    minimumX,
    minimumY,
    maximumX,
    maximumY,
  };
}

function addBilinearRgb(
  source,
  width,
  height,
  x,
  y,
  weight,
  output,
  outputIndex,
)
{
  const safeX = clamp(x, 0, width - 1);
  const safeY = clamp(y, 0, height - 1);
  const left = Math.floor(safeX);
  const top = Math.floor(safeY);
  const right = Math.min(left + 1, width - 1);
  const bottom = Math.min(top + 1, height - 1);
  const horizontal = safeX - left;
  const vertical = safeY - top;
  const topLeftWeight = (1 - horizontal) * (1 - vertical) * weight;
  const topRightWeight = horizontal * (1 - vertical) * weight;
  const bottomLeftWeight = (1 - horizontal) * vertical * weight;
  const bottomRightWeight = horizontal * vertical * weight;
  const topLeftIndex = (top * width + left) * RGB_CHANNELS;
  const topRightIndex = (top * width + right) * RGB_CHANNELS;
  const bottomLeftIndex = (bottom * width + left) * RGB_CHANNELS;
  const bottomRightIndex = (bottom * width + right) * RGB_CHANNELS;

  for (let channel = 0; channel < RGB_CHANNELS; channel++)
  {
    output[outputIndex + channel] +=
      source[topLeftIndex + channel] * topLeftWeight +
      source[topRightIndex + channel] * topRightWeight +
      source[bottomLeftIndex + channel] * bottomLeftWeight +
      source[bottomRightIndex + channel] * bottomRightWeight;
  }
}

function sampleBilinearScalar(source, width, height, x, y)
{
  const safeX = clamp(x, 0, width - 1);
  const safeY = clamp(y, 0, height - 1);
  const left = Math.floor(safeX);
  const top = Math.floor(safeY);
  const right = Math.min(left + 1, width - 1);
  const bottom = Math.min(top + 1, height - 1);
  const horizontal = safeX - left;
  const vertical = safeY - top;

  return source[top * width + left] * (1 - horizontal) * (1 - vertical) +
    source[top * width + right] * horizontal * (1 - vertical) +
    source[bottom * width + left] * (1 - horizontal) * vertical +
    source[bottom * width + right] * horizontal * vertical;
}

function filterBoxCoverage(
  source,
  sourceWidth,
  sourceHeight,
  output,
  outputWidth,
  outputHeight,
  sampleOffset,
  sourceBounds = null,
)
{
  const scaleX = sourceWidth / outputWidth;
  const scaleY = sourceHeight / outputHeight;
  let startX = 0;
  let startY = 0;
  let endX = outputWidth;
  let endY = outputHeight;

  output.fill(0);

  if (sourceBounds)
  {
    startX = clamp(
      Math.floor((sourceBounds.minimumX - 2) / scaleX) - 1,
      0,
      outputWidth,
    );
    startY = clamp(
      Math.floor((sourceBounds.minimumY - 2) / scaleY) - 1,
      0,
      outputHeight,
    );
    endX = clamp(
      Math.ceil((sourceBounds.maximumX + 3) / scaleX) + 1,
      0,
      outputWidth,
    );
    endY = clamp(
      Math.ceil((sourceBounds.maximumY + 3) / scaleY) + 1,
      0,
      outputHeight,
    );
  }

  for (let y = startY; y < endY; y++)
  {
    const sourceY = (y + 0.5) * scaleY - 0.5;

    for (let x = startX; x < endX; x++)
    {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      let coverage = 0;

      for (const offsetX of [-sampleOffset, sampleOffset])
      {
        for (const offsetY of [-sampleOffset, sampleOffset])
        {
          coverage += sampleBilinearScalar(
            source,
            sourceWidth,
            sourceHeight,
            sourceX + offsetX,
            sourceY + offsetY,
          ) * 0.25;
        }
      }

      // Coverage 只经过空间滤波，不受 HDR 阈值、强度或色相影响。
      output[y * outputWidth + x] = clamp01(coverage);
    }
  }
}

function upsampleBloomCoverage(
  high,
  highWidth,
  highHeight,
  low,
  lowWidth,
  lowHeight,
  output,
  sampleScale,
)
{
  const scaleX = lowWidth / highWidth;
  const scaleY = lowHeight / highHeight;
  const offset = Math.max(0, sampleScale) * 0.5;

  output.fill(0);

  for (let y = 0; y < highHeight; y++)
  {
    const lowY = (y + 0.5) * scaleY - 0.5;

    for (let x = 0; x < highWidth; x++)
    {
      const lowX = (x + 0.5) * scaleX - 0.5;
      let lowCoverage = 0;

      for (const offsetX of [-offset, offset])
      {
        for (const offsetY of [-offset, offset])
        {
          lowCoverage += sampleBilinearScalar(
            low,
            lowWidth,
            lowHeight,
            lowX + offsetX,
            lowY + offsetY,
          ) * 0.25;
        }
      }

      const outputIndex = y * highWidth + x;

      // 相邻 mip 属于同一几何，取最大值扩散而不重复累加 Coverage。
      output[outputIndex] = Math.max(
        clamp01(high[outputIndex]),
        clamp01(lowCoverage),
      );
    }
  }
}

/**
 * 从全分辨率发射遮罩生成半分辨率 mip0，并执行 MXFinalBloom Box4 预过滤。
 */
export function prefilterBloom(
  source,
  sourceWidth,
  sourceHeight,
  output,
  outputWidth,
  outputHeight,
  threshold,
  softKnee,
  // 这里接收的是已换算的 Linear 值；Unity Shader 最终受 half 上限约束。
  clampMax = HALF_FLOAT_MAX,
  highQualityFiltering = true,
  sourceTexelAspect = sourceHeight / sourceWidth,
  sourceBounds = null,
)
{
  const scaleX = sourceWidth / outputWidth;
  const scaleY = sourceHeight / outputHeight;
  let startX = 0;
  let startY = 0;
  let endX = outputWidth;
  let endY = outputHeight;
  let activeMinimumX = outputWidth;
  let activeMinimumY = outputHeight;
  let activeMaximumX = -1;
  let activeMaximumY = -1;

  output.fill(0);

  if (sourceBounds)
  {
    startX = clamp(
      Math.floor((sourceBounds.minimumX - 2) / scaleX) - 1,
      0,
      outputWidth,
    );
    startY = clamp(
      Math.floor((sourceBounds.minimumY - 2) / scaleY) - 1,
      0,
      outputHeight,
    );
    endX = clamp(
      Math.ceil((sourceBounds.maximumX + 3) / scaleX) + 1,
      0,
      outputWidth,
    );
    endY = clamp(
      Math.ceil((sourceBounds.maximumY + 3) / scaleY) + 1,
      0,
      outputHeight,
    );
  }

  for (let y = startY; y < endY; y++)
  {
    const sourceY = (y + 0.5) * scaleY - 0.5;

    for (let x = startX; x < endX; x++)
    {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const outputIndex = (y * outputWidth + x) * RGB_CHANNELS;

      output[outputIndex] = 0;
      output[outputIndex + 1] = 0;
      output[outputIndex + 2] = 0;

      for (const offsetX of [-1, 1])
      {
        for (const offsetY of [-1, 1])
        {
          addBilinearRgb(
            source,
            sourceWidth,
            sourceHeight,
            sourceX + offsetX,
            sourceY + offsetY,
            0.25,
            output,
            outputIndex,
          );
        }
      }

      writeThresholdedColor(
        Math.min(clampMax, output[outputIndex]),
        Math.min(clampMax, output[outputIndex + 1]),
        Math.min(clampMax, output[outputIndex + 2]),
        output,
        outputIndex,
        threshold,
        softKnee,
      );

      if (Math.max(
        output[outputIndex],
        output[outputIndex + 1],
        output[outputIndex + 2],
      ) > 0)
      {
        activeMinimumX = Math.min(activeMinimumX, x);
        activeMinimumY = Math.min(activeMinimumY, y);
        activeMaximumX = Math.max(activeMaximumX, x);
        activeMaximumY = Math.max(activeMaximumY, y);
      }
    }
  }

  if (activeMaximumX < activeMinimumX || activeMaximumY < activeMinimumY)
  {
    return null;
  }

  return {
    minimumX: activeMinimumX,
    minimumY: activeMinimumY,
    maximumX: activeMaximumX,
    maximumY: activeMaximumY,
  };
}

/**
 * 对上一层执行 MXFinalBloom 的 4-tap 盒式降采样。
 */
function downsampleBox(
  source,
  sourceWidth,
  sourceHeight,
  output,
  outputWidth,
  outputHeight,
)
{
  const scaleX = sourceWidth / outputWidth;
  const scaleY = sourceHeight / outputHeight;
  let activeMinimumX = outputWidth;
  let activeMinimumY = outputHeight;
  let activeMaximumX = -1;
  let activeMaximumY = -1;

  output.fill(0);

  for (let y = 0; y < outputHeight; y++)
  {
    const sourceY = (y + 0.5) * scaleY - 0.5;

    for (let x = 0; x < outputWidth; x++)
    {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const outputIndex = (y * outputWidth + x) * RGB_CHANNELS;

      for (const offsetX of [-1, 1])
      {
        for (const offsetY of [-1, 1])
        {
          addBilinearRgb(
            source,
            sourceWidth,
            sourceHeight,
            sourceX + offsetX,
            sourceY + offsetY,
            0.25,
            output,
            outputIndex,
          );
        }
      }

      if (Math.max(
        output[outputIndex],
        output[outputIndex + 1],
        output[outputIndex + 2],
      ) > 0)
      {
        activeMinimumX = Math.min(activeMinimumX, x);
        activeMinimumY = Math.min(activeMinimumY, y);
        activeMaximumX = Math.max(activeMaximumX, x);
        activeMaximumY = Math.max(activeMaximumY, y);
      }
    }
  }

  if (activeMaximumX < activeMinimumX || activeMaximumY < activeMinimumY)
  {
    return null;
  }

  return {
    minimumX: activeMinimumX,
    minimumY: activeMinimumY,
    maximumX: activeMaximumX,
    maximumY: activeMaximumY,
  };
}

export function downsampleGaussian(
  source,
  sourceWidth,
  sourceHeight,
  scratch,
  output,
  outputWidth,
  outputHeight,
  sourceBounds = null,
)
{
  // 保留导出名以兼容现有调用方，内部语义已切换为游戏的 Box4。
  return downsampleBox(
    source,
    sourceWidth,
    sourceHeight,
    output,
    outputWidth,
    outputHeight,
  );
}

/**
 * MXFinalBloom 反向金字塔：细层中心值加上粗层 4-tap 累积值。
 */
function upsampleBoxAndAdd(
  high,
  highWidth,
  highHeight,
  low,
  lowWidth,
  lowHeight,
  output,
  sampleScale,
)
{
  const scaleX = lowWidth / highWidth;
  const scaleY = lowHeight / highHeight;
  const offset = Math.max(0, sampleScale) * 0.5;

  output.fill(0);

  for (let y = 0; y < highHeight; y++)
  {
    const lowY = (y + 0.5) * scaleY - 0.5;

    for (let x = 0; x < highWidth; x++)
    {
      const lowX = (x + 0.5) * scaleX - 0.5;
      const outputIndex = (y * highWidth + x) * RGB_CHANNELS;

      output[outputIndex] = high[outputIndex];
      output[outputIndex + 1] = high[outputIndex + 1];
      output[outputIndex + 2] = high[outputIndex + 2];

      for (const offsetX of [-offset, offset])
      {
        for (const offsetY of [-offset, offset])
        {
          addBilinearRgb(
            low,
            lowWidth,
            lowHeight,
            lowX + offsetX,
            lowY + offsetY,
            0.25,
            output,
            outputIndex,
          );
        }
      }
    }
  }

  return {
    minimumX: 0,
    minimumY: 0,
    maximumX: highWidth - 1,
    maximumY: highHeight - 1,
  };
}

export function upsampleAndMixBloom(
  high,
  highWidth,
  highHeight,
  low,
  lowWidth,
  lowHeight,
  output,
  scatter,
  highQualityFiltering = true,
  highBounds = null,
  lowBounds = null,
)
{
  // 参数名 scatter 为兼容旧 API 保留；值现表示 MXFinalBloom SampleScale。
  return upsampleBoxAndAdd(
    high,
    highWidth,
    highHeight,
    low,
    lowWidth,
    lowHeight,
    output,
    scatter,
  );
}

/**
 * 将线性 HDR Bloom 转成可由透明 Canvas 保存的 sRGB 贡献。
 *
 * scene 保留原有的加色编码。transparent-overlay 的目标 Alpha 只读取独立
 * Coverage，并输出 source-over 所需的残余 Alpha；HDR RGB 不能反向抬高 Alpha。
 */
export function encodeAdditiveBloom(
  source,
  output,
  intensity,
  width = source.length / RGB_CHANNELS,
  bounds = null,
  edgeCorrection = null,
  options = null,
)
{
  const safeIntensity = Math.pow(2, Math.max(0, intensity) / 10) - 1;
  const transparentOverlay =
    options?.outputCompositing === 'transparent-overlay';
  const coverage = transparentOverlay ? options?.coverage : null;
  const sceneCoverage = transparentOverlay
    ? options?.sceneCoverage
    : null;
  const safeWidth = Math.max(1, Math.floor(width));
  const sourceHeight = Math.ceil(
    source.length / (safeWidth * RGB_CHANNELS),
  );
  const startX = bounds
    ? clamp(Math.floor(bounds.minimumX), 0, safeWidth)
    : 0;
  const startY = bounds
    ? clamp(Math.floor(bounds.minimumY), 0, sourceHeight)
    : 0;
  const endX = bounds
    ? clamp(Math.ceil(bounds.maximumX + 1), startX, safeWidth)
    : safeWidth;
  const endY = bounds
    ? clamp(Math.ceil(bounds.maximumY + 1), startY, sourceHeight)
    : sourceHeight;
  const feather = Math.max(1, edgeCorrection?.feather ?? 1);
  const leftFloor = edgeCorrection?.left;
  const rightFloor = edgeCorrection?.right;
  const topFloor = edgeCorrection?.top;
  const bottomFloor = edgeCorrection?.bottom;

  for (let y = startY; y < endY; y++)
  {
    let sourceIndex = (y * safeWidth + startX) * RGB_CHANNELS;
    let outputIndex = (y * safeWidth + startX) * RGBA_CHANNELS;
    const topWeight = topFloor
      ? smoothBloomEdgeWeight(y - edgeCorrection.minimumY, feather)
      : 0;
    const bottomWeight = bottomFloor
      ? smoothBloomEdgeWeight(edgeCorrection.maximumY - y, feather)
      : 0;
    const verticalRedFloor = Math.max(
      (topFloor?.[0] ?? 0) * topWeight,
      (bottomFloor?.[0] ?? 0) * bottomWeight,
    );
    const verticalGreenFloor = Math.max(
      (topFloor?.[1] ?? 0) * topWeight,
      (bottomFloor?.[1] ?? 0) * bottomWeight,
    );
    const verticalBlueFloor = Math.max(
      (topFloor?.[2] ?? 0) * topWeight,
      (bottomFloor?.[2] ?? 0) * bottomWeight,
    );

    for (let x = startX; x < endX; x++)
    {
      const leftWeight = leftFloor
        ? smoothBloomEdgeWeight(x - edgeCorrection.minimumX, feather)
        : 0;
      const rightWeight = rightFloor
        ? smoothBloomEdgeWeight(edgeCorrection.maximumX - x, feather)
        : 0;
      const redFloor = Math.max(
        verticalRedFloor,
        (leftFloor?.[0] ?? 0) * leftWeight,
        (rightFloor?.[0] ?? 0) * rightWeight,
      );
      const greenFloor = Math.max(
        verticalGreenFloor,
        (leftFloor?.[1] ?? 0) * leftWeight,
        (rightFloor?.[1] ?? 0) * rightWeight,
      );
      const blueFloor = Math.max(
        verticalBlueFloor,
        (leftFloor?.[2] ?? 0) * leftWeight,
        (rightFloor?.[2] ?? 0) * rightWeight,
      );
      const red = linearToSrgb(Math.max(
        0,
        source[sourceIndex] - redFloor,
      ) * safeIntensity);
      const green = linearToSrgb(Math.max(
        0,
        source[sourceIndex + 1] - greenFloor,
      ) * safeIntensity);
      const blue = linearToSrgb(Math.max(
        0,
        source[sourceIndex + 2] - blueFloor,
      ) * safeIntensity);
      const maximumSrgb = Math.max(red, green, blue);
      const pixelIndex = y * safeWidth + x;
      let alpha = maximumSrgb;

      if (transparentOverlay)
      {
        const sceneAlpha = clamp01(sceneCoverage?.[pixelIndex] ?? 0);
        const bloomAlpha = clamp01(coverage?.[pixelIndex] ?? 0);
        const targetAlpha = Math.max(sceneAlpha, bloomAlpha);

        // 主清晰层已经在目标 Canvas。求 source-over 的残余源 Alpha，令
        // residual + scene * (1 - residual) = max(scene, bloom)。
        // scene 已覆盖目标时必须输出零，不能用 union 再抬高点击中心。
        alpha = targetAlpha > sceneAlpha && sceneAlpha < 1
          ? clamp01((targetAlpha - sceneAlpha) / (1 - sceneAlpha))
          : 0;
      }

      if (maximumSrgb <= 0.00001 || alpha <= 0.00001)
      {
        output[outputIndex] = 0;
        output[outputIndex + 1] = 0;
        output[outputIndex + 2] = 0;
        output[outputIndex + 3] = 0;
      }
      else
      {
        // ImageData 保存非预乘 RGB。以 max(alpha, maximumSrgb) 归一化后，
        // Canvas 实际预乘结果严格不超过 Alpha，并保持 HDR 色相。
        const normalization = transparentOverlay
          ? Math.max(alpha, maximumSrgb)
          : alpha;

        output[outputIndex] = Math.round(
          clamp01(red / normalization) * 255,
        );
        output[outputIndex + 1] = Math.round(
          clamp01(green / normalization) * 255,
        );
        output[outputIndex + 2] = Math.round(
          clamp01(blue / normalization) * 255,
        );
        output[outputIndex + 3] = Math.round(alpha * 255);
      }

      sourceIndex += RGB_CHANNELS;
      outputIndex += RGBA_CHANNELS;
    }
  }
}

function filterBloomForComposite(
  source,
  width,
  height,
  output,
  sampleScale,
)
{
  const offset = Math.max(0, sampleScale) * 0.5;

  output.fill(0);

  for (let y = 0; y < height; y++)
  {
    for (let x = 0; x < width; x++)
    {
      const outputIndex = (y * width + x) * RGB_CHANNELS;

      for (const offsetX of [-offset, offset])
      {
        for (const offsetY of [-offset, offset])
        {
          addBilinearRgb(
            source,
            width,
            height,
            x + offsetX,
            y + offsetY,
            0.25,
            output,
            outputIndex,
          );
        }
      }
    }
  }
}

function smoothBloomEdgeWeight(distance, feather)
{
  const normalized = clamp01(1 - Math.max(0, distance) / feather);

  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * 最深层 mip 会在局部缓冲中形成接近常量的低频底色。全屏管线中该能量
 * 会继续向画面外扩散；局部裁剪则会把它截成矩形。这里只记录每条人工
 * 边界的基线，编码时再向内部平滑减弱，避免全局扣除压暗真实外晕。
 */
function calculateBloomEdgeCorrection(source, width, height, bounds, edges)
{
  if (!bounds || (
    !edges.left && !edges.right && !edges.top && !edges.bottom
  ))
  {
    return null;
  }

  const minimumX = clamp(Math.floor(bounds.minimumX), 0, width - 1);
  const minimumY = clamp(Math.floor(bounds.minimumY), 0, height - 1);
  const maximumX = clamp(Math.ceil(bounds.maximumX), minimumX, width - 1);
  const maximumY = clamp(Math.ceil(bounds.maximumY), minimumY, height - 1);
  const sampleEdge = (visit) =>
  {
    const floor = [0, 0, 0];

    visit((x, y) =>
    {
      const index = (y * width + x) * RGB_CHANNELS;

      for (let channel = 0; channel < RGB_CHANNELS; channel++)
      {
        floor[channel] = Math.max(floor[channel], source[index + channel]);
      }
    });

    return floor;
  };
  const correction =
  {
    minimumX,
    minimumY,
    maximumX,
    maximumY,
    // 半分辨率 Bloom 中最多渐退 16 px，足以隐藏边界且不会触及主体。
    feather: clamp(Math.round(Math.min(
      maximumX - minimumX + 1,
      maximumY - minimumY + 1,
    ) * 0.125), 2, 16),
    left: null,
    right: null,
    top: null,
    bottom: null,
  };

  if (edges.top)
  {
    correction.top = sampleEdge((sample) =>
    {
      for (let x = minimumX; x <= maximumX; x++)
      {
        sample(x, minimumY);
      }
    });
  }

  if (edges.bottom)
  {
    correction.bottom = sampleEdge((sample) =>
    {
      for (let x = minimumX; x <= maximumX; x++)
      {
        sample(x, maximumY);
      }
    });
  }

  if (edges.left)
  {
    correction.left = sampleEdge((sample) =>
    {
      for (let y = minimumY; y <= maximumY; y++)
      {
        sample(minimumX, y);
      }
    });
  }

  if (edges.right)
  {
    correction.right = sampleEdge((sample) =>
    {
      for (let y = minimumY; y <= maximumY; y++)
      {
        sample(maximumX, y);
      }
    });
  }

  return correction;
}

/**
 * 一个实例只持有一套金字塔缓冲；模块加载时不访问 DOM，兼容 SSR。
 */
export class SoftwareBloomRenderer
{
  constructor(createCanvas)
  {
    this.createCanvas = createCanvas;
    this.sourceCanvas = createCanvas();
    this.outputCanvas = createCanvas();
    this.sourceContext = this.sourceCanvas?.getContext?.(
      '2d',
      {
        alpha: true,
        willReadFrequently: true,
      },
    );
    this.outputContext = this.outputCanvas?.getContext?.('2d', { alpha: true });
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.width = 0;
    this.height = 0;
    this.originX = 0;
    this.originY = 0;
    this.regionWidth = 0;
    this.regionHeight = 0;
    this.resolutionScale = 0;
    this.diffusion = 0;
    this.sampleScale = 1;
    this.displayWidth = 0;
    this.displayHeight = 0;
    this.displayCssWidth = 0;
    this.displayCssHeight = 0;
    this.sourceLinear = new Float32Array(0);
    // 透明覆盖层才需要 Coverage；scene 实例不会创建 Canvas 或分配金字塔。
    this.coverageCanvas = null;
    this.coverageContext = null;
    this.sourceCoverage = new Float32Array(0);
    this.coverageLevels = [];
    this.coverageLevelStorage = [];
    this.coverageFrameReady = false;
    this.levels = [];
    this.levelStorage = [];
    this.outputImageData = null;
    this.outputBounds = null;
    this.sourceReadBounds = null;
    this.floatBufferAllocationCount = 0;
    this.available = Boolean(
      this.sourceContext &&
      this.outputContext &&
      typeof this.sourceContext.getImageData === 'function' &&
      typeof this.outputContext.createImageData === 'function' &&
      typeof this.outputContext.putImageData === 'function',
    );
  }

  _resizeFloatBuffer(buffer, length)
  {
    const capacity = buffer.buffer.byteLength / Float32Array.BYTES_PER_ELEMENT;

    if (capacity < length)
    {
      // 留出 50% 增长余量，密集点击导致区域小幅波动时不再逐帧制造大块 GC。
      const nextCapacity = Math.max(length, Math.ceil(capacity * 1.5));

      this.floatBufferAllocationCount++;
      return new Float32Array(nextCapacity).subarray(0, length);
    }

    if (buffer.length === length)
    {
      return buffer;
    }

    return new Float32Array(buffer.buffer, 0, length);
  }

  _ensureCanvasCapacity(canvas, width, height)
  {
    if (canvas.width >= width && canvas.height >= height)
    {
      return;
    }

    // Canvas backing store 只增长不收缩，避免量化区域尺寸来回变化时重复分配。
    canvas.width = Math.max(canvas.width, width);
    canvas.height = Math.max(canvas.height, height);
  }

  _ensureCoverageSurface()
  {
    if (this.coverageContext)
    {
      return true;
    }

    const canvas = this.createCanvas?.();
    const context = canvas?.getContext?.(
      '2d',
      {
        alpha: true,
        willReadFrequently: true,
      },
    );

    if (!canvas || !context || typeof context.getImageData !== 'function')
    {
      return false;
    }

    this.coverageCanvas = canvas;
    this.coverageContext = context;
    return true;
  }

  _ensureCoverageBuffers()
  {
    this.sourceCoverage = this._resizeFloatBuffer(
      this.sourceCoverage,
      this.sourceWidth * this.sourceHeight,
    );
    this.coverageLevels = this.levels.map((level, index) =>
    {
      const length = level.width * level.height;
      const storage = this.coverageLevelStorage[index] ?? {
        width: 0,
        height: 0,
        down: new Float32Array(0),
        up: new Float32Array(0),
        scratch: new Float32Array(0),
      };

      storage.width = level.width;
      storage.height = level.height;
      storage.down = this._resizeFloatBuffer(storage.down, length);
      storage.up = this._resizeFloatBuffer(storage.up, length);
      storage.scratch = this._resizeFloatBuffer(storage.scratch, length);
      this.coverageLevelStorage[index] = storage;

      return storage;
    });

    return this.coverageLevels.length === this.levels.length;
  }

  _resize(
    regionWidth,
    regionHeight,
    resolutionScale,
    displayWidth,
    displayHeight,
    diffusion,
    samplingScale,
  )
  {
    const safeScale = clamp(resolutionScale, 0.1, 0.75);
    // Unity 按 RenderTexture 物理像素执行后处理；高 DPR 页面也必须先以
    // 物理像素光栅化发射几何，再从半分辨率 mip0 开始，不能停留在 CSS 像素。
    const sourceWidth = Math.max(1, Math.round(regionWidth * samplingScale));
    const sourceHeight = Math.max(1, Math.round(regionHeight * samplingScale));
    const width = Math.max(1, Math.floor(sourceWidth * safeScale));
    const height = Math.max(1, Math.floor(sourceHeight * safeScale));
    const pyramid = calculatePyramidSettings(
      displayWidth,
      displayHeight,
      safeScale,
      diffusion,
    );
    const desiredLevelCount = pyramid.levelCount;
    const dimensions = [];
    let levelWidth = width;
    let levelHeight = height;

    for (let level = 0; level < desiredLevelCount; level++)
    {
      dimensions.push([levelWidth, levelHeight]);

      if (levelWidth === 1 && levelHeight === 1)
      {
        break;
      }

      levelWidth = Math.max(1, levelWidth >> 1);
      levelHeight = Math.max(1, levelHeight >> 1);
    }

    const sameDimensions =
      sourceWidth === this.sourceWidth &&
      sourceHeight === this.sourceHeight &&
      width === this.width &&
      height === this.height &&
      dimensions.length === this.levels.length &&
      dimensions.every(([nextWidth, nextHeight], index) =>
        this.levels[index]?.width === nextWidth &&
          this.levels[index]?.height === nextHeight);

    this.regionWidth = regionWidth;
    this.regionHeight = regionHeight;
    this.resolutionScale = safeScale;
    this.displayWidth = displayWidth;
    this.displayHeight = displayHeight;
    this.diffusion = diffusion;
    this.sampleScale = pyramid.sampleScale;

    if (sameDimensions)
    {
      return true;
    }

    this.sourceWidth = sourceWidth;
    this.sourceHeight = sourceHeight;
    this.width = width;
    this.height = height;
    this._ensureCanvasCapacity(
      this.sourceCanvas,
      sourceWidth,
      sourceHeight,
    );
    this._ensureCanvasCapacity(this.outputCanvas, width, height);
    this.sourceLinear = this._resizeFloatBuffer(
      this.sourceLinear,
      sourceWidth * sourceHeight * RGB_CHANNELS,
    );
    this.levels = dimensions.map(([nextWidth, nextHeight], index) =>
    {
      const length = nextWidth * nextHeight * RGB_CHANNELS;
      const storage = this.levelStorage[index] ?? {
        width: 0,
        height: 0,
        down: new Float32Array(0),
        up: new Float32Array(0),
        scratch: new Float32Array(0),
      };

      storage.width = nextWidth;
      storage.height = nextHeight;
      storage.down = this._resizeFloatBuffer(storage.down, length);
      storage.up = this._resizeFloatBuffer(storage.up, length);
      storage.scratch = this._resizeFloatBuffer(storage.scratch, length);
      this.levelStorage[index] = storage;

      return storage;
    });

    try
    {
      this.outputImageData = this.outputContext.createImageData(width, height);
      // Canvas 容量可能没有变化；尺寸切换时仍需清掉旧活动区域，
      // 否则局部 putImageData 不会覆盖包围框外的上一帧辉光。
      this.outputContext.clearRect(
        0,
        0,
        this.outputCanvas.width,
        this.outputCanvas.height,
      );
      this.outputBounds = null;
    }
    catch
    {
      this.available = false;
      this.outputImageData = null;
      return false;
    }

    return true;
  }

  beginFrame(
    displayWidth,
    displayHeight,
    resolutionScale,
    bounds,
    diffusion = DEFAULT_DIFFUSION,
    samplingScale = 1,
    emissionBounds = bounds,
  )
  {
    this.coverageFrameReady = false;

    if (!this.available || !bounds)
    {
      return null;
    }

    const safeSamplingScale = clamp(samplingScale, 1, 4);
    this.displayCssWidth = displayWidth;
    this.displayCssHeight = displayHeight;
    const pixelDisplayWidth = Math.max(1, Math.round(
      displayWidth * safeSamplingScale,
    ));
    const pixelDisplayHeight = Math.max(1, Math.round(
      displayHeight * safeSamplingScale,
    ));
    const levelCount = calculatePyramidSettings(
      pixelDisplayWidth,
      pixelDisplayHeight,
      resolutionScale,
      diffusion,
    ).levelCount;
    const regionQuantum = Math.max(
      REGION_QUANTUM,
      2 ** Math.max(0, levelCount - 1),
    );
    const leftPixels = clamp(
      Math.floor(bounds.x * safeSamplingScale / regionQuantum) * regionQuantum,
      0,
      pixelDisplayWidth,
    );
    const topPixels = clamp(
      Math.floor(bounds.y * safeSamplingScale / regionQuantum) * regionQuantum,
      0,
      pixelDisplayHeight,
    );
    const rightPixels = clamp(
      Math.ceil(
        (bounds.x + bounds.width) * safeSamplingScale / regionQuantum,
      ) * regionQuantum,
      0,
      pixelDisplayWidth,
    );
    const bottomPixels = clamp(
      Math.ceil(
        (bounds.y + bounds.height) * safeSamplingScale / regionQuantum,
      ) * regionQuantum,
      0,
      pixelDisplayHeight,
    );
    const left = leftPixels / safeSamplingScale;
    const top = topPixels / safeSamplingScale;
    const right = rightPixels / safeSamplingScale;
    const bottom = bottomPixels / safeSamplingScale;
    const regionWidth = right - left;
    const regionHeight = bottom - top;

    if (
      regionWidth <= 0 ||
      regionHeight <= 0 ||
      !this._resize(
        regionWidth,
        regionHeight,
        resolutionScale,
        pixelDisplayWidth,
        pixelDisplayHeight,
        diffusion,
        safeSamplingScale,
      )
    )
    {
      return null;
    }

    this.originX = left;
    this.originY = top;

    const scaleX = this.sourceWidth / regionWidth;
    const scaleY = this.sourceHeight / regionHeight;
    const safeEmissionBounds = emissionBounds ?? bounds;
    // 发射几何不含模糊；只回读它实际覆盖的子矩形。额外 2px 保留
    // Canvas 抗锯齿边缘和 HQ 预过滤的双线性采样支撑范围。
    const readPadding = 2;
    const readLeft = clamp(
      Math.floor((safeEmissionBounds.x - left) * scaleX) - readPadding,
      0,
      this.sourceWidth,
    );
    const readTop = clamp(
      Math.floor((safeEmissionBounds.y - top) * scaleY) - readPadding,
      0,
      this.sourceHeight,
    );
    const readRight = clamp(
      Math.ceil(
        (safeEmissionBounds.x + safeEmissionBounds.width - left) * scaleX,
      ) + readPadding,
      readLeft,
      this.sourceWidth,
    );
    const readBottom = clamp(
      Math.ceil(
        (safeEmissionBounds.y + safeEmissionBounds.height - top) * scaleY,
      ) + readPadding,
      readTop,
      this.sourceHeight,
    );

    this.sourceReadBounds = {
      x: readLeft,
      y: readTop,
      width: readRight - readLeft,
      height: readBottom - readTop,
    };

    this.sourceContext.setTransform(1, 0, 0, 1, 0, 0);
    this.sourceContext.clearRect(0, 0, this.sourceWidth, this.sourceHeight);
    this.sourceContext.setTransform(
      scaleX,
      0,
      0,
      scaleY,
      -left * scaleX,
      -top * scaleY,
    );
    this.sourceContext.globalCompositeOperation = 'lighter';

    return this.sourceContext;
  }

  /**
   * 为 transparent-overlay 准备独立 Coverage 源。
   *
   * 调用方应在 beginFrame() 之后调用，并使用白色几何把纹理 Coverage、
   * 生命周期 Alpha 与全局 opacity 写入返回 Context 的 Alpha。
   */
  beginCoverageFrame(outputCompositing = 'scene')
  {
    this.coverageFrameReady = false;

    if (outputCompositing !== 'transparent-overlay')
    {
      return null;
    }

    if (
      !this.available ||
      this.sourceWidth <= 0 ||
      this.sourceHeight <= 0 ||
      this.regionWidth <= 0 ||
      this.regionHeight <= 0 ||
      !this._ensureCoverageSurface()
    )
    {
      return null;
    }

    this._ensureCanvasCapacity(
      this.coverageCanvas,
      this.sourceWidth,
      this.sourceHeight,
    );
    const scaleX = this.sourceWidth / this.regionWidth;
    const scaleY = this.sourceHeight / this.regionHeight;

    this.coverageContext.setTransform(1, 0, 0, 1, 0, 0);
    this.coverageContext.clearRect(
      0,
      0,
      this.sourceWidth,
      this.sourceHeight,
    );
    this.coverageContext.setTransform(
      scaleX,
      0,
      0,
      scaleY,
      -this.originX * scaleX,
      -this.originY * scaleY,
    );
    // source-over 保存多个粒子 Coverage 的并集，不能像 HDR RGB 一样相加。
    this.coverageContext.globalCompositeOperation = 'source-over';
    this.coverageFrameReady = true;

    return this.coverageContext;
  }

  composite(targetContext, settings)
  {
    if (
      !this.available ||
      !this.outputImageData ||
      this.levels.length === 0
    )
    {
      return false;
    }

    const transparentOverlay =
      settings.outputCompositing === 'transparent-overlay';

    if (
      transparentOverlay &&
      (!this.coverageFrameReady || !this._ensureCoverageBuffers())
    )
    {
      // 缺少 Coverage 时不能退回 maxRGB，否则会重新引入不透明中心。
      return false;
    }

    const readBounds = this.sourceReadBounds ?? {
      x: 0,
      y: 0,
      width: this.sourceWidth,
      height: this.sourceHeight,
    };
    let emissionBounds = null;
    let coverageBounds = null;

    if (readBounds.width > 0 && readBounds.height > 0)
    {
      let sourceImageData;
      let coverageImageData;

      try
      {
        sourceImageData = this.sourceContext.getImageData(
          readBounds.x,
          readBounds.y,
          readBounds.width,
          readBounds.height,
        );

        if (transparentOverlay)
        {
          coverageImageData = this.coverageContext.getImageData(
            readBounds.x,
            readBounds.y,
            readBounds.width,
            readBounds.height,
          );
        }
      }
      catch
      {
        // 回读失败后永久使用原生回退，避免每帧重复触发异常。
        this.available = false;
        return false;
      }

      emissionBounds = decodeEmissionMask(
        sourceImageData.data,
        this.sourceLinear,
        settings.encodingRange,
        readBounds.width,
        readBounds.height,
        this.sourceWidth,
        readBounds.x,
        readBounds.y,
      );

      if (transparentOverlay)
      {
        coverageBounds = decodeCoverageMask(
          coverageImageData.data,
          this.sourceCoverage,
          readBounds.width,
          readBounds.height,
          this.sourceWidth,
          readBounds.x,
          readBounds.y,
        );
      }
    }
    else
    {
      // 发射几何完全在屏幕外时不存在可回读像素，但这不是 Canvas 故障。
      this.sourceLinear.fill(0);

      if (transparentOverlay)
      {
        this.sourceCoverage.fill(0);
      }
    }

    this.coverageFrameReady = false;

    const firstLevel = this.levels[0];
    const firstCoverageLevel = transparentOverlay
      ? this.coverageLevels[0]
      : null;

    const activeBounds = [];

    activeBounds[0] = prefilterBloom(
      this.sourceLinear,
      this.sourceWidth,
      this.sourceHeight,
      firstLevel.down,
      firstLevel.width,
      firstLevel.height,
      gammaToLinear(settings.threshold),
      settings.softKnee,
      resolveUnityBloomClamp(settings.clamp),
      true,
      1,
      emissionBounds,
    );

    if (transparentOverlay)
    {
      filterBoxCoverage(
        this.sourceCoverage,
        this.sourceWidth,
        this.sourceHeight,
        firstCoverageLevel.down,
        firstCoverageLevel.width,
        firstCoverageLevel.height,
        1,
        coverageBounds,
      );
    }

    if (!activeBounds[0])
    {
      this._clearOutputBounds();
      return this._drawOutput(targetContext);
    }

    for (let level = 1; level < this.levels.length; level++)
    {
      const previous = this.levels[level - 1];
      const current = this.levels[level];

      activeBounds[level] = downsampleGaussian(
        previous.down,
        previous.width,
        previous.height,
        current.scratch,
        current.down,
        current.width,
        current.height,
        activeBounds[level - 1],
      );

      if (transparentOverlay)
      {
        const previousCoverage = this.coverageLevels[level - 1];
        const currentCoverage = this.coverageLevels[level];

        filterBoxCoverage(
          previousCoverage.down,
          previousCoverage.width,
          previousCoverage.height,
          currentCoverage.down,
          currentCoverage.width,
          currentCoverage.height,
          1,
        );
      }
    }

    let bloom = this.levels.at(-1).down;
    let bloomBounds = activeBounds.at(-1);
    let bloomCoverage = transparentOverlay
      ? this.coverageLevels.at(-1).down
      : null;

    for (let level = this.levels.length - 2; level >= 0; level--)
    {
      const current = this.levels[level];
      const lower = this.levels[level + 1];

      bloomBounds = upsampleAndMixBloom(
        current.down,
        current.width,
        current.height,
        bloom,
        lower.width,
        lower.height,
        current.up,
        this.sampleScale,
        true,
        activeBounds[level],
        bloomBounds,
      );
      bloom = current.up;

      if (transparentOverlay)
      {
        const currentCoverage = this.coverageLevels[level];
        const lowerCoverage = this.coverageLevels[level + 1];

        upsampleBloomCoverage(
          currentCoverage.down,
          currentCoverage.width,
          currentCoverage.height,
          bloomCoverage,
          lowerCoverage.width,
          lowerCoverage.height,
          currentCoverage.up,
          this.sampleScale,
        );
        bloomCoverage = currentCoverage.up;
      }
    }

    this._clearOutputBounds();
    const compositeBloom = this.levels[0].scratch;

    filterBloomForComposite(
      bloom,
      this.width,
      this.height,
      compositeBloom,
      this.sampleScale,
    );
    let compositeCoverage = null;

    if (transparentOverlay)
    {
      compositeCoverage = this.coverageLevels[0].scratch;
      filterBoxCoverage(
        bloomCoverage,
        this.width,
        this.height,
        compositeCoverage,
        this.width,
        this.height,
        Math.max(0, this.sampleScale) * 0.5,
      );
    }

    const edgeCorrection = calculateBloomEdgeCorrection(
      compositeBloom,
      this.width,
      this.height,
      bloomBounds,
      {
        left: bloomBounds.minimumX > 0 || this.originX > 0,
        top: bloomBounds.minimumY > 0 || this.originY > 0,
        right: bloomBounds.maximumX < this.width - 1 ||
          this.originX + this.regionWidth < this.displayCssWidth,
        bottom: bloomBounds.maximumY < this.height - 1 ||
          this.originY + this.regionHeight < this.displayCssHeight,
      },
    );
    encodeAdditiveBloom(
      compositeBloom,
      this.outputImageData.data,
      settings.intensity,
      this.width,
      bloomBounds,
      edgeCorrection,
      {
        outputCompositing: settings.outputCompositing,
        coverage: compositeCoverage,
        // mip0 的 down 缓冲与输出 ImageData 尺寸完全相同；读取源分辨率
        // Coverage 会在 resolutionScale < 1 时造成索引和 DPR 错位。
        sceneCoverage: firstCoverageLevel?.down,
      },
    );
    this.outputBounds = bloomBounds;
    this.outputContext.putImageData(
      this.outputImageData,
      0,
      0,
      bloomBounds.minimumX,
      bloomBounds.minimumY,
      bloomBounds.maximumX - bloomBounds.minimumX + 1,
      bloomBounds.maximumY - bloomBounds.minimumY + 1,
    );

    return this._drawOutput(targetContext);
  }

  _drawOutput(targetContext)
  {
    targetContext.imageSmoothingEnabled = true;
    targetContext.imageSmoothingQuality = 'high';
    targetContext.drawImage(
      this.outputCanvas,
      0,
      0,
      this.width,
      this.height,
      this.originX,
      this.originY,
      this.regionWidth,
      this.regionHeight,
    );

    return true;
  }

  _clearOutputBounds()
  {
    if (!this.outputBounds)
    {
      return;
    }

    const bounds = this.outputBounds;

    // 先清除上一帧的局部结果，再上传当前有效区域，避免包围框收缩时残留光晕。
    this.outputContext.clearRect(
      bounds.minimumX,
      bounds.minimumY,
      bounds.maximumX - bounds.minimumX + 1,
      bounds.maximumY - bounds.minimumY + 1,
    );
    this.outputBounds = null;
  }

  destroy()
  {
    this.sourceCanvas.width = 0;
    this.sourceCanvas.height = 0;
    this.outputCanvas.width = 0;
    this.outputCanvas.height = 0;

    if (this.coverageCanvas)
    {
      this.coverageCanvas.width = 0;
      this.coverageCanvas.height = 0;
    }

    this.available = false;
    this.sourceLinear = new Float32Array(0);
    this.sourceCoverage = new Float32Array(0);
    this.coverageCanvas = null;
    this.coverageContext = null;
    this.coverageLevels = [];
    this.coverageLevelStorage = [];
    this.coverageFrameReady = false;
    this.levels = [];
    this.levelStorage = [];
    this.outputImageData = null;
    this.outputBounds = null;
    this.sourceReadBounds = null;
  }
}
