import { CONFIG } from './config.js';
import { rgbToCss } from './utils.js';

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
