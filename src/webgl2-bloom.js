const COMPONENTS_PER_VERTEX = 5;
const INITIAL_VERTEX_CAPACITY = 4096;
const MAX_PYRAMID_LEVELS = 16;
const DISK_BLOOM_RADIAL_STOPS = Object.freeze(
  [
    [0, 1],
    [0.88, 1],
    [1, 0],
  ],
);

const EMISSION_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec3 a_color;

uniform vec2 u_displaySize;

out vec3 v_color;

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
uniform vec2 u_prefilterTexel;
uniform float u_threshold;
uniform float u_softKnee;
uniform float u_clampMax;
uniform bool u_highQuality;

in vec2 v_uv;
out vec4 outColor;

vec3 sampleSource(vec2 offset)
{
  return texture(u_source, v_uv + offset * u_prefilterTexel).rgb;
}

vec3 thresholdColor(vec3 color)
{
  color = min(color, vec3(u_clampMax));
  float brightness = max(max(color.r, color.g), color.b);

  if (brightness <= 0.0)
  {
    return vec3(0.0);
  }

  float threshold = max(0.0, u_threshold);
  float knee = max(threshold * clamp(u_softKnee, 0.0, 1.0), 0.00001);
  float soft = brightness - threshold + knee;

  soft = clamp(soft, 0.0, knee * 2.0);
  soft = soft * soft / (knee * 4.0 + 0.0001);

  float contribution = max(max(brightness - threshold, soft), 0.0);
  return color * contribution / max(brightness, 0.0001);
}

void main()
{
  vec3 color;

  if (!u_highQuality)
  {
    color = texture(u_source, v_uv).rgb;
  }
  else
  {
    color =
      sampleSource(vec2(-1.0, -1.0)) * 0.03125 +
      sampleSource(vec2(0.0, -1.0)) * 0.0625 +
      sampleSource(vec2(1.0, -1.0)) * 0.03125 +
      sampleSource(vec2(-0.5, -0.5)) * 0.125 +
      sampleSource(vec2(0.5, -0.5)) * 0.125 +
      sampleSource(vec2(-1.0, 0.0)) * 0.0625 +
      sampleSource(vec2(0.0, 0.0)) * 0.125 +
      sampleSource(vec2(1.0, 0.0)) * 0.0625 +
      sampleSource(vec2(-0.5, 0.5)) * 0.125 +
      sampleSource(vec2(0.5, 0.5)) * 0.125 +
      sampleSource(vec2(-1.0, 1.0)) * 0.03125 +
      sampleSource(vec2(0.0, 1.0)) * 0.0625 +
      sampleSource(vec2(1.0, 1.0)) * 0.03125;
  }

  outColor = vec4(thresholdColor(color), 1.0);
}
`;

const DOWNSAMPLE_HORIZONTAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec2 u_sourceTexel;

in vec2 v_uv;
out vec4 outColor;

void main()
{
  vec3 color =
    texture(u_source, v_uv + vec2(-8.0 * u_sourceTexel.x, 0.0)).rgb * 0.01621622 +
    texture(u_source, v_uv + vec2(-6.0 * u_sourceTexel.x, 0.0)).rgb * 0.05405405 +
    texture(u_source, v_uv + vec2(-4.0 * u_sourceTexel.x, 0.0)).rgb * 0.12162162 +
    texture(u_source, v_uv + vec2(-2.0 * u_sourceTexel.x, 0.0)).rgb * 0.19459459 +
    texture(u_source, v_uv).rgb * 0.22702703 +
    texture(u_source, v_uv + vec2(2.0 * u_sourceTexel.x, 0.0)).rgb * 0.19459459 +
    texture(u_source, v_uv + vec2(4.0 * u_sourceTexel.x, 0.0)).rgb * 0.12162162 +
    texture(u_source, v_uv + vec2(6.0 * u_sourceTexel.x, 0.0)).rgb * 0.05405405 +
    texture(u_source, v_uv + vec2(8.0 * u_sourceTexel.x, 0.0)).rgb * 0.01621622;

  outColor = vec4(color, 1.0);
}
`;

const DOWNSAMPLE_VERTICAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_source;
uniform vec2 u_sourceTexel;

in vec2 v_uv;
out vec4 outColor;

