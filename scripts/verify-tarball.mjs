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
const hostControlMethods = [
  'pointerDown',
  'pointerMove',
  'pointerUp',
  'pointerCancel',
  'setPaused',
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

function verifyRuntimeApi(moduleExports, bundleName)
{
  verify(
    typeof moduleExports?.BAClickFX === 'function',
    `${bundleName} bundle does not expose BAClickFX`,
  );

  for (const methodName of hostControlMethods)
  {
    verify(
      typeof moduleExports.BAClickFX.prototype[methodName] === 'function',
      `${bundleName} bundle does not expose BAClickFX.prototype.${methodName}()`,
    );
  }

  verify(
    moduleExports.CONFIG?.effectBackend === 'webgl2' &&
      moduleExports.CONFIG?.bloomBackend === 'webgl2',
    `${bundleName} bundle does not expose the Full WebGL2 defaults`,
  );
  verify(
    moduleExports.CONFIG?.isolatedCompositing === false &&
      moduleExports.CONFIG?.lightBackgroundContrastAlpha === 0,
    `${bundleName} bundle does not expose the strict compositing defaults`,
  );
  verify(
    moduleExports.CONFIG?.inputSource === 'dom',
    `${bundleName} bundle does not expose the DOM input default`,
  );
  verify(
    moduleExports.CONFIG?.clickTimeScale === 1,
    `${bundleName} bundle does not expose the click time-scale default`,
  );
  verify(
    moduleExports.CONFIG?.trailTimeScale === 1,
    `${bundleName} bundle does not expose the trail time-scale default`,
  );
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

  const esmRuntimeSource = `
import BAClickFXDefault, * as moduleExports from 'ba-click-fx';

const hostControlMethods = ${JSON.stringify(hostControlMethods)};

if (
  typeof moduleExports.BAClickFX !== 'function' ||
  BAClickFXDefault !== moduleExports.BAClickFX ||
  moduleExports.BLOOM_BACKEND_CHANGE_EVENT !== 'baclickfxbackendchange'
)
{
  throw new Error('ESM exports are incomplete');
}

for (const methodName of hostControlMethods)
{
  if (typeof moduleExports.BAClickFX.prototype[methodName] !== 'function')
  {
    throw new Error(\`ESM is missing BAClickFX.prototype.\${methodName}()\`);
  }
}

if (
  moduleExports.CONFIG?.effectBackend !== 'webgl2' ||
  moduleExports.CONFIG?.bloomBackend !== 'webgl2' ||
  moduleExports.CONFIG?.isolatedCompositing !== false ||
  moduleExports.CONFIG?.lightBackgroundContrastAlpha !== 0 ||
  moduleExports.CONFIG?.inputSource !== 'dom' ||
  moduleExports.CONFIG?.clickTimeScale !== 1 ||
  moduleExports.CONFIG?.trailTimeScale !== 1
)
{
  throw new Error('ESM CONFIG defaults are incomplete');
}
`;
  const commonJsRuntimeSource = `
const moduleExports = require('ba-click-fx');
const hostControlMethods = ${JSON.stringify(hostControlMethods)};

if (
  typeof moduleExports.BAClickFX !== 'function' ||
  moduleExports.default !== moduleExports.BAClickFX ||
  moduleExports.BLOOM_BACKEND_CHANGE_EVENT !== 'baclickfxbackendchange'
)
{
  throw new Error('CommonJS exports are incomplete');
}

for (const methodName of hostControlMethods)
{
  if (typeof moduleExports.BAClickFX.prototype[methodName] !== 'function')
  {
    throw new Error(\`CommonJS is missing BAClickFX.prototype.\${methodName}()\`);
  }
}

if (
  moduleExports.CONFIG?.effectBackend !== 'webgl2' ||
  moduleExports.CONFIG?.bloomBackend !== 'webgl2' ||
  moduleExports.CONFIG?.isolatedCompositing !== false ||
  moduleExports.CONFIG?.lightBackgroundContrastAlpha !== 0 ||
  moduleExports.CONFIG?.inputSource !== 'dom' ||
  moduleExports.CONFIG?.clickTimeScale !== 1 ||
  moduleExports.CONFIG?.trailTimeScale !== 1
)
{
  throw new Error('CommonJS CONFIG defaults are incomplete');
}
`;

  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      esmRuntimeSource,
    ],
    { cwd: consumerDirectory, stdio: 'pipe' },
  );
  execFileSync(
    process.execPath,
    [
      '--input-type=commonjs',
      '--eval',
      commonJsRuntimeSource,
    ],
    { cwd: consumerDirectory, stdio: 'pipe' },
  );

  const installedRoot = join(consumerDirectory, 'node_modules', 'ba-click-fx');
  const iifeSource = readFileSync(
    join(installedRoot, 'dist', 'ba-click-fx.iife.js'),
    'utf8',
  );
  const iifeContext =
  {
    // IIFE 在浏览器中天然可用 atob；vm 隔离上下文不会继承宿主全局。
    atob: globalThis.atob,
  };

  vm.runInNewContext(iifeSource, iifeContext);
  verifyRuntimeApi(iifeContext.BAClickFX, 'IIFE');
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
  type BAClickFXEffectBackend,
  type BAClickFXInputFilter,
  type BAClickFXInputSource,
  type BAClickFXOptions,
  type BAClickFXPauseOptions,
  type BAClickFXPointerInput,
  type BAClickFXPointerType,
  type BAClickFXResolvedBloomBackend,
  type BAClickFXResolvedEffectBackend,
  type BAClickFXUpdateOptions,
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
  inputSource: 'manual',
  clickTimeScale: 1.5,
  trailTimeScale: 0.8,
  effectBackend: 'webgl2',
  renderingMode: 'enhanced',
  bloomBackend: 'webgl2',
  softwareBloomEnabled: true,
  isolatedCompositing: true,
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
    effectBackend: 'auto',
    bloomBackend: 'auto',
    isolatedCompositing: false,
  },
);
const unity: UnityFxTouchConfig = UNITY_FX_TOUCH;
const defaultScale: number = CONFIG.scale;
const defaultEffectBackend: BAClickFXEffectBackend = CONFIG.effectBackend;
const defaultBloomBackend: BAClickFXBloomBackend = CONFIG.bloomBackend;
const defaultIsolatedCompositing: boolean = CONFIG.isolatedCompositing;
const bloomBackend: BAClickFXBloomBackend = config.bloomBackend;
const effectBackend: BAClickFXEffectBackend = config.effectBackend;
const resolvedEffectBackend: BAClickFXResolvedEffectBackend =
  configSnapshot.resolvedEffectBackend;
