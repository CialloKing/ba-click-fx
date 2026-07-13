/**
 * ba-click-fx smoke test
 *
 * 验证：模块加载、类实例化、全部 API 签名、setter 调用无异常、
 *       配置隔离、resetConfig 恢复默认值、生命周期方法。
 * 运行方式：npm test
 *
 * 注意：Node.js 下使用最小 DOM mock 验证实例配置隔离。
 * 完整渲染测试仍需使用 Playwright 打开演示页。
 */

import { BAClickFX } from '../dist/ba-click-fx.js';

let passed = 0;
let failed = 0;
const inBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';

class MockHTMLElement
{
}

class MockCanvas extends MockHTMLElement
{
  constructor()
  {
    super();
    this.tagName = 'CANVAS';
    this.style = {};
    this.width = 0;
    this.height = 0;
    this.parentNode = null;
    this.rectReadCount = 0;
  }

  getContext()
  {
    return createMockContext();
  }

  getBoundingClientRect()
  {
    this.rectReadCount++;

    return {
      left: 0,
      top: 0,
      width: 320,
      height: 240,
    };
  }

  resetRectReadCount()
  {
    this.rectReadCount = 0;
  }
}

function createMockContext(commands)
{
  return new Proxy({}, {
    get(target, prop)
    {
      if (!(prop in target))
      {
        target[prop] = (...args) =>
        {
          if (commands)
          {
            commands.push([String(prop), ...args]);
          }
        };
      }

      return target[prop];
    },
  });
}

function installDomMock()
{
  const previous = {
    HTMLElement: globalThis.HTMLElement,
    document: globalThis.document,
    window: globalThis.window,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };

  const body = {
    appendChild(el)
    {
      el.parentNode = body;
    },
    removeChild(el)
    {
      el.parentNode = null;
    },
  };

  globalThis.HTMLElement = MockHTMLElement;
  globalThis.document = {
    body,
    createElement(tag)
    {
      if (tag === 'canvas')
      {
        return new MockCanvas();
      }

      return new MockHTMLElement();
    },
    getElementById()
    {
      return null;
    },
    querySelector()
    {
      return null;
    },
  };
  globalThis.window = {
    innerWidth: 320,
    innerHeight: 240,
    devicePixelRatio: 1,
    addEventListener()
    {
    },
    removeEventListener()
    {
    },
  };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () =>
  {
  };

  return () =>
  {
    globalThis.HTMLElement = previous.HTMLElement;
    globalThis.document = previous.document;
    globalThis.window = previous.window;
    globalThis.requestAnimationFrame = previous.requestAnimationFrame;
    globalThis.cancelAnimationFrame = previous.cancelAnimationFrame;
  };
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
  'setDpr', 'setTrailRenderScale', 'setTouchAction',
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
  'setTrail', 'setTrailAlways', 'setTrailBrightness', 'setTrailWhiteMix',
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

// 检查 prototype 上是否有意外的公共方法（排除 _ 开头和 constructor）
const protoKeys = Object.getOwnPropertyNames(proto).filter(
  (k) => k !== 'constructor' && !k.startsWith('_'),
);
const unexpected = protoKeys.filter((k) => !allMethods.includes(k));

if (unexpected.length > 0)
{
  console.log(`  ℹ 未记录的公共方法: ${unexpected.join(', ')}`);
}

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
  const restoreDom = installDomMock();

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
      'maxDpr', 'trailRenderScale', 'touchAction', 'maxDeltaMs', 'baseFrameMs',
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

    // ═══════════════════════════════════════════════
    // 测试 8: 无视觉差异的热路径优化
    // ═══════════════════════════════════════════════
    console.log('8. 无视觉差异的热路径优化');

    first.setTrailAlways(true);
    first.setTrailMaxCoalescedEvents(24);
    first.clearTrail();
    first.canvas.resetRectReadCount();
    first._handlePointerMove({
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
      first._handlePointerMove({
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

    // 清理
    first.destroy();
    second.destroy();
    assert(true, 'Node.js mock 环境实例化和销毁正常返回');
  }
  catch (e)
  {
    assert(false, `Node.js mock 实例化失败: ${e.message}`);
  }
  finally
  {
    restoreDom();
  }
}

// ── 结果 ──
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0)
{
  process.exit(1);
}
