const STANDARD_CANVAS_FORMAT = 'bgra8unorm';

function getDefaultGpu()
{
  return globalThis.navigator?.gpu ?? null;
}

function getPreferredCanvasFormat(gpu)
{
  try
  {
    return gpu?.getPreferredCanvasFormat?.() ?? STANDARD_CANVAS_FORMAT;
  }
  catch
  {
    return STANDARD_CANVAS_FORMAT;
  }
}

/**
 * 管理 WebGPU 的异步设备生命周期和 Canvas 输出合同。
 * Renderer 只在 ready 后创建资源，设备丢失则由宿主决定回退与重试时机。
 */
export class WebGPUCanvasDevice
{
  constructor(canvas, options = {})
  {
    this.canvas = canvas;
    this.gpu = options.gpu ?? getDefaultGpu();
    this.powerPreference = options.powerPreference ?? 'high-performance';
    this.onStateChange = typeof options.onStateChange === 'function'
      ? options.onStateChange
      : null;
    this.context = null;
    this.adapter = null;
    this.device = null;
    this.status = 'pending';
    this.outputMode = 'unconfigured';
    this.canvasFormat = null;
    this.preferHdr = null;
    this.failure = null;
    this.ready = this._initialize();
  }

  get available()
  {
    return this.status === 'ready';
  }

  get hdrOutput()
  {
    return this.outputMode === 'extended';
  }

  _setStatus(status, failure = null)
  {
    if (this.status === status && this.failure === failure)
    {
      return;
    }

    this.status = status;
    this.failure = failure;
    this.onStateChange?.(status, this);
  }

  async _initialize()
  {
    try
    {
      if (!this.gpu || typeof this.gpu.requestAdapter !== 'function')
      {
        throw new Error('当前环境未提供 WebGPU');
      }

      this.context = this.canvas?.getContext?.('webgpu') ?? null;

      if (!this.context)
      {
        throw new Error('Canvas 无法创建 WebGPU 上下文');
      }

      this.adapter = await this.gpu.requestAdapter(
        { powerPreference: this.powerPreference },
      );

      if (!this.adapter)
      {
        throw new Error('浏览器未返回 WebGPU Adapter');
      }

      this.device = await this.adapter.requestDevice();

      if (!this.device)
      {
        throw new Error('浏览器未返回 WebGPU Device');
      }

      this._watchDeviceLoss(this.device);
      this._setStatus('ready');
      return true;
    }
    catch (error)
    {
      if (this.status !== 'destroyed')
      {
        this._setStatus('unavailable', error);
      }

      return false;
    }
  }

  _watchDeviceLoss(device)
  {
    if (!device?.lost || typeof device.lost.then !== 'function')
    {
      return;
    }

    device.lost.then((info) =>
    {
      if (this.status === 'destroyed' || device !== this.device)
      {
        return;
      }

      this.outputMode = 'unconfigured';
      this.canvasFormat = null;
      this.preferHdr = null;
      this._setStatus('lost', info ?? new Error('WebGPU Device 已丢失'));
    });
  }

  _configureExtended()
  {
    this.context.configure(
      {
        device: this.device,
        format: 'rgba16float',
        alphaMode: 'premultiplied',
        toneMapping: { mode: 'extended' },
      },
    );
    this.canvasFormat = 'rgba16float';
    this.outputMode = 'extended';
  }

  _configureStandard()
  {
    const format = getPreferredCanvasFormat(this.gpu);

    // 不传可选 toneMapping 字段，兼容尚未实现扩展配置的 WebGPU 浏览器。
    this.context.configure(
      {
        device: this.device,
        format,
        alphaMode: 'premultiplied',
      },
    );
    this.canvasFormat = format;
    this.outputMode = 'standard';
  }

  configure(options = {})
  {
    if (!this.available || !this.context || !this.device)
    {
      return false;
    }

    const preferHdr = options.preferHdr !== false;

    if (this.outputMode !== 'unconfigured' && this.preferHdr === preferHdr)
    {
      return true;
    }

    if (preferHdr)
    {
      try
      {
        this._configureExtended();
        this.preferHdr = preferHdr;
        return true;
      }
      catch
      {
        // HDR Canvas 是可选能力；失败只降级输出合同，不丢弃可用 Device。
      }
    }

    try
    {
      this._configureStandard();
      this.preferHdr = preferHdr;
      return true;
    }
    catch (error)
    {
      this.outputMode = 'unconfigured';
      this.canvasFormat = null;
      this.preferHdr = null;
      this.failure = error;
      return false;
    }
  }

  destroy()
  {
    if (this.status === 'destroyed')
    {
      return;
    }

    this._setStatus('destroyed');

    try
    {
      this.context?.unconfigure?.();
    }
    catch
    {
      // 销毁必须幂等；已丢失的上下文可能拒绝再次取消配置。
    }

    try
    {
      this.device?.destroy?.();
    }
    catch
    {
      // Device 丢失后的 destroy 仅用于尽力释放，不应影响宿主清理。
    }

    this.context = null;
    this.adapter = null;
    this.device = null;
    this.outputMode = 'unconfigured';
    this.canvasFormat = null;
    this.preferHdr = null;
  }
}
