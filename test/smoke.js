/**
 * FX_Touch 移植烟雾测试。
 *
 * 测试只锁定从 Unity 恢复出的行为参数和生命周期；不再维护旧调参 API。
 */

const modulePath = process.argv.includes('--source')
  ? '../src/fx.js'
  : '../dist/ba-click-fx.js';
const module = await import(modulePath);
const {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
  CONFIG,
  UNITY_FX_TOUCH,
  createConfig,
  SIZE_CORRECTION,
} = module;
const nativePerformance = globalThis.performance;

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

    this.dispatchEvent(event);
  }

  dispatchEvent(event)
  {
    if (!event?.type)
    {
      return false;
    }

    for (const listener of this.listeners.get(event.type) ?? [])
    {
      listener(event);
    }

    return true;
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
    this.fillCompositeOperations = [];
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
    this.fillCompositeOperations.push(this.globalCompositeOperation);
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

class ElementMock extends EventTargetMock
{
  constructor(tagName, onAppend = null)
  {
    super();
    this.tagName = tagName.toUpperCase();
    this.style = {};
    this.children = [];
    this.parentElement = null;
    this.removed = false;
    this.onAppend = onAppend;
  }

  setAttribute()
  {
  }

  appendChild(child)
  {
    if (child.parentElement)
    {
      const index = child.parentElement.children.indexOf(child);

      if (index >= 0)
      {
        child.parentElement.children.splice(index, 1);
      }
    }

    child.parentElement = this;
    child.removed = false;
    this.children.push(child);
    this.onAppend?.(child, this);
    return child;
  }

  remove()
  {
    if (this.parentElement)
    {
      const index = this.parentElement.children.indexOf(this);

      if (index >= 0)
      {
        this.parentElement.children.splice(index, 1);
      }
    }

    this.parentElement = null;
    this.removed = true;
  }
}

class CanvasMock extends ElementMock
{
  constructor(onAppend = null)
  {
    super('canvas', onAppend);
    this.width = 0;
    this.height = 0;
    this.context = new ContextMock(this);
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
}

function installDom()
{
  const windowMock = new EventTargetMock();
  const frames = new Map();
  const createdCanvases = [];
  const createdElements = [];
  const appendedCanvases = [];
  const canvasMounts = [];
  let nextFrameId = 1;
  let appendedCanvas = null;
  let currentTime = nativePerformance.now();

  const recordAppend = (element, parent) =>
  {
    if (element.tagName === 'CANVAS')
    {
      appendedCanvas = element;
      appendedCanvases.push(element);
      canvasMounts.push({ canvas: element, parent });
    }
  };
  const body = new ElementMock('body', recordAppend);
  windowMock.innerWidth = 1920;
  windowMock.innerHeight = 1080;
  windowMock.devicePixelRatio = 1;

  globalThis.window = windowMock;
  // 浏览器的 RAF timestamp 与 performance.now() 共用同一时间源；测试也必须如此，
  // 否则人为推进 RAF 会让事件出生时间落到“未来”或“过去”。
  globalThis.performance =
  {
    timeOrigin: nativePerformance.timeOrigin,
    now()
    {
      return currentTime;
    },
  };
  globalThis.document =
  {
    body,
    createElement(tagName)
    {
      if (tagName === 'canvas')
      {
        const canvas = new CanvasMock(recordAppend);

        createdCanvases.push(canvas);
        createdElements.push(canvas);
        return canvas;
      }

      if (tagName === 'div')
      {
        const element = new ElementMock(tagName, recordAppend);

        createdElements.push(element);
        return element;
      }

      throw new Error(`不支持的测试元素：${tagName}`);
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

  if (typeof globalThis.CustomEvent !== 'function')
  {
    globalThis.CustomEvent = class CustomEventMock
    {
      constructor(type, init = {})
      {
        this.type = type;
        this.detail = init.detail ?? null;
      }
    };
  }

  return {
    windowMock,
    frames,
    body,
    createdCanvases,
    createdElements,
    appendedCanvases,
    canvasMounts,
    setCurrentTime(time)
    {
      currentTime = time;
    },
    get appendedCanvas()
    {
      return appendedCanvas;
    },
  };
}

function flushFrames(dom, startTime, count, frameMs = 1000 / 60)
{
  let now = startTime;

  dom.setCurrentTime(now);

  for (let index = 0; index < count && dom.frames.size > 0; index++)
  {
    now += frameMs;
    dom.setCurrentTime(now);
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
  Math.abs(UNITY_FX_TOUCH.shards.clickSpeedMin - 49.8769488) < 0.000001 &&
    Math.abs(UNITY_FX_TOUCH.shards.clickSpeedMax - 66.5025984) < 0.000001,
  '点击碎片速度包含 ParticleSystem 的 0.3078824 Local 缩放',
);
assert(
  Math.abs(UNITY_FX_TOUCH.shards.trailSpeedMin - 33.2512992) < 0.000001 &&
    Math.abs(UNITY_FX_TOUCH.shards.trailSpeedMax - 49.8769488) < 0.000001,
  '拖拽碎片速度包含 ParticleSystem 的 0.3078824 Local 缩放',
);
assert(
  UNITY_FX_TOUCH.shards.hdrIntensity === 5.992157 &&
    UNITY_FX_TOUCH.shards.startColor.every(
      (channel) => channel === 0.5377358,
    ),
  '碎片同时保留材质 HDR 与 ParticleSystem 起始色',
);
assert(
  JSON.stringify(UNITY_FX_TOUCH.shards.sizeKeys) === JSON.stringify(
    [
      [0, 0, 0, 0],
      [0.15445095, 1, 0, 0],
      [1, 0, -2.1621501, -2.1621501],
    ],
  ) &&
    UNITY_FX_TOUCH.shards.textureFrames.length === 2 &&
    UNITY_FX_TOUCH.shards.textureFrames[0][1][0] === 0.48046875,
  '碎片使用 Unity Hermite 尺寸曲线与 2×1 图集的实测轮廓',
);
assert(UNITY_FX_TOUCH.shards.trailSpacing === 108, '拖拽每 108px 生成一枚碎片');
assert(UNITY_FX_TOUCH.trail.lifetimeMs === 300, 'TrailRenderer.time 为 0.3 秒');
assert(UNITY_FX_TOUCH.trail.geometryWidth === 2.7, '1080p TrailRenderer 几何带宽为 2.7px');
assert(UNITY_FX_TOUCH.trail.width === 2.7, '清晰拖尾本体使用 Unity 的 2.7px 带宽');
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
const transverseProfileKeys =
  UNITY_FX_TOUCH.trail.textureTransverseProfileKeys;
const middleTransverseProfile = transverseProfileKeys.find(
  ([position]) => Math.abs(position - 0.624266) < 0.000001,
);
const transverseStopCount = transverseProfileKeys[2][1].length * 2 - 1;
const canvasTrailBandCount = transverseStopCount - 1;

assert(
  transverseProfileKeys.length === 14 &&
    transverseProfileKeys[0][1].every((value) => value === 0) &&
    middleTransverseProfile[1][6] === 0.1006 &&
    transverseProfileKeys.at(-1)[1][6] === 0.9867,
  '拖尾使用随 Stretch 进度变化的 FX_TEX_Trail_03 二维横截面',
);
assert(
  UNITY_FX_TOUCH.bloom.threshold === 1 &&
    UNITY_FX_TOUCH.bloom.softKnee === 0 &&
    UNITY_FX_TOUCH.bloom.intensity === 1.7 &&
    UNITY_FX_TOUCH.bloom.diffusion === 7 &&
    UNITY_FX_TOUCH.bloom.trailCoverageScale === 1 &&
    !('scatter' in UNITY_FX_TOUCH.bloom) &&
    !('iterations' in UNITY_FX_TOUCH.bloom),
  'Bloom 使用游戏 MXFinalBloom 的原始参数',
);
assert(
  UNITY_FX_TOUCH.bloom.trailEmissionAlpha === 1 &&
    UNITY_FX_TOUCH.bloom.clickEmissionScale === 1 &&
    UNITY_FX_TOUCH.bloom.ringEmissionAlpha === 1 &&
    UNITY_FX_TOUCH.bloom.diskEmissionAlpha === 1 &&
    UNITY_FX_TOUCH.bloom.trailAlpha === 0.18,
  '点击与拖尾发射倍率相互独立，原生阴影回退单独标定',
);
assert(
  CONFIG.lightBackgroundContrastAlpha === 0,
  '严格默认不加入游戏管线之外的浅色背景对比层',
);
assert(CONFIG.bloomBackend === 'webgl2', '默认使用 WebGL2 Bloom 后端');
assert(CONFIG.effectBackend === 'canvas2d', '实验性完整 WebGL2 默认关闭');
assert(CONFIG.isolatedCompositing === false, '默认直接与页面加色，保持游戏合成顺序');
assert(CONFIG.inputSource === 'dom', '默认由 DOM 指针事件驱动输入');
assert(
  CONFIG.clickTimeScale === 1 && CONFIG.trailTimeScale === 1,
  '点击与拖尾的默认时间倍率均为 1',
);
assert(
  BLOOM_BACKEND_CHANGE_EVENT === 'baclickfxbackendchange',
  '导出 Bloom 后端解析状态事件名，调用方无需硬编码字符串',
);
assert(
  EFFECT_BACKEND_CHANGE_EVENT === 'baclickfxeffectbackendchange',
  '导出完整特效后端解析状态事件名，调用方无需硬编码字符串',
);

console.log('\n配置隔离');
const leftConfig = createConfig();
const rightConfig = createConfig();

leftConfig.scale = 2;
assert(rightConfig.scale === CONFIG.scale, '实例配置互不污染');
const nativeAliasConfig = createConfig({ softwareBloomEnabled: false });
const explicitBackendConfig = createConfig(
  {
    bloomBackend: 'webgl2',
    softwareBloomEnabled: false,
  },
);
const invalidBackendConfig = createConfig({ bloomBackend: 'webgpu' });
const fullWebGLConfig = createConfig({ effectBackend: 'webgl2' });
const invalidEffectBackendConfig = createConfig({ effectBackend: 'webgpu' });
const directCompositingConfig = createConfig({ isolatedCompositing: false });
const invalidCompositingConfig = createConfig({ isolatedCompositing: 'yes' });
const manualInputConfig = createConfig(
  {
    inputSource: 'manual',
    clickTimeScale: 2,
    trailTimeScale: 0.5,
  },
);
const invalidHostControlConfig = createConfig(
  {
    inputSource: 'electron',
    clickTimeScale: 0,
    trailTimeScale: Infinity,
  },
);

assert(
  nativeAliasConfig.bloomBackend === 'native' &&
    nativeAliasConfig.softwareBloomEnabled === false,
  'createConfig 同步旧布尔别名与新 Bloom 后端',
);
assert(
  explicitBackendConfig.bloomBackend === 'webgl2' &&
    explicitBackendConfig.softwareBloomEnabled === true,
  'createConfig 中显式 Bloom 后端优先于旧布尔别名',
);
assert(
  invalidBackendConfig.bloomBackend === CONFIG.bloomBackend,
  'createConfig 忽略无效 Bloom 后端并恢复默认值',
);
assert(
  fullWebGLConfig.effectBackend === 'webgl2' &&
    invalidEffectBackendConfig.effectBackend === CONFIG.effectBackend,
  'createConfig 仅接受公开的完整特效后端值',
);
assert(
  directCompositingConfig.isolatedCompositing === false &&
    invalidCompositingConfig.isolatedCompositing === CONFIG.isolatedCompositing,
  'createConfig 只接受布尔隔离合成配置',
);
assert(
  manualInputConfig.inputSource === 'manual' &&
    manualInputConfig.clickTimeScale === 2 &&
    manualInputConfig.trailTimeScale === 0.5,
  'createConfig 保留有效的宿主输入模式与独立时间倍率',
);
assert(
  invalidHostControlConfig.inputSource === CONFIG.inputSource &&
    invalidHostControlConfig.clickTimeScale === CONFIG.clickTimeScale &&
    invalidHostControlConfig.trailTimeScale === CONFIG.trailTimeScale,
  'createConfig 忽略无效输入模式与非正有限时间倍率',
);

console.log('\n指针生命周期');
const dom = installDom();
const effect = new BAClickFX(
  {
    // 该实例同时覆盖网页白底兼容层的显式启用和运行时切换。
    isolatedCompositing: true,
    lightBackgroundContrastAlpha: 0.35,
  },
);
assert(
  effect.getConfig().bloomBackend === 'webgl2' &&
    effect.getConfig().resolvedBloomBackend === 'pending',
  '默认实例在延迟能力探测前请求 WebGL2 Bloom 并公开 pending',
);
effect.updateConfig({ bloomBackend: 'software' });
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
  dom.body.children.length === 1 &&
    dom.body.children[0] === effect.overlayRoot &&
    effect.overlayRoot.children.length === 2 &&
    effect.overlayRoot.children[0] === effect.canvas &&
    effect.overlayRoot.children[1] === effect.contrastCanvas,
  '显式兼容模式把主加色层与对比层挂入独立合成根',
);
assert(
  effect.overlayRoot.style.isolation === 'isolate' &&
    effect.overlayRoot.style.position === 'fixed' &&
    effect.canvas.style.position === 'absolute',
  '全屏合成根显式隔离内部混合且不改变页面布局',
);
assert(effect.width === 1920 && effect.height === 1080, '按 CSS 尺寸建立 1080p 坐标系');
assert(
  !('referenceWidth' in UNITY_FX_TOUCH) &&
    !('maximumScaleHeight' in UNITY_FX_TOUCH),
  '诊断截图尺寸不作为游戏运行时的视口上限',
);
const referenceViewportWidth = effect.width;
const referenceViewportHeight = effect.height;

effect.width = 3840;
effect.height = 2160;
const expected4KScale = effect.height /
  UNITY_FX_TOUCH.referenceHeight *
  SIZE_CORRECTION;

assert(
  Math.abs(effect._getScale() - expected4KScale) < 0.000001 &&
    UNITY_FX_TOUCH.bloom.diffusion === 7 &&
    !('highResolutionDiffusionCompensation' in UNITY_FX_TOUCH.bloom),
  '高分辨率按实际画布高度缩放，并直接使用游戏 Bloom Diffusion',
);
effect.width = referenceViewportWidth;
effect.height = referenceViewportHeight;
assert(
  effect.canvas.style.mixBlendMode === 'plus-lighter',
  '自有叠加 Canvas 使用元素级加色混合，不会在浅色 DOM 背景上压黑',
);
assert(
  effect.contrastCanvas.style.mixBlendMode === 'darken' &&
    Number(effect.contrastCanvas.style.zIndex) > Number(effect.canvas.style.zIndex),
  '微弱对比 Canvas 使用 darken 并位于主加色层上方',
);
effect.setFxParam('rings.rotationDirection', -1);
effect.setFxParam('rings.dissolveDirection', -1);
assert(
  effect.getFxConfig().rings.rotationDirection === -1 &&
    effect.getFxConfig().rings.dissolveDirection === -1,
  '方向参数允许负值，不会被通用非负校验错误钳制',
);
effect.setFxParam('rings.dissolveDirection', 1);
const zeroValueFxParams =
[
  ['bloom.ringBlur', effect.fxConfig.bloom.ringBlur],
  ['bloom.diskBlur', effect.fxConfig.bloom.diskBlur],
  ['shards.clickCount', effect.fxConfig.shards.clickCount],
  ['shards.maxCount', effect.fxConfig.shards.maxCount],
];

for (const [path] of zeroValueFxParams)
{
  effect.setFxParam(path, 0);
}

assert(
  effect.fxConfig.bloom.ringBlur === 0 &&
    effect.fxConfig.bloom.diskBlur === 0 &&
    effect.fxConfig.shards.clickCount === 0 &&
    effect.fxConfig.shards.maxCount === 0,
  'Blur、Count 与 maxCount 参数允许显式设为零',
);

for (const [path, value] of zeroValueFxParams)
{
  effect.setFxParam(path, value);
}

const initialCanvasCount = dom.createdCanvases.length;

effect.updateConfig({ isolatedCompositing: false });
assert(
  effect.getConfig().isolatedCompositing === false &&
    effect.overlayRoot.removed &&
    effect.canvas.parentElement === dom.body &&
    effect.contrastCanvas.parentElement === dom.body &&
    effect.canvas.style.position === 'fixed',
  '运行时可切回直接页面加色并恢复全屏 Canvas 定位',
);
effect.updateConfig({ isolatedCompositing: true });
assert(
  effect.getConfig().isolatedCompositing === true &&
    effect.overlayRoot.parentElement === dom.body &&
    effect.canvas.parentElement === effect.overlayRoot &&
    effect.contrastCanvas.parentElement === effect.overlayRoot &&
    dom.createdCanvases.length === initialCanvasCount,
  '恢复隔离合成时重挂载现有 Canvas，不重建渲染资源',
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
    shard.rotation === 0 && (shard.textureFrame === 0 || shard.textureFrame === 1)),
  '碎片不做伪旋转，而是随机选择 Unity 2×1 图集帧',
);
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
    clientX: 520,
    clientY: 300,
  });
assert(effect.trailStrokes[0].points.length > 2, '拖拽按 5.4px 最小顶点距离采样');
assert(effect.shards.some((shard) => shard.kind === 'trail'), '拖过 108px 后生成距离粒子');
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
effect.context.linearGradients = [];
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
effect.bloomRenderer.sourceContext.linearGradients = [];
effect.bloomRenderer.sourceContext.getImageDataCalls = [];
const bloomSourceFillStart = effect.bloomRenderer.sourceContext.fillCount;
const savedTrailTextureKeys = effect.fxConfig.trail.textureLongitudinalKeys;
let trailEnergyBuildCount = 0;

// 整帧只读取一次纹理关键帧。统计属性读取可证明纵向能量、二维横截面、
// 区域计算和发射 pass 均共享缓存，而不是仅检查缓存数组恰好存在。
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
// 圆环最初约 16ms 仍可能被溶解阈值完整裁剪；固定到 50ms 后验证发射路径。
now = flushFrames(dom, now, 1, 50);
Object.defineProperty(effect.fxConfig.trail, 'textureLongitudinalKeys',
  {
    configurable: true,
    enumerable: true,
    value: savedTrailTextureKeys,
    writable: true,
  });
assert(effect.context.linearGradients.length > 0, '运行帧实际绘制连续轨迹');
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
    lastBloomBeginFrameArgs[4] === UNITY_FX_TOUCH.bloom.diffusion &&
    lastBloomBeginFrameArgs[5] === effect.dpr &&
    lastBloomBeginFrameArgs[6]?.width > 0,
  '软件 Bloom 同时传入 MXFinalBloom 参数、物理像素倍率与发射范围',
);
assert(
  lastBloomCompositeSettings?.diffusion === UNITY_FX_TOUCH.bloom.diffusion &&
    !('iterations' in lastBloomCompositeSettings),
  '软件 Bloom 合成使用 MXFinalBloom diffusion 且不再传旧迭代数',
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
  effect.bloomRenderer.sourceCanvas.width === effect.canvas.width &&
    effect.bloomRenderer.sourceCanvas.height === effect.canvas.height,
  '软件 Bloom 金字塔工作区完整覆盖主画面，避免最低 mip 形成局部矩形',
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
  effect.bloomRenderer.sourceContext.fillCount - bloomSourceFillStart >=
    1 + UNITY_FX_TOUCH.rings.count * UNITY_FX_TOUCH.rings.radialSamples +
      UNITY_FX_TOUCH.shards.clickCount,
  '三角形碎片与光盘、圆环一同写入 Bloom 发射缓冲',
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
const clickEmissionProbeAge = probeWave.ageMs;

function sampleClickEmission(scale)
{
  effect.setFxParam('bloom.clickEmissionScale', scale);
  probeWave.ageMs = 100;
  effect.bloomRenderer.sourceContext.conicGradients = [];
  effect.bloomRenderer.sourceContext.radialGradients = [];
  probeWave.drawBloom(effect.bloomRenderer.sourceContext, 1, 1);

  const ringPeak = effect.bloomRenderer.sourceContext.conicGradients
    .flatMap((entry) => entry.gradient.stops)
    .reduce(
      (maximum, [, color]) => Math.max(maximum, getCssColorEnergy(color)),
      0,
    );
  const diskPeak = effect.bloomRenderer.sourceContext.radialGradients
    .flatMap((entry) => entry.gradient.stops)
    .reduce(
      (maximum, [, color]) => Math.max(maximum, getCssColorEnergy(color)),
      0,
    );
  const webglCalls = { disks: [], rings: [] };

  probeWave.appendWebGLBloom(
    {
      addAlphaBlendDisk(...args)
      {
        webglCalls.disks.push(args);
      },
      addDissolveRing(...args)
      {
        webglCalls.rings.push(args);
      },
    },
    1,
    1,
  );

  return { ringPeak, diskPeak, webglCalls };
}

const baseClickEmission = sampleClickEmission(1);
probeWave.ageMs = 190;
const lateDiskCalls = [];

probeWave.appendWebGLBloom(
  {
    addAlphaBlendDisk(...args)
    {
      lateDiskCalls.push(args);
    },
    addDissolveRing()
    {
    },
  },
  1,
  1,
);
assert(
  lateDiskCalls[0][4] === baseClickEmission.webglCalls.disks[0][4] &&
    lateDiskCalls[0][5] <
      baseClickEmission.webglCalls.disks[0][5],
  'WebGL2 光盘源 RGB 不随 Particle Alpha 衰减，并独立提交真实 Alpha',
);
const lateNativeDiskContext = new ContextMock(effect.canvas);
const lateSoftwareDiskContext = new ContextMock(effect.canvas);
const opaqueNativeDiskContext = new ContextMock(effect.canvas);
const opaqueSoftwareDiskContext = new ContextMock(effect.canvas);
const savedDiskAlphaKeys = probeWave.fx.disk.alphaKeys;

probeWave.drawDiskLayer(lateNativeDiskContext, 1, 1, true);
probeWave.drawBloomDiskLayer(lateSoftwareDiskContext, 1, 1);
probeWave.fx.disk.alphaKeys = [[0, 1], [1, 1]];
probeWave.drawDiskLayer(opaqueNativeDiskContext, 1, 1, true);
probeWave.drawBloomDiskLayer(opaqueSoftwareDiskContext, 1, 1);
probeWave.fx.disk.alphaKeys = savedDiskAlphaKeys;

assert(
  lateNativeDiskContext.fillCompositeOperations.join(',') ===
      'destination-out,lighter' &&
    lateSoftwareDiskContext.fillCompositeOperations.join(',') ===
      'destination-out,lighter',
  '主 Canvas 与 Software Bloom 光盘都先衰减目标，再以 lighter 加源 RGB',
);
assert(
  getCssAlpha(
    lateNativeDiskContext.radialGradients[1].gradient.stops[0][1],
  ) <
      getCssAlpha(
        opaqueNativeDiskContext.radialGradients[1].gradient.stops[0][1],
      ) &&
    JSON.stringify(
      lateNativeDiskContext.radialGradients[0].gradient.stops,
    ) === JSON.stringify(
      opaqueNativeDiskContext.radialGradients[0].gradient.stops,
    ) &&
    JSON.stringify(
      lateSoftwareDiskContext.radialGradients[0].gradient.stops,
    ) === JSON.stringify(
      opaqueSoftwareDiskContext.radialGradients[0].gradient.stops,
    ) &&
    lateNativeDiskContext.fillShadowBlurs[1] > 0 &&
    lateNativeDiskContext.fillShadowColors[1] ===
      opaqueNativeDiskContext.fillShadowColors[1],
  '190ms 光盘仅由 Particle Alpha 衰减目标，源 RGB 与 Native shadow 保持不变',
);
assert(
  effect.bloomRenderer.sourceContext.radialGradients.at(-1)
    .gradient.stops.length ===
      UNITY_FX_TOUCH.disk.textureRadialEnergyKeys.length,
  '光盘发射完整使用 FX_TEX_Circle_01 的径向能量曲线',
);
const boostedClickEmission = sampleClickEmission(2);

assert(
  boostedClickEmission.ringPeak >= baseClickEmission.ringPeak * 1.8 &&
    boostedClickEmission.diskPeak >= baseClickEmission.diskPeak * 1.8,
  '点击发射倍率在线性能量上同步增强软件 Bloom 的圆环与光盘',
);
assert(
  boostedClickEmission.webglCalls.disks[0][4] ===
      baseClickEmission.webglCalls.disks[0][4] * 2 &&
    boostedClickEmission.webglCalls.rings.every((call, index) =>
      call[8] === baseClickEmission.webglCalls.rings[index][8] * 2),
  'WebGL2 Bloom 的圆环与光盘使用同一点击发射倍率',
);
effect.setFxParam('bloom.clickEmissionScale', Number.NaN);
assert(
  effect.getFxConfig().bloom.clickEmissionScale === 2,
  '点击发射 API 忽略非有限数值',
);
effect.setFxParam('bloom.clickEmissionScale', 1);
probeWave.ageMs = clickEmissionProbeAge;
const contrastTint = effect.contrastContext.fillRects.at(-1);

assert(
  contrastTint?.compositeOperation === 'source-in' &&
    getCssAlpha(contrastTint.fillStyle) ===
      effect.getConfig().lightBackgroundContrastAlpha,
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
  effect.context.fillShadowBlurs.every((blur) => !blur) &&
    effect.bloomRenderer.sourceContext.fillShadowBlurs.every((blur) => !blur),
  '软件 Bloom 开启时可见与发射拖尾都不叠加 shadowBlur',
);
const trailSegmentCount = effect.trailStrokes[0].points.length - 1;
const cachedTrailFrameData = effect.trailStrokes[0].trailFrameData;
const visibleTrailGradients = effect.context.linearGradients.filter(
  ({ gradient }) => gradient.stops.length === 2,
);
const visibleTrailQuads = effect.context.filledPaths.filter((path) =>
  path.length === 4);
const visibleTrailGradientGroups = Array.from(
  { length: trailSegmentCount },
  (_, index) => visibleTrailGradients.slice(
    index * canvasTrailBandCount,
    (index + 1) * canvasTrailBandCount,
  ),
);
const bloomTrailGradients = effect.bloomRenderer.sourceContext
  .linearGradients.filter(({ gradient }) => gradient.stops.length === 2);
const firstVisibleBand = visibleTrailQuads[0];
const lastFirstSegmentBand =
  visibleTrailQuads[canvasTrailBandCount - 1];
const measuredVisibleTrailWidth = Math.hypot(
  lastFirstSegmentBand[3][0] - firstVisibleBand[0][0],
  lastFirstSegmentBand[3][1] - firstVisibleBand[0][1],
);

assert(
  visibleTrailQuads.length === trailSegmentCount * canvasTrailBandCount &&
    Math.abs(
      measuredVisibleTrailWidth -
        UNITY_FX_TOUCH.trail.width * SIZE_CORRECTION,
    ) < 0.01,
  '可见拖尾横截面保持 Unity 的 2.7px 几何带宽',
);
assert(
  visibleTrailGradientGroups[0].every(({ gradient }) =>
    gradient.stops[0][1] === 'rgba(0, 0, 0, 0)') &&
    visibleTrailGradientGroups.some((group) =>
      group.some(({ gradient }) =>
        gradient.stops[0][1] !== gradient.stops[1][1])),
  '拖尾尾端严格透明，并沿每段纵向连续插值而不是复用段中点',
);
let visibleTrailEndpointsContinuous = true;

for (let index = 1; index < visibleTrailGradientGroups.length; index++)
{
  for (let band = 0; band < canvasTrailBandCount; band++)
  {
    visibleTrailEndpointsContinuous &&=
      visibleTrailGradientGroups[index - 1][band].gradient.stops[1][1] ===
        visibleTrailGradientGroups[index][band].gradient.stops[0][1];
  }
}

assert(
  visibleTrailEndpointsContinuous,
  '相邻 Canvas 拖尾段在同一横截面窄带共享折点颜色',
);
const hasVisibleTransverseVariation = visibleTrailGradientGroups.some(
  (group) =>
  {
    for (let endpoint = 0; endpoint <= 1; endpoint++)
    {
      const colors = group.map(
        ({ gradient }) => gradient.stops[endpoint][1],
      );

      if (new Set(colors).size > 1)
      {
        return true;
      }
    }

    return false;
  },
);
assert(
  visibleTrailGradients.length ===
      trailSegmentCount * canvasTrailBandCount &&
    hasVisibleTransverseVariation,
  'Canvas 拖尾用 16 条窄带保留二维纹理的横截面能量差异',
);
assert(
  cachedTrailFrameData?.pointEnergies.length === trailSegmentCount + 1 &&
    cachedTrailFrameData.pointTransverseProfiles.length ===
      trailSegmentCount + 1 &&
    cachedTrailFrameData.segmentEnergies.length === trailSegmentCount &&
    cachedTrailFrameData.segmentMaximumEnergies.length === trailSegmentCount &&
    cachedTrailFrameData.segmentTransverseProfiles.length === trailSegmentCount &&
    cachedTrailFrameData.segmentMaximumEnergies.every((maximum, index) =>
      maximum >= Math.max(
        ...cachedTrailFrameData.pointEnergies[index],
        ...cachedTrailFrameData.segmentEnergies[index],
        ...cachedTrailFrameData.pointEnergies[index + 1],
      )) &&
    trailEnergyBuildCount === 1,
  '同一帧缓存弧长端点与中点采样，分段峰值覆盖三者',
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
  bloomTrailGradients.length ===
      expectedBloomSegmentCount * canvasTrailBandCount &&
    expectedBloomSegmentCount < trailSegmentCount,
  'Bloom 发射绘制逐窄带渲染，并只跳过量化后严格为零的暗尾分段',
);
const firstBloomPeak = bloomTrailGradients
  .slice(0, canvasTrailBandCount)
  .reduce(
    (maximum, { gradient }) => Math.max(
      maximum,
      ...gradient.stops.map(([, color]) => getCssColorEnergy(color)),
    ),
    0,
  );
const lastBloomPeak = bloomTrailGradients
  .slice(-canvasTrailBandCount)
  .reduce(
    (maximum, { gradient }) => Math.max(
      maximum,
      ...gradient.stops.map(([, color]) => getCssColorEnergy(color)),
    ),
    0,
  );

assert(
  lastBloomPeak > firstBloomPeak + 20,
  'Bloom 发射源沿纵向插值后仍只在拖尾头部保持高亮',
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
const shardProbe = effect.shards[0];
const savedShardProbe =
{
  ageMs: shardProbe.ageMs,
  size: shardProbe.size,
  textureFrame: shardProbe.textureFrame,
};
const shardProbeContext = new ContextMock(effect.canvas);

shardProbe.ageMs = shardProbe.lifetimeMs * 0.15445095;
shardProbe.size = 20;
shardProbe.textureFrame = 1;
shardProbe.drawBloom(shardProbeContext, 1, 1, effect.fxConfig);

const shardBloomEnergy = getCssColorEnergy(shardProbeContext.filledStyles[0]);
const expectedShardPath = UNITY_FX_TOUCH.shards.textureFrames[1].map(
  ([x, y]) => [x * 20, y * 20],
);

assert(
  shardBloomEnergy >= 15 && shardBloomEnergy <= 17,
  '碎片 Bloom 在线性空间乘入 0.5377358 起始色，峰值不再按白色粒子放大',
);
assert(
  JSON.stringify(shardProbeContext.filledPaths[0]) ===
    JSON.stringify(expectedShardPath),
  'Canvas 碎片按 Unity 图集等能量轮廓与 Hermite 峰值尺寸绘制',
);

const shardWebGLCalls = [];

shardProbe.appendWebGLBloom(
  {
    addTriangle(...args)
    {
      shardWebGLCalls.push(args);
    },
  },
  1,
  1,
  effect.fxConfig,
);

assert(
  Math.max(...shardWebGLCalls[0][4]) > 1.49 &&
    Math.max(...shardWebGLCalls[0][4]) < 1.51 &&
    JSON.stringify(shardWebGLCalls[0][6]) ===
      JSON.stringify(UNITY_FX_TOUCH.shards.textureFrames[1]),
  'WebGL2 碎片与 Canvas 使用相同的起始色能量和图集轮廓',
);

Object.assign(shardProbe, savedShardProbe);

const nativeShadowStart = effect.context.fillShadowBlurs.length;
const nativeStrokeStart = effect.context.strokeShadowBlurs.length;
const nativeFilterStart = effect.context.strokeFilters.length;
const nativeLinearGradientStart = effect.context.linearGradients.length;
const nativeDrawImageStart = effect.context.drawImageCalls.length;
const nativeContrastCopyStart = effect.contrastContext.drawImageCalls.length;
const nativePathStart = effect.context.filledPaths.length;

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
const nativeShardProbeContext = new ContextMock(effect.canvas);
const nativeShardAboveThresholdContext = new ContextMock(effect.canvas);
const nativeShardProbeState =
{
  ageMs: shardProbe.ageMs,
  size: shardProbe.size,
};
const nativeShardThreshold = effect.fxConfig.bloom.threshold;

shardProbe.ageMs = shardProbe.lifetimeMs * 0.15445095;
shardProbe.size = 20;
shardProbe.draw(
  nativeShardProbeContext,
  1,
  1,
  effect.fxConfig,
  true,
);
effect.fxConfig.bloom.threshold = 1.2;
shardProbe.draw(
  nativeShardAboveThresholdContext,
  1,
  1,
  effect.fxConfig,
  true,
);
effect.fxConfig.bloom.threshold = nativeShardThreshold;
Object.assign(shardProbe, nativeShardProbeState);

assert(
  nativeShardProbeContext.fillShadowBlurs[0] > 0 &&
    getCssAlpha(nativeShardProbeContext.fillShadowColors[0]) > 0,
  '原生辉光按 Threshold 以上的碎片 HDR 能量生成低强度光晕',
);
assert(
  nativeShardAboveThresholdContext.fillShadowBlurs[0] === 0 &&
    nativeShardAboveThresholdContext.fillShadowColors[0] === 'transparent',
  '大于 1 的 Bloom Threshold 先从 Gamma 转为 Linear，再剔除低能量碎片辉光',
);
const thresholdFormulaFx = structuredClone(effect.fxConfig);

thresholdFormulaFx.shards.colorKeys =
[
  [0, [255, 255, 255]],
  [1, [255, 255, 255]],
];
thresholdFormulaFx.shards.startColor = [255, 255, 255];
thresholdFormulaFx.shards.alphaKeys = [[0, 1], [1, 1]];
thresholdFormulaFx.shards.hdrIntensity = 0.75;
thresholdFormulaFx.bloom.threshold = 1;
thresholdFormulaFx.bloom.softKnee = 0.5;
thresholdFormulaFx.bloom.shardAlpha = 1;
thresholdFormulaFx.bloom.intensity = UNITY_FX_TOUCH.bloom.intensity;
const thresholdFormulaContext = new ContextMock(effect.canvas);

shardProbe.ageMs = shardProbe.lifetimeMs * 0.5;
shardProbe.size = 20;
shardProbe.draw(
  thresholdFormulaContext,
  1,
  1,
  thresholdFormulaFx,
  true,
);
const expectedKnee = 1 * 0.5 + 0.00001;
const expectedSoft = 0.75 - 1 + expectedKnee;
const expectedSoftContribution =
  expectedSoft * expectedSoft / (expectedKnee * 4) / 0.75;

assert(
  Math.abs(
    getCssAlpha(thresholdFormulaContext.fillShadowColors[0]) -
      expectedSoftContribution,
  ) < 0.000000001,
  'Native Bloom Soft Knee 在乘积后固定加 1e-5，与 MXFinalBloom 一致',
);

thresholdFormulaFx.shards.hdrIntensity = 70000;
thresholdFormulaFx.bloom.softKnee = 0;
delete thresholdFormulaFx.bloom.clamp;
const defaultClampContext = new ContextMock(effect.canvas);

shardProbe.draw(defaultClampContext, 1, 1, thresholdFormulaFx, true);
thresholdFormulaFx.bloom.clamp = 70000;
const halfFloatClampContext = new ContextMock(effect.canvas);

shardProbe.draw(halfFloatClampContext, 1, 1, thresholdFormulaFx, true);
assert(
  Math.abs(
    getCssAlpha(defaultClampContext.fillShadowColors[0]) -
      (65472 - 1) / 65472,
  ) < 0.000000001 &&
    Math.abs(
      getCssAlpha(halfFloatClampContext.fillShadowColors[0]) -
        (65504 - 1) / 65504,
    ) < 0.000000001,
  'Native Bloom Clamp 缺省为 65472，并安全限制到 HALF_FLOAT 65504',
);
Object.assign(shardProbe, nativeShardProbeState);
assert(
  effect.context.strokeShadowBlurs
    .slice(nativeStrokeStart)
    .every((blur) => !blur),
  '原生回退不在拖尾分段接缝叠加 shadowBlur',
);
const nativeBloomSurface = effect.nativeTrailBloomSurface;
const nativeGlowGradients = nativeBloomSurface.context.linearGradients;
const nativeTrailSegmentCount = effect.trailStrokes[0].points.length - 1;
const nativeTrailJoinCount = effect.trailStrokes[0].points.length - 2;
const nativeSegmentGradients = nativeGlowGradients.filter(
  ({ gradient }) => gradient.stops.length === 2,
);
const nativeCrossSectionGradients = nativeGlowGradients.filter(
  ({ gradient }) => gradient.stops.length === transverseStopCount,
);
const nativeSegmentGradientGroups = Array.from(
  { length: nativeTrailSegmentCount },
  (_, index) => nativeSegmentGradients.slice(
    index * canvasTrailBandCount,
    (index + 1) * canvasTrailBandCount,
  ),
);
const nativeBlurDraws = effect.context.drawImageCalls
  .slice(nativeDrawImageStart)
  .filter((call) => call.filter !== 'none');
const nativeTrailPaths = nativeBloomSurface.context.filledPaths;
const clearTrailPaths = effect.context.filledPaths
  .slice(nativePathStart)
  .filter((path) => path.length === 3 || path.length === 4)
  .slice(0, nativeTrailPaths.length);

assert(
  effect.context.strokeFilters
    .slice(nativeFilterStart)
    .every((filter) => filter === 'none') &&
    nativeBlurDraws.length === 1 &&
    nativeBlurDraws[0].args.length === 9,
  '原生回退在局部缓冲完成着色后只执行一次整体模糊',
);
assert(
  effect.context.linearGradients.length - nativeLinearGradientStart ===
      nativeTrailSegmentCount * canvasTrailBandCount +
        nativeTrailJoinCount + 2 &&
    nativeGlowGradients.length ===
      nativeTrailSegmentCount * canvasTrailBandCount +
        nativeTrailJoinCount + 2 &&
    nativeSegmentGradients.length ===
      nativeTrailSegmentCount * canvasTrailBandCount &&
    nativeCrossSectionGradients.length === nativeTrailJoinCount + 2,
  '原生回退按真实路径距离绘制纵向窄带，并为 join/cap 保留横截面纹理',
);
let nativeTrailEndpointsContinuous = true;

for (let index = 1; index < nativeSegmentGradientGroups.length; index++)
{
  for (let band = 0; band < canvasTrailBandCount; band++)
  {
    nativeTrailEndpointsContinuous &&=
      nativeSegmentGradientGroups[index - 1][band]
        .gradient.stops[1][1] ===
      nativeSegmentGradientGroups[index][band].gradient.stops[0][1];
  }
}

const nativeTailPeak = nativeSegmentGradientGroups[0].reduce(
  (maximum, { gradient }) => Math.max(
    maximum,
    getCssPremultipliedEnergy(gradient.stops[0][1]),
  ),
  0,
);
const nativeHeadPeak = nativeSegmentGradientGroups.at(-1).reduce(
  (maximum, { gradient }) => Math.max(
    maximum,
    getCssPremultipliedEnergy(gradient.stops[1][1]),
  ),
  0,
);

assert(
  nativeTrailEndpointsContinuous &&
    nativeTailPeak === 0 &&
    nativeHeadPeak > 20,
  '回环轨迹逐段共享折点能量，尾部无辉光且头部保留原生模糊能量',
);
assert(
  JSON.stringify(clearTrailPaths) === JSON.stringify(nativeTrailPaths),
  'Native 清晰层与局部辉光缓冲严格复用同一分带 TrailRenderer 网格',
);
const savedNativeTrailThreshold = effect.fxConfig.bloom.threshold;

nativeBloomSurface.context.linearGradients = [];
effect.setFxParam('bloom.threshold', 1000);
now = flushFrames(dom, now, 1);
assert(
  nativeBloomSurface.context.linearGradients.length > 0 &&
    nativeBloomSurface.context.linearGradients.every(({ gradient }) =>
      gradient.stops.every(([, color]) => getCssAlpha(color) === 0)),
  'Native 拖尾在发射能量上执行 Threshold 与 Soft Knee 后再生成模糊',
);
effect.setFxParam('bloom.threshold', savedNativeTrailThreshold);
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
  effect.destroyed &&
    effect.canvas.removed &&
    effect.contrastCanvas.removed &&
    dom.body.children.length === 0,
  'destroy() 移除监听、隔离合成根与自有 Canvas',
);

const ringlessEffect = new BAClickFX({ bloomBackend: 'native' });
let ringlessNow = performance.now();

ringlessEffect.setFxParam('rings.count', 0);
ringlessEffect.setFxParam('shards.clickCount', 0);
ringlessEffect.boom(400, 300);
ringlessNow = flushFrames(dom, ringlessNow, 1, 199);
assert(
  ringlessEffect.waves.length === 1 &&
    ringlessEffect.waves[0].rings.length === 0 &&
    dom.frames.size === 1,
  '零圆环点击在 199ms 时仍保留可见光盘与下一帧调度',
);
ringlessNow = flushFrames(dom, ringlessNow, 1, 2);
assert(
  ringlessEffect.waves.length === 0 &&
    ringlessEffect._hasVisibleEffects() === false &&
    dom.frames.size === 0,
  '零圆环点击在 200ms 光盘结束后立即释放 RAF',
);

ringlessEffect.setFxParam('rings.count', UNITY_FX_TOUCH.rings.count);
ringlessEffect.boom(400, 300);
ringlessNow = flushFrames(dom, ringlessNow, 1, 201);
assert(
  ringlessEffect.waves.length === 1 &&
    ringlessEffect.waves[0].rings.length === UNITY_FX_TOUCH.rings.count,
  '恢复圆环数量后 200ms 光盘结束不会提前回收仍可见圆环',
);
ringlessNow = flushFrames(dom, ringlessNow, 1, 400);
assert(
  ringlessEffect.waves.length === 0 && dom.frames.size === 0,
  '存在圆环时 ClickWave 保持完整 600ms 生命周期后停止 RAF',
);
ringlessEffect.destroy();

console.log('\n宿主手动输入');
const pointerEventTypes = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
];
const listenerCount = (type) => dom.windowMock.listeners.get(type)?.size ?? 0;
const pointerListenerBaseline = pointerEventTypes.map(listenerCount);
let manualFilterCallCount = 0;
const manualEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    inputSource: 'manual',
    inputFilter()
    {
      manualFilterCallCount++;
      return false;
    },
  },
);

