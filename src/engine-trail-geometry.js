import {
  distance, releaseMeshGradients,
} from './engine-shared.js';

const MAX_TRAIL_INNER_MITER_RATIO = 4;

const MIN_TRAIL_SEGMENT_LENGTH = 0.000001;

const TRAIL_MESH_CACHE_CAPACITY = 4;

function measureTrail(points, cacheSegmentLengths = false, measurement = {})
{
  let totalLength = 0;
  const distances = measurement.distances ??= [];
  const segmentLengths = cacheSegmentLengths ? (measurement.segmentLengths ??= []) : null;
  distances[0] = 0;
  if (segmentLengths) segmentLengths[0] = 0;

  for (let index = 1; index < points.length; index++)
  {
    const segmentLength = distance(points[index - 1], points[index]);

    totalLength += segmentLength;
    distances[index] = totalLength;

    if (segmentLengths)
    {
      segmentLengths[index] = segmentLength;
    }
  }

  measurement.totalLength = totalLength;
  return measurement;
}

function writeTrailPoint(point, x, y)
{
  point.x = x; point.y = y;
  return point;
}

function createTrailMesh(
  points,
  width,
  numCornerVertices = 0,
  numCapVertices = 0,
  segmentLengths = null,
  mesh = {},
)
{
  const halfWidth = Math.max(0, width) * 0.5;
  const segments = mesh.segments ??= [];
  const caps = mesh.caps ??= [];
  const pool = mesh.segmentPool ??= [];
  const capPool = mesh.capPool ??= [];
  // 只清理本次不用的槽位；有效段会原地覆写，避免先清空再写回的屏障成本。
  for (let index = halfWidth > 0 ? points.length : 1; index < (mesh.pointCount ?? 0); index++)
  {
    const segment = pool[index];
    if (segment) { segment.from = segment.to = null; segment.endJoin = null; }
  }
  mesh.pointCount = points.length;
  segments.length = points.length;
  segments[0] = null;
  caps.length = 0;
  const visibleSegments = mesh.visibleSegments ??= new Set();
  visibleSegments.clear();

  if (halfWidth <= 0)
  {
    segments.fill(null);
    return mesh;
  }

  for (let index = 1; index < points.length; index++)
  {
    const from = points[index - 1];
    const to = points[index];
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    // 弧长测量已计算同一段长度；复用原值可保持累计距离与网格完全一致。
    const length = segmentLengths?.[index] ?? Math.hypot(deltaX, deltaY);

    if (length <= MIN_TRAIL_SEGMENT_LENGTH)
    {
      const unused = pool[index];
      if (unused) { unused.from = unused.to = null; unused.endJoin = null; }
      segments[index] = null;
      continue;
    }

    const segment = pool[index] ??= {
      index, tangent: {}, normal: {}, boundaries: [{}, {}, {}, {}],
    };
    segment.endJoin = null;
    const tangent = segment.tangent;
    tangent.x = deltaX / length; tangent.y = deltaY / length;
    const normal = segment.normal;
    normal.x = -tangent.y; normal.y = tangent.x;
    const offsetX = normal.x * halfWidth;
    const offsetY = normal.y * halfWidth;
    segment.from = from; segment.to = to; segment.length = length;
    segment.fromLeft = writeTrailPoint(segment.boundaries[0], from.x + offsetX, from.y + offsetY);
    segment.fromRight = writeTrailPoint(segment.boundaries[1], from.x - offsetX, from.y - offsetY);
    segment.toLeft = writeTrailPoint(segment.boundaries[2], to.x + offsetX, to.y + offsetY);
    segment.toRight = writeTrailPoint(segment.boundaries[3], to.x - offsetX, to.y - offsetY);
    segments[index] = segment;
    visibleSegments.add(index);
  }

  const cornerVertexCount = Math.max(0, Math.floor(numCornerVertices));

  for (let pointIndex = 1; pointIndex < points.length - 1; pointIndex++)
  {
    const previous = segments[pointIndex];
    const next = segments[pointIndex + 1];

    if (!previous || !next)
    {
      continue;
    }

    const turn = previous.tangent.x * next.tangent.y -
      previous.tangent.y * next.tangent.x;
    const directionDot = previous.tangent.x * next.tangent.x +
      previous.tangent.y * next.tangent.y;

    if (Math.abs(turn) <= 0.000001)
    {
      // 直线自然共享截面；精确折返没有稳定内角，保留独立边界。
      continue;
    }

    const point = points[pointIndex];
    const innerSign = turn > 0 ? 1 : -1;
    const outerSign = -innerSign;
    const previousInnerX = point.x + previous.normal.x * halfWidth * innerSign;
    const previousInnerY = point.y + previous.normal.y * halfWidth * innerSign;
    const nextInnerX = point.x + next.normal.x * halfWidth * innerSign;
    const nextInnerY = point.y + next.normal.y * halfWidth * innerSign;
    const innerScale = (
      (nextInnerX - previousInnerX) * next.tangent.y -
      (nextInnerY - previousInnerY) * next.tangent.x
    ) / turn;
    const join = previous.joinWork ??= { inner: {}, outerArc: [], arcPool: [] };
    const inner = writeTrailPoint(join.inner,
      previousInnerX + previous.tangent.x * innerScale,
      previousInnerY + previous.tangent.y * innerScale);
    const innerDistance = Math.hypot(
      inner.x - point.x,
      inner.y - point.y,
    );
    const previousProjection =
      (inner.x - point.x) * previous.tangent.x +
      (inner.y - point.y) * previous.tangent.y;
    const nextProjection =
      (inner.x - point.x) * next.tangent.x +
      (inner.y - point.y) * next.tangent.y;

    if (
      !Number.isFinite(innerDistance) ||
      innerDistance > halfWidth * MAX_TRAIL_INNER_MITER_RATIO ||
      previousProjection < -previous.length - 0.000001 ||
      previousProjection > 0.000001 ||
      nextProjection < -0.000001 ||
      nextProjection > next.length + 0.000001
    )
    {
      // 无穷 miter 或超出短段的交点会使轮廓回折自交，此时保留独立截面。
      continue;
    }

    const turnAngle = Math.atan2(turn, directionDot);
    const outerStartAngle = Math.atan2(
      previous.normal.y * outerSign,
      previous.normal.x * outerSign,
    );
    const arcStepCount = cornerVertexCount + 1;
    const outerArc = join.outerArc;
    outerArc.length = arcStepCount + 1;

    for (let step = 0; step <= arcStepCount; step++)
    {
      const angle = outerStartAngle + turnAngle * step / arcStepCount;

      outerArc[step] = writeTrailPoint(join.arcPool[step] ??= {},
        point.x + Math.cos(angle) * halfWidth,
        point.y + Math.sin(angle) * halfWidth);
    }

    if (innerSign > 0)
    {
      previous.toLeft = inner;
      next.fromLeft = inner;
      previous.toRight = outerArc[0];
      next.fromRight = outerArc.at(-1);
    }
    else
    {
      previous.toRight = inner;
      next.fromRight = inner;
      previous.toLeft = outerArc[0];
      next.fromLeft = outerArc.at(-1);
    }

    // Unity 的数量表示端点间的插入点；记在前一段上可合并等价 fan 轮廓。
    join.nextSegmentIndex = next.index;
    join.innerSide = innerSign > 0 ? 'left' : 'right';
    previous.endJoin = join;
  }

  if (Math.floor(numCapVertices) > 0)
  {
    const first = segments.find((segment) => segment);
    let last = null;

    for (let index = segments.length - 1; index >= 1; index--)
    {
      if (segments[index])
      {
        last = segments[index];
        break;
      }
    }

    if (first)
    {
      const cap = capPool[0] ??= { position: 'start', points: [], tip: {} };
      cap.segmentIndex = first.index; cap.pointIndex = first.index - 1;
      cap.points[0] = first.fromLeft; cap.points[1] = first.fromRight;
      cap.points[2] = writeTrailPoint(cap.tip,
        first.from.x - first.tangent.x * halfWidth, first.from.y - first.tangent.y * halfWidth);
      caps.push(cap);
    }

    if (last)
    {
      const cap = capPool[1] ??= { position: 'end', points: [], tip: {} };
      cap.segmentIndex = last.index; cap.pointIndex = last.index;
      cap.points[0] = last.toLeft;
      cap.points[1] = writeTrailPoint(cap.tip,
        last.to.x + last.tangent.x * halfWidth, last.to.y + last.tangent.y * halfWidth);
      cap.points[2] = last.toRight;
      caps.push(cap);
    }
  }

  return mesh;
}

