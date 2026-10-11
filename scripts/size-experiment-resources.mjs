import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { parseAst } from 'rolldown/parseAst';
import { TRAIL_TEXTURE_RGB, TRAIL_TEXTURE_COVERAGE } from '../src/trail-texture.js';

function replaceRanges(code, edits)
{
  for (const [start, end, text] of edits.sort((left, right) => right[0] - left[0]))
  {
    code = code.slice(0, start) + text + code.slice(end);
  }
  return code;
}

function paeth(left, above, corner)
{
  const prediction = left + above - corner;
  const distances = [left, above, corner].map(value => Math.abs(prediction - value));
  return distances[0] <= distances[1] && distances[0] <= distances[2]
    ? left : distances[1] <= distances[2] ? above : corner;
}

function compressTexture(data, channels, width)
{
  const residual = new Uint8Array(data.length);
  const stride = width * channels;
  for (let index = 0; index < data.length; index++)
  {
    const x = index % stride;
    const left = x >= channels ? data[index - channels] : 0;
    const above = index >= stride ? data[index - stride] : 0;
    const corner = index >= stride && x >= channels ? data[index - stride - channels] : 0;
    residual[index] = (data[index] - paeth(left, above, corner) + 256) & 255;
  }
  return deflateRawSync(residual, { level: 9 });
}

function resizeTexture(source, channels, width)
{
  const scale = 512 / width;
  const output = new Uint8Array(width * width * channels);
  for (let y = 0; y < width; y++)
  {
    for (let x = 0; x < width; x++)
    {
      for (let channel = 0; channel < channels; channel++)
      {
        let sum = 0;
        for (let dy = 0; dy < scale; dy++)
        {
          for (let dx = 0; dx < scale; dx++)
          {
            sum += source[((y * scale + dy) * 512 + x * scale + dx) * channels + channel];
          }
        }
        output[(y * width + x) * channels + channel] = Math.round(sum / (scale * scale));
      }
    }
  }
  return output;
}

function rewriteResource(root, filename, values, functions = {})
{
  const code = readFileSync(join(root, 'src', filename), 'utf8');
  const edits = [];
  for (const statement of parseAst(code).body)
  {
    const node = statement.declaration ?? statement;
    if (node.type === 'VariableDeclaration')
    {
      for (const declaration of node.declarations)
      {
        if (Object.hasOwn(values, declaration.id.name))
        {
          edits.push([declaration.init.start, declaration.init.end, values[declaration.id.name]]);
        }
      }
    }
    if (node.type === 'FunctionDeclaration' && Object.hasOwn(functions, node.id.name))
    {
      edits.push([node.start, node.end, functions[node.id.name]]);
    }
  }
  return replaceRanges(code, edits);
}

function trailSource(root, width, external)
{
  const rgb = compressTexture(resizeTexture(TRAIL_TEXTURE_RGB, 3, width), 3, width);
  const coverage = compressTexture(resizeTexture(TRAIL_TEXTURE_COVERAGE, 1, width), 1, width);
  const values = {
    TRAIL_TEXTURE_WIDTH: String(width), TRAIL_TEXTURE_HEIGHT: String(width),
    PACKED_TRAIL_TEXTURE_RGB: JSON.stringify(rgb.toString('base64')),
    PACKED_TRAIL_TEXTURE_COVERAGE: JSON.stringify(coverage.toString('base64')),
  };
  let prefix = "import { inflateSync } from 'fflate/browser';\n";
  let asset = null;
  if (external)
  {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(rgb.length, 0);
    header.writeUInt32LE(coverage.length, 4);
    asset = Buffer.concat([header, rgb, coverage]);
    // 外置方案显式等待资源准备；构造仍同步，但模块导入需要额外请求。
    prefix += `const response = await fetch(new URL('./trail.bin', import.meta.url));
if (!response.ok) { throw new Error('Trail resource request failed: ' + response.status); }
const payload = new Uint8Array(await response.arrayBuffer());
if (payload.length < 8) { throw new Error('Invalid trail resource header'); }
const header = new DataView(payload.buffer);
const rgbEnd = 8 + header.getUint32(0, true);
if (rgbEnd + header.getUint32(4, true) !== payload.length) { throw new Error('Invalid trail resource length'); }
`;
    values.PACKED_TRAIL_TEXTURE_RGB = 'payload.subarray(8, rgbEnd)';
    values.PACKED_TRAIL_TEXTURE_COVERAGE = 'payload.subarray(rgbEnd)';
  }
  const source = rewriteResource(root, 'trail-texture.js', values, {
    decodeLz4Block: `function decodeLz4Block(source, outputLength)
{
  const output = inflateSync(source, { out: new Uint8Array(outputLength) });
  if (output.length !== outputLength)
  {
    throw new Error('Invalid trail texture length');
  }
  return output;
}`,
  });
  return { source: prefix + (external ? source.replace('const packed = decodeBase64Bytes(encoded);', 'const packed = encoded;') : source), asset };
}

