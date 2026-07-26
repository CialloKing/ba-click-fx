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

function createFakeWebGL2(options = null)
{
  const safeOptions = options ?? Object.create(null);
  const maximumTextureSize = safeOptions.maximumTextureSize ?? 256;
  const maximumViewportWidth = safeOptions.maximumViewportWidth ??
    maximumTextureSize;
  const maximumViewportHeight = safeOptions.maximumViewportHeight ??
    maximumTextureSize;
  const resourceTypes = [
    'shader',
    'program',
    'buffer',
    'vertexArray',
    'texture',
    'framebuffer',
  ];
  const resources =
  {
  };
  const calls =
  {
    shaderSources: [],
    vertexAttribPointers: [],
    bufferData: [],
    bindFramebuffers: [],
    bindTextures: [],
    framebufferAttachments: [],
    blendFunctions: [],
    drawArrays: [],
    uniform1f: [],
    uniform1i: [],
  };
  let nextResourceId = 1;
  let boundArrayBuffer = null;
  let boundFramebuffer = null;
  let boundVertexArray = null;
  let activeTextureUnit = 0x84C0;
  let blendEnabled = false;
  let currentProgram = null;
  let currentBlendFunction = null;
  const boundTextures = new Map();
  const framebufferAttachments = new Map();
  const samplerUnits = new Map();

  for (const type of resourceTypes)
  {
    resources[type] =
    {
      created: new Set(),
      deleted: new Set(),
    };
  }

  function createResource(type)
  {
    const resource =
    {
      id: nextResourceId++,
      type,
    };

    resources[type].created.add(resource);
    return resource;
  }

  function deleteResource(type, resource)
  {
    if (!resource)
    {
      return;
    }

    resources[type].deleted.add(resource);
  }

  const gl =
  {
    ACTIVE_TEXTURE: 0x84E0,
    ARRAY_BUFFER: 0x8892,
    BLEND: 0x0BE2,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_ATTACHMENT0: 0x8CE0,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    DYNAMIC_DRAW: 0x88E8,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8B30,
    FRAMEBUFFER: 0x8D40,
    FRAMEBUFFER_COMPLETE: 0x8CD5,
    FUNC_ADD: 0x8006,
    HALF_FLOAT: 0x140B,
    LINEAR: 0x2601,
    LINK_STATUS: 0x8B82,
    MAX_TEXTURE_SIZE: 0x0D33,
    MAX_VIEWPORT_DIMS: 0x0D3A,
    NO_ERROR: 0,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    SRC_ALPHA: 0x0302,
    RGBA: 0x1908,
    RGBA16F: 0x881A,
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    VERTEX_SHADER: 0x8B31,
    calls,
    resources,
    activeTexture(unit)
    {
      activeTextureUnit = unit;
    },
    attachShader(program, shader)
    {
      program.shaders ??= [];
      program.shaders.push(shader);
    },
    bindBuffer(target, buffer)
    {
      if (target === this.ARRAY_BUFFER)
      {
        boundArrayBuffer = buffer;
      }
    },
    bindFramebuffer(target, framebuffer)
    {
      boundFramebuffer = framebuffer;
      calls.bindFramebuffers.push(
        {
          framebuffer,
          target,
        },
      );
    },
    bindTexture(target, texture)
    {
      boundTextures.set(activeTextureUnit, texture);
      calls.bindTextures.push(
        {
          program: currentProgram,
          target,
          texture,
          unit: activeTextureUnit,
        },
      );
    },
    bindVertexArray(vertexArray)
    {
      boundVertexArray = vertexArray;
    },
    blendEquation()
    {
    },
    blendFunc(source, destination)
    {
      currentBlendFunction = [source, destination];
      calls.blendFunctions.push(currentBlendFunction);
    },
    blendFuncSeparate(
      sourceRgb,
      destinationRgb,
      sourceAlpha,
      destinationAlpha,
    )
    {
      currentBlendFunction = [
        sourceRgb,
        destinationRgb,
        sourceAlpha,
        destinationAlpha,
      ];
      calls.blendFunctions.push(currentBlendFunction);
    },
    bufferData(target, data, usage)
    {
      calls.bufferData.push(
        {
          buffer: boundArrayBuffer,
          componentCount: data.length,
          target,
          usage,
        },
      );
    },
    checkFramebufferStatus()
    {
      return this.FRAMEBUFFER_COMPLETE;
    },
    clear()
    {
    },
    clearColor()
    {
    },
    compileShader()
    {
    },
    createBuffer()
    {
      return createResource('buffer');
    },
    createFramebuffer()
    {
      return createResource('framebuffer');
    },
    createProgram()
    {
      return createResource('program');
    },
    createShader(type)
    {
      const shader = createResource('shader');

      shader.shaderType = type;
      return shader;
    },
    createTexture()
    {
      return createResource('texture');
    },
    createVertexArray()
    {
      return createResource('vertexArray');
    },
    deleteBuffer(resource)
    {
      deleteResource('buffer', resource);
    },
    deleteFramebuffer(resource)
    {
      framebufferAttachments.delete(resource);
      deleteResource('framebuffer', resource);
    },
    deleteProgram(resource)
    {
      deleteResource('program', resource);
    },
    deleteShader(resource)
    {
      deleteResource('shader', resource);
    },
    deleteTexture(resource)
    {
      deleteResource('texture', resource);
    },
    deleteVertexArray(resource)
    {
      deleteResource('vertexArray', resource);
    },
    disable(capability)
    {
      if (capability === this.BLEND)
      {
        blendEnabled = false;
      }
    },
    drawArrays(mode, first, count)
    {
      calls.drawArrays.push(
        {
          blendEnabled,
          blendFunction: currentBlendFunction,
          count,
          framebuffer: boundFramebuffer,
          framebufferAttachment:
            framebufferAttachments.get(boundFramebuffer) ?? null,
          first,
          mode,
          program: currentProgram,
          sampledTextures: [
            ...(samplerUnits.get(currentProgram)?.values() ?? []),
          ].map((unit) => boundTextures.get(this.TEXTURE0 + unit) ?? null),
          vertexArray: boundVertexArray,
        },
      );
    },
    enable(capability)
    {
      if (capability === this.BLEND)
      {
        blendEnabled = true;
      }
    },
    enableVertexAttribArray()
    {
    },
    framebufferTexture2D(
      target,
      attachment,
      textureTarget,
      texture,
      level,
    )
    {
      framebufferAttachments.set(boundFramebuffer, texture);
      calls.framebufferAttachments.push(
        {
          attachment,
          framebuffer: boundFramebuffer,
          level,
          target,
          texture,
          textureTarget,
        },
      );
    },
    getError()
    {
      return this.NO_ERROR;
    },
    getExtension(name)
    {
      return name === 'EXT_color_buffer_float'
        ? Object.create(null)
        : null;
    },
    getParameter(parameter)
    {
      if (parameter === this.MAX_TEXTURE_SIZE)
      {
        return maximumTextureSize;
      }

      if (parameter === this.MAX_VIEWPORT_DIMS)
      {
        return [maximumViewportWidth, maximumViewportHeight];
      }

      return null;
    },
    getProgramInfoLog()
    {
      return '';
    },
    getProgramParameter()
    {
      return true;
    },
    getShaderInfoLog()
    {
      return '';
    },
    getShaderParameter()
    {
      return true;
    },
    getUniformLocation(program, name)
    {
      const location =
      {
        name,
        program,
      };

      return location;
    },
    linkProgram()
    {
    },
    shaderSource(shader, source)
    {
      shader.source = source;
      calls.shaderSources.push(source);
    },
    texImage2D()
    {
    },
    texParameteri()
    {
    },
    uniform1f(location, value)
    {
      calls.uniform1f.push(
        {
          location,
          value,
        },
      );
    },
    uniform1i(location, value)
    {
      if (
        [
          'u_source',
          'u_high',
          'u_low',
          'u_bloom',
          'u_scene',
        ].includes(location.name)
      )
      {
        let programSamplers = samplerUnits.get(location.program);

        if (!programSamplers)
        {
          programSamplers = new Map();
          samplerUnits.set(location.program, programSamplers);
        }

        programSamplers.set(location.name, value);
      }

      calls.uniform1i.push(
        {
          location,
          value,
        },
      );
    },
    uniform2f()
    {
    },
    useProgram(program)
    {
      currentProgram = program;
    },
    vertexAttribPointer(index, size, type, normalized, stride, offset)
    {
      calls.vertexAttribPointers.push(
        {
          index,
          normalized,
          offset,
          size,
          stride,
          type,
          vertexArray: boundVertexArray,
        },
      );
    },
    viewport()
    {
    },
  };

  return gl;
}

