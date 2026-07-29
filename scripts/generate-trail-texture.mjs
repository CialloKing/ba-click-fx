import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = '89504e470d0a1a0a';
const EXPECTED_SOURCE_SHA256 =
  '16001511757e7007f43db9613e24144b5e8d726239de0262f55d9e14c0f00feb';
const EXPECTED_RGB_SHA256 =
  '9ef29db2147501c40c1ff0f1cd0848cd6e017a46b0e8aa0af685eef568d4faa0';
const inputPath = process.argv[2];
const outputPath = process.argv[3] ??
  new URL('../src/trail-texture.js', import.meta.url);

if (!inputPath)
{
  throw new Error(
    '用法: node scripts/generate-trail-texture.mjs <FX_TEX_Trail_03.png> [输出文件]',
  );
}

function sha256(value)
{
  return createHash('sha256').update(value).digest('hex');
}

function paeth(left, above, upperLeft)
{
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);

  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance)
  {
    return left;
  }

  if (aboveDistance <= upperLeftDistance)
  {
    return above;
  }

  return upperLeft;
}

function decodePngRgba(source)
{
  if (source.subarray(0, 8).toString('hex') !== PNG_SIGNATURE)
  {
    throw new Error('输入不是有效 PNG');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let offset = 8;
  const imageChunks = [];

  while (offset + 12 <= source.length)
  {
    const length = source.readUInt32BE(offset);
    const type = source.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > source.length)
    {
      throw new Error('PNG chunk 长度越界');
    }

    if (type === 'IHDR')
    {
      width = source.readUInt32BE(dataStart);
      height = source.readUInt32BE(dataStart + 4);
      bitDepth = source[dataStart + 8];
      colorType = source[dataStart + 9];
      interlace = source[dataStart + 12];
    }
    else if (type === 'IDAT')
    {
      imageChunks.push(source.subarray(dataStart, dataEnd));
    }
    else if (type === 'IEND')
    {
      break;
    }

    offset = dataEnd + 4;
  }

  if (
    width !== 512 ||
    height !== 512 ||
    bitDepth !== 8 ||
    colorType !== 6 ||
    interlace !== 0
  )
  {
    throw new Error('Trail 纹理必须是非交错 512x512 RGBA8 PNG');
  }

  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(imageChunks));
  const expectedLength = (stride + 1) * height;

  if (filtered.length !== expectedLength)
  {
    throw new Error('PNG 解压长度与 IHDR 不一致');
  }

  const rgba = Buffer.alloc(width * height * bytesPerPixel);
  let sourceOffset = 0;

  for (let y = 0; y < height; y++)
  {
    const filter = filtered[sourceOffset++];

    for (let x = 0; x < stride; x++)
    {
      const raw = filtered[sourceOffset++];
      const targetOffset = y * stride + x;
      const left = x >= bytesPerPixel
        ? rgba[targetOffset - bytesPerPixel]
        : 0;
      const above = y > 0 ? rgba[targetOffset - stride] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? rgba[targetOffset - stride - bytesPerPixel]
        : 0;
      let predictor = 0;

      if (filter === 1)
      {
        predictor = left;
      }
      else if (filter === 2)
      {
        predictor = above;
      }
      else if (filter === 3)
      {
        predictor = Math.floor((left + above) * 0.5);
      }
      else if (filter === 4)
      {
        predictor = paeth(left, above, upperLeft);
      }
      else if (filter !== 0)
      {
        throw new Error(`不支持的 PNG filter: ${filter}`);
      }

      rgba[targetOffset] = (raw + predictor) & 0xff;
    }
  }

  return { width, height, rgba };
}

function extractRgb(rgba)
{
  const rgb = Buffer.alloc(rgba.length / 4 * 3);
  let targetOffset = 0;

  for (let sourceOffset = 0; sourceOffset < rgba.length; sourceOffset += 4)
  {
    if (rgba[sourceOffset + 3] !== 255)
    {
      throw new Error('Trail 纹理 Alpha 不是恒定 255');
    }

    rgb[targetOffset++] = rgba[sourceOffset];
    rgb[targetOffset++] = rgba[sourceOffset + 1];
    rgb[targetOffset++] = rgba[sourceOffset + 2];
  }

  return rgb;
}

function createPaethResidual(rgb, width, height)
{
  const stride = width * 3;
  const residual = Buffer.alloc(rgb.length);

  for (let y = 0; y < height; y++)
  {
    for (let x = 0; x < stride; x++)
    {
      const offset = y * stride + x;
      const left = x >= 3 ? rgb[offset - 3] : 0;
      const above = y > 0 ? rgb[offset - stride] : 0;
      const upperLeft = y > 0 && x >= 3
        ? rgb[offset - stride - 3]
        : 0;

      residual[offset] = (
        rgb[offset] - paeth(left, above, upperLeft)
      ) & 0xff;
    }
  }

  return residual;
}

