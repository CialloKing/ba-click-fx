import { gunzipSync, deflateSync } from 'node:zlib';

export function decodeHalf(bytes)
{
  if (bytes.length % 2) throw new Error('Half 缓冲长度无效');
  const output = new Float32Array(bytes.length / 2);
  for (let index = 0; index < output.length; index++)
  {
    const word = bytes[index * 2] | bytes[index * 2 + 1] << 8;
    const sign = word & 0x8000 ? -1 : 1;
    const exponent = word >> 10 & 31;
    const fraction = word & 1023;
    output[index] = sign * (exponent === 0 ? fraction * 2 ** -24
      : exponent === 31 ? fraction ? NaN : Infinity : (1 + fraction / 1024) * 2 ** (exponent - 15));
  }
  return output;
}

export function decodeUnityBuffer(gzip, width, height)
{
  const bytes = gunzipSync(gzip);
  if (bytes.length !== width * height * 8) throw new Error('Unity 缓冲尺寸与数据长度不匹配');
  return decodeHalf(bytes);
}

export function srgbEncode(value)
{
  const linear = Math.max(0, Math.min(1, value));
  return linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
}

export function srgbDecode(value)
{
  const encoded = Math.max(0, Math.min(1, value));
  return encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
}

export function summarizeTrailMesh(trail, state)
{
  const transform = (point, matrix) =>
  {
    if (!matrix) return point;
    // JsonUtility 使用 Matrix4x4 的序列化字段 e00，测试输入也接受公开属性 m00。
    const entry = (row, column) => matrix[`e${row}${column}`] ?? matrix[`m${row}${column}`];
    const component = row => entry(row, 0) * point.x + entry(row, 1) * point.y +
      entry(row, 2) * point.z + entry(row, 3) * (point.w ?? 1);
    return { x: component(0), y: component(1), z: component(2), w: component(3) };
  };
  const projected = trail.vertices.map(point =>
  {
    const clip = transform(transform(point, state.cameraWorldToCamera), state.cameraProjection);
    return { x: clip.x / (clip.w ?? 1), y: clip.y / (clip.w ?? 1) };
  });
  let visibleTriangles = 0; let projectedArea = 0;
  for (let index = 0; index < trail.indices.length; index += 3)
  {
    const [a, b, c] = trail.indices.slice(index, index + 3).map(value => projected[value]);
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * 0.5;
    if (!Number.isFinite(area)) throw new Error('拖尾投影包含非有限值');
    if (area > 0) visibleTriangles++;
    projectedArea += area;
  }
  return { name: trail.name, positions: trail.positions.length, triangles: trail.indices.length / 3,
    visibleTriangles, projectedArea, projectionDomain: state.cameraProjection ? 'NDC' : 'world-XY',
    widthMultiplier: trail.width, curve: [trail.widthCurveStart, trail.widthCurveMiddle, trail.widthCurveEnd],
    alignment: trail.alignment, emitting: trail.emitting };
}

export function compareRgb(reference, actual, mask = null)
{
  if (reference.length !== actual.length || reference.length % 4) throw new Error('比较缓冲长度不一致');
  let maximum = 0; let absolute = 0; let squared = 0; let referenceEnergy = 0; let actualEnergy = 0;
  let changedPixels = 0; let pixels = 0;
  for (let index = 0; index < reference.length; index += 4)
  {
    if (mask && !mask[index / 4]) continue;
    pixels++;
    let changed = false;
    for (let channel = 0; channel < 3; channel++)
    {
      const a = reference[index + channel]; const b = actual[index + channel];
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('比较缓冲含非有限 RGB');
      const delta = Math.abs(a - b);
      maximum = Math.max(maximum, delta); absolute += delta; squared += delta * delta;
      referenceEnergy += a; actualEnergy += b; changed ||= delta !== 0;
    }
    if (changed) changedPixels++;
  }
  const count = Math.max(1, pixels * 3);
  return { maximumError: maximum, meanAbsoluteError: absolute / count, rmse: Math.sqrt(squared / count),
    referenceEnergy, actualEnergy, relativeEnergyError: referenceEnergy === 0 ? null : (actualEnergy - referenceEnergy) / referenceEnergy,
    changedPixels, pixels };
}

export function compareForegroundRgb(reference, actual, baseline = actual)
{
  if (baseline.length !== actual.length) throw new Error('前景基线尺寸不一致');
  const mask = new Uint8Array(reference.length / 4);
  for (let index = 0; index < reference.length; index += 4)
  {
    // 前后版本使用同一并集遮罩，保留多出的尾迹，不允许裁小比较区域提高得分。
    mask[index / 4] = [reference, actual, baseline].some(values =>
      Math.max(values[index], values[index + 1], values[index + 2]) > 1 / 255);
  }
  return { actual: compareRgb(reference, actual, mask), baseline: compareRgb(reference, baseline, mask), threshold: 1 / 255 };
}

export function trailEndpoints(trail, width = 1950, height = 1097)
{
  if (!trail.vertices.length) return null;
  const endpoint = u =>
  {
    const edge = v => trail.vertices.find((_, i) =>
      Math.abs(trail.uv[i].x - u) < 1e-6 && Math.abs(trail.uv[i].y - v) < 1e-6);
    const left = edge(0); const right = edge(1);
    if (!left || !right || Math.hypot(left.x - right.x, left.y - right.y) < 1e-8) return null;
    return { x: width / 2 + (left.x + right.x) * height / 4,
      y: height / 2 - (left.y + right.y) * height / 4 };
  };
  const start = endpoint(1); const end = endpoint(0);
  return start && end ? { start, end } : null;
}

function crc32(bytes)
{
  let crc = -1;
  for (const byte of bytes)
  {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(name, data)
{
  const type = Buffer.from(name);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([header, type, data, crc]);
}

export function encodePreview(data, width, height, { encoded = false, reference = null } = {})
{
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++)
  for (let channel = 0; channel < 3; channel++)
  {
    // 两种图形 API 在读取时显式统一为 bottom-left；PNG 必须写 top-left。
    const index = ((height - 1 - y) * width + x) * 4 + channel;
    const value = reference ? Math.min(1, Math.abs(data[index] - reference[index]) * 16)
      : encoded ? Math.max(0, Math.min(1, data[index])) : srgbEncode(data[index]);
    raw[y * (width * 3 + 1) + x * 3 + channel + 1] = Math.round(value * 255);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
