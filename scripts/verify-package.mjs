import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readText(relativePath)
{
  return readFileSync(resolve(rootDir, relativePath), 'utf8');
}

function readJson(relativePath)
{
  return JSON.parse(readText(relativePath));
}

function verify(condition, message)
{
  if (!condition)
  {
    throw new Error(`[verify-package] ${message}`);
  }
}

function normalizePath(filePath)
{
  return filePath.replace(/^\.\//, '');
}

const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const changelog = readText('CHANGELOG.md');
const version = '1.3.2';

verify(packageJson.name === 'ba-click-fx', 'package name must remain ba-click-fx');
verify(packageJson.version === version, `package version must remain ${version}`);
verify(packageLock.name === packageJson.name, 'lockfile package name is out of sync');
verify(packageLock.version === version, 'lockfile root version is out of sync');
verify(
  packageLock.packages?.['']?.version === version,
  'lockfile packages[""] version is out of sync',
);

const changelogHeadings = [...changelog.matchAll(/^##\s+(.+)$/gm)];
verify(changelogHeadings.length > 0, 'CHANGELOG does not contain any version heading');
verify(
  changelogHeadings[0][1].trim() === `v${version} - 同步 FX_Touch 渲染合同`,
  `latest CHANGELOG heading must be v${version}`,
);

for (const relativePath of ['README.md', 'README.en.md', 'index.html', 'src/main.js'])
{
  const referencedVersions = [
    ...readText(relativePath).matchAll(/ba-click-fx@(\d+\.\d+\.\d+)/g),
  ];

  for (const versionMatch of referencedVersions)
  {
    verify(
      versionMatch[1] === version,
      `${relativePath} references ${versionMatch[1]} instead of ${version}`,
    );
  }
}

const expectedFiles = [
  'dist/ba-click-fx.d.ts',
  'dist/ba-click-fx.js',
  'dist/config.d.ts',
  'dist/config.js',
  'dist/worker.d.ts',
  'dist/worker.js',
  'README.md',
  'README.en.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
].sort();
const configuredFiles = packageJson.files.map(normalizePath).sort();

verify(
  JSON.stringify(configuredFiles) === JSON.stringify(expectedFiles),
  'package files whitelist differs from the expected entries',
);

const entryFiles = new Set([
  packageJson.main,
  packageJson.types,
  ...Object.values(packageJson.exports ?? {}).flatMap((entry) =>
    Object.values(entry),
  ),
]);

for (const entryFile of entryFiles)
{
  verify(
    typeof entryFile === 'string' && existsSync(resolve(rootDir, entryFile)),
    `package entry does not exist: ${entryFile}`,
  );
}

for (const declarationName of ['ba-click-fx', 'config', 'worker'])
{
  const sourceDeclaration = readFileSync(
    resolve(rootDir, 'src', `${declarationName}.d.ts`),
  );
  const builtDeclaration = readFileSync(
    resolve(rootDir, 'dist', `${declarationName}.d.ts`),
  );

  verify(
    sourceDeclaration.equals(builtDeclaration),
    `built TypeScript declaration is not synchronized with src/${declarationName}.d.ts`,
  );
}

console.log(`\u2714 ESM-only package metadata and version are synchronized (${version})`);
