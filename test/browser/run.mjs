import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixturePath = '/test/browser/fixture.html';
const baselinePath = join(rootDir, 'test', 'browser', 'baseline.json');
const artifactDir = join(rootDir, 'test-results', 'browser-pixels');
const optional = process.argv.includes('--optional');
const calibrate = process.argv.includes('--calibrate');
const unityCountsOnly = process.argv.includes('--unity-counts-only');
const modeNames = [
  'full-webgl2',
  'webgl2-bloom',
  'software-bloom',
  'native',
];
const themeColorContractModes = [
  'native',
  'software-bloom',
  'full-webgl2',
];
const opacities = [0, 0.5, 1];
const isolationModes = [false, true];
const devicePixelRatios = [1, 2];
const lifecycleSampleTimes = [0, 40, 79, 120, 199, 300, 599, 601];
// suite.js 的径向采样索引 5 对应点击中心外 24 CSS px。该位置避开核心
// Coverage 和 Bloom 饱和区，又在 GPU 与软件后端都保留可测的低能信号。
const OPACITY_LINEAR_RADIAL_SAMPLE_INDEX = 5;
// Bright Pass 会让半透明外围先跌破阈值；平均覆盖面积不要求严格 0.5，
// 径向探针与最大 Alpha 仍保留更严格的线性约束。
const MINIMUM_BLOOM_MEAN_ALPHA_RATIO = 0.25;
// 游戏曝光倍率恢复后，24px 探针在 opacity=0.5 时会落到 Threshold
// 膝部下方；保留独立下限以检查连续性，但不能再把它当线性区。
const MINIMUM_BLOOM_PROBE_ALPHA_RATIO = 0.125;
// Unity 按物理渲染尺寸计算 Bloom 迭代数；DPR2 可能比 DPR1 多一个 mip，
// 因此默认配置的全画面均值不要求逐像素相等。
const MAXIMUM_DPR_MEAN_DIFFERENCE = 0.27;
// Software 在低 DPR 还会经过 RGBA8 光栅、回读和缩放，Alpha 均值需要
// 独立容差；颜色能量仍使用通用约束，不能全局放宽所有后端。
const MAXIMUM_SOFTWARE_DPR_MEAN_ALPHA_DIFFERENCE = 0.29;
const MAXIMUM_DPR_CORE_ALPHA_DIFFERENCE = 2 / 255;
const MAXIMUM_DPR_RADIAL_ALPHA_DIFFERENCE = 0.12;
const metrics =
{
  environment: {},
  cases: {},
  compositor: {},
  backendFailureChains:
  {
  },
  backendReentrantNative:
  {
  },
  trailBackendFailureChains:
  {
  },
  contrastCompositing:
  {
  },
  contextLifecycle: {},
  compositingReferenceContextLifecycle: null,
  effectLifecycle:
  {
  },
  trailContextLifecycle: {},
  trailTextureResourceLifecycle: {},
  prefabCountContracts: {},
  transparentCompositingTransitions: {},
  hostCompositingAccuracy: null,
  themeColorContracts: {},
  transparentContractContextLifecycle: {},
  transparentContractFailureChains: {},
  fullscreenScrollbarGutter:
  {
    source: null,
  },
  demoTimeScaleControls: null,
  demoMobileTouch: null,
  demoControlPanelStructure: null,
  demoBackgroundFile: null,
  demoPureWhiteIsolation: null,
};

let currentPage = null;
let currentLabel = 'startup';
let browser = null;
let vite = null;
let assertionCount = 0;

function assert(condition, message, detail = null)
{
  if (!condition)
  {
    const error = new Error(message);

    error.detail = detail;
    throw error;
  }

  assertionCount++;
}

function findExecutable(candidates)
{
  for (const candidate of candidates)
  {
    if (!candidate)
    {
      continue;
    }

    try
    {
      accessSync(candidate, constants.X_OK);
      return candidate;
    }
    catch
    {
      // 继续检查下一个系统安装位置。
    }
  }

  return null;
}

