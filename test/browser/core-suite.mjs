import * as common from './browser-common.mjs';

const {
  assert,
  captureCompositorMetrics,
  captureContrastScreenshot,
  compareScreenshotBuffers,
  createRuntimeState,
  devicePixelRatios,
  isolationModes,
  modeNames,
  opacities,
  openFixture,
  relativeDifference,
  runThemeColorContracts,
  selectBaselineFeatures,
  setRuntimeState,
  summarizeScreenshot,
  validateBaseline,
  validateBasicCase,
  validateBrightCoreTrailCompensation,
  validateContrastCompositing,
  validateDprPair,
  validateFullscreenScrollbarGutter,
  validateIsolationPair,
  validateOpacityGroup,
  validateTransparentContractTransitions,
  validateWebGLTrailDirections,
  validateWebGLTrailPair,
  validateWebGLTrailProbe,
} = common;

let state = null;

async function validateNativeSceneGlow(page)
{
  // 以实际 DOM 合成的已知背景对照，避免只比较 Alpha 基线却漏掉色带和色偏。
  for (const [background, sampleTimeMs, scale, maximumError] of [
    ['black', 120, 1, 0.7], ['color', 120, 1, 0.3],
    // 覆盖光盘消失后的大圆环；小尺寸的早期帧无法发现环内集中光斑。
    ['color', 220, 4, 1.5], ['color', 300, 4, 1.5],
  ])
  {
    const screenshots = [];
    for (const mode of ['full-webgl2', 'native'])
    {
      state.currentLabel = `native-scene-glow__${background}__${sampleTimeMs}__${mode}`;
      await page.evaluate((specification) => window.browserPixelSuite.runCase(specification),
        { mode, opacity: 1, background, includeTrail: false, sampleTimeMs, scale });
      const result = await page.evaluate((value) =>
        window.browserPixelSuite.setTransparentContractReference(value), background);
      assert(result.reference.accepted, '原生 Scene 对照必须成功设置背景参考');
      screenshots.push(await captureContrastScreenshot(page));
    }
    const difference = await compareScreenshotBuffers(page, ...screenshots);
    assert(difference.target.meanAbsoluteRgbError < maximumError,
      `原生点击光晕偏离 WebGL2：${background} / ${sampleTimeMs}ms / scale=${scale}`, difference);
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

async function runCoreMatrix(browserInstance, baseUrl, baseline, calibrate)
{
  const caseResults = new Map();
  let finalSession = null;
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
    state.currentLabel = `fixture-startup-dpr-${dpr}`;
    const session = await openFixture(browserInstance, baseUrl, dpr);
    const page = session.page;

    state.currentPage = page;
    state.metrics.environment[`dpr${dpr}`] = session.capabilities;

    if (dpr === 2)
    {
      state.currentLabel = 'source-fullscreen-scrollbar-gutter';
      const fullscreenScrollbarGutter = await page.evaluate(
        () => window.browserPixelSuite.runFullscreenScrollbarGutterContract(),
      );

      validateFullscreenScrollbarGutter(fullscreenScrollbarGutter, dpr);
      state.metrics.fullscreenScrollbarGutter.source = fullscreenScrollbarGutter;
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

          state.currentLabel = label;
          const result = await page.evaluate(
            (input) => window.browserPixelSuite.runCase(input),
            specification,
          );

          validateBasicCase(result, dpr);
          opacityResults.set(opacity, result);
          caseResults.set(label, result);
          state.metrics.cases[label] = result;

          if (opacity === 1)
          {
            const compositor = await captureCompositorMetrics(page);

            assert(
              compositor.maximumEnergy > compositor.minimumEnergy,
              `${label}: Chromium 实际合成截图为空`,
              compositor,
            );
            state.metrics.compositor[label] = compositor;
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
      const directCompositor = state.metrics.compositor[directLabel];
      const isolatedCompositor = state.metrics.compositor[isolatedLabel];

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

          state.currentLabel = label;
          const result = await page.evaluate(
            (input) => window.browserPixelSuite.runCase(input),
            specification,
          );

          validateBasicCase(result, dpr);
          caseResults.set(label, result);
          state.metrics.cases[label] = result;
        }
      }
    }

    if (dpr === 1)
    {
      await validateNativeSceneGlow(page);

      for (const mode of modeNames)
      {
        state.currentLabel = `${mode}__transparent-contract-transitions`;
        state.metrics.transparentCompositingTransitions[mode] =
          await runTransparentCompositingTransitions(page, mode);
      }

      state.currentLabel = 'full-webgl2__host-compositing-accuracy';
      state.metrics.hostCompositingAccuracy =
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

        state.currentLabel = referenceLabel;
        const referenceResult = await page.evaluate(
          (input) => window.browserPixelSuite.runCase(input),
          referenceSpecification,
        );

        validateBasicCase(referenceResult, 1);
        state.metrics.cases[referenceLabel] = referenceResult;
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

          state.currentLabel = label;
          await page.evaluate(
            (input) => window.browserPixelSuite.runCase(input),
            specification,
          );
          state.metrics.compositor[label] = await captureCompositorMetrics(page);
        }

        assert(
          state.metrics.compositor[`${mode}__css-black__dpr-1`].meanEnergy <
            state.metrics.compositor[`${mode}__css-white__dpr-1`].meanEnergy,
          `${mode}: Chromium 黑白 CSS 背景没有形成可检测差异`,
        );
        const blackCenter =
          state.metrics.compositor[`${mode}__css-black__dpr-1`].center;
        const whiteCenter =
          state.metrics.compositor[`${mode}__css-white__dpr-1`].center;
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

        state.currentLabel = shadowLabel;
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
        state.metrics.cases[shadowLabel] = shadowResult;
        state.metrics.compositor[shadowLabel] = await captureCompositorMetrics(page);
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

        state.currentLabel = label;
        const result = await page.evaluate(
          (input) => window.browserPixelSuite.runCase(input),
          specification,
        );

        webGLTrailResults.set(mode, result);
        state.metrics.cases[label] = result;
      }

      validateWebGLTrailPair(
        webGLTrailResults.get('full-webgl2'),
        webGLTrailResults.get('webgl2-bloom'),
      );

      for (const mode of ['full-webgl2', 'webgl2-bloom'])
      {
        state.currentLabel = `${mode}__straight-trail-probe__dpr-1`;
        validateWebGLTrailProbe(
          webGLTrailResults.get(mode),
          state.currentLabel,
        );
      }

      state.currentLabel = 'webgl2__straight-trail-v-direction__dpr-1';
      validateWebGLTrailDirections(
        webGLTrailResults.get('full-webgl2'),
        webGLTrailResults.get('webgl2-bloom'),
      );

      state.currentLabel = 'compositing-reference-reset';
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
      state.metrics.compositingReferenceReset = compositingReferenceReset;

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

            state.currentLabel = label;
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
            state.metrics.cases[label] = result;
          }
        }

        state.metrics.contrastCompositing[isolationLabel] =
          await validateContrastCompositing(
            page,
            contrastCases,
            isolationLabel,
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
    if (dpr === devicePixelRatios.at(-1))
    {
      // 末尾跨 DPR 合同失败时，统一 runner 仍可截取最后的真实夹具。
      finalSession = session;
    }
    else
    {
      await page.evaluate(() => window.browserPixelSuite.dispose());
      await session.context.close();
    }
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

      state.currentLabel = `${mode}__${suffix}__dpr-contract`;
      validateDprPair(dprOne, dprTwo, `${mode}/${suffix}`);
    }
  }

  for (const mode of ['native'])
  {
    for (const variant of ['click-only', 'trail-only'])
    {
      state.currentLabel = `${mode}__${variant}__dpr-contract`;
      validateDprPair(
        caseResults.get(`${mode}__${variant}__isolated__dpr-1`),
        caseResults.get(`${mode}__${variant}__isolated__dpr-2`),
        `${mode}/${variant}`,
      );
    }
  }

  await finalSession?.page.evaluate(() => window.browserPixelSuite.dispose());
  await finalSession?.context.close();

  return calibration;
}

export async function runCoreSuite({ browser, baseUrl, baseline, calibrate = false, state: nextState })
{
  state = nextState ?? createRuntimeState();
  setRuntimeState(state);
  return runCoreMatrix(browser, baseUrl, baseline, calibrate);
}