function proceduralSources(root)
{
  // 噪声只使用坐标函数，避免消耗粒子系统的随机数并改变运动轨迹。
  const trail = rewriteResource(root, 'trail-texture.js', {
    TRAIL_TEXTURE_WIDTH: '64', TRAIL_TEXTURE_HEIGHT: '64',
    PACKED_TRAIL_TEXTURE_RGB: "''", PACKED_TRAIL_TEXTURE_COVERAGE: "''",
  }, {
    decodePaethTexture: `function decodePaethTexture(encoded, outputLength, channels)
{
  const output = new Uint8Array(outputLength);
  for (let y = 0; y < TRAIL_TEXTURE_HEIGHT; y++)
  {
    for (let x = 0; x < TRAIL_TEXTURE_WIDTH; x++)
    {
      const u = x / TRAIL_TEXTURE_WIDTH * Math.PI * 2;
      const center = 0.5 + Math.sin(u) * 0.08;
      const width = 0.11 + Math.cos(u * 3) * 0.035;
      const energy = Math.exp(-Math.pow((y / TRAIL_TEXTURE_HEIGHT - center) / width, 2)) *
        (0.72 + 0.28 * Math.cos(u * 2)) * (0.86 + 0.14 * Math.sin((x * 17 + y * 31) * 0.31));
      const value = Math.round(255 * (channels === 1 ? Math.pow(energy, 0.65) : energy));
      const offset = (y * TRAIL_TEXTURE_WIDTH + x) * channels;
      for (let channel = 0; channel < channels; channel++) { output[offset + channel] = value; }
    }
  }
  return output;
}`,
  });
  const circle = rewriteResource(root, 'circle-texture.js', {
    CIRCLE_TEXTURE_SIZE: '64', RUNS_BASE64_CHUNKS: '[]',
  }, {
    decodeCircleTexture: `function decodeCircleTexture()
{
  const output = new Uint8Array(CIRCLE_TEXTURE_SIZE * CIRCLE_TEXTURE_SIZE * 4);
  for (let y = 0; y < CIRCLE_TEXTURE_SIZE; y++)
  {
    for (let x = 0; x < CIRCLE_TEXTURE_SIZE; x++)
    {
      const radius = Math.hypot((x + 0.5) / CIRCLE_TEXTURE_SIZE * 2 - 1, (y + 0.5) / CIRCLE_TEXTURE_SIZE * 2 - 1);
      const offset = (y * CIRCLE_TEXTURE_SIZE + x) * 4;
      output[offset] = output[offset + 2] = Math.round(255 * Math.exp(-Math.pow(radius * 1.65, 6)));
      output[offset + 1] = Math.round(255 * Math.exp(-Math.pow(radius * 2.2, 4)));
      output[offset + 3] = 255;
    }
  }
  return output;
}`,
  });
  const ring = rewriteResource(root, 'ring3-alpha.js', { PACKED_RING3_ALPHA: "''" }, {
    decodeRing3Alpha: `function decodeRing3Alpha()
{
  const output = new Uint8Array(RING3_ALPHA_WIDTH * RING3_ALPHA_HEIGHT);
  for (let y = 0; y < RING3_ALPHA_HEIGHT; y++)
  {
    for (let x = 0; x < RING3_ALPHA_WIDTH; x++)
    {
      const u = x / RING3_ALPHA_WIDTH * Math.PI * 2;
      const v = y / (RING3_ALPHA_HEIGHT - 1);
      const wave = 0.68 + 0.32 * Math.sin(u * 3 + Math.sin(v * Math.PI * 2) * 1.5);
      output[y * RING3_ALPHA_WIDTH + x] = Math.round(255 * (0.2 + 0.8 * Math.pow(v, 0.75)) * wave);
    }
  }
  return output;
}`,
  });
  return new Map([['trail-texture.js', trail], ['circle-texture.js', circle], ['ring3-alpha.js', ring]]);
}

export function createExperimentResources(root, strategy)
{
  const sources = new Map();
  const assets = new Map();
  if (strategy === 'procedural')
  {
    return { sources: proceduralSources(root), assets, exact: false, asynchronous: false };
  }
  if (['lossless-deflate', 'trail-256', 'trail-128', 'external-deflate'].includes(strategy))
  {
    const width = strategy === 'trail-256' ? 256 : strategy === 'trail-128' ? 128 : 512;
    const result = trailSource(root, width, strategy === 'external-deflate');
    sources.set('trail-texture.js', result.source);
    if (result.asset)
    {
      assets.set('trail.bin', result.asset);
    }
  }
  return { sources, assets, exact: !['trail-256', 'trail-128'].includes(strategy),
    asynchronous: strategy === 'external-deflate' };
}

export function markResourceInitializersPure(code, filename)
{
  if (!['triangle-texture.js', 'circle-texture.js', 'trail-texture.js', 'ring3-alpha.js', 'ring-mesh.js'].includes(filename))
  {
    return code;
  }
  // 仅标注已知的静态资源构造；这些调用只修改自己新建的数组。
  // 不关闭整个模块的副作用分析，以免删掉渲染器注册或宿主初始化。
  const ast = parseAst(code);
  const positions = new Set();
  const visit = node =>
  {
    if (!node || typeof node !== 'object')
    {
      return;
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
      node.callee.object.name === 'Object' && node.callee.property.name === 'freeze')
    {
      positions.add(node.start);
    }
    for (const value of Object.values(node))
    {
      if (Array.isArray(value))
      {
        value.forEach(visit);
      }
      else if (value?.type)
      {
        visit(value);
      }
    }
  };
  visit(ast);
  for (const statement of ast.body)
  {
    const node = statement.declaration ?? statement;
    if (node.type !== 'VariableDeclaration')
    {
      continue;
    }
    for (const declaration of node.declarations)
    {
      if (['CallExpression', 'NewExpression'].includes(declaration.init?.type))
      {
        positions.add(declaration.init.start);
      }
    }
  }
  return replaceRanges(code, [...positions].map(position => [position, position, '/* @__PURE__ */ ']));
}
