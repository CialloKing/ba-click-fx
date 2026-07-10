import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const distDir = join(rootDir, 'dist');

function runVite(args)
{
  // 直接调用 Vite 的 JS 入口，避免把跨平台构建逻辑塞进 package.json。
  execFileSync(process.execPath, [viteBin, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

runVite(['build']);
runVite(['build', '--config', 'vite.lib.config.js']);

mkdirSync(distDir, { recursive: true });
copyFileSync(
  join(rootDir, 'src', 'ba-click-fx.d.ts'),
  join(distDir, 'ba-click-fx.d.ts'),
);
