import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
const typescriptCompiler = resolve(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');
const temporaryRoot = resolve(tmpdir());
const temporaryDirectory = mkdtempSync(join(temporaryRoot, 'ba-click-fx-'));

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

try
{
  verify(
    npmCli,
    'npm CLI path is unavailable; run this check through npm run verify:tarball',
  );

  // 忽略生命周期脚本可避免 check -> pack -> prepack 再次递归构建。
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

  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import BAClickFXDefault, * as moduleExports from 'ba-click-fx'; if (typeof moduleExports.BAClickFX !== 'function' || BAClickFXDefault !== moduleExports.BAClickFX || moduleExports.BLOOM_BACKEND_CHANGE_EVENT !== 'baclickfxbackendchange') process.exit(1);",
    ],
    { cwd: consumerDirectory, stdio: 'pipe' },
  );
  execFileSync(
    process.execPath,
    [
      '--input-type=commonjs',
      '--eval',
      "const moduleExports = require('ba-click-fx'); if (typeof moduleExports.BAClickFX !== 'function' || moduleExports.default !== moduleExports.BAClickFX || moduleExports.BLOOM_BACKEND_CHANGE_EVENT !== 'baclickfxbackendchange') process.exit(1);",
    ],
    { cwd: consumerDirectory, stdio: 'pipe' },
  );

  const installedRoot = join(consumerDirectory, 'node_modules', 'ba-click-fx');
  const iifeSource = readFileSync(
    join(installedRoot, 'dist', 'ba-click-fx.iife.js'),
    'utf8',
  );
  const iifeContext = {};

  vm.runInNewContext(iifeSource, iifeContext);
  verify(
    typeof iifeContext.BAClickFX?.BAClickFX === 'function',
    'IIFE bundle does not expose BAClickFX.BAClickFX',
  );
  verify(
    iifeContext.BAClickFX?.BLOOM_BACKEND_CHANGE_EVENT === 'baclickfxbackendchange',
    'IIFE bundle does not expose the backend change event name',
  );
  verify(
    existsSync(join(installedRoot, 'dist', 'ba-click-fx.d.ts')),
    'installed package is missing its TypeScript declaration',
  );

  verify(
    existsSync(typescriptCompiler),
    'TypeScript compiler is unavailable; install the root development dependencies',
  );

  const typeConsumerSource = `import BAClickFXDefault,
{
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  CONFIG,
  UNITY_FX_TOUCH,
  createConfig,
  type BAClickFXBackendChangeEvent,
  type BAClickFXBloomBackend,
  type BAClickFXConfig,
  type BAClickFXConfigSnapshot,
  type BAClickFXInputFilter,
  type BAClickFXOptions,
  type BAClickFXResolvedBloomBackend,
  type UnityFxTouchConfig,
} from 'ba-click-fx';

const inputFilter: BAClickFXInputFilter = event => event.isPrimary;

const options: BAClickFXOptions =
{
  target: '#fx',
  scale: 1,
  opacity: 1,
  clickEnabled: true,
  trailEnabled: true,
  renderingMode: 'enhanced',
  bloomBackend: 'webgl2',
  softwareBloomEnabled: true,
  lightBackgroundContrastAlpha: 0.08,
  maxDpr: 2,
  inputFilter,
};

const namedInstance = new BAClickFX(options);
const defaultInstance = new BAClickFXDefault();
const configSnapshot: BAClickFXConfigSnapshot = namedInstance.getConfig();
const config: BAClickFXConfig = configSnapshot;
const defaults: BAClickFXConfig = createConfig(
  {
    bloomBackend: 'auto',
  },
);
const unity: UnityFxTouchConfig = UNITY_FX_TOUCH;
const defaultScale: number = CONFIG.scale;
const defaultBloomBackend: BAClickFXBloomBackend = CONFIG.bloomBackend;
const bloomBackend: BAClickFXBloomBackend = config.bloomBackend;
const resolvedBloomBackend: BAClickFXResolvedBloomBackend =
  configSnapshot.resolvedBloomBackend;
const pendingBloomBackend: BAClickFXResolvedBloomBackend = 'pending';
const softwareBloomEnabled: boolean = config.softwareBloomEnabled;
const renderingMode: BAClickFXConfig['renderingMode'] = config.renderingMode;
const lightBackgroundContrastAlpha: number =
  config.lightBackgroundContrastAlpha;

namedInstance.canvas.addEventListener(BLOOM_BACKEND_CHANGE_EVENT, event =>
{
  const backendEvent = event as BAClickFXBackendChangeEvent;
  const requested: BAClickFXBloomBackend =
    backendEvent.detail.requestedBloomBackend;
  const resolved: BAClickFXResolvedBloomBackend =
    backendEvent.detail.resolvedBloomBackend;

  void [requested, resolved];
});

namedInstance.boom(300, 200);
namedInstance.setFxParam('hit.enabled', true);
namedInstance.updateConfig(
  {
    renderingMode: 'enhanced',
    bloomBackend: 'auto',
  },
);
namedInstance.updateConfig(
  {
    softwareBloomEnabled: false,
  },
);
namedInstance.updateConfig(
  {
    renderingMode: 'legacy',
  },
);
namedInstance.clearTrail();
namedInstance.clear();
namedInstance.destroy();

const invalidOptions: BAClickFXOptions =
{
  // @ts-expect-error scale 只接受数字。
  scale: 'invalid',
  // @ts-expect-error 软件 Bloom 开关只接受布尔值。
  softwareBloomEnabled: 'invalid',
  // @ts-expect-error Bloom 后端只接受公开的四种取值。
  bloomBackend: 'webgpu',
  // @ts-expect-error renderingMode 只接受 enhanced 或 legacy。
  renderingMode: 'native-bloom',
};

void [
  defaultInstance,
  config,
  defaults,
  unity,
  defaultScale,
  defaultBloomBackend,
  bloomBackend,
  resolvedBloomBackend,
  pendingBloomBackend,
  softwareBloomEnabled,
  renderingMode,
  lightBackgroundContrastAlpha,
  invalidOptions,
];
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

  // 使用根项目锁定的编译器，但从临时消费者目录解析真实安装包。
  execFileSync(
    process.execPath,
    [typescriptCompiler, '--project', consumerDirectory, '--pretty', 'false'],
    {
      cwd: consumerDirectory,
      stdio: 'inherit',
    },
  );

  console.log('\u2714 local tarball exposes ESM, CommonJS, IIFE, and strict TypeScript types');
}
finally
{
  const relativeTemporaryPath = relative(temporaryRoot, temporaryDirectory);

  // 删除前验证目标确实是本脚本在系统临时目录下创建的子目录。
  if (
    relativeTemporaryPath &&
    relativeTemporaryPath !== '..' &&
    !relativeTemporaryPath.startsWith(`..\\`) &&
    !relativeTemporaryPath.startsWith('../')
  )
  {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
