import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { findChromiumExecutable, startViteServer } from '../test/browser/harness.mjs';

function chunk(type, data)
{
  const tag = Buffer.from(type);
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  checksum.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, checksum]);
}

function savePixels(path, width, height, pixels)
{
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  const bytes = Buffer.from(pixels);
  for (let y = 0; y < height; y++)
  {
    bytes.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]));
}

function comparePixels(baseline, candidate)
{
  assert.equal(candidate.pixelWidth, baseline.pixelWidth);
  assert.equal(candidate.pixelHeight, baseline.pixelHeight);
  const difference = new Uint8Array(candidate.pixels.length);
  let changed = 0;
  let error = 0;
  let maximum = 0;
  let activeError = 0;
  let activePixels = 0;
  for (let index = 0; index < difference.length; index += 4)
  {
    let pixelChanged = false;
    let pixelError = 0;
    let active = false;
    for (let channel = 0; channel < 4; channel++)
    {
      const delta = Math.abs(candidate.pixels[index + channel] - baseline.pixels[index + channel]);
      error += delta;
      pixelError += delta;
      active ||= candidate.pixels[index + channel] > 8 || baseline.pixels[index + channel] > 8;
      maximum = Math.max(maximum, delta);
      pixelChanged ||= delta !== 0;
      if (channel < 3)
      {
        difference[index + channel] = Math.min(255, delta * 4);
      }
    }
    // Alpha 的变化也显示出来，避免透明区域的差异被 RGB 掩盖。
    const alphaDelta = Math.abs(candidate.pixels[index + 3] - baseline.pixels[index + 3]);
    difference[index + 2] = Math.max(difference[index + 2], Math.min(255, alphaDelta * 4));
    difference[index + 3] = 255;
    changed += Number(pixelChanged);
    if (active)
    {
      activePixels++;
      activeError += pixelError;
    }
  }
  return { difference, changedPixels: changed, changedPercent: changed / (difference.length / 4) * 100,
    mae: error / difference.length, activeRgbaMae: activeError / Math.max(1, activePixels * 4), maximumChannelError: maximum };
}

function summary(values)
{
  const sorted = [...values].sort((left, right) => left - right);
  return { samples: values.length, min: sorted[0], median: sorted[Math.floor(sorted.length / 2)], max: sorted.at(-1) };
}

async function runFixture(browser, baseUrl, args, worker)
{
  // 每次使用独立上下文，避免模块缓存和上一轮设备状态影响冷加载结果。
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl + '/test/browser/custom.html');
  try
  {
    let result;
    if (!worker)
    {
      result = await page.evaluate(async args =>
        (await import('/test/browser/custom-fixture.js')).runCustomFixture(args), args);
    }
    else
    {
      result = await page.evaluate(args => new Promise((done, fail) =>
      {
        const source = `import { runCustomFixture } from ${JSON.stringify(location.origin + '/test/browser/custom-fixture.js')};
onmessage = async event => { try { postMessage(await runCustomFixture(event.data)); } catch (error) { postMessage({ failure: error.stack }); } };`;
        const blob = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
        const worker = new Worker(blob, { type: 'module' });
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 240;
        const targetCanvas = canvas.transferControlToOffscreen();
        const timer = setTimeout(() => { cleanup(); fail(new Error('Experiment Worker timeout')); }, 45000);
        const cleanup = () => { clearTimeout(timer); worker.terminate(); URL.revokeObjectURL(blob); };
        worker.onerror = error => { cleanup(); fail(new Error(error.message)); };
        worker.onmessage = event =>
        {
          cleanup();
          if (event.data.failure) { fail(new Error(event.data.failure)); }
          else { done(event.data); }
        };
        worker.postMessage({ ...args, targetCanvas }, [targetCanvas]);
      }), args);
    }
    assert.deepEqual(errors, []);
    assert(!result.skipped, `Device skipped: ${JSON.stringify(result)}`);
    return result;
  }
  finally
  {
    await page.close();
  }
}

