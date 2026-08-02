const MAX_HDR_UI_PRIMITIVES = 12;
const FLOATS_PER_PRIMITIVE = 12;
const HEADER_FLOATS = 4;
const HDR_UI_UNIFORM_FLOATS = HEADER_FLOATS +
  MAX_HDR_UI_PRIMITIVES * FLOATS_PER_PRIMITIVE;
const HDR_UI_UNIFORM_SIZE = HDR_UI_UNIFORM_FLOATS *
  Float32Array.BYTES_PER_ELEMENT;
const BUFFER_USAGE = globalThis.GPUBufferUsage ??
{
  COPY_DST: 8,
  UNIFORM: 64,
};

export const WEBGPU_HDR_UI_SHADER = /* wgsl */ `
const MAX_PRIMITIVES: u32 = ${MAX_HDR_UI_PRIMITIVES}u;

struct HdrUiUniforms
{
  viewport: vec4f,
  primitives: array<vec4f, ${MAX_HDR_UI_PRIMITIVES * 3}>,
}

@group(0) @binding(0) var<uniform> params: HdrUiUniforms;

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

fn roundedRectDistance(point: vec2f, halfSize: vec2f, radius: f32) -> f32
{
  let corner = abs(point) - halfSize + vec2f(radius);
  return min(max(corner.x, corner.y), 0.0) +
    length(max(corner, vec2f(0.0))) - radius;
}

fn linearToExtendedSrgb(value: f32) -> f32
{
  let safe = max(value, 0.0);
  return select(
    1.055 * pow(safe, 1.0 / 2.4) - 0.055,
    12.92 * safe,
    safe <= 0.0031308,
  );
}

@fragment
fn fragmentHdrUi(input: FullscreenOutput) -> @location(0) vec4f
{
  let pixel = input.uv * params.viewport.xy;
  var emission = vec3f(0.0);

  for (var index = 0u; index < MAX_PRIMITIVES; index = index + 1u)
  {
    if (f32(index) >= params.viewport.w)
    {
      break;
    }

    let base = index * 3u;
    let rect = params.primitives[base];
    let color = params.primitives[base + 1u];
    let style = params.primitives[base + 2u];

    if (rect.z <= 0.0 || rect.w <= 0.0 || style.w <= 0.0)
    {
      continue;
    }

    let halfSize = rect.zw * 0.5;
    let center = rect.xy + halfSize;
    let radius = clamp(style.x, 0.0, min(halfSize.x, halfSize.y));
    let distance = roundedRectDistance(pixel - center, halfSize, radius);
    let edgeDistance = abs(distance);
    let borderWidth = max(style.y, 0.25);
    let glowWidth = max(style.z, 0.5);
    let core = 1.0 - smoothstep(borderWidth, borderWidth + 1.0, edgeDistance);
    let halo = exp2(-edgeDistance * 4.0 / glowWidth);
    let energy = max(core, halo * 0.32) * style.w * params.viewport.z;

    emission = emission + max(color.rgb, vec3f(0.0)) * energy;
  }

  let encoded = vec3f(
    linearToExtendedSrgb(emission.r),
    linearToExtendedSrgb(emission.g),
    linearToExtendedSrgb(emission.b),
  );
  let alpha = clamp(max(max(encoded.r, encoded.g), encoded.b), 0.0, 1.0);

  if (alpha <= 0.00001)
  {
    return vec4f(0.0);
  }

  // plus-lighter 在 DOM 合成边界执行最终加色；Alpha 只承载扩展 RGB。
  return vec4f(encoded, alpha);
}
`;

function clamp(value, minimum, maximum)
{
  return Math.max(minimum, Math.min(maximum, value));
}

function finiteOr(value, fallback = 0)
{
  return Number.isFinite(value) ? value : fallback;
}

function normalizePrimitive(primitive)
{
  const rect = primitive?.rect;
  const color = primitive?.color;
  const width = finiteOr(rect?.width);
  const height = finiteOr(rect?.height);

  if (width <= 0 || height <= 0)
  {
    return null;
  }

  return {
    rect:
    [
      finiteOr(rect?.x),
      finiteOr(rect?.y),
      width,
      height,
    ],
    color:
    [
      clamp(finiteOr(color?.[0]), 0, 32),
      clamp(finiteOr(color?.[1]), 0, 32),
      clamp(finiteOr(color?.[2]), 0, 32),
      0,
    ],
    style:
    [
      clamp(finiteOr(primitive?.radius), 0, Math.min(width, height) * 0.5),
      clamp(finiteOr(primitive?.borderWidth, 1), 0.25, 32),
      clamp(finiteOr(primitive?.glowWidth, 8), 0.5, 128),
      clamp(finiteOr(primitive?.intensity, 1), 0, 32),
    ],
  };
}

