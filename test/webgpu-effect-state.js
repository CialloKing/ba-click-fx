import assert from 'node:assert/strict';
import { WebGPUEffectRenderer } from '../src/webgpu-effect.js';

function createCanvas(getContext)
{
  return {
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getContext,
  };
}

async function verifyUnavailableCase(
  label,
  gpu,
  getContext,
  expectedFailureStage,
)
{
  const states = [];
  const renderer = new WebGPUEffectRenderer(
    createCanvas(getContext),
    {
      gpu,
      onStateChange: (status) => states.push(status),
    },
  );
  const ready = await renderer.ready;
  const diagnostics = renderer.deviceManager.diagnostics;

  assert.equal(ready, false, `${label} ready 必须解析为 false`);
  assert.equal(
    renderer.status,
    'unavailable',
    `${label} Renderer 必须进入 unavailable`,
  );
  assert.equal(
    renderer.deviceManager.status,
    'unavailable',
    `${label} DeviceManager 必须进入 unavailable`,
  );
  assert.equal(
    diagnostics.failureStage,
    expectedFailureStage,
    `${label} 必须保留稳定失败码`,
  );
  assert.equal(
    renderer.failure,
    renderer.deviceManager.failure,
    `${label} Renderer 必须保留底层失败原因`,
  );
  assert.deepEqual(
    states,
    ['unavailable'],
    `${label} 必须在构造完成后通知一次 unavailable`,
  );

  renderer.addDissolveRing(100, 100, 50, 10, 0, 8, 96, [1, 1, 1], 1, 0.5, 0, 1, 1);
  assert.ok(renderer._ringCosine instanceof Float64Array, 'WebGPU 复用父类圆环工作缓冲');
  renderer.destroy();
  renderer.destroy();
  assert.equal(renderer._ringCosine, null, 'WebGPU 重复销毁释放圆环余弦缓冲');
  assert.equal(renderer._ringSine, null, 'WebGPU 重复销毁释放圆环正弦缓冲');
}

const unhandledRejections = [];

async function verifyResourceReuse()
{
  // 只替换被测的资源工厂和队列，不模拟着色器或 GPU 光栅化。
  const renderer = new WebGPUEffectRenderer(createCanvas(() => null), { gpu: {} });
  await renderer.ready;
  let groups = 0;
  let views = 0;
  const writes = [];
  renderer.device = {
    createBindGroup: descriptor => ({ ...descriptor, serial: ++groups }),
    queue: { writeBuffer: (uniform, offset, data) => writes.push({ uniform, data: data.slice(0) }) },
  };
  renderer.sampler = {};
  const pipeline = { getBindGroupLayout: () => 'layout' };
  const texture = { createView: () => ({ serial: ++views }) };
  const uniform = {};
  const geometry = renderer._createGeometryBindGroup('scene:ring', pipeline, uniform, texture);
  const pass = renderer._createFullscreenBindGroup('prefilter', pipeline, uniform, 'source');
  for (let i = 0; i < 20; i++)
  {
    assert.equal(renderer._createGeometryBindGroup('scene:ring', pipeline, uniform, texture), geometry);
    assert.equal(renderer._createFullscreenBindGroup('prefilter', pipeline, uniform, 'source'), pass);
  }
  assert.equal(groups, 2, '稳定绘制位置不重复创建绑定组');
  assert.equal(views, 1, '静态纹理跨 Pass 只创建一个视图');
  renderer._createGeometryBindGroup('bloom:ring', pipeline, {}, texture);
  assert.equal(views, 1);
  const oldSampler = renderer.sampler;
  renderer.sampler = {};
  assert.notEqual(renderer._createGeometryBindGroup('scene:ring', pipeline, uniform, texture), geometry);
  const replacementPipeline = { getBindGroupLayout: () => 'new-layout' };
  const replacement = renderer._createGeometryBindGroup('scene:ring', replacementPipeline, uniform, texture);
  assert.equal(replacement.layout, 'new-layout');
  assert.equal(renderer.bindGroups.size, 3, '替换资源不积累历史组合');
  renderer._invalidateBindGroups(replacementPipeline);
  assert.equal(renderer.bindGroups.has('scene:ring'), false);
  renderer._invalidateBindGroups('source');
  assert.equal(renderer.bindGroups.has('prefilter'), false);
  const noUniform = renderer._createFullscreenBindGroup('coverage', pipeline, null, 'source');
  assert.deepEqual(noUniform.entries.map(entry => entry.binding), [1, 2]);
  renderer.sampler = oldSampler;

  const firstPass = renderer._createPassUniform({ texelX: 8, hasScene: true, extendedOutput: true,
    hdrBrightness: 7, backgroundScaleX: 0.5 });
  const defaultPass = renderer._createPassUniform();
  assert.equal(firstPass, defaultPass, '后处理 Uniform 复用同一个工作缓冲');
  const floats = new Float32Array(defaultPass);
  const integers = new Uint32Array(defaultPass);
  assert.equal(floats[0], 1);
  assert.equal(floats[2], 1);
  assert.equal(floats[22], 1);
  assert.deepEqual([...integers.subarray(11, 18)], Array(7).fill(0), '完整覆盖上一个 Pass 的标志');
  renderer.displayWidth = 320;
  renderer.displayHeight = 240;
  const scratch = renderer.geometryUniformScratch;
  renderer._writeGeometryUniform(uniform, true, { disk: 3, ring: 4 });
  renderer._writeGeometryUniform({}, false);
  assert.equal(renderer.geometryUniformScratch, scratch);
  assert.equal(new Float32Array(writes[0].data)[2], 3, '后续工作面写入不改变已提交的 Uniform');
  assert.deepEqual([...new Float32Array(writes[1].data)], [320, 240, 1, 1, 0, 0, 0, 0]);

  renderer._deleteTargets();
  assert.equal(renderer.bindGroups.size, 0, '释放目标时不持有旧目标绑定');
  renderer._createGeometryBindGroup('scene:ring', pipeline, uniform, texture);
  renderer._handleDeviceState('lost', { failure: new Error('test loss') });
  assert.equal(renderer.bindGroups.size, 0, '设备丢失时清理绑定引用');
  assert.equal(renderer.textureViews.has(texture), false);
  renderer.destroy();
  renderer.destroy();
  assert.equal(renderer.geometryUniformScratch, null);
  assert.equal(renderer.passUniformScratch, null);
}
const onUnhandledRejection = (reason) => unhandledRejections.push(reason);