function getTrailMesh(trailData, points, width, trailCfg)
{
  if (!trailData.meshCache)
  {
    trailData.meshCache = new Map();
  }

  const cornerVertices = Math.max(
    0,
    Math.floor(trailCfg.numCornerVertices ?? 0),
  );
  const capVertices = Math.max(
    0,
    Math.floor(trailCfg.numCapVertices ?? 0),
  );
  const cacheKey = `${width}:${cornerVertices}:${capVertices}`;

  let mesh = trailData.meshCache.get(cacheKey);
  if (mesh)
  {
    trailData.meshCache.delete(cacheKey);
  }
  else if (trailData.meshCache.size >= TRAIL_MESH_CACHE_CAPACITY)
  {
    const oldest = trailData.meshCache.keys().next().value;
    mesh = trailData.meshCache.get(oldest);
    trailData.meshCache.delete(oldest);
    mesh.version = -1;
  }
  if (!mesh || mesh.version !== trailData.version)
  {
    releaseMeshGradients(mesh);
    mesh = createTrailMesh(points, width, cornerVertices, capVertices,
      trailData.measurement.segmentLengths, mesh);
    mesh.version = trailData.version;
  }
  // 四个宽度槽保留原 LRU 顺序，淘汰时直接覆写容量而不积累历史网格。
  trailData.meshCache.set(cacheKey, mesh);
  return mesh;
}

export {
  MIN_TRAIL_SEGMENT_LENGTH,
  measureTrail,
  getTrailMesh,
};
