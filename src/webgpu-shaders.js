/**
 * 将线性亮度编码到 extended sRGB；与普通 sRGB 的区别仅是不截断超白值。
 */
export function linearToExtendedSrgb(value)
{
  const linear = Math.max(0, value);

  if (linear <= 0.0031308)
  {
    return linear * 12.92;
  }

  return 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;
}

export const WEBGPU_GEOMETRY_SHADER = /* wgsl */ `
struct GeometryUniforms
{
  displaySize: vec2f,
  diskEmissionScale: f32,
  ringEmissionScale: f32,
  transparentOverlay: u32,
}

@group(0) @binding(0) var<uniform> geometry: GeometryUniforms;
@group(0) @binding(1) var materialTexture: texture_2d<f32>;
@group(0) @binding(2) var materialSampler: sampler;

struct GenericOutput
{
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) coverage: f32,
}

struct TexturedOutput
{
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) particleAlpha: f32,
  @location(3) coverageFactor: f32,
}

fn toClip(position: vec2f) -> vec4f
{
  let normalized = position / geometry.displaySize;
  return vec4f(
    normalized.x * 2.0 - 1.0,
    1.0 - normalized.y * 2.0,
    0.0,
    1.0,
  );
}

@vertex
fn vertexGeneric(
  @location(0) position: vec2f,
  @location(1) color: vec3f,
  @location(2) coverage: f32,
) -> GenericOutput
{
  var output: GenericOutput;
  output.position = toClip(position);
  output.color = color;
  output.coverage = coverage;
  return output;
}

@fragment
fn fragmentGeneric(input: GenericOutput) -> @location(0) vec4f
{
  let alpha = select(1.0, clamp(input.coverage, 0.0, 1.0),
    geometry.transparentOverlay != 0u);
  return vec4f(max(input.color, vec3f(0.0)), alpha);
}

@vertex
fn vertexTextured(
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) color: vec3f,
  @location(3) particleAlpha: f32,
  @location(4) coverageFactor: f32,
) -> TexturedOutput
{
  var output: TexturedOutput;
  output.position = toClip(position);
  output.uv = uv;
  output.color = color;
  output.particleAlpha = particleAlpha;
  output.coverageFactor = coverageFactor;
  return output;
}

@vertex
fn vertexDisk(
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) color: vec3f,
  @location(3) particleAlpha: f32,
) -> TexturedOutput
{
  var output: TexturedOutput;
  output.position = toClip(position);
  output.uv = uv;
  output.color = color;
  output.particleAlpha = particleAlpha;
  output.coverageFactor = 1.0;
  return output;
}

@fragment
fn fragmentTriangle(input: TexturedOutput) -> @location(0) vec4f
{
  let sampleColor = textureSample(materialTexture, materialSampler, input.uv);
  let particleAlpha = clamp(input.particleAlpha, 0.0, 1.0);
  let coverage = sampleColor.a * particleAlpha *
    clamp(input.coverageFactor, 0.0, 1.0);
  let emission = sampleColor.rgb * max(input.color, vec3f(0.0)) * coverage;
  let alpha = select(1.0, coverage, geometry.transparentOverlay != 0u);
  return vec4f(emission, alpha);
}

@fragment
fn fragmentTrail(input: TexturedOutput) -> @location(0) vec4f
{
  let sampleColor = textureSample(materialTexture, materialSampler, input.uv);
  let particleAlpha = clamp(input.particleAlpha, 0.0, 1.0);
  let edgeDistance = min(input.uv.y, 1.0 - input.uv.y);
  let footprint = max(fwidth(input.uv.y) * 0.5, 0.000001);
  let geometryCoverage = select(
    1.0,
    smoothstep(0.0, footprint, edgeDistance),
    geometry.transparentOverlay != 0u,
  );
  let coverage = sampleColor.a * particleAlpha *
    clamp(input.coverageFactor, 0.0, 1.0) * geometryCoverage;
  let emission = sampleColor.rgb * max(input.color, vec3f(0.0)) * particleAlpha;
  let alpha = select(1.0, coverage, geometry.transparentOverlay != 0u);
  return vec4f(emission, alpha);
}

@fragment
fn fragmentDisk(input: TexturedOutput) -> @location(0) vec4f
{
  let sampleColor = textureSample(materialTexture, materialSampler, input.uv);
  let textureAlpha = sampleColor.r;
  let color = sampleColor.rgb * max(input.color, vec3f(0.0)) *
    textureAlpha * max(geometry.diskEmissionScale, 0.0);
  let alpha = textureAlpha * clamp(input.particleAlpha, 0.0, 1.0);
  return vec4f(color, clamp(alpha, 0.0, 1.0));
}

struct RingOutput
{
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) dissolveThreshold: f32,
  @location(3) coverageOpacity: f32,
}

@vertex
fn vertexRing(
  @location(0) position: vec2f,
  @location(1) uv: vec2f,
  @location(2) color: vec3f,
  @location(3) dissolveThreshold: f32,
  @location(4) coverageOpacity: f32,
) -> RingOutput
{
  var output: RingOutput;
  output.position = toClip(position);
  output.uv = uv;
  output.color = color;
  output.dissolveThreshold = dissolveThreshold;
  output.coverageOpacity = coverageOpacity;
  return output;
}

@fragment
fn fragmentRing(input: RingOutput) -> @location(0) vec4f
{
  let textureAlpha = textureSample(
    materialTexture,
    materialSampler,
    input.uv,
  ).r;

  if (textureAlpha < input.dissolveThreshold)
  {
    discard;
  }

  let alpha = clamp(textureAlpha, 0.0, 1.0);
  let color = max(input.color, vec3f(0.0)) *
    max(geometry.ringEmissionScale, 0.0);

  if (geometry.transparentOverlay != 0u)
  {
    return vec4f(color * alpha, alpha * clamp(input.coverageOpacity, 0.0, 1.0));
  }

  return vec4f(color, alpha);
}
`;