function createFakeWebGLCanvas(gl)
{
  const listeners = new Map();
  const contextRequests = [];
  const canvas =
  {
    width: 0,
    height: 0,
    contextRequests,
    addEventListener(type, listener)
    {
      if (!listeners.has(type))
      {
        listeners.set(type, new Set());
      }

      listeners.get(type).add(listener);
    },
    dispatchContextEvent(type, event = null)
    {
      const safeEvent = event ?? Object.create(null);

      for (const listener of listeners.get(type) ?? [])
      {
        listener(safeEvent);
      }
    },
    getContext(type, options)
    {
      contextRequests.push(
        {
          options,
          type,
        },
      );
      return type === 'webgl2' ? gl : null;
    },
    listenerCount(type)
    {
      return listeners.get(type)?.size ?? 0;
    },
    removeEventListener(type, listener)
    {
      listeners.get(type)?.delete(listener);
    },
  };

  return canvas;
}

function resourcesAreSymmetric(gl)
{
  return Object.values(gl.resources).every((resourceState) =>
  {
    if (resourceState.created.size !== resourceState.deleted.size)
    {
      return false;
    }

    return [...resourceState.created].every((resource) =>
      resourceState.deleted.has(resource));
  });
}

console.log('\nSoftware Bloom 阈值与色彩空间');
const belowKnee = calculateBloomContribution(0.4, 1, 0.5);
const insideKnee = calculateBloomContribution(0.75, 1, 0.5);
const atThreshold = calculateBloomContribution(1, 1, 0.5);
const aboveThreshold = calculateBloomContribution(2, 1, 0.5);

