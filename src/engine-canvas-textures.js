import { clamp, clamp01, createCanvas } from './engine-shared.js';
import { linearToSrgb } from './bloom-color-space.js';
import { BRIGHT_CORE_CHANNEL_MIX } from './overlay-compositing.js';
import { CIRCLE_TEXTURE_SIZE, CIRCLE_TEXTURE_RGBA, createCircleTextureSources } from './circle-texture.js';
import { TRIANGLE_TEXTURE_COVERAGE, TRIANGLE_TEXTURE_SIZE, TRIANGLE_TEXTURE_RGBA, createRoundedTriangleCoverage, createTriangleTextureSources, getRoundedTriangleTextureDivisor, mapRoundedTriangleTextureUv } from './triangle-texture.js';
import { BUILD_CANVAS } from './build-capabilities.js';
import { srgbToLinearChannel } from './engine-materials.js';

let triangleTextureResources = null;

let triangleTextureUnavailable = false;

let circleTextureResources = null;

let circleTextureUnavailable = false;

const canvasTextureOwners = BUILD_CANVAS ? new Set() : null;

let canvasTextureFrameOwner = null;

let canvasTextureReadDepth = 0;

let canvasTextureReleasePending = false;

let canvasTextureIdleTimer = null;

function cancelCanvasTextureRelease()
{
  if (canvasTextureIdleTimer !== null)
  {
    clearTimeout(canvasTextureIdleTimer);
    canvasTextureIdleTimer = null;
  }
}

function scheduleCanvasTextureRelease()
{
  if (!BUILD_CANVAS || canvasTextureOwners.size === 0 ||
      (!triangleTextureResources && !circleTextureResources)) return;
  for (const owner of canvasTextureOwners)
  {
    if (owner.visible)
    {
      cancelCanvasTextureRelease();
      return;
    }
  }
  if (canvasTextureReadDepth > 0 || canvasTextureIdleTimer !== null) return;
  // 整个模块只有一个空闲计时器；可见的暂停帧仍然持有缓存，不申请 RAF。
  const timer = setTimeout(() =>
  {
    if (canvasTextureIdleTimer !== timer) return;
    canvasTextureIdleTimer = null;
    releaseCanvasTextureCache(true);
  }, 30000);
  canvasTextureIdleTimer = timer;
}

function trackCanvasTextureUse()
{
  if (!BUILD_CANVAS || !canvasTextureFrameOwner || canvasTextureFrameOwner.closed)
  {
    return;
  }
  // 只保存独立标记，不能让共享缓存延长 BAClickFX 实例的生命周期。
  canvasTextureOwners.add(canvasTextureFrameOwner);
  cancelCanvasTextureRelease();
  canvasTextureReleasePending = false;
}

function releaseCanvasTextureResource(resources)
{
  if (!resources) return;
  // 默认 Canvas 的位图历史会影响少量栅格字节；保留位图及命中键，只归还 CPU 工作面。
  resources.linearTextureRgb = resources.linearTextureEnergyRgb = null;
  if (resources.linearTextureCoverageFromSrgbRed) resources.linearTextureCoverage = null;
  for (const frames of [resources.linearTintFrames, resources.roundedSceneFrames])
  {
    for (const frame of frames ?? []) frame.image = null;
  }
  resources.roundedCoverages?.clear();
  resources.roundedCoverages = null;
}

function releaseCanvasTextureCache(idle = false)
{
  if (!BUILD_CANVAS || (!idle && canvasTextureOwners.size > 0)) return;
  if (idle)
  {
    for (const owner of canvasTextureOwners)
    {
      if (owner.visible)
      {
        canvasTextureReleasePending = false;
        return;
      }
    }
  }
  cancelCanvasTextureRelease();
  if (canvasTextureReadDepth > 0)
  {
    // clear/destroy 和空闲回调可以同步重入绘制；最外层 finally 才能归还工作数据。
    canvasTextureReleasePending = true;
    return;
  }
  if (idle) canvasTextureOwners.clear();
  releaseCanvasTextureResource(triangleTextureResources);
  releaseCanvasTextureResource(circleTextureResources);
  linearToSrgbLut = null;
  canvasTextureReleasePending = false;
}

