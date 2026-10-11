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
// 以已人工接受的 128² 编码为对照；不把 512² 与 128² 的有损差异当成精确一致。
const baseline = await buildExperiment({ name: 'release-slim-reference', profile: { backend: 'webgl2', runtime: 'dom' } }, 'trail-128');
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
assert.equal(candidate.info.resources.encoding, 'deflate');
const report = await compareExperiments(root, output, [
  { ...baseline, name: 'slim-webgl2-128', strategy: 'baseline' },
  { name: 'slim-webgl2-128', strategy: 'release', directory: candidate.directory,
    profile: candidate.info, exact: true, checkDomFaults: true },
], { benchmark: false });
assert(report.complete);
assert.equal(report.results[1].samples.length, 4);
assert(report.results.every(result => !Object.hasOwn(result, 'cpuFrameMs')));
console.log('slim release: four exact pixel scenes, input/lifecycle/multi-instance, initialization failure and context restoration passed');
