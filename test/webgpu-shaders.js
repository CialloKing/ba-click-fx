import assert from 'node:assert/strict';
import { resolveHdrPresentationState } from '../src/hdr-presentation-status.js';
import { linearToSrgb } from '../src/software-bloom.js';
import {
  linearToExtendedSrgb,
  WEBGPU_FULLSCREEN_SHADER,
} from '../src/webgpu-shaders.js';
import {
  mapWebGPUHdrPresentation,
  WEBGPU_HDR_PRESENTATION_DEFAULTS,
} from '../src/webgpu-hdr-presentation.js';

function approximatelyEqual(left, right, epsilon = 1e-12)
{
  return Math.abs(left - right) <= epsilon;
}

console.log('WebGPU Extended sRGB 编码');

for (const linear of [0, 0.001, 0.0031308, 0.08, 0.18, 0.5, 1])
{
  assert.ok(
    approximatelyEqual(
      linearToExtendedSrgb(linear),
      linearToSrgb(linear),
    ),
    `SDR 线性值 ${linear} 必须与 WebGL2/Software 的 sRGB 编码一致`,
  );
}

assert.equal(linearToExtendedSrgb(-1), 0, '负能量钳制为黑色');
assert.ok(
  linearToExtendedSrgb(2) > 1 && linearToExtendedSrgb(8) > 1,
  'HDR 超白能量编码后仍超过 1.0',
);
assert.ok(
  linearToExtendedSrgb(8) > linearToExtendedSrgb(2),
  '扩展编码不会折叠不同强度的 HDR 高光',
);

assert.ok(
  WEBGPU_FULLSCREEN_SHADER.includes(
      'let mappedExtendedLinear = mapExtendedHdrPresentation(linear);',
  ) &&
    WEBGPU_FULLSCREEN_SHADER.includes(
      'let extendedSrgb = linearToExtendedSrgb3(extendedDisplayLinear);',
    ) &&
    WEBGPU_FULLSCREEN_SHADER.includes(
      'clamp(params.hdrBrightness, 0.0, 32.0);',
    ) &&
    WEBGPU_FULLSCREEN_SHADER.includes(
      'return vec4f(extendedSrgb, alpha);',
    ) &&
    WEBGPU_FULLSCREEN_SHADER.includes(
      'let backgroundExtendedSrgb = linearToExtendedSrgb3(sampledBackground);',
    ) &&
    WEBGPU_FULLSCREEN_SHADER.includes(
      'let premultiplied = extendedSrgb -',
    ) &&
    !WEBGPU_FULLSCREEN_SHADER.includes(
      'return vec4f(max(linear, vec3f(0.0)), alpha);',
    ),
  'Extended 最终输出和已知背景反解统一使用扩展 sRGB 编码域',
);

console.log('WebGPU HDR 展示映射');

for (const rgb of [
  [0, 0, 0],
  [0.1, 0.5, 1],
  [1, 1, 1],
])
{
  assert.deepEqual(
    mapWebGPUHdrPresentation(rgb),
    rgb,
    'SDR 范围内的线性颜色必须保持不变',
  );
}

let previousGray = 0;

for (const energy of [0, 0.25, 1, 1.5, 2, 4, 8, 64])
{
  const mapped = mapWebGPUHdrPresentation([energy, energy, energy]);

  assert.ok(
    mapped.every((value) => value >= previousGray - 1e-12),
    'HDR 肩部必须保持灰阶能量单调',
  );
  assert.ok(
    mapped.every((value) =>
      value <= WEBGPU_HDR_PRESENTATION_DEFAULTS.peak + 1e-12),
    '映射结果不能超过配置的线性峰值',
  );
  previousGray = mapped[0];
}

const unityBlue = [0.431, 2.303, 5.992];
const mappedUnityBlue = mapWebGPUHdrPresentation(unityBlue);
const sourceChroma = Math.max(...unityBlue) - Math.min(...unityBlue);
const mappedChroma = Math.max(...mappedUnityBlue) -
  Math.min(...mappedUnityBlue);

