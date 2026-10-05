/** 按输入发生顺序匹配原始采样；折返时优先最后一段完整匹配，避免重合坐标串错出生时间。 */
export function matchTrailPointTimes(points, inputs)
{
  let matched = null;
  for (let start = 0; start < inputs.length; start++)
  {
    const candidate = []; let next = start;
    for (const point of points)
    {
      while (next < inputs.length && Math.hypot(point.x - inputs[next].x, point.y - inputs[next].y) > 0.001) next++;
      if (next === inputs.length) break;
      // 原始 TrailRenderer 首次发生位移时同时创建起点与终点。
      const time = inputs[next === 0 && inputs.length > 1 ? 1 : next].timeMs;
      candidate.push({ ...point, bornAt: time });
      next++;
    }
    if (candidate.length === points.length) matched = candidate;
  }
  if (!matched) throw new Error('Unity 原始采样不能按输入时间线匹配；不能从烘焙端点反推出生时间');
  return matched;
}
