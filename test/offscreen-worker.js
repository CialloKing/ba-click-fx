/**
 * OffscreenCanvas 与 Worker 环境兼容性测试。
 */

import { BAClickFX } from '../src/fx.js';

class MockOffscreenCanvasContext2D
{
  constructor(canvas)
  {
    this.canvas = canvas;
    this.globalCompositeOperation = 'source-over';
    this.globalAlpha = 1;
    this.shadowBlur = 0;
    this.shadowColor = 'transparent';
    this.filter = 'none';
    this.imageSmoothingEnabled = true;
    this.currentTransform = [1, 0, 0, 1, 0, 0];
  }

  save() {}
  restore() {}
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  quadraticCurveTo() {}
  arc() {}
  fill() {}
  stroke() {}
  clearRect() {}
  fillRect() {}
  strokeRect() {}
  drawImage() {}
  getImageData(x, y, w, h)
  {
    return {
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    };
  }
  putImageData() {}
  createImageData(w, h)
  {
    return {
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    };
  }
  createLinearGradient()
  {
    return { addColorStop() {} };
  }
  createRadialGradient()
  {
    return { addColorStop() {} };
  }
  setTransform(a, b, c, d, e, f)
  {
    this.currentTransform = [a, b, c, d, e, f];
  }
  scale() {}
  translate() {}
  rotate() {}
}

class MockOffscreenCanvas
{
  constructor(width = 300, height = 150)
  {
    this.width = width;
    this.height = height;
    this._context = null;
  }

  getContext(type)
  {
    if (type === '2d')
    {
      if (!this._context)
      {
        this._context = new MockOffscreenCanvasContext2D(this);
      }
      return this._context;
    }
    return null;
  }
}

// 模拟 Worker 环境全局对象
globalThis.OffscreenCanvas = MockOffscreenCanvas;
if (typeof globalThis.requestAnimationFrame === 'undefined')
{
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

let passed = 0;
function assert(condition, message)
{
  if (!condition)
  {
    throw new Error(`FAIL: ${message}`);
  }
  passed++;
  console.log(`  ✓ ${message}`);
}

console.log('Testing BAClickFX in OffscreenCanvas / Worker environment:');

// --- 1. 低阶手动 Worker 渲染测试 ---
const offscreen = new MockOffscreenCanvas(1920, 1080);
const fx = new BAClickFX({
  target: offscreen,
  inputSource: 'manual',
  maxDpr: 1,
  bloomBackend: 'native',
});

assert(fx.canvas === offscreen, 'BAClickFX correctly binds to OffscreenCanvas target');
assert(fx.width === 1920, 'BAClickFX reads initial width from OffscreenCanvas');
assert(fx.height === 1080, 'BAClickFX reads initial height from OffscreenCanvas');

// 測試 resize API
fx.resize(1280, 720, 1);
assert(fx.width === 1280, 'fx.resize updates logic width');
assert(fx.height === 720, 'fx.resize updates logic height');
assert(offscreen.width === 1280, 'fx.resize updates OffscreenCanvas backing width');
assert(offscreen.height === 720, 'fx.resize updates OffscreenCanvas backing height');

// 測試 手動輸入生命週期
const downResult = fx.pointerDown({ x: 100, y: 200, pointerId: 1, pointerType: 'mouse' });
assert(downResult === true, 'pointerDown succeeded in manual mode');

const moveResult = fx.pointerMove({ x: 120, y: 220, pointerId: 1, pointerType: 'mouse' });
assert(moveResult === true, 'pointerMove succeeded in manual mode');

const upResult = fx.pointerUp(1);
assert(upResult === true, 'pointerUp succeeded in manual mode');

// 測試 boom API
fx.boom(300, 400);
assert(true, 'fx.boom executed without throwing');

// 測試暫停與銷毀
fx.setPaused(true, { clear: true });
assert(true, 'fx.setPaused executed successfully');

fx.destroy();
assert(fx.destroyed === true, 'fx.destroy executed and set destroyed flag');

// --- 2. 高阶开箱即用 useWorker 桥接测试 ---
class MockElement
{
  constructor(tagName = 'div')
  {
    this.tagName = tagName.toUpperCase();
    this.style = {};
    this.attributes = {};
    this.children = [];
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  appendChild(child) { this.children.push(child); }
  removeChild(child) { this.children = this.children.filter((c) => c !== child); }
  remove() {}
  attachShadow() { return new MockElement('shadow-root'); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1920, height: 1080 }; }
}

class MockHTMLCanvasElement extends MockElement
{
  constructor()
  {
    super('canvas');
    this.width = 1920;
    this.height = 1080;
  }
  transferControlToOffscreen()
  {
    return new MockOffscreenCanvas(this.width, this.height);
  }
  getContext(type)
  {
    if (type === '2d')
    {
      return new MockOffscreenCanvasContext2D(this);
    }
    return null;
  }
}

const postedMessages = [];
class MockWorker
{
  constructor(url)
  {
    this.url = url;
  }
  postMessage(data)
  {
    postedMessages.push(data);
  }
  terminate() {}
}

globalThis.HTMLCanvasElement = MockHTMLCanvasElement;
globalThis.Worker = MockWorker;
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
globalThis.URL = { createObjectURL: () => 'blob:mock-worker', revokeObjectURL: () => {} };
globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  devicePixelRatio: 1,
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.document = {
  createElement: (tag) => (tag === 'canvas' ? new MockHTMLCanvasElement() : new MockElement(tag)),
  body: new MockElement('body'),
};

console.log('\nTesting BAClickFX out-of-the-box useWorker mode:');

const workerFx = new BAClickFX({
  useWorker: true,
  scale: 0.8,
  themeColor: '#ff6969',
});

assert(workerFx.isWorkerControlled === true, 'BAClickFX initializes as worker controlled');
assert(postedMessages.some((m) => m.type === 'INIT'), 'Posted INIT message with OffscreenCanvas');

workerFx.pointerDown({ clientX: 100, clientY: 200, pointerId: 1 });
assert(postedMessages.some((m) => m.type === 'POINTER_DOWN' && m.x === 100 && m.y === 200), 'Proxied POINTER_DOWN to worker');

workerFx.pointerMove({ clientX: 150, clientY: 250, pointerId: 1 });
assert(postedMessages.some((m) => m.type === 'POINTER_MOVE' && m.x === 150 && m.y === 250), 'Proxied POINTER_MOVE to worker');

workerFx.pointerUp(1);
assert(postedMessages.some((m) => m.type === 'POINTER_UP' && m.pointerId === 1), 'Proxied POINTER_UP to worker');

workerFx.boom(300, 400);
assert(postedMessages.some((m) => m.type === 'BOOM' && m.x === 300 && m.y === 400), 'Proxied BOOM to worker');

workerFx.setPaused(true);
assert(postedMessages.some((m) => m.type === 'PAUSE' && m.paused === true), 'Proxied PAUSE to worker');

workerFx.setThemeColor('#00ff00');
assert(postedMessages.some((m) => m.type === 'SET_THEME_COLOR' && m.color === '#00ff00'), 'Proxied SET_THEME_COLOR to worker');

workerFx.updateConfig({ clickTimeScale: 2 });
assert(postedMessages.some((m) => m.type === 'UPDATE_CONFIG'), 'Proxied UPDATE_CONFIG to worker');

workerFx.destroy();
assert(postedMessages.some((m) => m.type === 'DESTROY'), 'Proxied DESTROY to worker');
assert(workerFx.destroyed === true, 'Worker controlled instance destroyed');

console.log(`\nAll ${passed} tests passed!`);
