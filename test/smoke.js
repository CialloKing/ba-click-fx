/**
 * FX_Touch 移植烟雾测试。
 *
 * 测试只锁定从 Unity 恢复出的行为参数和生命周期；不再维护旧调参 API。
 */

const modulePath = process.argv.includes('--source')
  ? '../src/ba-spark.js'
  : '../dist/ba-click-fx.js';
const module = await import(modulePath);
const { BAClickFX, CONFIG, UNITY_FX_TOUCH, createConfig } = module;

let passed = 0;

function assert(condition, message)
{
  if (!condition)
  {
    throw new Error(message);
  }

  passed++;
  console.log(`  ✓ ${message}`);
}

class EventTargetMock
{
  constructor()
  {
    this.listeners = new Map();
  }

  addEventListener(type, listener)
  {
    if (!this.listeners.has(type))
    {
      this.listeners.set(type, new Set());
    }

    this.listeners.get(type).add(listener);
  }

  removeEventListener(type, listener)
  {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type, properties = {})
  {
    const event =
    {
      type,
      target: properties.target ?? this,
      ...properties,
    };

    for (const listener of this.listeners.get(type) ?? [])
    {
      listener(event);
    }
  }
}

class GradientMock
{
  constructor()
  {
    this.stops = [];
  }

  addColorStop(offset, color)
  {
    this.stops.push([offset, color]);
  }
}

class ContextMock
{
  constructor()
  {
    this.strokeCount = 0;
    this.fillCount = 0;
  }

  setTransform() {}
  clearRect() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  closePath() {}

  stroke()
  {
    this.strokeCount++;
  }

  fill()
  {
    this.fillCount++;
  }

  createRadialGradient()
  {
    return new GradientMock();
  }
}

class CanvasMock extends EventTargetMock
{
  constructor()
  {
    super();
    this.tagName = 'CANVAS';
    this.style = {};
    this.context = new ContextMock();
    this.removed = false;
    this.width = 0;
    this.height = 0;
  }

  setAttribute() {}

  getContext(type)
  {
    return type === '2d' ? this.context : null;
  }

  getBoundingClientRect()
  {
    return {
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    };
  }

  remove()
  {
    this.removed = true;
  }
}

function installDom()
{
  const windowMock = new EventTargetMock();
  const body = new EventTargetMock();
  const frames = new Map();
  let nextFrameId = 1;
  let appendedCanvas = null;

  body.appendChild = (canvas) =>
  {
    appendedCanvas = canvas;
  };
  windowMock.innerWidth = 1920;
  windowMock.innerHeight = 1080;
  windowMock.devicePixelRatio = 1;

  globalThis.window = windowMock;
  globalThis.document =
  {
    body,
    createElement(tagName)
    {
      if (tagName !== 'canvas')
      {
        throw new Error(`不支持的测试元素：${tagName}`);
      }

      return new CanvasMock();
    },
    querySelector()
    {
      return null;
    },
  };
  globalThis.requestAnimationFrame = (callback) =>
  {
    const id = nextFrameId++;

    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) =>
  {
    frames.delete(id);
  };

  return {
    windowMock,
    frames,
    get appendedCanvas()
    {
      return appendedCanvas;
    },
  };
}

function flushFrames(dom, startTime, count)
{
  let now = startTime;

  for (let index = 0; index < count && dom.frames.size > 0; index++)
  {
    now += 1000 / 60;
    const callbacks = [...dom.frames.values()];

    dom.frames.clear();

    for (const callback of callbacks)
    {
      callback(now);
    }
  }

  return now;
}

console.log('\nUnity 参数');
assert(UNITY_FX_TOUCH.rootDurationMs === 1000, '根粒子持续 1 秒');
assert(UNITY_FX_TOUCH.disk.lifetimeMs === 200, '短圆盘持续 0.2 秒');
assert(UNITY_FX_TOUCH.rings.count === 2, 'MeshTri burst 一次生成 2 枚圆环');
assert(UNITY_FX_TOUCH.rings.lifetimeMs === 600, '溶解圆环持续 0.6 秒');
assert(UNITY_FX_TOUCH.shards.clickCount === 4, '点击 burst 固定生成 4 枚碎片');
assert(UNITY_FX_TOUCH.shards.trailSpacing === 80, '拖拽每 80px 生成一枚碎片');
assert(UNITY_FX_TOUCH.trail.lifetimeMs === 300, 'TrailRenderer.time 为 0.3 秒');
assert(UNITY_FX_TOUCH.trail.width === 2, '1080p 轨迹宽度为 2px');

console.log('\n配置隔离');
const leftConfig = createConfig();
const rightConfig = createConfig();

leftConfig.scale = 2;
assert(rightConfig.scale === CONFIG.scale, '实例配置互不污染');

console.log('\n指针生命周期');
const dom = installDom();
const effect = new BAClickFX();
let now = flushFrames(dom, performance.now(), 1);

assert(dom.appendedCanvas === effect.canvas, '默认创建全屏 Canvas');
assert(effect.width === 1920 && effect.height === 1080, '按 CSS 尺寸建立 1080p 坐标系');

dom.windowMock.dispatch('pointerdown',
  {
    pointerType: 'mouse',
    button: 0,
    pointerId: 7,
    clientX: 400,
    clientY: 300,
  });
assert(effect.activePointerId === 7, '按下后只跟踪当前 Pointer');
assert(effect.waves.length === 1, '按下生成一组点击圆盘与圆环');
assert(effect.shards.length === 4, '按下立即生成 4 枚点击碎片');
assert(effect.trailStrokes.length === 1, '按下创建一个 TrailRenderer 行程');

dom.windowMock.dispatch('pointerdown',
  {
    pointerType: 'touch',
    button: 0,
    pointerId: 8,
    clientX: 900,
    clientY: 600,
  });
assert(effect.waves.length === 1, '活动上限为 1 时第二根手指不生成点击');

dom.windowMock.dispatch('pointermove',
  {
    pointerType: 'mouse',
    pointerId: 7,
    clientX: 496,
    clientY: 300,
  });
assert(effect.trailStrokes[0].points.length > 2, '拖拽按 4px 最小顶点距离采样');
assert(effect.shards.some((shard) => shard.kind === 'trail'), '拖过 80px 后生成距离粒子');

now = flushFrames(dom, now, 2);
assert(effect.context.strokeCount > 0, '运行帧实际绘制溶解环和细轨迹');
assert(effect.context.fillCount > 0, '运行帧实际绘制圆盘与三角粒子');

dom.windowMock.dispatch('pointerup',
  {
    pointerType: 'mouse',
    pointerId: 7,
  });
assert(effect.activePointerId === null, '松开后立即释放活动拖拽名额');
assert(effect.trailStrokes[0].active === false, '松开不清空轨迹，只停止追加顶点');

now = flushFrames(dom, now, 70);
assert(effect.waves.length === 0, '0.6 秒后圆环自然结束');
assert(effect.shards.length === 0, '最长 0.7 秒后碎片自然结束');
assert(effect.trailStrokes.length === 0, '松开后轨迹按 0.3 秒自然消失');

effect.boom(960, 540);
assert(effect.waves.length === 1 && effect.shards.length === 4, 'boom() 触发同一套 FX_Touch 点击');
effect.clear();
assert(effect.waves.length === 0 && effect.shards.length === 0, 'clear() 清除全部视觉对象');

effect.destroy();
assert(effect.destroyed && effect.canvas.removed, 'destroy() 移除监听和自有 Canvas');

console.log(`\n✅ ${passed} 项 FX_Touch 移植检查通过\n`);
