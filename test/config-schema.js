/**
 * 参数元数据契约测试。
 *
 * 测试只导入纯配置模块，宿主无需 DOM 或渲染器就能校验和迁移配置。
 */

import assert from 'node:assert/strict';
import {
  CONFIG,
  DEFAULT_THEME_COLOR,
  DEFAULT_THEME_COLOR_MODE,
  FX_PARAM_MIGRATIONS,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  UNITY_FX_TOUCH,
  createConfig,
  isHostCompositing,
  isHostCompositingSurface,
  isIndependentHostCompositing,
  isInputSamplingRate,
  isOverlayAlphaPolicy,
  isOverlayColorCompensation,
  isOverlayAlphaLimit,
  isThemeColorMode,
  normalizeHostCompositing,
  normalizeHostCompositingSurface,
  normalizeInputSamplingRate,
  normalizeOverlayAlphaLimit,
  normalizeOverlayAlphaPolicyConfig,
  normalizeOverlayColorCompensationConfig,
  normalizeThemeColor,
  normalizeThemeColorMode,
  normalizeWebGPUHdrPresentation,
  resolveHostCompositing,
} from '../src/config.js';

let passed = 0;

function check(condition, message)
{
  assert.ok(condition, message);
  passed++;
  console.log(`  ✓ ${message}`);
}

function assertConfigError(factory, message)
{
  assert.throws(factory, TypeError, message);
  passed++;
  console.log(`  ✓ ${message}`);
}

function getUnityValue(path)
{
  return path.split('.').reduce((value, key) => value[key], UNITY_FX_TOUCH);
}

function assertDeepFrozen(value, path)
{
  if (value === null || typeof value !== 'object')
  {
    return;
  }

  assert.ok(Object.isFrozen(value), `${path} 必须被冻结`);

  for (const [key, child] of Object.entries(value))
  {
    assertDeepFrozen(child, `${path}.${key}`);
  }
}

console.log('\n参数 Schema 版本与序列化契约');
check(FX_PARAM_SCHEMA_VERSION === 2, 'Schema 版本固定为 2');
check(FX_PARAM_SCHEMA.length === 66, '保留 66 个公开标量参数');
assertDeepFrozen(FX_PARAM_SCHEMA, 'FX_PARAM_SCHEMA');
assertDeepFrozen(FX_PARAM_MIGRATIONS, 'FX_PARAM_MIGRATIONS');
check(true, 'Schema 与迁移元数据均为深只读');

const serializedContract = JSON.stringify(
  {
    version: FX_PARAM_SCHEMA_VERSION,
    params: FX_PARAM_SCHEMA,
    migrations: FX_PARAM_MIGRATIONS,
  },
);
const parsedContract = JSON.parse(serializedContract);

check(
  parsedContract.params.length === FX_PARAM_SCHEMA.length &&
    parsedContract.migrations.length === FX_PARAM_MIGRATIONS.length,
  '契约可完整 JSON 往返',
);

console.log('\n参数路径、分组与展示范围');
const paths = new Set(FX_PARAM_SCHEMA.map((descriptor) => descriptor.path));
const orders = new Set(FX_PARAM_SCHEMA.map((descriptor) => descriptor.order));
const labelKeys = new Set(
  FX_PARAM_SCHEMA.map((descriptor) => descriptor.labelKey),
);

check(paths.size === FX_PARAM_SCHEMA.length, '参数路径不重复');
check(orders.size === FX_PARAM_SCHEMA.length, '稳定展示序号不重复');
check(labelKeys.size === FX_PARAM_SCHEMA.length, '本地化标签键不重复');

let previousOrder = 0;

