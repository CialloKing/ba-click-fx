import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCustomFixture } from '../custom-build-fixture.mjs';
import { buildExperiment } from '../../scripts/size-experiments.mjs';
import { compareExperiments } from '../../scripts/size-experiment-browser.mjs';

const root = resolve(import.meta.dirname, '../..');
const output = resolve(root, 'test-results/slim-browser');
const args = process.argv.slice(2).filter(value => value !== '--required');
assert(args.every(value => value === '--release-assets'), 'Unknown slim runtime option');
const input = JSON.parse(readFileSync(resolve(root, 'examples/build-profiles/slim-webgl2-128.json'), 'utf8'));
const webpageConfig = { outputCompositing: 'browser-overlay', hostCompositing: 'screen', hostCompositingSurface: 'dom-backdrop' };
// 保留已接受的 128² 编码，用网页推荐配置作独立对照；不要求与 Scene 输出一致。
const baseline = await buildExperiment({ name: 'release-slim-reference', profile: { backend: 'webgl2', runtime: 'dom', config: webpageConfig } }, 'trail-128');
let candidate;
if (args.includes('--release-assets'))
{
  const directory = resolve(output, 'published-files');
  mkdirSync(directory, { recursive: true });
  copyFileSync(resolve(root, 'dist-release/assets/ba-click-fx.slim-webgl2-128.js'), resolve(directory, 'ba-click-fx.js'));
  candidate = { directory, info: JSON.parse(readFileSync(resolve(root, 'dist-release/slim/build-info.json'), 'utf8')) };
}
else
{
  candidate = buildCustomFixture(input);
}
assert.equal(candidate.info.resources.trailSize, 128);
assert.equal(candidate.info.resources.encoding, 'zopfli');
for (const [key, value] of Object.entries(webpageConfig))
{
  assert.equal(candidate.info.config[key], value, 'Slim webpage configuration: ' + key);
}
const report = await compareExperiments(root, output, [
  { ...baseline, name: 'slim-webgl2-128', strategy: 'baseline' },
  { name: 'slim-webgl2-128', strategy: 'release', directory: candidate.directory,
    profile: candidate.info, exact: true, checkDomFaults: true },
], { benchmark: false });
assert(report.complete);
assert.equal(report.results[1].samples.length, 4);
assert(report.results.every(result => !Object.hasOwn(result, 'cpuFrameMs')));
console.log('slim release: four exact pixel scenes, input/lifecycle/multi-instance, initialization failure and context restoration passed');
