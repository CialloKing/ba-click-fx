import * as common from './browser-common.mjs';

const {
  assert,
  compareScreenshotBuffers,
  createRuntimeState,
  setRuntimeState,
} = common;

let state = null;

function initializeDemoMetrics(metrics)
{
  Object.assign(
    metrics,
    {
      demoTimeScaleControls: null,
      demoMobileTouch: null,
      demoControlPanelStructure: null,
      demoBackgroundFile: null,
      demoPureWhiteIsolation: null,
    },
  );
}

async function runDemoTimeScaleControlSmoke(browserInstance, baseUrl)
{
  state.currentLabel = 'demo-time-scale-controls';
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
  let completed = false;
  const page = await context.newPage();

  try
  {
    state.currentPage = page;
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
    state.metrics.demoTimeScaleControls = controlState;
    completed = true;
  }
  finally
  {
    if (completed)
    {
      await context.close();
      state.currentPage = null;
    }
  }
}

async function runDemoMobileTouchSmoke(browserInstance, baseUrl)
{
  state.currentLabel = 'demo-mobile-touch-action';
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
  let completed = false;
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
    state.currentPage = page;
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
      state.currentLabel =
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
        `${state.currentLabel}: 移动触摸拖尾生命周期不符合触摸策略`,
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
        `${state.currentLabel}: 原生滚动方向与触摸策略不一致`,
        result,
      );
      results.push({ specification, result });
    }

    state.currentLabel = 'demo-mobile-touch-input-filter';
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

    state.currentLabel = 'demo-mobile-touch-shadow-target';
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

    state.metrics.demoMobileTouch = results;
    completed = true;
  }
  finally
  {
    if (completed)
    {
      await context.close();
      state.currentPage = null;
    }
  }
}

async function runDemoControlPanelStructureSmoke(browserInstance, baseUrl)
{
  state.currentLabel = 'demo-control-panel-structure';
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
  let completed = false;
  const page = await context.newPage();

  try
  {
    state.currentPage = page;
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
    state.metrics.demoControlPanelStructure =
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
    completed = true;
  }
  finally
  {
    if (completed)
    {
      await context.close();
      state.currentPage = null;
    }
  }
}

async function runDemoBackgroundFileSmoke(browserInstance, baseUrl)
{
  state.currentLabel = 'demo-local-background-file';
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
  let completed = false;
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
    state.currentPage = page;
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
    state.metrics.demoBackgroundFile =
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
    completed = true;
  }
  finally
  {
    if (completed)
    {
      await context.close();
      state.currentPage = null;
    }
  }
}

async function runDemoPureWhiteIsolationSmoke(browserInstance, baseUrl)
{
  state.currentLabel = 'demo-pure-white-isolation';
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
  let completed = false;
  const page = await context.newPage();

  try
  {
    state.currentPage = page;
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

      state.currentLabel = `demo-pure-white-isolation-${mode}`;

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
    state.metrics.demoPureWhiteIsolation =
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
    completed = true;
  }
  finally
  {
    if (completed)
    {
      await context.close();
      state.currentPage = null;
    }
  }
}

export async function runDemoSuite({ browser, baseUrl, state: nextState })
{
  state = nextState ?? createRuntimeState();
  initializeDemoMetrics(state.metrics);
  setRuntimeState(state);
  await runDemoMobileTouchSmoke(browser, baseUrl);
  await runDemoTimeScaleControlSmoke(browser, baseUrl);
  await runDemoControlPanelStructureSmoke(browser, baseUrl);
  await runDemoBackgroundFileSmoke(browser, baseUrl);
  await runDemoPureWhiteIsolationSmoke(browser, baseUrl);
  return state;
}
