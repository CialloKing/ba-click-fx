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
effect.bloomRenderer.sourceContext.strokeStyles = [];
effect.bloomRenderer.sourceContext.strokeLineCaps = [];
effect.bloomRenderer.sourceContext.strokeShadowBlurs = [];
effect.bloomRenderer.sourceContext.conicGradients = [];
effect.bloomRenderer.sourceContext.radialGradients = [];
const bloomSourceFillStart = effect.bloomRenderer.sourceContext.fillCount;
now = flushFrames(dom, now, 1);
assert(effect.context.strokeCount > 0, '运行帧实际绘制连续轨迹');
assert(effect.context.fillCount > 0, '运行帧实际绘制圆盘与三角粒子');
const softwareBloomDrawCount = effect.context.drawImageCalls.length;
const bloomCanvases = dom.createdCanvases.filter((canvas) =>
  canvas !== effect.canvas && canvas !== effect.contrastCanvas);

assert(softwareBloomDrawCount > 0, '软件 Bloom 将低分辨率结果绘回主 Canvas');
assert(
  effect.context.drawImageCalls.at(-1).compositeOperation === 'lighter',
  '软件 Bloom 使用 lighter 进行加色合成',
);
assert(
  lastBloomBeginFrameArgs?.length === 6 &&
    lastBloomBeginFrameArgs[4] === UNITY_FX_TOUCH.bloom.skipIterations &&
    lastBloomBeginFrameArgs[5] === effect.dpr,
  '软件 Bloom 同时传入 URP skipIterations 与物理像素采样倍率',
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
  effect.bloomRenderer.sourceCanvas.width < effect.canvas.width * 0.25,
  '软件 Bloom 只处理特效包围区域，不回读整张主画面',
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
  '原生回退不在拖尾分段接缝叠加 shadowBlur',
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
assert(
  effect.destroyed && effect.canvas.removed && effect.contrastCanvas.removed,
  'destroy() 移除监听与两张自有 Canvas',
);

console.log(`\n✅ ${passed} 项 FX_Touch 移植检查通过\n`);
