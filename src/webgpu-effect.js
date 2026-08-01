import {
  TRIANGLE_TEXTURE_OVERLAY_RGBA,
  TRIANGLE_TEXTURE_RGBA,
  TRIANGLE_TEXTURE_SIZE,
} from './triangle-texture.js';
import {
  CIRCLE_TEXTURE_RGBA,
  CIRCLE_TEXTURE_SIZE,
} from './circle-texture.js';
import {
  RING3_ALPHA,
  RING3_ALPHA_HEIGHT,
  RING3_ALPHA_WIDTH,
} from './ring3-alpha.js';
import {
  TRAIL_TEXTURE_HEIGHT,
  TRAIL_TEXTURE_RGBA,
  TRAIL_TEXTURE_WIDTH,
} from './trail-texture.js';
import {
  gammaToLinear,
  resolveUnityBloomClamp,
  resolveUnityBloomIntensity,
} from './bloom-color-space.js';
import { isIndependentHostCompositing } from './config.js';
import {
  WebGL2EffectRenderer,
  calculatePyramidSettings,
} from './webgl2-effect.js';
import { WebGPUCanvasDevice } from './webgpu-device.js';
import {
  WEBGPU_FULLSCREEN_SHADER,
  WEBGPU_GEOMETRY_SHADER,
} from './webgpu-shaders.js';

const FLOAT_SIZE = Float32Array.BYTES_PER_ELEMENT;
const COMPONENTS_PER_VERTEX = 6;
const COMPONENTS_PER_DISK_VERTEX = 8;
const COMPONENTS_PER_RING_VERTEX = 9;
const COMPONENTS_PER_TEXTURED_VERTEX = 9;
const PASS_UNIFORM_SIZE = 80;
const GEOMETRY_UNIFORM_SIZE = 32;
const HDR_FORMAT = 'rgba16float';
const TEXTURE_USAGE = globalThis.GPUTextureUsage ??
{
  COPY_DST: 2,
  TEXTURE_BINDING: 4,
  RENDER_ATTACHMENT: 16,
};
const BUFFER_USAGE = globalThis.GPUBufferUsage ??
{
  COPY_DST: 8,
  VERTEX: 32,
  UNIFORM: 64,
};

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

  try
  {
    const width = source.naturalWidth ??
      source.videoWidth ??
      source.displayWidth ??
      source.width;
    const height = source.naturalHeight ??
      source.videoHeight ??
      source.displayHeight ??
      source.height;

    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    )
    {
      return { width, height };
    }
  }
  catch
  {
    // 已关闭的 VideoFrame 等外部源不能进入延迟上传状态。
  }

  return null;
}

function nextBufferSize(required)
{
  let size = 256;

  while (size < required)
  {
    size *= 2;
  }

  return size;
}

function destroyTexture(target)
{
  target?.texture?.destroy?.();
}

function createTarget(device, width, height, label)
{
  const texture = device.createTexture(
    {
      label,
      size: { width, height },
      format: HDR_FORMAT,
      usage: TEXTURE_USAGE.RENDER_ATTACHMENT | TEXTURE_USAGE.TEXTURE_BINDING,
    },
  );

  return {
    width,
    height,
    texture,
    view: texture.createView(),
  };
}

function createTextureFromBytes(
  device,
  width,
  height,
  format,
  data,
  label,
)
{
  const texture = device.createTexture(
    {
      label,
      size: { width, height },
      format,
      usage: TEXTURE_USAGE.COPY_DST | TEXTURE_USAGE.TEXTURE_BINDING,
    },
  );
  const bytesPerPixel = format === 'r8unorm' ? 1 : 4;

  device.queue.writeTexture(
    { texture },
    data,
    { bytesPerRow: width * bytesPerPixel, rowsPerImage: height },
    { width, height },
  );
  return texture;
}

function createVertexLayout(stride, attributes)
{
  return {
    arrayStride: stride * FLOAT_SIZE,
    stepMode: 'vertex',
    attributes: attributes.map(([shaderLocation, offset, format]) =>
      ({ shaderLocation, offset: offset * FLOAT_SIZE, format })),
  };
}

const GENERIC_VERTEX_LAYOUT = createVertexLayout(
  COMPONENTS_PER_VERTEX,
  [
    [0, 0, 'float32x2'],
    [1, 2, 'float32x3'],
    [2, 5, 'float32'],
  ],
);
const TEXTURED_VERTEX_LAYOUT = createVertexLayout(
  COMPONENTS_PER_TEXTURED_VERTEX,
  [
    [0, 0, 'float32x2'],
    [1, 2, 'float32x2'],
    [2, 4, 'float32x3'],
    [3, 7, 'float32'],
    [4, 8, 'float32'],
  ],
);
const DISK_VERTEX_LAYOUT = createVertexLayout(
  COMPONENTS_PER_DISK_VERTEX,
  [
    [0, 0, 'float32x2'],
    [1, 2, 'float32x2'],
    [2, 4, 'float32x3'],
    [3, 7, 'float32'],
  ],
);
const RING_VERTEX_LAYOUT = createVertexLayout(
  COMPONENTS_PER_RING_VERTEX,
  [
    [0, 0, 'float32x2'],
    [1, 2, 'float32x2'],
    [2, 4, 'float32x3'],
    [3, 7, 'float32'],
    [4, 8, 'float32'],
  ],
);

