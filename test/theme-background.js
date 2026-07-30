/**
 * 内置主题场景背景契约。
 *
 * CSS 预览与 WebGL 栅格源必须使用相同的渐变定义，否则 Scene 合成会把
 * 页面上显示的背景当作未知背景，重新引入亮度偏差。
 */

import assert from 'node:assert/strict';
import {
  getThemeBackgroundCss,
  renderThemeSceneBackground,
} from '../src/theme-background.js';

let passed = 0;

function check(condition, message)
{
  assert.ok(condition, message);
  passed++;
  console.log('  ✓ ' + message);
}

function checkEqual(actual, expected, message)
{
  assert.equal(actual, expected, message);
  passed++;
  console.log('  ✓ ' + message);
}

function checkClose(actual, expected, message)
{
  assert.ok(Math.abs(actual - expected) < 1e-9, message);
  passed++;
  console.log('  ✓ ' + message);
}

class GradientMock
{
  constructor(args)
  {
    this.args = args;
    this.stops = [];
  }

  addColorStop(offset, color)
  {
    this.stops.push([offset, color]);
  }
}

class ContextMock
{
  constructor()
  {
    this.gradients = [];
    this.fillStyle = null;
    this.fillRects = [];
  }

  createRadialGradient(...args)
  {
    const gradient = new GradientMock(args);
    this.gradients.push(gradient);
    return gradient;
  }

  fillRect(...args)
  {
    this.fillRects.push(args);
  }
}

class CanvasMock
{
  constructor(context = new ContextMock())
  {
    this.width = 0;
    this.height = 0;
    this.context = context;
  }

  getContext(type)
  {
    return type === '2d' ? this.context : null;
  }
}

console.log('\n内置主题 CSS 定义');
const expectedCss =
{
  '蔚蓝': 'radial-gradient(circle at 30% 20%, #1d3558 0%, #101827 45%, #080d16 100%)',
  '深紫': 'radial-gradient(circle at 30% 20%, #2d1b4e 0%, #1a1028 45%, #0d0616 100%)',
  '深绿': 'radial-gradient(circle at 30% 20%, #1a3d2a 0%, #0f1a14 45%, #080d0a 100%)',
  '暖金': 'radial-gradient(circle at 30% 20%, #3d2a1a 0%, #1f1910 45%, #14100a 100%)',
  '纯黑': '#000000',
  '纯白': '#ffffff',
};

for (const [name, expected] of Object.entries(expectedCss))
{
  checkEqual(getThemeBackgroundCss(name), expected, name + ' 保持既有 CSS 外观');
}

checkEqual(getThemeBackgroundCss('不存在'), null, '未知主题不生成 CSS 背景');
checkEqual(getThemeBackgroundCss(null), null, '非字符串主题不生成 CSS 背景');

console.log('\n径向主题栅格化');
const radialCanvas = new CanvasMock();
check(
  renderThemeSceneBackground(radialCanvas, '蔚蓝', 160, 90, 1.5),
  '径向主题可渲染为场景纹理',
);
checkEqual(radialCanvas.width, 240, '径向主题按 DPR 计算纹理宽度');
checkEqual(radialCanvas.height, 135, '径向主题按 DPR 计算纹理高度');
checkEqual(radialCanvas.context.gradients.length, 1, '径向主题创建一个径向渐变');

const [gradient] = radialCanvas.context.gradients;
const [centerX, centerY, innerRadius, outerCenterX, outerCenterY, radius] = gradient.args;
const expectedRadius = Math.hypot(168, 108);
checkClose(centerX, 72, '径向主题中心 X 与 CSS 百分比一致');
checkClose(centerY, 27, '径向主题中心 Y 与 CSS 百分比一致');
checkEqual(innerRadius, 0, '径向主题从中心开始');
checkClose(outerCenterX, centerX, '径向主题两个圆心保持一致');
checkClose(outerCenterY, centerY, '径向主题两个圆心保持一致');
checkClose(radius, expectedRadius, '径向主题使用 CSS farthest-corner 半径');
assert.deepEqual(
  gradient.stops,
  [
    [0, '#1d3558'],
    [0.45, '#101827'],
    [1, '#080d16'],
  ],
);
passed++;
console.log('  ✓ 径向主题保持三个原始色标');
assert.deepEqual(radialCanvas.context.fillRects, [[0, 0, 240, 135]]);
passed++;
console.log('  ✓ 径向主题填充完整场景纹理');

console.log('\n纯色主题与边界条件');
const solidCanvas = new CanvasMock();
check(
  renderThemeSceneBackground(solidCanvas, '纯白', 64, 48, 3),
  '纯白主题可渲染为场景纹理',
);
checkEqual(solidCanvas.width, 128, '纹理 DPR 上限为 2');
checkEqual(solidCanvas.height, 96, '纹理 DPR 上限同步影响高度');
checkEqual(solidCanvas.context.fillStyle, '#ffffff', '纯白主题使用原始纯色');
assert.deepEqual(solidCanvas.context.fillRects, [[0, 0, 128, 96]]);
passed++;
console.log('  ✓ 纯色主题填充完整场景纹理');

check(
  !renderThemeSceneBackground(new CanvasMock(), '不存在', 64, 48),
  '未知主题不会生成错误纹理',
);
check(
  !renderThemeSceneBackground(new CanvasMock(), '蔚蓝', 0, 48),
  '零宽度不会生成错误纹理',
);
check(
  !renderThemeSceneBackground(new CanvasMock(), '蔚蓝', 64, Number.NaN),
  '非有限高度不会生成错误纹理',
);
check(
  !renderThemeSceneBackground({ width: 0, height: 0 }, '蔚蓝', 64, 48),
  '无 2D 上下文时安全失败',
);

console.log('\n主题背景测试完成：' + passed + ' 项通过。');
