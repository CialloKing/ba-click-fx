const REFERENCE_HEIGHT = 1080;
const REFERENCE_ORTHOGRAPHIC_SIZE = 1.35;
const WORLD_TO_REFERENCE_PIXELS =
  REFERENCE_HEIGHT / (REFERENCE_ORTHOGRAPHIC_SIZE * 2);
const SHARD_LOCAL_SCALE = 0.3078824;
const SHARD_UNIT_TO_REFERENCE_PIXELS =
  WORLD_TO_REFERENCE_PIXELS * SHARD_LOCAL_SCALE;

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
      radiusMin: 51,
      radiusMax: 59,
      widthStart: 5.2,
      widthEnd: 2.4,
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
      // 游戏材质 _Color 原值 5.992157；Canvas 2D uniform 乘法无 Tonemap，
      // 降为 1.0 让粒子后期 (76,167,255) 即 R<G<B 的青蓝色调自然呈现。
      hdrIntensity: 1.0,
      colorKeys:
      [
        [0.1117723, [255, 255, 255]],
        [0.5000076, [76, 167, 255]],
        [1, [76, 167, 255]],
      ],
      sizeKeys:
      [
        [0.007209778, 0.420509],
        [0.2139282, 0.7159773],
        [1, 1],
      ],
      dissolveKeys:
      [
        [0, 1],
        [0.2, 0],
        [1, 1],
      ],
      arcSamples: 96,
      // Canvas 正角度为顺时针；弧长下降时，正向端点会沿逆时针单向回退。
      dissolveDirection: 1,
      // Shader 的溶解阈值沿网格 UV 推进：起点保持完整，只有活动端形成软边。
      dissolveEdgeRatio: 0.1,
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
      // 后可见亮芯约 4px，点击光盘直径的 ≈1/24。
      geometryWidth: 2,
      width: 4,
      minVertexDistance: 4,
      outerGlowWidth: 9,
      coreWidth: 1.7,
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
      intensity: 0.45,
      scatter: 0.35,
      resolutionScale: 0.5,
      iterations: 3,
      emissionRange: 23.968628,
      ringEmission: 5.992157,
      diskEmission: 2.0,
      trailEmission: 23.968628,
      // 原资源的纹理、顶点色和材质 Alpha 均为 1；头尾差异由 RGB
      // Gradient × Stretch 纹理产生，不能再用全局 Alpha 把头部一并压暗。
      trailEmissionAlpha: 1,
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
    softwareBloomEnabled: true,
    maxDpr: 2,
    touchAction: 'auto',
  },
);

/**
 * 每个引擎实例持有独立的运行配置；Unity 参数本身保持只读。
 * @param {object} [overrides]
 * @returns {object}
 */
export function createConfig(overrides = {})
{
  return {
    ...CONFIG,
    ...overrides,
  };
}
