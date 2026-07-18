import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8'));
const npmCli = process.env.npm_execpath;

function verify(condition, message)
{
  if (!condition)
  {
    throw new Error(`[verify-pack] ${message}`);
  }
}

verify(
  npmCli,
  'npm CLI path is unavailable; run this check through npm run verify:pack',
);

// check 会在 prepublishOnly 中运行；忽略生命周期脚本可避免 pack 再次递归触发 prepack。
const output = execFileSync(
  process.execPath,
  [npmCli, 'pack', '--dry-run', '--json', '--ignore-scripts'],
  {
    cwd: rootDir,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  },
);
const packResult = JSON.parse(output);

verify(Array.isArray(packResult) && packResult.length === 1, 'npm pack returned an invalid result');

const packageResult = packResult[0];
const expectedFiles = [
  'LICENSE',
  'README.en.md',
  'README.md',
  'THIRD_PARTY_NOTICES.md',
  'dist/ba-click-fx.cjs',
  'dist/ba-click-fx.d.ts',
  'dist/ba-click-fx.iife.js',
  'dist/ba-click-fx.js',
  'package.json',
].sort();
const packedFiles = packageResult.files.map((file) => file.path).sort();

verify(packageResult.name === packageJson.name, 'packed package name is incorrect');
verify(packageResult.version === packageJson.version, 'packed package version is incorrect');
verify(packageResult.entryCount === expectedFiles.length, `packed package must contain exactly ${expectedFiles.length} files`);
verify(
  JSON.stringify(packedFiles) === JSON.stringify(expectedFiles),
  `packed file list differs from the expected list:\n${packedFiles.join('\n')}`,
);

console.log(`\u2714 npm package contains exactly ${expectedFiles.length} expected files`);
