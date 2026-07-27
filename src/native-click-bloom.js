const EXPOSURE_DIVISOR = 10;
export const NATIVE_CLICK_BLOOM_FAR_SIGMA = 76;
// 清晰圆盘与圆环负责白热亮芯；Bloom 缓冲把线性 0..0.1 映射到 8 位，
// 才能保留 Unity 捕获中约 0.0008 的最远有效尾部。
const LINEAR_TRANSFER_ENCODING_SCALE = 10;
const SRGB_TRANSFER_KNOTS = Object.freeze(
  [
    0,
    17 / 255,
    50 / 255,
    121 / 255,
    1,
  ],
);
const LAYER_SPECS = Object.freeze(
  [
    Object.freeze(
      {
        resolutionScale: 1 / 2,
        sigma: 6,
        storageExposure: 4,
        gainScale: 1.829,
      },
    ),
    Object.freeze(
      {
        resolutionScale: 1 / 8,
        sigma: 22,
        storageExposure: 4,
        gainScale: 1.2,
      },
    ),
    Object.freeze(
      {
        resolutionScale: 1 / 16,
        sigma: NATIVE_CLICK_BLOOM_FAR_SIGMA,
        inputLayerIndex: 1,
        inputSigma: 22,
        storageExposure: 16,
        // Canvas blur 使用归一化核；游戏的逐级上采样会重复累加最低 mip。
        // 因此远层按 Unity 130ms/250ms 径向捕获单独标定，不能沿用单次
        // Gaussian 卷积的理论权重。
        gainScale: 2.1,
      },
    ),
  ],
);

function isFinitePositive(value)
{
  return Number.isFinite(value) && value > 0;
}

function linearToSrgb(value)
{
  const linear = Math.max(
    0,
    Math.min(1, value / LINEAR_TRANSFER_ENCODING_SCALE),
  );

  if (linear <= 0.0031308)
  {
    return linear * 12.92;
  }

  return 1.055 * linear ** (1 / 2.4) - 0.055;
}

function createSrgbTransferPasses()
{
  const slopes = [];

  for (let index = 1; index < SRGB_TRANSFER_KNOTS.length; index++)
  {
    const previous = SRGB_TRANSFER_KNOTS[index - 1];
    const current = SRGB_TRANSFER_KNOTS[index];

    slopes.push(
      (linearToSrgb(current) - linearToSrgb(previous)) /
      (current - previous),
    );
  }

  const passes =
  [
    Object.freeze(
      {
        brightness: slopes[slopes.length - 1],
        alpha: 1,
      },
    ),
  ];

  for (let index = 1; index < SRGB_TRANSFER_KNOTS.length - 1; index++)
  {
    const knot = SRGB_TRANSFER_KNOTS[index];
    const alpha = (slopes[index - 1] - slopes[index]) * knot;

    passes.push(
      Object.freeze(
        {
          brightness: 1 / knot,
          alpha,
        },
      ),
    );
  }

  return Object.freeze(passes);
}

const SRGB_TRANSFER_PASSES = createSrgbTransferPasses();

function releaseSurface(surface)
{
  if (!surface?.canvas)
  {
    return;
  }

  surface.canvas.width = 0;
  surface.canvas.height = 0;
  surface.activeWidth = 0;
  surface.activeHeight = 0;
}

/**
 * 使用局部低分辨率 Canvas 近似 MXFinalBloom 的近、中、远三段包络。
 * 模块不读取像素；调用方负责把已按 emissionRange 压缩的发射源画入回调上下文。
 */
export class NativeClickBloomRenderer
{
  constructor(createCanvas)
  {
    this.createCanvas = createCanvas;
    this.source = null;
    this.layers = [];
    this.available = typeof createCanvas === 'function';
  }

  _createSurface(specification = null)
  {
    const canvas = this.createCanvas();
    // 线性能量必须保存在不透明 RGB 中；透明缓冲的预乘 Alpha 会在
    // brightness 放大前截断远场。最终只允许合成到显式加色的 DOM Canvas。
    const context = canvas?.getContext?.('2d', { alpha: false });

    if (!canvas || !context)
    {
      throw new Error('Native Click Bloom 无法创建 Canvas 2D 缓冲');
    }

    if (specification && typeof context.filter !== 'string')
    {
      throw new Error('Native Click Bloom 需要 Canvas filter 支持');
    }

    const surface =
    {
      canvas,
      context,
      activeWidth: 0,
      activeHeight: 0,
      specification,
    };

    return surface;
  }

