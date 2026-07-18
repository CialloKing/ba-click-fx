/**
 * FX_Touch 移植烟雾测试。
 *
 * 测试只锁定从 Unity 恢复出的行为参数和生命周期；不再维护旧调参 API。
 */

const modulePath = process.argv.includes('--source')
  ? '../src/fx.js'
  : '../dist/ba-click-fx.js';
const module = await import(modulePath);
const { BAClickFX, CONFIG, UNITY_FX_TOUCH, createConfig, SIZE_CORRECTION } = module;

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

function getCssColorEnergy(value)
{
  const channels = String(value).match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];

  return channels.length === 3 ? Math.max(...channels) : 0;
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
  constructor(canvas)
  {
    this.canvas = canvas;
    this.strokeCount = 0;
    this.fillCount = 0;
    this.currentPath = [];
    this.filledPaths = [];
    this.filledStyles = [];
    this.strokeWidths = [];
    this.strokeStyles = [];
    this.strokeLineCaps = [];
    this.strokeShadowBlurs = [];
    this.strokeFilters = [];
    this.strokedPaths = [];
    this.fillShadowBlurs = [];
    this.fillShadowColors = [];
    this.linearGradients = [];
    this.drawImageCalls = [];
    this.putImageDataCount = 0;
    this.hasVisiblePixels = false;
    this.globalCompositeOperation = 'source-over';
    this.shadowBlur = 0;
    this.shadowColor = 'transparent';
    this.filter = 'none';
    this.stateStack = [];
  }

  setTransform()
  {
  }
  clearRect()
  {
    this.hasVisiblePixels = false;
  }

  save()
  {
    this.stateStack.push(
      {
        globalCompositeOperation: this.globalCompositeOperation,
        shadowBlur: this.shadowBlur,
        shadowColor: this.shadowColor,
        filter: this.filter,
      },
    );
  }

  restore()
  {
    const state = this.stateStack.pop();

    if (state)
    {
      this.globalCompositeOperation = state.globalCompositeOperation;
      this.shadowBlur = state.shadowBlur;
      this.shadowColor = state.shadowColor;
      this.filter = state.filter;
    }
  }

  translate()
  {
  }

  rotate()
  {
  }
  beginPath()
  {
    this.currentPath = [];
  }

  moveTo(x, y)
  {
    this.currentPath.push([x, y]);
  }

  lineTo(x, y)
  {
    this.currentPath.push([x, y]);
  }
  arc()
  {
  }

  closePath()
  {
  }

  stroke()
  {
    this.strokeCount++;
    this.strokeWidths.push(this.lineWidth);
    this.strokeStyles.push(this.strokeStyle);
    this.strokeLineCaps.push(this.lineCap);
    this.strokeShadowBlurs.push(this.shadowBlur);
    this.strokeFilters.push(this.filter);
    this.strokedPaths.push(this.currentPath.map((point) => [...point]));
    this.hasVisiblePixels = true;
  }

  fill()
  {
    this.fillCount++;
    this.filledPaths.push(this.currentPath.map((point) => [...point]));
    this.filledStyles.push(this.fillStyle);
    this.fillShadowBlurs.push(this.shadowBlur);
    this.fillShadowColors.push(this.shadowColor);
    this.hasVisiblePixels = true;
  }

  createRadialGradient()
  {
    return new GradientMock();
  }

  createLinearGradient(...args)
  {
    const gradient = new GradientMock();

    this.linearGradients.push({ args, gradient });
    return gradient;
  }

  createImageData(width, height)
  {
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    };
  }

  getImageData(_x, _y, width, height)
  {
    const imageData = this.createImageData(width, height);

    if (this.hasVisiblePixels)
    {
      // Mock 不做真实光栅化，用一个 HDR 遮罩像素驱动后续数值管线。
      const pixel = Math.floor(width * height / 2) * 4;

      imageData.data[pixel] = 64;
      imageData.data[pixel + 1] = 160;
      imageData.data[pixel + 2] = 255;
      imageData.data[pixel + 3] = 255;
    }

    return imageData;
  }

  putImageData(imageData)
  {
    this.putImageDataCount++;
    this.lastImageData = imageData;
    this.hasVisiblePixels = imageData.data.some((value) => value > 0);
  }

  drawImage(...args)
  {
    this.drawImageCalls.push(
      {
        args,
        compositeOperation: this.globalCompositeOperation,
      },
    );
  }
}