assert(belowKnee === 0, '低于 soft-knee 区间的亮度被完全剔除');
assert(
  approximatelyEqual(insideKnee, 0.031251875012499736),
  'soft-knee 在阈值下方按 MXFinalBloom 公式平滑引入 Bloom',
);
assert(
  approximatelyEqual(atThreshold, 0.1250025),
  '阈值位置仍保留连续的 soft-knee 贡献',
);
assert(
  approximatelyEqual(aboveThreshold, 1),
  '超过阈值后采用线性高亮贡献',
);
assert(
  calculateBloomContribution(0.75, 1, -1) ===
      calculateBloomContribution(0.75, 1, 0) &&
    calculateBloomContribution(0.75, 1, 2) ===
      calculateBloomContribution(0.75, 1, 1),
  'Software Bloom 与 Unity Range 一致地钳制 Soft Knee 到 0..1',
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
assert(
  approximatelyEqual(linearToSrgb(0.25 + 0.25), 0.7353569830524495) &&
    Math.min(1, linearToSrgb(0.25) * 2) === 1,
  '重叠图元先在线性 HDR 中混合，避免逐图元编码导致中间调过曝',
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

const excessiveClampSource = new Float32Array(4 * 4 * 3).fill(70000);
const excessiveClampOutput = new Float32Array(2 * 2 * 3);
const nonFiniteClampOutput = new Float32Array(2 * 2 * 3);

prefilterBloom(
  excessiveClampSource,
  4,
  4,
  excessiveClampOutput,
  2,
  2,
  0,
  0,
  70000,
);
prefilterBloom(
  excessiveClampSource,
  4,
  4,
  nonFiniteClampOutput,
  2,
  2,
  0,
  0,
  Number.POSITIVE_INFINITY,
);
assert(
  excessiveClampOutput.every((value) => value === 65504) &&
    nonFiniteClampOutput.every((value) => value === 65472),
  'Software Bloom 将过大 Clamp 限制到 HALF_FLOAT，并为非有限值恢复默认',
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
  '反向金字塔将细层四点均值与粗层直采值相加',
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
      4,
      3,
      1,
      0,
    ],
  ),
  '上采样对粗层执行一次双线性直采',
);
assert(
  arraysApproximatelyEqual(
    [bilinearMixed[0], bilinearMixed[3], bilinearMixed[6], bilinearMixed[9]],
    [
      4,
      3,
      1,
      0,
    ],
  ),
  'MXFinalBloom 上采样不再分叉为 URP bicubic 模式',
);

const cornerHigh = new Float32Array(4 * 4 * 3);
const zeroLow = new Float32Array(2 * 2 * 3);
const highFiltered = new Float32Array(cornerHigh.length);