flushFrames(dom, performance.now(), 1);
assert(
  manualEffect.getConfig().inputSource === 'manual' &&
    pointerEventTypes.every((type, index) =>
      listenerCount(type) === pointerListenerBaseline[index]),
  'manual 模式不注册 DOM 指针监听',
);

dom.windowMock.dispatch('pointerdown',
  {
    pointerType: 'mouse',
    button: 0,
    pointerId: 12,
    clientX: 300,
    clientY: 200,
  });
assert(
  manualEffect.activePointerId === null &&
    manualEffect.waves.length === 0 &&
    manualFilterCallCount === 0,
  'manual 模式忽略 DOM 指针事件',
);
assert(
  manualEffect.pointerDown({ x: NaN, y: 10 }) === false &&
    manualEffect.pointerMove({ x: 10, y: Infinity }) === false &&
    manualEffect.pointerUp(NaN) === false &&
    manualEffect.pointerCancel(Infinity) === false,
  '公开指针 API 以 false 拒绝无效坐标与指针编号',
);

const manualPointerAccepted = manualEffect.pointerDown(
  {
    x: -40,
    y: manualEffect.height + 40,
    pointerId: 23,
    pointerType: 'pen',
    // 宿主已把右键转换为逻辑主指针，库不应再过滤。
    button: 2,
  },
);
const manualStroke = manualEffect.currentTrailStroke;

