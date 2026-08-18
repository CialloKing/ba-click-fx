import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
const typescriptCompiler = resolve(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');
const temporaryRoot = resolve(tmpdir());
const temporaryDirectory = mkdtempSync(join(temporaryRoot, 'ba-click-fx-'));
const requiredRuntimeMethods = [
  'boom',
  'pointerDown',
  'pointerMove',
  'pointerUp',
  'pointerCancel',
  'setPaused',
  'setCompositingReference',
  'getEffectiveHostCompositing',
  'updateConfig',
  'setThemeColor',
  'setThemeColorMode',
  'setInputSamplingRate',
  'setFxParam',
  'setTriangleRoundness',
  'setFxParams',
  'getFxConfig',
  'resetFxConfig',
  'clearTrail',
  'clear',
  'getConfig',
  'destroy',
];

function verify(condition, message)
{
  if (!condition)
  {
    throw new Error(`[verify-tarball] ${message}`);
  }
}

function runNpm(args, cwd)
{
  return execFileSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runtimeContractSource(entryPoint)
{
  return `
import BAClickFXDefault, * as moduleExports from '${entryPoint}';

const requiredRuntimeMethods = ${JSON.stringify(requiredRuntimeMethods)};

if (
  typeof moduleExports.BAClickFX !== 'function' ||
  BAClickFXDefault !== moduleExports.BAClickFX ||
  moduleExports.DEFAULT_THEME_COLOR !== '#4ca7ff' ||
  moduleExports.DEFAULT_THEME_COLOR_MODE !== 'relative-oklch' ||
  moduleExports.CONFIG?.effectBackend !== 'webgl2' ||
  moduleExports.CONFIG?.bloomBackend !== 'webgl2' ||
  moduleExports.CONFIG?.themeColorMode !== 'relative-oklch' ||
  moduleExports.FX_PARAM_SCHEMA_VERSION !== 2 ||
  !Array.isArray(moduleExports.FX_PARAM_SCHEMA) ||
  moduleExports.FX_PARAM_SCHEMA.length !== 66 ||
  !Array.isArray(moduleExports.FX_PARAM_MIGRATIONS) ||
  moduleExports.FX_PARAM_MIGRATIONS.length < 1 ||
  typeof moduleExports.applyFxParamPatch !== 'function'
)
{
  throw new Error('${entryPoint} exports are incomplete');
}

for (const methodName of requiredRuntimeMethods)
{
  if (typeof moduleExports.BAClickFX.prototype[methodName] !== 'function')
  {
    throw new Error('${entryPoint} is missing BAClickFX.prototype.' + methodName + '()');
  }
}

const patchResult = moduleExports.applyFxParamPatch(
  { 'bloom.scatter': 7 },
  { schemaVersion: 0, strict: true },
);

if (
  patchResult.committed !== true ||
  patchResult.applied[0]?.path !== 'bloom.diffusion' ||
  patchResult.applied[0]?.value !== 7 ||
  'nextConfig' in patchResult
)
{
  throw new Error('${entryPoint} applyFxParamPatch() contract is invalid');
}
`;
}

function configContractSource()
{
  return `
import * as config from 'ba-click-fx/config';

if (
  config.DEFAULT_THEME_COLOR_MODE !== 'relative-oklch' ||
  config.CONFIG?.themeColorMode !== 'relative-oklch' ||
  typeof config.createConfig !== 'function' ||
  typeof config.normalizeThemeColorMode !== 'function'
)
{
  throw new Error('config subpath exports are incomplete');
}
`;
}

try
{
  verify(
    npmCli,
    'npm CLI path is unavailable; run this check through npm run verify:tarball',
  );

  const packOutput = runNpm([
    'pack',
    '--json',
    '--ignore-scripts',
    '--pack-destination',
    temporaryDirectory,
  ], rootDir);
  const packResult = JSON.parse(packOutput);

  verify(Array.isArray(packResult) && packResult.length === 1, 'npm pack returned an invalid result');

  const tarballPath = resolve(temporaryDirectory, packResult[0].filename);
  const consumerDirectory = join(temporaryDirectory, 'consumer');

  verify(existsSync(tarballPath), 'npm pack did not create the expected tarball');

  mkdirSync(consumerDirectory);
  writeFileSync(
    join(consumerDirectory, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );

  runNpm([
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    '--offline',
    tarballPath,
  ], consumerDirectory);

  for (const entryPoint of ['ba-click-fx', 'ba-click-fx/worker'])
  {
    execFileSync(
      process.execPath,
      ['--input-type=module', '--eval', runtimeContractSource(entryPoint)],
      { cwd: consumerDirectory, stdio: 'pipe' },
    );
  }
  execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', configContractSource()],
    { cwd: consumerDirectory, stdio: 'pipe' },
  );

  const installedRoot = join(consumerDirectory, 'node_modules', 'ba-click-fx');
  verify(
    !existsSync(join(installedRoot, 'dist', 'ba-click-fx.cjs')) &&
      !existsSync(join(installedRoot, 'dist', 'ba-click-fx.iife.js')),
    'installed package must not contain CommonJS or IIFE entry files',
  );
  verify(
    existsSync(join(installedRoot, 'dist', 'ba-click-fx.d.ts')) &&
      existsSync(join(installedRoot, 'dist', 'config.d.ts')) &&
      existsSync(join(installedRoot, 'dist', 'worker.d.ts')),
    'installed package is missing an ESM TypeScript declaration',
  );

  verify(
    existsSync(typescriptCompiler),
    'TypeScript compiler is unavailable; install the root development dependencies',
  );

  const typeConsumerSource = `import BAClickFXDefault,
{
  BAClickFX,
  CONFIG,
  DEFAULT_THEME_COLOR,
  DEFAULT_THEME_COLOR_MODE,
  FX_PARAM_SCHEMA_VERSION,
  createConfig,
  type BAClickFXConfig,
  type BAClickFXOptions,
  type BAClickFXThemeColorMode,
} from 'ba-click-fx';
import {
  normalizeThemeColorMode,
} from 'ba-click-fx/config';
import {
  BAClickFX as WorkerBAClickFX,
} from 'ba-click-fx/worker';

const options: BAClickFXOptions =
{
  target: '#fx',
  themeColorMode: 'relative-oklch',
  effectBackend: 'webgpu',
  bloomBackend: 'webgl2',
};
const instance = new BAClickFX(options);
const workerInstance: WorkerBAClickFX = instance;
const defaultInstance: BAClickFXDefault = new BAClickFXDefault();
const config: BAClickFXConfig = instance.getConfig();
const defaults: BAClickFXConfig = createConfig({ effectBackend: 'auto' });
const themeMode: BAClickFXThemeColorMode = DEFAULT_THEME_COLOR_MODE;
const normalizedMode: BAClickFXThemeColorMode = normalizeThemeColorMode('relative-oklch');
const version: 2 = FX_PARAM_SCHEMA_VERSION;
const color: string = DEFAULT_THEME_COLOR;
const defaultConfigColor: string = CONFIG.themeColor;

void [workerInstance, defaultInstance, config, defaults, themeMode, normalizedMode, version, color, defaultConfigColor];
instance.destroy();
`;
  const typeScriptConfig =
  {
    compilerOptions:
    {
      target: 'ES2020',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      lib: ['ES2020', 'DOM'],
      strict: true,
      exactOptionalPropertyTypes: true,
      noEmit: true,
      skipLibCheck: false,
      verbatimModuleSyntax: true,
    },
    include: ['consumer.ts'],
  };

  writeFileSync(join(consumerDirectory, 'consumer.ts'), typeConsumerSource);
  writeFileSync(
    join(consumerDirectory, 'tsconfig.json'),
    `${JSON.stringify(typeScriptConfig, null, 2)}\n`,
  );

  execFileSync(
    process.execPath,
    [typescriptCompiler, '--project', consumerDirectory, '--pretty', 'false'],
    {
      cwd: consumerDirectory,
      stdio: 'inherit',
    },
  );

  console.log('\u2714 local tarball exposes ESM root/config/worker entries and strict TypeScript types');
}
finally
{
  const relativeTemporaryPath = relative(temporaryRoot, temporaryDirectory);

  // 删除前验证目标确实是本脚本在系统临时目录下创建的子目录。
  if (
    relativeTemporaryPath &&
    relativeTemporaryPath !== '..' &&
    !relativeTemporaryPath.startsWith('..\\') &&
    !relativeTemporaryPath.startsWith('../')
  )
  {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
