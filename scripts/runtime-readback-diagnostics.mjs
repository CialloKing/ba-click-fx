// 浏览器基准与 Node 检查共用；不进入发布运行时。
export const READBACK_ROLES = ['sceneAlpha', 'emission', 'coverage', 'bloomTransport', 'finalFrame', 'unclassified'];

export function trackCanvasReadbacks(prototype, { classify, now = null })
{
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getImageData');
  const original = prototype.getImageData;
  const record = () => ({ calls: 0, requestedPixels: 0, returnedBytes: 0, failures: 0,
    ...(now ? { durationMs: 0 } : {}) });
  const stats = { total: record(), byRole: Object.fromEntries(READBACK_ROLES.map(role => [role, record()])), collectionErrors: 0 };
  prototype.getImageData = function (...args)
  {
    let role = 'unclassified';
    try { role = classify(this); }
    catch { stats.collectionErrors++; }
    if (!Object.hasOwn(stats.byRole, role)) role = 'unclassified';
    const started = now?.();
    let result;
    let failed = true;
    try
    {
      result = original.apply(this, args);
      failed = false;
      return result;
    }
    finally
    {
      // 统计不得替换 Canvas 的返回值或原始异常。
      try
      {
        const pixels = Math.abs(Math.trunc(args[2]) * Math.trunc(args[3]));
        const duration = now ? now() - started : 0;
        for (const target of [stats.total, stats.byRole[role]])
        {
          target.calls++;
          target.requestedPixels += Number.isFinite(pixels) ? pixels : 0;
          target.returnedBytes += result?.data?.byteLength ?? 0;
          target.failures += failed ? 1 : 0;
          if (now) target.durationMs += duration;
        }
      }
      catch { stats.collectionErrors++; }
    }
  };
  return { stats, restore: () =>
  {
    if (descriptor) Object.defineProperty(prototype, 'getImageData', descriptor);
    else delete prototype.getImageData;
  } };
}

export function seedRoundedShards(fx)
{
  fx.setFxParam('shards.clickCount', 6);
  fx.setTriangleRoundness(0.5);
  fx.boom(160, 120);
  fx.waves.length = 0;
  fx.shards.forEach((shard, index) => Object.assign(shard, {
    x: 55 + (index % 3) * 105, y: 75 + Math.floor(index / 3) * 90,
    velocityX: 0, velocityY: 0, size: 32, textureFrame: index % 2,
    // 固定在渐变的非恒定区间；每个纹理方向的三种颜色使染色缓存持续更新。
    lifetimeMs: 1000, ageMs: 200 + index * 12, lastUpdateTimeMs: null,
  }));
  if (fx.shards.length !== 6) throw new Error('圆角基准必须恰有六个碎片');
}