assert.ok(
  mappedChroma < sourceChroma,
  '高能蓝色必须获得更中性的白色核心',
);
assert.ok(
  mappedUnityBlue[2] > mappedUnityBlue[1] &&
    mappedUnityBlue[1] > mappedUnityBlue[0],
  '白核映射不能抹掉 Unity 蓝色的通道顺序',
);

const coloredOnly = mapWebGPUHdrPresentation(
  unityBlue,
  {
    ...WEBGPU_HDR_PRESENTATION_DEFAULTS,
    whiteCore: 0,
  },
);
const sourceExcess = unityBlue.map((value) => Math.max(0, value - 1));
const mappedExcess = coloredOnly.map((value, index) =>
  value - Math.min(unityBlue[index], 1));

assert.ok(
  approximatelyEqual(
    mappedExcess[1] / mappedExcess[2],
    sourceExcess[1] / sourceExcess[2],
  ),
  '关闭白核后仅压缩峰值，额外 HDR 能量的色相比率保持不变',
);

const brighterMapped = mapWebGPUHdrPresentation(
  unityBlue,
  {
    ...WEBGPU_HDR_PRESENTATION_DEFAULTS,
    brightness: 16,
  },
);
const mappedBackground = mapWebGPUHdrPresentation(
  [0.2, 0.4, 0.8],
  {
    ...WEBGPU_HDR_PRESENTATION_DEFAULTS,
    brightness: 32,
  },
  [0.2, 0.4, 0.8],
);

assert.ok(
  brighterMapped.every((value, index) =>
    approximatelyEqual(value, mappedUnityBlue[index] * 16)),
  '整体亮度按线性倍率放大映射后的特效能量',
);
assert.deepEqual(
  mappedBackground,
  [0.2, 0.4, 0.8],
  '已知背景不随 HDR 特效整体亮度一起提升',
);

console.log('WebGPU Shader tests passed.');

console.log('WebGPU HDR 展示状态');

assert.equal(
  resolveHdrPresentationState(
    {
      webgpuRequested: true,
      resolvedBackend: 'webgpu',
      outputMode: 'extended',
      dynamicRangeHigh: true,
    },
  ),
  'ready',
  'Extended Canvas 与 High 显示环境形成浏览器侧 HDR 就绪状态',
);
assert.equal(
  resolveHdrPresentationState(
    {
      webgpuRequested: true,
      resolvedBackend: 'webgpu',
      outputMode: 'extended',
      dynamicRangeHigh: false,
    },
  ),
  'display-unconfirmed',
  'Extended Canvas 不会把未报告 HDR 的显示环境误报为就绪',
);
assert.equal(
  resolveHdrPresentationState(
    {
      webgpuRequested: true,
      resolvedBackend: 'webgpu',
      outputMode: 'standard',
      dynamicRangeHigh: true,
    },
  ),
  'standard',
  'High 显示环境不能把 Standard Canvas 误报为 HDR',
);
assert.equal(
  resolveHdrPresentationState(
    {
      webgpuRequested: true,
      resolvedBackend: 'pending',
      outputMode: 'pending',
      dynamicRangeHigh: true,
    },
  ),
  'pending',
  '异步协商期间保持 pending',
);
assert.equal(
  resolveHdrPresentationState(
    {
      webgpuRequested: true,
      resolvedBackend: 'webgl2',
      outputMode: 'unavailable',
      dynamicRangeHigh: true,
    },
  ),
  'unavailable',
  'WebGPU 请求回退后明确报告 HDR 不可用',
);
assert.equal(
  resolveHdrPresentationState(
    {
      webgpuRequested: false,
      resolvedBackend: 'webgpu',
      outputMode: 'extended',
      dynamicRangeHigh: true,
    },
  ),
  'inactive',
  '未选择 WebGPU 时不把缓存的 Extended 协商结果误报为已启用',
);

console.log('WebGPU HDR status tests passed.');
