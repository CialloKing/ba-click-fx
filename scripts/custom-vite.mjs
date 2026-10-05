import { basename, resolve } from 'node:path';
import { compileCustomSources } from './custom-compiler.mjs';

export function customVite(root, profile)
{
  const compiled = compileCustomSources(root, profile);
  return {
    name: 'ba-click-fx-profile', enforce: 'pre',
    resolveId(id)
    {
      if (id === 'virtual:ba-click-fx-profile' || id === 'virtual:ba-click-fx-custom') return '\0' + id;
    },
    load(id)
    {
      if (id === '\0virtual:ba-click-fx-profile') return compiled.constants;
      if (id === '\0virtual:ba-click-fx-custom') return `export { default, BAClickFX } from ${JSON.stringify(resolve(root, 'src/fx.js'))};`;
      if (id.replaceAll('\\', '/').startsWith(resolve(root, 'src').replaceAll('\\', '/') + '/'))
        return compiled.sources.get(basename(id));
    },
    generateBundle(_options, bundle)
    {
      const modules = Object.values(bundle).filter(item => item.type === 'chunk')
        .flatMap(chunk => Object.entries(chunk.modules).filter(([, detail]) => detail.renderedLength > 0)
          .map(([id, detail]) => ({ id: id.replaceAll('\\', '/').replace(root.replaceAll('\\', '/') + '/', ''), bytes: detail.renderedLength })));
      this.emitFile({ type: 'asset', fileName: 'modules.json', source: JSON.stringify(modules, null, 2) });
    },
  };
}
