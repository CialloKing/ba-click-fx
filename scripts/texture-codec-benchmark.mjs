import assert from 'node:assert/strict';
import { join, relative } from 'node:path';
import { chromium } from 'playwright-core';
import { findChromiumExecutable, startViteServer } from '../test/browser/harness.mjs';

export async function benchmarkTextureCodecs(root, builds)
{
  const vite = await startViteServer(root);
  const browser = await chromium.launch({ executablePath: findChromiumExecutable(), headless: true });
  const report = { browser: browser.version(), results: [], nativeFormats: {} };
  try
  {
    for (const build of builds.filter(item => item.packets.length))
    {
      const page = await browser.newPage();
      try
      {
        await page.goto(vite.baseUrl + '/test/browser/custom.html');
        const url = vite.baseUrl + '/' + relative(root, join(build.directory, 'resource-check.js')).replaceAll('\\', '/');
        const result = await page.evaluate(async url =>
        {
          const { decodePayload, packets } = await import(url);
          // Base64 和散列校验不进入计时；只测同步解码全部压缩数据的成本。
          const inputs = packets.map(packet => Uint8Array.from(atob(packet.encoded), item => item.charCodeAt(0)));
          for (const [index, packet] of packets.entries())
          {
            const decoded = decodePayload(inputs[index]);
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', decoded)),
              item => item.toString(16).padStart(2, '0')).join('');
            if (decoded.length !== packet.inputBytes || hash !== packet.sha256)
            {
              throw new Error('Browser decoder byte mismatch: ' + packet.name);
            }
          }
          const rounds = [];
          for (let trial = 0; trial < 30; trial++)
          {
            const start = performance.now();
            inputs.forEach(input => decodePayload(input));
            if (trial >= 5)
            {
              rounds.push(performance.now() - start);
            }
          }
          rounds.sort((left, right) => left - right);
          const nativeFormats = Object.fromEntries(['deflate-raw', 'brotli', 'zstd'].map(format =>
          {
            try { new DecompressionStream(format); return [format, true]; }
            catch { return [format, false]; }
          }));
          return { packets: packets.length, decodedBytes: packets.reduce((sum, packet) => sum + packet.inputBytes, 0),
            samples: rounds.length, medianMs: rounds[Math.floor(rounds.length / 2)], p95Ms: rounds[Math.floor(rounds.length * 0.95)], nativeFormats };
        }, url);
        assert.equal(result.samples, 25);
        const { nativeFormats, ...measurements } = result;
        report.nativeFormats = nativeFormats;
        report.results.push({ name: build.name, codec: build.codec, ...measurements });
      }
      finally
      {
        await page.close();
      }
    }
    return report;
  }
  finally
  {
    await browser.close();
    await vite.server.close();
  }
}