class CanvasMock extends EventTargetMock
{
  constructor()
  {
    super();
    this.tagName = 'CANVAS';
    this.style = {};
    this.removed = false;
    this.width = 0;
    this.height = 0;
    this.context = new ContextMock(this);
  }

  setAttribute()
  {
  }

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
  const createdCanvases = [];
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

      const canvas = new CanvasMock();

      createdCanvases.push(canvas);
      return canvas;
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
    createdCanvases,
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
assert(UNITY_FX_TOUCH.rings.rotationDirection === -1, '两枚圆环只按逆时针方向旋转');
assert(
  UNITY_FX_TOUCH.rings.angularVelocityMultiplier === 11.170107 &&
    UNITY_FX_TOUCH.rings.angularVelocityMinKeys[1][1] === 0.45561826 &&
    UNITY_FX_TOUCH.rings.angularVelocityMaxKeys[1][1] === -0.06509134,
  '圆环角速度使用 Unity Rotation over Lifetime 的两条衰减曲线',
);
assert(UNITY_FX_TOUCH.rings.hdrIntensity === 1.0, '圆环材质使用 Canvas 适配的 HDR 强度');
assert(UNITY_FX_TOUCH.rings.arcSamples > 0, '圆环使用连续弧带而不是离散短弧');
assert(UNITY_FX_TOUCH.rings.dissolveDirection === 1, '圆环活动端只沿逆时针方向推进');
assert(UNITY_FX_TOUCH.rings.dissolveEdgeRatio > 0, '圆环只在活动端保留溶解软边');
assert(UNITY_FX_TOUCH.shards.clickCount === 4, '点击 burst 固定生成 4 枚碎片');
assert(
  Math.abs(UNITY_FX_TOUCH.shards.clickSpeedMin - 36.945888) < 0.000001 &&
    Math.abs(UNITY_FX_TOUCH.shards.clickSpeedMax - 49.261184) < 0.000001,
  '点击碎片速度包含 ParticleSystem 的 0.3078824 Local 缩放',
);
assert(
  Math.abs(UNITY_FX_TOUCH.shards.trailSpeedMin - 24.630592) < 0.000001 &&
    Math.abs(UNITY_FX_TOUCH.shards.trailSpeedMax - 36.945888) < 0.000001,
  '拖拽碎片速度包含 ParticleSystem 的 0.3078824 Local 缩放',
);
assert(UNITY_FX_TOUCH.shards.trailSpacing === 80, '拖拽每 80px 生成一枚碎片');
assert(UNITY_FX_TOUCH.trail.lifetimeMs === 300, 'TrailRenderer.time 为 0.3 秒');
assert(UNITY_FX_TOUCH.trail.geometryWidth === 2, '1080p TrailRenderer 几何带宽为 2px');
assert(UNITY_FX_TOUCH.trail.width === 4, 'HDR 与 Bloom 合成后的可见亮芯为 4px');
assert(
  UNITY_FX_TOUCH.trail.gradient[0][1].every((channel) => channel === 0) &&
    UNITY_FX_TOUCH.trail.gradient.at(-1)[1][2] === 255,
  'TrailRenderer 原 Gradient 已反向为 Canvas 的尾部到头部点序',
);
assert(
  UNITY_FX_TOUCH.trail.textureLongitudinalKeys[0][1] === 0 &&
    UNITY_FX_TOUCH.trail.textureLongitudinalKeys.at(-1)[1] === 1,
  'FX_TEX_Trail_03 的 Stretch 亮度从尾部黑色过渡到头部全亮',
);
const textureMidpoint = UNITY_FX_TOUCH.trail.textureLongitudinalKeys.find(
  ([position]) => Math.abs(position - 0.499022) < 0.000001,
);

assert(
  textureMidpoint && Math.abs(textureMidpoint[1] - 0.144128269) < 0.000001,
  'sRGB 拖尾纹理中点已预转为 Unity Linear 能量',
);
assert(
  UNITY_FX_TOUCH.bloom.threshold === 1 &&
    UNITY_FX_TOUCH.bloom.intensity === 0.45 &&
    UNITY_FX_TOUCH.bloom.scatter === 0.35,
  '软件 Bloom 保留 Unity 运行工程的 Volume 参数',
);
assert(
  UNITY_FX_TOUCH.bloom.trailEmissionAlpha === 1 &&
    UNITY_FX_TOUCH.bloom.trailAlpha === 0.18,
  '软件 HDR 发射与原生阴影回退分别标定',
);

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
assert(
  effect.waves[0].rings.every((ring) => ring.angularVelocity < 0),
  '每次生成的两枚圆环实际角速度均为逆时针',
);
assert(effect.shards.length === 4, '按下立即生成 4 枚点击碎片');
assert(
  effect.shards.every((shard) =>
  {
    const speed = Math.hypot(shard.velocityX, shard.velocityY);

    // 速度在 createShard 中乘以了含 SIZE_CORRECTION 的 scale
    return speed >= UNITY_FX_TOUCH.shards.clickSpeedMin * SIZE_CORRECTION &&
      speed <= UNITY_FX_TOUCH.shards.clickSpeedMax * SIZE_CORRECTION;
  }),
  '四枚点击碎片实际使用 Local 缩放后的飞溅速度',
);
assert(effect.trailStrokes.length === 1, '按下创建一个 TrailRenderer 行程');

const probeWave = effect.waves[0];
const savedRingAge = probeWave.ageMs;
const savedRings = probeWave.rings;
const probeRing = savedRings[0];
const savedRingRotation = probeRing.rotation;
const savedAngularBlend = probeRing.angularBlend;
const savedAngularVelocity = probeRing.angularVelocity;

probeWave.rings = [probeRing];
probeWave.ageMs = 0;
probeRing.rotation = 0;
probeRing.angularBlend = 0.5;
probeWave.update(16);
const initialAngularSpeed = Math.abs(probeRing.angularVelocity);

probeWave.ageMs = 480;
probeWave.update(16);
const lateAngularSpeed = Math.abs(probeRing.angularVelocity);

assert(lateAngularSpeed < initialAngularSpeed, '圆环角速度随生命周期衰减而不是全程高速旋转');
assert(probeRing.angularVelocity <= 0, '圆环角速度末期只减速、不反向');

function sampleRingEndpoints(ageMs)
{
  probeWave.ageMs = ageMs;
  probeWave.rings = [probeRing];
  probeRing.rotation = 0;
  effect.context.filledPaths = [];
  effect.context.filledStyles = [];
  probeWave.draw(effect.context, 1, 1);

  const path = effect.context.filledPaths[0];
  const activeIndex = path.length / 2 - 1;

  return {
    fixed: path[0],
    active: path[activeIndex],
    fillStyle: effect.context.filledStyles[0],
  };
}

const earlierRingEndpoints = sampleRingEndpoints(240);
const laterRingEndpoints = sampleRingEndpoints(300);
const activeEdgeCross =
  earlierRingEndpoints.active[0] * laterRingEndpoints.active[1] -
  earlierRingEndpoints.active[1] * laterRingEndpoints.active[0];

assert(
  Math.abs(earlierRingEndpoints.fixed[1]) < 0.000001 &&
    Math.abs(laterRingEndpoints.fixed[1]) < 0.000001,
  '圆环缩短前后固定端保持在同一局部方向',
);
assert(activeEdgeCross < 0, '圆环活动端只沿逆时针方向追向固定端');
// Canvas 2D 无 HDR/Tonemap，hdrIntensity 降为 1.5 后末期粒子保留青蓝色调
const fillColor = laterRingEndpoints.fillStyle;
const fillMatch = fillColor.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);