function getTriangleTextureResources()
{
  if (triangleTextureResources)
  {
    trackCanvasTextureUse();
    return triangleTextureResources;
  }

  if (triangleTextureUnavailable)
  {
    return null;
  }

  const sources = createTriangleTextureSources(createCanvas);
  const canvas = createCanvas();
  const context = canvas.getContext('2d');

  if (!sources || !context)
  {
    triangleTextureUnavailable = true;
    return null;
  }

  canvas.width = TRIANGLE_TEXTURE_SIZE;
  canvas.height = TRIANGLE_TEXTURE_SIZE;
  triangleTextureResources = {
    ...sources,
    canvas,
    context,
    linearTextureRgba: TRIANGLE_TEXTURE_RGBA,
    linearTextureCoverage: TRIANGLE_TEXTURE_COVERAGE,
    linearTextureCoverageFromSrgbRed: false,
    linearTextureRgb: null,
    linearTextureEnergyRgb: null,
    linearTintFrameCount: 2,
    linearTintFrames: null,
    linearTintUnavailable: false,
  };
  trackCanvasTextureUse();
  return triangleTextureResources;
}

function getCircleTextureResources()
{
  if (circleTextureResources)
  {
    trackCanvasTextureUse();
    return circleTextureResources;
  }

  if (circleTextureUnavailable)
  {
    return null;
  }

  const sources = createCircleTextureSources(createCanvas);

  if (!sources)
  {
    circleTextureUnavailable = true;
    return null;
  }

  const tintCanvas = createCanvas();
  const outputCanvas = createCanvas();
  const tintContext = tintCanvas.getContext('2d');
  const outputContext = outputCanvas.getContext('2d');

  if (!tintContext || !outputContext)
  {
    circleTextureUnavailable = true;
    return null;
  }

  tintCanvas.width = CIRCLE_TEXTURE_SIZE;
  tintCanvas.height = CIRCLE_TEXTURE_SIZE;
  outputCanvas.width = CIRCLE_TEXTURE_SIZE;
  outputCanvas.height = CIRCLE_TEXTURE_SIZE;
  circleTextureResources = {
    ...sources,
    tintCanvas,
    tintContext,
    outputCanvas,
    outputContext,
    linearTextureRgba: CIRCLE_TEXTURE_RGBA,
    linearTextureCoverage: null,
    linearTextureCoverageFromSrgbRed: true,
    linearTextureRgb: null,
    linearTextureEnergyRgb: null,
    linearTintFrameCount: 1,
    linearTintFrames: null,
    linearTintUnavailable: false,
  };
  trackCanvasTextureUse();
  return circleTextureResources;
}

function prepareLinearTextureData(resources)
{
  if (resources.linearTextureEnergyRgb)
  {
    return;
  }

  const rgba = resources.linearTextureRgba;
  const pixelCount = rgba.length / 4;
  const coverage = resources.linearTextureCoverage ??
    new Uint8Array(pixelCount);
  const textureRgb = new Float32Array(pixelCount * 3);
  const energyRgb = new Float32Array(pixelCount * 3);

  for (let sourceOffset = 0, pixelIndex = 0, targetOffset = 0;
    sourceOffset < rgba.length;
    sourceOffset += 4, pixelIndex++, targetOffset += 3)
  {
    const exactCoverage = resources.linearTextureCoverageFromSrgbRed
      ? srgbToLinearChannel(rgba[sourceOffset])
      : coverage[pixelIndex] / 255;

    if (resources.linearTextureCoverageFromSrgbRed)
    {
      coverage[pixelIndex] = Math.round(clamp01(exactCoverage) * 255);
    }

    // Unity 先在线性空间把纹理 Coverage 乘入发射 RGB，之后才由 Final
    // Pass 编码 sRGB。把 Coverage 留给 Canvas Alpha 才相乘会压暗半覆盖
    // texel，因此这里缓存 Shader 乘法后的逐 texel 线性能量。
    textureRgb[targetOffset] = srgbToLinearChannel(rgba[sourceOffset]);
    textureRgb[targetOffset + 1] = srgbToLinearChannel(
      rgba[sourceOffset + 1],
    );
    textureRgb[targetOffset + 2] = srgbToLinearChannel(
      rgba[sourceOffset + 2],
    );
    energyRgb[targetOffset] = textureRgb[targetOffset] * exactCoverage;
    energyRgb[targetOffset + 1] =
      textureRgb[targetOffset + 1] * exactCoverage;
    energyRgb[targetOffset + 2] =
      textureRgb[targetOffset + 2] * exactCoverage;
  }

  resources.linearTextureCoverage = coverage;
  resources.linearTextureRgb = textureRgb;
  resources.linearTextureEnergyRgb = energyRgb;
}

