import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCustom } from './custom-build.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const distDir = join(rootDir, 'dist');

function runVite(args, env = process.env)
{
  // 直接调用 Vite 的 JS 入口，避免把跨平台构建逻辑塞进 package.json。
  execFileSync(process.execPath, [viteBin, ...args], {
    cwd: rootDir,
    env,
    stdio: 'inherit',
  });
}

const args = process.argv.slice(2);
if (args.length)
{
  if (args.length !== 2 || args[0] !== '--profile')
  {
    throw new TypeError('用法: npm run build -- --profile <profile.json>');
  }
  buildCustom(rootDir, resolve(args[1]), runVite);
}
else
{
  runVite(['build']);
  for (const fileName of readdirSync(distDir))
  {
    if (
      fileName === 'ba-click-fx.cjs' ||
      fileName === 'ba-click-fx.iife.js' ||
      /^config(?:-[A-Za-z0-9_-]+)?\.js$/.test(fileName) ||
      /^fx(?:-[A-Za-z0-9_-]+)?\.js$/.test(fileName)
    )
    {
      rmSync(join(distDir, fileName), { force: true });
    }
  }

  for (const entryName of ['ba-click-fx', 'config', 'worker'])
  {
    runVite(
      ['build', '--config', 'vite.lib.config.js'],
      {
        ...process.env,
        BA_CLICK_FX_LIB_ENTRY: entryName,
      },
    );
  }

  mkdirSync(distDir, { recursive: true });
  for (const declarationName of ['ba-click-fx', 'config', 'worker'])
  {
    copyFileSync(
      join(rootDir, 'src', `${declarationName}.d.ts`),
      join(distDir, `${declarationName}.d.ts`),
    );
  }
}
