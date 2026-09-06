import * as common from './browser-common.mjs';

const {
  assert,
  collectLifecycleTimeline,
  createRuntimeState,
  lifecycleSampleTimes,
  opacities,
  openFixture,
  setRuntimeState,
  validateBackendFailureChain,
  validateBackendReentrantNative,
  validateCompositingReferenceContextLifecycle,
  validateContextLifecycleGroup,
  validateContextLifecycleRoute,
  validateDirectCompositingContract,
  validateEffectLifecycle,
  validateTrailBackendFailureChain,
  validateTrailContextLifecycle,
  validateTransparentContractContext,
} = common;

let state = null;

async function runEffectLifecycleContracts(page, mode)
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

  state.currentLabel = `${mode}__effect-lifecycle`;
  validateEffectLifecycle(mode, timelines);
  state.metrics.effectLifecycle[mode] = Object.fromEntries(
    Object.entries(timelines).map(([variant, timeline]) =>
      [variant, Object.fromEntries(timeline)]),
  );
}

async function runLifecycleMatrix(browserInstance, baseUrl)
{
  state.currentLabel = 'trail-texture-resource-fixture-startup';
  const trailResourceSession = await openFixture(browserInstance, baseUrl, 1);

  state.currentPage = trailResourceSession.page;
  state.currentLabel = 'trail-texture-resource-lifecycle';
  const trailTextureResourceLifecycle =
    await trailResourceSession.page.evaluate(
      () => window.browserPixelSuite.runTrailTextureResourceLifecycle(),
    );

  assert(
    Object.values(trailTextureResourceLifecycle).every(Boolean),
    'Trail 静态纹理的闲置释放或销毁合同失败',
    trailTextureResourceLifecycle,
  );
  state.metrics.trailTextureResourceLifecycle = trailTextureResourceLifecycle;
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
    state.currentLabel = `${mode}__context-fixture-startup`;
    const contextSession = await openFixture(browserInstance, baseUrl, 1);
    const contextResults = new Map();

    state.currentPage = contextSession.page;
    await runEffectLifecycleContracts(contextSession.page, mode);
    for (const opacity of opacities)
    {
      state.currentLabel = `${mode}__context-lifecycle-opacity-${opacity}`;
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

    state.currentLabel = `${mode}__context-lifecycle`;
    validateContextLifecycleGroup(mode, contextResults);
    state.metrics.contextLifecycle[mode] = Object.fromEntries(contextResults);

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
      state.currentLabel =
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

    state.metrics.transparentContractContextLifecycle[mode] =
      transparentContractLifecycles;

    if (mode === 'full-webgl2')
    {
      state.currentLabel = 'full-webgl2__compositing-reference-context-lifecycle';
      const compositingReferenceContextLifecycle =
        await contextSession.page.evaluate(
          () => window.browserPixelSuite.runCompositingReferenceContextLifecycle(),
        );

      validateCompositingReferenceContextLifecycle(
        compositingReferenceContextLifecycle,
      );
      state.metrics.compositingReferenceContextLifecycle =
        compositingReferenceContextLifecycle;
    }

    state.currentLabel = `${mode}__backend-reentrant-native`;
    const reentrantNative = await contextSession.page.evaluate(
      (input) => window.browserPixelSuite.runBackendReentrantNative(input),
      mode,
    );

    validateBackendReentrantNative(mode, reentrantNative);
    state.metrics.backendReentrantNative[mode] = reentrantNative;

    const failureChainResults = new Map();

    for (const opacity of opacities)
    {
      state.currentLabel = `${mode}__backend-failure-chain-opacity-${opacity}`;
      const chain = await contextSession.page.evaluate(
        (input) => window.browserPixelSuite.runBackendFailureChain(input),
        {
          mode,
          opacity,
        },
      );

      failureChainResults.set(opacity, chain);
    }

    state.currentLabel = `${mode}__backend-failure-chain`;
    validateBackendFailureChain(mode, failureChainResults);
    state.metrics.backendFailureChains[mode] = Object.fromEntries(
      failureChainResults,
    );

    state.currentLabel = `${mode}__visual-max-bright-core__backend-failure-chain`;
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
    state.metrics.transparentContractFailureChains[mode] =
      transparentContractFailureChain;

    const trailFailureChainResults = new Map();

    for (const opacity of opacities)
    {
      state.currentLabel =
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

    state.currentLabel = `${mode}__trail-backend-failure-chain`;
    validateTrailBackendFailureChain(mode, trailFailureChainResults);
    state.metrics.trailBackendFailureChains[mode] = Object.fromEntries(
      trailFailureChainResults,
    );

    const trailLifecycles = {};

    for (const outputCompositing of ['scene', 'browser-overlay'])
    {
      state.currentLabel =
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

    state.metrics.trailContextLifecycle[mode] = trailLifecycles;

    const directSpecification =
    {
      mode,
      opacity: 1,
      isolatedCompositing: false,
    };

    state.currentLabel = `${mode}__direct-context-lifecycle`;
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
    state.metrics.contextLifecycle[`${mode}-direct`] = directContextLifecycle;

    state.currentLabel = `${mode}__direct-backend-failure-chain`;
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
    state.metrics.backendFailureChains[`${mode}-direct`] = directFailureChain;

    state.currentLabel = `${mode}__direct-backend-reentrant-native`;
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
    state.metrics.backendReentrantNative[`${mode}-direct`] =
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

}

export async function runLifecycleSuite({ browser, baseUrl, state: nextState })
{
  state = nextState ?? createRuntimeState();
  setRuntimeState(state);
  await runLifecycleMatrix(browser, baseUrl);
}
