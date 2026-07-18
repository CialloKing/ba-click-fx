/**
 * Software Bloom 数值管线测试。
 *
 * 这些检查只依赖 TypedArray，确保阈值、扩散和 Canvas 编码可以脱离 DOM 验证。
 */

import {
  applyBlurPasses,
  calculateBloomContribution,
  encodeAdditiveBloom,
  extractBrightPass,
  separableBoxBlur,
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

console.log('\nSoftware Bloom 阈值');
const belowKnee = calculateBloomContribution(0.4, 1, 0.5);
const insideKnee = calculateBloomContribution(0.75, 1, 0.5);
const atThreshold = calculateBloomContribution(1, 1, 0.5);
const aboveThreshold = calculateBloomContribution(2, 1, 0.5);

assert(belowKnee === 0, '低于 soft-knee 区间的亮度被完全剔除');
assert(
  insideKnee > 0 && insideKnee < atThreshold,
  'soft-knee 在阈值下方平滑引入 Bloom',
);
assert(
  atThreshold < aboveThreshold && approximatelyEqual(aboveThreshold, 1),
  '超过阈值后高亮贡献单调增加',
);

const encodedMask = new Uint8ClampedArray([
  10, 10, 10, 255,
  255, 128, 64, 255,
]);
const brightPass = new Float32Array(6);

extractBrightPass(encodedMask, brightPass, 2, 1, 0.5);
assert(
  brightPass[0] === 0 && brightPass[1] === 0 && brightPass[2] === 0,
  '高亮提取会归零阈值下的像素',
);
assert(
  brightPass[3] > brightPass[4] && brightPass[4] > brightPass[5],
  '高亮提取保留原始 RGB 色调比例',
);

console.log('\nSoftware Bloom 扩散');
const impulse = new Float32Array(5 * 5 * 3);
const scratch = new Float32Array(impulse.length);
const blurred = new Float32Array(impulse.length);
const center = (2 * 5 + 2) * 3;
const neighbor = (2 * 5 + 1) * 3;

impulse[center] = 8;
impulse[center + 1] = 4;
impulse[center + 2] = 2;
separableBoxBlur(impulse, scratch, blurred, 5, 5, 1);

assert(
  blurred[neighbor] > 0 && blurred[neighbor + 1] > 0 && blurred[neighbor + 2] > 0,
  '单点高亮会扩散到周围像素',
);
assert(
  blurred[center] > 0 && blurred[0] === 0,
  '连续窗口保留局部能量且不会产生远距离稀疏副本',
);
assert(
  impulse[0] === 0 && impulse[center] === 8,
  '模糊过程不修改输入缓冲',
);

const chainWidth = 33;
const chainHeight = 33;
const chainSource = new Float32Array(chainWidth * chainHeight * 3);
const chainScratch = new Float32Array(chainSource.length);
const chainAlternate = new Float32Array(chainSource.length);
const chainCenterPixel = Math.floor(chainWidth / 2);
const chainCenter = (chainCenterPixel * chainWidth + chainCenterPixel) * 3;

chainSource[chainCenter] = 9;
const chainOutput = applyBlurPasses(
  chainSource,
  chainScratch,
  chainAlternate,
  chainWidth,
  chainHeight,
  1,
  3,
);
const chainSample = (offset) =>
  chainOutput[(chainCenterPixel * chainWidth + chainCenterPixel + offset) * 3];
let chainEnergy = 0;

for (let index = 0; index < chainOutput.length; index += 3)
{
  chainEnergy += chainOutput[index];
}

assert(
  chainSample(0) > chainSample(2) &&
    chainSample(2) > chainSample(4) &&
    chainSample(4) > chainSample(6) &&
    chainSample(6) > 0,
  '完整三次卷积从中心到支撑边缘连续衰减',
);
assert(
  chainSample(7) === 0,
  '最终卷积不会在支撑范围外生成衍射副本',
);
assert(
  approximatelyEqual(chainEnergy, 9, 0.00001),
  '完整模糊链守恒 HDR 高亮能量',
);

const evenWidth = 9;
const evenHeight = 7;
const evenSource = new Float32Array(evenWidth * evenHeight * 3);
const evenScratch = new Float32Array(evenSource.length);
const evenAlternate = new Float32Array(evenSource.length);
const referenceScratch = new Float32Array(evenSource.length);
const referenceFirstPass = new Float32Array(evenSource.length);
const referenceSecondScratch = new Float32Array(evenSource.length);
const referenceSecondPass = new Float32Array(evenSource.length);

evenSource[(3 * evenWidth + 2) * 3] = 5;
evenSource[(4 * evenWidth + 6) * 3 + 1] = 3;
evenSource[(1 * evenWidth + 4) * 3 + 2] = 7;

// 用两次独立卷积作为参照，专门防止偶数迭代时返回错误的 ping-pong 缓冲。
separableBoxBlur(
  evenSource,
  referenceScratch,
  referenceFirstPass,
  evenWidth,
  evenHeight,
  1,
);
separableBoxBlur(
  referenceFirstPass,
  referenceSecondScratch,
  referenceSecondPass,
  evenWidth,
  evenHeight,
  2,
);
const evenOutput = applyBlurPasses(
  evenSource,
  evenScratch,
  evenAlternate,
  evenWidth,
  evenHeight,
  1,
  2,
);

assert(
  evenOutput.every((value, index) =>
    approximatelyEqual(value, referenceSecondPass[index], 0.000001)),
  '偶数次卷积返回正确的 ping-pong 缓冲结果',
);

console.log('\nSoftware Bloom 编码');
const hdrBloom = new Float32Array([
  4, 2, 1,
  0, 0, 0,
  0.25, 1, 3,
]);
const rgba = new Uint8ClampedArray(12);

encodeAdditiveBloom(hdrBloom, rgba, 0.45);

for (let pixel = 0; pixel < rgba.length / 4; pixel++)
{
  const offset = pixel * 4;
  const red = rgba[offset];
  const green = rgba[offset + 1];
  const blue = rgba[offset + 2];
  const alpha = rgba[offset + 3];
  const hasColor = red > 0 || green > 0 || blue > 0;

  assert(
    red >= 0 && red <= 255 &&
      green >= 0 && green <= 255 &&
      blue >= 0 && blue <= 255 &&
      alpha >= 0 && alpha <= 255,
    `第 ${pixel + 1} 个编码像素保持在 RGBA8 范围内`,
  );
  assert(
    !hasColor || alpha > 0,
    `第 ${pixel + 1} 个非黑像素具有可合成的 Alpha`,
  );
}

assert(
  rgba[0] >= rgba[1] && rgba[1] >= rgba[2],
  '暖色 HDR 输入编码后仍保持通道顺序',
);
assert(
  rgba[8] <= rgba[9] && rgba[9] <= rgba[10],
  '蓝色 HDR 输入编码后仍保持通道顺序',
);

console.log(`\n✅ ${passed} 项 Software Bloom 数值检查通过\n`);
