import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const timingKeys = new Set(['iterations', 'calibration', 'rounds', 'durationsMs', 'medianMs',
  'msPerIteration', 'belowTargetDuration', 'resolutionLimited']);
const json = value => JSON.stringify(value ?? null);
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');

// 只识别测量叶子；后端信息与时钟校验不会被误判为跳过的场景。
export function collectBenchmarkCases(cases)
{
  const measurements = new Map();
  const skipped = new Map();
  const metadata = new Map();
  const visit = (value, path) =>
  {
    if (value && typeof value === 'object' && !Array.isArray(value))
    {
      if (value.skipped === true) { skipped.set(path, value); return; }
      if (['msPerIteration', 'durationsMs', 'iterations'].some(key => Object.hasOwn(value, key)))
      { measurements.set(path, value); return; }
      if (!Object.keys(value).length) metadata.set(path, value);
      for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
    }
    else metadata.set(path, value);
  };
  visit(cases ?? {}, '');
  return { measurements, skipped, metadata };
}

export function formatDuration(ms)
{
  if (!Number.isFinite(ms)) return '缺失';
  if (ms === 0) return '0 ms（低于计时分辨率）';
  const [scale, unit] = Math.abs(ms) < 0.001 ? [1e6, 'ns'] : Math.abs(ms) < 1 ? [1000, 'µs'] : [1, 'ms'];
  return `${Number((ms * scale).toPrecision(6))} ${unit}`;
}

export function createBenchmarkReport(before, after)
{
  const previous = collectBenchmarkCases(before.cases);
  const next = collectBenchmarkCases(after.cases);
  const environmentKeys = ['platform', 'node', 'cpu', 'browser', 'executablePath'];
  const workloadKeys = ['viewport', 'randomSeed', 'workloadVersion', 'targetBatchMs', 'maximumIterations'];
  const differences = [...environmentKeys, ...workloadKeys].filter(key =>
    before[key] === undefined || after[key] === undefined || json(before[key]) !== json(after[key]));
  const names = [...new Set([...previous.measurements.keys(), ...next.measurements.keys(),
    ...previous.skipped.keys(), ...next.skipped.keys()])];
  const skippedAt = (records, name) => [...records.skipped].find(([path]) => name === path || name.startsWith(`${path}.`));
  const status = (records, name) =>
  {
    const value = records.measurements.get(name);
    if (value) return `${formatDuration(value.msPerIteration)}${value.resolutionLimited ? '（计时受限）' : value.belowTargetDuration ? '（批次不足目标）' : ''}`;
    const skip = skippedAt(records, name);
    return skip ? `跳过：${skip[1].reason ?? '未记录原因'}` : '缺失数据';
  };
  const lines = ['# 运行时性能对比', '',
    `采集记录：${cell(before.label ?? 'before')} / ${cell(after.label ?? 'after')}。`,
    `采集提交：${cell(before.commit ?? '缺失')} → ${cell(after.commit ?? '缺失')}。`, '',
    'CPU 构建与提交耗时，不代表 GPU 帧率。调用计数独立采集，不能按自适应计时轮数缩放。耗时差包含运行条件波动，不构成因果证明。', '',
    '## 环境与工作量', '', '| 字段 | 前 | 后 |', '| --- | --- | --- |'];
  for (const key of [...environmentKeys, ...workloadKeys])
    lines.push(`| ${key} | ${cell(json(before[key]))} | ${cell(json(after[key]))} |`);
  lines.push('', differences.length ? `不可直接比较：字段缺失或不匹配（${differences.join(', ')}），不计算提升比例。` : '记录中的环境与全局工作量一致；逐场景继续检查实际工作量和后端。', '',
    `测量场景数：前 ${previous.measurements.size}，后 ${next.measurements.size}。`, '',
    '| 场景 | 前/操作 | 后/操作 | 前/后每轮操作数 | 耗时减少比例 |', '| --- | ---: | ---: | ---: | --- |');
  for (const name of names)
  {
    const b = previous.measurements.get(name), a = next.measurements.get(name);
    const backend = name.split('.')[0];
    const backendKeys = ['renderer', 'adapter', 'outputMode'];
    const sameBackend = backendKeys.every(key => json(before.cases?.[backend]?.[key]) === json(after.cases?.[backend]?.[key]));
    const sameWork = b && a && ['iterations', 'rounds', 'pointCount', 'warmupIterations', 'countIterations'].every(key => json(b[key]) === json(a[key]))
      && json(b.calibration?.[0]?.iterations) === json(a.calibration?.[0]?.iterations);
    const reliable = b && a && [b, a].every(value => Number.isFinite(value.msPerIteration) && value.msPerIteration > 0
      && !value.resolutionLimited && !value.belowTargetDuration);
    const ratio = differences.length || !sameBackend || !sameWork ? '不可直接比较' : !reliable ? '数据缺失或计时受限'
      : `${((1 - a.msPerIteration / b.msPerIteration) * 100).toFixed(2)}%`;
    lines.push(`| ${cell(name)} | ${cell(status(previous, name))} | ${cell(status(next, name))} | ${b?.iterations ?? '-'} / ${a?.iterations ?? '-'} | ${ratio} |`);
  }
  lines.push('', '## 原始耗时与独立调用计数', '');
  for (const name of names)
  {
    if (!previous.measurements.has(name) && !next.measurements.has(name)) continue;
    lines.push(`### ${name}`, '');
    for (const [label, records] of [['前', previous], ['后', next]])
    {
      const value = records.measurements.get(name);
      if (!value) { lines.push(`${label}：${status(records, name)}`, ''); continue; }
      const details = Object.fromEntries(Object.entries(value).filter(([key]) => !timingKeys.has(key)));
      lines.push(`${label}：${value.rounds ?? '?'} 轮 × ${value.iterations ?? '?'} 次；批次中位数 ${formatDuration(value.medianMs)}。`,
        `原始批次耗时（ms）：\`${json(value.durationsMs)}\``,
        `校准：\`${json(value.calibration)}\``,
        `工作量与独立计数（保留原字段及计数窗口）：\`${json(details)}\``, '');
    }
  }
  lines.push('## 校验结果与后端元数据', '', '| 字段 | 前 | 后 |', '| --- | --- | --- |');
  for (const name of new Set([...previous.metadata.keys(), ...next.metadata.keys()]))
    lines.push(`| ${cell(name || 'cases')} | ${cell(previous.metadata.has(name) ? json(previous.metadata.get(name)) : '缺失数据')} | ${cell(next.metadata.has(name) ? json(next.metadata.get(name)) : '缺失数据')} |`);
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
{
  const [beforePath, afterPath] = process.argv.slice(2);
  if (!beforePath || !afterPath) throw new Error('用法：npm run benchmark:report -- <before.json> <after.json>');
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  const safe = label => String(label).replace(/[^a-zA-Z0-9_-]/g, '-');
  const directory = resolve(import.meta.dirname, '../test-results');
  mkdirSync(directory, { recursive: true });
  const output = resolve(directory, `runtime-comparison-${safe(before.label ?? 'before')}-${safe(after.label ?? 'after')}.md`);
  writeFileSync(output, createBenchmarkReport(before, after));
  console.log(output);
}
