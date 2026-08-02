export const WEBGPU_HDR_PRESENTATION_DEFAULTS = Object.freeze(
  {
    peak: 3,
    brightness: 1,
    whiteCore: 0.6,
    whiteStart: 1,
    whiteEnd: 5,
  },
);

function clamp(value, minimum, maximum)
{
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value)
{
  if (edge1 <= edge0)
  {
    return value < edge0 ? 0 : 1;
  }

  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);

  return t * t * (3 - 2 * t);
}

/**
 * 压缩 SDR 白以上的能量，同时保留 SDR 基底和高能核心的白色观感。
 * 该纯函数与 WGSL 最终展示映射保持一致，便于脱离 HDR 设备验证合同。
 */
export function mapWebGPUHdrPresentation(
  rgb,
  settings = WEBGPU_HDR_PRESENTATION_DEFAULTS,
  background = [0, 0, 0],
)
{
  const peak = Math.max(1, settings.peak);
  const brightness = clamp(settings.brightness ?? 1, 0, 32);
  const whiteCore = clamp(settings.whiteCore, 0, 1);
  const whiteStart = Math.max(0, settings.whiteStart);
  const whiteEnd = Math.max(whiteStart, settings.whiteEnd);
  const base = rgb.map((value) => clamp(value, 0, 1));
  const excess = rgb.map((value, index) =>
    Math.max(0, value - base[index]));
  const excessPeak = Math.max(...excess);

  if (excessPeak <= 0)
  {
    return base.map((value, index) =>
      background[index] + Math.max(0, value - background[index]) *
        brightness);
  }

  const capacity = peak - 1;
  const mappedPeak = capacity * excessPeak /
    Math.max(capacity + excessPeak, 0.000001);
  const whiteMix = smoothstep(whiteStart, whiteEnd, excessPeak) *
    whiteCore;

  const mapped = base.map((value, index) =>
  {
    const coloredExtra = excess[index] * mappedPeak / excessPeak;
    const displayExtra = coloredExtra +
      (mappedPeak - coloredExtra) * whiteMix;

    return value + displayExtra;
  });

  return mapped.map((value, index) =>
    background[index] + Math.max(0, value - background[index]) *
      brightness);
}
