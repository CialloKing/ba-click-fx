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
 * 将输入转换为有限数字；无效输入回退到调用方声明的稳定默认值。
 * Number(null) 仍为 0，以保持现有公开 API 对可转换值的兼容行为。
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function toFiniteNumber(value, fallback)
{
  try
  {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
  }
  catch
  {
    // Symbol 和自定义 valueOf 可能拒绝数字转换；公开 setter 必须安全回退。
    return fallback;
  }
}

/**
 * 将有限数字钳制到闭区间；集中处理 NaN 与 Infinity，避免污染运行时配置。
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
export function clampNumber(value, min, max, fallback)
{
  return Math.max(min, Math.min(max, toFiniteNumber(value, fallback)));
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
const _rgbCache = new Map();
const _RGB_CACHE_MAX = 64;
export function rgbToCss(rgb, alpha = 1)
{
  // 万分位可保留柔光外缘的低透明度，同时确保缓存键和值使用同一精度。
  const alphaStep = Math.round(clamp01(alpha) * 10000);
  const a = alphaStep / 10000;
  const key = ((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) * 10000 + alphaStep;
  const cached = _rgbCache.get(key);

  if (cached !== undefined)
  {
    return cached;
  }

  const value = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`;
  if (_rgbCache.size >= _RGB_CACHE_MAX)
  {
    _rgbCache.delete(_rgbCache.keys().next().value);
  }
  _rgbCache.set(key, value);
  return value;
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
 * RGB [r, g, b] → "#rrggbb" 十六进制字符串
 */
export function rgbToHex(r, g, b)
{
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

/**
 * "#rrggbb" 十六进制字符串 → [r, g, b]
 */
export function hexToRgb(hex)
{
  const n = parseInt(hex.slice(1), 16);

  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