export function packHdrUiUniforms(options = {})
{
  const width = Math.max(1, finiteOr(options.width, 1));
  const height = Math.max(1, finiteOr(options.height, 1));
  const brightness = clamp(finiteOr(options.brightness, 1), 0, 32);
  const primitives = [];

  for (const candidate of options.primitives ?? [])
  {
    const primitive = normalizePrimitive(candidate);

    if (primitive)
    {
      primitives.push(primitive);
    }

    if (primitives.length >= MAX_HDR_UI_PRIMITIVES)
    {
      break;
    }
  }

  const data = new Float32Array(HDR_UI_UNIFORM_FLOATS);

  data[0] = width;
  data[1] = height;
  data[2] = brightness;
  data[3] = primitives.length;

  for (let index = 0; index < primitives.length; index++)
  {
    const primitive = primitives[index];
    const offset = HEADER_FLOATS + index * FLOATS_PER_PRIMITIVE;

    data.set(primitive.rect, offset);
    data.set(primitive.color, offset + 4);
    data.set(primitive.style, offset + 8);
  }

  return data;
}

export class WebGPUHdrUiRenderer
{
  constructor(canvas)
  {
    this.canvas = canvas;
    this.context = canvas?.getContext?.('webgpu') ?? null;
    this.device = null;
    this.pipeline = null;
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.configured = false;

    if (this.canvas)
    {
      this.canvas.style.display = 'none';
      this.canvas.dataset.hdrUiOutput = 'inactive';
    }
  }

  get available()
  {
    return this.context !== null;
  }

  _releaseDeviceResources()
  {
    this.uniformBuffer?.destroy?.();
    this.uniformBuffer = null;
    this.bindGroup = null;
    this.pipeline = null;
    this.device = null;
  }

  _createDeviceResources(device)
  {
    const module = device.createShaderModule(
      { label: 'BA Click FX demo HDR UI', code: WEBGPU_HDR_UI_SHADER },
    );

    this.pipeline = device.createRenderPipeline(
      {
        label: 'BA Click FX demo HDR UI',
        layout: 'auto',
        vertex: { module, entryPoint: 'vertexFullscreen' },
        fragment:
        {
          module,
          entryPoint: 'fragmentHdrUi',
          targets: [{ format: 'rgba16float' }],
        },
        primitive: { topology: 'triangle-list' },
      },
    );
    this.uniformBuffer = device.createBuffer(
      {
        label: 'BA Click FX demo HDR UI uniforms',
        size: HDR_UI_UNIFORM_SIZE,
        usage: BUFFER_USAGE.UNIFORM | BUFFER_USAGE.COPY_DST,
      },
    );
    this.bindGroup = device.createBindGroup(
      {
        label: 'BA Click FX demo HDR UI uniforms',
        layout: this.pipeline.getBindGroupLayout(0),
        entries:
        [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
      },
    );
    this.device = device;
  }

  configure(device)
  {
    if (!this.context || !device)
    {
      return false;
    }

    if (this.configured && this.device === device)
    {
      return true;
    }

    if (this.configured && !this.suspend())
    {
      return false;
    }

    if (this.device !== device)
    {
      this._releaseDeviceResources();
    }

    try
    {
      if (!this.pipeline)
      {
        this._createDeviceResources(device);
      }

      this.context.configure(
        {
          device,
          format: 'rgba16float',
          alphaMode: 'premultiplied',
          toneMapping: { mode: 'extended' },
        },
      );
      this.configured = true;
      this.canvas.dataset.hdrUiOutput = 'extended';
      return true;
    }
    catch
    {
      this.configured = false;
      this.canvas.style.display = 'none';
      this.canvas.dataset.hdrUiOutput = 'unavailable';
      return false;
    }
  }

  render(options = {})
  {
    if (
      !this.configured ||
      !this.device ||
      !this.pipeline ||
      !this.uniformBuffer ||
      !this.bindGroup
    )
    {
      return false;
    }

    const width = Math.max(1, finiteOr(options.width, 1));
    const height = Math.max(1, finiteOr(options.height, 1));
    const dpr = clamp(finiteOr(options.dpr, 1), 1, 4);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight)
    {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }

    try
    {
      const uniforms = packHdrUiUniforms({ ...options, width, height });
      const encoder = this.device.createCommandEncoder(
        { label: 'BA Click FX demo HDR UI commands' },
      );
      const pass = encoder.beginRenderPass(
        {
          label: 'BA Click FX demo HDR UI',
          colorAttachments:
          [{
            view: this.context.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
          }],
        },
      );

      this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(3);
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      this.canvas.style.display = '';
      this.canvas.dataset.hdrUiPrimitives = String(uniforms[3]);
      return true;
    }
    catch
    {
      this.canvas.style.display = 'none';
      return false;
    }
  }

  suspend()
  {
    if (!this.configured)
    {
      if (this.canvas)
      {
        this.canvas.style.display = 'none';
        this.canvas.dataset.hdrUiOutput = 'inactive';
      }

      return true;
    }

    try
    {
      this.context?.unconfigure?.();
    }
    catch
    {
      return false;
    }

    this.configured = false;
    this.canvas.style.display = 'none';
    this.canvas.dataset.hdrUiOutput = 'inactive';
    this.canvas.dataset.hdrUiPrimitives = '0';
    return true;
  }

  destroy()
  {
    this.suspend();
    this._releaseDeviceResources();
    this.context = null;
  }
}

export {
  HDR_UI_UNIFORM_FLOATS,
  HDR_UI_UNIFORM_SIZE,
  MAX_HDR_UI_PRIMITIVES,
};