export async function compareExperiments(root, output, builds, { benchmark = true } = {})
{
  const vite = await startViteServer(root);
  const browser = await chromium.launch({ executablePath: findChromiumExecutable(), headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-precise-memory-info'] });
  const report = { browser: browser.version(), complete: false,
    pixelRasterization: 'Native/Software: Canvas2D willReadFrequently=true; GPU backends unchanged. Performance: default contexts.',
    results: [] };
  const baselines = new Map();
  try
  {
    for (const build of builds)
    {
      const url = vite.baseUrl + '/' + relative(root, join(build.directory, 'ba-click-fx.js')).replaceAll('\\', '/');
      const worker = build.profile.runtime === 'worker';
      const snapshots = [];
      const measurements = [];
      const samples = [
        { name: 'early', captureOffsetMs: 0 },
        { name: 'late', captureOffsetMs: 180 },
        ...(build.profile.features.trail ? [{ name: 'active-trail', sustainedTrail: true }] : []),
        ...(build.profile.features.compositingReference ? [{ name: 'reference', reference: true }] : []),
      ];
      for (const sample of samples)
      {
        const snapshot = await runFixture(browser, vite.baseUrl,
          { profile: build.profile, url, capturePixels: true,
            deterministicCanvas: ['native', 'software'].includes(build.profile.backend), ...sample }, worker);
        assert(snapshot.lit > 0, `${build.name}/${build.strategy}: empty output`);
        snapshots.push({ sample: sample.name, ...snapshot });
        savePixels(join(build.directory, `${sample.name}.png`), snapshot.pixelWidth, snapshot.pixelHeight, snapshot.pixels);
      }
      for (let trial = 0; benchmark && trial < 3; trial++)
      {
        measurements.push(await runFixture(browser, vite.baseUrl,
          { profile: build.profile, url, timing: true, benchmark: trial === 0 }, worker));
      }
      const result = { name: build.name, strategy: build.strategy, samples: [], faultChecks: [] };
      if (benchmark)
      {
        const frames = [...measurements[0].cpuFrameMs].sort((left, right) => left - right);
        result.importMs = summary(measurements.map(value => value.importMs));
        result.initMs = summary(measurements.map(value => value.initMs));
        result.cpuFrameMs = { samples: frames.length, p50: frames[Math.floor(frames.length * 0.5)], p95: frames[Math.floor(frames.length * 0.95)] };
      }
      if (build.strategy === 'baseline')
      {
        baselines.set(build.name, snapshots);
      }
      const baseline = baselines.get(build.name);
      assert(baseline, 'Build the baseline before candidate strategies');
      for (const [index, snapshot] of snapshots.entries())
      {
        assert.deepEqual(snapshot.config, baseline[index].config, 'Fixed configuration changed');
        for (const key of ['waves', 'shards', 'trail'])
        {
          assert.deepEqual(snapshot.state[key], baseline[index].state[key], 'Particle/input state changed');
        }
        const comparison = comparePixels(baseline[index], snapshot);
        if (build.exact)
        {
          assert.equal(snapshot.hash, baseline[index].hash, `${build.name}/${build.strategy}/${snapshot.sample}: exact pixel parity`);
        }
        savePixels(join(build.directory, `${snapshot.sample}-diff.png`), snapshot.pixelWidth, snapshot.pixelHeight, comparison.difference);
        const { difference, ...metrics } = comparison;
        result.samples.push({ sample: snapshot.sample, hash: snapshot.hash, lit: snapshot.lit, ...metrics });
      }
      if (worker)
      {
        const gpu = build.profile.backend.startsWith('webgpu');
        const args = { profile: build.profile, url };
        const failure = await runFixture(browser, vite.baseUrl, { ...args, fault: gpu ? 'gpu' : 'context' }, true);
        assert.deepEqual(failure.errors, ['initialization-failed']);
        assert(failure.stopped);
        result.faultChecks.push('initialization-failed');
        if (gpu)
        {
          assert.deepEqual(await runFixture(browser, vite.baseUrl, { ...args, pendingDestroy: true }, true), { pendingDestroy: true });
          const loss = await runFixture(browser, vite.baseUrl, { ...args, deviceLost: true }, true);
          assert.deepEqual(loss.errors, ['device-lost']); assert(loss.stopped);
          result.faultChecks.push('pending-destroy', 'device-lost');
          const standard = await runFixture(browser, vite.baseUrl, { ...args, forceStandard: true }, true);
          assert.equal(standard.config.resolvedWebGPUOutputMode, 'standard');
          result.faultChecks.push('standard-output-fallback');
        }
        else
        {
          const restored = await runFixture(browser, vite.baseUrl, { ...args, restoreContext: true }, true);
          assert.equal(restored.contextRestored, 'passed');
          result.faultChecks.push('context-restoration');
        }
      }
      if (build.checkDomFaults)
      {
        const args = { profile: build.profile, url };
        const failure = await runFixture(browser, vite.baseUrl, { ...args, fault: 'context' }, false);
        assert.deepEqual(failure.errors, ['initialization-failed']);
        assert(failure.stopped);
        const restored = await runFixture(browser, vite.baseUrl, { ...args, restoreContext: true }, false);
        assert.equal(restored.contextRestored, 'passed');
        assert.deepEqual(restored.errors, []);
        result.faultChecks.push('initialization-failed', 'context-restoration');
      }
      report.results.push(result);
      console.log(`Browser passed: ${build.name}/${build.strategy}, early RGBA MAE=${result.samples[0].mae.toFixed(4)}`);
    }
    report.complete = true;
    return report;
  }
  finally
  {
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'browser-results.json'), JSON.stringify(report, null, 2) + '\n');
    await browser.close();
    await vite.server.close();
  }
}
