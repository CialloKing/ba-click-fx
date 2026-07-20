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

function getCssChannels(value)
{
  return String(value).match(/[\d.]+/g)?.map(Number) ?? [];
}

function getCssColorEnergy(value)
{
  const channels = getCssChannels(value).slice(0, 3);

  return channels.length === 3 ? Math.max(...channels) : 0;
}

function getCssAlpha(value)
{
  return getCssChannels(value)[3] ?? 1;
}

function getCssPremultipliedEnergy(value)
{
  return getCssColorEnergy(value) * getCssAlpha(value);
}

function getCssPremultipliedSum(value)
{
  const channels = getCssChannels(value);
  const alpha = channels[3] ?? 1;

  return channels.slice(0, 3).reduce((sum, channel) => sum + channel, 0) * alpha;
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
    this.radialGradients = [];
    this.linearGradients = [];
    this.conicGradients = [];
    this.fillRects = [];
    this.drawImageCalls = [];
    this.putImageDataCount = 0;
    this.getImageDataCalls = [];
    this.clearRectCalls = [];
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
  clearRect(...args)
  {
    this.clearRectCalls.push(args);
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

  fillRect(...args)
  {
    this.fillRects.push(
      {
        args,
        fillStyle: this.fillStyle,
        compositeOperation: this.globalCompositeOperation,
      },
    );

    if (args[2] > 0 && args[3] > 0)
    {
      this.hasVisiblePixels = true;
    }
  }

  createRadialGradient(...args)
  {
    const gradient = new GradientMock();

    this.radialGradients.push({ args, gradient });
    return gradient;
  }

  createLinearGradient(...args)
  {
    const gradient = new GradientMock();

    this.linearGradients.push({ args, gradient });
    return gradient;
  }

  createConicGradient(...args)
  {
    const gradient = new GradientMock();

    this.conicGradients.push({ args, gradient });
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
    this.getImageDataCalls.push([_x, _y, width, height]);
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

  putImageData(imageData, ...args)
  {
    this.putImageDataCount++;
    this.lastImageData = imageData;
    this.lastPutImageDataArgs = args;
    this.hasVisiblePixels = imageData.data.some((value) => value > 0);
  }

  drawImage(...args)
  {
    this.drawImageCalls.push(
      {
        args,
        compositeOperation: this.globalCompositeOperation,
        filter: this.filter,
      },
    );

    if (args[0]?.context?.hasVisiblePixels)
    {
      this.hasVisiblePixels = true;
    }
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
  const appendedCanvases = [];
  let nextFrameId = 1;
  let appendedCanvas = null;

  body.appendChild = (canvas) =>
  {
    appendedCanvas = canvas;
    appendedCanvases.push(canvas);
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
    appendedCanvases,
    get appendedCanvas()
    {
      return appendedCanvas;
    },
  };
}

function flushFrames(dom, startTime, count, frameMs = 1000 / 60)
{
  let now = startTime;

  for (let index = 0; index < count && dom.frames.size > 0; index++)
  {
    now += frameMs;
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
assert(
  UNITY_FX_TOUCH.rings.hdrIntensity === 5.992157,
  '圆环使用 FX_MAT_Touch_Tri3 的原始白色 HDR 强度',
);
assert(UNITY_FX_TOUCH.rings.arcSamples > 0, '圆环使用连续环带而不是离散短弧');
assert(
  JSON.stringify(UNITY_FX_TOUCH.rings.sizeKeys) === JSON.stringify(
    [
      [0.007209778, 0.42050898, 2.4004734, 2.4004734],
      [0.21392822, 0.7159773, 0.9115745, 0.9115745],
      [1, 1, 0, 0],
    ],
  ) &&
    JSON.stringify(UNITY_FX_TOUCH.rings.dissolveKeys) === JSON.stringify(
      [
        [0, 1, 0, 0],
        [0.2, 0, 0, 2.4249368],
        [1, 1, 0.27735636, 0.27735636],
      ],
    ),
  '圆环尺寸与溶解曲线保留 Unity 的四字段 Hermite 关键帧',
);
assert(
  UNITY_FX_TOUCH.rings.bandToOuterRadius === 0.0598573766034603 &&
    UNITY_FX_TOUCH.rings.widthStart === 1 &&
    UNITY_FX_TOUCH.rings.widthEnd === 1,
  '圆环宽度按 MeshTri 外半径比例计算，生命周期倍率保持 1',
);
assert(
  UNITY_FX_TOUCH.rings.textureAlphaKeys.length === 17 &&
    UNITY_FX_TOUCH.rings.textureAlphaKeys[0][0] === 0 &&
    UNITY_FX_TOUCH.rings.textureAlphaKeys.at(-1)[0] === 1 &&
    UNITY_FX_TOUCH.rings.textureRadialAlphaKeys[8][1] === 1,
  '圆环使用 FX_TEX_Grad_Ring3 完整 U 向与径向 Alpha 采样',
);
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
assert(UNITY_FX_TOUCH.trail.width === 2, '清晰拖尾本体使用 Unity 的 2px 带宽');
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
    UNITY_FX_TOUCH.bloom.scatter === 0.35 &&
    UNITY_FX_TOUCH.bloom.skipIterations === 1 &&
    UNITY_FX_TOUCH.bloom.highQualityFiltering === true &&
    !('iterations' in UNITY_FX_TOUCH.bloom),
  '软件 Bloom 保留 Unity 运行工程的 Volume 参数',
);
assert(
  UNITY_FX_TOUCH.bloom.trailEmissionAlpha === 1 &&
    UNITY_FX_TOUCH.bloom.ringEmissionAlpha === 0.65 &&
    UNITY_FX_TOUCH.bloom.diskEmissionAlpha === 1 &&
    UNITY_FX_TOUCH.bloom.trailAlpha === 0.18,
  '软件 HDR 发射使用资源 Alpha，原生阴影回退单独标定',
);
assert(
  CONFIG.lightBackgroundContrastAlpha === 0.35,
  '浅色背景对比层保留 0.35 的青色轮廓以改善白色背景可见性',
);

console.log('\n配置隔离');
const leftConfig = createConfig();
const rightConfig = createConfig();

leftConfig.scale = 2;
assert(rightConfig.scale === CONFIG.scale, '实例配置互不污染');

console.log('\n指针生命周期');
const dom = installDom();
const effect = new BAClickFX();
const originalBloomBeginFrame = effect.bloomRenderer.beginFrame.bind(
  effect.bloomRenderer,
);
const originalBloomComposite = effect.bloomRenderer.composite.bind(
  effect.bloomRenderer,
);
let lastBloomBeginFrameArgs = null;
let lastBloomCompositeSettings = null;

effect.bloomRenderer.beginFrame = (...args) =>
{
  lastBloomBeginFrameArgs = args;
  return originalBloomBeginFrame(...args);
};
effect.bloomRenderer.composite = (context, settings) =>
{
  lastBloomCompositeSettings = settings;
  return originalBloomComposite(context, settings);
};

let now = flushFrames(dom, performance.now(), 1);

assert(
  dom.appendedCanvas === effect.contrastCanvas &&
    dom.appendedCanvases.length === 2 &&
    dom.appendedCanvases[0] === effect.canvas &&
    dom.appendedCanvases[1] === effect.contrastCanvas,
  '默认按主加色层、对比层的顺序创建两张全屏 Canvas',
);
assert(effect.width === 1920 && effect.height === 1080, '按 CSS 尺寸建立 1080p 坐标系');
assert(
  effect.canvas.style.mixBlendMode === 'plus-lighter',
  '自有叠加 Canvas 使用元素级加色混合，不会在浅色 DOM 背景上压黑',
);
assert(
  effect.contrastCanvas.style.mixBlendMode === 'darken' &&
    Number(effect.contrastCanvas.style.zIndex) > Number(effect.canvas.style.zIndex),
  '微弱对比 Canvas 使用 darken 并位于主加色层上方',
);

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

function sampleRingGradients(ageMs)
{
  probeWave.ageMs = ageMs;
  probeWave.rings = [probeRing];
  probeRing.rotation = 0;
  effect.context.conicGradients = [];
  const fillStart = effect.context.fillCount;
  const fillStyleStart = effect.context.filledStyles.length;

  probeWave.draw(effect.context, 1, 1, false);

  return {
    gradients: effect.context.conicGradients.map((entry) => entry.gradient),
    fillStyles: effect.context.filledStyles.slice(fillStyleStart),
    fillCount: effect.context.fillCount - fillStart,
  };
}

const earlierRing = sampleRingGradients(240);
const laterRing = sampleRingGradients(300);
const earlierStops = earlierRing.gradients.flatMap((gradient) => gradient.stops);
const laterStops = laterRing.gradients.flatMap((gradient) => gradient.stops);
const earlierSurvivingStops = earlierStops.filter(([, color]) =>
  getCssAlpha(color) > 0);
const laterSurvivingStops = laterStops.filter(([, color]) =>
  getCssAlpha(color) > 0);

assert(
  earlierRing.fillCount === UNITY_FX_TOUCH.rings.radialSamples &&
    earlierRing.gradients.length === UNITY_FX_TOUCH.rings.radialSamples &&
    earlierRing.fillStyles.every((style, index) =>
      style === earlierRing.gradients[index]),
  '圆环用 radialSamples 条 conic gradient 环带还原纹理径向亮度',
);
assert(
  earlierRing.gradients.every((gradient) =>
    gradient.stops.length === UNITY_FX_TOUCH.rings.arcSamples + 1 &&
      gradient.stops[0][0] === 0 &&
      gradient.stops.at(-1)[0] === 1),
  '每条径向环带都完整采样 0..1 的纹理 U 坐标',
);
assert(
  earlierStops.every(([, color]) =>
  {
    const alpha = getCssAlpha(color);

    return alpha === 0 || alpha === 1;
  }),
  '原 Shader 的二值 clip 使采样点只保留或丢弃，不额外生成溶解软边',
);
assert(
  laterSurvivingStops.length < earlierSurvivingStops.length,
  '生命周期晚期溶解阈值升高，通过 clip 的纹理采样点更少',
);
const colorProbeIndex = Math.round(0.3125 * UNITY_FX_TOUCH.rings.arcSamples);
const edgeProbeColor = earlierRing.gradients[0].stops[colorProbeIndex][1];
const centerProbeColor = earlierRing.gradients[
  Math.floor(UNITY_FX_TOUCH.rings.radialSamples * 0.5)
].stops[colorProbeIndex][1];
const particleChannels = getCssChannels(centerProbeColor);

assert(
  particleChannels[0] < particleChannels[1] &&
    particleChannels[0] < particleChannels[2],
  '圆环粒子 RGB 在 Unity Linear 空间插值后保留红低于绿蓝的青蓝色调',
);
assert(
  getCssPremultipliedSum(centerProbeColor) >
    getCssPremultipliedSum(edgeProbeColor),
  '纹理径向中心采样比环带边缘更亮',
);

const savedRingColorKeys = probeWave.fx.rings.colorKeys;
let linearGradientBuildCount = 0;

// 前面的纹理采样测试只保留一枚圆环；这里恢复完整组，才能锁定共享计算。
probeWave.rings = savedRings;
probeWave.fx.rings.colorKeys = new Proxy(savedRingColorKeys,
  {
    get(target, property, receiver)
    {
      if (property === 'map')
      {
        return (...args) =>
        {
          linearGradientBuildCount++;
          return target.map(...args);
        };
      }

      return Reflect.get(target, property, receiver);
    },
  });
probeWave.draw(effect.context, 1, 1, false);
const visibleRingEnergyBuildCount = linearGradientBuildCount;

linearGradientBuildCount = 0;
probeWave.drawBloom(effect.bloomRenderer.sourceContext, 1, 1);
const emissionRingEnergyBuildCount = linearGradientBuildCount;

probeWave.fx.rings.colorKeys = savedRingColorKeys;
assert(
  probeWave.rings.length === UNITY_FX_TOUCH.rings.count &&
    visibleRingEnergyBuildCount === 1 &&
    emissionRingEnergyBuildCount === 1,
  '同组两枚圆环在每个渲染 pass 只构建一次 Linear Gradient 能量',
);

probeWave.ageMs = savedRingAge;
probeWave.rings = savedRings;
probeRing.rotation = savedRingRotation;
probeRing.angularBlend = savedAngularBlend;
probeRing.angularVelocity = savedAngularVelocity;
effect.context.conicGradients = [];

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
effect.context.conicGradients = [];
effect.contrastContext.drawImageCalls = [];
effect.contrastContext.conicGradients = [];
effect.bloomRenderer.sourceContext.strokeStyles = [];
effect.bloomRenderer.sourceContext.strokeLineCaps = [];
effect.bloomRenderer.sourceContext.strokeShadowBlurs = [];
effect.bloomRenderer.sourceContext.conicGradients = [];
effect.bloomRenderer.sourceContext.radialGradients = [];
effect.bloomRenderer.sourceContext.getImageDataCalls = [];
const bloomSourceFillStart = effect.bloomRenderer.sourceContext.fillCount;
const savedTrailTextureKeys = effect.fxConfig.trail.textureLongitudinalKeys;
let trailEnergyBuildCount = 0;

// 每次分段能量求值只读取一次纹理关键帧。统计属性读取可证明后续绘制、
// 区域计算和发射 pass 使用缓存，而不是仅检查缓存数组恰好存在。
Object.defineProperty(effect.fxConfig.trail, 'textureLongitudinalKeys',
  {
    configurable: true,
    enumerable: true,
    get()
    {
      trailEnergyBuildCount++;
      return savedTrailTextureKeys;
    },
  });
now = flushFrames(dom, now, 1);
Object.defineProperty(effect.fxConfig.trail, 'textureLongitudinalKeys',
  {
    configurable: true,
    enumerable: true,
    value: savedTrailTextureKeys,
    writable: true,
  });
assert(effect.context.strokeCount > 0, '运行帧实际绘制连续轨迹');
assert(effect.context.fillCount > 0, '运行帧实际绘制圆盘与三角粒子');
const softwareBloomDrawCount = effect.context.drawImageCalls.filter((call) =>
  call.args[0] === effect.bloomRenderer.outputCanvas).length;
const bloomCanvases = dom.createdCanvases.filter((canvas) =>
  canvas !== effect.canvas && canvas !== effect.contrastCanvas);

assert(softwareBloomDrawCount > 0, '软件 Bloom 将低分辨率结果绘回主 Canvas');
assert(
  effect.context.drawImageCalls.at(-1).compositeOperation === 'lighter',
  '软件 Bloom 使用 lighter 进行加色合成',
);
assert(
  lastBloomBeginFrameArgs?.length === 7 &&
    lastBloomBeginFrameArgs[4] === UNITY_FX_TOUCH.bloom.skipIterations &&
    lastBloomBeginFrameArgs[5] === effect.dpr &&
    lastBloomBeginFrameArgs[6]?.width > 0,
  '软件 Bloom 同时传入 URP 参数、物理像素倍率与发射范围',
);
assert(
  lastBloomCompositeSettings?.highQualityFiltering === true &&
    !('iterations' in lastBloomCompositeSettings),
  '软件 Bloom 合成启用 URP 高质量上采样且不再传旧迭代数',
);
assert(
  bloomCanvases.some((canvas) => canvas.context.putImageDataCount > 0),
  '软件 Bloom 数值结果通过 ImageData 写回隐藏 Canvas',
);
assert(
  effect.bloomRenderer.outputContext.lastPutImageDataArgs?.length === 6 &&
    effect.bloomRenderer.outputContext.lastPutImageDataArgs[0] === 0 &&
    effect.bloomRenderer.outputContext.lastPutImageDataArgs[1] === 0 &&
    effect.bloomRenderer.outputContext.lastPutImageDataArgs[4] > 0 &&
    effect.bloomRenderer.outputContext.lastPutImageDataArgs[5] > 0 &&
    effect.bloomRenderer.outputContext.lastPutImageDataArgs[4] <=
      effect.bloomRenderer.width &&
    effect.bloomRenderer.outputContext.lastPutImageDataArgs[5] <=
      effect.bloomRenderer.height,
  '软件 Bloom 只写回实际辉光区域，不上传整张工作 Canvas',
);
assert(
  effect.bloomRenderer.sourceCanvas.width < effect.canvas.width * 0.25,
  '软件 Bloom 只处理特效包围区域，不回读整张主画面',
);
assert(
  effect.bloomRenderer.sourceContext.getImageDataCalls.length === 1 &&
    effect.bloomRenderer.sourceContext.getImageDataCalls[0][0] ===
      effect.bloomRenderer.sourceReadBounds.x &&
    effect.bloomRenderer.sourceContext.getImageDataCalls[0][1] ===
      effect.bloomRenderer.sourceReadBounds.y &&
    effect.bloomRenderer.sourceContext.getImageDataCalls[0][2] ===
      effect.bloomRenderer.sourceReadBounds.width &&
    effect.bloomRenderer.sourceContext.getImageDataCalls[0][3] ===
      effect.bloomRenderer.sourceReadBounds.height &&
    effect.bloomRenderer.sourceReadBounds.width *
      effect.bloomRenderer.sourceReadBounds.height <
      effect.bloomRenderer.sourceWidth * effect.bloomRenderer.sourceHeight,
  '软件 Bloom 只回读发射几何，不读取外围纯透明 padding',
);
assert(
  effect.bloomRenderer.sourceContext.fillCount - bloomSourceFillStart ===
    1 + UNITY_FX_TOUCH.rings.count * UNITY_FX_TOUCH.rings.radialSamples,
  '三角形碎片不写入 Bloom，发射填充只包含光盘与圆环径向采样带',
);
assert(
  effect.context.conicGradients.length ===
      UNITY_FX_TOUCH.rings.count * UNITY_FX_TOUCH.rings.radialSamples &&
    effect.bloomRenderer.sourceContext.conicGradients.length ===
      UNITY_FX_TOUCH.rings.count * UNITY_FX_TOUCH.rings.radialSamples,
  '可见圆环与 Bloom 发射源都使用完整径向 conic gradient 填充',
);
assert(
  effect.contrastContext.drawImageCalls.length === 1 &&
    effect.contrastContext.drawImageCalls[0].args[0] === effect.canvas &&
    effect.contrastContext.drawImageCalls[0].compositeOperation ===
      'source-over' &&
    effect.contrastContext.conicGradients.length === 0,
  '软件 Bloom 对比层直接复用清晰主 Canvas，不重复构建圆环渐变',
);
const ringEmissionStops = effect.bloomRenderer.sourceContext
  .conicGradients[0].gradient.stops;
const peakRingEmission = ringEmissionStops.reduce(
  (maximum, [, color]) => Math.max(maximum, getCssColorEnergy(color)),
  0,
);

assert(
  peakRingEmission > 0,
  '圆环通过专用发射采样写入 Bloom，不复用原生阴影 Alpha',
);
const contrastTint = effect.contrastContext.fillRects.at(-1);

assert(
  contrastTint?.compositeOperation === 'source-in' &&
    getCssAlpha(contrastTint.fillStyle) === CONFIG.lightBackgroundContrastAlpha,
  '对比层内部用 source-in 将微弱青色只限制在特效遮罩中',
);
assert(
  contrastTint.args[2] === effect.contrastCanvas.width &&
    contrastTint.args[3] === effect.contrastCanvas.height &&
    effect.contrastContext.hasVisiblePixels,
  '对比层着色覆盖完整内部 Canvas 且保留可见遮罩',
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
const trailSegmentCount = effect.trailStrokes[0].points.length - 1;
const cachedTrailFrameData = effect.trailStrokes[0].trailFrameData;
const visibleTrailStyles = effect.context.strokeStyles.slice(0, trailSegmentCount);
const bloomTrailStyles = effect.bloomRenderer.sourceContext.strokeStyles.slice(
  0,
  trailSegmentCount,
);

assert(
  effect.context.strokeWidths
    .slice(0, trailSegmentCount)
    .every((width) => Math.abs(
      width - UNITY_FX_TOUCH.trail.width * SIZE_CORRECTION,
    ) < 0.01),
  '可见拖尾只绘制一层 2px Unity 几何带',
);
assert(
  visibleTrailStyles[0] === 'rgba(0, 0, 0, 0)',
  '拖尾零纹理能量严格编码为透明，不会在浅色背景形成黑段',
);
assert(
  getCssPremultipliedEnergy(visibleTrailStyles.at(-1)) >
    getCssPremultipliedEnergy(visibleTrailStyles[0]) + 100,
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
assert(
  cachedTrailFrameData?.segmentEnergies.length === trailSegmentCount &&
    cachedTrailFrameData.segmentMaximumEnergies.length === trailSegmentCount &&
    trailEnergyBuildCount === trailSegmentCount,
  '同一帧的可见拖尾、Bloom 区域和发射绘制共享分段能量缓存',
);
const expectedBloomSegmentCount = cachedTrailFrameData
  .segmentMaximumEnergies
  .filter((energy) =>
    energy * effect.config.opacity *
      (effect.fxConfig.trail.trailOpacity ?? 1) *
      effect.fxConfig.bloom.trailEmissionAlpha >
      0.5 * Math.max(1, effect.fxConfig.bloom.emissionRange) / 255)
  .length;
assert(
  bloomTrailStyles.length === expectedBloomSegmentCount &&
    expectedBloomSegmentCount < trailSegmentCount,
  'Bloom 发射绘制只跳过量化后严格为零的暗尾分段',
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
const nativeLinearGradientStart = effect.context.linearGradients.length;
const nativeDrawImageStart = effect.context.drawImageCalls.length;
const nativeContrastCopyStart = effect.contrastContext.drawImageCalls.length;

// 首尾接近的回环路径会暴露首尾弦渐变的投影错误。
effect.trailStrokes[0].points = [
  { x: 400, y: 300, bornAt: now },
  { x: 520, y: 180, bornAt: now },
  { x: 650, y: 300, bornAt: now },
  { x: 520, y: 430, bornAt: now },
  { x: 410, y: 310, bornAt: now },
];

effect.updateConfig({ softwareBloomEnabled: false });
now = flushFrames(dom, now, 1);
assert(
  effect.context.drawImageCalls.filter((call) =>
    call.args[0] === effect.bloomRenderer.outputCanvas).length ===
      softwareBloomDrawCount,
  '关闭软件 Bloom 后不再绘制 ImageData 辉光层',
);
assert(
  effect.contrastContext.drawImageCalls.length === nativeContrastCopyStart,
  '原生辉光模式不复制带光晕的主 Canvas，继续独立绘制对比遮罩',
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
  '原生回退不在拖尾分段接缝叠加 shadowBlur',
);
const nativeBloomSurface = effect.nativeTrailBloomSurface;
const nativeGlowStyles = nativeBloomSurface.context.strokeStyles;
const nativeBlurDraws = effect.context.drawImageCalls
  .slice(nativeDrawImageStart)
  .filter((call) => call.filter !== 'none');

assert(
  effect.context.strokeFilters
    .slice(nativeFilterStart)
    .every((filter) => filter === 'none') &&
    nativeBlurDraws.length === 1 &&
    nativeBlurDraws[0].args.length === 9,
  '原生回退在局部缓冲完成着色后只执行一次整体模糊',
);
assert(
  effect.context.linearGradients.length === nativeLinearGradientStart &&
    nativeGlowStyles.length === effect.trailStrokes[0].points.length - 1,
  '原生回退按真实路径距离逐段写入发射颜色，不再使用首尾弦渐变',
);
assert(
  nativeGlowStyles[0] === 'rgba(0, 0, 0, 0)' &&
    getCssPremultipliedEnergy(nativeGlowStyles.at(-1)) > 20,
  '回环轨迹的尾部保持无辉光，头部仍保留原生模糊能量',
);
assert(
  nativeBloomSurface.canvas.width < effect.canvas.width &&
    nativeBloomSurface.canvas.height < effect.canvas.height,
  '原生拖尾辉光只分配轨迹附近的局部缓冲',
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
assert(
  effect.destroyed && effect.canvas.removed && effect.contrastCanvas.removed,
  'destroy() 移除监听与两张自有 Canvas',
);

console.log('\nSoftware Bloom 多区域性能');
const regionEffect = new BAClickFX();

regionEffect.boom(160, 540);
regionEffect.boom(1760, 540);
let regionNow = flushFrames(dom, performance.now(), 1);
const regionStats = regionEffect.softwareBloomFrameStats;
const initialRegion = regionEffect._getSoftwareBloomRegions(1)[0];
const rendererPool = [...regionEffect.bloomRenderers];
const canvasCountAfterPoolGrowth = dom.createdCanvases.length;

assert(
  regionStats.regionCount === 2 && regionEffect.bloomRenderers.length === 2,
  '相距较远的点击拆成两个独立 Bloom 区域',
);
assert(
  initialRegion.emissionBounds.width <
    UNITY_FX_TOUCH.rings.radiusMax * 2,
  '点击早期按当前圆环尺寸收紧发射区域，不预留最终半径',
);
assert(
  regionStats.processedSourcePixels < regionStats.combinedBoundsPixels * 0.5,
  '拆区后的实际处理像素不足旧总包围框的一半',
);

regionNow = flushFrames(dom, regionNow, 1);
assert(
  regionEffect.bloomRenderers.every((renderer, index) =>
    renderer === rendererPool[index]) &&
    dom.createdCanvases.length === canvasCountAfterPoolGrowth,
  'Bloom renderer 池跨帧复用，不重复创建工作 Canvas',
);

const reusableRenderer = regionEffect.bloomRenderer;

reusableRenderer.beginFrame(
  regionEffect.width,
  regionEffect.height,
  UNITY_FX_TOUCH.bloom.resolutionScale,
  { x: 0, y: 0, width: 720, height: 720 },
  UNITY_FX_TOUCH.bloom.skipIterations,
  regionEffect.dpr,
);
const bloomCapacityWidth = reusableRenderer.outputCanvas.width;
const bloomCapacityHeight = reusableRenderer.outputCanvas.height;
const sourceCapacityBuffer = reusableRenderer.sourceLinear.buffer;
const levelCapacityBuffers = reusableRenderer.levels.map((level) =>
  [level.down.buffer, level.up.buffer, level.scratch.buffer]);
const capacityAllocationCount = reusableRenderer.floatBufferAllocationCount;

reusableRenderer.outputContext.clearRectCalls = [];

assert(
  reusableRenderer.beginFrame(
    regionEffect.width,
    regionEffect.height,
    UNITY_FX_TOUCH.bloom.resolutionScale,
    { x: 100, y: 100, width: 128, height: 128 },
    UNITY_FX_TOUCH.bloom.skipIterations,
    regionEffect.dpr,
    null,
  ),
  '显式空发射范围会安全回退到完整 Bloom 区域',
);

reusableRenderer.beginFrame(
  regionEffect.width,
  regionEffect.height,
  UNITY_FX_TOUCH.bloom.resolutionScale,
  { x: 100, y: 100, width: 128, height: 128 },
  UNITY_FX_TOUCH.bloom.skipIterations,
  regionEffect.dpr,
);
assert(
  reusableRenderer.sourceLinear.buffer === sourceCapacityBuffer &&
    reusableRenderer.levels.every((level, index) =>
      level.down.buffer === levelCapacityBuffers[index][0] &&
        level.up.buffer === levelCapacityBuffers[index][1] &&
        level.scratch.buffer === levelCapacityBuffers[index][2]) &&
    reusableRenderer.floatBufferAllocationCount === capacityAllocationCount,
  '区域缩小时复用 Float32 backing buffer，不产生新的金字塔分配',
);
assert(
  (reusableRenderer.width < bloomCapacityWidth ||
    reusableRenderer.height < bloomCapacityHeight) &&
    reusableRenderer.outputContext.clearRectCalls.at(-1)?.[2] ===
      bloomCapacityWidth &&
    reusableRenderer.outputContext.clearRectCalls.at(-1)?.[3] ===
      bloomCapacityHeight,
  'Bloom 活动尺寸变化时清除完整容量 Canvas，避免旧辉光形成边界细线',
);

regionEffect.clear();
regionEffect.boom(800, 540);
regionEffect.boom(920, 540);
regionNow = flushFrames(dom, regionNow, 1);
assert(
  regionEffect.softwareBloomFrameStats.regionCount === 1,
  '支撑范围相交的点击仍合并计算，保留邻近特效能量交互',
);

regionEffect.destroy();
assert(
  rendererPool.every((renderer) =>
    renderer.sourceCanvas.width === 0 && renderer.outputCanvas.width === 0),
  '销毁实例时同时释放 renderer 池的所有工作缓冲',
);

console.log('\n低帧率生命周期');
const stalledEffect = new BAClickFX();

stalledEffect.boom(960, 540);
let stalledNow = performance.now();
stalledNow = flushFrames(dom, stalledNow, 1, 1000);
assert(
  stalledEffect.waves.length === 0 && stalledEffect.shards.length === 0,
  '长帧后按真实时间结束过期特效，不因 delta 限制继续积压 Bloom',
);
stalledEffect.destroy();

const expiredTrailEffect = new BAClickFX();
const expirationNow = performance.now();
const expiringPoints = [];

for (let index = 0; index < 4096; index++)
{
  expiringPoints.push(
    {
      x: index,
      y: 0,
      bornAt: index < 4000
        ? expirationNow - UNITY_FX_TOUCH.trail.lifetimeMs
        : expirationNow,
    },
  );
}

let trailShiftCount = 0;

expiringPoints.shift = () =>
{
  trailShiftCount++;
  return Array.prototype.shift.call(expiringPoints);
};
expiredTrailEffect.trailStrokes.push(
  {
    active: false,
    points: expiringPoints,
  },
);
expiredTrailEffect._updateTrail(expirationNow, 1, false);
assert(
  trailShiftCount === 0 && expiringPoints.length === 96,
  '大量过期轨迹顶点一次批量删除，不重复 shift 搬移数组',
);
expiredTrailEffect.destroy();

console.log('\nLegacy 模式');
const legacyEffect = new BAClickFX({ renderingMode: 'legacy' });

legacyEffect.boom(960, 540);
legacyEffect.context.filledPaths = [];
let legacyNow = flushFrames(dom, performance.now(), 1);
const legacyRingPaths = legacyEffect.context.filledPaths.filter((path) =>
  path.length > 3);
const legacyTrianglePaths = legacyEffect.context.filledPaths.filter((path) =>
  path.length === 3);

assert(
  legacyRingPaths.length >= UNITY_FX_TOUCH.rings.count,
  'Legacy 点击后的第一帧正常绘制圆环',
);
assert(
  legacyTrianglePaths.length === UNITY_FX_TOUCH.shards.clickCount,
  'Legacy 点击后的第一帧同时绘制三角碎片',
);

legacyNow = flushFrames(dom, legacyNow, 50);
legacyEffect.destroy();
assert(legacyEffect.destroyed, 'Legacy 实例可正常结束完整生命周期并销毁');

console.log(`\n✅ ${passed} 项 FX_Touch 移植检查通过\n`);
