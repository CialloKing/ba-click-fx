/** 原始采样保留边界前一点；有效点只供渲染，不参与输入和距离粒子发射。 */
export function updateTrailRenderPoints(stroke, timeMs, lifetimeMs)
{
  const points = stroke.points;
  const render = stroke.renderPoints ??= [];
  const cutoff = timeMs - lifetimeMs;
  let first = 0;
  while (first < points.length && points[first].bornAt <= cutoff) first++;
  let changed = false;
  if (first === points.length)
  {
    changed = points.length > 0 || render.length > 0;
    points.length = 0;
    render.length = 0;
    return changed;
  }
  if (first > 1)
  {
    points.splice(0, first - 1);
    first = 1;
    changed = true;
  }
  let count = 0;
  if (first > 0)
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
  return changed;
}

export function getTrailRenderPoints(stroke)
{
  return stroke.renderPoints ?? stroke.points;
}