assert(
  manualPointerAccepted &&
    manualEffect.activePointerId === 23 &&
    manualEffect.lastPointerPosition.x === 0 &&
    manualEffect.lastPointerPosition.y === manualEffect.height &&
    manualEffect.waves[0].x === 0 &&
    manualEffect.waves[0].y === manualEffect.height &&
    manualFilterCallCount === 0,
  '手动 pointerDown 使用 Canvas 局部 CSS 像素、钳制边界且绕过按键与 inputFilter',
);
assert(
  manualEffect.pointerDown(
    {
      x: 100,
      y: 100,
      pointerId: 24,
      pointerType: 'touch',
    },
  ) === false && manualEffect.waves.length === 1,
  '手动输入也保留单活动指针上限',
);
assert(
  manualEffect.pointerMove({ x: 10, y: 10, pointerId: 24 }) === false &&
    manualEffect.pointerMove(
      {
        x: manualEffect.width + 80,
        y: -80,
        pointerId: 23,
        pointerType: 'pen',
      },
    ) === true &&
    manualEffect.lastPointerPosition.x === manualEffect.width &&
    manualEffect.lastPointerPosition.y === 0 &&
    manualStroke.points.every((point) =>
      point.x >= 0 && point.x <= manualEffect.width &&
      point.y >= 0 && point.y <= manualEffect.height),
  'pointerMove 拒绝非活动指针并钳制所有拖尾采样点',
);
assert(
  manualEffect.pointerUp(24) === false &&
    manualEffect.pointerUp(23) === true &&
    manualEffect.activePointerId === null &&
    manualStroke.active === false,
  'pointerUp 仅正常结束匹配指针，已有拖尾保留自然消失',
);

