const RGB_CHANNELS = 3;
const RGBA_CHANNELS = 4;
const REGION_QUANTUM = 64;
const MAX_PYRAMID_LEVELS = 16;
const DEFAULT_SKIP_ITERATIONS = 1;

// URP 12 Bloom.shader 的 9-tap 水平 Gaussian 权重。
const GAUSSIAN_HORIZONTAL_WEIGHTS = Object.freeze(
  [
    0.01621622,
    0.05405405,
    0.12162162,
    0.19459459,
    0.22702703,
    0.19459459,
    0.12162162,
    0.05405405,
    0.01621622,
  ],
);

// URP 借助双线性采样把纵向 9 taps 合并为 5 taps。
const GAUSSIAN_VERTICAL_TAPS = Object.freeze(
  [
    [-3.23076923, 0.07027027],
    [-1.38461538, 0.31621622],
    [0, 0.22702703],
    [1.38461538, 0.31621622],
    [3.23076923, 0.07027027],
  ],
);

// URP 高质量预过滤的 13 taps，重复采样项已合并为等价权重。
const PREFILTER_TAPS = Object.freeze(
  [
    [-1, -1, 0.03125],
    [0, -1, 0.0625],
    [1, -1, 0.03125],
    [-0.5, -0.5, 0.125],
    [0.5, -0.5, 0.125],
    [-1, 0, 0.0625],
    [0, 0, 0.125],
    [1, 0, 0.0625],
    [-0.5, 0.5, 0.125],
    [0.5, 0.5, 0.125],
    [-1, 1, 0.03125],
    [0, 1, 0.0625],
    [1, 1, 0.03125],
  ],
);

function clamp(value, minimum, maximum)
{
  return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value)
{
  return clamp(value, 0, 1);
}

