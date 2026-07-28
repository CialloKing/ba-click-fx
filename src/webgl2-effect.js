import {
  TRIANGLE_TEXTURE_RGBA,
  TRIANGLE_TEXTURE_SIZE,
  resolveTriangleTextureFrame,
} from './triangle-texture.js';
import {
  CIRCLE_TEXTURE_RGBA,
  CIRCLE_TEXTURE_SIZE,
} from './circle-texture.js';

const COMPONENTS_PER_VERTEX = 6;
const COMPONENTS_PER_DISK_VERTEX = 8;
const COMPONENTS_PER_RING_VERTEX = 8;
const COMPONENTS_PER_TRIANGLE_VERTEX = 8;
const INITIAL_VERTEX_CAPACITY = 4096;
const MAX_PYRAMID_LEVELS = 16;
const DISK_CENTER_RADIUS_EPSILON = 0.00001;
const DISK_TEXTURE_RADIAL_STOPS = Object.freeze(
  [
    // position, R_linear (Alpha), R_linear² (RGB energy)
    [0, 1, 1],
    [0.84, 1, 1],
    [0.88, 1, 1],
    [0.885, 0.356400144, 0.127021063],
    [0.89, 0.171441101, 0.029392051],
    [0.895, 0.102241733, 0.010453372],
    [0.9, 0.063010018, 0.003970262],
    [0.905, 0.015208514, 0.000231299],
    [0.91, 0.005181517, 0.000026848],
    [0.915, 0.001517635, 0.000002303],
    [0.92, 0, 0],
    [1, 0, 0],
  ],
);

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
out vec4 outColor;

void main()
{
  outColor = vec4(max(v_color, vec3(0.0)), 1.0);
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

vec3 thresholdColor(vec3 color)
{
  float clampMax = min(max(u_clampMax, 0.0), 65504.0);

  color = min(color, vec3(clampMax));
  float brightness = max(max(color.r, color.g), color.b);

  if (brightness <= 0.0)
  {
    return vec3(0.0);
  }

  float threshold = max(0.0, u_threshold);
  float knee = threshold * u_softKnee + 0.00001;
  float soft = brightness - threshold + knee;

  soft = clamp(soft, 0.0, knee * 2.0);
  soft = soft * soft / (knee * 4.0);

  float contribution = max(max(brightness - threshold, soft), 0.0);
  return color * contribution / max(brightness, 0.0001);
}

void main()
{
  vec3 color =
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, -1.0)).rgb +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, -1.0)).rgb +
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, 1.0)).rgb +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, 1.0)).rgb;

  outColor = vec4(thresholdColor(color * 0.25), 1.0);
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

const TRIANGLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform bool u_transparentOverlay;

in vec2 v_uv;
in vec3 v_materialColor;
in float v_particleAlpha;

out vec4 outColor;

void main()
{
  vec4 sampleColor = texture(u_texture, v_uv);
  float particleAlpha = clamp(v_particleAlpha, 0.0, 1.0);
  float coverage = sampleColor.a * particleAlpha;
  // SRGB8_ALPHA8 采样会自动把纹理 RGB 解码到线性空间。
  vec3 emission = sampleColor.rgb *
    max(v_materialColor, vec3(0.0)) * coverage;
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
    max(v_materialColor, vec3(0.0)) * textureAlpha;
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
layout(location = 1) in float a_textureAlpha;
layout(location = 2) in vec3 a_materialColor;
layout(location = 3) in float a_dissolveThreshold;
layout(location = 4) in float a_coverage;

uniform vec2 u_displaySize;

out float v_textureAlpha;
out vec3 v_materialColor;
out float v_dissolveThreshold;
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
  v_textureAlpha = a_textureAlpha;
  v_materialColor = a_materialColor;
  v_dissolveThreshold = a_dissolveThreshold;
  v_coverage = a_coverage;
}
`;

const DISSOLVE_RING_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float v_textureAlpha;
in vec3 v_materialColor;
in float v_dissolveThreshold;
in float v_coverage;

uniform bool u_transparentOverlay;

out vec4 outColor;

void main()
{
  // Unity clip(alpha - threshold) 是硬裁剪，通过的片元保留原纹理 Alpha。
  if (v_textureAlpha < v_dissolveThreshold)
  {
    discard;
  }

  float textureAlpha = clamp(v_textureAlpha, 0.0, 1.0);
  vec3 materialColor = max(v_materialColor, vec3(0.0));

  if (u_transparentOverlay)
  {
    // RGB 预乘纹理 Alpha 后改用 One/One，结果与 Unity SrcAlpha/One 相同。
    outColor = vec4(
      materialColor * textureAlpha,
      clamp(v_coverage, 0.0, 1.0)
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
  vec3 color =
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, -1.0)).rgb +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, -1.0)).rgb +
    texture(u_source, v_uv + u_sourceTexel * vec2(-1.0, 1.0)).rgb +
    texture(u_source, v_uv + u_sourceTexel * vec2(1.0, 1.0)).rgb;

  outColor = vec4(color * 0.25, 1.0);
}
`;

const UPSAMPLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_high;
uniform sampler2D u_low;
uniform vec2 u_lowTexel;
uniform float u_sampleScale;

in vec2 v_uv;
out vec4 outColor;

vec3 sampleBox(sampler2D source, vec2 uv, vec2 offset)
{
  return (
    texture(source, uv + vec2(-offset.x, -offset.y)).rgb +
    texture(source, uv + vec2(offset.x, -offset.y)).rgb +
    texture(source, uv + vec2(-offset.x, offset.y)).rgb +
    texture(source, uv + vec2(offset.x, offset.y)).rgb
  ) * 0.25;
}

