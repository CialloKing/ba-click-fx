/**
 * Software Bloom 数值管线测试。
 *
 * 这些检查只依赖 TypedArray，确保 HDR 解码、URP 金字塔和 Canvas 编码
 * 可以脱离 DOM 验证。
 */

import {
  calculateBloomContribution,
  decodeEmissionMask,
  downsampleGaussian,
  encodeAdditiveBloom,
  linearToSrgb,
  prefilterBloom,
  upsampleAndMixBloom,
} from '../src/software-bloom.js';

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
const belowKnee = calculateBloomContribution(0.4, 1, 0.5);
const insideKnee = calculateBloomContribution(0.75, 1, 0.5);
const atThreshold = calculateBloomContribution(1, 1, 0.5);
const aboveThreshold = calculateBloomContribution(2, 1, 0.5);

assert(belowKnee === 0, '低于 soft-knee 区间的亮度被完全剔除');
assert(
  approximatelyEqual(insideKnee, 0.03124843757812109),
  'soft-knee 在阈值下方按 URP 公式平滑引入 Bloom',
);
assert(
  approximatelyEqual(atThreshold, 0.12499375031248436),
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

console.log('\nSoftware Bloom URP 预过滤');
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
  'HQ 13-tap 预过滤保持均匀场并按阈值缩放色调',
);
assert(
  prefilterSource[0] === 2 && prefilterSource[2] === 0.5,
  '预过滤不会修改输入缓冲',
);

console.log('\nSoftware Bloom Gaussian 降采样');
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

// 2×2 对称脉冲使能量中心落在偶数纹理的像素边界上，符合 URP 的 16→8 mip。
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
    centerRow[3] > centerRow[2] &&
    centerRow[2] > centerRow[1] &&
    centerRow[1] > centerRow[0] &&
    centerRow[0] > 0,
  '2× floor mip 的 9-tap Gaussian 从双像素中心对称连续衰减',
);
assert(
  approximatelyEqual(centerRow[3], 0.09999269247055054),
  '两阶段 Gaussian 使用 URP 的固定采样权重',
);
assert(
  approximatelyEqual(downsampleEnergy, 2.177618645131588, 0.00001),
  '16→8 floor 降采样得到确定的离散 HDR 能量',
);
assert(
  leakedChannelEnergy === 0 &&
    impulseCenters.every((center) => impulse[center] === 2.25),
  'Gaussian 不串色且不会修改输入缓冲',
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
  'Gaussian 完整覆盖复用缓冲时不受上一帧脏值影响',
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
  'Gaussian 局部 bounds 会先清空复用缓冲的未覆盖像素',
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
  0.365,
  true,
);

assert(
  arraysApproximatelyEqual(
    uniformMixed.slice(0, 3),
    [3.46, 1.73, 0.865],
  ),
  '反向金字塔按映射后的 scatter 混合高低 mip',
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
  0.365,
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
  0.5,
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
  0.5,
  false,
);

assert(
  arraysApproximatelyEqual(
    [bicubicMixed[0], bicubicMixed[3], bicubicMixed[6], bicubicMixed[9]],
    [
      1.7286376953125,
      1.2686361074447632,
      0.5907389521598816,
      0.1307373046875,
    ],
  ),
  '高质量上采样使用 B-spline bicubic 平滑低 mip',
);
assert(
  arraysApproximatelyEqual(
    [bilinearMixed[0], bilinearMixed[3], bilinearMixed[6], bilinearMixed[9]],
    [2, 1.5, 0.5, 0],
  ),
  '关闭高质量过滤时回退为双线性上采样',
);

console.log('\nSoftware Bloom 加色编码');
const hdrBloom = new Float32Array([
  4, 2, 1,
  0, 0, 0,
  0.25, 1, 3,
  0.25, 0.0625, 0,
]);
const rgba = new Uint8ClampedArray(16);

encodeAdditiveBloom(hdrBloom, rgba, 0.45);

assert(
  arraysApproximatelyEqual(
    rgba,
    [
      255, 243, 179, 255,
      0, 0, 0, 0,
      94, 179, 255, 255,
      255, 126, 0, 94,
    ],
    0,
  ),
  '线性 HDR 经过 Bloom 强度和 sRGB 转换后编码为确定的 RGBA8',
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
  0.45,
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

console.log(`\n✅ ${passed} 项 Software Bloom 数值检查通过\n`);
