/**
 * Software Bloom 数值管线测试。
 *
 * 这些检查只依赖 TypedArray，确保 HDR 解码、MXFinalBloom 金字塔和 Canvas 编码
 * 可以脱离 DOM 验证。
 */

import {
  calculateBloomContribution,
  decodeCoverageMask,
  decodeEmissionMask,
  downsampleGaussian,
  encodeAdditiveBloom,
  linearToSrgb,
  limitCanvasAlpha,
  prefilterBloom,
  SoftwareBloomRenderer,
  upsampleAndMixBloom,
} from '../src/software-bloom.js';
import { UNITY_FX_TOUCH } from '../src/config.js';
import { WebGL2BloomRenderer } from '../src/webgl2-bloom.js';
import {
  applyOverlayAlphaPolicyToImageData,
  resolveOverlayAlpha,
  scaleOverlayPremultipliedRgb,
} from '../src/overlay-compositing.js';
import {
  DEFAULT_BLOOM_CLAMP,
  HALF_FLOAT_MAX,
  gammaToLinear,
  resolveUnityBloomClamp,
} from '../src/bloom-color-space.js';

let passed = 0;

function assert(condition, message)
{
  if (!condition)
  {
    throw new Error(message);
  }

  passed++;
  console.log(`  ✓ ${message}`);
}

function approximatelyEqual(left, right, epsilon = 0.000001)
{
  return Math.abs(left - right) <= epsilon;
}

function arraysApproximatelyEqual(left, right, epsilon = 0.000001)
{
  if (left.length !== right.length)
  {
    return false;
  }

  for (let index = 0; index < left.length; index++)
  {
    if (!approximatelyEqual(left[index], right[index], epsilon))
    {
      return false;
    }
  }

  return true;
}

console.log('\nSoftware Bloom 阈值与色彩空间');
assert(
  resolveUnityBloomClamp(DEFAULT_BLOOM_CLAMP) === HALF_FLOAT_MAX,
  '游戏 Clamp 先转 Linear，再按 Shader half 上限限制为 65504',
);
assert(
  resolveUnityBloomClamp(1) === 1 &&
    approximatelyEqual(resolveUnityBloomClamp(0.5), gammaToLinear(0.5)) &&
    approximatelyEqual(gammaToLinear(2), 2 ** 2.2),
  '自定义 Clamp 与 Unity 一样在 Gamma 空间配置并在线性空间生效',
);
assert(
  resolveUnityBloomClamp(Number.NaN) === HALF_FLOAT_MAX,
  '非法 Clamp 安全恢复游戏默认值后再执行相同换算',
);
const belowKnee = calculateBloomContribution(0.4, 1, 0.5);
const insideKnee = calculateBloomContribution(0.75, 1, 0.5);
const atThreshold = calculateBloomContribution(1, 1, 0.5);
const aboveThreshold = calculateBloomContribution(2, 1, 0.5);

assert(belowKnee === 0, '低于 soft-knee 区间的亮度被完全剔除');
assert(
  approximatelyEqual(insideKnee, 0.03125),
  'soft-knee 在阈值下方按 MXFinalBloom 公式平滑引入 Bloom',
);
assert(
  approximatelyEqual(atThreshold, 0.125),
  '阈值位置仍保留连续的 soft-knee 贡献',
);
assert(
  approximatelyEqual(aboveThreshold, 1),
  '超过阈值后采用线性高亮贡献',
);

assert(
  linearToSrgb(-1) === 0 && approximatelyEqual(linearToSrgb(2), 1),
  '线性转 sRGB 会夹紧显示范围',
);
assert(
  approximatelyEqual(linearToSrgb(0.0031308), 0.040449936),
  '线性转 sRGB 在低亮度段使用线性分支',
);
assert(
  approximatelyEqual(linearToSrgb(0.18), 0.46135612950044164),
  '线性转 sRGB 在中间调使用标准幂函数分支',
);

console.log('\nSoftware Bloom HDR 发射解码');
const encodedMask = new Uint8ClampedArray([
  255, 128, 64, 255,
  255, 0, 0, 128,
  255, 255, 255, 0,
]);
const decodedMask = new Float32Array(9);

decodeEmissionMask(encodedMask, decodedMask, 8);

assert(
  arraysApproximatelyEqual(
    decodedMask.slice(0, 3),
    [8, 128 / 255 * 8, 64 / 255 * 8],
  ),
  '发射遮罩按 encodingRange 解码线性 HDR 通道',
);
assert(
  approximatelyEqual(decodedMask[3], 128 / 255 * 8) &&
    decodedMask[4] === 0 &&
    decodedMask[5] === 0,
  '发射遮罩的 Alpha 作为覆盖率参与解码',
);
assert(
  decodedMask[6] === 0 &&
    decodedMask[7] === 0 &&
    decodedMask[8] === 0,
  '零 Alpha 像素不会向 Bloom 注入能量',
);

const reusedDecodedMask = new Float32Array(9).fill(7);

decodeEmissionMask(encodedMask, reusedDecodedMask, 8);
assert(
  reusedDecodedMask[6] === 0 &&
    reusedDecodedMask[7] === 0 &&
    reusedDecodedMask[8] === 0,
  '复用 HDR 缓冲时会清除上一帧的透明像素',
);

console.log('\nSoftware Bloom Coverage 解码');
const encodedCoverage = new Uint8ClampedArray([
  255, 255, 255, 0,
  255, 255, 255, 64,
  255, 255, 255, 128,
  255, 255, 255, 255,
]);
const decodedCoverage = new Float32Array(4).fill(7);

