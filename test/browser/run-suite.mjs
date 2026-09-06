import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  closeBrowserRuntime,
  findChromiumExecutable,
  getExecutableVersion,
  launchChromium,
  startViteServer,
  writeFailureArtifacts,
} from './harness.mjs';
import { createRuntimeState } from './browser-common.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function runBrowserSuite(name, runSuite)
{
  if (!['core', 'lifecycle', 'demo', 'unity'].includes(name))
  {
    throw new Error(`未知浏览器专项: ${name}`);
  }

  const optional = process.argv.includes('--optional');
  const calibrate = process.argv.includes('--calibrate');
  const artifactDir = join(rootDir, 'test-results', 'browser-pixels', name);
  const state = createRuntimeState();
  let browser = null;
  let vite = null;

  try
  {
    if (calibrate && name !== 'core')
    {
      throw new Error('--calibrate 仅支持 core 浏览器专项');
    }

    const executablePath = findChromiumExecutable();

    if (!executablePath)
    {
      const message = '找不到可用的 Chrome/Edge。请设置 BACLICKFX_CHROMIUM_PATH ' +
        '指向 Chromium 可执行文件。';

      if (optional)
      {
        console.warn(`[browser-${name}] SKIP: ${message}`);
        return;
      }

      throw new Error(message);
    }

    let baseline = null;

    if (name === 'core')
    {
      const baselinePath = join(rootDir, 'test', 'browser', 'baseline.json');

      if (!existsSync(baselinePath) && !calibrate)
      {
        throw new Error(`缺少数值特征基线: ${baselinePath}`);
      }

      baseline = existsSync(baselinePath)
        ? JSON.parse(readFileSync(baselinePath, 'utf8'))
        : null;
    }

    if (typeof runSuite !== 'function')
    {
      throw new TypeError(`浏览器专项 ${name} 未导出 runSuite 函数`);
    }
    const browserVersion = getExecutableVersion(executablePath);

    Object.assign(state.metrics.environment,
      { executablePath, browserVersion, node: process.version });
    const viteRuntime = await startViteServer(rootDir);

    vite = viteRuntime.server;
    browser = await launchChromium(executablePath);
    const startedAt = performance.now();
    const calibration = await runSuite(
      { browser, baseUrl: viteRuntime.baseUrl, state, baseline, calibrate },
    );

    if (calibrate)
    {
      console.log('\n[browser-core] calibration:');
      console.log(JSON.stringify(calibration, null, 2));
    }

    const durationSeconds = (performance.now() - startedAt) / 1000;

    console.log(`\n[browser-${name}] 完成：${state.assertionCount} 项断言，` +
      `${durationSeconds.toFixed(2)} 秒。`);
    console.log(`浏览器：${browserVersion}`);
  }
  catch (error)
  {
    await writeFailureArtifacts({ artifactDir, ...state, error });
    console.error(`\n[browser-${name}] FAIL (${state.currentLabel}): ` +
      error.message);

    if (error.detail)
    {
      console.error(JSON.stringify(error.detail, null, 2));
    }

    process.exitCode = 1;
  }
  finally
  {
    // 失败页必须留到截图完成；关闭浏览器会一并回收 suite 的所有 Context。
    await closeBrowserRuntime({ browser, vite });
  }
}