manualEffect.clear();
manualEffect.boom(-20, manualEffect.height + 20);
assert(
  manualEffect.waves.length === 1 &&
    manualEffect.waves[0].x === 0 &&
    manualEffect.waves[0].y === manualEffect.height &&
    manualEffect.activePointerId === null &&
    manualEffect.currentTrailStroke === null,
  'boom() 仍只生成一次钳制坐标的点击，不创建指针状态',
);
manualEffect.clear();
assert(
  manualEffect.pointerDown({ x: 30, y: 40 }) === true &&
    manualEffect.activePointerId === 1 &&
    manualEffect.pointerCancel(2) === false &&
    manualEffect.pointerCancel() === true &&
    manualEffect.activePointerId === null &&
    manualEffect.lastPointerPosition === null &&
    manualEffect.currentTrailStroke === null &&
    manualEffect.trailStrokes.length === 0,
  'pointerId 默认为 1，pointerCancel 清理匹配指针及不可见单点轨迹',
);

manualEffect.clear();
manualEffect.pointerDown({ x: 100, y: 120, pointerId: 40 });
manualEffect.pointerMove({ x: 260, y: 120, pointerId: 40 });
const cancelledVisibleStroke = manualEffect.currentTrailStroke;
assert(
  cancelledVisibleStroke.points.length >= 2 &&
    manualEffect.pointerCancel(40) === true &&
    cancelledVisibleStroke.active === false &&
    !manualEffect.trailStrokes.includes(cancelledVisibleStroke),
  'pointerCancel 强制清理当前可见轨迹，区别于 pointerUp 的自然衰减',
);

manualEffect.clear();
manualEffect.pointerDown({ x: 100, y: 160, pointerId: 41 });
manualEffect.pointerMove({ x: 180, y: 160, pointerId: 41 });
manualEffect.clearTrail();
assert(
  manualEffect.activePointerId === 41 &&
    manualEffect.currentTrailStroke === null &&
    manualEffect.pointerMove({ x: 260, y: 160, pointerId: 41 }) === true &&
    manualEffect.currentTrailStroke.points.length >= 2,
  'clearTrail() 后活动按下指针会在下一次移动时重建轨迹',
);
manualEffect.clear();
assert(
  manualEffect.activePointerId === 41 &&
    manualEffect.pointerMove({ x: 340, y: 160, pointerId: 41 }) === true &&
    manualEffect.currentTrailStroke.points.length >= 2,
  'clear() 清屏后活动按下指针仍可继续生成新轨迹',
);
manualEffect.updateConfig({ trailEnabled: false });
manualEffect.updateConfig({ trailEnabled: true });
assert(
  manualEffect.pointerMove({ x: 420, y: 160, pointerId: 41 }) === true &&
    manualEffect.currentTrailStroke.points.length >= 2,
  '重新启用 trailEnabled 后仍按当前按下指针续接新轨迹',
);
manualEffect.pointerCancel(41);

manualEffect.clear();
manualEffect.updateConfig({ inputSource: 'dom' });
assert(
  manualEffect.getConfig().inputSource === 'dom' &&
    pointerEventTypes.every((type, index) =>
      listenerCount(type) === pointerListenerBaseline[index] + 1),
  '运行时切换为 dom 会仅注册一组指针监听',
);
dom.windowMock.dispatch('pointerdown',
  {
    pointerType: 'mouse',
    button: 2,
    pointerId: 31,
    clientX: 300,
    clientY: 200,
  });
dom.windowMock.dispatch('pointerdown',
  {
    pointerType: 'mouse',
    button: 0,
    pointerId: 31,
    clientX: 300,
    clientY: 200,
  });
assert(
  manualEffect.activePointerId === null &&
    manualEffect.waves.length === 0 &&
    manualFilterCallCount === 1,
  'DOM 输入仍拒绝右键并执行 inputFilter',
);
manualEffect.updateConfig({ inputSource: 'manual' });
assert(
  pointerEventTypes.every((type, index) =>
    listenerCount(type) === pointerListenerBaseline[index]),
  '运行时恢复 manual 会完整解除 DOM 指针监听',
);
manualEffect.destroy();

const coalescedEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    clickEnabled: false,
    trailAlways: true,
  },
);

flushFrames(dom, performance.now(), 1);
const coalescedNow = performance.now() + 1000;

dom.setCurrentTime(coalescedNow);
dom.windowMock.dispatch('pointermove',
  {
    pointerType: '',
    pointerId: 70,
    button: -1,
    clientX: 300,
    clientY: 220,
    timeStamp: coalescedNow,
    getCoalescedEvents()
    {
      return [
        {
          pointerType: '',
          pointerId: 70,
          clientX: 100,
          clientY: 220,
          timeStamp: coalescedNow - 100,
        },
        {
          pointerType: '',
          pointerId: 70,
          clientX: 300,
          clientY: 220,
          timeStamp: coalescedNow - 20,
        },
      ];
    },
  });
const coalescedBornTimes = coalescedEffect.currentTrailStroke.points.map(
  (point) => point.bornAt,
);
const coalescedTrailShards = coalescedEffect.shards.filter((shard) =>
  shard.kind === 'trail');

assert(
  coalescedEffect.activePointerId === 70 &&
    Math.max(...coalescedBornTimes) - Math.min(...coalescedBornTimes) >= 79 &&
    coalescedTrailShards.length > 0 &&
    coalescedTrailShards.every((shard) =>
      shard.lastUpdateTimeMs < coalescedEffect.trailTimeMs),
  'DOM 合并样本保留 timeStamp，空 pointerType 也可回退为逻辑鼠标输入',
);
coalescedEffect.pointerCancel(70);
coalescedEffect.destroy();

console.log('\n独立时间倍率');
const timeScaleEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    inputSource: 'manual',
    clickTimeScale: 2,
    trailTimeScale: 0.5,
  },
);
let timeScaleNow = flushFrames(dom, performance.now(), 1);

assert(
  timeScaleEffect.pointerDown(
    {
      x: 100,
      y: 200,
      pointerId: 5,
      pointerType: 'mouse',
    },
  ),
  '时间倍率实例可开始手动指针',
);
const scaledWave = timeScaleEffect.waves[0];
const scaledClickShard = timeScaleEffect.shards[0];

// 复用相同 ClickWave 更新实现作为预期值，避免在测试中复制旋转曲线。
timeScaleEffect.boom(100, 200);
const expectedScaledWave = timeScaleEffect.waves.pop();

timeScaleEffect.shards.splice(-UNITY_FX_TOUCH.shards.clickCount);
expectedScaledWave.ageMs = scaledWave.ageMs;
expectedScaledWave.rings = scaledWave.rings.map((ring) => ({ ...ring }));
expectedScaledWave.update(200);
assert(
  timeScaleEffect.pointerMove(
    {
      x: 500,
      y: 200,
      pointerId: 5,
      pointerType: 'mouse',
    },
  ),
  '时间倍率实例可追加拖尾采样',
);
const scaledTrailShard = timeScaleEffect.shards.find((shard) =>
  shard.kind === 'trail');

scaledClickShard.ageMs = 0;
scaledClickShard.lifetimeMs = 1000;
scaledClickShard.velocityX = 100;
scaledClickShard.velocityY = 0;
scaledTrailShard.ageMs = 0;
scaledTrailShard.lifetimeMs = 250;
scaledTrailShard.velocityX = 100;
scaledTrailShard.velocityY = 0;
timeScaleEffect.shards = [scaledClickShard, scaledTrailShard];
const clickStartX = scaledClickShard.x;
const trailStartX = scaledTrailShard.x;

// 显式设定测试时间基准，使 RAF delta 不受执行机器速度影响。
timeScaleEffect.lastFrameTime = timeScaleNow;
timeScaleNow = flushFrames(dom, timeScaleNow, 1, 100);
assert(
  Math.abs(scaledWave.ageMs - 200) < 1e-9 &&
    Math.abs(scaledClickShard.ageMs - 200) < 1e-9 &&
    Math.abs(scaledClickShard.x - clickStartX - 20) < 1e-9,
  'clickTimeScale 同时缩放点击波纹、点击碎片寿命与位移',
);
assert(
  scaledWave.rings.every((ring, index) =>
    Math.abs(ring.rotation - expectedScaledWave.rings[index].rotation) < 1e-12),
  'clickTimeScale 以同一缩放 delta 推进圆环旋转',
);
assert(
  Math.abs(scaledTrailShard.ageMs - 50) < 1e-9 &&
    Math.abs(scaledTrailShard.x - trailStartX - 5) < 1e-9,
  'trailTimeScale 同时缩放拖尾碎片寿命与位移',
);

timeScaleNow = flushFrames(dom, timeScaleNow, 1, 201);
assert(
  timeScaleEffect.waves.length === 0 &&
    timeScaleEffect.currentTrailStroke.points.length >= 2,
  '两倍速点击在约 300ms 完成，半速拖尾仍保留有效顶点',
);
timeScaleNow = flushFrames(dom, timeScaleNow, 1, 301);
assert(
  timeScaleEffect.shards.length === 0 &&
    timeScaleEffect.currentTrailStroke.points.length === 0,
  '半速拖尾在约 600ms 真实时间后完成 300ms 衰减与碎片运动',
);

timeScaleEffect.pointerCancel(5);
timeScaleEffect.clear();
timeScaleEffect.updateConfig(
  {
    clickEnabled: false,
    trailTimeScale: 0.5,
  },
);
timeScaleEffect.pointerDown({ x: 100, y: 300, pointerId: 6 });
timeScaleEffect.pointerMove({ x: 500, y: 300, pointerId: 6 });
const slowTrailPointCount = timeScaleEffect.currentTrailStroke.points.length;
const slowTrailShardCount = timeScaleEffect.shards.filter((shard) =>
  shard.kind === 'trail').length;

timeScaleEffect.pointerCancel(6);
timeScaleEffect.clearTrail();
timeScaleEffect.updateConfig({ trailTimeScale: 4 });
timeScaleEffect.pointerDown({ x: 100, y: 300, pointerId: 7 });
timeScaleEffect.pointerMove({ x: 500, y: 300, pointerId: 7 });
assert(
  timeScaleEffect.currentTrailStroke.points.length === slowTrailPointCount &&
    timeScaleEffect.shards.filter((shard) => shard.kind === 'trail').length ===
      slowTrailShardCount,
  'trailTimeScale 不改变 minVertexDistance 与 trailSpacing 等空间采样',
);

timeScaleEffect.updateConfig({ clickTimeScale: 3, trailTimeScale: 4 });
timeScaleEffect.updateConfig(
  {
    clickTimeScale: 0,
    trailTimeScale: Number.NaN,
  },
);
assert(
  timeScaleEffect.getConfig().clickTimeScale === 3 &&
    timeScaleEffect.getConfig().trailTimeScale === 4,
  'updateConfig 忽略非正有限时间倍率并保留有效值',
);
timeScaleEffect.destroy();

const extremeTimeScaleEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    inputSource: 'manual',
    clickTimeScale: Number.MAX_VALUE,
    trailTimeScale: Number.MAX_VALUE,
  },
);
let extremeTimeScaleNow = flushFrames(dom, performance.now(), 1);

extremeTimeScaleEffect.pointerDown(
  {
    x: 100,
    y: 100,
    pointerId: 10,
  },
);
extremeTimeScaleEffect.pointerMove(
  {
    x: 300,
    y: 100,
    pointerId: 10,
  },
);
extremeTimeScaleEffect.pointerCancel(10);
extremeTimeScaleNow = flushFrames(dom, extremeTimeScaleNow, 1, 16);
assert(
  Number.isFinite(extremeTimeScaleEffect.clickTimeMs) &&
    Number.isFinite(extremeTimeScaleEffect.trailTimeMs) &&
    extremeTimeScaleEffect.waves.length === 0 &&
    extremeTimeScaleEffect.shards.length === 0 &&
    extremeTimeScaleEffect.trailStrokes.length === 0 &&
    dom.frames.size === 0,
  '极大有限时间倍率不会溢出虚拟时钟或永久占用 RAF',
);
extremeTimeScaleEffect.destroy();

const clickClockEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    inputSource: 'manual',
  },
);
let clickClockNow = flushFrames(dom, performance.now(), 1);

clickClockEffect.boom(100, 100);
clickClockNow = flushFrames(dom, clickClockNow, 1, 10);
dom.setCurrentTime(clickClockNow + 490);
clickClockEffect.boom(200, 100);
const lateClickWave = clickClockEffect.waves.at(-1);
const lateClickShard = clickClockEffect.shards.at(-1);

clickClockNow = flushFrames(dom, clickClockNow + 490, 1, 10);
assert(
  Math.abs(lateClickWave.ageMs - 10) < 1e-9 &&
    Math.abs(lateClickShard.ageMs - 10) < 1e-9,
  '两帧之间新建的点击只消费出生后的时间，不继承此前长帧',
);
clickClockEffect.clear();
dom.setCurrentTime(clickClockNow);
clickClockEffect.boom(300, 100);
const switchedScaleWave = clickClockEffect.waves[0];

dom.setCurrentTime(clickClockNow + 100);
clickClockEffect.updateConfig({ clickTimeScale: 2 });
clickClockNow = flushFrames(dom, clickClockNow + 100, 1, 50);
assert(
  Math.abs(switchedScaleWave.ageMs - 200) < 1e-9,
  '运行时切换 clickTimeScale 只缩放变更后的时间区间',
);
clickClockEffect.destroy();

console.log('\n拖尾碎片时钟');
const trailShardClockEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    inputSource: 'manual',
    clickEnabled: false,
  },
);

flushFrames(dom, performance.now(), 1);
trailShardClockEffect.pointerDown({ x: 100, y: 250, pointerId: 15 });
trailShardClockEffect.pointerMove({ x: 300, y: 250, pointerId: 15 });
const interleavedTrailShard = trailShardClockEffect.shards.find((shard) =>
  shard.kind === 'trail');

assert(interleavedTrailShard, '移动超过 trailSpacing 后创建拖尾碎片');
interleavedTrailShard.ageMs = 0;
interleavedTrailShard.velocityX = 100;
interleavedTrailShard.velocityY = 0;
const interleavedStartX = interleavedTrailShard.x;
const shardVirtualStart = trailShardClockEffect.trailTimeMs;

// 模拟 RAF 前的高频输入。输入可以推进轨迹时钟，但不能吞掉已有碎片的动画时间。
trailShardClockEffect.lastTrailTimeSource = performance.now() - 15;
trailShardClockEffect.pointerMove({ x: 301, y: 250, pointerId: 15 });
const synchronizedInputTime = trailShardClockEffect.lastTrailTimeSource;
const expectedInterleavedDelta =
  trailShardClockEffect.trailTimeMs - shardVirtualStart + 1;