decodeCoverageMask(encodedCoverage, decodedCoverage);
assert(
  arraysApproximatelyEqual(
    decodedCoverage,
    [0, 64 / 255, 128 / 255, 1],
  ),
  'Coverage 只从独立遮罩 Alpha 解码，不读取 HDR RGB',
);
const reusedCoverage = new Float32Array(4).fill(1);
const emptyCoverageBounds = decodeCoverageMask(
  new Uint8ClampedArray(16),
  reusedCoverage,
);

assert(
  emptyCoverageBounds === null &&
    reusedCoverage.every((value) => value === 0),
  '空 Coverage 帧会清除复用缓冲中的上一帧数据',
);

console.log('\nSoftware Bloom MXFinalBloom 预过滤');
const prefilterSource = new Float32Array(4 * 4 * 3);

for (let pixel = 0; pixel < 16; pixel++)
{
  const offset = pixel * 3;

  prefilterSource[offset] = 2;
  prefilterSource[offset + 1] = 1;
  prefilterSource[offset + 2] = 0.5;
}

const prefilterOutput = new Float32Array(2 * 2 * 3);

prefilterBloom(
  prefilterSource,
  4,
  4,
  prefilterOutput,
  2,
  2,
  1,
  0.5,
);

assert(
  arraysApproximatelyEqual(
    prefilterOutput,
    [
      1, 0.5, 0.25,
      1, 0.5, 0.25,
      1, 0.5, 0.25,
      1, 0.5, 0.25,
    ],
  ),
  '4-tap 预过滤保持均匀场并按阈值缩放色调',
);
assert(
  prefilterSource[0] === 2 && prefilterSource[2] === 0.5,
  '预过滤不会修改输入缓冲',
);

const defaultClampSource = new Float32Array(4 * 4 * 3);
const defaultClampOutput = new Float32Array(2 * 2 * 3);

defaultClampSource.fill(HALF_FLOAT_MAX + 32);
prefilterBloom(
  defaultClampSource,
  4,
  4,
  defaultClampOutput,
  2,
  2,
  0,
  0,
);
assert(
  defaultClampOutput.every((value) => value === HALF_FLOAT_MAX),
  '底层预过滤省略 Clamp 时仍遵守 Unity Shader half 上限',
);

console.log('\nSoftware Bloom Box4 降采样');
const downsampleWidth = 16;
const downsampleHeight = 16;
const downsampleOutputWidth = 8;
const downsampleOutputHeight = 8;
const impulse = new Float32Array(downsampleWidth * downsampleHeight * 3);
const downsampleScratch = new Float32Array(
  downsampleOutputWidth * downsampleOutputHeight * 3,
);
const downsampleOutput = new Float32Array(downsampleScratch.length);
const impulseCenters = [
  (7 * downsampleWidth + 7) * 3,
  (7 * downsampleWidth + 8) * 3,
  (8 * downsampleWidth + 7) * 3,
  (8 * downsampleWidth + 8) * 3,
];

// 2×2 对称脉冲使能量中心落在偶数纹理的像素边界上。
for (const center of impulseCenters)
{
  impulse[center] = 2.25;
}
downsampleGaussian(
  impulse,
  downsampleWidth,
  downsampleHeight,
  downsampleScratch,
  downsampleOutput,
  downsampleOutputWidth,
  downsampleOutputHeight,
);

const centerRow = [];
let downsampleEnergy = 0;
let leakedChannelEnergy = 0;

for (let pixel = 0; pixel < downsampleOutput.length / 3; pixel++)
{
  const offset = pixel * 3;

  downsampleEnergy += downsampleOutput[offset];
  leakedChannelEnergy += downsampleOutput[offset + 1] +
    downsampleOutput[offset + 2];
}

for (let x = 0; x < downsampleOutputWidth; x++)
{
  centerRow.push(
    downsampleOutput[(3 * downsampleOutputWidth + x) * 3],
  );
}

assert(
  approximatelyEqual(centerRow[3], centerRow[4]) &&
    approximatelyEqual(centerRow[3], 0.5625) &&
    centerRow.slice(0, 3).every((value) => value === 0) &&
    centerRow.slice(5).every((value) => value === 0),
  '2× floor mip 的 Box4 保持双像素中心对称',
);
assert(
  approximatelyEqual(downsampleEnergy, 2.25),
  'Box4 使用 MXFinalBloom 的四点均值并保持离散能量',
);
assert(
  leakedChannelEnergy === 0 &&
    impulseCenters.every((center) => impulse[center] === 2.25),
  'Box4 不串色且不会修改输入缓冲',
);

const reusedDownsampleScratch = new Float32Array(
  downsampleScratch.length,
).fill(7);
const reusedDownsampleOutput = new Float32Array(
  downsampleOutput.length,
).fill(7);

downsampleGaussian(
  impulse,
  downsampleWidth,
  downsampleHeight,
  reusedDownsampleScratch,
  reusedDownsampleOutput,
  downsampleOutputWidth,
  downsampleOutputHeight,
);
assert(
  arraysApproximatelyEqual(
    reusedDownsampleOutput,
    downsampleOutput,
  ),
  'Box4 完整覆盖复用缓冲时不受上一帧脏值影响',
);

const partialScratch = new Float32Array(downsampleScratch.length).fill(7);
const partialOutput = new Float32Array(downsampleOutput.length).fill(7);

downsampleGaussian(
  impulse,
  downsampleWidth,
  downsampleHeight,
  partialScratch,
  partialOutput,
  downsampleOutputWidth,
  downsampleOutputHeight,
  {
    minimumX: 6,
    minimumY: 6,
    maximumX: 9,
    maximumY: 9,
  },
);
assert(
  !partialOutput.some((value) => value === 7),
  'Box4 忽略优化 bounds 时仍完整覆盖复用缓冲',
);

