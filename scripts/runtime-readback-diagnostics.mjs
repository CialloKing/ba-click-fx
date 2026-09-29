// 浏览器基准与 Node 检查共用；不进入发布运行时。
export const READBACK_ROLES = ['sceneAlpha', 'emission', 'coverage', 'bloomTransport', 'finalFrame', 'unclassified'];
export const FINAL_FRAME_STAGES = ['regionAlpha', 'softwareCleanup', 'frameFinalize', 'unclassified'];

export function trackCanvasReadbacks(prototype, { classify, classifyStage = () => 'unclassified', now = null })
{
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'getImageData');
  const original = prototype.getImageData;
  const record = () => ({ calls: 0, requestedPixels: 0, returnedBytes: 0, failures: 0,
    ...(now ? { durationMs: 0 } : {}) });
  const stats = { total: record(), byRole: Object.fromEntries(READBACK_ROLES.map(role => [role, record()])),
    finalFrameStages: Object.fromEntries(FINAL_FRAME_STAGES.map(stage => [stage, record()])), collectionErrors: 0 };
  const collect = (callback, fallback) =>
  {
    try { return callback(); }
    catch { stats.collectionErrors++; return fallback; }
  };
  prototype.getImageData = function (...args)
  {
    let role = 'unclassified';
    try { role = classify(this); }
    catch { stats.collectionErrors++; }
    if (typeof role !== 'string' || !Object.hasOwn(stats.byRole, role)) role = 'unclassified';
    let stage = role === 'finalFrame' ? collect(() => classifyStage(this), 'unclassified') : null;
    if (role === 'finalFrame' && (typeof stage !== 'string' || !Object.hasOwn(stats.finalFrameStages, stage))) stage = 'unclassified';
    const started = now ? collect(now, null) : null;
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
        const pixels = collect(() => Math.abs(Math.trunc(args[2]) * Math.trunc(args[3])), 0);
        const ended = now ? collect(now, null) : null;
        const duration = Number.isFinite(started) && Number.isFinite(ended) ? ended - started : 0;
        const bytes = collect(() => result?.data?.byteLength ?? 0, 0);
        const targets = [stats.total, stats.byRole[role]];
        if (stage !== null) targets.push(stats.finalFrameStages[stage]);
        for (const target of targets)
        {
          target.calls++;
          target.requestedPixels += Number.isFinite(pixels) ? pixels : 0;
          target.returnedBytes += bytes;
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

// 仅在独立计数运行中启用，记录一个帧的调用顺序；不保留 Canvas 或 ImageData 引用。
export function trackCanvasOperations(prototype, { accepts, stage, limit = 200 })
{
  const trace = { limit, entries: [], dropped: 0, truncated: false, collectionErrors: 0 };
  const restores = [];
  const restore = () =>
  {
    for (const undo of restores.splice(0).reverse())
      try { undo(); } catch { trace.collectionErrors++; }
  };
  try
  {
    for (const method of ['getImageData', 'putImageData', 'drawImage', 'clearRect', 'fillRect', 'strokeRect', 'fill', 'stroke'])
    {
      const original = prototype[method];
      if (typeof original !== 'function') continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
      prototype[method] = function (...args)
      {
        let entry;
        try
        {
          if (accepts(this))
          {
            const currentStage = stage();
            const previous = trace.entries.at(-1);
            // 连续路径绘制合并计数，避免几百次 fill 淹没后续回读/写回的顺序证据。
            if (['fill', 'stroke'].includes(method) && !args.length && previous?.operation === method
              && previous.stage === currentStage && !previous.failed && !trace.truncated)
            {
              entry = previous;
              entry.calls++;
            }
            else if (trace.entries.length >= limit) { trace.dropped++; trace.truncated = true; }
            else
            {
              entry = { operation: method, stage: currentStage, calls: 1, args: args.map(value => typeof value === 'number' ? value
                : { width: value?.width ?? null, height: value?.height ?? null }), failed: false };
              trace.entries.push(entry);
            }
          }
        }
        catch { trace.collectionErrors++; }
        try { return original.apply(this, args); }
        catch (error) { if (entry) entry.failed = true; throw error; }
      };
      restores.push(() => descriptor ? Object.defineProperty(prototype, method, descriptor) : delete prototype[method]);
    }
  }
  catch (error) { restore(); throw error; }
  return { trace, restore };
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