function calculatePyramidLevelCount(
  displayWidth,
  displayHeight,
  resolutionScale,
  skipIterations,
)
{
  const safeScale = clamp(resolutionScale, 0.1, 0.75);
  const maxSize = Math.max(
    1,
    Math.floor(displayWidth * safeScale),
    Math.floor(displayHeight * safeScale),
  );
  const iterations = Math.floor(Math.log2(maxSize) - 1) -
    clamp(Math.round(skipIterations), 0, 16);

  return clamp(iterations, 1, MAX_PYRAMID_LEVELS);
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
 * 计算带 Soft Knee 的高亮贡献，与 URP Bloom.shader 的预过滤公式一致。
 */
export function calculateBloomContribution(brightness, threshold, softKnee)
{
  const safeThreshold = Math.max(0, threshold);
  const knee = Math.max(safeThreshold * clamp01(softKnee), 0.00001);
  let soft = brightness - safeThreshold + knee;

  soft = clamp(soft, 0, knee * 2);
  soft = (soft * soft) / (knee * 4 + 0.0001);

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

function calculateBicubicAxis(position, output)
{
  // Filtering.hlsl 用 4 次双线性读取重建 cubic B-spline；这里保留同一
  // 权重与坐标，避免为每个通道创建数组并执行 16 次标量读取。
  const coordinate = position + 1;
  const cell = Math.floor(coordinate);
  const fraction = coordinate - cell;
  const rightmost = 1 / 6 + fraction * (
    -0.5 + fraction * (0.5 - fraction / 6)
  );
  const middleRight = 2 / 3 + fraction * (
    -1 + 0.5 * fraction
  ) * fraction;
  const middleLeft = 1 / 6 + fraction * (
    0.5 + fraction * (0.5 - 0.5 * fraction)
  );
  const leftmost = 1 - middleRight - middleLeft - rightmost;
  const firstWeight = rightmost + middleRight;
  const secondWeight = middleLeft + leftmost;

  output.firstPosition = cell - 2 + middleRight / firstWeight;
  output.secondPosition = cell + leftmost / secondWeight;
  output.firstWeight = firstWeight;
  output.secondWeight = secondWeight;
}

function addBicubicRgb(
  source,
  width,
  height,
  horizontal,
  vertical,
  weight,
  output,
  outputIndex,
)
{
  addBilinearRgb(
    source,
    width,
    height,
    horizontal.firstPosition,
    vertical.firstPosition,
    weight * horizontal.firstWeight * vertical.firstWeight,
    output,
    outputIndex,
  );
  addBilinearRgb(
    source,
    width,
    height,
    horizontal.secondPosition,
    vertical.firstPosition,
    weight * horizontal.secondWeight * vertical.firstWeight,
    output,
    outputIndex,
  );
  addBilinearRgb(
    source,
    width,
    height,
    horizontal.firstPosition,
    vertical.secondPosition,
    weight * horizontal.firstWeight * vertical.secondWeight,
    output,
    outputIndex,
  );
  addBilinearRgb(
    source,
    width,
    height,
    horizontal.secondPosition,
    vertical.secondPosition,
    weight * horizontal.secondWeight * vertical.secondWeight,
    output,
    outputIndex,
  );
}

/**
 * 从全分辨率发射遮罩生成半分辨率 mip0，并执行 URP HQ 13-tap 预过滤。
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
  clampMax = 65472,
  highQualityFiltering = true,
  sourceTexelAspect = sourceHeight / sourceWidth,
  sourceBounds = null,
)
{
  const scaleX = sourceWidth / outputWidth;
  const scaleY = sourceHeight / outputHeight;
  // URP 12 有意用 _SourceTex_TexelSize.x 同时偏移两个轴；换算到
  // 源像素坐标后，横向为 1px，纵向为纹理高宽比，而不是各自 1px。
  const tapScaleX = 1;
  const tapScaleY = sourceTexelAspect;
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
    // 发射图通常只占带 padding 区域的一小部分；只预过滤可能读取到
    // 非零源像素的输出，空白区保持清零，避免长轨迹每帧做数百万次无效 taps。
    const horizontalPadding = highQualityFiltering ? 3 : 1;
    const verticalPadding = highQualityFiltering
      ? Math.ceil(Math.abs(tapScaleY)) + 2
      : 1;

    startX = clamp(
      Math.floor((sourceBounds.minimumX - horizontalPadding) / scaleX) - 1,
      0,
      outputWidth,
    );
    startY = clamp(
      Math.floor((sourceBounds.minimumY - verticalPadding) / scaleY) - 1,
      0,
      outputHeight,
    );
    endX = clamp(
      Math.ceil((sourceBounds.maximumX + horizontalPadding + 1) / scaleX) + 1,
      0,
      outputWidth,
    );
    endY = clamp(
      Math.ceil((sourceBounds.maximumY + verticalPadding + 1) / scaleY) + 1,
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

      if (!highQualityFiltering)
      {
        addBilinearRgb(
          source,
          sourceWidth,
          sourceHeight,
          sourceX,
          sourceY,
          1,
          output,
          outputIndex,
        );
      }
      else
      {
        let red = 0;
        let green = 0;
        let blue = 0;

        for (let tapIndex = 0; tapIndex < PREFILTER_TAPS.length; tapIndex++)
        {
          const tap = PREFILTER_TAPS[tapIndex];
          const offsetX = tap[0];
          const offsetY = tap[1];
          const weight = tap[2];
          const sampleX = sourceX + offsetX * tapScaleX;
          const sampleY = sourceY + offsetY * tapScaleY;
          const safeX = clamp(sampleX, 0, sourceWidth - 1);
          const safeY = clamp(sampleY, 0, sourceHeight - 1);
          const left = Math.floor(safeX);
          const top = Math.floor(safeY);
          const right = Math.min(left + 1, sourceWidth - 1);
          const bottom = Math.min(top + 1, sourceHeight - 1);
          const horizontal = safeX - left;
          const vertical = safeY - top;
          const topLeftWeight = (1 - horizontal) *
            (1 - vertical) * weight;
          const topRightWeight = horizontal * (1 - vertical) * weight;
          const bottomLeftWeight = (1 - horizontal) * vertical * weight;
          const bottomRightWeight = horizontal * vertical * weight;
          const topLeftIndex = (top * sourceWidth + left) * RGB_CHANNELS;
          const topRightIndex = (top * sourceWidth + right) * RGB_CHANNELS;
          const bottomLeftIndex = (bottom * sourceWidth + left) * RGB_CHANNELS;
          const bottomRightIndex = (bottom * sourceWidth + right) * RGB_CHANNELS;

          // HQ 预过滤是最热路径。标量累加保持相同 13-tap 公式，
          // 但避免每个 tap 调用通用函数并反复写入 Float32 输出。
          red += source[topLeftIndex] * topLeftWeight +
            source[topRightIndex] * topRightWeight +
            source[bottomLeftIndex] * bottomLeftWeight +
            source[bottomRightIndex] * bottomRightWeight;
          green += source[topLeftIndex + 1] * topLeftWeight +
            source[topRightIndex + 1] * topRightWeight +
            source[bottomLeftIndex + 1] * bottomLeftWeight +
            source[bottomRightIndex + 1] * bottomRightWeight;
          blue += source[topLeftIndex + 2] * topLeftWeight +
            source[topRightIndex + 2] * topRightWeight +
            source[bottomLeftIndex + 2] * bottomLeftWeight +
            source[bottomRightIndex + 2] * bottomRightWeight;
        }

        output[outputIndex] = red;
        output[outputIndex + 1] = green;
        output[outputIndex + 2] = blue;
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
 * 对上一层执行 URP 的“2×降采样 + 9-tap Gaussian”两阶段卷积。
 */
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
  const scaleX = sourceWidth / outputWidth;
  const scaleY = sourceHeight / outputHeight;
  let horizontalStartX = 0;
  let horizontalStartY = 0;
  let horizontalEndX = outputWidth;
  let horizontalEndY = outputHeight;
  let outputStartY = 0;
  let outputEndY = outputHeight;

  if (sourceBounds)
  {
    horizontalStartX = clamp(
      Math.floor((sourceBounds.minimumX - 9) / scaleX) - 1,
      0,
      outputWidth,
    );
    horizontalStartY = clamp(
      Math.floor((sourceBounds.minimumY - 1) / scaleY) - 1,
      0,
      outputHeight,
    );
    horizontalEndX = clamp(
      Math.ceil((sourceBounds.maximumX + 10) / scaleX) + 1,
      0,
      outputWidth,
    );
    horizontalEndY = clamp(
      Math.ceil((sourceBounds.maximumY + 2) / scaleY) + 1,
      0,
      outputHeight,
    );
    outputStartY = Math.max(0, horizontalStartY - 5);
    outputEndY = Math.min(outputHeight, horizontalEndY + 5);
  }

  const overwritesFullScratch = horizontalStartX === 0 &&
    horizontalStartY === 0 &&
    horizontalEndX === outputWidth &&
    horizontalEndY === outputHeight;
  const overwritesFullOutput = horizontalStartX === 0 &&
    outputStartY === 0 &&
    horizontalEndX === outputWidth &&
    outputEndY === outputHeight;

  if (!overwritesFullScratch)
  {
    scratch.fill(0);
  }

  if (!overwritesFullOutput)
  {
    output.fill(0);
  }

  for (let y = horizontalStartY; y < horizontalEndY; y++)
  {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    const safeSourceY = clamp(sourceY, 0, sourceHeight - 1);
    const sourceTop = Math.floor(safeSourceY);
    const sourceBottom = Math.min(sourceTop + 1, sourceHeight - 1);
    const vertical = safeSourceY - sourceTop;
    const topWeight = 1 - vertical;
    const bottomWeight = vertical;

    for (let x = horizontalStartX; x < horizontalEndX; x++)
    {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const outputIndex = (y * outputWidth + x) * RGB_CHANNELS;
      let red = 0;
      let green = 0;
      let blue = 0;

      for (let tap = -4; tap <= 4; tap++)
      {
        // FragBlurH 固定跨 2 个 source texel；奇数 mip 不能改用尺寸比，
        // 否则 135→67 一类层级会逐级把光晕错误地拉宽。
        const sampleX = clamp(
          sourceX + tap * 2,
          0,
          sourceWidth - 1,
        );
        const left = Math.floor(sampleX);
        const right = Math.min(left + 1, sourceWidth - 1);
        const horizontal = sampleX - left;
        const leftWeight = 1 - horizontal;
        const weight = GAUSSIAN_HORIZONTAL_WEIGHTS[tap + 4];
        const topLeftIndex = (sourceTop * sourceWidth + left) * RGB_CHANNELS;
        const topRightIndex = (sourceTop * sourceWidth + right) * RGB_CHANNELS;
        const bottomLeftIndex = (
          sourceBottom * sourceWidth + left
        ) * RGB_CHANNELS;
        const bottomRightIndex = (
          sourceBottom * sourceWidth + right
        ) * RGB_CHANNELS;

        // 水平 Gaussian 是热路径。一次读取三个通道并在寄存器中累加，
        // 避免每个 tap 调用通用双线性函数并反复写 Float32 scratch。
        red += (
          (source[topLeftIndex] * leftWeight +
            source[topRightIndex] * horizontal) * topWeight +
          (source[bottomLeftIndex] * leftWeight +
            source[bottomRightIndex] * horizontal) * bottomWeight
        ) * weight;
        green += (
          (source[topLeftIndex + 1] * leftWeight +
            source[topRightIndex + 1] * horizontal) * topWeight +
          (source[bottomLeftIndex + 1] * leftWeight +
            source[bottomRightIndex + 1] * horizontal) * bottomWeight
        ) * weight;
        blue += (
          (source[topLeftIndex + 2] * leftWeight +
            source[topRightIndex + 2] * horizontal) * topWeight +
          (source[bottomLeftIndex + 2] * leftWeight +
            source[bottomRightIndex + 2] * horizontal) * bottomWeight
        ) * weight;
      }

      scratch[outputIndex] = red;
      scratch[outputIndex + 1] = green;
      scratch[outputIndex + 2] = blue;
    }
  }

  for (let y = outputStartY; y < outputEndY; y++)
  {
    for (let x = horizontalStartX; x < horizontalEndX; x++)
    {
      const outputIndex = (y * outputWidth + x) * RGB_CHANNELS;
      let red = 0;
      let green = 0;
      let blue = 0;

      for (const [offset, weight] of GAUSSIAN_VERTICAL_TAPS)
      {
        const sampleY = clamp(y + offset, 0, outputHeight - 1);
        const top = Math.floor(sampleY);
        const bottom = Math.min(top + 1, outputHeight - 1);
        const vertical = sampleY - top;
        const topIndex = (top * outputWidth + x) * RGB_CHANNELS;
        const bottomIndex = (bottom * outputWidth + x) * RGB_CHANNELS;

        red += (
          scratch[topIndex] * (1 - vertical) +
          scratch[bottomIndex] * vertical
        ) * weight;
        green += (
          scratch[topIndex + 1] * (1 - vertical) +
          scratch[bottomIndex + 1] * vertical
        ) * weight;
        blue += (
          scratch[topIndex + 2] * (1 - vertical) +
          scratch[bottomIndex + 2] * vertical
        ) * weight;
      }

      output[outputIndex] = red;
      output[outputIndex + 1] = green;
      output[outputIndex + 2] = blue;
    }
  }

  return {
    minimumX: horizontalStartX,
    minimumY: outputStartY,
    maximumX: Math.max(horizontalStartX, horizontalEndX - 1),
    maximumY: Math.max(outputStartY, outputEndY - 1),
  };
}

/**
 * URP 的反向金字塔合成：每级保留 high mip，再按 scatter 混入 low mip。
 */
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
  const mix = clamp01(scatter);
  const keep = 1 - mix;
  const scaleX = lowWidth / highWidth;
  const scaleY = lowHeight / highHeight;
  const horizontalBicubic = {};
  const verticalBicubic = {};
  let startX = 0;
  let startY = 0;
  let endX = highWidth;
  let endY = highHeight;

  if (highBounds && lowBounds)
  {
    const lowStartX = Math.floor((lowBounds.minimumX - 3) / scaleX) - 2;
    const lowStartY = Math.floor((lowBounds.minimumY - 3) / scaleY) - 2;
    const lowEndX = Math.ceil((lowBounds.maximumX + 4) / scaleX) + 2;
    const lowEndY = Math.ceil((lowBounds.maximumY + 4) / scaleY) + 2;

    startX = clamp(
      Math.min(highBounds.minimumX, lowStartX),
      0,
      highWidth,
    );
    startY = clamp(
      Math.min(highBounds.minimumY, lowStartY),
      0,
      highHeight,
    );
    endX = clamp(
      Math.max(highBounds.maximumX + 1, lowEndX),
      0,
      highWidth,
    );
    endY = clamp(
      Math.max(highBounds.maximumY + 1, lowEndY),
      0,
      highHeight,
    );
  }

  if (
    startX !== 0 ||
    startY !== 0 ||
    endX !== highWidth ||
    endY !== highHeight
  )
  {
    output.fill(0);
  }

  for (let y = startY; y < endY; y++)
  {
    const lowY = (y + 0.5) * scaleY - 0.5;

    if (highQualityFiltering)
    {
      calculateBicubicAxis(lowY, verticalBicubic);
    }

    for (let x = startX; x < endX; x++)
    {
      const lowX = (x + 0.5) * scaleX - 0.5;
      const outputIndex = (y * highWidth + x) * RGB_CHANNELS;

      output[outputIndex] = high[outputIndex] * keep;
      output[outputIndex + 1] = high[outputIndex + 1] * keep;
      output[outputIndex + 2] = high[outputIndex + 2] * keep;

      if (highQualityFiltering)
      {
        calculateBicubicAxis(lowX, horizontalBicubic);
        addBicubicRgb(
          low,
          lowWidth,
          lowHeight,
          horizontalBicubic,
          verticalBicubic,
          mix,
          output,
          outputIndex,
        );
        continue;
      }

      addBilinearRgb(
        low,
        lowWidth,
        lowHeight,
        lowX,
        lowY,
        mix,
        output,
        outputIndex,
      );
    }
  }

  return {
    minimumX: startX,
    minimumY: startY,
    maximumX: Math.max(startX, endX - 1),
    maximumY: Math.max(startY, endY - 1),
  };
}