function findChromiumExecutable()
{
  const explicit = process.env.BACLICKFX_CHROMIUM_PATH;

  if (explicit)
  {
    // CI 显式路径失效时必须失败，不能静默改用另一个浏览器。
    return findExecutable([explicit]);
  }

  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    programFilesX86 && join(
      programFilesX86,
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    programFiles && join(
      programFiles,
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    localAppData && join(
      localAppData,
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    programFiles && join(
      programFiles,
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
    programFilesX86 && join(
      programFilesX86,
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];

  return findExecutable(candidates);
}

function getExecutableVersion(executablePath)
{
  if (process.platform === 'win32')
  {
    const escapedPath = executablePath.replaceAll("'", "''");
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-Item -LiteralPath '${escapedPath}').VersionInfo.ProductVersion`,
      ],
      {
        encoding: 'utf8',
      },
    );

    return result.stdout.trim() || 'unknown';
  }

  const result = spawnSync(executablePath, ['--version'],
    {
      encoding: 'utf8',
    });

  return result.stdout.trim() || result.stderr.trim() || 'unknown';
}

async function getAvailablePort()
{
  const probe = createNetServer();

  await new Promise((resolvePromise, rejectPromise) =>
  {
    probe.once('error', rejectPromise);
    probe.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = probe.address();

  await new Promise((resolvePromise, rejectPromise) =>
  {
    probe.close((error) =>
    {
      if (error)
      {
        rejectPromise(error);
        return;
      }

      resolvePromise();
    });
  });
  return address.port;
}

function relativeDifference(left, right)
{
  return Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1e-9);
}

function validateBasicCase(result, expectedDpr)
{
  const transparent = result.pixels.transparent;

  assert(
    result.route.resolvedEffectBackend === result.expectedRoute.effectBackend,
    `${currentLabel}: 完整特效后端解析错误`,
    result.route,
  );
  assert(
    result.route.resolvedBloomBackend === result.expectedRoute.bloomBackend,
    `${currentLabel}: Bloom 后端解析错误`,
    result.route,
  );
  assert(
    Math.abs(result.dpr - expectedDpr) < 0.01,
    `${currentLabel}: DPR 未按浏览器上下文生效`,
    result.dpr,
  );
  assert(
    Math.abs(result.layout.width - 320) < 0.01 &&
      Math.abs(result.layout.height - 240) < 0.01,
    `${currentLabel}: contain/Shadow 容器改变了稳定尺寸`,
    result.layout,
  );
  assert(
    result.layout.visibleCanvasCount > 0,
    `${currentLabel}: 没有可见输出 Canvas`,
    result.layout,
  );

  if (result.specification.opacity === 0)
  {
    assert(
      transparent.meanAlpha < 0.00001 &&
        transparent.meanEnergy < 0.00001 &&
        transparent.visibleRatio === 0,
      `${currentLabel}: opacity=0 仍输出可见像素`,
      transparent,
    );
  }
  else
  {
    assert(
      transparent.visibleRatio > 0 &&
        transparent.meanAlpha > 0 &&
        transparent.meanEnergy > 0,
      `${currentLabel}: 非零 opacity 输出为空`,
      transparent,
    );
  }

  assert(
    result.pixels.black.meanEnergy <= result.pixels.checker.meanEnergy &&
      result.pixels.checker.meanEnergy <= result.pixels.white.meanEnergy,
    `${currentLabel}: 黑/棋盘/白背景合成亮度不单调`,
    result.pixels,
  );

  if (result.outputCompositing === 'browser-overlay' &&
      result.specification.opacity > 0)
  {
    const blackCenter = result.pixels.black.center;
    const whiteCenter = result.pixels.white.center;
    const centerBackgroundDifference = blackCenter.slice(0, 3)
      .reduce((sum, channel, index) =>
        sum + Math.abs(channel - whiteCenter[index]), 0);

    assert(
      centerBackgroundDifference > 8,
      `${currentLabel}: 点击中心完全遮挡了宿主背景`,
      {
        blackCenter,
        centerBackgroundDifference,
        whiteCenter,
      },
    );
  }
}

function validateOpacityGroup(results, label)
{
  const zero = results.get(0).pixels.transparent;
  const half = results.get(0.5).pixels.transparent;
  const full = results.get(1).pixels.transparent;
  const alphaRatio = half.meanAlpha / Math.max(full.meanAlpha, 1e-9);
  const halfProbeAlpha =
    half.radialAlpha[OPACITY_LINEAR_RADIAL_SAMPLE_INDEX];
  const fullProbeAlpha =
    full.radialAlpha[OPACITY_LINEAR_RADIAL_SAMPLE_INDEX];
  const probeAlphaRatio = halfProbeAlpha / Math.max(fullProbeAlpha, 1e-9);

  assert(
    zero.meanAlpha < 0.00001 && zero.meanEnergy < 0.00001,
    `${label}: opacity=0 未完全透明`,
    zero,
  );
  assert(
    alphaRatio >= MINIMUM_BLOOM_MEAN_ALPHA_RATIO && alphaRatio <= 0.65,
    `${label}: opacity Alpha 不接近线性`,
    {
      alphaRatio,
      half,
      full,
    },
  );
  assert(
    probeAlphaRatio >= MINIMUM_BLOOM_PROBE_ALPHA_RATIO &&
      probeAlphaRatio <= 0.65,
    `${label}: 点击径向 Alpha 不接近线性`,
    {
      fullProbeAlpha,
      halfProbeAlpha,
      probeAlphaRatio,
      radialSampleIndex: OPACITY_LINEAR_RADIAL_SAMPLE_INDEX,
    },
  );
  assert(
    half.center[3] <= full.center[3] + 1,
    `${label}: opacity=0.5 的点击中心 Alpha 超过 opacity=1`,
    {
      halfCenter: half.center,
      fullCenter: full.center,
    },
  );
  assert(
    half.meanEnergy > 0 && half.meanEnergy < full.meanEnergy,
    `${label}: opacity 视觉能量不单调`,
    {
      half,
      full,
    },
  );
  assert(
    zero.maximumAlpha < half.maximumAlpha &&
      half.maximumAlpha <= full.maximumAlpha + 1 / 255,
    `${label}: opacity=0/0.5/1 的最大 Alpha 不单调`,
    {
      zero: zero.maximumAlpha,
      half: half.maximumAlpha,
      full: full.maximumAlpha,
    },
  );
}

function validateDprPair(dprOne, dprTwo, label)
{
  const first = dprOne.pixels.transparent;
  const second = dprTwo.pixels.transparent;
  const meanAlphaTolerance = label.startsWith('software-bloom/')
    ? MAXIMUM_SOFTWARE_DPR_MEAN_ALPHA_DIFFERENCE
    : MAXIMUM_DPR_MEAN_DIFFERENCE;
  const radialProbeDifferences = [5, 6].map((index) =>
    Math.abs(first.radialAlpha[index] - second.radialAlpha[index]));
  // 可见包围盒才使用 2/255 阈值；均值会累计全部像素，并允许 Unity
  // 因物理分辨率改变 mip 数。核心与固定 CSS 半径探针另行约束真实缩放。
  const widthTolerance = Math.max(
    16,
    Math.max(first.bounds.width, second.bounds.width) * 0.08,
  );
  const heightTolerance = Math.max(
    16,
    Math.max(first.bounds.height, second.bounds.height) * 0.08,
  );

  assert(
    relativeDifference(first.meanAlpha, second.meanAlpha) <=
      meanAlphaTolerance,
    `${label}: DPR 归一化 Alpha 偏差过大`,
    {
      dpr1: first,
      dpr2: second,
      tolerance: meanAlphaTolerance,
    },
  );
  assert(
    relativeDifference(first.meanEnergy, second.meanEnergy) <=
      MAXIMUM_DPR_MEAN_DIFFERENCE,
    `${label}: DPR 归一化颜色能量偏差过大`,
    {
      dpr1: first,
      dpr2: second,
    },
  );
  assert(
    Math.abs(first.maximumAlpha - second.maximumAlpha) <=
      MAXIMUM_DPR_CORE_ALPHA_DIFFERENCE &&
      Math.abs(first.center[3] - second.center[3]) / 255 <=
        MAXIMUM_DPR_CORE_ALPHA_DIFFERENCE,
    `${label}: DPR 改变了点击核心 Alpha`,
    {
      dpr1Center: first.center,
      dpr1MaximumAlpha: first.maximumAlpha,
      dpr2Center: second.center,
      dpr2MaximumAlpha: second.maximumAlpha,
    },
  );
  assert(
    radialProbeDifferences.every((difference) =>
      difference <= MAXIMUM_DPR_RADIAL_ALPHA_DIFFERENCE),
    `${label}: DPR 改变了点击径向 Alpha 轮廓`,
    {
      dpr1: first.radialAlpha,
      dpr2: second.radialAlpha,
      probeDifferences: radialProbeDifferences,
    },
  );
  assert(
    Math.abs(first.bounds.width - second.bounds.width) <= widthTolerance &&
      Math.abs(first.bounds.height - second.bounds.height) <= heightTolerance,
    `${label}: DPR 改变了 CSS 像素包围盒`,
    {
      dpr1: first.bounds,
      dpr2: second.bounds,
    },
  );
}

function validateIsolationPair(direct, isolated, label)
{
  const first = direct.pixels.transparent;
  const second = isolated.pixels.transparent;

  assert(
    relativeDifference(first.meanAlpha, second.meanAlpha) <= 0.08 &&
      relativeDifference(first.meanEnergy, second.meanEnergy) <= 0.08,
    `${label}: 隔离开关改变了渲染器内部像素合同`,
    {
      direct: first,
      isolated: second,
    },
  );
}

function hasPixelOutput(pixels)
{
  return pixels.meanAlpha > 0 ||
    pixels.meanEnergy > 0 ||
    pixels.maximumAlpha > 0;
}

function validateEmptyPixels(pixels, label)
{
  assert(
    pixels.meanAlpha < 0.00001 &&
      pixels.meanEnergy < 0.00001 &&
      pixels.maximumAlpha === 0 &&
      pixels.visibleRatio === 0,
    `${label}: 生命周期结束后仍有残影`,
    pixels,
  );
}

function validateFullscreenScrollbarGutter(result, expectedDpr)
{
  const gutterWidth = result.viewport.innerWidth - result.canvas.clientWidth;
  const bounds = result.canvas.bounds;

  assert(
    Math.abs(gutterWidth - 10) < 0.01,
    `${currentLabel}: 没有建立 10px 全屏滚动条槽`,
    result,
  );
  assert(
    Math.abs(result.effect.dpr - expectedDpr) < 0.01,
    `${currentLabel}: 全屏覆盖层 DPR 未按浏览器上下文生效`,
    result,
  );
  assert(
    Math.abs(result.effect.width - bounds.width) < 0.01 &&
      Math.abs(result.effect.height - bounds.height) < 0.01 &&
      Math.abs(result.canvas.clientWidth - bounds.width) < 0.01 &&
      Math.abs(result.canvas.clientHeight - bounds.height) < 0.01 &&
      Math.abs(result.viewport.innerHeight - bounds.height) < 0.01,
    `${currentLabel}: 全屏逻辑尺寸与 fixed Canvas CSS 盒子不一致`,
    result,
  );
  assert(
    result.canvas.backingWidth ===
      Math.round(result.effect.width * result.effect.dpr) &&
      result.canvas.backingHeight ===
        Math.round(result.effect.height * result.effect.dpr),
    `${currentLabel}: 全屏 backing store 没有按实测 CSS 尺寸和 DPR 分配`,
    result,
  );
}

function validateThemeColorContract(mode, result)
{
  const expectedRoute = mode === 'full-webgl2'
    ? ['webgl2', 'webgl2']
    : [
        'canvas2d',
        mode === 'software-bloom' ? 'software' : 'native',
      ];
  const variants = [
    result.defaultHue,
    result.defaultRelative,
    result.dark,
    result.bright,
    result.black,
    result.oneBlue,
    result.fiveGray,
    result.darkPeak,
    result.darkRedPeak,
  ];

  assert(
    variants.every((variant) =>
      variant.route.resolvedEffectBackend === expectedRoute[0] &&
      variant.route.resolvedBloomBackend === expectedRoute[1]),
    `${mode}: 主题色门禁没有走预期渲染后端`,
    {
      expectedRoute,
      routes: variants.map((variant) => variant.route),
    },
  );
  assert(
    result.defaultHue.config.themeColor === '#4ca7ff' &&
      result.defaultHue.config.themeColorMode === 'hue-only' &&
      result.defaultRelative.config.themeColor === '#4ca7ff' &&
      result.defaultRelative.config.themeColorMode === 'relative-oklch' &&
      result.dark.config.themeColor === '#001020' &&
      result.bright.config.themeColor === '#d8efff' &&
      result.black.config.themeColor === '#000000' &&
      result.oneBlue.config.themeColor === '#000001' &&
      result.fiveGray.config.themeColor === '#050505' &&
      result.darkPeak.config.themeColor === '#001020' &&
      result.darkRedPeak.config.themeColor === '#200002',
    `${mode}: 主题色夹具没有应用请求的颜色或映射模式`,
    variants.map((variant) => variant.config),
  );
  assert(
    hasPixelOutput(result.defaultHue.pixels) &&
      hasPixelOutput(result.defaultRelative.pixels),
    `${mode}: 默认蓝主题夹具没有可见像素`,
    {
      hueOnly: result.defaultHue.pixels,
      relativeOklch: result.defaultRelative.pixels,
    },
  );
  assert(
    result.defaultDifference.sizeMismatch === false &&
      result.defaultDifference.changedPixels === 0 &&
      result.defaultDifference.maximumChannelDelta === 0,
    `${mode}: 默认蓝在 hue-only 与 relative-oklch 之间不再像素恒等`,
    result.defaultDifference,
  );
  assert(
    hasPixelOutput(result.dark.pixels) &&
      hasPixelOutput(result.bright.pixels) &&
      result.dark.premultipliedEnergy < result.bright.premultipliedEnergy,
    `${mode}: 相对 OKLCH 暗色没有比亮色产生更低的最终能量`,
    {
      bright: result.bright,
      dark: result.dark,
    },
  );
  assert(
    result.black.runtime.waveCount > 0 &&
      result.black.runtime.shardCount > 0 &&
      result.black.runtime.trailPointCount >= 2,
    `${mode}: 纯黑门禁没有保留活动特效几何，无法排除空场景假通过`,
    result.black.runtime,
  );
  validateEmptyPixels(result.black.pixels, `${mode}: 纯黑主题`);

  const blackWhite = result.black.whiteBackground;
  const oneBlueWhite = result.oneBlue.whiteBackground;
  const fiveGrayWhite = result.fiveGray.whiteBackground;

  assert(
    blackWhite.changedPixels === 0 &&
      blackWhite.maximumChannelDarkening === 0 &&
      blackWhite.minimumChannel === 255,
    `${mode}: 纯黑主题改变了最终纯白背景`,
    blackWhite,
  );
  assert(
    blackWhite.maximumChannelDarkening <=
        oneBlueWhite.maximumChannelDarkening &&
      oneBlueWhite.maximumChannelDarkening <=
        fiveGrayWhite.maximumChannelDarkening &&
      blackWhite.meanChannelDarkening <=
        oneBlueWhite.meanChannelDarkening &&
      oneBlueWhite.meanChannelDarkening <=
        fiveGrayWhite.meanChannelDarkening,
    `${mode}: #000000 到 #000001/#050505 的白底变化不连续单调`,
    {
      black: blackWhite,
      fiveGray: fiveGrayWhite,
      oneBlue: oneBlueWhite,
    },
  );
  assert(
    oneBlueWhite.maximumChannelDarkening <= 2 &&
      fiveGrayWhite.changedPixels > 0 &&
      fiveGrayWhite.maximumChannelDarkening <= 32 &&
      oneBlueWhite.darkPixelCount === 0 &&
      fiveGrayWhite.darkPixelCount === 0,
    `${mode}: 近黑主题在纯白底上形成了暗色实心遮挡`,
    {
      fiveGray: fiveGrayWhite,
      oneBlue: oneBlueWhite,
    },
  );

  for (const [name, variant] of [
    ['#001020', result.darkPeak],
    ['#200002', result.darkRedPeak],
  ])
  {
    assert(
      variant.whiteBackground.changedPixels > 0 &&
        fiveGrayWhite.maximumChannelDarkening <=
          variant.whiteBackground.maximumChannelDarkening &&
        variant.whiteBackground.maximumChannelDarkening <= 32 &&
        variant.whiteBackground.minimumChannel >= 223 &&
        variant.whiteBackground.darkPixelCount === 0,
      `${mode}: ${name} 在峰值帧的纯白底上形成了暗色实心遮挡`,
      {
        fiveGray: fiveGrayWhite,
        theme: variant.whiteBackground,
      },
    );
  }
}

async function runThemeColorContracts(page)
{
  for (const mode of themeColorContractModes)
  {
    currentLabel = `${mode}__theme-color-contract`;
    const result = await page.evaluate(
      (requestedMode) =>
        window.browserPixelSuite.runThemeColorContract(requestedMode),
      mode,
    );

    validateThemeColorContract(mode, result);
    metrics.themeColorContracts[mode] = result;
  }
}

function validateEffectLifecycle(mode, timelines)
{
  const click = timelines.click;
  const disk = timelines.disk;
  const trail = timelines.trail;
  const hit = timelines.hit;
  const noHit = timelines.noHit;

  for (const timeMs of lifecycleSampleTimes)
  {
    assert(
      click.get(timeMs).sampleTimeMs === timeMs &&
        trail.get(timeMs).sampleTimeMs === timeMs,
      `${mode}: 浏览器夹具没有使用请求的采样时间 ${timeMs}ms`,
      {
        click: click.get(timeMs).sampleTimeMs,
        trail: trail.get(timeMs).sampleTimeMs,
      },
    );
  }

  for (const timeMs of [0, 40, 79, 120, 199, 300])
  {
    assert(
      hasPixelOutput(click.get(timeMs).pixels.transparent),
      `${mode}: 点击在 ${timeMs}ms 过早消失`,
      click.get(timeMs).pixels.transparent,
    );
  }
  assert(
    click.get(599).pixels.transparent.meanAlpha <
      click.get(300).pixels.transparent.meanAlpha,
    `${mode}: Ring 末段没有按 Unity 溶解曲线衰减`,
    {
      at300: click.get(300).pixels.transparent,
      at599: click.get(599).pixels.transparent,
    },
  );
  assert(
    click.get(599).runtime.waveCount === 1 &&
      click.get(599).runtime.ringCount > 0 &&
      click.get(599).runtime.hasVisibleEffects,
    `${mode}: Ring 在 Unity 600ms 生命周期前被提前回收`,
    click.get(599).runtime,
  );
  validateEmptyPixels(
    click.get(601).pixels.transparent,
    `${mode} 点击 601ms`,
  );
  assert(
    click.get(601).runtime.waveCount === 0 &&
      click.get(601).runtime.ringCount === 0 &&
      !click.get(601).runtime.hasVisibleEffects,
    `${mode}: Ring 超过 600ms 后仍占用运行时状态`,
    click.get(601).runtime,
  );

  for (const timeMs of [0, 40, 79, 120])
  {
    assert(
      hasPixelOutput(disk.get(timeMs).pixels.transparent),
      `${mode}: Disk 在 ${timeMs}ms 过早消失`,
      disk.get(timeMs).pixels.transparent,
    );
  }
  assert(
    disk.get(199).runtime.waveCount === 1 &&
      disk.get(199).runtime.ringCount === 0,
    `${mode}: Disk 在 Unity 200ms 生命周期前被提前回收`,
    disk.get(199).runtime,
  );
  validateEmptyPixels(
    disk.get(300).pixels.transparent,
    `${mode} Disk 300ms`,
  );
  assert(
    disk.get(300).runtime.waveCount === 0 &&
      !disk.get(300).runtime.hasVisibleEffects,
    `${mode}: Disk 超过 200ms 后仍占用运行时状态`,
    disk.get(300).runtime,
  );
  if (mode === 'full-webgl2' || mode === 'webgl2-bloom')
  {
    const at120 = disk.get(120).webglTransport;
    const at199 = disk.get(199).webglTransport;

    assert(
      at120?.waveAges[0] === 120 &&
        at199?.waveAges[0] === 199 &&
        at120.disk.lifetimeMs === 200 &&
        JSON.stringify(at120.disk.alphaKeys) ===
          JSON.stringify(at199.disk.alphaKeys),
      `${mode}: Disk WebGL2 夹具没有保留原始生命周期输入`,
      { at120, at199 },
    );
    assert(
      at120.scene[3] > 0.2 &&
        at199.scene[3] < 0.02 &&
        at199.scene[3] < at120.scene[3] &&
        Math.abs(at120.sceneOverlay[3] - at120.scene[3]) <= 0.001 &&
        Math.abs(at199.sceneOverlay[3] - at199.scene[3]) <= 0.001,
      `${mode}: Disk WebGL2 Scene Coverage 没有按 Unity Alpha 曲线衰减`,
      { at120, at199 },
    );
  }
  else
  {
    // Canvas 后端无法回读线性 Scene 目标；Disk 夹具已关闭独立
    // 点击 Bloom，因此最终 Alpha 可作为 Coverage 衰减的替代观测。
    assert(
      disk.get(199).pixels.transparent.meanAlpha <
        disk.get(120).pixels.transparent.meanAlpha,
      `${mode}: Disk 末段没有按 Unity Alpha 曲线衰减`,
      {
        at120: disk.get(120).pixels.transparent,
        at199: disk.get(199).pixels.transparent,
      },
    );
  }

  validateEmptyPixels(
    trail.get(0).pixels.transparent,
    `${mode} Trail 0ms`,
  );
  for (const timeMs of [40, 79, 120, 199, 300])
  {
    assert(
      hasPixelOutput(trail.get(timeMs).pixels.transparent),
      `${mode}: Trail 在 ${timeMs}ms 没有可见采样`,
      trail.get(timeMs).pixels.transparent,
    );
  }
  validateEmptyPixels(
    trail.get(599).pixels.transparent,
    `${mode} Trail 599ms`,
  );
  assert(
    trail.get(300).runtime.trailPointCount >= 2 &&
      trail.get(300).runtime.hasVisibleEffects &&
      trail.get(599).runtime.trailPointCount === 0 &&
      !trail.get(599).runtime.hasVisibleEffects,
    `${mode}: Trail 没有按 300ms 顶点寿命进入空闲`,
    {
      at300: trail.get(300).runtime,
      at599: trail.get(599).runtime,
    },
  );
  validateEmptyPixels(
    trail.get(601).pixels.transparent,
    `${mode} Trail 601ms`,
  );

  const hitDifferences = new Map();

  for (const timeMs of [0, 40, 79, 120])
  {
    hitDifferences.set(
      timeMs,
      Math.abs(
        hit.get(timeMs).pixels.transparent.meanAlpha -
          noHit.get(timeMs).pixels.transparent.meanAlpha,
      ),
    );
  }
  for (const timeMs of [0, 40, 79])
  {
    assert(
      hitDifferences.get(timeMs) > 0.000001,
      `${mode}: Hit 在 ${timeMs}ms 没有产生可检测像素`,
      Object.fromEntries(hitDifferences),
    );
  }
  assert(
    hitDifferences.get(0) > hitDifferences.get(40) &&
      hitDifferences.get(40) > hitDifferences.get(79) &&
      hitDifferences.get(79) > 0,
    `${mode}: Hit 没有按 80ms Alpha 曲线衰减`,
    Object.fromEntries(hitDifferences),
  );
  assert(
    hitDifferences.get(120) < 0.000001,
    `${mode}: Hit 超过 80ms 后仍残留可见像素`,
    Object.fromEntries(hitDifferences),
  );
}

function validateContextOpacityGroup(
  mode,
  results,
  phase,
  label = 'Context',
  probe = 'radial',
)
{
  const zero = results.get(0)[phase].transparent;
  const half = results.get(0.5)[phase].transparent;
  const full = results.get(1)[phase].transparent;
  const meanAlphaRatio = half.meanAlpha / Math.max(full.meanAlpha, 1e-9);
  const halfProbeAlpha = probe === 'trail'
    ? half.trailProbeAlpha
    : half.radialAlpha[OPACITY_LINEAR_RADIAL_SAMPLE_INDEX];
  const fullProbeAlpha = probe === 'trail'
    ? full.trailProbeAlpha
    : full.radialAlpha[OPACITY_LINEAR_RADIAL_SAMPLE_INDEX];
  const probeAlphaRatio = halfProbeAlpha / Math.max(fullProbeAlpha, 1e-9);
  const maximumAlphaRatio = half.maximumAlpha /
    Math.max(full.maximumAlpha, 1e-9);
  // 独立 Alpha 上限会让 half/full 的高能峰值同时饱和；此时全图均值也会
  // 偏离 0.5，低能固定探针仍由下方 0.25..0.65 约束守住 opacity 合同。
  const maximumAlphaSaturated = Math.abs(
    half.maximumAlpha - full.maximumAlpha,
  ) <= 1 / 255;
  const maximumMeanAlphaRatio = maximumAlphaSaturated ? 0.85 : 0.65;

  validateEmptyPixels(zero, `${mode} ${label} ${phase} opacity=0`);
  assert(
    meanAlphaRatio >= MINIMUM_BLOOM_MEAN_ALPHA_RATIO &&
      meanAlphaRatio <= maximumMeanAlphaRatio,
    `${mode}: ${label} ${phase} 的平均 Alpha 不接近线性`,
    {
      half,
      full,
      maximumAlphaSaturated,
      maximumMeanAlphaRatio,
      meanAlphaRatio,
    },
  );
  assert(
    probeAlphaRatio >= MINIMUM_BLOOM_PROBE_ALPHA_RATIO &&
      probeAlphaRatio <= 0.65,
    `${mode}: ${label} ${phase} 的${
      probe === 'trail' ? '拖尾探针' : '径向探针'} Alpha 不接近线性`,
    {
      probeAlphaRatio,
      half: halfProbeAlpha,
      full: fullProbeAlpha,
    },
  );
  // Bloom 传输 Alpha 在线性能量滤波后编码为 sRGB，单个峰值不按 0.5
  // 线性缩放；平均 Coverage 与固定非饱和探针仍由上方断言约束。
  assert(
    zero.maximumAlpha < half.maximumAlpha &&
      half.maximumAlpha <= full.maximumAlpha + 1 / 255 &&
      maximumAlphaRatio >= 0.35,
    `${mode}: ${label} ${phase} 的 opacity 峰值不单调`,
    {
      zero: zero.maximumAlpha,
      half: half.maximumAlpha,
      full: full.maximumAlpha,
      maximumAlphaRatio,
    },
  );
}

function validatePrefabCountContract(result)
{
  const runtime = result.runtime;

  assert(
    result.route.resolvedEffectBackend === result.expectedRoute.effectBackend &&
      result.route.resolvedBloomBackend === result.expectedRoute.bloomBackend,
    `${currentLabel}: 长拖尾数量夹具没有停留在请求的渲染后端`,
    {
      expected: result.expectedRoute,
      route: result.route,
    },
  );
  assert(
    runtime.configuredRingCount === 2 &&
      runtime.configuredClickShardCount === 4 &&
      runtime.configuredTrailShardLimit === 50,
    `${currentLabel}: Unity Prefab 数量真值发生变化`,
    runtime,
  );
  assert(
    runtime.waveCount === 1 &&
      runtime.ringCount === runtime.configuredRingCount,
    `${currentLabel}: 单次点击没有生成 Prefab 定义的 2 个圆环`,
    runtime,
  );
  assert(
    runtime.clickShardCount === runtime.configuredClickShardCount,
    `${currentLabel}: 单次点击没有生成 Prefab 定义的 4 个点击碎片`,
    runtime,
  );
  assert(
    runtime.trailShardCount === runtime.configuredTrailShardLimit,
    `${currentLabel}: 单个拖尾实例没有在 Prefab 定义的 50 个碎片处封顶`,
    runtime,
  );
  assert(
    runtime.shardCount ===
      runtime.clickShardCount + runtime.trailShardCount,
    `${currentLabel}: 碎片分类计数未覆盖全部运行时粒子`,
    runtime,
  );
}

async function runPrefabCountContracts(page)
{
  for (const mode of modeNames)
  {
    const label = `${mode}__unity-prefab-count-contract`;

    currentLabel = label;
    const result = await page.evaluate(
      (input) => window.browserPixelSuite.runCase(input),
      {
        mode,
        opacity: 1,
        isolatedCompositing: true,
        background: 'transparent',
        shadow: false,
        containStrict: false,
        prefabCountContract: true,
        sampleTimeMs: 1,
      },
    );

    validatePrefabCountContract(result);
    metrics.prefabCountContracts[mode] =
    {
      route: result.route,
      runtime: result.runtime,
    };
  }
}

function validateTransparentContractTransitions(mode, phases)
{
  const coverageZero = phases.coverageZero;
  const coverageHalf = phases.coverageHalf;
  const coverageFull = phases.coverageFull;
  const visualMax = phases.visualMax;
  const brightCore = phases.brightCore;
  const additiveZero = phases.additiveZero;
  const additiveHalf = phases.additiveHalf;
  const additiveFull = phases.additiveFull;
  const roundTrip = phases.roundTrip;
  const alphaLimit = coverageFull.config.overlayAlphaLimit;
  const lifecycle = JSON.stringify(coverageZero.lifecycle);

  for (const [name, phase] of Object.entries(phases))
  {
    assert(
      JSON.stringify(phase.lifecycle) === lifecycle,
      `${mode}: 透明合同热切换推进了 ${name} 的生命周期`,
      {
        initial: coverageZero.lifecycle,
        phase: phase.lifecycle,
      },
    );
    assert(
      phase.config.outputCompositing === 'browser-overlay',
      `${mode}: ${name} 离开了 browser-overlay 合同`,
      phase.config,
    );
    assert(
      phase.outside.sampleCount > 0 &&
        phase.outside.visiblePixelCount === 0 &&
        phase.outside.maximumAlpha <= 1 / 255 &&
        phase.outside.maximumEnergy <= 1 / 255,
      `${mode}: ${name} 在特效保护包围盒外留下矩形底色`,
      phase.outside,
    );
  }

  validateEmptyPixels(
    coverageZero.pixels.transparent,
    `${mode} Coverage opacity=0`,
  );
  validateEmptyPixels(
    additiveZero.pixels.transparent,
    `${mode} Host Add opacity=0`,
  );
  assert(
    hasPixelOutput(coverageHalf.pixels.transparent) &&
      hasPixelOutput(coverageFull.pixels.transparent) &&
      coverageHalf.pixels.transparent.meanAlpha <
        coverageFull.pixels.transparent.meanAlpha &&
      coverageHalf.pixels.transparent.meanEnergy <
        coverageFull.pixels.transparent.meanEnergy &&
      coverageZero.pixels.transparent.maximumAlpha <
        coverageHalf.pixels.transparent.maximumAlpha &&
      coverageHalf.pixels.transparent.maximumAlpha <=
        coverageFull.pixels.transparent.maximumAlpha + 1 / 255,
    `${mode}: Coverage opacity=0/0.5/1 输出或峰值不单调`,
    {
      zero: coverageZero.pixels.transparent,
      half: coverageHalf.pixels.transparent,
      full: coverageFull.pixels.transparent,
    },
  );

  for (const [name, phase] of [
    ['coverageHalf', coverageHalf],
    ['coverageFull', coverageFull],
    ['visualMax', visualMax],
    ['brightCore', brightCore],
    ['roundTrip', roundTrip],
  ])
  {
    const pixels = phase.pixels;

    assert(
      phase.config.hostCompositing === 'source-over' &&
        pixels.transparent.maximumAlpha <= alphaLimit + 1 / 255 &&
        pixels.black.meanEnergy < pixels.checker.meanEnergy &&
        pixels.checker.meanEnergy < pixels.white.meanEnergy &&
        pixels.backgroundTransmission.maximumTransmissionError <= 3 &&
        pixels.backgroundTransmission.maximumCheckerError <= 1,
      `${mode}: ${name} 没有保持 source-over Coverage 合同`,
      phase,
    );
  }

  const coveragePixels = coverageFull.pixels.transparent;
  const visualMaxPixels = visualMax.pixels.transparent;
  const brightCorePixels = brightCore.pixels.transparent;

  assert(
    coverageFull.config.overlayAlphaPolicy === 'coverage' &&
      coverageFull.config.overlayColorCompensation === 'none' &&
      visualMax.config.overlayAlphaPolicy === 'visual-max' &&
      visualMax.config.overlayColorCompensation === 'none' &&
      visualMaxPixels.meanAlpha <= coveragePixels.meanAlpha + 0.000001 &&
      visualMaxPixels.maximumAlpha <=
        coveragePixels.maximumAlpha + 1 / 255 &&
      visualMaxPixels.meanEnergy + 0.000001 >=
        coveragePixels.meanEnergy,
    `${mode}: visual-max 没有独立收敛 Alpha 或丢失旧版颜色能量`,
    {
      coverage: coveragePixels,
      visualMax: visualMaxPixels,
    },
  );

  assert(
    brightCore.config.overlayAlphaPolicy === 'visual-max' &&
      brightCore.config.overlayColorCompensation === 'bright-core' &&
      Math.abs(
        brightCorePixels.meanAlpha - visualMaxPixels.meanAlpha,
      ) <= 0.002 &&
      Math.abs(
        brightCorePixels.maximumAlpha - visualMaxPixels.maximumAlpha,
      ) <= 1 / 255 &&
      brightCorePixels.meanRed >= visualMaxPixels.meanRed &&
      brightCorePixels.meanGreen >= visualMaxPixels.meanGreen &&
      brightCorePixels.meanBlue >= visualMaxPixels.meanBlue &&
      brightCorePixels.meanRed > visualMaxPixels.meanRed + 0.000001 &&
      Math.abs(
        brightCorePixels.meanEnergy - visualMaxPixels.meanEnergy,
      ) <= 1 / 255 &&
      Math.abs(
        brightCorePixels.maximumEnergy - visualMaxPixels.maximumEnergy,
      ) <= 1 / 255 &&
      Math.max(...brightCorePixels.center.slice(0, 3)) <=
        Math.max(...visualMaxPixels.center.slice(0, 3)) + 1 &&
      Math.max(...brightCorePixels.center.slice(0, 3)) -
        Math.min(...brightCorePixels.center.slice(0, 3)) >=
        (
          Math.max(...visualMaxPixels.center.slice(0, 3)) -
          Math.min(...visualMaxPixels.center.slice(0, 3))
        ) * 0.6,
    `${mode}: bright-core 改变了 Alpha/峰值或抹掉了蓝青色层次`,
    {
      brightCore: brightCorePixels,
      visualMax: visualMaxPixels,
    },
  );

  assert(
    additiveFull.config.hostCompositing === 'screen' &&
      additiveFull.mount.overlayRootBlendMode === 'screen' &&
      additiveFull.mount.overlayRootConnected &&
      hasPixelOutput(additiveHalf.pixels.transparent) &&
      hasPixelOutput(additiveFull.pixels.transparent) &&
      additiveZero.pixels.transparent.maximumAlpha <
        additiveHalf.pixels.transparent.maximumAlpha &&
      additiveHalf.pixels.transparent.maximumAlpha <=
        additiveFull.pixels.transparent.maximumAlpha + 1 / 255 &&
      additiveHalf.pixels.transparent.meanAlpha <
        additiveFull.pixels.transparent.meanAlpha &&
      additiveHalf.pixels.transparent.meanEnergy <
        additiveFull.pixels.transparent.meanEnergy,
    `${mode}: DOM Add 没有保持透明度单调或挂载 screen`,
    {
      half: additiveHalf,
      full: additiveFull,
    },
  );

  const roundTripPixels = roundTrip.pixels.transparent;

  // Native Canvas blur 在重复栅格时会改变少量 1/255 边缘像素；
  // 中心、峰值和生命周期保持严格，低能全画面均值沿用后端切换的 8% 容差。
  assert(
    roundTrip.config.overlayAlphaPolicy === 'coverage' &&
      roundTrip.config.overlayColorCompensation === 'none' &&
      roundTrip.config.hostCompositing === 'source-over' &&
      relativeDifference(
        roundTripPixels.meanAlpha,
        coveragePixels.meanAlpha,
      ) <= 0.08 &&
      relativeDifference(
        roundTripPixels.meanRed,
        coveragePixels.meanRed,
      ) <= 0.08 &&
      relativeDifference(
        roundTripPixels.meanGreen,
        coveragePixels.meanGreen,
      ) <= 0.08 &&
      relativeDifference(
        roundTripPixels.meanBlue,
        coveragePixels.meanBlue,
      ) <= 0.08 &&
      Math.abs(
        roundTripPixels.maximumAlpha - coveragePixels.maximumAlpha,
      ) <= 1 / 255 &&
      Math.abs(
        roundTripPixels.center[3] - coveragePixels.center[3],
      ) <= 2,
    `${mode}: Coverage -> visual-max -> bright-core -> Host Add -> Coverage 往返发生跳变`,
    {
      initial: coveragePixels,
      roundTrip: roundTripPixels,
    },
  );
}

function validateBrightCoreTrailCompensation(mode, phases)
{
  const none = phases.none;
  const brightCore = phases.brightCore;
  const noneTail = none.trailProfile.tailColor;
  const brightTail = brightCore.trailProfile.tailColor;

  assert(
    JSON.stringify(none.lifecycle) === JSON.stringify(brightCore.lifecycle),
    `${mode}: bright-core 拖尾切换推进了生命周期`,
    phases,
  );
  assert(
    none.config.overlayAlphaPolicy === 'visual-max' &&
      none.config.overlayColorCompensation === 'none' &&
      brightCore.config.overlayAlphaPolicy === 'visual-max' &&
      brightCore.config.overlayColorCompensation === 'bright-core',
    `${mode}: 低能拖尾夹具没有保持正交透明配置`,
    {
      brightCore: brightCore.config,
      none: none.config,
    },
  );
  if (noneTail.energy <= 1 / 255)
  {
    assert(
      brightTail.energy <= 1 / 255 && brightTail.alpha <= 1 / 255,
      `${mode}: bright-core 在量化为零的拖尾尾端凭空生成像素`,
      {
        brightCore: brightTail,
        none: noneTail,
      },
    );
    return;
  }

  assert(
    noneTail.energy < 0.2 &&
      Math.abs(brightTail.alpha - noneTail.alpha) <= 1 / 255 &&
      brightTail.neutralEnergy <= noneTail.neutralEnergy + 2 / 255 &&
      brightTail.saturation + 0.08 >= noneTail.saturation &&
      relativeDifference(brightTail.energy, noneTail.energy) <= 0.15,
    `${mode}: bright-core 把低能拖尾抬成灰白尾巴`,
    {
      brightCore: brightTail,
      none: noneTail,
    },
  );
}

function validateTransparentContractContext(mode, lifecycle, expected)
{
  validateContextLifecycleRoute(mode, lifecycle);
  assert(
    lifecycle.contract.outputCompositing === 'browser-overlay' &&
      lifecycle.contract.hostCompositing === expected.hostCompositing &&
      lifecycle.contract.overlayAlphaPolicy === expected.overlayAlphaPolicy &&
      lifecycle.contract.overlayColorCompensation ===
        expected.overlayColorCompensation &&
      lifecycle.contract.overlayAlphaLimit === 0.7,
    `${mode}: Context 生命周期没有保留透明合同配置`,
    lifecycle.contract,
  );

  for (const phase of [
    'before',
    'fallback',
    'fallbackSteady',
    'restoring',
    'restored',
  ])
  {
    const compositing = lifecycle.compositing[phase];

    assert(
      compositing.overlayAlphaPolicy === expected.overlayAlphaPolicy &&
        compositing.overlayColorCompensation ===
          expected.overlayColorCompensation,
      `${mode}: Context ${phase} 丢失透明覆盖层正交配置`,
      compositing,
    );
  }

  if (expected.hostCompositing === 'source-over')
  {
    validateContextLifecycleGroup(
      mode,
      new Map([[1, lifecycle]]),
      false,
    );

    for (const phase of [
      'before',
      'fallback',
      'fallbackSteady',
      'restoring',
      'restored',
    ])
    {
      assert(
        lifecycle[phase].transparent.maximumAlpha <= 0.7 + 1 / 255 &&
          lifecycle.compositing[phase].overlayRootBlendMode === '',
        `${mode}: ${expected.name} Context ${phase} 越过 Alpha 上限`,
        {
          compositing: lifecycle.compositing[phase],
          pixels: lifecycle[phase].transparent,
        },
      );
    }
    return;
  }

  const before = lifecycle.before.transparent;
  const fallbackIsNative = lifecycle.fallbackRoute.bloom === 'native';

  for (const phase of [
    'before',
    'fallback',
    'fallbackSteady',
    'restoring',
    'restored',
  ])
  {
    const pixels = lifecycle[phase].transparent;
    const compositing = lifecycle.compositing[phase];
    const nativeFallbackPhase = fallbackIsNative &&
      (phase === 'fallback' || phase === 'fallbackSteady');

    assert(
      hasPixelOutput(pixels) &&
        compositing.hostCompositing === expected.hostCompositing &&
        compositing.overlayRootBlendMode === expected.hostCompositing &&
        compositing.overlayRootConnected &&
        (
          nativeFallbackPhase
            ? pixels.meanEnergy <= before.meanEnergy + 1 / 255
            : relativeDifference(before.meanEnergy, pixels.meanEnergy) <= 0.35
        ),
      `${mode}: ${expected.name} Context ${phase} 出现空白或载荷突跳`,
      {
        before,
        compositing,
        pixels,
      },
    );
  }

  if (fallbackIsNative)
  {
    const fallback = lifecycle.fallback.transparent;
    const fallbackSteady = lifecycle.fallbackSteady.transparent;
    const fallbackToSteady = lifecycle.alphaContinuity.fallbackToSteady;

    assert(
      fallback.meanAlpha <= before.meanAlpha + 1 / 255 &&
        fallback.maximumAlpha <= before.maximumAlpha + 1 / 255 &&
        fallbackSteady.meanAlpha <= before.meanAlpha + 1 / 255 &&
        fallbackSteady.maximumAlpha <= before.maximumAlpha + 1 / 255 &&
        relativeDifference(
          fallback.meanEnergy,
          fallbackSteady.meanEnergy,
        ) <= 0.05 &&
        fallbackToSteady.meanAbsoluteDelta <= 0.003 &&
        fallbackToSteady.visibleMeanAbsoluteDelta <= 0.08 &&
        fallbackToSteady.maximumAbsoluteDelta <= 0.35,
      `${mode}: ${expected.name} Native Context 回退不稳定或产生增亮闪烁`,
      {
        before,
        fallback,
        fallbackSteady,
        fallbackToSteady,
      },
    );
  }
}

function validateContextLifecycleGroup(
  mode,
  results,
  validateOpacitySeries = true,
)
{
  for (const [opacity, lifecycle] of results)
  {
    for (const phase of [
      'before',
      'fallback',
      'fallbackSteady',
      'restoring',
      'restored',
    ])
    {
      const pixels = lifecycle[phase].transparent;
      const black = lifecycle[phase].black;
      const checker = lifecycle[phase].checker;
      const white = lifecycle[phase].white;
      const transmission = lifecycle[phase].backgroundTransmission;
      const outside = lifecycle[phase].outside;

      assert(
        outside.sampleCount > 0 &&
          outside.visiblePixelCount === 0 &&
          outside.maximumAlpha <= 1 / 255 &&
          outside.maximumEnergy <= 1 / 255,
        `${mode}: Context ${phase} 在特效保护包围盒外留下矩形底色`,
        outside,
      );

      if (opacity === 0)
      {
        validateEmptyPixels(pixels, `${mode} Context ${phase} opacity=0`);
      }
      else
      {
        assert(
          hasPixelOutput(pixels),
          `${mode}: Context ${phase} opacity=${opacity} 产生空白帧`,
          pixels,
        );
        const centerBackgroundDifference = black.center.slice(0, 3)
          .reduce((sum, channel, index) =>
            sum + Math.abs(channel - white.center[index]), 0);

        assert(
          centerBackgroundDifference > 8,
          `${mode}: Context ${phase} 的点击中心遮挡了宿主背景`,
          {
            black: black.center,
            centerBackgroundDifference,
            white: white.center,
          },
        );
      }

      assert(
        black.meanEnergy < checker.meanEnergy &&
          checker.meanEnergy < white.meanEnergy,
        `${mode}: Context ${phase} 没有保留黑/棋盘/白背景透出顺序`,
        {
          black: black.meanEnergy,
          checker: checker.meanEnergy,
          white: white.meanEnergy,
        },
      );
      assert(
        transmission.maximumTransmissionError <= 2 &&
          transmission.maximumCheckerError <= 1,
        `${mode}: Context ${phase} 的局部背景透出不符合 Coverage Alpha`,
        transmission,
      );
    }

    if (opacity > 0)
    {
      const before = lifecycle.before.transparent;
      const fallbackIsNative =
        lifecycle.fallbackRoute.bloom === 'native';
      const continuityPhases = fallbackIsNative
        ? ['restoring', 'restored']
        : ['fallback', 'fallbackSteady', 'restoring', 'restored'];

      for (const phase of continuityPhases)
      {
        const current = lifecycle[phase].transparent;
        const spatial = lifecycle.alphaContinuity[phase];
        const radialDelta = before.radialAlpha.map((value, index) =>
          Math.abs(value - current.radialAlpha[index]));
        const opacityProbeDelta = radialDelta[
          OPACITY_LINEAR_RADIAL_SAMPLE_INDEX
        ];

        // 点击中心同时包含 Cross2 与 Bloom，GPU/Canvas 栅格化会让
        // 高能区落在不同的饱和侧。固定径向探针能更准确地检查
        // 未饱和 Coverage，全图均值与峰值仍限制整体跳变。
        assert(
          relativeDifference(before.meanAlpha, current.meanAlpha) <= 0.15 &&
            Math.abs(before.maximumAlpha - current.maximumAlpha) <= 0.2 &&
            opacityProbeDelta <= 0.05,
          `${mode}: Context ${phase} 出现 Alpha 突跳`,
          {
            before,
            current,
            opacity,
            opacityProbeDelta,
          },
        );
        assert(
          spatial.meanAbsoluteDelta <= 0.003 &&
            spatial.visibleMeanAbsoluteDelta <= 0.08 &&
            spatial.maximumAbsoluteDelta <= 0.35 &&
            Math.max(...radialDelta) <= 0.2 &&
            Math.abs(before.bounds.width - current.bounds.width) <= 4 &&
            Math.abs(before.bounds.height - current.bounds.height) <= 4 &&
            relativeDifference(
              before.visibleRatio,
              current.visibleRatio,
            ) <= 0.15,
          `${mode}: Context ${phase} 的 Alpha 空间分布不连续`,
          {
            before,
            current,
            opacity,
            radialDelta,
            spatial,
          },
        );
      }

      if (fallbackIsNative)
      {
        const fallback = lifecycle.fallback.transparent;
        const fallbackSteady = lifecycle.fallbackSteady.transparent;
        const fallbackToSteady = lifecycle.alphaContinuity.fallbackToSteady;

        // Native 是 GPU 故障时的低成本降级，不能复制 MXFinalBloom 的宽
        // 光晕；它必须保持透明、稳定且不能产生比故障前更实的 Alpha 闪烁。
        assert(
          fallback.meanAlpha <= before.meanAlpha + 1 / 255 &&
            fallback.maximumAlpha <= before.maximumAlpha + 1 / 255 &&
            fallbackSteady.meanAlpha <= before.meanAlpha + 1 / 255 &&
            fallbackSteady.maximumAlpha <= before.maximumAlpha + 1 / 255,
          `${mode}: Native Context 回退产生 Alpha 增亮闪烁`,
          {
            before,
            fallback,
            fallbackSteady,
          },
        );
        assert(
          fallbackToSteady.meanAbsoluteDelta <= 0.003 &&
            fallbackToSteady.visibleMeanAbsoluteDelta <= 0.08 &&
            fallbackToSteady.maximumAbsoluteDelta <= 0.35,
          `${mode}: Native Context 回退首帧与稳定帧不一致`,
          fallbackToSteady,
        );
      }

      const restoringToRestored =
        lifecycle.alphaContinuity.restoringToRestored;

      assert(
        restoringToRestored.meanAbsoluteDelta <= 0.003 &&
          restoringToRestored.visibleMeanAbsoluteDelta <= 0.08 &&
          restoringToRestored.maximumAbsoluteDelta <= 0.35,
        `${mode}: Context 恢复首帧与稳定帧出现 Alpha 跳变`,
        {
          opacity,
          restored: lifecycle.restored.transparent,
          restoring: lifecycle.restoring.transparent,
          restoringToRestored,
        },
      );
    }
  }

  if (validateOpacitySeries)
  {
    for (const phase of [
      'before',
      'fallback',
      'fallbackSteady',
      'restoring',
      'restored',
    ])
    {
      validateContextOpacityGroup(mode, results, phase);
    }
  }
}

function validateContextLifecycleRoute(mode, lifecycle)
{
  const expectedEffect = mode === 'full-webgl2'
    ? 'webgl2'
    : 'canvas2d';
  const expectedFallbackBloom = mode === 'full-webgl2'
    ? 'software'
    : 'native';

  assert(
    lifecycle.beforeRoute.effect === expectedEffect &&
      lifecycle.beforeRoute.bloom === 'webgl2' &&
      lifecycle.fallbackRoute.effect === 'canvas2d' &&
      lifecycle.fallbackRoute.bloom === expectedFallbackBloom &&
      lifecycle.fallbackSteadyRoute.effect === 'canvas2d' &&
      lifecycle.fallbackSteadyRoute.bloom === expectedFallbackBloom &&
      lifecycle.restoringRoute.effect === expectedEffect &&
      lifecycle.restoringRoute.bloom === 'webgl2' &&
      lifecycle.restoredRoute.effect === expectedEffect &&
      lifecycle.restoredRoute.bloom === 'webgl2',
    `${mode}: Context 生命周期后端路由错误`,
    lifecycle,
  );
}

function validateDirectCompositingContract(
  mode,
  result,
  gpuPhases,
  canvasPhases,
)
{
  const gpuLayer = mode === 'full-webgl2'
    ? 'webglEffect'
    : 'webglBloom';
  const otherGpuLayer = mode === 'full-webgl2'
    ? 'webglBloom'
    : 'webglEffect';

  assert(
    result.isolatedCompositing === false,
    `${mode}: 默认 Context 夹具没有使用直接合成`,
    result.isolatedCompositing,
  );

  for (const phase of [...gpuPhases, ...canvasPhases])
  {
    const state = result.compositing[phase];
    const gpuVisible = gpuPhases.includes(phase);
    // 纯 WebGL2 会保留已清空的兼容 Canvas，WebGL2 Bloom 则显式隐藏它。
    const canvasVisible = mode === 'full-webgl2' || !gpuVisible;

    assert(
      state.isolatedCompositing === false &&
        state.overlayParentIsTarget &&
        !state.overlayRootConnected &&
        state.allCanvasLayersAbsolute &&
        state.allCanvasLayersDirectChildren &&
        state.visibleLayersCoverTarget &&
        state.layers.main.visible === canvasVisible &&
        state.layers.contrast.visible === canvasVisible &&
        state.layers[gpuLayer].exists &&
        state.layers[gpuLayer].visible === gpuVisible &&
        (!state.layers[otherGpuLayer].exists ||
          !state.layers[otherGpuLayer].visible),
      `${mode}: 直接合成 ${phase} 的 Canvas 挂载或输出所有权错误`,
      state,
    );
  }
}

function validateCompositingReferenceContextLifecycle(lifecycle)
{
  assert(
    lifecycle.referenceSet &&
      lifecycle.referencePreserved &&
      lifecycle.routes.before.effect === 'webgl2' &&
      lifecycle.routes.before.bloom === 'webgl2' &&
      lifecycle.routes.fallback.effect === 'canvas2d' &&
      lifecycle.routes.fallback.bloom === 'webgl2' &&
      lifecycle.routes.restoring.effect === 'webgl2' &&
      lifecycle.routes.restoring.bloom === 'webgl2' &&
      lifecycle.routes.restored.effect === 'webgl2' &&
      lifecycle.routes.restored.bloom === 'webgl2',
    '合成参考 Context 生命周期路由或参考对象保留失败',
    lifecycle,
  );

  for (const phase of ['before', 'fallback', 'restoring', 'restored'])
  {
    const overlay = lifecycle[phase].overlay;
    const composited = lifecycle[phase].composited;

    assert(
      hasPixelOutput(overlay),
      `合成参考在 Context ${phase} 阶段产生空白叠加层`,
      overlay,
    );
    assert(
      relativeDifference(
        lifecycle.before.overlay.meanEnergy,
        overlay.meanEnergy,
      ) <= 0.15 &&
        relativeDifference(
          lifecycle.before.overlay.meanAlpha,
          overlay.meanAlpha,
        ) <= 0.15,
      `合成参考叠加层在 Context ${phase} 阶段出现突跳`,
      {
        before: lifecycle.before.overlay,
        current: overlay,
      },
    );
    assert(
      composited.meanAlpha >= 0.99 &&
        composited.maximumAlpha >= 0.99 &&
        composited.visibleRatio >= 0.99 &&
        composited.bounds.width >= 319 &&
        composited.bounds.height >= 239 &&
        relativeDifference(
          lifecycle.before.composited.meanEnergy,
          composited.meanEnergy,
        ) <= 0.15,
      `合成参考在 Context ${phase} 阶段没有保持宿主合成结果`,
      {
        before: lifecycle.before.composited,
        current: composited,
      },
    );
  }
}

function validateBackendFailureContract(mode, chain, label)
{
  const expectedEffect = mode === 'full-webgl2'
    ? 'webgl2'
    : 'canvas2d';
  const expectedEvents = mode === 'full-webgl2'
    ? [
        ['effect', 'webgl2', 'canvas2d'],
        ['bloom', 'software', 'software'],
        ['bloom', 'software', 'native'],
        ['effect', 'webgl2', 'pending'],
        ['bloom', 'software', 'webgl2'],
        ['effect', 'webgl2', 'webgl2'],
      ]
    : [
        ['bloom', 'webgl2', 'native'],
        ['bloom', 'software', 'software'],
        ['bloom', 'software', 'native'],
        ['bloom', 'webgl2', 'pending'],
        ['bloom', 'webgl2', 'webgl2'],
      ];

  assert(
    chain.routes.before.effect === expectedEffect &&
      chain.routes.before.bloom === 'webgl2' &&
      chain.routes.software.effect === 'canvas2d' &&
      chain.routes.software.bloom === 'software' &&
      chain.routes.fault.effect === 'canvas2d' &&
      chain.routes.fault.bloom === 'native' &&
      chain.routes.native.effect === 'canvas2d' &&
      chain.routes.native.bloom === 'native' &&
      chain.routes.restoring.effect === expectedEffect &&
      chain.routes.restoring.bloom === 'webgl2' &&
      chain.routes.restored.effect === expectedEffect &&
      chain.routes.restored.bloom === 'webgl2',
    `${mode}: ${label}路由错误`,
    chain.routes,
  );
  assert(
    chain.readback.sourceCalls === 1 &&
      chain.readback.coverageCalls ===
        (mode === 'webgl2-bloom' ? 1 : 0),
    `${mode}: ${label}未命中预期 Software 回读故障`,
    chain.readback,
  );
  assert(
    chain.readback.nativeFaultRedrawCount === 1,
    `${mode}: ${label}Software 故障帧没有且仅有一次 Native 重画`,
    chain.readback,
  );
  assert(
    chain.renderer.poolIdentityBeforeFailure &&
      chain.renderer.poolIdentityAfterRestore &&
      chain.renderer.sourceContextPreserved &&
      chain.renderer.coverageContextPreserved &&
      chain.renderer.unavailableAfterFailure &&
      chain.renderer.availableAfterRestore === false,
    `${mode}: ${label}的 Software Renderer 永久回退合同失效`,
    chain.renderer,
  );
  assert(
    chain.events.length === expectedEvents.length &&
      chain.events.every((event, index) =>
      {
        const expected = expectedEvents[index];

        return event.kind === expected[0] &&
          event.requested === expected[1] &&
          event.resolved === expected[2];
      }),
    `${mode}: ${label}事件顺序错误`,
    {
      actual: chain.events,
      expected: expectedEvents,
    },
  );

  for (const phase of [
    'before',
    'software',
    'fault',
    'native',
    'restoring',
    'restored',
  ])
  {
    const compositing = chain.compositing[phase];

    assert(
      compositing.outputCompositing === chain.contract.outputCompositing &&
        compositing.hostCompositing === chain.contract.hostCompositing &&
        compositing.overlayAlphaPolicy ===
          chain.contract.overlayAlphaPolicy &&
        compositing.overlayColorCompensation ===
          chain.contract.overlayColorCompensation &&
        compositing.overlayAlphaLimit === chain.contract.overlayAlphaLimit,
      `${mode}: ${label}${phase} 丢失透明覆盖层配置`,
      {
        contract: chain.contract,
        phase: compositing,
      },
    );
  }
}

function validateBackendFailureAlphaContract(mode, chain, opacity, label)
{
  for (const phase of [
    'before',
    'software',
    'fault',
    'native',
    'restoring',
    'restored',
  ])
  {
    const pixels = chain[phase].transparent;
    const black = chain[phase].black;
    const checker = chain[phase].checker;
    const white = chain[phase].white;
    const transmission = chain[phase].backgroundTransmission;
    const outside = chain[phase].outside;

    if (outside.sampleCount > 0)
    {
      assert(
        outside.visiblePixelCount === 0 &&
          outside.maximumAlpha <= 1 / 255 &&
          outside.maximumEnergy <= 1 / 255,
        `${mode}: ${label} ${phase} 在特效保护包围盒外留下矩形底色`,
        outside,
      );
    }

    if (opacity === 0)
    {
      validateEmptyPixels(
        pixels,
        `${mode} ${label} ${phase} opacity=0`,
      );
    }
    else
    {
      assert(
        hasPixelOutput(pixels),
        `${mode}: ${label} ${phase} opacity=${opacity} 输出为空`,
        pixels,
      );
    }

    assert(
      black.meanEnergy < checker.meanEnergy &&
        checker.meanEnergy < white.meanEnergy &&
        (
          opacity === 0 ||
          (
            transmission.maximumSampleAlpha >= 8 &&
            transmission.visibleSampleCount >= 1
          )
        ) &&
        transmission.maximumTransmissionError <= 2 &&
        transmission.maximumCheckerError <= 1,
      `${mode}: ${label} ${phase} 没有保留 Coverage 背景透出`,
      {
        black: black.meanEnergy,
        checker: checker.meanEnergy,
        transmission,
        white: white.meanEnergy,
      },
    );
  }

  if (opacity === 0)
  {
    return;
  }

  const before = chain.before.transparent;

  for (const phase of [
    'software',
    'fault',
    'native',
    'restoring',
    'restored',
  ])
  {
    const current = chain[phase].transparent;
    const spatial = chain.alphaContinuity[phase];
    // Native 是浏览器阴影近似，外围 Coverage 比完整 WebGL2 窄；其余空间和
    // 中心约束保持不变，故障当帧还会与下一 Native 帧直接比较。
    const maximumMeanAlphaDifference =
      phase === 'fault' || phase === 'native' ? 0.55 : 0.5;
    const radialDelta = before.radialAlpha.map((value, index) =>
      Math.abs(value - current.radialAlpha[index]));

    assert(
      relativeDifference(before.meanAlpha, current.meanAlpha) <=
        maximumMeanAlphaDifference &&
        Math.abs(before.center[3] - current.center[3]) <= 40 &&
        spatial.meanAbsoluteDelta <= 0.006 &&
        spatial.visibleMeanAbsoluteDelta <= 0.12 &&
        spatial.maximumAbsoluteDelta <= 0.5 &&
        Math.max(...radialDelta) <= 0.3,
      `${mode}: ${label} ${phase} 破坏透明 Alpha 合同`,
      {
        before,
        current,
        opacity,
        radialDelta,
        spatial,
      },
    );
  }

  const faultToNative = chain.alphaContinuity.faultToNative;

  assert(
    faultToNative.meanAbsoluteDelta <= 0.003 &&
      faultToNative.visibleMeanAbsoluteDelta <= 0.08 &&
      faultToNative.maximumAbsoluteDelta <= 0.35,
    `${mode}: ${label} Software 故障帧与 Native 稳定帧出现 Alpha 跳变`,
    {
      fault: chain.fault.transparent,
      faultToNative,
      native: chain.native.transparent,
      opacity,
    },
  );
  const restoringToRestored = chain.alphaContinuity.restoringToRestored;

  assert(
    restoringToRestored.meanAbsoluteDelta <= 0.003 &&
      restoringToRestored.visibleMeanAbsoluteDelta <= 0.08 &&
      restoringToRestored.maximumAbsoluteDelta <= 0.35,
    `${mode}: ${label} 恢复首帧与稳定帧出现 Alpha 跳变`,
    {
      opacity,
      restored: chain.restored.transparent,
      restoring: chain.restoring.transparent,
      restoringToRestored,
    },
  );
}

function validateBackendFailureOpacitySeries(
  mode,
  results,
  label,
  probe = 'center',
)
{
  for (const phase of [
    'before',
    'software',
    'fault',
    'native',
    'restoring',
    'restored',
  ])
  {
    validateContextOpacityGroup(mode, results, phase, label, probe);
  }
}

function validateBackendFailureChain(
  mode,
  results,
  validateOpacitySeries = true,
)
{
  const label = '完整后端失败链';

  for (const [opacity, chain] of results)
  {
    validateBackendFailureContract(mode, chain, label);
    validateBackendFailureAlphaContract(mode, chain, opacity, label);
  }

  if (validateOpacitySeries)
  {
    validateBackendFailureOpacitySeries(mode, results, label);
  }
}

function validateTrailBackendFailureChain(mode, results)
{
  const label = '透明拖尾后端失败链';

  for (const [opacity, chain] of results)
  {
    validateBackendFailureContract(mode, chain, label);
    assert(
      chain.variant === 'trail-only',
      `${mode}: ${label}夹具混入点击特效`,
      chain.variant,
    );
    validateBackendFailureAlphaContract(mode, chain, opacity, label);
  }

  validateBackendFailureOpacitySeries(mode, results, label, 'trail');
}

function validateBackendReentrantNative(mode, result)
{
  const expectedEvents = mode === 'full-webgl2'
    ? [
        ['effect', 'webgl2', 'canvas2d'],
        ['bloom', 'webgl2', 'native'],
      ]
    : [
        ['bloom', 'webgl2', 'native'],
      ];

  assert(
    result.routes.fallback.requested === 'native' &&
      result.routes.fallback.effect === 'canvas2d' &&
      result.routes.fallback.bloom === 'native' &&
      result.routes.steady.requested === 'native' &&
      result.routes.steady.effect === 'canvas2d' &&
      result.routes.steady.bloom === 'native',
    `${mode}: 后端事件重入没有稳定切换到 Native`,
    result.routes,
  );
  assert(
    result.softwareRenderCalls === 0,
    `${mode}: 后端事件重入后仍执行了 Software Bloom`,
    result.softwareRenderCalls,
  );
  assert(
    result.events.length === expectedEvents.length &&
      result.events.every((event, index) =>
      {
        const expected = expectedEvents[index];

        return event.kind === expected[0] &&
          event.requested === expected[1] &&
          event.resolved === expected[2];
      }),
    `${mode}: 后端事件重入顺序错误`,
    {
      actual: result.events,
      expected: expectedEvents,
    },
  );

  for (const phase of ['fallback', 'steady'])
  {
    const pixels = result[phase].transparent;
    const transmission = result[phase].backgroundTransmission;

    assert(
      hasPixelOutput(pixels),
      `${mode}: 后端事件重入 ${phase} Native 输出为空`,
      pixels,
    );
    assert(
      transmission.maximumTransmissionError <= 2 &&
        transmission.maximumCheckerError <= 1,
      `${mode}: 后端事件重入 ${phase} 破坏 Coverage 背景透出`,
      transmission,
    );
  }
}

function validateWebGLTrailProbe(result, label)
{
  const profile = result.trailProfile;

  assert(
    result.route.resolvedEffectBackend ===
        result.expectedRoute.effectBackend &&
      result.route.resolvedBloomBackend ===
        result.expectedRoute.bloomBackend,
    `${label}: 直线拖尾没有使用请求的 WebGL2 路径`,
    result.route,
  );
  assert(
    profile &&
      profile.width >= 16 &&
      profile.headEnergy > profile.tailEnergy + 0.1,
    `${label}: Trail_03 的最新头部没有显著亮于最旧尾部`,
    profile,
  );
}

function validateWebGLTrailProfiles(first, second, label)
{
  for (const key of [
    'headEnergy',
    'tailEnergy',
    'upperEdgeEnergy',
    'lowerEdgeEnergy',
  ])
  {
    assert(
      Math.abs(first[key] - second[key]) <= 2 / 255,
      `${label}: 拖尾探针 ${key} 不一致`,
      {
        first,
        second,
      },
    );
  }
}

function validateWebGLTrailPair(fullWebGL2, webGL2Bloom)
{
  validateWebGLTrailProfiles(
    fullWebGL2.trailProfile,
    webGL2Bloom.trailProfile,
    '完整 WebGL2 与 WebGL2 Bloom',
  );
}

function validateWebGLTrailDirection(profile, label)
{
  assert(
    profile.upperEdgeEnergy > profile.lowerEdgeEnergy + 0.02,
    `${label}: Trail_03 可见横截面方向偏离 Unity 诊断帧`,
    profile,
  );
}

function validateTrailContextRoutes(mode, lifecycle)
{
  const expectedEffect = mode === 'full-webgl2'
    ? 'webgl2'
    : 'canvas2d';
  const expectedFallbackSteadyBloom = mode === 'full-webgl2'
    ? 'webgl2'
    : 'native';
  const routes = lifecycle.routes;

  assert(
    routes.before.effect === expectedEffect &&
      routes.before.bloom === 'webgl2' &&
      routes.fallback.effect === 'canvas2d' &&
      routes.fallback.bloom === 'native' &&
      routes.fallbackSteady.effect === 'canvas2d' &&
      routes.fallbackSteady.bloom === expectedFallbackSteadyBloom &&
      routes.restoring.effect === expectedEffect &&
      routes.restoring.bloom === 'webgl2' &&
      routes.restored.effect === expectedEffect &&
      routes.restored.bloom === 'webgl2',
    `${mode}: Trail Context 生命周期后端路由错误`,
    routes,
  );
}

function validateTrailContextCoverage(mode, lifecycle)
{
  const phases = [
    'before',
    'fallback',
    'fallbackSteady',
    'restoring',
    'restored',
  ];
  const before = lifecycle.before.transparent;

  for (const phase of phases)
  {
    const pixels = lifecycle[phase];
    const transmission = pixels.backgroundTransmission;

    assert(
      pixels.black.meanEnergy < pixels.checker.meanEnergy &&
        pixels.checker.meanEnergy < pixels.white.meanEnergy &&
        transmission.maximumSampleAlpha >= 8 &&
        transmission.visibleSampleCount >= 1 &&
        transmission.maximumTransmissionError <= 2 &&
        transmission.maximumCheckerError <= 1,
      `${mode}: 透明 Trail Context ${phase} 破坏 Coverage 背景透出`,
      {
        black: pixels.black.meanEnergy,
        checker: pixels.checker.meanEnergy,
        transmission,
        white: pixels.white.meanEnergy,
      },
    );
  }

  for (const phase of ['restoring', 'restored'])
  {
    const current = lifecycle[phase].transparent;
    const spatial = lifecycle.alphaContinuity[phase];

    assert(
      relativeDifference(before.meanAlpha, current.meanAlpha) <= 0.15 &&
        Math.abs(before.maximumAlpha - current.maximumAlpha) <= 0.2 &&
        Math.abs(
          before.trailProbeAlpha - current.trailProbeAlpha,
        ) <= 0.2,
      `${mode}: 透明 Trail Context ${phase} 出现 Coverage Alpha 突跳`,
      {
        before,
        current,
      },
    );
    assert(
      spatial.meanAbsoluteDelta <= 0.003 &&
        spatial.visibleMeanAbsoluteDelta <= 0.08 &&
        spatial.maximumAbsoluteDelta <= 0.35 &&
        Math.abs(before.bounds.width - current.bounds.width) <= 4 &&
        Math.abs(before.bounds.height - current.bounds.height) <= 4 &&
        relativeDifference(before.visibleRatio, current.visibleRatio) <= 0.15,
      `${mode}: 透明 Trail Context ${phase} 的 Alpha 空间分布不连续`,
      {
        before,
        current,
        spatial,
      },
    );
  }

  const restoringToRestored =
    lifecycle.alphaContinuity.restoringToRestored;

  assert(
    restoringToRestored.meanAbsoluteDelta <= 0.003 &&
      restoringToRestored.visibleMeanAbsoluteDelta <= 0.08 &&
      restoringToRestored.maximumAbsoluteDelta <= 0.35,
    `${mode}: 透明 Trail Context 恢复首帧与稳定帧出现 Alpha 跳变`,
    restoringToRestored,
  );
}

function validateTrailContextCompositing(mode, lifecycle)
{
  const gpuLayer = mode === 'full-webgl2'
    ? 'webglEffect'
    : 'webglBloom';
  const fallbackSteadyLayer = mode === 'full-webgl2'
    ? 'webglBloom'
    : 'main';

  for (const phase of [
    'before',
    'fallback',
    'fallbackSteady',
    'restoring',
    'restored',
  ])
  {
    const state = lifecycle.compositing[phase];

    assert(
      state.isolatedCompositing &&
        state.overlayRootConnected &&
        state.visibleLayersCoverTarget &&
        state.allCanvasLayersAbsolute,
      `${mode}: Trail Context ${phase} 的隔离合成层失效`,
      state,
    );
  }

  assert(
    lifecycle.compositing.before.layers[gpuLayer].visible &&
      !lifecycle.compositing.fallback.layers[gpuLayer].visible &&
      lifecycle.compositing.fallback.layers.main.visible &&
      !lifecycle.compositing.fallbackSteady.layers[gpuLayer].visible &&
      lifecycle.compositing.fallbackSteady
        .layers[fallbackSteadyLayer].visible &&
      lifecycle.compositing.restoring.layers[gpuLayer].visible &&
      lifecycle.compositing.restored.layers[gpuLayer].visible,
    `${mode}: Trail Context 丢失或恢复时暴露了错误的 GPU 输出层`,
    lifecycle.compositing,
  );
}

function validateTrailContextLifecycle(
  mode,
  outputCompositing,
  lifecycle,
)
{
  const label = `${mode} ${lifecycle.outputCompositing} Trail Context`;

  assert(
    lifecycle.outputCompositing === outputCompositing,
    `${label}: 夹具没有应用请求的输出合成模式`,
    lifecycle.outputCompositing,
  );
  validateTrailContextRoutes(mode, lifecycle);
  validateTrailContextCompositing(mode, lifecycle);
  assert(
    Object.values(lifecycle.texture).every(Boolean),
    `${label}: 恢复没有替换失效纹理并重建有效 Trail_03`,
    lifecycle.texture,
  );

  for (const phase of [
    'before',
    'fallback',
    'fallbackSteady',
    'restoring',
    'restored',
  ])
  {
    assert(
      hasPixelOutput(lifecycle[phase].transparent),
      `${label}: ${phase} 产生空白帧`,
      lifecycle[phase].transparent,
    );
  }

  validateWebGLTrailProfiles(
    lifecycle.profiles.before,
    lifecycle.profiles.restoring,
    `${label} 恢复首帧`,
  );
  validateWebGLTrailProfiles(
    lifecycle.profiles.before,
    lifecycle.profiles.restored,
    `${label} 恢复稳定帧`,
  );
  validateWebGLTrailDirection(
    lifecycle.profiles.before,
    `${label} 恢复前`,
  );
  validateWebGLTrailDirection(
    lifecycle.profiles.restoring,
    `${label} 恢复首帧`,
  );
  validateWebGLTrailDirection(
    lifecycle.profiles.restored,
    `${label} 恢复稳定帧`,
  );

  if (lifecycle.outputCompositing === 'browser-overlay')
  {
    validateTrailContextCoverage(mode, lifecycle);
  }
}

function validateWebGLTrailDirections(fullWebGL2, webGL2Bloom)
{
  validateWebGLTrailDirection(
    fullWebGL2.trailProfile,
    '完整 WebGL2',
  );
  validateWebGLTrailDirection(
    webGL2Bloom.trailProfile,
    'WebGL2 Bloom',
  );
}

function selectBaselineFeatures(result)
{
  const pixels = result.pixels.transparent;
  const round = (value) => Number(value.toFixed(6));

  return {
    meanRed: round(pixels.meanRed),
    meanGreen: round(pixels.meanGreen),
    meanBlue: round(pixels.meanBlue),
    meanAlpha: round(pixels.meanAlpha),
    meanEnergy: round(pixels.meanEnergy),
    visibleRatio: round(pixels.visibleRatio),
    maximumAlpha: round(pixels.maximumAlpha),
    boundsWidth: round(pixels.bounds.width),
    boundsHeight: round(pixels.bounds.height),
    centerAlpha: round(pixels.center[3] / 255),
    centerRgb: pixels.center.slice(0, 3).map((value) => round(value / 255)),
    radialAlpha: pixels.radialAlpha.map(round),
  };
}

function validateBaseline(actual, expected, tolerances, label)
{
  for (const key of [
    'meanRed',
    'meanGreen',
    'meanBlue',
    'meanAlpha',
    'meanEnergy',
    'visibleRatio',
    'maximumAlpha',
    'centerAlpha',
  ])
  {
    const tolerance = tolerances[key] ?? tolerances.default;

    assert(
      Math.abs(actual[key] - expected[key]) <= tolerance,
      `${label}: 数值基线 ${key} 漂移`,
      {
        actual: actual[key],
        expected: expected[key],
        tolerance,
      },
    );
  }

  for (let index = 0; index < actual.centerRgb.length; index++)
  {
    assert(
      Math.abs(actual.centerRgb[index] - expected.centerRgb[index]) <=
        tolerances.centerChannel,
      `${label}: 中心 RGB 基线在通道 ${index} 漂移`,
      {
        actual: actual.centerRgb,
        expected: expected.centerRgb,
      },
    );
  }

  assert(
    Math.abs(actual.boundsWidth - expected.boundsWidth) <=
      tolerances.boundsCssPixels &&
      Math.abs(actual.boundsHeight - expected.boundsHeight) <=
        tolerances.boundsCssPixels,
    `${label}: 数值基线包围盒漂移`,
    {
      actual,
      expected,
    },
  );

  for (let index = 0; index < actual.radialAlpha.length; index++)
  {
    assert(
      Math.abs(actual.radialAlpha[index] - expected.radialAlpha[index]) <=
        tolerances.radialAlpha,
      `${label}: 径向 Alpha 基线在采样 ${index} 漂移`,
      {
        actual: actual.radialAlpha,
        expected: expected.radialAlpha,
      },
    );
  }
}

async function summarizeScreenshot(page, screenshot)
{
  return page.evaluate(
    async (encoded) =>
    {
      const response = await fetch(`data:image/png;base64,${encoded}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext(
        '2d',
        {
          willReadFrequently: true,
        },
      );

      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const data = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      ).data;
      let redSum = 0;
      let greenSum = 0;
      let blueSum = 0;
      let energySum = 0;
      let minimumEnergy = 255;
      let maximumEnergy = 0;

      for (let offset = 0; offset < data.length; offset += 4)
      {
        const energy = Math.max(
          data[offset],
          data[offset + 1],
          data[offset + 2],
        );

        redSum += data[offset];
        greenSum += data[offset + 1];
        blueSum += data[offset + 2];
        energySum += energy;
        minimumEnergy = Math.min(minimumEnergy, energy);
        maximumEnergy = Math.max(maximumEnergy, energy);
      }

      // 截图包含 stage 的 16px 内边距，按实际位图宽度定位点击中心。
      const centerScale = canvas.width / 352;
      const centerX = Math.min(
        canvas.width - 1,
        Math.round((16 + 160) * centerScale),
      );
      const centerY = Math.min(
        canvas.height - 1,
        Math.round((16 + 96) * centerScale),
      );
      const centerOffset = (centerY * canvas.width + centerX) * 4;
      const pixelCount = canvas.width * canvas.height;

      return {
        width: canvas.width,
        height: canvas.height,
        center: Array.from(data.slice(centerOffset, centerOffset + 4)),
        meanRed: redSum / pixelCount / 255,
        meanGreen: greenSum / pixelCount / 255,
        meanBlue: blueSum / pixelCount / 255,
        meanEnergy: energySum / pixelCount / 255,
        minimumEnergy: minimumEnergy / 255,
        maximumEnergy: maximumEnergy / 255,
      };
    },
    screenshot.toString('base64'),
  );
}

async function captureCompositorMetrics(page)
{
  await page.evaluate(() => window.browserPixelSuite.waitForCompositorFrame());
  const clip = await page.evaluate(() => window.browserPixelSuite.getStageClip());
  const screenshot = await page.screenshot(
    {
      animations: 'disabled',
      clip,
      type: 'png',
    },
  );

  return summarizeScreenshot(page, screenshot);
}

async function captureContrastScreenshot(page)
{
  await page.evaluate(() => window.browserPixelSuite.waitForCompositorFrame());
  const clip = await page.evaluate(() => window.browserPixelSuite.getStageClip());

  return page.screenshot(
    {
      animations: 'disabled',
      clip,
      type: 'png',
    },
  );
}

async function compareScreenshotBuffers(page, left, right)
{
  return page.evaluate(
    async (encoded) =>
    {
      const decode = async (value) =>
      {
        const response = await fetch(`data:image/png;base64,${value}`);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext(
          '2d',
          {
            willReadFrequently: true,
          },
        );

        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const leftImage = await decode(encoded.left);
      const rightImage = await decode(encoded.right);

      if (
        leftImage.width !== rightImage.width ||
        leftImage.height !== rightImage.height
      )
      {
        throw new Error('Contrast 对照截图尺寸不一致');
      }

      let changedPixels = 0;
      let maximumChannelDelta = 0;
      let maximumChannelDrop = 0;
      let maximumChannelIncrease = 0;
      let channelDropSum = 0;
      let maximumRedDrop = 0;
      let redDropSum = 0;
      let chromaticChangedPixels = 0;
      let rgbAbsoluteDeltaSum = 0;
      let leftWhiteCorePixels = 0;
      let rightWhiteCorePixels = 0;
      let targetRgbAbsoluteDeltaSum = 0;
      let targetPositiveRgbDeltaSum = 0;
      let targetNegativeRgbDeltaSum = 0;
      let targetChangedPixels = 0;
      let targetHighDeltaPixels = 0;
      let targetLeftWhiteCorePixels = 0;
      let targetRightWhiteCorePixels = 0;
      let targetLeftSaturatedPixels = 0;
      let targetRightSaturatedPixels = 0;
      const targetX = Math.round(leftImage.width * 16 / 352);
      const targetY = Math.round(leftImage.height * 16 / 272);
      const targetWidth = Math.round(leftImage.width * 320 / 352);
      const targetHeight = Math.round(leftImage.height * 240 / 272);
      const targetPixelCount = targetWidth * targetHeight;

      for (let offset = 0; offset < leftImage.data.length; offset += 4)
      {
        let pixelChanged = false;
        let maximumPixelRgbDelta = 0;
        const pixelIndex = offset / 4;
        const pixelX = pixelIndex % leftImage.width;
        const pixelY = Math.floor(pixelIndex / leftImage.width);
        const insideTarget = pixelX >= targetX &&
          pixelX < targetX + targetWidth &&
          pixelY >= targetY &&
          pixelY < targetY + targetHeight;

        for (let channel = 0; channel < 4; channel++)
        {
          const leftValue = leftImage.data[offset + channel];
          const rightValue = rightImage.data[offset + channel];
          const delta = Math.abs(leftValue - rightValue);

          maximumChannelDelta = Math.max(maximumChannelDelta, delta);
          pixelChanged ||= delta > 0;

          if (channel < 3)
          {
            rgbAbsoluteDeltaSum += delta;
            maximumPixelRgbDelta = Math.max(maximumPixelRgbDelta, delta);

            if (insideTarget)
            {
              targetRgbAbsoluteDeltaSum += delta;
              targetPositiveRgbDeltaSum += Math.max(
                0,
                rightValue - leftValue,
              );
              targetNegativeRgbDeltaSum += Math.max(
                0,
                leftValue - rightValue,
              );
            }

            const channelDrop = Math.max(0, leftValue - rightValue);

            maximumChannelDrop = Math.max(
              maximumChannelDrop,
              channelDrop,
            );
            channelDropSum += channelDrop;
            maximumChannelIncrease = Math.max(
              maximumChannelIncrease,
              rightValue - leftValue,
            );
          }
        }

        const redDrop = Math.max(
          0,
          leftImage.data[offset] - rightImage.data[offset],
        );

        maximumRedDrop = Math.max(maximumRedDrop, redDrop);
        redDropSum += redDrop;

        if (
          leftImage.data[offset] >= 250 &&
          leftImage.data[offset + 1] >= 250 &&
          leftImage.data[offset + 2] >= 250
        )
        {
          leftWhiteCorePixels++;
        }

        if (
          rightImage.data[offset] >= 250 &&
          rightImage.data[offset + 1] >= 250 &&
          rightImage.data[offset + 2] >= 250
        )
        {
          rightWhiteCorePixels++;
        }

        if (insideTarget)
        {
          targetChangedPixels += pixelChanged ? 1 : 0;
          targetHighDeltaPixels += maximumPixelRgbDelta >= 32 ? 1 : 0;
          targetLeftWhiteCorePixels +=
            leftImage.data[offset] >= 250 &&
            leftImage.data[offset + 1] >= 250 &&
            leftImage.data[offset + 2] >= 250
              ? 1
              : 0;
          targetRightWhiteCorePixels +=
            rightImage.data[offset] >= 250 &&
            rightImage.data[offset + 1] >= 250 &&
            rightImage.data[offset + 2] >= 250
              ? 1
              : 0;
          targetLeftSaturatedPixels +=
            Math.max(
              leftImage.data[offset],
              leftImage.data[offset + 1],
              leftImage.data[offset + 2],
            ) >= 250
              ? 1
              : 0;
          targetRightSaturatedPixels +=
            Math.max(
              rightImage.data[offset],
              rightImage.data[offset + 1],
              rightImage.data[offset + 2],
            ) >= 250
              ? 1
              : 0;
        }

        if (pixelChanged)
        {
          changedPixels++;

          // 灰阶遮罩也会改变像素；只有 RGB 变化不一致才能证明仍有蓝青色 VFX。
          const redDelta = rightImage.data[offset] - leftImage.data[offset];
          const greenDelta = rightImage.data[offset + 1] -
            leftImage.data[offset + 1];
          const blueDelta = rightImage.data[offset + 2] -
            leftImage.data[offset + 2];

          if (redDelta !== greenDelta || greenDelta !== blueDelta)
          {
            chromaticChangedPixels++;
          }
        }
      }

      const getPixelAt = (image, x, y) =>
      {
        const offset = (y * image.width + x) * 4;

        return Array.from(image.data.slice(offset, offset + 4));
      };
      // Stage 在目标区域四周保留 16px，截图坐标必须包含该偏移。
      const scale = leftImage.width / 352;
      const centerX = Math.min(
        leftImage.width - 1,
        Math.round((16 + 160) * scale),
      );
      const centerY = Math.min(
        leftImage.height - 1,
        Math.round((16 + 96) * scale),
      );
      const farX = Math.min(
        leftImage.width - 1,
        Math.round((16 + 16) * scale),
      );
      const farY = Math.min(
        leftImage.height - 1,
        Math.round((16 + 224) * scale),
      );

      return (
        {
          changedPixels,
          chromaticChangedPixels,
          center:
          {
            left: getPixelAt(leftImage, centerX, centerY),
            right: getPixelAt(rightImage, centerX, centerY),
          },
          far:
          {
            left: getPixelAt(leftImage, farX, farY),
            right: getPixelAt(rightImage, farX, farY),
          },
          maximumChannelDelta,
          maximumChannelDrop,
          maximumChannelIncrease,
          maximumRedDrop,
          meanAbsoluteRgbError:
            rgbAbsoluteDeltaSum /
            Math.max(1, leftImage.width * leftImage.height * 3),
          pixelCount: leftImage.width * leftImage.height,
          rgbAbsoluteDeltaSum,
          leftWhiteCorePixels,
          rightWhiteCorePixels,
          channelDropSum,
          redDropSum,
          target:
          {
            changedPixels: targetChangedPixels,
            highDeltaPixels: targetHighDeltaPixels,
            leftSaturatedPixels: targetLeftSaturatedPixels,
            leftWhiteCorePixels: targetLeftWhiteCorePixels,
            meanAbsoluteRgbError:
              targetRgbAbsoluteDeltaSum /
              Math.max(1, targetPixelCount * 3),
            meanNegativeRgbDelta:
              targetNegativeRgbDeltaSum /
              Math.max(1, targetPixelCount * 3),
            meanPositiveRgbDelta:
              targetPositiveRgbDeltaSum /
              Math.max(1, targetPixelCount * 3),
            pixelCount: targetPixelCount,
            rgbAbsoluteDeltaSum: targetRgbAbsoluteDeltaSum,
            rightSaturatedPixels: targetRightSaturatedPixels,
            rightWhiteCorePixels: targetRightWhiteCorePixels,
          },
        }
      );
    },
    {
      left: left.toString('base64'),
      right: right.toString('base64'),
    },
  );
}

async function validateContrastCompositing(
  page,
  contrastCases,
  isolationLabel,
)
{
  const transparentZero = contrastCases.get('browser-overlay__0');
  const transparentContrast = contrastCases.get(
    'browser-overlay__0.35',
  );
  const sceneZero = contrastCases.get('scene__0');
  const sceneContrast = contrastCases.get('scene__0.35');
  const transparentDifference = await compareScreenshotBuffers(
    page,
    transparentZero.screenshot,
    transparentContrast.screenshot,
  );
  const sceneDifference = await compareScreenshotBuffers(
    page,
    sceneZero.screenshot,
    sceneContrast.screenshot,
  );
  const prefix = `${isolationLabel} Contrast`;

  validateEmptyPixels(
    transparentZero.result.contrastLayer,
    `${prefix} browser-overlay=0`,
  );
  validateEmptyPixels(
    transparentContrast.result.contrastLayer,
    `${prefix} browser-overlay=0.35`,
  );
  validateEmptyPixels(
    sceneZero.result.contrastLayer,
    `${prefix} scene=0`,
  );
  assert(
    hasPixelOutput(sceneContrast.result.contrastLayer),
    `${prefix} scene=0.35 没有生成有效对比遮罩`,
    sceneContrast.result.contrastLayer,
  );
  assert(
    transparentDifference.changedPixels === 0 &&
      transparentDifference.maximumChannelDelta === 0,
    `${prefix} 改变了 browser-overlay 的 Chromium 输出`,
    transparentDifference,
  );
  assert(
    sceneDifference.changedPixels >= 8 &&
      sceneDifference.redDropSum > 0 &&
      sceneDifference.maximumRedDrop >= 4 &&
      sceneDifference.maximumChannelIncrease <= 1,
    `${prefix} 没有在 Scene 的真实 Chromium 合成中形成 darken 对照`,
    sceneDifference,
  );
  assert(
    sceneDifference.center.left[0] > sceneDifference.center.right[0],
    `${prefix} 没有压暗 Scene 点击中心的白色背景`,
    sceneDifference.center,
  );
  assert(
    sceneDifference.far.left.every((value) => value === 255) &&
      sceneDifference.far.right.every((value) => value === 255),
    `${prefix} 改变了远离特效遮罩的白色背景`,
    sceneDifference.far,
  );

  return (
    {
      sceneDifference,
      transparentDifference,
    }
  );
}

async function openFixture(browserInstance, baseUrl, dpr)
{
  const context = await browserInstance.newContext(
    {
      colorScheme: 'dark',
      deviceScaleFactor: dpr,
      reducedMotion: 'reduce',
      viewport:
      {
        width: 400,
        height: 320,
      },
    },
  );
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];

  const failedResources = [];

  await page.addInitScript(
    () =>
    {
      const getContext = HTMLCanvasElement.prototype.getContext;

      HTMLCanvasElement.prototype.getContext = function getFixtureContext(
        type,
        options,
      )
      {
        if (type !== 'webgl2')
        {
          return getContext.call(this, type, options);
        }

        // 透明像素断言需要从最终默认帧缓冲抓取 Canvas。测试夹具必须
        // 保留该缓冲，避免 Chromium 在合成后清空它；产品上下文仍保持
        // false，以免把测试读回成本带入运行时。
        return getContext.call(
          this,
          type,
          {
            ...options,
            preserveDrawingBuffer: true,
          },
        );
      };
    },
  );

  page.on('pageerror', (error) =>
  {
    pageErrors.push(error.message);
  });
  page.on('console', (message) =>
  {
    if (message.type() === 'error')
    {
      consoleErrors.push(
        {
          location: message.location(),
          text: message.text(),
        },
      );
    }
  });
  page.on('requestfailed', (request) =>
  {
    failedResources.push(
      {
        error: request.failure()?.errorText ?? 'unknown',
        url: request.url(),
      },
    );
  });
  page.on('response', (response) =>
  {
    if (response.status() >= 400)
    {
      failedResources.push(
        {
          status: response.status(),
          url: response.url(),
        },
      );
    }
  });
  currentPage = page;
  const fixtureUrl = new URL(`${baseUrl}${fixturePath}`);

  await page.goto(fixtureUrl.href, { waitUntil: 'load' });

  try
  {
    await page.waitForFunction(
      () => window.__BACLICKFX_PIXEL_READY__ === true,
      null,
      {
        polling: 100,
        timeout: 30000,
      },
    );
  }
  catch
  {
    const pageState = await page.evaluate(() =>
      ({
        progress: window.__BACLICKFX_PIXEL_PROGRESS__ ?? 'not-started',
        readyState: document.readyState,
        resources: performance.getEntriesByType('resource')
          .map((entry) => entry.name),
        scripts: [...document.scripts].map((script) => script.src),
      }));

    throw new Error(
      `浏览器夹具启动失败: ${JSON.stringify(
        {
          consoleErrors,
          failedResources,
          pageState,
          pageErrors,
          url: page.url(),
        },
      )}`,
    );
  }
  const capabilities = await page.evaluate(() =>
  {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');

    return {
      dpr: devicePixelRatio,
      userAgent: navigator.userAgent,
      webgl2: Boolean(gl),
      loseContext: Boolean(gl?.getExtension('WEBGL_lose_context')),
      preserveDrawingBuffer: gl?.getContextAttributes()?.preserveDrawingBuffer ===
        true,
    };
  });

  assert(capabilities.webgl2, `DPR ${dpr}: Chromium 不支持 WebGL2`);
  assert(
    capabilities.loseContext,
    `DPR ${dpr}: Chromium 不支持 WEBGL_lose_context`,
  );
  assert(
    capabilities.preserveDrawingBuffer,
    `DPR ${dpr}: 浏览器夹具没有保留 WebGL2 读回缓冲`,
    capabilities,
  );
  assert(
    Math.abs(capabilities.dpr - dpr) < 0.01,
    `DPR ${dpr}: 浏览器上下文 DPR 配置未生效`,
    capabilities,
  );

  return {
    capabilities,
    context,
    page,
    consoleErrors,
    failedResources,
    pageErrors,
  };
}

async function collectLifecycleTimeline(page, mode, variant, sampleTimes)
{
  const timelines = new Map();
  const commonSpecification =
  {
    mode,
    opacity: 1,
    isolatedCompositing: true,
    background: 'transparent',
    outputCompositing: 'browser-overlay',
    shadow: false,
    containStrict: false,
  };
  const variants =
  {
    click:
    {
      includeClick: true,
      includeTrail: false,
      fxParams:
      {
        'hit.enabled': false,
        'shards.clickCount': 0,
        'shards.maxCount': 0,
      },
    },
    disk:
    {
      includeClick: true,
      includeTrail: false,
      fxParams:
      {
        'hit.enabled': false,
        'rings.count': 0,
        'shards.clickCount': 0,
        'shards.maxCount': 0,
        // Cross2 的 RGB/Bloom 不受粒子生命周期 Alpha 调制；关闭独立点击
        // 发射而保留清晰材质，才能单独验证 200ms Coverage 曲线。
        'bloom.clickEmissionScale': 0,
      },
    },
    trail:
    {
      includeClick: false,
      includeTrail: true,
      includeTrailShards: false,
      fxParams:
      {
        'shards.maxCount': 0,
      },
    },
    hit:
    {
      includeClick: true,
      includeTrail: false,
      fxParams:
      {
        'hit.enabled': true,
        'disk.radius': 20,
        'rings.count': 0,
        'shards.clickCount': 0,
        'shards.maxCount': 0,
        'bloom.diskEmission': 0,
      },
    },
    noHit:
    {
      includeClick: true,
      includeTrail: false,
      fxParams:
      {
        'hit.enabled': false,
        'disk.radius': 20,
        'rings.count': 0,
        'shards.clickCount': 0,
        'shards.maxCount': 0,
        'bloom.diskEmission': 0,
      },
    },
  };

  for (const sampleTimeMs of sampleTimes)
  {
    const label = `${mode}__lifecycle-${variant}-${sampleTimeMs}ms`;
    const specification =
    {
      ...commonSpecification,
      ...variants[variant],
      inspectWebGLTransport:
        variant === 'disk' &&
        (mode === 'full-webgl2' || mode === 'webgl2-bloom'),
      sampleTimeMs,
    };

    currentLabel = label;
    const result = await page.evaluate(
      (input) => window.browserPixelSuite.runCase(input),
      specification,
    );

    timelines.set(sampleTimeMs, result);
    metrics.cases[label] = result;
  }

  return timelines;
}

async function runDemoTimeScaleControlSmoke(browserInstance, baseUrl)
{
  currentLabel = 'demo-time-scale-controls';
  const context = await browserInstance.newContext(
    {
      colorScheme: 'dark',
      deviceScaleFactor: 1,
      viewport:
      {
        width: 1024,
        height: 768,
      },
    },
  );
  const page = await context.newPage();

  try
  {
    currentPage = page;
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(
      () => typeof window.BAClickFXDemo?.getConfig === 'function',
    );
    await page.locator('#panelToggle').click();
    await page.waitForFunction(() =>
    {
      const panel = document.getElementById('panel');

      return panel?.classList.contains('open') &&
        Math.abs(panel.getBoundingClientRect().right - window.innerWidth) < 1;
    });
    const controls =
    [
      ['ctrlClickTimeScale', 'outClickTimeScale', 'clickTimeScale', 0.99],
      ['ctrlTrailTimeScale', 'outTrailTimeScale', 'trailTimeScale', 1.01],
    ];
    const readState = async (id, outputId, configKey) => page.evaluate(
      ({ controlId, outputId: stateOutputId, stateConfigKey }) =>
      {
        const control = document.getElementById(controlId);
        const output = document.getElementById(stateOutputId);

        return {
          config: window.BAClickFXDemo.getConfig()[stateConfigKey],
          output: output.textContent,
          stored: localStorage.getItem(`bafx-${controlId}`),
          value: control.value,
        };
      },
      {
        controlId: id,
        outputId,
        stateConfigKey: configKey,
      },
    );
    const clickRangeValue = async (id, targetValue) =>
    {
      const control = page.locator(`#${id}`);

      // HDR 诊断项会把宿主控件推到面板首屏之外；真实鼠标坐标必须先
      // 基于滚入视口后的布局计算，否则点击会落到浏览器视口外。
      await control.scrollIntoViewIfNeeded();
      const point = await control.evaluate((element, value) =>
      {
        const range = element;
        const bounds = range.getBoundingClientRect();
        const thumbWidth = 14;
        const min = Number(range.min);
        const max = Number(range.max);
        const progress = (value - min) / (max - min);

        return {
          x: bounds.x + thumbWidth / 2 +
            (bounds.width - thumbWidth) * progress,
          y: bounds.y + bounds.height / 2,
        };
      }, targetValue);

      await page.mouse.click(point.x, point.y);
    };

    // 先离开默认值，避免点到已是 1.00 的位置时浏览器不派发 input。
    for (const [id] of controls)
    {
      await clickRangeValue(id, 0.5);
      const displacedState = await page.evaluate((controlId) =>
      {
        const control = document.getElementById(controlId);

        return {
          value: control?.value,
        };
      }, id);

      assert(
        Number(displacedState.value) < 0.8,
        `${id} 的鼠标轨道点击没有离开默认倍率`,
        displacedState,
      );
    }

    // 这里使用真实鼠标轨道点击，覆盖浏览器原生 range 的 pointer/input
    // 时序，而不是仅模拟 input 事件。
    for (const [id, , , targetValue] of controls)
    {
      await clickRangeValue(id, targetValue);
    }

    const controlState =
    {
      clickSnapped: await readState(...controls[0].slice(0, 3)),
      trailSnapped: await readState(...controls[1].slice(0, 3)),
    };

    for (const [name, state] of Object.entries(
      {
        clickSnapped: controlState.clickSnapped,
        trailSnapped: controlState.trailSnapped,
      },
    ))
    {
      assert(
        state.value === '1' &&
          state.output === '1.00' &&
          state.config === 1 &&
          state.stored === '1',
        `${name} 没有把相邻速度档吸附到 1.00`,
        state,
      );
    }

    await page.evaluate(() =>
    {
      const clickControl = document.getElementById('ctrlClickTimeScale');
      const trailControl = document.getElementById('ctrlTrailTimeScale');

      clickControl.value = '0.99';
      clickControl.dispatchEvent(new Event('input', { bubbles: true }));
      trailControl.value = '1.01';
      trailControl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    controlState.clickPrecise = await readState(...controls[0].slice(0, 3));
    controlState.trailPrecise = await readState(...controls[1].slice(0, 3));

    assert(
      controlState.clickPrecise.value === '0.99' &&
        controlState.clickPrecise.config === 0.99 &&
        controlState.clickPrecise.stored === '0.99',
      '点击速度在非指针路径丢失了 0.01 精度',
      controlState.clickPrecise,
    );
    assert(
      controlState.trailPrecise.value === '1.01' &&
        controlState.trailPrecise.config === 1.01 &&
        controlState.trailPrecise.stored === '1.01',
      '拖尾速度在非指针路径丢失了 0.01 精度',
      controlState.trailPrecise,
    );
    metrics.demoTimeScaleControls = controlState;
  }
  finally
  {
    await context.close();
    currentPage = null;
  }
}

async function runDemoMobileTouchSmoke(browserInstance, baseUrl)
{
  currentLabel = 'demo-mobile-touch-action';
  const context = await browserInstance.newContext(
    {
      colorScheme: 'dark',
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
      viewport:
      {
        width: 390,
        height: 844,
      },
    },
  );
  const page = await context.newPage();

  const cases =
  [
    {
      action: 'none',
      direction: 'horizontal',
      keepsTrail: true,
    },
    {
      action: 'pan-y',
      direction: 'horizontal',
      keepsTrail: true,
    },
    {
      action: 'pan-y',
      direction: 'vertical',
      keepsTrail: false,
    },
    {
      action: 'pan-x',
      direction: 'vertical',
      keepsTrail: true,
    },
    {
      action: 'pan-x',
      direction: 'horizontal',
      keepsTrail: false,
    },
    {
      action: 'pinch-zoom',
      direction: 'horizontal',
      keepsTrail: true,
    },
    {
      action: 'pinch-zoom',
      direction: 'vertical',
      keepsTrail: true,
    },
    {
      action: 'pan-x pinch-zoom',
      direction: 'horizontal',
      keepsTrail: false,
    },
    {
      action: 'pan-x pinch-zoom',
      direction: 'vertical',
      keepsTrail: true,
    },
    {
      action: 'pan-y pinch-zoom',
      direction: 'horizontal',
      keepsTrail: true,
    },
    {
      action: 'pan-y pinch-zoom',
      direction: 'vertical',
      keepsTrail: false,
    },
    {
      action: 'auto',
      direction: 'horizontal',
      keepsTrail: false,
    },
    {
      action: 'manipulation',
      direction: 'horizontal',
      keepsTrail: false,
    },
    {
      action: 'pan-left',
      direction: 'right',
      keepsTrail: false,
    },
    {
      action: 'pan-left',
      direction: 'left',
      keepsTrail: true,
    },
    {
      action: 'pan-right',
      direction: 'left',
      keepsTrail: false,
    },
    {
      action: 'pan-right',
      direction: 'right',
      keepsTrail: true,
    },
    {
      action: 'pan-up',
      direction: 'down',
      keepsTrail: false,
    },
    {
      action: 'pan-up',
      direction: 'up',
      keepsTrail: true,
    },
    {
      action: 'pan-down',
      direction: 'up',
      keepsTrail: false,
    },
    {
      action: 'pan-down',
      direction: 'down',
      keepsTrail: true,
    },
  ];

  try
  {
    currentPage = page;
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(
      () => typeof window.BAClickFXDemo?.getConfig === 'function',
    );
    await page.evaluate(() =>
    {
      const inputSource = document.getElementById('ctrlInputSource');
      const trail = document.getElementById('ctrlTrail');
      const trailAlways = document.getElementById('ctrlTrailAlways');
      const surface = document.createElement('div');
      const content = document.createElement('div');

      // 触摸回归必须走库的 DOM 输入链路，避免宿主演示页的持久化状态
      // 把测试误切到 manual，导致只有事件序列而没有逻辑拖尾。
      window.BAClickFXDemo.updateConfig(
        {
          bloomBackend: 'native',
          clickEnabled: false,
          effectBackend: 'canvas2d',
          inputSource: 'dom',
          trailEnabled: true,
          trailAlways: false,
        },
      );
      window.BAClickFXDemo.setFxParam('trail.lifetimeMs', 2000);
      inputSource.value = 'dom';
      trail.checked = true;
      trailAlways.checked = false;

      surface.id = 'mobile-touch-regression-surface';
      surface.style.cssText = [
        'position: fixed',
        'left: 20px',
        'top: 120px',
        'width: 320px',
        'height: 320px',
        'overflow: auto',
        'z-index: 2147483000',
        'background: #333',
        'touch-action: auto',
      ].join(';');
      content.style.cssText = 'width: 700px; height: 700px';
      const stopHostPropagation = (event) =>
      {
        // 模拟宿主控件阻断冒泡；库的 capture 监听仍必须完成仲裁与清理。
        event.stopPropagation();
      };
      for (const type of ['touchmove', 'pointerup', 'pointercancel'])
      {
        content.addEventListener(type, stopHostPropagation,
          {
            passive: true,
          });
      }
      surface.append(content);
      document.body.append(surface);
      window.__mobileTouchEvents = [];

      for (const type of [
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel',
      ])
      {
        window.addEventListener(
          type,
          () => window.__mobileTouchEvents.push(type),
          { capture: true },
        );
      }
    });
    const cdp = await context.newCDPSession(page);
    const results = [];
    const dispatchTouchGesture = async (start, moves) =>
    {
      await cdp.send('Input.dispatchTouchEvent',
        {
          type: 'touchStart',
          touchPoints:
          [
            { ...start, id: 1, radiusX: 1, radiusY: 1, force: 1 },
          ],
        });

      for (const point of moves)
      {
        await cdp.send('Input.dispatchTouchEvent',
          {
            type: 'touchMove',
            touchPoints:
            [
              { ...point, id: 1, radiusX: 1, radiusY: 1, force: 1 },
            ],
          });
        await new Promise((resolve) => setTimeout(resolve, 16));
      }

      await cdp.send('Input.dispatchTouchEvent',
        {
          type: 'touchEnd',
          touchPoints: [],
        });
      await page.waitForTimeout(30);
    };

    for (const specification of cases)
    {
      currentLabel =
        `demo-mobile-touch-${specification.action}-${specification.direction}`;
      await page.evaluate((action) =>
      {
        const control = document.getElementById('ctrlTouchAction');
        const surface = document.getElementById(
          'mobile-touch-regression-surface',
        );
        const resetSurface = surface.cloneNode(true);

        // clear() 保留活动指针是公开合同；每轮触摸回归必须用公开暂停
        // 生命周期清空输入状态，避免上一轮未冒泡的终止事件污染下一轮。
        window.BAClickFXDemo.setPaused(true, { clear: true });
        window.BAClickFXDemo.setPaused(false);
        // 替换节点会同步终止上一用例的惯性滚动；只重设 scrollTop 时，
        // compositor 仍可能在下一帧追加旧手势的残余位移。
        surface.replaceWith(resetSurface);
        const stopHostPropagation = (event) =>
        {
          event.stopPropagation();
        };
        for (const type of ['touchmove', 'pointerup', 'pointercancel'])
        {
          resetSurface.firstElementChild.addEventListener(
            type,
            stopHostPropagation,
            {
              passive: true,
            },
          );
        }
        resetSurface.scrollLeft = 160;
        resetSurface.scrollTop = 160;
        if (Array.from(control.options).some((option) => option.value === action))
        {
          control.value = action;
          control.dispatchEvent(new Event('change', { bubbles: true }));
        }
        else
        {
          window.BAClickFXDemo.updateConfig({ touchAction: action });
        }
        window.__mobileTouchEvents = [];
      }, specification.action);

      const horizontalDirections = new Set(['horizontal', 'left', 'right']);
      const horizontal = horizontalDirections.has(specification.direction);
      const positive = specification.direction === 'right' ||
        specification.direction === 'down';
      const start = horizontal
        ? { x: positive ? 60 : 280, y: 260 }
        : { x: 180, y: positive ? 160 : 380 };
      const moves = horizontal
        ? (positive
          ? [
            { x: 100, y: 260 },
            { x: 140, y: 260 },
            { x: 180, y: 260 },
            { x: 220, y: 260 },
            { x: 250, y: 260 },
            { x: 280, y: 260 },
          ]
          : [
            { x: 250, y: 260 },
            { x: 220, y: 260 },
            { x: 180, y: 260 },
            { x: 140, y: 260 },
            { x: 100, y: 260 },
            { x: 60, y: 260 },
          ])
        : (positive
          ? [
            { x: 180, y: 200 },
            { x: 180, y: 240 },
            { x: 180, y: 280 },
            { x: 180, y: 320 },
            { x: 180, y: 350 },
            { x: 180, y: 380 },
          ]
          : [
            { x: 180, y: 350 },
            { x: 180, y: 320 },
            { x: 180, y: 280 },
            { x: 180, y: 240 },
            { x: 180, y: 200 },
            { x: 180, y: 160 },
          ]);

      await dispatchTouchGesture(start, moves);

      const result = await page.evaluate(() =>
      {
        const surface = document.getElementById(
          'mobile-touch-regression-surface',
        );
        const effect = window.BAClickFXDemo;

        return {
          action: effect.getConfig().touchAction,
          events: window.__mobileTouchEvents,
          pointCounts: effect.trailStrokes.map((stroke) => stroke.points.length),
          scrollLeft: surface.scrollLeft,
          scrollTop: surface.scrollTop,
          strokeCount: effect.trailStrokes.length,
          activePointerId: effect.activePointerId,
          currentTrailStroke: effect.currentTrailStroke !== null,
          touchGestureCount: effect.touchGestureStarts.size,
        };
      });

      assert(
        result.action === specification.action &&
          result.events[0] === 'pointerdown' &&
          result.events.includes(
            specification.keepsTrail ? 'pointerup' : 'pointercancel',
          ) &&
          !result.events.includes(
            specification.keepsTrail ? 'pointercancel' : 'pointerup',
          ) &&
          (specification.keepsTrail
            ? result.strokeCount > 0 && result.pointCounts[0] > 2
            : result.strokeCount === 0) &&
          result.activePointerId === null &&
          !result.currentTrailStroke &&
          result.touchGestureCount === 0,
        `${currentLabel}: 移动触摸拖尾生命周期不符合触摸策略`,
        result,
      );
      assert(
        specification.keepsTrail
          ? result.scrollLeft === 160 && result.scrollTop === 160
          : (
            horizontal
              ? result.scrollLeft !== 160
              : result.scrollTop !== 160
          ),
        `${currentLabel}: 原生滚动方向与触摸策略不一致`,
        result,
      );
      results.push({ specification, result });
    }

    currentLabel = 'demo-mobile-touch-input-filter';
    await page.evaluate(() =>
    {
      const control = document.getElementById('ctrlTouchAction');
      const panel = document.getElementById('panel');

      window.BAClickFXDemo.clear();
      document.getElementById('mobile-touch-regression-surface')
        .style.display = 'none';
      panel.style.transition = 'none';
      panel.classList.add('open');
      panel.scrollTop = 0;
      const originalInputFilter = window.BAClickFXDemo.inputFilter;

      window.__mobileInputFilterEvent = null;
      window.BAClickFXDemo.inputFilter = (event) =>
      {
        window.__mobileInputFilterEvent =
        {
          hasComposedPath: typeof event.composedPath === 'function',
          isPointerEvent: event instanceof PointerEvent,
        };
        return originalInputFilter(event);
      };
      control.value = 'none';
      control.dispatchEvent(new Event('change', { bubbles: true }));
      window.__mobileTouchEvents = [];
    });
    await dispatchTouchGesture(
      { x: 370, y: 700 },
      [
        { x: 370, y: 650 },
        { x: 370, y: 600 },
        { x: 370, y: 550 },
        { x: 370, y: 500 },
        { x: 370, y: 450 },
      ],
    );
    const filteredResult = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;
      const panel = document.getElementById('panel');

      return {
        events: window.__mobileTouchEvents,
        filterEvent: window.__mobileInputFilterEvent,
        panelScrollTop: panel.scrollTop,
        strokeCount: effect.trailStrokes.length,
      };
    });

    assert(
      filteredResult.events.includes('pointercancel') &&
        !filteredResult.events.includes('pointerup') &&
        filteredResult.filterEvent?.isPointerEvent &&
        filteredResult.filterEvent?.hasComposedPath &&
        filteredResult.panelScrollTop > 0 &&
        filteredResult.strokeCount === 0,
      'demo-mobile-touch-input-filter: 宿主面板没有保留原生滚动',
      filteredResult,
    );
    results.push(
      {
        specification: { action: 'none', scope: 'input-filter' },
        result: filteredResult,
      },
    );

    currentLabel = 'demo-mobile-touch-shadow-target';
    await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;
      const control = document.getElementById('ctrlTouchAction');
      const panel = document.getElementById('panel');
      const shadowHost = document.createElement('div');
      const shadowRoot = shadowHost.attachShadow({ mode: 'closed' });
      const target = document.createElement('div');

      panel.classList.remove('open');
      control.value = 'auto';
      control.dispatchEvent(new Event('change', { bubbles: true }));
      shadowHost.id = 'mobile-touch-shadow-host';
      shadowHost.style.cssText = [
        'position: fixed',
        'left: 20px',
        'top: 500px',
        'width: 320px',
        'height: 260px',
        'z-index: 2147483000',
      ].join(';');
      target.style.cssText = [
        'position: relative',
        'display: block',
        'width: 100%',
        'height: 100%',
        'background: #333',
      ].join(';');
      shadowRoot.append(target);
      document.body.append(shadowHost);
      window.__mobileShadowFilterEvents = [];
      window.__mobileShadowEffect = new effect.constructor(
        {
          target,
          bloomBackend: 'native',
          clickEnabled: false,
          effectBackend: 'canvas2d',
          inputSource: 'dom',
          touchAction: 'none',
          trailEnabled: true,
          trailAlways: false,
          inputFilter(event)
          {
            window.__mobileShadowFilterEvents.push(
              {
                hasComposedPath: typeof event.composedPath === 'function',
                isPointerEvent: event instanceof PointerEvent,
                targetIsInternal: event.target === target,
              },
            );
            return event.target === target;
          },
        },
      );
      window.__mobileShadowEffect.setFxParam('trail.lifetimeMs', 2000);
      window.__mobileTouchEvents = [];
    });
    await dispatchTouchGesture(
      { x: 280, y: 620 },
      [
        { x: 250, y: 620 },
        { x: 220, y: 620 },
        { x: 180, y: 620 },
        { x: 140, y: 620 },
        { x: 100, y: 620 },
        { x: 60, y: 620 },
      ],
    );
    const shadowResult = await page.evaluate(() =>
    {
      const effect = window.__mobileShadowEffect;
      const result =
      {
        events: window.__mobileTouchEvents,
        filterEvents: window.__mobileShadowFilterEvents,
        pointCounts: effect.trailStrokes.map((stroke) => stroke.points.length),
        strokeCount: effect.trailStrokes.length,
      };

      effect.destroy();
      document.getElementById('mobile-touch-shadow-host').remove();
      delete window.__mobileShadowEffect;
      return result;
    });

    assert(
      shadowResult.events.includes('pointerup') &&
        !shadowResult.events.includes('pointercancel') &&
        shadowResult.filterEvents.length === 1 &&
        shadowResult.filterEvents[0].isPointerEvent &&
        shadowResult.filterEvents[0].hasComposedPath &&
        shadowResult.filterEvents[0].targetIsInternal &&
        shadowResult.strokeCount > 0 &&
        shadowResult.pointCounts[0] > 2,
      'demo-mobile-touch-shadow-target: Shadow DOM target 拖尾被中断',
      shadowResult,
    );
    results.push(
      {
        specification: { action: 'none', scope: 'shadow-target' },
        result: shadowResult,
      },
    );

    metrics.demoMobileTouch = results;
  }
  finally
  {
    await context.close();
    currentPage = null;
  }
}

async function runDemoControlPanelStructureSmoke(browserInstance, baseUrl)
{
  currentLabel = 'demo-control-panel-structure';
  const context = await browserInstance.newContext(
    {
      colorScheme: 'dark',
      deviceScaleFactor: 1,
      viewport:
      {
        width: 1024,
        height: 768,
      },
    },
  );
  const page = await context.newPage();

  try
  {
    currentPage = page;
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(
      () => typeof window.BAClickFXDemo?.getConfig === 'function',
    );

    await page.evaluate(() =>
    {
      localStorage.setItem('bafx-ctrlBloomTrail', '0.5');
      localStorage.removeItem('bafx-ctrlBloomTrailAlpha');
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() =>
      window.BAClickFXDemo?.getFxConfig().bloom.trailAlpha === 0.09);
    const migratedNativeTrailAlpha = await page.evaluate(() =>
    ({
      trailEmissionAlpha:
        window.BAClickFXDemo.getFxConfig().bloom.trailEmissionAlpha,
      trailAlpha: window.BAClickFXDemo.getFxConfig().bloom.trailAlpha,
      control: document.getElementById('ctrlBloomTrailAlpha')?.value,
      stored: localStorage.getItem('bafx-ctrlBloomTrailAlpha'),
    }));
    assert(
      migratedNativeTrailAlpha.trailEmissionAlpha === 0.5 &&
        migratedNativeTrailAlpha.trailAlpha === 0.09 &&
        migratedNativeTrailAlpha.control === '0.09' &&
        migratedNativeTrailAlpha.stored === '0.09',
      '旧版拖尾发射校准没有迁移为等效的 Native 拖尾辉光 Alpha',
      migratedNativeTrailAlpha,
    );

    await page.evaluate(() => document.getElementById('btnReset').click());
    await page.waitForFunction(() =>
    {
      const bloom = window.BAClickFXDemo?.getFxConfig().bloom;

      return bloom?.trailEmissionAlpha === 1 && bloom?.trailAlpha === 0.18;
    });
    // 重置会按产品合同清空全部 bafx-* 键；刷新后再以新安装默认状态
    // 执行原有控制面板结构门禁，避免迁移用例污染主题持久化断言。
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => typeof window.BAClickFXDemo?.getConfig === 'function',
    );
    await page.locator('#panelToggle').click();
    await page.waitForFunction(() =>
    {
      const panel = document.getElementById('panel');

      return panel?.classList.contains('open') &&
        Math.abs(panel.getBoundingClientRect().right - window.innerWidth) < 1;
    });

    // 这些公开 Schema 参数以前只有宿主 API 入口；展示页控件必须继续
    // 使用相同路径更新配置，避免新增滑块只改变 UI 而没有改变引擎状态。
    const advancedControls =
    [
      {
        id: 'ctrlRingBandRatio',
        path: 'rings.bandToOuterRadius',
        scope: 'ringDetails',
        value: 0.1234,
      },
      {
        id: 'ctrlRadialSamples',
        path: 'rings.radialSamples',
        scope: 'ringDetails',
        value: 11,
      },
      {
        id: 'ctrlDissolveDir',
        path: 'rings.dissolveDirection',
        scope: 'ringDetails',
        value: -1,
      },
      {
        id: 'ctrlCornerVerts',
        path: 'trail.numCornerVertices',
        scope: 'trailLayerDetails',
        value: 7,
      },
      {
        id: 'ctrlCapVerts',
        path: 'trail.numCapVertices',
        scope: 'trailLayerDetails',
        value: 3,
      },
      {
        id: 'ctrlBloomSoftKnee',
        path: 'bloom.softKnee',
        scope: 'bloomPipelineDetails',
        value: 0.27,
      },
      {
        id: 'ctrlBloomClamp',
        path: 'bloom.clamp',
        scope: 'bloomPipelineDetails',
        value: 12345,
      },
      {
        id: 'ctrlBloomResolution',
        path: 'bloom.resolutionScale',
        scope: 'bloomPipelineDetails',
        value: 0.62,
      },
      {
        id: 'ctrlBloomEmission',
        path: 'bloom.emissionRange',
        scope: 'bloomPipelineDetails',
        value: 31.5,
      },
      {
        id: 'ctrlBloomDiskEmission',
        path: 'bloom.diskEmission',
        scope: 'bloomClickDetails',
        value: 4.25,
      },
      {
        id: 'ctrlBloomTrailAlpha',
        path: 'bloom.trailAlpha',
        scope: 'bloomTrailDetails',
        value: 0.46,
      },
      {
        id: 'ctrlBloomTrailEmission',
        path: 'bloom.trailEmission',
        scope: 'bloomTrailDetails',
        value: 41.25,
      },
      {
        id: 'ctrlBloomTrailCoverage',
        path: 'bloom.trailCoverageScale',
        scope: 'bloomTrailDetails',
        value: 2.25,
      },
      {
        id: 'ctrlBloomRingCoreAlpha',
        path: 'bloom.ringEmissionAlpha',
        scope: 'bloomClickDetails',
        value: 0.73,
      },
      {
        id: 'ctrlBloomDiskCoreAlpha',
        path: 'bloom.diskEmissionAlpha',
        scope: 'bloomClickDetails',
        value: 0.81,
      },
      {
        id: 'ctrlBloomRingAlpha',
        path: 'bloom.ringAlpha',
        scope: 'bloomClickDetails',
        value: 0.49,
      },
      {
        id: 'ctrlBloomDiskAlpha',
        path: 'bloom.diskAlpha',
        scope: 'bloomClickDetails',
        value: 0.77,
      },
    ];

    const structure = await page.evaluate(() =>
    {
      const shardScopes =
      {
        ctrlShardHdr: 'sharedShardsDetails',
        ctrlShardRoundness: 'sharedShardsDetails',
        ctrlShardSizeMin: 'sharedShardsDetails',
        ctrlShardSizeMax: 'sharedShardsDetails',
        ctrlClickShards: 'clickShardsDetails',
        ctrlClickShardLifeMin: 'clickShardsDetails',
        ctrlClickShardLifeMax: 'clickShardsDetails',
        ctrlClickShardRadius: 'clickShardsDetails',
        ctrlClickShardSpeedMin: 'clickShardsDetails',
        ctrlClickShardSpeedMax: 'clickShardsDetails',
        ctrlShardSpacing: 'trailShardsDetails',
        ctrlMaxShards: 'trailShardsDetails',
        ctrlTrailShardLifeMin: 'trailShardsDetails',
        ctrlTrailShardLifeMax: 'trailShardsDetails',
        ctrlTrailShardRadius: 'trailShardsDetails',
        ctrlTrailShardSpeedMin: 'trailShardsDetails',
        ctrlTrailShardSpeedMax: 'trailShardsDetails',
      };
      const panel = document.getElementById('panel');
      const display = document.getElementById('displayDetails');
      const theme = document.getElementById('themeDetails');
      const hostApi = document.getElementById('hostApiSummary');
      const defaultOpenDetails = Array.from(
        panel?.querySelectorAll('details[open]') ?? [],
      ).map((details) => details.id);
      const bloomSection = document.getElementById('sectionBloomHeading')
        ?.closest('.panel-section');
      const shardSection = document.getElementById('sectionShardsHeading')
        ?.closest('.panel-section');
      const bloomControlIds = Array.from(
        bloomSection?.querySelectorAll('input, select') ?? [],
      ).map((element) => element.id);
      const shardControlIds = Object.keys(shardScopes);
      const actualShardScopes = Object.fromEntries(
        shardControlIds.map((id) =>
          [id, document.getElementById(id)?.closest('details')?.id ?? null]),
      );
      const faqText =
        document.getElementById('introFAQContent')?.textContent ?? '';

      return {
        themeBeforeDisplay: Boolean(
          display && theme &&
            (theme.compareDocumentPosition(display) &
              Node.DOCUMENT_POSITION_FOLLOWING),
        ),
        themeBeforeHostApi: Boolean(
          theme && hostApi &&
            (theme.compareDocumentPosition(hostApi) &
              Node.DOCUMENT_POSITION_FOLLOWING),
        ),
        nestedPanelSections:
          panel?.querySelectorAll('.panel-section .panel-section').length ?? -1,
        defaultOpenDetails,
        faqContainsBASpark: faqText.includes('BASpark'),
        faqExplainsMobileTouch:
          faqText.includes('移动端浏览器滑动时为什么没有轨迹拖尾') &&
          faqText.includes('“触摸行为”切换为“禁止默认手势”') &&
          faqText.includes('pointercancel'),
        themeColorMode:
          document.getElementById('ctrlThemeColorMode')?.value ?? null,
        configuredThemeColorMode:
          window.BAClickFXDemo?.getConfig().themeColorMode ?? null,
        storedThemeColorMode:
          localStorage.getItem('bafx-ctrlThemeColorMode'),
        themeColorModeOptions: Array.from(
          document.querySelectorAll('#ctrlThemeColorMode option'),
        ).map((option) => option.value),
        touchActionOptions: Array.from(
          document.querySelectorAll('#ctrlTouchAction option'),
        ).map((option) =>
        ({
          value: option.value,
          text: option.textContent.trim(),
        })),
        actualShardScopes,
        shardControlCount: shardSection?.querySelectorAll('input[type="range"]').length ?? -1,
        bloomControlIds,
        actualAdvancedScopes: Object.fromEntries(
          Object.keys(
            {
              ctrlRingBandRatio: 'ringDetails',
              ctrlRadialSamples: 'ringDetails',
              ctrlDissolveDir: 'ringDetails',
              ctrlCornerVerts: 'trailLayerDetails',
              ctrlCapVerts: 'trailLayerDetails',
              ctrlBloomSoftKnee: 'bloomPipelineDetails',
              ctrlBloomClamp: 'bloomPipelineDetails',
              ctrlBloomResolution: 'bloomPipelineDetails',
              ctrlBloomEmission: 'bloomPipelineDetails',
              ctrlBloomDiskEmission: 'bloomClickDetails',
              ctrlBloomTrailAlpha: 'bloomTrailDetails',
              ctrlBloomTrailEmission: 'bloomTrailDetails',
              ctrlBloomTrailCoverage: 'bloomTrailDetails',
              ctrlBloomRingCoreAlpha: 'bloomClickDetails',
              ctrlBloomDiskCoreAlpha: 'bloomClickDetails',
              ctrlBloomRingAlpha: 'bloomClickDetails',
              ctrlBloomDiskAlpha: 'bloomClickDetails',
            },
          ).map((id) =>
            [id, document.getElementById(id)?.closest('details')?.id ?? null]),
        ),
        themeTitles: Object.fromEntries(
          Array.from(document.querySelectorAll('.theme-btn[data-theme]')).map(
            (button) => [button.dataset.theme, button.title],
          ),
        ),
      };
    });

    assert(
      structure.themeBeforeDisplay && structure.themeBeforeHostApi,
      '背景主题没有位于显示折叠栏之前或宿主 API 之前',
      structure,
    );
    assert(
      structure.nestedPanelSections === 0,
      '控制面板出现嵌套 panel-section',
      structure,
    );
    assert(
      JSON.stringify(structure.defaultOpenDetails) === JSON.stringify([
        'themeDetails',
        'displayDetails',
        'hostApiDetails',
        'sharedShardsDetails',
      ]),
      '控制面板默认展开的折叠栏不是背景主题、显示、宿主控制 API 与通用参数',
      structure,
    );
    assert(
      structure.faqContainsBASpark === false,
      '展示页加载后的 FAQ 仍显示 BASpark 字样',
      structure,
    );
    assert(
      structure.faqExplainsMobileTouch,
      '展示页中文 FAQ 没有说明移动端触摸行为切换',
      structure,
    );
    assert(
      JSON.stringify(structure.touchActionOptions) === JSON.stringify([
        { value: 'auto', text: '自动' },
        { value: 'none', text: '禁止默认手势' },
        { value: 'pan-x', text: '仅横向平移' },
        { value: 'pan-y', text: '仅纵向平移' },
        { value: 'pinch-zoom', text: '仅双指缩放' },
        { value: 'pan-x pinch-zoom', text: '横向平移与缩放' },
        { value: 'pan-y pinch-zoom', text: '纵向平移与缩放' },
        { value: 'manipulation', text: '直接操作' },
      ]),
      '展示页没有完整提供八种中文触摸行为选项',
      structure.touchActionOptions,
    );
    assert(
      structure.themeColorMode === 'relative-oklch' &&
        structure.configuredThemeColorMode === 'relative-oklch' &&
        structure.storedThemeColorMode === 'relative-oklch' &&
        JSON.stringify(structure.themeColorModeOptions) ===
          JSON.stringify(['relative-oklch', 'hue-only']),
      '新用户没有默认启用推荐主题映射，或展示页模式枚举不同步',
      structure,
    );
    assert(
      structure.shardControlCount === 17 &&
        Object.entries(structure.actualShardScopes).every(
          ([id, detailsId]) =>
            detailsId ===
            {
              ctrlShardHdr: 'sharedShardsDetails',
              ctrlShardRoundness: 'sharedShardsDetails',
              ctrlShardSizeMin: 'sharedShardsDetails',
              ctrlShardSizeMax: 'sharedShardsDetails',
              ctrlClickShards: 'clickShardsDetails',
              ctrlClickShardLifeMin: 'clickShardsDetails',
              ctrlClickShardLifeMax: 'clickShardsDetails',
              ctrlClickShardRadius: 'clickShardsDetails',
              ctrlClickShardSpeedMin: 'clickShardsDetails',
              ctrlClickShardSpeedMax: 'clickShardsDetails',
              ctrlShardSpacing: 'trailShardsDetails',
              ctrlMaxShards: 'trailShardsDetails',
              ctrlTrailShardLifeMin: 'trailShardsDetails',
              ctrlTrailShardLifeMax: 'trailShardsDetails',
              ctrlTrailShardRadius: 'trailShardsDetails',
              ctrlTrailShardSpeedMin: 'trailShardsDetails',
              ctrlTrailShardSpeedMax: 'trailShardsDetails',
            }[id],
        ),
      '17 个碎片参数没有完整归入通用、点击或拖尾碎片折叠栏',
      structure,
    );
    assert(
      Object.entries(structure.actualAdvancedScopes).every(
        ([id, detailsId]) =>
          detailsId ===
            advancedControls.find((control) => control.id === id)?.scope,
      ),
      '16 个新增 Schema 参数没有完整归入对应的特效折叠栏',
      structure,
    );
    assert(
      structure.bloomControlIds.every((id) =>
        [
          'ctrlBloomThreshold',
          'ctrlBloomSoftKnee',
          'ctrlBloomClamp',
          'ctrlBloomIntensity',
          'ctrlBloomDiffusion',
          'ctrlBloomResolution',
          'ctrlBloomEmission',
          'ctrlClickGlow',
          'ctrlBloomRing',
          'ctrlBloomDisk',
          'ctrlBloomDiskEmission',
          'ctrlBloomRingCoreAlpha',
          'ctrlBloomDiskCoreAlpha',
          'ctrlBloomRingAlpha',
          'ctrlBloomDiskAlpha',
          'ctrlBloomTrail',
          'ctrlBloomTrailAlpha',
          'ctrlBloomTrailEmission',
          'ctrlBloomTrailCoverage',
        ].includes(id),
      ),
      'Bloom 折叠栏仍包含碎片、环、光盘或轨迹的非 Bloom 参数',
      structure,
    );

    await page.evaluate(() =>
    {
      const control = document.getElementById('ctrlThemeColorMode');

      control.value = 'hue-only';
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.waitForFunction(() =>
      window.BAClickFXDemo?.getConfig().themeColorMode === 'hue-only');
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() =>
      window.BAClickFXDemo?.getConfig().themeColorMode === 'hue-only');
    const persistedThemeMode = await page.evaluate(() =>
    ({
      config: window.BAClickFXDemo.getConfig().themeColorMode,
      control: document.getElementById('ctrlThemeColorMode').value,
      stored: localStorage.getItem('bafx-ctrlThemeColorMode'),
    }));

    await page.evaluate(() => document.getElementById('btnReset').click());
    await page.waitForFunction(() =>
      window.BAClickFXDemo?.getConfig().themeColorMode === 'relative-oklch');
    const resetThemeMode = await page.evaluate(() =>
    ({
      config: window.BAClickFXDemo.getConfig().themeColorMode,
      control: document.getElementById('ctrlThemeColorMode').value,
      stored: localStorage.getItem('bafx-ctrlThemeColorMode'),
    }));

    await page.evaluate(() =>
    {
      localStorage.setItem('bafx-ctrlColor', '#330000');
      localStorage.removeItem('bafx-ctrlThemeColorMode');
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() =>
      window.BAClickFXDemo?.getConfig().themeColorMode === 'relative-oklch');
    const restoredDefaultTheme = await page.evaluate(() =>
    ({
      color: window.BAClickFXDemo.getConfig().themeColor,
      config: window.BAClickFXDemo.getConfig().themeColorMode,
      control: document.getElementById('ctrlThemeColorMode').value,
      stored: localStorage.getItem('bafx-ctrlThemeColorMode'),
    }));

    assert(
      persistedThemeMode.config === 'hue-only' &&
        persistedThemeMode.control === 'hue-only' &&
        persistedThemeMode.stored === 'hue-only' &&
        resetThemeMode.config === 'relative-oklch' &&
        resetThemeMode.control === 'relative-oklch' &&
        resetThemeMode.stored === null &&
        restoredDefaultTheme.color === '#330000' &&
        restoredDefaultTheme.config === 'relative-oklch' &&
        restoredDefaultTheme.control === 'relative-oklch' &&
        restoredDefaultTheme.stored === 'relative-oklch',
      '主题映射没有正确持久化、重置，或缺少模式时未使用新默认',
      { persistedThemeMode, resetThemeMode, restoredDefaultTheme },
    );

    // 其余控制面板门禁从推荐的新安装默认继续，避免兼容迁移状态污染测试。
    await page.evaluate(() => document.getElementById('btnReset').click());
    await page.waitForFunction(() =>
      window.BAClickFXDemo?.getConfig().themeColorMode === 'relative-oklch');
    await page.locator('#panelToggle').click();
    await page.waitForFunction(() =>
      document.getElementById('panel')?.classList.contains('open'));
    const themeModeLifecycle =
    {
      persistedThemeMode,
      resetThemeMode,
      restoredDefaultTheme,
    };

    const independentTrailAlphaControls = await page.evaluate(() =>
    {
      const emissionControl = document.getElementById('ctrlBloomTrail');
      const nativeControl = document.getElementById('ctrlBloomTrailAlpha');

      emissionControl.value = '0.37';
      emissionControl.dispatchEvent(new Event('input', { bubbles: true }));
      const alphaAfterEmissionChange =
        window.BAClickFXDemo.getFxConfig().bloom.trailAlpha;

      nativeControl.value = '0.46';
      nativeControl.dispatchEvent(new Event('input', { bubbles: true }));
      const bloom = window.BAClickFXDemo.getFxConfig().bloom;

      return {
        trailEmissionAlpha: bloom.trailEmissionAlpha,
        trailAlpha: bloom.trailAlpha,
        alphaAfterEmissionChange,
        storedEmission: localStorage.getItem('bafx-ctrlBloomTrail'),
        storedNative: localStorage.getItem('bafx-ctrlBloomTrailAlpha'),
      };
    });
    assert(
      independentTrailAlphaControls.trailEmissionAlpha === 0.37 &&
        independentTrailAlphaControls.trailAlpha === 0.46 &&
        independentTrailAlphaControls.alphaAfterEmissionChange === 0.18 &&
        independentTrailAlphaControls.storedEmission === '0.37' &&
        independentTrailAlphaControls.storedNative === '0.46',
      'Software 与 Native 拖尾辉光 Alpha 控件仍然互相覆盖',
      independentTrailAlphaControls,
    );

    const advancedChanged = await page.evaluate((controls) =>
    {
      const readPath = (config, path) =>
        path.split('.').reduce((value, key) => value?.[key], config);
      const result = {};

      for (const { id, path, value } of controls)
      {
        const control = document.getElementById(id);

        if (!control)
        {
          result[id] = { value: null, config: null, stored: null };
          continue;
        }

        control.value = String(value);
        control.dispatchEvent(new Event('input', { bubbles: true }));

        result[id] =
        {
          value: control.value,
          config: readPath(window.BAClickFXDemo.getFxConfig(), path),
          stored: localStorage.getItem(`bafx-${id}`),
        };
      }

      return result;
    }, advancedControls);
    assert(
      advancedControls.every(({ id, value }) =>
      {
        const changed = advancedChanged[id];

        return changed?.value === String(value) &&
          changed.config === value &&
          changed.stored === String(value);
      }),
      '新增 Schema 参数控件没有同步运行时配置或持久化值',
      advancedChanged,
    );

    await page.locator('#clickShardsSummary').click();
    await page.locator('#ctrlClickShardRadius').fill('42.25');
    await page.waitForFunction(() =>
      window.BAClickFXDemo.getFxConfig().shards.clickRadius === 42.25,
    );
    const changed = await page.evaluate(() =>
    {
      const control = document.getElementById('ctrlClickShardRadius');
      const output = document.getElementById('outClickShardRadius');

      return {
        value: control?.value,
        output: output?.textContent,
        config: window.BAClickFXDemo.getFxConfig().shards.clickRadius,
        stored: localStorage.getItem('bafx-ctrlClickShardRadius'),
      };
    });
    assert(
      changed.value === '42.25' &&
        changed.output === '42.25' &&
        changed.config === 42.25 &&
        changed.stored === '42.25',
      '新增点击碎片滑块没有更新运行时配置并持久化',
      changed,
    );

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () => typeof window.BAClickFXDemo?.getConfig === 'function',
    );
    const restored = await page.evaluate(() =>
    {
      const control = document.getElementById('ctrlClickShardRadius');

      return {
        value: control?.value,
        config: window.BAClickFXDemo.getFxConfig().shards.clickRadius,
        stored: localStorage.getItem('bafx-ctrlClickShardRadius'),
      };
    });
    assert(
      restored.value === '42.25' &&
        restored.config === 42.25 &&
        restored.stored === '42.25',
      '新增点击碎片滑块刷新后没有恢复持久化值',
      restored,
    );

    await page.locator('#panelToggle').click();
    await page.locator('#btnReset').click();
    await page.waitForFunction(() =>
      window.BAClickFXDemo.getFxConfig().shards.clickRadius === 49.8769488,
    );
    const reset = await page.evaluate(() =>
    {
      const control = document.getElementById('ctrlClickShardRadius');

      return {
        value: control?.value,
        config: window.BAClickFXDemo.getFxConfig().shards.clickRadius,
        stored: localStorage.getItem('bafx-ctrlClickShardRadius'),
        dprValue: document.getElementById('ctrlDpr')?.value,
        dprOutput: document.getElementById('outDpr')?.textContent,
        dprConfig: window.BAClickFXDemo.getConfig().maxDpr,
        dprStored: localStorage.getItem('bafx-ctrlDpr'),
      };
    });
    assert(
      reset.value === '49.88' &&
        reset.config === 49.8769488 &&
        reset.stored === null &&
        reset.dprValue === '1' &&
        reset.dprOutput === '1.00' &&
        reset.dprConfig === 1 &&
        reset.dprStored === null,
      '重置默认没有恢复碎片参数或最大 DPR 默认值',
      reset,
    );

    const hostApiState = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;
      const readConfig = () => effect.getConfig();
      const initialSamplingRate = readConfig().inputSamplingRate;
      const initialSamplingControl = Number(
        document.getElementById('ctrlInputSamplingRate').value,
      );
      const calls = [];
      const originals = {};

      for (const method of [
        'boom',
        'clearTrail',
        'clear',
        'setFxParams',
      ])
      {
        originals[method] = effect[method];
        effect[method] = (...args) =>
        {
          calls.push({ method, args });

          return method === 'setFxParams'
            ? { committed: true }
            : undefined;
        };
      }

      const setValue = (id, value, eventName = 'change') =>
      {
        const control = document.getElementById(id);

        control.value = value;
        control.dispatchEvent(new Event(eventName, { bubbles: true }));
      };

      setValue('ctrlOutputCompositing', 'browser-overlay');
      setValue('ctrlCompositingReference', 'unknown');
      setValue('ctrlHostCompositing', 'plus-lighter');
      setValue('ctrlHostCompositingSurface', 'native');
      setValue('ctrlLightBackgroundContrastAlpha', '0.42', 'input');
      const touchActionStates = [
        'pinch-zoom',
        'pan-x pinch-zoom',
        'pan-y pinch-zoom',
      ].map((action) =>
      {
        setValue('ctrlTouchAction', action);

        return {
          action,
          config: readConfig().touchAction,
          style: effect.canvas.style.touchAction,
          stored: localStorage.getItem('bafx-ctrlTouchAction'),
        };
      });
      setValue('ctrlInputSource', 'manual');
      setValue('ctrlInputSamplingRate', '1000', 'input');
      const maximumSamplingState =
      {
        config: readConfig().inputSamplingRate,
        output: document.getElementById('outInputSamplingRate').textContent,
        outputWidth: getComputedStyle(
          document.getElementById('outInputSamplingRate'),
        ).width,
      };
      setValue('ctrlInputSamplingRate', '30', 'input');
      const mobileSamplingOutputWidth = getComputedStyle(
        document.getElementById('outInputSamplingRate'),
      ).width;

      const pointerDown = effect.pointerDown(
        { x: 10, y: 20, pointerId: 9, pointerType: 'mouse' },
      );
      const pointerMove = effect.pointerMove(
        { x: 15, y: 25, pointerId: 9, pointerType: 'mouse' },
      );
      const pointerCancel = effect.pointerCancel(9);
      const configAfterManualInput = readConfig();

      document.getElementById('btnTriggerBoom').click();
      document.getElementById('btnClearTrail').click();
      document.getElementById('btnClearEffects').click();
      document.getElementById('btnApplyFxParams').click();

      for (const method of Object.keys(originals))
      {
        effect[method] = originals[method];
      }

      setValue('ctrlInputSource', 'dom');

      return {
        config: configAfterManualInput,
        touchActionStyle: effect.canvas.style.touchAction,
        storedTouchAction: localStorage.getItem('bafx-ctrlTouchAction'),
        storedHostCompositing:
          localStorage.getItem('bafx-ctrlHostCompositing'),
        storedHostSurface:
          localStorage.getItem('bafx-ctrlHostCompositingSurface'),
        storedContrastAlpha:
          localStorage.getItem('bafx-ctrlLightBackgroundContrastAlpha'),
        storedInputSamplingRate:
          localStorage.getItem('bafx-ctrlInputSamplingRate'),
        inputSamplingOutput:
          document.getElementById('outInputSamplingRate').textContent,
        initialSamplingRate,
        initialSamplingControl,
        maximumSamplingState,
        mobileSamplingOutputWidth,
        touchActionStates,
        pointerDown,
        pointerMove,
        pointerCancel,
        calls: calls.map(({ method }) => method),
      };
    });

    assert(
      hostApiState.config.outputCompositing === 'browser-overlay' &&
        hostApiState.config.hostCompositing === 'plus-lighter' &&
        hostApiState.config.hostCompositingSurface === 'native' &&
        hostApiState.config.lightBackgroundContrastAlpha === 0.42 &&
        hostApiState.config.touchAction === 'pan-y pinch-zoom' &&
        hostApiState.touchActionStyle === 'pan-y pinch-zoom' &&
        hostApiState.storedTouchAction === 'pan-y pinch-zoom' &&
        hostApiState.touchActionStates.every((state) =>
          state.config === state.action &&
            state.style === state.action &&
            state.stored === state.action) &&
        hostApiState.storedHostCompositing === 'plus-lighter' &&
        hostApiState.storedHostSurface === 'native' &&
        hostApiState.storedContrastAlpha === '0.42' &&
        hostApiState.initialSamplingRate === 0 &&
        hostApiState.initialSamplingControl === 0 &&
        hostApiState.config.inputSamplingRate === 30 &&
        hostApiState.storedInputSamplingRate === '30' &&
        hostApiState.inputSamplingOutput === '30' &&
        hostApiState.maximumSamplingState.config === 1000 &&
        hostApiState.maximumSamplingState.output === '1000' &&
        hostApiState.maximumSamplingState.outputWidth ===
          hostApiState.mobileSamplingOutputWidth &&
        hostApiState.pointerDown === true &&
        hostApiState.pointerMove === true &&
        hostApiState.pointerCancel === true &&
        hostApiState.calls.join(',') ===
          'boom,clearTrail,clear,setFxParams',
      '宿主控制 API 没有完整映射到公开实例方法或持久化配置',
      hostApiState,
    );

    await page.locator('#panelClose').click();
    await page.locator('#langToggle').click();
    await page.waitForFunction(
      () => document.getElementById('langToggle')?.textContent === '中文',
    );
    const english = await page.evaluate(() =>
    {
      const title = (id) => document.getElementById(id)?.textContent;

      return {
        sectionShards: title('sectionShardsHeading'),
        clickSummary: title('clickShardsSummary'),
        bloomSummary: title('bloomPipelineSummary'),
        inputSamplingLabel: document.getElementById('ctrlInputSamplingRate')
          ?.closest('label')?.querySelector('span')?.childNodes[0]
          ?.textContent?.trim(),
        inputSamplingOutput: title('outInputSamplingRate'),
        mobileTouchFaqText:
          document.getElementById('introFAQContent')?.textContent ?? '',
        themeColorModeLabel: document.getElementById('ctrlThemeColorMode')
          ?.closest('label')?.querySelector('span')?.textContent?.trim(),
        themeColorModeOptions: Array.from(
          document.querySelectorAll('#ctrlThemeColorMode option'),
        ).map((option) => option.textContent),
        touchActionOptions: Array.from(
          document.querySelectorAll('#ctrlTouchAction option'),
        ).map((option) =>
        ({
          value: option.value,
          text: option.textContent.trim(),
        })),
        themeBlueTitle: document.querySelector('.theme-btn[data-theme="蔚蓝"]')?.title,
        themeCustomTitle: document.querySelector('.theme-btn[data-theme="custom"]')?.title,
      };
    });
    assert(
      english.sectionShards === 'Shards' &&
        english.clickSummary === 'Click Shards' &&
        english.bloomSummary === 'Global Bloom' &&
        english.inputSamplingLabel === 'Input Sampling Rate Limit (Hz)' &&
        english.inputSamplingOutput === '30' &&
        english.themeColorModeLabel === 'Color Mapping' &&
        JSON.stringify(english.themeColorModeOptions) === JSON.stringify([
          'Relative OKLCH (Recommended)',
          'Hue Only (Compatible)',
        ]) &&
        JSON.stringify(english.touchActionOptions) === JSON.stringify([
          { value: 'auto', text: 'Auto' },
          { value: 'none', text: 'Disable Default Gestures' },
          { value: 'pan-x', text: 'Pan X Only' },
          { value: 'pan-y', text: 'Pan Y Only' },
          { value: 'pinch-zoom', text: 'Pinch Zoom Only' },
          { value: 'pan-x pinch-zoom', text: 'Pan X + Pinch Zoom' },
          { value: 'pan-y pinch-zoom', text: 'Pan Y + Pinch Zoom' },
          { value: 'manipulation', text: 'Manipulation' },
        ]) &&
        english.themeBlueTitle === 'Blue (Default)' &&
        english.themeCustomTitle === 'Custom',
      '控制面板新增分组或主题按钮缺少英文文案',
      english,
    );
    assert(
      english.mobileTouchFaqText.includes(
        'Why does dragging fail to leave a trail in a mobile browser',
      ) &&
        english.mobileTouchFaqText.includes(
          'Switch Touch Action to Disable Default Gestures',
        ) &&
        english.mobileTouchFaqText.includes('pointercancel'),
      '展示页英文 FAQ 没有说明移动端 Touch Action 切换',
      english,
    );

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() =>
    {
      const effect = window.BAClickFXDemo;

      return effect?.getConfig().inputSamplingRate === 30 &&
        document.getElementById('ctrlInputSamplingRate')?.value === '30' &&
        document.getElementById('outInputSamplingRate')?.textContent === '30' &&
        effect.getConfig().touchAction === 'pan-y pinch-zoom' &&
        effect.canvas.style.touchAction === 'pan-y pinch-zoom' &&
        document.getElementById('ctrlTouchAction')?.value ===
          'pan-y pinch-zoom' &&
        localStorage.getItem('bafx-ctrlTouchAction') === 'pan-y pinch-zoom';
    });
    const restoredInputSamplingRate = await page.evaluate(() =>
      localStorage.getItem('bafx-ctrlInputSamplingRate'));
    const restoredTouchAction = await page.evaluate(() =>
    ({
      config: window.BAClickFXDemo.getConfig().touchAction,
      control: document.getElementById('ctrlTouchAction').value,
      style: window.BAClickFXDemo.canvas.style.touchAction,
      stored: localStorage.getItem('bafx-ctrlTouchAction'),
    }));

    await page.evaluate(() => document.getElementById('btnReset').click());
    await page.waitForFunction(() =>
    {
      const effect = window.BAClickFXDemo;

      return effect?.getConfig().inputSamplingRate === 0 &&
        document.getElementById('ctrlInputSamplingRate')?.value === '0' &&
        document.getElementById('outInputSamplingRate')?.textContent === '0' &&
        localStorage.getItem('bafx-ctrlInputSamplingRate') === null &&
        effect.getConfig().touchAction === 'auto' &&
        effect.canvas.style.touchAction === 'auto' &&
        document.getElementById('ctrlTouchAction')?.value === 'auto' &&
        localStorage.getItem('bafx-ctrlTouchAction') === null;
    });
    const resetInputSamplingRate = await page.evaluate(() =>
    ({
      config: window.BAClickFXDemo.getConfig().inputSamplingRate,
      control: document.getElementById('ctrlInputSamplingRate').value,
      stored: localStorage.getItem('bafx-ctrlInputSamplingRate'),
    }));
    const resetTouchAction = await page.evaluate(() =>
    ({
      config: window.BAClickFXDemo.getConfig().touchAction,
      control: document.getElementById('ctrlTouchAction').value,
      style: window.BAClickFXDemo.canvas.style.touchAction,
      stored: localStorage.getItem('bafx-ctrlTouchAction'),
    }));

    assert(
      restoredInputSamplingRate === '30' &&
        resetInputSamplingRate.config === 0 &&
        resetInputSamplingRate.control === '0' &&
        resetInputSamplingRate.stored === null,
      '输入采样率没有跨刷新恢复或随重置恢复不限频',
      { restoredInputSamplingRate, resetInputSamplingRate },
    );
    assert(
      Object.values(restoredTouchAction).every(
        (value) => value === 'pan-y pinch-zoom',
      ) &&
        resetTouchAction.config === 'auto' &&
        resetTouchAction.control === 'auto' &&
        resetTouchAction.style === 'auto' &&
        resetTouchAction.stored === null,
      '组合触摸行为没有跨刷新恢复或随重置恢复自动模式',
      { restoredTouchAction, resetTouchAction },
    );
    metrics.demoControlPanelStructure =
    {
      structure,
      changed,
      restored,
      reset,
      advancedChanged,
      themeModeLifecycle,
      hostApiState,
      english,
      restoredInputSamplingRate,
      resetInputSamplingRate,
      restoredTouchAction,
      resetTouchAction,
    };
  }
  finally
  {
    await context.close();
    currentPage = null;
  }
}

