// ── 共享 HSL 转换 ──────────────────────────────────────────────────────

// ── 主题色偏移 ──────────────────────────────────────────────────────────
// 游戏中代表蓝色的关键色 (76,167,255)，hue≈212°；以此为基准计算偏移量。
// 模块级缓存，_renderFrame 前推入实例值，渲染后清空，保证多实例安全。

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
