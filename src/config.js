const REFERENCE_HEIGHT = 1080;
const REFERENCE_ORTHOGRAPHIC_SIZE = 1.35;
const WORLD_TO_REFERENCE_PIXELS =
  REFERENCE_HEIGHT / (REFERENCE_ORTHOGRAPHIC_SIZE * 2);
const SHARD_LOCAL_SCALE = 0.3078824;
const SHARD_UNIT_TO_REFERENCE_PIXELS =
  WORLD_TO_REFERENCE_PIXELS * SHARD_LOCAL_SCALE;
const DEFAULT_BLOOM_BACKEND = 'software';
const BLOOM_BACKENDS = new Set(['auto', 'software', 'webgl2', 'native']);

// 游戏相机 orthographicSize 实际约 1.47，代码中声明的 1.35 导致所有
// 世界单位→像素的硬编码常量整体偏大约 8%；此因子统一修正到游戏视觉比例。
export const SIZE_CORRECTION = 0.85;

/**
 * FX_Touch 的 Unity 2021.3 粒子参数。
 *
 * 数值统一换算到 1920x1080 画面中的 CSS 像素；运行时只按画面高度缩放。
 * 这里保留游戏参数而不是暴露调色面板，避免演示页和运行逻辑再次产生两套真值。
 */
export const UNITY_FX_TOUCH = Object.freeze(
  {
    referenceHeight: REFERENCE_HEIGHT,
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
      radius: 48,
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
        [0, 0.3258358],
        [0.2139282, 0.7159773],
        [1, 1],
      ],
    },
    rings:
    {
      count: 2,
      lifetimeMs: 600,
      // MeshTri 的外半径由 Start Size 0.12~0.14 换算而来；环宽始终随网格同比缩放。
      radiusMin: 51.0560832,
      radiusMax: 59.5654304,
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
      // FX_MAT_Touch_Tri3 的白色 HDR 强度；Shader 还会乘入粒子顶点 RGB。
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
      // 控制纹理 U 的朝向；可见区间不再重映射或人为固定端点。
      dissolveDirection: 1,
      textureAlphaKeys:
      [
        // FX_TEX_Grad_Ring3 的 U 向中线 Alpha；原 Shader 对它执行二值 clip。
        [0, 0.02745098],
        [0.0625, 0.043137255],
        [0.125, 0.117647059],
        [0.1875, 0.223529412],
        [0.25, 0.37254902],
        [0.3125, 0.533333333],
        [0.375, 0.721568627],
        [0.4375, 0.890196078],
        [0.5, 1],
        [0.5625, 0.88627451],
        [0.625, 0.717647059],
        [0.6875, 0.537254902],
        [0.75, 0.364705882],
        [0.8125, 0.22745098],
        [0.875, 0.109803922],
        [0.9375, 0.035294118],
        [1, 0.031372549],
      ],
      textureRadialAlphaKeys:
      [
        // 同一纹理 U=0.5 截面的 V 向 Alpha，除以中心 255 后归一化。
        // 这组二维覆盖让环带中心比内外沿更亮，而不是一条均匀纯色描边。
        [0, 0.890196078],
        [0.0625, 0.898039216],
        [0.125, 0.91372549],
        [0.1875, 0.933333333],
        [0.25, 0.952941176],
        [0.3125, 0.964705882],
        [0.375, 0.97254902],
        [0.4375, 0.988235294],
        [0.5, 1],
        [0.5625, 0.988235294],
        [0.625, 0.976470588],
        [0.6875, 0.964705882],
        [0.75, 0.952941176],
        [0.8125, 0.933333333],
        [0.875, 0.925490196],
        [0.9375, 0.905882353],
        [1, 0.882352941],
      ],
    },
    shards:
    {
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
        [0, 0],
        [0.154451, 1],
        [1, 0],
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
      trailSpacing: 80,
      maxCount: 96,
    },
    trail:
    {
      lifetimeMs: 300,
      // 0.005 世界单位在 1.35 正交相机下几何带宽 2px；HDR 23.97× Bloom
      // 后自然扩张为约 4px 的可见亮芯，点击光盘直径的 ≈1/24。
      geometryWidth: 2,
      width: 2,
      minVertexDistance: 4,
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
    },
    bloom:
    {
      // BundleBaseline 的 URP Bloom 对照值；软件管线使用 Float32 中间亮度，
      // 最终再量化为普通 ImageData，因此不依赖实验性的 float16 Canvas。
      threshold: 1.0,
      softKnee: 0.5,
      clamp: 65472,
      intensity: 0.45,
      scatter: 0.35,
      resolutionScale: 0.5,
      skipIterations: 1,
      highQualityFiltering: true,
      emissionRange: 23.968628,
      diskEmission: 2.0,
      trailEmission: 23.968628,
      // Unity TrailRenderer 的连续三角带在亮芯附近保留更多子像素覆盖；
      // Canvas 分段 stroke 需要该覆盖校准，才能得到相同的 Bloom 截面。
      trailCoverageScale: 1.75,
      // 原资源的纹理、顶点色和材质 Alpha 均为 1；头尾差异由 RGB
      // Gradient × Stretch 纹理产生，不能再用全局 Alpha 把头部一并压暗。
      trailEmissionAlpha: 1,
      // 局部裁剪 CPU 金字塔的圆环能量略高于 Unity 全屏链路；单独校准，
      // 不牵连已经匹配的圆盘与拖尾 Bloom。
      ringEmissionAlpha: 0.65,
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
    // 'enhanced' 使用线性能量编码，并由 bloomBackend 选择 Bloom 实现；
    // 'legacy' 使用 sRGB 颜色 + shadowBlur（main 分支风格）。
    renderingMode: 'enhanced',
    // 软件 Bloom 保持默认参考实现；WebGL2 仅在显式选择或 auto 时创建。
    bloomBackend: DEFAULT_BLOOM_BACKEND,
    softwareBloomEnabled: true,
    // 严格加色在纯白背景上没有对比度；独立 darken 层补回轮廓。0.35 为实验值。
    lightBackgroundContrastAlpha: 0.35,
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

  return {
    ...CONFIG,
    ...overrides,
    bloomBackend,
    softwareBloomEnabled: bloomBackend !== 'native',
  };
}
