import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compressResource } from './resource-compression.mjs';
import { parseAst } from 'rolldown/parseAst';
import { TRAIL_TEXTURE_RGB, TRAIL_TEXTURE_COVERAGE } from '../src/trail-texture.js';
import { RING_MESH_VERTICES, RING_MESH_INDICES } from '../src/ring-mesh.js';

const inflateImport = "import { inflateSync } from 'fflate/browser';\n";

function base64Strings(node, result = [])
{
  if (!node || typeof node !== 'object')
  {
    return result;
  }
  if (node.type === 'Literal' && typeof node.value === 'string')
  {
    if (/^[A-Za-z0-9+/=]{4,}$/.test(node.value))
    {
      result.push(node.value);
    }
    return result;
  }
  for (const value of Object.values(node))
  {
    if (Array.isArray(value))
    {
      value.forEach(child => base64Strings(child, result));
    }
    else if (value && typeof value === 'object')
    {
      base64Strings(value, result);
    }
  }
  return result;
}

async function compressedResource(root, filename, name, decode, chunks, encoding)
{
  const code = readFileSync(join(root, 'src', filename), 'utf8');
  const declarations = parseAst(code).body.flatMap(statement =>
    (statement.declaration ?? statement).declarations ?? []);
  const declaration = declarations.find(item => item.id.name === name);
  if (!declaration || code.split(decode).length !== 2)
  {
    throw new Error('Resource layout changed: ' + filename);
  }
  const encoded = base64Strings(declaration.init);
  // Circle 的最后一个短块也参与解码；块不能因长度较短而被丢弃。
  const bytes = chunks ? Buffer.concat(encoded.map(value => Buffer.from(value, 'base64')))
    : Buffer.from(encoded.join(''), 'base64');
  const packed = JSON.stringify((await compressResource(bytes, encoding)).toString('base64'));
  return inflateImport + rewriteResource(root, filename, { [name]: chunks ? `[${packed}]` : packed })
    .replace(decode, `inflateSync(${decode})`);
}

async function meshSource(root, encoding)
{
  const values = {};
  for (const [name, array, floats] of [
    ['RING_MESH_VERTICES', RING_MESH_VERTICES, true],
    ['RING_MESH_INDICES', RING_MESH_INDICES, false],
  ])
  {
    const bytes = Buffer.alloc(array.length * (floats ? 4 : 2));
    array.forEach((value, index) => floats ? bytes.writeFloatLE(value, index * 4)
      : bytes.writeUInt16LE(value, index * 2));
    values[name] = `decodeMeshBytes(${JSON.stringify((await compressResource(bytes, encoding)).toString('base64'))}, ${floats}, ${array.length})`;
  }
  // 明确指定小端，保留原 Float32 位模式，不重新生成近似的圆环几何。
  return inflateImport + `function decodeMeshBytes(encoded, floats, length)
{
  const packed = Uint8Array.from(atob(encoded), item => item.charCodeAt(0));
  const bytes = inflateSync(packed);
  const stride = floats ? 4 : 2;
  if (bytes.length !== length * stride)
  {
    throw new Error('Invalid ring mesh length');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = floats ? new Float32Array(length) : new Uint16Array(length);
  for (let index = 0; index < length; index++)
  {
    output[index] = floats ? view.getFloat32(index * stride, true) : view.getUint16(index * stride, true);
  }
  return output;
}
` + rewriteResource(root, 'ring-mesh.js', values);
}

export async function createBuildResources(root, profile)
{
  const sources = new Map();
  if (profile.resources.encoding === 'original')
  {
    return sources;
  }
  if (profile.features.trail)
  {
    sources.set('trail-texture.js', (await trailSource(root, profile.resources.trailSize, false, profile.resources.encoding)).source);
  }
  if (profile.features.click)
  {
    sources.set('circle-texture.js', await compressedResource(root, 'circle-texture.js', 'RUNS_BASE64_CHUNKS',
      'decodeBase64Chunks(RUNS_BASE64_CHUNKS)', true, profile.resources.encoding));
    sources.set('ring3-alpha.js', await compressedResource(root, 'ring3-alpha.js', 'PACKED_RING3_ALPHA',
      'decodeBase64Bytes(PACKED_RING3_ALPHA)', false, profile.resources.encoding));
    sources.set('ring-mesh.js', await meshSource(root, profile.resources.encoding));
  }
  return sources;
}

export function resourceNotices(root, modules)
{
  let text = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  if (modules.some(module => module.id.includes('/fflate/')) && !/^## fflate\s*$/m.test(text))
  {
    text += '\n\n## fflate\n\n' + readFileSync(join(root, 'node_modules/fflate/LICENSE'), 'utf8');
  }
  return text;
}

export function replaceRanges(code, edits)
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

export async function compressTexture(data, channels, width, encoding = 'deflate')
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
  return compressResource(residual, encoding);
}

export function resizeTexture(source, channels, width)
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

export function rewriteResource(root, filename, values, functions = {})
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

export async function trailSource(root, width, external, encoding = 'deflate')
{
  const rgb = await compressTexture(resizeTexture(TRAIL_TEXTURE_RGB, 3, width), 3, width, encoding);
  const coverage = await compressTexture(resizeTexture(TRAIL_TEXTURE_COVERAGE, 1, width), 1, width, encoding);
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
