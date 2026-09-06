/**
 * 源码入口与 Unity 资源合同。
 *
 * 运行时 Smoke 只验证 dist；这里保留源码、资源和 Shader 的静态真值，
 * 避免同一套生命周期断言在 src 与 dist 上完整执行两次。
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BAClickFX } from '../src/fx.js';
import { CONFIG, UNITY_FX_TOUCH } from '../src/config.js';
import { RING3_ALPHA, RING3_ALPHA_HEIGHT, RING3_ALPHA_WIDTH } from '../src/ring3-alpha.js';
import {
  CIRCLE_TEXTURE_RGBA,
  CIRCLE_TEXTURE_SIZE,
} from '../src/circle-texture.js';
import {
  TRAIL_TEXTURE_COVERAGE,
  TRAIL_TEXTURE_HEIGHT,
  TRAIL_TEXTURE_RGB,
  TRAIL_TEXTURE_RGBA,
  TRAIL_TEXTURE_WIDTH,
} from '../src/trail-texture.js';
import {
  TRIANGLE_TEXTURE_COVERAGE,
  TRIANGLE_TEXTURE_OVERLAY_RGBA,
  TRIANGLE_TEXTURE_RGBA,
  TRIANGLE_TEXTURE_SIZE,
} from '../src/triangle-texture.js';

const sourceFiles = {
  fx: readFileSync(new URL('../src/fx.js', import.meta.url), 'utf8'),
  webgl2: readFileSync(
    new URL('../src/webgl2-effect.js', import.meta.url),
    'utf8',
  ),
  webgl2Bloom: readFileSync(
    new URL('../src/webgl2-bloom.js', import.meta.url),
    'utf8',
  ),
};

function sha256(value)
{
  return createHash('sha256').update(value).digest('hex');
}

class MockContext
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
  }

  getImageData(_x, _y, width, height)
  {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    };
  }

  createImageData(width, height)
  {
    return this.getImageData(0, 0, width, height);
  }

  createLinearGradient()
  {
    return { addColorStop() {} };
  }

  createRadialGradient()
  {
    return { addColorStop() {} };
  }

  setTransform() {}
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
  putImageData() {}
  scale() {}
  translate() {}
  rotate() {}
}

class MockCanvas
{
  constructor(width = 320, height = 240)
  {
    this.width = width;
    this.height = height;
    this.context = new MockContext(this);
  }

  getContext(type)
  {
    return type === '2d' ? this.context : null;
  }
}

// Node 没有 DOM；注册 Mock OffscreenCanvas 以覆盖源码的 Worker 入口。
globalThis.OffscreenCanvas = MockCanvas;

assert.equal(CONFIG.maxDpr, 1, '源码入口保留默认最大 DPR');
assert.equal(UNITY_FX_TOUCH.rings.count, 2, '源码入口保留 Unity 圆环数量');
assert.equal(UNITY_FX_TOUCH.shards.clickCount, 4, '源码入口保留 Unity 点击碎片数量');
assert.equal(UNITY_FX_TOUCH.shards.maxCount, 50, '源码入口保留 Unity 拖尾碎片上限');

assert.equal(RING3_ALPHA_WIDTH, 256, 'Ring3 Alpha 宽度保持 256');
assert.equal(RING3_ALPHA_HEIGHT, 128, 'Ring3 Alpha 高度保持 128');
assert.equal(
  sha256(RING3_ALPHA),
  '6c1d74367a72a0ac830b0f5fdd8f0ee93bc9453c9b8c3cc4d470c2becca9d220',
  'Ring3 Alpha 字节合同保持不变',
);
assert.equal(CIRCLE_TEXTURE_SIZE, 512, 'Circle 纹理尺寸保持 512');
assert.equal(CIRCLE_TEXTURE_RGBA.length, 512 * 512 * 4, 'Circle 纹理完整解码');
assert.equal(TRAIL_TEXTURE_WIDTH, 512, 'Trail RGB 宽度保持 512');
assert.equal(TRAIL_TEXTURE_HEIGHT, 512, 'Trail RGB 高度保持 512');
assert.equal(TRAIL_TEXTURE_RGB.length, 512 * 512 * 3, 'Trail RGB 完整解码');
assert.equal(TRAIL_TEXTURE_COVERAGE.length, 512 * 512, 'Trail Coverage 完整解码');
assert.equal(TRAIL_TEXTURE_RGBA.length, 512 * 512 * 4, 'Trail RGBA 完整解码');
assert.equal(
  sha256(TRAIL_TEXTURE_RGB),
  '9ef29db2147501c40c1ff0f1cd0848cd6e017a46b0e8aa0af685eef568d4faa0',
  'Trail RGB 字节合同保持不变',
);
assert.equal(TRIANGLE_TEXTURE_SIZE, 128, 'Triangle 纹理尺寸保持 128');
assert.equal(TRIANGLE_TEXTURE_COVERAGE.length, 128 * 128, 'Triangle Coverage 完整解码');
assert.equal(TRIANGLE_TEXTURE_RGBA.length, 128 * 128 * 4, 'Triangle RGBA 完整解码');
assert.equal(
  TRIANGLE_TEXTURE_OVERLAY_RGBA.length,
  TRIANGLE_TEXTURE_RGBA.length,
  'Triangle 覆盖纹理保持 RGBA 长度',
);

assert(
  sourceFiles.webgl2.includes('gl.R8') &&
    sourceFiles.webgl2.includes('float textureAlpha = texture(u_texture, v_uv).r;') &&
    sourceFiles.webgl2.includes('layout(location = 1) in vec2 a_uv;') &&
    !sourceFiles.webgl2.includes('a_textureAlpha'),
  'WebGL2 继续使用 Ring3 逐片元采样',
);
for (const [label, source] of [
  ['完整 WebGL2', sourceFiles.webgl2],
  ['WebGL2 Bloom', sourceFiles.webgl2Bloom],
])
{
  assert(
    source.includes('transportEnergy = contribution;') &&
      source.includes('outColor = vec4(brightPass, transportEnergy);') &&
      source.includes('outColor = accumulatedCoarse + currentFine;'),
    `${label} 保留独立 Bloom 传输能量合同`,
  );
}
assert(
  sourceFiles.fx.includes('function prepareLinearTintedTextureCanvas') &&
    sourceFiles.fx.includes('energyRgb[targetOffset] = textureRgb[targetOffset] * exactCoverage') &&
    sourceFiles.fx.includes('image.data[outputOffset + 3] = coverageByte'),
  'Canvas 源码继续在线性空间保留 Coverage 写回',
);

const canvas = new MockCanvas();
const fx = new BAClickFX({
  target: canvas,
  inputSource: 'manual',
  effectBackend: 'canvas2d',
  bloomBackend: 'native',
});
assert.equal(fx.canvas, canvas, '源码入口可以绑定 Mock Canvas');
fx.resize(640, 480, 1);
assert.equal(fx.width, 640, '源码入口 resize 更新宽度');
assert.equal(fx.height, 480, '源码入口 resize 更新高度');
fx.destroy();
assert.equal(fx.destroyed, true, '源码入口可以销毁实例');

console.log('\n源码入口与资源合同通过');