const ADDITIVE_BLEND = Object.freeze(
  {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha:
    {
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    },
  },
);
const SCENE_ADDITIVE_BLEND = Object.freeze(
  {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
  },
);
const DISK_BLEND = Object.freeze(
  {
    color:
    {
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    },
    alpha:
    {
      srcFactor: 'one',
      dstFactor: 'one-minus-src-alpha',
      operation: 'add',
    },
  },
);
const RING_SCENE_BLEND = Object.freeze(
  {
    color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
  },
);

/**
 * WebGPU 只替换 GPU 提交与 HDR 输出；粒子网格继续复用已经验证的 CPU 构建器。
 * 等几何合同稳定后可将该构建器独立成更小的基类，不复制第二份粒子拓扑。
 */
export class WebGPUEffectRenderer extends WebGL2EffectRenderer
{
  constructor(canvas, options = {})
  {
    super(canvas, { initialize: false });
    this.status = 'pending';
    this.deviceManager = new WebGPUCanvasDevice(
      canvas,
      {
        gpu: options.gpu,
        onStateChange: (status) => this._handleDeviceState(status),
      },
    );
    this.onStateChange = typeof options.onStateChange === 'function'
      ? options.onStateChange
      : null;
    // SDR 路径必须能在支持 HDR 的浏览器上独立验证；宿主默认仍优先 HDR。
    this.preferHdr = options.preferHdr !== false;
    this.device = null;
    this.context = null;
    this.geometryModule = null;
    this.fullscreenModule = null;
    this.sampler = null;
    this.geometryUniform = null;
    this.bloomGeometryUniform = null;
    this.backgroundUniform = null;
    this.prefilterUniform = null;
    this.finalUniform = null;
    this.vertexBuffers = {};
    this.textures = {};
    this.pipelines = null;
    this.finalPipeline = null;
    this.finalPipelineFormat = null;
    this.sceneBackgroundTexture = null;
    this.sceneBackgroundView = null;
    this.backgroundBindGroup = null;
    this.placeholderTexture = null;
    this.placeholderView = null;
    this.ready = this.deviceManager.ready.then((ready) =>
      ready ? this._initializeWebGPU() : false);
  }

  get hdrOutput()
  {
    return this.deviceManager.hdrOutput;
  }

  _setRendererStatus(status, error = null)
  {
    if (this.status === status && this.failure === error)
    {
      return;
    }

    this.status = status;
    this.failure = error;
    this.onStateChange?.(status, this);
  }

  _handleDeviceState(status)
  {
    if (status === 'lost')
    {
      this.available = false;
      this.contextLost = true;
      this._setRendererStatus('lost', this.deviceManager.failure);
    }
    else if (status === 'unavailable')
    {
      this._setRendererStatus('unavailable', this.deviceManager.failure);
    }
  }

  _createUniformBuffer(label, size)
  {
    return this.device.createBuffer(
      {
        label,
        size,
        usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
      },
    );
  }

  _createGeometryPipeline(vertexEntry, fragmentEntry, layout, blend)
  {
    return this.device.createRenderPipeline(
      {
        layout: 'auto',
        vertex:
        {
          module: this.geometryModule,
          entryPoint: vertexEntry,
          buffers: [layout],
        },
        fragment:
        {
          module: this.geometryModule,
          entryPoint: fragmentEntry,
          targets: [{ format: HDR_FORMAT, blend }],
        },
        primitive: { topology: 'triangle-list' },
      },
    );
  }

  _createFullscreenPipeline(fragmentEntry, format = HDR_FORMAT)
  {
    return this.device.createRenderPipeline(
      {
        layout: 'auto',
        vertex:
        {
          module: this.fullscreenModule,
          entryPoint: 'vertexFullscreen',
        },
        fragment:
        {
          module: this.fullscreenModule,
          entryPoint: fragmentEntry,
          targets: [{ format }],
        },
        primitive: { topology: 'triangle-list' },
      },
    );
  }

