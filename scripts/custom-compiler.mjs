import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'rolldown/parseAst';
import { minifySync } from 'rolldown/experimental';
import { createRelativeOklchTheme } from '../src/theme-color.js';

export function walk(node, visit, parent = null)
{
  if (!node || typeof node !== 'object') return;
  visit(node, parent);
  for (const value of Object.values(node))
  {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, node));
    else if (value?.type) walk(value, visit, node);
  }
}

function edit(code, edits)
{
  // 外层表达式优先，禁止嵌套 AST 范围的重复替换破坏源码。
  const selected = [];
  for (const change of edits.sort((a, b) => a[0] - b[0] || b[1] - a[1]))
  {
    if (!selected.length || change[0] >= selected.at(-1)[1]) selected.push(change);
  }
  for (const [start, end, text] of selected.reverse()) code = code.slice(0, start) + text + code.slice(end);
  return code;
}

function compress(code)
{
  const result = minifySync('custom.js', code, {
    module: true, mangle: false,
    compress: { joinVars: false, sequences: false, keepNames: { function: true, class: true } },
    codegen: { removeWhitespace: false },
  });
  if (result.errors.length) throw new Error(JSON.stringify(result.errors));
  return result.code;
}

function memberNames(code)
{
  const names = new Set();
  walk(parseAst(code), node =>
  {
    if (node.type === 'MemberExpression' && !node.computed) names.add(node.property.name);
  });
  return names;
}

function pruneClasses(code, roots)
{
  const edits = [];
  walk(parseAst(code), node =>
  {
    if (node.type !== 'ClassDeclaration') return;
    const methods = new Map(node.body.body.map(member => [member.key.name, member]));
    const reached = new Set(['constructor', ...[...roots].filter(name => methods.has(name))]);
    const queue = [...reached];
    for (let i = 0; i < queue.length; i++)
    {
      walk(methods.get(queue[i]), child =>
      {
        if (child.type === 'MemberExpression' && child.object.type === 'ThisExpression' &&
            methods.has(child.property.name) && !reached.has(child.property.name))
        {
          reached.add(child.property.name);
          queue.push(child.property.name);
        }
      });
    }
    for (const [name, member] of methods) if (!reached.has(name)) edits.push([member.start, member.end, '']);
  });
  return compress(edit(code, edits));
}

export function customApi(profile)
{
  return ['resize', 'setPaused', 'clear', 'destroy', 'getConfig', 'getFxConfig', 'getEffectiveHostCompositing',
    ...(profile.features.click ? ['boom'] : []),
    ...(profile.features.trail ? ['clearTrail'] : []),
    ...(profile.runtime !== 'dom' && (profile.features.click || profile.features.trail)
      ? ['pointerDown', 'pointerMove', 'pointerUp', 'pointerCancel'] : []),
    ...(profile.features.compositingReference ? ['setCompositingReference'] : [])];
}

