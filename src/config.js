const REFERENCE_HEIGHT = 1080;
const REFERENCE_ORTHOGRAPHIC_SIZE = 1;
const WORLD_TO_REFERENCE_PIXELS =
  REFERENCE_HEIGHT / (REFERENCE_ORTHOGRAPHIC_SIZE * 2);
const SHARD_LOCAL_SCALE = 0.3078824;
const SHARD_UNIT_TO_REFERENCE_PIXELS =
  WORLD_TO_REFERENCE_PIXELS * SHARD_LOCAL_SCALE;
const RING_MESH_OUTER_RADIUS = 1.0636684;
const DEFAULT_BLOOM_BACKEND = 'webgl2';
const BLOOM_BACKENDS = new Set(['auto', 'software', 'webgl2', 'native']);
const INPUT_SOURCES = new Set(['dom', 'manual']);

// FX_Touch 使用独立的 UI 正交投影（高度 2 世界单位），不跟随场景相机。
export const SIZE_CORRECTION = 1;

/**
 * FX_Touch 的 Unity 2021.3 粒子参数。
 *
 * 数值统一换算到 1920x1080 画面中的 CSS 像素；运行时只按画面高度缩放。
 * 这里保留游戏参数而不是暴露调色面板，避免演示页和运行逻辑再次产生两套真值。
 */