async function runDemoBackgroundFileSmoke(browserInstance, baseUrl)
{
  currentLabel = 'demo-local-background-file';
  const context = await browserInstance.newContext(
    {
      colorScheme: 'dark',
      deviceScaleFactor: 1,
      viewport:
      {
        width: 1024,
        height: 768,
      },
    },
  );
  const page = await context.newPage();

  try
  {
    await page.addInitScript(() =>
    {
      const revokeObjectUrl = URL.revokeObjectURL.bind(URL);
      const imageSource = Object.getOwnPropertyDescriptor(
        HTMLImageElement.prototype,
        'src',
      );

      window.__BACLICKFX_REVOKED_OBJECT_URLS__ = [];
      window.__BACLICKFX_ASSIGNED_IMAGE_URLS__ = [];
      URL.revokeObjectURL = (url) =>
      {
        window.__BACLICKFX_REVOKED_OBJECT_URLS__.push(url);
        return revokeObjectUrl(url);
      };

      if (imageSource?.get && imageSource.set)
      {
        Object.defineProperty(HTMLImageElement.prototype, 'src',
          {
            configurable: true,
            enumerable: imageSource.enumerable,
            get: imageSource.get,
            set(value)
            {
              window.__BACLICKFX_ASSIGNED_IMAGE_URLS__.push(String(value));
              return imageSource.set.call(this, value);
            },
          });
      }
    });
    currentPage = page;
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(
      () =>
        typeof window.BAClickFXDemo?.setCompositingReference === 'function',
    );

    // 使用可上传到 WebGL 的完整 RGBA PNG，避免损坏的极小测试图片把
    // File/Object URL 路径误判为纹理上传失败。
    const localImage =
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGUlEQVR4nGOw7///nxLMMGrAqAGjBgwXAwBhM8wfgy2drAAAAABJRU5ErkJggg==';
    await page.locator('#panelToggle').click();
    await page.locator('.theme-btn[data-theme="custom"]').click();
    // 展示页接受 file: 并把读取与纹理上传权限交给宿主；标准网页会拒绝读取，
    // 随后由文件选择器生成 blob:，不需要文件协议或 CORS 特权。
    const typedFileUrl = 'file:///C:/BAClickFX/demo-background.png';
    await page.locator('#ctrlCustomBg').fill(typedFileUrl);
    await page.locator('#btnApplyBg').click();
    await page.waitForFunction(
      (url) => document.body.style.background.includes(url),
      typedFileUrl,
    );
    await page.waitForFunction(
      (url) => window.__BACLICKFX_ASSIGNED_IMAGE_URLS__.includes(url),
      typedFileUrl,
    );
    const typedFileBackground = await page.evaluate(() =>
    {
      const input = document.getElementById('ctrlCustomBg');

      return {
        imageRequested:
          window.__BACLICKFX_ASSIGNED_IMAGE_URLS__.includes(input?.value ?? ''),
        inputValue: input?.value ?? '',
        background: document.body.style.background,
      };
    });

    assert(
      typedFileBackground.inputValue === typedFileUrl &&
        typedFileBackground.background.includes(typedFileUrl) &&
        typedFileBackground.imageRequested,
      '展示页拒绝了自定义 file:// 背景 URL',
      typedFileBackground,
    );
    await page.locator('#ctrlCustomBgFile').setInputFiles(
      {
        name: 'demo-background.png',
        mimeType: 'image/png',
        buffer: Buffer.from(localImage, 'base64'),
      },
    );
    await page.waitForFunction(
      () =>
      {
        const source = window.BAClickFXDemo?.compositingReferenceSource;

        return source instanceof HTMLImageElement &&
          source.src.startsWith('blob:') &&
          source.naturalWidth > 0 &&
          source.naturalHeight > 0;
      },
    );
    const firstBackground = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;
      const source = effect.compositingReferenceSource;

      return (
        {
          controlValue:
            document.getElementById('ctrlCompositingReference').value,
          cssContainsSource: document.body.style.background.includes(source.src),
          referenceFit: effect.compositingReferenceFit,
          referenceMatchesPage:
            effect.compositingReferenceSource === source,
          compositingReferenceMatchedClass:
            document.body.classList.contains('compositing-reference-matched'),
          sourceUrl: source.src,
          cssBackground: document.body.style.background,
        }
      );
    });

    assert(
      firstBackground.cssContainsSource &&
        firstBackground.referenceFit === 'cover' &&
        firstBackground.referenceMatchesPage &&
        firstBackground.controlValue === 'match-page' &&
        firstBackground.compositingReferenceMatchedClass === true,
      '展示页本地图片没有默认匹配页面合成参考',
      firstBackground,
    );

    await page.locator('#ctrlCompositingReference').selectOption('unknown');
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.compositingReferenceSource === null &&
          document.getElementById('ctrlCompositingReference').value ===
            'unknown' &&
          localStorage.getItem('bafx-ctrlCompositingReference') === 'unknown';
      },
    );
    const unknownBackground = await page.evaluate(() =>
      ({
        compositingReferenceMatchedClass:
          document.body.classList.contains('compositing-reference-matched'),
        cssBackground: document.body.style.background,
        sourceCleared: window.BAClickFXDemo.compositingReferenceSource === null,
      }),
    );

    assert(
      unknownBackground.sourceCleared &&
        !unknownBackground.compositingReferenceMatchedClass &&
        unknownBackground.cssBackground === firstBackground.cssBackground,
      '未知背景模式没有清除合成参考，或错误改变了 CSS 页面背景',
      { firstBackground, unknownBackground },
    );

    await page.locator('#ctrlCompositingReference').selectOption('match-page');
    await page.waitForFunction(
      (sourceUrl) =>
      {
        const effect = window.BAClickFXDemo;
        const source = effect.compositingReferenceSource;

        return source instanceof HTMLImageElement &&
          source.src === sourceUrl &&
          document.getElementById('ctrlCompositingReference').value ===
            'match-page' &&
          localStorage.getItem('bafx-ctrlCompositingReference') ===
            'match-page';
      },
      firstBackground.sourceUrl,
    );
    const restoredMatchedBackground = await page.evaluate(() =>
      ({
        compositingReferenceMatchedClass:
          document.body.classList.contains('compositing-reference-matched'),
        cssBackground: document.body.style.background,
        sourceUrl: window.BAClickFXDemo.compositingReferenceSource?.src ?? null,
      }),
    );

    assert(
      restoredMatchedBackground.compositingReferenceMatchedClass &&
        restoredMatchedBackground.sourceUrl === firstBackground.sourceUrl &&
        restoredMatchedBackground.cssBackground === firstBackground.cssBackground,
      '匹配页面模式没有恢复同一张页面合成参考',
      { firstBackground, restoredMatchedBackground },
    );

    await page.locator('.theme-btn[data-theme="深紫"]').click();
    await page.waitForFunction(
      (sourceUrl) =>
        !document.body.style.background.includes(sourceUrl),
      firstBackground.sourceUrl,
    );
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.compositingReferenceSource instanceof HTMLCanvasElement &&
          document.getElementById('ctrlCompositingReference').value ===
            'match-page';
      },
    );
    const retainedOnThemeChange = await page.evaluate(
      (sourceUrl) =>
        !window.__BACLICKFX_REVOKED_OBJECT_URLS__.includes(sourceUrl) &&
          document.getElementById('ctrlCustomBg').value === sourceUrl,
      firstBackground.sourceUrl,
    );

    await page.locator('.theme-btn[data-theme="custom"]').click();
    await page.locator('#btnApplyBg').click();
    await page.waitForFunction(
      (sourceUrl) =>
      {
        const effect = window.BAClickFXDemo;
        const source = effect?.compositingReferenceSource;

        return source instanceof HTMLImageElement &&
          source.src === sourceUrl &&
          document.body.style.background.includes(sourceUrl) &&
          document.body.classList.contains('compositing-reference-matched');
      },
      firstBackground.sourceUrl,
    );
    const reappliedBackground = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;

      return {
        background: document.body.style.background,
        referenceSource: effect.compositingReferenceSource?.src ?? null,
        sourceKnown: effect.compositingReferenceSource !== null,
        matched:
          document.body.classList.contains('compositing-reference-matched'),
      };
    });

    assert(
      reappliedBackground.sourceKnown &&
        reappliedBackground.matched &&
        reappliedBackground.referenceSource === firstBackground.sourceUrl &&
        reappliedBackground.background.includes(firstBackground.sourceUrl),
      '本地图片经过预设主题往返后无法再次建立匹配页面的合成参考',
      { firstBackground, reappliedBackground },
    );

    await page.locator('#ctrlCustomBgFile').setInputFiles(
      {
        name: 'demo-background-reload.png',
        mimeType: 'image/png',
        buffer: Buffer.from(localImage, 'base64'),
      },
    );
    await page.waitForFunction(
      (sourceUrl) =>
        window.__BACLICKFX_REVOKED_OBJECT_URLS__.includes(sourceUrl),
      firstBackground.sourceUrl,
    );
    const releasedOnReplacement = await page.evaluate(
      (sourceUrl) =>
        window.__BACLICKFX_REVOKED_OBJECT_URLS__.includes(sourceUrl),
      firstBackground.sourceUrl,
    );
    await page.waitForFunction(
      () =>
        window.BAClickFXDemo?.compositingReferenceSource instanceof
          HTMLImageElement &&
        window.BAClickFXDemo.compositingReferenceSource.src.startsWith('blob:') &&
        document.getElementById('ctrlCompositingReference').value ===
          'match-page',
    );
    await page.locator('#ctrlCompositingReference').selectOption('unknown');
    await page.waitForFunction(
      () =>
        window.BAClickFXDemo?.compositingReferenceSource === null &&
        document.getElementById('ctrlCompositingReference').value ===
          'unknown' &&
        localStorage.getItem('bafx-ctrlCompositingReference') === 'unknown',
    );
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () =>
        typeof window.BAClickFXDemo?.setCompositingReference === 'function',
    );
    const restoredBackground = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;

      return (
        {
          cssContainsBlob: document.body.style.background.includes('blob:'),
          controlValue:
            document.getElementById('ctrlCompositingReference').value,
          sourceCleared: effect.compositingReferenceSource === null,
          referenceStorage:
            localStorage.getItem('bafx-ctrlCompositingReference'),
        }
      );
    });

    assert(
      retainedOnThemeChange,
      '展示页切换预设主题时提前撤销了仍可重新应用的本地图片 object URL',
      firstBackground,
    );
    assert(
      releasedOnReplacement,
      '展示页替换本地图片后没有释放旧的 object URL',
      firstBackground,
    );
    assert(
      !restoredBackground.cssContainsBlob &&
        restoredBackground.sourceCleared &&
        restoredBackground.controlValue === 'unknown' &&
        restoredBackground.referenceStorage === 'unknown',
      '展示页刷新后恢复了失效的本地图片 blob URL 或丢失未知背景偏好',
      restoredBackground,
    );
    metrics.demoBackgroundFile =
    {
      retainedOnThemeChange,
      releasedOnReplacement,
      firstBackground,
      unknownBackground,
      reappliedBackground,
      restoredMatchedBackground,
      restoredBackground,
      typedFileBackground,
    };
  }
  finally
  {
    await context.close();
    currentPage = null;
  }
}

