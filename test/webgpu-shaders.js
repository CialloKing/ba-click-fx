import assert from 'node:assert/strict';
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
