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
    this.contextRequests = [];
  }

  getContext(type)
  {
    this.contextRequests.push(type);
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

class LockedWebGL2OffscreenCanvas extends MockOffscreenCanvas
{
  getContext(type)
  {
    this.contextRequests.push(type);
    if (type === 'webgl2' && !this._context)
    {
      this._context = {
        getExtension()
        {
          return null;
        },
      };
      return this._context;
    }

    return null;
  }
}

// Worker 没有 DOM，测试必须确保核心只依赖 OffscreenCanvas 提供的接口。
globalThis.OffscreenCanvas = MockOffscreenCanvas;

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
  effectBackend: 'webgl2',
  bloomBackend: 'native',
});

assert(fx.canvas === offscreen, 'BAClickFX correctly binds to OffscreenCanvas target');
assert(fx.width === 1920, 'BAClickFX reads initial width from OffscreenCanvas');
assert(fx.height === 1080, 'BAClickFX reads initial height from OffscreenCanvas');
assert(
  offscreen.contextRequests[0] === 'webgl2' &&
    offscreen.contextRequests.includes('2d'),
  'GPU initialization can fall back to Canvas2D before the surface is locked',
);

// 測試 resize API
fx.resize(1280, 720, 1);
assert(fx.width === 1280, 'fx.resize updates logic width');
assert(fx.height === 720, 'fx.resize updates logic height');
assert(offscreen.width === 1280, 'fx.resize updates OffscreenCanvas backing width');
assert(offscreen.height === 720, 'fx.resize updates OffscreenCanvas backing height');

// 測試 手動輸入生命週期
const downResult = fx.pointerDown({ x: 100, y: 200, pointerId: 1, pointerType: 'mouse' });
assert(downResult === true, 'pointerDown succeeded in manual mode');
assert(fx.animationFrame !== null, 'Worker without requestAnimationFrame uses the timer scheduler');

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

const canvas2d = new MockOffscreenCanvas(64, 64);
const canvas2dFx = new BAClickFX({
  target: canvas2d,
  inputSource: 'manual',
  effectBackend: 'canvas2d',
  bloomBackend: 'native',
});
assert(
  canvas2d.contextRequests[0] === '2d' &&
    !canvas2d.contextRequests.includes('webgl2'),
  'Explicit Canvas2D mode does not lock the OffscreenCanvas to WebGL2',
);
canvas2dFx.destroy();

assert(
  (() =>
  {
    try
    {
      new BAClickFX({
        target: new LockedWebGL2OffscreenCanvas(64, 64),
        inputSource: 'manual',
        effectBackend: 'webgl2',
      });
      return false;
    }
    catch (error)
    {
      return /新的画布/.test(error.message) && /Canvas2D/.test(error.message);
    }
  })(),
  'Locked WebGL2 initialization failure reports that a new canvas is required',
);

assert(
  (() =>
  {
    try
    {
      new BAClickFX({ inputSource: 'manual' });
      return false;
    }
    catch (error)
    {
      return /OffscreenCanvas target/.test(error.message);
    }
  })(),
  'Worker without an OffscreenCanvas target fails with an actionable error',
);

console.log(`\nAll ${passed} OffscreenCanvas tests passed!`);
