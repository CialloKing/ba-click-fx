import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { cpus, platform, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { build } from 'vite';
import { normalizeProfile } from './build-profile.mjs';
import { compressionSession, compressionInfo } from './resource-compression.mjs';
import { releaseBaseline, baselineAssets } from './release-baseline.mjs';
import { codecResources, codecPlugin } from './texture-codecs.mjs';
import { compareExperiments } from './size-experiment-browser.mjs';
import { benchmarkTextureCodecs } from './texture-codec-benchmark.mjs';
import { scriptSizes } from './size-experiments.mjs';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'test-results/resource-benchmark');
mkdirSync(output, { recursive: true });
const path = join(output, 'results.json');
const report = { complete: false, version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  environment: { node: process.version, platform: platform(), os: release(), cpu: cpus()[0].model },
  compression: compressionInfo('zopfli'), builds: [],
  scope: 'Local headless browser only; no physical GPU/HDR acceptance. Cold builds use separate temporary caches; full build includes demo/config/Worker. Pure decode excludes Base64/Paeth/GPU; cold import includes HTTP/parse/resource initialization.' };
writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
const baseline = await releaseBaseline(root);
const slimInput = JSON.parse(readFileSync(join(root, 'examples/build-profiles/slim-webgl2-128.json'), 'utf8'));
const builds = [];
for (const edition of ['full', 'slim'])
{
  const session = compressionSession();
  try
  {
    const full = edition === 'full';
    const start = performance.now();
    execFileSync(process.execPath, ['scripts/build.mjs', ...(full ? [] : ['--profile', 'examples/build-profiles/slim-webgl2-128.json'])],
      { cwd: root, stdio: 'pipe' });
    const buildMs = performance.now() - start;
    const directory = join(output, edition, 'zopfli');
    mkdirSync(directory, { recursive: true });
    copyFileSync(join(root, full ? 'dist' : 'dist-custom', 'ba-click-fx.js'), join(directory, 'ba-click-fx.js'));
    const resources = await codecResources(root, full ? 512 : 128, 'zopfli');
    assert.equal(resources.packets.length, 6);
    const entry = join(directory, '.decode-entry.js');
    writeFileSync(entry, `export { inflateSync as decodePayload } from 'virtual:texture-codec';\nexport const packets = ${JSON.stringify(resources.packets)};\n`);
    await build({ configFile: false, root, logLevel: 'silent', plugins: [codecPlugin(root, resources, 'zopfli')],
      build: { outDir: directory, emptyOutDir: false, copyPublicDir: false,
        lib: { entry, formats: ['es'], fileName: () => 'resource-check.js' } } });
    const profile = normalizeProfile(full ? { backend: 'webgl2', runtime: 'dom' } : slimInput);
    const previous = join(output, edition, 'baseline');
    mkdirSync(previous, { recursive: true });
    copyFileSync(join(baseline.directory, baselineAssets[edition].filename), join(previous, 'ba-click-fx.js'));
    builds.push({ name: edition, strategy: 'baseline', directory: previous, profile, full, exact: true, packets: [] },
      { name: edition, strategy: 'zopfli', codec: 'zopfli', directory, profile, full, exact: true, packets: resources.packets });
    report.builds.push({ edition, buildMs, cache: 'new empty session',
      sizes: scriptSizes(readFileSync(join(directory, 'ba-click-fx.js'), 'utf8')) });
  }
  finally
  {
    session.close();
  }
}
report.browser = await compareExperiments(root, output, builds, { benchmark: false, startupTrials: 3 });
report.decoding = await benchmarkTextureCodecs(root, builds);
assert(report.browser.complete);
report.complete = true;
writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
console.log('Explicit resource benchmark: ' + path);