function sampleTextureChannel(
  data,
  textureSize,
  stride,
  u,
  v,
  channel = 0,
)
{
  const sourceX = clamp(u * textureSize - 0.5, 0, textureSize - 1);
  const sourceY = clamp(v * textureSize - 0.5, 0, textureSize - 1);
  const left = Math.floor(sourceX);
  const top = Math.floor(sourceY);
  const right = Math.min(textureSize - 1, left + 1);
  const bottom = Math.min(textureSize - 1, top + 1);
  const horizontal = sourceX - left;
  const vertical = sourceY - top;
  const topLeft = data[(top * textureSize + left) * stride + channel];
  const topRight = data[(top * textureSize + right) * stride + channel];
  const bottomLeft = data[(bottom * textureSize + left) * stride + channel];
  const bottomRight = data[
    (bottom * textureSize + right) * stride + channel
  ];
  const topSample = topLeft + (topRight - topLeft) * horizontal;
  const bottomSample = bottomLeft +
    (bottomRight - bottomLeft) * horizontal;

  return topSample + (bottomSample - topSample) * vertical;
}

function prepareTextureSample(sample, textureSize, u, v)
{
  const sourceX = clamp(u * textureSize - 0.5, 0, textureSize - 1);
  const sourceY = clamp(v * textureSize - 0.5, 0, textureSize - 1);
  const left = Math.floor(sourceX);
  const top = Math.floor(sourceY);
  const right = Math.min(textureSize - 1, left + 1);
  const bottom = Math.min(textureSize - 1, top + 1);
  sample.topLeft = top * textureSize + left;
  sample.topRight = top * textureSize + right;
  sample.bottomLeft = bottom * textureSize + left;
  sample.bottomRight = bottom * textureSize + right;
  sample.horizontal = sourceX - left;
  sample.vertical = sourceY - top;
}

function samplePreparedTextureChannel(data, stride, sample, channel = 0)
{
  const topLeft = data[sample.topLeft * stride + channel];
  const topRight = data[sample.topRight * stride + channel];
  const bottomLeft = data[sample.bottomLeft * stride + channel];
  const bottomRight = data[sample.bottomRight * stride + channel];
  // 保留原来的两次横向插值再纵向插值，不改成权重加和以免改变最终字节。
  const topSample = topLeft + (topRight - topLeft) * sample.horizontal;
  const bottomSample = bottomLeft + (bottomRight - bottomLeft) * sample.horizontal;
  return topSample + (bottomSample - topSample) * sample.vertical;
}

// 12 位线性索引的最大 sRGB 误差低于一个 8 位通道步长，同时避免在
// Context 回退首帧同步计算 65536 次幂函数造成可见卡顿。
const LINEAR_TO_SRGB_LUT_SIZE = 4096;

let linearToSrgbLut = null;

function getLinearToSrgbLut()
{
  if (linearToSrgbLut)
  {
    return linearToSrgbLut;
  }

  linearToSrgbLut = new Float32Array(LINEAR_TO_SRGB_LUT_SIZE);

  for (let index = 0; index < LINEAR_TO_SRGB_LUT_SIZE; index++)
  {
    linearToSrgbLut[index] = linearToSrgb(
      index / (LINEAR_TO_SRGB_LUT_SIZE - 1),
    );
  }

  return linearToSrgbLut;
}

function createLinearTintFrames(textureSize, frameCount)
{
  const frames = [];

  try
  {
    for (let index = 0; index < frameCount; index++)
    {
      const canvas = createCanvas();

      canvas.width = textureSize;
      canvas.height = textureSize;
      const context = canvas.getContext('2d');

      if (
        !context ||
        typeof context.createImageData !== 'function' ||
        typeof context.putImageData !== 'function'
      )
      {
        throw new Error('Canvas ImageData is unavailable');
      }

      frames.push(
        {
          canvas,
          context,
          image: context.createImageData(textureSize, textureSize),
          key: null,
        },
      );
    }
  }
  catch
  {
    for (const frame of frames)
    {
      frame.canvas.width = 0;
      frame.canvas.height = 0;
    }

    return null;
  }

  return frames;
}

