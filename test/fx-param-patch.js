/**
 * Schema 驱动参数补丁的纯逻辑测试。
 *
 * 测试不创建 BAClickFX，确保宿主可以在没有 DOM/WebGL 的环境先验证配置。
 */

import assert from 'node:assert/strict';
import { UNITY_FX_TOUCH } from '../src/config.js';
import { applyFxParamPatch } from '../src/fx-param-patch.js';

let passed = 0;

function check(condition, message)
{
  assert.ok(condition, message);
  passed++;
  console.log(`  ✓ ${message}`);
}

function createBaseline()
{
  return structuredClone(UNITY_FX_TOUCH);
}

console.log('\n基础应用与 Schema 数值语义');

const baseline = createBaseline();
const baselineSnapshot = structuredClone(baseline);
const basicResult = applyFxParamPatch(
  {
    'rings.arcSamples': 95.25,
    'bloom.intensity': 20,
    'disk.radius': -5,
  },
  { baseline },
);

assert.deepEqual(
  basicResult.applied,
  [
    { path: 'disk.radius', value: 1 },
    { path: 'rings.arcSamples', value: 95.25 },
    { path: 'bloom.intensity', value: 10 },
  ],
);
assert.deepEqual(
  basicResult.normalized,
  [
    { path: 'disk.radius', from: -5, to: 1, reason: 'clamped' },
    { path: 'bloom.intensity', from: 20, to: 10, reason: 'clamped' },
  ],
);
assert.equal(basicResult.committed, true);
assert.equal(basicResult.schemaVersion, 2);
assert.equal(basicResult.nextConfig.disk.radius, 1);
assert.equal(basicResult.nextConfig.rings.arcSamples, 95.25);
assert.equal(basicResult.nextConfig.bloom.intensity, 10);
assert.deepEqual(baseline, baselineSnapshot);
check(true, '数值按 Schema 边界钳制且不按 step 量化');
check(true, '候选配置不会原地修改 baseline');

console.log('\n旧版本迁移与路径冲突');

for (const scatter of [0, 0.35, 1, 1.01, 7, Number.MAX_VALUE])
{
  const migrationResult = applyFxParamPatch(
    {
      'bloom.scatter': scatter,
    },
    {
      baseline,
      schemaVersion: 0,
    },
  );

  assert.deepEqual(
    migrationResult.applied,
    [{ path: 'bloom.diffusion', value: 7 }],
  );
  assert.deepEqual(
    migrationResult.normalized,
    [
      {
        path: 'bloom.scatter',
        from: 'bloom.scatter',
        to: 'bloom.diffusion',
        reason: 'renamed',
      },
      {
        path: 'bloom.diffusion',
        from: scatter,
        to: 7,
        reason: 'defaulted',
      },
    ],
  );
  assert.equal(migrationResult.nextConfig.bloom.diffusion, 7);
}
check(true, 'Schema 0 的 scatter 合法值都会恢复 diffusion 默认值');

const invalidScatterValues =
[
  ['0.35', 'invalid-type'],
  [Number.NaN, 'non-finite-number'],
  [Number.POSITIVE_INFINITY, 'non-finite-number'],
  [Number.NEGATIVE_INFINITY, 'non-finite-number'],
  [-0.01, 'out-of-range'],
];

for (const [scatter, expectedReason] of invalidScatterValues)
{
  const invalidMigrationResult = applyFxParamPatch(
    {
      'bloom.scatter': scatter,
      'rings.count': 2,
    },
    {
      baseline,
      schemaVersion: 0,
    },
  );

  assert.deepEqual(
    invalidMigrationResult.applied,
    [{ path: 'rings.count', value: 2 }],
  );
  assert.deepEqual(invalidMigrationResult.normalized, []);
  assert.equal(invalidMigrationResult.rejected.length, 1);
  assert.equal(invalidMigrationResult.rejected[0].path, 'bloom.scatter');
  assert.ok(Object.is(invalidMigrationResult.rejected[0].value, scatter));
  assert.equal(invalidMigrationResult.rejected[0].reason, expectedReason);
  assert.equal(invalidMigrationResult.nextConfig.rings.count, 2);
  assert.equal(invalidMigrationResult.nextConfig.bloom.diffusion, 7);
}
check(true, '非严格模式拒绝非法 scatter 源值并继续应用合法项');

for (const [scatter, expectedReason] of invalidScatterValues)
{
  const strictInvalidMigrationResult = applyFxParamPatch(
    {
      'bloom.scatter': scatter,
      'rings.count': 2,
    },
    {
      baseline,
      schemaVersion: 0,
      strict: true,
    },
  );

  assert.equal(strictInvalidMigrationResult.committed, false);
  assert.deepEqual(strictInvalidMigrationResult.applied, []);
  assert.deepEqual(strictInvalidMigrationResult.normalized, []);
  assert.deepEqual(strictInvalidMigrationResult.nextConfig, baseline);
  assert.equal(strictInvalidMigrationResult.rejected.length, 1);
  assert.equal(strictInvalidMigrationResult.rejected[0].path, 'bloom.scatter');
  assert.ok(Object.is(strictInvalidMigrationResult.rejected[0].value, scatter));
  assert.equal(strictInvalidMigrationResult.rejected[0].reason, expectedReason);
}
check(true, 'strict 模式遇到任一非法 scatter 源值时整批回滚');

const migrationConflictResult = applyFxParamPatch(
  {
    'bloom.scatter': 0.35,
    'bloom.diffusion': 7,
  },
  {
    baseline,
    schemaVersion: 0,
  },
);

