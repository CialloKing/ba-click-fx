import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const beforePath = resolve(process.argv[2] ?? join(root, 'test-results/unity-comparison-fit-before'));
const afterPath = resolve(process.argv[3] ?? join(root, 'test-results/unity-comparison-fit-after'));
// 阶段采集只输出到本地目录，避免报告和大体积指标重新进入源码管理。
const reportPath = join(root, 'test-results/unity-fit-stage1');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const before = await json(join(beforePath, 'comparison.json'));
const after = await json(join(afterPath, 'comparison.json'));
const benchmarks = await Promise.all(['before', 'after'].map(label =>
  json(join(root, `test-results/runtime-benchmark-unity-fit-${label}.json`))));
if (before.capture.sourceProjectHash !== after.capture.sourceProjectHash ||
    !after.repeat.stateAndPixelsIdentical || after.consoleErrors.length)
  throw new Error('参考工程或重复捕获合同不一致');
let identicalBuffers = 0;
for (const specification of after.input.cases)
for (const time of specification.captures)
{
  const name = `${specification.name}-${time}`;
  const buffers = await json(join(afterPath, 'reference/run0', name, 'buffers.json'));
  for (const buffer of buffers.buffers)
  {
    const files = await Promise.all([beforePath, afterPath].map(path =>
      readFile(join(path, 'reference/run0', name, `${buffer.name}.rgba16f.gz`))));
    if (!gunzipSync(files[0]).equals(gunzipSync(files[1]))) throw new Error(`${name}/${buffer.name} 前后参考像素不同`);
    identicalBuffers++;
  }
}
const percentage = value => `${(value * 100).toFixed(3)}%`;
const reduction = (old, current, key) => 1 - current[key] / old[key];
const summary = {
  unity: after.capture, browser: after.browser, referenceBuffersIdentical: identicalBuffers,
  dimensions: [1950, 1097], dpr: 1, background: 'black', output: 'SDR',
  trail: [], clicks: [], lifecycle: [], costs: {}, layers: {}, checks: {},
};
const runs = await Promise.all([0, 1].map(run => stat(join(afterPath, `capture-process-run${run}.json`))));
const replayLog = await stat(join(root, 'test-results/unity-fit-after-replay.log'));
const releaseLog = await stat(join(root, 'test-results/unity-fit-release-final.log'));
summary.runCostsSeconds = {
  unityRun0: (runs[0].mtimeMs - Date.parse(after.capture.capturedAt)) / 1000,
  unityRun1: (runs[1].mtimeMs - runs[0].mtimeMs) / 1000,
  browserReplay: (replayLog.mtimeMs - replayLog.birthtimeMs) / 1000,
  releaseChecks: (releaseLog.mtimeMs - releaseLog.birthtimeMs) / 1000,
};
const lines = ['# 第一期 Unity 拟合实测', '',
  '2026-10-05，本地实现与提交；没有推送或发布。API、类型、同步构造和单文件打包方式保留。', '',
  `参考：UnityMouseFxLab / Unity 2021.3.45f1；Edge ${after.browser}，1950×1097、DPR 1、黑底、SDR。两次新采集各自运行两个独立 Unity 图形进程，状态和像素重复一致；前后 ${identicalBuffers} 个参考缓冲也逐字节一致。`, '',
  `原工程 SHA-256：\`${after.capture.sourceProjectHash}\`。完整参考、网页浮点缓冲和逐层指标保留在独立的 \`test-results/unity-comparison-fit-before\` / \`unity-comparison-fit-after\` 中。旧 stage11/stage12 目录保留。`, '',
  '## 同状态拖尾', '',
  '下表是最终 SDR 合成层。前景 MAE 使用 Unity、旧版和新版的相同并集区域，阈值 1/255；黑色背景不参与该前景指标。', '',
  '| 410 ms 样本 | 后端 | RGB 总量差：旧 → 新 | MAE 降幅 | 前景 MAE：旧 → 新 |',
  '|---|---|---|---|---|'];
