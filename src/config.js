/**
 * FX_Touch 的 Unity 2021.3 粒子参数。
 *
 * 数值统一换算到 1920x1080 画面中的 CSS 像素；运行时只按画面高度缩放。
 * 这里保留游戏参数而不是暴露调色面板，避免演示页和运行逻辑再次产生两套真值。
 */
export const UNITY_FX_TOUCH = Object.freeze(
  {
    referenceHeight: 1080,
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
      angularVelocityMin: 6,
      angularVelocityMax: 11,
      // Canvas 正角度在屏幕坐标中表现为顺时针，因此用 -1 还原游戏逆时针方向。
      rotationDirection: -1,
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
      // Shader 的溶解阈值沿网格 UV 推进：起点保持完整，只有活动端形成软边。
      dissolveEdgeRatio: 0.1,
    },
    shards:
    {
      clickCount: 4,
      clickLifetimeMinMs: 600,
      clickLifetimeMaxMs: 700,
      clickRadius: 37,
      clickSpeedMin: 108,
      clickSpeedMax: 144,
      trailLifetimeMinMs: 200,
      trailLifetimeMaxMs: 400,
      trailRadius: 18,
      trailSpeedMin: 80,
      trailSpeedMax: 120,
      sizeMin: 12,
      sizeMax: 25,
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
      // 0.005 世界单位在 1.35 正交相机下是 2px 几何带；原材质 23.968628
      // 倍 HDR 亮度经过 Bloom 后会形成约 3px 的可见亮芯。
      geometryWidth: 2,
      width: 3,
      minVertexDistance: 4,
      outerGlowWidth: 7,
      coreWidth: 1.25,
      gradient:
      [
        [0, [0, 0, 0]],
        [0.5794156, [0, 24, 72]],
        // HDR 加法材质会把原始 (0, 0.391, 1) 的头部压到青白高光。
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
