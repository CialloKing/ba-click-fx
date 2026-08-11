// Theme colors are authored as ordinary sRGB, while the effect itself keeps
// Unity's relative color relationships. OKLCH lets us change those perceptual
// relationships before HDR emission and Bloom are applied.

import { DEFAULT_THEME_COLOR } from './config.js';

// Keep the focused color helper convenient to test without creating a second
// source of truth for the public default.
export { DEFAULT_THEME_COLOR };

const ACHROMATIC_EPSILON = 1e-5;
const BLACK_EPSILON = 1e-7;
const GAMUT_EPSILON = 1e-7;
const GAMUT_SEARCH_STEPS = 28;
const FULL_TURN = Math.PI * 2;

function clamp01(value)
{
  return Math.max(0, Math.min(1, value));
}

function decodeSrgbChannel(channel)
{
  if (channel <= 0.04045)
  {
    return channel / 12.92;
  }

  return ((channel + 0.055) / 1.055) ** 2.4;
}

function encodeSrgbChannel(channel)
{
  if (channel <= 0.0031308)
  {
    return channel * 12.92;
  }

  return 1.055 * channel ** (1 / 2.4) - 0.055;
}

function parseThemeColor(themeColor)
{
  if (typeof themeColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(themeColor))
  {
    throw new TypeError('themeColor 必须是 #rrggbb 格式的 sRGB 颜色');
  }

  return [
    Number.parseInt(themeColor.slice(1, 3), 16),
    Number.parseInt(themeColor.slice(3, 5), 16),
    Number.parseInt(themeColor.slice(5, 7), 16),
  ];
}

function validateSrgb255(rgb)
{
  if (!Array.isArray(rgb) || rgb.length !== 3)
  {
    throw new TypeError('rgb 必须是包含三个通道的数组');
  }

  for (let index = 0; index < 3; index++)
  {
    if (!Number.isFinite(rgb[index]) || rgb[index] < 0 || rgb[index] > 255)
    {
      throw new RangeError('rgb 通道必须是 0 到 255 之间的有限数值');
    }
  }
}

