// 渲染入口推入实例状态；退出时恢复外层值，保证多实例同步重入安全。

let themeHueShift = 0;

let relativeOklchTheme = null;

let gradientEnergyCache = null;

let ringSampleCache = null;

export {
  themeHueShift,
  relativeOklchTheme,
  gradientEnergyCache,
  ringSampleCache,
};

// 调用方保存四个旧值并在 finally 中恢复；普通帧不分配快照。
export function setRenderState(hue, theme, energy, rings)
{
  themeHueShift = hue;
  relativeOklchTheme = theme;
  gradientEnergyCache = energy;
  ringSampleCache = rings;
}
