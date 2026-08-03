const STANDARD_CANVAS_FORMAT = 'bgra8unorm';

const DIAGNOSTIC_STAGE_NAMES = Object.freeze(
  [
    'gpuApi',
    'context',
    'adapter',
    'device',
    'extendedConfigure',
    'standardConfigure',
    'deviceLost',
    'unconfigure',
  ],
);

const CONFIGURATION_FAILURE_STAGES = new Set(
  [
    'extended-configure-failed',
    'standard-configure-failed',
    'unconfigure-failed',
  ],
);

function createDiagnosticStage()
{
  return {
    status: 'idle',
    failureStage: null,
    error: null,
  };
}

function freezeDiagnosticStage(stage)
{
  return Object.freeze(
    {
      status: stage.status,
      failureStage: stage.failureStage,
      error: stage.error,
    },
  );
}

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
    this._diagnosticFailureStage = null;
    this._diagnosticStages = Object.fromEntries(
      DIAGNOSTIC_STAGE_NAMES.map((name) => [name, createDiagnosticStage()]),
    );
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

  /**
   * 返回不可变快照，防止展示层意外改写设备状态。Error/DeviceLostInfo
   * 保留原对象，便于诊断浏览器提供的详细原因。
   */
  get diagnostics()
  {
    const stages = Object.fromEntries(
      DIAGNOSTIC_STAGE_NAMES.map(
        (name) => [name, freezeDiagnosticStage(this._diagnosticStages[name])],
      ),
    );

    return Object.freeze(
      {
        failureStage: this._diagnosticFailureStage,
        stages: Object.freeze(stages),
      },
    );
  }

  _setDiagnosticStage(
    name,
    status,
    failureStage = null,
    error = null,
  )
  {
    const stage = this._diagnosticStages[name];

    if (!stage)
    {
      return;
    }

    stage.status = status;
    stage.failureStage = failureStage;
    stage.error = error;
  }

  _failDiagnosticStage(name, failureStage, error)
  {
    this._setDiagnosticStage(name, 'failed', failureStage, error);
    this._diagnosticFailureStage = failureStage;
  }

  _resetConfigurationDiagnostics()
  {
    this._setDiagnosticStage('extendedConfigure', 'idle');
    this._setDiagnosticStage('standardConfigure', 'idle');
    this._setDiagnosticStage('unconfigure', 'idle');

    if (CONFIGURATION_FAILURE_STAGES.has(this._diagnosticFailureStage))
    {
      this._diagnosticFailureStage = null;
    }
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
      this._setDiagnosticStage('gpuApi', 'pending');

      if (!this.gpu || typeof this.gpu.requestAdapter !== 'function')
      {
        const error = new Error('当前环境未提供 WebGPU');
        this._failDiagnosticStage('gpuApi', 'webgpu-api-missing', error);
        throw error;
      }

      this._setDiagnosticStage('gpuApi', 'succeeded');
      this._setDiagnosticStage('context', 'pending');

      try
      {
        this.context = this.canvas?.getContext?.('webgpu') ?? null;
      }
      catch (error)
      {
        this._failDiagnosticStage('context', 'context-unavailable', error);
        throw error;
      }

      if (!this.context)
      {
        const error = new Error('Canvas 无法创建 WebGPU 上下文');
        this._failDiagnosticStage('context', 'context-unavailable', error);
        throw error;
      }

      this._setDiagnosticStage('context', 'succeeded');
      this._setDiagnosticStage('adapter', 'pending');

      try
      {
        this.adapter = await this.gpu.requestAdapter(
          { powerPreference: this.powerPreference },
        );
      }
      catch (error)
      {
        this._failDiagnosticStage('adapter', 'adapter-request-failed', error);
        throw error;
      }

      if (!this.adapter)
      {
        const error = new Error('浏览器未返回 WebGPU Adapter');
        this._failDiagnosticStage('adapter', 'adapter-unavailable', error);
        throw error;
      }

      this._setDiagnosticStage('adapter', 'succeeded');
      this._setDiagnosticStage('device', 'pending');

      try
      {
        this.device = await this.adapter.requestDevice();
      }
      catch (error)
      {
        this._failDiagnosticStage('device', 'device-request-failed', error);
        throw error;
      }

      if (!this.device)
      {
        const error = new Error('浏览器未返回 WebGPU Device');
        this._failDiagnosticStage('device', 'device-request-failed', error);
        throw error;
      }

      this._setDiagnosticStage('device', 'succeeded');
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
      this._resetConfigurationDiagnostics();

      const failure = info ?? new Error('WebGPU Device 已丢失');
      this._setDiagnosticStage('device', 'lost', 'device-lost', failure);
      this._setDiagnosticStage('deviceLost', 'lost', 'device-lost', failure);
      this._diagnosticFailureStage = 'device-lost';
      this._setStatus('lost', failure);
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

    this._resetConfigurationDiagnostics();

    if (preferHdr)
    {
      this._setDiagnosticStage('extendedConfigure', 'pending');

      try
      {
        this._configureExtended();
        this._setDiagnosticStage('extendedConfigure', 'succeeded');
        this._setDiagnosticStage('standardConfigure', 'skipped');
        this.preferHdr = preferHdr;
        return true;
      }
      catch (error)
      {
        // HDR Canvas 是可选能力；保留失败原因后继续使用同一个 Device 降级。
        this._failDiagnosticStage(
          'extendedConfigure',
          'extended-configure-failed',
          error,
        );
      }
    }
    else
    {
      this._setDiagnosticStage('extendedConfigure', 'skipped');
    }

    this._setDiagnosticStage('standardConfigure', 'pending');
    try
    {
      this._configureStandard();
      this._setDiagnosticStage('standardConfigure', 'succeeded');
      this.preferHdr = preferHdr;
      return true;
    }
    catch (error)
    {
      this.outputMode = 'unconfigured';
      this.canvasFormat = null;
      this.preferHdr = null;
      this.failure = error;
      this._failDiagnosticStage(
        'standardConfigure',
        'standard-configure-failed',
        error,
      );
      return false;
    }
  }

  /**
   * 解除 Canvas 的展示配置，但保留 Adapter 与 Device，供再次选择 WebGPU
   * 时重新协商 HDR/SDR。隐藏的 Extended Surface 不能继续参与页面合成。
   */
  unconfigure()
  {
    if (
      this.outputMode === 'unconfigured' &&
      this.canvasFormat === null &&
      this.preferHdr === null
    )
    {
      return true;
    }

    this._setDiagnosticStage('unconfigure', 'pending');

    try
    {
      this.context?.unconfigure?.();
    }
    catch (error)
    {
      this.failure = error;
      this._failDiagnosticStage(
        'unconfigure',
        'unconfigure-failed',
        error,
      );
      return false;
    }

    this.outputMode = 'unconfigured';
    this.canvasFormat = null;
    this.preferHdr = null;
    this._setDiagnosticStage('extendedConfigure', 'idle');
    this._setDiagnosticStage('standardConfigure', 'idle');
    this._setDiagnosticStage('unconfigure', 'succeeded');

    if (CONFIGURATION_FAILURE_STAGES.has(this._diagnosticFailureStage))
    {
      this._diagnosticFailureStage = null;
    }

    return true;
  }

  destroy()
  {
    if (this.status === 'destroyed')
    {
      return;
    }

    this._setStatus('destroyed');
    this.unconfigure();

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
