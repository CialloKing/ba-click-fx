// Native 和 Software 共用的 Bloom 数学及 Canvas 输出边界，不绑定渲染后端。
const RGBA_CHANNELS = 4;
function clamp(value, minimum, maximum)
{
  return Math.max(minimum, Math.min(maximum, value));
}
function clamp01(value)
{
  return clamp(value, 0, 1);
}

/**
 * 将 Canvas 脏区的最终 Alpha 限制在独立容量内。getImageData 返回非预乘
 * RGB，因此只降低 Alpha 就会让浏览器在写回时等比收敛预乘颜色。
 */
export function limitCanvasAlpha(context, bounds, alphaLimit)
{
  const canvas = context?.canvas;

  if (
    !canvas ||
    !bounds ||
    typeof context.getImageData !== 'function' ||
    typeof context.putImageData !== 'function'
  )
  {
    return false;
  }

  const minimumX = clamp(
    Math.floor(bounds.minimumX),
    0,
    canvas.width,
  );
  const minimumY = clamp(
    Math.floor(bounds.minimumY),
    0,
    canvas.height,
  );
  const maximumX = clamp(
    Math.ceil(bounds.maximumX + 1),
    minimumX,
    canvas.width,
  );
  const maximumY = clamp(
    Math.ceil(bounds.maximumY + 1),
    minimumY,
    canvas.height,
  );
  const width = maximumX - minimumX;
  const height = maximumY - minimumY;

  if (width <= 0 || height <= 0)
  {
    return false;
  }

  try
  {
    const image = context.getImageData(minimumX, minimumY, width, height);
    const maximumAlpha = Math.round(clamp01(alphaLimit ?? 1) * 255);

    // 字节 Alpha 不可能超过 255；仍保留回读边界及其失败语义，避免改变 Canvas 输出。
    if (maximumAlpha === 255 && image.data instanceof Uint8ClampedArray)
    {
      return true;
    }

    let changed = false;

    for (let offset = 3; offset < image.data.length; offset += RGBA_CHANNELS)
    {
      if (image.data[offset] > maximumAlpha)
      {
        image.data[offset] = maximumAlpha;
        changed = true;
      }
    }

    if (changed)
    {
      context.putImageData(image, minimumX, minimumY);
    }

    return true;
  }
  catch
  {
    // 跨域或外部绘制可能污染 Canvas；限制失败不能中断特效生命周期。
    return false;
  }
}

/**
 * 计算带 Soft Knee 的高亮贡献，与 MXFinalBloom 的预过滤公式一致。
 */
export function calculateBloomContribution(brightness, threshold, softKnee)
{
  const safeThreshold = Math.max(0, threshold);
  // Unity 在 CPU 侧无条件加 epsilon；不能改成下限，否则非零 Soft Knee
  // 会与 BaGameBloomRendererFeature 产生细小但可累积的能量偏差。
  const knee = safeThreshold * clamp01(softKnee) + 0.00001;
  let soft = brightness - safeThreshold + knee;

  soft = clamp(soft, 0, knee * 2);
  soft = (soft * soft) / (knee * 4);

  return Math.max(brightness - safeThreshold, soft, 0);
}