flushFrames(dom, synchronizedInputTime, 1, 1);
assert(
  expectedInterleavedDelta >= 16 &&
    Math.abs(interleavedTrailShard.ageMs - expectedInterleavedDelta) < 1e-9 &&
    Math.abs(
      interleavedTrailShard.x - interleavedStartX -
        expectedInterleavedDelta / 10,
    ) < 1e-9,
  '高频 pointerMove 与 RAF 交错时不会丢失拖尾碎片的寿命和位移',
);

flushFrames(dom, synchronizedInputTime + 1, 1, 1);
assert(
  Math.abs(interleavedTrailShard.ageMs - expectedInterleavedDelta - 1) < 1e-9 &&
    Math.abs(
      interleavedTrailShard.x - interleavedStartX -
        (expectedInterleavedDelta + 1) / 10,
    ) < 1e-9,
  '后续 RAF 只结算新增时间，不会重复应用输入期间的时间差',
);

trailShardClockEffect.pointerCancel(15);
trailShardClockEffect.clearTrail();
trailShardClockEffect.lastTrailTimeSource = performance.now() - 10000;
trailShardClockEffect.pointerDown({ x: 100, y: 300, pointerId: 16 });
trailShardClockEffect.pointerMove({ x: 300, y: 300, pointerId: 16 });
const postIdleTrailShard = trailShardClockEffect.shards.find((shard) =>
  shard.kind === 'trail');
const postIdleInputTime = trailShardClockEffect.lastTrailTimeSource;

flushFrames(dom, postIdleInputTime, 1, 1);
assert(
  postIdleTrailShard && postIdleTrailShard.ageMs === 1,
  '长时间空闲后新建的拖尾碎片不会继承空闲时间并立即过期',
);
trailShardClockEffect.destroy();

console.log('\n暂停与空闲调度');
const pauseEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    inputSource: 'manual',
  },
);

flushFrames(dom, performance.now(), 1);
pauseEffect.pointerDown({ x: 100, y: 100, pointerId: 44 });
pauseEffect.pointerMove({ x: 300, y: 100, pointerId: 44 });
const pausedWave = pauseEffect.waves[0];
const pausedClickShard = pauseEffect.shards.find((shard) =>
  shard.kind === 'click');
const pausedTrailShard = pauseEffect.shards.find((shard) =>
  shard.kind === 'trail');
const pausedStroke = pauseEffect.currentTrailStroke;
const pausedWaveAge = pausedWave.ageMs;
const pausedClickShardX = pausedClickShard.x;
const pausedTrailShardAge = pausedTrailShard.ageMs;
const pausedTrailShardX = pausedTrailShard.x;

pauseEffect.setPaused(true, { clear: false });
assert(
  pauseEffect.paused &&
    pauseEffect.activePointerId === null &&
    pauseEffect.lastPointerPosition === null &&
    pauseEffect.currentTrailStroke === null &&
    pausedStroke.active === false,
  'setPaused(true) 取消当前指针且 clear:false 保留可见对象',
);
assert(
  pauseEffect.animationFrame === null && dom.frames.size === 0,
  '暂停会取消已申请的 RAF',
);

const pausedCounts = [
  pauseEffect.waves.length,
  pauseEffect.shards.length,
  pauseEffect.trailStrokes.length,
];
pauseEffect.boom(500, 500);
assert(
  pauseEffect.pointerDown({ x: 500, y: 500, pointerId: 45 }) === false &&
    pauseEffect.pointerMove({ x: 520, y: 500, pointerId: 45 }) === false &&
    pauseEffect.pointerUp(45) === false &&
    pauseEffect.pointerCancel(45) === false &&
    pauseEffect.waves.length === pausedCounts[0] &&
    pauseEffect.shards.length === pausedCounts[1] &&
    pauseEffect.trailStrokes.length === pausedCounts[2],
  '暂停期间忽略 boom() 与全部公开指针输入',
);
dom.windowMock.dispatch('resize');
assert(dom.frames.size === 0, '暂停期间 resize 也不会重新申请 RAF');
assert(
  pausedWave.ageMs === pausedWaveAge &&
    pausedClickShard.x === pausedClickShardX &&
    pausedTrailShard.ageMs === pausedTrailShardAge &&
    pausedTrailShard.x === pausedTrailShardX,
  'clear:false 在暂停期间冻结点击与拖尾碎片状态',
);

// 模拟宿主长时间挂起；恢复必须覆盖这个过期时间基准。
pauseEffect.lastFrameTime = performance.now() - 60000;
const resumeTime = performance.now();

pauseEffect.setPaused(false);
assert(dom.frames.size === 1, '恢复后为保留的可见对象重新申请 RAF');
flushFrames(dom, resumeTime, 1, 16);
assert(
  pausedWave.ageMs > pausedWaveAge &&
    pausedWave.ageMs - pausedWaveAge < 100 &&
    Math.abs(pausedClickShard.x - pausedClickShardX) < 100 &&
    pausedTrailShard.ageMs > pausedTrailShardAge &&
    pausedTrailShard.ageMs - pausedTrailShardAge < 100 &&
    Math.abs(pausedTrailShard.x - pausedTrailShardX) < 100 &&
    pausedStroke.points.length >= 2,
  '恢复时重置点击、轨迹与拖尾碎片时间基准，不把暂停间隔当作超大 delta',
);

pauseEffect.pointerDown({ x: 600, y: 400, pointerId: 46 });
const clearCallCount = pauseEffect.context.clearRectCalls.length;

pauseEffect.setPaused(true, { clear: true });
assert(
  pauseEffect.waves.length === 0 &&
    pauseEffect.shards.length === 0 &&
    pauseEffect.trailStrokes.length === 0 &&
    pauseEffect.activePointerId === null &&
    pauseEffect.animationFrame === null &&
    dom.frames.size === 0 &&
    pauseEffect.context.clearRectCalls.length > clearCallCount,
  'setPaused(true, { clear:true }) 停止调度并立即清除全部视觉对象',
);
pauseEffect.setPaused(false);
assert(
  pauseEffect.pointerDown({ x: 60, y: 70, pointerId: 47 }) === true,
  '恢复后公开指针输入重新生效',
);
pauseEffect.pointerCancel(47);
pauseEffect.destroy();

const pauseSettlementEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    inputSource: 'manual',
  },
);
let pauseSettlementNow = flushFrames(dom, performance.now(), 1);

pauseSettlementEffect.boom(400, 300);
const settledWave = pauseSettlementEffect.waves[0];

dom.setCurrentTime(pauseSettlementNow + 100);
pauseSettlementEffect.setPaused(true, { clear: false });
assert(
  Math.abs(
    pauseSettlementEffect.clickTimeMs - settledWave.lastUpdateTimeMs - 100,
  ) < 1e-9,
  '暂停前先结算上一帧后的有效点击时间',
);
dom.setCurrentTime(pauseSettlementNow + 10100);
pauseSettlementEffect.setPaused(false);
pauseSettlementNow = flushFrames(dom, pauseSettlementNow + 10100, 1, 16);
assert(
  Math.abs(settledWave.ageMs - 116) < 1e-9,
  '恢复后保留暂停前时间且不计入暂停区间',
);
pauseSettlementEffect.destroy();

const idleTrailEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    inputSource: 'manual',
    clickEnabled: false,
    trailAlways: true,
  },
);

let idleTrailNow = flushFrames(dom, performance.now(), 1);
assert(
  idleTrailEffect.pointerMove({ x: 100, y: 100, pointerId: 9 }) === true &&
    idleTrailEffect.activePointerId === 9 &&
    idleTrailEffect.currentTrailStroke.points.length === 2,
  'trailAlways 的首个移动样本创建可见轨迹',
);

// 固定虚拟拖尾时钟，精确验证 300ms 后的空闲判定。
idleTrailEffect.trailTimeMs = 0;
idleTrailEffect.lastFrameTime = idleTrailNow;
for (const point of idleTrailEffect.currentTrailStroke.points)
{
  point.bornAt = 0;
}
idleTrailNow = flushFrames(dom, idleTrailNow, 40, 20);
assert(
  dom.frames.size === 0 &&
    idleTrailEffect._hasVisibleEffects() === false &&
    idleTrailEffect.activePointerId === 9 &&
    !idleTrailEffect.trailStrokes.some((stroke) => stroke.points.length >= 2),
  'trailAlways 停止移动后忽略空指针状态并停止 RAF',
);
assert(
  idleTrailEffect.pointerMove({ x: 140, y: 100, pointerId: 9 }) === true &&
    idleTrailEffect.currentTrailStroke.points.length >= 2 &&
    dom.frames.size === 1,
  '空闲后的下一次 pointerMove 追加新顶点并唤醒 RAF',
);
idleTrailNow = flushFrames(dom, idleTrailNow, 1, 20);
assert(
  idleTrailEffect._hasVisibleEffects() === true &&
    idleTrailEffect.currentTrailStroke.points.length >= 2,
  'trailAlways 空闲后的首次移动在实际渲染帧仍保持可见',
);
idleTrailEffect.currentTrailStroke.points = [
  {
    x: 140,
    y: 100,
    bornAt: idleTrailEffect.trailTimeMs -
      UNITY_FX_TOUCH.trail.lifetimeMs - 1,
  },
];
idleTrailEffect.lastPointerPosition = { x: 140, y: 100 };
idleTrailEffect.lastPointerTime = idleTrailEffect.trailTimeMs - 1000;
assert(
  idleTrailEffect.pointerMove({ x: 180, y: 100, pointerId: 9 }) === true &&
    idleTrailEffect.currentTrailStroke.points.length >= 2 &&
    idleTrailEffect.currentTrailStroke.points.every((point) =>
      point.bornAt === idleTrailEffect.trailTimeMs),
  'trailAlways 仅剩一个过期点时也从当前时刻重建轨迹',
);
const cancelledIdleStroke = idleTrailEffect.currentTrailStroke;

assert(
  idleTrailEffect.pointerCancel(8) === false &&
    idleTrailEffect.pointerCancel(9) === true &&
    idleTrailEffect.activePointerId === null &&
    idleTrailEffect.lastPointerPosition === null &&
    idleTrailEffect.currentTrailStroke === null &&
    cancelledIdleStroke.active === false,
  'pointerCancel 清理 trailAlways 的指针位置与当前 stroke',
);
idleTrailEffect.destroy();

const trailStateEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    inputSource: 'manual',
    clickEnabled: false,
    trailAlways: true,
  },
);

flushFrames(dom, performance.now(), 1);
assert(
  trailStateEffect.pointerDown({ x: 100, y: 100, pointerId: 80 }) === true &&
    trailStateEffect.pointerDown({ x: 120, y: 100, pointerId: 81 }) === false &&
    trailStateEffect.activePointerId === 80,
  'trailAlways 也不会让第二次真实按下夺取活动指针',
);
trailStateEffect.pointerCancel(80);
trailStateEffect.pointerMove({ x: 200, y: 200, pointerId: 82 });
assert(
  trailStateEffect.activePointerSource === 'hover' &&
    trailStateEffect.activePointerId === 82,
  'trailAlways 移动会建立可被点击接管的悬停指针',
);
trailStateEffect.updateConfig({ trailAlways: false });
assert(
  trailStateEffect.activePointerId === null &&
    trailStateEffect.currentTrailStroke === null &&
    trailStateEffect.pointerDown({ x: 220, y: 200, pointerId: 83 }) === true,
  '运行时关闭 trailAlways 会释放悬停状态并允许下一次正常按下',
);
trailStateEffect.pointerCancel(83);
trailStateEffect.updateConfig({ trailAlways: true });
assert(
  trailStateEffect.pointerMove(
    {
      x: trailStateEffect.width,
      y: trailStateEffect.height,
      pointerId: 84,
    },
  ) === true &&
    trailStateEffect._hasVisibleEffects() === true &&
    trailStateEffect.currentTrailStroke.points[0].x !==
      trailStateEffect.currentTrailStroke.points[1].x,
  '右下角 trailAlways 种子向画布内部偏移，不产生零长度伪轨迹',
);
trailStateEffect.pointerCancel(84);
trailStateEffect.destroy();

const releasedSinglePointEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    clickEnabled: false,
    inputSource: 'manual',
  },
);
const releasedTrailStart = flushFrames(dom, performance.now(), 1);

releasedSinglePointEffect.pointerDown(
  {
    x: 100,
    y: 100,
    pointerId: 85,
  },
);
dom.setCurrentTime(releasedTrailStart + 200);
releasedSinglePointEffect.pointerMove(
  {
    x: 108,
    y: 100,
    pointerId: 85,
  },
);
releasedSinglePointEffect.pointerUp(85);
flushFrames(dom, releasedTrailStart + 200, 1, 210);
assert(
  releasedSinglePointEffect.trailStrokes.length === 0 &&
    dom.frames.size === 0,
  '已松开轨迹错峰衰减到单点时会删除容器并停止 RAF',
);
releasedSinglePointEffect.destroy();

const clickGlowResetEffect = new BAClickFX({ bloomBackend: 'native' });

clickGlowResetEffect.setFxParam('bloom.clickEmissionScale', -1);
assert(
  clickGlowResetEffect.getFxConfig().bloom.clickEmissionScale === 0,
  '点击发射 API 将负倍率钳制为零',
);
clickGlowResetEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
const disabledNativeGlowIndices = clickGlowResetEffect.context.fillShadowBlurs
  .reduce((indices, blur, index) =>
  {
    if (
      blur > 0 &&
      clickGlowResetEffect.context.filledPaths[index]?.length !== 3
    )
    {
      indices.push(index);
    }

    return indices;
  }, []);

assert(
  disabledNativeGlowIndices.length > 0 &&
    disabledNativeGlowIndices.every((index) =>
      getCssAlpha(clickGlowResetEffect.context.fillShadowColors[index]) === 0),
  '点击发射倍率为零时原生圆环与光盘只关闭阴影、不移除清晰几何',
);
clickGlowResetEffect.clear();
clickGlowResetEffect.setFxParam('bloom.clickEmissionScale', 4);
clickGlowResetEffect.context.fillShadowBlurs = [];
clickGlowResetEffect.context.fillShadowColors = [];
clickGlowResetEffect.context.filledPaths = [];
clickGlowResetEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
const boostedNativeGlowAlphas = clickGlowResetEffect.context.fillShadowBlurs
  .reduce((alphas, blur, index) =>
  {
    if (
      blur > 0 &&
      clickGlowResetEffect.context.filledPaths[index]?.length !== 3
    )
    {
      alphas.push(getCssAlpha(
        clickGlowResetEffect.context.fillShadowColors[index],
      ));
    }

    return alphas;
  }, []);

assert(
  boostedNativeGlowAlphas.length > 0 &&
    boostedNativeGlowAlphas.every((alpha) => alpha > 0 && alpha < 1),
  '原生辉光在滑块上限仍保持单调余量，不会提前钳制为不透明阴影',
);
clickGlowResetEffect.resetFxConfig();
assert(
  clickGlowResetEffect.getFxConfig().bloom.clickEmissionScale === 1,
  'resetFxConfig() 恢复点击发射倍率默认值',
);
clickGlowResetEffect.destroy();

const firstIsolatedEffect = new BAClickFX({ isolatedCompositing: true });
const secondIsolatedEffect = new BAClickFX({ isolatedCompositing: true });
const secondOverlayRoot = secondIsolatedEffect.overlayRoot;

