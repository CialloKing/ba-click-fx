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

function trailSource(root, width, rgb, coverage)
{
  const code = readFileSync(join(root, 'src/trail-texture.js'), 'utf8');
  const values = {
    TRAIL_TEXTURE_WIDTH: String(width), TRAIL_TEXTURE_HEIGHT: String(width),
    PACKED_TRAIL_TEXTURE_RGB: JSON.stringify(compressTexture(rgb, 3, width).toString('base64')),
    PACKED_TRAIL_TEXTURE_COVERAGE: JSON.stringify(compressTexture(coverage, 1, width).toString('base64')),
  };
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
    if (node.type === 'FunctionDeclaration' && node.id.name === 'decodeLz4Block')
    {
      edits.push([node.start, node.end, `function decodeLz4Block(source, outputLength)
{
  const output = inflateSync(source, { out: new Uint8Array(outputLength) });
  if (output.length !== outputLength)
  {
    throw new Error('Invalid trail texture length');
  }
  return output;
}`]);
    }
  }
  return "import { inflateSync } from 'fflate/browser';\n" + replaceRanges(code, edits);
}

export function createExperimentResources(root, strategy)
{
  const sources = new Map();
  if (strategy === 'lossless-deflate')
  {
    sources.set('trail-texture.js', trailSource(root, 512, TRAIL_TEXTURE_RGB, TRAIL_TEXTURE_COVERAGE));
  }
  return { sources, assets: new Map(), exact: true, asynchronous: false };
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
