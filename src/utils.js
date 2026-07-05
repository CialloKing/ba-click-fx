// 纯数学/图形工具函数，无外部依赖
export function clamp01(v) {
  if (!Number.isFinite(v)) {
    return 0;
  }

  return Math.max(0, Math.min(1, v));
}

export function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }

  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function rgbToCss(rgb, alpha = 1) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp01(alpha)})`;
}

export function mixColor(a, b, t) {
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
  ];
}

// 弧段宽度权重曲线：中间宽，两端窄
export function getArcWeight(t) {
  return Math.min(2 - Math.abs(4 * (t - 0.5)), 1);
}