export const UNITY_FX_TOUCH = Object.freeze(
  {
    referenceHeight: REFERENCE_HEIGHT,
    // 游戏在输入结束后等待该时长再回收根对象；它不驱动任何可见曲线。
    rootDurationMs: 1000,
    hit:
    {
      enabled: false,
      lifetimeMs: 80,
      radius: 24,
      colorKeys:
      [
        [0, [255, 255, 255]],
        [0.5, [180, 220, 255]],
        [1, [61, 100, 255]],
      ],
      alphaKeys:
      [
        [0, 1],
        [0.4, 0.8],
        [1, 0],
      ],
    },
    flare:
    {
      enabled: false,
      lifetimeMs: 150,
      radius: 36,
      rayCount: 6,
      colorKeys:
      [
        [0, [255, 255, 255]],
        [0.3, [180, 220, 255]],
        [1, [61, 100, 255]],
      ],
      alphaKeys:
      [
        [0, 0.7],
        [0.5, 0.3],
        [1, 0],
      ],
    },
    disk:
    {
      lifetimeMs: 200,
      radius: 0.12 * 2 * 0.5 * WORLD_TO_REFERENCE_PIXELS,
      colorKeys:
      [
        [0, [255, 255, 255]],
        [0.1205921, [61, 100, 255]],
      ],
      alphaKeys:
      [
        [0, 1],
        [0.1088273, 1],
        [1, 0],
      ],
      sizeKeys:
      [
        [0, 0.32583582, 2.4004734, 2.4004734],
        [0.21392822, 0.7159773, 0.9115745, 0.9115745],
        [1, 1, 0, 0],
      ],
      // FX_TEX_Circle_01 的 RGB 会在 Shader 中再乘一次 R 通道。
      textureRadialEnergyKeys:
      [
        [0, 1],
        [0.84, 1],
        [0.88, 1],
        [0.885, 0.398631296],
        [0.89, 0.203383314],
        [0.895, 0.124567474],
        [0.9, 0.077524029],
        [0.905, 0.016747405],
        [0.91, 0.003936947],
        [0.915, 0.000384468],
        [0.92, 0],
        [1, 0],
      ],
    },
    rings:
    {
      count: 2,
      lifetimeMs: 600,
      // MeshTri 的外半径由 Start Size 0.12~0.14 换算而来；环宽始终随网格同比缩放。
      radiusMin: 0.12 * WORLD_TO_REFERENCE_PIXELS * RING_MESH_OUTER_RADIUS,
      radiusMax: 0.14 * WORLD_TO_REFERENCE_PIXELS * RING_MESH_OUTER_RADIUS,
      bandToOuterRadius: 0.0598573766034603,
      // 保留两个运行时调节入口，但它们是资源环宽的倍率，不再是独立像素宽度。
      widthStart: 1,
      widthEnd: 1,
      angularVelocityMultiplier: 11.170107,
      angularVelocityMinKeys:
      [
        [0.14903903, 1],
        [1, 0.45561826],
      ],
      angularVelocityMaxKeys:
      [
        [0.15865384, 0.79881656],
        [1, -0.06509134],
      ],
      // Canvas 正角度在屏幕坐标中表现为顺时针，因此用 -1 还原游戏逆时针方向。
      rotationDirection: -1,
      // FX_MAT_Touch_Tri3 的白色 HDR 强度；Renderer 的 Color 顶点流还会
      // 乘入启用的 Color over Lifetime，必须保留生命周期内的青蓝过渡。
      hdrIntensity: 5.992157,
      colorKeys:
      [
        [0.1117723, [255, 255, 255]],
        [0.5000076, [76, 167, 255]],
        [1, [76, 167, 255]],
      ],
      sizeKeys:
      [
        [0.007209778, 0.42050898, 2.4004734, 2.4004734],
        [0.21392822, 0.7159773, 0.9115745, 0.9115745],
        [1, 1, 0, 0],
      ],
      dissolveKeys:
      [
        [0, 1, 0, 0],
        [0.2, 0, 0, 2.4249368],
        [1, 1, 0.27735636, 0.27735636],
      ],
      arcSamples: 96,
      radialSamples: 8,
      // Cylinder002 网格没有使用纹理边界，需保留导出的 float32 UV 范围。
      textureUvMin: 0.0005000000237487257,
      textureUvMax: 0.999500036239624,
      // 控制纹理 U 的朝向；可见区间不再重映射或人为固定端点。
      dissolveDirection: 1,
    },
    shards:
    {
      hdrIntensity: 5.992157,
      // Ring (3)/(4) 的 InitialModule.startColor。Renderer 开启
      // Apply Active Color Space，因此必须在线性空间乘入，不能当作显示 Alpha。
      startColor: [0.5377358, 0.5377358, 0.5377358],
      clickCount: 4,
      clickLifetimeMinMs: 600,
      clickLifetimeMaxMs: 700,
      // Ring (3)/(4) 使用 Local scalingMode；发射位置、尺寸和速度都必须乘
      // 子节点的 0.3078824 缩放，不能只缩放其中两项。
      clickRadius: 0.3 * SHARD_UNIT_TO_REFERENCE_PIXELS,
      clickSpeedMin: 0.3 * SHARD_UNIT_TO_REFERENCE_PIXELS,
      clickSpeedMax: 0.4 * SHARD_UNIT_TO_REFERENCE_PIXELS,
      trailLifetimeMinMs: 200,
      trailLifetimeMaxMs: 400,
      trailRadius: 0.15 * SHARD_UNIT_TO_REFERENCE_PIXELS,
      trailSpeedMin: 0.2 * SHARD_UNIT_TO_REFERENCE_PIXELS,
      trailSpeedMax: 0.3 * SHARD_UNIT_TO_REFERENCE_PIXELS,
      sizeMin: 0.1 * SHARD_UNIT_TO_REFERENCE_PIXELS,
      sizeMax: 0.2 * SHARD_UNIT_TO_REFERENCE_PIXELS,
      sizeKeys:
      [
        [0, 0, 0, 0],
        [0.15445095, 1, 0, 0],
        [1, 0, -2.1621501, -2.1621501],
      ],
      // FX_TEX_Triangle_02_1 是 2×1 图集；坐标来自两个 128×128 帧内
      // 非透明三角形的边界，避免用偏大的等边三角形增加 Bloom 输入面积。
      textureFrames:
      [
        [
          [-0.48046875, -0.36328125],
          [0.48046875, -0.36328125],
          [0, 0.45703125],
        ],
        [
          [0, -0.45703125],
          [0.48046875, 0.36328125],
          [-0.48046875, 0.36328125],
        ],
      ],
      colorKeys:
      [
        [0, [255, 255, 255]],
        [0.1823606, [255, 255, 255]],
        [0.282353, [95, 197, 255]],
        [0.4617685, [95, 197, 255]],
        [0.6617685, [90, 186, 241]],
        [0.8264744, [95, 197, 255]],
        [1, [95, 197, 255]],
      ],
      alphaKeys:
      [
        [0, 1],
        [0.2882429, 1],
        [0.3647059, 0],
        [0.4705882, 1],
        [0.5735256, 0],
        [0.6676432, 1],
        [0.7558862, 0],
        [0.8529488, 1],
        [1, 1],
      ],
      trailSpacing: WORLD_TO_REFERENCE_PIXELS / 5,
      maxCount: 96,
    },
    trail:
    {
      lifetimeMs: 300,
      // 0.005 世界单位在固定 UI 投影下几何带宽 2.7px；HDR 23.97× Bloom
      // 后自然扩张为约 4px 的可见亮芯，点击光盘直径的 ≈1/24。
      geometryWidth: 0.005 * WORLD_TO_REFERENCE_PIXELS,
      width: 0.005 * WORLD_TO_REFERENCE_PIXELS,
      minVertexDistance: 0.01 * WORLD_TO_REFERENCE_PIXELS,
      // TrailRenderer 在折点和首尾使用资源中记录的细分数量。
      numCornerVertices: 4,
      numCapVertices: 1,
      outerGlowWidth: 9,
      // 拖尾整体透明度，可通过 setFxParam 调整
      trailOpacity: 1.0,
      gradient:
      [
        // Unity TrailRenderer 的 0 端位于最新点；这里按“旧点到新点”的
        // Canvas 点序反转原始 Gradient，保留资源中的精确关键帧。
        [0, [0, 0, 0]],
        [0.5794156, [0, 24.191827, 72]],
        [0.97941558, [0, 99.598249, 255]],
        [1, [0, 99.598249, 255]],
      ],
      textureLongitudinalKeys:
      [
        // FX_TEX_Trail_03 使用 Stretch UV 且按 sRGB 导入，而 Unity 工程运行在
        // Linear 色彩空间。这里预先转成线性能量并反转为旧点→新点，避免中段
        // 亮度被放大后过早进入 Bloom。
        [0, 0],
        [0.248532, 0],
        [0.311155, 0.002428251],
        [0.373777, 0.021219072],
        [0.436399, 0.068478133],
        [0.499022, 0.144128269],
        [0.561644, 0.462077113],
        [0.624266, 0.672443723],
        [0.686888, 0.791298368],
        [0.749511, 0.930109875],
        [0.812133, 1],
        [1, 1],
      ],
      // FX_TEX_Trail_03 不可分离为固定横截面。每行按旧点→新点进度保存
      // 中心到边缘 d=[0,.125,...,1] 的相对线性能量，运行时先还原绝对
      // 二维纹理能量再做纵向插值，避免中段被固定亮芯错误拓宽。
      textureTransverseProfileKeys:
      [
        [0, [0, 0, 0, 0, 0, 0, 0, 0, 0]],
        [0.248532, [0, 0, 0, 0, 0, 0, 0, 0, 0]],
        [0.311155, [1, 1, 0.625, 0, 0, 0, 0, 0, 0]],
        [0.373777, [1, 1, 0.7167, 0.3534, 0.1144, 0, 0, 0, 0]],
        [0.436399, [1, 1, 0.7956, 0.5387, 0.283, 0.0757, 0, 0, 0]],
        [0.499022, [1, 0.9605, 0.8657, 0.6613, 0.4191, 0.1786, 0.0279, 0, 0]],
        [0.561644, [1, 1, 0.9277, 0.4599, 0.2906, 0.1564, 0.0591, 0.0013, 0.0026]],
        [0.624266, [1, 0.9687, 0.9534, 0.8881, 0.6621, 0.2342, 0.1006, 0.0149, 0.0018]],
        [0.686888, [1, 0.9804, 0.9515, 0.8952, 0.8188, 0.5912, 0.1858, 0.0382, 0.0019]],
        [0.749511, [1, 1, 0.9457, 0.9018, 0.8341, 0.723, 0.4968, 0.0699, 0.0016]],
        [0.812133, [1, 1, 0.9734, 0.9647, 0.9047, 0.7991, 0.6724, 0.1896, 0.0015]],
        [0.874755, [1, 1, 1, 1, 0.9734, 0.9301, 0.7991, 0.4022, 0.0015]],
        [0.937378, [1, 1, 1, 1, 1, 1, 0.9301, 0.5, 0.0015]],
        [1, [1, 1, 1, 1, 1, 1, 0.9867, 0.591, 0.0015]],
      ],
    },
    bloom:
    {
      // 游戏使用 Hidden/MXFinalBloom，而不是 URP Volume Bloom。
      threshold: 1.0,
      softKnee: 0,
      clamp: 65472,
      intensity: 1.7,
      diffusion: 7,
      resolutionScale: 0.5,
      emissionRange: 23.968628,
      diskEmission: 2.0,
      trailEmission: 23.968628,
      // Canvas 的物理像素线宽已经等于 TrailRenderer 三角带宽；额外扩张会
      // 同时放大阈值以上面积和 MXFinalBloom 的中远程光晕。
      trailCoverageScale: 1,
      // 原资源的纹理、顶点色和材质 Alpha 均为 1；头尾差异由 RGB
      // Gradient × Stretch 纹理产生，不能再用全局 Alpha 把头部一并压暗。
      trailEmissionAlpha: 1,
      // 点击专用倍率只缩放圆环与光盘的辉光源，不改变清晰几何或拖尾。
      // 原生辉光后端复用同一倍率缩放 shadowBlur 的颜色 Alpha。
      clickEmissionScale: 1,
      // FX_MAT_Touch_Tri3 的材质 Alpha 为 1；Bloom 不再用全局 Alpha
      // 压低圆环发射能量。
      ringEmissionAlpha: 1,
      diskEmissionAlpha: 1,
      // 以下 Alpha 只用于无法回读像素时的原生模糊回退。
      ringBlur: 80,
      ringAlpha: 0.35,
      diskBlur: 65,
      diskAlpha: 0.65,
      trailAlpha: 0.18,
    },
  },
);

