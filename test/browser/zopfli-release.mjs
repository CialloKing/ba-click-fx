import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scriptSizes, compareSizes, sizeComparisonRows } from '../../scripts/release-sizes.mjs';
import { normalizeProfile } from '../../scripts/build-profile.mjs';
import { releaseBaseline, baselineAssets } from '../../scripts/release-baseline.mjs';
import { compareExperiments } from '../../scripts/size-experiment-browser.mjs';
import { buildCustomFixture, withCustomBuildSession } from '../custom-build-fixture.mjs';
import { isMain } from '../cli.mjs';

export async function runZopfliRelease(args = [])
{
  const root = resolve(import.meta.dirname, '../..');
  const output = join(root, 'test-results/zopfli-release');
  args = args.filter(arg => arg !== '--required');
  assert(args.every(arg => arg === '--release-assets'), 'Unknown Zopfli release option');
  mkdirSync(output, { recursive: true });
  const reportPath = join(output, 'results.json');
  const report = { complete: false, baselineVersion: '1.3.11', baselineAssets, results: [] };
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  const baseline = await releaseBaseline(root);
  const input = JSON.parse(readFileSync(join(root, 'examples/build-profiles/slim-webgl2-128.json'), 'utf8'));
  const ready = args.includes('--release-assets');
  const builds = [];
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const edition of ['full', 'slim'])
  {
    const full = edition === 'full';
    const candidate = ready ? join(root, 'dist-release/assets', baselineAssets[edition].filename)
      : full ? join(root, 'dist/ba-click-fx.js') : join(buildCustomFixture(input).directory, 'ba-click-fx.js');
    const profile = normalizeProfile(full ? { backend: 'webgl2', runtime: 'dom' } : input);
    const previousBytes = readFileSync(join(baseline.directory, baselineAssets[edition].filename));
    const bytes = readFileSync(candidate);
    const previous = scriptSizes(previousBytes);
    const current = scriptSizes(bytes);
    const comparison = compareSizes(previous, current);
    console.log(sizeComparisonRows(edition, comparison));
    for (const strategy of ['baseline', 'zopfli'])
    {
      const directory = join(output, edition, strategy);
      mkdirSync(directory, { recursive: true });
      copyFileSync(strategy === 'baseline' ? join(baseline.directory, baselineAssets[edition].filename) : candidate,
        join(directory, 'ba-click-fx.js'));
      builds.push({ name: edition, strategy, directory, full, profile, exact: true, checkDomFaults: !full });
    }
    report.results.push({ edition, previous, current, comparison, sha256: digest(bytes) });
  }
  assert(readFileSync(ready ? join(root, 'dist-release/assets/worker.js') : join(root, 'dist/worker.js'))
    .equals(readFileSync(ready ? join(root, 'dist-release/assets/ba-click-fx.js') : join(root, 'dist/ba-click-fx.js'))));
  report.browser = await compareExperiments(root, output, builds, { benchmark: false });
  assert(report.browser.complete);
  assert(report.browser.results.every(result => result.samples.length === 4));
  report.complete = true;
  report.readyAssets = ready;
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log('Zopfli release: full/slim match independently verified v1.3.11 in all four WebGL2 scenes; size deltas reported');
}

if (isMain(import.meta))
{
  await withCustomBuildSession(() => runZopfliRelease(process.argv.slice(2)));
}
