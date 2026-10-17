import {
  rgbToHsl, hslToRgb, smoothstep, evaluateColor,
} from './engine-math.js';
import {
  clamp, clamp01,
} from './engine-shared.js';
import {
  applyRelativeOklchTheme,
} from './theme-color.js';
import {
  gammaToLinear, linearToSrgb, resolveUnityBloomClamp, resolveUnityBloomIntensity,
} from './bloom-color-space.js';
import {
  calculateBloomContribution,
} from './bloom-math.js';
import {
  compensateBrightCorePremultipliedRgb,
} from './overlay-compositing.js';
import {
  themeHueShift, relativeOklchTheme, gradientEnergyCache,
} from './engine-render-state.js';

const BASE_BLUE = [76, 167, 255];

const BASE_BLUE_HUE = rgbToHsl(BASE_BLUE[0] / 255, BASE_BLUE[1] / 255, BASE_BLUE[2] / 255)[0];

/** 将主题色 hex 转为 hue 偏移量，返回计算值供实例存储。 */
function computeThemeHueShift(hex)
{
  if (!/^#[0-9a-f]{6}$/i.test(hex))
  {
    return 0;
  }

  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const [h, s] = rgbToHsl(r, g, b);
  if (s < 0.02)
  {
    return 0;
  }

  return h - BASE_BLUE_HUE;
}

/**
 * 对 RGB 数组应用主题色 hue 偏移；灰度色（饱和度极低）保持原样。
 * @param {number[]} rgb — [r, g, b]，可能超过 0~255（HDR 中间值）
 * @returns {number[]}
 */
function applyThemeHue(rgb)
{
  if (themeHueShift === 0)
  {
    return rgb;
  }

  const [h, s, l] = rgbToHsl(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);

  if (s < 0.02)
  {
    return rgb;
  }

  let newHue = h + themeHueShift;
  newHue = newHue - Math.floor(newHue);
  const [nr, ng, nb] = hslToRgb(newHue, s, l);
  return [Math.round(nr * 255), Math.round(ng * 255), Math.round(nb * 255)];
}

function applyThemeColor(rgb)
{
  if (relativeOklchTheme)
  {
    return applyRelativeOklchTheme(rgb, relativeOklchTheme);
  }

  return applyThemeHue(rgb);
}

function colorToCss(color, alpha = 1)
{
  // 在 clamp 之前统一应用主题映射，默认模式仍精确保留旧 hue 偏移。
  const themed = applyThemeColor(color);
  const red = Math.round(clamp(themed[0], 0, 255));
  const green = Math.round(clamp(themed[1], 0, 255));
  const blue = Math.round(clamp(themed[2], 0, 255));

  return `rgba(${red}, ${green}, ${blue}, ${clamp01(alpha)})`;
}

function srgbToLinearChannel(channel)
{
  const normalized = clamp01(channel / 255);

  if (normalized <= 0.04045)
  {
    return normalized / 12.92;
  }

  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function colorToLinearEnergy(color, intensity = 1, decodeSrgb = false, output = [0, 0, 0])
{
  const safeIntensity = Math.max(0, intensity);

  if (relativeOklchTheme && !relativeOklchTheme.identity)
  {
    // TrailRenderer Gradient 已处于项目的线性活动色彩空间。OKLCH 只接受
    // 普通 sRGB，因此先编码主题输入，映射后再统一解码回线性能量。
    const themeInput = decodeSrgb
      ? color
      : color.map((channel) =>
        linearToSrgb(clamp01(channel / 255)) * 255);
    const themed = applyRelativeOklchTheme(themeInput, relativeOklchTheme);

    for (let index = 0; index < 3; index++)
      output[index] = srgbToLinearChannel(themed[index]) * safeIntensity;
    return output;
  }

  const themed = relativeOklchTheme?.identity
    ? color
    : applyThemeHue(color);

  for (let index = 0; index < 3; index++)
  {
    const channel = themed[index];
    const linear = decodeSrgb
      ? srgbToLinearChannel(channel)
      : clamp01(channel / 255);

    output[index] = linear * safeIntensity;
  }
  return output;
}

function evaluateSrgbGradientEnergy(
  keys,
  progress,
  intensity,
  startColor = null,
)
{
  let linearKeys = gradientEnergyCache?.get(keys);
  if (!linearKeys)
  {
    linearKeys = keys.map(([time, color]) =>
    [
      time,
      applyThemeColor(color).map(srgbToLinearChannel),
    ]);
    gradientEnergyCache?.set(keys, linearKeys);
  }
  const safeIntensity = Math.max(0, intensity);
  const linearStartColor = startColor
    ? startColor.map((channel) => srgbToLinearChannel(channel * 255))
    : [1, 1, 1];

  // ParticleSystem 在 Linear 项目中先转换各 Gradient key，再在 active space 插值。
  return evaluateColor(linearKeys, progress).map((channel, index) =>
    channel * linearStartColor[index] * safeIntensity);
}

/**
 * 将 Shader 线性能量按 Unity 捕获图的通道值编码为预乘加色贡献；
 * 清晰本体不做额外 gamma 提亮，零 RGB 必然得到零 Alpha。
 */
function linearEnergyToAdditiveCss(color, opacity = 1)
{
  const safeOpacity = clamp01(opacity);
  const red = clamp01(color[0] * safeOpacity);
  const green = clamp01(color[1] * safeOpacity);
  const blue = clamp01(color[2] * safeOpacity);
  const alpha = Math.max(red, green, blue);

  if (alpha <= 0.00001)
  {
    return 'rgba(0, 0, 0, 0)';
  }

  return `rgba(${Math.round(red / alpha * 255)}, ${
    Math.round(green / alpha * 255)}, ${
    Math.round(blue / alpha * 255)}, ${alpha})`;
}

/**
 * 为 DOM plus-lighter/宿主 Add 保存完整的 sRGB 发射载荷。
 *
 * scene Canvas 允许把 Linear 能量直接相加，最终由 Scene Final Pass
 * 统一编码；普通 Canvas 回退没有这个 Final Pass，若继续写 Linear 数值，
 * CSS 会把它当作 sRGB 解释，低能量尤其容易变暗。因此这里在每个回退
 * 图层边界编码一次，并用独立 Coverage 作为最小传输 Alpha。
 */
function resolveHostAdditivePayload(
  color,
  contributionOpacity = 1,
  coverageAlpha = contributionOpacity,
)
{
  const contribution = Math.max(0, contributionOpacity);
  const red = linearToSrgb(Math.max(0, color[0]) * contribution);
  const green = linearToSrgb(Math.max(0, color[1]) * contribution);
  const blue = linearToSrgb(Math.max(0, color[2]) * contribution);
  const alpha = clamp01(Math.max(
    red,
    green,
    blue,
    clamp01(coverageAlpha),
  ));

  if (alpha <= 0.00001)
  {
    return [0, 0, 0, 0];
  }

  // alpha 至少覆盖三个 sRGB 通道，Canvas 预乘后仍满足 RGB <= Alpha。
  return [red / alpha, green / alpha, blue / alpha, alpha];
}

function linearEnergyToHostAdditiveCss(
  color,
  contributionOpacity = 1,
  coverageAlpha = contributionOpacity,
)
{
  const [red, green, blue, alpha] = resolveHostAdditivePayload(
    color,
    contributionOpacity,
    coverageAlpha,
  );

  if (alpha <= 0.00001)
  {
    return 'rgba(0, 0, 0, 0)';
  }

  return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${
    Math.round(blue * 255)}, ${alpha})`;
}

function resolveOverlayStraightColor(
  color,
  contributionOpacity,
  coverageAlpha,
  overlayColorCompensation = 'none',
  globalOpacity = 1,
)
{
  const requestedAlpha = clamp01(coverageAlpha);

  if (requestedAlpha <= 0.00001)
  {
    return [0, 0, 0];
  }

  const contribution = Math.max(0, contributionOpacity);
  // Canvas CSS 颜色位于 sRGB 空间。这里的材质颜色是 Unity Linear
  // 能量，必须先完成最终编码，再除以 Coverage 得到直通道颜色。
  let red = clamp01(
    linearToSrgb(Math.max(0, color[0]) * contribution) / requestedAlpha,
  );
  let green = clamp01(
    linearToSrgb(Math.max(0, color[1]) * contribution) / requestedAlpha,
  );
  let blue = clamp01(
    linearToSrgb(Math.max(0, color[2]) * contribution) / requestedAlpha,
  );

  if (overlayColorCompensation === 'bright-core')
  {
    const compensated = compensateBrightCorePremultipliedRgb(
      [
        red * requestedAlpha,
        green * requestedAlpha,
        blue * requestedAlpha,
      ],
      requestedAlpha,
      globalOpacity,
    );

    red = compensated[0] / requestedAlpha;
    green = compensated[1] / requestedAlpha;
    blue = compensated[2] / requestedAlpha;
  }

  return [red, green, blue];
}

function resolveOverlayCompensation(
  color,
  contributionOpacity,
  coverageAlpha,
  globalOpacity = 1,
)
{
  const safeOpacity = Math.max(clamp01(globalOpacity), 0.000001);
  const normalizedCoverage = clamp01(
    clamp01(coverageAlpha) / safeOpacity,
  );
  const normalizedEnergy = linearToSrgb(
    Math.max(...color) * Math.max(0, contributionOpacity) / safeOpacity,
  );
  const energyRatio = normalizedEnergy /
    Math.max(normalizedCoverage, 0.000001);

  return smoothstep(0.25, 0.75, energyRatio) *
    smoothstep(0.03125, 0.25, normalizedEnergy);
}

function colorToCanvasOutputCss(color, alpha, linearOutput = false)
{
  if (!linearOutput)
  {
    return colorToCss(color, alpha);
  }

  // Final Pass 把 Canvas 数值直接解释为线性能量，阴影颜色也必须先解码。
  return linearEnergyToAdditiveCss(
    colorToLinearEnergy(color, 1, true),
    alpha,
  );
}

/**
 * 将线性能量编码为指定 Coverage 的预乘颜色。超出 Coverage 可承载范围的
 * HDR 能量在清晰层钳制，完整能量仍由独立 Bloom 发射路径保留。
 */
function linearEnergyToOverlayCss(
  color,
  contributionOpacity,
  coverageAlpha,
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
  globalOpacity = 1,
)
{
  const requestedAlpha = clamp01(coverageAlpha);
  const alpha = Math.min(
    requestedAlpha,
    clamp01(overlayAlphaLimit),
  );

  if (alpha <= 0.00001)
  {
    return 'rgba(0, 0, 0, 0)';
  }

  const [red, green, blue] = resolveOverlayStraightColor(
    color,
    contributionOpacity,
    requestedAlpha,
    overlayColorCompensation,
    globalOpacity,
  );

  return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${
    Math.round(blue * 255)}, ${alpha})`;
}

/**
 * 原生 Canvas 无法保留 HDR，因此先按 Unity MXFinalBloom 提取高亮，
 * 再用回退强度映射到可模糊的加色源，避免低能尾段也产生均匀光雾。
 */
function linearEnergyToNativeTrailBloomCss(
  color,
  opacity,
  intensity,
  bloomCfg,
  outputCompositing = 'scene',
  coverageOpacity = opacity,
  overlayColorCompensation = 'none',
  overlayAlphaLimit = 1,
)
{
  // GPU Final Pass 会把 Unity 序列化 Intensity 转为线性曝光倍率；原生
  // Canvas 没有独立合成阶段，因此必须在写入模糊源前应用同一倍率。
  const sourceScale = clamp01(opacity) * Math.max(0, intensity) *
    bloomCfg.trailEmissionAlpha;
  const exposure = resolveUnityBloomIntensity(bloomCfg.intensity) /
    resolveUnityBloomIntensity(1.7);
  const source = color.map((channel) => Math.min(resolveUnityBloomClamp(bloomCfg.clamp),
    Math.max(0, channel * sourceScale)));
  const brightness = Math.max(...source);

  if (brightness <= 0)
  {
    return 'rgba(0, 0, 0, 0)';
  }

  const contribution = calculateBloomContribution(
    brightness,
    gammaToLinear(bloomCfg.threshold),
    bloomCfg.softKnee,
  );

  if (contribution <= 0)
  {
    return 'rgba(0, 0, 0, 0)';
  }

  const contributionScale = contribution / brightness * exposure;
  const brightPass = source.map((channel) => channel * contributionScale);

  if (outputCompositing === 'browser-overlay')
  {
    // Native blur 的 Alpha 取自几何 Coverage，而不是 HDR 明度；发射倍率只
    // 改变 RGB，不能把透明桌面的轨迹变成实心遮挡。
    const coverage = clamp01(coverageOpacity * exposure * bloomCfg.trailEmissionAlpha);

    return linearEnergyToOverlayCss(
      brightPass,
      bloomCfg.trailAlpha,
      coverage,
      overlayColorCompensation,
      overlayAlphaLimit,
      opacity,
    );
  }

  if (outputCompositing === 'host-additive')
  {
    return linearEnergyToHostAdditiveCss(
      brightPass,
      bloomCfg.trailAlpha,
      coverageOpacity,
    );
  }

  return linearEnergyToAdditiveCss(brightPass, bloomCfg.trailAlpha);
}

function linearEnergyToEmissionCss(
  color,
  opacity,
  emissionRange,
  energyScale = 1,
)
{
  // 发射增益属于阈值提取前的线性能量，不能并入会钳制到 1 的 opacity。
  const scale = clamp01(opacity) * Math.max(0, energyScale) /
    Math.max(1, emissionRange);
  const red = Math.round(clamp(color[0] * scale * 255, 0, 255));
  const green = Math.round(clamp(color[1] * scale * 255, 0, 255));
  const blue = Math.round(clamp(color[2] * scale * 255, 0, 255));

  return `rgb(${red}, ${green}, ${blue})`;
}

/**
 * 将已知的材质发射强度压入 8 位遮罩；软件 Bloom 回读后会乘回 emissionRange。
 * Alpha 被预先烘入 RGB，Canvas 自身的 Alpha 只负责路径边缘的抗锯齿覆盖率。
 */
function colorToEmissionCss(
  color,
  alpha,
  emission,
  emissionRange,
  energyScale = 1,
)
{
  return linearEnergyToEmissionCss(
    colorToLinearEnergy(color, emission),
    alpha,
    emissionRange,
    energyScale,
  );
}

export {
  computeThemeHueShift,
  colorToCss,
  srgbToLinearChannel,
  colorToLinearEnergy,
  evaluateSrgbGradientEnergy,
  linearEnergyToAdditiveCss,
  resolveHostAdditivePayload,
  linearEnergyToHostAdditiveCss,
  resolveOverlayCompensation,
  colorToCanvasOutputCss,
  linearEnergyToOverlayCss,
  linearEnergyToNativeTrailBloomCss,
  linearEnergyToEmissionCss,
};