function linearSrgbToOklab(rgb)
{
  const [red, green, blue] = rgb;
  const l = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  );
  const m = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  );
  const s = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  );

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearSrgb(oklab)
{
  const [lightness, a, b] = oklab;
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function srgb255ToOklch(rgb)
{
  const linear = rgb.map((channel) => decodeSrgbChannel(channel / 255));
  const [lightness, a, b] = linearSrgbToOklab(linear);
  const chroma = Math.hypot(a, b);
  const hue = chroma <= ACHROMATIC_EPSILON
    ? 0
    : Math.atan2(b, a);

  return [lightness, chroma, hue];
}

function normalizeHue(hue)
{
  return hue - Math.floor(hue / FULL_TURN) * FULL_TURN;
}

function oklchToLinearSrgb(lightness, chroma, hue)
{
  return oklabToLinearSrgb(
    [
      lightness,
      chroma * Math.cos(hue),
      chroma * Math.sin(hue),
    ],
  );
}

function isInSrgbGamut(linear)
{
  return linear.every((channel) =>
    Number.isFinite(channel)
      && channel >= -GAMUT_EPSILON
      && channel <= 1 + GAMUT_EPSILON);
}

/**
 * 保持感知明度与色相，只降低色度进入 sRGB；直接裁剪 RGB 会改变色相。
 */
function gamutMapOklch(lightness, chroma, hue)
{
  let mappedChroma = Math.max(0, chroma);
  let linear = oklchToLinearSrgb(lightness, mappedChroma, hue);

  if (!isInSrgbGamut(linear))
  {
    let lower = 0;
    let upper = mappedChroma;

    for (let index = 0; index < GAMUT_SEARCH_STEPS; index++)
    {
      const candidate = (lower + upper) / 2;
      const candidateLinear = oklchToLinearSrgb(lightness, candidate, hue);

      if (isInSrgbGamut(candidateLinear))
      {
        lower = candidate;
      }
      else
      {
        upper = candidate;
      }
    }

    mappedChroma = lower;
    linear = oklchToLinearSrgb(lightness, mappedChroma, hue);
  }

  // 保留子 8-bit 的低能量；Canvas/CSS 等最终输出边界会自行量化，
  // 这里提前 round 会让 #000001 一类主题在进入 HDR/Bloom 前直接断成零。
  return linear.map((channel) =>
    clamp01(encodeSrgbChannel(clamp01(channel))) * 255);
}

const BASE_OKLCH = srgb255ToOklch(parseThemeColor(DEFAULT_THEME_COLOR));

/**
 * 将取色器颜色预计算为可复用的相对 OKLCH 映射。
 * 返回值可跨一帧内所有粒子颜色共享，避免重复解析主题颜色。
 */
export function createRelativeOklchTheme(themeColor = DEFAULT_THEME_COLOR)
{
  const targetRgb = parseThemeColor(themeColor);
  const canonicalColor = themeColor.toLowerCase();
  const [targetLightness, targetChroma, targetHue] = srgb255ToOklch(targetRgb);
  const targetIsAchromatic = targetChroma <= ACHROMATIC_EPSILON;

  return Object.freeze(
    {
      color: canonicalColor,
      identity: canonicalColor === DEFAULT_THEME_COLOR,
      invisible: targetLightness <= BLACK_EPSILON,
      // relative-oklch 的透明传输必须随主题峰值连续收敛到零，否则
      // #000000 -> #000001 会从空帧跳回完整 Coverage，在白底形成暗遮罩。
      // 该比例只限制未知背景的 source-over Alpha，不缩放 Scene/HDR 发射。
      coverageScale: Math.max(...targetRgb) / 255,
      targetLightness,
      chromaScale: targetIsAchromatic
        ? 0
        : targetChroma / BASE_OKLCH[1],
      hueShift: targetIsAchromatic
        ? 0
        : normalizeHue(targetHue - BASE_OKLCH[2]),
    },
  );
}

function mapRelativeLightness(sourceLightness, targetLightness)
{
  if (
    targetLightness <= BASE_OKLCH[0] ||
    sourceLightness <= BASE_OKLCH[0]
  )
  {
    return sourceLightness * targetLightness / BASE_OKLCH[0];
  }

  // 亮主题分别锚定基准色和白色，避免高光被简单乘法推到 1 后夹平；
  // 低于基准的颜色仍从黑点线性映射，不能无中生有抬起近黑能量。
  return targetLightness +
    (sourceLightness - BASE_OKLCH[0]) *
      (1 - targetLightness) /
      (1 - BASE_OKLCH[0]);
}

/**
 * 将一个 0..255 sRGB 颜色映射到主题色，返回同范围的整数 sRGB。
 * 默认主题走严格恒等路径，保证既有 Unity 默认画面不发生舍入漂移。
 */
export function applyRelativeOklchTheme(rgb, theme)
{
  validateSrgb255(rgb);

  if (!theme || typeof theme !== 'object')
  {
    throw new TypeError('theme 必须由 createRelativeOklchTheme 创建');
  }

  if (theme.identity)
  {
    return rgb;
  }

  if (theme.invisible)
  {
    return [0, 0, 0];
  }

  const [sourceLightness, sourceChroma, sourceHue] = srgb255ToOklch(rgb);

  // 黑色在加色管线中代表零能量；亮主题也不能凭空把它变成可见灰色。
  if (sourceLightness <= BLACK_EPSILON)
  {
    return [0, 0, 0];
  }

  const lightness = mapRelativeLightness(
    sourceLightness,
    theme.targetLightness,
  );
  const chroma = sourceChroma <= ACHROMATIC_EPSILON
    ? 0
    : sourceChroma * theme.chromaScale;
  const hue = normalizeHue(sourceHue + theme.hueShift);

  return gamutMapOklch(lightness, chroma, hue);
}