console.log('\nSoftware Bloom 金字塔上采样');
const uniformHigh = new Float32Array(4 * 4 * 3);
const uniformLow = new Float32Array(2 * 2 * 3);

for (let pixel = 0; pixel < 16; pixel++)
{
  const offset = pixel * 3;

  uniformHigh[offset] = 2;
  uniformHigh[offset + 1] = 1;
  uniformHigh[offset + 2] = 0.5;
}

for (let pixel = 0; pixel < 4; pixel++)
{
  const offset = pixel * 3;

  uniformLow[offset] = 6;
  uniformLow[offset + 1] = 3;
  uniformLow[offset + 2] = 1.5;
}

const uniformMixed = new Float32Array(uniformHigh.length);

upsampleAndMixBloom(
  uniformHigh,
  4,
  4,
  uniformLow,
  2,
  2,
  uniformMixed,
  1.42925835,
  true,
);

assert(
  arraysApproximatelyEqual(
    uniformMixed.slice(0, 3),
    [8, 4, 2],
  ),
  '反向金字塔将粗层四点均值累加到细层中心值',
);

const reusedUniformMixed = new Float32Array(uniformHigh.length).fill(7);

upsampleAndMixBloom(
  uniformHigh,
  4,
  4,
  uniformLow,
  2,
  2,
  reusedUniformMixed,
  1.42925835,
  true,
);
assert(
  arraysApproximatelyEqual(reusedUniformMixed, uniformMixed),
  '上采样完整覆盖复用缓冲时不受上一帧脏值影响',
);

const cornerLow = new Float32Array([
  4, 0, 0,
  0, 0, 0,
  0, 0, 0,
  0, 0, 0,
]);
const zeroHigh = new Float32Array(4 * 4 * 3);
const bicubicMixed = new Float32Array(zeroHigh.length);
const bilinearMixed = new Float32Array(zeroHigh.length);

upsampleAndMixBloom(
  zeroHigh,
  4,
  4,
  cornerLow,
  2,
  2,
  bicubicMixed,
  1.42925835,
  true,
);
upsampleAndMixBloom(
  zeroHigh,
  4,
  4,
  cornerLow,
  2,
  2,
  bilinearMixed,
  1.42925835,
  false,
);

assert(
  arraysApproximatelyEqual(
    [bicubicMixed[0], bicubicMixed[3], bicubicMixed[6], bicubicMixed[9]],
    [
      2.35736346244812,
      1.589678168296814,
      1.4810634851455688,
      0.7133780717849731,
    ],
  ),
  '上采样按 SampleScale 对粗层执行四点采样',
);
assert(
  arraysApproximatelyEqual(
    [bilinearMixed[0], bilinearMixed[3], bilinearMixed[6], bilinearMixed[9]],
    [
      2.35736346244812,
      1.589678168296814,
      1.4810634851455688,
      0.7133780717849731,
    ],
  ),
  'MXFinalBloom 上采样不再分叉为 URP bicubic 模式',
);

console.log('\nSoftware Bloom 加色编码');
const hdrBloom = new Float32Array([
  4, 2, 1,
  0, 0, 0,
  0.25, 1, 3,
  0.25, 0.0625, 0,
]);
const rgba = new Uint8ClampedArray(16);

encodeAdditiveBloom(hdrBloom, rgba, 1.7);

assert(
  arraysApproximatelyEqual(
    rgba,
    [
      255, 186, 135, 188,
      0, 0, 0, 0,
      77, 153, 255, 165,
      255, 111, 0, 49,
    ],
    0,
  ),
  '线性 HDR 经过游戏强度转换和 sRGB 编码后得到确定的 RGBA8',
);
assert(
  rgba[4] === 0 &&
    rgba[5] === 0 &&
    rgba[6] === 0 &&
    rgba[7] === 0,
  '零能量严格编码为透明像素，避免浅色背景被黑色覆盖',
);
assert(
  rgba[12] === 255 && rgba[15] < 255,
  '低亮度贡献使用反预乘颜色和非零 Alpha 保存加色结果',
);

const boundedRgba = new Uint8ClampedArray(16);

encodeAdditiveBloom(
  hdrBloom,
  boundedRgba,
  1.7,
  4,
  {
    minimumX: 2,
    minimumY: 0,
    maximumX: 3,
    maximumY: 0,
  },
);
assert(
  boundedRgba.slice(0, 8).every((value) => value === 0) &&
    arraysApproximatelyEqual(boundedRgba.slice(8), rgba.slice(8), 0),
  '加色编码只访问指定的实际辉光区域',
);

const floorSource = new Float32Array(5 * 5 * 3).fill(1);
const floorRgba = new Uint8ClampedArray(5 * 5 * 4);
const floorCenter = (2 * 5 + 2) * 3;

floorSource[floorCenter] = 4;
floorSource[floorCenter + 1] = 4;
floorSource[floorCenter + 2] = 4;

encodeAdditiveBloom(
  floorSource,
  floorRgba,
  10,
  5,
  null,
  {
    minimumX: 0,
    minimumY: 0,
    maximumX: 4,
    maximumY: 4,
    feather: 2,
    left: [1, 1, 1],
    right: [1, 1, 1],
    top: [1, 1, 1],
    bottom: [1, 1, 1],
  },
);
assert(
  floorRgba[3] === 0 &&
    floorRgba[(2 * 5 + 2) * 4 + 3] === 255 &&
    floorRgba[(4 * 5 + 4) * 4 + 3] === 0 &&
    floorRgba[(1 * 5 + 2) * 4 + 3] > 0,
  '局部 Bloom 只在裁剪边界移除底色，并向内部平滑保留低频辉光',
);

