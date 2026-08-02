import assert from 'node:assert/strict';
import {
  HDR_UI_UNIFORM_FLOATS,
  MAX_HDR_UI_PRIMITIVES,
  packHdrUiUniforms,
  WebGPUHdrUiRenderer,
  WEBGPU_HDR_UI_SHADER,
} from '../src/webgpu-hdr-ui.js';

console.log('WebGPU HDR UI 数据合同');

const packed = packHdrUiUniforms(
  {
    width: 1920,
    height: 1080,
    brightness: 2.5,
    primitives:
    [
      {
        rect: { x: 20, y: 20, width: 240, height: 42 },
        color: [0.2, 0.7, 1],
        radius: 8,
        borderWidth: 1.5,
        glowWidth: 12,
        intensity: 1.25,
      },
      { rect: { width: 0, height: 10 } },
    ],
  },
);

assert.equal(packed.length, HDR_UI_UNIFORM_FLOATS, 'Uniform 长度固定');
assert.deepEqual(
  Array.from(packed.slice(0, 4)),
  [1920, 1080, 2.5, 1],
  '视口、亮度和有效图元数写入头部',
);
const expectedPrimitive =
  [20, 20, 240, 42, 0.2, 0.7, 1, 0, 8, 1.5, 12, 1.25];

assert.ok(
  Array.from(packed.slice(4, 16)).every((value, index) =>
    Math.abs(value - expectedPrimitive[index]) <= 1e-6),
  '圆角边框图元保持稳定的三个 vec4 布局',
);
const brightnessFixture = {
  width: 320,
  height: 240,
  primitives:
  [{
    rect: { x: 10, y: 20, width: 30, height: 40 },
    color: [0.2, 0.7, 1],
    intensity: 1.25,
  }],
};
const minimumBrightnessPacked = packHdrUiUniforms(
  { ...brightnessFixture, brightness: 1 },
);
const maximumBrightnessPacked = packHdrUiUniforms(
  { ...brightnessFixture, brightness: 16 },
);

assert.equal(minimumBrightnessPacked[2], 1, 'UI HDR 最低亮度写入独立 Uniform');
assert.equal(maximumBrightnessPacked[2], 16, 'UI HDR 最高亮度写入独立 Uniform');
assert.ok(
  minimumBrightnessPacked.every((value, index) =>
    index === 2 || value === maximumBrightnessPacked[index]),
  'UI HDR 亮度只能改变自身 Uniform，不能改写图元数据',
);

const overflowPacked = packHdrUiUniforms(
  {
    primitives: Array.from(
      { length: MAX_HDR_UI_PRIMITIVES + 5 },
      (_, index) =>
      ({ rect: { x: index, y: 0, width: 1, height: 1 } }),
    ),
  },
);

assert.equal(
  overflowPacked[3],
  MAX_HDR_UI_PRIMITIVES,
  '固定上限避免展示页 DOM 数量扩大 GPU Uniform',
);
assert.ok(
  WEBGPU_HDR_UI_SHADER.includes('toneMapping') === false &&
    WEBGPU_HDR_UI_SHADER.includes('linearToExtendedSrgb') &&
    WEBGPU_HDR_UI_SHADER.includes('@builtin(instance_index)') &&
    WEBGPU_HDR_UI_SHADER.includes('return vec4f(encoded, 1.0);'),
  'Shader 用局部实例输出扩展 sRGB，Canvas 协商仍由生命周期类负责',
);

console.log('WebGPU HDR UI 生命周期');

function createFixture()
{
  const calls = [];
  const pass = {
    setPipeline: () => calls.push('setPipeline'),
    setBindGroup: () => calls.push('setBindGroup'),
    draw: (count, instances) => calls.push(`draw:${count}:${instances}`),
    end: () => calls.push('end'),
  };
  const context = {
    configure: (configuration) => calls.push(
      [
        'configure',
        configuration.format,
        configuration.toneMapping.mode,
        configuration.alphaMode,
      ].join(':'),
    ),
    unconfigure: () => calls.push('unconfigure'),
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
  const canvas = {
    width: 1,
    height: 1,
    style: {},
    dataset: {},
    getContext: (kind) => kind === 'webgpu' ? context : null,
  };
  const buffer = { destroy: () => calls.push('destroyBuffer') };
  const device = {
    limits: { maxTextureDimension2D: 8192 },
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createBuffer: () => buffer,
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => pass,
      finish: () => ({}),
    }),
    queue:
    {
      writeBuffer: () => calls.push('writeBuffer'),
      submit: () => calls.push('submit'),
    },
  };

  return { buffer, calls, canvas, context, device };
}

const fixture = createFixture();
const renderer = new WebGPUHdrUiRenderer(fixture.canvas);

assert.ok(renderer.available, 'WebGPU Canvas Context 可用');
assert.ok(renderer.configure(fixture.device), 'Extended UI Canvas 配置成功');
assert.ok(
  fixture.calls.includes('configure:rgba16float:extended:opaque') &&
    fixture.canvas.dataset.hdrUiOutput === 'extended',
  'UI Canvas 只使用 rgba16float Extended 输出',
);
assert.ok(
  renderer.render(
    {
      width: 320,
      height: 240,
      dpr: 2,
      primitives:
      [{ rect: { x: 10, y: 10, width: 20, height: 20 } }],
    },
  ),
  'HDR UI 图元可以提交',
);
assert.ok(
  fixture.canvas.width === 640 &&
    fixture.canvas.height === 480 &&
    fixture.canvas.style.display === 'block' &&
    fixture.canvas.dataset.hdrUiPrimitives === '1' &&
    fixture.calls.includes('draw:6:1'),
  'Canvas 尺寸、可见性和局部实例绘制同步更新',
);
fixture.device.limits.maxTextureDimension2D = 512;
assert.ok(
  renderer.render(
    {
      width: 400,
      height: 300,
      dpr: 2,
      primitives:
      [{ rect: { x: 10, y: 10, width: 20, height: 20 } }],
    },
  ) &&
    fixture.canvas.width === 512 &&
    fixture.canvas.height === 384 &&
    fixture.canvas.dataset.hdrUiDpr === '1.280',
  'UI Surface DPR 遵守共享 Device 的纹理尺寸上限',
);
assert.ok(renderer.suspend(), '切出 WebGPU 时解除 UI Canvas 配置');
assert.ok(
  fixture.calls.includes('unconfigure') &&
    fixture.canvas.style.display === 'none' &&
    fixture.canvas.dataset.hdrUiOutput === 'inactive',
  '暂停后不保留隐藏 Extended Surface',
);
assert.ok(renderer.configure(fixture.device), '同一 Device 可重新协商 Extended');
renderer.destroy();
assert.ok(
  fixture.calls.filter((call) => call === 'unconfigure').length === 2 &&
    fixture.calls.includes('destroyBuffer'),
  '销毁时解除配置并释放自有 Buffer，不销毁共享 Device',
);

const replacementFixture = createFixture();
const replacementRenderer = new WebGPUHdrUiRenderer(replacementFixture.canvas);

assert.ok(replacementRenderer.configure(replacementFixture.device));
assert.ok(
  replacementRenderer.configure(createFixture().device),
  'Device 更换后可重建 UI GPU 资源',
);
assert.equal(
  replacementFixture.calls.filter((call) => call === 'unconfigure').length,
  1,
  'Device 更换前必须先解除旧 Extended Surface',
);
replacementRenderer.destroy();

console.log('WebGPU HDR UI tests passed.');
