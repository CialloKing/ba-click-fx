import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { chromium } from 'playwright-core';
import { normalizeProfile } from '../../scripts/build-profile.mjs';
import { buildCustomFixture } from '../custom-build-fixture.mjs';
import { closeBrowserRuntime, findChromiumExecutable, startViteServer } from './harness.mjs';

const root = resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
assert(args.every(arg => arg === '--benchmark' || arg === '--source' || arg.startsWith('--baseline=') || arg === '--runtime=worker'));
const benchmark = args.includes('--benchmark');
const baselineDirectory = args.find(arg => arg.startsWith('--baseline='))?.slice(11);
const baseline = baselineDirectory && JSON.parse(readFileSync(resolve(root, baselineDirectory, 'manifest.json')));
const url = path => '/' + relative(root, resolve(root, path)).replaceAll('\\', '/');
const verify = (directory, sha256) =>
{
  const file = resolve(root, directory, 'ba-click-fx.js');
  assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), sha256);
  return url(file);
};
const oldUrl = baseline && verify(baselineDirectory, baseline.full.files.find(file => file.name === 'ba-click-fx.js').sha256);
const output = resolve(root, 'test-results/trail-work');
mkdirSync(output, { recursive: true });
const report = { complete: false, benchmark, workerOnly: args.includes('--runtime=worker'), results: [] };
let browser, vite;
try
{
  const server = await startViteServer(root); vite = server.server; await vite.watcher.close();
  browser = await chromium.launch({ executablePath: findChromiumExecutable(), headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-precise-memory-info'] });
  report.browser = browser.version();
  const run = async parameters =>
  {
    const page = await browser.newPage();
    let trace, session;
    try
    {
      await page.goto(server.baseUrl + '/test/browser/custom.html');
      if (benchmark)
      {
        trace = [];
        session = await page.context().newCDPSession(page);
        session.on('Tracing.dataCollected', event => trace.push(...event.value));
        await session.send('Tracing.start', { categories: 'devtools.timeline,v8,blink.user_timing', transferMode: 'ReportEvents' });
      }
      const result = await page.evaluate(async parameters =>
      {
        if (parameters.profile.runtime !== 'worker')
          return (await import('/test/browser/custom-fixture.js')).runCustomFixture(parameters);
        return new Promise((done, fail) =>
        {
          const source = `import { runCustomFixture } from ${JSON.stringify(location.origin + '/test/browser/custom-fixture.js')};
            onmessage = async event => { try { postMessage(await runCustomFixture(event.data)); } catch(error) { postMessage({ error: error.stack }); } };`;
          const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
          const worker = new Worker(url, { type: 'module' });
          const finish = (result, error) =>
          { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(url); error ? fail(Error(error)) : done(result); };
          const timer = setTimeout(() => finish(null, 'Trail Worker timeout'), 60000);
          worker.onmessage = event => finish(event.data, event.data.error);
          worker.onerror = event => finish(null, event.message);
          const canvas = document.createElement('canvas').transferControlToOffscreen();
          worker.postMessage({ ...parameters, targetCanvas: canvas }, [canvas]);
        });
      }, parameters);
      assert(!result.skipped, result.skipped); assert.deepEqual(result.errors, []);
      if (session)
      {
        const finished = new Promise(done => session.once('Tracing.tracingComplete', done));
        await session.send('Tracing.end'); await finished;
        const startEvent = trace.find(event => event.name === 'trail-measure-start');
        const start = startEvent?.ts;
        const end = trace.find(event => event.name === 'trail-measure-end')?.ts;
        const events = trace.filter(event => event.pid === startEvent?.pid && ['MinorGC', 'MajorGC'].includes(event.name) && event.ph === 'X' && event.ts >= start && event.ts < end);
        result.trailWork.gc = { measured: Number.isFinite(start) && Number.isFinite(end),
          count: events.length, durationMs: events.reduce((sum, event) => sum + (event.dur ?? 0) / 1000, 0), events };
        await session.detach(); session = null;
      }
      return result.trailWork;
    }
    finally { await page.close(); }
  };
  const cases = benchmark ? ['webgl2', 'webgpu'].map(backend => ({ backend, runtime: 'dom', full: true })) : [
    ...['webgl2', 'webgpu', 'webgl2-bloom', 'native', 'software'].map(backend => ({ backend, runtime: 'dom', full: true })),
    ...[true, false].flatMap(full => ['webgl2', 'webgpu'].map(backend => ({ backend, runtime: 'worker', full }))),
  ];
  for (const entry of cases)
  {
    if (report.workerOnly && entry.runtime !== 'worker') continue;
    const input = { backend: entry.backend, runtime: entry.runtime,
      config: { hostCompositing: 'source-over', maxDpr: 2, outputCompositing: 'browser-overlay' },
      fxParams: { 'bloom.clickEmissionScale': 2, 'bloom.intensity': entry.full ? 1.7 : 0 } };
    const profile = normalizeProfile(input);
    const candidateUrl = entry.full ? args.includes('--source') ? '/src/fx.js' : '/dist/ba-click-fx.js' : buildCustomFixture(input).url;
    const oldCustom = !entry.full && baseline?.custom.find(item => item.backend === entry.backend && item.runtime === entry.runtime);
    if (oldCustom) assert.deepEqual(normalizeProfile(oldCustom.input), profile);
    const baselineUrl = entry.full ? oldUrl : oldCustom && verify(oldCustom.path, oldCustom.sha256);
    for (let trial = 0; trial < (benchmark ? 5 : 1); trial++)
    {
      const record = { ...entry, trial };
      for (const kind of trial % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'])
      {
        const url = kind === 'candidate' ? candidateUrl : baselineUrl;
        if (url) record[kind] = await run({ url, profile, full: entry.full,
          deterministicCanvas: !benchmark, trailWork: benchmark ? 'benchmark' : true });
      }
      assert(record.candidate.released);
      if (!benchmark)
      {
        assert.deepEqual(record.candidate.growth, { arrays: 0, samples: 0, segments: 0, points: 0 }, 'Warmed moving work stays within existing capacity');
        if (record.baseline) assert.deepEqual(record.candidate.hashes, record.baseline.hashes, 'Independent moving/pause/config/expiry pixel parity');
      }
      report.results.push(record);
      console.log(`Trail work ${entry.backend}/${entry.runtime}/${entry.full ? 'full' : 'custom'} trial ${trial + 1}: passed`);
    }
  }
  report.complete = true;
}
catch(error) { report.failure = error.stack; console.error(error.stack); process.exitCode = 1; }
finally
{
  await closeBrowserRuntime({ browser, vite });
  writeFileSync(resolve(output, benchmark ? 'benchmark.json' : 'results.json'), JSON.stringify(report, null, 2));
}