console.log('\nSoftware Bloom 透明覆盖层编码');
const coverageAlphaResult = resolveOverlayAlpha(0.4, 0.35, 1, 'coverage');
const visualMaxAlphaResult = resolveOverlayAlpha(0.4, 0.35, 1, 'visual-max');

assert(
  Math.abs(coverageAlphaResult.alpha - 0.75) < 0.000001 &&
    Math.abs(visualMaxAlphaResult.alpha - 0.4) < 0.000001,
  'Alpha 策略分别使用清晰与 Bloom 传输和或最大值',
);

const visualMaxPremultiplied = scaleOverlayPremultipliedRgb(
  [0.8, 0.3, 0.1],
  visualMaxAlphaResult.requestedAlpha,
  visualMaxAlphaResult.alpha,
  'visual-max',
);

assert(
  Math.abs(visualMaxPremultiplied[0] - 0.4) < 0.000001 &&
    Math.abs(visualMaxPremultiplied[1] - 0.15) < 0.000001 &&
    Math.abs(visualMaxPremultiplied[2] - 0.05) < 0.000001,
  'visual-max 只用 maxRGB 收敛预乘颜色而不改变 Alpha',
);

const visualMaxImageData = {
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([204, 102, 51, 191]),
};
const clearSceneData = new Uint8ClampedArray([0, 0, 0, 102]);

applyOverlayAlphaPolicyToImageData(
  visualMaxImageData,
  clearSceneData,
  1,
  'visual-max',
);

assert(
  visualMaxImageData.data[3] === 102 &&
    visualMaxImageData.data[0] === 255 &&
    visualMaxImageData.data[1] > visualMaxImageData.data[2],
  'Canvas visual-max 从最终载荷恢复 Scene/Bloom 最大 Alpha 并保留色相',
);

const overlayHdr = new Float32Array([
  4, 2, 1,
  4, 2, 1,
  4, 2, 1,
  4, 2, 1,
]);
const overlayCoverage = new Float32Array([0, 0.25, 0.5, 1]);
const overlayRgba = new Uint8ClampedArray(16);
const overlayExposure = Math.pow(2, 1.7 / 10) - 1;
const overlayAlphaLimit = 250 / 255;
const expectedTransportAlpha = (value) => Math.min(
  overlayAlphaLimit,
  linearToSrgb(value * overlayExposure),
);

encodeAdditiveBloom(
  overlayHdr,
  overlayRgba,
  1.7,
  4,
  null,
  null,
  {
    outputCompositing: 'browser-overlay',
    coverage: overlayCoverage,
  },
);

assert(
  overlayRgba.slice(0, 4).every((value) => value === 0),
  'browser-overlay 在 Bright Pass 能量为零时不输出颜色或 Alpha',
);
assert(
  [1, 2, 3].every((pixel) =>
    Math.abs(
      overlayRgba[pixel * 4 + 3] / 255 -
        expectedTransportAlpha(overlayCoverage[pixel]),
    ) <= 1 / 255) &&
    overlayRgba[7] < overlayRgba[11] &&
    overlayRgba[11] < overlayRgba[15],
  'browser-overlay Alpha 由 Bright Pass 传输上界单调生成',
);

let validPremultipliedOverlay = true;

for (let pixel = 0; pixel < overlayRgba.length / 4; pixel++)
{
  const offset = pixel * 4;
  const alpha = overlayRgba[offset + 3] / 255;

  for (let channel = 0; channel < 3; channel++)
  {
    const premultiplied = overlayRgba[offset + channel] / 255 * alpha;

    if (premultiplied > alpha + 1 / 255)
    {
      validPremultipliedOverlay = false;
    }
  }
}

assert(
  validPremultipliedOverlay,
  'browser-overlay 写入 Canvas 后的预乘 RGB 始终不超过 Alpha',
);

const dimOverlayRgba = new Uint8ClampedArray(4);
const brightOverlayRgba = new Uint8ClampedArray(4);
const fixedCoverage = new Float32Array([0.35]);

encodeAdditiveBloom(
  new Float32Array([0.5, 0.25, 0.125]),
  dimOverlayRgba,
  1.7,
  1,
  null,
  null,
  {
    outputCompositing: 'browser-overlay',
    coverage: fixedCoverage,
  },
);
encodeAdditiveBloom(
  new Float32Array([8, 4, 2]),
  brightOverlayRgba,
  1.7,
  1,
  null,
  null,
  {
    outputCompositing: 'browser-overlay',
    coverage: fixedCoverage,
  },
);
assert(
  dimOverlayRgba[3] === brightOverlayRgba[3] &&
    Math.abs(
      dimOverlayRgba[3] / 255 - expectedTransportAlpha(0.35),
    ) <= 1 / 255,
  'browser-overlay 传输 Alpha 不读取最终 Bloom RGB',
);

const opacitySeries = [0, 0.5, 1].map((opacity) =>
{
  const output = new Uint8ClampedArray(4);

  encodeAdditiveBloom(
    new Float32Array([8, 4, 2]),
    output,
    1.7,
    1,
    null,
    null,
    {
      outputCompositing: 'browser-overlay',
      coverage: new Float32Array([100]),
      overlayAlphaLimit,
      opacity,
    },
  );
  return output[3];
});

assert(
  JSON.stringify(opacitySeries) === JSON.stringify([250, 250, 250]),
  'browser-overlay 的 Alpha 容量与 effect opacity 保持独立',
);

