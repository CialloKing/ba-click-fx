/**
 * ba-click-fx smoke test
 *
 * 验证：模块加载、类实例化、API 签名、基本流程无异常。
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
  }

  getContext()
  {
    return createMockContext();
  }

  getBoundingClientRect()
  {
    return {
      width: 320,
      height: 240,
    };
  }
}

function createMockContext()
{
  // 构造函数只需要 Canvas 2D API 存在；测试不执行真实渲染。
  return new Proxy({}, {
    get(target, prop)
    {
      if (!(prop in target))
      {
        target[prop] = () =>
        {
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

// ── 测试 1: 模块导出 ──
console.log('1. 模块导出');
assert(typeof BAClickFX === 'function', 'BAClickFX 应为构造函数');
assert(BAClickFX.prototype.constructor === BAClickFX, 'prototype.constructor 应指向自身');

// ── 测试 2: getConfig / resetConfig 静态方法 ──
console.log('2. 静态检查');
const proto = BAClickFX.prototype;
const requiredMethods = [
  'setColor', 'setScale', 'setOpacity', 'setSpeed',
  'setTrail', 'setTrailAlways', 'setTrailBrightness',
  'boom', 'clearTrail', 'getConfig', 'resetConfig', 'destroy',
];
for (const m of requiredMethods)
{
  assert(typeof proto[m] === 'function', `BAClickFX.prototype.${m} 应为函数`);
}

// ── 测试 3: 实例化（需要浏览器环境） ──
console.log('3. 实例化');
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

    first.setColor(10, 20, 30);
    assert(
      second.getConfig().color.join(',') === '1,2,3',
      '两个实例的 color 配置应互相隔离',
    );

    second.setScale(1.8);
    assert(first.getConfig().scale !== second.getConfig().scale, '两个实例的 scale 配置应互相隔离');

    first.resetConfig();
    assert(first.getConfig().color.join(',') === '105,161,255', 'resetConfig 应恢复当前实例默认 color');
    assert(second.getConfig().color.join(',') === '1,2,3', 'resetConfig 不应影响其他实例');

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