for (const name of ['trail-runtime-corner-410', 'trail-runtime-reverse-410'])
for (const backend of ['webgl2', 'webgpu'])
{
  const old = before.cases[name][backend].stages['40_Composite'];
  const current = after.cases[name][backend].stages['40_Composite'];
  const entry = { name, backend, old, current, maeReduction: reduction(old, current, 'meanAbsoluteError') };
  summary.trail.push(entry);
  if (Math.abs(current.relativeEnergyError) > (backend === 'webgl2' ? 0.01 : 0.05) || entry.maeReduction < 0.75)
    throw new Error(`${name}/${backend} 同状态拖尾目标未达标`);
  lines.push(`| ${name.includes('corner') ? '直角' : '折返'} | ${backend} | ${percentage(old.relativeEnergyError)} → ${percentage(current.relativeEnergyError)} | ${percentage(entry.maeReduction)} | ${current.foreground.baseline.meanAbsoluteError.toExponential(4)} → ${current.foreground.actual.meanAbsoluteError.toExponential(4)} |`);
}
lines.push('', '两个样本均达到 WebGL2 ≤1%、WebGPU ≤5% 和 MAE 下降 ≥75% 的同状态目标。插值端点由 JS 根据输入时间与寿命计算，Unity BakeMesh 只作参考。', '',
  '## JS 自行推进的完整生命周期', '',
  '| 路径 | 全历史最大旧端偏差 | Unity / JS 消失时刻 | 可见性错配 |', '|---|---|---|---|');
for (const [path, time] of [['fixed', 410], ['corner', 450], ['reverse', 450]])
{
  const name = `trail-runtime-${path}-${time}`;
  const lifecycle = after.inputCases[name].webgl2.lifecycle;
  summary.lifecycle.push({ name, ...lifecycle });
  if (lifecycle.maximumStartError > 0.5 || Math.abs(lifecycle.disappearanceErrorMs) > 10 || lifecycle.visibilityMismatches.length)
    throw new Error(`${name} 生命周期未达标`);
  lines.push(`| ${path} | ${lifecycle.maximumStartError.toFixed(6)} px | ${lifecycle.unityDisappearance} / ${lifecycle.webDisappearance} ms | ${lifecycle.visibilityMismatches.length} |`);
}
lines.push('', '公共指针 API 输入相同事件，由生产虚拟时钟和拖尾更新函数自行推进，不注入 Unity 点集。首次移动时初始两端同批出生；释放后头部宽度为零仍属于可见拖尾。寿命边界、全部过期、停顿后重新移动、暂停恢复和取消另有运行时检查。', '',
  '## 点击与圆环', '',
  '圆环几何验收以线性 HDR 场景层 `00_UI_HDR` 为主，同时报告最终合成，避免把 Bloom/SDR 误差混入几何结论。', '',
  '| 时刻 | 后端 | 场景层 MAE / RMSE 降幅 | 最终合成 MAE / RMSE 降幅 |', '|---|---|---|---|');
for (const time of [50, 100, 120, 130, 250, 450])
for (const backend of ['webgl2', 'webgpu'])
{
  const name = `click-${time}`;
  const stages = {};
  for (const layer of ['00_UI_HDR', '40_Composite'])
  {
    const old = before.cases[name][backend].stages[layer];
    const current = after.cases[name][backend].stages[layer];
    stages[layer] = { maeReduction: reduction(old, current, 'meanAbsoluteError'), rmseReduction: reduction(old, current, 'rmse'), old, current };
  }
  summary.clicks.push({ time, backend, stages });
  const pair = layer => `${percentage(stages[layer].maeReduction)} / ${percentage(stages[layer].rmseReduction)}`;
  lines.push(`| ${time} ms | ${backend} | ${pair('00_UI_HDR')} | ${pair('40_Composite')} |`);
}
lines.push('', '130 ms 的场景与最终层 MAE、RMSE 均下降超过 50%，其余点击场景层也改善。**50 ms 的最终合成 MAE 上升约 41%，未达到“其他点击误差增幅 ≤5%”的完整合成目标**，即使该样本场景层和最终 RMSE 改善，也不能计为完整达标。450 ms 仍有约 1.8% RGB 总量不足。', '',
  '针对 50 ms 的额外诊断只在验收夹具中分别使用原始 BakeMesh 坐标/UV、改用先减中心的投影计算，最终 MAE 仍约为 9.27e-6 / 9.26e-6，未消除回归。两种诊断都未进入生产代码，不能据此确认剩余误差的根因；需要继续隔离各合成阶段。', '',
  '## 仍未解决的差异', '',
  'JS 自行输入的 410 ms 拖尾最终 RGB 总量差如下；端点和消失时刻达标不代表整条拖尾像素一致。网页采样密度与 Unity 不同，颜色插值是需要进一步隔离确认的误差因素。', '',
  '| 路径 | WebGL2 | WebGPU |', '|---|---|---|');
for (const path of ['corner', 'reverse']) lines.push(`| ${path} | ${percentage(after.inputCases[`trail-runtime-${path}-410`].webgl2.stages['40_Composite'].relativeEnergyError)} | ${percentage(after.inputCases[`trail-runtime-${path}-410`].webgpu.stages['40_Composite'].relativeEnergyError)} |`);
lines.push('', '点击随机数、运动模拟、Native 扩散模型及 HDR 专项校准没有在本期调整；本次实测不证明这些部分完整复刻。Native 的 48 组数值黄金记录保持一致，Canvas/Native 默认内部积分保留原精度。', '',
  '## 运行成本', '',
  '七轮 CPU 微基准取中位数，同机前后依次运行。耗时包含浏览器调度噪声，不代表 GPU FPS；静止轨迹仅复用缓存，移动轨迹包含连续裁切和几何重建。', '',
  '| 工作 | 旧版 ms/次 | 新版 ms/次 | 变化 |', '|---|---|---|---|');
