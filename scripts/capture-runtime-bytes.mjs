// 复用既存夹具保存同机完整字节，供缓存优化前后核对；不是跨设备像素基线。
import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { filterFixture } from '../test/software-filter-fixture.js';
import { findChromiumExecutable, startViteServer, closeBrowserRuntime } from '../test/browser/harness.mjs';

const root = resolve(import.meta.dirname, '..');
const label = process.argv[2];
if (!/^[a-zA-Z0-9_-]+$/.test(label ?? '')) throw new Error('需要记录名称');
const result = { filters: await filterFixture(null, true), canvas: {} };
let browser; let vite;
try
{
  const runtime = await startViteServer(root); vite = runtime.server;
  browser = await chromium.launch({ executablePath: findChromiumExecutable(), headless: true,
    args: ['--disable-background-networking', '--disable-extensions', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
  await page.goto(`${runtime.baseUrl}/test/browser/webgpu.html`);
  for (const bloomBackend of ['native', 'software'])
  for (const [name, options] of [['straight', {}], ['bent', { bentTrail: true }], ['ring', { ringVariant: true }]])
    result.canvas[`${bloomBackend}-${name}`] = await page.evaluate(async options =>
      (await import('/test/canvas-alpha-fixture.js')).canvasAlphaFixture(options), { ...options, bloomBackend, includeBytes: true });
}
finally { await closeBrowserRuntime({ browser, vite }); }
const output = resolve(root, 'test-results', `runtime-output-${label}.json`);
await writeFile(output, JSON.stringify(result));
if (process.argv[3]) assert.deepEqual(result, JSON.parse(await readFile(resolve(root, process.argv[3]), 'utf8')), '完整 Float32 / Canvas 字节与采样次数保持一致');
console.log(`保存 ${result.filters.length} 组 Float32、${Object.values(result.canvas).flat().reduce((sum, item) => sum + item.frames.length, 0)} 帧 Canvas 字节：${output}`);