/**
 * Canvas 没有 Unity 的线性采样/材质乘法状态；透明回退必须在写入 8 位
 * Canvas 前完成逐 texel 的 Linear(texture) × Linear(material)，否则 WebGL2
 * 丢失后会把已编码 sRGB 材质再次相乘而明显变暗。
 */
function prepareLinearTintedTextureCanvas(
  resources,
  textureSize,
  materialEnergy,
  contribution,
  alphaDivisor,
  frameIndex = 0,
  compensation = 0,
  shape = null,
  preserveCoverageColor = false,
)
{
  const safeContribution = Math.max(0, Number(contribution) || 0);
  const safeDivisor = Math.max(0, Number(alphaDivisor) || 0);
  const safeMaterialEnergy = [0, 1, 2].map((channel) =>
    Math.max(0, Number(materialEnergy[channel]) || 0));
  const safeCompensation = clamp01(Number(compensation) || 0);
  const roundness = clamp01(Number(shape?.roundness) || 0);
  const shapeCoverage = shape?.coverage ?? null;
  const useTextureAlpha = shape?.useTextureAlpha === true;
  const useRoundedShape = roundness > 0 && shapeCoverage !== null;

  if (
    safeContribution <= 0.000001 ||
    safeDivisor <= 0.000001 ||
    Math.max(...safeMaterialEnergy) <= 0.000001 ||
    resources.linearTintUnavailable
  )
  {
    return null;
  }

  if (!resources.linearTintFrames)
  {
    resources.linearTintFrames = createLinearTintFrames(
      textureSize,
      resources.linearTintFrameCount,
    );

    if (!resources.linearTintFrames)
    {
      resources.linearTintUnavailable = true;
      return null;
    }
  }

  prepareLinearTextureData(resources);

  const rawFrameIndex = Number.isFinite(frameIndex)
    ? Math.trunc(frameIndex)
    : 0;
  const frameSlot = (
    (rawFrameIndex % resources.linearTintFrameCount) +
      resources.linearTintFrameCount
  ) % resources.linearTintFrameCount;
  const frame = resources.linearTintFrames[frameSlot];
  const key = [
    safeDivisor,
    safeContribution,
    ...safeMaterialEnergy,
    safeCompensation,
    roundness,
    useTextureAlpha,
    preserveCoverageColor,
  ].join(',');

  if (frame.key === key)
  {
    return frame.canvas;
  }

  if (!frame.image)
  {
    try { frame.image = frame.context.createImageData(textureSize, textureSize); }
    catch
    {
      resources.linearTintUnavailable = true;
      return null;
    }
  }
  const { context, image } = frame;
  const sourceEnergyRgb = resources.linearTextureEnergyRgb;
  const sourceTextureRgb = resources.linearTextureRgb;
  const sourceCoverage = resources.linearTextureCoverage;
  const sourceRgba = resources.linearTextureRgba;
  const srgbLut = getLinearToSrgbLut();
  const flipVertical = frameSlot === 1;
  // 工作区属于本次染色调用；多实例及重入不会共享可变采样状态。
  const textureSample = roundness > 0 ? {} : null;
  const textureDivisor = useRoundedShape ? getRoundedTriangleTextureDivisor(roundness) : 1;
  const encodeLinearChannel = (energy, straightDivisor) =>
  {
    const lookupIndex = Math.round(
      clamp01(energy) * (LINEAR_TO_SRGB_LUT_SIZE - 1),
    );
    return srgbLut[lookupIndex] / straightDivisor;
  };
  const encodeRoundedChannel = (channel, textureSupport, targetCoverage, straightDivisor) =>
  {
    const textureChannel = samplePreparedTextureChannel(
      sourceTextureRgb, 3, textureSample, channel,
    );
    const supportedChannel = 1 + (textureChannel - 1) * clamp01(textureSupport);
    const shapeChannel = supportedChannel + (1 - supportedChannel) * roundness;
    // 圆角 Coverage 是唯一边界；纹理映射及通道乘法顺序保持不变。
    const roundedPremultiplied = shapeChannel * targetCoverage;
    return encodeLinearChannel(
      roundedPremultiplied * safeMaterialEnergy[channel] * safeContribution,
      straightDivisor,
    );
  };

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.filter = 'none';
  context.imageSmoothingEnabled = false;

  for (let y = 0; y < textureSize; y++)
  {
    const sourceY = flipVertical ? textureSize - 1 - y : y;

    for (let x = 0; x < textureSize; x++)
    {
      const sourcePixelIndex = sourceY * textureSize + x;
      const sourceOffset = sourcePixelIndex * 3;
      const sourceRgbaOffset = sourcePixelIndex * 4;
      const outputOffset = (y * textureSize + x) * 4;
      const originalCoverage = useTextureAlpha
        ? sourceRgba[sourceRgbaOffset + 3] / 255
        : sourceCoverage[sourcePixelIndex] / 255;
      const targetCoverage = useRoundedShape
        ? shapeCoverage[sourcePixelIndex] / 255
        : originalCoverage;
      const coverageByte = Math.round(clamp01(targetCoverage) * 255);

      if (coverageByte === 0)
      {
        image.data[outputOffset] = 0;
        image.data[outputOffset + 1] = 0;
        image.data[outputOffset + 2] = 0;
        image.data[outputOffset + 3] = 0;
        continue;
      }

      let sampleU = (x + 0.5) / textureSize;
      let sampleV = (sourceY + 0.5) / textureSize;

      if (useRoundedShape)
      {
        sampleU = 0.5 + (sampleU - 0.5) / textureDivisor;
        sampleV = 0.5 + (sampleV - 0.5) / textureDivisor;
      }

      if (textureSample) prepareTextureSample(textureSample, textureSize, sampleU, sampleV);

      const textureSupport = useRoundedShape
        ? (useTextureAlpha
            ? samplePreparedTextureChannel(
                sourceRgba,
                4,
                textureSample,
                3,
              )
            : samplePreparedTextureChannel(
                sourceCoverage,
                1,
                textureSample,
              )) / 255
        : originalCoverage;

      const effectiveAlpha = coverageByte / 255;
      const straightDivisor = safeDivisor * effectiveAlpha;
      let red;
      let green;
      let blue;
      if (roundness <= 0)
      {
        let energyScale = 1;
        if (preserveCoverageColor)
        {
          // RGB 共用同一 Coverage 容量，每个 texel 只算一次，保留原峰值乘法顺序。
          const maximum = Math.max(
            safeMaterialEnergy[0] * sourceEnergyRgb[sourceOffset] * safeContribution,
            safeMaterialEnergy[1] * sourceEnergyRgb[sourceOffset + 1] * safeContribution,
            safeMaterialEnergy[2] * sourceEnergyRgb[sourceOffset + 2] * safeContribution,
          );
          energyScale = Math.min(1, srgbToLinearChannel(straightDivisor * 255) /
            Math.max(maximum, 0.000001));
        }
        red = encodeLinearChannel(
          sourceEnergyRgb[sourceOffset] * safeMaterialEnergy[0] * safeContribution * energyScale,
          straightDivisor,
        );
        green = encodeLinearChannel(
          sourceEnergyRgb[sourceOffset + 1] * safeMaterialEnergy[1] * safeContribution * energyScale,
          straightDivisor,
        );
        blue = encodeLinearChannel(
          sourceEnergyRgb[sourceOffset + 2] * safeMaterialEnergy[2] * safeContribution * energyScale,
          straightDivisor,
        );
      }
      else
      {
        red = encodeRoundedChannel(0, textureSupport, targetCoverage, straightDivisor);
        green = encodeRoundedChannel(1, textureSupport, targetCoverage, straightDivisor);
        blue = encodeRoundedChannel(2, textureSupport, targetCoverage, straightDivisor);
      }
      const maximum = Math.max(red, green, blue);
      // 保留每个 texel 的峰值，只让弱通道有限靠近主通道。这里仍以纹理
      // 能量衰减门控，兼容直接调用路径也不会填白低能细节。
      const mixAmount = BRIGHT_CORE_CHANNEL_MIX * safeCompensation *
        clamp01(maximum);

      image.data[outputOffset] = Math.round(
        clamp01(red + (maximum - red) * mixAmount) * 255,
      );
      image.data[outputOffset + 1] = Math.round(
        clamp01(green + (maximum - green) * mixAmount) * 255,
      );
      image.data[outputOffset + 2] = Math.round(
        clamp01(blue + (maximum - blue) * mixAmount) * 255,
      );
      image.data[outputOffset + 3] = coverageByte;
    }
  }

  context.putImageData(image, 0, 0);
  context.globalCompositeOperation = 'source-over';
  context.filter = 'none';
  frame.key = key;
  return frame.canvas;
}