async function runDemoPureWhiteIsolationSmoke(browserInstance, baseUrl)
{
  currentLabel = 'demo-pure-white-isolation';
  const context = await browserInstance.newContext(
    {
      colorScheme: 'light',
      deviceScaleFactor: 1,
      viewport:
      {
        width: 1024,
        height: 768,
      },
    },
  );
  const page = await context.newPage();

  try
  {
    currentPage = page;
    await page.goto(baseUrl, { waitUntil: 'load' });
    await page.waitForFunction(
      () => typeof window.BAClickFXDemo?.boom === 'function',
    );
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.compositingReferenceSource instanceof HTMLCanvasElement &&
          document.getElementById('ctrlCompositingReference').value ===
            'match-page' &&
          localStorage.getItem('bafx-ctrlCompositingReference') === null;
      },
    );
    const automaticDefaultReference = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;

      return {
        controlValue:
          document.getElementById('ctrlCompositingReference').value,
        sourceIsCanvas:
          effect.compositingReferenceSource instanceof HTMLCanvasElement,
      };
    });
    await page.locator('#panelToggle').click();
    await page.locator('.theme-btn[data-theme="纯白"]').click();
    await page.locator('#ctrlIsolatedCompositing + .toggle-track').click();
    await page.waitForFunction(
      () =>
      {
        const config = window.BAClickFXDemo?.getConfig();

        return document.body.classList.contains('theme-pure-white') &&
          config?.isolatedCompositing === true &&
          config.lightBackgroundContrastAlpha === 0.35 &&
          window.BAClickFXDemo.compositingReferenceSource instanceof
            HTMLCanvasElement &&
          document.getElementById('ctrlCompositingReference').value ===
            'match-page';
      },
    );
    await page.evaluate(async () =>
    {
      window.dispatchEvent(new Event('resize'));

      // 主题参考同步通过 RAF 合并 resize；等待两帧才能覆盖延迟重传路径。
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await page.waitForFunction(
      () =>
        window.BAClickFXDemo.compositingReferenceSource instanceof
          HTMLCanvasElement &&
        document.getElementById('ctrlCompositingReference').value ===
          'match-page',
    );

    const modeSamples = {};
    const screenshotClip =
    {
      x: 220,
      y: 180,
      width: 300,
      height: 300,
    };
    const modes = ['full-webgl2', 'webgl2-bloom', 'native-bloom'];

    for (let modeIndex = 0; modeIndex < modes.length; modeIndex++)
    {
      const mode = modes[modeIndex];

      currentLabel = `demo-pure-white-isolation-${mode}`;

      if (modeIndex > 0)
      {
        await page.locator('#panelToggle').click();
      }

      await page.locator('#ctrlRenderMode').selectOption(mode);
      await page.locator('#panelClose').click();
      await page.waitForFunction(
        () => !document.getElementById('panelOverlay').classList.contains('open'),
      );
      await page.evaluate(async () =>
      {
        const effect = window.BAClickFXDemo;

        effect.setPaused(false);
        effect.clear();

        for (let frame = 0; frame < 2; frame++)
        {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
      });
      const beforeScreenshot = await page.screenshot(
        {
          animations: 'disabled',
          clip: screenshotClip,
          type: 'png',
        },
      );
      const sample = await page.evaluate(async () =>
      {
        const effect = window.BAClickFXDemo;

        effect.boom(370, 330);

        // boom() 会先登记引擎 RAF，因此探针 RAF 返回时首个完整帧已经提交。
        // 不跨越更多帧：软件 WebGL 首帧较慢时，额外 RAF 的真实时间可能
        // 已超过 600–700ms 的 Unity 粒子寿命，反而会把有效遮罩等到清空。
        await new Promise((resolve) => requestAnimationFrame(resolve));

        const image = effect.contrastContext.getImageData(
          0,
          0,
          effect.contrastCanvas.width,
          effect.contrastCanvas.height,
        );
        let alphaSum = 0;
        let maximumAlpha = 0;
        let minimumX = image.width;
        let minimumY = image.height;
        let maximumX = -1;
        let maximumY = -1;

        for (let offset = 3; offset < image.data.length; offset += 4)
        {
          const alpha = image.data[offset];

          alphaSum += alpha;
          maximumAlpha = Math.max(maximumAlpha, alpha);

          if (alpha > 0)
          {
            const pixelIndex = (offset - 3) / 4;
            const x = pixelIndex % image.width;
            const y = Math.floor(pixelIndex / image.width);

            minimumX = Math.min(minimumX, x);
            minimumY = Math.min(minimumY, y);
            maximumX = Math.max(maximumX, x);
            maximumY = Math.max(maximumY, y);
          }
        }

        const result = {
          alphaSum,
          canvasSceneVisible: effect.canvasSceneVisible,
          compositingReferenceMode:
            document.getElementById('ctrlCompositingReference').value,
          compositingReferenceMatchesPage:
            effect.compositingReferenceSource instanceof HTMLCanvasElement,
          config: effect.getConfig(),
          contrastDisplay: getComputedStyle(effect.contrastCanvas).display,
          contrastVisibility:
            getComputedStyle(effect.contrastCanvas).visibility,
          contrastBounds:
          {
            maximumX,
            maximumY,
            minimumX,
            minimumY,
          },
          contrastRect: effect.contrastCanvas.getBoundingClientRect().toJSON(),
          contrastZIndex: Number.parseInt(
            getComputedStyle(effect.contrastCanvas).zIndex,
            10,
          ),
          canvasSceneZIndex: effect.canvasSceneCanvas
            ? Number.parseInt(
              getComputedStyle(effect.canvasSceneCanvas).zIndex,
              10,
            )
            : null,
          maximumAlpha,
        };

        // 截图编码可能跨过完整生命周期；冻结当前已渲染帧后再比较。
        effect.setPaused(true, { clear: false });
        return result;
      });
      const afterScreenshot = await page.screenshot(
        {
          animations: 'disabled',
          clip: screenshotClip,
          type: 'png',
        },
      );
      const visualDifference = await compareScreenshotBuffers(
        page,
        beforeScreenshot,
        afterScreenshot,
      );

      assert(
        sample.config.outputCompositing === 'scene' &&
          sample.config.isolatedCompositing === true &&
          sample.config.lightBackgroundContrastAlpha === 0.35 &&
          sample.compositingReferenceMode === 'match-page' &&
          sample.compositingReferenceMatchesPage,
        `${mode}: 展示页没有保持纯白隔离的对比层配置`,
        sample,
      );
      assert(
        mode === 'full-webgl2'
          ? sample.config.resolvedEffectBackend === 'webgl2'
          : mode === 'webgl2-bloom'
            ? sample.config.resolvedBloomBackend === 'webgl2'
            : sample.config.resolvedBloomBackend === 'native' &&
              sample.canvasSceneVisible === true,
        `${mode}: 纯白隔离回归没有走到目标成功路径`,
        sample,
      );
      assert(
        sample.alphaSum > 0 &&
          sample.maximumAlpha > 0 &&
          sample.contrastDisplay !== 'none' &&
          sample.contrastVisibility !== 'hidden',
        `${mode}: 纯白隔离场景没有生成可见对比遮罩`,
        sample,
      );
      assert(
        visualDifference.changedPixels >= 8 &&
          visualDifference.redDropSum > 0 &&
          visualDifference.maximumRedDrop >= 4,
        `${mode}: 纯白页面截图中点击特效仍然不可见`,
        { sample, visualDifference },
      );
      if (mode === 'native-bloom')
      {
        assert(
          Number.isFinite(sample.canvasSceneZIndex) &&
            sample.contrastZIndex > sample.canvasSceneZIndex,
          'Canvas Scene Final Pass 覆盖了纯白隔离对比层',
          sample,
        );
      }
      modeSamples[mode] =
      {
        ...sample,
        visualDifference,
      };
    }

    await page.locator('#panelToggle').click();
    await page.locator('#ctrlIsolatedCompositing + .toggle-track').click();
    await page.waitForFunction(() =>
    {
      const config = window.BAClickFXDemo.getConfig();

      return config.isolatedCompositing === false &&
        config.lightBackgroundContrastAlpha === 0;
    });
    const disabledContrastAlpha = await page.evaluate(
      () => window.BAClickFXDemo.getConfig().lightBackgroundContrastAlpha,
    );

    await page.locator('#ctrlIsolatedCompositing + .toggle-track').click();
    await page.waitForFunction(
      () =>
      {
        const config = window.BAClickFXDemo.getConfig();

        return config.isolatedCompositing === true &&
          config.lightBackgroundContrastAlpha === 0.35;
      },
    );

    await page.locator('.theme-btn[data-theme="深紫"]').click();
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.compositingReferenceSource instanceof HTMLCanvasElement &&
          document.getElementById('ctrlCompositingReference').value ===
            'match-page' &&
          localStorage.getItem('bafx-ctrlCompositingReference') === null;
      },
    );
    const automaticNonWhiteReference = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;

      return {
        controlValue:
          document.getElementById('ctrlCompositingReference').value,
        sourceIsCanvas:
          effect.compositingReferenceSource instanceof HTMLCanvasElement,
      };
    });

    await page.locator('.theme-btn[data-theme="纯白"]').click();
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.compositingReferenceSource instanceof HTMLCanvasElement &&
          document.getElementById('ctrlCompositingReference').value ===
            'match-page' &&
          localStorage.getItem('bafx-ctrlCompositingReference') === null;
      },
    );
    const automaticPureWhiteReference = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;

      return {
        controlValue:
          document.getElementById('ctrlCompositingReference').value,
        sourceIsCanvas:
          effect.compositingReferenceSource instanceof HTMLCanvasElement,
      };
    });

    await page.locator('#ctrlOutputCompositing').selectOption(
      'browser-overlay',
    );
    const matchedPureWhiteBackground = await page.evaluate(
      () => document.body.style.background,
    );
    await page.locator('#ctrlCompositingReference').selectOption('unknown');
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.getConfig().outputCompositing === 'browser-overlay' &&
          effect.compositingReferenceSource === null &&
          document.getElementById('ctrlCompositingReference').value ===
            'unknown' &&
          localStorage.getItem('bafx-ctrlCompositingReference') === 'unknown';
      },
    );
    const unknownPureWhiteReference = await page.evaluate(() =>
      ({
        cssBackground: document.body.style.background,
        sourceCleared: window.BAClickFXDemo.compositingReferenceSource === null,
      }),
    );

    assert(
      unknownPureWhiteReference.sourceCleared &&
        unknownPureWhiteReference.cssBackground === matchedPureWhiteBackground,
      '纯白未知背景模式错误改变了页面背景，或没有清除合成参考',
      { matchedPureWhiteBackground, unknownPureWhiteReference },
    );

    await page.locator('.theme-btn[data-theme="深紫"]').click();
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.getConfig().lightBackgroundContrastAlpha === 0 &&
          effect.compositingReferenceSource === null &&
          document.getElementById('ctrlCompositingReference').value ===
            'unknown';
      },
    );
    const resetContrastAlpha = await page.evaluate(
      () => window.BAClickFXDemo.getConfig().lightBackgroundContrastAlpha,
    );

    assert(
      resetContrastAlpha === 0,
      '离开纯白主题后展示页没有清除隔离对比遮罩',
      { resetContrastAlpha },
    );

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return document.body.classList.contains('theme-pure-white') === false &&
          effect.compositingReferenceSource === null &&
          document.getElementById('ctrlCompositingReference').value ===
            'unknown' &&
          localStorage.getItem('bafx-ctrlCompositingReference') === 'unknown';
      },
    );
    const restoredUnknownReference = await page.evaluate(() =>
      ({
        controlValue:
          document.getElementById('ctrlCompositingReference').value,
        sourceCleared: window.BAClickFXDemo.compositingReferenceSource === null,
      }),
    );

    await page.locator('#panelToggle').click();
    await page.locator('.theme-btn[data-theme="纯白"]').click();
    await page.waitForFunction(
      () =>
      {
        const config = window.BAClickFXDemo.getConfig();

        return config.isolatedCompositing === true &&
          config.lightBackgroundContrastAlpha === 0.35 &&
          window.BAClickFXDemo.compositingReferenceSource === null &&
          document.getElementById('ctrlCompositingReference').value ===
            'unknown';
      },
    );

    await page.locator('#ctrlCompositingReference').selectOption('match-page');
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.compositingReferenceSource instanceof HTMLCanvasElement &&
          document.getElementById('ctrlCompositingReference').value ===
            'match-page' &&
          localStorage.getItem('bafx-ctrlCompositingReference') ===
            'match-page';
      },
    );
    const restoredMatchedPureWhiteReference = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;

      return {
        controlValue:
          document.getElementById('ctrlCompositingReference').value,
        sourceIsCanvas:
          effect.compositingReferenceSource instanceof HTMLCanvasElement,
      };
    });

    await page.locator('.theme-btn[data-theme="深紫"]').click();
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.compositingReferenceSource instanceof HTMLCanvasElement &&
          document.getElementById('ctrlCompositingReference').value ===
            'match-page';
      },
    );
    const matchedNonWhiteReference = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;

      return {
        controlValue:
          document.getElementById('ctrlCompositingReference').value,
        sourceIsCanvas:
          effect.compositingReferenceSource instanceof HTMLCanvasElement,
      };
    });

    await page.locator('.theme-btn[data-theme="纯白"]').click();
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.compositingReferenceSource instanceof HTMLCanvasElement &&
          document.getElementById('ctrlCompositingReference').value ===
            'match-page';
      },
    );

    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() =>
    {
      const config = window.BAClickFXDemo?.getConfig();

      return document.body.classList.contains('theme-pure-white') &&
        config?.isolatedCompositing === true &&
        config.lightBackgroundContrastAlpha === 0.35 &&
        window.BAClickFXDemo.compositingReferenceSource instanceof
          HTMLCanvasElement &&
        document.getElementById('ctrlCompositingReference').value ===
          'match-page' &&
        localStorage.getItem('bafx-ctrlCompositingReference') === 'match-page';
    });
    const restoredContrastAlpha = await page.evaluate(
      () => window.BAClickFXDemo.getConfig().lightBackgroundContrastAlpha,
    );

    await page.locator('#panelToggle').click();
    await page.locator('.theme-btn[data-theme="深紫"]').click();
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.compositingReferenceSource instanceof HTMLCanvasElement &&
          document.getElementById('ctrlCompositingReference').value ===
            'match-page' &&
          localStorage.getItem('bafx-ctrlCompositingReference') ===
            'match-page';
      },
    );
    const restoredMatchedNonWhiteReference = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;

      return {
        controlValue:
          document.getElementById('ctrlCompositingReference').value,
        sourceIsCanvas:
          effect.compositingReferenceSource instanceof HTMLCanvasElement,
      };
    });

    await page.locator('#btnReset').click();
    await page.waitForFunction(
      () =>
      {
        const effect = window.BAClickFXDemo;

        return effect.compositingReferenceSource instanceof HTMLCanvasElement &&
          document.getElementById('ctrlCompositingReference').value ===
            'match-page' &&
          localStorage.getItem('bafx-ctrlCompositingReference') === null;
      },
    );
    const resetAutomaticReference = await page.evaluate(() =>
    {
      const effect = window.BAClickFXDemo;

      return {
        controlValue:
          document.getElementById('ctrlCompositingReference').value,
        sourceIsCanvas:
          effect.compositingReferenceSource instanceof HTMLCanvasElement,
      };
    });

    assert(
      restoredContrastAlpha === 0.35,
      '刷新后没有恢复纯白主题的隔离对比轮廓',
      { restoredContrastAlpha },
    );
    metrics.demoPureWhiteIsolation =
    {
      automaticDefaultReference,
      automaticNonWhiteReference,
      automaticPureWhiteReference,
      disabledContrastAlpha,
      modeSamples,
      resetContrastAlpha,
      resetAutomaticReference,
      restoredMatchedNonWhiteReference,
      restoredMatchedPureWhiteReference,
      restoredContrastAlpha,
      restoredUnknownReference,
      unknownPureWhiteReference,
    };
  }
  finally
  {
    await context.close();
    currentPage = null;
  }
}

