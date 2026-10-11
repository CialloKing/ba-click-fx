import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { buildExperiment, profiles } from './size-experiments.mjs';
import { getAvailablePort } from '../test/browser/harness.mjs';

const root = resolve(import.meta.dirname, '..');
const builds = [];
// 人工审查看当前源码，不依赖上一次体积实验留下的文件。
for (const name of ['webgl2-dom', 'webgpu-dom', 'native-dom'])
{
  const entry = profiles.find(profile => profile.name === name);
  for (const strategy of ['baseline', 'lossless-deflate', 'trail-128', 'procedural'])
  {
    builds.push(await buildExperiment(entry, strategy));
    console.log(`Built: ${name}/${strategy}`);
  }
}
const output = join(root, 'test-results/size-experiments');
mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'live-builds.json'), JSON.stringify(builds, null, 2) + '\n');
const port = await getAvailablePort();
const server = await createServer({ configFile: false, root, logLevel: 'error',
  server: { host: '127.0.0.1', port, strictPort: true, open: false } });
await server.listen();
for (const scene of ['article', 'dashboard', 'gallery'])
{
  console.log(`Live comparison: http://127.0.0.1:${port}/test/size-live/index.html?scene=${scene}`);
}
console.log('Keep this process running for manual review. Ctrl+C stops the local server.');
for (const signal of ['SIGINT', 'SIGTERM'])
{
  process.once(signal, async () => { await server.close(); process.exit(0); });
}
