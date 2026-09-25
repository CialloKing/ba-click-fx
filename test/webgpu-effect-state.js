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
const onUnhandledRejection = (reason) => unhandledRejections.push(reason);

process.on('unhandledRejection', onUnhandledRejection);

try
{
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

console.log('WebGPU Renderer 构造期失败状态测试通过：3 项');