function appendExtendedLength(output, length)
{
  let remaining = length;

  while (remaining >= 255)
  {
    output.push(255);
    remaining -= 255;
  }

  output.push(remaining);
}

function readSequenceKey(source, offset)
{
  return (
    source[offset] |
    source[offset + 1] << 8 |
    source[offset + 2] << 16 |
    source[offset + 3] << 24
  ) >>> 0;
}

function encodeLz4Block(source)
{
  const output = [];
  const latestSequence = new Map();
  let anchor = 0;
  let offset = 0;

  while (offset + 4 <= source.length)
  {
    const key = readSequenceKey(source, offset);
    let matchOffset = latestSequence.get(key);

    latestSequence.set(key, offset);

    if (
      matchOffset === undefined ||
      offset - matchOffset > 0xffff
    )
    {
      offset++;
      continue;
    }

    while (
      offset > anchor &&
      matchOffset > 0 &&
      source[offset - 1] === source[matchOffset - 1]
    )
    {
      offset--;
      matchOffset--;
    }

    let matchLength = 4;

    while (
      offset + matchLength < source.length &&
      source[offset + matchLength] === source[matchOffset + matchLength]
    )
    {
      matchLength++;
    }

    const literalLength = offset - anchor;
    const encodedMatchLength = matchLength - 4;
    output.push(
      Math.min(literalLength, 15) << 4 |
      Math.min(encodedMatchLength, 15),
    );

    if (literalLength >= 15)
    {
      appendExtendedLength(output, literalLength - 15);
    }

    for (let index = anchor; index < offset; index++)
    {
      output.push(source[index]);
    }

    const distance = offset - matchOffset;

    output.push(distance & 0xff, distance >> 8);

    if (encodedMatchLength >= 15)
    {
      appendExtendedLength(output, encodedMatchLength - 15);
    }

    const matchStart = offset;

    offset += matchLength;
    anchor = offset;

    // 记录匹配内部的序列，避免大块平坦区域之后丢失最近窗口位置。
    for (let index = matchStart + 1; index + 4 <= offset; index++)
    {
      latestSequence.set(readSequenceKey(source, index), index);
    }

  }

  const literalLength = source.length - anchor;

  output.push(Math.min(literalLength, 15) << 4);

  if (literalLength >= 15)
  {
    appendExtendedLength(output, literalLength - 15);
  }

  for (let index = anchor; index < source.length; index++)
  {
    output.push(source[index]);
  }

  return Buffer.from(output);
}

function formatChunks(encoded, width = 100)
{
  const chunks = [];

  for (let offset = 0; offset < encoded.length; offset += width)
  {
    chunks.push(`  '${encoded.slice(offset, offset + width)}',`);
  }

  return chunks.join('\n');
}

