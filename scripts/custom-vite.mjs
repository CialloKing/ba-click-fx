import { basename, resolve } from 'node:path';
import { compileCustomSources } from './custom-compiler.mjs';
import { createBuildResources, markResourceInitializersPure } from './build-resources.mjs';
import { minifySync } from 'rolldown/experimental';

export function customVite(root, profile)
{
  const compiled = compileCustomSources(root, profile);
  const resources = createBuildResources(root, profile);
  const compact = profile.resources.encoding === 'deflate';
  return {
    name: 'ba-click-fx-profile', enforce: 'pre',
    resolveId(id)
    {
      if (id === 'virtual:ba-click-fx-profile') return '\0' + id;
    },
    load(id)
    {
      if (id === '\0virtual:ba-click-fx-profile') return compiled.constants;
      if (id.replaceAll('\\', '/').startsWith(resolve(root, 'src').replaceAll('\\', '/') + '/'))
      {
        const filename = basename(id);
        const code = resources.get(filename) ?? compiled.sources.get(filename);
        return compact && code ? markResourceInitializersPure(code, filename) : code;
      }
    },
    generateBundle(_options, bundle)
    {
      const modules = Object.values(bundle).filter(item => item.type === 'chunk')
        .flatMap(chunk => Object.entries(chunk.modules).filter(([, detail]) => detail.renderedLength > 0)
          .map(([id, detail]) => ({ id: id.replaceAll('\\', '/').replace(root.replaceAll('\\', '/') + '/', ''), bytes: detail.renderedLength })));
      if (compact)
      {
        for (const item of Object.values(bundle).filter(item => item.type === 'chunk'))
        {
          const result = minifySync(item.fileName, item.code, {
            module: true, mangle: true,
            compress: { keepNames: { function: true, class: true } },
            codegen: { removeWhitespace: true },
          });
          if (result.errors.length)
          {
            this.error(JSON.stringify(result.errors));
          }
          item.code = result.code;
        }
      }
      this.emitFile({ type: 'asset', fileName: 'modules.json', source: JSON.stringify(modules, null, 2) });
    },
  };
}