assert(
  fillMatch && Number(fillMatch[3]) > Number(fillMatch[1]) + 50,
  '圆环生命周期末期仍由 HDR 材质保持蓝色高亮核心',
);

probeWave.ageMs = savedRingAge;
probeWave.rings = savedRings;
probeRing.rotation = savedRingRotation;
probeRing.angularBlend = savedAngularBlend;
probeRing.angularVelocity = savedAngularVelocity;
effect.context.filledPaths = [];
effect.context.filledStyles = [];

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
assert(
  effect.shards
    .filter((shard) => shard.kind === 'trail')
    .every((shard) =>
    {
      const speed = Math.hypot(shard.velocityX, shard.velocityY);

      return speed >= UNITY_FX_TOUCH.shards.trailSpeedMin * SIZE_CORRECTION &&
        speed <= UNITY_FX_TOUCH.shards.trailSpeedMax * SIZE_CORRECTION;
    }),
  '拖拽碎片实际使用 Local 缩放后的飞溅速度',
);

effect.context.strokeCount = 0;
effect.context.filledPaths = [];
effect.context.strokeWidths = [];
effect.context.strokeStyles = [];
effect.context.strokeLineCaps = [];
effect.context.strokeFilters = [];
effect.context.strokedPaths = [];
effect.context.fillShadowBlurs = [];
effect.context.fillShadowColors = [];
effect.context.strokeShadowBlurs = [];
effect.context.drawImageCalls = [];
effect.bloomRenderer.sourceContext.strokeStyles = [];
effect.bloomRenderer.sourceContext.strokeLineCaps = [];
effect.bloomRenderer.sourceContext.strokeShadowBlurs = [];
const bloomSourceFillStart = effect.bloomRenderer.sourceContext.fillCount;
now = flushFrames(dom, now, 1);
assert(effect.context.strokeCount > 0, '运行帧实际绘制连续轨迹');
assert(effect.context.fillCount > 0, '运行帧实际绘制圆盘与三角粒子');
const softwareBloomDrawCount = effect.context.drawImageCalls.length;
const bloomCanvases = dom.createdCanvases.filter((canvas) => canvas !== effect.canvas);