cornerHigh[0] = 4;
upsampleAndMixBloom(
  cornerHigh,
  4,
  4,
  zeroLow,
  2,
  2,
  highFiltered,
  1.42925835,
  true,
);
assert(
  arraysApproximatelyEqual(
    [
      highFiltered[0],
      highFiltered[3],
      highFiltered[12],
      highFiltered[15],
    ],
    [
      1.652178168296814,
      0.9185634851455688,
      0.9185634851455688,
      0.5106948614120483,
    ],
  ),
  '上采样按 SampleScale 对细层执行四点采样',
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
      255, 255, 255, 255,
      0, 0, 0, 0,
      174, 255, 255, 255,
      255, 134, 0, 174,
    ],
    0,
  ),
  '线性 HDR 直接乘游戏强度并经 sRGB 编码后得到确定的 RGBA8',
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
geometryRenderer.addTrailTriangle(
  { x: 1, y: 2 },
  { x: 3, y: 4 },
  { x: 5, y: 6 },
  [
    [2, 1, 0.5],
    [1, 0.5, 0.25],
    [0.5, 0.25, 0.125],
  ],
  0.5,
);
assert(
  geometryRenderer.vertexCount === 3 &&
    arraysApproximatelyEqual(
      geometryRenderer.vertexData.slice(0, 15),
      [
        1, 2, 1, 0.5, 0.25,
        3, 4, 0.5, 0.25, 0.125,
        5, 6, 0.25, 0.125, 0.0625,
      ],
    ),
  'WebGL2 任意拖尾三角保留逐顶点线性能量并统一应用不透明度',
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

geometryRenderer.beginFrame();
const leadingTriangleCount = 32;

for (let index = 0; index < leadingTriangleCount; index++)
{
  geometryRenderer.addTriangle(
    index,
    index,
    2,
    0,
    [1, 1, 1],
  );
}

const leadingVertexCount = geometryRenderer.vertexCount;
const diskX = 1000;
const diskY = 900;
const diskRadius = 100;
const diskSegments = 64;
let diskVerticesPerSegment = 0;

for (
  let stopIndex = 0;
  stopIndex < UNITY_FX_TOUCH.disk.textureRadialEnergyKeys.length - 1;
  stopIndex++
)
{
  const innerRadius = diskRadius *
    UNITY_FX_TOUCH.disk.textureRadialEnergyKeys[stopIndex][0];

  diskVerticesPerSegment += innerRadius <= 0.00001 ? 3 : 6;
}

geometryRenderer.addDisk(
  diskX,
  diskY,
  diskRadius,
  [1, 1, 1],
  1,
  diskSegments,
);

const diskEndVertexCount = geometryRenderer.vertexCount;

// 旧实现会在光盘末段越界；后续扩容会把那些丢失的写入暴露为零值。
geometryRenderer.addTriangle(-10, -10, 2, 0, [1, 1, 1]);

const lastDiskVertexOffset = (diskEndVertexCount - 1) * 5;
const lastDiskVertexAngle = Math.PI * 2 * (diskSegments - 1) /
  diskSegments;

assert(
  leadingVertexCount === leadingTriangleCount * 3 &&
    diskEndVertexCount === leadingVertexCount +
      diskSegments * diskVerticesPerSegment &&
    geometryRenderer.vertexData.length >= geometryRenderer.vertexCount * 5 &&
    approximatelyEqual(
      geometryRenderer.vertexData[lastDiskVertexOffset],
      diskX + Math.cos(lastDiskVertexAngle) * diskRadius,
      0.0001,
    ) &&
    approximatelyEqual(
      geometryRenderer.vertexData[lastDiskVertexOffset + 1],
      diskY + Math.sin(lastDiskVertexAngle) * diskRadius,
      0.0001,
    ),
  'WebGL2 光盘按全部径向 stop 预留容量，已有几何不会使尾部顶点丢失',
);

geometryRenderer.beginFrame();
let ringAlphaSampleCount = 0;

geometryRenderer.addDissolveRing(
  0,
  0,
  10,
  2,
  0,
  8,
  96,
  [2, 1, 0.5],
  0.5,
  0.4,
  (angularProgress, radialProgress) =>
  {
    ringAlphaSampleCount++;
    return angularProgress * 0.5 + radialProgress * 0.5;
  },
);

assert(
  geometryRenderer.ringVertexCount === 8 * 96 * 6 &&
    ringAlphaSampleCount === 9 * 97 &&
    arraysApproximatelyEqual(
      geometryRenderer.ringVertexData.slice(0, 7),
      [9, 0, 0, 1, 0.5, 0.25, 0.4],
      0.00001,
    ) &&
    approximatelyEqual(
      geometryRenderer.ringVertexData[7 + 2],
      1 / 192,
    ) &&
    approximatelyEqual(
      geometryRenderer.ringVertexData[14 + 2],
      1 / 192 + 1 / 16,
    ),
  'Dissolve Ring 按 8x96 边界网格保留 raw Alpha、材质能量与硬裁剪阈值',
);

geometryRenderer.destroy();

console.log('\nWebGL2 Bloom-only 兼容');
const bloomOnlyGl = createFakeWebGL2();
const bloomOnlyCanvas = createFakeWebGLCanvas(bloomOnlyGl);
const bloomOnlyRenderer = new WebGL2BloomRenderer(bloomOnlyCanvas);

assert(
  bloomOnlyRenderer.resize(64, 32, 1, 0.5, 2),
  '普通 WebGL2 Bloom 仍可分配独立发射与金字塔目标',
);
bloomOnlyRenderer.beginFrame();
bloomOnlyRenderer.addAlphaBlendDisk(
  32,
  16,
  8,
  [1, 0.5, 0.25],
  1,
  0.4,
  24,
);
bloomOnlyRenderer.addTriangle(16, 16, 4, 0, [2, 1, 0.5]);
bloomOnlyRenderer.addDissolveRing(
  32,
  16,
  10,
  2,
  0,
  2,
  32,
  [1, 0.5, 0.25],
  1,
  0.5,
  () => 0.75,
);
const bloomOnlyDrawStart = bloomOnlyGl.calls.drawArrays.length;
assert(
  bloomOnlyRenderer.render(
    {
      threshold: 1,
      softKnee: 0.5,
      clamp: 65472,
      intensity: 1,
      diffusion: 2,
    },
  ) &&
    bloomOnlyGl.calls.drawArrays.some((call) =>
      call.program === bloomOnlyRenderer.programs.emission &&
        call.blendEnabled) &&
    bloomOnlyGl.calls.uniform1i.some(({ location, value }) =>
      location.name === 'u_hasScene' && value === 0) &&
    bloomOnlyGl.calls.drawArrays.every((call) =>
      call.framebufferAttachment === null ||
        !call.sampledTextures.includes(call.framebufferAttachment)),
  '普通 WebGL2 Bloom 保留 emission pass，并显式关闭 Scene 合成',
);
const bloomOnlyDrawCalls = bloomOnlyGl.calls.drawArrays.slice(
  bloomOnlyDrawStart,
);
const bloomOnlyGeometryCalls = bloomOnlyDrawCalls.slice(0, 3);

assert(
  bloomOnlyGeometryCalls.length === 3 &&
    bloomOnlyGeometryCalls[0].program ===
      bloomOnlyRenderer.programs.sceneDisk &&
    arraysApproximatelyEqual(
      bloomOnlyGeometryCalls[0].blendFunction,
      [bloomOnlyGl.ONE, bloomOnlyGl.ONE_MINUS_SRC_ALPHA],
      0,
    ) &&
    bloomOnlyGeometryCalls[1].program ===
      bloomOnlyRenderer.programs.emission &&
    arraysApproximatelyEqual(
      bloomOnlyGeometryCalls[1].blendFunction,
      [bloomOnlyGl.ONE, bloomOnlyGl.ONE],
      0,
    ) &&
    bloomOnlyGeometryCalls[2].program ===
      bloomOnlyRenderer.programs.dissolveRing &&
    arraysApproximatelyEqual(
      bloomOnlyGeometryCalls[2].blendFunction,
      [
        bloomOnlyGl.SRC_ALPHA,
        bloomOnlyGl.ONE,
        bloomOnlyGl.ONE,
        bloomOnlyGl.ONE,
      ],
      0,
    ) &&
    bloomOnlyGeometryCalls.every((call) =>
      call.framebuffer === bloomOnlyRenderer.sourceTarget.framebuffer),
  '普通 Bloom 按 AlphaBlendAdd 光盘、普通加色、Dissolve Ring 顺序写入 HDR 发射源',
);
bloomOnlyRenderer.destroy();
assert(
  resourcesAreSymmetric(bloomOnlyGl),
  '普通 WebGL2 Bloom 新旧资源生命周期保持对称',
);

console.log('\nWebGL2 Scene 批次与生命周期');
const sceneGl = createFakeWebGL2(
  {
    maximumTextureSize: 256,
  },
);
const sceneCanvas = createFakeWebGLCanvas(sceneGl);
const sceneRenderer = new WebGL2BloomRenderer(
  sceneCanvas,
  {
    sceneEnabled: true,
  },
);
const sceneFragmentSource = sceneRenderer.programs.scene.shaders.find(
  (shader) => shader.shaderType === sceneGl.FRAGMENT_SHADER,
)?.source ?? '';
const sceneDiskFragmentSource = sceneRenderer.programs.sceneDisk.shaders.find(
  (shader) => shader.shaderType === sceneGl.FRAGMENT_SHADER,
)?.source ?? '';
const finalFragmentSource = sceneRenderer.programs.final.shaders.find(
  (shader) => shader.shaderType === sceneGl.FRAGMENT_SHADER,
)?.source ?? '';
const prefilterFragmentSource = sceneRenderer.programs.prefilter.shaders.find(
  (shader) => shader.shaderType === sceneGl.FRAGMENT_SHADER,
)?.source ?? '';
const dissolveRingFragmentSource =
  sceneRenderer.programs.dissolveRing.shaders.find(
    (shader) => shader.shaderType === sceneGl.FRAGMENT_SHADER,
  )?.source ?? '';

assert(
  sceneRenderer.available &&
    sceneCanvas.contextRequests.length === 1 &&
    sceneCanvas.contextRequests[0].options.antialias === false &&
    sceneGl.calls.shaderSources.some((source) =>
      source.includes('layout(location = 0) in vec2 a_position;')) &&
    sceneGl.calls.shaderSources.some((source) =>
      source.includes('layout(location = 2) in float a_alpha;')),
  'WebGL2 Scene 使用显式顶点位置，并避免无效的默认帧缓冲 MSAA',
);
assert(
  !sceneFragmentSource.includes('linearToSrgb') &&
    !sceneDiskFragmentSource.includes('linearToSrgb') &&
    sceneFragmentSource.includes(
      'outColor = vec4(max(v_color, vec3(0.0)), 1.0);',
    ) &&
    finalFragmentSource.includes('linearToSrgb') &&
    finalFragmentSource.includes(
      'vec3 linear = scene + bloom * 0.25 * max(0.0, u_intensity);',
    ),
  '完整 WebGL2 在 RGBA16F Scene 中保持线性，仅由 Final Pass 编码一次 sRGB',
);
assert(
  prefilterFragmentSource.includes(
    'float knee = threshold * u_softKnee + 0.00001;',
  ) &&
    prefilterFragmentSource.includes(
      'float clampMax = min(max(u_clampMax, 0.0), 65504.0);',
    ),
  'WebGL2 Prefilter 使用 Unity soft-knee 偏移并限制为 HALF_FLOAT 最大值',
);
assert(
  dissolveRingFragmentSource.includes(
    'if (v_textureAlpha < v_dissolveThreshold)',
  ) &&
    dissolveRingFragmentSource.includes('discard;') &&
    dissolveRingFragmentSource.includes(
      'clamp(v_textureAlpha, 0.0, 1.0)',
    ),
  'Dissolve Ring Fragment 逐片元执行 Unity clip，并保留通过片元的 raw Alpha',
);
assert(
  sceneGl.calls.shaderSources.some((source) =>
    source.includes('vec3 high = sampleBox(u_high, v_uv, offset);') &&
      source.includes('vec3 low = texture(u_low, v_uv).rgb;')),
  'WebGL2 上采样与 BaGameBloom 一致：细层四点采样、粗层直采',
);
assert(
  sceneRenderer.resize(96, 64, 1, 0.5, 7) &&
    sceneRenderer.sourceTarget.width === 96 &&
    sceneRenderer.sourceTarget.height === 64 &&
    sceneRenderer.levels[0].width === 48 &&
    sceneRenderer.levels[0].height === 32,
  'WebGL2 Scene 使用全尺寸 RGBA16F 目标，Bloom 金字塔保持独立分辨率',
);

sceneRenderer.beginFrame();
sceneRenderer.addSceneDisk(
  32,
  32,
  20,
  [2, 0.5, 0.25],
  0.5,
  0.4,
  24,
);
const firstSceneDiskVertexCount = sceneRenderer.sceneDiskVertexCount;
const firstSceneDiskVertex = sceneRenderer.sceneDiskVertexData.slice(0, 6);

sceneRenderer.addSceneDisk(
  64,
  32,
  12,
  [0.8, 0.4, 0.2],
  0.5,
  0,
  24,
);
const zeroAlphaDiskOffset = firstSceneDiskVertexCount * 6;
const zeroAlphaDiskVertex = sceneRenderer.sceneDiskVertexData.slice(
  zeroAlphaDiskOffset,
  zeroAlphaDiskOffset + 6,
);

sceneRenderer.addTriangle(
  48,
  32,
  8,
  0,
  [1, 0.5, 0.25],
  0.75,
);
sceneRenderer.addSolidDisk(
  80,
  24,
  6,
  [0.25, 0.5, 1],
  0.5,
  8,
);
const sceneAdditiveVertexCount = sceneRenderer.vertexCount;
sceneRenderer.addDissolveRing(
  48,
  32,
  18,
  3,
  0,
  8,
  96,
  [1.5, 0.75, 0.25],
  0.8,
  0.45,
  (angularProgress, radialProgress) =>
    angularProgress * radialProgress,
);
const sceneRingVertexCount = sceneRenderer.ringVertexCount;

assert(
  firstSceneDiskVertexCount > 0 &&
    sceneRenderer.sceneDiskVertexCount === firstSceneDiskVertexCount * 2 &&
    sceneAdditiveVertexCount === 3 + 16 * 3 &&
    sceneRingVertexCount === 8 * 96 * 6,
  'WebGL2 Scene 将光盘、普通加色与 Dissolve Ring 写入独立批次',
);
assert(
  arraysApproximatelyEqual(
    firstSceneDiskVertex.slice(2),
    [1, 0.25, 0.125, 0.4],
  ),
  'Scene 光盘源 RGB 只乘不透明度，粒子 Alpha 保存在独立顶点通道',
);
assert(
  arraysApproximatelyEqual(
    zeroAlphaDiskVertex.slice(2),
    [0.4, 0.2, 0.1, 0],
  ),
  'Scene 光盘 Alpha 为零时仍提交源 RGB，仅停止衰减目标颜色',
);

assert(
  sceneRenderer.renderScene(),
  'WebGL2 Scene 可在同一帧完成光盘与普通几何绘制',
);

const sceneDrawCalls = sceneGl.calls.drawArrays.slice(-3);
const sceneBufferUploads = sceneGl.calls.bufferData.slice(-3);

assert(
  sceneDrawCalls.length === 3 &&
    sceneDrawCalls[0].program === sceneRenderer.programs.sceneDisk &&
    sceneDrawCalls[0].blendEnabled &&
    sceneDrawCalls[0].framebuffer ===
      sceneRenderer.sourceTarget.framebuffer &&
    sceneDrawCalls[0].framebufferAttachment ===
      sceneRenderer.sourceTarget.texture &&
    arraysApproximatelyEqual(
      sceneDrawCalls[0].blendFunction,
      [sceneGl.ONE, sceneGl.ONE_MINUS_SRC_ALPHA],
      0,
    ) &&
    sceneDrawCalls[0].count === sceneRenderer.sceneDiskVertexCount &&
    sceneDrawCalls[1].program === sceneRenderer.programs.scene &&
    sceneDrawCalls[1].blendEnabled &&
    sceneDrawCalls[1].framebuffer ===
      sceneRenderer.sourceTarget.framebuffer &&
    arraysApproximatelyEqual(
      sceneDrawCalls[1].blendFunction,
      [sceneGl.ONE, sceneGl.ONE],
      0,
    ) &&
    sceneDrawCalls[1].count === sceneAdditiveVertexCount &&
    sceneDrawCalls[2].program === sceneRenderer.programs.dissolveRing &&
    sceneDrawCalls[2].blendEnabled &&
    arraysApproximatelyEqual(
      sceneDrawCalls[2].blendFunction,
      [
        sceneGl.SRC_ALPHA,
        sceneGl.ONE,
        sceneGl.ONE,
        sceneGl.ONE,
      ],
      0,
    ) &&
    sceneDrawCalls[2].count === sceneRingVertexCount &&
    sceneDrawCalls[2].framebuffer ===
      sceneRenderer.sourceTarget.framebuffer,
  'WebGL2 Scene 依次绘制 AlphaBlendAdd 光盘、普通加色与末尾 Dissolve Ring',
);
assert(
  sceneBufferUploads[0].buffer === sceneRenderer.sceneDiskBuffer &&
    sceneBufferUploads[0].componentCount ===
      sceneRenderer.sceneDiskVertexCount * 6 &&
    sceneBufferUploads[1].buffer === sceneRenderer.emissionBuffer &&
    sceneBufferUploads[1].componentCount === sceneAdditiveVertexCount * 5 &&
    sceneBufferUploads[2].buffer === sceneRenderer.ringBuffer &&
    sceneBufferUploads[2].componentCount === sceneRingVertexCount * 7 &&
    sceneRenderer.stats.sceneDiskVertexCount ===
      sceneRenderer.sceneDiskVertexCount &&
    sceneRenderer.stats.sceneVertexCount === sceneAdditiveVertexCount &&
    sceneRenderer.stats.sceneRingVertexCount === sceneRingVertexCount,
  'WebGL2 Scene 分别上传光盘、普通加色和七分量 Ring 顶点并记录统计',
);

const diskAttributePointers = sceneGl.calls.vertexAttribPointers.filter(
  (pointer) => pointer.vertexArray === sceneRenderer.sceneDiskVao,
);
const additiveAttributePointers = sceneGl.calls.vertexAttribPointers.filter(
  (pointer) => pointer.vertexArray === sceneRenderer.emissionVao,
);
const ringAttributePointers = sceneGl.calls.vertexAttribPointers.filter(
  (pointer) => pointer.vertexArray === sceneRenderer.ringVao,
);

assert(
  diskAttributePointers.length === 3 &&
    diskAttributePointers.map((pointer) => pointer.index).join(',') ===
      '0,1,2' &&
    diskAttributePointers.every((pointer) => pointer.stride === 6 * 4) &&
    additiveAttributePointers.length === 2 &&
    additiveAttributePointers.map((pointer) => pointer.index).join(',') ===
      '0,1' &&
    additiveAttributePointers.every((pointer) => pointer.stride === 5 * 4) &&
    ringAttributePointers.length === 4 &&
    ringAttributePointers.map((pointer) => pointer.index).join(',') ===
      '0,1,2,3' &&
    ringAttributePointers.every((pointer) => pointer.stride === 7 * 4),
  'WebGL2 光盘、共享加色与 Dissolve Ring VAO 使用稳定的独立顶点布局',
);

const renderedSceneStats =
{
  sceneVertexCount: sceneRenderer.stats.sceneVertexCount,
  sceneDiskVertexCount: sceneRenderer.stats.sceneDiskVertexCount,
  sceneRingVertexCount: sceneRenderer.stats.sceneRingVertexCount,
};

sceneRenderer.beginFrame(
  {
    preserveSceneStats: true,
  },
);
assert(
  sceneRenderer.vertexCount === 0 &&
    sceneRenderer.sceneDiskVertexCount === 0 &&
    sceneRenderer.ringVertexCount === 0 &&
    sceneRenderer.stats.sceneVertexCount ===
      renderedSceneStats.sceneVertexCount &&
    sceneRenderer.stats.sceneDiskVertexCount ===
      renderedSceneStats.sceneDiskVertexCount &&
    sceneRenderer.stats.sceneRingVertexCount ===
      renderedSceneStats.sceneRingVertexCount,
  '完整 WebGL2 的 Bloom pass 清空几何时保留同一帧 Scene 统计',
);

sceneRenderer.addTriangle(24, 24, 4, 0, [2, 1, 0.5]);
const fullRenderDrawStart = sceneGl.calls.drawArrays.length;
const fullRenderTextureStart = sceneGl.calls.bindTextures.length;
assert(
  sceneRenderer.render(
    {
      threshold: 1,
      softKnee: 2,
      clamp: 70000,
      intensity: 1.7,
      diffusion: 7,
    },
    {
      preserveCanvas: true,
    },
  ) &&
    sceneGl.calls.uniform1f.some(({ location, value }) =>
      location.name === 'u_intensity' && value === 1.7) &&
    sceneGl.calls.uniform1f.some(({ location, value }) =>
      location.name === 'u_softKnee' && value === 1) &&
    sceneGl.calls.uniform1f.some(({ location, value }) =>
      location.name === 'u_clampMax' && value === 65504),
  'WebGL2 使用游戏强度，并钳制 Soft Knee 与 HALF_FLOAT 上界',
);
const fullRenderDrawCalls = sceneGl.calls.drawArrays.slice(
  fullRenderDrawStart,
);
const fullRenderTextureBindings = sceneGl.calls.bindTextures.slice(
  fullRenderTextureStart,
);
const prefilterSceneBinding = fullRenderTextureBindings.find((binding) =>
  binding.program === sceneRenderer.programs.prefilter &&
    binding.unit === sceneGl.TEXTURE0);
const finalSceneBinding = fullRenderTextureBindings.find((binding) =>
  binding.program === sceneRenderer.programs.final &&
    binding.unit === sceneGl.TEXTURE0 + 1);

assert(
  fullRenderDrawCalls.length > 1 &&
    fullRenderDrawCalls.every((call) =>
      call.program !== sceneRenderer.programs.emission) &&
    fullRenderDrawCalls.at(-1).program === sceneRenderer.programs.final &&
    fullRenderDrawCalls.at(-1).framebuffer === null &&
    !fullRenderDrawCalls.at(-1).blendEnabled &&
    fullRenderDrawCalls.every((call) =>
      call.framebufferAttachment === null ||
        !call.sampledTextures.includes(call.framebufferAttachment)),
  '完整 WebGL2 直接从 Scene Target 构建 Bloom，并在默认帧缓冲执行最终合成',
);
assert(
  prefilterSceneBinding?.texture === sceneRenderer.sourceTarget.texture &&
    finalSceneBinding?.texture === sceneRenderer.sourceTarget.texture &&
    sceneGl.calls.uniform1i.some(({ location, value }) =>
      location.name === 'u_hasScene' &&
        location.program === sceneRenderer.programs.final &&
        value === 1),
  '完整 WebGL2 的 Prefilter 与 Final Scene 读取同一 HDR Target',
);

sceneRenderer.beginFrame();
sceneRenderer.addTriangle(40, 20, 5, 0, [1, 0.5, 0.25]);
assert(
  sceneRenderer.renderScene(),
  '完整 WebGL2 可建立不依赖独立 emission 批次的 HDR Scene',
);
sceneRenderer.beginFrame(
  {
    preserveSceneStats: true,
  },
);
const sceneOnlyDrawStart = sceneGl.calls.drawArrays.length;
const sceneOnlyUniformStart = sceneGl.calls.uniform1f.length;

assert(
  sceneRenderer.vertexCount === 0 &&
    sceneRenderer.render(
      {
        threshold: 1,
        softKnee: -1,
        clamp: Number.POSITIVE_INFINITY,
        intensity: 1.7,
        diffusion: 7,
      },
      {
        preserveCanvas: true,
      },
    ) &&
    sceneGl.calls.drawArrays.slice(sceneOnlyDrawStart).at(-1).program ===
      sceneRenderer.programs.final &&
    sceneGl.calls.uniform1f.slice(sceneOnlyUniformStart).some(
      ({ location, value }) =>
        location.name === 'u_softKnee' && value === 0,
    ) &&
    sceneGl.calls.uniform1f.slice(sceneOnlyUniformStart).some(
      ({ location, value }) =>
        location.name === 'u_clampMax' && value === 65472,
    ),
  '完整 WebGL2 无 emission 仍合成，并恢复非有限 Clamp 与 Soft Knee 下界',
);

sceneRenderer.beginFrame();
assert(
  !sceneRenderer.sceneFrameReady &&
    sceneRenderer.stats.sceneVertexCount === 0 &&
    sceneRenderer.stats.sceneDiskVertexCount === 0 &&
    sceneRenderer.stats.sceneRingVertexCount === 0,
  '后续普通 Bloom 帧不会残留上一帧完整 WebGL2 Scene 统计',
);

sceneRenderer.destroy();
assert(
  sceneCanvas.listenerCount('webglcontextlost') === 0 &&
    sceneCanvas.listenerCount('webglcontextrestored') === 0 &&
    resourcesAreSymmetric(sceneGl),
  'WebGL2 Scene 销毁时对称释放 Program、Buffer、VAO、Texture 与监听器',
);

console.log('\nWebGL2 尺寸失败恢复');
const resizeGl = createFakeWebGL2(
  {
    maximumTextureSize: 64,
  },
);
const resizeCanvas = createFakeWebGLCanvas(resizeGl);
const resizeRenderer = new WebGL2BloomRenderer(
  resizeCanvas,
  {
    sceneEnabled: true,
  },
);
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
  const failedResizeResourceCount =
    resizeGl.resources.texture.created.size +
    resizeGl.resources.framebuffer.created.size;

  assert(
    !resizeRenderer.resize(128, 32, 1, 0.5, 0) &&
      resizeWarnings.length === 1 &&
      resizeGl.resources.texture.created.size +
        resizeGl.resources.framebuffer.created.size ===
          failedResizeResourceCount,
    'WebGL2 缓存相同失败尺寸，后续探测不再警告或创建 GPU 资源',
  );
  assert(
    resizeRenderer.resize(64, 32, 1, 0.5, 0),
    'WebGL2 从超限尺寸回到相同正常尺寸时重新分配目标',
  );
  recoveredResizeTarget = resizeRenderer.sourceTarget;
}
finally
{
  console.warn = previousConsoleWarn;
}

