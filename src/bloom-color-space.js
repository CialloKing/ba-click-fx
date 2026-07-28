export const HALF_FLOAT_MAX = 65504;
export const DEFAULT_BLOOM_CLAMP = 65472;

/**
 * Unity 在把 Bloom 设置传给线性 HDR Shader 前调用 GammaToLinearSpace。
 */
export function gammaToLinear(value)
{
  const gamma = Math.max(0, value);

  if (gamma <= 0.04045)
  {
    return gamma / 12.92;
  }

  if (gamma < 1)
  {
    return Math.pow((gamma + 0.055) / 1.055, 2.4);
  }

  // Unity 对 HDR Gamma 值使用扩展的 2.2 幂分支，而不是把 sRGB 曲线
  // 无限外推；自定义 Threshold / Clamp 大于 1 时也必须保持该语义。
  return Math.pow(gamma, 2.2);
}

/**
 * MXFinalBloom 的 Clamp 是序列化 Gamma 值，最终还受 half 精度上限约束。
 */
export function resolveUnityBloomClamp(value = DEFAULT_BLOOM_CLAMP)
{
  const gammaClamp = Number.isFinite(value)
    ? value
    : DEFAULT_BLOOM_CLAMP;

  return Math.min(HALF_FLOAT_MAX, gammaToLinear(gammaClamp));
}
