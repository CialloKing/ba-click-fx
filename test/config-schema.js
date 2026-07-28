/**
 * 参数元数据契约测试。
 *
 * 测试只导入纯配置模块，宿主无需 DOM 或渲染器就能校验和迁移配置。
 */

import assert from 'node:assert/strict';
import {
  CONFIG,
  DEFAULT_THEME_COLOR,
  FX_PARAM_MIGRATIONS,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  UNITY_FX_TOUCH,
  createConfig,
  normalizeThemeColor,
} from '../src/config.js';

let passed = 0;

function check(condition, message)
{
  assert.ok(condition, message);
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
check(FX_PARAM_SCHEMA_VERSION === 1, 'Schema 版本固定为 1');
check(FX_PARAM_SCHEMA.length === 65, '保留 65 个公开标量参数');
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
  assert.equal(descriptor.modeDefaults.enhanced, descriptor.default);
  assert.equal(
    typeof descriptor.modeDefaults.legacy,
    descriptor.type,
    `${descriptor.path} Legacy 默认值类型`,
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
check(true, 'Bloom Threshold 与 Clamp 明确使用 Unity Gamma 空间配置语义');

console.log('\nLegacy 基线与版本迁移');
const legacyOverrides = FX_PARAM_SCHEMA.filter(
  (descriptor) =>
    descriptor.modeDefaults.legacy !== descriptor.modeDefaults.enhanced,
);

assert.deepEqual(
  legacyOverrides.map((descriptor) =>
    [descriptor.path, descriptor.modeDefaults.legacy]),
  [
    ['trail.width', 4],
    ['bloom.trailAlpha', 0],
  ],
);
check(true, 'Legacy 只声明实际改变的两项公开标量');

assert.deepEqual(
  FX_PARAM_MIGRATIONS,
  [
    {
      fromVersion: 0,
      toVersion: 1,
      changes:
      [
        {
          kind: 'rename',
          from: 'bloom.scatter',
          to: 'bloom.diffusion',
        },
      ],
    },
  ],
);
check(true, '0 -> 1 迁移将 bloom.scatter 重命名为 bloom.diffusion');

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
  createConfig({ themeColor: '#FF6969' }).themeColor === '#ff6969' &&
    createConfig({ themeColor: 'red' }).themeColor === DEFAULT_THEME_COLOR,
  '构造配置保存合法主题色并拒绝非十六进制颜色',
);

console.log(`\n参数 Schema 测试完成：${passed} 项通过。`);