assert(
  resizeWarnings.length === 1 &&
    recoveredResizeTarget &&
    recoveredResizeTarget !== firstResizeTarget &&
    resizeCanvas.width === 64 &&
    resizeCanvas.height === 32,
  'WebGL2 尺寸恢复不会把已删除目标误判为 unchanged',
);
resizeRenderer.destroy();
assert(
  resourcesAreSymmetric(resizeGl),
  'WebGL2 尺寸失败与恢复不会泄漏被替换的 GPU 资源',
);

console.log('\nWebGL2 Context Lost 与恢复');
const contextGl = createFakeWebGL2(
  {
    maximumTextureSize: 128,
  },
);
const contextCanvas = createFakeWebGLCanvas(contextGl);
const contextRenderer = new WebGL2BloomRenderer(
  contextCanvas,
  {
    sceneEnabled: true,
  },
);

assert(
  contextRenderer.resize(64, 64, 1, 0.5, 2),
  'WebGL2 Context 生命周期测试先建立完整资源',
);

const firstContextProgram = contextRenderer.programs.scene;
const firstContextDiskBuffer = contextRenderer.sceneDiskBuffer;
const firstContextTexture = contextRenderer.sourceTarget.texture;
const programsCreatedBeforeRestore =
  contextGl.resources.program.created.size;