assert(softwareBloomDrawCount > 0, '软件 Bloom 将低分辨率结果绘回主 Canvas');
assert(
  effect.context.drawImageCalls.at(-1).compositeOperation === 'lighter',
  '软件 Bloom 使用 lighter 进行加色合成',
);
assert(
  bloomCanvases.some((canvas) => canvas.context.putImageDataCount > 0),
  '软件 Bloom 数值结果通过 ImageData 写回隐藏 Canvas',
);
assert(
  effect.bloomRenderer.sourceCanvas.width < effect.canvas.width * 0.25,
  '软件 Bloom 只处理特效包围区域，不回读整张主画面',
);
assert(
  effect.bloomRenderer.sourceContext.fillCount - bloomSourceFillStart === 1,
  '三角形碎片不写入 Bloom 发射缓冲，仅光盘产生填充发射',
);
assert(
  effect.context.fillShadowBlurs.every((blur) => !blur),
  '软件 Bloom 开启时主图形不叠加原生 shadowBlur',
);
assert(
  effect.context.strokeShadowBlurs.every((blur) => !blur) &&
    effect.bloomRenderer.sourceContext.strokeShadowBlurs.every((blur) => !blur),
  '软件 Bloom 开启时可见与发射拖尾都不叠加 shadowBlur',
);
const ringPath = effect.context.filledPaths
  .filter((path) => path.length > 12)
  .sort((left, right) => right.length - left.length)[0];