/**
 * 将线性 HDR Bloom 转成可由透明 Canvas 保存的 sRGB 加色贡献。
 * Alpha 取最大 sRGB 通道，反预乘后写入 ImageData；零能量严格输出零 Alpha。
 */
export function encodeAdditiveBloom(
  source,
  output,
  intensity,
  width = source.length / RGB_CHANNELS,
  bounds = null,
)
{
  const safeIntensity = Math.max(0, intensity);
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

  for (let y = startY; y < endY; y++)
  {
    let sourceIndex = (y * safeWidth + startX) * RGB_CHANNELS;
    let outputIndex = (y * safeWidth + startX) * RGBA_CHANNELS;

    for (let x = startX; x < endX; x++)
    {
      const red = linearToSrgb(source[sourceIndex] * safeIntensity);
      const green = linearToSrgb(source[sourceIndex + 1] * safeIntensity);
      const blue = linearToSrgb(source[sourceIndex + 2] * safeIntensity);
      const alpha = Math.max(red, green, blue);

      if (alpha <= 0.00001)
      {
        output[outputIndex] = 0;
        output[outputIndex + 1] = 0;
        output[outputIndex + 2] = 0;
        output[outputIndex + 3] = 0;
      }
      else
      {
        output[outputIndex] = Math.round(clamp01(red / alpha) * 255);
        output[outputIndex + 1] = Math.round(clamp01(green / alpha) * 255);
        output[outputIndex + 2] = Math.round(clamp01(blue / alpha) * 255);
        output[outputIndex + 3] = Math.round(alpha * 255);
      }

      sourceIndex += RGB_CHANNELS;
      outputIndex += RGBA_CHANNELS;
    }
  }
}