  async _initializeWebGPU()
  {
    if (this.status === 'destroyed')
    {
      return false;
    }

    try
    {
      this.device = this.deviceManager.device;
      this.context = this.deviceManager.context;
      this.maximumTextureSize = this.device.limits?.maxTextureDimension2D ??
        8192;
      this.maximumViewportWidth = this.maximumTextureSize;
      this.maximumViewportHeight = this.maximumTextureSize;
      this.geometryModule = this.device.createShaderModule(
        { label: 'BA Click FX WebGPU geometry', code: WEBGPU_GEOMETRY_SHADER },
      );
      this.fullscreenModule = this.device.createShaderModule(
        { label: 'BA Click FX WebGPU fullscreen', code: WEBGPU_FULLSCREEN_SHADER },
      );
      const compilationInfos = await Promise.all(
        [
          this.geometryModule.getCompilationInfo?.(),
          this.fullscreenModule.getCompilationInfo?.(),
        ],
      );
      const shaderErrors = compilationInfos.flatMap((info) =>
        info?.messages?.filter((message) => message.type === 'error') ?? []);

      if (shaderErrors.length > 0)
      {
        throw new Error(shaderErrors.map((message) =>
          `${message.lineNum ?? '?'}:${message.linePos ?? '?'} ` +
            message.message).join('\n'));
      }

      this.sampler = this.device.createSampler(
        {
          magFilter: 'linear',
          minFilter: 'linear',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge',
        },
      );
      this.geometryUniform = this._createUniformBuffer(
        'BA Click FX geometry uniforms',
        GEOMETRY_UNIFORM_SIZE,
      );
      this.bloomGeometryUniform = this._createUniformBuffer(
        'BA Click FX scaled bloom geometry uniforms',
        GEOMETRY_UNIFORM_SIZE,
      );
      this.backgroundUniform = this._createUniformBuffer(
        'BA Click FX background uniforms',
        PASS_UNIFORM_SIZE,
      );
      this.prefilterUniform = this._createUniformBuffer(
        'BA Click FX prefilter uniforms',
        PASS_UNIFORM_SIZE,
      );
      this.finalUniform = this._createUniformBuffer(
        'BA Click FX final uniforms',
        PASS_UNIFORM_SIZE,
      );
      this._createMaterialTextures();
      this.device.pushErrorScope?.('validation');
      this._createPipelines();
      const pipelineError = await this.device.popErrorScope?.();

      if (pipelineError)
      {
        throw pipelineError;
      }

      this.available = true;
      this.contextLost = false;
      this._setRendererStatus('ready');

      if (this.sceneBackgroundSource !== null)
      {
        this._uploadSceneBackground();
      }

      return true;
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGPU 资源初始化失败:', error);
      this.available = false;
      this._setRendererStatus('unavailable', error);
      return false;
    }
  }

  _createMaterialTextures()
  {
    this.textures.ring = createTextureFromBytes(
      this.device,
      RING3_ALPHA_WIDTH,
      RING3_ALPHA_HEIGHT,
      'r8unorm',
      RING3_ALPHA,
      'BA Click FX Ring3',
    );
    this.textures.circle = createTextureFromBytes(
      this.device,
      CIRCLE_TEXTURE_SIZE,
      CIRCLE_TEXTURE_SIZE,
      'rgba8unorm-srgb',
      CIRCLE_TEXTURE_RGBA,
      'BA Click FX Circle_01',
    );
    this.textures.triangle = createTextureFromBytes(
      this.device,
      TRIANGLE_TEXTURE_SIZE,
      TRIANGLE_TEXTURE_SIZE,
      'rgba8unorm-srgb',
      TRIANGLE_TEXTURE_RGBA,
      'BA Click FX triangle',
    );
    this.textures.triangleOverlay = createTextureFromBytes(
      this.device,
      TRIANGLE_TEXTURE_SIZE,
      TRIANGLE_TEXTURE_SIZE,
      'rgba8unorm-srgb',
      TRIANGLE_TEXTURE_OVERLAY_RGBA,
      'BA Click FX triangle overlay',
    );
    this.textures.trail = createTextureFromBytes(
      this.device,
      TRAIL_TEXTURE_WIDTH,
      TRAIL_TEXTURE_HEIGHT,
      'rgba8unorm-srgb',
      TRAIL_TEXTURE_RGBA,
      'BA Click FX Trail_03',
    );
    this.placeholderTexture = createTextureFromBytes(
      this.device,
      1,
      1,
      'rgba8unorm',
      new Uint8Array(4),
      'BA Click FX empty texture',
    );
    this.placeholderView = this.placeholderTexture.createView();
  }

  _createPipelines()
  {
    this.pipelines =
    {
      genericOverlay: this._createGeometryPipeline(
        'vertexGeneric',
        'fragmentGeneric',
        GENERIC_VERTEX_LAYOUT,
        ADDITIVE_BLEND,
      ),
      genericScene: this._createGeometryPipeline(
        'vertexGeneric',
        'fragmentGeneric',
        GENERIC_VERTEX_LAYOUT,
        SCENE_ADDITIVE_BLEND,
      ),
      triangleOverlay: this._createGeometryPipeline(
        'vertexTextured',
        'fragmentTriangle',
        TEXTURED_VERTEX_LAYOUT,
        ADDITIVE_BLEND,
      ),
      triangleScene: this._createGeometryPipeline(
        'vertexTextured',
        'fragmentTriangle',
        TEXTURED_VERTEX_LAYOUT,
        SCENE_ADDITIVE_BLEND,
      ),
      trailOverlay: this._createGeometryPipeline(
        'vertexTextured',
        'fragmentTrail',
        TEXTURED_VERTEX_LAYOUT,
        ADDITIVE_BLEND,
      ),
      trailScene: this._createGeometryPipeline(
        'vertexTextured',
        'fragmentTrail',
        TEXTURED_VERTEX_LAYOUT,
        SCENE_ADDITIVE_BLEND,
      ),
      disk: this._createGeometryPipeline(
        'vertexDisk',
        'fragmentDisk',
        DISK_VERTEX_LAYOUT,
        DISK_BLEND,
      ),
      ringOverlay: this._createGeometryPipeline(
        'vertexRing',
        'fragmentRing',
        RING_VERTEX_LAYOUT,
        ADDITIVE_BLEND,
      ),
      ringScene: this._createGeometryPipeline(
        'vertexRing',
        'fragmentRing',
        RING_VERTEX_LAYOUT,
        RING_SCENE_BLEND,
      ),
      background: this._createFullscreenPipeline('fragmentBackground'),
      sceneOverlay: this._createFullscreenPipeline('fragmentSceneOverlay'),
      prefilter: this._createFullscreenPipeline('fragmentPrefilter'),
      downsample: this._createFullscreenPipeline('fragmentDownsample'),
      upsample: this._createFullscreenPipeline('fragmentUpsample'),
    };
  }