export const WEBGPU_FULLSCREEN_SHADER = /* wgsl */ `
struct PassUniforms
{
  texelSize: vec2f,
  backgroundUvScale: vec2f,
  sampleScale: f32,
  threshold: f32,
  softKnee: f32,
  clampMax: f32,
  intensity: f32,
  overlayAlphaLimit: f32,
  opacity: f32,
  hasScene: u32,
  hasBackground: u32,
  transparentOverlay: u32,
  visualMaxAlpha: u32,
  brightUnknownBackground: u32,
  hostAdditive: u32,
  extendedOutput: u32,
  _padding: u32,
}

@group(0) @binding(0) var<uniform> params: PassUniforms;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var source0: texture_2d<f32>;
@group(0) @binding(3) var source1: texture_2d<f32>;
@group(0) @binding(4) var source2: texture_2d<f32>;
@group(0) @binding(5) var source3: texture_2d<f32>;

struct FullscreenOutput
{
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vertexFullscreen(@builtin(vertex_index) index: u32) -> FullscreenOutput
{
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  let position = positions[index];
  var output: FullscreenOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  return output;
}

fn sampleBox(source: texture_2d<f32>, uv: vec2f, offset: vec2f) -> vec4f
{
  return (
    textureSampleLevel(source, linearSampler, uv + vec2f(-offset.x, -offset.y), 0.0) +
    textureSampleLevel(source, linearSampler, uv + vec2f(offset.x, -offset.y), 0.0) +
    textureSampleLevel(source, linearSampler, uv + vec2f(-offset.x, offset.y), 0.0) +
    textureSampleLevel(source, linearSampler, uv + vec2f(offset.x, offset.y), 0.0)
  ) * 0.25;
}

@fragment
fn fragmentBackground(input: FullscreenOutput) -> @location(0) vec4f
{
  let uv = (input.uv - vec2f(0.5)) * params.backgroundUvScale + vec2f(0.5);
  return vec4f(textureSampleLevel(source0, linearSampler, uv, 0.0).rgb, 1.0);
}

@fragment
fn fragmentSceneOverlay(input: FullscreenOutput) -> @location(0) vec4f
{
  let scene = textureSampleLevel(source0, linearSampler, input.uv, 0.0);
  let coverage = clamp(scene.a, 0.0, 1.0);
  let capacity = select(
    pow((coverage + 0.055) / 1.055, 2.4),
    coverage / 12.92,
    coverage <= 0.04045,
  );
  let maximumEnergy = max(max(scene.r, scene.g), scene.b);
  let scale = min(1.0, capacity / max(maximumEnergy, 0.000001));
  return vec4f(scene.rgb * scale, coverage);
}

@fragment
fn fragmentPrefilter(input: FullscreenOutput) -> @location(0) vec4f
{
  let filtered = sampleBox(source0, input.uv, params.texelSize);
  let color = min(filtered.rgb, vec3f(min(max(params.clampMax, 0.0), 65504.0)));
  let brightness = max(max(color.r, color.g), color.b);

  if (brightness <= 0.0)
  {
    return vec4f(0.0);
  }

  let threshold = max(0.0, params.threshold);
  let knee = threshold * clamp(params.softKnee, 0.0, 1.0) + 0.00001;
  var soft = clamp(brightness - threshold + knee, 0.0, knee * 2.0);
  soft = soft * soft / (knee * 4.0);
  let contribution = max(max(brightness - threshold, soft), 0.0);
  return vec4f(color * contribution / max(brightness, 0.0001), contribution);
}

@fragment
fn fragmentDownsample(input: FullscreenOutput) -> @location(0) vec4f
{
  return sampleBox(source0, input.uv, params.texelSize);
}

@fragment
fn fragmentUpsample(input: FullscreenOutput) -> @location(0) vec4f
{
  let offset = params.texelSize * (params.sampleScale * 0.5);
  let coarse = sampleBox(source0, input.uv, offset);
  let fine = textureSampleLevel(source1, linearSampler, input.uv, 0.0);
  return coarse + fine;
}

fn linearToExtendedSrgb(value: f32) -> f32
{
  let linear = max(value, 0.0);
  return select(
    1.055 * pow(linear, 1.0 / 2.4) - 0.055,
    linear * 12.92,
    linear <= 0.0031308,
  );
}

fn linearToSrgb(value: f32) -> f32
{
  return min(linearToExtendedSrgb(value), 1.0);
}

fn linearToSrgb3(value: vec3f) -> vec3f
{
  return vec3f(
    linearToSrgb(value.r),
    linearToSrgb(value.g),
    linearToSrgb(value.b),
  );
}

fn linearToExtendedSrgb3(value: vec3f) -> vec3f
{
  return vec3f(
    linearToExtendedSrgb(value.r),
    linearToExtendedSrgb(value.g),
    linearToExtendedSrgb(value.b),
  );
}

fn solveOverlayAlpha(background: f32, desired: f32) -> f32
{
  if (desired > background)
  {
    return (desired - background) / max(1.0 - background, 0.000001);
  }

  if (desired < background)
  {
    return (background - desired) / max(background, 0.000001);
  }

  return 0.0;
}

@fragment
fn fragmentFinal(input: FullscreenOutput) -> @location(0) vec4f
{
  let offset = params.texelSize * (params.sampleScale * 0.5);
  let filteredBloom = sampleBox(source0, input.uv, offset);
  let scene = select(
    vec4f(0.0),
    textureSampleLevel(source1, linearSampler, input.uv, 0.0),
    params.hasScene != 0u,
  );
  let sceneEnergy = select(
    vec4f(0.0),
    textureSampleLevel(source2, linearSampler, input.uv, 0.0),
    params.hasScene != 0u,
  );
  var sceneLinear = scene.rgb;

  if (
    params.transparentOverlay != 0u &&
    params.visualMaxAlpha != 0u &&
    params.hostAdditive == 0u &&
    params.hasScene != 0u
  )
  {
    sceneLinear = sceneEnergy.rgb;
  }

  let linear = sceneLinear + filteredBloom.rgb * max(0.0, params.intensity);
  let sceneCoverage = select(0.0, clamp(scene.a, 0.0, 1.0), params.hasScene != 0u);
  let bloomCoverage = linearToSrgb(
    max(0.0, filteredBloom.a) * max(0.0, params.intensity),
  );
  let requestedCoverage = select(
    sceneCoverage + bloomCoverage,
    max(sceneCoverage, bloomCoverage),
    params.visualMaxAlpha != 0u,
  );

  let extendedSrgb = linearToExtendedSrgb3(linear);

  if (params.extendedOutput != 0u && params.hasBackground == 0u)
  {
    var alpha = clamp(
      max(
        requestedCoverage,
        max(max(extendedSrgb.r, extendedSrgb.g), extendedSrgb.b),
      ),
      0.0,
      1.0,
    );

    if (params.transparentOverlay != 0u && params.hostAdditive == 0u)
    {
      alpha = min(alpha, clamp(params.overlayAlphaLimit, 0.0, 1.0));
    }

    if (alpha <= 0.00001)
    {
      return vec4f(0.0);
    }

    // rgba16float Canvas 仍按 sRGB 编码解释；extended 只扩展可显示范围。
    return vec4f(extendedSrgb, alpha);
  }

  let srgb = linearToSrgb3(linear);
  let backgroundUv = (input.uv - vec2f(0.5)) *
    params.backgroundUvScale + vec2f(0.5);
  let sampledBackground = textureSampleLevel(
    source3,
    linearSampler,
    backgroundUv,
    0.0,
  ).rgb;

  if (params.extendedOutput != 0u && params.hasBackground != 0u)
  {
    let backgroundExtendedSrgb = linearToExtendedSrgb3(sampledBackground);
    let difference = abs(extendedSrgb - backgroundExtendedSrgb);

    if (max(max(difference.r, difference.g), difference.b) <= 0.00001)
    {
      return vec4f(0.0);
    }

    let channelAlpha = vec3f(
      solveOverlayAlpha(backgroundExtendedSrgb.r, extendedSrgb.r),
      solveOverlayAlpha(backgroundExtendedSrgb.g, extendedSrgb.g),
      solveOverlayAlpha(backgroundExtendedSrgb.b, extendedSrgb.b),
    );
    let alpha = clamp(
      max(max(channelAlpha.r, channelAlpha.g), channelAlpha.b),
      0.0,
      1.0,
    );
    let premultiplied = extendedSrgb -
      backgroundExtendedSrgb * (1.0 - alpha);

    // 在 Canvas 的 sRGB 编码域反解，避免 SDR 中间调在最终合成时变深。
    return vec4f(max(premultiplied, vec3f(0.0)), alpha);
  }

  if (params.hasBackground != 0u)
  {
    let backgroundSrgb = linearToSrgb3(sampledBackground);
    let difference = abs(srgb - backgroundSrgb);

    if (max(max(difference.r, difference.g), difference.b) <= 0.00001)
    {
      return vec4f(0.0);
    }

    let channelAlpha = vec3f(
      solveOverlayAlpha(backgroundSrgb.r, srgb.r),
      solveOverlayAlpha(backgroundSrgb.g, srgb.g),
      solveOverlayAlpha(backgroundSrgb.b, srgb.b),
    );
    let alpha = clamp(max(max(channelAlpha.r, channelAlpha.g), channelAlpha.b), 0.0, 1.0);
    let premultiplied = srgb - backgroundSrgb * (1.0 - alpha);
    return vec4f(clamp(premultiplied, vec3f(0.0), vec3f(alpha)), alpha);
  }

  if (params.transparentOverlay != 0u)
  {
    let capacity = min(requestedCoverage, 1.0);

    if (params.hostAdditive != 0u)
    {
      let alpha = clamp(max(max(max(srgb.r, srgb.g), srgb.b), capacity), 0.0, 1.0);
      return select(vec4f(srgb, alpha), vec4f(0.0), alpha <= 0.00001);
    }

    let alpha = min(capacity, clamp(params.overlayAlphaLimit, 0.0, 1.0));

    if (alpha <= 0.00001)
    {
      return vec4f(0.0);
    }

    let maximumSrgb = max(max(srgb.r, srgb.g), srgb.b);
    let scale = select(
      min(1.0, alpha / max(capacity, 0.000001)),
      min(1.0, alpha / max(maximumSrgb, 0.000001)),
      params.visualMaxAlpha != 0u,
    );
    var premultiplied = srgb * scale;

    if (params.brightUnknownBackground != 0u)
    {
      let compensation = alpha * smoothstep(0.03125, 0.25, maximumSrgb);
      premultiplied = min(vec3f(alpha), max(premultiplied, vec3f(compensation)));
    }

    return vec4f(premultiplied, alpha);
  }

  let maximumSrgb = max(max(srgb.r, srgb.g), srgb.b);
  let alpha = select(
    maximumSrgb,
    max(clamp(scene.a, 0.0, 1.0), maximumSrgb),
    params.hasScene != 0u,
  );
  return select(vec4f(srgb, alpha), vec4f(0.0), maximumSrgb <= 0.00001 && alpha <= 0.00001);
}
`;
