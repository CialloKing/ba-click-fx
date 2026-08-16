import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const distDir = join(rootDir, 'dist');
const tempWorkerFile = join(distDir, 'ba-click-fx.worker.iife.js');
const generatedWorkerSourceFile = join(rootDir, 'src', 'worker-code.generated.js');

function runVite(args)
{
  // 直接调用 Vite 的 JS 入口，避免把跨平台构建逻辑塞进 package.json。
  execFileSync(process.execPath, [viteBin, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

mkdirSync(distDir, { recursive: true });

// 1. 先将 Worker 脚本打包为单文件 IIFE
runVite(['build', '--config', 'vite.worker.config.js']);

// 2. 将打包后的 Worker 代码内嵌至 generated 源码模块中
const workerSource = readFileSync(tempWorkerFile, 'utf8');
writeFileSync(
  generatedWorkerSourceFile,
  `/**
 * 自动生成的 Worker 内联脚本源码。
 * 构建时由 scripts/build.mjs 自动更新。
 */
export const WORKER_SOURCE = ${JSON.stringify(workerSource)};
`,
  'utf8',
);
unlinkSync(tempWorkerFile);

// 3. 构建 Demo 和主库产物
runVite(['build']);
runVite(['build', '--config', 'vite.lib.config.js']);

copyFileSync(
  join(rootDir, 'src', 'ba-click-fx.d.ts'),
  join(distDir, 'ba-click-fx.d.ts'),
);
