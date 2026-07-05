/**
 * 纯数学/图形工具函数 — 零外部依赖，可独立复用。
 * @module utils
 */

/**
 * 将值钳制到 [0, 1] 区间
 * @param {number} v
 * @returns {number}
 */
export function clamp01(v) {
  if (!Number.isFinite(v)) {
    return 0;
  }
  return Math.max(0, Math.min(1, v));
}

/**
 * [min, max) 区间随机浮点数
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function rand(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * 从数组中随机取一个元素
 * @template T
 * @param {T[]} list
 * @returns {T}
 */
export function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * easeOutCubic 缓动：t → 1-(1-t)³
 * @param {number} t - 归一化进度 [0, 1]
 * @returns {number}
 */
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * GLSL 风格 smoothstep：在 [edge0, edge1] 间平滑插值
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} x
 * @returns {number}
 */
export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/**
 * 两点间欧氏距离
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * 线性插值
 * @param {number} a
 * @param {number} b
 * @param {number} t - 插值因子 [0, 1]
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * RGB 数组 → CSS rgba 字符串
 * @param {number[]} rgb - [r, g, b]
 * @param {number} [alpha=1]
 * @returns {string} "rgba(r, g, b, a)"
 */
export function rgbToCss(rgb, alpha = 1) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp01(alpha)})`;
}

/**
 * 两 RGB 颜色按 t 混合
 * @param {number[]} a - [r, g, b]
 * @param {number[]} b - [r, g, b]
 * @param {number} t - 混合因子 [0, 1]，0=纯a，1=纯b
 * @returns {number[]} [r, g, b]
 */
export function mixColor(a, b, t) {
  return [
    Math.round(a[0] * (1 - t) + b[0] * t),
    Math.round(a[1] * (1 - t) + b[1] * t),
    Math.round(a[2] * (1 - t) + b[2] * t),
  ];
}

/**
 * 弧段宽度权重曲线：中间宽(t≈0.5)，两端窄(t≈0,1)
 * @param {number} t - 归一化位置 [0, 1]
 * @returns {number}
 */
export function getArcWeight(t) {
  return Math.min(2 - Math.abs(4 * (t - 0.5)), 1);
}