for (const descriptor of FX_PARAM_SCHEMA)
{
  const unityDefault = getUnityValue(descriptor.path);

  assert.equal(descriptor.default, unityDefault, `${descriptor.path} 默认值`);
  assert.ok(descriptor.order > previousOrder, `${descriptor.path} 展示顺序`);
  assert.equal(descriptor.group, descriptor.path.split('.')[0]);
  assert.equal(
    descriptor.labelKey,
    `baClickFx.params.${descriptor.path}`,
  );
  assert.equal(
    descriptor.groupLabelKey,
    `baClickFx.paramGroups.${descriptor.group}`,
  );
  previousOrder = descriptor.order;

  if (descriptor.type === 'number')
  {
    assert.ok(descriptor.display, `${descriptor.path} 缺少展示范围`);
    assert.ok(descriptor.display.min <= descriptor.default);
    assert.ok(descriptor.display.max >= descriptor.default);
    assert.ok(descriptor.display.step > 0);
    assert.ok(descriptor.display.min >= descriptor.min);
    assert.ok(descriptor.display.max <= descriptor.max);
  }
  else
  {
    assert.equal(descriptor.display, undefined);
  }

  for (const linkedPath of descriptor.linkedParams)
  {
    const linkedDescriptor = FX_PARAM_SCHEMA.find(
      (candidate) => candidate.path === linkedPath,
    );

    assert.ok(linkedDescriptor, `${descriptor.path} 关联的 ${linkedPath} 必须存在`);
    assert.ok(
      linkedDescriptor.linkedParams.includes(descriptor.path),
      `${descriptor.path} 与 ${linkedPath} 必须双向关联`,
    );
  }
}

check(true, '所有描述符都匹配 Unity 默认值与展示边界');

const bloomThresholdDescriptor = FX_PARAM_SCHEMA.find(
  (descriptor) => descriptor.path === 'bloom.threshold',
);
const bloomClampDescriptor = FX_PARAM_SCHEMA.find(
  (descriptor) => descriptor.path === 'bloom.clamp',
);

assert.equal(bloomThresholdDescriptor?.unit, 'gamma-hdr');
assert.equal(bloomClampDescriptor?.unit, 'gamma-hdr');
check(true, 'Bloom Threshold 与 Clamp 都从 Gamma 配置换算到 Linear');

console.log('\nUnity 基线与版本迁移');
assert.equal(
  FX_PARAM_SCHEMA.every((descriptor) => !Object.hasOwn(descriptor, 'modeDefaults')),
  true,
);
check(true, '参数描述符只保留 Unity 基线');
assertConfigError(
  () => createConfig({ renderingMode: 'enhanced' }),
  '构造配置拒绝已移除的 renderingMode',
);

assert.deepEqual(
  FX_PARAM_MIGRATIONS,
  [
    {
      fromVersion: 0,
      toVersion: 1,
      changes:
      [
        {
          kind: 'replace',
          from: 'bloom.scatter',
          to: 'bloom.diffusion',
          source:
          {
            type: 'number',
            min: 0,
          },
          value: 7,
        },
      ],
    },
    {
      fromVersion: 1,
      toVersion: 2,
      changes: [],
    },
  ],
);
check(true, '0 -> 1 保留旧参数迁移，1 -> 2 使用新增参数默认值');

console.log('\n主题色配置契约');
check(
  DEFAULT_THEME_COLOR === '#4ca7ff' &&
    CONFIG.themeColor === DEFAULT_THEME_COLOR,
  '默认配置导出游戏基准蓝',
);
check(
  normalizeThemeColor('#4CA7FF') === DEFAULT_THEME_COLOR &&
    normalizeThemeColor('') === DEFAULT_THEME_COLOR,
  '主题色规范化为小写并让无效值回退游戏蓝',
);
check(
  createConfig({ themeColor: '#FF6969' }).themeColor === '#ff6969',
  '构造配置保存合法主题色并统一为小写',
);
assertConfigError(
  () => createConfig({ themeColor: 'red' }),
  '构造配置拒绝非十六进制主题色',
);
check(
  DEFAULT_THEME_COLOR_MODE === 'relative-oklch' &&
    CONFIG.themeColorMode === DEFAULT_THEME_COLOR_MODE &&
    isThemeColorMode('hue-only') &&
    isThemeColorMode('relative-oklch') &&
    !isThemeColorMode('oklch'),
  '主题颜色映射默认使用相对 OKLCH 并只接受两个公开枚举',
);
check(
  normalizeThemeColorMode('relative-oklch') === 'relative-oklch' &&
    normalizeThemeColorMode('invalid') === DEFAULT_THEME_COLOR_MODE &&
    createConfig({ themeColorMode: 'relative-oklch' }).themeColorMode ===
      'relative-oklch',
  '主题颜色映射辅助函数可规范化，构造配置保留合法模式',
);
assertConfigError(
  () => createConfig({ themeColorMode: 'invalid' }),
  '构造配置拒绝非法主题颜色映射模式',
);

