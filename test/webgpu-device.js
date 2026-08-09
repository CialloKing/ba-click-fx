import assert from 'node:assert/strict';
import { WebGPUCanvasDevice } from '../src/webgpu-device.js';

function createFixture(options = {})
{
  let resolveLost = null;
  const configureCalls = [];
  const configureErrors = [];
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
        const error = new Error('extended unsupported');
        configureErrors.push(error);
        throw error;
      }
    },
    unconfigureCalls: 0,
    unconfigure()
    {
      this.unconfigureCalls++;

      if (options.rejectUnconfigure)
      {
        throw new Error('unconfigure failed');
      }
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
    configureErrors,
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
check(
  Object.isFrozen(extended.diagnostics) &&
    Object.isFrozen(extended.diagnostics.stages) &&
    Object.isFrozen(extended.diagnostics.stages.device) &&
    extended.diagnostics.failureStage === null &&
    extended.diagnostics.stages.gpuApi.status === 'succeeded' &&
    extended.diagnostics.stages.context.status === 'succeeded' &&
    extended.diagnostics.stages.adapter.status === 'succeeded' &&
    extended.diagnostics.stages.device.status === 'succeeded',
  '初始化诊断以只读快照报告各阶段成功',
);
check(extended.configure(), '可配置 Canvas 输出');
check(
  extended.hdrOutput &&
    extended.canvasFormat === 'rgba16float' &&
    extendedFixture.configureCalls[0]?.toneMapping?.mode === 'extended',
  '优先配置 rgba16float extended HDR 输出',
);
check(
  extended.diagnostics.stages.extendedConfigure.status === 'succeeded' &&
    extended.diagnostics.stages.standardConfigure.status === 'skipped',
  'Extended 成功时诊断明确跳过标准输出',
);
check(
  extended.configure() && extendedFixture.configureCalls.length === 1,
  '相同输出偏好不会每帧重复配置 Canvas',
);
check(extended.unconfigure(), '可暂停 Canvas 展示而不销毁 Device');
check(
  extended.status === 'ready' &&
    extended.outputMode === 'unconfigured' &&
    extended.canvasFormat === null &&
    extended.preferHdr === null &&
    extendedFixture.context.unconfigureCalls === 1 &&
    extended.diagnostics.failureStage === null &&
    extended.diagnostics.stages.extendedConfigure.status === 'idle' &&
    extended.diagnostics.stages.standardConfigure.status === 'idle' &&
    extended.diagnostics.stages.unconfigure.status === 'succeeded',
  '暂停后清除 HDR 输出状态并保持 Device 就绪',
);
check(
  extended.unconfigure() &&
    extendedFixture.context.unconfigureCalls === 1,
  '重复暂停 Canvas 展示保持幂等',
);
check(
  extended.configure() &&
    extended.hdrOutput &&
    extendedFixture.configureCalls.length === 2 &&
    extendedFixture.gpu.requestAdapterCalls.length === 1 &&
    extendedFixture.adapter.requestDeviceCalls === 1,
  '恢复 Canvas 展示时复用 Adapter 与 Device 并重新协商 HDR',
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
const firstExtendedError = standardFixture.configureErrors[0];
check(
  standard.diagnostics.failureStage === 'extended-configure-failed' &&
    standard.diagnostics.stages.extendedConfigure.status === 'failed' &&
    standard.diagnostics.stages.extendedConfigure.error === firstExtendedError &&
    standard.diagnostics.stages.standardConfigure.status === 'succeeded',
  'SDR 回退成功后仍保留 Extended 配置异常及稳定阶段代码',
);
check(standard.unconfigure(), 'SDR 回退输出可正常暂停');
check(
  standard.diagnostics.failureStage === null &&
    standard.diagnostics.stages.extendedConfigure.status === 'idle' &&
    standard.diagnostics.stages.standardConfigure.status === 'idle' &&
    standard.diagnostics.stages.unconfigure.status === 'succeeded',
  '暂停输出会清除上一轮 HDR 协商失败记录',
);
check(standard.configure(), '暂停后可重新协商输出');
check(
  standard.diagnostics.failureStage === 'extended-configure-failed' &&
    standard.diagnostics.stages.extendedConfigure.error !== firstExtendedError &&
    standard.diagnostics.stages.standardConfigure.status === 'succeeded' &&
    standard.diagnostics.stages.unconfigure.status === 'idle',
  '重新配置生成新的协商诊断且清除旧暂停状态',
);

console.log('\nWebGPU 强制标准输出');
const forcedStandardFixture = createFixture();
const forcedStandard = new WebGPUCanvasDevice(
  forcedStandardFixture.canvas,
  { gpu: forcedStandardFixture.gpu },
);

check(await forcedStandard.ready, '标准模式可正常申请 Device');
check(
  forcedStandard.configure({ preferHdr: false }),
  '标准模式可直接配置 Canvas',
);
check(
  forcedStandard.outputMode === 'standard' &&
    forcedStandard.canvasFormat === 'bgra8unorm' &&
    forcedStandardFixture.configureCalls.length === 1 &&
    forcedStandardFixture.configureCalls[0]?.format === 'bgra8unorm' &&
    !('toneMapping' in forcedStandardFixture.configureCalls[0]) &&
    forcedStandard.diagnostics.stages.extendedConfigure.status === 'skipped' &&
    forcedStandard.diagnostics.stages.standardConfigure.status === 'succeeded',
  '标准模式不尝试 rgba16float Extended 配置且诊断明确跳过 HDR',
);
forcedStandard.destroy();

console.log('\nWebGPU 不可用与设备丢失');
const unavailableFixture = createFixture({ adapterUnavailable: true });
const unavailable = new WebGPUCanvasDevice(
  unavailableFixture.canvas,
  { gpu: unavailableFixture.gpu },
);

check(!await unavailable.ready, '缺少 Adapter 时安全解析为不可用');
check(unavailable.status === 'unavailable', '不可用状态可供宿主决定回退');
check(
  unavailable.diagnostics.failureStage === 'adapter-unavailable' &&
    unavailable.diagnostics.stages.gpuApi.status === 'succeeded' &&
    unavailable.diagnostics.stages.context.status === 'succeeded' &&
    unavailable.diagnostics.stages.adapter.status === 'failed' &&
    unavailable.diagnostics.stages.device.status === 'idle' &&
    unavailable.diagnostics.stages.adapter.error === unavailable.failure,
  'Adapter 缺失诊断保留精确失败阶段和错误对象',
);
check(!unavailable.configure(), '不可用设备拒绝配置 Canvas');

standardFixture.resolveLost({ reason: 'unknown', message: 'test loss' });
await Promise.resolve();
check(standard.status === 'lost', 'Device lost 会更新生命周期状态');
check(
  standard.diagnostics.failureStage === 'device-lost' &&
    standard.diagnostics.stages.device.status === 'lost' &&
    standard.diagnostics.stages.deviceLost.status === 'lost' &&
    standard.diagnostics.stages.deviceLost.error === standard.failure &&
    standard.diagnostics.stages.extendedConfigure.status === 'idle' &&
    standard.diagnostics.stages.standardConfigure.status === 'idle',
  'Device lost 诊断覆盖旧输出协商并保留浏览器丢失信息',
);
check(!standard.configure(), '丢失的 Device 不再接受配置');

console.log('\nWebGPU 暂停失败');
const unconfigureFailureFixture = createFixture({ rejectUnconfigure: true });
const unconfigureFailure = new WebGPUCanvasDevice(
  unconfigureFailureFixture.canvas,
  { gpu: unconfigureFailureFixture.gpu },
);

check(await unconfigureFailure.ready, '暂停失败夹具可正常初始化');
check(unconfigureFailure.configure(), '暂停失败前可配置 Extended 输出');
check(!unconfigureFailure.unconfigure(), '浏览器拒绝暂停时返回失败');
check(
  unconfigureFailure.outputMode === 'extended' &&
    unconfigureFailure.diagnostics.failureStage === 'unconfigure-failed' &&
    unconfigureFailure.diagnostics.stages.unconfigure.status === 'failed' &&
    unconfigureFailure.diagnostics.stages.unconfigure.error ===
      unconfigureFailure.failure,
  '暂停失败保留当前输出合同并报告稳定阶段代码',
);

console.log('\nWebGPU 销毁');
extended.destroy();
extended.destroy();
await Promise.resolve();
check(extended.status === 'destroyed', 'destroy 幂等并保持终止状态');
check(
  extendedFixture.context.unconfigureCalls === 2 &&
    extendedFixture.device.destroyCalls === 1,
  '恢复后的 Canvas 与 Device 在销毁时只再释放一次',
);

console.log(`\nWebGPU 设备测试完成：${passed} 项通过。`);
