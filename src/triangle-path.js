const TAU = Math.PI * 2;

function clamp01(value)
{
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function traceSharpTriangle(context, frame, size)
{
  context.moveTo(frame[0][0] * size, frame[0][1] * size);
  context.lineTo(frame[1][0] * size, frame[1][1] * size);
  context.lineTo(frame[2][0] * size, frame[2][1] * size);
  context.closePath();
}

function resolveOutwardNormals(vertices)
{
  const signedArea = vertices.reduce((area, point, index) =>
  {
    const next = vertices[(index + 1) % vertices.length];

    return area + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const winding = signedArea >= 0 ? 1 : -1;
  const normals = vertices.map((point, index) =>
  {
    const next = vertices[(index + 1) % vertices.length];
    const deltaX = next[0] - point[0];
    const deltaY = next[1] - point[1];
    const length = Math.max(0.000001, Math.hypot(deltaX, deltaY));

    return [
      winding * deltaY / length,
      -winding * deltaX / length,
    ];
  });

  return { normals, anticlockwise: winding < 0 };
}

/**
 * 描出“缩小三角核心 + 圆盘”的 Minkowski 和。
 * 直边与圆弧共享同一法线，因此圆角不会变成圆内接三角形。
 */
export function traceRoundedTrianglePath(context, frame, size, roundness)
{
  const amount = clamp01(roundness);

  if (amount <= 0)
  {
    traceSharpTriangle(context, frame, size);
    return;
  }

  const radius = size * amount * 0.5;

  if (amount >= 1)
  {
    context.arc(0, 0, radius, 0, TAU, false);
    context.closePath();
    return;
  }

  const coreScale = size * (1 - amount);
  const vertices = frame.map((point) =>
    [point[0] * coreScale, point[1] * coreScale]);
  const { normals, anticlockwise } = resolveOutwardNormals(vertices);
  const previousNormal = normals.at(-1);

  context.moveTo(
    vertices[0][0] + previousNormal[0] * radius,
    vertices[0][1] + previousNormal[1] * radius,
  );

  for (let index = 0; index < vertices.length; index++)
  {
    const point = vertices[index];
    const before = normals[(index + normals.length - 1) % normals.length];
    const after = normals[index];
    const next = vertices[(index + 1) % vertices.length];

    context.arc(
      point[0],
      point[1],
      radius,
      Math.atan2(before[1], before[0]),
      Math.atan2(after[1], after[0]),
      anticlockwise,
    );
    context.lineTo(
      next[0] + after[0] * radius,
      next[1] + after[1] * radius,
    );
  }

  context.closePath();
}
