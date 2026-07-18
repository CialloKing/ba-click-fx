const RGB_CHANNELS = 3;
const REGION_QUANTUM = 64;

function clamp(value, minimum, maximum)
{
  return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value)
{
  return clamp(value, 0, 1);
}

/**
 * 计算带 Soft Knee 的高亮贡献。独立成纯函数，方便锁定阈值行为。
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

/**
 * 将 8 位发射遮罩还原为 Float32 HDR 高亮缓冲。
 * 遮罩 RGB 保存线性能量比例，Alpha 只保存 Canvas 抗锯齿覆盖率。
 */
export function extractBrightPass(
  source,
  output,
  encodingRange,
  threshold,
  softKnee,
)
{
  const pixelCount = source.length / 4;
  const safeEncodingRange = Math.max(1, encodingRange);

  for (let pixel = 0; pixel < pixelCount; pixel++)
  {
    const sourceIndex = pixel * 4;
    const outputIndex = pixel * RGB_CHANNELS;
    const coverage = source[sourceIndex + 3] / 255;
    const red = (source[sourceIndex] / 255) * safeEncodingRange * coverage;
    const green = (source[sourceIndex + 1] / 255) * safeEncodingRange * coverage;
    const blue = (source[sourceIndex + 2] / 255) * safeEncodingRange * coverage;
    const brightness = Math.max(red, green, blue);

    if (brightness <= 0)
    {
      output[outputIndex] = 0;
      output[outputIndex + 1] = 0;
      output[outputIndex + 2] = 0;
      continue;
    }

    const contribution = calculateBloomContribution(
      brightness,
      threshold,
      softKnee,
    );
    const scale = contribution / brightness;

    output[outputIndex] = red * scale;
    output[outputIndex + 1] = green * scale;
    output[outputIndex + 2] = blue * scale;
  }
}

/**
 * 使用滑动窗口执行水平、垂直两次箱式模糊。
 * 连续覆盖窗口不会把稀疏采样核印到细圆环上，三次迭代可近似高斯光晕。
 */
export function separableBoxBlur(
  source,
  scratch,
  output,
  width,
  height,
  radius,
)
{
  const safeRadius = Math.max(1, Math.round(radius));
  const windowSize = safeRadius * 2 + 1;
  const inverseWindow = 1 / windowSize;

  for (let y = 0; y < height; y++)
  {
    let red = 0;
    let green = 0;
    let blue = 0;

    for (let offset = -safeRadius; offset <= safeRadius; offset++)
    {
      const x = clamp(offset, 0, width - 1);
      const index = (y * width + x) * RGB_CHANNELS;

      red += source[index];
      green += source[index + 1];
      blue += source[index + 2];
    }

    for (let x = 0; x < width; x++)
    {
      const index = (y * width + x) * RGB_CHANNELS;

      scratch[index] = red * inverseWindow;
      scratch[index + 1] = green * inverseWindow;
      scratch[index + 2] = blue * inverseWindow;

      const removeX = clamp(x - safeRadius, 0, width - 1);
      const addX = clamp(x + safeRadius + 1, 0, width - 1);
      const removeIndex = (y * width + removeX) * RGB_CHANNELS;
      const addIndex = (y * width + addX) * RGB_CHANNELS;

      red += source[addIndex] - source[removeIndex];
      green += source[addIndex + 1] - source[removeIndex + 1];
      blue += source[addIndex + 2] - source[removeIndex + 2];
    }
  }

  for (let x = 0; x < width; x++)
  {
    let red = 0;
    let green = 0;
    let blue = 0;

    for (let offset = -safeRadius; offset <= safeRadius; offset++)
    {
      const y = clamp(offset, 0, height - 1);
      const index = (y * width + x) * RGB_CHANNELS;

      red += scratch[index];
      green += scratch[index + 1];
      blue += scratch[index + 2];
    }

    for (let y = 0; y < height; y++)
    {
      const index = (y * width + x) * RGB_CHANNELS;

      output[index] = red * inverseWindow;
      output[index + 1] = green * inverseWindow;
      output[index + 2] = blue * inverseWindow;

      const removeY = clamp(y - safeRadius, 0, height - 1);
      const addY = clamp(y + safeRadius + 1, 0, height - 1);
      const removeIndex = (removeY * width + x) * RGB_CHANNELS;
      const addIndex = (addY * width + x) * RGB_CHANNELS;

      red += scratch[addIndex] - scratch[removeIndex];
      green += scratch[addIndex + 1] - scratch[removeIndex + 1];
      blue += scratch[addIndex + 2] - scratch[removeIndex + 2];
    }
  }
}

