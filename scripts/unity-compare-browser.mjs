import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { findChromiumExecutable, startViteServer, closeBrowserRuntime } from '../test/browser/harness.mjs';
import { decodeHalf, decodeUnityBuffer, compareRgb, srgbEncode, srgbDecode, encodePreview, summarizeTrailMesh } from './unity-compare-data.mjs';

const json = async path => JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
const stableState = ({ frame, elapsedUnityTime, run, ...state }) => state;

export async function validateUnityCapture(output)
{
  const input = await json(join(output, 'inputs.json'));
  const complete = await json(join(output, 'complete.json'));
  const process = await json(join(output, 'capture-process.json'));
  if (process.exitCode !== 0 || process.timedOut) throw new Error('Unity 捕获进程失败；不能把完整文件当作执行成功');
  if (!complete.completed || complete.runs !== 2) throw new Error('Unity 两轮捕获未完成');
  const cases = [];
  for (const specification of input.cases)
  for (const time of specification.captures)
  {
    const name = `${specification.name}-${time}`;
    const directories = [0, 1].map(run => join(output, 'reference', `run${run}`, name));
    const states = await Promise.all(directories.map(path => json(join(path, 'state.json'))));
    const particles = await Promise.all(directories.map(path => json(join(path, 'particles.json'))));
    const buffers = await Promise.all(directories.map(path => json(join(path, 'buffers.json'))));
    for (const state of states)
    {
      if (state.timeMs !== time || Math.abs(state.elapsedUnityTime * 1000 - time) > 0.1)
        throw new Error(`${name} 逻辑时间与 Unity 时间不匹配`);
    }
    if (JSON.stringify(stableState(states[0])) !== JSON.stringify(stableState(states[1])) ||
        JSON.stringify(particles[0]) !== JSON.stringify(particles[1]) || JSON.stringify(buffers[0]) !== JSON.stringify(buffers[1]))
      throw new Error(`${name} 两轮状态不一致`);
    for (const buffer of buffers[0].buffers)
    {
      const raw = await Promise.all(directories.map(path => readFile(join(path, `${buffer.name}.rgba16f.gz`))));
      if (!gunzipSync(raw[0]).equals(gunzipSync(raw[1]))) throw new Error(`${name}/${buffer.name} 两轮像素不一致`);
    }
    cases.push({ name, directory: directories[0], specification, state: states[0], particles: particles[0], buffers: buffers[0] });
  }
  for (const specification of input.cases.filter(value => value.trail))
  {
    const [start, end] = specification.captures.map(time => cases.find(sample => sample.name === `${specification.name}-${time}`));
    const count = sample => sample.state.trails.reduce((sum, trail) => sum + trail.positions.length, 0);
    if (count(start) < 2 || count(end) >= count(start)) throw new Error(`${specification.name} 拖尾没有实际生成或过期裁剪`);
    for (const sample of [start, end])
    {
      sample.referenceGeometry = sample.state.trails.map(trail => summarizeTrailMesh(trail, sample.state));
      const scene = sample.buffers.buffers.find(buffer => buffer.name === '00_UI_HDR');
      const values = decodeUnityBuffer(await readFile(join(sample.directory, `${scene.name}.rgba16f.gz`)), scene.width, scene.height);
      sample.referenceEnergy = compareRgb(values, values).referenceEnergy;
    }
  }
  return { input, cases };
}

