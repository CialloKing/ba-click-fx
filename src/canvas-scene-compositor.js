const BYTE_MAXIMUM = 255;
const OUTPUT_EPSILON = 0.00001;

const SRGB_BYTE_TO_LINEAR_BYTE = new Uint8ClampedArray(256);
const LINEAR_BYTE_TO_SRGB = new Float32Array(256);

for (let byte = 0; byte <= BYTE_MAXIMUM; byte++)
{
  const srgb = byte / BYTE_MAXIMUM;
  const linear = srgb <= 0.04045
    ? srgb / 12.92
    : ((srgb + 0.055) / 1.055) ** 2.4;
  const linearByte = byte / BYTE_MAXIMUM;
  const encoded = linearByte <= 0.0031308
    ? linearByte * 12.92
    : 1.055 * linearByte ** (1 / 2.4) - 0.055;

  SRGB_BYTE_TO_LINEAR_BYTE[byte] = Math.round(linear * BYTE_MAXIMUM);
  LINEAR_BYTE_TO_SRGB[byte] = Math.max(0, Math.min(1, encoded));
}

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
    // 已关闭的 VideoFrame 等宿主对象不能继续作为场景真值。
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

function regionsIntersect(left, right)
{
  return left.x <= right.x + right.width &&
    right.x <= left.x + left.width &&
    left.y <= right.y + right.height &&
    right.y <= left.y + left.height;
}

function mergeRegion(regions, nextRegion)
{
  let index = 0;

  while (index < regions.length)
  {
    const current = regions[index];

    if (!regionsIntersect(current, nextRegion))
    {
      index++;
      continue;
    }

    const right = Math.max(
      current.x + current.width,
      nextRegion.x + nextRegion.width,
    );
    const bottom = Math.max(
      current.y + current.height,
      nextRegion.y + nextRegion.height,
    );

    nextRegion.x = Math.min(current.x, nextRegion.x);
    nextRegion.y = Math.min(current.y, nextRegion.y);
    nextRegion.width = right - nextRegion.x;
    nextRegion.height = bottom - nextRegion.y;
    regions.splice(index, 1);
    // 合并后的矩形可能连接之前不相交的区域，必须重新扫描。
    index = 0;
  }

  regions.push(nextRegion);
}

function solveOverlayAlpha(background, target)
{
  if (target > background)
  {
    return (target - background) / Math.max(1 - background, 0.000001);
  }

  if (target < background)
  {
    return (background - target) / Math.max(background, 0.000001);
  }

  return 0;
}

/**
 * Canvas 兼容后端的线性 Scene 暂存与透明覆盖层反解。
 * 背景缓存和逐帧脏区处理被隔离在这里，避免 CPU 回退逻辑侵入粒子实现。
 */
export class CanvasSceneCompositor
{
  constructor(canvasFactory)
  {
    this.canvasFactory = canvasFactory;
    this.rasterCanvas = null;
    this.rasterContext = null;
    this.source = null;
    this.fit = 'cover';
    this.width = 0;
    this.height = 0;
    this.backgroundSrgb = null;
    this.backgroundLinearImageData = null;
    this.available = false;
  }

  get ready()
  {
    return this.available &&
      this.backgroundSrgb !== null &&
      this.backgroundLinearImageData !== null;
  }

  _discardCache()
  {
    this.backgroundSrgb = null;
    this.backgroundLinearImageData = null;
    this.available = false;
  }

  _replaceRasterSurface()
  {
    this.rasterCanvas = null;
    this.rasterContext = null;

    try
    {
      const canvas = this.canvasFactory();
      const context = canvas?.getContext?.('2d', { willReadFrequently: true });

      if (!canvas || !context)
      {
        return false;
      }

      this.rasterCanvas = canvas;
      this.rasterContext = context;
      return true;
    }
    catch
    {
      return false;
    }
  }