/**
 * 连续执行完整的模糊链并返回最后一级结果。
 * 缓冲区由调用方复用；偶数次迭代会覆盖 source，这是软件 Bloom 的预期行为。
 */
export function applyBlurPasses(
  source,
  scratch,
  alternate,
  width,
  height,
  baseRadius,
  iterations,
)
{
  const safeIterations = clamp(Math.round(iterations), 1, 6);
  const safeBaseRadius = Math.max(1, Math.round(baseRadius));
  let input = source;
  let output = alternate;

  for (let iteration = 0; iteration < safeIterations; iteration++)
  {
    separableBoxBlur(
      input,
      scratch,
      output,
      width,
      height,
      safeBaseRadius * (iteration + 1),
    );
    input = output;
    output = output === alternate ? source : alternate;
  }

  return input;
}

/**
 * 将 HDR Bloom 编码为可参与 lighter 合成的非预乘 RGBA。
 * Alpha 取最大颜色分量，确保 Canvas 预乘后恰好恢复目标加色能量。
 */
export function encodeAdditiveBloom(source, output, intensity)
{
  const pixelCount = source.length / RGB_CHANNELS;
  const safeIntensity = Math.max(0, intensity);

  for (let pixel = 0; pixel < pixelCount; pixel++)
  {
    const sourceIndex = pixel * RGB_CHANNELS;
    const outputIndex = pixel * 4;
    const redEnergy = source[sourceIndex] * safeIntensity;
    const greenEnergy = source[sourceIndex + 1] * safeIntensity;
    const blueEnergy = source[sourceIndex + 2] * safeIntensity;
    // 基准 Volume 没有 Tonemapping；这里让普通 8 位 Canvas 自然截断 SDR 峰值。
    const red = clamp01(redEnergy);
    const green = clamp01(greenEnergy);
    const blue = clamp01(blueEnergy);
    const alpha = clamp01(Math.max(red, green, blue));

    if (alpha <= 0.00001)
    {
      output[outputIndex] = 0;
      output[outputIndex + 1] = 0;
      output[outputIndex + 2] = 0;
      output[outputIndex + 3] = 0;
      continue;
    }

    output[outputIndex] = Math.round(clamp01(red / alpha) * 255);
    output[outputIndex + 1] = Math.round(clamp01(green / alpha) * 255);
    output[outputIndex + 2] = Math.round(clamp01(blue / alpha) * 255);
    output[outputIndex + 3] = Math.round(alpha * 255);
  }
}

