import { BUILD_TRAIL, BUILD_CLICK, BUILD_SHARDS, BUILD_BLOOM, BUILD_REFERENCE } from './build-capabilities.js';
import { EffectGeometry, calculatePyramidSettings } from './effect-geometry.js';
export { calculatePyramidSettings } from './effect-geometry.js';
import { TRIANGLE_TEXTURE_OVERLAY_RGBA, TRIANGLE_TEXTURE_RGBA, TRIANGLE_TEXTURE_SIZE } from './triangle-texture.js';
import { CIRCLE_TEXTURE_RGBA, CIRCLE_TEXTURE_SIZE } from './circle-texture.js';
import { RING3_ALPHA, RING3_ALPHA_HEIGHT, RING3_ALPHA_WIDTH } from './ring3-alpha.js';
import { TRAIL_TEXTURE_HEIGHT, TRAIL_TEXTURE_RGBA, TRAIL_TEXTURE_WIDTH } from './trail-texture.js';
import { gammaToLinear, resolveUnityBloomClamp, resolveUnityBloomIntensity } from './bloom-color-space.js';
import { isIndependentHostCompositing } from './config.js';


// 将资源接缝转到参数 rotation 的起点，并把 Unity 的 Y 轴转成屏幕方向。






const COMPONENTS_PER_VERTEX = 6;
const COMPONENTS_PER_DISK_VERTEX = 8;
const COMPONENTS_PER_RING_VERTEX = 9;
const COMPONENTS_PER_TRIANGLE_VERTEX = 9;
const COMPONENTS_PER_TRAIL_VERTEX = 9;





const EMISSION_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec3 a_color;
layout(location = 2) in float a_coverage;

uniform vec2 u_displaySize;

out vec3 v_color;
out float v_coverage;

void main()
{
  vec2 normalized = a_position / u_displaySize;
  gl_Position = vec4(
    normalized.x * 2.0 - 1.0,
    1.0 - normalized.y * 2.0,
    0.0,
    1.0
  );
  v_color = a_color;
  v_coverage = a_coverage;
}
`;

const EMISSION_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_color;
in float v_coverage;
uniform bool u_transparentOverlay;
out vec4 outColor;

void main()
{
  float coverage = u_transparentOverlay
    ? clamp(v_coverage, 0.0, 1.0)
    : 1.0;

  outColor = vec4(max(v_color, vec3(0.0)), coverage);
}
`;

const FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;

out vec2 v_uv;

void main()
{
  vec2 positions[3] = vec2[](
    vec2(-1.0, -1.0),
    vec2(3.0, -1.0),
    vec2(-1.0, 3.0)
  );
  vec2 position = positions[gl_VertexID];

  gl_Position = vec4(position, 0.0, 1.0);
  v_uv = position * 0.5 + 0.5;
}
`;

const PREFILTER_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec2 u_sourceTexel;
uniform float u_threshold;
uniform float u_softKnee;
uniform float u_clampMax;

in vec2 v_uv;
out vec4 outColor;

vec3 thresholdColor(vec3 color, out float transportEnergy)
{
  float clampMax = min(max(u_clampMax, 0.0), 65504.0);

  color = min(color, vec3(clampMax));
  float brightness = max(max(color.r, color.g), color.b);

  if (brightness <= 0.0)
  {
    transportEnergy = 0.0;
    return vec3(0.0);
  }

  float threshold = max(0.0, u_threshold);
  // BaGameBloomRendererFeature 的序列化范围是 0..1，并无条件加 epsilon。
  float knee = threshold * clamp(u_softKnee, 0.0, 1.0) + 0.00001;
  float soft = brightness - threshold + knee;

  soft = clamp(soft, 0.0, knee * 2.0);
  soft = soft * soft / (knee * 4.0);

  float contribution = max(max(brightness - threshold, soft), 0.0);

  // contribution 等于 Bright Pass 的最大通道。作为独立标量经过相同的
  // 正权重 Bloom 核后，它始终是三个 RGB 通道的上界。
  transportEnergy = contribution;
  return color * contribution / max(brightness, 0.0001);
}

void main()
{
  vec4 sampleSum =
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, -1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, -1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, 1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, 1.0));
  vec4 filtered = sampleSum * 0.25;
  float transportEnergy = 0.0;
  vec3 brightPass = thresholdColor(filtered.rgb, transportEnergy);

  // sourceTarget.a 仍保留清晰 Scene Coverage；Bloom RT 的 Alpha 从
  // Prefilter 开始仅传输 Bright Pass 上界，不从最终 RGB 反推。
  outColor = vec4(brightPass, transportEnergy);
}
`;

const SCENE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 v_color;
in float v_coverage;
uniform bool u_transparentOverlay;
out vec4 outColor;

void main()
{
  // Scene 模式保留 Unity 固定 A=1；透明覆盖层单独保存粒子 Coverage。
  float alpha = u_transparentOverlay
    ? clamp(v_coverage, 0.0, 1.0)
    : 1.0;

  outColor = vec4(max(v_color, vec3(0.0)), alpha);
}
`;

const SCENE_BACKGROUND_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_background;
uniform vec2 u_uvScale;

in vec2 v_uv;
out vec4 outColor;

void main()
{
  vec2 uv = (v_uv - 0.5) * u_uvScale + 0.5;

  // DOM 栅格源统一按左上原点上传；Shader 翻转也覆盖忽略 UNPACK 的 ImageBitmap。
  uv.y = 1.0 - uv.y;
  // SRGB8_ALPHA8 采样会自动解码到线性空间，和 Unity 相机颜色 RT 一致。
  outColor = vec4(texture(u_background, uv).rgb, 1.0);
}
`;

const TRIANGLE_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec3 a_materialColor;
layout(location = 3) in float a_particleAlpha;
layout(location = 4) in float a_coverageFactor;

uniform vec2 u_displaySize;

out vec2 v_uv;
out vec3 v_materialColor;
out float v_particleAlpha;
out float v_coverageFactor;

void main()
{
  vec2 normalized = a_position / u_displaySize;
  gl_Position = vec4(
    normalized.x * 2.0 - 1.0,
    1.0 - normalized.y * 2.0,
    0.0,
    1.0
  );
  v_uv = a_uv;
  v_materialColor = a_materialColor;
  v_particleAlpha = a_particleAlpha;
  v_coverageFactor = a_coverageFactor;
}
`;

const TRIANGLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform bool u_transparentOverlay;
uniform bool u_alphaModulatesEmission;
uniform bool u_antialiasGeometryCoverage;
uniform bool u_roundTriangle;

in vec2 v_uv;
in vec3 v_materialColor;
in float v_particleAlpha;
in float v_coverageFactor;

out vec4 outColor;

float sdTriangle(vec2 point)
{
  const vec2 vertices[3] = vec2[](
    vec2(-0.9609375, -0.7265625),
    vec2(0.9609375, -0.7265625),
    vec2(0.0, 0.9140625)
  );
  float minimumSquaredDistance = 1.0e20;
  bool inside = true;

  for (int index = 0; index < 3; index++)
  {
    vec2 start = vertices[index];
    vec2 end = vertices[(index + 1) % 3];
    vec2 edge = end - start;
    vec2 offset = point - start;
    float progress = clamp(
      dot(offset, edge) / max(dot(edge, edge), 1.0e-20),
      0.0,
      1.0
    );
    vec2 nearest = offset - edge * progress;

    minimumSquaredDistance = min(
      minimumSquaredDistance,
      dot(nearest, nearest)
    );
    inside = inside && edge.x * offset.y - edge.y * offset.x >= 0.0;
  }

  return sqrt(minimumSquaredDistance) * (inside ? -1.0 : 1.0);
}

float sdRoundedTriangle(vec2 point, float roundness)
{
  if (roundness >= 1.0)
  {
    return length(point) - 1.0;
  }

  float triangleScale = max(1.0 - roundness, 0.000001);

  // 缩小真实图集三角与圆盘的 Minkowski 和只磨圆角，仍保留直边。
  return sdTriangle(point / triangleScale) *
    triangleScale - roundness;
}

void main()
{
  float roundness = u_roundTriangle
    ? clamp(v_coverageFactor, 0.0, 1.0)
    : 0.0;
  vec2 sampleUv = v_uv;

  if (u_roundTriangle)
  {
    sampleUv = (v_uv * 2.0 - 1.0) /
      (1.0 + 1.16465 * roundness) * 0.5 + 0.5;
  }

  vec4 sampleColor = texture(u_texture, sampleUv);
  float particleAlpha = clamp(v_particleAlpha, 0.0, 1.0);
  float geometryCoverage = 1.0;
  vec2 point = v_uv * 2.0 - 1.0;
  float distance = sdRoundedTriangle(point, roundness);
  float footprint = max(fwidth(distance), 0.000001);
  float roundedCoverage = 1.0 - smoothstep(
    -footprint,
    footprint,
    distance
  );

  if (u_roundTriangle && roundness > 0.0)
  {
    float textureSupport = clamp(sampleColor.a, 0.0, 1.0);
    vec3 supportedRgb = mix(vec3(1.0), sampleColor.rgb, textureSupport);
    vec3 shapeRgb = mix(supportedRgb, vec3(1.0), roundness);

    // 正数圆角只有一条 Coverage 边界；RGB 在透明区向材质色外推，
    // 再随比例淡化纹理细节，避免形成“圆里套三角”的暗边。
    sampleColor = vec4(shapeRgb, roundedCoverage);
  }

  if (u_transparentOverlay && u_antialiasGeometryCoverage)
  {
    float edgeDistance = min(v_uv.y, 1.0 - v_uv.y);
    float halfPixelFootprint = max(fwidth(v_uv.y) * 0.5, 0.000001);

    geometryCoverage = smoothstep(0.0, halfPixelFootprint, edgeDistance);
  }

  float coverageFactor = u_roundTriangle
    ? 1.0
    : clamp(v_coverageFactor, 0.0, 1.0);
  float coverage = sampleColor.a * particleAlpha *
    coverageFactor * geometryCoverage;
  // sRGB 纹理采样会自动把 RGB 解码到线性空间。
  vec3 emission = sampleColor.rgb *
    max(v_materialColor, vec3(0.0)) *
    (u_alphaModulatesEmission ? coverage : particleAlpha);
  float outputAlpha = u_transparentOverlay ? coverage : 1.0;

  outColor = vec4(emission, outputAlpha);
}
`;