const alphaLimitSeries = [0, 0.5, 1].map((overlayAlphaLimitValue) =>
{
  const output = new Uint8ClampedArray(4);

  encodeAdditiveBloom(
    new Float32Array([8, 4, 2]),
    output,
    1.7,
    1,
    null,
    null,
    {
      outputCompositing: 'browser-overlay',
      coverage: new Float32Array([100]),
      overlayAlphaLimit: overlayAlphaLimitValue,
      opacity: 0.5,
    },
  );
  return output[3];
});

assert(
  JSON.stringify(alphaLimitSeries) === JSON.stringify([0, 128, 255]),
  'overlayAlphaLimit 独立控制最终网页覆盖层容量',
);

const coverageAppearanceRgba = new Uint8ClampedArray(4);
const brightAppearanceRgba = new Uint8ClampedArray(4);
const additiveHostRgba = new Uint8ClampedArray(4);
const scenePayloadRgba = new Uint8ClampedArray(4);
const appearanceSource = new Float32Array([0.4, 0.2, 0.1]);
const appearanceCoverage = new Float32Array([1]);
const appearanceOptions = {
  outputCompositing: 'browser-overlay',
  coverage: appearanceCoverage,
  overlayAlphaLimit: 0.2,
  opacity: 1,
};

encodeAdditiveBloom(
  appearanceSource,
  coverageAppearanceRgba,
  1.7,
  1,
  null,
  null,
  appearanceOptions,
);
encodeAdditiveBloom(
  appearanceSource,
  brightAppearanceRgba,
  1.7,
  1,
  null,
  null,
  {
    ...appearanceOptions,
    unknownBackgroundAppearance: 'bright',
  },
);
encodeAdditiveBloom(
  appearanceSource,
  additiveHostRgba,
  1.7,
  1,
  null,
  null,
  {
    ...appearanceOptions,
    hostCompositing: 'plus-lighter',
  },
);
encodeAdditiveBloom(
  appearanceSource,
  scenePayloadRgba,
  1.7,
  1,
  null,
  null,
  { outputCompositing: 'scene' },
);

assert(
  coverageAppearanceRgba[3] === 51 &&
    brightAppearanceRgba[3] === 51 &&
    brightAppearanceRgba[0] >= coverageAppearanceRgba[0] &&
    brightAppearanceRgba[1] > coverageAppearanceRgba[1] &&
    brightAppearanceRgba[2] > coverageAppearanceRgba[2],
  'bright 只补偿独立高能 Bloom 通道且不改变 Coverage Alpha',
);
assert(
  [0, 1, 2].every((channel) =>
    brightAppearanceRgba[channel] <= 255) &&
    additiveHostRgba[3] > 51,
  'bright 保持预乘容量而宿主 Add 绕过网页 Alpha 上限',
);

const additivePremultiplied = [0, 1, 2].map((channel) =>
  additiveHostRgba[channel] * additiveHostRgba[3] / 255);
const scenePremultiplied = [0, 1, 2].map((channel) =>
  scenePayloadRgba[channel] * scenePayloadRgba[3] / 255);

assert(
  additivePremultiplied.every((value, channel) =>
    approximatelyEqual(value, scenePremultiplied[channel], 2)),
  '宿主 Add 传输完整 Scene Bloom 载荷而不按 Coverage 容量压缩',
);

const additiveHostWithSceneRgba = new Uint8ClampedArray(4);

encodeAdditiveBloom(
  new Float32Array([0.01, 0.005, 0.0025]),
  additiveHostWithSceneRgba,
  1.7,
  1,
  null,
  null,
  {
    outputCompositing: 'browser-overlay',
    coverage: new Float32Array([0.2]),
    sceneCoverage: new Float32Array([0.5]),
    hostCompositing: 'plus-lighter',
  },
);

assert(
  approximatelyEqual(
    additiveHostWithSceneRgba[3] / 255,
    linearToSrgb(0.2 * overlayExposure),
    1 / 255,
  ) && additiveHostWithSceneRgba[3] < 128,
  '宿主 Add 的 Software Bloom Alpha 不重复累计清晰层 Coverage',
);

const deferredOverlayRgba = new Uint8ClampedArray(4);

encodeAdditiveBloom(
  new Float32Array([0.1, 0.05, 0.025]),
  deferredOverlayRgba,
  1.7,
  1,
  null,
  null,
  {
    outputCompositing: 'browser-overlay',
    coverage: new Float32Array([0.5]),
    sceneCoverage: new Float32Array([0.5]),
    overlayAlphaLimit: 0.7,
    deferOverlayAlphaLimit: true,
  },
);

assert(
  approximatelyEqual(
    deferredOverlayRgba[3] / 255,
    linearToSrgb(0.5 * overlayExposure),
    1 / 255,
  ),
  'Software Bloom 先输出完整传输 Alpha，再由最终 Canvas 限制总容量',
);

const lowEnergyCoverageRgba = new Uint8ClampedArray(4);
const lowEnergyBrightRgba = new Uint8ClampedArray(4);
const lowEnergySource = new Float32Array([0.001, 0.0005, 0.00025]);
const lowEnergyOptions = {
  outputCompositing: 'browser-overlay',
  coverage: new Float32Array([0.001]),
  overlayAlphaLimit: 0.7,
  opacity: 1,
};

encodeAdditiveBloom(
  lowEnergySource,
  lowEnergyCoverageRgba,
  1.7,
  1,
  null,
  null,
  lowEnergyOptions,
);
encodeAdditiveBloom(
  lowEnergySource,
  lowEnergyBrightRgba,
  1.7,
  1,
  null,
  null,
  {
    ...lowEnergyOptions,
    unknownBackgroundAppearance: 'bright',
  },
);

