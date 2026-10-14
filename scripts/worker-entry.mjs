import assert from 'node:assert/strict';
import { parseAst } from 'rolldown/parseAst';

export function verifyWorkerEntry(mainSource, workerSource)
{
  const exports = (source, dependency, identity) =>
  {
    const names = [];
    for (const node of parseAst(source).body)
    {
      // 复制产物只适用于纯重导出；新增 Worker 初始化或副作用必须使构建失败。
      assert(node.type === 'ExportNamedDeclaration' && node.source?.value === dependency && !node.declaration,
        'Runtime entries must remain pure named re-exports');
      for (const specifier of node.specifiers)
      {
        assert(specifier.type === 'ExportSpecifier' && typeof specifier.exported.name === 'string');
        if (identity) assert.equal(specifier.local.name, specifier.exported.name, 'Worker must preserve export bindings');
        names.push(specifier.exported.name);
      }
    }
    assert(names.includes('default'), 'Runtime entry must expose its default export');
    return names.sort();
  };
  assert.deepEqual(exports(workerSource, './fx.js', true), exports(mainSource, './engine-core.js', false),
    'Worker and main export contracts differ');
}
