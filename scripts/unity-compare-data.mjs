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

export function compareRgb(reference, actual)
{
  if (reference.length !== actual.length || reference.length % 4) throw new Error('比较缓冲长度不一致');
  let maximum = 0; let absolute = 0; let squared = 0; let referenceEnergy = 0; let actualEnergy = 0;
  let changedPixels = 0;
  for (let index = 0; index < reference.length; index += 4)
  {
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
  const count = reference.length / 4 * 3;
  return { maximumError: maximum, meanAbsoluteError: absolute / count, rmse: Math.sqrt(squared / count),
    referenceEnergy, actualEnergy, relativeEnergyError: referenceEnergy === 0 ? null : (actualEnergy - referenceEnergy) / referenceEnergy,
    changedPixels, pixels: reference.length / 4 };
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