// 双向尖角后两端 taper→0，检查中段宽度代替端点
const midIndex = Math.floor(ringPath.length / 4);
const midOuterRadius = Math.hypot(ringPath[midIndex][0], ringPath[midIndex][1]);
const midInnerRadius = Math.hypot(
  ringPath[ringPath.length - 1 - midIndex][0],
  ringPath[ringPath.length - 1 - midIndex][1],
);
assert(
  midOuterRadius - midInnerRadius > 1,
  '圆环中段保持完整宽度，两端均为尖角',
);
assert(
  effect.context.strokeWidths.some((w) => Math.abs(w - UNITY_FX_TOUCH.trail.width * SIZE_CORRECTION) < 0.01),
  '拖尾实际使用 4px HDR 可见亮芯',
);
const trailSegmentCount = effect.trailStrokes[0].points.length - 1;
const visibleTrailStyles = effect.context.strokeStyles.slice(0, trailSegmentCount);
const bloomTrailStyles = effect.bloomRenderer.sourceContext.strokeStyles.slice(
  0,
  trailSegmentCount,
);

assert(
  getCssColorEnergy(visibleTrailStyles.at(-1)) >
    getCssColorEnergy(visibleTrailStyles[0]) + 100,
  '可见拖尾按原 Gradient 与 Stretch 纹理由尾部向头部增强',
);
assert(
  getCssColorEnergy(bloomTrailStyles.at(-1)) >
    getCssColorEnergy(bloomTrailStyles[0]) + 20,
  'Bloom 发射源只在拖尾头部保持高亮',
);
assert(
  effect.bloomRenderer.sourceContext.strokeLineCaps
    .slice(0, trailSegmentCount)
    .every((lineCap) => lineCap === 'butt'),
  'Bloom 拖尾段使用 butt cap，采样点不会重复发光',
);
const trianglePathIndices = effect.context.filledPaths.reduce(
  (indices, path, index) =>
  {
    if (path.length === 3)
    {
      indices.push(index);
    }

    return indices;
  },
  [],
);

assert(trianglePathIndices.length > 0, '运行帧实际绘制了三点碎片路径');
assert(
  trianglePathIndices.every((index) =>
    effect.context.fillShadowBlurs[index] === 0 &&
      effect.context.fillShadowColors[index] === 'transparent'),
  '三角形碎片在主 Canvas 也不设置阴影',
);

const nativeShadowStart = effect.context.fillShadowBlurs.length;
const nativeStrokeStart = effect.context.strokeShadowBlurs.length;
const nativeFilterStart = effect.context.strokeFilters.length;
const nativePathStart = effect.context.strokedPaths.length;
const nativeLinearGradientStart = effect.context.linearGradients.length;

effect.updateConfig({ softwareBloomEnabled: false });
now = flushFrames(dom, now, 1);
assert(
  effect.context.drawImageCalls.length === softwareBloomDrawCount,
  '关闭软件 Bloom 后不再绘制 ImageData 辉光层',
);
assert(
  effect.context.fillShadowBlurs
    .slice(nativeShadowStart)
    .some((blur) => blur > 0),
  '关闭软件 Bloom 后圆环与圆盘仍回退为原生 shadowBlur',
);
assert(
  effect.context.strokeShadowBlurs
    .slice(nativeStrokeStart)
    .every((blur) => !blur),
  '原生回退拖尾不对采样分段叠加 shadowBlur',
);
const nativeFilteredStrokeIndices = effect.context.strokeFilters
  .slice(nativeFilterStart)
  .reduce((indices, filter, index) =>
  {
    if (filter !== 'none')
    {
      indices.push(index);
    }

    return indices;
  }, []);

assert(
  nativeFilteredStrokeIndices.length === 1 &&
    effect.context.strokedPaths[
      nativePathStart + nativeFilteredStrokeIndices[0]
    ].length > 2,
  '原生回退只用一次 filter blur 绘制连续拖尾光晕',
);
assert(
  effect.context.linearGradients.length === nativeLinearGradientStart + 1,
  '原生回退用线性渐变近似拖尾的头亮尾暗',
);

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
