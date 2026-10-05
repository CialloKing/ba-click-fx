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
const typeConsumers = { dom: [], worker: [] };
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
  assert(!modules.includes('src/engine-config.js') && !modules.includes('src/engine-input.js'), 'methods are statically expanded and trimmed');
  if (!input.backend.startsWith('webgpu')) assert(!modules.includes('src/webgpu-effect.js'));
  if (input.backend.startsWith('webgpu')) assert(!modules.includes('src/webgl2-effect.js'));
  if (input.features?.trail === false) assert(!modules.includes('src/trail-texture.js'));
  if (input.features?.shards === false) assert(!modules.includes('src/triangle-texture.js'));
  if (input.features?.click === false) assert(!modules.includes('src/circle-texture.js') && !modules.includes('src/ring3-alpha.js'));
  if (input.backend !== 'software') assert(!modules.includes('src/software-bloom.js'));
  assert.equal(info.sizes.raw, Buffer.byteLength(code));
  assert.deepEqual(readFileSync(resolve(root, 'dist/ba-click-fx.js')), fullBefore);
  // 检查实际生成的声明；Worker 使用独立 lib，避免 DOM 类型掩盖接入错误。
  writeFileSync(resolve(dir, `custom-${index}.d.ts`), readFileSync(resolve(output, 'ba-click-fx.d.ts')));
  const target = input.runtime === 'worker' ? 'new OffscreenCanvas(320, 240)'
    : input.runtime === 'manual' ? "document.createElement('canvas')" : 'document.body';
  const consumer = resolve(dir, `consumer-${index}.ts`);
  writeFileSync(consumer, `import BAClickFX, { BAClickFX as Named } from './custom-${index}.js';
const fx = new BAClickFX({ target: ${target}, onError: error => console.log(error.code) });
const same: typeof BAClickFX = Named;
fx.resize(320, 240, 1); fx.setPaused(true); fx.getConfig(); fx.getFxConfig(); fx.clear(); fx.destroy();
${info.features.click ? 'fx.boom(10, 20);' : '// @ts-expect-error click capability is absent\nfx.boom();'}
${info.features.trail ? 'fx.clearTrail();' : ''}
${info.features.compositingReference ? 'fx.setCompositingReference(null);' : ''}
${input.runtime !== 'dom' && (info.features.click || info.features.trail)
  ? "fx.pointerDown({ x: 10, y: 20, pointerType: 'mouse' }); fx.pointerMove({ x: 20, y: 30 }); fx.pointerUp(); fx.pointerCancel();" : ''}
// @ts-expect-error fixed numbers belong in the build profile
new BAClickFX({ target: ${target}, scale: 2 });
// @ts-expect-error dynamic configuration is absent
fx.updateConfig({ opacity: 0.5 });
`);
  typeConsumers[input.runtime === 'worker' ? 'worker' : 'dom'].push(consumer);
  console.log(`custom build passed: ${input.backend}/${input.runtime} ${JSON.stringify(input.features ?? {})} (${info.sizes.gzip} gzip bytes)`);
}
for (const [lib, consumers] of Object.entries(typeConsumers))
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--strict', '--noEmit', '--lib', `es2022,${lib === 'worker' ? 'webworker' : 'dom'}`, '--module', 'nodenext', ...consumers], { cwd: root, stdio: 'inherit' });
console.log('custom ESM declarations passed');
