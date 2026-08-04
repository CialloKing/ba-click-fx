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

export const BRIGHT_CORE_CHANNEL_MIX = 0.35;

function clamp01(value)
{
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function smoothstep(edge0, edge1, value)
{
  const progress = clamp01((value - edge0) / (edge1 - edge0));

  return progress * progress * (3 - 2 * progress);
}

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

/**
 * 只补齐高能像素的弱通道。最大通道和 Alpha 都保持不变，避免浅色背景
 * 补偿把蓝青核心压成纯白；绝对能量门继续保护低能拖尾。
 */
export function compensateBrightCorePremultipliedRgb(
  rgb,
  alpha,
  opacity = 1,
)
{
  const safeAlpha = clamp01(alpha);

  if (safeAlpha <= 0.000001)
  {
    return [0, 0, 0];
  }

  const color = [0, 1, 2].map((channel) =>
    Math.min(safeAlpha, Math.max(0, Number(rgb?.[channel]) || 0)));
  const maximum = Math.max(...color);

  if (maximum <= 0.000001)
  {
    return color;
  }

  const safeOpacity = Math.max(clamp01(opacity), 0.000001);
  const normalizedCoverage = clamp01(safeAlpha / safeOpacity);
  const normalizedEnergy = maximum / safeOpacity;
  const energyRatio = normalizedEnergy /
    Math.max(normalizedCoverage, 0.000001);
  const gate = smoothstep(0.25, 0.75, energyRatio) *
    smoothstep(0.03125, 0.25, normalizedEnergy);
  const amount = BRIGHT_CORE_CHANNEL_MIX * gate;

  return color.map((channel) =>
    channel + (maximum - channel) * amount);
}

/**
 * Canvas ImageData 保存直通道 RGB；先恢复聚合后的预乘载荷，再统一补偿一次。
 */
export function applyOverlayColorCompensationToImageData(
  imageData,
  compensation = 'none',
  opacity = 1,
)
{
  if (compensation !== 'bright-core' || !imageData?.data)
  {
    return imageData;
  }

  const data = imageData.data;

  for (let index = 0; index + 3 < data.length; index += 4)
  {
    const alpha = data[index + 3] / 255;

    if (alpha <= 0.000001)
    {
      continue;
    }

    const premultiplied = [
      data[index] / 255 * alpha,
      data[index + 1] / 255 * alpha,
      data[index + 2] / 255 * alpha,
    ];
    const compensated = compensateBrightCorePremultipliedRgb(
      premultiplied,
      alpha,
      opacity,
    );

    data[index] = Math.round(compensated[0] / alpha * 255);
    data[index + 1] = Math.round(compensated[1] / alpha * 255);
    data[index + 2] = Math.round(compensated[2] / alpha * 255);
  }

  return imageData;
}

/**
 * 对 Canvas 最终 ImageData 执行 visual-max。Canvas 回读的是直通道 RGB，
 * 因此先还原当前预乘载荷，再以新的 Alpha 容量重新编码，不能只改 A 通道。
 */
export function applyOverlayAlphaPolicyToImageData(
  imageData,
  sceneAlphaData = null,
  bloomAlphaData = null,
  alphaLimit = 1,
  policy = 'coverage',
  bloomCompositing = 'lighter',
)
{
  if (
    policy !== 'visual-max' ||
    !imageData?.data ||
    !Number.isFinite(imageData.width) ||
    !Number.isFinite(imageData.height)
  )
  {
    return imageData;
  }

  const data = imageData.data;
  const safeLimit = Math.max(0, Math.min(1, Number(alphaLimit) || 0));

  for (let index = 0; index + 3 < data.length; index += 4)
  {
    const currentAlpha = data[index + 3] / 255;
    const sceneAlpha = sceneAlphaData?.[index + 3] === undefined
      ? currentAlpha
      : sceneAlphaData[index + 3] / 255;
    // lighter 会在写入 Canvas 时把累计 Alpha 饱和到 1。优先读取 Bloom
    // 独立传输层，避免在高能核心从已丢失信息的总 Alpha 反推。
    let bloomAlpha;

    if (bloomAlphaData?.[index + 3] !== undefined)
    {
      bloomAlpha = bloomAlphaData[index + 3] / 255;
    }
    else if (bloomCompositing === 'source-over')
    {
      // Native/Legacy 阴影与清晰层以 source-over 组成 Alpha 并集：
      // 1 - A总 = (1 - A清晰) * (1 - A辉光)。清晰层已不透明时
      // visual-max 必然选择它，无需再恢复被完全遮住的辉光 Alpha。
      bloomAlpha = sceneAlpha >= 1
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              (currentAlpha - sceneAlpha) / Math.max(1 - sceneAlpha, 1e-6),
            ),
          );
    }
    else
    {
      bloomAlpha = Math.max(0, currentAlpha - sceneAlpha);
    }
    const targetAlpha = Math.min(
      Math.max(sceneAlpha, bloomAlpha),
      safeLimit,
    );

    if (targetAlpha <= 0.00001)
    {
      data[index] = 0;
      data[index + 1] = 0;
      data[index + 2] = 0;
      data[index + 3] = 0;
      continue;
    }

    const currentPremultiplied = [
      (data[index] / 255) * currentAlpha,
      (data[index + 1] / 255) * currentAlpha,
      (data[index + 2] / 255) * currentAlpha,
    ];
    // WebGL Final Pass 也使用统一容量倍率；逐通道钳制会让蓝青核心偏白。
    const maximumPremultiplied = Math.max(...currentPremultiplied);
    const capacityScale = Math.min(
      1,
      targetAlpha / Math.max(maximumPremultiplied, 0.000001),
    );

    data[index] = Math.round(
      currentPremultiplied[0] * capacityScale / targetAlpha * 255,
    );
    data[index + 1] = Math.round(
      currentPremultiplied[1] * capacityScale / targetAlpha * 255,
    );
    data[index + 2] = Math.round(
      currentPremultiplied[2] * capacityScale / targetAlpha * 255,
    );
    data[index + 3] = Math.round(targetAlpha * 255);
  }

  return imageData;
}