  _initialize()
  {
    if (this.source)
    {
      return true;
    }

    try
    {
      this.source = this._createSurface();

      for (const specification of LAYER_SPECS)
      {
        // 逐层登记，后续创建失败时 _disable() 才能释放此前的部分结果。
        this.layers.push(this._createSurface(specification));
      }
    }
    catch
    {
      this._disable();
      return false;
    }

    return true;
  }

  ensureAvailable()
  {
    if (!this.available)
    {
      return false;
    }

    return this._initialize();
  }

  _ensureCapacity(surface, width, height)
  {
    const canvas = surface.canvas;

    if (canvas.width >= width && canvas.height >= height)
    {
      return;
    }

    // backing store 只增长不收缩，避免点击区域轻微变化时反复分配显存。
    canvas.width = Math.max(canvas.width, width);
    canvas.height = Math.max(canvas.height, height);

    if (canvas.width < width || canvas.height < height)
    {
      throw new Error('Native Click Bloom Canvas 容量不足');
    }
  }

  _resetSurface(surface, width, height)
  {
    this._ensureCapacity(surface, width, height);

    const context = surface.context;
    const resetWidth = Math.max(surface.activeWidth, width);
    const resetHeight = Math.max(surface.activeHeight, height);

    // alpha:false 缓冲以不透明 RGB 保存暗部；一次黑色覆盖同时完成清除和
    // 中性底初始化，避免在扩大后的局部区域重复执行 clearRect 与 fillRect。
    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.filter = 'none';
    context.fillStyle = '#000';
    context.fillRect(0, 0, resetWidth, resetHeight);
    context.restore();
    surface.activeWidth = width;
    surface.activeHeight = height;
  }

  _drawSource(bounds, dpr, drawSource)
  {
    const sourceScale = dpr * 0.5;
    const width = Math.max(1, Math.ceil(bounds.width * sourceScale));
    const height = Math.max(1, Math.ceil(bounds.height * sourceScale));
    const scaleX = width / bounds.width;
    const scaleY = height / bounds.height;

    this._resetSurface(this.source, width, height);

    const context = this.source.context;

    context.save();
    context.setTransform(
      scaleX,
      0,
      0,
      scaleY,
      -bounds.x * scaleX,
      -bounds.y * scaleY,
    );
    context.globalCompositeOperation = 'lighter';
    context.filter = 'none';
    context.shadowBlur = 0;
    context.shadowColor = 'transparent';

    try
    {
      drawSource(context);
    }
    finally
    {
      context.restore();
    }

    return this.source;
  }

  _renderLayer(
    layer,
    source,
    bounds,
    dpr,
    effectScale,
  )
  {
    const specification = layer.specification;
    const resolutionScale = specification.resolutionScale;
    const width = Math.max(
      1,
      Math.ceil(bounds.width * dpr * resolutionScale),
    );
    const height = Math.max(
      1,
      Math.ceil(bounds.height * dpr * resolutionScale),
    );
    const inputSigma = specification.inputSigma ?? 0;
    const incrementalSigma = Math.sqrt(
      Math.max(0, specification.sigma ** 2 - inputSigma ** 2),
    );
    const blurPixels = incrementalSigma * effectScale * dpr *
      resolutionScale;
    const storageExposure = specification.storageExposure;
    const inputStorageExposure = source.specification?.storageExposure ?? 1;
    const stageExposure = storageExposure / inputStorageExposure;

    this._resetSurface(layer, width, height);
    // 最终 Canvas 使用 plus-lighter，黑色是中性底；在局部线性缓冲中保持
    // Alpha=1 可防止 brightness 后的 HDR RGB 被预乘 Alpha 上限截断。

    const context = layer.context;

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'source-over';
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    // 模糊后提高存储曝光，避免 8 位缓冲把 0.0008 级远尾舍入为零；
    // 合并时会等比除回，因此不会改变线性能量或三层权重。
    context.filter = `blur(${blurPixels}px) brightness(${stageExposure})`;
    context.drawImage(
      source.canvas,
      0,
      0,
      source.activeWidth,
      source.activeHeight,
      0,
      0,
      width,
      height,
    );
    context.restore();

    return layer;
  }

