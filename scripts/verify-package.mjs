import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const changelog = readText('CHANGELOG.md');

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

verify(packageJson.name === 'ba-click-fx', 'package name must remain ba-click-fx');
verify(
  /^\d+\.\d+\.\d+$/.test(packageJson.version),
  `invalid release version: ${packageJson.version}`,
);
verify(packageLock.name === packageJson.name, 'lockfile package name is out of sync');
verify(packageLock.version === packageJson.version, 'lockfile root version is out of sync');
verify(
  packageLock.packages?.['']?.version === packageJson.version,
  'lockfile packages[""] version is out of sync',
);
verify(
  JSON.stringify(packageLock.packages?.['']?.devDependencies ?? {}) ===
    JSON.stringify(packageJson.devDependencies ?? {}),
  'lockfile root development dependencies are out of sync',
);

const latestChangelog = changelog.match(/^## v(\d+\.\d+\.\d+)\b/m);

verify(latestChangelog, 'CHANGELOG does not contain a release heading');
verify(
  latestChangelog[1] === packageJson.version,
  `latest CHANGELOG version ${latestChangelog[1]} does not match ${packageJson.version}`,
);

const installExampleFiles = [
  'README.md',
  'README.en.md',
  'index.html',
  'src/main.js',
];

for (const relativePath of installExampleFiles)
{
  const installContent = readText(relativePath);
  const referencedVersions = [
    ...installContent.matchAll(/ba-click-fx@(\d+\.\d+\.\d+)/g),
  ];

  verify(
    referencedVersions.length > 0,
    `${relativePath} does not contain a fixed-version install example`,
  );

  // 固定版本示例必须跟随包版本，避免演示页继续把用户导向旧发行版。
  for (const versionMatch of referencedVersions)
  {
    verify(
      versionMatch[1] === packageJson.version,
      `${relativePath} references ${versionMatch[1]} instead of ${packageJson.version}`,
    );
  }
}

const expectedFiles = [
  'dist/ba-click-fx.js',
  'dist/ba-click-fx.cjs',
  'dist/ba-click-fx.iife.js',
  'dist/ba-click-fx.d.ts',
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
  packageJson.module,
  packageJson.types,
  ...Object.values(packageJson.exports?.['.'] ?? {}),
]);

for (const entryFile of entryFiles)
{
  verify(
    typeof entryFile === 'string' && existsSync(resolve(rootDir, entryFile)),
    `package entry does not exist: ${entryFile}`,
  );
}

const sourceDeclaration = readFileSync(resolve(rootDir, 'src/ba-click-fx.d.ts'));
const builtDeclaration = readFileSync(resolve(rootDir, 'dist/ba-click-fx.d.ts'));

verify(
  sourceDeclaration.equals(builtDeclaration),
  'built TypeScript declaration is not synchronized with src/ba-click-fx.d.ts',
);

console.log(`\u2714 package metadata and version are synchronized (${packageJson.version})`);
