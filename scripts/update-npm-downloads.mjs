#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const PACKAGE_NAME = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).name;
const BADGE_PATH = fileURLToPath(new URL('../badges/npm-downloads.json', import.meta.url));
const DOWNLOADS_API = 'https://api.npmjs.org/downloads/point';

function verify(condition, message)
{
  if (!condition)
  {
    throw new Error(`[npm-downloads] ${message}`);
  }
}

function dateOnly(value)
{
  const date = new Date(value);

  verify(Number.isFinite(date.getTime()), `invalid date: ${value}`);
  return date.toISOString().slice(0, 10);
}

function validateDay(value)
{
  verify(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'expected YYYY-MM-DD');
  verify(dateOnly(value) === value, `invalid calendar date: ${value}`);
  return value;
}

function validatePoint(payload)
{
  verify(payload?.package === PACKAGE_NAME, 'download response has the wrong package');
  verify(Number.isSafeInteger(payload.downloads) && payload.downloads >= 0, 'invalid download count');
  validateDay(payload.start);
  validateDay(payload.end);
}

async function fetchJson(url, fetchImpl)
{
  const response = await fetchImpl(url,
    {
      headers: { Accept: 'application/json', 'User-Agent': `${PACKAGE_NAME}-download-counter` },
      signal: AbortSignal.timeout(30000),
    });

  verify(response.ok, `HTTP ${response.status}: ${url}`);
  return response.json();
}

export async function updateNpmDownloads(
  { now = new Date(), fetchImpl = fetch, outputPath = BADGE_PATH } = {},
)
{
  const today = dateOnly(now);
  const yesterday = dateOnly(Date.parse(`${today}T00:00:00Z`) - 86400000);
  const encodedName = encodeURIComponent(PACKAGE_NAME);
  const metadata = await fetchJson(`https://registry.npmjs.org/${encodedName}`, fetchImpl);

  verify(typeof metadata?.time?.created === 'string', 'package creation date is missing');
  const created = dateOnly(metadata.time.created);

  verify(created >= '2015-01-10' && created <= today, 'creation date is outside available npm history');

  // 使用显式 UTC 昨日，避免当天未结算数据及 last-day 元数据滞后漏掉已有记录。
  const through = yesterday;
  let total = 0;

  // 两端日期均包含在 npm 结果中；自然年切段避免 18 个月上限及跨年重复计数。
  for (let start = created; start <= through;)
  {
    const year = Number(start.slice(0, 4));
    const yearEnd = `${year}-12-31`;
    const end = yearEnd < through ? yearEnd : through;
    const result = await fetchJson(`${DOWNLOADS_API}/${start}:${end}/${encodedName}`, fetchImpl);

    validatePoint(result);
    verify(result.start === start && result.end === end, `truncated download period: ${start}:${end}`);
    total += result.downloads;
    verify(Number.isSafeInteger(total), 'total download count exceeds safe integer range');
    console.log(`[npm-downloads] ${start}:${end}: ${result.downloads}`);
    start = `${year + 1}-01-01`;
  }

  const badge =
  {
    schemaVersion: 1,
    label: 'npm lifetime downloads',
    message: new Intl.NumberFormat('en-US',
      { notation: 'compact', maximumFractionDigits: 1 }).format(total).toLowerCase(),
    color: 'CB3837',
  };
  const content = `${JSON.stringify(badge, null, 2)}\n`;
  const changed = !existsSync(outputPath) ||
    readFileSync(outputPath, 'utf8').replaceAll('\r\n', '\n') !== content;

  // 所有分段成功后才原子替换徽章；失败时继续保留上一次完整统计。
  if (changed)
  {
    mkdirSync(dirname(outputPath), { recursive: true });
    const temporaryPath = `${outputPath}.${process.pid}.tmp`;

    try
    {
      writeFileSync(temporaryPath, content, 'utf8');
      renameSync(temporaryPath, outputPath);
    }
    finally
    {
      rmSync(temporaryPath, { force: true });
    }
  }

  console.log(`[npm-downloads] ${PACKAGE_NAME}: ${total} lifetime downloads, ${created}:${through}; ` +
    (changed ? 'badge updated' : 'badge unchanged'));
  return { total, created, through, badge, changed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
  // 允许工作流把生成数据写入独立检出的统计分支。
  const { values } = parseArgs({ options: { output: { type: 'string', default: BADGE_PATH } } });

  verify(values.output.length > 0, 'output path is empty');
  updateNpmDownloads({ outputPath: resolve(values.output) }).catch((error) =>
  {
    console.error(error);
    process.exitCode = 1;
  });
}
