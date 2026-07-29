const REFERENCE_HEIGHT = 1080;
const REFERENCE_ORTHOGRAPHIC_SIZE = 1;
const WORLD_TO_REFERENCE_PIXELS =
  REFERENCE_HEIGHT / (REFERENCE_ORTHOGRAPHIC_SIZE * 2);
const SHARD_LOCAL_SCALE = 0.3078824;
const SHARD_UNIT_TO_REFERENCE_PIXELS =
  WORLD_TO_REFERENCE_PIXELS * SHARD_LOCAL_SCALE;
const RING_MESH_OUTER_RADIUS = 1.0636684;
const DEFAULT_EFFECT_BACKEND = 'webgl2';
const EFFECT_BACKENDS = new Set(['canvas2d', 'webgl2', 'auto']);
const DEFAULT_BLOOM_BACKEND = 'webgl2';
const BLOOM_BACKENDS = new Set(['auto', 'software', 'webgl2', 'native']);
const INPUT_SOURCES = new Set(['dom', 'manual']);
const DEFAULT_OUTPUT_COMPOSITING = 'scene';
const OUTPUT_COMPOSITING_MODES = new Set([
  'scene',
  'transparent-overlay',
]);

// 主题色属于宿主配置状态；固定导出游戏蓝可避免各适配层重复写常量。
export const DEFAULT_THEME_COLOR = '#4ca7ff';

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
        // OriginalPrefab 序列化的是归一化 float；保留乘 255 后的小数，
        // 避免在进入 Linear 色彩空间前先被 8-bit 整数量化。
        [0.1205921, [0.24056602 * 255, 0.39061815 * 255, 255]],
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
      // Circle_01 按 sRGB 导入；Shader 采样得到线性 R 后又乘一次 R，
      // 因此这里保存 R_linear²，调用方开方即可恢复 Coverage 使用的 R_linear。
      textureRadialEnergyKeys:
      [
        [0, 1],
        [0.84, 1],
        [0.88, 1],
        [0.885, 0.127021063],
        [0.89, 0.029392051],
        [0.895, 0.010453372],
        [0.9, 0.003970262],
        [0.905, 0.000231299],
        [0.91, 0.000026848],
        [0.915, 0.000002303],
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
        [0.5000076, [0.2971698 * 255, 0.6532865 * 255, 255]],
        [1, [0.2971698 * 255, 0.6532865 * 255, 255]],
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
      // FX_TEX_Triangle_02_1 是 2×1 图集；共享纹理保存左侧单帧，
      // 右侧帧与左帧仅垂直翻转，由各后端在运行时还原。
      // 这些实测边界仅供不支持纹理 Canvas 的兼容回退使用。
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
        [0.282353, [0.3726415 * 255, 0.7731873 * 255, 255]],
        [0.4617685, [0.37254903 * 255, 0.7725491 * 255, 255]],
        [0.6617685, [0.3529412 * 255, 0.7294118 * 255, 0.9450981 * 255]],
        [0.8264744, [0.37254903 * 255, 0.7725491 * 255, 255]],
        [1, [0.37254903 * 255, 0.7725491 * 255, 255]],
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
      // 原 Ring (4) 的 maxNumParticles=50，作用域是每个 FX_Touch 实例。
      maxCount: 50,
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

export const FX_PARAM_SCHEMA_VERSION = 1;

const FX_PARAM_GROUP_ORDERS = Object.freeze(
  {
    hit: 10,
    flare: 20,
    disk: 30,
    rings: 40,
    shards: 50,
    trail: 60,
    bloom: 70,
  },
);

const FX_PARAM_ORDERS = Object.freeze(
  {
    'hit.enabled': 10,
    'hit.lifetimeMs': 20,
    'hit.radius': 30,
    'flare.enabled': 40,
    'flare.lifetimeMs': 50,
    'flare.radius': 60,
    'flare.rayCount': 70,
    'disk.lifetimeMs': 80,
    'disk.radius': 90,
    'rings.count': 100,
    'rings.lifetimeMs': 110,
    'rings.radiusMin': 120,
    'rings.radiusMax': 130,
    'rings.bandToOuterRadius': 140,
    'rings.widthStart': 150,
    'rings.widthEnd': 160,
    'rings.angularVelocityMultiplier': 170,
    'rings.rotationDirection': 180,
    'rings.hdrIntensity': 190,
    'rings.arcSamples': 200,
    'rings.radialSamples': 210,
    'rings.dissolveDirection': 220,
    'shards.hdrIntensity': 230,
    'shards.clickCount': 240,
    'shards.clickLifetimeMinMs': 250,
    'shards.clickLifetimeMaxMs': 260,
    'shards.clickRadius': 270,
    'shards.clickSpeedMin': 280,
    'shards.clickSpeedMax': 290,
    'shards.trailLifetimeMinMs': 300,
    'shards.trailLifetimeMaxMs': 310,
    'shards.trailRadius': 320,
    'shards.trailSpeedMin': 330,
    'shards.trailSpeedMax': 340,
    'shards.sizeMin': 350,
    'shards.sizeMax': 360,
    'shards.trailSpacing': 370,
    'shards.maxCount': 380,
    'trail.lifetimeMs': 390,
    'trail.geometryWidth': 400,
    'trail.width': 410,
    'trail.minVertexDistance': 420,
    'trail.numCornerVertices': 430,
    'trail.numCapVertices': 440,
    'trail.outerGlowWidth': 450,
    'trail.trailOpacity': 460,
    'bloom.threshold': 470,
    'bloom.softKnee': 480,
    'bloom.clamp': 490,
    'bloom.intensity': 500,
    'bloom.diffusion': 510,
    'bloom.resolutionScale': 520,
    'bloom.emissionRange': 530,
    'bloom.diskEmission': 540,
    'bloom.trailEmission': 550,
    'bloom.trailCoverageScale': 560,
    'bloom.trailEmissionAlpha': 570,
    'bloom.clickEmissionScale': 580,
    'bloom.ringEmissionAlpha': 590,
    'bloom.diskEmissionAlpha': 600,
    'bloom.ringBlur': 610,
    'bloom.ringAlpha': 620,
    'bloom.diskBlur': 630,
    'bloom.diskAlpha': 640,
    'bloom.trailAlpha': 650,
  },
);

const LEGACY_FX_PARAM_DEFAULTS = Object.freeze(
  {
    // Legacy 只替换 Canvas 拖尾主体宽度与外层辉光，其他公开参数沿用 Unity 真值。
    'trail.width': 4,
    'bloom.trailAlpha': 0,
  },
);

const FX_PARAM_DISPLAY_RANGES = Object.freeze(
  {
    'hit.lifetimeMs': [20, 200, 1],
    'hit.radius': [10, 60, 0.01],
    'flare.lifetimeMs': [50, 300, 1],
    'flare.radius': [10, 80, 0.01],
    'flare.rayCount': [3, 12, 1],
    'disk.lifetimeMs': [50, 500, 1],
    'disk.radius': [20, 120, 0.01],
    'rings.count': [0, 6, 1],
    'rings.lifetimeMs': [50, 2000, 1],
    'rings.radiusMin': [20, 120, 0.01],
    'rings.radiusMax': [20, 120, 0.01],
    'rings.bandToOuterRadius': [0.01, 0.2, 0.0001],
    'rings.widthStart': [0.25, 2, 0.01],
    'rings.widthEnd': [0.25, 2, 0.01],
    'rings.angularVelocityMultiplier': [1, 30, 0.01],
    'rings.rotationDirection': [-1, 1, 2],
    'rings.hdrIntensity': [0, 8, 0.01],
    'rings.arcSamples': [24, 192, 1],
    'rings.radialSamples': [2, 16, 1],
    'rings.dissolveDirection': [-1, 1, 2],
    'shards.hdrIntensity': [0, 8, 0.01],
    'shards.clickCount': [0, 12, 1],
    'shards.clickLifetimeMinMs': [100, 1000, 1],
    'shards.clickLifetimeMaxMs': [100, 1000, 1],
    'shards.clickRadius': [0, 200, 0.01],
    'shards.clickSpeedMin': [0, 200, 0.01],
    'shards.clickSpeedMax': [0, 200, 0.01],
    'shards.trailLifetimeMinMs': [50, 500, 1],
    'shards.trailLifetimeMaxMs': [50, 500, 1],
    'shards.trailRadius': [0, 100, 0.01],
    'shards.trailSpeedMin': [0, 150, 0.01],
    'shards.trailSpeedMax': [0, 150, 0.01],
    'shards.sizeMin': [0, 100, 0.01],
    'shards.sizeMax': [0, 100, 0.01],
    'shards.trailSpacing': [10, 500, 0.01],
    'shards.maxCount': [0, 500, 1],
    'trail.lifetimeMs': [50, 2000, 1],
    'trail.geometryWidth': [1, 8, 0.01],
    'trail.width': [1, 25, 0.01],
    'trail.minVertexDistance': [1, 20, 0.01],
    'trail.numCornerVertices': [0, 12, 1],
    'trail.numCapVertices': [0, 6, 1],
    'trail.outerGlowWidth': [1, 40, 0.1],
    'trail.trailOpacity': [0, 1, 0.01],
    'bloom.threshold': [0, 5, 0.01],
    'bloom.softKnee': [0, 1, 0.01],
    'bloom.clamp': [1, 65504, 1],
    'bloom.intensity': [0, 2, 0.01],
    'bloom.diffusion': [0, 10, 0.01],
    'bloom.resolutionScale': [0.1, 0.75, 0.01],
    'bloom.emissionRange': [1, 64, 0.01],
    'bloom.diskEmission': [0, 8, 0.01],
    'bloom.trailEmission': [0, 64, 0.01],
    'bloom.trailCoverageScale': [0, 4, 0.01],
    'bloom.trailEmissionAlpha': [0, 1, 0.01],
    'bloom.clickEmissionScale': [0, 4, 0.01],
    'bloom.ringEmissionAlpha': [0, 1, 0.01],
    'bloom.diskEmissionAlpha': [0, 1, 0.01],
    'bloom.ringBlur': [0, 200, 0.1],
    'bloom.ringAlpha': [0, 1, 0.01],
    'bloom.diskBlur': [0, 200, 0.1],
    'bloom.diskAlpha': [0, 1, 0.01],
    'bloom.trailAlpha': [0, 1, 0.01],
  },
);

const FX_PARAM_LINKS = Object.freeze(
  {
    'rings.radiusMin': ['rings.radiusMax'],
    'rings.radiusMax': ['rings.radiusMin'],
    'rings.widthStart': ['rings.widthEnd'],
    'rings.widthEnd': ['rings.widthStart'],
    'shards.clickLifetimeMinMs': ['shards.clickLifetimeMaxMs'],
    'shards.clickLifetimeMaxMs': ['shards.clickLifetimeMinMs'],
    'shards.clickSpeedMin': ['shards.clickSpeedMax'],
    'shards.clickSpeedMax': ['shards.clickSpeedMin'],
    'shards.trailLifetimeMinMs': ['shards.trailLifetimeMaxMs'],
    'shards.trailLifetimeMaxMs': ['shards.trailLifetimeMinMs'],
    'shards.trailSpeedMin': ['shards.trailSpeedMax'],
    'shards.trailSpeedMax': ['shards.trailSpeedMin'],
    'shards.sizeMin': ['shards.sizeMax'],
    'shards.sizeMax': ['shards.sizeMin'],
  },
);

function freezeFxParamMetadata(value)
{
  if (value === null || typeof value !== 'object' || Object.isFrozen(value))
  {
    return value;
  }

  for (const child of Object.values(value))
  {
    freezeFxParamMetadata(child);
  }

  return Object.freeze(value);
}

function createFxParamDescriptor(path, type, options = {})
{
  const keys = path.split('.');
  let defaultValue = UNITY_FX_TOUCH;

  for (const key of keys)
  {
    defaultValue = defaultValue[key];
  }

  return (
    {
      path,
      type,
      default: defaultValue,
      ...options,
    }
  );
}

function finalizeFxParamDescriptor(descriptor)
{
  const group = descriptor.path.split('.')[0];
  const displayRange = FX_PARAM_DISPLAY_RANGES[descriptor.path];
  const legacyDefault = Object.hasOwn(
    LEGACY_FX_PARAM_DEFAULTS,
    descriptor.path,
  )
    ? LEGACY_FX_PARAM_DEFAULTS[descriptor.path]
    : descriptor.default;

  const result =
  {
    ...descriptor,
    // 显式序号是持久化契约，新参数可使用预留空档而不重排旧控件。
    order: FX_PARAM_ORDERS[descriptor.path],
    group,
    groupOrder: FX_PARAM_GROUP_ORDERS[group],
    labelKey: `baClickFx.params.${descriptor.path}`,
    groupLabelKey: `baClickFx.paramGroups.${group}`,
    linkedParams: FX_PARAM_LINKS[descriptor.path] ?? [],
    modeDefaults:
    {
      enhanced: descriptor.default,
      legacy: legacyDefault,
    },
  };

  if (displayRange)
  {
    result.display =
    {
      min: displayRange[0],
      max: displayRange[1],
      step: displayRange[2],
    };
  }

  return result;
}

/**
 * 可由宿主安全修改的公开标量参数。曲线、颜色键与纹理采样数据仍由
 * Unity 资源真值独占，避免通用配置界面破坏渲染器之间的共同契约。
 */
export const FX_PARAM_SCHEMA = freezeFxParamMetadata(
  [
    createFxParamDescriptor('hit.enabled', 'boolean', { unit: 'boolean' }),
    createFxParamDescriptor(
      'hit.lifetimeMs',
      'number',
      { min: 1, max: 10000, step: 1, unit: 'ms' },
    ),
    createFxParamDescriptor(
      'hit.radius',
      'number',
      { min: 1, max: 2000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor('flare.enabled', 'boolean', { unit: 'boolean' }),
    createFxParamDescriptor(
      'flare.lifetimeMs',
      'number',
      { min: 1, max: 10000, step: 1, unit: 'ms' },
    ),
    createFxParamDescriptor(
      'flare.radius',
      'number',
      { min: 1, max: 2000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'flare.rayCount',
      'number',
      { min: 1, max: 64, step: 1, unit: 'count' },
    ),
    createFxParamDescriptor(
      'disk.lifetimeMs',
      'number',
      { min: 1, max: 10000, step: 1, unit: 'ms' },
    ),
    createFxParamDescriptor(
      'disk.radius',
      'number',
      { min: 1, max: 2000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'rings.count',
      'number',
      { min: 0, max: 64, step: 1, unit: 'count' },
    ),
    createFxParamDescriptor(
      'rings.lifetimeMs',
      'number',
      { min: 1, max: 10000, step: 1, unit: 'ms' },
    ),
    createFxParamDescriptor(
      'rings.radiusMin',
      'number',
      { min: 0, max: 2000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'rings.radiusMax',
      'number',
      { min: 0, max: 2000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'rings.bandToOuterRadius',
      'number',
      { min: 0, max: 1, step: 0.0001, unit: 'ratio' },
    ),
    createFxParamDescriptor(
      'rings.widthStart',
      'number',
      { min: 0, max: 8, step: 0.01, unit: 'multiplier' },
    ),
    createFxParamDescriptor(
      'rings.widthEnd',
      'number',
      { min: 0, max: 8, step: 0.01, unit: 'multiplier' },
    ),
    createFxParamDescriptor(
      'rings.angularVelocityMultiplier',
      'number',
      { min: 0, max: 100, step: 0.01, unit: 'multiplier' },
    ),
    createFxParamDescriptor(
      'rings.rotationDirection',
      'number',
      { min: -1, max: 1, step: 2, unit: 'direction' },
    ),
    createFxParamDescriptor(
      'rings.hdrIntensity',
      'number',
      { min: 0, max: 64, step: 0.01, unit: 'linear-hdr' },
    ),
    createFxParamDescriptor(
      'rings.arcSamples',
      'number',
      { min: 3, max: 1024, step: 1, unit: 'samples' },
    ),
    createFxParamDescriptor(
      'rings.radialSamples',
      'number',
      { min: 1, max: 32, step: 1, unit: 'samples' },
    ),
    createFxParamDescriptor(
      'rings.dissolveDirection',
      'number',
      { min: -1, max: 1, step: 2, unit: 'direction' },
    ),
    createFxParamDescriptor(
      'shards.hdrIntensity',
      'number',
      { min: 0, max: 64, step: 0.01, unit: 'linear-hdr' },
    ),
    createFxParamDescriptor(
      'shards.clickCount',
      'number',
      { min: 0, max: 1000, step: 1, unit: 'count' },
    ),
    createFxParamDescriptor(
      'shards.clickLifetimeMinMs',
      'number',
      { min: 1, max: 10000, step: 1, unit: 'ms' },
    ),
    createFxParamDescriptor(
      'shards.clickLifetimeMaxMs',
      'number',
      { min: 1, max: 10000, step: 1, unit: 'ms' },
    ),
    createFxParamDescriptor(
      'shards.clickRadius',
      'number',
      { min: 0, max: 5000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'shards.clickSpeedMin',
      'number',
      { min: 0, max: 5000, step: 0.01, unit: 'px-per-second' },
    ),
    createFxParamDescriptor(
      'shards.clickSpeedMax',
      'number',
      { min: 0, max: 5000, step: 0.01, unit: 'px-per-second' },
    ),
    createFxParamDescriptor(
      'shards.trailLifetimeMinMs',
      'number',
      { min: 1, max: 10000, step: 1, unit: 'ms' },
    ),
    createFxParamDescriptor(
      'shards.trailLifetimeMaxMs',
      'number',
      { min: 1, max: 10000, step: 1, unit: 'ms' },
    ),
    createFxParamDescriptor(
      'shards.trailRadius',
      'number',
      { min: 0, max: 5000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'shards.trailSpeedMin',
      'number',
      { min: 0, max: 5000, step: 0.01, unit: 'px-per-second' },
    ),
    createFxParamDescriptor(
      'shards.trailSpeedMax',
      'number',
      { min: 0, max: 5000, step: 0.01, unit: 'px-per-second' },
    ),
    createFxParamDescriptor(
      'shards.sizeMin',
      'number',
      { min: 0, max: 2000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'shards.sizeMax',
      'number',
      { min: 0, max: 2000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'shards.trailSpacing',
      'number',
      { min: 1, max: 5000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'shards.maxCount',
      'number',
      { min: 0, max: 10000, step: 1, unit: 'count' },
    ),
    createFxParamDescriptor(
      'trail.lifetimeMs',
      'number',
      { min: 1, max: 10000, step: 1, unit: 'ms' },
    ),
    createFxParamDescriptor(
      'trail.geometryWidth',
      'number',
      { min: 0, max: 1000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'trail.width',
      'number',
      { min: 0, max: 1000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'trail.minVertexDistance',
      'number',
      { min: 0, max: 5000, step: 0.01, unit: 'px' },
    ),
    createFxParamDescriptor(
      'trail.numCornerVertices',
      'number',
      { min: 0, max: 64, step: 1, unit: 'count' },
    ),
    createFxParamDescriptor(
      'trail.numCapVertices',
      'number',
      { min: 0, max: 64, step: 1, unit: 'count' },
    ),
    createFxParamDescriptor(
      'trail.outerGlowWidth',
      'number',
      { min: 0, max: 1000, step: 0.1, unit: 'px' },
    ),
    createFxParamDescriptor(
      'trail.trailOpacity',
      'number',
      { min: 0, max: 1, step: 0.01, unit: 'ratio' },
    ),
    createFxParamDescriptor(
      'bloom.threshold',
      'number',
      { min: 0, max: 64, step: 0.01, unit: 'gamma-hdr' },
    ),
    createFxParamDescriptor(
      'bloom.softKnee',
      'number',
      { min: 0, max: 1, step: 0.01, unit: 'ratio' },
    ),
    createFxParamDescriptor(
      'bloom.clamp',
      'number',
      { min: 0, max: 65504, step: 1, unit: 'gamma-hdr' },
    ),
    createFxParamDescriptor(
      'bloom.intensity',
      'number',
      { min: 0, max: 10, step: 0.01, unit: 'scalar' },
    ),
    createFxParamDescriptor(
      'bloom.diffusion',
      'number',
      { min: 0, max: 10, step: 0.01, unit: 'scalar' },
    ),
    createFxParamDescriptor(
      'bloom.resolutionScale',
      'number',
      { min: 0.1, max: 0.75, step: 0.01, unit: 'ratio' },
    ),
    createFxParamDescriptor(
      'bloom.emissionRange',
      'number',
      { min: 1, max: 65504, step: 0.01, unit: 'linear-hdr' },
    ),
    createFxParamDescriptor(
      'bloom.diskEmission',
      'number',
      { min: 0, max: 64, step: 0.01, unit: 'linear-hdr' },
    ),
    createFxParamDescriptor(
      'bloom.trailEmission',
      'number',
      { min: 0, max: 65504, step: 0.01, unit: 'linear-hdr' },
    ),
    createFxParamDescriptor(
      'bloom.trailCoverageScale',
      'number',
      { min: 0, max: 8, step: 0.01, unit: 'multiplier' },
    ),
    createFxParamDescriptor(
      'bloom.trailEmissionAlpha',
      'number',
      { min: 0, max: 1, step: 0.01, unit: 'ratio' },
    ),
    createFxParamDescriptor(
      'bloom.clickEmissionScale',
      'number',
      { min: 0, max: 4, step: 0.01, unit: 'multiplier' },
    ),
    createFxParamDescriptor(
      'bloom.ringEmissionAlpha',
      'number',
      { min: 0, max: 1, step: 0.01, unit: 'ratio' },
    ),
    createFxParamDescriptor(
      'bloom.diskEmissionAlpha',
      'number',
      { min: 0, max: 1, step: 0.01, unit: 'ratio' },
    ),
    createFxParamDescriptor(
      'bloom.ringBlur',
      'number',
      { min: 0, max: 1000, step: 0.1, unit: 'px' },
    ),
    createFxParamDescriptor(
      'bloom.ringAlpha',
      'number',
      { min: 0, max: 1, step: 0.01, unit: 'ratio' },
    ),
    createFxParamDescriptor(
      'bloom.diskBlur',
      'number',
      { min: 0, max: 1000, step: 0.1, unit: 'px' },
    ),
    createFxParamDescriptor(
      'bloom.diskAlpha',
      'number',
      { min: 0, max: 1, step: 0.01, unit: 'ratio' },
    ),
    createFxParamDescriptor(
      'bloom.trailAlpha',
      'number',
      { min: 0, max: 1, step: 0.01, unit: 'ratio' },
    ),
  ].map(finalizeFxParamDescriptor),
);

/**
 * Schema 版本间的纯数据迁移规则。宿主按版本顺序执行 changes，
 * 不需要加载渲染引擎就能升级持久化配置。
 */
export const FX_PARAM_MIGRATIONS = freezeFxParamMetadata(
  [
    {
      fromVersion: 0,
      toVersion: 1,
      changes:
      [
        {
          kind: 'replace',
          from: 'bloom.scatter',
          to: 'bloom.diffusion',
          source:
          {
            type: 'number',
            min: 0,
          },
          // 旧 API 接受任意非负有限值；新旧参数无等价换算，统一恢复默认值。
          value: UNITY_FX_TOUCH.bloom.diffusion,
        },
      ],
    },
  ],
);

export const CONFIG = Object.freeze(
  {
    scale: 1,
    opacity: 1,
    themeColor: DEFAULT_THEME_COLOR,
    clickEnabled: true,
    trailEnabled: true,
    trailAlways: false,
    inputSource: 'dom',
    clickTimeScale: 1,
    trailTimeScale: 1,
    // 默认保留 Unity Scene 合成；透明桌面宿主必须显式选择覆盖层输出。
    outputCompositing: DEFAULT_OUTPUT_COMPOSITING,
    // 默认由纯 WebGL2 接管完整 Scene；能力不足时运行时安全回退 Canvas2D。
    effectBackend: DEFAULT_EFFECT_BACKEND,
    // 两种模式都按 Unity Linear/HDR 真值绘制清晰主体；Legacy 仅把 Bloom
    // 替换为兼容性更高的 Canvas shadowBlur，并保留旧版拖尾合成风格。
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

export function isEffectBackend(value)
{
  return EFFECT_BACKENDS.has(value);
}

export function normalizeEffectBackend(value, fallback = DEFAULT_EFFECT_BACKEND)
{
  return isEffectBackend(value) ? value : fallback;
}

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

export function isOutputCompositing(value)
{
  return OUTPUT_COMPOSITING_MODES.has(value);
}

export function normalizeOutputCompositing(
  value,
  fallback = DEFAULT_OUTPUT_COMPOSITING,
)
{
  return isOutputCompositing(value) ? value : fallback;
}

export function normalizeTimeScale(value, fallback = 1)
{
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function normalizeThemeColor(value, fallback = DEFAULT_THEME_COLOR)
{
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value))
  {
    return fallback;
  }

  return value.toLowerCase();
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
  const compatibilityEffectBackend =
    isBloomBackend(overrides.bloomBackend) ||
    typeof overrides.softwareBloomEnabled === 'boolean'
      ? 'canvas2d'
      : CONFIG.effectBackend;
  const effectBackend = normalizeEffectBackend(
    overrides.effectBackend,
    compatibilityEffectBackend,
  );
  const clickTimeScale = normalizeTimeScale(
    overrides.clickTimeScale,
    CONFIG.clickTimeScale,
  );
  const trailTimeScale = normalizeTimeScale(
    overrides.trailTimeScale,
    CONFIG.trailTimeScale,
  );
  const outputCompositing = normalizeOutputCompositing(
    overrides.outputCompositing,
    CONFIG.outputCompositing,
  );
  const themeColor = normalizeThemeColor(
    overrides.themeColor,
    CONFIG.themeColor,
  );

  return {
    ...CONFIG,
    ...overrides,
    inputSource,
    effectBackend,
    clickTimeScale,
    trailTimeScale,
    outputCompositing,
    themeColor,
    bloomBackend,
    softwareBloomEnabled: bloomBackend !== 'native',
    isolatedCompositing: typeof overrides.isolatedCompositing === 'boolean'
      ? overrides.isolatedCompositing
      : CONFIG.isolatedCompositing,
  };
}
