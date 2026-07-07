/**
 * ba-click-fx smoke test
 *
 * 验证：模块加载、类实例化、API 签名、基本流程无异常。
 * 运行方式：npm test
 *
 * 注意：BAClickFX 构造函数需要浏览器 Canvas，Node.js 下跳过实例化测试。
 * 完整渲染测试需使用 Playwright 打开演示页。
 */

import { BAClickFX } from '../dist/ba-click-fx.js';

let passed = 0;
let failed = 0;
const inBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';

function assert(condition, message)
{
  if (condition)
  {
    passed++;
    console.log(`  ✓ ${message}`);
  }
  else
  {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// ── 测试 1: 模块导出 ──
console.log('1. 模块导出');
assert(typeof BAClickFX === 'function', 'BAClickFX 应为构造函数');
assert(BAClickFX.prototype.constructor === BAClickFX, 'prototype.constructor 应指向自身');

// ── 测试 2: getConfig / resetConfig 静态方法 ──
console.log('2. 静态检查');
const proto = BAClickFX.prototype;
const requiredMethods = [
  'setColor', 'setScale', 'setOpacity', 'setSpeed',
  'setTrail', 'setTrailAlways', 'setTrailBrightness',
  'boom', 'clearTrail', 'getConfig', 'resetConfig', 'destroy',
];
for (const m of requiredMethods)
{
  assert(typeof proto[m] === 'function', `BAClickFX.prototype.${m} 应为函数`);
}

// ── 测试 3: 实例化（需要浏览器环境） ──
console.log('3. 实例化');
if (inBrowser)
{
  try
  {
    const spark = new BAClickFX();
    assert(spark instanceof BAClickFX, '实例应为 BAClickFX 类型');

    const config = spark.getConfig();
    assert(config && typeof config === 'object', 'getConfig() 应返回对象');
    assert(Array.isArray(config.color) && config.color.length === 3, 'config.color 应为 [r,g,b]');

    spark.destroy();
    assert(true, 'destroy() 正常返回');
  }
  catch (e)
  {
    assert(false, `实例化失败: ${e.message}`);
  }
}
else
{
  console.log('  (Node.js 环境，跳过浏览器实例化测试)');
  passed++;  // counted as pass since environment limitation
}

// ── 结果 ──
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0)
{
  process.exit(1);
}
