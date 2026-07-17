const REFERENCE_HEIGHT = 1080;
const REFERENCE_ORTHOGRAPHIC_SIZE = 1.35;
const WORLD_TO_REFERENCE_PIXELS =
  REFERENCE_HEIGHT / (REFERENCE_ORTHOGRAPHIC_SIZE * 2);
const SHARD_LOCAL_SCALE = 0.3078824;
const SHARD_UNIT_TO_REFERENCE_PIXELS =
  WORLD_TO_REFERENCE_PIXELS * SHARD_LOCAL_SCALE;

// 游戏相机 orthographicSize 实际约 1.47，代码中声明的 1.35 导致所有
// 世界单位→像素的硬编码常量整体偏大约 8%；此因子统一修正到游戏视觉比例。
export const SIZE_CORRECTION = 0.92;

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
      gradient:
      [
        // 统一蓝色调，尾部靠 fadeAlpha 透明淡出，避免浅色背景灰色伪影
        [0, [0, 100, 220]],
        [0.5794156, [0, 150, 235]],
        [0.9794156, [0, 238, 255]],
        [1, [0, 238, 255]],
      ],
    },
    bloom:
    {
      ringBlur: 7,
      ringAlpha: 0.22,
      diskBlur: 8,
      shardBlur: 5,
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