console.log('\n输入采样率配置合同');
check(
  CONFIG.inputSamplingRate === 0 &&
    createConfig().inputSamplingRate === 0,
  '输入采样率默认不限频',
);
check(
  isInputSamplingRate(0) &&
    isInputSamplingRate(30) &&
    isInputSamplingRate(1000) &&
    !isInputSamplingRate(0.5) &&
    !isInputSamplingRate(1001) &&
    !isInputSamplingRate(-1) &&
    !isInputSamplingRate(Number.NaN) &&
    !isInputSamplingRate(Number.POSITIVE_INFINITY),
  '输入采样率只接受 0 或 1..1000 的有限 Hz',
);
check(
  normalizeInputSamplingRate(30) === 30 &&
    normalizeInputSamplingRate(-1, 60) === 60 &&
    createConfig({ inputSamplingRate: 15 }).inputSamplingRate === 15,
  '构造配置保留合法采样率，辅助函数仍可恢复默认值',
);
assertConfigError(
  () => createConfig({ inputSamplingRate: -1 }),
  '构造配置拒绝低于范围的采样率',
);

console.log('\nWebGPU HDR 展示配置合同');
check(
  CONFIG.webgpuPreferHdr === true,
  'WebGPU 默认保持向后兼容的 HDR 优先输出偏好',
);
check(
  CONFIG.webgpuHdrPeak === 3 &&
    CONFIG.webgpuHdrBrightness === 1 &&
    CONFIG.webgpuHdrColorPreservation === 0 &&
    CONFIG.webgpuHdrWhiteCore === 0.6 &&
    CONFIG.webgpuHdrWhiteStart === 1 &&
    CONFIG.webgpuHdrWhiteEnd === 5,
  '默认 HDR 展示映射使用受限峰值与渐进白核',
);

const normalizedHdrPresentation = normalizeWebGPUHdrPresentation(
  {
    webgpuHdrPeak: 8,
    webgpuHdrBrightness: 64,
    webgpuHdrColorPreservation: 2,
    webgpuHdrWhiteCore: -1,
    webgpuHdrWhiteStart: 7,
    webgpuHdrWhiteEnd: 2,
  },
);

check(
  normalizedHdrPresentation.webgpuHdrPeak === 4 &&
    normalizedHdrPresentation.webgpuHdrBrightness === 32 &&
    normalizedHdrPresentation.webgpuHdrColorPreservation === 1 &&
    normalizedHdrPresentation.webgpuHdrWhiteCore === 0 &&
    normalizedHdrPresentation.webgpuHdrWhiteStart === 7 &&
    normalizedHdrPresentation.webgpuHdrWhiteEnd === 7.01,
  'HDR 展示配置钳制范围并维持有效白核阈值顺序',
);