function createModule(width, height, packed)
{
  const encoded = packed.toString('base64');

  return `export const TRAIL_TEXTURE_WIDTH = ${width};
export const TRAIL_TEXTURE_HEIGHT = ${height};
const TRAIL_TEXTURE_CHANNELS = 3;
const TRAIL_TEXTURE_RGB_LENGTH =
  TRAIL_TEXTURE_WIDTH * TRAIL_TEXTURE_HEIGHT * TRAIL_TEXTURE_CHANNELS;

// FX_TEX_Trail_03 的 Alpha 恒为 255。RGB texel 先做逐通道 Paeth 预测，
// 再以 LZ4 block 无损保存；运行时不依赖外部图片或异步解码。
const PACKED_TRAIL_TEXTURE_RGB = [
${formatChunks(encoded)}
].join('');

function decodeBase64Bytes(encoded)
{
  const binary = globalThis.atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++)
  {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function readExtendedLength(source, state)
{
  let length = 0;
  let value = 255;

  while (value === 255)
  {
    if (state.offset >= source.length)
    {
      throw new Error('[BAClickFX] Trail texture LZ4 length overflow');
    }

    value = source[state.offset++];
    length += value;
  }

  return length;
}

function decodeLz4Block(source, outputLength)
{
  const output = new Uint8Array(outputLength);
  const state = { offset: 0 };
  let outputOffset = 0;

  while (state.offset < source.length)
  {
    const token = source[state.offset++];
    let literalLength = token >> 4;

    if (literalLength === 15)
    {
      literalLength += readExtendedLength(source, state);
    }

    if (
      state.offset + literalLength > source.length ||
      outputOffset + literalLength > output.length
    )
    {
      throw new Error('[BAClickFX] Trail texture LZ4 literal overflow');
    }

    output.set(
      source.subarray(state.offset, state.offset + literalLength),
      outputOffset,
    );
    state.offset += literalLength;
    outputOffset += literalLength;

    if (state.offset === source.length)
    {
      break;
    }

    if (state.offset + 2 > source.length)
    {
      throw new Error('[BAClickFX] Trail texture LZ4 offset overflow');
    }

    const matchDistance = source[state.offset] |
      source[state.offset + 1] << 8;

    state.offset += 2;

    if (matchDistance <= 0 || matchDistance > outputOffset)
    {
      throw new Error('[BAClickFX] Trail texture LZ4 offset is invalid');
    }

    let matchLength = (token & 0x0f) + 4;

    if ((token & 0x0f) === 15)
    {
      matchLength += readExtendedLength(source, state);
    }

    if (outputOffset + matchLength > output.length)
    {
      throw new Error('[BAClickFX] Trail texture LZ4 match overflow');
    }

    const matchOffset = outputOffset - matchDistance;

    for (let index = 0; index < matchLength; index++)
    {
      output[outputOffset++] = output[matchOffset + index];
    }
  }

  if (outputOffset !== output.length)
  {
    throw new Error('[BAClickFX] Trail texture LZ4 output is incomplete');
  }

  return output;
}

function paeth(left, above, upperLeft)
{
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);

  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance)
  {
    return left;
  }

  if (aboveDistance <= upperLeftDistance)
  {
    return above;
  }

  return upperLeft;
}

function decodeTrailTextureRgb()
{
  const packed = decodeBase64Bytes(PACKED_TRAIL_TEXTURE_RGB);
  const residual = decodeLz4Block(packed, TRAIL_TEXTURE_RGB_LENGTH);
  const rgb = new Uint8Array(TRAIL_TEXTURE_RGB_LENGTH);
  const stride = TRAIL_TEXTURE_WIDTH * TRAIL_TEXTURE_CHANNELS;

  for (let y = 0; y < TRAIL_TEXTURE_HEIGHT; y++)
  {
    for (let x = 0; x < stride; x++)
    {
      const offset = y * stride + x;
      const left = x >= TRAIL_TEXTURE_CHANNELS
        ? rgb[offset - TRAIL_TEXTURE_CHANNELS]
        : 0;
      const above = y > 0 ? rgb[offset - stride] : 0;
      const upperLeft = y > 0 && x >= TRAIL_TEXTURE_CHANNELS
        ? rgb[offset - stride - TRAIL_TEXTURE_CHANNELS]
        : 0;

      rgb[offset] = (
        residual[offset] + paeth(left, above, upperLeft)
      ) & 0xff;
    }
  }

  return rgb;
}

export const TRAIL_TEXTURE_RGB = decodeTrailTextureRgb();

function createTrailTextureRgba(rgb)
{
  const pixelCount = TRAIL_TEXTURE_WIDTH * TRAIL_TEXTURE_HEIGHT;
  const rgba = new Uint8Array(pixelCount * 4);

  for (let pixel = 0; pixel < pixelCount; pixel++)
  {
    const sourceOffset = pixel * TRAIL_TEXTURE_CHANNELS;
    const outputOffset = pixel * 4;
    const red = rgb[sourceOffset];
    const green = rgb[sourceOffset + 1];
    const blue = rgb[sourceOffset + 2];

    rgba[outputOffset] = red;
    rgba[outputOffset + 1] = green;
    rgba[outputOffset + 2] = blue;
    // 原纹理 Alpha 恒为 1，透明宿主改用二值 RGB 支持面。Bilinear 只在
    // 纹理边界插值 Coverage，不会把 HDR 明度重新解释为 Alpha。
    rgba[outputOffset + 3] = red || green || blue ? 255 : 0;
  }

  return rgba;
}

export const TRAIL_TEXTURE_RGBA = createTrailTextureRgba(TRAIL_TEXTURE_RGB);
`;
}

const png = readFileSync(inputPath);

if (sha256(png) !== EXPECTED_SOURCE_SHA256)
{
  throw new Error('输入 PNG 的 SHA256 与已审计 FX_TEX_Trail_03 不一致');
}

const { width, height, rgba } = decodePngRgba(png);
const rgb = extractRgb(rgba);

if (sha256(rgb) !== EXPECTED_RGB_SHA256)
{
  throw new Error('PNG 解码后的 RGB SHA256 与审计值不一致');
}

const residual = createPaethResidual(rgb, width, height);
const packed = encodeLz4Block(residual);

writeFileSync(outputPath, createModule(width, height, packed), 'utf8');
console.log(
  `已生成 ${outputPath}: ${rgb.length} RGB bytes -> ${packed.length} packed bytes`,
);