/**
 * 一个实例只持有一套局部金字塔缓冲；模块加载时不访问 DOM，兼容 SSR。
 */
export class SoftwareBloomRenderer
{
  constructor(createCanvas)
  {
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
    this.displayWidth = 0;
    this.displayHeight = 0;
    this.sourceLinear = new Float32Array(0);
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

  _resize(
    regionWidth,
    regionHeight,
    resolutionScale,
    displayWidth,
    displayHeight,
    skipIterations,
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
    const desiredLevelCount = calculatePyramidLevelCount(
      displayWidth,
      displayHeight,
      safeScale,
      skipIterations,
    );
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
    skipIterations = DEFAULT_SKIP_ITERATIONS,
    samplingScale = 1,
    emissionBounds = bounds,
  )
  {
    if (!this.available || !bounds)
    {
      return null;
    }

    const safeSamplingScale = clamp(samplingScale, 1, 4);
    const pixelDisplayWidth = Math.max(1, Math.round(
      displayWidth * safeSamplingScale,
    ));
    const pixelDisplayHeight = Math.max(1, Math.round(
      displayHeight * safeSamplingScale,
    ));
    const levelCount = calculatePyramidLevelCount(
      pixelDisplayWidth,
      pixelDisplayHeight,
      resolutionScale,
      skipIterations,
    );
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
        skipIterations,
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

    const readBounds = this.sourceReadBounds ?? {
      x: 0,
      y: 0,
      width: this.sourceWidth,
      height: this.sourceHeight,
    };
    let emissionBounds = null;

    if (readBounds.width > 0 && readBounds.height > 0)
    {
      let sourceImageData;

      try
      {
        sourceImageData = this.sourceContext.getImageData(
          readBounds.x,
          readBounds.y,
          readBounds.width,
          readBounds.height,
        );
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
    }
    else
    {
      // 发射几何完全在屏幕外时不存在可回读像素，但这不是 Canvas 故障。
      this.sourceLinear.fill(0);
    }

    const firstLevel = this.levels[0];

    const activeBounds = [];

    activeBounds[0] = prefilterBloom(
      this.sourceLinear,
      this.sourceWidth,
      this.sourceHeight,
      firstLevel.down,
      firstLevel.width,
      firstLevel.height,
      settings.threshold,
      settings.softKnee,
      settings.clamp ?? 65472,
      settings.highQualityFiltering !== false,
      this.displayHeight / this.displayWidth,
      emissionBounds,
    );

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
    }

    // Unity 将用户 scatter 从 0..1 映射到 0.05..0.95。
    const scatter = 0.05 + clamp01(settings.scatter) * 0.9;
    let bloom = this.levels.at(-1).down;
    let bloomBounds = activeBounds.at(-1);

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
        scatter,
        settings.highQualityFiltering !== false,
        activeBounds[level],
        bloomBounds,
      );
      bloom = current.up;
    }

    this._clearOutputBounds();
    encodeAdditiveBloom(
      bloom,
      this.outputImageData.data,
      settings.intensity,
      this.width,
      bloomBounds,
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
    this.available = false;
    this.sourceLinear = new Float32Array(0);
    this.levels = [];
    this.levelStorage = [];
    this.outputImageData = null;
    this.outputBounds = null;
    this.sourceReadBounds = null;
  }
}