void main()
{
  vec3 color =
    texture(u_source, v_uv + vec2(0.0, -3.23076923 * u_sourceTexel.y)).rgb * 0.07027027 +
    texture(u_source, v_uv + vec2(0.0, -1.38461538 * u_sourceTexel.y)).rgb * 0.31621622 +
    texture(u_source, v_uv).rgb * 0.22702703 +
    texture(u_source, v_uv + vec2(0.0, 1.38461538 * u_sourceTexel.y)).rgb * 0.31621622 +
    texture(u_source, v_uv + vec2(0.0, 3.23076923 * u_sourceTexel.y)).rgb * 0.07027027;

  outColor = vec4(color, 1.0);
}
`;

const UPSAMPLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_high;
uniform sampler2D u_low;
uniform float u_scatter;
uniform bool u_highQuality;

in vec2 v_uv;
out vec4 outColor;

void calculateBicubicAxis(
  float position,
  out vec2 samplePositions,
  out vec2 sampleWeights
)
{
  float coordinate = position + 1.0;
  float cell = floor(coordinate);
  float fraction = coordinate - cell;
  float rightmost = 1.0 / 6.0 + fraction * (
    -0.5 + fraction * (0.5 - fraction / 6.0)
  );
  float middleRight = 2.0 / 3.0 + fraction * (
    -1.0 + 0.5 * fraction
  ) * fraction;
  float middleLeft = 1.0 / 6.0 + fraction * (
    0.5 + fraction * (0.5 - 0.5 * fraction)
  );
  float leftmost = 1.0 - middleRight - middleLeft - rightmost;
  float firstWeight = rightmost + middleRight;
  float secondWeight = middleLeft + leftmost;

  samplePositions = vec2(
    cell - 2.0 + middleRight / max(firstWeight, 0.00001),
    cell + leftmost / max(secondWeight, 0.00001)
  );
  sampleWeights = vec2(firstWeight, secondWeight);
}

vec3 sampleBicubic(sampler2D source, vec2 uv)
{
  vec2 size = vec2(textureSize(source, 0));
  vec2 pixel = uv * size - 0.5;
  vec2 horizontalPositions;
  vec2 horizontalWeights;
  vec2 verticalPositions;
  vec2 verticalWeights;

  calculateBicubicAxis(pixel.x, horizontalPositions, horizontalWeights);
  calculateBicubicAxis(pixel.y, verticalPositions, verticalWeights);

  vec3 firstRow =
    texture(
      source,
      (vec2(horizontalPositions.x, verticalPositions.x) + 0.5) / size
    ).rgb * horizontalWeights.x +
    texture(
      source,
      (vec2(horizontalPositions.y, verticalPositions.x) + 0.5) / size
    ).rgb * horizontalWeights.y;
  vec3 secondRow =
    texture(
      source,
      (vec2(horizontalPositions.x, verticalPositions.y) + 0.5) / size
    ).rgb * horizontalWeights.x +
    texture(
      source,
      (vec2(horizontalPositions.y, verticalPositions.y) + 0.5) / size
    ).rgb * horizontalWeights.y;

  return firstRow * verticalWeights.x + secondRow * verticalWeights.y;
}

void main()
{
  float mixAmount = clamp(u_scatter, 0.0, 1.0);
  vec3 high = texture(u_high, v_uv).rgb;
  vec3 low = u_highQuality
    ? sampleBicubic(u_low, v_uv)
    : texture(u_low, v_uv).rgb;

  outColor = vec4(high * (1.0 - mixAmount) + low * mixAmount, 1.0);
}
`;

const FINAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_bloom;
uniform float u_intensity;

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

