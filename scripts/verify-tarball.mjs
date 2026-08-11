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

function verifyRuntimeApi(moduleExports, bundleName)
{
  verify(
    typeof moduleExports?.BAClickFX === 'function',
    `${bundleName} bundle does not expose BAClickFX`,
  );

  for (const methodName of requiredRuntimeMethods)
  {
    verify(
      typeof moduleExports.BAClickFX.prototype[methodName] === 'function',
      `${bundleName} bundle does not expose BAClickFX.prototype.${methodName}()`,
    );
  }

  verify(
    moduleExports.CONFIG?.effectBackend === 'webgl2' &&
      moduleExports.CONFIG?.bloomBackend === 'webgl2' &&
      moduleExports.CONFIG?.outputCompositing === 'scene' &&
      moduleExports.CONFIG?.hostCompositingSurface === 'dom-backdrop' &&
      moduleExports.CONFIG?.themeColor === '#4ca7ff',
    `${bundleName} bundle does not expose the Full WebGL2 defaults`,
  );
  verify(
    moduleExports.CONFIG?.isolatedCompositing === false &&
      moduleExports.CONFIG?.softwareBloomEnabled === false &&
      moduleExports.CONFIG?.lightBackgroundContrastAlpha === 0,
    `${bundleName} bundle does not expose the strict compositing defaults`,
  );
  verify(
    moduleExports.CONFIG?.inputSource === 'dom' &&
      moduleExports.CONFIG?.inputSamplingRate === 0,
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
  verify(
    moduleExports.DEFAULT_THEME_COLOR === '#4ca7ff',
    `${bundleName} bundle does not expose the default theme colour`,
  );
  verify(
    moduleExports.BLOOM_BACKEND_CHANGE_EVENT === 'baclickfxbackendchange' &&
      moduleExports.EFFECT_BACKEND_CHANGE_EVENT ===
        'baclickfxeffectbackendchange' &&
      moduleExports.HOST_COMPOSITING_CHANGE_EVENT ===
        'baclickfxhostcompositingchange',
    `${bundleName} bundle does not expose runtime state event names`,
  );
  verify(
    moduleExports.FX_PARAM_SCHEMA_VERSION === 2 &&
      Array.isArray(moduleExports.FX_PARAM_SCHEMA) &&
      moduleExports.FX_PARAM_SCHEMA.length === 66 &&
      Array.isArray(moduleExports.FX_PARAM_MIGRATIONS) &&
      moduleExports.FX_PARAM_MIGRATIONS.length > 0,
    `${bundleName} bundle does not expose the parameter schema contract`,
  );
  verify(
    typeof moduleExports.applyFxParamPatch === 'function',
    `${bundleName} bundle does not expose applyFxParamPatch()`,
  );

  const patchResult = moduleExports.applyFxParamPatch(
    { 'bloom.scatter': 7 },
    {
      schemaVersion: 0,
      strict: true,
    },
  );

  verify(
    patchResult.committed === true &&
      patchResult.applied[0]?.path === 'bloom.diffusion' &&
      patchResult.applied[0]?.value === 7 &&
      !('nextConfig' in patchResult),
    `${bundleName} applyFxParamPatch() does not preserve the public contract`,
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

const requiredRuntimeMethods = ${JSON.stringify(requiredRuntimeMethods)};

if (
  typeof moduleExports.BAClickFX !== 'function' ||
  BAClickFXDefault !== moduleExports.BAClickFX ||
  moduleExports.BLOOM_BACKEND_CHANGE_EVENT !== 'baclickfxbackendchange' ||
  moduleExports.EFFECT_BACKEND_CHANGE_EVENT !==
    'baclickfxeffectbackendchange' ||
  moduleExports.HOST_COMPOSITING_CHANGE_EVENT !==
    'baclickfxhostcompositingchange' ||
  moduleExports.DEFAULT_THEME_COLOR !== '#4ca7ff' ||
  moduleExports.FX_PARAM_SCHEMA_VERSION !== 2 ||
  !Array.isArray(moduleExports.FX_PARAM_SCHEMA) ||
  moduleExports.FX_PARAM_SCHEMA.length !== 66 ||
  !Array.isArray(moduleExports.FX_PARAM_MIGRATIONS) ||
  moduleExports.FX_PARAM_MIGRATIONS.length < 1 ||
  typeof moduleExports.applyFxParamPatch !== 'function'
)
{
  throw new Error('ESM exports are incomplete');
}

for (const methodName of requiredRuntimeMethods)
{
  if (typeof moduleExports.BAClickFX.prototype[methodName] !== 'function')
  {
    throw new Error(\`ESM is missing BAClickFX.prototype.\${methodName}()\`);
  }
}

if (
  moduleExports.CONFIG?.effectBackend !== 'webgl2' ||
  moduleExports.CONFIG?.bloomBackend !== 'webgl2' ||
  moduleExports.CONFIG?.outputCompositing !== 'scene' ||
  moduleExports.CONFIG?.hostCompositingSurface !== 'dom-backdrop' ||
  moduleExports.CONFIG?.themeColor !== '#4ca7ff' ||
  moduleExports.CONFIG?.softwareBloomEnabled !== false ||
  moduleExports.CONFIG?.isolatedCompositing !== false ||
  moduleExports.CONFIG?.lightBackgroundContrastAlpha !== 0 ||
  moduleExports.CONFIG?.inputSource !== 'dom' ||
  moduleExports.CONFIG?.inputSamplingRate !== 0 ||
  moduleExports.CONFIG?.clickTimeScale !== 1 ||
  moduleExports.CONFIG?.trailTimeScale !== 1
)
{
  throw new Error('ESM CONFIG defaults are incomplete');
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
  throw new Error('ESM applyFxParamPatch() contract is invalid');
}
`;
  const commonJsRuntimeSource = `
const moduleExports = require('ba-click-fx');
const requiredRuntimeMethods = ${JSON.stringify(requiredRuntimeMethods)};

if (
  typeof moduleExports.BAClickFX !== 'function' ||
  moduleExports.default !== moduleExports.BAClickFX ||
  moduleExports.BLOOM_BACKEND_CHANGE_EVENT !== 'baclickfxbackendchange' ||
  moduleExports.EFFECT_BACKEND_CHANGE_EVENT !==
    'baclickfxeffectbackendchange' ||
  moduleExports.HOST_COMPOSITING_CHANGE_EVENT !==
    'baclickfxhostcompositingchange' ||
  moduleExports.DEFAULT_THEME_COLOR !== '#4ca7ff' ||
  moduleExports.FX_PARAM_SCHEMA_VERSION !== 2 ||
  !Array.isArray(moduleExports.FX_PARAM_SCHEMA) ||
  moduleExports.FX_PARAM_SCHEMA.length !== 66 ||
  !Array.isArray(moduleExports.FX_PARAM_MIGRATIONS) ||
  moduleExports.FX_PARAM_MIGRATIONS.length < 1 ||
  typeof moduleExports.applyFxParamPatch !== 'function'
)
{
  throw new Error('CommonJS exports are incomplete');
}

for (const methodName of requiredRuntimeMethods)
{
  if (typeof moduleExports.BAClickFX.prototype[methodName] !== 'function')
  {
    throw new Error(\`CommonJS is missing BAClickFX.prototype.\${methodName}()\`);
  }
}

if (
  moduleExports.CONFIG?.effectBackend !== 'webgl2' ||
  moduleExports.CONFIG?.bloomBackend !== 'webgl2' ||
  moduleExports.CONFIG?.outputCompositing !== 'scene' ||
  moduleExports.CONFIG?.hostCompositingSurface !== 'dom-backdrop' ||
  moduleExports.CONFIG?.themeColor !== '#4ca7ff' ||
  moduleExports.CONFIG?.softwareBloomEnabled !== false ||
  moduleExports.CONFIG?.isolatedCompositing !== false ||
  moduleExports.CONFIG?.lightBackgroundContrastAlpha !== 0 ||
  moduleExports.CONFIG?.inputSource !== 'dom' ||
  moduleExports.CONFIG?.inputSamplingRate !== 0 ||
  moduleExports.CONFIG?.clickTimeScale !== 1 ||
  moduleExports.CONFIG?.trailTimeScale !== 1
)
{
  throw new Error('CommonJS CONFIG defaults are incomplete');
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
  throw new Error('CommonJS applyFxParamPatch() contract is invalid');
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
    // IIFE 在浏览器中天然可用这些能力；vm 隔离上下文不会继承宿主全局。
    atob: globalThis.atob,
    structuredClone: globalThis.structuredClone,
  };

  vm.runInNewContext(iifeSource, iifeContext);
  verifyRuntimeApi(iifeContext.BAClickFX, 'IIFE');
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
  DEFAULT_THEME_COLOR,
  EFFECT_BACKEND_CHANGE_EVENT,
  HOST_COMPOSITING_CHANGE_EVENT,
  FX_PARAM_MIGRATIONS,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  UNITY_FX_TOUCH,
  applyFxParamPatch,
  createConfig,
  type BAClickFXBackendChangeEvent,
  type BAClickFXBloomBackend,
  type BAClickFXConfig,
  type BAClickFXConfigSnapshot,
  type BAClickFXEffectBackend,
  type BAClickFXEffectBackendChangeEvent,
  type BAClickFXHostCompositing,
  type BAClickFXHostCompositingChangeEvent,
  type BAClickFXHostCompositingSurface,
  type BAClickFXInputFilter,
  type BAClickFXInputSource,
  type BAClickFXOptions,
  type BAClickFXOutputCompositing,
  type BAClickFXParamDescriptor,
  type BAClickFXParamMigration,
  type BAClickFXParamPatchOptions,
  type BAClickFXParamPatchResult,
  type BAClickFXParamValue,
  type BAClickFXPauseOptions,
  type BAClickFXPointerInput,
  type BAClickFXPointerType,
  type BAClickFXResolvedBloomBackend,
  type BAClickFXResolvedEffectBackend,
  type BAClickFXWebGPUOutputMode,
  type BAClickFXCompositingReferenceOptions,
  type BAClickFXStandalonePatchOptions,
  type BAClickFXUpdateOptions,
  type UnityFxTouchConfig,
} from 'ba-click-fx';

const inputFilter: BAClickFXInputFilter = event => event.isPrimary;

const options: BAClickFXOptions =
{
  target: '#fx',
  scale: 1,
  opacity: 1,
  themeColor: '#4ca7ff',
  outputCompositing: 'browser-overlay',
  hostCompositing: 'screen',
  hostCompositingSurface: 'native',
  clickEnabled: true,
  trailEnabled: true,
  inputSource: 'manual',
  inputSamplingRate: 30,
  clickTimeScale: 1.5,
  trailTimeScale: 0.8,
  effectBackend: 'webgpu',
  webgpuPreferHdr: false,
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
const defaultThemeColor: string = DEFAULT_THEME_COLOR;
const schemaVersion: 2 = FX_PARAM_SCHEMA_VERSION;
const firstDescriptor: BAClickFXParamDescriptor = FX_PARAM_SCHEMA[0]!;
const firstMigration: BAClickFXParamMigration = FX_PARAM_MIGRATIONS[0]!;
const defaultEffectBackend: BAClickFXEffectBackend = CONFIG.effectBackend;
const defaultBloomBackend: BAClickFXBloomBackend = CONFIG.bloomBackend;
const defaultIsolatedCompositing: boolean = CONFIG.isolatedCompositing;
const bloomBackend: BAClickFXBloomBackend = config.bloomBackend;
const effectBackend: BAClickFXEffectBackend = config.effectBackend;
const webgpuPreferHdr: boolean = config.webgpuPreferHdr;
const resolvedEffectBackend: BAClickFXResolvedEffectBackend =
  configSnapshot.resolvedEffectBackend;
const pendingEffectBackend: BAClickFXResolvedEffectBackend = 'pending';
const resolvedWebGPUOutputMode: BAClickFXWebGPUOutputMode =
  configSnapshot.resolvedWebGPUOutputMode;
const pendingWebGPUOutputMode: BAClickFXWebGPUOutputMode = 'pending';
const resolvedBloomBackend: BAClickFXResolvedBloomBackend =
  configSnapshot.resolvedBloomBackend;
const pendingBloomBackend: BAClickFXResolvedBloomBackend = 'pending';
const softwareBloomEnabled: boolean = config.softwareBloomEnabled;
const isolatedCompositing: boolean = config.isolatedCompositing;
const renderingMode: BAClickFXConfig['renderingMode'] = config.renderingMode;
const outputCompositing: BAClickFXOutputCompositing =
  config.outputCompositing;
const hostCompositing: BAClickFXHostCompositing =
  configSnapshot.resolvedHostCompositing;
const hostCompositingSurface: BAClickFXHostCompositingSurface =
  config.hostCompositingSurface;
const lightBackgroundContrastAlpha: number =
  config.lightBackgroundContrastAlpha;
const inputSource: BAClickFXInputSource = config.inputSource;
const inputSamplingRate: number = config.inputSamplingRate;
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
const compositingReferenceSource: HTMLCanvasElement = document.createElement(
  'canvas',
);
const compositingReferenceOptions: BAClickFXCompositingReferenceOptions =
{
  fit: 'cover',
};
const patchOptions: BAClickFXParamPatchOptions =
{
  schemaVersion: FX_PARAM_SCHEMA_VERSION,
  strict: true,
  reset: false,
};
const standalonePatchOptions: BAClickFXStandalonePatchOptions =
{
  schemaVersion: 0,
  strict: true,
};
const standalonePatchResult: BAClickFXParamPatchResult = applyFxParamPatch(
  {
    'bloom.scatter': 7,
  },
  standalonePatchOptions,
);
const untrustedPatch: Readonly<Record<string, unknown>> =
{
  'hit.enabled': 'invalid',
  'rings.count': null,
};
applyFxParamPatch(untrustedPatch);
applyFxParamPatch(
  {
    'hit.enabled': true,
  },
  {
    // @ts-expect-error standalone API 不允许请求实例模式重置。
    reset: true,
  },
);
applyFxParamPatch(
  {
    'hit.enabled': true,
  },
  {
    // @ts-expect-error standalone API 不允许注入内部配置基线。
    baseline: UNITY_FX_TOUCH,
  },
);
// @ts-expect-error standalone 结果不公开内部候选配置树。
const internalPatchCandidate = standalonePatchResult.nextConfig;

namedInstance.canvas.addEventListener(BLOOM_BACKEND_CHANGE_EVENT, event =>
{
  const backendEvent = event as BAClickFXBackendChangeEvent;
  const requested: BAClickFXBloomBackend =
    backendEvent.detail.requestedBloomBackend;
  const resolved: BAClickFXResolvedBloomBackend =
    backendEvent.detail.resolvedBloomBackend;

  void [requested, resolved];
});
namedInstance.canvas.addEventListener(EFFECT_BACKEND_CHANGE_EVENT, event =>
{
  const backendEvent = event as BAClickFXEffectBackendChangeEvent;
  const requested: BAClickFXEffectBackend =
    backendEvent.detail.requestedEffectBackend;
  const resolved: BAClickFXResolvedEffectBackend =
    backendEvent.detail.resolvedEffectBackend;

  void [requested, resolved];
});
namedInstance.canvas.addEventListener(HOST_COMPOSITING_CHANGE_EVENT, event =>
{
  const compositingEvent = event as BAClickFXHostCompositingChangeEvent;
  const requested: BAClickFXHostCompositing =
    compositingEvent.detail.requestedHostCompositing;
  const resolved: BAClickFXHostCompositing =
    compositingEvent.detail.resolvedHostCompositing;
  const surface: BAClickFXHostCompositingSurface =
    compositingEvent.detail.hostCompositingSurface;

  void [requested, resolved, surface, compositingEvent.detail.compositingWarning];
});

namedInstance.boom(300, 200);
const effectiveHostCompositing: BAClickFXHostCompositing =
  namedInstance.getEffectiveHostCompositing();
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
const compositingReferenceAccepted: boolean = namedInstance.setCompositingReference(
  compositingReferenceSource,
  compositingReferenceOptions,
);
const compositingReferenceCleared: boolean =
  namedInstance.setCompositingReference(null);
namedInstance.setCompositingReference(
  compositingReferenceSource,
  {
    // @ts-expect-error 合成参考目前只接受 cover。
    fit: 'contain',
  },
);
namedInstance.setThemeColor(DEFAULT_THEME_COLOR);
const inputSamplingRateAccepted: boolean =
  namedInstance.setInputSamplingRate(30);
const paramValue: BAClickFXParamValue = true;
const paramAccepted: boolean = namedInstance.setFxParam(
  'hit.enabled',
  paramValue,
);
const roundnessAccepted: boolean = namedInstance.setTriangleRoundness(0.5);
const patchResult: BAClickFXParamPatchResult = namedInstance.setFxParams(
  {
    'hit.enabled': true,
    'bloom.intensity': 1.7,
  },
  patchOptions,
);
const updateOptions: BAClickFXUpdateOptions =
{
  themeColor: '#4ca7ff',
  outputCompositing: 'scene',
  hostCompositingSurface: 'dom-backdrop',
  effectBackend: 'auto',
  webgpuPreferHdr: true,
  renderingMode: 'enhanced',
  bloomBackend: 'auto',
  inputSource: 'dom',
  inputSamplingRate: 60,
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
  // @ts-expect-error 完整特效后端只接受四种公开取值。
  effectBackend: 'metal',
  // @ts-expect-error WebGPU HDR 输出偏好只接受布尔值。
  webgpuPreferHdr: 'standard',
  // @ts-expect-error renderingMode 只接受 enhanced 或 legacy。
  renderingMode: 'native-bloom',
  // @ts-expect-error inputSource 只接受 dom 或 manual。
  inputSource: 'host',
  // @ts-expect-error 宿主表面只接受三个公开取值。
  hostCompositingSurface: 'webview',
};

void [
  defaultInstance,
  config,
  defaults,
  unity,
  defaultScale,
  defaultThemeColor,
  schemaVersion,
  firstDescriptor,
  firstMigration,
  defaultEffectBackend,
  defaultBloomBackend,
  defaultIsolatedCompositing,
  bloomBackend,
  effectBackend,
  webgpuPreferHdr,
  resolvedEffectBackend,
  pendingEffectBackend,
  resolvedWebGPUOutputMode,
  pendingWebGPUOutputMode,
  resolvedBloomBackend,
  pendingBloomBackend,
  softwareBloomEnabled,
  isolatedCompositing,
  renderingMode,
  outputCompositing,
  hostCompositing,
  hostCompositingSurface,
  effectiveHostCompositing,
  lightBackgroundContrastAlpha,
  inputSource,
  inputSamplingRate,
  clickTimeScale,
  trailTimeScale,
  pointerType,
  pointerInput,
  pauseOptions,
  pointerDownAccepted,
  pointerMoveAccepted,
  pointerUpAccepted,
  pointerCancelAccepted,
  compositingReferenceSource,
  compositingReferenceOptions,
  compositingReferenceAccepted,
  compositingReferenceCleared,
  patchOptions,
  standalonePatchOptions,
  standalonePatchResult,
  internalPatchCandidate,
  paramValue,
  inputSamplingRateAccepted,
  paramAccepted,
  patchResult,
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