async function runTransparentCompositingTransitions(page, mode)
{
  const transition = (input) => page.evaluate(
    (specification) =>
      window.browserPixelSuite.transitionTransparentContract(specification),
    input,
  );
  const phases = {};

  phases.coverageZero = await page.evaluate(
    (specification) =>
      window.browserPixelSuite.beginTransparentContractTransitions(
        specification,
      ),
    {
      mode,
      opacity: 0,
      background: 'checker',
      includeTrail: false,
      overlayAlphaPolicy: 'coverage',
      // 观感 A/B 必须先移除额外容量瓶颈；0.7 上限由 Context 与失败链
      // 矩阵独立验证，否则两种策略都会先在高能核心饱和。
      overlayAlphaLimit: 1,
      overlayColorCompensation: 'none',
      hostCompositing: 'source-over',
      // Unity 默认 1.7 强度会让 Software 的全部 Scene 重叠区都饱和，
      // 此时 sum 与 max 数学上相同，无法观察 Alpha 策略是否真正生效。
      fxParams:
      {
        'bloom.intensity': 0.1,
      },
    },
  );
  phases.coverageHalf = await transition({ opacity: 0.5 });
  phases.coverageFull = await transition({ opacity: 1 });
  // opacity=1 与 0.7 Alpha 上限会让点击核心的 sum/max 同时饱和；
  // 在未饱和的半透明重叠区才能确实区分两种 Alpha 策略。
  const coverageWhiteHalf = await transition(
    {
      background: 'white',
      opacity: 0.5,
    },
  );
  const coverageWhiteScreenshot = await captureContrastScreenshot(page);

  const visualMaxWhiteHalf = await transition(
    {
      overlayAlphaPolicy: 'visual-max',
    },
  );
  const visualMaxWhiteScreenshot = await captureContrastScreenshot(page);
  const visualMaxDifference = await compareScreenshotBuffers(
    page,
    coverageWhiteScreenshot,
    visualMaxWhiteScreenshot,
  );
  const coverageWhite = await summarizeScreenshot(
    page,
    coverageWhiteScreenshot,
  );
  const visualMaxWhite = await summarizeScreenshot(
    page,
    visualMaxWhiteScreenshot,
  );
  const visualMaxImprovesWhite =
    visualMaxDifference.changedPixels >= 1 &&
    visualMaxDifference.maximumChannelIncrease >= 2 &&
    visualMaxDifference.maximumChannelDrop <= 1;

  assert(
    visualMaxImprovesWhite,
    `${mode}: visual-max 没有保持纯白背景透明合同`,
    {
      difference: visualMaxDifference,
      payload:
      {
        coverage: coverageWhiteHalf.pixels.transparent,
        visualMax: visualMaxWhiteHalf.pixels.transparent,
      },
      screenshot:
      {
        coverage: coverageWhite,
        visualMax: visualMaxWhite,
      },
    },
  );

  phases.visualMax = await transition({ opacity: 1 });
  const visualMaxFullWhiteScreenshot = await captureContrastScreenshot(page);

  phases.brightCore = await transition(
    {
      overlayColorCompensation: 'bright-core',
    },
  );
  const brightWhiteScreenshot = await captureContrastScreenshot(page);
  const brightDifference = await compareScreenshotBuffers(
    page,
    visualMaxFullWhiteScreenshot,
    brightWhiteScreenshot,
  );

  phases.additiveZero = await transition(
    {
      hostCompositing: 'screen',
      opacity: 0,
    },
  );
  const baselineScreenshots = {};
  const additiveScreenshots = {};

  for (const background of [
    'black',
    'white',
    'color',
    'light-color',
    'checker',
  ])
  {
    await transition({ background });
    baselineScreenshots[background] = await captureContrastScreenshot(page);
  }

  phases.additiveHalf = await transition(
    {
      background: 'black',
      opacity: 0.5,
    },
  );
  phases.additiveFull = await transition(
    {
      opacity: 1,
    },
  );

  for (const background of [
    'black',
    'white',
    'color',
    'light-color',
    'checker',
  ])
  {
    await transition({ background });
    additiveScreenshots[background] = await captureContrastScreenshot(page);
  }

  const hostAddDifferences = {};

  for (const background of [
    'black',
    'white',
    'color',
    'light-color',
    'checker',
  ])
  {
    const difference = await compareScreenshotBuffers(
      page,
      baselineScreenshots[background],
      additiveScreenshots[background],
    );

    assert(
      difference.maximumChannelDrop <= 1 &&
        difference.channelDropSum <= 4,
      `${mode}: Host Add 在 ${background} 背景压暗了宿主像素`,
      difference,
    );

    if (background !== 'white')
    {
      assert(
        difference.changedPixels >= 8 &&
          difference.maximumChannelIncrease >= 4,
        `${mode}: Host Add 在 ${background} 背景没有输出可见增量`,
        difference,
      );
    }

    hostAddDifferences[background] = difference;
  }

  assert(
    brightDifference.changedPixels >= 4 &&
      brightDifference.maximumChannelIncrease >= 2 &&
      brightDifference.maximumChannelDrop <= 1,
    `${mode}: bright-core 热切换没有改善纯白背景可见性`,
    brightDifference,
  );

  phases.roundTrip = await transition(
    {
      background: 'checker',
      hostCompositing: 'source-over',
      opacity: 1,
      overlayAlphaPolicy: 'coverage',
      overlayColorCompensation: 'none',
    },
  );
  validateTransparentContractTransitions(mode, phases);

  const trailCompensation = {};

  trailCompensation.none = await page.evaluate(
    (specification) =>
      window.browserPixelSuite.beginTransparentContractTransitions(
        specification,
      ),
    {
      mode,
      opacity: 1,
      background: 'transparent',
      includeClick: false,
      includeTrail: true,
      straightTrailProbe: true,
      overlayAlphaPolicy: 'visual-max',
      overlayAlphaLimit: 0.7,
      overlayColorCompensation: 'none',
      hostCompositing: 'source-over',
    },
  );
  trailCompensation.brightCore = await transition(
    {
      overlayColorCompensation: 'bright-core',
    },
  );
  validateBrightCoreTrailCompensation(mode, trailCompensation);

  return {
    brightDifference,
    brightWhite: await summarizeScreenshot(page, brightWhiteScreenshot),
    coverageWhite,
    hostAddDifferences,
    phases,
    trailCompensation,
    visualMaxDifference,
    visualMaxWhite,
    visualMaxFullWhite: await summarizeScreenshot(
      page,
      visualMaxFullWhiteScreenshot,
    ),
  };
}

