/**
 * 在离散滑块靠近常用值时返回可稳定命中的值。
 *
 * 滑块的有效轨道可能短于全部 step 数；允许一格误差可避免常用值恰好
 * 落在两个物理鼠标坐标之间。调用方决定何时启用，因此不会影响 API 精度。
 */
export function snapRangeValue(value, preferredValue, step)
{
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(preferredValue) ||
    !Number.isFinite(step) ||
    step <= 0
  )
  {
    return value;
  }

  // 十进制步距在二进制浮点数中可能略有误差；容差只补偿表示误差，
  // 不会把第二个相邻档位也纳入吸附范围。
  return Math.abs(value - preferredValue) <= step + Number.EPSILON
    ? preferredValue
    : value;
}