const programsDeletedBeforeRestore =
  contextGl.resources.program.deleted.size;
let contextLossPrevented = false;
const previousContextWarn = console.warn;

console.warn = () =>
{
};

try
{
  assert(
    !contextRenderer.resize(256, 64, 1, 0.5, 2) &&
      contextRenderer.failedResizeSignature !== null,
    'WebGL2 Context 恢复测试先记录一个失败尺寸签名',
  );
}
finally
{
  console.warn = previousContextWarn;
}

contextCanvas.dispatchContextEvent(
  'webglcontextlost',
  {
    preventDefault()
    {
      contextLossPrevented = true;
    },
  },
);
assert(
  contextLossPrevented &&
    contextRenderer.contextLost &&
    !contextRenderer.available &&
    !contextRenderer.sceneFrameReady,
  'WebGL2 Context Lost 阻止默认销毁并立即标记后端不可用',
);

contextCanvas.dispatchContextEvent('webglcontextrestored');
assert(
  contextRenderer.available &&
    !contextRenderer.contextLost &&
    contextRenderer.programs.scene !== firstContextProgram &&
    contextRenderer.sceneDiskBuffer !== firstContextDiskBuffer &&
    contextRenderer.sourceTarget.texture !== firstContextTexture &&
    contextRenderer.failedResizeSignature === null &&
    contextGl.resources.program.created.size ===
      programsCreatedBeforeRestore * 2 &&
    contextGl.resources.program.deleted.size ===
      programsDeletedBeforeRestore,
  'WebGL2 Context 恢复清除失败缓存并完整重建 Scene 与 Bloom 资源',
);

contextRenderer.beginFrame();
contextRenderer.addTriangle(16, 16, 4, 0, [1, 1, 1]);
assert(
  contextRenderer.renderScene(),
  'WebGL2 Context 恢复后的首个 Scene 帧可正常提交几何',
);
const restoredFailureWarnings = [];

console.warn = (...args) =>
{
  restoredFailureWarnings.push(args.join(' '));
};

try
{
  assert(
    !contextRenderer.resize(256, 64, 1, 0.5, 2) &&
      restoredFailureWarnings.length === 1 &&
      contextRenderer.failedResizeSignature !== null,
    'Context 恢复后会重新尝试并记录恢复前的同一失败尺寸',
  );
}
finally
{
  console.warn = previousContextWarn;
}

contextRenderer.destroy();
assert(
  contextCanvas.listenerCount('webglcontextlost') === 0 &&
    contextCanvas.listenerCount('webglcontextrestored') === 0,
  'WebGL2 Context 生命周期结束后移除 Lost 与 Restored 监听器',
);

console.log(`\n✅ ${passed} 项 Software Bloom 数值检查通过\n`);