assert.deepEqual(
  migrationConflictResult.applied,
  [{ path: 'bloom.diffusion', value: 7 }],
);
assert.equal(migrationConflictResult.rejected.length, 1);
assert.equal(migrationConflictResult.rejected[0].path, 'bloom.scatter');
assert.equal(migrationConflictResult.rejected[0].value, 0.35);
assert.equal(migrationConflictResult.rejected[0].reason, 'migration-conflict');
assert.equal(
  migrationConflictResult.rejected[0].targetPath,
  'bloom.diffusion',
);
check(true, '新旧路径同时存在时显式新路径优先');

const strictMigrationConflictResult = applyFxParamPatch(
  {
    'bloom.scatter': 0.35,
    'bloom.diffusion': 7,
  },
  {
    baseline,
    schemaVersion: 0,
    strict: true,
  },
);

assert.equal(strictMigrationConflictResult.committed, false);
assert.deepEqual(strictMigrationConflictResult.applied, []);
assert.deepEqual(strictMigrationConflictResult.nextConfig, baseline);
check(true, 'strict 模式会原子回滚新旧路径迁移冲突');

console.log('\n类型校验与非严格部分应用');

const typeResult = applyFxParamPatch(
  {
    'hit.enabled': 0,
    'flare.enabled': -2,
    'rings.count': '4',
    'bloom.threshold': Number.NaN,
    'unknown.value': 1,
  },
  { baseline },
);

assert.deepEqual(
  typeResult.applied,
  [
    { path: 'hit.enabled', value: false },
    { path: 'flare.enabled', value: true },
  ],
);
assert.deepEqual(
  typeResult.normalized,
  [
    { path: 'hit.enabled', from: 0, to: false, reason: 'boolean-coercion' },
    { path: 'flare.enabled', from: -2, to: true, reason: 'boolean-coercion' },
  ],
);
assert.deepEqual(
  typeResult.rejected.map((entry) => [entry.path, entry.reason]),
  [
    ['rings.count', 'invalid-type'],
    ['bloom.threshold', 'non-finite-number'],
    ['unknown.value', 'unknown-path'],
  ],
);
assert.equal(typeResult.nextConfig.hit.enabled, false);
assert.equal(typeResult.nextConfig.flare.enabled, true);
check(true, 'boolean 接受有限 number 并使用 JavaScript 真值语义');
check(true, '非严格模式只应用类型与路径合法的参数');

const booleanNanResult = applyFxParamPatch(
  {
    'hit.enabled': Number.NaN,
  },
  { baseline },
);

assert.equal(booleanNanResult.committed, false);
assert.equal(booleanNanResult.rejected[0].reason, 'non-finite-number');
check(true, 'boolean 拒绝非有限 number');

console.log('\n严格回滚与重置基线');

const strictResult = applyFxParamPatch(
  {
    'rings.count': 2,
    'rings.badParam': 1,
  },
  {
    baseline,
    strict: true,
  },
);

assert.equal(strictResult.committed, false);
assert.deepEqual(strictResult.applied, []);
assert.deepEqual(strictResult.nextConfig, baseline);
assert.notEqual(strictResult.nextConfig, baseline);
assert.notEqual(strictResult.nextConfig.rings, baseline.rings);
check(true, 'strict 任一拒绝会回滚整批并返回 baseline 深拷贝');

const resetBaseline = createBaseline();
resetBaseline.trail.width = 4;
resetBaseline.bloom.trailAlpha = 0;
const resetBaselineSnapshot = structuredClone(resetBaseline);
const resetResult = applyFxParamPatch(
  {
    'trail.trailOpacity': 0.375,
  },
  {
    baseline: basicResult.nextConfig,
    reset: true,
    resetBaseline,
  },
);

assert.equal(resetResult.committed, true);
assert.equal(resetResult.nextConfig.trail.width, 4);
assert.equal(resetResult.nextConfig.bloom.trailAlpha, 0);
assert.equal(resetResult.nextConfig.trail.trailOpacity, 0.375);
assert.deepEqual(resetBaseline, resetBaselineSnapshot);
assert.notEqual(resetResult.nextConfig, resetBaseline);
check(true, 'reset 从调用方基线构造候选且不原地修改该基线');

const strictResetResult = applyFxParamPatch(
  {
    'trail.notReal': 1,
  },
  {
    baseline,
    reset: true,
    resetBaseline,
    strict: true,
  },
);

assert.equal(strictResetResult.committed, false);
assert.deepEqual(strictResetResult.nextConfig, baseline);
check(true, 'strict reset 失败时回到当前 baseline 而非重置基线');

console.log('\n输入边界');

const invalidSchemaResult = applyFxParamPatch(
  {},
  {
    baseline,
    schemaVersion: 3,
  },
);

assert.equal(invalidSchemaResult.committed, false);
assert.equal(
  invalidSchemaResult.rejected[0].reason,
  'unsupported-schema-version',
);
check(true, '拒绝当前库无法解释的 Schema 版本');

const emptyResetResult = applyFxParamPatch(
  {},
  {
    baseline,
    reset: true,
    resetBaseline,
  },
);

assert.equal(emptyResetResult.committed, true);
assert.deepEqual(emptyResetResult.nextConfig, resetBaseline);
check(true, '空补丁仍可原子提交调用方提供的重置基线');

console.log(`\n参数补丁测试完成：${passed} 项通过。`);