  _createPassUniform(values = {})
  {
    const data = new ArrayBuffer(PASS_UNIFORM_SIZE);
    const floats = new Float32Array(data);
    const integers = new Uint32Array(data);

    floats[0] = values.texelX ?? 1;
    floats[1] = values.texelY ?? 1;
    floats[2] = values.backgroundScaleX ?? 1;
    floats[3] = values.backgroundScaleY ?? 1;
    floats[4] = values.sampleScale ?? 1;
    floats[5] = values.threshold ?? 0;
    floats[6] = values.softKnee ?? 0;
    floats[7] = values.clampMax ?? 65504;
    floats[8] = values.intensity ?? 0;
    floats[9] = values.overlayAlphaLimit ?? 1;
    floats[10] = values.opacity ?? 1;
    integers[11] = values.hasScene ? 1 : 0;
    integers[12] = values.hasBackground ? 1 : 0;
    integers[13] = values.transparentOverlay ? 1 : 0;
    integers[14] = values.visualMaxAlpha ? 1 : 0;
    integers[15] = values.brightUnknownBackground ? 1 : 0;
    integers[16] = values.hostAdditive ? 1 : 0;
    integers[17] = values.extendedOutput ? 1 : 0;
    return data;
  }

  _getBackgroundUvScale()
  {
    if (this.sceneBackgroundWidth <= 0 || this.sceneBackgroundHeight <= 0)
    {
      return [1, 1];
    }

    const sourceAspect = this.sceneBackgroundWidth /
      this.sceneBackgroundHeight;
    const displayAspect = this.displayWidth / this.displayHeight;

    return sourceAspect > displayAspect
      ? [displayAspect / sourceAspect, 1]
      : [1, sourceAspect / displayAspect];
  }

  _writeGeometryUniform(uniform, transparentOverlay, scales = {})
  {
    const data = new ArrayBuffer(GEOMETRY_UNIFORM_SIZE);
    const floats = new Float32Array(data);
    const integers = new Uint32Array(data);

    floats[0] = this.displayWidth;
    floats[1] = this.displayHeight;
    floats[2] = Math.max(0, scales.disk ?? 1);
    floats[3] = Math.max(0, scales.ring ?? 1);
    integers[4] = transparentOverlay ? 1 : 0;
    this.device.queue.writeBuffer(uniform, 0, data);
  }

  _ensureVertexBuffer(name, data, vertexCount, components)
  {
    if (vertexCount <= 0)
    {
      return null;
    }

    const byteLength = vertexCount * components * FLOAT_SIZE;
    let entry = this.vertexBuffers[name];

    if (!entry || entry.size < byteLength)
    {
      entry?.buffer?.destroy?.();
      const size = nextBufferSize(byteLength);

      entry =
      {
        size,
        buffer: this.device.createBuffer(
          {
            label: `BA Click FX ${name} vertices`,
            size,
            usage: BUFFER_USAGE.VERTEX | BUFFER_USAGE.COPY_DST,
          },
        ),
      };
      this.vertexBuffers[name] = entry;
    }

    this.device.queue.writeBuffer(
      entry.buffer,
      0,
      data.buffer,
      data.byteOffset,
      byteLength,
    );
    return entry.buffer;
  }

  _createGeometryBindGroup(pipeline, uniform, texture = null)
  {
    const entries =
    [
      { binding: 0, resource: { buffer: uniform } },
    ];

    if (texture)
    {
      entries.push(
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: this.sampler },
      );
    }

