/**
 * 网页透明覆盖层的最终载荷合同。
 *
 * Unity 的 FX_Touch 在已知 HDR 场景中使用真正的 Add；未知网页背景只能
 * 传输一个满足预乘约束的近似载荷。因此 Alpha 策略和颜色补偿必须保持独立。
 */

export const OVERLAY_ALPHA_POLICIES = Object.freeze(
  [
    'coverage',
    'visual-max',
  ],
);

export const OVERLAY_COLOR_COMPENSATIONS = Object.freeze(
  [
    'none',
    'bright-core',
  ],
);

export function isOverlayAlphaPolicy(value)
{
  return OVERLAY_ALPHA_POLICIES.includes(value);
}

export function normalizeOverlayAlphaPolicy(
  value,
  fallback = 'coverage',
)
{
  return isOverlayAlphaPolicy(value) ? value : fallback;
}

export function isOverlayColorCompensation(value)
{
  return OVERLAY_COLOR_COMPENSATIONS.includes(value);
}

export function normalizeOverlayColorCompensation(
  value,
  fallback = 'none',
)
{
  return isOverlayColorCompensation(value) ? value : fallback;
}

export function mapUnknownBackgroundAppearance(value)
{
  return value === 'bright' ? 'bright-core' : 'none';
}

export function mapOverlayColorCompensation(value)
{
  return value === 'bright-core' ? 'bright' : 'coverage';
}

export function resolveOverlayRequestedAlpha(
  sceneCoverage,
  bloomTransportAlpha,
  policy = 'coverage',
)
{
  const scene = Math.max(0, Number(sceneCoverage) || 0);
  const bloom = Math.max(0, Number(bloomTransportAlpha) || 0);

  if (policy === 'visual-max')
  {
    return Math.max(scene, bloom);
  }

  return scene + bloom;
}

export function resolveOverlayAlpha(
  sceneCoverage,
  bloomTransportAlpha,
  alphaLimit = 1,
  policy = 'coverage',
)
{
  const requestedAlpha = resolveOverlayRequestedAlpha(
    sceneCoverage,
    bloomTransportAlpha,
    policy,
  );
  const limit = Math.max(0, Math.min(1, Number(alphaLimit) || 0));

  return {
    requestedAlpha,
    alpha: Math.min(requestedAlpha, limit),
  };
}

/**
 * 将最终 sRGB 目标颜色收敛到预乘 Alpha 容量。visual-max 只在这里读取
 * maxRGB；它不参与 Alpha 的生成，避免重新耦合清晰 Coverage 与发射能量。
 */
export function scaleOverlayPremultipliedRgb(
  srgb,
  requestedAlpha,
  alpha,
  policy = 'coverage',
)
{
  const color = Array.isArray(srgb) ? srgb : [0, 0, 0];
  const safeRequested = Math.max(0, Number(requestedAlpha) || 0);
  const safeAlpha = Math.max(0, Math.min(1, Number(alpha) || 0));
  const maximumSrgb = Math.max(
    0,
    Number(color[0]) || 0,
    Number(color[1]) || 0,
    Number(color[2]) || 0,
  );
  const scale = policy === 'visual-max'
    ? Math.min(1, safeAlpha / Math.max(maximumSrgb, 0.000001))
    : Math.min(1, safeAlpha / Math.max(safeRequested, 0.000001));

  return [
    Math.min(safeAlpha, Math.max(0, Number(color[0]) || 0) * scale),
    Math.min(safeAlpha, Math.max(0, Number(color[1]) || 0) * scale),
    Math.min(safeAlpha, Math.max(0, Number(color[2]) || 0) * scale),
  ];
}
