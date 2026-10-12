import { basename, resolve } from 'node:path';
import { createBuildResources } from './build-resources.mjs';
import { compressionSession } from './resource-compression.mjs';

export function resourceVite(root, profile = { resources: { encoding: 'zopfli', trailSize: 512 }, features: { trail: true, click: true } })
{
  const prefix = resolve(root, 'src').replaceAll('\\', '/') + '/';
  let sources;
  let session;
  return {
    name: 'ba-click-fx-resources', enforce: 'pre', apply: 'build',
    async buildStart()
    {
      session = compressionSession();
      try
      {
        sources = await createBuildResources(root, profile);
      }
      catch (error)
      {
        session.close();
        throw error;
      }
    },
    load(id)
    {
      if (id.replaceAll('\\', '/').startsWith(prefix))
      {
        return sources.get(basename(id));
      }
    },
    buildEnd(error)
    {
      if (error)
      {
        session?.close();
      }
    },
    closeBundle()
    {
      session?.close();
    },
  };
}
