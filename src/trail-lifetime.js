/** 原始采样保留边界前一点；有效点只供渲染，不参与输入和距离粒子发射。 */
export function updateTrailRenderPoints(stroke, timeMs, lifetimeMs)
{
  const points = stroke.points;
  const render = stroke.renderPoints ??= [];
  const cutoff = timeMs - lifetimeMs;
  const cached = stroke.renderPointCache;
  const clipTime = points.length && cutoff > points[0].bornAt ? cutoff : null;
  if (cached && cached.points === points && cached.version === stroke.pointsVersion &&
    cached.length === points.length && cached.first === points[0] && cached.last === points.at(-1) &&
    cached.lifetimeMs === lifetimeMs && cached.clipTime === clipTime)
  {
    return false;
  }
  if (points.length && points.at(-1).bornAt <= cutoff)
  {
    points.length = 0;
    render.length = 0;
    cacheTrailRenderPoints(stroke, cutoff, lifetimeMs);
    return true;
  }
  let first = 0;
  // Unity 在边界仍保留同一时刻出生的邻接点；最后一批全部到期则直接清空。
  while (first < points.length && points[first].bornAt < cutoff) first++;
  let changed = false;
  if (first === points.length)
  {
    changed = points.length > 0 || render.length > 0;
    points.length = 0;
    render.length = 0;
    cacheTrailRenderPoints(stroke, cutoff, lifetimeMs);
    return changed;
  }
  if (first > 1)
  {
    points.splice(0, first - 1);
    first = 1;
    changed = true;
  }
  let count = 0;
  if (first > 0 && points[first].bornAt > cutoff)
  {
    const before = points[0]; const after = points[1];
    const progress = (cutoff - before.bornAt) / (after.bornAt - before.bornAt);
    const x = before.x + (after.x - before.x) * progress;
    const y = before.y + (after.y - before.y) * progress;
    const clipped = stroke.clippedPoint ??= { x, y, bornAt: cutoff };
    changed ||= clipped.x !== x || clipped.y !== y || render[0] !== clipped;
    clipped.x = x; clipped.y = y; clipped.bornAt = cutoff;
    render[count++] = clipped;
  }
  for (let index = first; index < points.length; index++)
  {
    changed ||= render[count] !== points[index];
    render[count++] = points[index];
  }
  changed ||= render.length !== count;
  render.length = count;
  cacheTrailRenderPoints(stroke, cutoff, lifetimeMs);
  return changed;
}

function cacheTrailRenderPoints(stroke, cutoff, lifetimeMs)
{
  // 未开始裁切的静止轨迹不必每帧扫描全部采样；裁切后时间变化仍强制重建。
  const cache = stroke.renderPointCache ??= {};
  const points = stroke.points;
  cache.points = points;
  cache.version = stroke.pointsVersion;
  cache.length = points.length;
  cache.first = points[0];
  cache.last = points.at(-1);
  cache.lifetimeMs = lifetimeMs;
  cache.clipTime = points.length && cutoff > points[0].bornAt ? cutoff : null;
}

export function getTrailRenderPoints(stroke)
{
  return stroke.renderPoints ?? stroke.points;
}