  _rebuildBackground()
  {
    const dimensions = getRasterSourceDimensions(this.source);

    this._discardCache();

    if (
      !dimensions ||
      this.width <= 0 ||
      this.height <= 0 ||
      !this._replaceRasterSurface()
    )
    {
      return false;
    }

    const canvas = this.rasterCanvas;
    const context = this.rasterContext;

    try
    {
      canvas.width = this.width;
      canvas.height = this.height;

      const scale = Math.max(
        this.width / dimensions.width,
        this.height / dimensions.height,
      );
      const sourceWidth = this.width / scale;
      const sourceHeight = this.height / scale;
      const sourceX = (dimensions.width - sourceWidth) * 0.5;
      const sourceY = (dimensions.height - sourceHeight) * 0.5;

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = 'copy';
      context.drawImage(
        this.source,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        this.width,
        this.height,
      );

      const sourceImageData = context.getImageData(
        0,
        0,
        this.width,
        this.height,
      );
      const linearImageData = context.createImageData(this.width, this.height);
      const sourceData = sourceImageData.data;
      const linearData = linearImageData.data;

      for (let offset = 0; offset < sourceData.length; offset += 4)
      {
        linearData[offset] = SRGB_BYTE_TO_LINEAR_BYTE[sourceData[offset]];
        linearData[offset + 1] = SRGB_BYTE_TO_LINEAR_BYTE[sourceData[offset + 1]];
        linearData[offset + 2] = SRGB_BYTE_TO_LINEAR_BYTE[sourceData[offset + 2]];
        // Unity 的相机颜色 RT 在这条路径中是不透明 Scene。
        linearData[offset + 3] = BYTE_MAXIMUM;
      }

      this.backgroundSrgb = new Uint8ClampedArray(sourceData);
      this.backgroundLinearImageData = linearImageData;
      this.available = true;
      // 后续帧只使用两份像素缓存，及时释放临时 cover 栅格的全尺寸 backing store。
      canvas.width = 1;
      canvas.height = 1;
      return true;
    }
    catch
    {
      // 一旦读到受 CORS 污染的 Canvas，该表面不能复用；重建后保留旧透明路径。
      this._discardCache();
      this._replaceRasterSurface();
      return false;
    }
  }

  setSceneBackground(source, options = {})
  {
    const fit = options.fit ?? 'cover';

    if (fit !== 'cover')
    {
      return false;
    }

    if (source === null)
    {
      this.source = null;
      this.fit = fit;
      this._discardCache();

      if (this.rasterCanvas)
      {
        this.rasterCanvas.width = 1;
        this.rasterCanvas.height = 1;
      }

      return true;
    }

    this.source = source;
    this.fit = fit;

    if (!getRasterSourceDimensions(source))
    {
      // 新来源无效时不能继续把上一张背景误当成当前 Scene。
      this._discardCache();
      return false;
    }

    return this._rebuildBackground();
  }

  resize(width, height)
  {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    const changed = nextWidth !== this.width || nextHeight !== this.height;

    this.width = nextWidth;
    this.height = nextHeight;

    if (!this.source)
    {
      this._discardCache();
      return false;
    }

    if (!changed && this.ready)
    {
      return true;
    }

    return this._rebuildBackground();
  }

  _resolvePhysicalRegions(bounds, dpr)
  {
    const regions = [];
    const safeDpr = Math.max(1, dpr || 1);

    for (const bound of bounds)
    {
      if (
        !bound ||
        !Number.isFinite(bound.x) ||
        !Number.isFinite(bound.y) ||
        !Number.isFinite(bound.width) ||
        !Number.isFinite(bound.height) ||
        bound.width <= 0 ||
        bound.height <= 0
      )
      {
        continue;
      }

      const left = clamp(Math.floor(bound.x * safeDpr), 0, this.width);
      const top = clamp(Math.floor(bound.y * safeDpr), 0, this.height);
      const right = clamp(
        Math.ceil((bound.x + bound.width) * safeDpr),
        0,
        this.width,
      );
      const bottom = clamp(
        Math.ceil((bound.y + bound.height) * safeDpr),
        0,
        this.height,
      );

      if (right <= left || bottom <= top)
      {
        continue;
      }

      mergeRegion(
        regions,
        {
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        },
      );
    }

    return regions;
  }

  beginFrame(context, bounds, dpr)
  {
    if (
      !this.ready ||
      context?.canvas?.width !== this.width ||
      context?.canvas?.height !== this.height
    )
    {
      return null;
    }

    const regions = this._resolvePhysicalRegions(bounds, dpr);

    if (regions.length === 0)
    {
      return null;
    }

    try
    {
      for (const region of regions)
      {
        // putImageData 不受当前 DPR 变换和 lighter 状态影响，适合作为线性 Scene 底图。
        context.putImageData(
          this.backgroundLinearImageData,
          0,
          0,
          region.x,
          region.y,
          region.width,
          region.height,
        );
      }

      return regions;
    }
    catch
    {
      this.available = false;
      return null;
    }
  }