    return this.device.createBindGroup(
      {
        layout: pipeline.getBindGroupLayout(0),
        entries,
      },
    );
  }

  _drawBatch(
    pass,
    pipeline,
    uniform,
    name,
    data,
    count,
    components,
    texture = null,
  )
  {
    const buffer = this._ensureVertexBuffer(
      name,
      data,
      count,
      components,
    );

    if (!buffer)
    {
      return;
    }

    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      this._createGeometryBindGroup(pipeline, uniform, texture),
    );
    pass.setVertexBuffer(0, buffer);
    pass.draw(count);
  }

  _drawGeometry(pass, uniform, transparentOverlay, scales = {})
  {
    this._writeGeometryUniform(uniform, transparentOverlay, scales);
    this._drawBatch(
      pass,
      this.pipelines.disk,
      uniform,
      'disk',
      this.sceneDiskVertexData,
      this.sceneDiskVertexCount,
      COMPONENTS_PER_DISK_VERTEX,
      this.textures.circle,
    );
    this._drawBatch(
      pass,
      transparentOverlay
        ? this.pipelines.trailOverlay
        : this.pipelines.trailScene,
      uniform,
      'trail',
      this.trailVertexData,
      this.trailVertexCount,
      COMPONENTS_PER_TEXTURED_VERTEX,
      this.textures.trail,
    );
    this._drawBatch(
      pass,
      transparentOverlay
        ? this.pipelines.genericOverlay
        : this.pipelines.genericScene,
      uniform,
      'generic',
      this.vertexData,
      this.vertexCount,
      COMPONENTS_PER_VERTEX,
    );
    this._drawBatch(
      pass,
      transparentOverlay
        ? this.pipelines.triangleOverlay
        : this.pipelines.triangleScene,
      uniform,
      'triangle',
      this.triangleVertexData,
      this.triangleVertexCount,
      COMPONENTS_PER_TEXTURED_VERTEX,
      transparentOverlay
        ? this.textures.triangleOverlay
        : this.textures.triangle,
    );
    this._drawBatch(
      pass,
      transparentOverlay
        ? this.pipelines.ringOverlay
        : this.pipelines.ringScene,
      uniform,
      'ring',
      this.ringVertexData,
      this.ringVertexCount,
      COMPONENTS_PER_RING_VERTEX,
      this.textures.ring,
    );
  }

  _createFullscreenBindGroup(
    pipeline,
    uniform,
    source0,
    source1 = null,
    source2 = null,
    source3 = null,
  )
  {
    const entries = [{ binding: 1, resource: this.sampler }];
    const sources = [source0, source1, source2, source3];

    // 自动布局会剔除 WGSL 未读取的 uniform，不能提交不存在的 binding 0。
    if (uniform)
    {
      entries.unshift({ binding: 0, resource: { buffer: uniform } });
    }

    for (let index = 0; index < sources.length; index++)
    {
      if (!sources[index])
      {
        break;
      }

      entries.push({ binding: index + 2, resource: sources[index] });
    }

    return this.device.createBindGroup(
      {
        layout: pipeline.getBindGroupLayout(0),
        entries,
      },
    );
  }

  _drawFullscreen(
    encoder,
    pipeline,
    targetView,
    uniform,
    sources,
    label,
  )
  {
    const pass = encoder.beginRenderPass(
      {
        label,
        colorAttachments:
        [{
          view: targetView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      },
    );

    pass.setPipeline(pipeline);
    pass.setBindGroup(
      0,
      this._createFullscreenBindGroup(pipeline, uniform, ...sources),
    );
    pass.draw(3);
    pass.end();
  }

  _drawBackground(pass)
  {
    if (!this.sceneBackgroundView)
    {
      return false;
    }

    const [scaleX, scaleY] = this._getBackgroundUvScale();
    const uniforms = this._createPassUniform(
      { backgroundScaleX: scaleX, backgroundScaleY: scaleY },
    );

    this.device.queue.writeBuffer(this.backgroundUniform, 0, uniforms);
    pass.setPipeline(this.pipelines.background);
    pass.setBindGroup(
      0,
      this._createFullscreenBindGroup(
        this.pipelines.background,
        this.backgroundUniform,
        this.sceneBackgroundView,
      ),
    );
    pass.draw(3);
    return true;
  }

  _renderGeometryTarget(
    encoder,
    target,
    uniform,
    settings,
    scales = {},
  )
  {
    const pass = encoder.beginRenderPass(
      {
        label: 'BA Click FX WebGPU scene',
        colorAttachments:
        [{
          view: target.view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
        }],
      },
    );
    const hasBackground = this._drawBackground(pass);

    this._drawGeometry(
      pass,
      uniform,
      settings.outputCompositing === 'browser-overlay',
      scales,
    );
    pass.end();
    return hasBackground;
  }

  _deleteTargets()
  {
    destroyTexture(this.sourceTarget);
    destroyTexture(this.bloomSourceTarget);
    destroyTexture(this.sceneOverlayTarget);

    for (const level of this.levels)
    {
      destroyTexture(level.down);
      destroyTexture(level.up);
      level.downUniform?.destroy?.();
      level.upUniform?.destroy?.();
    }

    this.sourceTarget = null;
    this.bloomSourceTarget = null;
    this.sceneOverlayTarget = null;
    this.levels = [];
  }

  _allocateTargets()
  {
    try
    {
      this._deleteTargets();
      this.sourceTarget = createTarget(
        this.device,
        this.sourceWidth,
        this.sourceHeight,
        'BA Click FX WebGPU scene target',
      );
      this.sceneOverlayTarget = createTarget(
        this.device,
        this.sourceWidth,
        this.sourceHeight,
        'BA Click FX WebGPU scene overlay',
      );
      let width = this.width;
      let height = this.height;
      const pyramid = calculatePyramidSettings(
        this.sourceWidth,
        this.sourceHeight,
        this.resolutionScale,
        this.diffusion,
      );

      this.sampleScale = pyramid.sampleScale;

      for (let index = 0; index < pyramid.levelCount; index++)
      {
        const level =
        {
          width,
          height,
          down: createTarget(
            this.device,
            width,
            height,
            `BA Click FX WebGPU bloom down ${index}`,
          ),
          up: index === pyramid.levelCount - 1
            ? null
            : createTarget(
                this.device,
                width,
                height,
                `BA Click FX WebGPU bloom up ${index}`,
              ),
          downUniform: this._createUniformBuffer(
            `BA Click FX WebGPU down uniforms ${index}`,
            PASS_UNIFORM_SIZE,
          ),
          upUniform: this._createUniformBuffer(
            `BA Click FX WebGPU up uniforms ${index}`,
            PASS_UNIFORM_SIZE,
          ),
        };

        this.levels.push(level);

        if (width === 1 && height === 1)
        {
          break;
        }

        width = Math.max(1, width >> 1);
        height = Math.max(1, height >> 1);
      }

      this.stats.levelCount = this.levels.length;
      this.stats.bloomPixels = this.levels.reduce(
        (sum, level) => sum + level.width * level.height,
        0,
      );
      return this.levels.length > 0;
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGPU Scene 缓冲创建失败:', error);
      this._deleteTargets();
      return false;
    }
  }

  _ensureFinalPipeline()
  {
    const format = this.deviceManager.canvasFormat;

    if (this.finalPipeline && this.finalPipelineFormat === format)
    {
      return true;
    }

    this.finalPipeline = this._createFullscreenPipeline(
      'fragmentFinal',
      format,
    );
    this.finalPipelineFormat = format;
    return true;
  }

  resize(displayWidth, displayHeight, dpr, resolutionScale, diffusion)
  {
    if (!this.available || this.contextLost)
    {
      return false;
    }

    const safeDisplayWidth = Math.max(1, displayWidth);
    const safeDisplayHeight = Math.max(1, displayHeight);
    const safeDpr = clamp(dpr, 1, 4);
    const safeScale = clamp(resolutionScale, 0.1, 0.75);
    const sourceWidth = Math.max(1, Math.round(safeDisplayWidth * safeDpr));
    const sourceHeight = Math.max(1, Math.round(safeDisplayHeight * safeDpr));
    const width = Math.max(1, Math.floor(sourceWidth * safeScale));
    const height = Math.max(1, Math.floor(sourceHeight * safeScale));
    const safeDiffusion = clamp(diffusion, 0, 10);

    if (
      sourceWidth > this.maximumTextureSize ||
      sourceHeight > this.maximumTextureSize
    )
    {
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
    this.width = width;
    this.height = height;

    if (this.canvas.width !== sourceWidth || this.canvas.height !== sourceHeight)
    {
      this.canvas.width = sourceWidth;
      this.canvas.height = sourceHeight;
    }

    if (!this.deviceManager.configure({ preferHdr: this.preferHdr }))
    {
      return false;
    }

    this._ensureFinalPipeline();
    return unchanged || this._allocateTargets();
  }

  _uploadSceneBackground()
  {
    if (
      !this.available ||
      !this.device ||
      !this.sceneBackgroundSource ||
      this.sceneBackgroundWidth <= 0 ||
      this.sceneBackgroundHeight <= 0
    )
    {
      return false;
    }

    let texture = null;

    try
    {
      texture = this.device.createTexture(
        {
          label: 'BA Click FX WebGPU compositing reference',
          size:
          {
            width: this.sceneBackgroundWidth,
            height: this.sceneBackgroundHeight,
          },
          format: 'rgba8unorm-srgb',
          // copyExternalImageToTexture 在 Dawn 中要求目标也可作为渲染附件。
          usage: TEXTURE_USAGE.COPY_DST |
            TEXTURE_USAGE.TEXTURE_BINDING |
            TEXTURE_USAGE.RENDER_ATTACHMENT,
        },
      );
      this.device.queue.copyExternalImageToTexture(
        { source: this.sceneBackgroundSource },
        { texture },
        {
          width: this.sceneBackgroundWidth,
          height: this.sceneBackgroundHeight,
        },
      );
      this.sceneBackgroundTexture?.destroy?.();
      this.sceneBackgroundTexture = texture;
      this.sceneBackgroundView = texture.createView();
      return true;
    }
    catch (error)
    {
      texture?.destroy?.();
      console.warn('[BAClickFX] WebGPU 合成参考上传失败:', error);
      return false;
    }
  }

  setCompositingReference(source, options = {})
  {
    if (source === null)
    {
      this.sceneBackgroundTexture?.destroy?.();
      this.sceneBackgroundTexture = null;
      this.sceneBackgroundView = null;
      this.sceneBackgroundSource = null;
      this.sceneBackgroundWidth = 0;
      this.sceneBackgroundHeight = 0;
      return true;
    }

    if (options.fit !== undefined && options.fit !== 'cover')
    {
      return false;
    }

    const dimensions = getTexImageSourceDimensions(source);

    if (!dimensions)
    {
      return false;
    }

    const previous =
    {
      source: this.sceneBackgroundSource,
      width: this.sceneBackgroundWidth,
      height: this.sceneBackgroundHeight,
    };

    this.sceneBackgroundSource = source;
    this.sceneBackgroundWidth = dimensions.width;
    this.sceneBackgroundHeight = dimensions.height;

    if (!this.available || this._uploadSceneBackground())
    {
      return true;
    }

    this.sceneBackgroundSource = previous.source;
    this.sceneBackgroundWidth = previous.width;
    this.sceneBackgroundHeight = previous.height;
    return false;
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

    destroyTexture(this.bloomSourceTarget);
    this.bloomSourceTarget = createTarget(
      this.device,
      this.sourceWidth,
      this.sourceHeight,
      'BA Click FX WebGPU scaled bloom source',
    );
    return true;
  }

  renderScene(settings = {})
  {
    if (!this.available || this.contextLost || !this.sourceTarget)
    {
      return false;
    }

    try
    {
      const encoder = this.device.createCommandEncoder(
        { label: 'BA Click FX WebGPU scene commands' },
      );

      this.sceneBackgroundFrameReady = this._renderGeometryTarget(
        encoder,
        this.sourceTarget,
        this.geometryUniform,
        settings,
      );
      const disk = Math.max(0, settings.diskEmissionScale ?? 1);
      const ring = Math.max(0, settings.ringEmissionScale ?? 1);

      this.bloomSourceFrameReady = false;

      if (disk !== 1 || ring !== 1)
      {
        this._ensureBloomSourceTarget();
        this._renderGeometryTarget(
          encoder,
          this.bloomSourceTarget,
          this.bloomGeometryUniform,
          settings,
          { disk, ring },
        );
        this.bloomSourceFrameReady = true;
      }
      else
      {
        destroyTexture(this.bloomSourceTarget);
        this.bloomSourceTarget = null;
      }

      this.sceneOverlayFrameReady = false;

      if (
        settings.outputCompositing === 'browser-overlay' &&
        !isIndependentHostCompositing(settings.hostCompositing)
      )
      {
        this._drawFullscreen(
          encoder,
          this.pipelines.sceneOverlay,
          this.sceneOverlayTarget.view,
          null,
          [this.sourceTarget.view],
          'BA Click FX WebGPU scene coverage',
        );
        this.sceneOverlayFrameReady = true;
      }

      this.device.queue.submit([encoder.finish()]);
      this.sceneFrameReady = true;
      this.stats.sceneVertexCount = this.vertexCount +
        this.triangleVertexCount + this.trailVertexCount;
      this.stats.sceneDiskVertexCount = this.sceneDiskVertexCount;
      this.stats.sceneRingVertexCount = this.ringVertexCount;
      this.stats.sceneTriangleVertexCount = this.triangleVertexCount;
      this.stats.sceneTrailVertexCount = this.trailVertexCount;
      return true;
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGPU 清晰特效渲染失败:', error);
      this.available = false;
      this._setRendererStatus('unavailable', error);
      return false;
    }
  }

  _renderBloomPasses(encoder, settings)
  {
    const bloomSource = this.bloomSourceFrameReady
      ? this.bloomSourceTarget
      : this.sourceTarget;
    const first = this.levels[0];
    const prefilterData = this._createPassUniform(
      {
        texelX: 1 / this.sourceWidth,
        texelY: 1 / this.sourceHeight,
        threshold: gammaToLinear(settings.threshold),
        softKnee: clamp(settings.softKnee ?? 0, 0, 1),
        clampMax: resolveUnityBloomClamp(settings.clamp),
      },
    );

    this.device.queue.writeBuffer(this.prefilterUniform, 0, prefilterData);
    this._drawFullscreen(
      encoder,
      this.pipelines.prefilter,
      first.down.view,
      this.prefilterUniform,
      [bloomSource.view],
      'BA Click FX WebGPU bloom prefilter',
    );

    for (let index = 1; index < this.levels.length; index++)
    {
      const previous = this.levels[index - 1];
      const level = this.levels[index];
      const uniforms = this._createPassUniform(
        { texelX: 1 / previous.width, texelY: 1 / previous.height },
      );

      this.device.queue.writeBuffer(level.downUniform, 0, uniforms);
      this._drawFullscreen(
        encoder,
        this.pipelines.downsample,
        level.down.view,
        level.downUniform,
        [previous.down.view],
        `BA Click FX WebGPU bloom downsample ${index}`,
      );
    }

    let accumulated = this.levels.at(-1).down;

    for (let index = this.levels.length - 2; index >= 0; index--)
    {
      const fine = this.levels[index];
      const coarse = this.levels[index + 1];
      const uniforms = this._createPassUniform(
        {
          texelX: 1 / coarse.width,
          texelY: 1 / coarse.height,
          sampleScale: this.sampleScale,
        },
      );

      this.device.queue.writeBuffer(fine.upUniform, 0, uniforms);
      this._drawFullscreen(
        encoder,
        this.pipelines.upsample,
        fine.up.view,
        fine.upUniform,
        [accumulated.view, fine.down.view],
        `BA Click FX WebGPU bloom upsample ${index}`,
      );
      accumulated = fine.up;
    }

    return accumulated;
  }

  render(settings, options = {})
  {
    if (
      !this.available ||
      this.contextLost ||
      !this.sourceTarget ||
      this.levels.length === 0 ||
      !this.finalPipeline
    )
    {
      return false;
    }

    try
    {
      const hasScene = options.preserveCanvas === true && this.sceneFrameReady;
      const encoder = this.device.createCommandEncoder(
        { label: 'BA Click FX WebGPU bloom commands' },
      );
      const bloom = this._renderBloomPasses(encoder, settings);
      const [backgroundScaleX, backgroundScaleY] =
        this._getBackgroundUvScale();
      const hasBackground = hasScene && this.sceneBackgroundFrameReady;
      const useSceneOverlay = hasScene &&
        !hasBackground &&
        settings.outputCompositing === 'browser-overlay' &&
        !isIndependentHostCompositing(settings.hostCompositing) &&
        this.sceneOverlayFrameReady;
      const uniforms = this._createPassUniform(
        {
          texelX: 1 / bloom.width,
          texelY: 1 / bloom.height,
          backgroundScaleX,
          backgroundScaleY,
          sampleScale: this.sampleScale,
          intensity: resolveUnityBloomIntensity(settings.intensity),
          overlayAlphaLimit: clamp(settings.overlayAlphaLimit ?? 1, 0, 1),
          opacity: clamp(settings.opacity ?? 1, 0, 1),
          hasScene,
          hasBackground,
          transparentOverlay:
            settings.outputCompositing === 'browser-overlay',
          visualMaxAlpha: settings.overlayAlphaPolicy === 'visual-max',
          brightUnknownBackground:
            settings.overlayColorCompensation === 'bright-core',
          hostAdditive: isIndependentHostCompositing(
            settings.hostCompositing,
          ),
          extendedOutput: this.hdrOutput,
        },
      );

      this.device.queue.writeBuffer(this.finalUniform, 0, uniforms);
      this._drawFullscreen(
        encoder,
        this.finalPipeline,
        this.context.getCurrentTexture().createView(),
        this.finalUniform,
        [
          bloom.view,
          hasScene
            ? (
                useSceneOverlay
                  ? this.sceneOverlayTarget.view
                  : this.sourceTarget.view
              )
            : this.placeholderView,
          hasScene ? this.sourceTarget.view : this.placeholderView,
          hasBackground ? this.sceneBackgroundView : this.placeholderView,
        ],
        'BA Click FX WebGPU final',
      );
      this.device.queue.submit([encoder.finish()]);
      this.stats.vertexCount = this.vertexCount +
        this.triangleVertexCount + this.trailVertexCount;
      this.stats.diskVertexCount = this.sceneDiskVertexCount;
      this.stats.ringVertexCount = this.ringVertexCount;
      this.stats.triangleVertexCount = this.triangleVertexCount;
      this.stats.trailVertexCount = this.trailVertexCount;
      return true;
    }
    catch (error)
    {
      console.warn('[BAClickFX] WebGPU Scene 渲染失败:', error);
      this.available = false;
      this._setRendererStatus('unavailable', error);
      return false;
    }
  }

  clear()
  {
    this.sceneFrameReady = false;
    this.bloomSourceFrameReady = false;
    this.sceneOverlayFrameReady = false;
    this.sceneBackgroundFrameReady = false;

    if (!this.available || !this.finalPipeline)
    {
      return;
    }

    try
    {
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass(
        {
          colorAttachments:
          [{
            view: this.context.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          }],
        },
      );

      pass.end();
      this.device.queue.submit([encoder.finish()]);
    }
    catch
    {
      // 页面卸载或设备丢失期间的清屏失败不应阻断销毁流程。
    }
  }

  releaseFrameResources()
  {
    this.clear();
    this._deleteTargets();
    this.beginFrame();
  }

  destroy()
  {
    if (this.status === 'destroyed')
    {
      return;
    }

    this._setRendererStatus('destroyed');
    this._deleteTargets();

    for (const entry of Object.values(this.vertexBuffers))
    {
      entry.buffer?.destroy?.();
    }

    for (const texture of Object.values(this.textures))
    {
      texture?.destroy?.();
    }

    this.placeholderTexture?.destroy?.();
    this.sceneBackgroundTexture?.destroy?.();
    this.geometryUniform?.destroy?.();
    this.bloomGeometryUniform?.destroy?.();
    this.backgroundUniform?.destroy?.();
    this.prefilterUniform?.destroy?.();
    this.finalUniform?.destroy?.();
    this.deviceManager.destroy();
    this.available = false;
    this.contextLost = false;
    this.vertexCount = 0;
    this.sceneDiskVertexCount = 0;
    this.ringVertexCount = 0;
    this.triangleVertexCount = 0;
    this.trailVertexCount = 0;
  }
}