export const CONFIG = Object.freeze(
  {
    scale: 1,
    opacity: 1,
    clickEnabled: true,
    trailEnabled: true,
    trailAlways: false,
    inputSource: 'dom',
    clickTimeScale: 1,
    trailTimeScale: 1,
    // 'enhanced' 使用线性能量编码，并由 bloomBackend 选择 Bloom 实现；
    // 'legacy' 使用 sRGB 颜色 + shadowBlur（main 分支风格）。
    renderingMode: 'enhanced',
    // 默认使用 GPU Bloom；能力不足时依次回退软件 Bloom 与原生辉光。
    bloomBackend: DEFAULT_BLOOM_BACKEND,
    softwareBloomEnabled: true,
    // 游戏把 UI 粒子直接加到同一 HDR 目标；透明隔离组仅作为网页兼容选项。
    isolatedCompositing: false,
    // 淡青 darken 轮廓不是游戏管线的一部分，浅色页面需要时再显式开启。
    lightBackgroundContrastAlpha: 0,
    maxDpr: 2,
    touchAction: 'auto',
  },
);

export function isBloomBackend(value)
{
  return BLOOM_BACKENDS.has(value);
}

export function normalizeBloomBackend(value, fallback = DEFAULT_BLOOM_BACKEND)
{
  return isBloomBackend(value) ? value : fallback;
}