const configuredHdrPresentation = createConfig(
  {
    webgpuHdrPeak: 2.5,
    webgpuHdrBrightness: 12,
    webgpuHdrColorPreservation: 0.75,
    webgpuHdrWhiteCore: 0.75,
    webgpuHdrWhiteStart: 0.5,
    webgpuHdrWhiteEnd: 4,
  },
);
check(
  configuredHdrPresentation.webgpuHdrPeak === 2.5 &&
    configuredHdrPresentation.webgpuHdrBrightness === 12 &&
    configuredHdrPresentation.webgpuHdrColorPreservation === 0.75 &&
    configuredHdrPresentation.webgpuHdrWhiteCore === 0.75 &&
    configuredHdrPresentation.webgpuHdrWhiteStart === 0.5 &&
    configuredHdrPresentation.webgpuHdrWhiteEnd === 4,
  '构造配置保留合法 HDR 校准值',
);
assertConfigError(
  () => createConfig({ webgpuHdrPeak: '4' }),
  '构造配置拒绝错误类型的 HDR 峰值',
);
assertConfigError(
  () => createConfig({ webgpuHdrWhiteStart: 4, webgpuHdrWhiteEnd: 4 }),
  '构造配置拒绝无效的 HDR 白核阈值顺序',
);

console.log('\n透明合成配置合同');
check(
  CONFIG.overlayAlphaPolicy === 'coverage' &&
    CONFIG.overlayColorCompensation === 'none' &&
    CONFIG.overlayAlphaLimit === 250 / 255 &&
    CONFIG.hostCompositing === 'source-over' &&
    CONFIG.hostCompositingSurface === 'dom-backdrop',
  '透明合成配置默认使用 Coverage、source-over 与 DOM 背景表面',
);
check(
  CONFIG.bloomBackend === 'webgl2' &&
    !Object.hasOwn(CONFIG, 'softwareBloomEnabled') &&
    !Object.hasOwn(createConfig({ bloomBackend: 'software' }), 'softwareBloomEnabled'),
  'Software Bloom 兼容布尔字段已从配置快照删除',
);
check(
  isOverlayAlphaPolicy('coverage') &&
    isOverlayAlphaPolicy('visual-max') &&
    !isOverlayAlphaPolicy('maxRGB') &&
    normalizeOverlayAlphaPolicyConfig('invalid') === 'coverage',
  'Alpha 策略只接受 coverage 与 visual-max',
);
check(
  isOverlayColorCompensation('none') &&
    isOverlayColorCompensation('bright-core') &&
    !isOverlayColorCompensation('bright') &&
    normalizeOverlayColorCompensationConfig('invalid') === 'none',
  '颜色补偿只接受 none 与 bright-core',
);
check(
  isHostCompositing('source-over') &&
    isHostCompositing('screen') &&
    isHostCompositing('plus-lighter') &&
    !isHostCompositing('overlay') &&
    normalizeHostCompositing('invalid') === 'source-over',
  '宿主合成只接受 source-over、screen 与 plus-lighter',
);
check(
  isHostCompositingSurface('dom-backdrop') &&
    isHostCompositingSurface('transparent-window') &&
    isHostCompositingSurface('native') &&
    !isHostCompositingSurface('webview') &&
    normalizeHostCompositingSurface('invalid') === 'dom-backdrop',
  '宿主表面只接受 DOM 背景、透明窗口与原生合成器',
);
check(
  !isIndependentHostCompositing('source-over') &&
    isIndependentHostCompositing('screen') &&
    isIndependentHostCompositing('plus-lighter'),
  'screen 与 plus-lighter 共享独立完整载荷合同',
);
check(
  isOverlayAlphaLimit(0) &&
    isOverlayAlphaLimit(1) &&
    !isOverlayAlphaLimit(-0.01) &&
    !isOverlayAlphaLimit(1.01) &&
    !isOverlayAlphaLimit(Number.NaN),
  '覆盖层 Alpha 合法性限制为有限的 0..1',
);
check(
  normalizeOverlayAlphaLimit(-1) === 0 &&
    normalizeOverlayAlphaLimit(2) === 1 &&
    normalizeOverlayAlphaLimit(0.5) === 0.5 &&
    normalizeOverlayAlphaLimit(Number.POSITIVE_INFINITY) === 250 / 255 &&
    normalizeOverlayAlphaLimit(Number.NaN, 2) === 1,
  '覆盖层 Alpha 钳制有限值并让非有限值恢复默认值',
);

