import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'rolldown/parseAst';
import { ENGINE_MODULES, ENGINE_RUNTIMES } from './engine-module-list.js';

// 只静态展开清单内的模块。普通构建仍使用原生 ESM 和显式继承。
export function inlineEngineParts(root)
{
  const imports = new Map(), bindings = new Map(), declarations = new Set();
  const bodies = [], methods = [];
  let core;
  for (const filename of ENGINE_MODULES)
  {
    const source = readFileSync(join(root, 'src', filename), 'utf8');
    const edits = [];
    for (const node of parseAst(source).body)
    {
      if (node.type === 'ImportDeclaration')
      {
        const path = node.source.value;
        edits.push([node.start, node.end, '']);
        if (ENGINE_MODULES.includes(path.replace(/^\.\//, ''))) continue;
        const group = imports.get(path) ?? new Map();
        imports.set(path, group);
        for (const spec of node.specifiers)
        {
          const imported = spec.type === 'ImportSpecifier' ? spec.imported.name
            : spec.type === 'ImportDefaultSpecifier' ? 'default' : '*';
          const identity = `${path}:${imported}`;
          if (bindings.has(spec.local.name) && bindings.get(spec.local.name) !== identity)
            throw Error(`内部导入名称冲突: ${spec.local.name}`);
          bindings.set(spec.local.name, identity);
          group.set(spec.local.name, imported);
        }
        continue;
      }
      const declaration = node.declaration ?? node;
      if (ENGINE_RUNTIMES.includes(filename) && declaration.type === 'ClassDeclaration')
      {
        for (const member of declaration.body.body)
        {
          if (member.key.name === 'constructor') throw Error(`职责层不得增加构造函数: ${filename}`);
          if (methods.some(entry => entry.name === member.key.name)) throw Error(`职责方法重名: ${member.key.name}`);
          methods.push({ name: member.key.name, source: source.slice(member.start, member.end) });
        }
        edits.push([node.start, node.end, '']);
        continue;
      }
      const names = declaration.type === 'VariableDeclaration'
        ? declaration.declarations.map(value => value.id.name) : declaration.id ? [declaration.id.name] : [];
      for (const name of names)
      {
        if (declarations.has(name)) throw Error(`内部声明名称冲突: ${name}`);
        declarations.add(name);
      }
      if (filename !== 'engine-core.js' && node.type.startsWith('Export'))
        edits.push([node.start, node.declaration ? node.declaration.start : node.end, '']);
      if (filename === 'engine-core.js' && declaration.id?.name === 'BAClickFX')
      {
        edits.push([declaration.id.end, declaration.body.start, '\n']);
        const constructor = declaration.body.body.find(member => member.key.name === 'constructor');
        const superCall = constructor.value.body.body[0];
        if (superCall.expression?.callee?.type !== 'Super') throw Error('入口构造必须先调用 super');
        edits.push([superCall.start, superCall.end, '']);
        edits.push([declaration.body.end - 1, declaration.body.end - 1, '\n' + methods.map(value => value.source).join('\n') + '\n']);
      }
    }
    let body = source;
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0]))
      body = body.slice(0, start) + replacement + body.slice(end);
    if (filename === 'engine-core.js') core = body;
    else bodies.push(body);
  }
  for (const name of declarations)
    if (bindings.has(name)) throw Error(`导入与内部声明冲突: ${name}`);
  const header = [];
  for (const [path, group] of imports)
  {
    const named = [];
    if (!group.size) header.push(`import '${path}';`);
    for (const [local, imported] of group)
    {
      if (imported === '*') header.push(`import * as ${local} from '${path}';`);
      else named.push(imported === local ? local : `${imported} as ${local}`);
    }
    if (named.length) header.push(`import { ${named.join(', ')} } from '${path}';`);
  }
  return [...header, ...bodies, core].join('\n');
}