async function runHostCompositingAccuracy(page)
{
  const begin = (input) => page.evaluate(
    (specification) =>
      window.browserPixelSuite.beginTransparentContractTransitions(
        specification,
      ),
    input,
  );
  const transition = (input) => page.evaluate(
    (specification) =>
      window.browserPixelSuite.transitionTransparentContract(specification),
    input,
  );
  const unknownZeroPhase = await begin(
    {
      mode: 'full-webgl2',
      opacity: 0,
      background: 'light-color',
      includeTrail: false,
      isolatedCompositing: true,
      overlayAlphaPolicy: 'coverage',
      overlayAlphaLimit: 1,
      overlayColorCompensation: 'none',
      hostCompositing: 'screen',
    },
  );
  const unknownZeroScreenshot = await captureContrastScreenshot(page);
  const knownZeroPhase = await page.evaluate(
    () => window.browserPixelSuite.setTransparentContractReference(
      'light-color',
    ),
  );
  const knownZeroScreenshot = await captureContrastScreenshot(page);
  const zeroReferenceMatch = await compareScreenshotBuffers(
    page,
    unknownZeroScreenshot,
    knownZeroScreenshot,
  );

  await page.evaluate(
    () => window.browserPixelSuite.setTransparentContractReference(null),
  );
  const screenPhase = await transition(
    {
      hostCompositing: 'screen',
      opacity: 1,
    },
  );
  const screenScreenshot = await captureContrastScreenshot(page);
  const plusLighterPhase = await transition(
    { hostCompositing: 'plus-lighter' },
  );
  const plusLighterScreenshot = await captureContrastScreenshot(page);
  const knownScenePhase = await page.evaluate(
    () => window.browserPixelSuite.setTransparentContractReference(
      'light-color',
    ),
  );
  const knownSceneScreenshot = await captureContrastScreenshot(page);
  const screenToScene = await compareScreenshotBuffers(
    page,
    knownSceneScreenshot,
    screenScreenshot,
  );
  const plusLighterToScene = await compareScreenshotBuffers(
    page,
    knownSceneScreenshot,
    plusLighterScreenshot,
  );
  const screenToPlusLighter = await compareScreenshotBuffers(
    page,
    screenScreenshot,
    plusLighterScreenshot,
  );
  const screenIncrement = await compareScreenshotBuffers(
    page,
    unknownZeroScreenshot,
    screenScreenshot,
  );
  const lifecycle = JSON.stringify(screenPhase.lifecycle);

  assert(
    unknownZeroPhase.config.opacity === 0 &&
      knownZeroPhase.config.opacity === 0 &&
      knownZeroPhase.reference.renderingActive &&
      zeroReferenceMatch.maximumChannelDelta <= 1 &&
      zeroReferenceMatch.target.meanAbsoluteRgbError <= 0.01,
    '已知 Scene 参考与 CSS 亮灰基线不匹配',
    {
      knownZero: knownZeroPhase,
      unknownZero: unknownZeroPhase,
      zeroReferenceMatch,
    },
  );
  assert(
    screenPhase.config.hostCompositing === 'screen' &&
      screenPhase.mount.overlayRootBlendMode === 'screen' &&
      screenPhase.route.effect === 'webgl2' &&
      !screenPhase.reference.sourceKnown &&
      !screenPhase.reference.renderingActive &&
      plusLighterPhase.config.hostCompositing === 'plus-lighter' &&
      plusLighterPhase.mount.overlayRootBlendMode === 'plus-lighter' &&
      !plusLighterPhase.reference.sourceKnown &&
      !plusLighterPhase.reference.renderingActive &&
      knownScenePhase.config.outputCompositing === 'scene' &&
      knownScenePhase.mount.overlayRootBlendMode === '' &&
      knownScenePhase.reference.active &&
      knownScenePhase.reference.renderingActive &&
      knownScenePhase.route.effect === 'webgl2' &&
      lifecycle === JSON.stringify(plusLighterPhase.lifecycle) &&
      lifecycle === JSON.stringify(knownScenePhase.lifecycle),
    '亮底三路对照没有保持同一帧或正确合成合同',
    {
      knownScene: knownScenePhase,
      plusLighter: plusLighterPhase,
      screen: screenPhase,
    },
  );
  assert(
    screenToPlusLighter.maximumChannelDrop <= 1 &&
      screenToPlusLighter.channelDropSum <= 4 &&
      screenToPlusLighter.maximumChannelIncrease >= 8 &&
      screenToPlusLighter.target.rightWhiteCorePixels >=
        screenToPlusLighter.target.leftWhiteCorePixels * 2,
    'Screen 没有抑制 plus-lighter 在亮底上的额外饱和',
    screenToPlusLighter,
  );
  assert(
    screenToScene.rgbAbsoluteDeltaSum <
      plusLighterToScene.rgbAbsoluteDeltaSum * 0.4 &&
      screenToScene.meanAbsoluteRgbError <
        plusLighterToScene.meanAbsoluteRgbError * 0.4 &&
      screenToScene.target.meanAbsoluteRgbError <= 0.35,
    'Screen 在亮底上没有比 plus-lighter 更接近 Unity 已知 Scene',
    {
      plusLighterToScene,
      screenToScene,
    },
  );
  assert(
    screenIncrement.target.meanPositiveRgbDelta >= 0.55 &&
      screenIncrement.target.meanPositiveRgbDelta <= 0.85 &&
      screenIncrement.target.highDeltaPixels >= 500 &&
      screenIncrement.target.highDeltaPixels <= 700 &&
      screenIncrement.target.rightWhiteCorePixels >= 60 &&
      screenIncrement.target.rightWhiteCorePixels <= 130 &&
      screenIncrement.target.rightSaturatedPixels >= 400 &&
      screenIncrement.target.rightSaturatedPixels <= 560,
    'Screen 亮底输出偏离已验收的强度与饱和面积',
    screenIncrement.target,
  );

  return {
    knownZero: await summarizeScreenshot(page, knownZeroScreenshot),
    knownScene: await summarizeScreenshot(page, knownSceneScreenshot),
    plusLighter: await summarizeScreenshot(page, plusLighterScreenshot),
    plusLighterToScene,
    screen: await summarizeScreenshot(page, screenScreenshot),
    screenIncrement,
    screenToPlusLighter,
    screenToScene,
    unknownZero: await summarizeScreenshot(page, unknownZeroScreenshot),
    zeroReferenceMatch,
  };
}