assert(
  arraysApproximatelyEqual(lowEnergyBrightRgba, lowEnergyCoverageRgba, 0),
  'bright 的绝对能量门不会把低能拖尾尾端补成灰白色',
);

const limitedCanvasData = new Uint8ClampedArray([
  20, 40, 60, 255,
  10, 20, 30, 64,
]);
let limitedCanvasWrite = null;
const limitedCanvasContext = {
  canvas: { width: 2, height: 1 },
  getImageData: () => ({ data: limitedCanvasData }),
  putImageData: (image) =>
  {
    limitedCanvasWrite = image.data;
  },
};

assert(
  limitCanvasAlpha(
    limitedCanvasContext,
    { minimumX: 0, minimumY: 0, maximumX: 1, maximumY: 0 },
    0.7,
  ) &&
    limitedCanvasWrite?.[3] === 179 &&
    limitedCanvasWrite?.[7] === 64 &&
    limitedCanvasWrite?.[0] === 20,
  'Canvas 脏区上限只收敛超限 Alpha 并保留非预乘 RGB',
);

const sceneCoverage = new Float32Array([0.45, 0.45, 0, 1]);
const bloomCoverage = new Float32Array([0.45, 0.7, 0.2, 1]);
const residualOverlayRgba = new Uint8ClampedArray(16);

encodeAdditiveBloom(
  new Float32Array([
    4, 2, 1,
    4, 2, 1,
    4, 2, 1,
    4, 2, 1,
  ]),
  residualOverlayRgba,
  1.7,
  4,
  null,
  null,
  {
    outputCompositing: 'browser-overlay',
    coverage: bloomCoverage,
    sceneCoverage,
  },
);

const additiveAlpha = (pixel) =>
{
  const sourceAlpha = residualOverlayRgba[pixel * 4 + 3] / 255;
  const destinationAlpha = sceneCoverage[pixel];

  return Math.min(1, sourceAlpha + destinationAlpha);
};

assert(
  [0, 1, 2].every((pixel) =>
  {
    const expected = Math.min(
      overlayAlphaLimit,
      sceneCoverage[pixel] + expectedTransportAlpha(bloomCoverage[pixel]),
    );

    return approximatelyEqual(additiveAlpha(pixel), expected, 1 / 255);
  }),
  'Bloom lighter 合成只占用清晰 Coverage 之外的剩余 Alpha 容量',
);
assert(
  residualOverlayRgba[15] === 0 && additiveAlpha(3) === 1,
  '清晰层已占满容量时不会生成额外 Bloom Alpha',
);

const explicitSceneRgba = new Uint8ClampedArray(rgba.length);

encodeAdditiveBloom(
  hdrBloom,
  explicitSceneRgba,
  1.7,
  4,
  null,
  null,
  {
    outputCompositing: 'scene',
    coverage: overlayCoverage,
  },
);
assert(
  arraysApproximatelyEqual(explicitSceneRgba, rgba, 0),
  'scene 显式设置仍保持原有 maxRGB 加色编码基线',
);

function createSoftwareCanvasFactory()
{
  let creationCount = 0;
  const canvases = [];
  const createCanvas = () =>
  {
    creationCount++;
    const context =
    {
      clearRect()
      {
      },
      createImageData(width, height)
      {
        return {
          data: new Uint8ClampedArray(width * height * 4),
        };
      },
      drawImage()
      {
      },
      getImageData(x, y, width, height)
      {
        return {
          data: new Uint8ClampedArray(width * height * 4),
        };
      },
      putImageData()
      {
      },
      setTransform()
      {
      },
    };
    const canvas =
    {
      width: 0,
      height: 0,
      getContext()
      {
        return context;
      },
    };

    canvases.push(canvas);
    return canvas;
  };

  return {
    canvases,
    createCanvas,
    get creationCount()
    {
      return creationCount;
    },
  };
}

const coverageFactory = createSoftwareCanvasFactory();
const coverageRenderer = new SoftwareBloomRenderer(
  coverageFactory.createCanvas,
);

coverageRenderer.beginFrame(
  64,
  64,
  0.5,
  { x: 0, y: 0, width: 64, height: 64 },
  7,
  1,
);
assert(
  coverageFactory.creationCount === 2 &&
    coverageRenderer.beginCoverageFrame('scene') === null &&
    coverageFactory.creationCount === 2 &&
    coverageRenderer.sourceCoverage.length === 0,
  'scene 模式不会创建 Coverage Canvas 或分配单通道金字塔',
);
assert(
  coverageRenderer.beginCoverageFrame('browser-overlay') !== null &&
    coverageFactory.creationCount === 3 &&
    coverageRenderer.sourceCoverage.length === 0,
  'browser-overlay 首次使用时才懒创建 Coverage Canvas',
);
coverageRenderer.outputBounds = {
  minimumX: 0,
  minimumY: 0,
  maximumX: 1,
  maximumY: 1,
};
const emptyCoverageComposite = coverageRenderer.composite(
  {
    drawImage()
    {
    },
  },
  {
    outputCompositing: 'browser-overlay',
    encodingRange: 8,
    threshold: 1,
    softKnee: 0.5,
    clamp: 65472,
    intensity: 1.7,
  },
);
assert(
  emptyCoverageComposite &&
    coverageRenderer.outputBounds === null &&
    !coverageRenderer.coverageFrameReady &&
    coverageRenderer.sourceCoverage.length > 0 &&
    coverageRenderer.coverageLevels[0].width === coverageRenderer.width &&
    coverageRenderer.coverageLevels[0].height === coverageRenderer.height &&
    coverageRenderer.coverageLevels[0].down.length ===
      coverageRenderer.outputImageData.data.length / 4 &&
    coverageRenderer.coverageLevels.every((level) =>
      level.down.every((value) => value === 0)),
  '透明模式以输出分辨率保存清晰 Coverage 且空帧不保留旧值',
);
const allocatedCoverageCanvas = coverageRenderer.coverageCanvas;