const pendingEffectBackend: BAClickFXResolvedEffectBackend = 'pending';
const resolvedBloomBackend: BAClickFXResolvedBloomBackend =
  configSnapshot.resolvedBloomBackend;
const pendingBloomBackend: BAClickFXResolvedBloomBackend = 'pending';
const softwareBloomEnabled: boolean = config.softwareBloomEnabled;
const isolatedCompositing: boolean = config.isolatedCompositing;
const renderingMode: BAClickFXConfig['renderingMode'] = config.renderingMode;
const lightBackgroundContrastAlpha: number =
  config.lightBackgroundContrastAlpha;
const inputSource: BAClickFXInputSource = config.inputSource;
const clickTimeScale: number = config.clickTimeScale;
const trailTimeScale: number = config.trailTimeScale;
const pointerType: BAClickFXPointerType = 'pen';
const pointerInput: BAClickFXPointerInput =
{
  x: 300,
  y: 200,
  pointerId: 7,
  pointerType,
};
const pauseOptions: BAClickFXPauseOptions =
{
  clear: true,
};

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
const pointerDownAccepted: boolean = namedInstance.pointerDown(pointerInput);
const pointerMoveAccepted: boolean = namedInstance.pointerMove(
  {
    x: 320,
    y: 210,
    pointerId: 7,
    pointerType: 'pen',
  },
);
const pointerUpAccepted: boolean = namedInstance.pointerUp(7);
const pointerCancelAccepted: boolean = namedInstance.pointerCancel();
namedInstance.setPaused(true, pauseOptions);
namedInstance.setPaused(false);
namedInstance.setFxParam('hit.enabled', true);
const updateOptions: BAClickFXUpdateOptions =
{
  effectBackend: 'auto',
  renderingMode: 'enhanced',
  bloomBackend: 'auto',
  inputSource: 'dom',
  clickTimeScale: 2,
  trailTimeScale: 0.5,
};

namedInstance.updateConfig(updateOptions);
namedInstance.updateConfig(
  {
    softwareBloomEnabled: false,
    isolatedCompositing: false,
  },
);
namedInstance.updateConfig(
  {
    renderingMode: 'legacy',
  },
);
namedInstance.updateConfig(
  {
    // @ts-expect-error target 只能在构造实例时指定。
    target: '#replacement',
  },
);
namedInstance.updateConfig(
  {
    // @ts-expect-error inputFilter 只能在构造实例时指定。
    inputFilter,
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
  // @ts-expect-error 隔离合成开关只接受布尔值。
  isolatedCompositing: 'isolate',
  // @ts-expect-error Bloom 后端只接受公开的四种取值。
  bloomBackend: 'webgpu',
  // @ts-expect-error 完整特效后端只接受 canvas2d、webgl2 或 auto。
  effectBackend: 'webgpu',
  // @ts-expect-error renderingMode 只接受 enhanced 或 legacy。
  renderingMode: 'native-bloom',
  // @ts-expect-error inputSource 只接受 dom 或 manual。
  inputSource: 'host',
};

void [
  defaultInstance,
  config,
  defaults,
  unity,
  defaultScale,
  defaultEffectBackend,
  defaultBloomBackend,
  defaultIsolatedCompositing,
  bloomBackend,
  effectBackend,
  resolvedEffectBackend,
  pendingEffectBackend,
  resolvedBloomBackend,
  pendingBloomBackend,
  softwareBloomEnabled,
  isolatedCompositing,
  renderingMode,
  lightBackgroundContrastAlpha,
  inputSource,
  clickTimeScale,
  trailTimeScale,
  pointerType,
  pointerInput,
  pauseOptions,
  pointerDownAccepted,
  pointerMoveAccepted,
  pointerUpAccepted,
  pointerCancelAccepted,
  updateOptions,
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