/**
 * 一个实例只持有一套可复用缓冲；不在模块顶层访问 DOM，保证包可在 SSR 中加载。
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
    this.width = 0;
    this.height = 0;
    this.originX = 0;
    this.originY = 0;
    this.regionWidth = 0;
    this.regionHeight = 0;
    this.resolutionScale = 0;
    this.bright = new Float32Array(0);
    this.blurA = new Float32Array(0);
    this.blurB = new Float32Array(0);
    this.outputImageData = null;
    this.available = Boolean(
      this.sourceContext &&
      this.outputContext &&
      typeof this.sourceContext.getImageData === 'function' &&
      typeof this.outputContext.createImageData === 'function' &&
      typeof this.outputContext.putImageData === 'function',
    );
  }

  _resize(regionWidth, regionHeight, resolutionScale)
  {
    const safeScale = clamp(resolutionScale, 0.1, 0.75);
    const width = Math.max(1, Math.ceil(regionWidth * safeScale));
    const height = Math.max(1, Math.ceil(regionHeight * safeScale));

    this.regionWidth = regionWidth;
    this.regionHeight = regionHeight;
    this.resolutionScale = safeScale;

    if (width === this.width && height === this.height)
    {
      return true;
    }

    this.width = width;
    this.height = height;
    this.sourceCanvas.width = width;
    this.sourceCanvas.height = height;
    this.outputCanvas.width = width;
    this.outputCanvas.height = height;

    const floatLength = width * height * RGB_CHANNELS;

    this.bright = new Float32Array(floatLength);
    this.blurA = new Float32Array(floatLength);
    this.blurB = new Float32Array(floatLength);

    try
    {
      this.outputImageData = this.outputContext.createImageData(width, height);
    }
    catch
    {
      this.available = false;
      this.outputImageData = null;
      return false;
    }

    return true;
  }

  beginFrame(displayWidth, displayHeight, resolutionScale, bounds)
  {
    if (!this.available || !bounds)
    {
      return null;
    }

    const left = clamp(
      Math.floor(bounds.x / REGION_QUANTUM) * REGION_QUANTUM,
      0,
      displayWidth,
    );
    const top = clamp(
      Math.floor(bounds.y / REGION_QUANTUM) * REGION_QUANTUM,
      0,
      displayHeight,
    );
    const right = clamp(
      Math.ceil((bounds.x + bounds.width) / REGION_QUANTUM) * REGION_QUANTUM,
      0,
      displayWidth,
    );
    const bottom = clamp(
      Math.ceil((bounds.y + bounds.height) / REGION_QUANTUM) * REGION_QUANTUM,
      0,
      displayHeight,
    );
    const regionWidth = right - left;
    const regionHeight = bottom - top;

    if (
      regionWidth <= 0 ||
      regionHeight <= 0 ||
      !this._resize(regionWidth, regionHeight, resolutionScale)
    )
    {
      return null;
    }

    this.originX = left;
    this.originY = top;

    const scaleX = this.width / regionWidth;
    const scaleY = this.height / regionHeight;

    // 先在像素坐标中清空，再切回带世界坐标偏移的局部高分辨率区域。
    this.sourceContext.setTransform(1, 0, 0, 1, 0, 0);
    this.sourceContext.clearRect(0, 0, this.width, this.height);
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
    if (!this.available || !this.outputImageData)
    {
      return false;
    }

    let sourceImageData;

    try
    {
      sourceImageData = this.sourceContext.getImageData(
        0,
        0,
        this.width,
        this.height,
      );
    }
    catch
    {
      // 回读失败后永久退回原生 shadowBlur，避免每帧重复抛异常。
      this.available = false;
      return false;
    }

    extractBrightPass(
      sourceImageData.data,
      this.bright,
      settings.encodingRange,
      settings.threshold,
      settings.softKnee,
    );

    const iterations = clamp(Math.round(settings.iterations), 1, 6);
    const scatter = clamp01(settings.scatter);
    const bufferRadius = Math.max(
      1,
      settings.blurRadius * this.resolutionScale * (0.55 + scatter),
    );
    const radiusDivisor = iterations * (iterations + 1) * 0.5;
    const baseRadius = Math.max(1, Math.round(bufferRadius / radiusDivisor));
    const blurred = applyBlurPasses(
      this.bright,
      this.blurA,
      this.blurB,
      this.width,
      this.height,
      baseRadius,
      iterations,
    );

    // 只输出完整卷积链的结果。把首轮箱式模糊混回去会暴露矩形核边界，
    // 在细圆环和拖尾外侧形成肉眼可见的硬带。
    encodeAdditiveBloom(
      blurred,
      this.outputImageData.data,
      settings.intensity,
    );
    this.outputContext.putImageData(this.outputImageData, 0, 0);
    targetContext.imageSmoothingEnabled = true;
    targetContext.imageSmoothingQuality = 'high';
    targetContext.drawImage(
      this.outputCanvas,
      this.originX,
      this.originY,
      this.regionWidth,
      this.regionHeight,
    );

    return true;
  }

  destroy()
  {
    this.sourceCanvas.width = 0;
    this.sourceCanvas.height = 0;
    this.outputCanvas.width = 0;
    this.outputCanvas.height = 0;
    this.available = false;
    this.outputImageData = null;
  }
}