const SCENE_DISK_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec3 a_materialColor;
layout(location = 3) in float a_particleAlpha;

uniform vec2 u_displaySize;

out vec2 v_uv;
out vec3 v_materialColor;
out float v_particleAlpha;

void main()
{
  vec2 normalized = a_position / u_displaySize;
  gl_Position = vec4(
    normalized.x * 2.0 - 1.0,
    1.0 - normalized.y * 2.0,
    0.0,
    1.0
  );
  v_uv = a_uv;
  v_materialColor = a_materialColor;
  v_particleAlpha = a_particleAlpha;
}
`;

const SCENE_DISK_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform float u_emissionScale;

in vec2 v_uv;
in vec3 v_materialColor;
in float v_particleAlpha;
out vec4 outColor;

void main()
{
  vec4 sampleColor = texture(u_texture, v_uv);
  // Cross2 的 _RGBRGBA=0 读取线性 R 作为透明度，原图 A 恒为 1。
  float textureAlpha = sampleColor.r;
  vec3 color = sampleColor.rgb *
    max(v_materialColor, vec3(0.0)) * textureAlpha *
    max(u_emissionScale, 0.0);
  // 生命周期 Alpha 只控制目标颜色衰减，不能再次乘入源 RGB。
  float alpha = textureAlpha * clamp(v_particleAlpha, 0.0, 1.0);

  outColor = vec4(
    color,
    clamp(alpha, 0.0, 1.0)
  );
}
`;

const DISSOLVE_RING_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec3 a_materialColor;
layout(location = 3) in float a_dissolveThreshold;
layout(location = 4) in float a_coverageOpacity;

uniform vec2 u_displaySize;

out vec2 v_uv;
out vec3 v_materialColor;
out float v_dissolveThreshold;
out float v_coverageOpacity;

void main()
{
  vec2 normalized = a_position / u_displaySize;
  gl_Position = vec4(
    normalized.x * 2.0 - 1.0,
    1.0 - normalized.y * 2.0,
    0.0,
    1.0
  );
  v_uv = a_uv;
  v_materialColor = a_materialColor;
  v_dissolveThreshold = a_dissolveThreshold;
  v_coverageOpacity = a_coverageOpacity;
}
`;

const DISSOLVE_RING_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec3 v_materialColor;
in float v_dissolveThreshold;
in float v_coverageOpacity;

uniform sampler2D u_texture;
uniform bool u_transparentOverlay;
uniform float u_emissionScale;

out vec4 outColor;

void main()
{
  // Unity 在片元阶段以 Bilinear + Clamp 采样 Ring3，而不是插值顶点 Alpha。
  float textureAlpha = texture(u_texture, v_uv).r;

  // Unity clip(alpha - threshold) 是硬裁剪，通过的片元保留原纹理 Alpha。
  if (textureAlpha < v_dissolveThreshold)
  {
    discard;
  }

  textureAlpha = clamp(textureAlpha, 0.0, 1.0);
  vec3 materialColor = max(v_materialColor, vec3(0.0)) *
    max(u_emissionScale, 0.0);

  if (u_transparentOverlay)
  {
    // RGB 预乘纹理 Alpha 后改用 One/One，结果与 Unity SrcAlpha/One 相同。
    outColor = vec4(
      materialColor * textureAlpha,
      textureAlpha * clamp(v_coverageOpacity, 0.0, 1.0)
    );
    return;
  }

  outColor = vec4(materialColor, textureAlpha);
}
`;

const DOWNSAMPLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec2 u_sourceTexel;

in vec2 v_uv;
out vec4 outColor;

void main()
{
  vec4 sampleSum =
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, -1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, -1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, 1.0)) +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, 1.0));
  vec4 filtered = sampleSum * 0.25;

  // Alpha 是 HDR 传输上界，必须与 RGB 使用同一线性核且保留大于 1 的值。
  outColor = filtered;
}
`;

const SCENE_OVERLAY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_scene;

in vec2 v_uv;
out vec4 outColor;

void main()
{
  vec4 scene = texture(u_scene, v_uv);
  float coverage = clamp(scene.a, 0.0, 1.0);
  float capacity = coverage <= 0.04045
    ? coverage / 12.92
    : pow((coverage + 0.055) / 1.055, 2.4);
  float maximumEnergy = max(max(scene.r, scene.g), scene.b);
  float scale = min(1.0, capacity / max(maximumEnergy, 0.000001));

  // 只把清晰 Scene 收敛到 authored Coverage 的预乘容量；原 HDR Scene
  // 仍保留在 sourceTarget，供 Bloom Prefilter 与已知背景精确合成使用。
  outColor = vec4(scene.rgb * scale, coverage);
}
`;

const UPSAMPLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_accumulatedCoarse;
uniform sampler2D u_currentFine;
uniform vec2 u_accumulatedCoarseTexel;
uniform float u_sampleScale;

in vec2 v_uv;
out vec4 outColor;

vec4 sampleBox(sampler2D source, vec2 uv, vec2 offset)
{
  return (
    texture(source, uv + vec2(-offset.x, -offset.y)) +
    texture(source, uv + vec2(offset.x, -offset.y)) +
    texture(source, uv + vec2(-offset.x, offset.y)) +
    texture(source, uv + vec2(offset.x, offset.y))
  ) * 0.25;
}

void main()
{
  vec2 offset = u_accumulatedCoarseTexel * (u_sampleScale * 0.5);
  vec4 accumulatedCoarse = sampleBox(u_accumulatedCoarse, v_uv, offset);
  vec4 currentFine = texture(u_currentFine, v_uv);

  // Unity 对 lastMip（累计粗级）继续扩散，再单点加当前细级。
  // RGB 与传输上界必须走完全相同的加法链，避免透明合成改变光晕轮廓。
  outColor = accumulatedCoarse + currentFine;
}
`;

const FINAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_scene;
uniform sampler2D u_sceneEnergy;
uniform sampler2D u_bloom;
uniform sampler2D u_background;
uniform vec2 u_bloomTexel;
uniform float u_sampleScale;
uniform float u_intensity;
uniform float u_overlayAlphaLimit;
uniform float u_opacity;
uniform bool u_hasScene;
uniform bool u_hasBackground;
uniform bool u_transparentOverlay;
uniform bool u_visualMaxAlpha;
uniform bool u_brightUnknownBackground;
uniform bool u_hostAdditive;

in vec2 v_uv;
out vec4 outColor;

float linearToSrgb(float value)
{
  float linear = clamp(value, 0.0, 1.0);

  if (linear <= 0.0031308)
  {
    return linear * 12.92;
  }

  return 1.055 * pow(linear, 1.0 / 2.4) - 0.055;
}

float solveOverlayAlpha(float background, float target)
{
  if (target > background)
  {
    return (target - background) / max(1.0 - background, 0.000001);
  }

  if (target < background)
  {
    return (background - target) / max(background, 0.000001);
  }

  return 0.0;
}

void main()
{
  vec2 offset = u_bloomTexel * (u_sampleScale * 0.5);
  vec4 bloom =
    texture(u_bloom, v_uv + vec2(-offset.x, -offset.y)) +
    texture(u_bloom, v_uv + vec2(offset.x, -offset.y)) +
    texture(u_bloom, v_uv + vec2(-offset.x, offset.y)) +
    texture(u_bloom, v_uv + vec2(offset.x, offset.y));
  vec4 scene = u_hasScene
    ? texture(u_scene, v_uv)
    : vec4(0.0);
  vec4 sceneEnergy = u_hasScene
    ? texture(u_sceneEnergy, v_uv)
    : vec4(0.0);
  vec4 filteredBloom = bloom * 0.25;
  vec3 sceneLinear = scene.rgb;

  if (u_transparentOverlay && u_visualMaxAlpha && !u_hostAdditive && u_hasScene)
  {
    // visual-max 要恢复 v1.2.15 的颜色保留，必须读取未提前按 Coverage
    // 收敛的清晰发射；sceneOverlay 只供默认 Coverage 合同使用。
    sceneLinear = sceneEnergy.rgb;
  }

  vec3 linear = sceneLinear +
    filteredBloom.rgb * max(0.0, u_intensity);
  vec3 srgb = vec3(
    linearToSrgb(linear.r),
    linearToSrgb(linear.g),
    linearToSrgb(linear.b)
  );

  if (u_hasBackground)
  {
    vec3 backgroundLinear = texture(u_background, v_uv).rgb;
    vec3 backgroundSrgb = vec3(
      linearToSrgb(backgroundLinear.r),
      linearToSrgb(backgroundLinear.g),
      linearToSrgb(backgroundLinear.b)
    );
    vec3 difference = abs(srgb - backgroundSrgb);

    if (max(max(difference.r, difference.g), difference.b) <= 0.00001)
    {
      outColor = vec4(0.0);
      return;
    }

    // 求满足 target = premultiplied + background * (1 - alpha) 的最小
    // source-over Alpha；这样 DOM 背景保持可交互，同时逐像素等于 Unity 输出。
    vec3 channelAlpha = vec3(
      solveOverlayAlpha(backgroundSrgb.r, srgb.r),
      solveOverlayAlpha(backgroundSrgb.g, srgb.g),
      solveOverlayAlpha(backgroundSrgb.b, srgb.b)
    );
    float overlayAlpha = clamp(
      max(max(channelAlpha.r, channelAlpha.g), channelAlpha.b),
      0.0,
      1.0
    );
    vec3 premultiplied = srgb - backgroundSrgb * (1.0 - overlayAlpha);

    outColor = vec4(
      clamp(premultiplied, vec3(0.0), vec3(overlayAlpha)),
      overlayAlpha
    );
    return;
  }

  if (u_transparentOverlay)
  {
    float sceneCoverage = u_hasScene
      ? clamp(scene.a, 0.0, 1.0)
      : 0.0;
    float bloomTransportAlpha = linearToSrgb(
      max(0.0, filteredBloom.a) * max(0.0, u_intensity)
    );
    float requestedAlpha = u_visualMaxAlpha
      ? max(sceneCoverage, bloomTransportAlpha)
      : sceneCoverage + bloomTransportAlpha;
    // Canvas lighter 与默认帧缓冲都会先把累计 Alpha 饱和到 1。Bloom
    // 强度较高时 requestedAlpha 可大于 1；继续用未饱和值归一化会在
    // 预乘容量已经充足时额外压暗 RGB，并与 Canvas 回退产生跳变。
    float transportCapacity = min(requestedAlpha, 1.0);

    if (u_hostAdditive)
    {
      // CSS/原生宿主使用 One/One 加色时不会以源 Alpha 衰减背景。Alpha
      // 仅承担浏览器预乘传输，至少覆盖 RGB，不能再反向限制发射能量。
      float maximumSrgb = max(max(srgb.r, srgb.g), srgb.b);
      float transportAlpha = clamp(
        max(maximumSrgb, transportCapacity),
        0.0,
        1.0
      );

      if (transportAlpha <= 0.00001)
      {
        outColor = vec4(0.0);
        return;
      }

      outColor = vec4(srgb, transportAlpha);
      return;
    }

    float alpha = min(
      transportCapacity,
      clamp(u_overlayAlphaLimit, 0.0, 1.0)
    );

    if (alpha <= 0.00001)
    {
      outColor = vec4(0.0);
      return;
    }

    // 默认合同按独立传输和收敛；visual-max 只在最后一步读取 maxRGB
    // 约束预乘容量，不能用颜色反向生成 Coverage Alpha。
    float maximumSrgb = max(max(srgb.r, srgb.g), srgb.b);
    float capacityScale = u_visualMaxAlpha
      ? min(1.0, alpha / max(maximumSrgb, 0.000001))
      : min(1.0, alpha / max(transportCapacity, 0.000001));

    vec3 premultiplied = srgb * capacityScale;

    if (u_brightUnknownBackground)
    {
      float safeOpacity = max(u_opacity, 0.000001);
      float normalizedCoverage = clamp(alpha / safeOpacity, 0.0, 1.0);
      float maximumPremultiplied = max(
        max(premultiplied.r, premultiplied.g),
        premultiplied.b
      );
      float normalizedEnergy = maximumPremultiplied / safeOpacity;
      float energyRatio = normalizedEnergy /
        max(normalizedCoverage, 0.000001);
      float gate = smoothstep(0.25, 0.75, energyRatio) *
        smoothstep(0.03125, 0.25, normalizedEnergy);

      // 聚合后只混合一次；峰值不增加，蓝青核心不会再坍缩成纯白。
      premultiplied = mix(
        premultiplied,
        vec3(maximumPremultiplied),
        0.35 * gate
      );
    }

    outColor = vec4(premultiplied, alpha);
    return;
  }

  float maximumSrgb = max(max(srgb.r, srgb.g), srgb.b);
  // Bloom 会扩散到 Cross2 Coverage 之外。无场景背景可用于精确反解时，
  // Alpha 至少要覆盖发光 RGB，避免透明桌面合成出现非法的 RGB > Alpha。
  float alpha = u_hasScene
    ? max(clamp(scene.a, 0.0, 1.0), maximumSrgb)
    : maximumSrgb;

  if (maximumSrgb <= 0.00001 && alpha <= 0.00001)
  {
    outColor = vec4(0.0);
    return;
  }

  // WebGL Canvas 以预乘 Alpha 交给页面合成器。
  outColor = vec4(srgb, alpha);
}
`;