  _combineLayers(source, exposure, emissionRange)
  {
    const width = source.activeWidth;
    const height = source.activeHeight;

    // 发射源已经被三层消费，可以复用同一张半分辨率 Canvas 合并线性能量。
    this._resetSurface(source, width, height);

    const context = source.context;

    context.save();
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = 'lighter';
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';

    try
    {
      for (let index = this.layers.length - 1; index >= 0; index--)
      {
        const layer = this.layers[index];
        const linearGain = emissionRange *
          layer.specification.gainScale *
          exposure *
          LINEAR_TRANSFER_ENCODING_SCALE /
          layer.specification.storageExposure;

        context.filter = `brightness(${linearGain})`;
        context.drawImage(
          layer.canvas,
          0,
          0,
          layer.activeWidth,
          layer.activeHeight,
          0,
          0,
          width,
          height,
        );
      }
    }
    finally
    {
      context.restore();
    }

    return source;
  }

  _compositeSrgbTransfer(targetContext, source, bounds)
  {
    // Canvas 没有 Gamma filter；四条截断线性坡度相加可近似 Unity 的
    // Linear→sRGB 曲线，并保留暗部远场，无需 getImageData() 回读。
    for (const pass of SRGB_TRANSFER_PASSES)
    {
      targetContext.filter = `brightness(${pass.brightness})`;
      targetContext.globalAlpha = pass.alpha;
      targetContext.drawImage(
        source.canvas,
        0,
        0,
        source.activeWidth,
        source.activeHeight,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
      );
    }
  }

  render(targetContext, bounds, dpr, settings, drawSource)
  {
    if (!this.available)
    {
      return false;
    }

    if (
      !targetContext ||
      typeof targetContext.drawImage !== 'function' ||
      typeof drawSource !== 'function' ||
      !bounds ||
      !Number.isFinite(bounds.x) ||
      !Number.isFinite(bounds.y) ||
      !Number.isFinite(bounds.width) ||
      !Number.isFinite(bounds.height) ||
      !isFinitePositive(dpr) ||
      !settings ||
      !Number.isFinite(settings.intensity) ||
      !isFinitePositive(settings.emissionRange) ||
      !isFinitePositive(settings.scale)
    )
    {
      this._disable();
      return false;
    }

    if (bounds.width <= 0 || bounds.height <= 0 || settings.intensity <= 0)
    {
      return true;
    }

    if (!this.ensureAvailable())
    {
      return false;
    }

    try
    {
      const exposure = 2 ** (settings.intensity / EXPOSURE_DIVISOR) - 1;

      if (!Number.isFinite(exposure))
      {
        throw new Error('Native Click Bloom 曝光值溢出');
      }

      const source = this._drawSource(bounds, dpr, drawSource);

      for (let index = 0; index < this.layers.length; index++)
      {
        const layer = this.layers[index];
        const inputLayerIndex = layer.specification.inputLayerIndex;
        // 远层沿用 Unity 的逐级金字塔，避免从全分辨率一次缩至 1/16
        // 时漏掉 2px 细环。
        const layerSource = Number.isInteger(inputLayerIndex)
          ? this.layers[inputLayerIndex]
          : source;

        this._renderLayer(
          layer,
          layerSource,
          bounds,
          dpr,
          settings.scale,
        );
      }

      const combined = this._combineLayers(
        source,
        exposure,
        settings.emissionRange,
      );

      targetContext.save();

      try
      {
        targetContext.globalCompositeOperation = 'lighter';
        targetContext.filter = 'none';
        targetContext.imageSmoothingEnabled = true;
        targetContext.imageSmoothingQuality = 'high';

        this._compositeSrgbTransfer(targetContext, combined, bounds);
      }
      finally
      {
        targetContext.restore();
      }
    }
    catch
    {
      this._disable();
      return false;
    }

    return true;
  }

  _disable()
  {
    releaseSurface(this.source);

    for (const layer of this.layers)
    {
      releaseSurface(layer);
    }

    this.source = null;
    this.layers = [];
    this.available = false;
  }

  destroy()
  {
    this._disable();
  }
}
