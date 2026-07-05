import { CONFIG } from './config.js';
import { rgbToCss } from './utils.js';

/**
 * 绘制发光实心圆（含多层伪发光 + 可选 shadowBlur）
 * @param {CanvasRenderingContext2D} context
 * @param {number} x - 圆心 X
 * @param {number} y - 圆心 Y
 * @param {number} r - 半径
 * @param {number[]} color - [r, g, b] 主题色
 * @param {number} alpha - 基础透明度
 * @param {number} [blur=0] - 光晕扩散量
 */
export function drawCircle(context, x, y, r, color, alpha, blur = 0) {
  if (alpha <= 0 || r <= 0) {
    return;
  }

  context.save();

  if (CONFIG.glow.fake && blur > 0) {
    context.fillStyle = rgbToCss(color, alpha * 0.12);
    context.beginPath();
    context.arc(x, y, r + blur * 1.2, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = rgbToCss(color, alpha * 0.16);
    context.beginPath();
    context.arc(x, y, r + blur * 0.55, 0, Math.PI * 2);
    context.fill();
  }

  if (CONFIG.glow.enabled && blur > 0) {
    context.shadowColor = rgbToCss(color, alpha);
    context.shadowBlur = blur * 0.28;
  }

  context.fillStyle = rgbToCss(color, alpha);
  context.beginPath();
  context.arc(x, y, r, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

/**
 * 绘制带旋转的三角形粒子
 * @param {CanvasRenderingContext2D} context
 * @param {number} x - 中心 X
 * @param {number} y - 中心 Y
 * @param {number} size - 三角形尺寸
 * @param {number} rotation - 旋转弧度
 * @param {number[]} color - [r, g, b]
 * @param {number} alpha - 透明度
 * @param {number} [blur=0]
 * @param {boolean} useFakeGlow - 是否叠加伪发光层
 */
export function drawTriangle(
  context,
  x,
  y,
  size,
  rotation,
  color,
  alpha,
  blur = 0,
  useFakeGlow,
)
{
  if (alpha <= 0) {
    return;
  }

  context.save();
  context.translate(x, y);
  context.rotate(rotation);

  if (useFakeGlow && CONFIG.glow.fake) {
    context.fillStyle = rgbToCss(color, alpha * 0.18);
    context.beginPath();
    context.moveTo(0, -size * 1.55);
    context.lineTo(size * 0.95, size * 0.9);
    context.lineTo(-size * 0.95, size * 0.9);
    context.closePath();
    context.fill();
  }

  if (CONFIG.glow.enabled && blur > 0) {
    context.shadowColor = rgbToCss(color, alpha);
    context.shadowBlur = blur * 0.28;
  }

  const sideX = useFakeGlow ? 0.62 : 0.6;
  const sideY = useFakeGlow ? 0.58 : 0.6;

  context.fillStyle = rgbToCss(color, alpha);
  context.beginPath();
  context.moveTo(0, -size);
  context.lineTo(size * sideX, size * sideY);
  context.lineTo(-size * sideX, size * sideY);
  context.closePath();
  context.fill();

  context.restore();
}

// BASpark 的点击圆环是单层线条；多层 fake glow 会让点击反馈显得发糊。
/**
 * 绘制弧线段（单层线条，不带发光效果）
 * @param {CanvasRenderingContext2D} context
 * @param {number} x - 圆心 X
 * @param {number} y - 圆心 Y
 * @param {number} radius - 半径
 * @param {number} start - 起始弧度
 * @param {number} end - 结束弧度
 * @param {number} widthValue - 线宽
 * @param {number[]} color - [r, g, b]
 * @param {number} alpha - 透明度
 */
export function drawArcSegment(
  context,
  x,
  y,
  radius,
  start,
  end,
  widthValue,
  color,
  alpha,
)
{
  if (alpha <= 0 || widthValue <= 0 || Math.abs(end - start) < 0.001) {
    return;
  }

  context.save();

  context.lineCap = 'butt';
  context.strokeStyle = rgbToCss(color, alpha);
  context.lineWidth = widthValue;

  context.beginPath();
  context.arc(x, y, radius, start, end);
  context.stroke();

  context.restore();
}
