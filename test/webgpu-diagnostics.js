import assert from 'node:assert/strict';
import {
  formatDiagnosticError,
  getDiagnosticStageValue,
  getWebGPUFailureStage,
} from '../src/webgpu-diagnostics.js';

const dictionary = {
  diagnosticFailed: 'failed',
  diagnosticLost: 'lost',
  diagnosticNotTested: 'not-tested',
  diagnosticPending: 'pending',
  diagnosticReady: 'ready',
  diagnosticSkipped: 'skipped',
  diagnosticUnavailable: 'unavailable',
};

assert.equal(
  getDiagnosticStageValue(null, true, dictionary),
  'not-tested',
  '尚未创建 Manager 时不应伪报不可用',
);
assert.equal(
  getDiagnosticStageValue({ status: 'pending' }, true, dictionary),
  'pending',
  '阶段正在请求时应报告 pending',
);
assert.equal(
  formatDiagnosticError({ message: '', reason: 'destroyed' }),
  'destroyed',
  'Device Lost 的空 message 不应遮蔽 reason',
);

const apiFailure = { failureStage: 'webgpu-api-missing' };

assert.equal(
  getWebGPUFailureStage(
    { status: 'unavailable' },
    { status: 'unavailable' },
    apiFailure,
    false,
  ),
  'webgpu-api-missing',
  '设备管理器初始化失败应保留精确阶段',
);
assert.equal(
  getWebGPUFailureStage(
    { status: 'ready' },
    { status: 'ready' },
    { failureStage: 'standard-configure-failed' },
    true,
  ),
  'standard-configure-failed',
  'Standard 配置失败应直接解释后端回退',
);
assert.equal(
  getWebGPUFailureStage(
    { status: 'ready' },
    { status: 'ready' },
    { failureStage: 'extended-configure-failed' },
    true,
  ),
  'renderer-frame-failed',
  'Standard 成功后的管线回退不应归因于 Extended 拒绝',
);
assert.equal(
  getWebGPUFailureStage(
    { status: 'unavailable' },
    { status: 'ready' },
    { failureStage: 'extended-configure-failed' },
    false,
  ),
  'renderer-unavailable',
  '运行时 Renderer 失败不应被历史 Extended 拒绝遮蔽',
);
assert.equal(
  getWebGPUFailureStage(
    { status: 'lost' },
    { status: 'lost' },
    { failureStage: 'device-lost' },
    false,
  ),
  'device-lost',
  'Device Lost 应保留稳定阶段代码',
);

console.log('WebGPU 诊断状态测试通过：8 项');
