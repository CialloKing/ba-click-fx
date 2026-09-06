#!/usr/bin/env node

/**
 * verify-runtime-sync.cjs 与 verify-demo-sync.cjs 共用的静态合同工具。
 * 具体合同按职责分布在两个入口，避免通过环境变量重复读取和计算另一侧正则。
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readText(relativePath)
{
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function verify(condition, message)
{
  if (!condition)
  {
    throw new Error(`[verify-sync] ${message}`);
  }

  console.log(`  ✓ ${message}`);
}

function getFunctionSource(source, name)
{
  const signature = 'function ' + name + '(';
  const start = source.indexOf(signature);

  if (start < 0)
  {
    return '';
  }

  // 参数默认值可能包含对象字面量；函数体花括号固定独占下一行。
  const openingBrace = source.indexOf('\n{', start) + 1;

  if (openingBrace <= 0)
  {
    return '';
  }

  let depth = 0;

  for (let index = openingBrace; index < source.length; index++)
  {
    if (source[index] === '{')
    {
      depth++;
    }
    else if (source[index] === '}')
    {
      depth--;

      if (depth === 0)
      {
        return source.slice(start, index + 1);
      }
    }
  }

  return '';
}

module.exports =
{
  getFunctionSource,
  readText,
  verify,
};
