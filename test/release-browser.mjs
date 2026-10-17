import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMain } from './cli.mjs';
import { customBuildStats, withCustomBuildSession } from './custom-build-fixture.mjs';
import { runCustomRelease } from './custom-release.mjs';

export async function runReleaseBrowser({ releaseAssets = false, prepare = false } = {})
{
  const root = resolve(import.meta.dirname, '..');
  const start = performance.now();
  const report = { complete: false, releaseAssets, stages: [] };
  const output = resolve(root, 'test-results/release-browser');
  mkdirSync(output, { recursive: true });
  return withCustomBuildSession(async () =>
  {
    const stage = async (name, run) =>
    {
      const started = performance.now();
      const entry = { name, complete: false };
      report.stages.push(entry);
      console.log(`Release browser: ${name}`);
      try { await run(); entry.complete = true; }
      finally { entry.elapsedMs = performance.now() - started; }
    };
    try
    {
      if (prepare)
      {
        // 从本轮主构建开始共享压缩会话，子进程通过环境继承临时缓存。
        await stage(releaseAssets ? 'prepare-release' : 'check', () =>
        {
          if (!releaseAssets) assert(process.env.npm_execpath, 'Run the full check through npm run check:release');
          execFileSync(process.execPath, releaseAssets ? ['scripts/prepare-release.mjs']
            : [process.env.npm_execpath, 'run', 'check'], { cwd: root, stdio: 'inherit' });
        });
      }
      // 无定制构建的专项继续进程隔离，共享编译的专项各自创建独立浏览器。
      for (const name of ['core', 'offscreen-worker-runtime', 'lifecycle', 'demo', 'unity', 'webgpu-runtime'])
      {
        await stage(name, () => execFileSync(process.execPath,
          [`test/browser/${name}.mjs`, ...(name === 'webgpu-runtime' ? ['--optional'] : [])],
          { cwd: root, stdio: 'inherit' }));
      }
      for (const [file, name] of [['gpu-optimization', 'runGpuOptimization'], ['trail-work', 'runTrailWork'],
        ['software-optimization', 'runSoftwareOptimization'], ['canvas-texture-cache', 'runCanvasTextureCache']])
      {
        await stage(file, async () => (await import(`./browser/${file}.mjs`))[name]());
      }
      // CI 的 Linux job 已执行静态定制检查；Windows 必须对待发布附件验收。
      await stage('custom-release', () => runCustomRelease({ releaseAssets, staticChecks: !releaseAssets }));
      report.complete = true;
    }
    finally
    {
      report.builds = customBuildStats();
      report.elapsedMs = performance.now() - start;
      writeFileSync(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
      console.log(`Release browser: ${JSON.stringify({ complete: report.complete, builds: report.builds, elapsedMs: report.elapsedMs })}`);
    }
    return report;
  });
}

if (isMain(import.meta))
{
  const args = process.argv.slice(2);
  assert(args.every(arg => arg === '--release-assets' || arg === '--prepare'));
  await runReleaseBrowser({ releaseAssets: args.includes('--release-assets'), prepare: args.includes('--prepare') });
}