for (const key of ['rings', 'fixedTrail', 'changingTrail'])
{
  const old = benchmarks[0].cases[key]; const current = benchmarks[1].cases[key];
  summary.costs[key] = { old, current };
  lines.push(`| ${key} | ${old.msPerIteration.toFixed(7)} | ${current.msPerIteration.toFixed(7)} | ${percentage(current.msPerIteration / old.msPerIteration - 1)} |`);
}
lines.push('', '默认双圆环顶点数据从 62,856 降至 9,360 字节（约 -85.1%），索引数据从 36,864 降至 3,072 字节（-91.7%）。移动拖尾有持续重建的成本；静止点集缓存避免每帧扫描全部采样。', '',
  `日志时间记录：Unity 两轮约 ${summary.runCostsSeconds.unityRun0.toFixed(1)} / ${summary.runCostsSeconds.unityRun1.toFixed(1)} 秒，网页完整重放约 ${summary.runCostsSeconds.browserReplay.toFixed(1)} 秒，最终发布检查约 ${summary.runCostsSeconds.releaseChecks.toFixed(1)} 秒。网页重放包含浮点回读、压缩、PNG 与指标计算，且曾与其他验证共享本机；不能当作渲染帧率。`, '',
  '## 对照图与验证', '',
  '对照图应从固定坐标区域裁切，统一缩放用于观察；不参与指标计算。列顺序为 Unity、旧版、新版、新版差异放大 16 倍。', '',
  '本地对照图可保存为 `unity-fit-stage1.png`；图片不参与指标计算。', '',
  '完整分层 RGB 总量与误差见 [指标 JSON](unity-fit-stage1-metrics.json)。本机完成 `npm run check:release`、`verify:unity-reference` 和真实 Unity 分层对照。浏览器覆盖 DPR 1/2、灰底/白底与连续性、公共 API、暂停/恢复/取消、自定义采样/宽度/旋转/溶解方向。WebGPU 实际运行，设备没有跳过。视觉基线在确认 Unity 场景误差下降之后更新；50 ms 最终合成回归仍在本报告中明确保留。', '',
  '复现报告：`node scripts/report-unity-fit.mjs`。微基准：`node scripts/benchmark-runtime.mjs unity-fit-after /src/ --fit-only`，旧版替换为冻结源码前缀。');
for (const mode of ['cases', 'inputCases'])
for (const [name, records] of Object.entries(after[mode]))
for (const [backend, record] of Object.entries(records))
{
  if (record.skipped) throw new Error(`${backend} 被跳过`);
  summary.layers[`${mode}/${name}/${backend}`] = Object.fromEntries(Object.entries(record.stages).map(([layer, value]) => [layer, {
    referenceRGB: value.referenceEnergy, webRGB: value.actualEnergy, relativeError: value.relativeEnergyError,
    mae: value.meanAbsoluteError, rmse: value.rmse, foreground: value.foreground,
  }]));
}
const clickPass = (entry, layer) => entry.stages[layer].maeReduction >= (entry.time === 130 ? 0.5 : -0.05) &&
  entry.stages[layer].rmseReduction >= (entry.time === 130 ? 0.5 : -0.05);
summary.checks = {
  sameStateTrailEnergyAndMAE: true, inputEndpointsAndDisappearance: true,
  clickSceneLayer: summary.clicks.every(entry => clickPass(entry, '00_UI_HDR')),
  clickCompositeLayer: summary.clicks.every(entry => clickPass(entry, '40_Composite')),
  independentTrailEnergy: ['corner', 'reverse'].every(path => ['webgl2', 'webgpu'].every(backend =>
    Math.abs(after.inputCases[`trail-runtime-${path}-410`][backend].stages['40_Composite'].relativeEnergyError) <= (backend === 'webgl2' ? 0.01 : 0.05))),
};
summary.allPixelTargetsMet = Object.values(summary.checks).every(Boolean);
await mkdir(reportPath, { recursive: true });
await writeFile(join(reportPath, 'unity-fit-stage1.md'), `${lines.join('\n')}\n`);
await writeFile(join(reportPath, 'unity-fit-stage1-metrics.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`报告已生成：${identicalBuffers} 个前后参考缓冲字节一致；保留最终合成的未达标项。`);
