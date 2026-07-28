import {
  CIRCLE_TEXTURE_RGBA,
  CIRCLE_TEXTURE_SIZE,
} from './circle-texture.js';

const COVERAGE_VERTEX_COMPONENTS = 5;
const INITIAL_COVERAGE_VERTEX_CAPACITY = 48;

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

const COVERAGE_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in float a_particleAlpha;

uniform vec2 u_displaySize;

out vec2 v_uv;
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
  v_particleAlpha = a_particleAlpha;
}
`;

const COVERAGE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_circle;

in vec2 v_uv;
in float v_particleAlpha;
out vec4 outColor;

void main()
{
  // Circle_01 以 sRGB 导入；SRGB8_ALPHA8 在采样时恢复 Shader 读取的线性 R。
  float coverage = texture(u_circle, v_uv).r *
    clamp(v_particleAlpha, 0.0, 1.0);

  outColor = vec4(coverage, 0.0, 0.0, coverage);
}
`;

const FINAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_effect;
uniform sampler2D u_coverage;
uniform sampler2D u_background;
uniform vec2 u_backgroundUvScale;

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
  // DOM Canvas 上传保持顶行原点，所有浏览器统一在 Shader 中翻转。
  vec2 canvasUv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec3 effectLinear = texture(u_effect, canvasUv).rgb;
  float coverage = clamp(texture(u_coverage, v_uv).r, 0.0, 1.0);
  vec2 backgroundUv = (v_uv - 0.5) * u_backgroundUvScale + 0.5;

  backgroundUv.y = 1.0 - backgroundUv.y;

  vec3 backgroundLinear = texture(u_background, backgroundUv).rgb;
  vec3 linear = effectLinear + backgroundLinear * (1.0 - coverage);
  vec3 targetSrgb = vec3(
    linearToSrgb(linear.r),
    linearToSrgb(linear.g),
    linearToSrgb(linear.b)
  );
  vec3 backgroundSrgb = vec3(
    linearToSrgb(backgroundLinear.r),
    linearToSrgb(backgroundLinear.g),
    linearToSrgb(backgroundLinear.b)
  );
  vec3 difference = abs(targetSrgb - backgroundSrgb);

  if (max(max(difference.r, difference.g), difference.b) <= 0.00001)
  {
    outColor = vec4(0.0);
    return;
  }

  vec3 channelAlpha = vec3(
    solveOverlayAlpha(backgroundSrgb.r, targetSrgb.r),
    solveOverlayAlpha(backgroundSrgb.g, targetSrgb.g),
    solveOverlayAlpha(backgroundSrgb.b, targetSrgb.b)
  );
  float overlayAlpha = clamp(
    max(max(channelAlpha.r, channelAlpha.g), channelAlpha.b),
    0.0,
    1.0
  );
  vec3 premultiplied = targetSrgb -
    backgroundSrgb * (1.0 - overlayAlpha);

  outColor = vec4(
    clamp(premultiplied, vec3(0.0), vec3(overlayAlpha)),
    overlayAlpha
  );
}
`;

function clamp(value, minimum, maximum)
{
  return Math.max(minimum, Math.min(maximum, value));
}

function getRasterSourceDimensions(source)
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

  return { width, height };
}

function compileShader(gl, type, source)
{
  const shader = gl.createShader(type);

  if (!shader)
  {
    throw new Error('Canvas Scene Final Pass 无法创建 Shader');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
  {
    const message = gl.getShaderInfoLog(shader) || '未知编译错误';

    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

function createProgram(gl, vertexSource, fragmentSource)
{
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();

  if (!program)
  {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error('Canvas Scene Final Pass 无法创建 Program');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
  {
    const message = gl.getProgramInfoLog(program) || '未知链接错误';

    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

function configureTexture(gl, texture, filter)
{
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

export class WebGL2CanvasSceneRenderer
{
  constructor(canvas)
  {
    this.canvas = canvas;
    this.gl = null;
    this.available = false;
    this.contextLost = false;
    this.destroyed = false;
    this.displayWidth = 1;
    this.displayHeight = 1;
    this.dpr = 1;
    this.width = 0;
    this.height = 0;
    this.maximumTextureSize = 0;
    this.maximumViewportWidth = 0;
    this.maximumViewportHeight = 0;
    this.failedResizeSignature = null;
    this.finalProgram = null;
    this.coverageProgram = null;
    this.fullscreenVao = null;
    this.coverageVao = null;
    this.coverageBuffer = null;
    this.effectTexture = null;
    this.coverageTexture = null;
    this.coverageFramebuffer = null;
    this.circleTexture = null;
    this.backgroundTexture = null;
    this.backgroundSource = null;
    this.backgroundWidth = 0;
    this.backgroundHeight = 0;
    this.backgroundUploadRetryPending = false;
    this.coverageVertexCount = 0;
    this.coverageVertexData = new Float32Array(
      INITIAL_COVERAGE_VERTEX_CAPACITY * COVERAGE_VERTEX_COMPONENTS,
    );
    this._onContextLost = this._handleContextLost.bind(this);
    this._onContextRestored = this._handleContextRestored.bind(this);

    this.canvas?.addEventListener?.('webglcontextlost', this._onContextLost);
    this.canvas?.addEventListener?.(
      'webglcontextrestored',
      this._onContextRestored,
    );
    this._initialize();
  }

  get hasSceneBackground()
  {
    return this.backgroundTexture !== null;
  }

  _discardPendingErrors()
  {
    const gl = this.gl;

    if (!gl)
    {
      return;
    }

    for (let count = 0; count < 8; count++)
    {
      if (gl.getError() === gl.NO_ERROR)
      {
        return;
      }
    }
  }

  _initialize()
  {
    if (this.destroyed)
    {
      return;
    }

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

      if (!gl)
      {
        this.available = false;
        return;
      }

      this.gl = gl;
      // 新 Context 的资源状态与丢失前无关，旧尺寸失败签名必须作废。
      this.failedResizeSignature = null;
      this.maximumTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const maximumViewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS);

      this.maximumViewportWidth = maximumViewport?.[0] ??
        this.maximumTextureSize;
      this.maximumViewportHeight = maximumViewport?.[1] ??
        this.maximumTextureSize;
      this.finalProgram = createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        FINAL_FRAGMENT_SHADER,
      );
      this.coverageProgram = createProgram(
        gl,
        COVERAGE_VERTEX_SHADER,
        COVERAGE_FRAGMENT_SHADER,
      );
      this.fullscreenVao = gl.createVertexArray();
      this.coverageVao = gl.createVertexArray();
      this.coverageBuffer = gl.createBuffer();
      this.circleTexture = gl.createTexture();

      if (
        !this.fullscreenVao ||
        !this.coverageVao ||
        !this.coverageBuffer ||
        !this.circleTexture
      )
      {
        throw new Error('Canvas Scene Final Pass 资源分配失败');
      }

      gl.bindVertexArray(this.coverageVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.coverageBuffer);
      const stride = COVERAGE_VERTEX_COMPONENTS * Float32Array.BYTES_PER_ELEMENT;

      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
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
        1,
        gl.FLOAT,
        false,
        stride,
        4 * Float32Array.BYTES_PER_ELEMENT,
      );
      gl.bindVertexArray(null);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);

      configureTexture(gl, this.circleTexture, gl.LINEAR);
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

      const requestedWidth = this.width;
      const requestedHeight = this.height;

      this.width = 0;
      this.height = 0;

      if (requestedWidth > 0 && requestedHeight > 0)
      {
        this._allocateFrameResources(requestedWidth, requestedHeight);
      }

      if (this.backgroundSource)
      {
        this.backgroundUploadRetryPending = !this._replaceBackgroundTexture(
          this.backgroundSource,
        );
      }
    }
    catch (error)
    {
      console.warn('[BAClickFX] Canvas Scene Final Pass 初始化失败:', error);
      this.available = false;
      this._deleteResources();
    }
  }

  _deleteFrameResources()
  {
    const gl = this.gl;

    if (gl && !this.contextLost)
    {
      gl.deleteTexture(this.effectTexture);
      gl.deleteTexture(this.coverageTexture);
      gl.deleteFramebuffer(this.coverageFramebuffer);
    }

    this.effectTexture = null;
    this.coverageTexture = null;
    this.coverageFramebuffer = null;
  }

  _deleteResources()
  {
    const gl = this.gl;

    this._deleteFrameResources();

    if (gl && !this.contextLost)
    {
      gl.deleteProgram(this.finalProgram);
      gl.deleteProgram(this.coverageProgram);
      gl.deleteVertexArray(this.fullscreenVao);
      gl.deleteVertexArray(this.coverageVao);
      gl.deleteBuffer(this.coverageBuffer);
      gl.deleteTexture(this.circleTexture);
      gl.deleteTexture(this.backgroundTexture);
    }

    this.finalProgram = null;
    this.coverageProgram = null;
    this.fullscreenVao = null;
    this.coverageVao = null;
    this.coverageBuffer = null;
    this.circleTexture = null;
    this.backgroundTexture = null;
  }

  _createFrameResources(width, height)
  {
    const gl = this.gl;
    const effectTexture = gl.createTexture();
    const coverageTexture = gl.createTexture();
    const coverageFramebuffer = gl.createFramebuffer();

    if (!effectTexture || !coverageTexture || !coverageFramebuffer)
    {
      gl.deleteTexture(effectTexture);
      gl.deleteTexture(coverageTexture);
      gl.deleteFramebuffer(coverageFramebuffer);
      return null;
    }

    try
    {
      this._discardPendingErrors();
      configureTexture(gl, effectTexture, gl.NEAREST);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
      configureTexture(gl, coverageTexture, gl.NEAREST);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        width,
        height,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        null,
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, coverageFramebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        coverageTexture,
        0,
      );

      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      const error = gl.getError();

      if (status !== gl.FRAMEBUFFER_COMPLETE || error !== gl.NO_ERROR)
      {
        throw new Error(`Coverage FBO 状态 ${status}，错误码 ${error}`);
      }

      return { effectTexture, coverageTexture, coverageFramebuffer };
    }
    catch (error)
    {
      console.warn('[BAClickFX] Canvas Scene 帧资源分配失败:', error);
      gl.deleteTexture(effectTexture);
      gl.deleteTexture(coverageTexture);
      gl.deleteFramebuffer(coverageFramebuffer);
      return null;
    }
    finally
    {
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  _allocateFrameResources(width, height)
  {
    const resources = this._createFrameResources(width, height);

    if (!resources)
    {
      return false;
    }

    this._deleteFrameResources();
    this.effectTexture = resources.effectTexture;
    this.coverageTexture = resources.coverageTexture;
    this.coverageFramebuffer = resources.coverageFramebuffer;
    this.width = width;
    this.height = height;
    return true;
  }

  resize(displayWidth, displayHeight, dpr)
  {
    if (!this.available || !this.gl || this.contextLost)
    {
      return false;
    }

    const safeDisplayWidth = Math.max(1, displayWidth);
    const safeDisplayHeight = Math.max(1, displayHeight);
    const safeDpr = clamp(dpr, 1, 4);
    const width = Math.max(1, Math.round(safeDisplayWidth * safeDpr));
    const height = Math.max(1, Math.round(safeDisplayHeight * safeDpr));
    const signature = `${width}:${height}`;

    this.displayWidth = safeDisplayWidth;
    this.displayHeight = safeDisplayHeight;
    this.dpr = safeDpr;

    if (signature === this.failedResizeSignature)
    {
      return false;
    }

    if (
      width > this.maximumTextureSize ||
      height > this.maximumTextureSize ||
      width > this.maximumViewportWidth ||
      height > this.maximumViewportHeight
    )
    {
      this.failedResizeSignature = signature;
      return false;
    }

    if (this.backgroundUploadRetryPending)
    {
      // Context 恢复时只在下一次尺寸准备阶段额外重试一次，避免无效
      // VideoFrame 或 CORS 源在每个 RAF 重复上传并刷出警告。
      this.backgroundUploadRetryPending = false;

      if (!this._replaceBackgroundTexture(this.backgroundSource))
      {
        return false;
      }
    }

    if (
      width === this.width &&
      height === this.height &&
      this.effectTexture &&
      this.coverageTexture &&
      this.coverageFramebuffer
    )
    {
      this.failedResizeSignature = null;
      return true;
    }

    if (!this._allocateFrameResources(width, height))
    {
      this.failedResizeSignature = signature;
      return false;
    }

    // 只有配套纹理和 FBO 已成功创建，才能提交默认帧缓冲尺寸。
    this.canvas.width = width;
    this.canvas.height = height;
    this.failedResizeSignature = null;
    return true;
  }

  _createBackgroundTexture(source)
  {
    const gl = this.gl;
    const texture = gl?.createTexture();

    if (!gl || !texture)
    {
      return null;
    }

    const previousFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const previousPremultiply = gl.getParameter(
      gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
    );
    const previousColorConversion = gl.getParameter(
      gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
    );

    try
    {
      this._discardPendingErrors();
      configureTexture(gl, texture, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
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
        throw new Error(`背景纹理上传错误码 ${error}`);
      }

      return texture;
    }
    catch (error)
    {
      console.warn('[BAClickFX] Canvas Scene 背景上传失败:', error);
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
      gl.pixelStorei(
        gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
        previousColorConversion,
      );
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  _replaceBackgroundTexture(source)
  {
    const dimensions = getRasterSourceDimensions(source);

    if (!dimensions || !this.gl || this.contextLost)
    {
      return false;
    }

    const texture = this._createBackgroundTexture(source);

    if (!texture)
    {
      return false;
    }

    this.gl.deleteTexture(this.backgroundTexture);
    this.backgroundTexture = texture;
    this.backgroundSource = source;
    this.backgroundWidth = dimensions.width;
    this.backgroundHeight = dimensions.height;
    this.backgroundUploadRetryPending = false;
    this.failedResizeSignature = null;
    return true;
  }

  setSceneBackground(source, options = {})
  {
    if (options.fit !== undefined && options.fit !== 'cover')
    {
      return false;
    }

    if (source === null)
    {
      this.gl?.deleteTexture(this.backgroundTexture);
      this.backgroundTexture = null;
      this.backgroundSource = null;
      this.backgroundWidth = 0;
      this.backgroundHeight = 0;
      this.backgroundUploadRetryPending = false;
      this.failedResizeSignature = null;
      return true;
    }

    const dimensions = getRasterSourceDimensions(source);

    if (!dimensions)
    {
      return false;
    }

    if (this.contextLost || !this.gl)
    {
      this.backgroundSource = source;
      this.backgroundWidth = dimensions.width;
      this.backgroundHeight = dimensions.height;
      this.backgroundUploadRetryPending = true;
      return true;
    }

    return this._replaceBackgroundTexture(source);
  }

  beginFrame()
  {
    this.coverageVertexCount = 0;
  }

  _ensureCoverageVertexCapacity(additionalVertices)
  {
    const required = (
      this.coverageVertexCount + additionalVertices
    ) * COVERAGE_VERTEX_COMPONENTS;

    if (required <= this.coverageVertexData.length)
    {
      return;
    }

    let nextLength = this.coverageVertexData.length;

    while (nextLength < required)
    {
      nextLength = Math.ceil(nextLength * 1.5);
    }

    const next = new Float32Array(nextLength);

    next.set(this.coverageVertexData.subarray(
      0,
      this.coverageVertexCount * COVERAGE_VERTEX_COMPONENTS,
    ));
    this.coverageVertexData = next;
  }

  _appendCoverageVertex(x, y, u, v, alpha)
  {
    const offset = this.coverageVertexCount * COVERAGE_VERTEX_COMPONENTS;

    this.coverageVertexData[offset] = x;
    this.coverageVertexData[offset + 1] = y;
    this.coverageVertexData[offset + 2] = u;
    this.coverageVertexData[offset + 3] = v;
    this.coverageVertexData[offset + 4] = clamp(alpha, 0, 1);
    this.coverageVertexCount++;
  }

  addCoverageDisk(x, y, radius, alpha, rotation = 0)
  {
    if (radius <= 0 || alpha <= 0)
    {
      return;
    }

    const angle = Number.isFinite(rotation) ? rotation : 0;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const appendCorner = (localX, localY, u, v) =>
    {
      this._appendCoverageVertex(
        x + localX * cosine - localY * sine,
        y + localX * sine + localY * cosine,
        u,
        v,
        alpha,
      );
    };

    this._ensureCoverageVertexCapacity(6);
    appendCorner(-radius, -radius, 0, 0);
    appendCorner(radius, -radius, 1, 0);
    appendCorner(radius, radius, 1, 1);
    appendCorner(-radius, -radius, 0, 0);
    appendCorner(radius, radius, 1, 1);
    appendCorner(-radius, radius, 0, 1);
  }

  _uploadEffectCanvas(effectCanvas)
  {
    const gl = this.gl;
    const previousFlipY = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const previousPremultiply = gl.getParameter(
      gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
    );
    const previousColorConversion = gl.getParameter(
      gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
    );

    try
    {
      this._discardPendingErrors();
      gl.bindTexture(gl.TEXTURE_2D, this.effectTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      // 主 Canvas 的 RGB 必须作为已合成的预乘线性能量上传。
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        effectCanvas,
      );

      return gl.getError() === gl.NO_ERROR;
    }
    catch
    {
      return false;
    }
    finally
    {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, previousFlipY);
      gl.pixelStorei(
        gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
        previousPremultiply,
      );
      gl.pixelStorei(
        gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
        previousColorConversion,
      );
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  _drawCoverage()
  {
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.coverageFramebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (this.coverageVertexCount === 0)
    {
      return;
    }

    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    // 每张 Cross2 的 Coverage 以 source-over 并集写入单通道目标。
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.coverageProgram);
    gl.uniform2f(
      gl.getUniformLocation(this.coverageProgram, 'u_displaySize'),
      this.displayWidth,
      this.displayHeight,
    );
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.circleTexture);
    gl.uniform1i(
      gl.getUniformLocation(this.coverageProgram, 'u_circle'),
      0,
    );
    gl.bindVertexArray(this.coverageVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.coverageBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.coverageVertexData.subarray(
        0,
        this.coverageVertexCount * COVERAGE_VERTEX_COMPONENTS,
      ),
      gl.DYNAMIC_DRAW,
    );
    gl.drawArrays(gl.TRIANGLES, 0, this.coverageVertexCount);
  }

  _getBackgroundUvScale()
  {
    const sourceAspect = this.backgroundWidth / this.backgroundHeight;
    const displayAspect = this.displayWidth / this.displayHeight;

    if (sourceAspect > displayAspect)
    {
      return [displayAspect / sourceAspect, 1];
    }

    return [1, sourceAspect / displayAspect];
  }

  _drawFinal()
  {
    const gl = this.gl;
    const backgroundUvScale = this._getBackgroundUvScale();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.finalProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.effectTexture);
    gl.uniform1i(gl.getUniformLocation(this.finalProgram, 'u_effect'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.coverageTexture);
    gl.uniform1i(gl.getUniformLocation(this.finalProgram, 'u_coverage'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture);
    gl.uniform1i(gl.getUniformLocation(this.finalProgram, 'u_background'), 2);
    gl.uniform2f(
      gl.getUniformLocation(this.finalProgram, 'u_backgroundUvScale'),
      backgroundUvScale[0],
      backgroundUvScale[1],
    );
    gl.bindVertexArray(this.fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(effectCanvas)
  {
    if (
      !this.available ||
      this.contextLost ||
      !this.gl ||
      !this.effectTexture ||
      !this.coverageTexture ||
      !this.coverageFramebuffer ||
      !this.backgroundTexture ||
      effectCanvas?.width !== this.width ||
      effectCanvas?.height !== this.height
    )
    {
      return false;
    }

    if (!this._uploadEffectCanvas(effectCanvas))
    {
      return false;
    }

    try
    {
      this._discardPendingErrors();
      this._drawCoverage();
      this._drawFinal();
      // flush 只提交命令，不等待 GPU；避免延后到下一次主线程事件才显示。
      this.gl.flush();
      return this.gl.getError() === this.gl.NO_ERROR;
    }
    catch
    {
      return false;
    }
  }

  clear()
  {
    if (!this.gl || this.contextLost)
    {
      return;
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  _handleContextLost(event)
  {
    event?.preventDefault?.();
    this.contextLost = true;
    this.available = false;
    this.finalProgram = null;
    this.coverageProgram = null;
    this.fullscreenVao = null;
    this.coverageVao = null;
    this.coverageBuffer = null;
    this.effectTexture = null;
    this.coverageTexture = null;
    this.coverageFramebuffer = null;
    this.circleTexture = null;
    this.backgroundTexture = null;
    this.failedResizeSignature = null;
    this.backgroundUploadRetryPending = this.backgroundSource !== null;
  }

  _handleContextRestored()
  {
    this.contextLost = false;
    this._initialize();
    // 初始化中的一次瞬时分配失败不能阻止下一帧按相同尺寸重试。
    this.failedResizeSignature = null;
  }

  destroy()
  {
    if (this.destroyed)
    {
      return;
    }

    this.destroyed = true;
    this.canvas?.removeEventListener?.(
      'webglcontextlost',
      this._onContextLost,
    );
    this.canvas?.removeEventListener?.(
      'webglcontextrestored',
      this._onContextRestored,
    );
    this._deleteResources();
    this.coverageVertexData = new Float32Array(0);
    this.coverageVertexCount = 0;
    this.available = false;
    this.gl = null;
    this.backgroundSource = null;
    this.backgroundWidth = 0;
    this.backgroundHeight = 0;
    this.backgroundUploadRetryPending = false;
  }
}