const transparentCompositingConfig = createConfig(
  {
    overlayAlphaPolicy: 'visual-max',
    overlayColorCompensation: 'bright-core',
    overlayAlphaLimit: 0.8,
    hostCompositing: 'screen',
    hostCompositingSurface: 'native',
  },
);
check(
  transparentCompositingConfig.overlayAlphaPolicy === 'visual-max' &&
    transparentCompositingConfig.overlayColorCompensation === 'bright-core' &&
    transparentCompositingConfig.overlayAlphaLimit === 0.8 &&
    transparentCompositingConfig.hostCompositing === 'screen' &&
    transparentCompositingConfig.hostCompositingSurface === 'native',
  '构造配置保留合法透明合成选项',
);
assertConfigError(
  () => createConfig({ overlayColorCompensation: 'bright' }),
  '构造配置拒绝非法颜色补偿策略',
);
assertConfigError(
  () => createConfig({ overlayAlphaLimit: 2 }),
  '构造配置拒绝越界覆盖层 Alpha',
);
assertConfigError(
  () => createConfig({ hostCompositing: 'overlay' }),
  '构造配置拒绝非法宿主合成模式',
);
assertConfigError(
  () => createConfig({ hostCompositingSurface: 'webview' }),
  '构造配置拒绝非法宿主表面',
);

const domScreenResolution = resolveHostCompositing(
  {
    outputCompositing: 'browser-overlay',
    requestedHostCompositing: 'screen',
    hostCompositingSurface: 'dom-backdrop',
  },
);
const nativeAddResolution = resolveHostCompositing(
  {
    outputCompositing: 'browser-overlay',
    requestedHostCompositing: 'plus-lighter',
    hostCompositingSurface: 'native',
  },
);
const transparentScreenResolution = resolveHostCompositing(
  {
    outputCompositing: 'browser-overlay',
    requestedHostCompositing: 'screen',
    hostCompositingSurface: 'transparent-window',
  },
);
const transparentAddResolution = resolveHostCompositing(
  {
    outputCompositing: 'browser-overlay',
    requestedHostCompositing: 'plus-lighter',
    hostCompositingSurface: 'transparent-window',
  },
);

check(
  domScreenResolution.resolvedHostCompositing === 'screen' &&
    domScreenResolution.compositingWarning === null &&
    nativeAddResolution.resolvedHostCompositing === 'plus-lighter' &&
    nativeAddResolution.compositingWarning === null,
  'DOM 背景与原生合成器保留独立 Screen/Add 载荷',
);
check(
  transparentScreenResolution.resolvedHostCompositing === 'source-over' &&
    transparentScreenResolution.compositingWarning ===
      'screen-requires-visible-backdrop' &&
    transparentAddResolution.resolvedHostCompositing === 'source-over' &&
    transparentAddResolution.compositingWarning ===
      'plus-lighter-requires-visible-backdrop',
  '透明窗口自动回退 source-over 并报告缺少可见背景',
);
check(
  resolveHostCompositing(
    {
      outputCompositing: 'scene',
      requestedHostCompositing: 'screen',
      hostCompositingSurface: 'transparent-window',
    },
  ).compositingWarning === null &&
    resolveHostCompositing(
      {
        outputCompositing: 'browser-overlay',
        requestedHostCompositing: 'plus-lighter',
        hostCompositingSurface: 'transparent-window',
        hasCompositingReference: true,
      },
    ).compositingWarning === null,
  'Scene 与活动合成参考直接解析为 source-over 且不产生误导警告',
);

assertConfigError(
  () => createConfig({ unknownBackgroundAppearance: 'bright' }),
  '构造配置拒绝已删除或拼写错误的未知字段',
);

console.log(`\n参数 Schema 测试完成：${passed} 项通过。`);
