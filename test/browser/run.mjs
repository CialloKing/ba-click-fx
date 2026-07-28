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
const metrics =
{
  environment: {},
  cases: {},
  compositor: {},
  contextLifecycle: {},
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

function validateWebGLTrailPair(fullWebGL2, webGL2Bloom)
{
  const first = fullWebGL2.trailProfile;
  const second = webGL2Bloom.trailProfile;

  for (const key of [
    'headEnergy',
    'tailEnergy',
    'upperEdgeEnergy',
    'lowerEdgeEnergy',
  ])
  {
    assert(
      Math.abs(first[key] - second[key]) <= 2 / 255,
      `两种 WebGL2 模式的拖尾探针 ${key} 不一致`,
      {
        fullWebGL2: first,
        webGL2Bloom: second,
      },
    );
  }
}

function validateWebGLTrailDirections(fullWebGL2, webGL2Bloom)
{
  const profiles =
  {
    fullWebGL2: fullWebGL2.trailProfile,
    webGL2Bloom: webGL2Bloom.trailProfile,
  };

  assert(
    Object.values(profiles).every((profile) =>
      profile.upperEdgeEnergy > profile.lowerEdgeEnergy + 0.02),
    '两种 WebGL2 模式的 Trail_03 可见横截面方向偏离 Unity 诊断帧',
    profiles,
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
  await page.goto(`${baseUrl}${fixturePath}`, { waitUntil: 'load' });

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
    pageErrors,
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

  // Context 丢失可能让 GPU 进程短暂回收共享资源，独立于 DPR 矩阵执行。
  for (const mode of ['full-webgl2', 'webgl2-bloom'])
  {
    currentLabel = `${mode}__context-fixture-startup`;
    const contextSession = await openFixture(browserInstance, baseUrl, 1);

    currentPage = contextSession.page;
    currentLabel = `${mode}__context-lifecycle`;
    const lifecycle = await contextSession.page.evaluate(
      (input) => window.browserPixelSuite.runContextLifecycle(input),
      mode,
    );

    assert(
      lifecycle.before.visibleRatio > 0 &&
        lifecycle.fallback.visibleRatio > 0 &&
        lifecycle.restored.visibleRatio > 0,
      `${mode}: Context 丢失或恢复产生空白帧`,
      lifecycle,
    );

    if (mode === 'full-webgl2')
    {
      assert(
        lifecycle.sceneBackgroundAccepted === true,
        `${mode}: Context 生命周期场景背景上传失败`,
        lifecycle,
      );
      assert(
        lifecycle.fallbackRoute.effect === 'canvas2d' &&
          lifecycle.restoredRoute.effect === 'webgl2',
        `${mode}: Context 生命周期后端路由错误`,
        lifecycle,
      );
      assert(
        relativeDifference(
          lifecycle.before.meanEnergy,
          lifecycle.fallback.meanEnergy,
        ) <= 0.15 &&
          relativeDifference(
            lifecycle.before.meanEnergy,
            lifecycle.restored.meanEnergy,
          ) <= 0.15,
        `${mode}: Context 丢失或恢复没有保持 Scene 背景能量`,
        lifecycle,
      );
    }
    else
    {
      assert(
        ['software', 'native'].includes(lifecycle.fallbackRoute.bloom) &&
          lifecycle.restoredRoute.bloom === 'webgl2',
        `${mode}: Context 生命周期 Bloom 路由错误`,
        lifecycle,
      );
    }

    metrics.contextLifecycle[mode] = lifecycle;
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
