import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BACKENDS, RUNTIMES, normalizeProfile } from '../scripts/build-profile.mjs';
import { customApi } from '../scripts/custom-compiler.mjs';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'test-results/custom');
mkdirSync(dir, { recursive: true });
const fullBefore = readFileSync(resolve(root, 'dist/ba-click-fx.js'));
const profiles = BACKENDS.flatMap(backend => RUNTIMES.map(runtime => ({ backend, runtime })));
profiles.push(...['click', 'trail', 'shards', 'bloom', 'compositingReference'].map(feature => ({
  backend: 'webgl2', runtime: 'worker', features: { [feature]: false },
})));
profiles.push({ backend: 'native', runtime: 'dom', features: { click: false, trail: false, shards: false, bloom: false, compositingReference: false } });
for (const [index, input] of profiles.entries())
{
  const path = resolve(dir, 'profile.json');
  writeFileSync(path, JSON.stringify(input));
  execFileSync(process.execPath, ['scripts/build.mjs', '--profile', path], { cwd: root, stdio: 'pipe' });
  const output = resolve(root, 'dist-custom');
  const info = JSON.parse(readFileSync(resolve(output, 'build-info.json'), 'utf8'));
  const code = readFileSync(resolve(output, 'ba-click-fx.js'), 'utf8');
  const exports = await import(pathToFileURL(resolve(output, 'ba-click-fx.js')).href + '?case=' + index);
  assert.deepEqual(Object.keys(exports).sort(), ['BAClickFX', 'default']);
  assert.equal(exports.default, exports.BAClickFX);
  assert.deepEqual(Object.getOwnPropertyNames(exports.BAClickFX.prototype)
    .filter(name => name !== 'constructor' && !name.startsWith('_')).sort(), customApi(normalizeProfile(input)).sort());
  assert(!/\b(?:import|export)\s.*?\bfrom\s*['"]|\bimport\s*\(/.test(code), 'single self-contained module');
  assert(!code.includes('createFxParamDescriptor') && !code.includes('applyFxParamPatch'));
  const modules = info.modules.map(item => item.id);
  assert(!modules.includes('src/fx-param-patch.js'));
  if (!input.backend.startsWith('webgpu')) assert(!modules.includes('src/webgpu-effect.js'));
  if (input.backend.startsWith('webgpu')) assert(!modules.includes('src/webgl2-effect.js'));
  if (input.features?.trail === false) assert(!modules.includes('src/trail-texture.js'));
  assert.equal(info.sizes.raw, Buffer.byteLength(code));
  assert.deepEqual(readFileSync(resolve(root, 'dist/ba-click-fx.js')), fullBefore);
  console.log(`custom build passed: ${input.backend}/${input.runtime} ${JSON.stringify(input.features ?? {})} (${info.sizes.gzip} gzip bytes)`);
}
// Validate a real relative ESM consumer and ensure fixed values cannot be supplied.
writeFileSync(resolve(dir, 'consumer.ts'), `import BAClickFX, { BAClickFX as Named } from '../../dist-custom/ba-click-fx.js';
const fx = new BAClickFX({ onError: error => console.log(error.code) });
const same: typeof BAClickFX = Named;
fx.resize(320, 240, 1); fx.setPaused(true); fx.getConfig(); fx.getFxConfig(); fx.clear(); fx.destroy();
// @ts-expect-error fixed numbers belong in the build profile
new BAClickFX({ scale: 2 });
// @ts-expect-error dynamic configuration is absent
fx.updateConfig({ opacity: 0.5 });
// @ts-expect-error click capability is absent
fx.boom();
`);
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--strict', '--noEmit', '--lib', 'es2022,dom', '--module', 'nodenext', resolve(dir, 'consumer.ts')], { cwd: root, stdio: 'inherit' });
console.log('custom ESM declarations passed');