assert(
  firstIsolatedEffect.overlayRoot !== secondOverlayRoot &&
    dom.body.children.includes(firstIsolatedEffect.overlayRoot) &&
    dom.body.children.includes(secondOverlayRoot),
  '每个实例建立独立合成组，避免配置和销毁生命周期相互耦合',
);
firstIsolatedEffect.updateConfig({ isolatedCompositing: false });
assert(
  secondOverlayRoot.parentElement === dom.body &&
    secondIsolatedEffect.canvas.parentElement === secondOverlayRoot &&
    secondIsolatedEffect.getConfig().isolatedCompositing === true,
  '一个实例切换直接合成不会移动另一个实例的隔离层',
);
firstIsolatedEffect.destroy();
assert(
  secondOverlayRoot.parentElement === dom.body &&
    !secondOverlayRoot.removed,
  '销毁一个实例不会误删另一个实例的隔离根',
);
secondIsolatedEffect.destroy();
assert(dom.body.children.length === 0, '全部实例销毁后不残留隔离合成节点');

console.log('\nBloom 后端 API');
const webglEffect = new BAClickFX(
  {
    bloomBackend: 'webgl2',
    isolatedCompositing: true,
  },
);
const canvasCountBeforeWebGLAttempt = dom.createdCanvases.length;
const webglBackendEvents = [];

webglEffect.canvas.addEventListener(BLOOM_BACKEND_CHANGE_EVENT, (event) =>
{
  webglBackendEvents.push(event.detail);
});
assert(
  webglEffect.getConfig().resolvedBloomBackend === 'pending',
  'WebGL2 延迟能力探测前公开 pending，不伪报 Software 后端',
);

webglEffect.boom(960, 540);
const webglFirstFrameTime = flushFrames(dom, performance.now(), 1);

const webglFallbackConfig = webglEffect.getConfig();
const attemptedWebGLCanvas = dom.createdCanvases.at(-1);
const attemptedWebGLMount = dom.canvasMounts.find(
  (mount) => mount.canvas === attemptedWebGLCanvas,
);
const canvasCountAfterWebGLAttempt = dom.createdCanvases.length;

flushFrames(dom, webglFirstFrameTime, 1);

assert(
  dom.createdCanvases.length === canvasCountBeforeWebGLAttempt + 1 &&
    dom.appendedCanvases.includes(attemptedWebGLCanvas) &&
    attemptedWebGLCanvas.removed,
  '请求 WebGL2 时延迟创建独立画布，不可用后立即移除',
);
assert(
  attemptedWebGLMount?.parent === webglEffect.overlayRoot &&
    attemptedWebGLCanvas.style.position === 'absolute',
  '隔离模式下延迟创建的 WebGL Canvas 挂入隔离根并使用 absolute 定位',
);
assert(
  webglEffect.webglBloomUnavailable &&
    webglEffect.webglBloomRenderer === null &&
    dom.createdCanvases.length === canvasCountAfterWebGLAttempt,
  'WebGL2 初始化失败会被记忆，后续帧不重复尝试创建上下文',
);
assert(
  webglFallbackConfig.bloomBackend === 'webgl2' &&
    webglFallbackConfig.softwareBloomEnabled === true &&
    webglFallbackConfig.resolvedBloomBackend === 'software',
  'getConfig() 同时保留请求的 WebGL2 后端与实际的软件 Bloom 回退结果',
);
assert(
  webglBackendEvents.length === 1 &&
    webglBackendEvents[0].requestedBloomBackend === 'webgl2' &&
    webglBackendEvents[0].resolvedBloomBackend === 'software',
  'WebGL2 首帧回退时在主 Canvas 派发后端解析状态事件',
);
assert(
  webglEffect.context.drawImageCalls.some((call) =>
    call.args[0] === webglEffect.bloomRenderer.outputCanvas),
  'WebGL2 不可用时当前帧仍由软件 Bloom 完成绘制',
);
const webglEventCountAfterFallback = webglBackendEvents.length;

webglEffect.updateConfig({ opacity: 0.8 });
flushFrames(dom, webglFirstFrameTime, 1);
assert(
  webglEffect.getConfig().resolvedBloomBackend === 'software' &&
    webglBackendEvents.length === webglEventCountAfterFallback,
  '非后端配置更新不会把已解析结果重置为 pending 或重复派发事件',
);
const retainedWebGLRenderer =
{
  available: true,
  destroyed: false,
  clear()
  {
  },
  destroy()
  {
    this.available = false;
    this.destroyed = true;
  },
};

// 复用失败探测留下的 Canvas，单独验证合成挂载生命周期而不伪造完整 WebGL API。
webglEffect.webglBloomCanvas = attemptedWebGLCanvas;
webglEffect.webglBloomRenderer = retainedWebGLRenderer;
webglEffect.webglBloomUnavailable = false;
webglEffect._applyCompositingMount();
const canvasCountBeforeCompositingSwitch = dom.createdCanvases.length;

webglEffect.updateConfig({ isolatedCompositing: false });
assert(
  webglEffect.webglBloomCanvas.parentElement === dom.body &&
    webglEffect.webglBloomCanvas.style.position === 'fixed' &&
    webglEffect.webglBloomRenderer === retainedWebGLRenderer,
  '关闭隔离合成时重挂载已有 WebGL Canvas，不重建 renderer',
);
webglEffect.updateConfig({ isolatedCompositing: true });
assert(
  webglEffect.webglBloomCanvas.parentElement === webglEffect.overlayRoot &&
    webglEffect.webglBloomCanvas.style.position === 'absolute' &&
    webglEffect.webglBloomRenderer === retainedWebGLRenderer &&
    dom.createdCanvases.length === canvasCountBeforeCompositingSwitch,
  '恢复隔离合成时复用 WebGL Canvas 和 renderer',
);
const retainedOverlayRoot = webglEffect.overlayRoot;

webglEffect.destroy();
assert(
  attemptedWebGLCanvas.removed &&
    retainedWebGLRenderer.destroyed &&
    retainedOverlayRoot.removed &&
    dom.body.children.length === 0,
  'destroy() 清理 WebGL Canvas、renderer 和隔离根',
);

const directWebGLEffect = new BAClickFX(
  {
    bloomBackend: 'webgl2',
    isolatedCompositing: false,
  },
);
const canvasCountBeforeDirectAttempt = dom.createdCanvases.length;

directWebGLEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
const directAttemptedCanvas = dom.createdCanvases.at(-1);
const directAttemptedMount = dom.canvasMounts.find(
  (mount) => mount.canvas === directAttemptedCanvas,
);

assert(
  dom.createdCanvases.length === canvasCountBeforeDirectAttempt + 1 &&
    directAttemptedMount?.parent === dom.body &&
    directAttemptedCanvas.style.position === 'fixed' &&
    directAttemptedCanvas.removed,
  '直接合成模式下延迟创建的全屏 WebGL Canvas 挂到 body 并使用 fixed 定位',
);
directWebGLEffect.destroy();

const externalCanvas = new CanvasMock();
const externalWebGLEffect = new BAClickFX(
  {
    target: externalCanvas,
    bloomBackend: 'webgl2',
  },
);
const canvasCountBeforeExternalFallback = dom.createdCanvases.length;

assert(
  externalWebGLEffect.getConfig().resolvedBloomBackend === 'software',
  '已有 Canvas target 无法承载独立 WebGL 层时同步给出已知回退后端',
);
assert(
  externalWebGLEffect.getConfig().isolatedCompositing === false,
  '已有 Canvas target 明确降级为直接合成',
);
externalWebGLEffect.updateConfig({ isolatedCompositing: true });
assert(
  externalWebGLEffect.getConfig().isolatedCompositing === false,
  '已有 Canvas target 在运行时也不能误报已启用隔离合成',
);
externalWebGLEffect.updateConfig({ renderingMode: 'legacy' });
assert(
  externalWebGLEffect.getFxConfig().rings.hdrIntensity ===
      UNITY_FX_TOUCH.rings.hdrIntensity &&
    externalWebGLEffect.getFxConfig().rings.bandToOuterRadius ===
      UNITY_FX_TOUCH.rings.bandToOuterRadius &&
    externalWebGLEffect.getConfig().resolvedBloomBackend === 'legacy',
  '已有 Canvas target 切换 Legacy 时仍保留 Unity 参数集',
);
externalWebGLEffect.updateConfig({ renderingMode: 'enhanced' });
assert(
  externalWebGLEffect.getFxConfig().rings.hdrIntensity ===
      UNITY_FX_TOUCH.rings.hdrIntensity &&
    externalWebGLEffect.getFxConfig().rings.bandToOuterRadius ===
      UNITY_FX_TOUCH.rings.bandToOuterRadius,
  '已有 Canvas target 切回增强模式时继续保留 Unity 参数集',
);

externalWebGLEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
const externalFallbackConfig = externalWebGLEffect.getConfig();

assert(
  dom.createdCanvases.length === canvasCountBeforeExternalFallback &&
    externalWebGLEffect.webglBloomCanvas === null &&
    externalFallbackConfig.resolvedBloomBackend === 'software',
  '已有 Canvas target 无法插入独立 GPU 层时直接回退软件 Bloom',
);
externalWebGLEffect.destroy();
assert(!externalCanvas.removed, '销毁实例不会移除调用方传入的 Canvas');

const compatibilityEffect = new BAClickFX(
  {
    softwareBloomEnabled: false,
  },
);
const compatibilityBackendEvents = [];

compatibilityEffect.canvas.addEventListener(BLOOM_BACKEND_CHANGE_EVENT, (event) =>
{
  compatibilityBackendEvents.push(event.detail.resolvedBloomBackend);
});
let compatibilityConfig = compatibilityEffect.getConfig();

assert(
  compatibilityConfig.bloomBackend === 'native' &&
    compatibilityConfig.softwareBloomEnabled === false &&
    compatibilityConfig.resolvedBloomBackend === 'native',
  '旧 softwareBloomEnabled=false 构造参数同步映射到原生辉光',
);
compatibilityEffect.updateConfig(
  {
    softwareBloomEnabled: true,
  },
);
compatibilityConfig = compatibilityEffect.getConfig();
assert(
  compatibilityConfig.bloomBackend === 'software' &&
    compatibilityConfig.softwareBloomEnabled === true &&
    compatibilityConfig.resolvedBloomBackend === 'software',
  '旧 softwareBloomEnabled=true 更新参数同步映射到软件 Bloom',
);
compatibilityEffect.updateConfig(
  {
    bloomBackend: 'webgl2',
    softwareBloomEnabled: false,
  },
);
compatibilityConfig = compatibilityEffect.getConfig();
assert(
  compatibilityConfig.bloomBackend === 'webgl2' &&
    compatibilityConfig.softwareBloomEnabled === true &&
    compatibilityConfig.resolvedBloomBackend === 'pending',
  '新 bloomBackend 优先于旧别名，并在延迟探测前同步进入 pending',
);
compatibilityEffect.updateConfig({ bloomBackend: 'auto' });
assert(
  compatibilityEffect.getConfig().resolvedBloomBackend === 'pending',
  'pending 期间切换 auto 保持等待探测，不伪造回退结果',
);
flushFrames(dom, performance.now(), 1);
compatibilityConfig = compatibilityEffect.getConfig();
assert(
  compatibilityConfig.bloomBackend === 'auto' &&
    compatibilityConfig.resolvedBloomBackend === 'software',
  'auto 会优先尝试 WebGL2，并在当前环境自动回退软件 Bloom',
);
assert(
  compatibilityBackendEvents.join(',') === 'software,pending,software',
  '运行时后端 API 按 Software、pending、回退结果依次派发状态变化',
);
compatibilityEffect.destroy();

const softwareAliasEffect = new BAClickFX(
  {
    softwareBloomEnabled: true,
  },
);
assert(
  softwareAliasEffect.getConfig().bloomBackend === 'software' &&
    softwareAliasEffect.getConfig().resolvedBloomBackend === 'software',
  '旧 softwareBloomEnabled=true 构造参数仍显式选择软件 Bloom',
);
softwareAliasEffect.destroy();

const contextLifecycleEffect = new BAClickFX({ bloomBackend: 'webgl2' });
const contextLifecycleEvents = [];

contextLifecycleEffect.canvas.addEventListener(
  BLOOM_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    contextLifecycleEvents.push(event.detail.resolvedBloomBackend);
  },
);
contextLifecycleEffect._ensureWebGLBloomRenderer = () => true;
contextLifecycleEffect._resizeWebGLBloomRenderer = () => true;
flushFrames(dom, performance.now(), 1);
contextLifecycleEffect._handleWebGLContextLost();
contextLifecycleEffect._handleWebGLContextRestored();
flushFrames(dom, performance.now(), 1);
assert(
  contextLifecycleEvents.slice(0, 4).join(',') ===
    'webgl2,software,pending,webgl2',
  'WebGL Context 丢失与恢复按 WebGL2、Software、pending、WebGL2 更新状态',
);

contextLifecycleEffect.updateConfig({ bloomBackend: 'native' });
const dormantNativeEventCount = contextLifecycleEvents.length;

contextLifecycleEffect._handleWebGLContextLost();
contextLifecycleEffect._handleWebGLContextRestored();
assert(
  contextLifecycleEffect.getConfig().resolvedBloomBackend === 'native' &&
    contextLifecycleEvents.length === dormantNativeEventCount,
  '隐藏的 WebGL Canvas 丢失上下文时不会覆盖 Native 后端状态',
);

contextLifecycleEffect.updateConfig({ renderingMode: 'legacy' });
const dormantLegacyEventCount = contextLifecycleEvents.length;

contextLifecycleEffect._handleWebGLContextLost();
contextLifecycleEffect._handleWebGLContextRestored();
assert(
  contextLifecycleEffect.getConfig().resolvedBloomBackend === 'legacy' &&
    contextLifecycleEvents.length === dormantLegacyEventCount,
  'Legacy 模式忽略休眠 WebGL Canvas 的上下文事件',
);

const atomicEventCount = contextLifecycleEvents.length;

contextLifecycleEffect.updateConfig(
  {
    renderingMode: 'enhanced',
    bloomBackend: 'webgl2',
  },
);
assert(
  contextLifecycleEffect.getConfig().resolvedBloomBackend === 'pending' &&
    contextLifecycleEvents.length === atomicEventCount + 1 &&
    contextLifecycleEvents.at(-1) === 'pending',
  '一次更新渲染模式与 Bloom 后端只派发最终 pending 状态',
);
contextLifecycleEffect.destroy();

console.log('\n完整 WebGL2 特效后端');
const pendingFullWebGLEffect = new BAClickFX(
  {
    effectBackend: 'webgl2',
  },
);

assert(
  pendingFullWebGLEffect.getConfig().effectBackend === 'webgl2' &&
    pendingFullWebGLEffect.getConfig().resolvedEffectBackend === 'pending',
  '完整 WebGL2 构造后同步公开 pending，等待首帧能力探测',
);
pendingFullWebGLEffect.destroy();

