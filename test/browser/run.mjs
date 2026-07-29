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
const iifeBundlePath = join(rootDir, 'dist', 'ba-click-fx.iife.js');
const baselinePath = join(rootDir, 'test', 'browser', 'baseline.json');
const artifactDir = join(rootDir, 'test-results', 'browser-pixels');
const optional = process.argv.includes('--optional');
const calibrate = process.argv.includes('--calibrate');
const modeNames = [
  'full-webgl2',
  'webgl2-bloom',
  'software-bloom',
  'native',
  'legacy',
];
const opacities = [0, 0.5, 1];
const isolationModes = [false, true];
const devicePixelRatios = [1, 2];
const lifecycleSampleTimes = [0, 40, 79, 120, 199, 300, 599, 601];
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
  sceneBackgroundContextLifecycle: null,
  effectLifecycle:
  {
  },
  trailContextLifecycle: {},
  trailTextureResourceLifecycle: {},
  iifeSmoke: null,
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

  if (result.outputCompositing === 'transparent-overlay' &&
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
  const centerAlphaRatio = half.center[3] /
    Math.max(full.center[3], 1);

  assert(
    zero.meanAlpha < 0.00001 && zero.meanEnergy < 0.00001,
    `${label}: opacity=0 未完全透明`,
    zero,
  );
  assert(
    alphaRatio >= 0.35 && alphaRatio <= 0.65,
    `${label}: opacity Alpha 不接近线性`,
    {
      alphaRatio,
      half,
      full,
    },
  );
  assert(
    centerAlphaRatio >= 0.35 && centerAlphaRatio <= 0.65,
    `${label}: 点击中心 Alpha 不接近线性`,
    {
      centerAlphaRatio,
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
    half.maximumAlpha <= full.maximumAlpha + 0.01,
    `${label}: opacity=0.5 的最大 Alpha 超过 opacity=1`,
    {
      half: half.maximumAlpha,
      full: full.maximumAlpha,
    },
  );
}

function validateDprPair(dprOne, dprTwo, label)
{
  const first = dprOne.pixels.transparent;
  const second = dprTwo.pixels.transparent;
  // Bloom 边缘以 2/255 的离散可见阈值统计；完整纹理会让不同 DPR 的
  // 亚像素采样在大范围低能边缘产生少量差异，但真正的缩放错误仍远超 8%。
  const widthTolerance = Math.max(
    16,
    Math.max(first.bounds.width, second.bounds.width) * 0.08,
  );
  const heightTolerance = Math.max(
    16,
    Math.max(first.bounds.height, second.bounds.height) * 0.08,
  );

  assert(
    relativeDifference(first.meanAlpha, second.meanAlpha) <= 0.25,
    `${label}: DPR 归一化 Alpha 偏差过大`,
    {
      dpr1: first,
      dpr2: second,
    },
  );
  assert(
    relativeDifference(first.meanEnergy, second.meanEnergy) <= 0.25,
    `${label}: DPR 归一化颜色能量偏差过大`,
    {
      dpr1: first,
      dpr2: second,
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
  assert(
    disk.get(199).pixels.transparent.meanAlpha <
      disk.get(120).pixels.transparent.meanAlpha,
    `${mode}: Disk 末段没有按 Unity Alpha 曲线衰减`,
    {
      at120: disk.get(120).pixels.transparent,
      at199: disk.get(199).pixels.transparent,
    },
  );

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
  probe = 'center',
)
{
  const zero = results.get(0)[phase].transparent;
  const half = results.get(0.5)[phase].transparent;
  const full = results.get(1)[phase].transparent;
  const meanAlphaRatio = half.meanAlpha / Math.max(full.meanAlpha, 1e-9);
  const halfProbeAlpha = probe === 'trail'
    ? half.trailProbeAlpha
    : half.center[3] / 255;
  const fullProbeAlpha = probe === 'trail'
    ? full.trailProbeAlpha
    : full.center[3] / 255;
  const probeAlphaRatio = halfProbeAlpha / Math.max(fullProbeAlpha, 1e-9);
  const maximumAlphaRatio = half.maximumAlpha /
    Math.max(full.maximumAlpha, 1e-9);

  validateEmptyPixels(zero, `${mode} ${label} ${phase} opacity=0`);
  assert(
    meanAlphaRatio >= 0.35 && meanAlphaRatio <= 0.65,
    `${mode}: ${label} ${phase} 的平均 Alpha 不接近线性`,
    {
      half,
      full,
      meanAlphaRatio,
    },
  );
  assert(
    probeAlphaRatio >= 0.35 && probeAlphaRatio <= 0.65,
    `${mode}: ${label} ${phase} 的${
      probe === 'trail' ? '拖尾探针' : '中心'} Alpha 不接近线性`,
    {
      probeAlphaRatio,
      half: halfProbeAlpha,
      full: fullProbeAlpha,
    },
  );
  assert(
    maximumAlphaRatio >= 0.35 && maximumAlphaRatio <= 0.65,
    `${mode}: ${label} ${phase} 的最大 Alpha 不接近线性`,
    {
      half: half.maximumAlpha,
      full: full.maximumAlpha,
      maximumAlphaRatio,
    },
  );
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

      for (const phase of [
        'fallback',
        'fallbackSteady',
        'restoring',
        'restored',
      ])
      {
        const current = lifecycle[phase].transparent;
        const spatial = lifecycle.alphaContinuity[phase];
        const radialDelta = before.radialAlpha.map((value, index) =>
          Math.abs(value - current.radialAlpha[index]));

        assert(
          relativeDifference(before.meanAlpha, current.meanAlpha) <= 0.15 &&
            Math.abs(before.maximumAlpha - current.maximumAlpha) <= 0.2 &&
            Math.abs(before.center[3] - current.center[3]) <= 24,
          `${mode}: Context ${phase} 出现 Alpha 突跳`,
          {
            before,
            current,
            opacity,
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

  assert(
    lifecycle.beforeRoute.effect === expectedEffect &&
      lifecycle.beforeRoute.bloom === 'webgl2' &&
      lifecycle.fallbackRoute.effect === 'canvas2d' &&
      lifecycle.fallbackRoute.bloom === 'software' &&
      lifecycle.fallbackSteadyRoute.effect === 'canvas2d' &&
      lifecycle.fallbackSteadyRoute.bloom === 'software' &&
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

function validateSceneBackgroundContextLifecycle(lifecycle)
{
  assert(
    lifecycle.accepted &&
      lifecycle.sourcePreserved &&
      lifecycle.routes.before.effect === 'webgl2' &&
      lifecycle.routes.before.bloom === 'webgl2' &&
      lifecycle.routes.fallback.effect === 'canvas2d' &&
      lifecycle.routes.fallback.bloom === 'webgl2' &&
      lifecycle.routes.restoring.effect === 'webgl2' &&
      lifecycle.routes.restoring.bloom === 'webgl2' &&
      lifecycle.routes.restored.effect === 'webgl2' &&
      lifecycle.routes.restored.bloom === 'webgl2',
    'Scene 背景 Context 生命周期路由或源对象保留失败',
    lifecycle,
  );

  for (const phase of ['before', 'fallback', 'restoring', 'restored'])
  {
    const overlay = lifecycle[phase].overlay;
    const composited = lifecycle[phase].composited;

    assert(
      hasPixelOutput(overlay),
      `Scene 背景在 Context ${phase} 阶段产生空白叠加层`,
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
      `Scene 背景叠加层在 Context ${phase} 阶段出现突跳`,
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
      `Scene 背景在 Context ${phase} 阶段没有保持宿主合成结果`,
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
        ['bloom', 'webgl2', 'software'],
        ['bloom', 'webgl2', 'native'],
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
        ['bloom', 'webgl2', 'software'],
        ['bloom', 'native', 'native'],
      ]
    : [
        ['bloom', 'webgl2', 'software'],
        ['bloom', 'native', 'native'],
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
    : 'software';
  const routes = lifecycle.routes;

  assert(
    routes.before.effect === expectedEffect &&
      routes.before.bloom === 'webgl2' &&
      routes.fallback.effect === 'canvas2d' &&
      routes.fallback.bloom === 'software' &&
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

  if (lifecycle.outputCompositing === 'transparent-overlay')
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
      let maximumChannelIncrease = 0;
      let maximumRedDrop = 0;
      let redDropSum = 0;

      for (let offset = 0; offset < leftImage.data.length; offset += 4)
      {
        let pixelChanged = false;

        for (let channel = 0; channel < 4; channel++)
        {
          const leftValue = leftImage.data[offset + channel];
          const rightValue = rightImage.data[offset + channel];
          const delta = Math.abs(leftValue - rightValue);

          maximumChannelDelta = Math.max(maximumChannelDelta, delta);
          pixelChanged ||= delta > 0;

          if (channel < 3)
          {
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

        if (pixelChanged)
        {
          changedPixels++;
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
          maximumChannelIncrease,
          maximumRedDrop,
          pixelCount: leftImage.width * leftImage.height,
          redDropSum,
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
  const transparentZero = contrastCases.get('transparent-overlay__0');
  const transparentContrast = contrastCases.get(
    'transparent-overlay__0.35',
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
    `${prefix} transparent-overlay=0`,
  );
  validateEmptyPixels(
    transparentContrast.result.contrastLayer,
    `${prefix} transparent-overlay=0.35`,
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
    `${prefix} 改变了 transparent-overlay 的 Chromium 输出`,
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

async function openFixture(browserInstance, baseUrl, dpr, runtimeKind = 'source')
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

  if (runtimeKind === 'iife')
  {
    fixtureUrl.searchParams.set('runtime', runtimeKind);
  }
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
    };
  });

  assert(capabilities.webgl2, `DPR ${dpr}: Chromium 不支持 WebGL2`);
  assert(
    capabilities.loseContext,
    `DPR ${dpr}: Chromium 不支持 WEBGL_lose_context`,
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
    outputCompositing: 'transparent-overlay',
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

async function runIifeSmoke(browserInstance, baseUrl)
{
  currentLabel = 'iife-fixture-startup';
  const session = await openFixture(browserInstance, baseUrl, 1, 'iife');
  const page = session.page;

  currentPage = page;

  try
  {
    const runtimeContract = await page.evaluate(() =>
      ({
        constructorType: typeof window.BAClickFX?.BAClickFX,
        runtimeKind: window.browserPixelSuite.runtimeKind,
      }));

    assert(
      runtimeContract.runtimeKind === 'iife' &&
        runtimeContract.constructorType === 'function',
      '构建后 IIFE 夹具没有使用包根运行时',
      runtimeContract,
    );

    currentLabel = 'iife-transparent-click-trail';
    const basic = await page.evaluate(
      (input) => window.browserPixelSuite.runCase(input),
      {
        mode: 'full-webgl2',
        opacity: 1,
        isolatedCompositing: true,
        background: 'checker',
        outputCompositing: 'transparent-overlay',
        shadow: false,
        containStrict: false,
      },
    );

    validateBasicCase(basic, 1);
    assert(
      basic.runtime.waveCount > 0 && basic.runtime.trailPointCount >= 2,
      '构建后 IIFE 没有同时创建点击与拖尾输出',
      basic.runtime,
    );

    const trailFailureChains = {};

    for (const mode of ['full-webgl2', 'webgl2-bloom'])
    {
      const results = new Map();

      for (const opacity of opacities)
      {
        currentLabel =
          `iife-${mode}-trail-backend-failure-chain-opacity-${opacity}`;
        const failureChain = await page.evaluate(
          (input) => window.browserPixelSuite.runBackendFailureChain(input),
          {
            mode,
            opacity,
            trailOnly: true,
          },
        );

        results.set(opacity, failureChain);
      }

      validateTrailBackendFailureChain(mode, results);
      trailFailureChains[mode] = Object.fromEntries(results);
    }
    const reentrantNative = {};

    for (const mode of ['full-webgl2', 'webgl2-bloom'])
    {
      currentLabel = `iife-${mode}-backend-reentrant-native`;
      const result = await page.evaluate(
        (input) => window.browserPixelSuite.runBackendReentrantNative(input),
        mode,
      );

      validateBackendReentrantNative(mode, result);
      reentrantNative[mode] = result;
    }

    metrics.iifeSmoke =
    {
      basic,
      reentrantNative,
      runtimeContract,
      trailFailureChains,
    };
    assert(
      session.pageErrors.length === 0 &&
        session.consoleErrors.length === 0 &&
        session.failedResources.length === 0,
      '构建后 IIFE 浏览器夹具出现未处理异常',
      {
        consoleErrors: session.consoleErrors,
        failedResources: session.failedResources,
        pageErrors: session.pageErrors,
      },
    );
  }
  finally
  {
    await page.evaluate(() => window.browserPixelSuite.dispose());
    await session.context.close();
  }
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

      if (mode === 'native' || mode === 'legacy')
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

      currentLabel = 'scene-background-null';
      const sceneReset = await page.evaluate(
        () => window.browserPixelSuite.runSceneBackgroundReset(),
      );

      assert(
        sceneReset.accepted && sceneReset.cleared,
        'setSceneBackground() 或 setSceneBackground(null) 被拒绝',
        sceneReset,
      );
      assert(
        relativeDifference(
          sceneReset.beforeScene.meanEnergy,
          sceneReset.withScene.meanEnergy,
        ) > 0.1,
        'setSceneBackground() 没有改变可见场景',
        sceneReset,
      );
      assert(
        relativeDifference(
          sceneReset.beforeScene.meanAlpha,
          sceneReset.withoutScene.meanAlpha,
        ) <= 0.01 &&
          relativeDifference(
            sceneReset.beforeScene.meanEnergy,
            sceneReset.withoutScene.meanEnergy,
          ) <= 0.01,
        'setSceneBackground(null) 未恢复设置前的透明输出',
        sceneReset,
      );
      metrics.sceneBackgroundReset = sceneReset;

      for (const isolatedCompositing of isolationModes)
      {
        const contrastCases = new Map();
        const isolationLabel = isolatedCompositing ? 'isolated' : 'direct';

        for (const outputCompositing of ['transparent-overlay', 'scene'])
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

    if (mode === 'full-webgl2')
    {
      currentLabel = 'full-webgl2__scene-background-context-lifecycle';
      const sceneBackgroundContextLifecycle =
        await contextSession.page.evaluate(
          () => window.browserPixelSuite.runSceneBackgroundContextLifecycle(),
        );

      validateSceneBackgroundContextLifecycle(
        sceneBackgroundContextLifecycle,
      );
      metrics.sceneBackgroundContextLifecycle =
        sceneBackgroundContextLifecycle;
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

    for (const outputCompositing of ['scene', 'transparent-overlay'])
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

  for (const mode of ['native', 'legacy'])
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

  assert(
    existsSync(baselinePath) || calibrate,
    `缺少数值特征基线: ${baselinePath}`,
  );
  assert(
    existsSync(iifeBundlePath),
    `缺少构建后 IIFE: ${iifeBundlePath}；请先运行 npm run build`,
  );
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
  await runIifeSmoke(browser, baseUrl);
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