void main()
{
  vec3 high = texture(u_high, v_uv).rgb;
  vec2 offset = u_lowTexel * (u_sampleScale * 0.5);
  vec3 low = sampleBox(u_low, v_uv, offset);

  outColor = vec4(high + low, 1.0);
}
`;

const FINAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform sampler2D u_background;
uniform vec2 u_bloomTexel;
uniform float u_sampleScale;
uniform float u_intensity;
uniform bool u_hasScene;
uniform bool u_hasBackground;

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
  vec3 bloom =
    texture(u_bloom, v_uv + vec2(-offset.x, -offset.y)).rgb +
    texture(u_bloom, v_uv + vec2(offset.x, -offset.y)).rgb +
    texture(u_bloom, v_uv + vec2(-offset.x, offset.y)).rgb +
    texture(u_bloom, v_uv + vec2(offset.x, offset.y)).rgb;
  vec4 scene = u_hasScene
    ? texture(u_scene, v_uv)
    : vec4(0.0);
  vec3 linear = scene.rgb + bloom * 0.25 * max(0.0, u_intensity);
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

function gammaToLinear(value)
{
  const gamma = Math.max(0, value);

  if (gamma <= 0.04045)
  {
    return gamma / 12.92;
  }

  return Math.pow((gamma + 0.055) / 1.055, 2.4);
}

function calculatePyramidSettings(
  displayWidth,
  displayHeight,
  resolutionScale,
  diffusion,
)
{
  const safeScale = clamp(resolutionScale, 0.1, 0.75);
  const maxSize = Math.max(
    1,
    Math.floor(displayWidth * safeScale),
    Math.floor(displayHeight * safeScale),
  );
  const logIterations = Math.log2(maxSize) +
    Math.min(Math.max(0, diffusion), 10) - 10;

  return {
    levelCount: clamp(
      Math.floor(logIterations),
      1,
      MAX_PYRAMID_LEVELS,
    ),
    sampleScale: 0.5 + logIterations - Math.floor(logIterations),
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

export class WebGL2EffectRenderer
{
  constructor(canvas)
  {
    this.canvas = canvas;
    // 两种 WebGL2 模式共享完整 Scene，避免清晰层和 Bloom 分层输出产生色差。
    this.sceneEnabled = true;
    this.gl = null;
    this.available = false;
    this.contextLost = false;
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
    this.maximumTextureSize = 0;
    this.maximumViewportWidth = 0;
    this.maximumViewportHeight = 0;
    this.vertexCount = 0;
    this.vertexData = new Float32Array(
      INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_VERTEX,
    );
    this.sceneDiskVertexCount = 0;
    this.sceneDiskVertexData = new Float32Array(
      INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_DISK_VERTEX,
    );
    this.ringVertexCount = 0;
    this.ringVertexData = new Float32Array(
      INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_RING_VERTEX,
    );
    this.triangleVertexCount = 0;
    this.triangleVertexData = new Float32Array(
      INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_TRIANGLE_VERTEX,
    );
    this.sourceTarget = null;
    this.levels = [];
    this.sceneFrameReady = false;
    this.sceneBackgroundFrameReady = false;
    this.sceneBackgroundSource = null;
    this.sceneBackgroundWidth = 0;
    this.sceneBackgroundHeight = 0;
    this.sceneBackgroundTexture = null;
    this.sceneBackgroundTarget = null;
    this.failedResizeSignature = null;
    this.programs = null;
    this.emissionBuffer = null;
    this.emissionVao = null;
    this.sceneDiskBuffer = null;
    this.sceneDiskVao = null;
    this.ringBuffer = null;
    this.ringVao = null;
    this.triangleBuffer = null;
    this.triangleVao = null;
    this.triangleTexture = null;
    this.circleTexture = null;
    this.fullscreenVao = null;
    this.stats =
    {
      vertexCount: 0,
      sceneVertexCount: 0,
      sceneDiskVertexCount: 0,
      sceneRingVertexCount: 0,
      sceneTriangleVertexCount: 0,
      diskVertexCount: 0,
      ringVertexCount: 0,
      triangleVertexCount: 0,
      levelCount: 0,
      bloomPixels: 0,
    };

    this._onContextLost = this._handleContextLost.bind(this);
    this._onContextRestored = this._handleContextRestored.bind(this);
    this.canvas?.addEventListener?.('webglcontextlost', this._onContextLost);
    this.canvas?.addEventListener?.('webglcontextrestored', this._onContextRestored);
    this._initialize();
  }

  _initialize()
  {
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
      this.programs.sceneBackground = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        SCENE_BACKGROUND_FRAGMENT_SHADER,
      );
      this.programs.prefilter = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        PREFILTER_FRAGMENT_SHADER,
      );
      this.programs.downsample = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        DOWNSAMPLE_FRAGMENT_SHADER,
      );
      this.programs.upsample = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        UPSAMPLE_FRAGMENT_SHADER,
      );
      this.programs.final = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        FINAL_FRAGMENT_SHADER,
      );
      this.emissionBuffer = gl.createBuffer();
      this.emissionVao = gl.createVertexArray();
      this.sceneDiskBuffer = gl.createBuffer();
      this.sceneDiskVao = gl.createVertexArray();
      this.ringBuffer = gl.createBuffer();
      this.ringVao = gl.createVertexArray();
      this.triangleBuffer = gl.createBuffer();
      this.triangleVao = gl.createVertexArray();
      this.triangleTexture = gl.createTexture();
      this.circleTexture = gl.createTexture();
      this.fullscreenVao = gl.createVertexArray();

      if (
        !this.emissionBuffer ||
        !this.emissionVao ||
        !this.fullscreenVao ||
        !this.sceneDiskBuffer ||
        !this.sceneDiskVao ||
        !this.ringBuffer ||
        !this.ringVao ||
        !this.triangleBuffer ||
        !this.triangleVao ||
        !this.triangleTexture ||
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
        1,
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
        3 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(
        3,
        1,
        gl.FLOAT,
        false,
        ringStride,
        6 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(
        4,
        1,
        gl.FLOAT,
        false,
        ringStride,
        7 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      gl.bindVertexArray(this.triangleVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.triangleBuffer);

      const triangleStride = COMPONENTS_PER_TRIANGLE_VERTEX *
        Float32Array.BYTES_PER_ELEMENT;

      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(
        0,
        2,
        gl.FLOAT,
        false,
        triangleStride,
        0,
      );
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(
        1,
        2,
        gl.FLOAT,
        false,
        triangleStride,
        2 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(
        2,
        3,
        gl.FLOAT,
        false,
        triangleStride,
        4 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(
        3,
        1,
        gl.FLOAT,
        false,
        triangleStride,
        7 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      // 解包纹理禁用 Mipmap，并沿用 Unity importer 的 Bilinear + Clamp。
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

      // Circle_01 使用 Repeat；完整 Quad 在片元阶段采样才能保留二维边缘。
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
      gl.bindTexture(gl.TEXTURE_2D, null);

      this.contextLost = false;
      this.available = true;

      if (this.sceneBackgroundSource)
      {
        this._replaceSceneBackgroundTexture(this.sceneBackgroundSource);
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

  _handleContextLost(event)
  {
    event?.preventDefault?.();
    this.contextLost = true;
    this.available = false;
    this.sceneFrameReady = false;
    this.sceneBackgroundFrameReady = false;
  }

  _handleContextRestored()
  {
    // Context 恢复后旧 WebGL 对象已由浏览器作废；再次 delete 会产生
    // INVALID_OPERATION，并让首个恢复帧被误判为渲染失败。
    this._forgetResourceReferences();
    this._initialize();
  }

  _forgetResourceReferences()
  {
    this.sourceTarget = null;
    this.levels = [];
    this.sceneFrameReady = false;
    this.sceneBackgroundFrameReady = false;
    // Context 恢复代表一套新资源，旧尺寸的失败结论不能继续复用。
    this.failedResizeSignature = null;
    this.programs = null;
    this.emissionBuffer = null;
    this.emissionVao = null;
    this.sceneDiskBuffer = null;
    this.sceneDiskVao = null;
    this.ringBuffer = null;
    this.ringVao = null;
    this.triangleBuffer = null;
    this.triangleVao = null;
    this.triangleTexture = null;
    this.circleTexture = null;
    this.sceneBackgroundTexture = null;
    this.sceneBackgroundTarget = null;
    this.fullscreenVao = null;
    this.vertexCount = 0;
    this.sceneDiskVertexCount = 0;
    this.ringVertexCount = 0;
    this.triangleVertexCount = 0;
    this.stats.vertexCount = 0;
    this.stats.sceneVertexCount = 0;
    this.stats.sceneDiskVertexCount = 0;
    this.stats.sceneRingVertexCount = 0;
    this.stats.sceneTriangleVertexCount = 0;
    this.stats.diskVertexCount = 0;
    this.stats.ringVertexCount = 0;
    this.stats.triangleVertexCount = 0;
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
    if (!this.gl)
    {
      return;
    }

    deleteTarget(this.gl, this.sourceTarget);
    deleteTarget(this.gl, this.sceneBackgroundTarget);
    this.sourceTarget = null;
    this.sceneBackgroundTarget = null;
    this.sceneFrameReady = false;
    this.sceneBackgroundFrameReady = false;

    for (const level of this.levels)
    {
      deleteTarget(this.gl, level.down);
      deleteTarget(this.gl, level.scratch);
      deleteTarget(this.gl, level.up);
    }

    this.levels = [];
    this.stats.levelCount = 0;
    this.stats.bloomPixels = 0;
  }

  _deleteResources()
  {
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
    gl.deleteVertexArray(this.ringVao);
    gl.deleteBuffer(this.triangleBuffer);
    gl.deleteVertexArray(this.triangleVao);
    gl.deleteTexture(this.triangleTexture);
    gl.deleteTexture(this.circleTexture);
    gl.deleteTexture(this.sceneBackgroundTexture);
    gl.deleteVertexArray(this.fullscreenVao);
    this.programs = null;
    this.emissionBuffer = null;
    this.emissionVao = null;
    this.sceneDiskBuffer = null;
    this.sceneDiskVao = null;
    this.ringBuffer = null;
    this.ringVao = null;
    this.triangleBuffer = null;
    this.triangleVao = null;
    this.triangleTexture = null;
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
    this.stats.diskVertexCount = 0;
    this.stats.ringVertexCount = 0;
    this.stats.triangleVertexCount = 0;
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

    const previousTexture = this.sceneBackgroundTexture;

    this.sceneBackgroundTexture = texture;
    this.sceneBackgroundSource = source;
    this.sceneBackgroundWidth = dimensions.width;
    this.sceneBackgroundHeight = dimensions.height;
    this._rebuildSceneBackgroundTarget();
    this.gl.deleteTexture(previousTexture);
    return true;
  }

  setSceneBackground(source, options = {})
  {
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
      return true;
    }

    return this._replaceSceneBackgroundTexture(source);
  }

  _getSceneBackgroundUvScale()
  {
    const sourceAspect = this.sceneBackgroundWidth /
      this.sceneBackgroundHeight;
    const displayAspect = this.displayWidth / this.displayHeight;

    if (sourceAspect > displayAspect)
    {
      return [displayAspect / sourceAspect, 1];
    }

    return [1, sourceAspect / displayAspect];
  }

  _rebuildSceneBackgroundTarget()
  {
    if (
      !this.sceneBackgroundTexture ||
      !this.programs?.sceneBackground ||
      !this.sourceTarget ||
      this.sourceWidth <= 0 ||
      this.sourceHeight <= 0
    )
    {
      deleteTarget(this.gl, this.sceneBackgroundTarget);
      this.sceneBackgroundTarget = null;
      return false;
    }

    const gl = this.gl;
    const program = this.programs.sceneBackground;
    const uvScale = this._getSceneBackgroundUvScale();
    let target = null;

    try
    {
      target = this._createTarget(this.sourceWidth, this.sourceHeight);
      gl.disable(gl.BLEND);
      gl.useProgram(program);
      this._bindTexture(
        program,
        'u_background',
        this.sceneBackgroundTexture,
        0,
      );
      gl.uniform2f(
        gl.getUniformLocation(program, 'u_uvScale'),
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

      deleteTarget(gl, this.sceneBackgroundTarget);
      this.sceneBackgroundTarget = target;
      return true;
    }
    catch (error)
    {
      console.warn('[BAClickFX] Scene 背景缓冲创建失败，保留透明回退:', error);
      deleteTarget(gl, target);
      deleteTarget(gl, this.sceneBackgroundTarget);
      this.sceneBackgroundTarget = null;
      // 背景额外缓冲分配失败不能污染下一帧并禁用整个 Scene 后端。
      this._discardPendingErrors();
      return false;
    }
  }

  _copySceneBackgroundToSource()
  {
    if (!this.sceneBackgroundTarget || !this.sourceTarget)
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
      this.sourceTarget.framebuffer,
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sourceTarget.framebuffer);
    return true;
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

      for (let index = 0; index < levelCount; index++)
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
        this._rebuildSceneBackgroundTarget();
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

    const unchanged = sourceWidth === this.sourceWidth &&
      sourceHeight === this.sourceHeight &&
      width === this.width &&
      height === this.height &&
      safeDiffusion === this.diffusion &&
      this.sourceTarget !== null &&
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

  beginFrame(options = {})
  {
    this.vertexCount = 0;
    this.sceneDiskVertexCount = 0;
    this.ringVertexCount = 0;
    this.triangleVertexCount = 0;
    this.stats.vertexCount = 0;
    this.stats.diskVertexCount = 0;
    this.stats.ringVertexCount = 0;
    this.stats.triangleVertexCount = 0;

    if (options.preserveSceneStats !== true)
    {
      this.sceneFrameReady = false;
      this.sceneBackgroundFrameReady = false;
      this.stats.sceneVertexCount = 0;
      this.stats.sceneDiskVertexCount = 0;
      this.stats.sceneRingVertexCount = 0;
      this.stats.sceneTriangleVertexCount = 0;
    }
  }

  _hasGeometry()
  {
    return this.vertexCount > 0 ||
      this.sceneDiskVertexCount > 0 ||
      this.ringVertexCount > 0 ||
      this.triangleVertexCount > 0;
  }

  _drawGeometryBatches(additiveProgram, transparentOverlay = false)
  {
    const gl = this.gl;

    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);

    if (this.sceneDiskVertexCount > 0)
    {
      const diskProgram = this.programs.sceneDisk;

      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(diskProgram);
      gl.uniform2f(
        gl.getUniformLocation(diskProgram, 'u_displaySize'),
        this.displayWidth,
        this.displayHeight,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.circleTexture);
      gl.uniform1i(
        gl.getUniformLocation(diskProgram, 'u_texture'),
        0,
      );
      gl.bindVertexArray(this.sceneDiskVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sceneDiskBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        this.sceneDiskVertexData.subarray(
          0,
          this.sceneDiskVertexCount * COMPONENTS_PER_DISK_VERTEX,
        ),
        gl.DYNAMIC_DRAW,
      );
      gl.drawArrays(gl.TRIANGLES, 0, this.sceneDiskVertexCount);
    }

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
      const compositingLocation = gl.getUniformLocation(
        additiveProgram,
        'u_transparentOverlay',
      );

      if (compositingLocation !== null)
      {
        gl.uniform1i(compositingLocation, transparentOverlay ? 1 : 0);
      }

      gl.uniform2f(
        gl.getUniformLocation(additiveProgram, 'u_displaySize'),
        this.displayWidth,
        this.displayHeight,
      );
      gl.bindVertexArray(this.emissionVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.emissionBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        this.vertexData.subarray(
          0,
          this.vertexCount * COMPONENTS_PER_VERTEX,
        ),
        gl.DYNAMIC_DRAW,
      );
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    }

    if (this.triangleVertexCount > 0)
    {
      const triangleProgram = this.programs.triangle;

      if (transparentOverlay)
      {
        // RGB 已乘纹理和粒子 Coverage；Alpha 独立累积 source-over 并集。
        gl.blendFuncSeparate(
          gl.ONE,
          gl.ONE,
          gl.ONE,
          gl.ONE_MINUS_SRC_ALPHA,
        );
      }
      else
      {
        // BaTouchAdditive.shader 的 RGB 是 One/One；网页输出 Alpha 单独保留
        // Cross2 Coverage，才能在最终 DOM 合成时还原目标颜色衰减。
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
      }

      gl.useProgram(triangleProgram);
      gl.uniform1i(
        gl.getUniformLocation(triangleProgram, 'u_transparentOverlay'),
        transparentOverlay ? 1 : 0,
      );
      gl.uniform2f(
        gl.getUniformLocation(triangleProgram, 'u_displaySize'),
        this.displayWidth,
        this.displayHeight,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.triangleTexture);
      gl.uniform1i(
        gl.getUniformLocation(triangleProgram, 'u_texture'),
        0,
      );
      gl.bindVertexArray(this.triangleVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.triangleBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        this.triangleVertexData.subarray(
          0,
          this.triangleVertexCount * COMPONENTS_PER_TRIANGLE_VERTEX,
        ),
        gl.DYNAMIC_DRAW,
      );
      gl.drawArrays(gl.TRIANGLES, 0, this.triangleVertexCount);
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
        gl.getUniformLocation(ringProgram, 'u_transparentOverlay'),
        transparentOverlay ? 1 : 0,
      );
      gl.uniform2f(
        gl.getUniformLocation(ringProgram, 'u_displaySize'),
        this.displayWidth,
        this.displayHeight,
      );
      gl.bindVertexArray(this.ringVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ringBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        this.ringVertexData.subarray(
          0,
          this.ringVertexCount * COMPONENTS_PER_RING_VERTEX,
        ),
        gl.DYNAMIC_DRAW,
      );
      gl.drawArrays(gl.TRIANGLES, 0, this.ringVertexCount);
    }

    gl.disable(gl.BLEND);
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
      this.sceneBackgroundFrameReady = this._copySceneBackgroundToSource();
      this.stats.sceneVertexCount = this.vertexCount +
        this.triangleVertexCount;
      this.stats.sceneDiskVertexCount = this.sceneDiskVertexCount;
      this.stats.sceneRingVertexCount = this.ringVertexCount;
      this.stats.sceneTriangleVertexCount = this.triangleVertexCount;

      if (!this._hasGeometry())
      {
        this.sceneFrameReady = true;
        return true;
      }

      this._drawGeometryBatches(
        this.programs.scene,
        settings.outputCompositing === 'transparent-overlay',
      );

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
      this.clear();
      this._deleteTargets();
      this.available = false;
      return false;
    }
  }

  _ensureVertexCapacity(additionalVertices)
  {
    const requiredComponents = (
      this.vertexCount + additionalVertices
    ) * COMPONENTS_PER_VERTEX;

    if (requiredComponents <= this.vertexData.length)
    {
      return;
    }

    let nextLength = this.vertexData.length;

    while (nextLength < requiredComponents)
    {
      nextLength = Math.ceil(nextLength * 1.5);
    }

    const next = new Float32Array(nextLength);

    next.set(this.vertexData.subarray(
      0,
      this.vertexCount * COMPONENTS_PER_VERTEX,
    ));
    this.vertexData = next;
  }

  _appendVertex(x, y, red, green, blue, coverage)
  {
    const offset = this.vertexCount * COMPONENTS_PER_VERTEX;

    this.vertexData[offset] = x;
    this.vertexData[offset + 1] = y;
    this.vertexData[offset + 2] = Math.max(0, red);
    this.vertexData[offset + 3] = Math.max(0, green);
    this.vertexData[offset + 4] = Math.max(0, blue);
    this.vertexData[offset + 5] = clamp(coverage, 0, 1);
    this.vertexCount++;
  }

  _ensureSceneDiskVertexCapacity(additionalVertices)
  {
    const requiredComponents = (
      this.sceneDiskVertexCount + additionalVertices
    ) * COMPONENTS_PER_DISK_VERTEX;

    if (requiredComponents <= this.sceneDiskVertexData.length)
    {
      return;
    }

    let nextLength = this.sceneDiskVertexData.length;

    while (nextLength < requiredComponents)
    {
      nextLength = Math.ceil(nextLength * 1.5);
    }

    const next = new Float32Array(nextLength);

    next.set(this.sceneDiskVertexData.subarray(
      0,
      this.sceneDiskVertexCount * COMPONENTS_PER_DISK_VERTEX,
    ));
    this.sceneDiskVertexData = next;
  }

  _appendSceneDiskVertex(
    x,
    y,
    u,
    v,
    red,
    green,
    blue,
    particleAlpha,
  )
  {
    const offset = this.sceneDiskVertexCount *
      COMPONENTS_PER_DISK_VERTEX;

    this.sceneDiskVertexData[offset] = x;
    this.sceneDiskVertexData[offset + 1] = y;
    this.sceneDiskVertexData[offset + 2] = u;
    this.sceneDiskVertexData[offset + 3] = v;
    this.sceneDiskVertexData[offset + 4] = Math.max(0, red);
    this.sceneDiskVertexData[offset + 5] = Math.max(0, green);
    this.sceneDiskVertexData[offset + 6] = Math.max(0, blue);
    this.sceneDiskVertexData[offset + 7] = clamp(particleAlpha, 0, 1);
    this.sceneDiskVertexCount++;
  }

  _ensureRingVertexCapacity(additionalVertices)
  {
    const requiredComponents = (
      this.ringVertexCount + additionalVertices
    ) * COMPONENTS_PER_RING_VERTEX;

    if (requiredComponents <= this.ringVertexData.length)
    {
      return;
    }

    let nextLength = this.ringVertexData.length;

    while (nextLength < requiredComponents)
    {
      nextLength = Math.ceil(nextLength * 1.5);
    }

    const next = new Float32Array(nextLength);

    next.set(this.ringVertexData.subarray(
      0,
      this.ringVertexCount * COMPONENTS_PER_RING_VERTEX,
    ));
    this.ringVertexData = next;
  }

  _appendRingVertex(
    x,
    y,
    textureAlpha,
    red,
    green,
    blue,
    dissolveThreshold,
    coverage,
  )
  {
    const offset = this.ringVertexCount * COMPONENTS_PER_RING_VERTEX;

    this.ringVertexData[offset] = x;
    this.ringVertexData[offset + 1] = y;
    this.ringVertexData[offset + 2] = clamp(textureAlpha, 0, 1);
    this.ringVertexData[offset + 3] = Math.max(0, red);
    this.ringVertexData[offset + 4] = Math.max(0, green);
    this.ringVertexData[offset + 5] = Math.max(0, blue);
    this.ringVertexData[offset + 6] = clamp(dissolveThreshold, 0, 1);
    this.ringVertexData[offset + 7] = clamp(coverage, 0, 1);
    this.ringVertexCount++;
  }

  _ensureTriangleVertexCapacity(additionalVertices)
  {
    const requiredComponents = (
      this.triangleVertexCount + additionalVertices
    ) * COMPONENTS_PER_TRIANGLE_VERTEX;

    if (requiredComponents <= this.triangleVertexData.length)
    {
      return;
    }

    let nextLength = this.triangleVertexData.length;

    while (nextLength < requiredComponents)
    {
      nextLength = Math.ceil(nextLength * 1.5);
    }

    const next = new Float32Array(nextLength);

    next.set(this.triangleVertexData.subarray(
      0,
      this.triangleVertexCount * COMPONENTS_PER_TRIANGLE_VERTEX,
    ));
    this.triangleVertexData = next;
  }

  _appendTriangleVertex(
    x,
    y,
    u,
    v,
    red,
    green,
    blue,
    particleAlpha,
  )
  {
    const offset = this.triangleVertexCount *
      COMPONENTS_PER_TRIANGLE_VERTEX;

    this.triangleVertexData[offset] = x;
    this.triangleVertexData[offset + 1] = y;
    this.triangleVertexData[offset + 2] = u;
    this.triangleVertexData[offset + 3] = v;
    this.triangleVertexData[offset + 4] = Math.max(0, red);
    this.triangleVertexData[offset + 5] = Math.max(0, green);
    this.triangleVertexData[offset + 6] = Math.max(0, blue);
    this.triangleVertexData[offset + 7] = clamp(particleAlpha, 0, 1);
    this.triangleVertexCount++;
  }

  _appendRadialDisk(
    x,
    y,
    radius,
    segmentCount,
    ensureCapacity,
    appendVertex,
  )
  {
    const segments = clamp(Math.round(segmentCount), 24, 128);
    const angleStep = Math.PI * 2 / segments;
    const cosineStep = Math.cos(angleStep);
    const sineStep = Math.sin(angleStep);
    let verticesPerSegment = 0;

    for (
      let ringIndex = 0;
      ringIndex < DISK_TEXTURE_RADIAL_STOPS.length - 1;
      ringIndex++
    )
    {
      const innerRadius = radius * DISK_TEXTURE_RADIAL_STOPS[ringIndex][0];

      verticesPerSegment += innerRadius <= DISK_CENTER_RADIUS_EPSILON ? 3 : 6;
    }

    ensureCapacity(segments * verticesPerSegment);

    for (
      let ringIndex = 0;
      ringIndex < DISK_TEXTURE_RADIAL_STOPS.length - 1;
      ringIndex++
    )
    {
      const inner = DISK_TEXTURE_RADIAL_STOPS[ringIndex];
      const outer = DISK_TEXTURE_RADIAL_STOPS[ringIndex + 1];
      const innerRadius = radius * inner[0];
      const outerRadius = radius * outer[0];
      let startCosine = 1;
      let startSine = 0;

      for (let segment = 0; segment < segments; segment++)
      {
        const lastSegment = segment === segments - 1;
        const endCosine = lastSegment
          ? 1
          : startCosine * cosineStep - startSine * sineStep;
        const endSine = lastSegment
          ? 0
          : startSine * cosineStep + startCosine * sineStep;
        const innerStartX = x + startCosine * innerRadius;
        const innerStartY = y + startSine * innerRadius;
        const innerEndX = x + endCosine * innerRadius;
        const innerEndY = y + endSine * innerRadius;
        const outerStartX = x + startCosine * outerRadius;
        const outerStartY = y + startSine * outerRadius;
        const outerEndX = x + endCosine * outerRadius;
        const outerEndY = y + endSine * outerRadius;

        if (innerRadius <= DISK_CENTER_RADIUS_EPSILON)
        {
          appendVertex(x, y, inner[1], inner[2]);
          appendVertex(outerEndX, outerEndY, outer[1], outer[2]);
          appendVertex(outerStartX, outerStartY, outer[1], outer[2]);
          startCosine = endCosine;
          startSine = endSine;
          continue;
        }

        appendVertex(innerStartX, innerStartY, inner[1], inner[2]);
        appendVertex(innerEndX, innerEndY, inner[1], inner[2]);
        appendVertex(outerEndX, outerEndY, outer[1], outer[2]);
        appendVertex(innerStartX, innerStartY, inner[1], inner[2]);
        appendVertex(outerEndX, outerEndY, outer[1], outer[2]);
        appendVertex(outerStartX, outerStartY, outer[1], outer[2]);
        startCosine = endCosine;
        startSine = endSine;
      }
    }
  }

  addSolidDisk(x, y, radius, color, opacity = 1, segmentCount = 48)
  {
    const red = color[0] * opacity;
    const green = color[1] * opacity;
    const blue = color[2] * opacity;

    if (radius <= 0 || Math.max(red, green, blue) <= 0)
    {
      return;
    }

    const segments = clamp(Math.round(segmentCount), 16, 128);
    const angleStep = Math.PI * 2 / segments;

    this._ensureVertexCapacity(segments * 3);

    for (let segment = 0; segment < segments; segment++)
    {
      const startAngle = segment * angleStep;
      const endAngle = (segment + 1) * angleStep;

      this._appendVertex(x, y, red, green, blue, opacity);
      this._appendVertex(
        x + Math.cos(endAngle) * radius,
        y + Math.sin(endAngle) * radius,
        red,
        green,
        blue,
        opacity,
      );
      this._appendVertex(
        x + Math.cos(startAngle) * radius,
        y + Math.sin(startAngle) * radius,
        red,
        green,
        blue,
        opacity,
      );
    }
  }

  addDisk(x, y, radius, color, opacity = 1, segmentCount = 64)
  {
    const red = color[0] * opacity;
    const green = color[1] * opacity;
    const blue = color[2] * opacity;

    if (radius <= 0 || Math.max(red, green, blue) <= 0)
    {
      return;
    }

    // 每对相邻 stop 都生成一条径向带；共享构建器保证 Scene 与 Bloom 纹理一致。
    this._appendRadialDisk(
      x,
      y,
      radius,
      segmentCount,
      (count) => this._ensureVertexCapacity(count),
      (vertexX, vertexY, textureAlpha, energy) =>
      {
        this._appendVertex(
          vertexX,
          vertexY,
          red * energy,
          green * energy,
          blue * energy,
          opacity * textureAlpha,
        );
      },
    );
  }

  addAlphaBlendDisk(
    x,
    y,
    radius,
    color,
    opacity = 1,
    particleAlpha = 1,
    rotation = 0,
    segmentCount = 64,
  )
  {
    // 解包 Shader 的 vertex.a 只进入输出 Alpha，不能削弱 HDR RGB 或 Bloom。
    const red = color[0] * opacity;
    const green = color[1] * opacity;
    const blue = color[2] * opacity;
    const coverageOpacity = opacity * particleAlpha;

    if (
      radius <= 0 ||
      Math.max(red, green, blue) <= 0
    )
    {
      return;
    }

    // segmentCount 仅为旧调用兼容保留；Unity Billboard 本身始终是一个 Quad。
    void segmentCount;

    const angle = Number.isFinite(rotation) ? rotation : 0;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const appendCorner = (localX, localY, u, v) =>
    {
      this._appendSceneDiskVertex(
        x + localX * cosine - localY * sine,
        y + localX * sine + localY * cosine,
        u,
        v,
        red,
        green,
        blue,
        coverageOpacity,
      );
    };

    // PNG 数据按顶行到末行保存，屏幕上边沿因此对应 V=0。
    this._ensureSceneDiskVertexCapacity(6);
    appendCorner(-radius, -radius, 0, 0);
    appendCorner(radius, -radius, 1, 0);
    appendCorner(radius, radius, 1, 1);
    appendCorner(-radius, -radius, 0, 0);
    appendCorner(radius, radius, 1, 1);
    appendCorner(-radius, radius, 0, 1);
  }

  addSceneDisk(
    x,
    y,
    radius,
    color,
    opacity = 1,
    particleAlpha = 1,
    rotation = 0,
    segmentCount = 64,
  )
  {
    // 保留旧名称供现有宿主适配；批次本身不再依赖完整 Scene 模式。
    this.addAlphaBlendDisk(
      x,
      y,
      radius,
      color,
      opacity,
      particleAlpha,
      rotation,
      segmentCount,
    );
  }

  addTriangle(
    x,
    y,
    size,
    rotation,
    color,
    opacity = 1,
    textureFrame = 0,
  )
  {
    const particleAlpha = Number.isFinite(opacity)
      ? clamp(opacity, 0, 1)
      : 0;
    const red = Math.max(0, color?.[0] ?? 0);
    const green = Math.max(0, color?.[1] ?? 0);
    const blue = Math.max(0, color?.[2] ?? 0);

    if (
      size <= 0 ||
      particleAlpha <= 0 ||
      Math.max(red, green, blue) <= 0
    )
    {
      return;
    }

    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const halfSize = size * 0.5;
    const rotatePoint = (localX, localY) =>
    ({
      x: x + localX * cosine - localY * sine,
      y: y + localX * sine + localY * cosine,
    });
    const topLeft = rotatePoint(-halfSize, -halfSize);
    const topRight = rotatePoint(halfSize, -halfSize);
    const bottomRight = rotatePoint(halfSize, halfSize);
    const bottomLeft = rotatePoint(-halfSize, halfSize);
    const frame = resolveTriangleTextureFrame(textureFrame);
    const topV = frame === 1 ? 1 : 0;
    const bottomV = frame === 1 ? 0 : 1;

    // 原始粒子使用完整方形 Mesh；透明轮廓完全由纹理 RGBA 决定。
    this._ensureTriangleVertexCapacity(6);
    this._appendTriangleVertex(
      topLeft.x,
      topLeft.y,
      0,
      topV,
      red,
      green,
      blue,
      particleAlpha,
    );
    this._appendTriangleVertex(
      topRight.x,
      topRight.y,
      1,
      topV,
      red,
      green,
      blue,
      particleAlpha,
    );
    this._appendTriangleVertex(
      bottomRight.x,
      bottomRight.y,
      1,
      bottomV,
      red,
      green,
      blue,
      particleAlpha,
    );
    this._appendTriangleVertex(
      topLeft.x,
      topLeft.y,
      0,
      topV,
      red,
      green,
      blue,
      particleAlpha,
    );
    this._appendTriangleVertex(
      bottomRight.x,
      bottomRight.y,
      1,
      bottomV,
      red,
      green,
      blue,
      particleAlpha,
    );
    this._appendTriangleVertex(
      bottomLeft.x,
      bottomLeft.y,
      0,
      bottomV,
      red,
      green,
      blue,
      particleAlpha,
    );
  }

  addTrailTriangle(first, second, third, color, opacity = 1)
  {
    const perVertexColor = Array.isArray(color?.[0]);
    const firstColor = perVertexColor ? color[0] : color;
    const secondColor = perVertexColor ? color[1] : color;
    const thirdColor = perVertexColor ? color[2] : color;
    const firstRed = firstColor[0] * opacity;
    const firstGreen = firstColor[1] * opacity;
    const firstBlue = firstColor[2] * opacity;
    const secondRed = secondColor[0] * opacity;
    const secondGreen = secondColor[1] * opacity;
    const secondBlue = secondColor[2] * opacity;
    const thirdRed = thirdColor[0] * opacity;
    const thirdGreen = thirdColor[1] * opacity;
    const thirdBlue = thirdColor[2] * opacity;

    if (
      Math.max(
        firstRed,
        firstGreen,
        firstBlue,
        secondRed,
        secondGreen,
        secondBlue,
        thirdRed,
        thirdGreen,
        thirdBlue,
      ) <= 0
    )
    {
      return;
    }

    // 三顶点颜色让内外角 fan 延续横截面纹理插值，数值保持在线性空间。
    this._ensureVertexCapacity(3);
    this._appendVertex(
      first.x,
      first.y,
      firstRed,
      firstGreen,
      firstBlue,
      opacity,
    );
    this._appendVertex(
      second.x,
      second.y,
      secondRed,
      secondGreen,
      secondBlue,
      opacity,
    );
    this._appendVertex(
      third.x,
      third.y,
      thirdRed,
      thirdGreen,
      thirdBlue,
      opacity,
    );
  }

  addDissolveRing(
    x,
    y,
    radius,
    width,
    rotation,
    radialSamples,
    segmentCount,
    materialColor,
    opacity,
    dissolveThreshold,
    sampleTextureAlpha,
  )
  {
    const red = materialColor[0] * opacity;
    const green = materialColor[1] * opacity;
    const blue = materialColor[2] * opacity;

    if (
      radius <= 0 ||
      width <= 0 ||
      Math.max(red, green, blue) <= 0 ||
      typeof sampleTextureAlpha !== 'function'
    )
    {
      return;
    }

    const bands = clamp(Math.round(radialSamples), 1, 32);
    const segments = clamp(Math.round(segmentCount), 32, 512);
    const innerEdge = Math.max(0, radius - width * 0.5);
    const bandWidth = width / bands;
    const angleStep = Math.PI * 2 / segments;
    const cosine = new Float64Array(segments + 1);
    const sine = new Float64Array(segments + 1);
    const textureAlpha = new Float32Array(
      (bands + 1) * (segments + 1),
    );
    const coverageOpacity = clamp(opacity, 0, 1);
    const safeThreshold = Number.isFinite(dissolveThreshold)
      ? clamp(dissolveThreshold, 0, 1)
      : 1;

    for (let segment = 0; segment <= segments; segment++)
    {
      const angularProgress = segment / segments;
      const angle = rotation + angularProgress * Math.PI * 2;

      cosine[segment] = Math.cos(angle);
      sine[segment] = Math.sin(angle);
    }

    for (let band = 0; band <= bands; band++)
    {
      const radialProgress = band / bands;

      for (let segment = 0; segment <= segments; segment++)
      {
        const value = sampleTextureAlpha(
          segment / segments,
          radialProgress,
        );
        const sampleIndex = band * (segments + 1) + segment;

        textureAlpha[sampleIndex] = Number.isFinite(value)
          ? clamp(value, 0, 1)
          : 0;
      }
    }

    // 不在 CPU 跳过溶解区域；完整网格让 Fragment discard 保留硬裁剪边界。
    this._ensureRingVertexCapacity(bands * segments * 6);

    for (let band = 0; band < bands; band++)
    {
      const innerRadius = innerEdge + bandWidth * band;
      const outerRadius = innerEdge + bandWidth * (band + 1);
      const innerRow = band * (segments + 1);
      const outerRow = (band + 1) * (segments + 1);

      for (let segment = 0; segment < segments; segment++)
      {
        const nextSegment = segment + 1;
        const innerStartX = x + cosine[segment] * innerRadius;
        const innerStartY = y + sine[segment] * innerRadius;
        const innerEndX = x + cosine[nextSegment] * innerRadius;
        const innerEndY = y + sine[nextSegment] * innerRadius;
        const outerStartX = x + cosine[segment] * outerRadius;
        const outerStartY = y + sine[segment] * outerRadius;
        const outerEndX = x + cosine[nextSegment] * outerRadius;
        const outerEndY = y + sine[nextSegment] * outerRadius;
        const innerStartAlpha = textureAlpha[innerRow + segment];
        const innerEndAlpha = textureAlpha[innerRow + nextSegment];
        const outerStartAlpha = textureAlpha[outerRow + segment];
        const outerEndAlpha = textureAlpha[outerRow + nextSegment];

        this._appendRingVertex(
          innerStartX,
          innerStartY,
          innerStartAlpha,
          red,
          green,
          blue,
          safeThreshold,
          innerStartAlpha * coverageOpacity,
        );
        this._appendRingVertex(
          innerEndX,
          innerEndY,
          innerEndAlpha,
          red,
          green,
          blue,
          safeThreshold,
          innerEndAlpha * coverageOpacity,
        );
        this._appendRingVertex(
          outerEndX,
          outerEndY,
          outerEndAlpha,
          red,
          green,
          blue,
          safeThreshold,
          outerEndAlpha * coverageOpacity,
        );
        this._appendRingVertex(
          innerStartX,
          innerStartY,
          innerStartAlpha,
          red,
          green,
          blue,
          safeThreshold,
          innerStartAlpha * coverageOpacity,
        );
        this._appendRingVertex(
          outerEndX,
          outerEndY,
          outerEndAlpha,
          red,
          green,
          blue,
          safeThreshold,
          outerEndAlpha * coverageOpacity,
        );
        this._appendRingVertex(
          outerStartX,
          outerStartY,
          outerStartAlpha,
          red,
          green,
          blue,
          safeThreshold,
          outerStartAlpha * coverageOpacity,
        );
      }
    }
  }

  addRing(
    x,
    y,
    radius,
    width,
    rotation,
    radialSamples,
    segmentCount,
    materialColor,
    opacity,
    sampleLuminance,
  )
  {
    if (width <= 0 || opacity <= 0)
    {
      return;
    }

    const bands = clamp(Math.round(radialSamples), 1, 32);
    const segments = clamp(Math.round(segmentCount), 32, 512);
    const innerEdge = Math.max(0, radius - width * 0.5);
    const bandWidth = width / bands;
    const red = materialColor[0] * opacity;
    const green = materialColor[1] * opacity;
    const blue = materialColor[2] * opacity;
    const angleStep = Math.PI * 2 / segments;
    const cosineStep = Math.cos(angleStep);
    const sineStep = Math.sin(angleStep);
    const rotationCosine = Math.cos(rotation);
    const rotationSine = Math.sin(rotation);

    // 溶解会跳过部分片元，但按最坏情况预留可避免数万顶点时反复扩容。
    this._ensureVertexCapacity(bands * segments * 6);

    for (let band = 0; band < bands; band++)
    {
      const innerRadius = innerEdge + bandWidth * band;
      const outerRadius = innerEdge + bandWidth * (band + 1);
      const radialProgress = (band + 0.5) / bands;
      let startCosine = rotationCosine;
      let startSine = rotationSine;
      let startLuminance = sampleLuminance(0, radialProgress);

      for (let segment = 0; segment < segments; segment++)
      {
        const endProgress = (segment + 1) / segments;
        const endLuminance = sampleLuminance(
          endProgress,
          radialProgress,
        );
        const lastSegment = segment === segments - 1;
        const endCosine = lastSegment
          ? rotationCosine
          : startCosine * cosineStep - startSine * sineStep;
        const endSine = lastSegment
          ? rotationSine
          : startSine * cosineStep + startCosine * sineStep;

        if (startLuminance <= 0 && endLuminance <= 0)
        {
          startCosine = endCosine;
          startSine = endSine;
          startLuminance = endLuminance;
          continue;
        }

        const startRed = red * startLuminance;
        const startGreen = green * startLuminance;
        const startBlue = blue * startLuminance;
        const endRed = red * endLuminance;
        const endGreen = green * endLuminance;
        const endBlue = blue * endLuminance;
        const innerStartX = x + startCosine * innerRadius;
        const innerStartY = y + startSine * innerRadius;
        const innerEndX = x + endCosine * innerRadius;
        const innerEndY = y + endSine * innerRadius;
        const outerStartX = x + startCosine * outerRadius;
        const outerStartY = y + startSine * outerRadius;
        const outerEndX = x + endCosine * outerRadius;
        const outerEndY = y + endSine * outerRadius;

        this._appendVertex(
          innerStartX,
          innerStartY,
          startRed,
          startGreen,
          startBlue,
          opacity * startLuminance,
        );
        this._appendVertex(
          innerEndX,
          innerEndY,
          endRed,
          endGreen,
          endBlue,
          opacity * endLuminance,
        );
        this._appendVertex(
          outerEndX,
          outerEndY,
          endRed,
          endGreen,
          endBlue,
          opacity * endLuminance,
        );
        this._appendVertex(
          innerStartX,
          innerStartY,
          startRed,
          startGreen,
          startBlue,
          opacity * startLuminance,
        );
        this._appendVertex(
          outerEndX,
          outerEndY,
          endRed,
          endGreen,
          endBlue,
          opacity * endLuminance,
        );
        this._appendVertex(
          outerStartX,
          outerStartY,
          startRed,
          startGreen,
          startBlue,
          opacity * startLuminance,
        );
        startCosine = endCosine;
        startSine = endSine;
        startLuminance = endLuminance;
      }
    }
  }

  addTrailSegment(
    from,
    to,
    width,
    color,
    opacity = 1,
    transverseProfile = null,
    fromOffset = null,
    toOffset = null,
    capStart = false,
    capEnd = false,
  )
  {
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const length = Math.hypot(deltaX, deltaY);
    const red = color[0] * opacity;
    const green = color[1] * opacity;
    const blue = color[2] * opacity;

    if (length <= 0 || width <= 0 || Math.max(red, green, blue) <= 0)
    {
      return;
    }

    const profile = Array.isArray(transverseProfile) &&
        transverseProfile.length >= 2
      ? transverseProfile
      : [[0, 1], [1, 1]];
    const halfWidth = width * 0.5;
    const defaultOffset =
    {
      x: -deltaY / length * halfWidth,
      y: deltaX / length * halfWidth,
    };
    const startOffset = fromOffset ?? defaultOffset;
    const endOffset = toOffset ?? defaultOffset;

    this._ensureVertexCapacity(
      (profile.length - 1) * 6 +
        (capStart ? 3 : 0) +
        (capEnd ? 3 : 0),
    );

    for (let index = 1; index < profile.length; index++)
    {
      const previous = profile[index - 1];
      const current = profile[index];
      const previousOffsetScale = 1 - previous[0] * 2;
      const currentOffsetScale = 1 - current[0] * 2;
      const previousFromX = from.x +
        startOffset.x * previousOffsetScale;
      const previousFromY = from.y +
        startOffset.y * previousOffsetScale;
      const previousToX = to.x + endOffset.x * previousOffsetScale;
      const previousToY = to.y + endOffset.y * previousOffsetScale;
      const currentFromX = from.x + startOffset.x * currentOffsetScale;
      const currentFromY = from.y + startOffset.y * currentOffsetScale;
      const currentToX = to.x + endOffset.x * currentOffsetScale;
      const currentToY = to.y + endOffset.y * currentOffsetScale;
      const previousRed = red * previous[1];
      const previousGreen = green * previous[1];
      const previousBlue = blue * previous[1];
      const currentRed = red * current[1];
      const currentGreen = green * current[1];
      const currentBlue = blue * current[1];

      this._appendVertex(
        previousFromX,
        previousFromY,
        previousRed,
        previousGreen,
        previousBlue,
        opacity,
      );
      this._appendVertex(
        previousToX,
        previousToY,
        previousRed,
        previousGreen,
        previousBlue,
        opacity,
      );
      this._appendVertex(
        currentToX,
        currentToY,
        currentRed,
        currentGreen,
        currentBlue,
        opacity,
      );
      this._appendVertex(
        previousFromX,
        previousFromY,
        previousRed,
        previousGreen,
        previousBlue,
        opacity,
      );
      this._appendVertex(
        currentToX,
        currentToY,
        currentRed,
        currentGreen,
        currentBlue,
        opacity,
      );
      this._appendVertex(
        currentFromX,
        currentFromY,
        currentRed,
        currentGreen,
        currentBlue,
        opacity,
      );
    }

    if (!capStart && !capEnd)
    {
      return;
    }

    const tangentX = deltaX / length;
    const tangentY = deltaY / length;
    const centerIntensity = profile.reduce(
      (maximum, [, intensity]) => Math.max(maximum, intensity),
      0,
    );
    const centerRed = red * centerIntensity;
    const centerGreen = green * centerIntensity;
    const centerBlue = blue * centerIntensity;

    if (capStart)
    {
      this._appendVertex(
        from.x + startOffset.x,
        from.y + startOffset.y,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
      this._appendVertex(
        from.x - startOffset.x,
        from.y - startOffset.y,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
      this._appendVertex(
        from.x - tangentX * halfWidth,
        from.y - tangentY * halfWidth,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
    }

    if (capEnd)
    {
      this._appendVertex(
        to.x + endOffset.x,
        to.y + endOffset.y,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
      this._appendVertex(
        to.x + tangentX * halfWidth,
        to.y + tangentY * halfWidth,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
      this._appendVertex(
        to.x - endOffset.x,
        to.y - endOffset.y,
        centerRed,
        centerGreen,
        centerBlue,
        opacity,
      );
    }
  }

  _bindTexture(program, name, texture, unit)
  {
    const gl = this.gl;

    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(gl.getUniformLocation(program, name), unit);
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

  _renderEmission()
  {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sourceTarget.framebuffer);
    gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this._drawGeometryBatches(this.programs.emission);
  }

  _renderPrefilter(settings)
  {
    const gl = this.gl;
    const program = this.programs.prefilter;
    const level = this.levels[0];
    const softKnee = Number.isFinite(settings.softKnee)
      ? clamp(settings.softKnee, 0, 1)
      : 0;
    const clampMax = Number.isFinite(settings.clamp)
      ? clamp(settings.clamp, 0, 65504)
      : 65472;

    gl.useProgram(program);
    this._bindTexture(program, 'u_source', this.sourceTarget.texture, 0);
    gl.uniform2f(
      gl.getUniformLocation(program, 'u_sourceTexel'),
      1 / this.sourceWidth,
      1 / this.sourceHeight,
    );
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_threshold'),
      gammaToLinear(settings.threshold),
    );
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_softKnee'),
      softKnee,
    );
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_clampMax'),
      clampMax,
    );
    this._drawFullscreen(program, level.down, level.width, level.height);
  }

  _renderDownsample(sourceLevel, targetLevel)
  {
    const gl = this.gl;
    const program = this.programs.downsample;

    gl.useProgram(program);
    this._bindTexture(program, 'u_source', sourceLevel.down.texture, 0);
    gl.uniform2f(
      gl.getUniformLocation(program, 'u_sourceTexel'),
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

  _renderUpsample(highLevel, lowLevel, lowTexture)
  {
    const gl = this.gl;
    const program = this.programs.upsample;

    gl.useProgram(program);
    this._bindTexture(program, 'u_high', highLevel.down.texture, 0);
    this._bindTexture(program, 'u_low', lowTexture, 1);
    gl.uniform2f(
      gl.getUniformLocation(program, 'u_lowTexel'),
      1 / lowLevel.width,
      1 / lowLevel.height,
    );
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_sampleScale'),
      this.sampleScale,
    );
    this._drawFullscreen(
      program,
      highLevel.up,
      highLevel.width,
      highLevel.height,
    );

    return highLevel.up.texture;
  }

  _renderFinal(
    texture,
    settings,
    hasScene = false,
    hasBackground = false,
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
      hasScene ? this.sourceTarget.texture : texture,
      1,
    );
    this._bindTexture(
      program,
      'u_background',
      hasBackground ? this.sceneBackgroundTarget.texture : texture,
      2,
    );
    gl.uniform1i(
      gl.getUniformLocation(program, 'u_hasScene'),
      hasScene ? 1 : 0,
    );
    gl.uniform1i(
      gl.getUniformLocation(program, 'u_hasBackground'),
      hasBackground ? 1 : 0,
    );
    gl.uniform2f(
      gl.getUniformLocation(program, 'u_bloomTexel'),
      1 / this.width,
      1 / this.height,
    );
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_sampleScale'),
      this.sampleScale,
    );
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_intensity'),
      // WebGL 最终输出与软件后端共享网页曝光标定，避免缺少 Unity 相机
      // HDR 后处理时把 1.7 直接作为线性倍率并产生整片白色钳制。
      Math.pow(2, Math.max(0, settings.intensity) / 10) - 1,
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
      this.levels.length === 0
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
        this._renderEmission();
      }

      this._renderPrefilter(settings);

      for (let level = 1; level < this.levels.length; level++)
      {
        this._renderDownsample(
          this.levels[level - 1],
          this.levels[level],
        );
      }

      let bloomTexture = this.levels.at(-1).down.texture;

      for (let level = this.levels.length - 2; level >= 0; level--)
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
      );
      this.stats.vertexCount = this.vertexCount + this.triangleVertexCount;
      this.stats.diskVertexCount = this.sceneDiskVertexCount;
      this.stats.ringVertexCount = this.ringVertexCount;
      this.stats.triangleVertexCount = this.triangleVertexCount;

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
      this.clear();
      this._deleteTargets();
      this.available = false;
      return false;
    }
  }

  clear()
  {
    this.sceneFrameReady = false;
    this.sceneBackgroundFrameReady = false;
    this.stats.vertexCount = 0;
    this.stats.diskVertexCount = 0;
    this.stats.ringVertexCount = 0;
    this.stats.triangleVertexCount = 0;
    this.stats.sceneVertexCount = 0;
    this.stats.sceneDiskVertexCount = 0;
    this.stats.sceneRingVertexCount = 0;
    this.stats.sceneTriangleVertexCount = 0;

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
    this.maximumTextureSize = 0;
    this.maximumViewportWidth = 0;
    this.maximumViewportHeight = 0;
    this.failedResizeSignature = null;
    this.sceneBackgroundSource = null;
    this.sceneBackgroundWidth = 0;
    this.sceneBackgroundHeight = 0;
  }
}