void main()
{
  vec3 linear = texture(u_bloom, v_uv).rgb * max(0.0, u_intensity);
  vec3 srgb = vec3(
    linearToSrgb(linear.r),
    linearToSrgb(linear.g),
    linearToSrgb(linear.b)
  );
  float alpha = max(max(srgb.r, srgb.g), srgb.b);

  if (alpha <= 0.00001)
  {
    outColor = vec4(0.0);
    return;
  }

  // WebGL Canvas 以预乘 Alpha 交给页面合成器；RGB 直接保存加色贡献。
  outColor = vec4(srgb, alpha);
}
`;

function clamp(value, minimum, maximum)
{
  return Math.max(minimum, Math.min(maximum, value));
}

function calculatePyramidLevelCount(
  displayWidth,
  displayHeight,
  resolutionScale,
  skipIterations,
)
{
  const safeScale = clamp(resolutionScale, 0.1, 0.75);
  const maxSize = Math.max(
    1,
    Math.floor(displayWidth * safeScale),
    Math.floor(displayHeight * safeScale),
  );
  const iterations = Math.floor(Math.log2(maxSize) - 1) -
    clamp(Math.round(skipIterations), 0, 16);

  return clamp(iterations, 1, MAX_PYRAMID_LEVELS);
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

export class WebGL2BloomRenderer
{
  constructor(canvas)
  {
    this.canvas = canvas;
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
    this.skipIterations = 0;
    this.maximumTextureSize = 0;
    this.maximumViewportWidth = 0;
    this.maximumViewportHeight = 0;
    this.vertexCount = 0;
    this.vertexData = new Float32Array(
      INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_VERTEX,
    );
    this.sourceTarget = null;
    this.levels = [];
    this.programs = null;
    this.emissionBuffer = null;
    this.emissionVao = null;
    this.fullscreenVao = null;
    this.stats =
    {
      vertexCount: 0,
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
      this.programs.prefilter = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        PREFILTER_FRAGMENT_SHADER,
      );
      this.programs.downsampleHorizontal = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        DOWNSAMPLE_HORIZONTAL_FRAGMENT_SHADER,
      );
      this.programs.downsampleVertical = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        DOWNSAMPLE_VERTICAL_FRAGMENT_SHADER,
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
      this.fullscreenVao = gl.createVertexArray();

      if (!this.emissionBuffer || !this.emissionVao || !this.fullscreenVao)
      {
        throw new Error('WebGL2 无法创建几何缓冲');
      }

      gl.bindVertexArray(this.emissionVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.emissionBuffer);

      const stride = COMPONENTS_PER_VERTEX * Float32Array.BYTES_PER_ELEMENT;
      const positionLocation = gl.getAttribLocation(
        this.programs.emission,
        'a_position',
      );
      const colorLocation = gl.getAttribLocation(
        this.programs.emission,
        'a_color',
      );

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
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      this.contextLost = false;
      this.available = true;

      if (this.width > 0 && this.height > 0)
      {
        this._allocateTargets();
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL2 Bloom 初始化失败:', error);
      this.available = false;
      this._deleteResources();
    }
  }

  _handleContextLost(event)
  {
    event?.preventDefault?.();
    this.contextLost = true;
    this.available = false;
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
    this.programs = null;
    this.emissionBuffer = null;
    this.emissionVao = null;
    this.fullscreenVao = null;
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
    this.sourceTarget = null;

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
        gl.deleteProgram(program);
      }
    }

    gl.deleteBuffer(this.emissionBuffer);
    gl.deleteVertexArray(this.emissionVao);
    gl.deleteVertexArray(this.fullscreenVao);
    this.programs = null;
    this.emissionBuffer = null;
    this.emissionVao = null;
    this.fullscreenVao = null;
    this.stats.levelCount = 0;
    this.stats.bloomPixels = 0;
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

      const levelCount = calculatePyramidLevelCount(
        this.sourceWidth,
        this.sourceHeight,
        this.resolutionScale,
        this.skipIterations,
      );
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
        // mip0 不接收横向降采样，最末 mip 也不会作为高层上采样输出。
        level.scratch = index === 0 ? null : this._createTarget(width, height);
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

      this.stats.levelCount = this.levels.length;
      this.stats.bloomPixels = this.levels.reduce(
        (total, level) => total + level.width * level.height,
        0,
      );
      return true;
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL2 Bloom 缓冲创建失败:', error);
      this.available = false;
      this._deleteTargets();
      return false;
    }
  }

  resize(
    displayWidth,
    displayHeight,
    dpr,
    resolutionScale,
    skipIterations,
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
    const safeSkip = clamp(Math.round(skipIterations), 0, 16);

    if (
      sourceWidth > this.maximumTextureSize ||
      sourceHeight > this.maximumTextureSize ||
      sourceWidth > this.maximumViewportWidth ||
      sourceHeight > this.maximumViewportHeight
    )
    {
      console.warn('[BAClickFX] WebGL2 Bloom 尺寸超过设备上限，回退软件 Bloom');
      this._deleteTargets();
      this.available = false;
      return false;
    }

    const unchanged = sourceWidth === this.sourceWidth &&
      sourceHeight === this.sourceHeight &&
      width === this.width &&
      height === this.height &&
      safeSkip === this.skipIterations;

    this.displayWidth = safeDisplayWidth;
    this.displayHeight = safeDisplayHeight;
    this.dpr = safeDpr;
    this.resolutionScale = safeScale;
    this.skipIterations = safeSkip;
    this.sourceWidth = sourceWidth;
    this.sourceHeight = sourceHeight;

    if (unchanged)
    {
      return this.available;
    }

    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    return this._allocateTargets();
  }

  beginFrame()
  {
    this.vertexCount = 0;
    this.stats.vertexCount = 0;
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

  _appendVertex(x, y, red, green, blue)
  {
    const offset = this.vertexCount * COMPONENTS_PER_VERTEX;

    this.vertexData[offset] = x;
    this.vertexData[offset + 1] = y;
    this.vertexData[offset + 2] = Math.max(0, red);
    this.vertexData[offset + 3] = Math.max(0, green);
    this.vertexData[offset + 4] = Math.max(0, blue);
    this.vertexCount++;
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

    const segments = clamp(Math.round(segmentCount), 24, 128);
    const angleStep = Math.PI * 2 / segments;
    const cosineStep = Math.cos(angleStep);
    const sineStep = Math.sin(angleStep);

    // 每段由一个中心三角形和一个渐隐四边形组成；一次扩容避免热循环检查。
    this._ensureVertexCapacity(segments * 9);

    for (
      let ringIndex = 0;
      ringIndex < DISK_BLOOM_RADIAL_STOPS.length - 1;
      ringIndex++
    )
    {
      const inner = DISK_BLOOM_RADIAL_STOPS[ringIndex];
      const outer = DISK_BLOOM_RADIAL_STOPS[ringIndex + 1];
      const innerRed = red * inner[1];
      const innerGreen = green * inner[1];
      const innerBlue = blue * inner[1];
      const outerRed = red * outer[1];
      const outerGreen = green * outer[1];
      const outerBlue = blue * outer[1];
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

        if (innerRadius <= 0.00001)
        {
          this._appendVertex(x, y, innerRed, innerGreen, innerBlue);
          this._appendVertex(
            outerEndX,
            outerEndY,
            outerRed,
            outerGreen,
            outerBlue,
          );
          this._appendVertex(
            outerStartX,
            outerStartY,
            outerRed,
            outerGreen,
            outerBlue,
          );
          startCosine = endCosine;
          startSine = endSine;
          continue;
        }

        this._appendVertex(
          innerStartX,
          innerStartY,
          innerRed,
          innerGreen,
          innerBlue,
        );
        this._appendVertex(
          innerEndX,
          innerEndY,
          innerRed,
          innerGreen,
          innerBlue,
        );
        this._appendVertex(
          outerEndX,
          outerEndY,
          outerRed,
          outerGreen,
          outerBlue,
        );
        this._appendVertex(
          innerStartX,
          innerStartY,
          innerRed,
          innerGreen,
          innerBlue,
        );
        this._appendVertex(
          outerEndX,
          outerEndY,
          outerRed,
          outerGreen,
          outerBlue,
        );
        this._appendVertex(
          outerStartX,
          outerStartY,
          outerRed,
          outerGreen,
          outerBlue,
        );
        startCosine = endCosine;
        startSine = endSine;
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
        );
        this._appendVertex(
          innerEndX,
          innerEndY,
          endRed,
          endGreen,
          endBlue,
        );
        this._appendVertex(
          outerEndX,
          outerEndY,
          endRed,
          endGreen,
          endBlue,
        );
        this._appendVertex(
          innerStartX,
          innerStartY,
          startRed,
          startGreen,
          startBlue,
        );
        this._appendVertex(
          outerEndX,
          outerEndY,
          endRed,
          endGreen,
          endBlue,
        );
        this._appendVertex(
          outerStartX,
          outerStartY,
          startRed,
          startGreen,
          startBlue,
        );
        startCosine = endCosine;
        startSine = endSine;
        startLuminance = endLuminance;
      }
    }
  }

  addTrailSegment(from, to, width, color, opacity = 1)
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

    const halfWidth = width * 0.5;
    const normalX = -deltaY / length * halfWidth;
    const normalY = deltaX / length * halfWidth;
    const firstLeftX = from.x + normalX;
    const firstLeftY = from.y + normalY;
    const secondLeftX = to.x + normalX;
    const secondLeftY = to.y + normalY;
    const secondRightX = to.x - normalX;
    const secondRightY = to.y - normalY;
    const firstRightX = from.x - normalX;
    const firstRightY = from.y - normalY;

    this._ensureVertexCapacity(6);
    this._appendVertex(firstLeftX, firstLeftY, red, green, blue);
    this._appendVertex(secondLeftX, secondLeftY, red, green, blue);
    this._appendVertex(secondRightX, secondRightY, red, green, blue);
    this._appendVertex(firstLeftX, firstLeftY, red, green, blue);
    this._appendVertex(secondRightX, secondRightY, red, green, blue);
    this._appendVertex(firstRightX, firstRightY, red, green, blue);
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
    const program = this.programs.emission;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sourceTarget.framebuffer);
    gl.viewport(0, 0, this.sourceWidth, this.sourceHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(program);
    gl.uniform2f(
      gl.getUniformLocation(program, 'u_displaySize'),
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
    gl.disable(gl.BLEND);
  }

  _renderPrefilter(settings)
  {
    const gl = this.gl;
    const program = this.programs.prefilter;
    const level = this.levels[0];

    gl.useProgram(program);
    this._bindTexture(program, 'u_source', this.sourceTarget.texture, 0);
    // URP 12 使用 source 宽度的 texel 尺寸同时偏移两个轴。
    gl.uniform2f(
      gl.getUniformLocation(program, 'u_prefilterTexel'),
      1 / this.sourceWidth,
      1 / this.sourceWidth,
    );
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_threshold'),
      settings.threshold,
    );
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_softKnee'),
      settings.softKnee,
    );
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_clampMax'),
      settings.clamp ?? 65472,
    );
    gl.uniform1i(
      gl.getUniformLocation(program, 'u_highQuality'),
      settings.highQualityFiltering !== false ? 1 : 0,
    );
    this._drawFullscreen(program, level.down, level.width, level.height);
  }

  _renderDownsample(sourceLevel, targetLevel)
  {
    const gl = this.gl;
    let program = this.programs.downsampleHorizontal;

    gl.useProgram(program);
    this._bindTexture(program, 'u_source', sourceLevel.down.texture, 0);
    gl.uniform2f(
      gl.getUniformLocation(program, 'u_sourceTexel'),
      1 / sourceLevel.width,
      1 / sourceLevel.height,
    );
    this._drawFullscreen(
      program,
      targetLevel.scratch,
      targetLevel.width,
      targetLevel.height,
    );

    program = this.programs.downsampleVertical;
    gl.useProgram(program);
    this._bindTexture(program, 'u_source', targetLevel.scratch.texture, 0);
    gl.uniform2f(
      gl.getUniformLocation(program, 'u_sourceTexel'),
      1 / targetLevel.width,
      1 / targetLevel.height,
    );
    this._drawFullscreen(
      program,
      targetLevel.down,
      targetLevel.width,
      targetLevel.height,
    );
  }

  _renderUpsample(highLevel, lowTexture, settings)
  {
    const gl = this.gl;
    const program = this.programs.upsample;

    gl.useProgram(program);
    this._bindTexture(program, 'u_high', highLevel.down.texture, 0);
    this._bindTexture(program, 'u_low', lowTexture, 1);
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_scatter'),
      0.05 + clamp(settings.scatter, 0, 1) * 0.9,
    );
    gl.uniform1i(
      gl.getUniformLocation(program, 'u_highQuality'),
      settings.highQualityFiltering !== false ? 1 : 0,
    );
    this._drawFullscreen(
      program,
      highLevel.up,
      highLevel.width,
      highLevel.height,
    );

    return highLevel.up.texture;
  }

  _renderFinal(texture, settings)
  {
    const gl = this.gl;
    const program = this.programs.final;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    this._bindTexture(program, 'u_bloom', texture, 0);
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_intensity'),
      settings.intensity,
    );
    gl.bindVertexArray(this.fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(settings)
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

    try
    {
      if (this.vertexCount === 0)
      {
        this.clear();
        return true;
      }

      this._renderEmission();
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
          bloomTexture,
          settings,
        );
      }

      this._renderFinal(bloomTexture, settings);
      this.stats.vertexCount = this.vertexCount;

      const error = gl.getError();

      if (error !== gl.NO_ERROR)
      {
        throw new Error(`WebGL2 错误码 ${error}`);
      }

      return true;
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGL2 Bloom 渲染失败，回退软件 Bloom:', error);
      this.clear();
      this._deleteTargets();
      this.available = false;
      return false;
    }
  }

  clear()
  {
    this.stats.vertexCount = 0;

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
    this.maximumTextureSize = 0;
    this.maximumViewportWidth = 0;
    this.maximumViewportHeight = 0;
  }
}
