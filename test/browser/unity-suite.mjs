import * as common from './browser-common.mjs';

const {
  assert,
  createRuntimeState,
  modeNames,
  openFixture,
  setRuntimeState,
} = common;

let state = null;

function initializeUnityMetrics(metrics)
{
  metrics.prefabCountContracts = {};
}

function validatePrefabCountContract(result)
{
  const runtime = result.runtime;

  assert(
    result.route.resolvedEffectBackend === result.expectedRoute.effectBackend &&
      result.route.resolvedBloomBackend === result.expectedRoute.bloomBackend,
    `${state.currentLabel}: 长拖尾数量夹具没有停留在请求的渲染后端`,
    {
      expected: result.expectedRoute,
      route: result.route,
    },
  );
  assert(
    runtime.configuredRingCount === 2 &&
      runtime.configuredClickShardCount === 4 &&
      runtime.configuredTrailShardLimit === 50,
    `${state.currentLabel}: Unity Prefab 数量真值发生变化`,
    runtime,
  );
  assert(
    runtime.waveCount === 1 &&
      runtime.ringCount === runtime.configuredRingCount,
    `${state.currentLabel}: 单次点击没有生成 Prefab 定义的 2 个圆环`,
    runtime,
  );
  assert(
    runtime.clickShardCount === runtime.configuredClickShardCount,
    `${state.currentLabel}: 单次点击没有生成 Prefab 定义的 4 个点击碎片`,
    runtime,
  );
  assert(
    runtime.trailShardCount === runtime.configuredTrailShardLimit,
    `${state.currentLabel}: 单个拖尾实例没有在 Prefab 定义的 50 个碎片处封顶`,
    runtime,
  );
  assert(
    runtime.shardCount ===
      runtime.clickShardCount + runtime.trailShardCount,
    `${state.currentLabel}: 碎片分类计数未覆盖全部运行时粒子`,
    runtime,
  );
}

async function runPrefabCountContracts(page)
{
  for (const mode of modeNames)
  {
    const label = `${mode}__unity-prefab-count-contract`;

    state.currentLabel = label;
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
    state.metrics.prefabCountContracts[mode] =
    {
      route: result.route,
      runtime: result.runtime,
    };
  }
}

async function runUnityCountGate(browserInstance, baseUrl)
{
  state.currentLabel = 'unity-prefab-count-fixture-startup';
  const session = await openFixture(browserInstance, baseUrl, 1);
  let completed = false;

  state.currentPage = session.page;
  state.metrics.environment.dpr1 = session.capabilities;

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
    completed = true;
  }
  finally
  {
    if (completed)
    {
      await session.page.evaluate(
        () => window.browserPixelSuite.dispose(),
      ).catch(() => {});
      await session.context.close();
      state.currentPage = null;
    }
  }
}

export async function runUnitySuite({ browser, baseUrl, state: nextState })
{
  state = nextState ?? createRuntimeState();
  initializeUnityMetrics(state.metrics);
  setRuntimeState(state);
  await runUnityCountGate(browser, baseUrl);
  return state;
}
