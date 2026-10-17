import { ENGINE_MODULES } from './engine-module-list.js';
let nextFixture = 0;

export function exposeEngineBindings(source, names)
{
  const exported = new Set([...source.matchAll(/export\s*\{([^}]+)\}/g)]
    .flatMap(match => match[1].split(',').map(name => name.trim())));
  for (const match of source.matchAll(/export\s+(?:const|let|function|class)\s+(\w+)/g)) exported.add(match[1]);
  const missing = names.filter(name => !exported.has(name));
  return source + (missing.length ? `\nexport { ${missing.join(', ')} };` : '');
}

// 每次调用创建独立模块图；同一图中的引擎与探针共享缓存的唯一副本。
// 仅测试/诊断引用本文件，发布产物和公共 API 不受影响。
export async function isolatedEngineFixture({ sourceUrl, readSource, transform = (_, source) => source, expose = {} })
{
  const urls = new Map(), pending = new Set(), blobs = [];
  const fixtureId = ++nextFixture;
  const makeUrl = source =>
  {
    if (typeof window === 'undefined' && typeof process !== 'undefined')
      return `data:text/javascript;base64,${Buffer.from(source + `\n// fixture ${fixtureId}`).toString('base64')}`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    blobs.push(url);
    return url;
  };
  readSource ??= async url =>
  {
    const response = await fetch(url);
    if (!response.ok) throw Error(`诊断源码读取失败: ${url} (${response.status})`);
    return response.text();
  };
  async function copy(file)
  {
    if (urls.has(file)) return urls.get(file);
    if (pending.has(file)) throw Error(`诊断模块存在循环依赖: ${file}`);
    pending.add(file);
    const url = new URL(file, sourceUrl);
    let source = await readSource(url);
    // 先重写依赖再注入探针；注入的同模块读写不创建第二份共享状态。
    const matches = [...source.matchAll(/from\s*(['"])([./][^'"]+)\1/g)];
    for (const match of matches.reverse())
    {
      const path = match[2];
      const resolved = new URL(path, url);
      const dependency = resolved.pathname.split('/').at(-1);
      const internal = new URL('.', resolved).href === new URL('.', sourceUrl).href && ENGINE_MODULES.includes(dependency);
      const target = internal ? await copy(dependency) : resolved.href;
      source = source.slice(0, match.index) + `from '${target}'` + source.slice(match.index + match[0].length);
    }
    source = exposeEngineBindings(transform(file, source), expose[file] ?? []);
    const result = makeUrl(source);
    urls.set(file, result);
    pending.delete(file);
    return result;
  }
  try
  {
    let entry = `export * from '${await copy('engine-core.js')}';`;
    for (const [file, names] of Object.entries(expose))
      entry += `\nexport { ${names.join(', ')} } from '${await copy(file)}';`;
    return await import(makeUrl(entry));
  }
  finally { for (const url of blobs) URL.revokeObjectURL(url); }
}