async function runMatrix(browserInstance, baseUrl, baseline)
{
  const caseResults = new Map();
  const calibration =
  {
    schemaVersion: 1,
    source: [
      'Microsoft Edge/Chromium fixed-time implementation regression;',
      'inputs follow the audited Unity FX_Touch contract; no source assets',
    ].join(' '),
    fixture:
    {
      width: 320,
      height: 240,
      sampleTimeMs: 120,
      randomSeed: '0x04ba5f17',
    },
    tolerances: baseline?.tolerances ??
    {
      default: 0.015,
      meanAlpha: 0.004,
      meanEnergy: 0.006,
      visibleRatio: 0.012,
      maximumAlpha: 0.03,
      centerAlpha: 0.03,
      centerChannel: 0.05,
      radialAlpha: 0.05,
      boundsCssPixels: 3,
    },
    modes: {},
  };

  for (const dpr of devicePixelRatios)
  {
    currentLabel = `fixture-startup-dpr-${dpr}`;
    const session = await openFixture(browserInstance, baseUrl, dpr);
    const page = session.page;

    currentPage = page;
    metrics.environment[`dpr${dpr}`] = session.capabilities;

    if (dpr === 2)
    {
      currentLabel = 'source-fullscreen-scrollbar-gutter';
      const fullscreenScrollbarGutter = await page.evaluate(
        () => window.browserPixelSuite.runFullscreenScrollbarGutterContract(),
      );

      validateFullscreenScrollbarGutter(fullscreenScrollbarGutter, dpr);
      metrics.fullscreenScrollbarGutter.source = fullscreenScrollbarGutter;
    }

    if (dpr === 1)
    {
      // 主题色映射与 DPR 无关；只跑一次便可在不扩大整体
      // 像素矩阵的前提下锁定三条实际后端管线。
      await runThemeColorContracts(page);
    }

    for (const mode of modeNames)
    {
      for (const isolatedCompositing of isolationModes)
      {
        const opacityResults = new Map();

        for (const opacity of opacities)
        {
          const specification =
          {
            mode,
            opacity,
            isolatedCompositing,
            background: 'checker',
            shadow: false,
            containStrict: false,
          };
          const label = [
            mode,
            `opacity-${opacity}`,
            isolatedCompositing ? 'isolated' : 'direct',
            `dpr-${dpr}`,
          ].join('__');

          currentLabel = label;
          const result = await page.evaluate(
            (input) => window.browserPixelSuite.runCase(input),
            specification,
          );

          validateBasicCase(result, dpr);
          opacityResults.set(opacity, result);
          caseResults.set(label, result);
          metrics.cases[label] = result;

          if (opacity === 1)
          {
            const compositor = await captureCompositorMetrics(page);

            assert(
              compositor.maximumEnergy > compositor.minimumEnergy,
              `${label}: Chromium 实际合成截图为空`,
              compositor,
            );
            metrics.compositor[label] = compositor;
          }
        }

        validateOpacityGroup(
          opacityResults,
          `${mode}/${isolatedCompositing ? 'isolated' : 'direct'}/dpr${dpr}`,
        );
      }

      const directLabel = `${mode}__opacity-1__direct__dpr-${dpr}`;
      const isolatedLabel = `${mode}__opacity-1__isolated__dpr-${dpr}`;

      validateIsolationPair(
        caseResults.get(directLabel),
        caseResults.get(isolatedLabel),
        `${mode}/dpr${dpr}`,
      );
      const directCompositor = metrics.compositor[directLabel];
      const isolatedCompositor = metrics.compositor[isolatedLabel];

      assert(
        relativeDifference(
          directCompositor.meanEnergy,
          isolatedCompositor.meanEnergy,
        ) <= 0.08,
        `${mode}/dpr${dpr}: 隔离开关改变了 Chromium 最终合成亮度`,
        {
          direct: directCompositor,
          isolated: isolatedCompositor,
        },
      );

      if (mode === 'native')
      {
        for (const variant of ['click-only', 'trail-only'])
        {
          const specification =
          {
            mode,
            opacity: 1,
            isolatedCompositing: true,
            background: 'checker',
            shadow: false,
            containStrict: false,
            includeClick: variant !== 'trail-only',
            includeTrail: variant !== 'click-only',
            // 320px 夹具中的 Unity 2.7px 带宽不足 1 CSS px；放大后再比较 DPR，
            // 避免把 DPR1 的单像素栅格取整误判为物理缩放回归。
            scale: variant === 'trail-only' ? 3 : 1,
          };
          const label = `${mode}__${variant}__isolated__dpr-${dpr}`;

          currentLabel = label;
          const result = await page.evaluate(
            (input) => window.browserPixelSuite.runCase(input),
            specification,
          );

          validateBasicCase(result, dpr);
          caseResults.set(label, result);
          metrics.cases[label] = result;
        }
      }
    }

    if (dpr === 1)
    {
      await runPrefabCountContracts(page);

      for (const mode of modeNames)
      {
        currentLabel = `${mode}__transparent-contract-transitions`;
        metrics.transparentCompositingTransitions[mode] =
          await runTransparentCompositingTransitions(page, mode);
      }

      currentLabel = 'full-webgl2__host-compositing-accuracy';
      metrics.hostCompositingAccuracy =
        await runHostCompositingAccuracy(page);

      for (const mode of modeNames)
      {
        const baselineLabel = `${mode}__opacity-1__isolated__dpr-1`;
        const baselineResult = caseResults.get(baselineLabel);
        const referenceSpecification =
        {
          mode,
          opacity: 1,
          isolatedCompositing: true,
          background: 'black',
          shadow: false,
          containStrict: false,
          includeTrail: false,
        };
        const referenceLabel =
          `${mode}__edge-regression-click-120ms__dpr-1`;

        currentLabel = referenceLabel;
        const referenceResult = await page.evaluate(
          (input) => window.browserPixelSuite.runCase(input),
          referenceSpecification,
        );

        validateBasicCase(referenceResult, 1);
        metrics.cases[referenceLabel] = referenceResult;
        const features = selectBaselineFeatures(referenceResult);

        calibration.modes[mode] = features;

        if (!calibrate)
        {
          assert(baseline?.modes?.[mode], `${mode}: 缺少数值特征基线`);
          validateBaseline(
            features,
            baseline.modes[mode],
            baseline.tolerances,
            mode,
          );
        }

        for (const background of ['black', 'white'])
        {
          const specification =
          {
            mode,
            opacity: 1,
            isolatedCompositing: true,
            background,
            shadow: false,
            containStrict: false,
          };
          const label = `${mode}__css-${background}__dpr-1`;

          currentLabel = label;
          await page.evaluate(
            (input) => window.browserPixelSuite.runCase(input),
            specification,
          );
          metrics.compositor[label] = await captureCompositorMetrics(page);
        }

        assert(
          metrics.compositor[`${mode}__css-black__dpr-1`].meanEnergy <
            metrics.compositor[`${mode}__css-white__dpr-1`].meanEnergy,
          `${mode}: Chromium 黑白 CSS 背景没有形成可检测差异`,
        );
        const blackCenter =
          metrics.compositor[`${mode}__css-black__dpr-1`].center;
        const whiteCenter =
          metrics.compositor[`${mode}__css-white__dpr-1`].center;
        const centerBackgroundDifference = blackCenter.slice(0, 3)
          .reduce((sum, channel, index) =>
            sum + Math.abs(channel - whiteCenter[index]), 0);

        assert(
          centerBackgroundDifference > 8,
          `${mode}: Chromium 最终合成中的点击中心完全遮挡背景`,
          {
            blackCenter,
            centerBackgroundDifference,
            whiteCenter,
          },
        );

        const shadowSpecification =
        {
          mode,
          opacity: 1,
          isolatedCompositing: true,
          background: 'checker',
          shadow: true,
          containStrict: true,
        };
        const shadowLabel = `${mode}__shadow-contain__dpr-1`;

        currentLabel = shadowLabel;
        const shadowResult = await page.evaluate(
          (input) => window.browserPixelSuite.runCase(input),
          shadowSpecification,
        );

        validateBasicCase(shadowResult, 1);
        assert(
          shadowResult.layout.insideShadowRoot &&
            shadowResult.layout.contain.includes('strict'),
          `${mode}: Shadow DOM + contain: strict 未实际生效`,
          shadowResult.layout,
        );
        validateIsolationPair(
          baselineResult,
          shadowResult,
          `${mode}/shadow-contain`,
        );
        metrics.cases[shadowLabel] = shadowResult;
        metrics.compositor[shadowLabel] = await captureCompositorMetrics(page);
      }

      const webGLTrailResults = new Map();

      for (const mode of ['full-webgl2', 'webgl2-bloom'])
      {
        const specification =
        {
          mode,
          opacity: 1,
          isolatedCompositing: true,
          background: 'transparent',
          shadow: false,
          containStrict: false,
          includeClick: false,
          includeTrail: true,
          includeTrailShards: false,
          straightTrailProbe: true,
          inspectTrailTexture: true,
          outputCompositing: 'scene',
          // 240px 高夹具需放大到约 38.4 CSS px，才能成对采样非对称边缘。
          scale: 64,
        };
        const label = `${mode}__straight-trail-probe__dpr-1`;

        currentLabel = label;
        const result = await page.evaluate(
          (input) => window.browserPixelSuite.runCase(input),
          specification,
        );

        webGLTrailResults.set(mode, result);
        metrics.cases[label] = result;
      }

      validateWebGLTrailPair(
        webGLTrailResults.get('full-webgl2'),
        webGLTrailResults.get('webgl2-bloom'),
      );

      for (const mode of ['full-webgl2', 'webgl2-bloom'])
      {
        currentLabel = `${mode}__straight-trail-probe__dpr-1`;
        validateWebGLTrailProbe(
          webGLTrailResults.get(mode),
          currentLabel,
        );
      }

      currentLabel = 'webgl2__straight-trail-v-direction__dpr-1';
      validateWebGLTrailDirections(
        webGLTrailResults.get('full-webgl2'),
        webGLTrailResults.get('webgl2-bloom'),
      );

      currentLabel = 'compositing-reference-reset';
      const compositingReferenceReset = await page.evaluate(
        () => window.browserPixelSuite.runCompositingReferenceReset(),
      );

      assert(
        compositingReferenceReset.referenceSet &&
          compositingReferenceReset.referenceCleared &&
          compositingReferenceReset.referenceRestored &&
          compositingReferenceReset.referenceClearedAgain,
        '合成参考设置、清除或恢复被拒绝',
        compositingReferenceReset,
      );
      assert(
        relativeDifference(
          compositingReferenceReset.beforeReference.meanEnergy,
          compositingReferenceReset.withReference.meanEnergy,
        ) > 0.1,
        'setCompositingReference() 没有改变可见合成结果',
        compositingReferenceReset,
      );
      assert(
        compositingReferenceReset.referenceClearedFromEffect &&
          compositingReferenceReset.referenceClearedAgainFromEffect &&
          relativeDifference(
            compositingReferenceReset.beforeReference.meanEnergy,
            compositingReferenceReset.withoutReference.meanEnergy,
          ) <= 0.01 &&
          relativeDifference(
            compositingReferenceReset.beforeReference.meanAlpha,
            compositingReferenceReset.withoutReference.meanAlpha,
          ) <= 0.01 &&
          relativeDifference(
            compositingReferenceReset.beforeReference.meanEnergy,
            compositingReferenceReset.withoutReferenceAgain.meanEnergy,
          ) <= 0.01 &&
          relativeDifference(
            compositingReferenceReset.beforeReference.meanAlpha,
            compositingReferenceReset.withoutReferenceAgain.meanAlpha,
          ) <= 0.01,
        'setCompositingReference(null) 没有原子清除合成参考并恢复透明输出',
        compositingReferenceReset,
      );
      assert(
        compositingReferenceReset.referenceRestoredInEffect &&
        relativeDifference(
          compositingReferenceReset.withReference.meanAlpha,
          compositingReferenceReset.restoredReference.meanAlpha,
        ) <= 0.01 &&
        relativeDifference(
          compositingReferenceReset.withReference.meanEnergy,
          compositingReferenceReset.restoredReference.meanEnergy,
        ) <= 0.01,
        'setCompositingReference() 没有原子恢复已清除的合成参考',
        compositingReferenceReset,
      );
      metrics.compositingReferenceReset = compositingReferenceReset;

      for (const isolatedCompositing of isolationModes)
      {
        const contrastCases = new Map();
        const isolationLabel = isolatedCompositing ? 'isolated' : 'direct';

        for (const outputCompositing of ['browser-overlay', 'scene'])
        {
          for (const lightBackgroundContrastAlpha of [0, 0.35])
          {
            const key =
              `${outputCompositing}__${lightBackgroundContrastAlpha}`;
            const label =
              `software-bloom__contrast-${isolationLabel}__${key}`;
            const specification =
            {
              mode: 'software-bloom',
              opacity: 1,
              isolatedCompositing,
              background: 'white',
              outputCompositing,
              lightBackgroundContrastAlpha,
              shadow: false,
              containStrict: false,
              includeTrail: false,
              inspectContrast: true,
              sampleTimeMs: 120,
              fxParams:
              {
                'shards.clickCount': 0,
                'shards.maxCount': 0,
              },
            };

            currentLabel = label;
            const result = await page.evaluate(
              (input) => window.browserPixelSuite.runCase(input),
              specification,
            );
            const screenshot = await captureContrastScreenshot(page);

            contrastCases.set(
              key,
              {
                result,
                screenshot,
              },
            );
            metrics.cases[label] = result;
          }
        }

        metrics.contrastCompositing[isolationLabel] =
          await validateContrastCompositing(
            page,
            contrastCases,
            isolationLabel,
          );
      }

      for (const mode of modeNames)
      {
        const timelines =
        {
          click: await collectLifecycleTimeline(
            page,
            mode,
            'click',
            lifecycleSampleTimes,
          ),
          disk: await collectLifecycleTimeline(
            page,
            mode,
            'disk',
            [0, 40, 79, 120, 199, 300],
          ),
          trail: await collectLifecycleTimeline(
            page,
            mode,
            'trail',
            lifecycleSampleTimes,
          ),
          hit: await collectLifecycleTimeline(
            page,
            mode,
            'hit',
            [0, 40, 79, 120],
          ),
          noHit: await collectLifecycleTimeline(
            page,
            mode,
            'noHit',
            [0, 40, 79, 120],
          ),
        };

        currentLabel = `${mode}__effect-lifecycle`;
        validateEffectLifecycle(mode, timelines);
        metrics.effectLifecycle[mode] = Object.fromEntries(
          Object.entries(timelines).map(([variant, timeline]) =>
            [variant, Object.fromEntries(timeline)]),
        );
      }

    }

    assert(
      session.pageErrors.length === 0 && session.consoleErrors.length === 0,
      `DPR ${dpr}: 浏览器页面出现未处理异常`,
      {
        consoleErrors: session.consoleErrors,
        pageErrors: session.pageErrors,
      },
    );
    await page.evaluate(() => window.browserPixelSuite.dispose());
    await session.context.close();
  }

  currentLabel = 'trail-texture-resource-fixture-startup';
  const trailResourceSession = await openFixture(browserInstance, baseUrl, 1);

  currentPage = trailResourceSession.page;
  currentLabel = 'trail-texture-resource-lifecycle';
  const trailTextureResourceLifecycle =
    await trailResourceSession.page.evaluate(
      () => window.browserPixelSuite.runTrailTextureResourceLifecycle(),
    );

  assert(
    Object.values(trailTextureResourceLifecycle).every(Boolean),
    'Trail 静态纹理的闲置释放或销毁合同失败',
    trailTextureResourceLifecycle,
  );
  metrics.trailTextureResourceLifecycle = trailTextureResourceLifecycle;
  assert(
    trailResourceSession.pageErrors.length === 0 &&
      trailResourceSession.consoleErrors.length === 0,
    'Trail 静态纹理资源夹具出现未处理异常',
    {
      consoleErrors: trailResourceSession.consoleErrors,
      pageErrors: trailResourceSession.pageErrors,
    },
  );
  await trailResourceSession.page.evaluate(
    () => window.browserPixelSuite.dispose(),
  );
  await trailResourceSession.context.close();

  // Context 丢失可能让 GPU 进程短暂回收共享资源，独立于 DPR 矩阵执行。
  for (const mode of ['full-webgl2', 'webgl2-bloom'])
  {
    currentLabel = `${mode}__context-fixture-startup`;
    const contextSession = await openFixture(browserInstance, baseUrl, 1);
    const contextResults = new Map();

    currentPage = contextSession.page;
    for (const opacity of opacities)
    {
      currentLabel = `${mode}__context-lifecycle-opacity-${opacity}`;
      const lifecycle = await contextSession.page.evaluate(
        (input) => window.browserPixelSuite.runContextLifecycle(input),
        {
          mode,
          opacity,
        },
      );

      validateContextLifecycleRoute(mode, lifecycle);
      contextResults.set(opacity, lifecycle);
    }

    currentLabel = `${mode}__context-lifecycle`;
    validateContextLifecycleGroup(mode, contextResults);
    metrics.contextLifecycle[mode] = Object.fromEntries(contextResults);

    const transparentContractLifecycles = {};

    for (const contract of [
      {
        name: 'coverage',
        overlayAlphaPolicy: 'coverage',
        overlayColorCompensation: 'none',
        hostCompositing: 'source-over',
      },
      {
        name: 'visual-max',
        overlayAlphaPolicy: 'visual-max',
        overlayColorCompensation: 'none',
        hostCompositing: 'source-over',
      },
      {
        name: 'visual-max-bright-core',
        overlayAlphaPolicy: 'visual-max',
        overlayColorCompensation: 'bright-core',
        hostCompositing: 'source-over',
      },
      {
        name: 'dom-add',
        overlayAlphaPolicy: 'coverage',
        overlayColorCompensation: 'none',
        hostCompositing: 'screen',
      },
      {
        name: 'host-plus-lighter',
        overlayAlphaPolicy: 'coverage',
        overlayColorCompensation: 'none',
        hostCompositing: 'plus-lighter',
      },
    ])
    {
      currentLabel =
        `${mode}__${contract.name}__context-lifecycle`;
      const lifecycle = await contextSession.page.evaluate(
        (input) => window.browserPixelSuite.runContextLifecycle(input),
        {
          mode,
          opacity: 1,
          overlayAlphaLimit: 0.7,
          overlayAlphaPolicy: contract.overlayAlphaPolicy,
          overlayColorCompensation: contract.overlayColorCompensation,
          hostCompositing: contract.hostCompositing,
        },
      );

      validateTransparentContractContext(mode, lifecycle, contract);
      transparentContractLifecycles[contract.name] = lifecycle;
    }

    metrics.transparentContractContextLifecycle[mode] =
      transparentContractLifecycles;

    if (mode === 'full-webgl2')
    {
      currentLabel = 'full-webgl2__compositing-reference-context-lifecycle';
      const compositingReferenceContextLifecycle =
        await contextSession.page.evaluate(
          () => window.browserPixelSuite.runCompositingReferenceContextLifecycle(),
        );

      validateCompositingReferenceContextLifecycle(
        compositingReferenceContextLifecycle,
      );
      metrics.compositingReferenceContextLifecycle =
        compositingReferenceContextLifecycle;
    }

    currentLabel = `${mode}__backend-reentrant-native`;
    const reentrantNative = await contextSession.page.evaluate(
      (input) => window.browserPixelSuite.runBackendReentrantNative(input),
      mode,
    );

    validateBackendReentrantNative(mode, reentrantNative);
    metrics.backendReentrantNative[mode] = reentrantNative;

    const failureChainResults = new Map();

    for (const opacity of opacities)
    {
      currentLabel = `${mode}__backend-failure-chain-opacity-${opacity}`;
      const chain = await contextSession.page.evaluate(
        (input) => window.browserPixelSuite.runBackendFailureChain(input),
        {
          mode,
          opacity,
        },
      );

      failureChainResults.set(opacity, chain);
    }

    currentLabel = `${mode}__backend-failure-chain`;
    validateBackendFailureChain(mode, failureChainResults);
    metrics.backendFailureChains[mode] = Object.fromEntries(
      failureChainResults,
    );

    currentLabel = `${mode}__visual-max-bright-core__backend-failure-chain`;
    const transparentContractFailureChain =
      await contextSession.page.evaluate(
        (input) => window.browserPixelSuite.runBackendFailureChain(input),
        {
          mode,
          opacity: 1,
          overlayAlphaLimit: 0.7,
          overlayAlphaPolicy: 'visual-max',
          overlayColorCompensation: 'bright-core',
        },
      );

    validateBackendFailureChain(
      mode,
      new Map([[1, transparentContractFailureChain]]),
      false,
    );
    metrics.transparentContractFailureChains[mode] =
      transparentContractFailureChain;

    const trailFailureChainResults = new Map();

    for (const opacity of opacities)
    {
      currentLabel =
        `${mode}__trail-backend-failure-chain-opacity-${opacity}`;
      const trailFailureChain = await contextSession.page.evaluate(
        (input) => window.browserPixelSuite.runBackendFailureChain(input),
        {
          mode,
          opacity,
          trailOnly: true,
        },
      );

      trailFailureChainResults.set(opacity, trailFailureChain);
    }

    currentLabel = `${mode}__trail-backend-failure-chain`;
    validateTrailBackendFailureChain(mode, trailFailureChainResults);
    metrics.trailBackendFailureChains[mode] = Object.fromEntries(
      trailFailureChainResults,
    );

    const trailLifecycles = {};

    for (const outputCompositing of ['scene', 'browser-overlay'])
    {
      currentLabel =
        `${mode}__${outputCompositing}__trail-context-lifecycle`;
      const trailLifecycle = await contextSession.page.evaluate(
        (input) => window.browserPixelSuite.runTrailContextLifecycle(input),
        {
          mode,
          outputCompositing,
        },
      );

      validateTrailContextLifecycle(
        mode,
        outputCompositing,
        trailLifecycle,
      );
      trailLifecycles[outputCompositing] = trailLifecycle;
    }

    metrics.trailContextLifecycle[mode] = trailLifecycles;

    const directSpecification =
    {
      mode,
      opacity: 1,
      isolatedCompositing: false,
    };

    currentLabel = `${mode}__direct-context-lifecycle`;
    const directContextLifecycle = await contextSession.page.evaluate(
      (input) => window.browserPixelSuite.runContextLifecycle(input),
      directSpecification,
    );

    validateContextLifecycleRoute(mode, directContextLifecycle);
    validateContextLifecycleGroup(
      mode,
      new Map([[1, directContextLifecycle]]),
      false,
    );
    validateDirectCompositingContract(
      mode,
      directContextLifecycle,
      ['before', 'restoring', 'restored'],
      ['fallback', 'fallbackSteady'],
    );
    metrics.contextLifecycle[`${mode}-direct`] = directContextLifecycle;

    currentLabel = `${mode}__direct-backend-failure-chain`;
    const directFailureChain = await contextSession.page.evaluate(
      (input) => window.browserPixelSuite.runBackendFailureChain(input),
      directSpecification,
    );

    validateBackendFailureChain(
      mode,
      new Map([[1, directFailureChain]]),
      false,
    );
    validateDirectCompositingContract(
      mode,
      directFailureChain,
      ['before', 'restoring', 'restored'],
      ['software', 'fault', 'native'],
    );
    metrics.backendFailureChains[`${mode}-direct`] = directFailureChain;

    currentLabel = `${mode}__direct-backend-reentrant-native`;
    const directReentrantNative = await contextSession.page.evaluate(
      (input) => window.browserPixelSuite.runBackendReentrantNative(input),
      directSpecification,
    );

    validateBackendReentrantNative(mode, directReentrantNative);
    validateDirectCompositingContract(
      mode,
      directReentrantNative,
      [],
      ['fallback', 'steady'],
    );
    metrics.backendReentrantNative[`${mode}-direct`] =
      directReentrantNative;

    assert(
      contextSession.pageErrors.length === 0 &&
        contextSession.consoleErrors.length === 0,
      `${mode}: Context 生命周期页面出现未处理异常`,
      {
        consoleErrors: contextSession.consoleErrors,
        pageErrors: contextSession.pageErrors,
      },
    );
    await contextSession.page.evaluate(() => window.browserPixelSuite.dispose());
    await contextSession.context.close();
  }

  for (const mode of modeNames)
  {
    for (const isolatedCompositing of isolationModes)
    {
      const suffix = isolatedCompositing ? 'isolated' : 'direct';
      const dprOne = caseResults.get(
        `${mode}__opacity-1__${suffix}__dpr-1`,
      );
      const dprTwo = caseResults.get(
        `${mode}__opacity-1__${suffix}__dpr-2`,
      );

      currentLabel = `${mode}__${suffix}__dpr-contract`;
      validateDprPair(dprOne, dprTwo, `${mode}/${suffix}`);
    }
  }

  for (const mode of ['native'])
  {
    for (const variant of ['click-only', 'trail-only'])
    {
      currentLabel = `${mode}__${variant}__dpr-contract`;
      validateDprPair(
        caseResults.get(`${mode}__${variant}__isolated__dpr-1`),
        caseResults.get(`${mode}__${variant}__isolated__dpr-2`),
        `${mode}/${variant}`,
      );
    }
  }

  return calibration;
}

