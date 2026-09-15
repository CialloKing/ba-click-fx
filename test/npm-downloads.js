import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { updateNpmDownloads } from '../scripts/update-npm-downloads.mjs';

function fixture(context, override = value => value)
{
  const directory = mkdtempSync(join(tmpdir(), 'ba-click-fx-npm-downloads-'));
  const outputPath = join(directory, 'badge.json');
  const periods = [];

  context.after(() =>
  {
    rmSync(outputPath, { force: true });
    rmdirSync(directory);
  });
  return {
    outputPath,
    periods,
    now: new Date('2026-01-03T00:10:00Z'),
    fetchImpl: async (url) =>
    {
      const period = url.split('/').at(-2);
      const [start, end] = period.split(':');
      const payload = url.startsWith('https://registry.npmjs.org/')
        ? { time: { created: '2023-12-31T23:00:00Z' } }
        : { package: 'ba-click-fx', start, end, downloads: 1000 };

      if (period.includes(':'))
      {
        periods.push(period);
      }

      const result = override(payload, period);

      return result instanceof Response ? result : Response.json(result);
    },
  };
}

test('自然年分段覆盖闰年、不重叠漏日，统计至 UTC 昨日并保持重复运行幂等', async (context) =>
{
  const options = fixture(context);
  const result = await updateNpmDownloads(options);

  assert.deepEqual(options.periods,
    ['2023-12-31:2023-12-31', '2024-01-01:2024-12-31', '2025-01-01:2025-12-31', '2026-01-01:2026-01-02']);
  assert.equal(result.total, 4000);
  assert.equal(result.through, '2026-01-02');
  assert.deepEqual(JSON.parse(readFileSync(options.outputPath, 'utf8')),
    { schemaVersion: 1, label: 'npm lifetime downloads', message: '4k', color: 'CB3837' });
  assert.equal(result.changed, true);
  assert.equal((await updateNpmDownloads(options)).changed, false);
});

test('年初仅统计去年；首次发布尚无完整日时输出零，不请求反向区间', async (context) =>
{
  const options = fixture(context);

  options.now = new Date('2026-01-01T00:01:00Z');
  assert.equal((await updateNpmDownloads(options)).total, 3000);
  assert.equal(options.periods.at(-1), '2025-01-01:2025-12-31');

  const fresh = fixture(context, (payload) => payload.time
    ? { time: { created: '2026-01-03T00:01:00Z' } } : payload);

  assert.equal((await updateNpmDownloads(fresh)).total, 0);
  assert.deepEqual(fresh.periods, []);
});

test('后续分段 HTTP 失败、无效数值、错误包名或日期截断均不覆盖旧徽章', async (context) =>
{
  for (const corrupt of [
    () => new Response('unavailable', { status: 503 }),
    () => new Response('not json'),
    payload => ({ ...payload, downloads: -1 }),
    payload => ({ ...payload, downloads: 1.5 }),
    payload => ({ ...payload, package: 'another-package' }),
    payload => ({ ...payload, start: '2024-02-01' }),
    payload => ({ ...payload, end: '2024-12-30' }),
  ])
  {
    const options = fixture(context, (payload, period) => period.startsWith('2024-')
      ? corrupt(payload) : payload);

    writeFileSync(options.outputPath, 'previous complete badge\n');
    await assert.rejects(updateNpmDownloads(options));
    assert.equal(readFileSync(options.outputPath, 'utf8'), 'previous complete badge\n');
  }
});