  _resolveRegion(context, region)
  {
    const imageData = context.getImageData(
      region.x,
      region.y,
      region.width,
      region.height,
    );
    const data = imageData.data;
    const linearBackground = this.backgroundLinearImageData.data;
    const srgbBackground = this.backgroundSrgb;

    for (let y = 0; y < region.height; y++)
    {
      let backgroundOffset = (
        (region.y + y) * this.width + region.x
      ) * 4;
      let offset = y * region.width * 4;
      const rowEnd = offset + region.width * 4;

      while (offset < rowEnd)
      {
        if (
          data[offset] === linearBackground[backgroundOffset] &&
          data[offset + 1] === linearBackground[backgroundOffset + 1] &&
          data[offset + 2] === linearBackground[backgroundOffset + 2]
        )
        {
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 0;
          offset += 4;
          backgroundOffset += 4;
          continue;
        }

        const targetRed = LINEAR_BYTE_TO_SRGB[data[offset]];
        const targetGreen = LINEAR_BYTE_TO_SRGB[data[offset + 1]];
        const targetBlue = LINEAR_BYTE_TO_SRGB[data[offset + 2]];
        const backgroundRed = srgbBackground[backgroundOffset] / BYTE_MAXIMUM;
        const backgroundGreen = srgbBackground[backgroundOffset + 1] /
          BYTE_MAXIMUM;
        const backgroundBlue = srgbBackground[backgroundOffset + 2] /
          BYTE_MAXIMUM;
        const difference = Math.max(
          Math.abs(targetRed - backgroundRed),
          Math.abs(targetGreen - backgroundGreen),
          Math.abs(targetBlue - backgroundBlue),
        );

        if (difference <= OUTPUT_EPSILON)
        {
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 0;
          offset += 4;
          backgroundOffset += 4;
          continue;
        }

        const alpha = clamp(
          Math.max(
            solveOverlayAlpha(backgroundRed, targetRed),
            solveOverlayAlpha(backgroundGreen, targetGreen),
            solveOverlayAlpha(backgroundBlue, targetBlue),
          ),
          0,
          1,
        );

        if (alpha <= OUTPUT_EPSILON)
        {
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 0;
          offset += 4;
          backgroundOffset += 4;
          continue;
        }

        const premultipliedRed = clamp(
          targetRed - backgroundRed * (1 - alpha),
          0,
          alpha,
        );
        const premultipliedGreen = clamp(
          targetGreen - backgroundGreen * (1 - alpha),
          0,
          alpha,
        );
        const premultipliedBlue = clamp(
          targetBlue - backgroundBlue * (1 - alpha),
          0,
          alpha,
        );

        // ImageData 接收 straight RGB；写入预乘值会被浏览器再次乘 Alpha。
        data[offset] = Math.round(premultipliedRed / alpha * BYTE_MAXIMUM);
        data[offset + 1] = Math.round(
          premultipliedGreen / alpha * BYTE_MAXIMUM,
        );
        data[offset + 2] = Math.round(
          premultipliedBlue / alpha * BYTE_MAXIMUM,
        );
        data[offset + 3] = Math.round(alpha * BYTE_MAXIMUM);
        offset += 4;
        backgroundOffset += 4;
      }
    }

    context.putImageData(imageData, region.x, region.y);
  }

  finishFrame(context, regions)
  {
    if (!this.ready || !Array.isArray(regions) || regions.length === 0)
    {
      return false;
    }

    try
    {
      for (const region of regions)
      {
        this._resolveRegion(context, region);
      }

      return true;
    }
    catch
    {
      // 主 Canvas 回读失败后停用 Scene 路径，直到背景或尺寸再次更新。
      this.available = false;
      return false;
    }
  }

  destroy()
  {
    this.source = null;
    this._discardCache();

    if (this.rasterCanvas)
    {
      this.rasterCanvas.width = 0;
      this.rasterCanvas.height = 0;
    }

    this.rasterCanvas = null;
    this.rasterContext = null;
  }
}
