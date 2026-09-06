import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const fixturePath = '/test/browser/fixture.html?runtime=dist';
export const modeNames = ['full-webgl2', 'webgl2-bloom', 'software-bloom', 'native'];
export const opacities = [0, 0.5, 1];
export const isolationModes = [false, true];
export const devicePixelRatios = [1, 2];
export const lifecycleSampleTimes = [0, 40, 79, 120, 199, 300, 599, 601];
export const themeColorContractModes = ['native', 'software-bloom', 'full-webgl2'];
export const OPACITY_LINEAR_RADIAL_SAMPLE_INDEX = 5;
export const MINIMUM_BLOOM_MEAN_ALPHA_RATIO = 0.25;
export const MINIMUM_BLOOM_PROBE_ALPHA_RATIO = 0.125;
export const MAXIMUM_DPR_MEAN_DIFFERENCE = 0.27;
export const MAXIMUM_SOFTWARE_DPR_MEAN_ALPHA_DIFFERENCE = 0.29;
export const MAXIMUM_DPR_CORE_ALPHA_DIFFERENCE = 2 / 255;
export const MAXIMUM_DPR_RADIAL_ALPHA_DIFFERENCE = 0.12;
let state = null;

export function createRuntimeState()
{
  return {
    currentPage: null,
    currentLabel: 'startup',
    assertionCount: 0,
    metrics:
    {
      environment: {}, cases: {}, compositor: {}, backendFailureChains: {},
      backendReentrantNative: {}, trailBackendFailureChains: {}, contrastCompositing: {},
      contextLifecycle: {}, compositingReferenceContextLifecycle: null, effectLifecycle: {},
      trailContextLifecycle: {}, trailTextureResourceLifecycle: {}, prefabCountContracts: {},
      transparentCompositingTransitions: {}, hostCompositingAccuracy: null, themeColorContracts: {},
      transparentContractContextLifecycle: {}, transparentContractFailureChains: {},
      fullscreenScrollbarGutter: { source: null }, demoTimeScaleControls: null,
      demoMobileTouch: null, demoControlPanelStructure: null, demoBackgroundFile: null,
      demoPureWhiteIsolation: null,
    },
  };
}

export function setRuntimeState(nextState)
{
  state = nextState;
}

function assert(condition, message, detail = null)
{
  if (!condition)
  {
    const error = new Error(message);

    error.detail = detail;
    throw error;
  }

  state.assertionCount++;
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
    `${state.currentLabel}: 完整特效后端解析错误`,
    result.route,
  );
  assert(
    result.route.resolvedBloomBackend === result.expectedRoute.bloomBackend,
    `${state.currentLabel}: Bloom 后端解析错误`,
    result.route,
  );
  assert(
    Math.abs(result.dpr - expectedDpr) < 0.01,
    `${state.currentLabel}: DPR 未按浏览器上下文生效`,
    result.dpr,
  );
  assert(
    Math.abs(result.layout.width - 320) < 0.01 &&
      Math.abs(result.layout.height - 240) < 0.01,
    `${state.currentLabel}: contain/Shadow 容器改变了稳定尺寸`,
    result.layout,
  );
  assert(
    result.layout.visibleCanvasCount > 0,
    `${state.currentLabel}: 没有可见输出 Canvas`,
    result.layout,
  );

  if (result.specification.opacity === 0)
  {
    assert(
      transparent.meanAlpha < 0.00001 &&
        transparent.meanEnergy < 0.00001 &&
        transparent.visibleRatio === 0,
      `${state.currentLabel}: opacity=0 仍输出可见像素`,
      transparent,
    );
  }
  else
  {
    assert(
      transparent.visibleRatio > 0 &&
        transparent.meanAlpha > 0 &&
        transparent.meanEnergy > 0,
      `${state.currentLabel}: 非零 opacity 输出为空`,
      transparent,
    );
  }

  assert(
    result.pixels.black.meanEnergy <= result.pixels.checker.meanEnergy &&
      result.pixels.checker.meanEnergy <= result.pixels.white.meanEnergy,
    `${state.currentLabel}: 黑/棋盘/白背景合成亮度不单调`,
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
      `${state.currentLabel}: 点击中心完全遮挡了宿主背景`,
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
    `${state.currentLabel}: 没有建立 10px 全屏滚动条槽`,
    result,
  );
  assert(
    Math.abs(result.effect.dpr - expectedDpr) < 0.01,
    `${state.currentLabel}: 全屏覆盖层 DPR 未按浏览器上下文生效`,
    result,
  );
  assert(
    Math.abs(result.effect.width - bounds.width) < 0.01 &&
      Math.abs(result.effect.height - bounds.height) < 0.01 &&
      Math.abs(result.canvas.clientWidth - bounds.width) < 0.01 &&
      Math.abs(result.canvas.clientHeight - bounds.height) < 0.01 &&
      Math.abs(result.viewport.innerHeight - bounds.height) < 0.01,
    `${state.currentLabel}: 全屏逻辑尺寸与 fixed Canvas CSS 盒子不一致`,
    result,
  );
  assert(
    result.canvas.backingWidth ===
      Math.round(result.effect.width * result.effect.dpr) &&
      result.canvas.backingHeight ===
        Math.round(result.effect.height * result.effect.dpr),
    `${state.currentLabel}: 全屏 backing store 没有按实测 CSS 尺寸和 DPR 分配`,
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
}async function runThemeColorContracts(page)
{
  for (const mode of themeColorContractModes)
  {
    state.currentLabel = `${mode}__theme-color-contract`;
    const result = await page.evaluate(
      (requestedMode) =>
        window.browserPixelSuite.runThemeColorContract(requestedMode),
      mode,
    );

    validateThemeColorContract(mode, result);
    state.metrics.themeColorContracts[mode] = result;
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
  state.currentPage = page;
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

export async function collectLifecycleTimeline(page, mode, variant, sampleTimes)
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

    state.currentLabel = label;
    const result = await page.evaluate(
      (input) => window.browserPixelSuite.runCase(input),
      specification,
    );

    timelines.set(sampleTimeMs, result);
    state.metrics.cases[label] = result;
  }

  return timelines;
}


export { assert, relativeDifference, validateBasicCase, validateOpacityGroup, validateDprPair, validateIsolationPair, hasPixelOutput, validateEmptyPixels, validateFullscreenScrollbarGutter, validateThemeColorContract, runThemeColorContracts, validateEffectLifecycle, validateContextOpacityGroup, validateTransparentContractTransitions, validateBrightCoreTrailCompensation, validateTransparentContractContext, validateContextLifecycleGroup, validateContextLifecycleRoute, validateDirectCompositingContract, validateCompositingReferenceContextLifecycle, validateBackendFailureContract, validateBackendFailureAlphaContract, validateBackendFailureOpacitySeries, validateBackendFailureChain, validateTrailBackendFailureChain, validateBackendReentrantNative, validateWebGLTrailProbe, validateWebGLTrailProfiles, validateWebGLTrailPair, validateWebGLTrailDirection, validateTrailContextRoutes, validateTrailContextCoverage, validateTrailContextCompositing, validateTrailContextLifecycle, validateWebGLTrailDirections, selectBaselineFeatures, validateBaseline, summarizeScreenshot, captureCompositorMetrics, captureContrastScreenshot, compareScreenshotBuffers, validateContrastCompositing, openFixture };