async function runUnityCountGate(browserInstance, baseUrl)
{
  currentLabel = 'unity-prefab-count-fixture-startup';
  const session = await openFixture(browserInstance, baseUrl, 1);

  currentPage = session.page;
  metrics.environment.dpr1 = session.capabilities;

  try
  {
    await runPrefabCountContracts(session.page);
    assert(
      session.pageErrors.length === 0 && session.consoleErrors.length === 0,
      'Unity Prefab 数量门禁出现未处理的浏览器异常',
      {
        consoleErrors: session.consoleErrors,
        pageErrors: session.pageErrors,
      },
    );
  }
  finally
  {
    await session.page.evaluate(
      () => window.browserPixelSuite.dispose(),
    ).catch(() => {});
    await session.context.close();
  }
}

async function writeFailureArtifacts(error)
{
  mkdirSync(artifactDir, { recursive: true });
  const safeLabel = currentLabel.replaceAll(/[^a-zA-Z0-9_.-]+/g, '-');

  if (currentPage)
  {
    try
    {
      await currentPage.screenshot(
        {
          animations: 'disabled',
          fullPage: true,
          path: join(artifactDir, `${safeLabel}.png`),
        },
      );
    }
    catch (screenshotError)
    {
      metrics.screenshotError = screenshotError.message;
    }
  }

  writeFileSync(
    join(artifactDir, 'failure.json'),
    `${JSON.stringify(
      {
        label: currentLabel,
        error:
        {
          message: error.message,
          stack: error.stack,
          detail: error.detail ?? null,
        },
        metrics,
      },
      null,
      2,
    )}\n`,
  );
}

async function main()
{
  const executablePath = findChromiumExecutable();

  if (!executablePath)
  {
    const message = [
      '找不到可用的 Chrome/Edge。',
      '请设置 BACLICKFX_CHROMIUM_PATH 指向 Chromium 可执行文件。',
    ].join(' ');

    if (optional)
    {
      console.warn(`[browser-pixels] SKIP: ${message}`);
      return;
    }

    throw new Error(message);
  }

  if (!unityCountsOnly)
  {
    assert(
      existsSync(baselinePath) || calibrate,
      `缺少数值特征基线: ${baselinePath}`,
    );
  }
  const baseline = existsSync(baselinePath)
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : null;
  const browserVersion = getExecutableVersion(executablePath);
  metrics.environment.executablePath = executablePath;
  metrics.environment.browserVersion = browserVersion;
  metrics.environment.node = process.version;
  const availablePort = await getAvailablePort();

  vite = await createViteServer(
    {
      appType: 'spa',
      clearScreen: false,
      logLevel: 'error',
      root: rootDir,
      server:
      {
        host: '127.0.0.1',
        port: availablePort,
        strictPort: true,
      },
    },
  );
  await vite.listen();
  const address = vite.httpServer.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  browser = await chromium.launch(
    {
      args:
      [
        '--disable-background-networking',
        '--disable-extensions',
        '--force-color-profile=srgb',
        '--ignore-gpu-blocklist',
        '--use-angle=swiftshader',
      ],
      executablePath,
      headless: true,
    },
  );
  const startedAt = performance.now();

  if (unityCountsOnly)
  {
    await runUnityCountGate(browser, baseUrl);
    const durationMs = performance.now() - startedAt;

    console.log(
      `\nUnity Prefab 五后端数量门禁完成：${assertionCount} 项断言，` +
        `${(durationMs / 1000).toFixed(2)} 秒。`,
    );
    console.log(`浏览器：${browserVersion}`);
    return;
  }

  await runDemoMobileTouchSmoke(browser, baseUrl);
  await runDemoTimeScaleControlSmoke(browser, baseUrl);
  await runDemoControlPanelStructureSmoke(browser, baseUrl);
  await runDemoBackgroundFileSmoke(browser, baseUrl);
  await runDemoPureWhiteIsolationSmoke(browser, baseUrl);
  const calibration = await runMatrix(browser, baseUrl, baseline);
  const durationMs = performance.now() - startedAt;

  if (calibrate)
  {
    console.log('\n[browser-pixels] calibration:');
    console.log(JSON.stringify(calibration, null, 2));
  }

  console.log(
    `\nChromium 像素回归完成：${assertionCount} 项断言，` +
      `${(durationMs / 1000).toFixed(2)} 秒。`,
  );
  console.log(`浏览器：${browserVersion}`);
}

try
{
  await main();
}
catch (error)
{
  await writeFailureArtifacts(error);
  console.error(`\n[browser-pixels] FAIL (${currentLabel}): ${error.message}`);

  if (error.detail)
  {
    console.error(JSON.stringify(error.detail, null, 2));
  }

  process.exitCode = 1;
}
finally
{
  await browser?.close();
  await vite?.close();
}
