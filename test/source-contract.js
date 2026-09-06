/**
 * 源码入口与 Unity 资源合同。
 *
 * 运行时 Smoke 只验证 dist；这里保留源码、资源和 Shader 的静态真值，
 * 避免同一套生命周期断言在 src 与 dist 上完整执行两次。
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BAClickFX } from '../src/fx.js';
import { UNITY_FX_TOUCH } from '../src/config.js';
import {
  RING3_ALPHA,
  RING3_ALPHA_HEIGHT,
  RING3_ALPHA_WIDTH,
  sampleRing3Alpha,
} from '../src/ring3-alpha.js';
import {
  CIRCLE_TEXTURE_RGBA,
  CIRCLE_TEXTURE_SIZE,
} from '../src/circle-texture.js';
import {
  TRAIL_TEXTURE_COVERAGE,
  TRAIL_TEXTURE_HEIGHT,
  TRAIL_TEXTURE_RGB,
  TRAIL_TEXTURE_RGBA,
  TRAIL_TEXTURE_WIDTH,
} from '../src/trail-texture.js';
import {
  evaluateTrailLongitudinalCoverage,
  evaluateTrailTextureCoverageProfile,
} from '../src/trail-coverage.js';
import {
  createRoundedTriangleCoverage,
  sampleRoundedTriangleCoverage,
  TRIANGLE_TEXTURE_COVERAGE,
  TRIANGLE_TEXTURE_OVERLAY_RGBA,
  TRIANGLE_TEXTURE_RGBA,
  TRIANGLE_TEXTURE_SIZE,
} from '../src/triangle-texture.js';

// Unity Prefab serialization values stay in the source-only contract.
assert(UNITY_FX_TOUCH.rootDurationMs === 1000, '根粒子持续 1 秒');
assert(UNITY_FX_TOUCH.disk.lifetimeMs === 200, '短圆盘持续 0.2 秒');
// OriginalPrefab 直接序列化归一化 float；完整数组断言避免未来再次把
// 启用粒子的 RGB 提前取整成 8-bit 近似值。
const originalPrefabEnabledColorKeys =
[
  [
    [0, [255, 255, 255]],
    [0.1205921, [0.24056602 * 255, 0.39061815 * 255, 255]],
  ],
  [
    [0.1117723, [255, 255, 255]],
    [0.5000076, [0.2971698 * 255, 0.6532865 * 255, 255]],
    [1, [0.2971698 * 255, 0.6532865 * 255, 255]],
  ],
  [
    [0, [255, 255, 255]],
    [0.1823606, [255, 255, 255]],
    [0.282353, [0.3726415 * 255, 0.7731873 * 255, 255]],
    [0.4617685, [0.37254903 * 255, 0.7725491 * 255, 255]],
    [0.6617685, [0.3529412 * 255, 0.7294118 * 255, 0.9450981 * 255]],
    [0.8264744, [0.37254903 * 255, 0.7725491 * 255, 255]],
    [1, [0.37254903 * 255, 0.7725491 * 255, 255]],
  ],
];

assert(
  JSON.stringify(
    [
      UNITY_FX_TOUCH.disk.colorKeys,
      UNITY_FX_TOUCH.rings.colorKeys,
      UNITY_FX_TOUCH.shards.colorKeys,
    ],
  ) === JSON.stringify(originalPrefabEnabledColorKeys),
  '启用粒子的 Gradient RGB 保留 OriginalPrefab 归一化 float 真值',
);
assert(
  JSON.stringify(UNITY_FX_TOUCH.disk.sizeKeys) === JSON.stringify(
    [
      [0, 0.32583582, 2.4004734, 2.4004734],
      [0.21392822, 0.7159773, 0.9115745, 0.9115745],
      [1, 1, 0, 0],
    ],
  ),
  '短圆盘尺寸保留 Unity 的四字段 Hermite 关键帧',
);
assert(UNITY_FX_TOUCH.rings.count === 2, 'MeshTri burst 一次生成 2 枚圆环');
assert(UNITY_FX_TOUCH.rings.lifetimeMs === 600, '溶解圆环持续 0.6 秒');
assert(UNITY_FX_TOUCH.rings.rotationDirection === -1, '两枚圆环只按逆时针方向旋转');
assert(
  UNITY_FX_TOUCH.rings.angularVelocityMultiplier === 11.170107 &&
    UNITY_FX_TOUCH.rings.angularVelocityMinKeys[1][1] === 0.45561826 &&
    UNITY_FX_TOUCH.rings.angularVelocityMaxKeys[1][1] === -0.06509134,
  '圆环角速度使用 Unity Rotation over Lifetime 的两条衰减曲线',
);
assert(
  UNITY_FX_TOUCH.rings.hdrIntensity === 5.992157,
  '圆环使用 FX_MAT_Touch_Tri3 的原始白色 HDR 强度',
);
assert(UNITY_FX_TOUCH.rings.arcSamples > 0, '圆环使用连续环带而不是离散短弧');
assert(
  JSON.stringify(UNITY_FX_TOUCH.rings.sizeKeys) === JSON.stringify(
    [
      [0.007209778, 0.42050898, 2.4004734, 2.4004734],
      [0.21392822, 0.7159773, 0.9115745, 0.9115745],
      [1, 1, 0, 0],
    ],
  ) &&
    JSON.stringify(UNITY_FX_TOUCH.rings.dissolveKeys) === JSON.stringify(
      [
        [0, 1, 0, 0],
        [0.2, 0, 0, 2.4249368],
        [1, 1, 0.27735636, 0.27735636],
      ],
    ),
  '圆环尺寸与溶解曲线保留 Unity 的四字段 Hermite 关键帧',
);
assert(
  UNITY_FX_TOUCH.rings.bandToOuterRadius === 0.0598573766034603 &&
    UNITY_FX_TOUCH.rings.widthStart === 1 &&
    UNITY_FX_TOUCH.rings.widthEnd === 1,
  '圆环宽度按 MeshTri 外半径比例计算，生命周期倍率保持 1',
);
assert(
  UNITY_FX_TOUCH.rings.textureUvMin === 0.0005000000237487257 &&
    UNITY_FX_TOUCH.rings.textureUvMax === 0.999500036239624,
  '圆环使用 Cylinder002 导出的精确 UV 范围采样 Ring3 Alpha',
);

assert(UNITY_FX_TOUCH.shards.clickCount === 4, '点击 burst 固定生成 4 枚碎片');
assert(
  Math.abs(UNITY_FX_TOUCH.shards.clickSpeedMin - 49.8769488) < 0.000001 &&
    Math.abs(UNITY_FX_TOUCH.shards.clickSpeedMax - 66.5025984) < 0.000001,
  '点击碎片速度包含 ParticleSystem 的 0.3078824 Local 缩放',
);
assert(
  Math.abs(UNITY_FX_TOUCH.shards.trailSpeedMin - 33.2512992) < 0.000001 &&
    Math.abs(UNITY_FX_TOUCH.shards.trailSpeedMax - 49.8769488) < 0.000001,
  '拖拽碎片速度包含 ParticleSystem 的 0.3078824 Local 缩放',
);
assert(
  UNITY_FX_TOUCH.shards.hdrIntensity === 5.992157 &&
    UNITY_FX_TOUCH.shards.startColor.every(
      (channel) => channel === 0.5377358,
    ),
  '碎片同时保留材质 HDR 与 ParticleSystem 起始色',
);
assert(
  JSON.stringify(UNITY_FX_TOUCH.shards.sizeKeys) === JSON.stringify(
    [
      [0, 0, 0, 0],
      [0.15445095, 1, 0, 0],
      [1, 0, -2.1621501, -2.1621501],
    ],
  ) &&
    UNITY_FX_TOUCH.shards.textureFrames.length === 2 &&
    UNITY_FX_TOUCH.shards.textureFrames[0][1][0] === 0.48046875,
  '碎片使用 Unity Hermite 尺寸曲线与 2×1 图集的实测轮廓',
);
assert(UNITY_FX_TOUCH.shards.trailSpacing === 108, '拖拽每 108px 生成一枚碎片');
assert(
  UNITY_FX_TOUCH.shards.maxCount === 50,
  'Ring (4) 保留 Prefab 每个 FX_Touch 实例 50 枚粒子上限',
);
assert(UNITY_FX_TOUCH.trail.lifetimeMs === 300, 'TrailRenderer.time 为 0.3 秒');
assert(UNITY_FX_TOUCH.trail.geometryWidth === 2.7, '1080p TrailRenderer 几何带宽为 2.7px');
assert(UNITY_FX_TOUCH.trail.width === 2.7, '清晰拖尾本体使用 Unity 的 2.7px 带宽');
assert(
  UNITY_FX_TOUCH.trail.numCornerVertices === 4 &&
    UNITY_FX_TOUCH.trail.numCapVertices === 1,
  'TrailRenderer 使用 4 个圆角插入点和 1 个端帽顶点',
);
assert(
  UNITY_FX_TOUCH.trail.gradient[0][1].every((channel) => channel === 0) &&
    UNITY_FX_TOUCH.trail.gradient.at(-1)[1][2] === 255,
  'TrailRenderer 原 Gradient 已反向为 Canvas 的尾部到头部点序',
);
assert(
  UNITY_FX_TOUCH.trail.textureLongitudinalKeys[0][1] === 0 &&
    UNITY_FX_TOUCH.trail.textureLongitudinalKeys.at(-1)[1] === 1,
  'FX_TEX_Trail_03 的 Stretch 亮度从尾部黑色过渡到头部全亮',
);
assert(
  JSON.stringify(UNITY_FX_TOUCH.trail.coverageLongitudinalKeys) ===
    JSON.stringify(
      [
        [0, 0],
        [0.248532, 0],
        [0.97941558, 1],
        [1, 1],
      ],
    ),
  '透明拖尾使用独立的旧端零 Coverage 与头部完整 Coverage 锚点',
);

const textureMidpoint = UNITY_FX_TOUCH.trail.textureLongitudinalKeys.find(
  ([position]) => Math.abs(position - 0.499022) < 0.000001,
);

assert(
  textureMidpoint && Math.abs(textureMidpoint[1] - 0.144128269) < 0.000001,
  'sRGB 拖尾纹理中点已预转为 Unity Linear 能量',
);
const transverseProfileKeys =
  UNITY_FX_TOUCH.trail.textureTransverseProfileKeys;
const middleTransverseProfile = transverseProfileKeys.find(
  ([position]) => Math.abs(position - 0.624266) < 0.000001,
);
const transverseStopCount = transverseProfileKeys[2][1].length * 2 - 1;
const joinedTrailPathLength =
  UNITY_FX_TOUCH.trail.numCornerVertices + 5;

assert(
  transverseProfileKeys.length === 14 &&
    transverseProfileKeys[0][1].every((value) => value === 0) &&
    middleTransverseProfile[1][6] === 0.1006 &&
    transverseProfileKeys.at(-1)[1][6] === 0.9867,
  '拖尾使用随 Stretch 进度变化的 FX_TEX_Trail_03 二维横截面',
);
assert(
  UNITY_FX_TOUCH.bloom.threshold === 1 &&
    UNITY_FX_TOUCH.bloom.softKnee === 0 &&
    UNITY_FX_TOUCH.bloom.intensity === 1.7 &&
    UNITY_FX_TOUCH.bloom.diffusion === 7 &&
    UNITY_FX_TOUCH.bloom.trailCoverageScale === 1 &&
    !('scatter' in UNITY_FX_TOUCH.bloom) &&
    !('iterations' in UNITY_FX_TOUCH.bloom),
  'Bloom 使用游戏 MXFinalBloom 的原始参数',
);
assert(
  UNITY_FX_TOUCH.bloom.trailEmissionAlpha === 1 &&
    UNITY_FX_TOUCH.bloom.clickEmissionScale === 1 &&
    UNITY_FX_TOUCH.bloom.ringEmissionAlpha === 1 &&
    UNITY_FX_TOUCH.bloom.diskEmissionAlpha === 1 &&
    UNITY_FX_TOUCH.bloom.trailAlpha === 0.18,
  '点击与拖尾发射倍率相互独立，原生阴影回退单独标定',
);
const sourceFiles = {
  fx: readFileSync(new URL('../src/fx.js', import.meta.url), 'utf8'),
  webgl2: readFileSync(
    new URL('../src/webgl2-effect.js', import.meta.url),
    'utf8',
  ),
  webgl2Bloom: readFileSync(
    new URL('../src/webgl2-bloom.js', import.meta.url),
    'utf8',
  ),
  webgpu: readFileSync(
    new URL('../src/webgpu-effect.js', import.meta.url),
    'utf8',
  ),
};

const trailCoverageGolden = JSON.parse(readFileSync(
  new URL('./trail-coverage-golden.json', import.meta.url),
  'utf8',
));

function sha256(value)
{
  return createHash('sha256').update(value).digest('hex');
}

class MockContext
{
  constructor(canvas)
  {
    this.canvas = canvas;
    this.globalCompositeOperation = 'source-over';
    this.globalAlpha = 1;
    this.shadowBlur = 0;
    this.shadowColor = 'transparent';
    this.filter = 'none';
    this.imageSmoothingEnabled = true;
  }

  getImageData(_x, _y, width, height)
  {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    };
  }

  createImageData(width, height)
  {
    return this.getImageData(0, 0, width, height);
  }

  createLinearGradient()
  {
    return { addColorStop() {} };
  }

  createRadialGradient()
  {
    return { addColorStop() {} };
  }

  setTransform() {}
  save() {}
  restore() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  arc() {}
  fill() {}
  stroke() {}
  clearRect() {}
  fillRect() {}
  strokeRect() {}
  drawImage() {}
  putImageData() {}
  scale() {}
  translate() {}
  rotate() {}
}

class MockCanvas
{
  constructor(width = 320, height = 240)
  {
    this.width = width;
    this.height = height;
    this.context = new MockContext(this);
  }

  getContext(type)
  {
    return type === '2d' ? this.context : null;
  }
}

// Node 没有 DOM；注册 Mock OffscreenCanvas 以覆盖源码的 Worker 入口。
globalThis.OffscreenCanvas = MockCanvas;

assert.equal(UNITY_FX_TOUCH.rings.count, 2, '源码入口保留 Unity 圆环数量');
assert.equal(UNITY_FX_TOUCH.shards.clickCount, 4, '源码入口保留 Unity 点击碎片数量');
assert.equal(UNITY_FX_TOUCH.shards.maxCount, 50, '源码入口保留 Unity 拖尾碎片上限');

assert.equal(RING3_ALPHA_WIDTH, 256, 'Ring3 Alpha 宽度保持 256');
assert.equal(RING3_ALPHA_HEIGHT, 128, 'Ring3 Alpha 高度保持 128');
assert.equal(
  sha256(RING3_ALPHA),
  '6c1d74367a72a0ac830b0f5fdd8f0ee93bc9453c9b8c3cc4d470c2becca9d220',
  'Ring3 Alpha 字节合同保持不变',
);
assert.equal(CIRCLE_TEXTURE_SIZE, 512, 'Circle 纹理尺寸保持 512');
assert.equal(CIRCLE_TEXTURE_RGBA.length, 512 * 512 * 4, 'Circle 纹理完整解码');
assert.equal(TRAIL_TEXTURE_WIDTH, 512, 'Trail RGB 宽度保持 512');
assert.equal(TRAIL_TEXTURE_HEIGHT, 512, 'Trail RGB 高度保持 512');
assert.equal(TRAIL_TEXTURE_RGB.length, 512 * 512 * 3, 'Trail RGB 完整解码');
assert.equal(TRAIL_TEXTURE_COVERAGE.length, 512 * 512, 'Trail Coverage 完整解码');
assert.equal(TRAIL_TEXTURE_RGBA.length, 512 * 512 * 4, 'Trail RGBA 完整解码');
assert.equal(
  sha256(TRAIL_TEXTURE_RGB),
  '9ef29db2147501c40c1ff0f1cd0848cd6e017a46b0e8aa0af685eef568d4faa0',
  'Trail RGB 字节合同保持不变',
);
assert.equal(
  sha256(TRAIL_TEXTURE_COVERAGE),
  trailCoverageGolden.sha256,
  'Trail Coverage 字节哈希与 Golden 保持一致',
);
assert.equal(
  trailCoverageGolden.counts.partial,
  123210,
  'Trail Coverage 保留固定的部分覆盖像素数量',
);
assert(
  trailCoverageGolden.samples.every(({ x, y, coverage }) =>
    TRAIL_TEXTURE_COVERAGE[y * TRAIL_TEXTURE_WIDTH + x] === coverage),
  'Trail Coverage Golden 采样保持一致',
);
let trailRgbaMatchesAssets = true;

for (let pixel = 0; pixel < TRAIL_TEXTURE_WIDTH * TRAIL_TEXTURE_HEIGHT; pixel++)
{
  const rgbOffset = pixel * 3;
  const rgbaOffset = pixel * 4;

  if (
    TRAIL_TEXTURE_RGBA[rgbaOffset] !== TRAIL_TEXTURE_RGB[rgbOffset] ||
    TRAIL_TEXTURE_RGBA[rgbaOffset + 1] !== TRAIL_TEXTURE_RGB[rgbOffset + 1] ||
    TRAIL_TEXTURE_RGBA[rgbaOffset + 2] !== TRAIL_TEXTURE_RGB[rgbOffset + 2] ||
    TRAIL_TEXTURE_RGBA[rgbaOffset + 3] !== TRAIL_TEXTURE_COVERAGE[pixel]
  )
  {
    trailRgbaMatchesAssets = false;
    break;
  }
}
assert(trailRgbaMatchesAssets, 'Trail RGBA 只组合原 RGB 与独立 Coverage');
assert(
  TRAIL_TEXTURE_RGB[0] === 5 &&
    TRAIL_TEXTURE_RGB[(13 * TRAIL_TEXTURE_WIDTH + 20) * 3 + 1] === 71 &&
    TRAIL_TEXTURE_RGB[(498 * TRAIL_TEXTURE_WIDTH + 20) * 3 + 1] === 131,
  'Trail RGB 保留非对称逐通道纹理细节',
);
assert.equal(TRIANGLE_TEXTURE_SIZE, 128, 'Triangle 纹理尺寸保持 128');
assert.equal(TRIANGLE_TEXTURE_COVERAGE.length, 128 * 128, 'Triangle Coverage 完整解码');
assert.equal(TRIANGLE_TEXTURE_RGBA.length, 128 * 128 * 4, 'Triangle RGBA 完整解码');
assert.equal(
  sha256(TRIANGLE_TEXTURE_COVERAGE),
  '9c45a4c8a83458648715ac47f758d9a046c65287f09ce124ee88d6f9b0aa39a8',
  'Triangle Coverage 字节哈希保持不变',
);
assert.equal(
  TRIANGLE_TEXTURE_OVERLAY_RGBA.length,
  TRIANGLE_TEXTURE_RGBA.length,
  'Triangle 覆盖纹理保持 RGBA 长度',
);
let triangleOverlayMatchesAssets = true;

for (let index = 0; index < TRIANGLE_TEXTURE_COVERAGE.length; index++)
{
  const offset = index * 4;

  triangleOverlayMatchesAssets &&=
    TRIANGLE_TEXTURE_OVERLAY_RGBA[offset] === TRIANGLE_TEXTURE_RGBA[offset] &&
    TRIANGLE_TEXTURE_OVERLAY_RGBA[offset + 1] ===
      TRIANGLE_TEXTURE_RGBA[offset + 1] &&
    TRIANGLE_TEXTURE_OVERLAY_RGBA[offset + 2] ===
      TRIANGLE_TEXTURE_RGBA[offset + 2] &&
    TRIANGLE_TEXTURE_OVERLAY_RGBA[offset + 3] ===
      TRIANGLE_TEXTURE_COVERAGE[index];
}
assert(
  triangleOverlayMatchesAssets,
  'Triangle 覆盖纹理只替换 Alpha 并保持原 RGB 字节',
);

const ring3Samples = [
  [129, 80],
  [136, 80],
  [129, 92],
  [136, 92],
].map(([x, y]) => Math.round(sampleRing3Alpha(
  (x + 0.5) / RING3_ALPHA_WIDTH,
  (y + 0.5) / RING3_ALPHA_HEIGHT,
) * 255));
assert.deepEqual(
  ring3Samples,
  [243, 239, 246, 226],
  'Ring3 Alpha 保留不可由一维曲线乘积表达的二维采样差异',
);

assert(
  sourceFiles.webgl2.includes('gl.R8') &&
    sourceFiles.webgl2.includes('float textureAlpha = texture(u_texture, v_uv).r;') &&
    sourceFiles.webgl2.includes('layout(location = 1) in vec2 a_uv;') &&
    !sourceFiles.webgl2.includes('a_textureAlpha'),
  'WebGL2 继续使用 Ring3 逐片元采样',
);

const finalShaderSource = sourceFiles.webgl2.match(
  /const FINAL_FRAGMENT_SHADER = `([\s\S]*?)`;/,
)?.[1] ?? '';
const sceneOverlayShaderSource = sourceFiles.webgl2.match(
  /const SCENE_OVERLAY_FRAGMENT_SHADER = `([\s\S]*?)`;/,
)?.[1] ?? '';
const transparentFinalStart = finalShaderSource.indexOf(
  'if (u_transparentOverlay)',
);
const sceneFinalStart = finalShaderSource.lastIndexOf('float maximumSrgb');
const transparentFinalSource = finalShaderSource.slice(
  transparentFinalStart,
  sceneFinalStart,
);

for (const [label, source] of [
  ['完整 WebGL2', sourceFiles.webgl2],
  ['WebGL2 Bloom', sourceFiles.webgl2Bloom],
])
{
  assert(
    source.includes('transportEnergy = contribution;') &&
      source.includes('outColor = vec4(brightPass, transportEnergy);') &&
      !source.includes('clamp(filtered.a'),
    `${label} Prefilter 保留独立 Bloom 传输能量`,
  );
  assert(
    source.includes('outColor = filtered;') &&
      source.includes('sampleBox(u_accumulatedCoarse, v_uv, offset)') &&
      source.includes('texture(u_currentFine, v_uv)') &&
      source.includes('outColor = accumulatedCoarse + currentFine;'),
    `${label} 上采样只叠加当前细级与累计粗级`,
  );
  assert(
    /'u_accumulatedCoarse',\r?\n\s+accumulatedCoarseTexture,/.test(source) &&
      source.includes(
        "this._bindTexture(program, 'u_currentFine', fineLevel.down.texture, 1);",
      ) &&
      source.includes('1 / accumulatedCoarseLevel.width') &&
      source.includes('1 / accumulatedCoarseLevel.height'),
    `${label} 上采样纹理与 texel 尺寸保持正确绑定`,
  );
}

assert(
  transparentFinalSource.includes('? clamp(scene.a, 0.0, 1.0)') &&
    transparentFinalSource.includes('float bloomTransportAlpha = linearToSrgb(') &&
    transparentFinalSource.includes('float requestedAlpha = u_visualMaxAlpha') &&
    transparentFinalSource.includes('? max(sceneCoverage, bloomTransportAlpha)') &&
    transparentFinalSource.includes(': sceneCoverage + bloomTransportAlpha;') &&
    transparentFinalSource.includes('float transportCapacity = min(requestedAlpha, 1.0);') &&
    transparentFinalSource.includes('alpha / max(transportCapacity, 0.000001)') &&
    transparentFinalSource.includes('outColor = vec4(premultiplied, alpha);') &&
    transparentFinalSource.includes('if (u_hostAdditive)') &&
    transparentFinalSource.includes('if (u_brightUnknownBackground)') &&
    transparentFinalSource.includes('clamp(u_overlayAlphaLimit, 0.0, 1.0)') &&
    !transparentFinalSource.includes('premultiplyScale') &&
    sceneOverlayShaderSource.includes('capacity / max(maximumEnergy, 0.000001)') &&
    sceneOverlayShaderSource.includes('outColor = vec4(scene.rgb * scale, coverage);'),
  'WebGL2 Final Pass 保留独立预乘清晰 Coverage 与 Bloom 传输上界',
);
assert(
  finalShaderSource.includes('sceneLinear = sceneEnergy.rgb;') &&
    transparentFinalSource.includes('alpha / max(maximumSrgb, 0.000001)') &&
    transparentFinalSource.includes(': min(1.0, alpha / max(transportCapacity, 0.000001));') &&
    sourceFiles.webgl2.includes("settings.overlayAlphaPolicy === 'visual-max' ? 1 : 0"),
  'WebGL2 visual-max 仅在最终 Pass 使用 Alpha 容量策略',
);

const overlayColorStart = sourceFiles.fx.indexOf(
  'function resolveOverlayStraightColor',
);
const overlayColorEnd = sourceFiles.fx.indexOf(
  'function colorToCanvasOutputCss',
  overlayColorStart,
);
const overlayColorSource = sourceFiles.fx
  .slice(overlayColorStart, overlayColorEnd)
  .replace(/\s+/g, ' ');
assert(
  [0, 1, 2].every((channel) => overlayColorSource.includes(
    `linearToSrgb(Math.max(0, color[${channel}]) * contribution)`,
  )),
  'Canvas 透明覆盖层将线性能量编码为 sRGB',
);
const hostAdditiveStart = sourceFiles.fx.indexOf(
  'function resolveHostAdditivePayload',
);
const hostAdditiveEnd = sourceFiles.fx.indexOf(
  'function resolveOverlayStraightColor',
  hostAdditiveStart,
);
const hostAdditiveSource = sourceFiles.fx
  .slice(hostAdditiveStart, hostAdditiveEnd)
  .replace(/\s+/g, ' ');
assert(
  [0, 1, 2].every((channel) => hostAdditiveSource.includes(
    `linearToSrgb(Math.max(0, color[${channel}]) * contribution)`,
  )) &&
    hostAdditiveSource.includes('clamp01(coverageAlpha)') &&
    sourceFiles.fx.includes("? 'host-additive'") &&
    sourceFiles.fx.includes("outputCompositing === 'host-additive'") &&
    sourceFiles.fx.includes('function prepareLinearTintedTextureCanvas') &&
    sourceFiles.fx.includes('Linear(texture) × Linear(material)') &&
    sourceFiles.fx.includes('energyRgb[targetOffset] = textureRgb[targetOffset] * exactCoverage') &&
    sourceFiles.fx.includes('const straightDivisor = safeDivisor * effectiveAlpha') &&
    sourceFiles.fx.includes('image.data[outputOffset + 3] = coverageByte'),
  'Canvas 回退在线性空间合成纹理、Coverage 与材质后只编码一次 sRGB',
);
assert(
  (() =>
  {
    const start = sourceFiles.fx.indexOf(
      '  _renderCanvasSceneEffects(scale, useNativeBloom)',
    );
    const end = sourceFiles.fx.indexOf('  _drawCanvasFallbackPass(', start);
    const method = sourceFiles.fx.slice(start, end);

    return start >= 0 && end > start &&
      method.indexOf('this._drawCanvasTrails(scale, useNativeBloom, true);') <
        method.indexOf('wave.drawDiskLayer(') &&
      method.indexOf('wave.drawAdditiveBase(') <
        method.indexOf('this._drawWaveRings(') &&
      method.indexOf('this._drawWaveRings(') < method.indexOf('shard.draw(');
  })(),
  'Canvas Scene 按 Queue 4499 到 4550 的顺序提交拖尾、圆盘、圆环与碎片',
);
assert(
  (() =>
  {
    const start = sourceFiles.webgl2.indexOf('  _drawGeometryBatches(');
    const end = sourceFiles.webgl2.indexOf('  _renderScaledBloomSource(', start);
    const method = sourceFiles.webgl2.slice(start, end);

    return start >= 0 && end > start &&
      method.indexOf('this._drawTexturedAdditiveBatch(') <
        method.indexOf('if (this.ringVertexCount > 0)') &&
      method.indexOf('// Tri2 的 Queue 4550') <
        method.indexOf('if (this.triangleVertexCount > 0)');
  })(),
  'WebGL2 按 Queue 4499 后 4550 提交拖尾、圆环与碎片',
);
assert(
  (() =>
  {
    const start = sourceFiles.webgpu.indexOf(
      '  _drawGeometry(pass, uniform, transparentOverlay',
    );
    const end = sourceFiles.webgpu.indexOf('  _createFullscreenBindGroup(', start);
    const method = sourceFiles.webgpu.slice(start, end);

    return start >= 0 && end > start &&
      method.indexOf("'trail'") < method.indexOf("'ring'") &&
      method.indexOf("'ring'") < method.indexOf("'triangle'");
  })(),
  'WebGPU 按 Queue 4499 到 4550 提交拖尾、圆环与碎片',
);
assert(
  sourceFiles.fx.includes('function prepareLinearTintedTextureCanvas') &&
    sourceFiles.fx.includes('energyRgb[targetOffset] = textureRgb[targetOffset] * exactCoverage') &&
    sourceFiles.fx.includes('image.data[outputOffset + 3] = coverageByte'),
  'Canvas 源码继续在线性空间保留 Coverage 写回',
);
assert(
  !sourceFiles.fx.includes('(targetCoverage - originalCoverage) * roundness') &&
    !sourceFiles.fx.includes('(targetAlpha - originalAlpha) * amount') &&
    sourceFiles.webgl2.includes('sampleColor = vec4(shapeRgb, roundedCoverage)'),
  'Canvas 与 WebGL2 只保留圆角 Coverage，不叠加旧尖三角 Alpha',
);

const coverageKeys = UNITY_FX_TOUCH.trail.coverageLongitudinalKeys;
const coverageSamples = Array.from({ length: 101 }, (_, index) =>
  evaluateTrailLongitudinalCoverage(coverageKeys, index / 100));
const asymmetricCoverageProfile = evaluateTrailTextureCoverageProfile(1 - 20 / 511);
assert(
  evaluateTrailLongitudinalCoverage(coverageKeys, 0.248532) === 0 &&
    evaluateTrailLongitudinalCoverage(coverageKeys, 0.61397379) === 0.5 &&
    evaluateTrailLongitudinalCoverage(coverageKeys, 0.97941558) === 1 &&
    coverageSamples.every((value, index, values) =>
      value >= 0 && value <= 1 &&
        (index === 0 || value >= values[index - 1])),
  '拖尾纵向 Coverage 以 smootherstep 有界单调连接两个平坦端点',
);
assert(
  asymmetricCoverageProfile.length === 17 &&
    asymmetricCoverageProfile[1][1] > asymmetricCoverageProfile.at(-2)[1] + 0.03 &&
    Math.max(...asymmetricCoverageProfile.map(([, value]) => value)) === 1,
  'Canvas 后端从固定二维 Coverage 资产采样非对称横截面',
);

const sharpCoverage = createRoundedTriangleCoverage(0);
const halfRoundedCoverage = createRoundedTriangleCoverage(0.5);
const circleCoverage = createRoundedTriangleCoverage(1);
const centerIndex = 64 * TRIANGLE_TEXTURE_SIZE + 64;
const cornerIndex = 0;
const circleArea = circleCoverage.reduce((sum, value) => sum + value / 255, 0);
let sharpIntersection = 0;
let sharpUnion = 0;

for (let index = 0; index < sharpCoverage.length; index++)
{
  const analyticInside = sharpCoverage[index] >= 128;
  const textureInside = TRIANGLE_TEXTURE_COVERAGE[index] >= 128;

  sharpIntersection += Number(analyticInside && textureInside);
  sharpUnion += Number(analyticInside || textureInside);
}

const sharpIoU = sharpIntersection / sharpUnion;
const halfRoundness = 0.5;
const coreLeft = [-0.9609375 * 0.5, -0.7265625 * 0.5];
const previousEdge = [-0.9609375, -1.640625];
const previousLength = Math.hypot(...previousEdge);
const previousNormal = [
  previousEdge[1] / previousLength,
  -previousEdge[0] / previousLength,
];
const bisector = [previousNormal[0], previousNormal[1] - 1];
const bisectorLength = Math.hypot(...bisector);
const arcPoint = [
  coreLeft[0] + halfRoundness * bisector[0] / bisectorLength,
  coreLeft[1] + halfRoundness * bisector[1] / bisectorLength,
];
const boundaryCoverage = (x, y, roundness) => sampleRoundedTriangleCoverage(
  (x + 1) * 0.5,
  (y + 1) * 0.5,
  roundness,
  0.00001,
);
const flatSideCoverage = boundaryCoverage(
  0,
  coreLeft[1] - halfRoundness,
  halfRoundness,
);
const roundedCornerCoverage = boundaryCoverage(
  arcPoint[0],
  arcPoint[1],
  halfRoundness,
);
const circleBoundaryCoverages = Array.from({ length: 8 }, (_, index) =>
{
  const angle = index * Math.PI / 4;

  return boundaryCoverage(Math.cos(angle), Math.sin(angle), 1);
});
assert(
  sharpCoverage[centerIndex] === 255 &&
    sharpCoverage[cornerIndex] === 0 &&
    halfRoundedCoverage[centerIndex] === 255 &&
    circleCoverage[centerIndex] === 255 &&
    circleCoverage[cornerIndex] === 0 &&
    Math.abs(circleArea - Math.PI * 64 * 64) < 300 &&
    sharpIoU > 0.98,
  '圆角 Coverage 对齐原图集轮廓且最大值形成同尺寸圆形',
);
assert(
  Math.abs(flatSideCoverage - 0.5) < 0.0001 &&
    Math.abs(roundedCornerCoverage - 0.5) < 0.0001 &&
    circleBoundaryCoverages.every((coverage) => Math.abs(coverage - 0.5) < 0.0001),
  '中间比例保留相切直边与圆弧，最大值八方向均为圆边界',
);

const canvas = new MockCanvas();
const fx = new BAClickFX({
  target: canvas,
  inputSource: 'manual',
  effectBackend: 'canvas2d',
  bloomBackend: 'native',
});
assert.equal(fx.canvas, canvas, '源码入口可以绑定 Mock Canvas');
fx.resize(640, 480, 1);
assert.equal(fx.width, 640, '源码入口 resize 更新宽度');
assert.equal(fx.height, 480, '源码入口 resize 更新高度');
fx.destroy();
assert.equal(fx.destroyed, true, '源码入口可以销毁实例');

console.log('\n源码入口与资源合同通过');