const fullWebGLSubmissionEffect = new BAClickFX(
  {
    inputSource: 'manual',
    bloomBackend: 'native',
  },
);
const fullWebGLSubmissionOrder = [];
const fullWebGLTrailTriangles = [];
const fullWebGLTrailTriangleColors = [];
const fullWebGLDiskCalls = [];
const fullWebGLRingCalls = [];
let fullWebGLSubmissionPhase = 'idle';
let duplicateFullWebGLEmissionCount = 0;
let preservedFullWebGLScene = false;
const recordFullWebGLSubmission = (type) =>
{
  if (fullWebGLSubmissionPhase === 'scene')
  {
    if (!fullWebGLSubmissionOrder.includes(type))
    {
      fullWebGLSubmissionOrder.push(type);
    }

    return;
  }

  if (fullWebGLSubmissionPhase === 'bloom')
  {
    duplicateFullWebGLEmissionCount++;
  }
};

fullWebGLSubmissionEffect.pointerDown(
  { x: 100, y: 100, pointerId: 501 },
);
fullWebGLSubmissionEffect.pointerMove(
  { x: 170, y: 100, pointerId: 501 },
);
fullWebGLSubmissionEffect.pointerMove(
  { x: 170, y: 170, pointerId: 501 },
);
fullWebGLSubmissionEffect.currentTrailStroke.points =
[
  { x: 100, y: 100, bornAt: fullWebGLSubmissionEffect.trailTimeMs },
  { x: 170, y: 100, bornAt: fullWebGLSubmissionEffect.trailTimeMs },
  { x: 170, y: 170, bornAt: fullWebGLSubmissionEffect.trailTimeMs },
];
fullWebGLSubmissionEffect.webglBloomRenderer =
{
  available: true,
  sceneEnabled: true,
  stats:
  {
    sceneVertexCount: 0,
  },
  resize()
  {
    return true;
  },
  beginFrame(options = {})
  {
    fullWebGLSubmissionPhase = options.preserveSceneStats === true
      ? 'bloom'
      : 'scene';
  },
  addAlphaBlendDisk(...args)
  {
    recordFullWebGLSubmission('disk');
    fullWebGLDiskCalls.push(args);
  },
  addTrailTriangle(first, second, third, colors)
  {
    recordFullWebGLSubmission('trail');

    if (fullWebGLSubmissionPhase === 'scene')
    {
      fullWebGLTrailTriangles.push([first, second, third]);
      fullWebGLTrailTriangleColors.push(colors);
    }
  },
  addTriangle()
  {
    recordFullWebGLSubmission('shard');
  },
  addDissolveRing(...args)
  {
    recordFullWebGLSubmission('ring');
    fullWebGLRingCalls.push(args);
  },
  addSolidDisk()
  {
    recordFullWebGLSubmission('auxiliary');
  },
  addTrailSegment()
  {
    recordFullWebGLSubmission('auxiliary');
  },
  renderScene()
  {
    return true;
  },
  render(settings, options = {})
  {
    preservedFullWebGLScene = options.preserveCanvas === true;
    return true;
  },
  clear()
  {
  },
  destroy()
  {
  },
};
const smallWebGLSceneScale = 0.05;

assert(
  fullWebGLSubmissionEffect._renderWebGL2Effects(smallWebGLSceneScale),
  '完整 WebGL2 测试场景可完成 Scene 与 Bloom 合成',
);
assert(
  fullWebGLSubmissionOrder.join(',') === 'disk,trail,shard,ring',
  '完整 WebGL2 按 Disk、Trail/Shard、RenderQueue 4499 Ring 提交',
);
assert(
  duplicateFullWebGLEmissionCount === 0 && preservedFullWebGLScene,
  '完整 WebGL2 直接复用 HDR Scene Target，不重复构建 Bloom emission',
);
assert(
  fullWebGLDiskCalls.length > 0 &&
    Number.isFinite(fullWebGLDiskCalls[0][5]) &&
    fullWebGLRingCalls.length > 0 &&
    Number.isFinite(fullWebGLRingCalls[0][9]) &&
    typeof fullWebGLRingCalls[0][10] === 'function' &&
    fullWebGLRingCalls[0][9] >
      fullWebGLRingCalls[0][10](0, 0.5) &&
    Math.abs(
      fullWebGLRingCalls[0][10](0, 0.5) -
        UNITY_FX_TOUCH.rings.textureAlphaKeys[0][1],
    ) < 0.000001,
  '完整 WebGL2 光盘保留 Particle Alpha，圆环独立提交 dissolve threshold',
);
const trailProfileBandCount = transverseStopCount - 1;
const trailTrianglesPerSegment = trailProfileBandCount * 2;
const firstWebGLSegmentColors = fullWebGLTrailTriangleColors.slice(
  0,
  trailTrianglesPerSegment,
);
const secondWebGLSegmentColors = fullWebGLTrailTriangleColors.slice(
  trailTrianglesPerSegment,
  trailTrianglesPerSegment * 2,
);
let hasContinuousWebGLStretch = false;
let sharedWebGLJointColors = true;

for (let band = 0; band < trailProfileBandCount; band++)
{
  const firstTriangle = firstWebGLSegmentColors[band * 2];
  const firstSecondTriangle = firstWebGLSegmentColors[band * 2 + 1];
  const secondTriangle = secondWebGLSegmentColors[band * 2];
  const secondSecondTriangle = secondWebGLSegmentColors[band * 2 + 1];

  hasContinuousWebGLStretch ||= JSON.stringify(firstTriangle[0]) !==
    JSON.stringify(firstTriangle[1]);
  sharedWebGLJointColors &&=
    JSON.stringify(firstTriangle[1]) ===
      JSON.stringify(secondTriangle[0]) &&
    JSON.stringify(firstTriangle[2]) ===
      JSON.stringify(secondSecondTriangle[2]);
}

const startWebGLCapColors = fullWebGLTrailTriangleColors.at(-2);
const endWebGLCapColors = fullWebGLTrailTriangleColors.at(-1);

assert(
  hasContinuousWebGLStretch &&
    sharedWebGLJointColors &&
    startWebGLCapColors.flat().every((channel) => channel === 0) &&
    endWebGLCapColors.flat().some((channel) => channel > 0),
  'WebGL2 按弧长端点连续插值 Stretch，join/cap 复用折点与端点能量',
);
const smallWebGLTrailWidth = UNITY_FX_TOUCH.trail.width *
  smallWebGLSceneScale;
const smallWebGLStartEdgePoints = fullWebGLTrailTriangles
  .flat()
  .filter((point) => Math.abs(point.x - 100) < 0.000001);
const smallWebGLStartYs = smallWebGLStartEdgePoints.map((point) => point.y);
const smallWebGLMeasuredWidth =
  Math.max(...smallWebGLStartYs) - Math.min(...smallWebGLStartYs);

assert(
  smallWebGLMeasuredWidth < 0.5 &&
    Math.abs(smallWebGLMeasuredWidth - smallWebGLTrailWidth) < 0.000001,
  '完整 WebGL2 拖尾在小 scale 下严格使用 Unity 带宽，不强制放大到 0.5px',
);
const smallWebGLTurnPoint = { x: 170, y: 100 };
const smallWebGLOuterRadius = smallWebGLTrailWidth * 0.5;
const uniqueSmallWebGLPoints = [];

for (const point of fullWebGLTrailTriangles.flat())
{
  if (!uniqueSmallWebGLPoints.some((candidate) =>
    Math.hypot(candidate.x - point.x, candidate.y - point.y) < 0.000001))
  {
    uniqueSmallWebGLPoints.push(point);
  }
}

const smallWebGLOuterArc = uniqueSmallWebGLPoints.filter((point) =>
  Math.abs(
    Math.hypot(
      point.x - smallWebGLTurnPoint.x,
      point.y - smallWebGLTurnPoint.y,
    ) - smallWebGLOuterRadius,
  ) < 0.000001);

assert(
  smallWebGLOuterArc.length ===
    UNITY_FX_TOUCH.trail.numCornerVertices + 2,
  '完整 WebGL2 复用共享网格的内角交点和 4 点外角圆弧',
);
fullWebGLSubmissionEffect.waves.length = 0;
fullWebGLSubmissionEffect.shards.length = 0;
fullWebGLTrailTriangles.length = 0;
fullWebGLTrailTriangleColors.length = 0;
fullWebGLSubmissionEffect._renderWebGL2Bloom(smallWebGLSceneScale);
const smallWebGLBloomStartPoints = fullWebGLTrailTriangles
  .flat()
  .filter((point) => Math.abs(point.x - 100) < 0.000001);
const smallWebGLBloomStartYs = smallWebGLBloomStartPoints.map(
  (point) => point.y,
);
const smallWebGLBloomMeasuredWidth =
  Math.max(...smallWebGLBloomStartYs) - Math.min(...smallWebGLBloomStartYs);
const expectedSmallWebGLBloomWidth =
  UNITY_FX_TOUCH.trail.geometryWidth *
  smallWebGLSceneScale *
  UNITY_FX_TOUCH.bloom.trailCoverageScale;

assert(
  smallWebGLBloomMeasuredWidth < 0.5 &&
    Math.abs(
      smallWebGLBloomMeasuredWidth - expectedSmallWebGLBloomWidth,
    ) < 0.000001,
  'WebGL2 Bloom emission 也严格随 scale 缩放，不强制最小 0.5px',
);
fullWebGLSubmissionEffect.destroy();

const runtimeEffectBackendEffect = new BAClickFX({ bloomBackend: 'native' });
const runtimeEffectBackendEvents = [];
let runtimeFullWebGLClearCount = 0;

flushFrames(dom, performance.now(), 1);
runtimeEffectBackendEffect.canvas.addEventListener(
  EFFECT_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    runtimeEffectBackendEvents.push(event.detail.resolvedEffectBackend);
  },
);
runtimeEffectBackendEffect.webglBloomRenderer =
{
  available: true,
  sceneEnabled: true,
  clear()
  {
    runtimeFullWebGLClearCount++;
  },
  destroy()
  {
  },
};
runtimeEffectBackendEffect._ensureWebGLBloomRenderer = () => true;
runtimeEffectBackendEffect._resizeWebGLBloomRenderer = () => true;
runtimeEffectBackendEffect.updateConfig({ effectBackend: 'webgl2' });

assert(
  runtimeEffectBackendEffect.getConfig().resolvedEffectBackend === 'pending',
  'Canvas2D 运行时切换完整 WebGL2 时先进入 pending',
);
flushFrames(dom, performance.now(), 1);
runtimeEffectBackendEffect.updateConfig({ effectBackend: 'canvas2d' });
assert(
  runtimeEffectBackendEffect.getConfig().resolvedEffectBackend ===
      'canvas2d' &&
    runtimeEffectBackendEvents.join(',') === 'pending,webgl2,canvas2d' &&
    runtimeFullWebGLClearCount === 1,
  '完整特效后端按 Canvas2D、pending、WebGL2、Canvas2D 原子切换并派发事件',
);
runtimeEffectBackendEffect.destroy();

const fullWebGLFailureEffect = new BAClickFX(
  {
    effectBackend: 'webgl2',
    bloomBackend: 'native',
  },
);
const renderCanvasEffects =
  fullWebGLFailureEffect._renderCanvasEffects.bind(fullWebGLFailureEffect);
let canvasFallbackCount = 0;

fullWebGLFailureEffect.webglBloomRenderer =
{
  available: true,
  sceneEnabled: true,
  clear()
  {
  },
  destroy()
  {
  },
};
fullWebGLFailureEffect._ensureWebGLBloomRenderer = () => true;
fullWebGLFailureEffect._resizeWebGLBloomRenderer = () => true;
fullWebGLFailureEffect._renderWebGL2Effects = () => false;
fullWebGLFailureEffect._renderCanvasEffects = (...args) =>
{
  canvasFallbackCount++;
  renderCanvasEffects(...args);
};
fullWebGLFailureEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
assert(
  fullWebGLFailureEffect.getConfig().resolvedEffectBackend === 'canvas2d' &&
    canvasFallbackCount === 1,
  '完整 WebGL2 提交失败时在同一 RAF 内回退 Canvas2D 绘制可见特效',
);
fullWebGLFailureEffect.destroy();

const externalFullWebGLCanvas = new CanvasMock();
const mountedCanvasCountBeforeExternalFullWebGL =
  dom.appendedCanvases.length;
const externalFullWebGLEffect = new BAClickFX(
  {
    target: externalFullWebGLCanvas,
    effectBackend: 'webgl2',
  },
);
const canvasCountBeforeExternalFullWebGLFrame =
  dom.createdCanvases.length;

assert(
  externalFullWebGLEffect.getConfig().resolvedEffectBackend === 'canvas2d' &&
    externalFullWebGLEffect.webglBloomCanvas === null &&
    dom.appendedCanvases.length === mountedCanvasCountBeforeExternalFullWebGL,
  '外部 Canvas 请求完整 WebGL2 时同步回退 Canvas2D 且不挂载叠加层',
);
externalFullWebGLEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
assert(
  externalFullWebGLEffect.webglBloomCanvas === null &&
    dom.createdCanvases.length === canvasCountBeforeExternalFullWebGLFrame,
  '外部 Canvas 的完整 WebGL2 回退帧不会延迟创建 GPU 画布',
);
externalFullWebGLEffect.destroy();
assert(
  !externalFullWebGLCanvas.removed,
  '销毁完整 WebGL2 回退实例不会移除调用方提供的 Canvas',
);

const idleFullWebGLEffect = new BAClickFX(
  {
    effectBackend: 'webgl2',
  },
);
let idleFullWebGLClearCount = 0;

idleFullWebGLEffect.webglBloomRenderer =
{
  available: true,
  sceneEnabled: true,
  clear()
  {
    idleFullWebGLClearCount++;
  },
  destroy()
  {
  },
};
idleFullWebGLEffect._ensureWebGLBloomRenderer = () => true;
idleFullWebGLEffect._resizeWebGLBloomRenderer = () => true;
flushFrames(dom, performance.now(), 1);
assert(
  idleFullWebGLEffect.getConfig().resolvedEffectBackend === 'webgl2' &&
    idleFullWebGLClearCount === 1 &&
    dom.frames.size === 0 &&
    idleFullWebGLEffect.animationFrame === null,
  '完整 WebGL2 完成空闲能力探测后停止 RAF，等待下一次可见输入唤醒',
);
idleFullWebGLEffect.destroy();

const softwareFailureEffect = new BAClickFX({ bloomBackend: 'software' });
const softwareFailureEvents = [];

flushFrames(dom, performance.now(), 1);
softwareFailureEffect.canvas.addEventListener(
  BLOOM_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    softwareFailureEvents.push(event.detail.resolvedBloomBackend);
  },
);
softwareFailureEffect.bloomRenderer.beginFrame = () =>
{
  softwareFailureEffect.bloomRenderer.available = false;
  return null;
};
softwareFailureEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
assert(
  softwareFailureEffect.getConfig().resolvedBloomBackend === 'native' &&
    softwareFailureEvents.join(',') === 'native',
  'Software Bloom 运行时回读失败会立即公开 Native 回退并派发事件',
);
softwareFailureEffect.destroy();

console.log('\nSoftware Bloom 全视口工作区');
const regionEffect = new BAClickFX({ bloomBackend: 'software' });

regionEffect.boom(160, 540);
regionEffect.boom(1760, 540);
let regionNow = flushFrames(dom, performance.now(), 1);
const regionStats = regionEffect.softwareBloomFrameStats;
const initialRegion = regionEffect._getSoftwareBloomRegions(1)[0];
const rendererPool = [...regionEffect.bloomRenderers];
const canvasCountAfterPoolGrowth = dom.createdCanvases.length;

