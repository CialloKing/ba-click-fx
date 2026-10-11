import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { minifySync } from 'rolldown/experimental';
import { normalizeProfile } from './build-profile.mjs';
import { customTypes } from './custom-types.mjs';
import { customVite } from './custom-vite.mjs';
import { createExperimentResources, markResourceInitializersPure } from './size-experiment-resources.mjs';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'test-results/size-experiments');
export const strategies = ['baseline', 'minified', 'lossless-deflate'];
export const profiles = [
  { name: 'webgl2-dom', profile: { backend: 'webgl2', runtime: 'dom' } },
  { name: 'webgpu-dom', profile: { backend: 'webgpu', runtime: 'dom' } },
  { name: 'native-click-dom', profile: JSON.parse(readFileSync(join(root, 'examples/build-profiles/native-click-dom.json'), 'utf8')) },
];

export function scriptSizes(code)
{
  return { raw: Buffer.byteLength(code), gzip: gzipSync(code).length, brotli: brotliCompressSync(code).length };
}

export async function buildExperiment(entry, strategy)
{
  assert(strategies.includes(strategy), 'Unknown strategy');
  const profile = normalizeProfile(entry.profile);
  const resources = createExperimentResources(root, strategy);
  const plugin = customVite(root, profile);
  const originalLoad = plugin.load;
  plugin.load = function(id)
  {
    const code = originalLoad.call(this, id);
    if (!code)
    {
      return code;
    }
    const filename = basename(id);
    const source = resources.sources.get(filename) ?? code;
    return strategy === 'baseline' || strategy === 'minified' ? source
      : markResourceInitializersPure(source, filename);
  };
  const directory = join(output, entry.name, strategy);
  mkdirSync(directory, { recursive: true });
  const sourceEntry = join(output, 'entry.js');
  writeFileSync(sourceEntry, "export { default, BAClickFX } from '../../src/engine-core.js';\n");
  await build({
    configFile: false, root, logLevel: 'silent', plugins: [plugin],
    build: {
      target: 'es2020', outDir: directory, emptyOutDir: false, copyPublicDir: false,
      lib: { entry: sourceEntry, formats: ['es'], fileName: () => 'ba-click-fx.js' },
      rollupOptions: { output: { exports: 'named', codeSplitting: false } },
    },
  });
  const scriptPath = join(directory, 'ba-click-fx.js');
  let code = readFileSync(scriptPath, 'utf8');
  if (strategy !== 'baseline')
  {
    const result = minifySync('ba-click-fx.js', code, {
      module: true, mangle: true,
      compress: { keepNames: { function: true, class: true } },
      codegen: { removeWhitespace: true },
    });
    assert.deepEqual(result.errors, []);
    code = result.code;
    writeFileSync(scriptPath, code);
  }
  const files = [{ name: 'ba-click-fx.js', ...scriptSizes(code) }];
  for (const [name, data] of resources.assets)
  {
    writeFileSync(join(directory, name), data);
    files.push({ name, ...scriptSizes(data) });
  }
  writeFileSync(join(directory, 'ba-click-fx.d.ts'), customTypes(profile));
  copyFileSync(join(root, 'LICENSE'), join(directory, 'LICENSE'));
  let notices = readFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  if (resources.sources.get('trail-texture.js')?.includes('inflateSync'))
  {
    notices += '\n\n## fflate\n\n' + readFileSync(join(root, 'node_modules/fflate/LICENSE'), 'utf8');
  }
  writeFileSync(join(directory, 'THIRD_PARTY_NOTICES.md'), notices);
  const totals = Object.fromEntries(['raw', 'gzip', 'brotli'].map(key =>
    [key, files.reduce((sum, file) => sum + file[key], 0)]));
  const result = { name: entry.name, strategy, profile, exact: resources.exact,
    asynchronous: resources.asynchronous, directory, files, totals };
  writeFileSync(join(directory, 'build-info.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

async function main()
{
  const args = process.argv.slice(2);
  assert(args.every(arg => arg === '--build-only' || arg.startsWith('--profile=') || arg.startsWith('--strategy=')),
    'Usage: experiment:size [--build-only] [--profile=name] [--strategy=name]');
  const selectedProfile = args.find(arg => arg.startsWith('--profile='))?.slice(10);
  const selectedStrategy = args.find(arg => arg.startsWith('--strategy='))?.slice(11);
  const selected = profiles.filter(entry => !selectedProfile || entry.name === selectedProfile);
  const modes = strategies.filter(strategy => !selectedStrategy || strategy === selectedStrategy);
  assert(selected.length && modes.length, 'No matching experiment');
  const results = [];
  for (const entry of selected)
  {
    for (const strategy of modes)
    {
      const result = await buildExperiment(entry, strategy);
      results.push(result);
      console.log(`${entry.name}/${strategy}: ${result.totals.gzip} gzip bytes`);
    }
  }
  const report = { version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), results };
  writeFileSync(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Report: ${join(output, 'results.json')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
{
  await main();
}