export function compileCustomSources(root, profile)
{
  const gpu = ['webgl2', 'webgl2-bloom', 'webgpu', 'webgpu-hdr'].includes(profile.backend);
  const flags = {
    CUSTOM_BUILD: true, BUILD_DOM: profile.runtime === 'dom',
    BUILD_WORKER: profile.runtime === 'worker',
    BUILD_WEBGL: ['webgl2', 'webgl2-bloom'].includes(profile.backend),
    BUILD_WEBGPU: profile.backend.startsWith('webgpu'), BUILD_WEBGL_BLOOM: false,
    BUILD_CANVAS: !gpu, BUILD_SOFTWARE: profile.backend === 'software',
    BUILD_NATIVE: profile.backend === 'native', BUILD_CLICK: profile.features.click,
    BUILD_TRAIL: profile.features.trail, BUILD_SHARDS: profile.features.shards,
    BUILD_BLOOM: profile.features.bloom, BUILD_REFERENCE: profile.features.compositingReference,
  };
  const sources = new Map();
  for (const filename of readdirSync(join(root, 'src')).filter(name => name.endsWith('.js')))
  {
    if (filename === 'build-capabilities.js') continue;
    let code = readFileSync(join(root, 'src', filename), 'utf8');
    const ast = parseAst(code);
    const edits = [];
    walk(ast, (node, parent) =>
    {
      if (node.type === 'ImportDeclaration' && node.source.value === './build-capabilities.js')
      {
        edits.push([node.start, node.end, "import { FIXED_CONFIG, FIXED_FX, FIXED_THEME } from 'virtual:ba-click-fx-profile';"]);
      }
      if (node.type === 'Identifier' && Object.hasOwn(flags, node.name) && parent?.type !== 'ImportSpecifier')
      {
        edits.push([node.start, node.end, String(flags[node.name])]);
      }
      if (node.type === 'MemberExpression' && node.object.type === 'MemberExpression' &&
          node.object.object.type === 'ThisExpression' && node.object.property.name === 'config' &&
          Object.hasOwn(profile.config, node.property.name) &&
          !(parent?.type === 'AssignmentExpression' && parent.left === node))
      {
        edits.push([node.start, node.end, JSON.stringify(profile.config[node.property.name])]);
      }
      if (node.type === 'MemberExpression' && !(parent?.type === 'AssignmentExpression' && parent.left === node))
      {
        const path = [];
        let target = node;
        while (target.type === 'MemberExpression' && !target.computed)
        {
          path.unshift(target.property.name);
          target = target.object;
        }
        let value;
        if (target.type === 'ThisExpression' && ['fxConfig', 'fx'].includes(path[0]))
          value = path.slice(1).reduce((current, key) => current?.[key], profile.fxParams);
        else if (target.type === 'Identifier')
        {
          const aliases = { fxConfig: profile.fxParams, bloomCfg: profile.fxParams.bloom,
            trailCfg: profile.fxParams.trail, shardCfg: profile.fxParams.shards, ringCfg: profile.fxParams.rings };
          if (Object.hasOwn(aliases, target.name)) value = path.reduce((current, key) => current?.[key], aliases[target.name]);
        }
        if (['number', 'boolean', 'string'].includes(typeof value)) edits.push([node.start, node.end, JSON.stringify(value)]);
      }
      if (filename === 'fx.js' && node.type === 'ExportNamedDeclaration' && !node.declaration)
      {
        edits.push([node.start, node.end, '']);
      }
      if (filename === 'fx.js' && node.type === 'ImportDeclaration' && node.source.value === './config.js')
      {
        const specs = node.specifiers.filter(spec => spec.local.name !== 'UNITY_FX_TOUCH');
        edits.push([node.start, node.end, `import { ${specs.map(spec => spec.local.name).join(', ')} } from './config.js';
import { FIXED_FX as UNITY_FX_TOUCH } from 'virtual:ba-click-fx-profile';`]);
      }
      if (filename === 'fx.js' && node.type === 'MethodDefinition' && parent?.type === 'ClassBody')
      {
        const name = node.key.name;
        const dynamic = ['setThemeColor', 'setThemeColorMode', 'setInputSamplingRate', 'updateConfig',
          'setFxParams', 'setFxParam', 'setTriangleRoundness', 'resetFxConfig'];
        if (dynamic.includes(name)) edits.push([node.start, node.end, '']);
      }
    });
    sources.set(filename, compress(edit(code, edits)));
  }
  // 元数据构造有递归 freeze 等副作用，不能只依赖打包器猜测其纯度。
  // 这些声明只供构建工具/完整版调用，定制配置已在 Node 中验证完成。
  let configCode = sources.get('config.js');
  const configEdits = [];
  const runtimeExports = new Set();
  for (const [name, code] of sources)
  {
    if (name === 'config.js' || name === 'main.js' || name === 'worker.js') continue;
    for (const node of parseAst(code).body)
      if (node.type === 'ImportDeclaration' && node.source.value === './config.js')
        for (const spec of node.specifiers) runtimeExports.add(spec.imported.name);
  }
  for (const node of parseAst(configCode).body)
  {
    const declaration = node.declaration ?? node;
    const names = declaration.type === 'VariableDeclaration' ? declaration.declarations.map(item => item.id.name)
      : declaration.type === 'FunctionDeclaration' ? [declaration.id.name] : [];
    if (names.some(name => ['UNITY_FX_TOUCH', 'FX_PARAM_SCHEMA', 'FX_PARAM_MIGRATIONS', 'FX_PARAM_SCHEMA_VERSION', 'CONFIG_OVERRIDE_VALIDATORS'].includes(name)))
      configEdits.push([node.start, node.end, '']);
    else if (node.type === 'ExportNamedDeclaration' && !names.some(name => runtimeExports.has(name)))
      configEdits.push([node.start, declaration.start, '']);
  }
  sources.set('config.js', compress(edit(configCode, configEdits)));
  // 方法不会自动 tree-shake。先从公开能力与回调追踪 this 引用，再让现有
  // 优化器移除失去调用者的函数；不复制特效算法，也不通过原型删除伪装裁剪。
  for (let round = 0; round < 8; round++)
  {
    let changed = false;
    let code = sources.get('fx.js');
    const ast = parseAst(code);
    const cls = ast.body.find(n => n.declaration?.id?.name === 'BAClickFX').declaration;
    const methods = new Map(cls.body.body.map(member => [member.key.name, member]));
    const constantMethods = new Map();
    for (const [name, member] of methods)
    {
      const body = member.value.body.body;
      if (body.length === 1 && body[0].type === 'ReturnStatement' &&
          /^(?:false|true|null|!0|!1|void 0)$/.test(code.slice(body[0].argument?.start, body[0].argument?.end)))
        constantMethods.set(name, code.slice(body[0].argument.start, body[0].argument.end));
    }
    const inlines = [];
    walk(ast, node =>
    {
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'ThisExpression' && constantMethods.has(node.callee.property.name))
      {
        const args = node.arguments.map(arg => code.slice(arg.start, arg.end));
        inlines.push([node.start, node.end, `(${[...args, constantMethods.get(node.callee.property.name)].join(', ')})`]);
      }
    });
    if (inlines.length)
    {
      sources.set('fx.js', compress(edit(code, inlines)));
      continue;
    }
    const reached = new Set(['constructor', ...customApi(profile)]);
    const queue = [...reached];
    for (let index = 0; index < queue.length; index++)
    {
      walk(methods.get(queue[index]), node =>
      {
        if (node.type === 'MemberExpression' && node.object.type === 'ThisExpression' &&
            methods.has(node.property.name) && !reached.has(node.property.name))
        {
          reached.add(node.property.name);
          queue.push(node.property.name);
        }
      });
    }
    const next = compress(edit(code, [...methods].filter(([name]) => !reached.has(name))
      .map(([, node]) => [node.start, node.end, ''])));
    changed ||= next !== code;
    sources.set('fx.js', next);
    const localAst = parseAst(next);
    const localClasses = localAst.body.filter(n => n.type === 'ClassDeclaration');
    const called = new Set();
    for (const statement of localAst.body)
    {
      if (statement.type === 'ClassDeclaration') continue;
      walk(statement, node =>
      {
        if (node.type === 'MemberExpression' && !node.computed) called.add(node.property.name);
      });
    }
    const removals = [];
    for (const local of localClasses)
    {
      const members = new Map(local.body.body.map(member => [member.key.name, member]));
      const used = new Set(['constructor', ...[...called].filter(name => members.has(name))]);
      const pending = [...used];
      for (let i = 0; i < pending.length; i++)
      {
        walk(members.get(pending[i]), node =>
        {
          if (node.type === 'MemberExpression' && node.object.type === 'ThisExpression' &&
              members.has(node.property.name) && !used.has(node.property.name))
          {
            used.add(node.property.name);
            pending.push(node.property.name);
          }
        });
      }
      for (const [name, node] of members) if (!used.has(name)) removals.push([node.start, node.end, '']);
    }
    if (removals.length)
    {
      sources.set('fx.js', compress(edit(next, removals)));
      changed = true;
    }
    if (!changed) break;
  }
  const rendererNames = ['webgl2-effect.js', 'webgpu-effect.js'];
  const engineRoots = memberNames(sources.get('fx.js'));
  const geometryRoots = new Set(engineRoots);
  for (const filename of rendererNames)
  {
    const code = pruneClasses(sources.get(filename), engineRoots);
    sources.set(filename, code);
    for (const name of memberNames(code)) geometryRoots.add(name);
  }
  sources.set('effect-geometry.js', pruneClasses(sources.get('effect-geometry.js'), geometryRoots));
  {
    const code = sources.get('fx.js');
    const ast = parseAst(code);
    const cls = ast.body.find(node => node.declaration?.id?.name === 'BAClickFX').declaration;
    const hidden = new Set(cls.body.body.map(member => member.key.name)
      .filter(name => name !== 'constructor' && !name.startsWith('_') && !customApi(profile).includes(name)));
    const edits = [];
    walk(cls, node =>
    {
      if (node.type === 'MethodDefinition' && hidden.has(node.key.name))
        edits.push([node.key.start, node.key.end, '_' + node.key.name]);
      if (node.type === 'MemberExpression' && node.object.type === 'ThisExpression' && hidden.has(node.property.name))
        edits.push([node.property.start, node.property.end, '_' + node.property.name]);
    });
    sources.set('fx.js', edit(code, edits));
  }
  for (const [filename, code] of sources)
  {
    const ast = parseAst(code);
    const edits = [];
    for (const node of ast.body.filter(n => n.type === 'ImportDeclaration'))
    {
      const used = new Set();
      walk(ast, (child, parent) =>
      {
        if (child.start >= node.start && child.end <= node.end) return;
        if (child.type === 'Identifier' && !(parent?.type === 'MemberExpression' && parent.property === child && !parent.computed))
          used.add(child.name);
      });
      const specs = node.specifiers.filter(spec => used.has(spec.local.name));
      if (!specs.length || specs.length !== node.specifiers.length)
      {
        const defaults = specs.filter(spec => spec.type === 'ImportDefaultSpecifier').map(spec => spec.local.name);
        const namespaces = specs.filter(spec => spec.type === 'ImportNamespaceSpecifier').map(spec => `* as ${spec.local.name}`);
        const named = specs.filter(spec => spec.type === 'ImportSpecifier').map(spec => spec.imported.name === spec.local.name
          ? spec.local.name : `${spec.imported.name} as ${spec.local.name}`);
        const bindings = [...defaults, ...namespaces, ...(named.length ? [`{ ${named.join(', ')} }`] : [])];
        const text = specs.length ? `import ${bindings.join(', ')} from ${JSON.stringify(node.source.value)};` : '';
        edits.push([node.start, node.end, text]);
      }
    }
    sources.set(filename, edit(code, edits));
  }
  const theme = profile.config.themeColorMode === 'relative-oklch'
    ? createRelativeOklchTheme(profile.config.themeColor) : null;
  const constants = `function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export const FIXED_CONFIG = freeze(${JSON.stringify(profile.config)});
export const FIXED_FX = freeze(${JSON.stringify(profile.fxParams)});
export const FIXED_THEME = freeze(${JSON.stringify(theme)});`;
  return { sources, constants, api: customApi(profile) };
}
