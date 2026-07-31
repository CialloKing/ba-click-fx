/**
 * 展示页滑块吸附的纯逻辑测试。
 *
 * 此模块不依赖 DOM，确保窄轨道上的常用值修复不会改变精细范围本身。
 */

import assert from 'node:assert/strict';
import { snapRangeValue } from '../src/range-snap.js';

let passed = 0;

function check(actual, expected, message)
{
  assert.equal(actual, expected, message);
  passed++;
  console.log(`  ✓ ${message}`);
}

console.log('\n滑块常用值吸附');
check(snapRangeValue(0.99, 1, 0.01), 1, '下方相邻档位可吸附到默认倍率');
check(snapRangeValue(1.01, 1, 0.01), 1, '上方相邻档位可吸附到默认倍率');
check(snapRangeValue(0.98, 1, 0.01), 0.98, '吸附范围外的低倍率保持原值');
check(snapRangeValue(1.02, 1, 0.01), 1.02, '吸附范围外的高倍率保持原值');
check(snapRangeValue(1, 1, 0.01), 1, '目标倍率保持精确值');
check(snapRangeValue(Number.NaN, 1, 0.01), Number.NaN, '非有限输入不会被伪造为目标倍率');

console.log(`\n${passed} 项滑块吸附断言通过`);