export function isInputSource(value)
{
  return INPUT_SOURCES.has(value);
}

export function normalizeTimeScale(value, fallback = 1)
{
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 每个引擎实例持有独立的运行配置；Unity 参数本身保持只读。
 * @param {object} [overrides]
 * @returns {object}
 */
export function createConfig(overrides = {})
{
  let bloomBackend = CONFIG.bloomBackend;

  if (isBloomBackend(overrides.bloomBackend))
  {
    bloomBackend = overrides.bloomBackend;
  }
  else if (typeof overrides.softwareBloomEnabled === 'boolean')
  {
    bloomBackend = overrides.softwareBloomEnabled ? 'software' : 'native';
  }

  const inputSource = isInputSource(overrides.inputSource)
    ? overrides.inputSource
    : CONFIG.inputSource;
  const clickTimeScale = normalizeTimeScale(
    overrides.clickTimeScale,
    CONFIG.clickTimeScale,
  );
  const trailTimeScale = normalizeTimeScale(
    overrides.trailTimeScale,
    CONFIG.trailTimeScale,
  );

  return {
    ...CONFIG,
    ...overrides,
    inputSource,
    clickTimeScale,
    trailTimeScale,
    bloomBackend,
    softwareBloomEnabled: bloomBackend !== 'native',
    isolatedCompositing: typeof overrides.isolatedCompositing === 'boolean'
      ? overrides.isolatedCompositing
      : CONFIG.isolatedCompositing,
  };
}
