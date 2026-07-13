/**
 * ba-click-fx smoke test
 *
 * 验证：模块加载、类实例化、全部 API 签名、setter 调用无异常、
 *       配置隔离、resetConfig 恢复默认值、生命周期方法。
 * 运行方式：npm test（构建产物）或 npm run test:source（源码）
 *
 * 注意：Node.js 下使用最小 DOM mock 验证实例配置隔离。
 * 完整渲染测试仍需使用 Playwright 打开演示页。
 */

const modulePath = process.argv.includes('--source')
  ? '../src/ba-spark.js'
  : '../dist/ba-click-fx.js';
const { BAClickFX } = await import(modulePath);

let passed = 0;
let failed = 0;
const inBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';
let activeDomMock = null;

class MockEventTarget
{
  constructor()
  {
    this._listeners = new Map();
    this._capturedPointers = new Set();
    this.captureError = null;
  }

  addEventListener(type, listener)
  {
    if (activeDomMock)
    {
      activeDomMock.listenerCallCount++;

      if (activeDomMock.listenerFailureAt === activeDomMock.listenerCallCount)
      {
        throw new Error('listener registration failed');
      }
    }

    if (!this._listeners.has(type))
    {
      this._listeners.set(type, new Set());
    }

    this._listeners.get(type).add(listener);
    activeDomMock?.listenerAdds.push({ target: this, type, listener });
  }

  removeEventListener(type, listener)
  {
    this._listeners.get(type)?.delete(listener);
    activeDomMock?.listenerRemoves.push({ target: this, type, listener });
  }

  dispatchEvent(event)
  {
    if (!event || !event.type)
    {
      throw new Error('Mock Event 必须包含 type');
    }

    if (!event.target)
    {
      event.target = this;
    }

    event.currentTarget = this;

    for (const listener of [...(this._listeners.get(event.type) ?? [])])
    {
      if (typeof listener === 'function')
      {
        listener.call(this, event);
      }
      else
      {
        listener.handleEvent(event);
      }
    }

    return !event.defaultPrevented;
  }

  listenerCount(type)
  {
    if (type)
    {
      return this._listeners.get(type)?.size ?? 0;
    }

    let count = 0;

    for (const listeners of this._listeners.values())
    {
      count += listeners.size;
    }

    return count;
  }

  setPointerCapture(pointerId)
  {
    activeDomMock?.captureAttempts.push({ target: this, pointerId });

    if (this.captureError)
    {
      throw this.captureError;
    }

    this._capturedPointers.add(pointerId);
    activeDomMock?.captureOwners.set(pointerId, this);
  }

  releasePointerCapture(pointerId)
  {
    activeDomMock?.captureReleases.push({ target: this, pointerId });
    this._capturedPointers.delete(pointerId);

    if (activeDomMock?.captureOwners.get(pointerId) === this)
    {
      activeDomMock.captureOwners.delete(pointerId);
    }
  }

  hasPointerCapture(pointerId)
  {
    return this._capturedPointers.has(pointerId);
  }
}

class MockResizeObserver
{
  constructor(callback)
  {
    this.callback = callback;
    this.observedTargets = new Set();
    this.disconnected = false;
    activeDomMock?.resizeObservers.push(this);
  }

  observe(target)
  {
    this.observedTargets.add(target);
  }

  unobserve(target)
  {
    this.observedTargets.delete(target);
  }

  disconnect()
  {
    this.disconnected = true;
    this.observedTargets.clear();
  }

  trigger(target)
  {
    if (this.disconnected || !this.observedTargets.has(target))
    {
      return;
    }

    // ResizeObserverEntry 自带 contentRect；Mock 不额外调用宿主测量方法，
    // 避免测试辅助代码污染被测代码的 getBoundingClientRect 读取次数。
    const contentRect = {
      ...target.rect,
      right: target.rect.left + target.rect.width,
      bottom: target.rect.top + target.rect.height,
    };

    this.callback([{ target, contentRect }], this);
  }
}

class MockMediaQueryList extends MockEventTarget
{
  constructor(media)
  {
    super();
    this.media = media;
    this.matches = true;
  }

  addListener(listener)
  {
    this.addEventListener('change', listener);
  }

  removeListener(listener)
  {
    this.removeEventListener('change', listener);
  }

  dispatchChange()
  {
    this.dispatchEvent({
      type: 'change',
      matches: this.matches,
      media: this.media,
    });
  }
}

class MockStyle
{
  constructor(initial = {})
  {
    this.cssText = '';
    this._propertyPriorities = new Map();
    Object.assign(this, initial);
  }

  getPropertyValue(name)
  {
    if (name === 'touch-action')
    {
      return this.touchAction ?? '';
    }

    return this[name] ?? '';
  }

  getPropertyPriority(name)
  {
    return this._propertyPriorities.get(name) ?? '';
  }

  setProperty(name, value, priority = '')
  {
    if (name === 'touch-action')
    {
      this.touchAction = value;
    }
    else
    {
      this[name] = value;
    }

    if (priority)
    {
      this._propertyPriorities.set(name, priority);
    }
    else
    {
      this._propertyPriorities.delete(name);
    }
  }

  removeProperty(name)
  {
    this._propertyPriorities.delete(name);

    if (name === 'touch-action')
    {
      delete this.touchAction;
      return;
    }

    delete this[name];
  }
}

class MockHTMLElement extends MockEventTarget
{
  constructor()
  {
    super();
    this.tagName = 'DIV';
    this.style = new MockStyle();
    this.parentNode = null;
  }
}

class MockCanvas extends MockHTMLElement
{
  constructor(options = {})
  {
    super();
    this.tagName = 'CANVAS';
    this.style = new MockStyle(options.style);
    this._width = 0;
    this._height = 0;
    this.dimensionWrites = [];
    this.parentNode = null;
    this.rectReadCount = 0;
    this.contextCommands = [];
    this.intrinsicLayout = options.intrinsicLayout === true;
    this.rect = {
      left: options.left ?? 0,
      top: options.top ?? 0,
      width: options.width ?? 320,
      height: options.height ?? 240,
    };

    if (this.intrinsicLayout)
    {
      this._width = this.rect.width;
      this._height = this.rect.height;
    }

    activeDomMock?.canvases.push(this);
  }

  get width()
  {
    return this._width;
  }

  set width(value)
  {
    this.dimensionWrites.push({ axis: 'width', value });
    this._width = value;
  }

  get height()
  {
    return this._height;
  }

  set height(value)
  {
    this.dimensionWrites.push({ axis: 'height', value });
    this._height = value;
  }

  getContext()
  {
    if (activeDomMock)
    {
      activeDomMock.contextCallCount++;

      if (activeDomMock.contextFailureAt === activeDomMock.contextCallCount)
      {
        return null;
      }
    }

    return createMockContext(this.contextCommands);
  }

  getBoundingClientRect()
  {
    this.rectReadCount++;

    const inlineWidth = Number.parseFloat(this.style.width);
    const inlineHeight = Number.parseFloat(this.style.height);
    const width = this.intrinsicLayout
      ? Number.isFinite(inlineWidth)
        ? inlineWidth
        : this.width
      : this.rect.width;
    const height = this.intrinsicLayout
      ? Number.isFinite(inlineHeight)
        ? inlineHeight
        : this.height
      : this.rect.height;

    return {
      ...this.rect,
      width,
      height,
      right: this.rect.left + width,
      bottom: this.rect.top + height,
    };
  }

  resetRectReadCount()
  {
    this.rectReadCount = 0;
  }

  resetContextCommands()
  {
    this.contextCommands.length = 0;
  }

  resetDimensionWrites()
  {
    this.dimensionWrites.length = 0;
  }

  getDimensionWriteCount(axis)
  {
    if (axis === undefined)
    {
      return this.dimensionWrites.length;
    }

    return this.dimensionWrites.filter((write) => write.axis === axis).length;
  }
}

function createMockContext(commands)
{
  return new Proxy({}, {
    get(target, prop)
    {
      if (!(prop in target))
      {
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient')
        {
          target[prop] = (...args) =>
          {
            if (commands)
            {
              commands.push([String(prop), ...args]);
            }

            // 渐变色标属于返回对象；单独记录才能比较完整的绘制指令流。
            return {
              addColorStop: (...colorStopArgs) =>
              {
                if (commands)
                {
                  commands.push(['addColorStop', ...colorStopArgs]);
                }
              },
            };
          };
        }
        else
        {
          target[prop] = (...args) =>
          {
            if (commands)
            {
              commands.push([String(prop), ...args]);
            }
          };
        }
      }

      return target[prop];
    },
  });
}