/**
 * 用固定大小的 Canvas 合成 Circle_01 二维 RGB 与 R Coverage。
 *
 * 动态材质只触发局部 GPU/Canvas 操作，不重新遍历 512x512 texel；这样既
 * 保留 G 通道的非径向细节，也不会重新引入旧逐帧 CPU 卡顿。
 */
function prepareCircleTextureCanvas(channelScales, srgbOutput = false)
{
  const resources = getCircleTextureResources();
  const maximumScale = Math.max(0, ...channelScales);

  if (!resources || maximumScale <= 0.00001)
  {
    return null;
  }

  const normalizedChannels = channelScales.map((channel) =>
    Math.round(clamp01(channel / maximumScale) * 255));
  const {
    tintCanvas,
    tintContext,
    outputCanvas,
    outputContext,
  } = resources;

  tintContext.setTransform(1, 0, 0, 1, 0, 0);
  tintContext.globalAlpha = 1;
  tintContext.globalCompositeOperation = 'source-over';
  tintContext.filter = 'none';
  tintContext.clearRect(0, 0, CIRCLE_TEXTURE_SIZE, CIRCLE_TEXTURE_SIZE);
  tintContext.drawImage(
    srgbOutput ? resources.srgbColorCanvas : resources.colorCanvas,
    0,
    0,
  );
  tintContext.globalCompositeOperation = 'multiply';
  tintContext.fillStyle = `rgb(${normalizedChannels[0]}, ${
    normalizedChannels[1]}, ${normalizedChannels[2]})`;
  tintContext.fillRect(0, 0, CIRCLE_TEXTURE_SIZE, CIRCLE_TEXTURE_SIZE);

  outputContext.setTransform(1, 0, 0, 1, 0, 0);
  outputContext.globalAlpha = 1;
  outputContext.globalCompositeOperation = 'source-over';
  // brightness 在纹理采样后逐通道放大并钳制，等价于 Shader 的 RGBA8 清晰输出。
  // 8 位纹理的最小非零通道在 255 倍时已经饱和，限制滤镜参数可避免
  // 生命周期最后一帧把无意义的超大倍率交给浏览器滤镜实现。
  outputContext.filter = `brightness(${Math.min(maximumScale, 255)})`;
  outputContext.clearRect(0, 0, CIRCLE_TEXTURE_SIZE, CIRCLE_TEXTURE_SIZE);
  outputContext.drawImage(tintCanvas, 0, 0);
  outputContext.filter = 'none';
  outputContext.globalCompositeOperation = 'destination-in';
  outputContext.drawImage(resources.coverageCanvas, 0, 0);
  return outputCanvas;
}