coverageRenderer.destroy();
assert(
  allocatedCoverageCanvas.width === 0 &&
    allocatedCoverageCanvas.height === 0 &&
    coverageRenderer.coverageCanvas === null &&
    coverageRenderer.coverageContext === null &&
    coverageRenderer.sourceCoverage.length === 0 &&
    coverageRenderer.coverageLevels.length === 0 &&
    coverageRenderer.coverageLevelStorage.length === 0,
  'Software renderer 销毁时释放 Coverage Canvas 与单通道金字塔',
);

function createResizeTestRenderer(maximumSize = 64)
{
  let nextTargetId = 1;
  const targetCreations = [];
  const createdTargets = [];
  const deletedTextures = new Set();
  const deletedFramebuffers = new Set();
  const pendingErrors = [];
  const gl =
  {
    NO_ERROR: 0,
    OUT_OF_MEMORY: 0x0505,
    deleteTexture(texture)
    {
      if (texture)
      {
        deletedTextures.add(texture);
      }
    },
    deleteFramebuffer(framebuffer)
    {
      if (framebuffer)
      {
        deletedFramebuffers.add(framebuffer);
      }
    },
    deleteProgram()
    {
    },
    deleteBuffer()
    {
    },
    deleteVertexArray()
    {
    },
    getError()
    {
      return pendingErrors.shift() ?? this.NO_ERROR;
    },
  };
  const canvas =
  {
    width: 0,
    height: 0,
    removeEventListener()
    {
    },
  };
  const renderer = Object.create(WebGL2BloomRenderer.prototype);

  Object.assign(
    renderer,
    {
      canvas,
      gl,
      available: true,
      contextLost: false,
      displayWidth: 1,
      displayHeight: 1,
      sourceWidth: 0,
      sourceHeight: 0,
      width: 0,
      height: 0,
      dpr: 1,
      resolutionScale: 0,
      diffusion: 0,
      sampleScale: 1,
      maximumTextureSize: maximumSize,
      maximumViewportWidth: maximumSize,
      maximumViewportHeight: maximumSize,
      vertexCount: 0,
      vertexData: new Float32Array(1),
      sourceTarget: null,
      levels: [],
      failedResizeSignature: null,
      programs: null,
      emissionBuffer: null,
      emissionVao: null,
      fullscreenVao: null,
      failureSourceWidth: null,
      failureAfterTargetCount: null,
      stats:
      {
        vertexCount: 0,
        levelCount: 0,
        bloomPixels: 0,
      },
      _onContextLost: null,
      _onContextRestored: null,
    },
  );
  renderer._createTarget = (width, height) =>
  {
    targetCreations.push([width, height]);

    if (renderer.sourceWidth === renderer.failureSourceWidth)
    {
      if (renderer.failureAfterTargetCount === 0)
      {
        pendingErrors.push(gl.OUT_OF_MEMORY);
        throw new Error('模拟 RenderTarget 分配失败');
      }

      renderer.failureAfterTargetCount--;
    }

    const id = nextTargetId++;
    const target =
    {
      width,
      height,
      texture:
      {
        id,
      },
      framebuffer:
      {
        id,
      },
    };

    createdTargets.push(target);
    return target;
  };

  return {
    renderer,
    targetCreations,
    createdTargets,
    deletedTextures,
    deletedFramebuffers,
    pendingErrors,
  };
}

console.log('\nWebGL2 尺寸失败恢复');
const resizeHarness = createResizeTestRenderer();
const resizeRenderer = resizeHarness.renderer;
const previousConsoleWarn = console.warn;
const resizeWarnings = [];
let firstResizeTarget = null;
let recoveredResizeTarget = null;

console.warn = (...args) =>
{
  resizeWarnings.push(args.join(' '));
};

try
{
  assert(
    resizeRenderer.resize(64, 32, 1, 0.5, 0),
    'WebGL2 在设备限制内先建立正常尺寸目标',
  );
  firstResizeTarget = resizeRenderer.sourceTarget;

  assert(
    !resizeRenderer.resize(128, 32, 1, 0.5, 0) &&
      resizeRenderer.available &&
      resizeRenderer.sourceTarget === null &&
      resizeRenderer.levels.length === 0,
    'WebGL2 超限尺寸只回退当前帧，不永久禁用已初始化上下文',
  );
  const oversizeCreationCount = resizeHarness.targetCreations.length;

  assert(
    !resizeRenderer.resize(128, 32, 1, 0.5, 0) &&
      resizeWarnings.length === 1 &&
      resizeHarness.targetCreations.length === oversizeCreationCount,
    'WebGL2 缓存相同超限尺寸，不重复警告或创建 GPU 目标',
  );
  assert(
    resizeRenderer.resize(64, 32, 1, 0.5, 0),
    'WebGL2 从超限尺寸缩回后重新分配目标',
  );
  recoveredResizeTarget = resizeRenderer.sourceTarget;

  resizeRenderer.failureSourceWidth = 48;
  resizeRenderer.failureAfterTargetCount = 2;
  const partialTargetStart = resizeHarness.createdTargets.length;
  assert(
    !resizeRenderer.resize(48, 32, 1, 0.5, 10) &&
      resizeRenderer.available &&
      resizeRenderer.sourceTarget === null &&
      resizeRenderer.failedResizeSignature !== null &&
      resizeHarness.pendingErrors.length === 0,
    'RenderTarget 创建异常只回退当前尺寸，并排空显存错误状态',
  );
  const partialTargets = resizeHarness.createdTargets.slice(
    partialTargetStart,
  );

  assert(
    partialTargets.length === 2 &&
      partialTargets.every((target) =>
        resizeHarness.deletedTextures.has(target.texture) &&
          resizeHarness.deletedFramebuffers.has(target.framebuffer)),
    'WebGL2 分配中途失败会释放已创建的 source 与 mip 目标',
  );
  const allocationFailureCreationCount = resizeHarness.targetCreations.length;

  assert(
    !resizeRenderer.resize(48, 32, 1, 0.5, 10) &&
      resizeWarnings.length === 2 &&
      resizeHarness.targetCreations.length === allocationFailureCreationCount,
    '相同的分配失败尺寸不会在后续探测中重复分配',
  );

  resizeRenderer.failureSourceWidth = null;
  resizeRenderer._forgetResourceReferences();
  assert(
    resizeRenderer.failedResizeSignature === null &&
      resizeRenderer.resize(48, 32, 1, 0.5, 10),
    'Context 资源失效后清除失败尺寸缓存并允许重新探测',
  );
}
finally
{
  console.warn = previousConsoleWarn;
}