function clamp(value, minimum, maximum)
{
  return Math.max(minimum, Math.min(maximum, value));
}

function getTexImageSourceDimensions(source)
{
  if (!source)
  {
    return null;
  }

  let width;
  let height;

  try
  {
    width = source.naturalWidth ??
      source.videoWidth ??
      source.displayWidth ??
      source.width;
    height = source.naturalHeight ??
      source.videoHeight ??
      source.displayHeight ??
      source.height;
  }
  catch
  {
    // 已关闭的 VideoFrame 等宿主资源会在尺寸读取时抛错。
    return null;
  }

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
  {
    return null;
  }

  return {
    width,
    height,
  };
}



function compileShader(gl, type, source)
{
  const shader = gl.createShader(type);

  if (!shader)
  {
    throw new Error('WebGL2 无法创建 Shader');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
  {
    const message = gl.getShaderInfoLog(shader) || '未知 Shader 编译错误';

    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createProgram(gl, vertexSource, fragmentSource)
{
  let vertexShader = null;
  let fragmentShader = null;
  let program = null;

  try
  {
    vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    program = gl.createProgram();

    if (!program)
    {
      throw new Error('WebGL2 无法创建 Program');
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    {
      throw new Error(
        gl.getProgramInfoLog(program) || '未知 Program 链接错误',
      );
    }

    return program;
  }
  catch (error)
  {
    gl.deleteProgram(program);
    throw error;
  }
  finally
  {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  }
}

function deleteTarget(gl, target)
{
  if (!target)
  {
    return;
  }

  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}

export class WebGL2EffectRenderer extends EffectGeometry
{


  constructor(canvas, options = {})
  {
    super(canvas);
    this.uniformLocations = new Map();
    this.emissionBuffer = null;
    this.emissionVao = null;
    this.sceneDiskBuffer = null;
    this.sceneDiskVao = null;
    this.ringBuffer = null;
    this.ringIndexBuffer = null;
    this.ringVao = null;
    this.ringTexture = null;
    this.triangleBuffer = null;
    this.triangleVao = null;
    this.trailBuffer = null;
    this.trailVao = null;
    this.triangleTexture = null;
    this.triangleOverlayTexture = null;
    this.trailTexture = null;
    this.circleTexture = null;
    this.fullscreenVao = null;
    this._onContextLost = this._handleContextLost.bind(this);
    this._onContextRestored = this._handleContextRestored.bind(this);
    if (options.initialize !== false)
    {
      this.canvas?.addEventListener?.('webglcontextlost', this._onContextLost);
      this.canvas?.addEventListener?.(
        'webglcontextrestored',
        this._onContextRestored,
      );
      this._initialize();
    }
  }

  _initialize()
  {
    this.uniformLocations?.clear();
    try
    {
      const gl = this.canvas?.getContext?.(
        'webgl2',
        {
          alpha: true,
          // Scene 绘入自建 HDR FBO，默认帧缓冲 MSAA 对其无效且徒增开销。
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: true,
          preserveDrawingBuffer: false,
          powerPreference: 'high-performance',
        },
      );

      if (!gl || !gl.getExtension('EXT_color_buffer_float'))
      {
        this.available = false;
        return;
      }

      this.gl = gl;
      this.maximumTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const maximumViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);

      this.maximumViewportWidth = maximumViewport?.[0] ??
        this.maximumTextureSize;
      this.maximumViewportHeight = maximumViewport?.[1] ??
        this.maximumTextureSize;

      if (
        this.maximumTextureSize <= 0 ||
        this.maximumViewportWidth <= 0 ||
        this.maximumViewportHeight <= 0
      )
      {
        throw new Error('WebGL2 无法查询纹理或视口尺寸上限');
      }

      // 逐项登记，后续任一 Shader 失败时 catch 可以释放此前创建的 Program。
      this.programs = {};
      this.programs.emission = createProgram(
        gl,
        EMISSION_VERTEX_SHADER,
        EMISSION_FRAGMENT_SHADER,
      );
      this.programs.scene = this.sceneEnabled
        ? createProgram(
            gl,
            EMISSION_VERTEX_SHADER,
            SCENE_FRAGMENT_SHADER,
          )
        : null;
      this.programs.sceneDisk = createProgram(
        gl,
        SCENE_DISK_VERTEX_SHADER,
        SCENE_DISK_FRAGMENT_SHADER,
      );
      this.programs.dissolveRing = createProgram(
        gl,
        DISSOLVE_RING_VERTEX_SHADER,
        DISSOLVE_RING_FRAGMENT_SHADER,
      );
      this.programs.triangle = createProgram(
        gl,
        TRIANGLE_VERTEX_SHADER,
        TRIANGLE_FRAGMENT_SHADER,
      );
      this.programs.sceneBackground = BUILD_REFERENCE ? createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        SCENE_BACKGROUND_FRAGMENT_SHADER,
      ) : null;
      this.programs.sceneOverlay = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        SCENE_OVERLAY_FRAGMENT_SHADER,
      );
      this.programs.prefilter = BUILD_BLOOM ? createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        PREFILTER_FRAGMENT_SHADER,
      ) : null;
      this.programs.downsample = BUILD_BLOOM ? createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        DOWNSAMPLE_FRAGMENT_SHADER,
      ) : null;
      this.programs.upsample = BUILD_BLOOM ? createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        UPSAMPLE_FRAGMENT_SHADER,
      ) : null;
      this.programs.final = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        FINAL_FRAGMENT_SHADER,
      );
      this.emissionBuffer = gl.createBuffer();
      this.emissionVao = gl.createVertexArray();
      this.sceneDiskBuffer = BUILD_CLICK ? gl.createBuffer() : null;
      this.sceneDiskVao = BUILD_CLICK ? gl.createVertexArray() : null;
      this.ringBuffer = BUILD_CLICK ? gl.createBuffer() : null;
      this.ringIndexBuffer = BUILD_CLICK ? gl.createBuffer() : null;
      this.ringVao = BUILD_CLICK ? gl.createVertexArray() : null;
      this.ringTexture = BUILD_CLICK ? gl.createTexture() : null;
      this.triangleBuffer = gl.createBuffer();
      this.triangleVao = gl.createVertexArray();
      this.trailBuffer = BUILD_TRAIL ? gl.createBuffer() : null;
      this.trailVao = BUILD_TRAIL ? gl.createVertexArray() : null;
      this.triangleTexture = gl.createTexture();
      this.triangleOverlayTexture = gl.createTexture();
      this.trailTexture = BUILD_TRAIL ? gl.createTexture() : null;
      this.circleTexture = BUILD_CLICK ? gl.createTexture() : null;
      this.fullscreenVao = gl.createVertexArray();

      if (
        !this.emissionBuffer ||
        !this.emissionVao ||
        !this.fullscreenVao ||
        (BUILD_CLICK && !this.sceneDiskBuffer) ||
        (BUILD_CLICK && !this.sceneDiskVao) ||
        (BUILD_CLICK && !this.ringBuffer) ||
        (BUILD_CLICK && !this.ringIndexBuffer) ||
        (BUILD_CLICK && !this.ringVao) ||
        (BUILD_CLICK && !this.ringTexture) ||
        !this.triangleBuffer ||
        !this.triangleVao ||
        (BUILD_TRAIL && !this.trailBuffer) ||
        (BUILD_TRAIL && !this.trailVao) ||
        !this.triangleTexture ||
        !this.triangleOverlayTexture ||
        (BUILD_TRAIL && !this.trailTexture) ||
        !this.circleTexture
      )
      {
        throw new Error('WebGL2 无法创建几何缓冲');
      }

      gl.bindVertexArray(this.emissionVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.emissionBuffer);

      const stride = COMPONENTS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
      const positionLocation = 0;
      const colorLocation = 1;
      const coverageLocation = 2;

      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(
        positionLocation,
        2,
        gl.FLOAT,
        false,
        stride,
        0,
      );
      gl.enableVertexAttribArray(colorLocation);
      gl.vertexAttribPointer(
        colorLocation,
        3,
        gl.FLOAT,
        false,
        stride,
        2 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.enableVertexAttribArray(coverageLocation);
      gl.vertexAttribPointer(
        coverageLocation,
        1,
        gl.FLOAT,
        false,
        stride,
        5 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      if (BUILD_CLICK)
      {
      gl.bindVertexArray(this.sceneDiskVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sceneDiskBuffer);

      const diskStride = COMPONENTS_PER_DISK_VERTEX *
        Float32Array.BYTES_PER_ELEMENT;

      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(
        0,
        2,
        gl.FLOAT,
        false,
        diskStride,
        0,
      );
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(
        1,
        2,
        gl.FLOAT,
        false,
        diskStride,
        2 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(
        2,
        3,
        gl.FLOAT,
        false,
        diskStride,
        4 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(
        3,
        1,
        gl.FLOAT,
        false,
        diskStride,
        7 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.bindVertexArray(this.ringVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ringBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ringIndexBuffer);

      const ringStride = COMPONENTS_PER_RING_VERTEX *
        Float32Array.BYTES_PER_ELEMENT;

      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(
        0,
        2,
        gl.FLOAT,
        false,
        ringStride,
        0,
      );
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(
        1,
        2,
        gl.FLOAT,
        false,
        ringStride,
        2 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(
        2,
        3,
        gl.FLOAT,
        false,
        ringStride,
        4 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(
        3,
        1,
        gl.FLOAT,
        false,
        ringStride,
        7 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(
        4,
        1,
        gl.FLOAT,
        false,
        ringStride,
        8 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      }
      this._initializeTexturedVertexArray(this.triangleVao, this.triangleBuffer);
      if (BUILD_TRAIL) this._initializeTexturedVertexArray(this.trailVao, this.trailBuffer);

      // Ring3 的 Alpha 不参与 sRGB 解码；R8 保留 Unity Alpha 采样真值。
      if (BUILD_CLICK)
      {
      gl.bindTexture(gl.TEXTURE_2D, this.ringTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        RING3_ALPHA_WIDTH,
        RING3_ALPHA_HEIGHT,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        RING3_ALPHA,
      );

      // 解包纹理禁用 Mipmap，并沿用 Unity importer 的 Bilinear + Clamp。
      }
      gl.bindTexture(gl.TEXTURE_2D, this.triangleTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.SRGB8_ALPHA8,
        TRIANGLE_TEXTURE_SIZE,
        TRIANGLE_TEXTURE_SIZE,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        TRIANGLE_TEXTURE_RGBA,
      );

      // 透明宿主使用固定的独立 Coverage；RGB 字节与 Scene 纹理完全相同。
      gl.bindTexture(gl.TEXTURE_2D, this.triangleOverlayTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.SRGB8_ALPHA8,
        TRIANGLE_TEXTURE_SIZE,
        TRIANGLE_TEXTURE_SIZE,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        TRIANGLE_TEXTURE_OVERLAY_RGBA,
      );

      // Trail_03 的 Importer 使用 sRGB、Bilinear、Repeat 且关闭 Mipmap。
      // RGB 保留原逐通道纹理；派生 Alpha 只描述非零 texel 的 Coverage 支持面。
      if (BUILD_TRAIL)
      {
      gl.bindTexture(gl.TEXTURE_2D, this.trailTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.SRGB8_ALPHA8,
        TRAIL_TEXTURE_WIDTH,
        TRAIL_TEXTURE_HEIGHT,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        TRAIL_TEXTURE_RGBA,
      );

      // Circle_01 使用 Repeat；完整 Quad 在片元阶段采样才能保留二维边缘。
      }
      if (BUILD_CLICK)
      {
      gl.bindTexture(gl.TEXTURE_2D, this.circleTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.SRGB8_ALPHA8,
        CIRCLE_TEXTURE_SIZE,
        CIRCLE_TEXTURE_SIZE,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        CIRCLE_TEXTURE_RGBA,
      );
      }
      gl.bindTexture(gl.TEXTURE_2D, null);

      this.contextLost = false;
      this.available = true;

      if (this.sceneBackgroundSource)
      {
        this.sceneBackgroundUploadRetryPending =
          !this._replaceSceneBackgroundTexture(this.sceneBackgroundSource);
      }

      if (this.width > 0 && this.height > 0)
      {
        this._allocateTargets();
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL2 Scene 初始化失败:', error);
      this.available = false;
      this._deleteResources();
    }
  }

  _initializeTexturedVertexArray(vertexArray, buffer)
  {
    const gl = this.gl;
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    const stride = COMPONENTS_PER_TRIANGLE_VERTEX *
      Float32Array.BYTES_PER_ELEMENT;

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(
      0,
      2,
      gl.FLOAT,
      false,
      stride,
      0,
    );
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(
      1,
      2,
      gl.FLOAT,
      false,
      stride,
      2 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(
      2,
      3,
      gl.FLOAT,
      false,
      stride,
      4 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(
      3,
      1,
      gl.FLOAT,
      false,
      stride,
      7 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(
      4,
      1,
      gl.FLOAT,
      false,
      stride,
      8 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  _handleContextLost(event)
  {
    event?.preventDefault?.();
    this.ringIndexBuffer = null;
    this._ringUploadedIndexVersion = -1;
    this.uniformLocations?.clear();
    this.contextLost = true;
    this.available = false;
    this.sceneFrameReady = false;
    this.bloomSourceFrameReady = false;
    this.sceneOverlayFrameReady = false;
    this.sceneBackgroundFrameReady = false;
    this.sceneBackgroundUploadRetryPending =
      this.sceneBackgroundSource !== null;
  }

  _handleContextRestored()
  {
    // Context 恢复后旧 WebGL 对象已由浏览器作废；再次 delete 会产生
    // INVALID_OPERATION，并让首个恢复帧被误判为渲染失败。
    this._forgetResourceReferences();
    this._initialize();
    // 恢复初始化中的瞬时分配失败允许在下一帧按原尺寸重试一次。
    this.failedResizeSignature = null;
  }

  _forgetResourceReferences()
  {
    this.uniformLocations?.clear();
    this.sourceTarget = null;
    this.bloomSourceTarget = null;
    this.sceneOverlayTarget = null;
    this.levels = [];
    this.sceneFrameReady = false;
    this.bloomSourceFrameReady = false;
    this.sceneOverlayFrameReady = false;
    this.sceneBackgroundFrameReady = false;
    // Context 恢复代表一套新资源，旧尺寸的失败结论不能继续复用。
    this.failedResizeSignature = null;
    this.programs = null;
    this.emissionBuffer = null;
    this.emissionVao = null;
    this.sceneDiskBuffer = null;
    this.sceneDiskVao = null;
    this.ringBuffer = null;
    this.ringIndexBuffer = null;
    this._ringUploadedIndexVersion = -1;
    this.ringVao = null;
    this.ringTexture = null;
    this.triangleBuffer = null;
    this.triangleVao = null;
    this.trailBuffer = null;
    this.trailVao = null;
    this.triangleTexture = null;
    this.triangleOverlayTexture = null;
    this.trailTexture = null;
    this.circleTexture = null;
    this.sceneBackgroundTexture = null;
    this.sceneBackgroundTarget = null;
    this.fullscreenVao = null;
    this.vertexCount = 0;
    this.sceneDiskVertexCount = 0;
    this.ringVertexCount = 0;
    this.triangleVertexCount = 0;
    this.ringIndexCount = 0;
    this._ringTopologyCount = 0;
    this.trailVertexCount = 0;
    this.stats.vertexCount = 0;
    this.stats.sceneVertexCount = 0;
    this.stats.sceneDiskVertexCount = 0;
    this.stats.sceneRingVertexCount = 0;
    this.stats.sceneTriangleVertexCount = 0;
    this.stats.sceneTrailVertexCount = 0;
    this.stats.diskVertexCount = 0;
    this.stats.ringVertexCount = 0;
    this.stats.triangleVertexCount = 0;
    this.stats.trailVertexCount = 0;
    this.stats.levelCount = 0;
    this.stats.bloomPixels = 0;
  }

  _createTarget(width, height)
  {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();

    if (!texture || !framebuffer)
    {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      throw new Error('WebGL2 无法创建 Bloom RenderTarget');
    }

    try
    {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA16F,
        width,
        height,
        0,
        gl.RGBA,
        gl.HALF_FLOAT,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      );

      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
      {
        throw new Error('WebGL2 浮点 Bloom Framebuffer 不完整');
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);

      return {
        texture,
        framebuffer,
        width,
        height,
      };
    }
    catch (error)
    {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw error;
    }
  }

  _deleteTargets()
  {
    const gl = this.gl;

    if (gl && !this.contextLost)
    {
      deleteTarget(gl, this.sourceTarget);
      deleteTarget(gl, this.bloomSourceTarget);
      deleteTarget(gl, this.sceneOverlayTarget);
      deleteTarget(gl, this.sceneBackgroundTarget);

      for (const level of this.levels)
      {
        deleteTarget(gl, level.down);
        deleteTarget(gl, level.scratch);
        deleteTarget(gl, level.up);
      }
    }

    this.sourceTarget = null;
    this.bloomSourceTarget = null;
    this.sceneOverlayTarget = null;
    this.sceneBackgroundTarget = null;
    this.sceneFrameReady = false;
    this.bloomSourceFrameReady = false;
    this.sceneOverlayFrameReady = false;
    this.sceneBackgroundFrameReady = false;
    this.levels = [];
    this.stats.levelCount = 0;
    this.stats.bloomPixels = 0;
  }

  releaseFrameResources()
  {
    this._deleteTargets();
    this.beginFrame();
    this.displayWidth = 1;
    this.displayHeight = 1;
    this.sourceWidth = 0;
    this.sourceHeight = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.resolutionScale = 0;
    this.diffusion = 0;
    this.sampleScale = 1;
    this.failedResizeSignature = null;

    if (
      this.canvas &&
      (this.canvas.width !== 1 || this.canvas.height !== 1)
    )
    {
      // 闲置后端只保留最小默认帧缓冲；Program、静态纹理和背景源纹理
      // 留在 Context 中，重新启用时无需完成昂贵的完整初始化。
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
  }

  _deleteResources()
  {
    this.uniformLocations?.clear();
    if (!this.gl)
    {
      return;
    }

    const gl = this.gl;

    this._deleteTargets();

    if (this.programs)
    {
      for (const program of Object.values(this.programs))
      {
        if (program)
        {
          gl.deleteProgram(program);
        }
      }
    }

    gl.deleteBuffer(this.emissionBuffer);
    gl.deleteVertexArray(this.emissionVao);
    gl.deleteBuffer(this.sceneDiskBuffer);
    gl.deleteVertexArray(this.sceneDiskVao);
    gl.deleteBuffer(this.ringBuffer);
    gl.deleteBuffer(this.ringIndexBuffer);
    gl.deleteVertexArray(this.ringVao);
    gl.deleteTexture(this.ringTexture);
    gl.deleteBuffer(this.triangleBuffer);
    gl.deleteVertexArray(this.triangleVao);
    gl.deleteBuffer(this.trailBuffer);
    gl.deleteVertexArray(this.trailVao);
    gl.deleteTexture(this.triangleTexture);
    gl.deleteTexture(this.triangleOverlayTexture);
    gl.deleteTexture(this.trailTexture);
    gl.deleteTexture(this.circleTexture);
    gl.deleteTexture(this.sceneBackgroundTexture);
    gl.deleteVertexArray(this.fullscreenVao);
    this.programs = null;
    this.emissionBuffer = null;
    this.emissionVao = null;
    this.sceneDiskBuffer = null;
    this.sceneDiskVao = null;
    this.ringBuffer = null;
    this.ringIndexBuffer = null;
    this._ringUploadedIndexVersion = -1;
    this.ringVao = null;
    this.ringTexture = null;
    this.triangleBuffer = null;
    this.triangleVao = null;
    this.trailBuffer = null;
    this.trailVao = null;
    this.triangleTexture = null;
    this.triangleOverlayTexture = null;
    this.trailTexture = null;
    this.circleTexture = null;
    this.sceneBackgroundTexture = null;
    this.sceneBackgroundTarget = null;
    this.sceneBackgroundFrameReady = false;
    this.fullscreenVao = null;
    this.stats.vertexCount = 0;
    this.stats.sceneVertexCount = 0;
    this.stats.sceneDiskVertexCount = 0;
    this.stats.sceneRingVertexCount = 0;
    this.stats.sceneTriangleVertexCount = 0;
    this.stats.sceneTrailVertexCount = 0;
    this.stats.diskVertexCount = 0;
    this.stats.ringVertexCount = 0;
    this.stats.triangleVertexCount = 0;
    this.stats.trailVertexCount = 0;
    this.stats.levelCount = 0;
    this.stats.bloomPixels = 0;
  }

  _discardPendingErrors()
  {
    const gl = this.gl;

    if (!gl || typeof gl.getError !== 'function')
    {
      return;
    }

    // 分配失败的 OOM 可能延迟到后续 getError；缩小后的有效帧不能继承旧错误。
    for (let count = 0; count < 8; count++)
    {
      if (gl.getError() === gl.NO_ERROR)
      {
        return;
      }
    }
  }

  _createSceneBackgroundTexture(source)
  {
    const gl = this.gl;
    const texture = gl?.createTexture();

    if (!gl || !texture)
    {
      return null;
    }

    const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D);
    const previousFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const previousPremultiply = gl.getParameter(
      gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
    );

    try
    {
      this._discardPendingErrors();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // ImageBitmap 会忽略 UNPACK_FLIP_Y_WEBGL，方向统一交给背景 Shader。
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.SRGB8_ALPHA8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );

      const error = gl.getError();

      if (error !== gl.NO_ERROR)
      {
        throw new Error(`WebGL2 背景纹理上传错误码 ${error}`);
      }

      return texture;
    }
    catch (error)
    {
      console.warn('[BAClickFX] Scene 背景无法上传，保留透明回退:', error);
      gl.deleteTexture(texture);
      return null;
    }
    finally
    {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previousFlipY);
      gl.pixelStorei(
        gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
        previousPremultiply,
      );
      gl.bindTexture(gl.TEXTURE_2D, previousTexture);
    }
  }

  _replaceSceneBackgroundTexture(source)
  {
    const dimensions = getTexImageSourceDimensions(source);

    if (!dimensions || !this.gl || this.contextLost)
    {
      return false;
    }

    const texture = this._createSceneBackgroundTexture(source);

    if (!texture)
    {
      return false;
    }

    const requiresTarget = !!this.sourceTarget &&
      this.sourceWidth > 0 &&
      this.sourceHeight > 0;
    const target = requiresTarget
      ? this._createSceneBackgroundTarget(
          texture,
          dimensions.width,
          dimensions.height,
        )
      : null;

    if (requiresTarget && !target)
    {
      // 新背景必须连同其线性场景目标一起成功，旧纹理才能被替换。
      this.gl.deleteTexture(texture);
      return false;
    }

    const previousTexture = this.sceneBackgroundTexture;
    const previousTarget = this.sceneBackgroundTarget;

    this.sceneBackgroundTexture = texture;
    this.sceneBackgroundTarget = target;
    this.sceneBackgroundSource = source;
    this.sceneBackgroundWidth = dimensions.width;
    this.sceneBackgroundHeight = dimensions.height;
    this.sceneBackgroundFrameReady = false;
    this.sceneBackgroundUploadRetryPending = false;
    // 背景目标属于尺寸资源的一部分；新背景可以让旧失败签名失效。
    this.failedResizeSignature = null;
    this.gl.deleteTexture(previousTexture);
    deleteTarget(this.gl, previousTarget);
    return true;
  }

  setCompositingReference(source, options = {})
  {
    if (!(BUILD_REFERENCE)) return false;

    if (source === null)
    {
      this.gl?.deleteTexture(this.sceneBackgroundTexture);
      deleteTarget(this.gl, this.sceneBackgroundTarget);
      this.sceneBackgroundSource = null;
      this.sceneBackgroundWidth = 0;
      this.sceneBackgroundHeight = 0;
      this.sceneBackgroundTexture = null;
      this.sceneBackgroundTarget = null;
      this.sceneBackgroundFrameReady = false;
      this.sceneBackgroundUploadRetryPending = false;
      this.failedResizeSignature = null;
      return true;
    }

    if (options.fit !== undefined && options.fit !== 'cover')
    {
      return false;
    }

    if (this.contextLost || !this.gl)
    {
      const dimensions = getTexImageSourceDimensions(source);

      if (!dimensions)
      {
        return false;
      }

      // Context 恢复时再上传最新宿主源，不能重新使用丢失前的旧背景。
      this.sceneBackgroundSource = source;
      this.sceneBackgroundWidth = dimensions.width;
      this.sceneBackgroundHeight = dimensions.height;
      this.sceneBackgroundFrameReady = false;
      this.sceneBackgroundUploadRetryPending = true;
      return true;
    }

    return this._replaceSceneBackgroundTexture(source);
  }

  _getSceneBackgroundUvScale(
    backgroundWidth = this.sceneBackgroundWidth,
    backgroundHeight = this.sceneBackgroundHeight,
  )
  {
    const sourceAspect = backgroundWidth / backgroundHeight;
    const displayAspect = this.displayWidth / this.displayHeight;

    if (sourceAspect > displayAspect)
    {
      return [displayAspect / sourceAspect, 1];
    }

    return [1, sourceAspect / displayAspect];
  }

  _createSceneBackgroundTarget(
    texture,
    backgroundWidth,
    backgroundHeight,
  )
  {
    if (
      !texture ||
      !this.programs?.sceneBackground ||
      !this.sourceTarget ||
      this.sourceWidth <= 0 ||
      this.sourceHeight <= 0
    )
    {
      return null;
    }

    const gl = this.gl;
    const program = this.programs.sceneBackground;
    const uvScale = this._getSceneBackgroundUvScale(
      backgroundWidth,
      backgroundHeight,
    );
    let target = null;

    try
    {
      target = this._createTarget(this.sourceWidth, this.sourceHeight);
      gl.disable(gl.BLEND);
      gl.useProgram(program);
      this._bindTexture(
        program,
        'u_background',
        texture,
        0,
      );
      gl.uniform2f(
        this._getUniformLocation(program, 'u_uvScale'),
        uvScale[0],
        uvScale[1],
      );
      this._drawFullscreen(
        program,
        target,
        this.sourceWidth,
        this.sourceHeight,
      );

      const error = gl.getError();

      if (error !== gl.NO_ERROR)
      {
        throw new Error(`WebGL2 Scene 背景解析错误码 ${error}`);
      }

      return target;
    }
    catch (error)
    {
      console.warn('[BAClickFX] Scene 背景缓冲创建失败，保留现有背景:', error);
      deleteTarget(gl, target);
      // 背景额外缓冲分配失败不能污染下一帧并禁用整个 Scene 后端。
      this._discardPendingErrors();
      return null;
    }
  }

  _rebuildSceneBackgroundTarget()
  {
    if (!(BUILD_REFERENCE)) return false;

    const target = this._createSceneBackgroundTarget(
      this.sceneBackgroundTexture,
      this.sceneBackgroundWidth,
      this.sceneBackgroundHeight,
    );

    if (!target)
    {
      deleteTarget(this.gl, this.sceneBackgroundTarget);
      this.sceneBackgroundTarget = null;
      return false;
    }

    deleteTarget(this.gl, this.sceneBackgroundTarget);
    this.sceneBackgroundTarget = target;
    return true;
  }

  _copySceneBackgroundToTarget(target)
  {
    if (!(BUILD_REFERENCE)) return false;

    if (!this.sceneBackgroundTarget || !target)
    {
      return false;
    }

    const gl = this.gl;

    // Scene 与 Final 复用同一份半浮点背景，避免二次纹理采样产生全屏残差。
    gl.bindFramebuffer(
      gl.READ_FRAMEBUFFER,
      this.sceneBackgroundTarget.framebuffer,
    );
    gl.bindFramebuffer(
      gl.DRAW_FRAMEBUFFER,
      target.framebuffer,
    );
    gl.blitFramebuffer(
      0,
      0,
      this.sourceWidth,
      this.sourceHeight,
      0,
      0,
      this.sourceWidth,
      this.sourceHeight,
      gl.COLOR_BUFFER_BIT,
      gl.NEAREST,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    return true;
  }

  _ensureBloomSourceTarget()
  {
    if (
      this.bloomSourceTarget?.width === this.sourceWidth &&
      this.bloomSourceTarget?.height === this.sourceHeight
    )
    {
      return true;
    }

    deleteTarget(this.gl, this.bloomSourceTarget);
    this.bloomSourceTarget = this._createTarget(
      this.sourceWidth,
      this.sourceHeight,
    );
    return this.bloomSourceTarget !== null;
  }

  _allocateTargets()
  {
    if (!this.available || !this.gl || this.width <= 0 || this.height <= 0)
    {
      return false;
    }

    try
    {
      this._deleteTargets();
      this.sourceTarget = this._createTarget(
        this.sourceWidth,
        this.sourceHeight,
      );
      this.sceneOverlayTarget = this._createTarget(
        this.sourceWidth,
        this.sourceHeight,
      );

      const pyramid = calculatePyramidSettings(
        this.sourceWidth,
        this.sourceHeight,
        this.resolutionScale,
        this.diffusion,
      );
      const levelCount = pyramid.levelCount;

      this.sampleScale = pyramid.sampleScale;
      let width = this.width;
      let height = this.height;

      for (let index = 0; BUILD_BLOOM && index < levelCount; index++)
      {
        const level =
        {
          width,
          height,
          down: null,
          scratch: null,
          up: null,
        };

        // 先登记空槽位，任一步分配失败时 _deleteTargets() 都能释放已创建资源。
        this.levels.push(level);
        level.down = this._createTarget(width, height);
        level.scratch = null;
        level.up = index === levelCount - 1
          ? null
          : this._createTarget(width, height);

        if (width === 1 && height === 1)
        {
          break;
        }

        width = Math.max(1, width >> 1);
        height = Math.max(1, height >> 1);
      }

      if (this.sceneBackgroundTexture)
      {
        if (!this._rebuildSceneBackgroundTarget())
        {
          throw new Error('WebGL2 Scene 背景目标重建失败');
        }
      }

      this.stats.levelCount = this.levels.length;
      this.stats.bloomPixels = this.levels.reduce(
        (total, level) => total + level.width * level.height,
        0,
      );
      this.failedResizeSignature = null;
      return true;
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL2 Scene 缓冲创建失败:', error);
      this.failedResizeSignature = this._createResizeSignature(
        this.sourceWidth,
        this.sourceHeight,
        this.width,
        this.height,
        this.diffusion,
      );
      this._deleteTargets();
      this._discardPendingErrors();
      return false;
    }
  }

  _createResizeSignature(
    sourceWidth,
    sourceHeight,
    width,
    height,
    diffusion,
  )
  {
    return `${sourceWidth}:${sourceHeight}:${width}:${height}:${diffusion}`;
  }

  resize(
    displayWidth,
    displayHeight,
    dpr,
    resolutionScale,
    diffusion,
  )
  {
    const safeDisplayWidth = Math.max(1, displayWidth);
    const safeDisplayHeight = Math.max(1, displayHeight);
    const safeDpr = clamp(dpr, 1, 4);
    const safeScale = clamp(resolutionScale, 0.1, 0.75);
    const sourceWidth = Math.max(1, Math.round(
      safeDisplayWidth * safeDpr,
    ));
    const sourceHeight = Math.max(1, Math.round(
      safeDisplayHeight * safeDpr,
    ));
    const width = Math.max(1, Math.floor(
      sourceWidth * safeScale,
    ));
    const height = Math.max(1, Math.floor(
      sourceHeight * safeScale,
    ));
    const safeDiffusion = clamp(diffusion, 0, 10);
    const resizeSignature = this._createResizeSignature(
      sourceWidth,
      sourceHeight,
      width,
      height,
      safeDiffusion,
    );

    if (resizeSignature === this.failedResizeSignature)
    {
      // 同一尺寸在一帧中可能被特效与 Bloom 后端各探测一次。
      return false;
    }

    if (
      sourceWidth > this.maximumTextureSize ||
      sourceHeight > this.maximumTextureSize ||
      sourceWidth > this.maximumViewportWidth ||
      sourceHeight > this.maximumViewportHeight
    )
    {
      this.failedResizeSignature = resizeSignature;
      console.warn('[BAClickFX] WebGL2 Scene 尺寸超过设备上限');
      this._deleteTargets();
      return false;
    }

    if (this.sceneBackgroundUploadRetryPending)
    {
      // 恢复阶段额外重试一次背景上传；失败后由显式 setSceneBackground
      // 或下一次 Context 恢复重新触发，避免每帧重复上传无效源。
      this.sceneBackgroundUploadRetryPending = false;

      if (!this._replaceSceneBackgroundTexture(this.sceneBackgroundSource))
      {
        return false;
      }
    }

    const unchanged = sourceWidth === this.sourceWidth &&
      sourceHeight === this.sourceHeight &&
      width === this.width &&
      height === this.height &&
      safeDiffusion === this.diffusion &&
      this.sourceTarget !== null &&
      this.sceneOverlayTarget !== null &&
      this.levels.length > 0;

    this.displayWidth = safeDisplayWidth;
    this.displayHeight = safeDisplayHeight;
    this.dpr = safeDpr;
    this.resolutionScale = safeScale;
    this.diffusion = safeDiffusion;
    this.sourceWidth = sourceWidth;
    this.sourceHeight = sourceHeight;

    if (unchanged)
    {
      this.failedResizeSignature = null;
      return this.available;
    }

    this.width = width;
    this.height = height;
    this.canvas.width = sourceWidth;
    this.canvas.height = sourceHeight;

    return this._allocateTargets();
  }





  _getUniformLocation(program, name)
  {
    this.uniformLocations ??= new Map();
    let locations = this.uniformLocations.get(program);
    if (!locations)
    {
      locations = new Map();
      this.uniformLocations.set(program, locations);
    }
    // null 也代表已查询，Shader 优化掉的 Uniform 不应每帧重试。
    if (!locations.has(name))
    {
      locations.set(name, this.gl.getUniformLocation(program, name));
    }
    return locations.get(name);
  }

  _drawTexturedAdditiveBatch(
    vertexCount,
    vertexArray,
    texture,
    transparentOverlay,
    alphaModulatesEmission = true,
    antialiasGeometryCoverage = false,
    roundTriangle = false,
  )
  {
    if (vertexCount <= 0)
    {
      return;
    }

    const gl = this.gl;
    const program = this.programs.triangle;

    if (transparentOverlay)
    {
      // RGB 保持 Unity One/One 加色，Alpha 单独累积几何 Coverage 并集。
      gl.blendFuncSeparate(
        gl.ONE,
        gl.ONE,
        gl.ONE,
        gl.ONE_MINUS_SRC_ALPHA,
      );
    }
    else
    {
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    }

    gl.useProgram(program);
    gl.uniform1i(
      this._getUniformLocation(program, 'u_transparentOverlay'),
      transparentOverlay ? 1 : 0,
    );
    gl.uniform1i(
      this._getUniformLocation(program, 'u_alphaModulatesEmission'),
      alphaModulatesEmission ? 1 : 0,
    );
    gl.uniform1i(
      this._getUniformLocation(program, 'u_antialiasGeometryCoverage'),
      antialiasGeometryCoverage ? 1 : 0,
    );
    gl.uniform1i(
      this._getUniformLocation(program, 'u_roundTriangle'),
      roundTriangle ? 1 : 0,
    );
    gl.uniform2f(
      this._getUniformLocation(program, 'u_displaySize'),
      this.displayWidth,
      this.displayHeight,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(
      this._getUniformLocation(program, 'u_texture'),
      0,
    );
    gl.bindVertexArray(vertexArray);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  }

  _drawGeometryBatches(
    additiveProgram,
    transparentOverlay = false,
    clickEmissionScales = null,
  )
  {
    const gl = this.gl;
    const diskEmissionScale = Math.max(
      0,
      clickEmissionScales?.disk ?? 1,
    );
    const ringEmissionScale = Math.max(
      0,
      clickEmissionScales?.ring ?? 1,
    );

    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);

    if (this.sceneDiskVertexCount > 0)
    {
      const diskProgram = this.programs.sceneDisk;

      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(diskProgram);
      gl.uniform2f(
        this._getUniformLocation(diskProgram, 'u_displaySize'),
        this.displayWidth,
        this.displayHeight,
      );
      gl.uniform1f(
        this._getUniformLocation(diskProgram, 'u_emissionScale'),
        diskEmissionScale,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.circleTexture);
      gl.uniform1i(
        this._getUniformLocation(diskProgram, 'u_texture'),
        0,
      );
      gl.bindVertexArray(this.sceneDiskVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.sceneDiskVertexCount);
    }

    // Trail 与 Cross2 同属 Queue 4499；先画 Cross2，再提交 Trail 的
    // One/One 材质，随后完成同队列的其余加色粒子。
    this._drawTexturedAdditiveBatch(
      this.trailVertexCount,
      this.trailVao,
      this.trailTexture,
      transparentOverlay,
      false,
      true,
    );

    if (this.vertexCount > 0)
    {
      if (transparentOverlay)
      {
        // RGB 仍严格加色；Alpha 独立保存多个粒子 Coverage 的 source-over 并集。
        gl.blendFuncSeparate(
          gl.ONE,
          gl.ONE,
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA,
        );
      }
      else
      {
        // 普通加色粒子不能覆盖 Cross2 留下的背景衰减 Coverage。
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
      }

      gl.useProgram(additiveProgram);
      const compositingLocation = this._getUniformLocation(
        additiveProgram,
        'u_transparentOverlay',
      );

      if (compositingLocation !== null)
      {
        gl.uniform1i(compositingLocation, transparentOverlay ? 1 : 0);
      }

      gl.uniform2f(
        this._getUniformLocation(additiveProgram, 'u_displaySize'),
        this.displayWidth,
        this.displayHeight,
      );
      gl.bindVertexArray(this.emissionVao);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    }

    if (this.ringVertexCount > 0)
    {
      const ringProgram = this.programs.dissolveRing;

      if (transparentOverlay)
      {
        // Shader 已预乘纹理 Alpha，RGB 数值等价于 Unity SrcAlpha/One。
        gl.blendFuncSeparate(
          gl.ONE,
          gl.ONE,
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA,
        );
      }
      else
      {
        // FX_MAT_Touch_Tri3 的 RGB 仍是 SrcAlpha/One；Alpha 不参与网页
        // 背景覆盖，因此保持 Cross2 已写入的 Coverage。
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE);
      }

      gl.useProgram(ringProgram);
      gl.uniform1i(
        this._getUniformLocation(ringProgram, 'u_transparentOverlay'),
        transparentOverlay ? 1 : 0,
      );
      gl.uniform1f(
        this._getUniformLocation(ringProgram, 'u_emissionScale'),
        ringEmissionScale,
      );
      gl.uniform2f(
        this._getUniformLocation(ringProgram, 'u_displaySize'),
        this.displayWidth,
        this.displayHeight,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.ringTexture);
      gl.uniform1i(
        this._getUniformLocation(ringProgram, 'u_texture'),
        0,
      );
      gl.bindVertexArray(this.ringVao);
      gl.drawElements(gl.TRIANGLES, this.ringIndexCount, gl.UNSIGNED_INT, 0);
    }

    // Tri2 的 Queue 4550 高于其余 FX_Touch 材质，最后绘制三角碎片。
    if (this.triangleVertexCount > 0)
    {
      this._drawTexturedAdditiveBatch(
        this.triangleVertexCount,
        this.triangleVao,
        transparentOverlay
          ? this.triangleOverlayTexture
          : this.triangleTexture,
        transparentOverlay,
        true,
        false,
        true,
      );
    }

    gl.disable(gl.BLEND);
  }

  _uploadGeometryBuffer(buffer, data, vertexCount, components)
  {
    if (vertexCount <= 0)
    {
      return;
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, vertexCount * components), gl.DYNAMIC_DRAW);
  }

  _uploadGeometryBatches()
  {
    this._prepareRingIndices();
    // 每次场景提交都重新上传；仅复用本次清晰层与发光层，不能跨调用猜测几何未变。
    this._uploadGeometryBuffer(this.sceneDiskBuffer, this.sceneDiskVertexData,
      this.sceneDiskVertexCount, COMPONENTS_PER_DISK_VERTEX);
    this._uploadGeometryBuffer(this.trailBuffer, this.trailVertexData,
      this.trailVertexCount, COMPONENTS_PER_TRAIL_VERTEX);
    this._uploadGeometryBuffer(this.emissionBuffer, this.vertexData,
      this.vertexCount, COMPONENTS_PER_VERTEX);
    this._uploadGeometryBuffer(this.ringBuffer, this.ringVertexData,
      this.ringVertexCount, COMPONENTS_PER_RING_VERTEX);
    if (this.ringIndexCount > 0 && this._ringUploadedIndexVersion !== this._ringIndexVersion)
    {
      // ELEMENT_ARRAY_BUFFER 属于 VAO 状态，不能覆盖其他几何的绑定。
      this.gl.bindVertexArray(this.ringVao);
      this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.ringIndexBuffer);
      this.gl.bufferData(this.gl.ELEMENT_ARRAY_BUFFER,
        this.ringIndexData.subarray(0, this.ringIndexCount), this.gl.STATIC_DRAW);
      this.gl.bindVertexArray(null);
      this._ringUploadedIndexVersion = this._ringIndexVersion;
    }
    this._uploadGeometryBuffer(this.triangleBuffer, this.triangleVertexData,
      this.triangleVertexCount, COMPONENTS_PER_TRIANGLE_VERTEX);
  }

  _renderScaledBloomSource(settings)
  {
    const disk = Math.max(0, settings.diskEmissionScale ?? 1);
    const ring = Math.max(0, settings.ringEmissionScale ?? 1);

    this.bloomSourceFrameReady = false;

    if (disk === 1 && ring === 1)
    {
      // Unity 默认值直接复用原 Scene；从自定义倍率切回后同步释放整屏
      // HDR 目标，避免一次调节让默认路径长期保留额外显存。
      deleteTarget(this.gl, this.bloomSourceTarget);
      this.bloomSourceTarget = null;
      return true;
    }

    if (!this._ensureBloomSourceTarget())
    {
      return false;
    }

    const gl = this.gl;

    gl.bindFramebuffer(
      gl.FRAMEBUFFER,
      this.bloomSourceTarget.framebuffer,
    );
    gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this._copySceneBackgroundToTarget(this.bloomSourceTarget);

    // 复用清晰 Scene 的几何与队列，只缩放点击材质的 Bloom RGB。Coverage、
    // Cross2 目标衰减以及拖尾/碎片发射仍保持 Unity 原顺序和数值。
    this._drawGeometryBatches(
      this.programs.scene,
      settings.outputCompositing === 'browser-overlay',
      { disk, ring },
    );
    this.bloomSourceFrameReady = true;
    return true;
  }

  renderScene(settings = {})
  {
    if (
      !this.sceneEnabled ||
      !this.available ||
      this.contextLost ||
      !this.programs?.scene ||
      !this.sourceTarget
    )
    {
      return false;
    }

    const gl = this.gl;
    const needsCoverageOverlay =
      settings.outputCompositing === 'browser-overlay' &&
      !isIndependentHostCompositing(settings.hostCompositing);

    try
    {
      gl.bindFramebuffer(
        gl.FRAMEBUFFER,
        this.sourceTarget.framebuffer,
      );
      gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.sceneFrameReady = false;
      this.bloomSourceFrameReady = false;
      this.sceneOverlayFrameReady = false;
      this.sceneBackgroundFrameReady = this._copySceneBackgroundToTarget(
        this.sourceTarget,
      );
      this.stats.sceneVertexCount = this.vertexCount +
        this.triangleVertexCount + this.trailVertexCount;
      this.stats.sceneDiskVertexCount = this.sceneDiskVertexCount;
      this.stats.sceneRingVertexCount = this.ringIndexCount;
      this.stats.sceneTriangleVertexCount = this.triangleVertexCount;
      this.stats.sceneTrailVertexCount = this.trailVertexCount;

      this._prepareRingIndices();
      if (!this._hasGeometry())
      {
        if (needsCoverageOverlay)
        {
          this.sceneOverlayFrameReady = this._renderSceneOverlay();
        }

        this.sceneFrameReady = true;
        return true;
      }

      this._uploadGeometryBatches();
      this._drawGeometryBatches(
        this.programs.scene,
        settings.outputCompositing === 'browser-overlay',
      );

      if (!this._renderScaledBloomSource(settings))
      {
        throw new Error('WebGL2 独立点击 Bloom 源生成失败');
      }

      if (needsCoverageOverlay)
      {
        this.sceneOverlayFrameReady = this._renderSceneOverlay();

        if (!this.sceneOverlayFrameReady)
        {
          throw new Error('WebGL2 Scene 传输上界生成失败');
        }
      }

      const error = gl.getError();

      if (error !== gl.NO_ERROR)
      {
        throw new Error(`WebGL2 错误码 ${error}`);
      }

      this.sceneFrameReady = true;
      return true;
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL2 清晰特效渲染失败:', error);
      this._ringUploadedIndexVersion = -1;
      this.clear();
      this._deleteTargets();
      this.available = false;
      return false;
    }
  }

















































  _bindTexture(program, name, texture, unit)
  {
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this._getUniformLocation(program, name), unit);
  }

  _drawFullscreen(program, target, width, height)
  {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.bindVertexArray(this.fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _renderEmission(settings)
  {
    const gl = this.gl;
    const transparentOverlay =
      settings.outputCompositing === 'browser-overlay';

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sourceTarget.framebuffer);
    gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this._uploadGeometryBatches();
    this._drawGeometryBatches(
      this.programs.emission,
      transparentOverlay,
    );
  }

  _renderPrefilter(settings)
  {
    const gl = this.gl;
    const program = this.programs.prefilter;
    const level = this.levels[0];
    const sourceTarget = this.bloomSourceFrameReady
      ? this.bloomSourceTarget
      : this.sourceTarget;
    const softKnee = Number.isFinite(settings.softKnee)
      ? clamp(settings.softKnee, 0, 1)
      : 0;
    const clampMax = resolveUnityBloomClamp(settings.clamp);

    gl.useProgram(program);
    this._bindTexture(program, 'u_source', sourceTarget.texture, 0);
    gl.uniform2f(
      this._getUniformLocation(program, 'u_sourceTexel'),
      1 / this.sourceWidth,
      1 / this.sourceHeight,
    );
    gl.uniform1f(
      this._getUniformLocation(program, 'u_threshold'),
      gammaToLinear(settings.threshold),
    );
    gl.uniform1f(
      this._getUniformLocation(program, 'u_softKnee'),
      softKnee,
    );
    gl.uniform1f(
      this._getUniformLocation(program, 'u_clampMax'),
      clampMax,
    );
    this._drawFullscreen(program, level.down, level.width, level.height);
  }

  _renderSceneOverlay()
  {
    if (
      !this.sourceTarget ||
      !this.sceneOverlayTarget ||
      !this.programs?.sceneOverlay
    )
    {
      return false;
    }

    const program = this.programs.sceneOverlay;

    this.gl.useProgram(program);
    this._bindTexture(program, 'u_scene', this.sourceTarget.texture, 0);
    this._drawFullscreen(
      program,
      this.sceneOverlayTarget,
      this.sourceWidth,
      this.sourceHeight,
    );
    return true;
  }

  _renderDownsample(sourceLevel, targetLevel)
  {
    const gl = this.gl;
    const program = this.programs.downsample;

    gl.useProgram(program);
    this._bindTexture(program, 'u_source', sourceLevel.down.texture, 0);
    gl.uniform2f(
      this._getUniformLocation(program, 'u_sourceTexel'),
      1 / sourceLevel.width,
      1 / sourceLevel.height,
    );
    this._drawFullscreen(
      program,
      targetLevel.down,
      targetLevel.width,
      targetLevel.height,
    );
  }

  _renderUpsample(
    fineLevel,
    accumulatedCoarseLevel,
    accumulatedCoarseTexture,
  )
  {
    const gl = this.gl;
    const program = this.programs.upsample;

    gl.useProgram(program);
    this._bindTexture(
      program,
      'u_accumulatedCoarse',
      accumulatedCoarseTexture,
      0,
    );
    this._bindTexture(program, 'u_currentFine', fineLevel.down.texture, 1);
    gl.uniform2f(
      this._getUniformLocation(program, 'u_accumulatedCoarseTexel'),
      1 / accumulatedCoarseLevel.width,
      1 / accumulatedCoarseLevel.height,
    );
    gl.uniform1f(
      this._getUniformLocation(program, 'u_sampleScale'),
      this.sampleScale,
    );
    this._drawFullscreen(
      program,
      fineLevel.up,
      fineLevel.width,
      fineLevel.height,
    );

    return fineLevel.up.texture;
  }

  _renderFinal(
    texture,
    settings,
    hasScene = false,
    hasBackground = false,
    hasSceneOverlay = false,
  )
  {
    const gl = this.gl;
    const program = this.programs.final;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    this._bindTexture(program, 'u_bloom', texture, 0);
    this._bindTexture(
      program,
      'u_scene',
      hasScene
        ? (
            hasSceneOverlay
              ? this.sceneOverlayTarget.texture
              : this.sourceTarget.texture
          )
        : texture,
      1,
    );
    this._bindTexture(
      program,
      'u_background',
      hasBackground ? this.sceneBackgroundTarget.texture : texture,
      2,
    );
    this._bindTexture(
      program,
      'u_sceneEnergy',
      hasScene ? this.sourceTarget.texture : texture,
      3,
    );
    gl.uniform1i(
      this._getUniformLocation(program, 'u_hasScene'),
      hasScene ? 1 : 0,
    );
    gl.uniform1i(
      this._getUniformLocation(program, 'u_hasBackground'),
      hasBackground ? 1 : 0,
    );
    gl.uniform1i(
      this._getUniformLocation(program, 'u_transparentOverlay'),
      settings.outputCompositing === 'browser-overlay' ? 1 : 0,
    );
    gl.uniform1i(
      this._getUniformLocation(program, 'u_visualMaxAlpha'),
      settings.overlayAlphaPolicy === 'visual-max' ? 1 : 0,
    );
    gl.uniform1i(
      this._getUniformLocation(program, 'u_brightUnknownBackground'),
      settings.overlayColorCompensation === 'bright-core' ? 1 : 0,
    );
    gl.uniform1i(
      this._getUniformLocation(program, 'u_hostAdditive'),
      isIndependentHostCompositing(settings.hostCompositing) ? 1 : 0,
    );
    gl.uniform2f(
      this._getUniformLocation(program, 'u_bloomTexel'),
      1 / this.width,
      1 / this.height,
    );
    gl.uniform1f(
      this._getUniformLocation(program, 'u_sampleScale'),
      this.sampleScale,
    );
    gl.uniform1f(
      this._getUniformLocation(program, 'u_intensity'),
      resolveUnityBloomIntensity(settings.intensity),
    );
    gl.uniform1f(
      this._getUniformLocation(program, 'u_overlayAlphaLimit'),
      clamp(settings.overlayAlphaLimit ?? 1, 0, 1),
    );
    gl.uniform1f(
      this._getUniformLocation(program, 'u_opacity'),
      clamp(settings.opacity ?? 1, 0, 1),
    );
    gl.bindVertexArray(this.fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(settings, options = {})
  {
    if (
      !this.available ||
      this.contextLost ||
      !this.sourceTarget ||
      (BUILD_BLOOM && this.levels.length === 0)
    )
    {
      return false;
    }

    const gl = this.gl;
    const preserveCanvas = options.preserveCanvas === true;
    const hasScene = preserveCanvas &&
      this.sceneEnabled &&
      this.sceneFrameReady;
    const hasBackground = hasScene && this.sceneBackgroundFrameReady;
    const hasSceneOverlay = hasScene &&
      !hasBackground &&
      settings.outputCompositing === 'browser-overlay' &&
      !isIndependentHostCompositing(settings.hostCompositing) &&
      this.sceneOverlayFrameReady;

    try
    {
      if (!this._hasGeometry() && !hasScene)
      {
        if (!preserveCanvas)
        {
          this.clear();
        }

        return true;
      }

      if (!hasScene)
      {
        this._renderEmission(settings);
      }

      if (BUILD_BLOOM) this._renderPrefilter(settings);

      for (let level = 1; BUILD_BLOOM && level < this.levels.length; level++)
      {
        this._renderDownsample(
          this.levels[level - 1],
          this.levels[level],
        );
      }

      let bloomTexture = BUILD_BLOOM ? this.levels.at(-1).down.texture : this.sourceTarget.texture;

      for (let level = this.levels.length - 2; BUILD_BLOOM && level >= 0; level--)
      {
        bloomTexture = this._renderUpsample(
          this.levels[level],
          this.levels[level + 1],
          bloomTexture,
        );
      }

      this._renderFinal(
        bloomTexture,
        settings,
        hasScene,
        hasBackground,
        hasSceneOverlay,
      );
      this.stats.vertexCount = this.vertexCount +
        this.triangleVertexCount +
        this.trailVertexCount;
      this.stats.diskVertexCount = this.sceneDiskVertexCount;
      this.stats.ringVertexCount = this.ringIndexCount;
      this.stats.triangleVertexCount = this.triangleVertexCount;
      this.stats.trailVertexCount = this.trailVertexCount;

      const error = gl.getError();

      if (error !== gl.NO_ERROR)
      {
        throw new Error(`WebGL2 错误码 ${error}`);
      }

      return true;
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL2 Scene 渲染失败:', error);
      this._ringUploadedIndexVersion = -1;
      this.clear();
      this._deleteTargets();
      this.available = false;
      return false;
    }
  }

  clear()
  {
    this.sceneFrameReady = false;
    this.bloomSourceFrameReady = false;
    this.sceneBackgroundFrameReady = false;
    this.stats.vertexCount = 0;
    this.stats.diskVertexCount = 0;
    this.stats.ringVertexCount = 0;
    this.stats.triangleVertexCount = 0;
    this.stats.trailVertexCount = 0;
    this.stats.sceneVertexCount = 0;
    this.stats.sceneDiskVertexCount = 0;
    this.stats.sceneRingVertexCount = 0;
    this.stats.sceneTriangleVertexCount = 0;
    this.stats.sceneTrailVertexCount = 0;

    if (!this.gl || this.contextLost)
    {
      return;
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }



  destroy()
  {
    this.canvas?.removeEventListener?.('webglcontextlost', this._onContextLost);
    this.canvas?.removeEventListener?.('webglcontextrestored', this._onContextRestored);
    this._deleteResources();
    this._releaseRingScratch();
    this.available = false;
    this.contextLost = false;
    this.vertexCount = 0;
    this.vertexData = new Float32Array(0);
    this.sceneDiskVertexCount = 0;
    this.sceneDiskVertexData = new Float32Array(0);
    this.ringVertexCount = 0;
    this.ringVertexData = new Float32Array(0);
    this.triangleVertexCount = 0;
    this.triangleVertexData = new Float32Array(0);
    this.trailVertexCount = 0;
    this.trailVertexData = new Float32Array(0);
    this.maximumTextureSize = 0;
    this.maximumViewportWidth = 0;
    this.maximumViewportHeight = 0;
    this.failedResizeSignature = null;
    this.sceneBackgroundSource = null;
    this.sceneBackgroundWidth = 0;
    this.sceneBackgroundHeight = 0;
    this.sceneBackgroundUploadRetryPending = false;
  }
}