async function verifySceneUploads()
{
  const renderer = new WebGPUEffectRenderer(createCanvas(() => null), { gpu: {} });
  await renderer.ready;
  const uploads = [];
  const draws = [];
  let boundBuffer;
  const pass = {
    setPipeline() {}, setBindGroup() {}, end() {},
    setVertexBuffer: (_, buffer) => { boundBuffer = buffer; },
    draw: count => draws.push([boundBuffer.label, count]),
  };
  renderer.device = {
    createBuffer: descriptor => ({ ...descriptor, destroy() {} }),
    createBindGroup: descriptor => descriptor,
    createCommandEncoder: () => ({ beginRenderPass: () => pass, finish() {} }),
    queue: {
      submit() {},
      writeBuffer(buffer, offset, data, dataOffset, size)
      {
        if (buffer.label?.endsWith(' vertices'))
        {
          uploads.push({ label: buffer.label, data: new Uint8Array(data, dataOffset, size).slice() });
        }
      },
    },
  };
  const pipeline = { getBindGroupLayout() {} };
  renderer.pipelines = Object.fromEntries(
    ['disk', 'trailScene', 'genericScene', 'ringScene', 'triangleScene'].map(name => [name, pipeline]),
  );
  renderer.geometryUniform = {};
  renderer.bloomGeometryUniform = {};
  renderer.available = true;
  renderer.sourceWidth = 320;
  renderer.sourceHeight = 240;
  const target = () => ({ width: 320, height: 240, view: {}, texture: { destroy() {} } });
  renderer.sourceTarget = target();
  renderer.bloomSourceTarget = target();
  for (const key of ['sceneDiskVertexCount', 'trailVertexCount', 'vertexCount',
    'ringVertexCount', 'triangleVertexCount']) renderer[key] = 3;
  const settings = { outputCompositing: 'scene', diskEmissionScale: 2, ringEmissionScale: 3 };
  assert.equal(renderer.renderScene(settings), true);
  assert.equal(uploads.length, 5, '清晰与发光两次绘制每种几何只上传一次');
  assert.deepEqual(draws.slice(0, 5), draws.slice(5), '两层保持相同的几何及绘制顺序');
  renderer.ringVertexData[0] = 123;
  assert.equal(renderer.renderScene(settings), true);
  assert.equal(uploads.length, 10, '再次调用 renderScene 必须重新提交修改后的几何');
  assert.equal(new Float32Array(uploads[8].data.buffer)[0], 123);
  const buffer = renderer.vertexBuffers.ring.buffer;
  renderer.beginFrame();
  assert.equal(renderer.renderScene(settings), true);
  assert.equal(uploads.length, 10, '空批次不上传旧缓冲');
  renderer.ringVertexCount = 3;
  assert.equal(renderer.renderScene(settings), true);
  assert.equal(uploads.length, 11);
  assert.equal(renderer.vertexBuffers.ring.buffer, buffer, '容量足够时复用 GPU 顶点缓冲');
  renderer.destroy();
}

process.on('unhandledRejection', onUnhandledRejection);

try
{
  await verifyResourceReuse();
  await verifySceneUploads();
  await verifyUnavailableCase(
    'WebGPU API 缺失',
    {},
    () =>
    {
      throw new Error('API 缺失时不应请求 Context');
    },
    'webgpu-api-missing',
  );

  const gpu = { requestAdapter: async () => null };

  await verifyUnavailableCase(
    'Context 返回 null',
    gpu,
    () => null,
    'context-unavailable',
  );

  const contextError = new Error('Context 创建失败');

  await verifyUnavailableCase(
    'Context 抛出异常',
    gpu,
    () =>
    {
      throw contextError;
    },
    'context-unavailable',
  );

  // 让 Node 完成 Promise 拒绝检查，避免仅因同一轮事件循环而漏报。
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    unhandledRejections,
    [],
    '构造期同步失败不得产生 unhandledRejection',
  );
}
finally
{
  process.removeListener('unhandledRejection', onUnhandledRejection);
}

console.log('WebGPU Renderer 状态、资源复用与场景提交测试通过');