function getRoundedTriangleCoverage(resources, roundness)
{
  const key = clamp01(roundness);

  if (key <= 0)
  {
    return null;
  }

  if (!resources.roundedCoverages)
  {
    resources.roundedCoverages = new Map();
  }

  if (resources.roundedCoverages.has(key))
  {
    return resources.roundedCoverages.get(key);
  }

  // 宿主可能连续拖动参数，限制缓存避免把全部浮点中间值永久保留。
  if (resources.roundedCoverages.size >= 32)
  {
    resources.roundedCoverages.delete(
      resources.roundedCoverages.keys().next().value,
    );
  }

  const coverage = createRoundedTriangleCoverage(key);

  resources.roundedCoverages.set(key, coverage);
  return coverage;
}

function prepareSceneRoundedTriangleCanvas(
  resources,
  materialEnergy,
  roundness,
  frameIndex,
)
{
  const amount = clamp01(roundness);
  const shapeCoverage = getRoundedTriangleCoverage(resources, amount);

  if (!shapeCoverage)
  {
    return null;
  }

  if (!resources.roundedSceneFrames)
  {
    resources.roundedSceneFrames = createLinearTintFrames(
      TRIANGLE_TEXTURE_SIZE,
      2,
    );
  }

  if (!resources.roundedSceneFrames)
  {
    return null;
  }

  const frameSlot = ((Math.trunc(frameIndex) % 2) + 2) % 2;
  const frame = resources.roundedSceneFrames[frameSlot];
  const safeMaterialEnergy = materialEnergy.map((channel) =>
    Math.max(0, Number(channel) || 0));
  const key = [amount, ...safeMaterialEnergy].join(',');

  if (frame.key === key)
  {
    return frame.canvas;
  }

  if (!frame.image)
  {
    try { frame.image = frame.context.createImageData(TRIANGLE_TEXTURE_SIZE, TRIANGLE_TEXTURE_SIZE); }
    catch { return null; }
  }

  prepareLinearTextureData(resources);

  const flipVertical = frameSlot === 1;
  const sourceRgba = resources.linearTextureRgba;
  const sourceTextureRgb = resources.linearTextureRgb;

  for (let y = 0; y < TRIANGLE_TEXTURE_SIZE; y++)
  {
    const sourceY = flipVertical ? TRIANGLE_TEXTURE_SIZE - 1 - y : y;

    for (let x = 0; x < TRIANGLE_TEXTURE_SIZE; x++)
    {
      const sourceIndex = sourceY * TRIANGLE_TEXTURE_SIZE + x;
      const outputOffset = (y * TRIANGLE_TEXTURE_SIZE + x) * 4;
      const targetAlpha = shapeCoverage[sourceIndex] / 255;
      const [sampleU, sampleV] = mapRoundedTriangleTextureUv(
        (x + 0.5) / TRIANGLE_TEXTURE_SIZE,
        (sourceY + 0.5) / TRIANGLE_TEXTURE_SIZE,
        amount,
      );
      const textureSupport = sampleTextureChannel(
        sourceRgba,
        TRIANGLE_TEXTURE_SIZE,
        4,
        sampleU,
        sampleV,
        3,
      ) / 255;

      for (let channel = 0; channel < 3; channel++)
      {
        const textureChannel = sampleTextureChannel(
          sourceTextureRgb,
          TRIANGLE_TEXTURE_SIZE,
          3,
          sampleU,
          sampleV,
          channel,
        );
        const supportedChannel = 1 +
          (textureChannel - 1) * clamp01(textureSupport);
        const roundedChannel = supportedChannel +
          (1 - supportedChannel) * amount;

        frame.image.data[outputOffset + channel] = Math.round(
          clamp01(roundedChannel * safeMaterialEnergy[channel]) * 255,
        );
      }

      frame.image.data[outputOffset + 3] = Math.round(
        clamp01(targetAlpha) * 255,
      );
    }
  }

  frame.context.putImageData(frame.image, 0, 0);
  frame.key = key;
  return frame.canvas;
}