export async function compareUnityCapture({ root, output })
{
  const { input, cases } = await validateUnityCapture(output);
  const diagnostics = cases.filter(sample => sample.specification.trail).map(sample => ({
    name: sample.name, drive: sample.specification.drive ?? 'legacy-manual',
    releaseMs: sample.specification.releaseMs, input: sample.specification.points,
    referenceGeometry: sample.referenceGeometry, referenceEnergy: sample.referenceEnergy,
  }));
  const invalidReferences = input.schema >= 2 ? cases.filter(sample => sample.specification.drive === 'runtime' &&
    sample.state.timeMs === sample.specification.captures[0] &&
    (!sample.referenceGeometry.some(mesh => mesh.visibleTriangles > 0) || sample.referenceEnergy <= 0)).map(sample => sample.name) : [];
  await writeFile(join(output, 'trail-diagnostics.json'), JSON.stringify({ inputVersion: input.workloadVersion,
    repeatIdentical: true, diagnostics, invalidReferences }, null, 2));
  const report = { capture: await json(join(output, 'environment.json')),
    replayCommit: execFileSync('git', ['describe', '--always', '--dirty'], { cwd: root, encoding: 'utf8' }).trim(),
    input, repeat: { runs: 2, stateAndPixelsIdentical: true }, cases: {}, consoleErrors: [], invalidReferences,
    note: '中间层比较原始线性 RGB。Final 同时报告原始 Unity HDR 与网页 SDR 解码后的线性差异，以及 SDR 显示域差异。前者保留 Unity 超出 1 的值，后者明确夹取和 sRGB 编码参考值；两者不能混用。Alpha 不纳入 RGB 指标。PNG 差异固定放大 16 倍，无自动对齐或缩放。' };
  let browser; let vite; let current;
  try
  {
    const runtime = await startViteServer(root); vite = runtime.server;
    const executablePath = findChromiumExecutable();
    if (!executablePath) throw new Error('找不到 Chrome 或 Edge');
    browser = await chromium.launch({ executablePath, headless: true,
      args: ['--disable-background-networking', '--disable-extensions', '--force-color-profile=srgb', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
    report.browser = browser.version(); report.executablePath = executablePath;
    const page = await browser.newPage({ viewport: { width: input.width, height: input.height }, deviceScaleFactor: 1 });
    page.on('pageerror', error => report.consoleErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    await page.exposeFunction('saveUnityStage', async stage =>
    {
      const referenceMetadata = current.buffers.buffers.find(buffer => buffer.name === stage.name);
      if (!referenceMetadata || referenceMetadata.width !== stage.width || referenceMetadata.height !== stage.height)
        throw new Error(`${current.name}/${stage.name} 中间层尺寸不匹配`);
      const bytes = Buffer.from(stage.bytes, 'base64');
      const actual = stage.format === 'float32' ? new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)) : decodeHalf(bytes);
      const reference = decodeUnityBuffer(await readFile(join(current.directory, `${stage.name}.rgba16f.gz`)), stage.width, stage.height);
      const encoded = stage.name === '40_Composite';
      let linearComparison;
      let actualLinear;
      if (encoded)
      {
        actualLinear = Float32Array.from(actual, (value, index) => index % 4 === 3 ? value : srgbDecode(value));
        linearComparison = compareRgb(reference, actualLinear);
        for (let index = 0; index < reference.length; index++) if (index % 4 !== 3) reference[index] = srgbEncode(reference[index]);
      }
      const metrics = compareRgb(reference, actual);
      const directory = join(output, 'web', current.backend, current.name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, `${stage.name}.rgba32f.gz`), gzipSync(Buffer.from(actual.buffer)));
      await writeFile(join(directory, `${stage.name}.png`), encodePreview(actual, stage.width, stage.height, { encoded }));
      await writeFile(join(directory, `${stage.name}-diff.png`), encodePreview(actual, stage.width, stage.height, { reference }));
      if (encoded) await writeFile(join(directory, `${stage.name}-linear.rgba32f.gz`), gzipSync(Buffer.from(actualLinear.buffer)));
      report.cases[current.name][current.backend].stages[stage.name] = { width: stage.width, height: stage.height, domain: encoded ? 'encoded-sRGB' : 'linear-HDR', ...metrics,
        ...(linearComparison ? { linearComparison: { domain: 'Unity-HDR-vs-web-decoded-SDR', ...linearComparison } } : {}) };
    });
    await page.goto(`${runtime.baseUrl}/test/browser/webgpu.html`);
    for (const sample of cases)
    {
      // 手动驱动保留为流程诊断，不把退化参考混入正式视觉误差。
      if (sample.specification.drive === 'manual') continue;
      report.cases[sample.name] = {};
      for (const backend of ['webgl2', 'webgpu'])
      {
        current = { ...sample, backend };
        const record = report.cases[sample.name][backend] = { stages: {}, referenceGeometry: sample.referenceGeometry };
        console.log(`Unity 对照 ${sample.name} / ${backend}`);
        const errorsBefore = report.consoleErrors.length;
        Object.assign(record, await page.evaluate(async ({ backend, particles, state }) =>
        {
          const { captureWebStages } = await import('/scripts/unity-compare-replay.js');
          return captureWebStages(backend, particles, state);
        }, { backend, particles: sample.particles, state: sample.state }));
        if (!record.skipped && report.consoleErrors.length !== errorsBefore) throw new Error(`${backend} 渲染出现控制台错误`);
        if (!record.skipped && Math.abs(record.sampleScale - sample.buffers.sampleScale) > 0.000001) throw new Error('Bloom 采样倍率不匹配');
      }
    }
    if (invalidReferences.length)
    {
      const error = new Error(`原预览驱动仍没有有效拖尾参考：${invalidReferences.join(', ')}`);
      error.code = 'INVALID_UNITY_REFERENCE';
      throw error;
    }
    report.status = 'completed-with-rendering-differences';
  }
  catch (error)
  {
    report.status = error.code === 'INVALID_UNITY_REFERENCE' ? 'reference-failed' : 'execution-failed';
    report.failure = { case: current?.name, backend: current?.backend, message: error.message, stack: error.stack };
    throw error;
  }
  finally
  {
    await closeBrowserRuntime({ browser, vite });
    await writeFile(join(output, 'comparison.json'), JSON.stringify(report, null, 2)).catch(() => {});
    const rows = ['# Unity 同状态视觉对照', '', `状态：${report.status}`, '',
      `采集提交：${report.capture.commit}；网页重放：${report.replayCommit}；Unity ${report.capture.unityVersion}；${report.browser ?? '浏览器尚未启动'}`, '', report.note, '',
      `两轮状态及像素一致性：${report.repeat.stateAndPixelsIdentical}。网页保留 96×8 网格；Unity 原网格 64×1。拖尾由同一原始点集重建网页网格。`, '',
      '原 Prefab 拖尾的投影三角数量、宽度曲线求值另列于 JSON referenceGeometry；若投影几何退化，空参考图的差异不能代表正常可见 Unity 拖尾的还原误差。不修改参考 Prefab 来消除这个差异。', '',
      '| 场景 | 后端 | 层 | 最大误差 | MAE | RMSE | 参考能量 | 网页能量 |', '|---|---|---|---:|---:|---:|---:|---:|'];
    for (const [name, backends] of Object.entries(report.cases))
    for (const [backend, record] of Object.entries(backends))
    {
      if (record.skipped) rows.push(`| ${name} | ${backend} | 跳过：${record.reason} | | | | | |`);
      for (const [stage, metric] of Object.entries(record.stages))
      {
        for (const [title, values] of [[stage, metric], ...(metric.linearComparison ? [[`${stage} (原始 HDR/网页 SDR)`, metric.linearComparison]] : [])])
          rows.push(`| ${name} | ${backend} | ${title} | ${values.maximumError.toPrecision(6)} | ${values.meanAbsoluteError.toPrecision(6)} | ${values.rmse.toPrecision(6)} | ${values.referenceEnergy.toPrecision(8)} | ${values.actualEnergy.toPrecision(8)} |`);
      }
    }
    if (report.failure) rows.push('', `失败：${report.failure.message}`);
    await writeFile(join(output, 'comparison.md'), `${rows.join('\n')}\n`).catch(() => {});
  }
}
