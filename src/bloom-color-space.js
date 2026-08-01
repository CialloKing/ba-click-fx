export const HALF_FLOAT_MAX = 65504;
export const DEFAULT_BLOOM_CLAMP = 65472;

/**
 * 游戏把 Bloom 面板强度当作曝光刻度，并在绑定 Shader 前完成换算。
 * Shader 里的乘法虽然是线性的，但接收到的并不是序列化原值。
 */
export function resolveUnityBloomIntensity(value)
{
  const intensity = Number.isFinite(value)
    ? Math.max(0, value)
    : 0;

  return Math.expm1(intensity / 10 * Math.LN2);
}

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
 * 游戏 CPU 与 Threshold 一样先把序列化 Clamp 换算到线性空间。
 * 默认值换算后会超过 half 范围，因此还要模拟 Shader 参数上限。
 */
export function resolveUnityBloomClamp(value = DEFAULT_BLOOM_CLAMP)
{
  const gammaClamp = Number.isFinite(value)
    ? value
    : DEFAULT_BLOOM_CLAMP;

  return Math.min(HALF_FLOAT_MAX, gammaToLinear(gammaClamp));
}