assert(
  resizeWarnings.length === 2 &&
    recoveredResizeTarget &&
    recoveredResizeTarget !== firstResizeTarget &&
    resizeHarness.deletedTextures.has(firstResizeTarget.texture) &&
    resizeHarness.deletedFramebuffers.has(firstResizeTarget.framebuffer),
  'WebGL2 尺寸失败与恢复替换旧目标且不残留旧资源引用',
);
resizeRenderer.failedResizeSignature = '待销毁尺寸';
resizeRenderer.destroy();
assert(
  !resizeRenderer.available &&
    resizeRenderer.failedResizeSignature === null &&
    resizeRenderer.sourceTarget === null &&
    resizeRenderer.levels.length === 0,
  'WebGL2 renderer 销毁时同时清除目标和失败尺寸缓存',
);

const rendererCanvas =
{
  addEventListener()
  {
  },
  removeEventListener()
  {
  },
  getContext()
  {
    return null;
  },
};
const geometryRenderer = new WebGL2BloomRenderer(rendererCanvas);
const upwardFrame = UNITY_FX_TOUCH.shards.textureFrames[1];

geometryRenderer.beginFrame();
geometryRenderer.addTriangle(10, 20, 20, 0, [1, 2, 3], 1, upwardFrame);

assert(
  geometryRenderer.vertexCount === 0 &&
    geometryRenderer.triangleVertexCount === 6 &&
    approximatelyEqual(geometryRenderer.triangleVertexData[0], 0) &&
    approximatelyEqual(
      geometryRenderer.triangleVertexData[1],
      10,
    ) &&
    approximatelyEqual(
      geometryRenderer.triangleVertexData[8],
      20,
    ) &&
    approximatelyEqual(geometryRenderer.triangleVertexData[2], 0) &&
    approximatelyEqual(geometryRenderer.triangleVertexData[3], 1) &&
    approximatelyEqual(geometryRenderer.triangleVertexData[10], 1) &&
    approximatelyEqual(geometryRenderer.triangleVertexData[11], 1) &&
    approximatelyEqual(geometryRenderer.triangleVertexData[18], 1) &&
    approximatelyEqual(geometryRenderer.triangleVertexData[19], 0),
  'WebGL2 碎片以完整 Quad 采样 Unity 2×1 图集的实测透明轮廓',
);

geometryRenderer.beginFrame();
const headCenterToEdge =
  UNITY_FX_TOUCH.trail.textureTransverseProfileKeys.at(-1)[1];
const headTransverseProfile = [];
const headEdgeIndex = headCenterToEdge.length - 1;

for (let index = headEdgeIndex; index >= 0; index--)
{
  headTransverseProfile.push(
    [
      (headEdgeIndex - index) / (headEdgeIndex * 2),
      headCenterToEdge[index],
    ],
  );
}

for (let index = 1; index <= headEdgeIndex; index++)
{
  headTransverseProfile.push(
    [
      0.5 + index / (headEdgeIndex * 2),
      headCenterToEdge[index],
    ],
  );
}

geometryRenderer.addTrailSegment(
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  4,
  [1, 1, 1],
  1,
  headTransverseProfile,
);

const trailVertices = [];

for (let index = 0; index < geometryRenderer.vertexCount; index++)
{
  const offset = index * 6;

  trailVertices.push(
    {
      y: geometryRenderer.vertexData[offset + 1],
      energy: geometryRenderer.vertexData[offset + 2],
      coverage: geometryRenderer.vertexData[offset + 5],
    },
  );
}

assert(
  geometryRenderer.vertexCount ===
      (headTransverseProfile.length - 1) * 6 &&
    approximatelyEqual(Math.max(...trailVertices.map(({ y }) => y)), 2) &&
    approximatelyEqual(Math.min(...trailVertices.map(({ y }) => y)), -2) &&
    approximatelyEqual(
      Math.min(...trailVertices.map(({ energy }) => energy)),
      0.0015,
    ) &&
    approximatelyEqual(
      Math.max(...trailVertices.map(({ energy }) => energy)),
      1,
    ) &&
    trailVertices.every(({ coverage }) => approximatelyEqual(coverage, 1)),
  'WebGL2 拖尾把原纹理羽化横截面细分进真实 2.7px 三角带',
);

geometryRenderer.destroy();

console.log(`\n✅ ${passed} 项 Software Bloom 数值检查通过\n`);
