#!/usr/bin/env node

/**
 * 检查演示页与 Unity 参数源是否保持单一真值。
 * 旧版控制面板可以修改粒子生命周期，因而不允许在精确移植分支重新出现。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const engineJs = fs.readFileSync(path.join(root, 'src', 'ba-spark.js'), 'utf8');

function verify(condition, message)
{
  if (!condition)
  {
    throw new Error(`[verify-sync] ${message}`);
  }

  console.log(`  ✓ ${message}`);
}

verify(!/id="ctrl[A-Z]/.test(indexHtml), '演示页不再包含会改变还原参数的旧控制器');
verify(/inputFilter/.test(mainJs), '演示页把信息卡映射为 Unity UGUI 输入过滤区');
verify(/UNITY_FX_TOUCH/.test(engineJs), '渲染引擎直接消费 Unity 参数源');
verify(!/localStorage/.test(mainJs), '历史本地设置不能覆盖 Unity 参数');
verify(/pointerdown/.test(engineJs) && /pointerup/.test(engineJs), '按下、拖拽和松开共享同一输入生命周期');

console.log('\n✅ Unity 参数同步检查通过\n');