export { triangleTextureResources, triangleTextureUnavailable, circleTextureResources, circleTextureUnavailable, canvasTextureOwners, canvasTextureFrameOwner, canvasTextureReadDepth, canvasTextureReleasePending, canvasTextureIdleTimer, cancelCanvasTextureRelease, scheduleCanvasTextureRelease, trackCanvasTextureUse, releaseCanvasTextureResource, releaseCanvasTextureCache, getTriangleTextureResources, getCircleTextureResources, prepareLinearTextureData, sampleTextureChannel, prepareTextureSample, samplePreparedTextureChannel, LINEAR_TO_SRGB_LUT_SIZE, linearToSrgbLut, getLinearToSrgbLut, createLinearTintFrames, prepareLinearTintedTextureCanvas, prepareCircleTextureCanvas, getRoundedTriangleCoverage, prepareSceneRoundedTriangleCanvas };

// 仅登记轻量所有权标记，缓存不持有引擎实例。
export function beginCanvasTextureFrame(owner)
{
  const previous = canvasTextureFrameOwner;
  canvasTextureFrameOwner = owner;
  return previous;
}

export function enterCanvasTextureFrame()
{
  canvasTextureReadDepth++;
}

export function endCanvasTextureFrame(previous)
{
  canvasTextureFrameOwner = previous;
  canvasTextureReadDepth--;
}

export function flushCanvasTextureRelease()
{
  if (canvasTextureReleasePending && canvasTextureReadDepth === 0) releaseCanvasTextureCache(true);
}
