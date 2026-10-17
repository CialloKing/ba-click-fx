import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAst } from 'rolldown/parseAst';
import { fileURLToPath } from 'node:url';
import { ENGINE_MODULES, ENGINE_RUNTIMES } from '../scripts/engine-module-list.js';
import { inlineEngineParts } from '../scripts/engine-source.mjs';

const graph = new Map();
for (const file of ENGINE_MODULES)
{
  const ast = parseAst(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'));
  const dependencies = ast.body.filter(node => node.type === 'ImportDeclaration')
    .map(node => node.source.value.replace(/^\.\//, '')).filter(name => ENGINE_MODULES.includes(name));
  assert(!dependencies.includes('engine-core.js'), `${file} must not import the entry`);
  graph.set(file, dependencies);
  if (ENGINE_RUNTIMES.includes(file))
  {
    const cls = ast.body.find(node => node.declaration?.type === 'ClassDeclaration').declaration;
    assert(!cls.body.body.some(node => node.key.name === 'constructor'), `${file} preserves entry initialization`);
  }
}
function visit(file, ancestors = [])
{
  assert(!ancestors.includes(file), `Cyclic engine dependency: ${[...ancestors, file].join(' -> ')}`);
  for (const dependency of graph.get(file)) visit(dependency, [...ancestors, file]);
}
for (const file of graph.keys()) visit(file);
// 解析最终展开结果可同时发现重复绑定、遗漏的内部导入和无效继承。
const flat = inlineEngineParts(fileURLToPath(new URL('..', import.meta.url)));
assert(!parseAst(flat).body.some(node => node.type === 'ImportDeclaration' &&
  ENGINE_MODULES.includes(node.source.value.replace(/^\.\//, ''))));
console.log(`Core module boundaries passed (${graph.size} modules, no cycles)`);
