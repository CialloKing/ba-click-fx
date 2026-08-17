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

// Worker 没有 DOM，测试必须确保核心只依赖 OffscreenCanvas 提供的接口。
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

// 宿主负责把视口和 DPR 变化显式同步给 Worker。
fx.resize(1280, 720, 1);
assert(fx.width === 1280, 'fx.resize updates logic width');
assert(fx.height === 720, 'fx.resize updates logic height');
assert(offscreen.width === 1280, 'fx.resize updates OffscreenCanvas backing width');
assert(offscreen.height === 720, 'fx.resize updates OffscreenCanvas backing height');

// Worker 中没有 DOM 事件，宿主通过 manual API 转发局部坐标。
const downResult = fx.pointerDown({ x: 100, y: 200, pointerId: 1, pointerType: 'mouse' });
assert(downResult === true, 'pointerDown succeeded in manual mode');

const moveResult = fx.pointerMove({ x: 120, y: 220, pointerId: 1, pointerType: 'mouse' });
assert(moveResult === true, 'pointerMove succeeded in manual mode');

const upResult = fx.pointerUp(1);
assert(upResult === true, 'pointerUp succeeded in manual mode');

// boom 仍可作为不建立拖尾状态的点击入口。
fx.boom(300, 400);
assert(true, 'fx.boom executed without throwing');

// 暂停和销毁不能依赖 window 生命周期事件。
fx.setPaused(true, { clear: true });
assert(true, 'fx.setPaused executed successfully');

fx.destroy();
assert(fx.destroyed === true, 'fx.destroy executed and set destroyed flag');

console.log(`\nAll ${passed} OffscreenCanvas tests passed!`);
