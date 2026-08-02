import assert from 'node:assert/strict';
import { WebGPUCanvasDevice } from '../src/webgpu-device.js';

function createFixture(options = {})
{
  let resolveLost = null;
  const configureCalls = [];
  const context =
  {
    configure(configuration)
    {
      configureCalls.push(configuration);

      if (
        configuration.toneMapping?.mode === 'extended' &&
        options.rejectExtended
      )
      {
        throw new Error('extended unsupported');
      }
    },
    unconfigureCalls: 0,
    unconfigure()
    {
      this.unconfigureCalls++;
    },
  };
  const lost = new Promise((resolve) =>
  {
    resolveLost = resolve;
  });
  const device =
  {
    lost,
    destroyCalls: 0,
    destroy()
    {
      this.destroyCalls++;
    },
  };
  const adapter =
  {
    requestDeviceCalls: 0,
    async requestDevice()
    {
      this.requestDeviceCalls++;
      return options.deviceUnavailable ? null : device;
    },
  };
  const gpu =
  {
    requestAdapterCalls: [],
    getPreferredCanvasFormat: () => 'bgra8unorm',
    async requestAdapter(request)
    {
      this.requestAdapterCalls.push(request);
      return options.adapterUnavailable ? null : adapter;
    },
  };
  const canvas =
  {
    getContextCalls: [],
    getContext(kind)
    {
      this.getContextCalls.push(kind);
      return options.contextUnavailable ? null : context;
    },
  };

  return {
    adapter,
    canvas,
    configureCalls,
    context,
    device,
    gpu,
    resolveLost,
  };
}

let passed = 0;

function check(condition, message)
{
  assert.ok(condition, message);
  passed++;
  console.log(`  OK ${message}`);
}

console.log('\nWebGPU 设备初始化');
const extendedFixture = createFixture();
const states = [];
const extended = new WebGPUCanvasDevice(
  extendedFixture.canvas,
  {
    gpu: extendedFixture.gpu,
    onStateChange: (state) => states.push(state),
  },
);

check(extended.status === 'pending', '申请 Adapter 期间保持 pending');
check(await extended.ready, 'Adapter 与 Device 成功后进入 ready');
check(
  extendedFixture.canvas.getContextCalls.join(',') === 'webgpu',
  '只请求 webgpu Canvas 上下文',
);
check(
  extendedFixture.gpu.requestAdapterCalls[0]?.powerPreference ===
    'high-performance',
  '默认请求高性能 Adapter',
);
check(states.join(',') === 'ready', '初始化只通知一次 ready 状态');
check(extended.configure(), '可配置 Canvas 输出');
check(
  extended.hdrOutput &&
    extended.canvasFormat === 'rgba16float' &&
    extendedFixture.configureCalls[0]?.toneMapping?.mode === 'extended',
  '优先配置 rgba16float extended HDR 输出',
);
check(
  extended.configure() && extendedFixture.configureCalls.length === 1,
  '相同输出偏好不会每帧重复配置 Canvas',
);

console.log('\nWebGPU SDR 回退');
const standardFixture = createFixture({ rejectExtended: true });
const standard = new WebGPUCanvasDevice(
  standardFixture.canvas,
  { gpu: standardFixture.gpu },
);

check(await standard.ready, 'HDR 配置失败不影响 Device 就绪');
check(standard.configure(), 'extended 失败后配置标准 Canvas');
check(
  !standard.hdrOutput &&
    standard.outputMode === 'standard' &&
    standard.canvasFormat === 'bgra8unorm' &&
    standardFixture.configureCalls.length === 2,
  '标准输出使用浏览器首选格式且不伪报 HDR',
);

console.log('\nWebGPU 不可用与设备丢失');
const unavailableFixture = createFixture({ adapterUnavailable: true });
const unavailable = new WebGPUCanvasDevice(
  unavailableFixture.canvas,
  { gpu: unavailableFixture.gpu },
);

check(!await unavailable.ready, '缺少 Adapter 时安全解析为不可用');
check(unavailable.status === 'unavailable', '不可用状态可供宿主决定回退');
check(!unavailable.configure(), '不可用设备拒绝配置 Canvas');

standardFixture.resolveLost({ reason: 'unknown', message: 'test loss' });
await Promise.resolve();
check(standard.status === 'lost', 'Device lost 会更新生命周期状态');
check(!standard.configure(), '丢失的 Device 不再接受配置');

console.log('\nWebGPU 销毁');
extended.destroy();
extended.destroy();
await Promise.resolve();
check(extended.status === 'destroyed', 'destroy 幂等并保持终止状态');
check(
  extendedFixture.context.unconfigureCalls === 1 &&
    extendedFixture.device.destroyCalls === 1,
  'Canvas 与 Device 只释放一次',
);

console.log(`\nWebGPU 设备测试完成：${passed} 项通过。`);
