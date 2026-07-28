const COMPONENTS_PER_VERTEX = 5;
const INITIAL_VERTEX_CAPACITY = 4096;
const MAX_PYRAMID_LEVELS = 16;
const DISK_BLOOM_RADIAL_STOPS = Object.freeze(
  [
    [0, 1],
    [0.84, 1],
    [0.88, 1],
    [0.885, 0.398631296],
    [0.89, 0.203383314],
    [0.895, 0.124567474],
    [0.9, 0.077524029],
    [0.905, 0.016747405],
    [0.91, 0.003936947],
    [0.915, 0.000384468],
    [0.92, 0],
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
uniform vec2 u_sourceTexel;
uniform float u_threshold;
uniform float u_softKnee;
uniform float u_clampMax;

in vec2 v_uv;
out vec4 outColor;

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

uniform sampler2D u_bloom;
uniform vec2 u_bloomTexel;
uniform float u_sampleScale;
uniform float u_intensity;
uniform bool u_transparentOverlay;

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
  vec2 offset = u_bloomTexel * (u_sampleScale * 0.5);
  vec3 bloom =
    texture(u_bloom, v_uv + vec2(-offset.x, -offset.y)).rgb +
    texture(u_bloom, v_uv + vec2(offset.x, -offset.y)).rgb +
    texture(u_bloom, v_uv + vec2(-offset.x, offset.y)).rgb +
    texture(u_bloom, v_uv + vec2(offset.x, offset.y)).rgb;
  vec3 linear = bloom * 0.25 * max(0.0, u_intensity);
  vec3 srgb = vec3(
    linearToSrgb(linear.r),
    linearToSrgb(linear.g),
    linearToSrgb(linear.b)
  );
  float maximumSrgb = max(max(srgb.r, srgb.g), srgb.b);

  if (maximumSrgb <= 0.00001)
  {
    outColor = vec4(0.0);
    return;
  }

  // Unity Composite 只增加 RGB；独立覆盖层用零 Alpha 避免改变清晰层 Coverage。
  float alpha = u_transparentOverlay ? 0.0 : maximumSrgb;

  outColor = vec4(srgb, alpha);
}
`;

function clamp(value, minimum, maximum)
{
  return Math.max(minimum, Math.min(maximum, value));
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
    this.diffusion = 0;
    this.sampleScale = 1;
    this.maximumTextureSize = 0;
    this.maximumViewportWidth = 0;
    this.maximumViewportHeight = 0;
    this.vertexCount = 0;
    this.vertexData = new Float32Array(
      INITIAL_VERTEX_CAPACITY * COMPONENTS_PER_VERTEX,
    );
    this.sourceTarget = null;
    this.levels = [];
    this.failedResizeSignature = null;
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
    // Context 恢复后资源能力可能变化，旧尺寸的失败结论不能继续复用。
    this.failedResizeSignature = null;
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

  _discardPendingErrors()
  {
    const gl = this.gl;

    if (!gl || typeof gl.getError !== 'function')
    {
      return;
    }

    // texImage2D 的 OOM 标记会延迟到后续 getError；若不排空，缩小后的
    // 成功帧会把旧错误误判为新的渲染故障。设上限以兼容异常 Context。
    for (let count = 0; count < 8; count++)
    {
      if (gl.getError() === gl.NO_ERROR)
      {
        return;
      }
    }
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
      console.warn('[BAClickFX] WebGL2 Bloom 缓冲创建失败:', error);
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
      // 同一渲染帧可能从后端解析和绘制路径各探测一次，失败尺寸只尝试一次。
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
      console.warn('[BAClickFX] WebGL2 Bloom 尺寸超过设备上限，回退软件 Bloom');
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

  addTriangle(
    x,
    y,
    size,
    rotation,
    color,
    opacity = 1,
    textureFrame = null,
  )
  {
    const red = color[0] * opacity;
    const green = color[1] * opacity;
    const blue = color[2] * opacity;

    if (size <= 0 || Math.max(red, green, blue) <= 0)
    {
      return;
    }

    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);
    const rotatePoint = (localX, localY) =>
    ({
      x: x + localX * cosine - localY * sine,
      y: y + localX * sine + localY * cosine,
    });
    const vertices = Array.isArray(textureFrame) && textureFrame.length === 3
      ? textureFrame
      : [
        [0, -0.58],
        [0.52, 0.45],
        [-0.52, 0.45],
      ];
    const first = rotatePoint(vertices[0][0] * size, vertices[0][1] * size);
    const second = rotatePoint(vertices[1][0] * size, vertices[1][1] * size);
    const third = rotatePoint(vertices[2][0] * size, vertices[2][1] * size);

    this._ensureVertexCapacity(3);
    this._appendVertex(first.x, first.y, red, green, blue);
    this._appendVertex(second.x, second.y, red, green, blue);
    this._appendVertex(third.x, third.y, red, green, blue);
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

  addTrailSegment(
    from,
    to,
    width,
    color,
    opacity = 1,
    transverseProfile = null,
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
    const normalX = -deltaY / length * width;
    const normalY = deltaX / length * width;

    this._ensureVertexCapacity((profile.length - 1) * 6);

    for (let index = 1; index < profile.length; index++)
    {
      const previous = profile[index - 1];
      const current = profile[index];
      const previousOffset = 0.5 - previous[0];
      const currentOffset = 0.5 - current[0];
      const previousFromX = from.x + normalX * previousOffset;
      const previousFromY = from.y + normalY * previousOffset;
      const previousToX = to.x + normalX * previousOffset;
      const previousToY = to.y + normalY * previousOffset;
      const currentFromX = from.x + normalX * currentOffset;
      const currentFromY = from.y + normalY * currentOffset;
      const currentToX = to.x + normalX * currentOffset;
      const currentToY = to.y + normalY * currentOffset;
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
      );
      this._appendVertex(
        previousToX,
        previousToY,
        previousRed,
        previousGreen,
        previousBlue,
      );
      this._appendVertex(
        currentToX,
        currentToY,
        currentRed,
        currentGreen,
        currentBlue,
      );
      this._appendVertex(
        previousFromX,
        previousFromY,
        previousRed,
        previousGreen,
        previousBlue,
      );
      this._appendVertex(
        currentToX,
        currentToY,
        currentRed,
        currentGreen,
        currentBlue,
      );
      this._appendVertex(
        currentFromX,
        currentFromY,
        currentRed,
        currentGreen,
        currentBlue,
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
      settings.softKnee,
    );
    gl.uniform1f(
      gl.getUniformLocation(program, 'u_clampMax'),
      settings.clamp ?? 65472,
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
      Math.pow(2, Math.max(0, settings.intensity) / 10) - 1,
    );
    gl.uniform1i(
      gl.getUniformLocation(program, 'u_transparentOverlay'),
      settings.outputCompositing === 'transparent-overlay' ? 1 : 0,
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
          this.levels[level + 1],
          bloomTexture,
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
    this.failedResizeSignature = null;
  }
}