function installDomMock()
{
  const previous = {
    HTMLElement: globalThis.HTMLElement,
    ResizeObserver: globalThis.ResizeObserver,
    matchMedia: globalThis.matchMedia,
    document: globalThis.document,
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  const controller = {
    canvases: [],
    listenerAdds: [],
    listenerRemoves: [],
    listenerCallCount: 0,
    listenerFailureAt: null,
    captureAttempts: [],
    captureReleases: [],
    captureOwners: new Map(),
    contextCallCount: 0,
    contextFailureAt: null,
    resizeObservers: [],
    mediaQueries: [],
    matchMediaCalls: [],
    rafCallbacks: new Map(),
    rafRequested: 0,
    rafCanceled: 0,
    nextRafId: 1,
    timerCallbacks: new Map(),
    timerRequested: 0,
    timerCanceled: 0,
    nextTimerId: 1,
    eventTime: 1,
  };
  activeDomMock = controller;

  const body = new MockEventTarget();
  body.children = [];
  body.appendChild = function (el)
  {
    if (!body.children.includes(el))
    {
      body.children.push(el);
    }

    el.parentNode = body;
  };
  body.removeChild = function (el)
  {
    const index = body.children.indexOf(el);

    if (index >= 0)
    {
      body.children.splice(index, 1);
    }

    el.parentNode = null;
  };

  const mockWindow = new MockEventTarget();
  mockWindow.innerWidth = 320;
  mockWindow.innerHeight = 240;
  mockWindow.devicePixelRatio = 1;
  mockWindow.visualViewport = new MockEventTarget();
  mockWindow.visualViewport.width = 320;
  mockWindow.visualViewport.height = 240;
  mockWindow.ResizeObserver = MockResizeObserver;
  mockWindow.matchMedia = (query) =>
  {
    const mediaQuery = new MockMediaQueryList(query);

    controller.matchMediaCalls.push(query);
    controller.mediaQueries.push(mediaQuery);
    return mediaQuery;
  };

  globalThis.HTMLElement = MockHTMLElement;
  globalThis.ResizeObserver = MockResizeObserver;
  globalThis.matchMedia = mockWindow.matchMedia;
  globalThis.document = {
    appendChild(el)
    {
      body.appendChild(el);
    },
    body,
    documentElement: body,
    createElement(tag)
    {
      if (tag === 'canvas')
      {
        return new MockCanvas();
      }

      return new MockHTMLElement();
    },
    getElementById(id)
    {
      return body.children.find((element) => element.id === id) ?? null;
    },
    querySelector()
    {
      return null;
    },
  };
  globalThis.window = mockWindow;
  globalThis.requestAnimationFrame = (callback) =>
  {
    const id = controller.nextRafId++;

    controller.rafRequested++;
    controller.rafCallbacks.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) =>
  {
    controller.rafCanceled++;
    controller.rafCallbacks.delete(id);
  };
  globalThis.setTimeout = (callback, delay = 0) =>
  {
    const id = controller.nextTimerId++;

    controller.timerRequested++;
    controller.timerCallbacks.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = (id) =>
  {
    controller.timerCanceled++;
    controller.timerCallbacks.delete(id);
  };

  controller.body = body;
  controller.window = mockWindow;
  controller.visualViewport = mockWindow.visualViewport;
  controller.dispatchWindow = (type, properties = {}) =>
  {
    const event = {
      type,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: 0,
      clientY: 0,
      timeStamp: controller.eventTime++,
      defaultPrevented: false,
      preventDefault()
      {
        this.defaultPrevented = true;
      },
      ...properties,
    };

    mockWindow.dispatchEvent(event);
    return event;
  };
  controller.flushAnimationFrame = (now = 16.67) =>
  {
    const callbacks = [...controller.rafCallbacks.values()];

    controller.rafCallbacks.clear();

    for (const callback of callbacks)
    {
      callback(now);
    }
  };
  controller.flushTimers = () =>
  {
    const timers = [...controller.timerCallbacks.values()];

    controller.timerCallbacks.clear();

    for (const timer of timers)
    {
      timer.callback();
    }
  };
  controller.dispatchResize = (target) =>
  {
    for (const observer of controller.resizeObservers)
    {
      observer.trigger(target);
    }
  };
  controller.dispatchVisualViewportResize = () =>
  {
    mockWindow.visualViewport.dispatchEvent({ type: 'resize' });
  };
  controller.dispatchMediaChange = (mediaQuery = controller.mediaQueries.at(-1), matches = false) =>
  {
    if (mediaQuery)
    {
      // DPR 改变时，旧 resolution 查询会从匹配变为不匹配。
      mediaQuery.matches = matches;
    }

    mediaQuery?.dispatchChange();
  };
  controller.activeResizeObserverCount = () => controller.resizeObservers.filter(
    (observer) => !observer.disconnected && observer.observedTargets.size > 0,
  ).length;
  controller.activeMediaListenerCount = () => controller.mediaQueries.reduce(
    (count, mediaQuery) => count + mediaQuery.listenerCount('change'),
    0,
  );
  controller.resetActivity = () =>
  {
    controller.captureAttempts.length = 0;
    controller.captureReleases.length = 0;
    controller.listenerAdds.length = 0;
    controller.listenerRemoves.length = 0;
    controller.rafRequested = 0;
    controller.rafCanceled = 0;
    controller.timerRequested = 0;
    controller.timerCanceled = 0;
  };
  controller.restore = () =>
  {
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.ResizeObserver = previous.ResizeObserver;
    globalThis.matchMedia = previous.matchMedia;
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
    globalThis.setTimeout = previous.setTimeout;
    globalThis.clearTimeout = previous.clearTimeout;
    activeDomMock = null;
  };

  return controller;
}

function assert(condition, message)
{
  if (condition)
  {
    passed++;
    console.log(`  ✓ ${message}`);
  }
  else
  {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

// ═══════════════════════════════════════════════
// 测试 1: 模块导出
// ═══════════════════════════════════════════════
console.log('1. 模块导出');
assert(typeof BAClickFX === 'function', 'BAClickFX 应为构造函数');
assert(BAClickFX.prototype.constructor === BAClickFX, 'prototype.constructor 应指向自身');

// ═══════════════════════════════════════════════
// 测试 2: 全部公共 API 方法存在性检查
// ═══════════════════════════════════════════════
console.log('2. 公共 API 方法检查');

const proto = BAClickFX.prototype;

// 从 .d.ts 提取的完整 API 列表
const allMethods = [
  // 基础
  'setColor', 'setScale', 'setOpacity', 'setSpeed',
  'setDpr', 'setTrailRenderScale', 'setRenderOptions', 'refreshSize', 'getRenderMetrics',
  'setTouchAction',
  // 发光
  'setGlow', 'setFakeGlow', 'setClickFakeGlow',
  // 点击
  'setClick', 'setClickTotalLife', 'setClickScaleMul',
  'setClickHaloRadius', 'setClickShardFlicker', 'setSparksCount',
  // 圆盘
  'setDiskSize', 'setDiskGlow', 'setDiskTiming',
  // 圆环
  'setRingRotationSpeed', 'setRingEmission', 'setRingWidth',
  'setRingWidthEndMul', 'setRingAlpha', 'setRingWhiteMix',
  'setRingDelay', 'setRingMaxLife', 'setRingBaseRadiusMul',
  'setRingRadiusGrowEnd', 'setRingPostDiskGrow',
  'setRingGlowRadiusAdd', 'setRingSoftGlowRadiusAdd',
  'setRingGlowAlpha', 'setRingSoftGlowAlpha',
  'setRingColorFadeStart', 'setRingColorEndWhiteMix',
  'setRingArcLength', 'setRingRotationJitter', 'setRingSegmentCount',
  'setRingSmallRadius', 'setRingSegmentDetail', 'setRingRadiusJitter',
  'setRingNormalGrow', 'setRingCollapseTiming',
  // 拖尾
  'setTrail', 'setTrailAlways', 'setTrailOutsideBehavior',
  'setTrailBrightness', 'setTrailWhiteMix',
  'setTrailWidth', 'setTrailLength', 'setTrailLife', 'setTrailDecay',
  'setTrailSpeedDecay', 'setTrailSpeedRange',
  'setTrailSampling', 'setTrailRenderSampling', 'setTrailSmooth',
  'setTrailGradientChunk', 'setTrailMaxPoints',
  'setTrailCoreWidth', 'setTrailHotWidth',
  'setTrailMinDistance', 'setTrailMaxJumpDistance', 'setTrailMaxCoalescedEvents',
  'setTrailRailWidth', 'setTrailRibbon',
  'setTrailGlowRadius', 'setTrailGlowIntensity',
  // 拖尾图层
  'setTrailLayerAlpha', 'setTrailMainAlpha', 'setTrailCoreAlpha',
  'setTrailHotAlpha', 'setTrailGlowAlpha', 'setTrailSoftGlowAlpha',
  'setTrailRailAlpha', 'setTrailGlowWidthMul', 'setTrailSoftGlowWidthMul',
  // 拖尾衰减/速度
  'setTrailTailDecayMul', 'setTrailHeadDecayMul', 'setTrailReleaseDecayMul',
  'setTrailSpeedMin', 'setTrailSpeedMax',
  // 碎片
  'setMoveSparkChance', 'setShardSpacing', 'setShardChance',
  'setShardLargeChance', 'setMaxShards',
  'setTrailShardFlicker', 'setTrailShardOffset',
  // 操作
  'clearTrail', 'boom', 'getConfig', 'resetConfig', 'destroy',
];

let methodCount = 0;

for (const m of allMethods)
{
  if (typeof proto[m] === 'function')
  {
    methodCount++;
  }
  else
  {
    assert(false, `BAClickFX.prototype.${m} 应为函数`);
  }
}

assert(methodCount === allMethods.length, `全部 ${allMethods.length} 个公共方法存在 (${methodCount}/${allMethods.length})`);
assert(allMethods.length === 98, `公共方法基线应为 98 个，实际 ${allMethods.length} 个`);

// 检查 prototype 上是否有意外的公共方法（排除 _ 开头和 constructor）
const protoKeys = Object.getOwnPropertyNames(proto).filter(
  (k) => k !== 'constructor' && !k.startsWith('_') && typeof proto[k] === 'function',
);
const unexpected = protoKeys.filter((k) => !allMethods.includes(k));

assert(unexpected.length === 0, `不应存在未记录的公共方法: ${unexpected.join(', ') || '无'}`);

// ═══════════════════════════════════════════════
// 测试 3: 实例化 + 配置隔离
// ═══════════════════════════════════════════════
console.log('3. 实例化 + 配置隔离');

if (inBrowser)
{
  try
  {
    const spark = new BAClickFX();
    assert(spark instanceof BAClickFX, '实例应为 BAClickFX 类型');

    const config = spark.getConfig();
    assert(config && typeof config === 'object', 'getConfig() 应返回对象');
    assert(Array.isArray(config.color) && config.color.length === 3, 'config.color 应为 [r,g,b]');

    spark.destroy();
    assert(true, 'destroy() 正常返回');
  }
  catch (e)
  {
    assert(false, `实例化失败: ${e.message}`);
  }
}
else
{
  const dom = installDomMock();

  try
  {
    const first = new BAClickFX({ target: new MockCanvas() });
    const second = new BAClickFX({
      target: new MockCanvas(),
      color: [1, 2, 3],
      scale: 2,
    });
    const initialConfig = first.getConfig();

    first.setColor(10, 20, 30);
    assert(
      second.getConfig().color.join(',') === '1,2,3',
      '两个实例的 color 配置应互相隔离',
    );

    second.setScale(1.8);
    assert(first.getConfig().scale !== second.getConfig().scale, '两个实例的 scale 配置应互相隔离');

    // ═══════════════════════════════════════════════
    // 测试 4: 全部 setter 调用无异常
    // ═══════════════════════════════════════════════
    console.log('4. 全部 setter 调用无异常');

    const setterCalls = [
      // 基础
      () => first.setColor(100, 150, 255),
      () => first.setScale(1.5),
      () => first.setOpacity(0.8),
      () => first.setSpeed(1.2, 1.3),
      () => first.setDpr(1),
      () => first.setTrailRenderScale(0.75),
      () => first.setRenderOptions({
        maxDpr: 1,
        minRenderScale: 0.5,
        trailRenderScale: 0.75,
        maxBackingPixels: null,
      }),
      () => first.refreshSize(),
      () => first.getRenderMetrics(),
      () => first.setTouchAction('none'),
      // 发光
      () => first.setGlow(true),
      () => first.setGlow(false),
      () => first.setFakeGlow(false),
      () => first.setFakeGlow(true),
      () => first.setClickFakeGlow(false),
      () => first.setClickFakeGlow(true),
      // 点击
      () => first.setClick(false),
      () => first.setClick(true),
      () => first.setClickTotalLife(30),
      () => first.setClickScaleMul(1.5),
      () => first.setClickHaloRadius(120),
      () => first.setClickShardFlicker(10, 0.3),
      () => first.setSparksCount(6),
      // 圆盘
      () => first.setDiskSize(30),
      () => first.setDiskGlow(5.0, 0.2),
      () => first.setDiskTiming(15, 0.9, 0.4, 0.8),
      // 圆环
      () => first.setRingRotationSpeed(0.01),
      () => first.setRingEmission(0.5),
      () => first.setRingWidth(1.2, 5.0),
      () => first.setRingWidthEndMul(0.4),
      () => first.setRingAlpha(0.8),
      () => first.setRingWhiteMix(0.6),
      () => first.setRingDelay(3),
      () => first.setRingMaxLife(30),
      () => first.setRingBaseRadiusMul(0.5),
      () => first.setRingRadiusGrowEnd(0.7),
      () => first.setRingPostDiskGrow(30),
      () => first.setRingGlowRadiusAdd(60),
      () => first.setRingSoftGlowRadiusAdd(100),
      () => first.setRingGlowAlpha(0.2),
      () => first.setRingSoftGlowAlpha(0.1),
      () => first.setRingColorFadeStart(0.6),
      () => first.setRingColorEndWhiteMix(0.9),
      () => first.setRingArcLength(5.0, 1.2),
      () => first.setRingRotationJitter(0.6, 1.4),
      () => first.setRingSegmentCount(3, 4),
      () => first.setRingSmallRadius(0.8, 0.95),
      () => first.setRingSegmentDetail(0.1, 0.4, 0.5, 1.2),
      () => first.setRingRadiusJitter(0.4, 0.9),
      () => first.setRingNormalGrow(0.9, 1.1),
      () => first.setRingCollapseTiming(0.2, 0.2, 0.9),
      // 拖尾
      () => first.setTrail(false),
      () => first.setTrail(true),
      () => first.setTrailAlways(true),
      () => first.setTrailAlways(false),
      () => first.setTrailOutsideBehavior('pause-connect'),
      () => first.setTrailOutsideBehavior('continue'),
      () => first.setTrailOutsideBehavior('auto'),
      () => first.setTrailBrightness(0.9),
      () => first.setTrailWhiteMix(0.3),
      () => first.setTrailWidth(4, 3),
      () => first.setTrailLength(1000, 5000),
      () => first.setTrailLife(25, 25),
      () => first.setTrailDecay(1.3, 0.9, 1.2),
      () => first.setTrailSpeedDecay(0.99),
      () => first.setTrailSpeedRange(0.05, 2.5),
      () => first.setTrailSampling(1.0, 60),
      () => first.setTrailRenderSampling(0.8, 2000),
      () => first.setTrailSmooth(0.6),
      () => first.setTrailGradientChunk(2.0),
      () => first.setTrailMaxPoints(15000),
      () => first.setTrailCoreWidth(0.4, 0.6),
      () => first.setTrailHotWidth(0.15, 0.3),
      () => first.setTrailMinDistance(0.1),
      () => first.setTrailMaxJumpDistance(500),
      () => first.setTrailMaxCoalescedEvents(20),
      () => first.setTrailRailWidth(0.3, 0.4),
      () => first.setTrailRibbon(0.5, 0.1),
      () => first.setTrailGlowRadius(20),
      () => first.setTrailGlowIntensity(0.2),
      // 拖尾图层
      () => first.setTrailLayerAlpha(0.9, 0.7, 0.3, 0.15, 0.04, 0.02),
      () => first.setTrailMainAlpha(0.95),
      () => first.setTrailCoreAlpha(0.7),
      () => first.setTrailHotAlpha(0.3),
      () => first.setTrailGlowAlpha(0.15),
      () => first.setTrailSoftGlowAlpha(0.04),
      () => first.setTrailRailAlpha(0.015),
      () => first.setTrailGlowWidthMul(2.0),
      () => first.setTrailSoftGlowWidthMul(3.0),
      // 拖尾衰减/速度
      () => first.setTrailTailDecayMul(1.4),
      () => first.setTrailHeadDecayMul(0.9),
      () => first.setTrailReleaseDecayMul(1.3),
      () => first.setTrailSpeedMin(0.04),
      () => first.setTrailSpeedMax(2.5),
      // 碎片
      () => first.setMoveSparkChance(0.01),
      () => first.setShardSpacing(150),
      () => first.setShardChance(0.05, 0.2),
      () => first.setShardLargeChance(0.5),
      () => first.setMaxShards(40),
      () => first.setTrailShardFlicker(10, 0.4, 0.2),
      () => first.setTrailShardOffset(3, 30),
      // 操作
      () => first.boom(),
      () => first.boom(160, 120),
      () => first.clearTrail(),
    ];

    let setterErrors = 0;

    for (const call of setterCalls)
    {
      try
      {
        call();
      }
      catch (e)
      {
        setterErrors++;
        assert(false, `setter 调用异常: ${e.message}`);
      }
    }

    assert(setterErrors === 0, `全部 ${setterCalls.length} 个 setter 调用无异常`);

    // ═══════════════════════════════════════════════
    // 测试 5: getConfig 结构验证
    // ═══════════════════════════════════════════════
    console.log('5. getConfig 结构验证');

    const cfg = first.getConfig();
    const expectedKeys = [
      'color', 'scale', 'opacity', 'clickEnabled', 'clickSpeed', 'trailSpeed',
      'maxDpr', 'minRenderScale', 'trailRenderScale', 'maxBackingPixels',
      'touchAction', 'maxDeltaMs', 'baseFrameMs',
      'filledCircle', 'click', 'rings', 'sparksCount', 'trail', 'glow',
    ];

    for (const key of expectedKeys)
    {
      assert(key in cfg, `getConfig() 应包含 key: ${key}`);
    }

    assert(Array.isArray(cfg.color) && cfg.color.length === 3, 'config.color 应为 [r,g,b]');
    assert(typeof cfg.filledCircle === 'object', 'config.filledCircle 应为对象');
    assert(typeof cfg.click === 'object', 'config.click 应为对象');
    assert(typeof cfg.rings === 'object', 'config.rings 应为对象');
    assert(typeof cfg.trail === 'object', 'config.trail 应为对象');
    assert(typeof cfg.glow === 'object', 'config.glow 应为对象');

    // ═══════════════════════════════════════════════
    // 测试 6: resetConfig 恢复默认值
    // ═══════════════════════════════════════════════
    console.log('6. resetConfig 恢复默认值');

    first.setScale(2.5);
    first.setTrailWhiteMix(0.8);
    first.resetConfig();

    const resetCfg = first.getConfig();
    assert(resetCfg.scale === 1.10, `resetConfig 后 scale 应为 1.10，实际 ${resetCfg.scale}`);
    assert(resetCfg.trail.whiteMix === 0.45, `resetConfig 后 trail.whiteMix 应为 0.45，实际 ${resetCfg.trail.whiteMix}`);
    assert(resetCfg.color.join(',') === '105,161,255', 'resetConfig 后 color 应为默认值');
    assert(
      JSON.stringify(resetCfg) === JSON.stringify(initialConfig),
      'resetConfig 后全部默认配置应保持不变',
    );
    assert(second.getConfig().scale === 1.8, 'resetConfig 不应影响其他实例');

    // ═══════════════════════════════════════════════
    // 测试 7: CONFIG getter
    // ═══════════════════════════════════════════════
    console.log('7. CONFIG getter');

    assert(typeof first.CONFIG === 'object', 'CONFIG getter 应返回对象');

    // CONFIG 返回内部引用，getConfig 返回深拷贝
    const configCopy = first.getConfig();
    const liveConfig = first.CONFIG;

    assert(configCopy !== liveConfig, 'getConfig() 与 CONFIG 不应是同一引用');

    configCopy._testMarker = true;
    assert(liveConfig._testMarker === undefined, '修改 getConfig() 副本不应影响 CONFIG');

    // 后续输入测试通过 window 的真实注册监听器派发，避免第二个实例重复消费同一事件。
    second.destroy();

    // ═══════════════════════════════════════════════
    // 测试 8: 无视觉差异的热路径优化
    // ═══════════════════════════════════════════════
    console.log('8. 无视觉差异的热路径优化');

    first.setTrailAlways(true);
    first.setTrailMaxCoalescedEvents(24);
    first.clearTrail();
    first.canvas.resetRectReadCount();
    dom.dispatchWindow('pointermove', {
      target: first.canvas,
      getCoalescedEvents()
      {
        return [
          { clientX: 10, clientY: 20, timeStamp: 10 },
          { clientX: 20, clientY: 30, timeStamp: 20 },
          { clientX: 30, clientY: 40, timeStamp: 30 },
        ];
      },
    });
    assert(
      first.canvas.rectReadCount === 1,
      `一批合并事件应只读取一次画布矩形，实际 ${first.canvas.rectReadCount}`,
    );

    first.setTrailMaxCoalescedEvents(1);
    first.clearTrail();
    let coalescedError = null;

    try
    {
      dom.dispatchWindow('pointermove', {
        target: first.canvas,
        getCoalescedEvents()
        {
          return [
            { clientX: 50, clientY: 60, timeStamp: 40 },
            { clientX: 90, clientY: 70, timeStamp: 50 },
          ];
        },
      });
    }
    catch (error)
    {
      coalescedError = error;
    }

    assert(coalescedError === null, '合并事件上限为 1 时不应抛出异常');
    assert(
      first.lastTrailPos?.x === 90 && first.lastTrailPos?.y === 70,
      '合并事件上限为 1 时应保留最后一个事件坐标',
    );

    const drawCommands = [];
    const drawContext = createMockContext(drawCommands);

    first._drawTriangle(drawContext, 10, 20, 2, 0.25, [100, 150, 255], 0.5);

    const expectedDrawCommands = [
      ['save'],
      ['translate', 10, 20],
      ['rotate', 0.25],
      ['beginPath'],
      ['moveTo', 0, -2],
      ['lineTo', Math.sqrt(3), 1],
      ['lineTo', -Math.sqrt(3), 1],
      ['closePath'],
      ['fill'],
      ['restore'],
    ];

    assert(
      JSON.stringify(drawCommands) === JSON.stringify(expectedDrawCommands),
      '等边三角的 Canvas 路径指令与坐标应保持不变',
    );

    // 前八组测试结束，后续契约测试保证 window 上只存在当前被测实例的监听器。
    first.destroy();
    assert(true, 'Node.js mock 环境实例化和销毁正常返回');

    // ═══════════════════════════════════════════════
    // 测试 9: 点击/拖尾四象限与输入前置门禁
    // ═══════════════════════════════════════════════
    console.log('9. 点击/拖尾四象限与输入前置门禁');

    const quadrantCases = [
      { click: false, trail: false, expectedWaves: 0, expectedTrail: false },
      { click: true, trail: false, expectedWaves: 1, expectedTrail: false },
      { click: false, trail: true, expectedWaves: 0, expectedTrail: true },
      { click: true, trail: true, expectedWaves: 1, expectedTrail: true },
    ];

    for (const quadrant of quadrantCases)
    {
      const target = new MockCanvas({ width: 100, height: 100 });
      const engine = new BAClickFX({
        target,
        clickEnabled: quadrant.click,
        trailEnabled: quadrant.trail,
      });
      let coalescedCalls = 0;

      engine.setTrailSmooth(0);
      dom.flushAnimationFrame(performance.now() + 20);
      target.resetRectReadCount();
      dispatchPointer(dom, 'pointerdown', target, 10, 10, { pointerId: 10 });
      dispatchPointer(dom, 'pointermove', target, 30, 30, {
        pointerId: 10,
        getCoalescedEvents()
        {
          coalescedCalls++;
          return [{ clientX: 30, clientY: 30, timeStamp: 30 }];
        },
      });

      assert(
        engine.waves.length === quadrant.expectedWaves,
        `click=${quadrant.click} trail=${quadrant.trail} 的点击 wave 数量应独立`,
      );
      assert(
        quadrant.expectedTrail ? engine.trailStrokes.length > 0 : engine.trailStrokes.length === 0,
        `click=${quadrant.click} trail=${quadrant.trail} 的 stroke 状态应符合开关`,
      );
      assert(
        quadrant.expectedTrail ? engine.isDown === true : engine.isDown === false,
        `click=${quadrant.click} trail=${quadrant.trail} 不应污染按压状态`,
      );
      assert(
        quadrant.trail ? coalescedCalls === 1 : coalescedCalls === 0,
        `trail=${quadrant.trail} 应在 getCoalescedEvents 之前完成门禁`,
      );
      assert(
        getClickSparks(engine).length === (quadrant.click ? engine.config.sparksCount : 0),
        `click=${quadrant.click} 只控制点击来源碎片`,
      );

      engine.destroy();
    }

    const disabledTarget = new MockCanvas({ width: 100, height: 100 });
    const disabledEngine = new BAClickFX({
      target: disabledTarget,
      clickEnabled: false,
      trailEnabled: false,
      trailAlways: true,
    });
    let disabledCoalescedCalls = 0;

    dom.flushAnimationFrame(performance.now() + 30);
    disabledTarget.resetRectReadCount();

    for (let i = 0; i < 1000; i++)
    {
      dispatchPointer(dom, 'pointermove', disabledTarget, i % 100, i % 100, {
        getCoalescedEvents()
        {
          disabledCoalescedCalls++;
          return [{ clientX: i % 100, clientY: i % 100, timeStamp: i + 1 }];
        },
      });
    }

    assert(disabledCoalescedCalls === 0, '拖尾关闭时 1000 次 move 不应读取合并事件');
    assert(disabledTarget.rectReadCount === 0, '拖尾关闭时 move 不应读取 Canvas 矩形');
    assert(disabledEngine.trailStrokes.length === 0, 'trailAlways 不得绕过拖尾总开关');
    assert(getTrailSparks(disabledEngine).length === 0, '拖尾关闭时不得生成隐藏拖尾碎片');
    disabledEngine.destroy();

    // ═══════════════════════════════════════════════
    // 测试 10: setTrail / clearTrail / setClick 独立契约
    // ═══════════════════════════════════════════════
    console.log('10. setTrail / clearTrail / setClick 独立契约');

    const toggleTarget = new MockCanvas({ width: 120, height: 100 });
    const toggleEngine = new BAClickFX({ target: toggleTarget });

    toggleEngine.setTrailOutsideBehavior('continue');
    toggleEngine.setTrailSmooth(0);
    toggleEngine.setShardSpacing(20);
    toggleEngine.setShardChance(1, 1);
    toggleEngine.setMaxShards(200);
    toggleEngine.setMoveSparkChance(0);
    dispatchPointer(dom, 'pointerdown', toggleTarget, 10, 20, { pointerId: 21 });
    dispatchPointer(dom, 'pointermove', toggleTarget, 110, 20, { pointerId: 21 });

    const preservedWaves = [...toggleEngine.waves];
    const preservedClickSparks = [...getClickSparks(toggleEngine)];
    const trailSparkCount = getTrailSparks(toggleEngine).length;
    const originalRequestRender = toggleEngine._requestRender;
    let disableRenderRequests = 0;

    assert(trailSparkCount > 0, '禁用前应通过实际 Pointer move 生成拖尾碎片');
    assert(hasPointerCapture(dom, 21), 'continue 模式按下时应尝试建立 Pointer Capture');
    toggleEngine.trailCanvas.resetContextCommands();
    toggleEngine._requestRender = function ()
    {
      disableRenderRequests++;
      return originalRequestRender.call(this);
    };
    toggleEngine.setTrail(false);
    toggleEngine._requestRender = originalRequestRender;

    assert(toggleEngine.config.trail.enabled === false, 'setTrail(false) 应关闭总开关');
    assert(toggleEngine.isDown === false, 'setTrail(false) 应复位内部按压状态');
    assert(toggleEngine.lastTrailPos === null, 'setTrail(false) 应清除上次坐标');
    assert(toggleEngine.lastTrailEventTime === 0, 'setTrail(false) 应清除事件时间');
    assert(toggleEngine.trailSpeedFactor === 0, 'setTrail(false) 应清除速度状态');
    assert(toggleEngine.trailSmoothX === null && toggleEngine.trailSmoothY === null, 'setTrail(false) 应清除平滑状态');
    assert(toggleEngine.trailShardDistance === 0, 'setTrail(false) 应清除碎片累计距离');
    assert(toggleEngine.trailStrokes.length === 0 && toggleEngine.currentTrailStroke === null, 'setTrail(false) 应清除全部 stroke');
    assert(getTrailSparks(toggleEngine).length === 0, 'setTrail(false) 应立即回收拖尾来源碎片');
    assert(
      preservedWaves.every((wave) => toggleEngine.waves.includes(wave)) &&
        preservedClickSparks.every((spark) => toggleEngine.sparks.includes(spark)),
      'setTrail(false) 必须保留点击 wave 与点击来源碎片',
    );
    assert(!hasPointerCapture(dom, 21), 'setTrail(false) 应释放拖尾持有的 Pointer Capture');
    assert(disableRenderRequests === 1, 'setTrail(false) 应只请求一次必要重绘');
    assert(
      toggleEngine.trailCanvas.contextCommands.some(([name]) => name === 'clearRect'),
      'setTrail(false) 应立即清除 trail Canvas',
    );

    // 即使配置已经是 false，也要修复消费者直接污染的内部状态。
    toggleEngine.isDown = true;
    toggleEngine.lastTrailPos = { x: 1, y: 2 };
    toggleEngine.lastTrailEventTime = 99;
    toggleEngine.trailSmoothX = 1;
    toggleEngine.trailSmoothY = 2;
    toggleEngine.trailSpeedFactor = 0.8;
    toggleEngine.trailShardDistance = 12;
    toggleEngine.currentTrailStroke = [];
    toggleEngine.trailStrokes.push(toggleEngine.currentTrailStroke);
    toggleEngine.sparks.push(toggleEngine._getSpark(1, 2, false));
    toggleEngine.setTrail(false);
    toggleEngine.setTrail(false);
    assert(
      toggleEngine.isDown === false &&
        toggleEngine.lastTrailPos === null &&
        toggleEngine.trailStrokes.length === 0 &&
        getTrailSparks(toggleEngine).length === 0,
      '重复 setTrail(false) 应无异常并执行自愈式清理',
    );

    toggleEngine.setTrail(true);
    dispatchPointer(dom, 'pointermove', toggleTarget, 80, 40, { pointerId: 21, buttons: 1 });
    assert(toggleEngine.trailStrokes.length === 0, '重新启用后 always=false 应等待新的真实 pointerdown');
    dispatchPointer(dom, 'pointerdown', toggleTarget, 80, 40, { pointerId: 22 });
    assert(toggleEngine.lastTrailPos?.x === 80, '重新启用后的新按压不得连接禁用前坐标');
    toggleEngine.setTrail(false);
    toggleEngine.setTrailAlways(true);
    toggleEngine.setTrail(true);
    dispatchPointer(dom, 'pointermove', toggleTarget, 95, 45, { pointerId: 23, buttons: 0 });
    assert(toggleEngine.lastTrailPos?.x === 95, '重新启用且 always=true 时下一 move 应从新坐标起笔');
    toggleEngine.destroy();

    const clearTarget = new MockCanvas({ width: 120, height: 100 });
    const clearEngine = new BAClickFX({ target: clearTarget });

    clearEngine.setTrailOutsideBehavior('continue');
    clearEngine.setTrailSmooth(0);
    clearEngine.setShardSpacing(20);
    clearEngine.setShardChance(1, 1);
    clearEngine.setMaxShards(200);
    dispatchPointer(dom, 'pointerdown', clearTarget, 10, 10, { pointerId: 31 });
    dispatchPointer(dom, 'pointermove', clearTarget, 100, 10, { pointerId: 31 });

    const clearWaves = [...clearEngine.waves];
    const clearClickSparks = [...getClickSparks(clearEngine)];

    assert(getTrailSparks(clearEngine).length > 0, 'clearTrail 前应存在拖尾来源碎片');
    clearEngine.clearTrail();
    assert(clearEngine.config.trail.enabled === true, 'clearTrail 不应修改 enabled');
    assert(clearEngine.isDown === true, 'clearTrail 不应伪造物理松开');
    assert(hasPointerCapture(dom, 31), 'clearTrail 不应释放仍在进行的拖尾 capture');
    assert(clearEngine.trailStrokes.length === 0 && clearEngine.lastTrailPos === null, 'clearTrail 应清空拖尾连续性');
    assert(getTrailSparks(clearEngine).length === 0, 'clearTrail 应回收拖尾来源碎片');
    assert(
      clearWaves.every((wave) => clearEngine.waves.includes(wave)) &&
        clearClickSparks.every((spark) => clearEngine.sparks.includes(spark)),
      'clearTrail 应保留点击对象',
    );
    dispatchPointer(dom, 'pointermove', clearTarget, 70, 50, { pointerId: 31 });
    assert(clearEngine.lastTrailPos?.x === 70, '按住时 clearTrail 后下一 move 应从新坐标重新起笔');

    const wavesBeforeClickDisable = clearEngine.waves.length;
    const clickSparksBeforeDisable = getClickSparks(clearEngine).length;
    const trailStrokesBeforeClickDisable = clearEngine.trailStrokes.length;

    clearEngine.setClick(false);
    clearEngine.boom(30, 30);
    dispatchPointer(dom, 'pointerdown', clearTarget, 30, 30, { pointerId: 32 });
    assert(clearEngine.waves.length === wavesBeforeClickDisable, 'setClick(false) 只阻止后续点击 wave');
    assert(getClickSparks(clearEngine).length === clickSparksBeforeDisable, 'setClick(false) 应保留已开始的点击碎片');
    assert(clearEngine.trailStrokes.length >= trailStrokesBeforeClickDisable, 'setClick(false) 不应关闭拖尾输入');
    clearEngine.destroy();

    // ═══════════════════════════════════════════════
    // 测试 11: outsideBehavior、Pointer Capture 与 blur
    // ═══════════════════════════════════════════════
    console.log('11. outsideBehavior、Pointer Capture 与 blur');

    const outsideTarget = new MockCanvas({ width: 100, height: 100 });
    const outsideEngine = new BAClickFX({
      target: outsideTarget,
      clickEnabled: false,
    });

    outsideEngine.setTrailSmooth(0);
    outsideEngine.setTrailMaxJumpDistance(1000);
    assert(outsideEngine.getConfig().trail.outsideBehavior === 'auto', 'outsideBehavior 默认值应为 auto');
    dom.captureAttempts.length = 0;
    dispatchPointer(dom, 'pointerdown', outsideTarget, 10, 10, { pointerId: 41 });
    dispatchPointer(dom, 'pointermove', outsideTarget, 150, 10, { pointerId: 41 });
    assert(outsideEngine.lastTrailPos?.x === 150, 'auto 应保持 1.1.7 对实际投递外点的处理');
    assert(dom.captureAttempts.length === 0, 'auto 不应主动 Pointer Capture');
    dispatchPointer(dom, 'pointerup', outsideTarget, 150, 10, { pointerId: 41 });

    outsideEngine.setTrailOutsideBehavior('pause-connect');
    dispatchPointer(dom, 'pointerdown', outsideTarget, 20, 20, { pointerId: 42 });
    dispatchPointer(dom, 'pointermove', outsideTarget, 50, 20, { pointerId: 42 });

    const pausedStroke = outsideEngine.currentTrailStroke;
    const pausedSmoothX = outsideEngine.trailSmoothX;
    const pausedEventTime = outsideEngine.lastTrailEventTime;

    dispatchPointer(dom, 'pointermove', outsideTarget, 150, 20, { pointerId: 42 });
    assert(outsideEngine.lastTrailPos?.x === 50, 'pause-connect 应忽略 Canvas 外坐标');
    assert(outsideEngine.trailSmoothX === pausedSmoothX, 'pause-connect 在外部应保留平滑锚点');
    assert(outsideEngine.lastTrailEventTime === pausedEventTime, 'pause-connect 在外部应保留事件时间');
    assert(outsideEngine.currentTrailStroke === pausedStroke, 'pause-connect 不应主动结束当前 stroke');

    dispatchPointer(dom, 'pointermove', outsideTarget, 70, 20, {
      pointerId: 42,
      getCoalescedEvents()
      {
        return [
          { clientX: 60, clientY: 20, timeStamp: 60 },
          { clientX: 160, clientY: 20, timeStamp: 61 },
          { clientX: 70, clientY: 20, timeStamp: 62 },
        ];
      },
    });
    assert(outsideEngine.lastTrailPos?.x === 70, 'pause-connect 回到 Canvas 后应继续当前输入连续性');
    assert(
      outsideEngine.currentTrailStroke.every((point) => point.x < 100),
      'pause-connect 应逐个过滤同批合并事件中的 Canvas 外样本',
    );
    assert(!hasPointerCapture(dom, 42), 'pause-connect 不应主动 Pointer Capture');
    dispatchPointer(dom, 'pointerup', outsideTarget, 70, 20, { pointerId: 42 });

    outsideEngine.setTrailOutsideBehavior('continue');
    dom.captureAttempts.length = 0;
    dispatchPointer(dom, 'pointerdown', outsideTarget, 15, 15, { pointerId: 43 });
    assert(dom.captureAttempts.length === 1 && hasPointerCapture(dom, 43), 'continue 应在合法按下时尝试 Pointer Capture');
    const capturedPosition = { ...outsideEngine.lastTrailPos };
    const capturedRectReads = outsideTarget.rectReadCount;
    let foreignCoalescedReads = 0;

    dispatchPointer(dom, 'pointermove', outsideTarget, 80, 80, {
      pointerId: 99,
      getCoalescedEvents()
      {
        foreignCoalescedReads++;
        return [];
      },
    });
    assert(foreignCoalescedReads === 0, '其他 pointerId 的 move 应在合并事件读取前被忽略');
    assert(outsideTarget.rectReadCount === capturedRectReads, '其他 pointerId 的 move 不应读取 Canvas 矩形');
    assert(
      outsideEngine.lastTrailPos?.x === capturedPosition.x &&
        outsideEngine.lastTrailPos?.y === capturedPosition.y,
      '其他 pointerId 的 move 不应改写当前轨迹坐标',
    );
    dispatchPointer(dom, 'pointermove', outsideTarget, 140, 15, { pointerId: 43 });
    assert(outsideEngine.lastTrailPos?.x === 140, 'continue 应处理浏览器实际投递的 Canvas 外事件');
    dom.dispatchWindow('blur');
    assert(
      outsideEngine.isDown === false &&
        outsideEngine.lastTrailPos === null &&
        outsideEngine.currentTrailStroke === null,
      'window.blur 在所有模式下都应复位并断笔',
    );
    assert(!hasPointerCapture(dom, 43), 'window.blur 应释放 continue 的 Pointer Capture');

    dispatchPointer(dom, 'pointerdown', outsideTarget, 20, 20, { pointerId: 44 });
    assert(hasPointerCapture(dom, 44), 'continue 再次按下应重新 capture');
    outsideTarget._capturedPointers.delete(44);
    dom.captureOwners.delete(44);
    dom.dispatchWindow('lostpointercapture', {
      target: outsideTarget,
      pointerId: 44,
    });
    assert(
      outsideEngine.isDown === false &&
        outsideEngine.lastTrailPos === null &&
        outsideEngine.currentTrailStroke === null,
      '意外 lostpointercapture 应结束当前拖尾输入',
    );
    const lostCaptureRectReads = outsideTarget.rectReadCount;

    dispatchPointer(dom, 'pointermove', outsideTarget, 80, 20, { pointerId: 99 });
    assert(
      outsideEngine.lastTrailPos === null &&
        outsideTarget.rectReadCount === lostCaptureRectReads,
      '丢失 capture 后其他 pointerId 不得接管旧轨迹',
    );

    dispatchPointer(dom, 'pointerdown', outsideTarget, 20, 20, { pointerId: 45 });
    assert(hasPointerCapture(dom, 45), 'lostpointercapture 后的新按下应重新 capture');
    dispatchPointer(dom, 'pointerup', outsideTarget, 20, 20, { pointerId: 99 });
    assert(hasPointerCapture(dom, 45) && outsideEngine.isDown, '其他 pointerId 的释放事件不应终止当前 capture');
    outsideEngine.setTrailOutsideBehavior('pause-connect');
    assert(!hasPointerCapture(dom, 45), 'outsideBehavior 模式切换应释放 capture');
    assert(outsideEngine.lastTrailPos === null && outsideEngine.currentTrailStroke === null, '模式切换应清除锚点并结束 stroke');
    assert(outsideEngine.isDown === true, '模式切换不应伪造物理松开');
    dom.dispatchWindow('lostpointercapture', {
      target: outsideTarget,
      pointerId: 45,
    });
    assert(outsideEngine.isDown === true, '主动释放后迟到的 lostpointercapture 不应终止当前物理按压');
    dispatchPointer(dom, 'pointerup', outsideTarget, 20, 20, { pointerId: 45 });
    outsideEngine.destroy();

    const captureFailureTarget = new MockCanvas({ width: 100, height: 100 });
    const captureFailureEngine = new BAClickFX({
      target: captureFailureTarget,
      clickEnabled: false,
    });
    let captureFailureError = null;

    captureFailureEngine.setTrailOutsideBehavior('continue');
    captureFailureEngine.setTrailSmooth(0);
    captureFailureTarget.captureError = new Error('capture unavailable');

    try
    {
      dispatchPointer(dom, 'pointerdown', captureFailureTarget, 10, 10, { pointerId: 46 });
      const captureFailurePosition = { ...captureFailureEngine.lastTrailPos };
      let captureFailureForeignReads = 0;

      dispatchPointer(dom, 'pointermove', captureFailureTarget, 80, 80, {
        pointerId: 99,
        getCoalescedEvents()
        {
          captureFailureForeignReads++;
          return [];
        },
      });
      assert(
        captureFailureForeignReads === 0 &&
          captureFailureEngine.lastTrailPos?.x === captureFailurePosition.x &&
          captureFailureEngine.lastTrailPos?.y === captureFailurePosition.y,
        'capture 失败后仍应隔离其他 pointerId 的 move',
      );
      dispatchPointer(dom, 'pointerup', captureFailureTarget, 80, 80, { pointerId: 99 });
      assert(captureFailureEngine.isDown, 'capture 失败后其他 pointerId 的释放事件不应终止输入');
      dispatchPointer(dom, 'pointermove', captureFailureTarget, 130, 10, { pointerId: 46 });
    }
    catch (error)
    {
      captureFailureError = error;
    }

    assert(captureFailureError === null, 'continue 的 Pointer Capture 失败应安全退化');
    assert(captureFailureEngine.lastTrailPos?.x === 130, 'capture 失败后仍应处理实际投递的外部事件');
    dispatchPointer(dom, 'pointerup', captureFailureTarget, 130, 10, { pointerId: 46 });
    captureFailureTarget.captureError = null;
    captureFailureEngine.setTrailAlways(true);
    dom.captureAttempts.length = 0;
    dispatchPointer(dom, 'pointermove', captureFailureTarget, 130, 20, { pointerId: 47, buttons: 0 });
    assert(dom.captureAttempts.length === 0, 'continue 不应承诺未按下 hover 的全局 capture');
    captureFailureEngine.destroy();

    // ═══════════════════════════════════════════════
    // 测试 12: 构造失败回滚与 destroy 完整资源释放
    // ═══════════════════════════════════════════════
    console.log('12. 构造失败回滚与 destroy 完整资源释放');

    for (let failedContext = 1; failedContext <= 3; failedContext++)
    {
      const canvasStart = dom.canvases.length;
      const contextStart = dom.contextCallCount;
      let constructionError = null;

      dom.contextFailureAt = contextStart + failedContext;

      try
      {
        new BAClickFX();
      }
      catch (error)
      {
        constructionError = error;
      }

      dom.contextFailureAt = null;

      const failedCanvases = dom.canvases.slice(canvasStart);

      assert(constructionError instanceof Error, `第 ${failedContext} 个 2D context 失败时构造应抛出`);
      assert(dom.body.children.length === 0, `第 ${failedContext} 个 context 失败后不应遗留自动 Canvas`);
      assert(dom.window.listenerCount() === 0, `第 ${failedContext} 个 context 失败后不应遗留 window listener`);
      assert(dom.activeResizeObserverCount() === 0, `第 ${failedContext} 个 context 失败后不应遗留 ResizeObserver`);
      assert(dom.visualViewport.listenerCount() === 0, `第 ${failedContext} 个 context 失败后不应遗留 visualViewport listener`);
      assert(dom.activeMediaListenerCount() === 0, `第 ${failedContext} 个 context 失败后不应遗留 DPR listener`);
      assert(dom.rafCallbacks.size === 0 && dom.timerCallbacks.size === 0, `第 ${failedContext} 个 context 失败后不应遗留 RAF/timer`);
      assert(
        failedCanvases.every((canvas) => canvas.width === 0 && canvas.height === 0),
        `第 ${failedContext} 个 context 失败后不应保留 backing store`,
      );
    }

    const rollbackTarget = new MockCanvas({
      width: 160,
      height: 90,
      style: {
        width: '50%',
        height: '25%',
        touchAction: 'pan-y',
      },
    });
    let listenerError = null;

    rollbackTarget.width = 640;
    rollbackTarget.height = 360;
    dom.listenerFailureAt = dom.listenerCallCount + 1;

    try
    {
      new BAClickFX({
        target: rollbackTarget,
        touchAction: 'none',
      });
    }
    catch (error)
    {
      listenerError = error;
    }

    dom.listenerFailureAt = null;

    assert(listenerError instanceof Error, '监听器注册失败时构造应抛出');
    assert(rollbackTarget.width === 640 && rollbackTarget.height === 360, '构造失败应恢复外部 Canvas backing store 尺寸');
    assert(rollbackTarget.style.width === '50%' && rollbackTarget.style.height === '25%', '构造失败应恢复外部 Canvas CSS 尺寸');
    assert(rollbackTarget.style.touchAction === 'pan-y', '构造失败应恢复外部 Canvas touch-action');
    assert(dom.window.listenerCount() === 0, '监听器注册失败后不应遗留 window listener');

    const externalTarget = new MockCanvas({
      width: 160,
      height: 90,
      style: { touchAction: 'pan-y' },
    });
    const lifecycleEngine = new BAClickFX({
      target: externalTarget,
      touchAction: 'none',
    });
    const externalWidth = lifecycleEngine.canvas.width;
    const externalHeight = lifecycleEngine.canvas.height;

    lifecycleEngine.setTrailOutsideBehavior('continue');
    dispatchPointer(dom, 'pointerdown', externalTarget, 10, 10, { pointerId: 51 });
    dom.dispatchResize(externalTarget);
    assert(dom.timerCallbacks.size > 0, 'ResizeObserver 应建立可由 destroy 清理的防抖 timer');
    assert(dom.window.listenerCount() === 6, '外部 Canvas 应只在 window 注册六个输入监听器');
    assert(dom.activeResizeObserverCount() === 1, '外部 Canvas 应注册一个 ResizeObserver');
    assert(dom.visualViewport.listenerCount('resize') === 1, '实例应监听 visualViewport.resize');
    assert(dom.activeMediaListenerCount() === 1, '实例应监听当前 DPR media query');
    const staleRafCallback = [...dom.rafCallbacks.values()][0] ?? (() => {});
    const staleTimerCallback = [...dom.timerCallbacks.values()][0]?.callback ?? (() => {});

    lifecycleEngine.destroy();
    lifecycleEngine.destroy();

    const rafRequestsAfterDestroy = dom.rafRequested;
    const timerRequestsAfterDestroy = dom.timerRequested;

    staleRafCallback(performance.now() + 100);
    staleTimerCallback();

    assert(dom.window.listenerCount() === 0, 'destroy 应幂等移除全部 window listener');
    assert(dom.activeResizeObserverCount() === 0, 'destroy 应断开 ResizeObserver');
    assert(dom.visualViewport.listenerCount() === 0, 'destroy 应移除 visualViewport listener');
    assert(dom.activeMediaListenerCount() === 0, 'destroy 应移除 DPR media query listener');
    assert(dom.rafCallbacks.size === 0 && dom.timerCallbacks.size === 0, 'destroy 应取消 RAF 与 resize timer');
    assert(
      dom.rafRequested === rafRequestsAfterDestroy &&
        dom.timerRequested === timerRequestsAfterDestroy,
      '销毁后已排队的 RAF/timer 回调不得重新调度资源',
    );
    assert(!hasPointerCapture(dom, 51), 'destroy 应释放 Pointer Capture');
    assert(lifecycleEngine.trailCanvas.width === 0 && lifecycleEngine.trailCanvas.height === 0, 'destroy 应释放 trail backing store');
    assert(lifecycleEngine.waveCanvas.width === 0 && lifecycleEngine.waveCanvas.height === 0, 'destroy 应释放 wave backing store');
    assert(externalTarget.parentNode === null, 'destroy 不应删除调用方传入的 Canvas');
    assert(externalTarget.width === externalWidth && externalTarget.height === externalHeight, 'destroy 不应清空外部 Canvas backing store');
    assert(externalTarget.style.touchAction === 'pan-y', 'destroy 应恢复外部 Canvas 原 touch-action');
    assert(
      lifecycleEngine.waves.length === 0 &&
        lifecycleEngine.sparks.length === 0 &&
        lifecycleEngine.trailStrokes.length === 0 &&
        lifecycleEngine.wavePool.length === 0 &&
        lifecycleEngine.sparkPool.length === 0 &&
        lifecycleEngine._renderPointCache.length === 0 &&
        lifecycleEngine._renderPointPool.length === 0,
      'destroy 应清空效果、对象池和渲染缓存',
    );
    lifecycleEngine.boom(10, 10);
    lifecycleEngine.boom(20, 20);
    assert(
      lifecycleEngine.waves.length === 0 &&
        lifecycleEngine.sparks.length === 0 &&
        dom.rafRequested === rafRequestsAfterDestroy,
      'destroy 后 boom 不得重新分配效果或 RAF',
    );

    const resetTouchTarget = new MockCanvas({
      width: 120,
      height: 80,
      style: { touchAction: 'pan-y' },
    });
    const resetTouchEngine = new BAClickFX({
      target: resetTouchTarget,
      touchAction: 'none',
    });

    resetTouchEngine.resetConfig();
    assert(
      resetTouchEngine.getConfig().touchAction === 'auto' &&
        resetTouchTarget.style.touchAction === 'auto',
      'resetConfig 应同步恢复配置和 Canvas touch-action',
    );
    resetTouchEngine.destroy();
    assert(resetTouchTarget.style.touchAction === 'pan-y', 'resetConfig 后 destroy 仍应恢复宿主原 touch-action');

    const priorityTarget = new MockCanvas({ width: 120, height: 80 });

    priorityTarget.style.setProperty('touch-action', 'pan-y', 'important');

    const priorityEngine = new BAClickFX({
      target: priorityTarget,
      touchAction: 'none',
    });

    priorityEngine.destroy();
    assert(
      priorityTarget.style.touchAction === 'pan-y' &&
        priorityTarget.style.getPropertyPriority('touch-action') === 'important',
      'destroy 应恢复外部 Canvas touch-action 的 CSS priority',
    );

    const hostOverrideTarget = new MockCanvas({
      width: 120,
      height: 80,
      style: { touchAction: 'pan-y' },
    });
    const hostOverrideEngine = new BAClickFX({
      target: hostOverrideTarget,
      touchAction: 'none',
    });

    hostOverrideTarget.style.setProperty('touch-action', 'none', 'important');
    hostOverrideEngine.destroy();
    assert(
      hostOverrideTarget.style.touchAction === 'none' &&
        hostOverrideTarget.style.getPropertyPriority('touch-action') === 'important',
      '宿主运行期覆写 touch-action 后 destroy 不得覆盖宿主值',
    );

    const ownedCanvasStart = dom.canvases.length;
    const ownedEngine = new BAClickFX();
    const ownedCanvas = ownedEngine.canvas;

    assert(dom.body.children.includes(ownedCanvas), '无 target 时应自动挂载主 Canvas');
    ownedEngine.destroy();
    assert(!dom.body.children.includes(ownedCanvas), 'destroy 应删除自动创建的主 Canvas');
    assert(ownedCanvas.width === 0 && ownedCanvas.height === 0, 'destroy 应释放自有主 Canvas backing store');
    assert(dom.canvases.length >= ownedCanvasStart + 3, '实例应建立主、trail、wave 三张 Canvas');

    const repeatedCanvasStart = dom.canvases.length;

    for (let i = 0; i < 100; i++)
    {
      const repeatedEngine = new BAClickFX();

      repeatedEngine.destroy();
    }

    const repeatedCanvases = dom.canvases.slice(repeatedCanvasStart);

    assert(dom.body.children.length === 0, '连续创建销毁 100 次后自动 Canvas 数量应回到基线');
    assert(dom.window.listenerCount() === 0, '连续创建销毁 100 次后 listener 数量应回到基线');
    assert(dom.activeResizeObserverCount() === 0, '连续创建销毁 100 次后 ResizeObserver 应回到基线');
    assert(dom.visualViewport.listenerCount() === 0, '连续创建销毁 100 次后 visualViewport listener 应回到基线');
    assert(dom.activeMediaListenerCount() === 0, '连续创建销毁 100 次后 DPR listener 应回到基线');
    assert(dom.rafCallbacks.size === 0 && dom.timerCallbacks.size === 0, '连续创建销毁 100 次后 RAF/timer 应回到基线');
    assert(
      repeatedCanvases.every((canvas) => canvas.width === 0 && canvas.height === 0),
      '连续创建销毁 100 次后全部自有 backing store 应释放',
    );
    dom.flushTimers();
    dom.flushAnimationFrame(performance.now() + 100);
    assert(dom.body.children.length === 0 && dom.window.listenerCount() === 0, '销毁后已排队回调不得重新分配资源');

    // ═══════════════════════════════════════════════
    // 测试 13: 默认三层尺寸与渲染指标
    // ═══════════════════════════════════════════════
    console.log('13. 默认三层尺寸与渲染指标');

    dom.window.devicePixelRatio = 2;

    const defaultRenderTarget = new MockCanvas({
      width: 320,
      height: 240,
      style: {
        width: '50%',
        height: '40vh',
      },
    });
    const defaultRenderEngine = new BAClickFX({ target: defaultRenderTarget });
    const defaultRenderMetrics = defaultRenderEngine.getRenderMetrics();

    assert(
      defaultRenderTarget.width === 320 && defaultRenderTarget.height === 240,
      '默认 maxDpr=1 时主 Canvas backing 尺寸应保持 320×240',
    );
    assert(
      defaultRenderEngine.trailCanvas.width === 320 && defaultRenderEngine.trailCanvas.height === 240,
      '默认 trailRenderScale=1 时 trail Canvas backing 尺寸应保持 320×240',
    );
    assert(
      defaultRenderEngine.waveCanvas.width === 320 && defaultRenderEngine.waveCanvas.height === 240,
      '默认 wave Canvas backing 尺寸应保持 320×240',
    );
    assert(
      defaultRenderTarget.style.width === '50%' && defaultRenderTarget.style.height === '40vh',
      '构造外部 Canvas 时不得改写宿主响应式 CSS 尺寸',
    );
    assert(
      defaultRenderMetrics.cssWidth === 320 &&
        defaultRenderMetrics.cssHeight === 240 &&
        defaultRenderMetrics.devicePixelRatio === 2 &&
        defaultRenderMetrics.effectivePixelRatio === 1 &&
        defaultRenderMetrics.trailRenderScale === 1,
      '默认渲染指标应区分设备 DPR 与实际有效像素比',
    );
    assert(
      defaultRenderMetrics.totalBackingPixels === 320 * 240 * 3 &&
        defaultRenderMetrics.nominalRgbaBytes === 320 * 240 * 3 * 4 &&
        defaultRenderMetrics.maxBackingPixels === null &&
        defaultRenderMetrics.budgetExceeded === false,
      '默认渲染指标应精确统计三层 backing 与理论 RGBA 字节数',
    );

    try
    {
      defaultRenderMetrics.cssWidth = -1;
    }
    catch
    {
      // 返回冻结快照同样满足只读契约，测试只关心外部不能污染内部指标。
    }

    assert(defaultRenderEngine.getRenderMetrics().cssWidth === 320, 'getRenderMetrics() 应返回不可污染内部状态的副本');
    defaultRenderEngine.destroy();

    // ═══════════════════════════════════════════════
    // 测试 14: backing 像素预算
    // ═══════════════════════════════════════════════
    console.log('14. backing 像素预算');

    const budgetTarget = new MockCanvas({ width: 100, height: 80 });
    const budgetEngine = new BAClickFX({
      target: budgetTarget,
      render: {
        maxDpr: 2,
        minRenderScale: 0.5,
        trailRenderScale: 0.5,
        maxBackingPixels: null,
      },
    });
    const naturalMetrics = budgetEngine.getRenderMetrics();

    assert(
      budgetTarget.width === 200 &&
        budgetTarget.height === 160 &&
        budgetEngine.trailCanvas.width === 100 &&
        budgetEngine.trailCanvas.height === 80 &&
        budgetEngine.waveCanvas.width === 200 &&
        budgetEngine.waveCanvas.height === 160,
      '构造 render 选项应按 maxDpr 与 trailRenderScale 规划三层尺寸',
    );
    assert(
      naturalMetrics.totalBackingPixels === 72000 &&
        naturalMetrics.totalBackingPixels === getBackingPixelCount(budgetEngine),
      '无预算时指标应等于三张 Canvas 的精确 backing 像素和',
    );
    assert(
      budgetTarget.style.width === undefined && budgetTarget.style.height === undefined,
      '由样式表控制且 inline 为空的外部 Canvas 不得被写成固定像素尺寸',
    );

    const intrinsicTarget = new MockCanvas({
      width: 100,
      height: 60,
      intrinsicLayout: true,
    });
    const intrinsicEngine = new BAClickFX({
      target: intrinsicTarget,
      render: { maxDpr: 2 },
    });

    assert(
      intrinsicTarget.width === 200 &&
        intrinsicTarget.height === 120 &&
        intrinsicTarget.style.width === '100px' &&
        intrinsicTarget.style.height === '60px',
      '纯 intrinsic Canvas 应锁定原 CSS 尺寸，避免 DPR backing 写入造成布局倍增',
    );
    intrinsicTarget.resetDimensionWrites();
    intrinsicEngine.refreshSize();
    assert(
      intrinsicTarget.getDimensionWriteCount() === 0 &&
        intrinsicEngine.getRenderMetrics().cssWidth === 100 &&
        intrinsicEngine.getRenderMetrics().cssHeight === 60,
      'intrinsic Canvas 锁定后重复刷新不得形成尺寸反馈循环',
    );
    intrinsicEngine.destroy();

    budgetEngine.setRenderOptions({ maxBackingPixels: 30000 });

    const constrainedMetrics = budgetEngine.getRenderMetrics();

    assert(
      constrainedMetrics.effectivePixelRatio >= 1 && constrainedMetrics.effectivePixelRatio < 2,
      '可满足预算时应在 minRenderScale 与自然 DPR 之间选取有效像素比',
    );
    assert(
      constrainedMetrics.totalBackingPixels <= 30000 &&
        constrainedMetrics.totalBackingPixels === getBackingPixelCount(budgetEngine) &&
        constrainedMetrics.budgetExceeded === false,
      '可满足预算时实际 backing 像素和不得超过预算',
    );

    resetBackingWrites(budgetEngine);
    budgetEngine.setRenderOptions({ maxBackingPixels: undefined });
    assert(
      budgetEngine.getRenderMetrics().maxBackingPixels === 30000 &&
        budgetEngine.getRenderMetrics().totalBackingPixels === constrainedMetrics.totalBackingPixels &&
        getBackingWriteCount(budgetEngine) === 0,
      '显式 undefined 应忽略，不得关闭已有预算或重写 backing store',
    );

    const floorBoundaryTarget = new MockCanvas({
      width: 100.99999999999,
      height: 80,
    });
    const floorBoundaryEngine = new BAClickFX({
      target: floorBoundaryTarget,
      render: {
        maxDpr: 2,
        minRenderScale: 0.5,
        trailRenderScale: 0.5,
        maxBackingPixels: 18000,
      },
    });
    const floorBoundaryMetrics = floorBoundaryEngine.getRenderMetrics();

    assert(
      floorBoundaryMetrics.effectivePixelRatio === 1 &&
        floorBoundaryMetrics.totalBackingPixels === 18000 &&
        floorBoundaryMetrics.budgetExceeded === false,
      'floor 可行区间极窄时应保留已确认满足预算的最低倍率方案',
    );
    floorBoundaryEngine.destroy();

    budgetEngine.setRenderOptions({ maxBackingPixels: 1000 });

    const exceededMetrics = budgetEngine.getRenderMetrics();

    assert(
      Math.abs(exceededMetrics.effectivePixelRatio - 1) < 1e-9,
      '最低渲染比例仍超限时应停在 naturalDpr × minRenderScale',
    );
    assert(
      exceededMetrics.totalBackingPixels === 18000 &&
        exceededMetrics.totalBackingPixels === getBackingPixelCount(budgetEngine) &&
        exceededMetrics.budgetExceeded === true,
      '最低渲染比例仍超限时应保留最低比例并明确报告 budgetExceeded',
    );

    budgetEngine.setRenderOptions({ maxBackingPixels: null });
    assert(
      budgetEngine.getRenderMetrics().totalBackingPixels === 72000 &&
        budgetEngine.getRenderMetrics().budgetExceeded === false,
      '显式传入 null 应关闭预算并恢复自然 backing 尺寸',
    );
    budgetEngine.destroy();

    // ═══════════════════════════════════════════════
    // 测试 15: 尺寸写入最小化
    // ═══════════════════════════════════════════════
    console.log('15. 尺寸写入最小化');

    const stableTarget = new MockCanvas({ width: 200, height: 120 });
    const stableEngine = new BAClickFX({
      target: stableTarget,
      render: {
        maxDpr: 1,
        minRenderScale: 0.5,
        trailRenderScale: 1,
      },
    });

    resetBackingWrites(stableEngine);
    stableEngine.refreshSize();
    stableEngine.refreshSize();
    stableEngine.setDpr(1);
    stableEngine.setTrailRenderScale(1);
    stableEngine.setRenderOptions({
      maxDpr: 1,
      minRenderScale: 0.5,
      trailRenderScale: 1,
      maxBackingPixels: null,
    });
    assert(
      getBackingWriteCount(stableEngine) === 0,
      '重复 refresh 与归一化后相同的 setter 不得重写任何 Canvas 尺寸',
    );

    resetBackingWrites(stableEngine);
    stableEngine.setTrailRenderScale(0.75);
    assert(
      stableTarget.getDimensionWriteCount() === 0 && stableEngine.waveCanvas.getDimensionWriteCount() === 0,
      '仅修改 trailRenderScale 不得写入主 Canvas 或 wave Canvas 尺寸',
    );
    assert(
      stableEngine.trailCanvas.getDimensionWriteCount('width') === 1 &&
        stableEngine.trailCanvas.getDimensionWriteCount('height') === 1 &&
        stableEngine.trailCanvas.width === 150 &&
        stableEngine.trailCanvas.height === 90,
      '仅修改 trailRenderScale 应各写一次 trail Canvas 宽高',
    );

    resetBackingWrites(stableEngine);
    stableEngine.setRenderOptions({ maxDpr: 2, trailRenderScale: 0.5 });
    assert(
      [stableTarget, stableEngine.trailCanvas, stableEngine.waveCanvas].every(
        (canvas) => canvas.getDimensionWriteCount('width') <= 1 && canvas.getDimensionWriteCount('height') <= 1,
      ),
      '一次批量渲染配置更新中每个 Canvas 尺寸属性最多写入一次',
    );
    stableEngine.destroy();

    // ═══════════════════════════════════════════════
    // 测试 16: 外部 Canvas CSS 与 0×0 暂停恢复
    // ═══════════════════════════════════════════════
    console.log('16. 外部 Canvas CSS 与 0×0 暂停恢复');

    dom.window.devicePixelRatio = 1;

    const zeroTarget = new MockCanvas({
      width: 0,
      height: 0,
      style: {
        width: '75%',
        height: 'calc(100vh - 2rem)',
      },
    });
    const zeroEngine = new BAClickFX({ target: zeroTarget });
    const zeroMetrics = zeroEngine.getRenderMetrics();

    assert(
      zeroTarget.width === 0 &&
        zeroTarget.height === 0 &&
        zeroEngine.trailCanvas.width === 0 &&
        zeroEngine.trailCanvas.height === 0 &&
        zeroEngine.waveCanvas.width === 0 &&
        zeroEngine.waveCanvas.height === 0,
      '外部 Canvas 为 0×0 时三层 backing 应保持 0，不得回退 window 全屏尺寸',
    );
    assert(
      zeroMetrics.cssWidth === 0 && zeroMetrics.cssHeight === 0 && zeroMetrics.totalBackingPixels === 0,
      '0×0 暂停状态的渲染指标应准确归零',
    );
    assert(dom.rafCallbacks.size === 0, '0×0 暂停状态不得持续申请 RAF');

    zeroEngine.boom(20, 20);
    assert(zeroEngine.waves.length > 0 && dom.rafCallbacks.size === 0, '0×0 时应保留待恢复效果状态但不启动 RAF');

    zeroTarget.rect.width = 120;
    zeroTarget.rect.height = 80;
    dom.dispatchResize(zeroTarget);
    assert(dom.timerCallbacks.size === 1, '外部 Canvas 恢复正尺寸时 ResizeObserver 应调度一次防抖刷新');
    assert([...dom.timerCallbacks.values()][0]?.delay === 100, '尺寸监听应使用 100ms 防抖窗口');
    dom.flushTimers();
    assert(
      zeroTarget.width === 120 &&
        zeroTarget.height === 80 &&
        zeroEngine.trailCanvas.width === 120 &&
        zeroEngine.trailCanvas.height === 80 &&
        zeroEngine.waveCanvas.width === 120 &&
        zeroEngine.waveCanvas.height === 80,
      '外部 Canvas 从 0×0 恢复后应重新建立三层 backing',
    );
    assert(dom.rafCallbacks.size === 1, '恢复正尺寸后有待处理效果时应重新启动 RAF');
    assert(
      zeroTarget.style.width === '75%' && zeroTarget.style.height === 'calc(100vh - 2rem)',
      '0×0 暂停和恢复过程不得改写外部 Canvas CSS 尺寸',
    );
    zeroEngine.destroy();

    // ═══════════════════════════════════════════════
    // 测试 17: 尺寸监听、防抖重绑与清理
    // ═══════════════════════════════════════════════
    console.log('17. 尺寸监听、防抖重绑与清理');

    const observerTarget = new MockCanvas({ width: 140, height: 90 });
    const observerEngine = new BAClickFX({
      target: observerTarget,
      render: { maxDpr: 2 },
    });

    dom.flushAnimationFrame(performance.now() + 120);
    assert(dom.activeResizeObserverCount() === 1, '外部 Canvas 应由 ResizeObserver 监听尺寸变化');
    assert(dom.window.listenerCount() === 6, '外部 Canvas 不应额外注册 window.resize');
    assert(dom.visualViewport.listenerCount('resize') === 1, '实例应监听 visualViewport.resize');
    assert(dom.activeMediaListenerCount() === 1, '实例应监听当前设备 DPR media query');

    const initialMediaQuery = dom.mediaQueries.findLast(
      (mediaQuery) => mediaQuery.listenerCount('change') > 0,
    );
    const matchMediaCallsBeforeChange = dom.matchMediaCalls.length;

    observerTarget.rect.width = 180;
    observerTarget.rect.height = 100;
    dom.window.devicePixelRatio = 1.5;
    dom.dispatchResize(observerTarget);
    dom.dispatchResize(observerTarget);
    dom.dispatchVisualViewportResize();
    dom.dispatchVisualViewportResize();
    dom.dispatchMediaChange(initialMediaQuery);
    assert(dom.timerCallbacks.size === 1, 'RO、visualViewport 与 DPR 连续变化应合并为一个待执行刷新');
    assert([...dom.timerCallbacks.values()][0]?.delay === 100, '合并尺寸事件的防抖延迟应固定为 100ms');
    dom.flushTimers();
    assert(
      dom.matchMediaCalls.length > matchMediaCallsBeforeChange &&
        dom.matchMediaCalls.at(-1).includes('1.5') &&
        dom.activeMediaListenerCount() === 1,
      'DPR change 后应移除旧监听并按新 DPR 重绑唯一 media query',
    );
    assert(
      observerTarget.width === 270 && observerTarget.height === 150,
      '防抖刷新后应同时应用新的外部尺寸与设备 DPR',
    );

    const reboundMediaQuery = dom.mediaQueries.findLast(
      (mediaQuery) => mediaQuery.listenerCount('change') > 0,
    );

    observerTarget.rect.width = 200;
    observerTarget.rect.height = 110;
    dom.dispatchResize(observerTarget);
    resetBackingWrites(observerEngine);

    const timerCanceledBeforeRefresh = dom.timerCanceled;

    observerEngine.refreshSize();
    assert(
      dom.timerCallbacks.size === 0 && dom.timerCanceled > timerCanceledBeforeRefresh,
      'refreshSize() 应取消 pending 防抖 timer 并立即刷新',
    );
    assert(
      observerTarget.width === 300 &&
        observerTarget.height === 165 &&
        [observerTarget, observerEngine.trailCanvas, observerEngine.waveCanvas].every(
          (canvas) => canvas.getDimensionWriteCount('width') <= 1 && canvas.getDimensionWriteCount('height') <= 1,
        ),
      'refreshSize() 立即刷新时每个 backing 尺寸属性最多写入一次',
    );

    const writesAfterImmediateRefresh = getBackingWriteCount(observerEngine);

    dom.flushTimers();
    assert(
      getBackingWriteCount(observerEngine) === writesAfterImmediateRefresh,
      'refreshSize() 取消的旧 timer 不得造成第二次尺寸写入',
    );

    dom.dispatchResize(observerTarget);

    const staleResizeCallback = [...dom.timerCallbacks.values()][0]?.callback ?? (() => {});

    observerEngine.destroy();

    const writesAfterObserverDestroy = getBackingWriteCount(observerEngine);
    const matchMediaCallsAfterDestroy = dom.matchMediaCalls.length;

    staleResizeCallback();
    dom.dispatchMediaChange(reboundMediaQuery);
    assert(dom.activeResizeObserverCount() === 0, 'destroy 应断开外部 Canvas ResizeObserver');
    assert(dom.visualViewport.listenerCount() === 0, 'destroy 应移除 visualViewport.resize 监听');
    assert(dom.activeMediaListenerCount() === 0, 'destroy 应移除当前 DPR media query 监听');
    assert(dom.window.listenerCount() === 0, 'destroy 应移除外部 Canvas 的全部 window 输入监听');
    assert(dom.timerCallbacks.size === 0, 'destroy 应取消待执行尺寸刷新 timer');
    assert(
      dom.matchMediaCalls.length === matchMediaCallsAfterDestroy,
      'destroy 后手动触发旧 DPR media query 不得重新绑定监听',
    );
    assert(
      getBackingWriteCount(observerEngine) === writesAfterObserverDestroy,
      'destroy 后迟到的尺寸回调不得重新写入 backing store',
    );

    dom.window.devicePixelRatio = 1;

    const ownedResizeEngine = new BAClickFX();

    dom.flushAnimationFrame(performance.now() + 140);
    assert(dom.activeResizeObserverCount() === 0, '自建全屏 Canvas 不需要 ResizeObserver');
    assert(dom.window.listenerCount() === 7, '自建全屏 Canvas 应注册 window.resize 与六个输入监听器');
    dom.dispatchWindow('resize');
    dom.dispatchWindow('resize');
    dom.dispatchVisualViewportResize();
    assert(dom.timerCallbacks.size === 1, '自建 Canvas 的 window 与 visualViewport resize 应共享一个防抖刷新');
    ownedResizeEngine.destroy();
    assert(
      dom.window.listenerCount() === 0 &&
        dom.visualViewport.listenerCount() === 0 &&
        dom.activeMediaListenerCount() === 0 &&
        dom.timerCallbacks.size === 0,
      '自建 Canvas destroy 后也应完整释放尺寸监听资源',
    );

    // ═══════════════════════════════════════════════
    // 测试 18: 渲染选项有限数值校验
    // ═══════════════════════════════════════════════
    console.log('18. 渲染选项有限数值校验');

    dom.window.devicePixelRatio = 2;

    const finiteTarget = new MockCanvas({ width: 160, height: 90 });
    const finiteEngine = new BAClickFX({
      target: finiteTarget,
      render: {
        maxDpr: Number.NaN,
        minRenderScale: Number.POSITIVE_INFINITY,
        trailRenderScale: Number.NEGATIVE_INFINITY,
        maxBackingPixels: Number.POSITIVE_INFINITY,
      },
    });
    let finiteOptionError = null;

    try
    {
      finiteEngine.setDpr(Number.NaN);
      finiteEngine.setTrailRenderScale(Number.POSITIVE_INFINITY);
      finiteEngine.setRenderOptions({
        maxDpr: Number.NEGATIVE_INFINITY,
        minRenderScale: Number.NaN,
        trailRenderScale: Number.NaN,
        maxBackingPixels: -1,
      });
      finiteEngine.refreshSize();
    }
    catch (error)
    {
      finiteOptionError = error;
    }

    const finiteMetrics = finiteEngine.getRenderMetrics();
    const finiteMetricKeys = [
      'cssWidth',
      'cssHeight',
      'devicePixelRatio',
      'effectivePixelRatio',
      'trailRenderScale',
      'totalBackingPixels',
      'nominalRgbaBytes',
    ];
    const finiteCanvases = [finiteTarget, finiteEngine.trailCanvas, finiteEngine.waveCanvas];
    const transformCommands = finiteCanvases.flatMap((canvas) => canvas.contextCommands).filter(
      ([name]) => name === 'setTransform',
    );

    assert(finiteOptionError === null, '非有限渲染选项不得导致构造或 setter 抛出异常');
    assert(
      finiteMetricKeys.every((key) => Number.isFinite(finiteMetrics[key])) &&
        (finiteMetrics.maxBackingPixels === null || Number.isFinite(finiteMetrics.maxBackingPixels)),
      'getRenderMetrics() 的全部数值字段都必须为有限数',
    );
    assert(
      finiteCanvases.every(
        (canvas) =>
          Number.isFinite(canvas.width) &&
          Number.isFinite(canvas.height) &&
          canvas.width >= 0 &&
          canvas.height >= 0 &&
          canvas.dimensionWrites.every((write) => Number.isFinite(write.value)),
      ),
      '任何非法选项都不得把 NaN 或 Infinity 写入 Canvas 尺寸',
    );
    assert(
      transformCommands.every(([, ...args]) => args.every((value) => Number.isFinite(value))),
      '任何非法选项都不得把 NaN 或 Infinity 写入 Canvas transform',
    );
    finiteEngine.destroy();
    dom.window.devicePixelRatio = 1;

    // ═══════════════════════════════════════════════
    // 测试 19: 主 Canvas 独占与多实例所有权
    // ═══════════════════════════════════════════════
    console.log('19. 主 Canvas 独占与多实例所有权');

    const hostSparkCanvas = new MockCanvas({ width: 320, height: 240 });

    hostSparkCanvas.id = 'sparkCanvas';
    dom.body.appendChild(hostSparkCanvas);

    const borrowedHostEngine = new BAClickFX();

    assert(borrowedHostEngine.canvas === hostSparkCanvas, '未被占用的宿主 #sparkCanvas 应继续兼容自动复用');
    borrowedHostEngine.destroy();
    assert(hostSparkCanvas.parentNode === dom.body, '销毁借用的宿主 #sparkCanvas 不得删除节点');
    dom.body.removeChild(hostSparkCanvas);

    const firstOwnedEngine = new BAClickFX();
    const secondOwnedEngine = new BAClickFX();
    const secondOwnedCanvas = secondOwnedEngine.canvas;
    const secondOwnedWidth = secondOwnedCanvas.width;

    assert(
      firstOwnedEngine.canvas !== secondOwnedEngine.canvas &&
        dom.body.children.length === 2,
      '两个无 target 实例必须分别持有独立主 Canvas',
    );
    assert(
      dom.body.children.filter((canvas) => canvas.id === 'sparkCanvas').length === 1,
      '多实例自动 Canvas 不得创建重复 sparkCanvas id',
    );
    firstOwnedEngine.destroy();
    assert(
      secondOwnedCanvas.parentNode === dom.body &&
        secondOwnedCanvas.width === secondOwnedWidth,
      '销毁第一个自动实例不得移除或清空第二个实例的 Canvas',
    );
    secondOwnedEngine.destroy();
    assert(dom.body.children.length === 0, '全部自动实例销毁后主 Canvas 数量应回到基线');

    const sharedTarget = new MockCanvas({ width: 160, height: 90 });
    const sharedOwner = new BAClickFX({ target: sharedTarget });
    const listenersBeforeSharedFailure = dom.window.listenerCount();
    let sharedTargetError = null;

    try
    {
      new BAClickFX({ target: sharedTarget });
    }
    catch (error)
    {
      sharedTargetError = error;
    }

    assert(
      sharedTargetError instanceof Error &&
        sharedTargetError.message.includes('同一 Canvas'),
      '显式重复绑定同一 Canvas 应抛出清晰错误',
    );
    assert(
      dom.window.listenerCount() === listenersBeforeSharedFailure &&
        sharedTarget.width > 0 &&
        sharedTarget.height > 0,
      '重复绑定失败不得破坏原实例的监听器或 backing store',
    );
    sharedOwner.destroy();

    const reclaimedOwner = new BAClickFX({ target: sharedTarget });

    assert(reclaimedOwner.canvas === sharedTarget, '原实例销毁后外部 Canvas 应允许重新认领');
    reclaimedOwner.destroy();

    const failedClaimTarget = new MockCanvas({ width: 120, height: 80 });
    let failedClaimError = null;

    dom.contextFailureAt = dom.contextCallCount + 1;

    try
    {
      new BAClickFX({ target: failedClaimTarget });
    }
    catch (error)
    {
      failedClaimError = error;
    }

    dom.contextFailureAt = null;
    assert(failedClaimError instanceof Error, '认领 Canvas 后的构造失败应正常抛出');

    const claimRetryEngine = new BAClickFX({ target: failedClaimTarget });

    assert(claimRetryEngine.canvas === failedClaimTarget, '构造失败 teardown 必须释放 Canvas 独占声明');
    claimRetryEngine.destroy();

    // ═══════════════════════════════════════════════
    // 测试 20: 全部公开数值入口有限值归一化
    // ═══════════════════════════════════════════════
    console.log('20. 全部公开数值入口有限值归一化');

    const numericTarget = new MockCanvas({ width: 200, height: 120 });
    const numericEngine = new BAClickFX({
      target: numericTarget,
      color: [Number.NaN, Number.POSITIVE_INFINITY, 'invalid'],
      scale: Number.NaN,
      opacity: Number.POSITIVE_INFINITY,
    });

    assert(
      numericEngine.CONFIG.scale === 1.1 &&
        numericEngine.CONFIG.opacity === 0.5 &&
        numericEngine.CONFIG.color.join(',') === '105,161,255',
      '构造参数中的非有限数和非法字符串应恢复各自默认值',
    );

    const numericConfigSchema = numericEngine.getConfig();
    const throwingNumericValue = {
      toString()
      {
        return 'throwing-valueOf';
      },
      valueOf()
      {
        throw new Error('numeric conversion rejected');
      },
    };

    const oneArgumentSetters = [
      'setScale',
      'setOpacity',
      'setDpr',
      'setTrailRenderScale',
      'setRingRotationSpeed',
      'setRingEmission',
      'setRingWidthEndMul',
      'setRingAlpha',
      'setRingWhiteMix',
      'setTrailBrightness',
      'setTrailWhiteMix',
      'setTrailSpeedDecay',
      'setTrailSmooth',
      'setMoveSparkChance',
      'setShardSpacing',
      'setShardLargeChance',
      'setMaxShards',
      'setSparksCount',
      'setClickTotalLife',
      'setClickScaleMul',
      'setClickHaloRadius',
      'setRingDelay',
      'setRingMaxLife',
      'setRingBaseRadiusMul',
      'setRingRadiusGrowEnd',
      'setRingPostDiskGrow',
      'setRingGlowRadiusAdd',
      'setRingSoftGlowRadiusAdd',
      'setRingColorFadeStart',
      'setRingColorEndWhiteMix',
      'setRingGlowAlpha',
      'setRingSoftGlowAlpha',
      'setDiskSize',
      'setTrailMainAlpha',
      'setTrailCoreAlpha',
      'setTrailHotAlpha',
      'setTrailGlowAlpha',
      'setTrailSoftGlowAlpha',
      'setTrailRailAlpha',
      'setTrailGlowWidthMul',
      'setTrailSoftGlowWidthMul',
      'setTrailTailDecayMul',
      'setTrailHeadDecayMul',
      'setTrailReleaseDecayMul',
      'setTrailSpeedMin',
      'setTrailSpeedMax',
      'setTrailGradientChunk',
      'setTrailMaxPoints',
      'setTrailMinDistance',
      'setTrailMaxJumpDistance',
      'setTrailMaxCoalescedEvents',
      'setTrailGlowRadius',
      'setTrailGlowIntensity',
    ];
    const twoArgumentSetters = [
      'setSpeed',
      'setRingWidth',
      'setTrailWidth',
      'setTrailLength',
      'setTrailLife',
      'setTrailSpeedRange',
      'setTrailSampling',
      'setTrailRenderSampling',
      'setShardChance',
      'setClickShardFlicker',
      'setDiskGlow',
      'setRingArcLength',
      'setRingRotationJitter',
      'setRingSegmentCount',
      'setRingSmallRadius',
      'setTrailShardOffset',
      'setTrailCoreWidth',
      'setTrailHotWidth',
      'setRingRadiusJitter',
      'setRingNormalGrow',
      'setTrailRailWidth',
      'setTrailRibbon',
    ];
    const numericSetterCases = [
      ...oneArgumentSetters.map((method) => [method, 1]),
      ...twoArgumentSetters.map((method) => [method, 2]),
      ['setColor', 3],
      ['setTrailDecay', 3],
      ['setTrailShardFlicker', 3],
      ['setRingCollapseTiming', 3],
      ['setDiskTiming', 4],
      ['setRingSegmentDetail', 4],
      ['setTrailLayerAlpha', 6],
    ];
    const invalidNumericValues = [
      undefined,
      null,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      'not-a-number',
      Symbol('not-a-number'),
      throwingNumericValue,
    ];

    for (const invalidValue of invalidNumericValues)
    {
      numericEngine.resetConfig();
      numericEngine.setRenderOptions({ maxBackingPixels: 123456 });

      for (const [method, argumentCount] of numericSetterCases)
      {
        numericEngine[method](...Array(argumentCount).fill(invalidValue));
      }

      numericEngine.setRenderOptions({
        maxDpr: invalidValue,
        minRenderScale: invalidValue,
        trailRenderScale: invalidValue,
        maxBackingPixels: invalidValue,
      });

      const nonFinitePaths = findInvalidNumberPaths(
        numericEngine.CONFIG,
        numericConfigSchema,
      );

      assert(
        nonFinitePaths.length === 0,
        `${String(invalidValue)} 不得污染运行时配置: ${nonFinitePaths.join(', ') || '无'}`,
      );
      assert(
        numericEngine.CONFIG.maxBackingPixels === (invalidValue === null ? null : 123456),
        `${String(invalidValue)} 应保持 maxBackingPixels 的 number | null 契约`,
      );
    }

    numericEngine.resetConfig();
    numericEngine.setScale('1.75');
    assert(numericEngine.CONFIG.scale === 1.75, '有限数字字符串应继续按原行为转换');
    numericEngine.setScale(null);
    assert(numericEngine.CONFIG.scale === 0.5, 'null 应继续按 Number(null)=0 后执行原范围钳制');
    numericEngine.setScale(99);
    assert(numericEngine.CONFIG.scale === 3, '有限越界值应继续执行原范围钳制');
    numericEngine.setRingAlpha(Number.POSITIVE_INFINITY);
    assert(numericEngine.CONFIG.rings.alpha === 0.9, 'Infinity 应回退 API 声明的稳定默认值');
    numericEngine.setColor(12.5, Number.NaN, Number.POSITIVE_INFINITY);
    assert(
      numericEngine.CONFIG.color.join(',') === '12.5,161,255',
      '颜色入口应保留有限通道并仅回退非有限通道',
    );

    const wavesBeforeInvalidBoom = numericEngine.waves.length;

    numericEngine.boom(Number.NaN, Number.POSITIVE_INFINITY);

    const normalizedWave = numericEngine.waves.at(-1);

    assert(
      numericEngine.waves.length === wavesBeforeInvalidBoom + 1 &&
        normalizedWave.x === dom.window.innerWidth / 2 &&
        normalizedWave.y === dom.window.innerHeight / 2,
      'boom 的非有限坐标应安全回退到原有窗口中心默认值',
    );
    numericEngine.destroy();

    // ═══════════════════════════════════════════════
    // 测试 21: 拖尾渲染缓存严格等价限流
    // ═══════════════════════════════════════════════
    console.log('21. 拖尾渲染缓存严格等价限流');

    const renderCacheEngine = new BAClickFX({
      target: new MockCanvas({ width: 320, height: 180 }),
    });
    const explicitBoundaryPoints = [
      createTrailTestPoint(0, 0, 9, 10, 0.1),
      createTrailTestPoint(0.11, 0, 8, 10, 0.2),
      createTrailTestPoint(0.2, 0, 7, 10, 0.3),
      createTrailTestPoint(0.31, 0, 6, 10, 0.4),
      createTrailTestPoint(0.4, 0, 5, 10, 0.5),
      createTrailTestPoint(0.61, 0, 4, 10, 0.6),
    ];
    const renderSteps = [0.1, 0.2, 0.75, 2.5];
    const renderLimits = [1, 2, 3, 5, 8, 60];
    let renderMismatchCount = 0;
    let randomState = 0x1a2b3c4d;

    const nextDeterministicRandom = () =>
    {
      randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;

      return randomState / 0x100000000;
    };
    const renderCases = [explicitBoundaryPoints];

    for (let caseIndex = 0; caseIndex < 300; caseIndex++)
    {
      const pointCount = 2 + Math.floor(nextDeterministicRandom() * 22);
      const points = [];
      let x = 0;
      let y = 0;

      for (let pointIndex = 0; pointIndex < pointCount; pointIndex++)
      {
        if (pointIndex > 0)
        {
          const distanceStep = [0, 0.05, 0.11, 0.2, 0.21, 0.7, 3.5][
            Math.floor(nextDeterministicRandom() * 7)
          ];
          const angle = nextDeterministicRandom() * Math.PI * 2;

          x += Math.cos(angle) * distanceStep;
          y += Math.sin(angle) * distanceStep;
        }

        points.push(createTrailTestPoint(
          x,
          y,
          5 + nextDeterministicRandom() * 20,
          25 + nextDeterministicRandom() * 10,
          nextDeterministicRandom(),
        ));
      }

      renderCases.push(points);
    }

    for (let caseIndex = 0; caseIndex < renderCases.length; caseIndex++)
    {
      const points = renderCases[caseIndex];
      const renderStep = renderSteps[caseIndex % renderSteps.length];
      const renderLimit = renderLimits[caseIndex % renderLimits.length];
      const pointsBeforeRender = JSON.stringify(points);
      const expected = buildLegacyTrailRenderPoints(points, renderStep, renderLimit);

      renderCacheEngine.CONFIG.trail.renderStep = renderStep;
      renderCacheEngine.CONFIG.trail.renderMaxPoints = renderLimit;

      const actual = renderCacheEngine._buildTrailRenderPoints(points);

      if (
        JSON.stringify(snapshotTrailRenderPoints(actual)) !==
        JSON.stringify(snapshotTrailRenderPoints(expected))
      )
      {
        renderMismatchCount++;
      }

      if (JSON.stringify(points) !== pointsBeforeRender)
      {
        renderMismatchCount++;
      }
    }

    assert(
      renderMismatchCount === 0,
      '环形缓存应与旧版前向去重后截取后缀的点字段和总长度完全一致',
    );

    const allocationPoints = [
      createTrailTestPoint(0, 0, 20, 20, 0.5),
      createTrailTestPoint(1000, 0, 20, 20, 0.5),
    ];
    const renderCache = renderCacheEngine._renderPointCache;
    const nativePush = renderCache.push;
    let cachePushCount = 0;
    let cachePeakLength = 0;

    renderCache.length = 0;
    renderCache.push = function (...items)
    {
      cachePushCount += items.length;
      const length = nativePush.apply(this, items);

      cachePeakLength = Math.max(cachePeakLength, length);
      return length;
    };
    renderCacheEngine.CONFIG.trail.renderStep = 1;
    renderCacheEngine.CONFIG.trail.renderMaxPoints = 5;
    renderCacheEngine._buildTrailRenderPoints(allocationPoints);

    const pushesAfterWarmup = cachePushCount;

    renderCacheEngine._buildTrailRenderPoints(allocationPoints);
    delete renderCache.push;
    assert(
      cachePeakLength === 5 &&
        pushesAfterWarmup === 5 &&
        cachePushCount === pushesAfterWarmup,
      '缓存对象分配不得超过 renderMaxPoints，预热后同容量长轨迹不得继续分配',
    );

    const warmRenderObjects = new Set([
      ...renderCacheEngine._renderPointCache,
      ...renderCacheEngine._renderPointPool,
    ]);
    const shortAllocationPoints = [
      createTrailTestPoint(0, 0, 20, 20, 0.5),
      createTrailTestPoint(1, 0, 20, 20, 0.5),
    ];

    renderCacheEngine._buildTrailRenderPoints(shortAllocationPoints);
    renderCacheEngine._buildTrailRenderPoints(allocationPoints);

    const reusedRenderObjects = new Set([
      ...renderCacheEngine._renderPointCache,
      ...renderCacheEngine._renderPointPool,
    ]);

    assert(
      reusedRenderObjects.size === warmRenderObjects.size &&
        [...reusedRenderObjects].every((point) => warmRenderObjects.has(point)),
      '长→短→长轨迹应复用预热对象，不得因有效长度缩短而重新分配',
    );

    const alternatingLongStroke = allocationPoints.map((point) => ({ ...point }));
    const alternatingShortStroke = shortAllocationPoints.map((point) => ({ ...point }));

    alternatingLongStroke.speedFactor = 0.5;
    alternatingLongStroke.released = false;
    alternatingShortStroke.speedFactor = 0.5;
    alternatingShortStroke.released = false;

    for (let frame = 0; frame < 3; frame++)
    {
      renderCacheEngine._renderTrailStrokeToCanvas(alternatingLongStroke);
      renderCacheEngine._renderTrailStrokeToCanvas(alternatingShortStroke);
    }

    const alternatingRenderObjects = new Set([
      ...renderCacheEngine._renderPointCache,
      ...renderCacheEngine._renderPointPool,
    ]);

    assert(
      alternatingRenderObjects.size === warmRenderObjects.size &&
        [...alternatingRenderObjects].every((point) => warmRenderObjects.has(point)),
      '多 stroke 长短交替渲染应持续复用已预热的点对象',
    );

    renderCacheEngine.CONFIG.trail.renderMaxPoints = 3.9;
    const fractionalLimitResult = renderCacheEngine._buildTrailRenderPoints(allocationPoints);

    assert(
      fractionalLimitResult.length === 3,
      '小数 renderMaxPoints 应安全向下整数化，不得形成非法数组长度',
    );

    const commandStroke = [
      createTrailTestPoint(40, 80, 18, 20, 0.2),
      createTrailTestPoint(90, 60, 17, 20, 0.4),
      createTrailTestPoint(150, 90, 16, 20, 0.7),
      createTrailTestPoint(230, 70, 15, 20, 0.9),
    ];

    commandStroke.speedFactor = 0.9;
    commandStroke.released = false;
    renderCacheEngine.CONFIG.trail.renderStep = 0.75;
    renderCacheEngine.CONFIG.trail.renderMaxPoints = 60;
    renderCacheEngine.trailCanvas.resetContextCommands();
    renderCacheEngine._renderTrailStrokeToCanvas(commandStroke);

    const ringCommands = JSON.stringify(renderCacheEngine.trailCanvas.contextCommands);
    const ringBuilder = renderCacheEngine._buildTrailRenderPoints;

    renderCacheEngine._buildTrailRenderPoints = (points) => buildLegacyTrailRenderPoints(
      points,
      renderCacheEngine.CONFIG.trail.renderStep,
      renderCacheEngine.CONFIG.trail.renderMaxPoints,
    );
    renderCacheEngine.trailCanvas.resetContextCommands();
    renderCacheEngine._renderTrailStrokeToCanvas(commandStroke);

    const legacyCommands = JSON.stringify(renderCacheEngine.trailCanvas.contextCommands);

    renderCacheEngine._buildTrailRenderPoints = ringBuilder;
    assert(
      ringCommands === legacyCommands,
      '环形缓存前后的拖尾 Canvas 指令、坐标和绘制顺序应完全一致',
    );

    const countedStrokes = [
      [createTrailTestPoint(0, 0), createTrailTestPoint(0, 0)],
      [
        createTrailTestPoint(0, 0),
        createTrailTestPoint(0, 0),
        createTrailTestPoint(0, 0),
      ],
    ];
    const originalCountTrim = renderCacheEngine._trimOldestTrailPointsByCount;
    let receivedAlivePointCount = null;

    for (const stroke of countedStrokes)
    {
      stroke.speedFactor = 0;
      stroke.released = true;
    }

    renderCacheEngine.trailStrokes = countedStrokes;
    renderCacheEngine.currentTrailStroke = null;
    renderCacheEngine._trimOldestTrailPointsByCount = (count) =>
    {
      receivedAlivePointCount = count;
    };
    renderCacheEngine._updateTrailPoints(0);
    renderCacheEngine._trimOldestTrailPointsByCount = originalCountTrim;
    assert(
      receivedAlivePointCount === 5,
      '更新循环应复用已遍历得到的存活点数，不再二次扫描全部 stroke',
    );

    const firstOldest = Array.from({ length: 2 }, () => createTrailTestPoint(0, 0));
    const secondOldest = Array.from({ length: 4 }, () => createTrailTestPoint(0, 0));

    renderCacheEngine.CONFIG.trail.maxPoints = 3;
    renderCacheEngine.trailStrokes = [firstOldest, secondOldest];
    renderCacheEngine._trimOldestTrailPointsByCount(6);
    assert(
      renderCacheEngine.trailStrokes.length === 1 &&
        renderCacheEngine.trailStrokes[0] === secondOldest &&
        secondOldest.length === 4,
      '跨 stroke 超限时仍应保持每帧只处理第一个 oldest stroke 的既有顺序',
    );

    const excessiveStrokes = Array.from(
      { length: 65 },
      () => [createTrailTestPoint(0, 0)],
    );
    const removedCurrentStroke = excessiveStrokes[0];

    renderCacheEngine.CONFIG.trail.maxPoints = 1000;
    renderCacheEngine.trailStrokes = excessiveStrokes;
    renderCacheEngine.currentTrailStroke = removedCurrentStroke;
    renderCacheEngine._trimOldestTrailPointsByCount(65);
    assert(
      renderCacheEngine.trailStrokes.length === 64 &&
        !renderCacheEngine.trailStrokes.includes(removedCurrentStroke) &&
        renderCacheEngine.currentTrailStroke === null,
      '64-stroke 清理顺序及 currentTrailStroke 释放语义应保持不变',
    );
    renderCacheEngine.destroy();
  }
  catch (e)
  {
    assert(false, `Node.js mock 实例化失败: ${e.message}`);
  }
  finally
  {
    dom.restore();
  }
}

function dispatchPointer(dom, type, target, x, y, properties = {})
{
  return dom.dispatchWindow(type, {
    target,
    clientX: x,
    clientY: y,
    ...properties,
  });
}

function getClickSparks(engine)
{
  return engine.sparks.filter((spark) => spark.fromClick === true);
}

function getTrailSparks(engine)
{
  return engine.sparks.filter((spark) => spark.fromClick === false);
}

function hasPointerCapture(dom, pointerId)
{
  return dom.captureOwners.has(pointerId);
}

function getBackingPixelCount(engine)
{
  return (
    engine.canvas.width * engine.canvas.height +
    engine.trailCanvas.width * engine.trailCanvas.height +
    engine.waveCanvas.width * engine.waveCanvas.height
  );
}

function resetBackingWrites(engine)
{
  engine.canvas.resetDimensionWrites();
  engine.trailCanvas.resetDimensionWrites();
  engine.waveCanvas.resetDimensionWrites();
}

function getBackingWriteCount(engine)
{
  return (
    engine.canvas.getDimensionWriteCount() +
    engine.trailCanvas.getDimensionWriteCount() +
    engine.waveCanvas.getDimensionWriteCount()
  );
}

function findInvalidNumberPaths(value, schema, path = 'CONFIG')
{
  if (typeof schema === 'number')
  {
    return typeof value === 'number' && Number.isFinite(value) ? [] : [path];
  }

  if (!schema || typeof schema !== 'object')
  {
    return [];
  }

  const paths = [];

  for (const [key, childSchema] of Object.entries(schema))
  {
    const childValue = value && typeof value === 'object'
      ? value[key]
      : undefined;

    // 默认配置充当数字字段 schema，避免字符串、null 或 Symbol 绕过有限值断言。
    paths.push(...findInvalidNumberPaths(childValue, childSchema, `${path}.${key}`));
  }

  return paths;
}

function createTrailTestPoint(x, y, life = 10, maxLife = 10, speedFactor = 0)
{
  return {
    x,
    y,
    life,
    maxLife,
    speedFactor,
    distanceFromTail: 0,
  };
}

function buildLegacyTrailRenderPoints(points, renderStep, renderMaxPoints)
{
  if (points.length < 2)
  {
    return points;
  }

  const result = [];

  for (let i = 0; i < points.length - 1; i++)
  {
    const first = points[i];
    const second = points[i + 1];
    const segmentLength = Math.hypot(second.x - first.x, second.y - first.y);
    const steps = Math.max(1, Math.ceil(segmentLength / renderStep));

    for (let stepIndex = 0; stepIndex < steps; stepIndex++)
    {
      const progress = stepIndex / steps;
      const point = {
        x: first.x + (second.x - first.x) * progress,
        y: first.y + (second.y - first.y) * progress,
        life: first.life + (second.life - first.life) * progress,
        maxLife: first.maxLife + (second.maxLife - first.maxLife) * progress,
        speedFactor:
          (first.speedFactor ?? 0) +
          ((second.speedFactor ?? 0) - (first.speedFactor ?? 0)) * progress,
        distanceFromTail: 0,
      };
      const previous = result[result.length - 1];

      if (
        previous &&
        Math.hypot(point.x - previous.x, point.y - previous.y) < 0.2
      )
      {
        continue;
      }

      result.push(point);
    }
  }

  const last = points[points.length - 1];
  const previous = result[result.length - 1];

  if (
    !previous ||
    Math.hypot(last.x - previous.x, last.y - previous.y) >= 0.2
  )
  {
    result.push({
      x: last.x,
      y: last.y,
      life: last.life,
      maxLife: last.maxLife,
      speedFactor: last.speedFactor ?? 0,
      distanceFromTail: 0,
    });
  }

  const integerLimit = Math.max(1, Math.floor(renderMaxPoints));

  if (result.length > integerLimit)
  {
    result.splice(0, result.length - integerLimit);
  }

  let totalLength = 0;

  if (result.length > 0)
  {
    result[0].distanceFromTail = 0;
  }

  for (let i = 1; i < result.length; i++)
  {
    totalLength += Math.hypot(
      result[i].x - result[i - 1].x,
      result[i].y - result[i - 1].y,
    );
    result[i].distanceFromTail = totalLength;
  }

  result.totalLength = totalLength;
  return result;
}

function snapshotTrailRenderPoints(points)
{
  return {
    points: points.map((point) => ({
      x: point.x,
      y: point.y,
      life: point.life,
      maxLife: point.maxLife,
      speedFactor: point.speedFactor,
      distanceFromTail: point.distanceFromTail,
    })),
    totalLength: points.totalLength ?? 0,
  };
}

// ── 结果 ──
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0)
{
  process.exit(1);
}
