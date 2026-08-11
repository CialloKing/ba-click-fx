import assert from 'node:assert/strict';
import {
  DEFAULT_THEME_COLOR,
  applyRelativeOklchTheme,
  createRelativeOklchTheme,
} from '../src/theme-color.js';

let passed = 0;

function check(condition, message)
{
  assert.ok(condition, message);
  passed++;
  console.log('  ✓ ' + message);
}

function checkEqual(actual, expected, message)
{
  assert.deepEqual(actual, expected, message);
  passed++;
  console.log('  ✓ ' + message);
}

function checkRgbClose(actual, expected, epsilon, message)
{
  check(
    actual.every((channel, index) =>
      Math.abs(channel - expected[index]) <= epsilon),
    message,
  );
}

function perceivedLightness(rgb)
{
  const channel = (value) =>
  {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const red = channel(rgb[0]);
  const green = channel(rgb[1]);
  const blue = channel(rgb[2]);
  const l = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  );
  const m = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  );
  const s = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  );

  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

console.log('\n相对 OKLCH 默认契约');
const defaultTheme = createRelativeOklchTheme(DEFAULT_THEME_COLOR);
const original = [180.25, 220.5, 255];
check(defaultTheme.identity, '默认游戏蓝使用恒等快速路径');
check(!defaultTheme.invisible, '默认游戏蓝保持可见');
check(defaultTheme.coverageScale === 1, '默认游戏蓝保持完整 Coverage 上限');
check(
  applyRelativeOklchTheme(original, defaultTheme) === original,
  '默认主题严格返回原颜色且不发生舍入',
);
check(
  createRelativeOklchTheme('#4CA7FF').identity,
  '默认主题匹配不受十六进制大小写影响',
);
const redTheme = createRelativeOklchTheme('#ff0000');
check(
  Math.abs(redTheme.targetLightness - 0.6279553606) < 1e-9,
  'sRGB 红色转换为标准 OKLab 感知明度',
);

console.log('\n基准色映射');
const baseBlue = [76, 167, 255];
for (const target of ['#ff3b30', '#200002', '#d8f000', '#ffffff', '#808080'])
{
  const expected = [
    Number.parseInt(target.slice(1, 3), 16),
    Number.parseInt(target.slice(3, 5), 16),
    Number.parseInt(target.slice(5, 7), 16),
  ];
  checkRgbClose(
    applyRelativeOklchTheme(baseBlue, createRelativeOklchTheme(target)),
    expected,
    0.0001,
    '游戏基准蓝准确映射到 ' + target,
  );
}

console.log('\n主题明度与中性色');
const sourceBlue = [61, 100, 255];
const dark = applyRelativeOklchTheme(
  sourceBlue,
  createRelativeOklchTheme('#001020'),
);
const medium = applyRelativeOklchTheme(
  sourceBlue,
  createRelativeOklchTheme(DEFAULT_THEME_COLOR),
);
const light = applyRelativeOklchTheme(
  sourceBlue,
  createRelativeOklchTheme('#d8efff'),
);
check(
  perceivedLightness(dark) < perceivedLightness(medium),
  '暗主题降低源颜色的感知明度',
);
check(
  perceivedLightness(medium) < perceivedLightness(light),
  '亮主题提高源颜色的感知明度',
);

const grayResult = applyRelativeOklchTheme(
  sourceBlue,
  createRelativeOklchTheme('#808080'),
);
check(
  Math.max(...grayResult) - Math.min(...grayResult) < 0.000001,
  '灰色目标将彩色源颜色完全去色',
);

const darkWhite = applyRelativeOklchTheme(
  [255, 255, 255],
  createRelativeOklchTheme('#200002'),
);
check(
  Math.max(...darkWhite) - Math.min(...darkWhite) < 0.000001,
  '白色核心随主题变暗但保持中性',
);
checkRgbClose(
  applyRelativeOklchTheme(
    [255, 255, 255],
    createRelativeOklchTheme('#ffffff'),
  ),
  [255, 255, 255],
  0.0001,
  '白色主题将白色核心锚定在白色',
);
const brightNearBlack = applyRelativeOklchTheme(
  [1, 1, 1],
  createRelativeOklchTheme('#ffffff'),
);
check(
  Math.max(...brightNearBlack) < 10,
  '亮主题保持近黑能量靠近黑点而不会整体抬灰',
);

console.log('\n零能量与色域安全');
const blackTheme = createRelativeOklchTheme('#000000');
check(blackTheme.invisible, '纯黑主题显式报告 invisible');
check(blackTheme.coverageScale === 0, '纯黑主题的透明传输比例为零');
checkEqual(
  applyRelativeOklchTheme(sourceBlue, blackTheme),
  [0, 0, 0],
  '纯黑主题输出零能量',
);
checkEqual(
  applyRelativeOklchTheme([0, 0, 0], createRelativeOklchTheme('#ffff00')),
  [0, 0, 0],
  '亮主题不会把源零能量提升为可见颜色',
);

for (const target of ['#ff0000', '#00ff00', '#0000ff', '#ff00ff', '#00ffff'])
{
  const theme = createRelativeOklchTheme(target);

  for (const source of [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 255],
    [7, 19, 83],
  ])
  {
    const result = applyRelativeOklchTheme(source, theme);
    check(
      result.every((channel) =>
        Number.isFinite(channel) && channel >= 0 && channel <= 255),
      target + ' 的映射结果保持在有限 sRGB 色域内',
    );
  }
}

console.log('\n近黑主题连续性');
const oneBlueTheme = createRelativeOklchTheme('#000001');
const fiveGrayTheme = createRelativeOklchTheme('#050505');
const oneBlueOutput = applyRelativeOklchTheme(baseBlue, oneBlueTheme);
check(
  oneBlueOutput[2] > 0 && oneBlueOutput[2] <= 1.000001,
  '#000001 在最终量化前保留非零低能蓝色',
);
check(
  oneBlueTheme.coverageScale === 1 / 255 &&
    fiveGrayTheme.coverageScale === 5 / 255,
  '近黑主题 Coverage 上限按 sRGB 峰值逐级增长',
);
check(
  blackTheme.coverageScale < oneBlueTheme.coverageScale &&
    oneBlueTheme.coverageScale < fiveGrayTheme.coverageScale &&
    fiveGrayTheme.coverageScale < defaultTheme.coverageScale,
  '#000000、#000001、#050505 到默认蓝的透明传输保持单调',
);
check(
  createRelativeOklchTheme('#001020').coverageScale === 32 / 255 &&
    createRelativeOklchTheme('#200002').coverageScale === 32 / 255 &&
    createRelativeOklchTheme('#808080').coverageScale === 128 / 255,
  '暗色与中灰主题使用各自 sRGB 峰值限制未知背景 Coverage',
);

console.log('\n输入边界');
assert.throws(
  () => createRelativeOklchTheme('blue'),
  /#rrggbb/,
);
passed++;
console.log('  ✓ 非法主题颜色被拒绝');
assert.throws(
  () => createRelativeOklchTheme(null),
  /#rrggbb/,
);
passed++;
console.log('  ✓ 非字符串主题颜色被一致拒绝');
assert.throws(
  () => applyRelativeOklchTheme([256, 0, 0], defaultTheme),
  /0 到 255/,
);
passed++;
console.log('  ✓ 非法源 sRGB 被拒绝');

console.log('\n主题颜色测试完成：' + passed + ' 项通过。');