assert(
  regionStats.regionCount === 1 &&
    regionEffect.bloomRenderers.length === 1 &&
    initialRegion.x === 0 &&
    initialRegion.y === 0 &&
    initialRegion.width === regionEffect.width &&
    initialRegion.height === regionEffect.height,
  '软件 Bloom 使用单个全视口金字塔，不再按特效拆分局部工作区',
);
assert(
  initialRegion.emissionBounds.width < initialRegion.width &&
    initialRegion.emissionBounds.height < initialRegion.height,
  '全视口金字塔仍只回读实际发射几何覆盖的子区域',
);
assert(
  regionStats.processedSourcePixels === regionStats.combinedBoundsPixels,
  '软件 Bloom 的发射源与金字塔工作区完整覆盖当前视口',
);

regionNow = flushFrames(dom, regionNow, 1);
assert(
  regionEffect.bloomRenderers.every((renderer, index) =>
    renderer === rendererPool[index]) &&
    dom.createdCanvases.length === canvasCountAfterPoolGrowth,
  '全视口 Bloom renderer 跨帧复用，不重复创建工作 Canvas',
);

const reusableRenderer = regionEffect.bloomRenderer;

reusableRenderer.beginFrame(
  regionEffect.width,
  regionEffect.height,
  UNITY_FX_TOUCH.bloom.resolutionScale,
  { x: 0, y: 0, width: 720, height: 720 },
  UNITY_FX_TOUCH.bloom.diffusion,
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
    UNITY_FX_TOUCH.bloom.diffusion,
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
  UNITY_FX_TOUCH.bloom.diffusion,
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
  '邻近特效继续共享同一全视口金字塔并保留能量交互',
);

regionEffect.destroy();
assert(
  rendererPool.every((renderer) =>
    renderer.sourceCanvas.width === 0 && renderer.outputCanvas.width === 0),
  '销毁实例时同时释放 renderer 池的所有工作缓冲',
);

console.log('\n低帧率生命周期');
const stalledEffect = new BAClickFX({ bloomBackend: 'software' });

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
const legacyEffect = new BAClickFX(
  {
    renderingMode: 'legacy',
    bloomBackend: 'software',
  },
);

assert(
  legacyEffect.getConfig().resolvedBloomBackend === 'legacy',
  'Legacy 构造完成后无需等待 RAF 即公开实际渲染模式',
);
const legacyUnityConfig = legacyEffect.getFxConfig();

assert(
  legacyUnityConfig.rings.hdrIntensity ===
      UNITY_FX_TOUCH.rings.hdrIntensity &&
    legacyUnityConfig.rings.bandToOuterRadius ===
      UNITY_FX_TOUCH.rings.bandToOuterRadius &&
    legacyUnityConfig.rings.textureAlphaKeys.length ===
      UNITY_FX_TOUCH.rings.textureAlphaKeys.length &&
    legacyUnityConfig.trail.width === UNITY_FX_TOUCH.trail.width &&
    legacyUnityConfig.trail.lifetimeMs === UNITY_FX_TOUCH.trail.lifetimeMs &&
    legacyUnityConfig.trail.textureLongitudinalKeys.length ===
      UNITY_FX_TOUCH.trail.textureLongitudinalKeys.length,
  'Legacy 保留 Unity 圆环、HDR、拖尾尺寸与 Stretch 纹理参数',
);
legacyEffect.boom(960, 540);
legacyEffect.context.filledPaths = [];
legacyEffect.context.conicGradients = [];
let legacyNow = flushFrames(dom, performance.now(), 1);
const legacyTrianglePaths = legacyEffect.context.filledPaths.filter((path) =>
  path.length === 3);

assert(
  legacyEffect.context.conicGradients.length ===
      UNITY_FX_TOUCH.rings.count * UNITY_FX_TOUCH.rings.radialSamples &&
    legacyEffect.context.conicGradients.some(({ gradient }) =>
      gradient.stops.some(([, color]) => getCssAlpha(color) > 0)),
  'Legacy 点击首帧使用解包圆环纹理与硬裁剪采样',
);
assert(
  legacyTrianglePaths.length === UNITY_FX_TOUCH.shards.clickCount,
  'Legacy 点击后的第一帧同时绘制三角碎片',
);
assert(
  legacyEffect.context.fillShadowBlurs.some((blur, index) =>
    blur > 0 && getCssAlpha(legacyEffect.context.fillShadowColors[index]) > 0),
  'Legacy 使用资源几何时仍启用原生点击与碎片辉光',
);

legacyEffect.clear();
legacyEffect.pointerDown({ x: 100, y: 100, pointerId: 91 });
legacyEffect.pointerMove({ x: 170, y: 100, pointerId: 91 });
legacyEffect.pointerMove({ x: 170, y: 170, pointerId: 91 });
legacyEffect.currentTrailStroke.points =
[
  { x: 100, y: 100, bornAt: legacyEffect.trailTimeMs },
  { x: 170, y: 100, bornAt: legacyEffect.trailTimeMs },
  { x: 170, y: 170, bornAt: legacyEffect.trailTimeMs },
];
legacyEffect.waves.length = 0;
legacyEffect.shards.length = 0;
legacyEffect.context.linearGradients = [];
legacyEffect.context.drawImageCalls = [];
legacyEffect.context.filledPaths = [];
legacyEffect.nativeTrailBloomSurface.context.filledPaths = [];
legacyNow = flushFrames(dom, legacyNow, 1);
const legacyTrailGradients = legacyEffect.context.linearGradients;
const legacyTrailQuads = legacyEffect.context.filledPaths.filter((path) =>
  path.length === 4);
const legacyTrailTriangles = legacyEffect.context.filledPaths.filter((path) =>
  path.length === 3);
const legacyTrailSegmentCount =
  legacyEffect.currentTrailStroke.points.length - 1;
const legacyTrailJoinCount =
  legacyEffect.currentTrailStroke.points.length - 2;
const legacyTrailFanTriangleCount = legacyTrailJoinCount *
  (UNITY_FX_TOUCH.trail.numCornerVertices + 1);
const legacyTrailFan = legacyTrailTriangles.slice(
  0,
  legacyTrailFanTriangleCount,
);
const legacyTrailCaps = legacyTrailTriangles.slice(
  legacyTrailFanTriangleCount,
);
const legacySegmentGradients = legacyTrailGradients.filter(
  ({ gradient }) => gradient.stops.length === 2,
);
const legacyCrossSectionGradients = legacyTrailGradients.filter(
  ({ gradient }) => gradient.stops.length === transverseStopCount,
);

function restoreCanvasTrailOutlines(quads, segmentCount)
{
  return Array.from({ length: segmentCount }, (_, index) =>
  {
    const bands = quads.slice(
      index * canvasTrailBandCount,
      (index + 1) * canvasTrailBandCount,
    );

    return [
      bands[0][0],
      bands[0][1],
      bands.at(-1)[2],
      bands.at(-1)[3],
    ];
  });
}

const legacyTrailOutlines = restoreCanvasTrailOutlines(
  legacyTrailQuads,
  legacyTrailSegmentCount,
);
let legacyTrailEndpointsContinuous = true;

for (let index = 1; index < legacyTrailSegmentCount; index++)
{
  for (let band = 0; band < canvasTrailBandCount; band++)
  {
    const previousGradient = legacySegmentGradients[
      (index - 1) * canvasTrailBandCount + band
    ].gradient;
    const nextGradient = legacySegmentGradients[
      index * canvasTrailBandCount + band
    ].gradient;

    legacyTrailEndpointsContinuous &&=
      previousGradient.stops[1][1] === nextGradient.stops[0][1];
  }
}

assert(
  legacySegmentGradients.length ===
      legacyTrailSegmentCount * canvasTrailBandCount &&
    legacyCrossSectionGradients.length === legacyTrailJoinCount + 2 &&
    legacyTrailEndpointsContinuous &&
    legacyCrossSectionGradients.at(-2).gradient.stops.every(
      ([, color]) => color === 'rgba(0, 0, 0, 0)',
    ) &&
    legacyCrossSectionGradients.at(-1).gradient.stops.some(
      ([, color]) => getCssPremultipliedEnergy(color) > 0,
    ),
  'Legacy 逐窄带连续插值，join/cap 复用精确折点与首尾端点能量',
);
const legacyInnerCorner = legacyTrailOutlines[0][1];
const legacyTurnPoint = legacyEffect.currentTrailStroke.points[1];
const legacyOuterArc =
[
  legacyTrailFan[0][1],
  ...legacyTrailFan.map((triangle) => triangle[2]),
];
const legacyOuterRadius = Math.hypot(
  legacyOuterArc[0][0] - legacyTurnPoint.x,
  legacyOuterArc[0][1] - legacyTurnPoint.y,
);

assert(
  legacyTrailQuads.length ===
      legacyTrailSegmentCount * canvasTrailBandCount &&
    JSON.stringify(legacyInnerCorner) ===
      JSON.stringify(legacyTrailOutlines[1][0]) &&
    legacyTrailFan.length ===
      UNITY_FX_TOUCH.trail.numCornerVertices + 1 &&
    legacyTrailFan.every((triangle) =>
      JSON.stringify(triangle[0]) === JSON.stringify(legacyInnerCorner)) &&
    JSON.stringify(legacyTrailFan[0][1]) ===
      JSON.stringify(legacyTrailOutlines[0][2]) &&
    JSON.stringify(legacyTrailFan.at(-1)[2]) ===
      JSON.stringify(legacyTrailOutlines[1][3]),
  '90 度折点共享内角交点，并用 4 个插入点生成 5 个外角 fan 三角',
);
assert(
  legacyOuterArc.length === UNITY_FX_TOUCH.trail.numCornerVertices + 2 &&
    legacyOuterArc.every(([x, y]) =>
      Math.abs(
        Math.hypot(x - legacyTurnPoint.x, y - legacyTurnPoint.y) -
          legacyOuterRadius,
      ) < 0.000001) &&
    legacyTrailCaps.length === 2,
  '外角圆弧保持半带宽半径，numCapVertices=1 生成两个三角端帽',
);
assert(
  JSON.stringify(
    legacyEffect.nativeTrailBloomSurface.context.filledPaths,
  ) === JSON.stringify(legacyEffect.context.filledPaths),
  'Legacy 清晰层与 Native 离屏辉光严格复用同一拖尾网格',
);

function renderLegacyGeometryProbe(points)
{
  legacyEffect.currentTrailStroke.points = points.map((point) =>
  {
    return {
      ...point,
      bornAt: legacyEffect.trailTimeMs,
    };
  });
  legacyEffect.context.filledPaths = [];
  legacyEffect.context.drawImageCalls = [];
  legacyEffect.nativeTrailBloomSurface.context.filledPaths = [];
  legacyEffect._requestRender();
  legacyNow = flushFrames(dom, legacyNow, 1);

  const quads = legacyEffect.context.filledPaths.filter((path) =>
    path.length === 4);

  return {
    quads,
    outlines: restoreCanvasTrailOutlines(quads, points.length - 1),
    triangles: legacyEffect.context.filledPaths.filter((path) =>
      path.length === 3),
  };
}

const sharpLegacyGeometry = renderLegacyGeometryProbe(
  [
    { x: 100, y: 100 },
    { x: 170, y: 100 },
    { x: 130, y: 140 },
  ],
);
const sharpLegacyFan = sharpLegacyGeometry.triangles.slice(
  0,
  UNITY_FX_TOUCH.trail.numCornerVertices + 1,
);
const sharpLegacyTurn = { x: 170, y: 100 };
const sharpLegacyHalfWidth = Math.hypot(
  sharpLegacyFan[0][1][0] - sharpLegacyTurn.x,
  sharpLegacyFan[0][1][1] - sharpLegacyTurn.y,
);
const sharpLegacyInnerDistance = Math.hypot(
  sharpLegacyFan[0][0][0] - sharpLegacyTurn.x,
  sharpLegacyFan[0][0][1] - sharpLegacyTurn.y,
);

assert(
  sharpLegacyGeometry.quads.length === 2 * canvasTrailBandCount &&
    sharpLegacyGeometry.triangles.length ===
      UNITY_FX_TOUCH.trail.numCornerVertices + 3 &&
    sharpLegacyFan.flat(2).every(Number.isFinite) &&
    sharpLegacyInnerDistance > sharpLegacyHalfWidth &&
    sharpLegacyInnerDistance <= sharpLegacyHalfWidth * 4,
  '锐角拖尾保留有限内角交点与完整圆角 fan',
);

const foldedLegacyGeometry = renderLegacyGeometryProbe(
  [
    { x: 100, y: 100 },
    { x: 170, y: 100 },
    { x: 100, y: 101 },
  ],
);
const foldedLegacyTurn = { x: 170, y: 100 };
const foldedJointVertices =
[
  foldedLegacyGeometry.outlines[0][1],
  foldedLegacyGeometry.outlines[0][2],
  foldedLegacyGeometry.outlines[1][0],
  foldedLegacyGeometry.outlines[1][3],
];
const foldedLegacyHalfWidth = Math.hypot(
  foldedJointVertices[0][0] - foldedLegacyTurn.x,
  foldedJointVertices[0][1] - foldedLegacyTurn.y,
);

assert(
  foldedLegacyGeometry.quads.length === 2 * canvasTrailBandCount &&
    foldedLegacyGeometry.triangles.length === 2 &&
    foldedLegacyGeometry.quads.flat(2).every(Number.isFinite) &&
    foldedJointVertices.every(([x, y]) =>
      Math.abs(
        Math.hypot(x - foldedLegacyTurn.x, y - foldedLegacyTurn.y) -
          foldedLegacyHalfWidth,
      ) < 0.000001),
  '近 180 度回折退化为稳定独立截面，不生成无限 miter 或超大 Bounds',
);
assert(
  legacyEffect.context.drawImageCalls.some((call) => call.filter !== 'none'),
  'Legacy 拖尾通过一次局部缓冲模糊生成原生辉光',
);
legacyEffect.pointerCancel(91);

legacyNow = flushFrames(dom, legacyNow, 50);
assert(
  dom.appendedCanvases.includes(legacyEffect.contrastCanvas) &&
    legacyEffect.contrastCanvas.style.display === 'none',
  'Legacy 初始实例预挂载并隐藏对比层，便于运行时安全切回增强模式',
);
legacyEffect.updateConfig({ renderingMode: 'enhanced' });
assert(
  legacyEffect.canvas.style.mixBlendMode === 'plus-lighter' &&
    legacyEffect.contrastCanvas.style.display === '' &&
    legacyEffect.getConfig().resolvedBloomBackend === 'software',
  'Legacy 实例运行时切回增强模式会恢复加色层与对比层',
);
legacyEffect.updateConfig({ renderingMode: 'legacy' });
assert(
  legacyEffect.canvas.style.mixBlendMode === '' &&
    legacyEffect.canvas.style.zIndex === '2147483647' &&
    legacyEffect.contrastCanvas.style.display === 'none' &&
    legacyEffect.getConfig().resolvedBloomBackend === 'legacy',
  '切回 Legacy 时会隐藏增强模式对比层，避免残留轮廓',
);
legacyEffect.destroy();
assert(legacyEffect.destroyed, 'Legacy 实例可正常结束完整生命周期并销毁');

console.log(`\n✅ ${passed} 项 FX_Touch 移植检查通过\n`);
