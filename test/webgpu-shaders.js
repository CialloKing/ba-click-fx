import assert from 'node:assert/strict';
import { resolveHdrPresentationState } from '../src/hdr-presentation-status.js';
import { linearToSrgb } from '../src/software-bloom.js';
import {
  linearToExtendedSrgb,
  WEBGPU_FULLSCREEN_SHADER,
} from '../src/webgpu-shaders.js';

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
    'let extendedSrgb = linearToExtendedSrgb3(linear);',
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
