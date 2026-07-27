/**
 * Software Bloom 数值管线测试。
 *
 * 这些检查只依赖 TypedArray，确保 HDR 解码、MXFinalBloom 金字塔和 Canvas 编码
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
import { UNITY_FX_TOUCH } from '../src/config.js';
import { WebGL2BloomRenderer } from '../src/webgl2-bloom.js';

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

function createResizeTestRenderer(maximumSize = 64)
{
  let nextTargetId = 1;
  const targetCreations = [];
  const deletedTextures = new Set();
  const deletedFramebuffers = new Set();
  const gl =
  {
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
      throw new Error('模拟 RenderTarget 分配失败');
    }

    const id = nextTargetId++;

    return {
      width,
      height,
      texture: { id },
      framebuffer: { id },
    };
  };

  return {
    renderer,
    targetCreations,
    deletedTextures,
    deletedFramebuffers,
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
  assert(
    !resizeRenderer.resize(48, 32, 1, 0.5, 0) &&
      resizeRenderer.available &&
      resizeRenderer.sourceTarget === null &&
      resizeRenderer.failedResizeSignature !== null,
    'RenderTarget 创建异常只使当前尺寸回退，并释放半成品目标',
  );
  const allocationFailureCreationCount = resizeHarness.targetCreations.length;

  assert(
    !resizeRenderer.resize(48, 32, 1, 0.5, 0) &&
      resizeWarnings.length === 2 &&
      resizeHarness.targetCreations.length === allocationFailureCreationCount,
    '相同的分配失败尺寸不会在后续探测中重复分配',
  );

  resizeRenderer.failureSourceWidth = null;
  resizeRenderer._forgetResourceReferences();
  assert(
    resizeRenderer.failedResizeSignature === null &&
      resizeRenderer.resize(48, 32, 1, 0.5, 0),
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
  geometryRenderer.vertexCount === 3 &&
    approximatelyEqual(geometryRenderer.vertexData[0], 10) &&
    approximatelyEqual(
      geometryRenderer.vertexData[1],
      20 + upwardFrame[0][1] * 20,
    ) &&
    approximatelyEqual(
      geometryRenderer.vertexData[5],
      10 + upwardFrame[1][0] * 20,
    ),
  'WebGL2 碎片顶点使用 Unity 2×1 图集的实测轮廓',
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
  const offset = index * 5;

  trailVertices.push(
    {
      y: geometryRenderer.vertexData[offset + 1],
      energy: geometryRenderer.vertexData[offset + 2],
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
    ),
  'WebGL2 拖尾把原纹理羽化横截面细分进真实 2.7px 三角带',
);

geometryRenderer.destroy();

console.log(`\n✅ ${passed} 项 Software Bloom 数值检查通过\n`);
