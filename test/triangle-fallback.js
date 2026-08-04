import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traceRoundedTrianglePath } from '../src/triangle-path.js';

const EPSILON = 0.000001;
const FRAME =
[
  [0, -0.45703125],
  [0.48046875, 0.36328125],
  [-0.48046875, 0.36328125],
];

class PathContext
{
  constructor()
  {
    this.commands = [];
  }

  moveTo(x, y)
  {
    this.commands.push({ kind: 'move', x, y });
  }

  lineTo(x, y)
  {
    this.commands.push({ kind: 'line', x, y });
  }

  arc(x, y, radius, start, end, anticlockwise)
  {
    this.commands.push(
      { kind: 'arc', x, y, radius, start, end, anticlockwise },
    );
  }

  closePath()
  {
    this.commands.push({ kind: 'close' });
  }
}

function near(left, right)
{
  return Math.abs(left - right) <= EPSILON;
}

function pointOnArc(arc, angle)
{
  return [
    arc.x + Math.cos(angle) * arc.radius,
    arc.y + Math.sin(angle) * arc.radius,
  ];
}

console.log('\nCanvas 三角纹理失败回退');

const sharp = new PathContext();

traceRoundedTrianglePath(sharp, FRAME, 100, 0);
assert.deepEqual(
  sharp.commands,
  [
    { kind: 'move', x: 0, y: -45.703125 },
    { kind: 'line', x: 48.046875, y: 36.328125 },
    { kind: 'line', x: -48.046875, y: 36.328125 },
    { kind: 'close' },
  ],
  'roundness=0 必须精确保留旧三角路径',
);

const rounded = new PathContext();

traceRoundedTrianglePath(rounded, FRAME, 100, 0.5);
const roundedArcs = rounded.commands.filter(({ kind }) => kind === 'arc');
const roundedLines = rounded.commands.filter(({ kind }) => kind === 'line');

assert.equal(roundedArcs.length, 3, '中间比例必须保留三个独立圆角');
assert.equal(roundedLines.length, 3, '中间比例必须保留三条直边');
assert.ok(
  roundedArcs.every((arc) => near(arc.radius, 25)),
  '圆角半径必须随比例连续增长',
);

for (let index = 0; index < roundedArcs.length; index++)
{
  const arc = roundedArcs[index];
  const line = roundedLines[index];
  const nextArc = roundedArcs[(index + 1) % roundedArcs.length];
  const arcEnd = pointOnArc(arc, arc.end);
  const nextArcStart = pointOnArc(nextArc, nextArc.start);
  const lineDirection = [line.x - arcEnd[0], line.y - arcEnd[1]];
  const arcRadius = [arcEnd[0] - arc.x, arcEnd[1] - arc.y];

  assert.ok(
    near(line.x, nextArcStart[0]) && near(line.y, nextArcStart[1]),
    `第 ${index + 1} 条直边必须无缝接入下一个圆角`,
  );
  assert.ok(
    Math.hypot(...lineDirection) > 1 &&
      near(
        lineDirection[0] * arcRadius[0] +
          lineDirection[1] * arcRadius[1],
        0,
      ),
    `第 ${index + 1} 条直边必须与圆角相切`,
  );
}

const circle = new PathContext();

traceRoundedTrianglePath(circle, FRAME, 100, 1);
assert.deepEqual(
  circle.commands,
  [
    {
      kind: 'arc',
      x: 0,
      y: 0,
      radius: 50,
      start: 0,
      end: Math.PI * 2,
      anticlockwise: false,
    },
    { kind: 'close' },
  ],
  'roundness=1 必须退化为同尺寸圆形',
);

const fxSource = readFileSync(new URL('../src/fx.js', import.meta.url), 'utf8');
const fallbackCallCount = [
  ...fxSource.matchAll(/\btraceRoundedTrianglePath\(/g),
].length;

assert.equal(
  fallbackCallCount,
  3,
  '主绘制、Coverage 与发射三处纹理失败回退必须共享圆角路径',
);

console.log('  ✓ 0 保留原三角，0..1 使用相切圆角，1 形成圆形');
console.log('  ✓ 三处 Canvas fallback 已统一接入');
