/**
 * FX_Touch 移植烟雾测试。
 *
 * 测试只锁定从 Unity 恢复出的行为参数和生命周期；不再维护旧调参 API。
 */

const module = await import('../dist/ba-click-fx.js');

const {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  CONFIG,
  DEFAULT_THEME_COLOR,
  EFFECT_BACKEND_CHANGE_EVENT,
  HOST_COMPOSITING_CHANGE_EVENT,
  UNITY_FX_TOUCH,
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

function assertThrowsTypeError(factory, message)
{
  let thrown = null;

  try
  {
    factory();
  }
  catch (error)
  {
    thrown = error;
  }

  assert(thrown instanceof TypeError, message);
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

const transverseProfileKeys =
  UNITY_FX_TOUCH.trail.textureTransverseProfileKeys;
const transverseStopCount = transverseProfileKeys[2][1].length * 2 - 1;
const joinedTrailPathLength =
  UNITY_FX_TOUCH.trail.numCornerVertices + 5;

class EventTargetMock
{
  constructor()
  {
    this.listeners = new Map();
    this.listenerOptions = new Map();
  }

  addEventListener(type, listener, options = false)
  {
    if (!this.listeners.has(type))
    {
      this.listeners.set(type, new Set());
      this.listenerOptions.set(type, new Map());
    }

    this.listeners.get(type).add(listener);
    this.listenerOptions.get(type).set(listener, options);
  }

  removeEventListener(type, listener)
  {
    this.listeners.get(type)?.delete(listener);
    this.listenerOptions.get(type)?.delete(listener);
  }

  getEventListenerOptions(type, listener)
  {
    return this.listenerOptions.get(type)?.get(listener);
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
    this.strokeWidths = [];
    this.strokeStyles = [];
    this.strokeLineCaps = [];
    this.lineJoinWrites = [];
    this.strokeShadowBlurs = [];
    this.strokeFilters = [];
    this.strokedPaths = [];
    this.fillShadowBlurs = [];
    this.fillShadowColors = [];
    this.fillCompositeOperations = [];
    this.fillOrders = [];
    this.radialGradients = [];
    this.linearGradients = [];
    this.conicGradients = [];
    this.fillRects = [];
    this.drawImageCalls = [];
    this.putImageDataCount = 0;
    this.putImageDataCalls = [];
    this.getImageDataCalls = [];
    this.clearRectCalls = [];
    this.hasVisiblePixels = false;
    this.globalCompositeOperation = 'source-over';
    this.globalAlpha = 1;
    this.shadowBlur = 0;
    this.shadowColor = 'transparent';
    this.filter = 'none';
    this.imageSmoothingEnabled = true;
    this.stateStack = [];
    this.currentTransform = [1, 0, 0, 1, 0, 0];
    this.currentRotation = 0;
    this.drawSequence = 0;
    this._lineJoin = 'miter';
  }

  set lineJoin(value)
  {
    this._lineJoin = value;
    this.lineJoinWrites.push(value);
  }

  get lineJoin()
  {
    return this._lineJoin;
  }

  setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0)
  {
    this.currentTransform = [a, b, c, d, e, f];
    this.currentRotation = Math.atan2(b, a);
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
        globalAlpha: this.globalAlpha,
        shadowBlur: this.shadowBlur,
        shadowColor: this.shadowColor,
        filter: this.filter,
        imageSmoothingEnabled: this.imageSmoothingEnabled,
        lineJoin: this._lineJoin,
        transform: [...this.currentTransform],
        rotation: this.currentRotation,
      },
    );
  }

  restore()
  {
    const state = this.stateStack.pop();

    if (state)
    {
      this.globalCompositeOperation = state.globalCompositeOperation;
      this.globalAlpha = state.globalAlpha;
      this.shadowBlur = state.shadowBlur;
      this.shadowColor = state.shadowColor;
      this.filter = state.filter;
      this.imageSmoothingEnabled = state.imageSmoothingEnabled;
      this._lineJoin = state.lineJoin;
      this.currentTransform = state.transform;
      this.currentRotation = state.rotation;
    }
  }

  translate(x, y)
  {
    const [a, b, c, d, e, f] = this.currentTransform;

    this.currentTransform = [
      a,
      b,
      c,
      d,
      a * x + c * y + e,
      b * x + d * y + f,
    ];
  }

  scale(x, y)
  {
    const [a, b, c, d, e, f] = this.currentTransform;

    this.currentTransform = [
      a * x,
      b * x,
      c * y,
      d * y,
      e,
      f,
    ];
  }

  rotate(angle)
  {
    const [a, b, c, d, e, f] = this.currentTransform;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    this.currentTransform = [
      a * cosine + c * sine,
      b * cosine + d * sine,
      c * cosine - a * sine,
      d * cosine - b * sine,
      e,
      f,
    ];
    this.currentRotation += angle;
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
    this.fillCompositeOperations.push(this.globalCompositeOperation);
    this.fillOrders.push(++this.drawSequence);
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
    this.putImageDataCalls.push({ imageData, args });
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
        shadowBlur: this.shadowBlur,
        shadowColor: this.shadowColor,
        imageSmoothingEnabled: this.imageSmoothingEnabled,
        globalAlpha: this.globalAlpha,
        transform: [...this.currentTransform],
        rotation: this.currentRotation,
        order: ++this.drawSequence,
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

  contains(candidate)
  {
    if (candidate === this)
    {
      return true;
    }

    return this.children.some((child) =>
      typeof child.contains === 'function'
        ? child.contains(candidate)
        : child === candidate,
    );
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
  constructor(onAppend = null, bounds = null)
  {
    super('canvas', onAppend);
    this.width = 0;
    this.height = 0;
    this.context = new ContextMock(this);
    this.bounds = bounds ?? {
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    };
  }

  getContext(type)
  {
    return type === '2d' ? this.context : null;
  }

  getBoundingClientRect()
  {
    return { ...this.bounds };
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
  const canvasBounds = {
    left: 0,
    top: 0,
    width: 1920,
    height: 1080,
  };
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
        const canvas = new CanvasMock(recordAppend, canvasBounds);

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
    setCanvasBounds(bounds)
    {
      Object.assign(canvasBounds, bounds);
    },
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

console.log('\n指针生命周期');
const dom = installDom();


console.log('\n全屏坐标尺寸');
const fullscreenTestDevicePixelRatio = dom.windowMock.devicePixelRatio;

dom.windowMock.devicePixelRatio = 1.5;
dom.setCanvasBounds({ width: 1910, height: 1080 });
const scrollbarGutterEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
  },
);

assert(
  dom.windowMock.innerWidth === 1920 &&
    scrollbarGutterEffect.width === 1910 &&
    scrollbarGutterEffect.height === 1080 &&
    scrollbarGutterEffect.canvas.width === 1910 * CONFIG.maxDpr &&
    scrollbarGutterEffect.canvas.height === 1080 * CONFIG.maxDpr,
  '全屏覆盖层按实测 CSS 尺寸排除滚动条槽',
);
dom.setCanvasBounds({ width: 1600, height: 900 });
scrollbarGutterEffect._onResize({ type: 'resize' });
assert(
  scrollbarGutterEffect.width === 1600 &&
    scrollbarGutterEffect.height === 900 &&
    Number.isFinite(scrollbarGutterEffect.canvas.width) &&
    Number.isFinite(scrollbarGutterEffect.canvas.height),
  '浏览器 resize 事件参数不会污染公开尺寸覆盖值',
);
scrollbarGutterEffect.resize(800, 600, 0.5);
assert(
  scrollbarGutterEffect.width === 800 &&
    scrollbarGutterEffect.height === 600 &&
    scrollbarGutterEffect.dpr === 0.5 &&
    scrollbarGutterEffect.canvas.width === 400 &&
    scrollbarGutterEffect.canvas.height === 300,
  '公开 resize 接受有效 CSS 尺寸与 DPR',
);
scrollbarGutterEffect.resize(Number.NaN, -1, 0);
assert(
  scrollbarGutterEffect.width === 1600 &&
    scrollbarGutterEffect.height === 900 &&
    scrollbarGutterEffect.dpr === CONFIG.maxDpr,
  '公开 resize 对非法尺寸与 DPR 回退到实测环境值',
);
scrollbarGutterEffect.destroy();

dom.setCanvasBounds({ width: 0, height: 0 });
const hiddenFullscreenEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
  },
);

assert(
  hiddenFullscreenEffect.width === 1920 &&
    hiddenFullscreenEffect.height === 1080 &&
    hiddenFullscreenEffect.canvas.width === 1920 * CONFIG.maxDpr &&
    hiddenFullscreenEffect.canvas.height === 1080 * CONFIG.maxDpr,
  '全屏覆盖层不可测时回退窗口尺寸',
);
hiddenFullscreenEffect.destroy();
dom.setCanvasBounds({ width: 1920, height: 1080 });
dom.windowMock.devicePixelRatio = fullscreenTestDevicePixelRatio;

const defaultBackendEffect = new BAClickFX();

assert(
  defaultBackendEffect.getConfig().effectBackend === 'webgl2' &&
    defaultBackendEffect.getConfig().resolvedEffectBackend === 'pending' &&
    defaultBackendEffect.getConfig().bloomBackend === 'webgl2' &&
    defaultBackendEffect.getConfig().themeColor === DEFAULT_THEME_COLOR,
  '默认实例在延迟能力探测前请求纯 WebGL2 并公开 pending',
);
defaultBackendEffect.destroy();

const effect = new BAClickFX(
  {
    // 该实例同时覆盖网页白底兼容层的显式启用和运行时切换。
    effectBackend: 'canvas2d',
    bloomBackend: 'software',
    isolatedCompositing: true,
    lightBackgroundContrastAlpha: 0.35,
  },
);
assert(
  effect.getConfig().effectBackend === 'canvas2d' &&
  effect.getConfig().bloomBackend === 'software' &&
    effect.getConfig().resolvedBloomBackend === 'software',
  'Canvas2D 实例只在显式请求时直接启用 Software Bloom',
);
const originalBloomBeginFrame = effect.bloomRenderer.beginFrame.bind(
  effect.bloomRenderer,
);
let lastBloomBeginFrameArgs = null;

effect.bloomRenderer.beginFrame = (...args) =>
{
  lastBloomBeginFrameArgs = args;
  return originalBloomBeginFrame(...args);
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
  effect.canvas.style.mixBlendMode === '',
  '自有叠加 Canvas 使用预乘 source-over，避免 CSS 再次抬高桌面亮度',
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
effect.context.filledStyles = [];
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
// 圆环最初约 16ms 仍可能被溶解阈值完整裁剪；固定到 50ms 后验证发射路径。
now = flushFrames(dom, now, 1, 50);
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
  effect.bloomRenderer.coverageCanvas === null,
  'Scene 输出不分配透明 Coverage 画布，保持原软件 Bloom 资源路径',
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
const triangleTextureDraws = effect.context.drawImageCalls.filter((call) =>
  call.args.length === 5 &&
    call.args[1] < 0 &&
    call.args[2] < 0 &&
    call.args[3] > 0 &&
    call.args[3] === call.args[4]);

assert(triangleTextureDraws.length > 0, '运行帧实际绘制了图集碎片');
assert(
  triangleTextureDraws.every((call) =>
    call.shadowBlur === 0 && call.shadowColor === 'transparent'),
  '三角形碎片在主 Canvas 也不设置阴影',
);
const nativeShadowStart = effect.context.fillShadowBlurs.length;
const nativeRadialStart = effect.context.radialGradients.length;
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

effect.updateConfig(
  {
    bloomBackend: 'native',
    outputCompositing: 'browser-overlay',
  },
);
now = flushFrames(dom, now, 1);
assert(
  effect.context.drawImageCalls.filter((call) =>
    call.args[0] === effect.bloomRenderer.outputCanvas).length ===
      softwareBloomDrawCount,
  '关闭软件 Bloom 后不再绘制 ImageData 辉光层',
);
assert(
  effect.contrastContext.drawImageCalls
    .slice(nativeContrastCopyStart)
    .every((call) => call.args[0] !== effect.canvas),
  '原生辉光模式不复制带光晕的主 Canvas，继续用独立图集绘制对比遮罩',
);
assert(
  effect.context.fillShadowBlurs
    .slice(nativeShadowStart)
    .every((blur) => blur === 0) &&
    effect.context.radialGradients.length > nativeRadialStart,
  '原生点击光晕独立绘制，清晰圆环与光盘不再重复叠加阴影',
);
assert(
  effect.context.strokeShadowBlurs
    .slice(nativeStrokeStart)
    .every((blur) => !blur),
  '原生回退不在拖尾分段接缝叠加 shadowBlur',
);
const nativeBloomSurface = effect.nativeTrailBloomSurface;
const nativeGlowGradients = nativeBloomSurface.context.linearGradients;
const nativeTrailSegmentCount = effect.trailStrokes[0].points.length - 1;
const nativeSkippedSegmentCount = 1;
const clearTrailDrawCount = nativeTrailSegmentCount + 2;
const nativeVisibleSegmentCount =
  nativeTrailSegmentCount - nativeSkippedSegmentCount;
const nativeTrailDrawCount = nativeVisibleSegmentCount + 1;
const nativeSegmentGradients = nativeGlowGradients.slice(
  0,
  nativeVisibleSegmentCount,
);
const nativeBlurDraws = effect.context.drawImageCalls
  .slice(nativeDrawImageStart)
  .filter((call) => call.filter !== 'none');
const nativeTrailPaths = nativeBloomSurface.context.filledPaths;
const clearTrailPaths = effect.context.filledPaths
  .slice(nativePathStart)
  .slice(0, clearTrailDrawCount);
const clearTrailGradients = effect.context.linearGradients.slice(
  nativeLinearGradientStart,
  nativeLinearGradientStart + clearTrailDrawCount,
);

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
      clearTrailDrawCount &&
    nativeGlowGradients.length === nativeTrailDrawCount &&
    nativeTrailPaths.length === nativeTrailDrawCount &&
    nativeGlowGradients.every(({ gradient }) =>
      gradient.stops.length === transverseStopCount),
  '原生回退跳过严格透明尾段，剩余 segment 和 end cap 各提交一次',
);
const clearTailPeak = clearTrailGradients[0].gradient.stops.reduce(
  (maximum, [, color]) => Math.max(maximum, getCssPremultipliedEnergy(color)),
  0,
);
const firstNativePeak = nativeSegmentGradients[0].gradient.stops.reduce(
  (maximum, [, color]) => Math.max(maximum, getCssPremultipliedEnergy(color)),
  0,
);
const secondNativePeak = nativeSegmentGradients[1].gradient.stops.reduce(
  (maximum, [, color]) => Math.max(maximum, getCssPremultipliedEnergy(color)),
  0,
);
const nativeHeadPeak = nativeSegmentGradients.at(-1).gradient.stops.reduce(
  (maximum, [, color]) => Math.max(maximum, getCssPremultipliedEnergy(color)),
  0,
);

assert(
  clearTailPeak === 0 &&
    firstNativePeak === 0 &&
    secondNativePeak > 0 &&
    nativeHeadPeak > 20,
  '回环轨迹裁剪严格零尾段，并由 MXFinalBloom 阈值过滤首个低能段',
);
const nativeCoveragePeaks = nativeSegmentGradients.map(({ gradient }) =>
  Math.max(...gradient.stops.map(([, color]) => getCssAlpha(color))));
const nativeHasSmoothTextureCoverage = nativeSegmentGradients.some(
  ({ gradient }) => new Set(
    gradient.stops
      .map(([, color]) => getCssAlpha(color))
      .filter((alpha) => alpha > 0),
  ).size > 1,
);

assert(
  nativeHasSmoothTextureCoverage &&
    nativeCoveragePeaks.every((alpha) =>
      alpha >= 0 && alpha <= effect.config.opacity) &&
    nativeCoveragePeaks.every((alpha, index) =>
      index === 0 || alpha + 0.000001 >= nativeCoveragePeaks[index - 1]) &&
    nativeCoveragePeaks[0] <= nativeCoveragePeaks.at(-1) * 0.1 &&
    nativeCoveragePeaks.at(-1) >= effect.config.opacity * 0.9,
  'Native 拖尾使用独立二维蒙版和单调纵向 Coverage，不读取 Bloom 强度',
);
const expectedNativeTrailPaths = [
  ...clearTrailPaths.slice(
    nativeSkippedSegmentCount,
    nativeTrailSegmentCount,
  ),
  clearTrailPaths.at(-1),
];

assert(
  JSON.stringify(expectedNativeTrailPaths) ===
    JSON.stringify(nativeTrailPaths),
  'Native 可见段与 end cap 继续复用清晰层的同一拖尾网格',
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
  effect.destroyed &&
    effect.canvas.removed &&
    effect.contrastCanvas.removed &&
    dom.body.children.length === 0,
  'destroy() 移除监听、隔离合成根与自有 Canvas',
);

console.log('\n透明覆盖层 Canvas 合同');

function captureTransparentSoftwareFrame(opacity, options = {})
{
  const transparentEffect = new BAClickFX(
    {
      effectBackend: 'canvas2d',
      bloomBackend: 'software',
      outputCompositing: 'browser-overlay',
      inputSource: 'manual',
      opacity,
      lightBackgroundContrastAlpha: 0.35,
      ...options,
    },
  );
  const renderer = transparentEffect.bloomRenderer;
  const originalBeginCoverageFrame = renderer.beginCoverageFrame.bind(
    renderer,
  );
  const originalComposite = renderer.composite.bind(renderer);
  const coverageModes = [];
  let compositeSettings = null;

  renderer.beginCoverageFrame = (outputCompositing) =>
  {
    coverageModes.push(outputCompositing);
    return originalBeginCoverageFrame(outputCompositing);
  };
  renderer.composite = (context, settings) =>
  {
    compositeSettings = settings;
    return originalComposite(context, settings);
  };

  transparentEffect.pointerDown({ x: 400, y: 300, pointerId: 71 });
  transparentEffect.pointerMove({ x: 560, y: 300, pointerId: 71 });
  flushFrames(dom, performance.now(), 1, 50);

  const coverageContext = renderer.coverageContext;
  const diskCoverageDraw = coverageContext?.drawImageCalls.find((call) =>
    call.args[0]?.width === 512 && call.args[0]?.height === 512);
  const shardCoverageDraw = coverageContext?.drawImageCalls.find((call) =>
    call.args[0]?.width === 128 && call.args[0]?.height === 128);
  const bloomOutputDraw = transparentEffect.context.drawImageCalls.find(
    (call) => call.args[0] === renderer.outputCanvas,
  );
  const coverageDiskAlpha = diskCoverageDraw?.globalAlpha ?? 0;
  const trailCoverageAlpha = coverageContext?.linearGradients
    .flatMap(({ gradient }) => gradient.stops)
    .reduce(
      (maximum, [, color]) => Math.max(maximum, getCssAlpha(color)),
      0,
    ) ?? 0;
  const clearPayloadPeak = transparentEffect.context.linearGradients
    .flatMap(({ gradient }) => gradient.stops)
    .reduce(
      (maximum, [, color]) => Math.max(
        maximum,
        getCssPremultipliedEnergy(color),
      ),
      0,
    );

  renderer.coverageContext.drawImageCalls = [];
  renderer.coverageContext.linearGradients = [];
  transparentEffect.setFxParam('bloom.clickEmissionScale', 2);
  transparentEffect.setFxParam('bloom.trailEmission', 2);
  transparentEffect._updateTrail(
    transparentEffect.trailTimeMs,
    transparentEffect._getScale(),
    false,
    false,
    false,
  );
  transparentEffect._renderSoftwareBloom(transparentEffect._getScale());
  const boostedDiskCoverage = renderer.coverageContext.drawImageCalls.find(
    (call) => call.args[0]?.width === 512 && call.args[0]?.height === 512,
  );
  const boostedTrailCoverageAlpha = renderer.coverageContext.linearGradients
    .flatMap(({ gradient }) => gradient.stops)
    .reduce(
      (maximum, [, color]) => Math.max(maximum, getCssAlpha(color)),
      0,
    );
  const result = {
    bloomOutputComposite: bloomOutputDraw?.compositeOperation,
    canvasOutputCompositing:
      transparentEffect._getCanvasOutputCompositing(),
    clearPayloadPeak,
    compositeSettings,
    coverageDiskAlpha,
    coverageModes,
    hasCircleCoverage: !!diskCoverageDraw,
    hasRingCoverage: (coverageContext?.conicGradients.length ?? 0) > 0,
    hasShardCoverage: !!shardCoverageDraw,
    hasTrailCoverage: (coverageContext?.linearGradients.length ?? 0) > 0,
    boostedDiskAlpha: boostedDiskCoverage?.globalAlpha ?? 0,
    boostedTrailCoverageAlpha,
    trailCoverageAlpha,
    mainCompositeOperations: [
      ...transparentEffect.context.fillCompositeOperations,
    ],
    diskCompositeOperations: transparentEffect.context.drawImageCalls
      .filter((call) =>
        call.args[0]?.width === 512 && call.args[0]?.height === 512)
      .map((call) => call.compositeOperation),
    contrastFillCount: transparentEffect.contrastContext.fillRects.length,
    canvasParentIsRoot:
      transparentEffect.canvas.parentElement === transparentEffect.overlayRoot,
    rootBlendMode: transparentEffect.overlayRoot.style.mixBlendMode,
  };

  transparentEffect.destroy();
  return result;
}

const zeroOverlayFrame = captureTransparentSoftwareFrame(0);
const halfOverlayFrame = captureTransparentSoftwareFrame(0.5);
const fullOverlayFrame = captureTransparentSoftwareFrame(1);
const brightOverlayFrame = captureTransparentSoftwareFrame(
  1,
  {
    overlayColorCompensation: 'bright-core',
    overlayAlphaLimit: 0.7,
  },
);
const limitedOverlayFrame = captureTransparentSoftwareFrame(
  1,
  { overlayAlphaLimit: 0.2 },
);
const additiveOverlayFrame = captureTransparentSoftwareFrame(
  1,
  {
    hostCompositing: 'plus-lighter',
    overlayAlphaLimit: 0.2,
  },
);
const screenOverlayFrame = captureTransparentSoftwareFrame(
  1,
  {
    hostCompositing: 'screen',
    overlayAlphaLimit: 0.2,
  },
);

assert(
  halfOverlayFrame.coverageModes.every((mode) =>
    mode === 'browser-overlay') &&
    halfOverlayFrame.compositeSettings?.outputCompositing ===
      'browser-overlay',
  'Software Bloom 将透明输出模式同时传给 Coverage 与最终合成',
);
assert(
  halfOverlayFrame.hasCircleCoverage &&
    halfOverlayFrame.hasRingCoverage &&
    halfOverlayFrame.hasShardCoverage &&
    halfOverlayFrame.hasTrailCoverage,
  'Software Coverage 重绘完整 Circle、Ring3、三角纹理与拖尾几何',
);
assert(
  zeroOverlayFrame.coverageDiskAlpha === 0 &&
    halfOverlayFrame.coverageDiskAlpha > 0 &&
    fullOverlayFrame.coverageDiskAlpha > halfOverlayFrame.coverageDiskAlpha &&
    Math.abs(
      halfOverlayFrame.coverageDiskAlpha /
        fullOverlayFrame.coverageDiskAlpha - 0.5,
    ) < 0.000001,
  '透明 Coverage 对 opacity=0/0.5/1 保持单调且线性',
);
assert(
  halfOverlayFrame.boostedDiskAlpha ===
      halfOverlayFrame.coverageDiskAlpha &&
    halfOverlayFrame.boostedTrailCoverageAlpha ===
      halfOverlayFrame.trailCoverageAlpha,
  '点击与拖尾 HDR 发射倍率不会改变独立 Coverage',
);
assert(
  halfOverlayFrame.bloomOutputComposite === 'lighter' &&
    halfOverlayFrame.mainCompositeOperations.every((operation) =>
      operation === 'source-over') &&
    halfOverlayFrame.diskCompositeOperations.includes('source-over'),
  '透明 Canvas 的 Bloom 使用 lighter 加色，Coverage 与主层仍使用 source-over',
);
assert(
  halfOverlayFrame.contrastFillCount === 0,
  '透明覆盖层保留 Contrast 配置但不绘制额外桌面遮挡',
);
assert(
  brightOverlayFrame.compositeSettings?.overlayColorCompensation ===
      'none' &&
    brightOverlayFrame.compositeSettings?.overlayAlphaLimit === 0.7 &&
    brightOverlayFrame.compositeSettings?.hostCompositing === 'source-over',
  'Software Bloom 延迟颜色补偿并接收 Alpha 上限与有效宿主合成设置',
);
assert(
  additiveOverlayFrame.compositeSettings?.hostCompositing ===
      'plus-lighter' &&
    additiveOverlayFrame.canvasOutputCompositing === 'host-additive' &&
    additiveOverlayFrame.rootBlendMode === 'plus-lighter' &&
    additiveOverlayFrame.canvasParentIsRoot &&
    additiveOverlayFrame.mainCompositeOperations.every((operation) =>
      operation === 'lighter') &&
    additiveOverlayFrame.clearPayloadPeak >
      limitedOverlayFrame.clearPayloadPeak,
  'plus-lighter 在单一合成根执行一次并输出不受 Alpha 上限压缩的载荷',
);
assert(
  screenOverlayFrame.compositeSettings?.hostCompositing === 'screen' &&
    screenOverlayFrame.canvasOutputCompositing === 'host-additive' &&
    screenOverlayFrame.rootBlendMode === 'screen' &&
    screenOverlayFrame.canvasParentIsRoot &&
    screenOverlayFrame.mainCompositeOperations.every((operation) =>
      operation === 'lighter') &&
    screenOverlayFrame.clearPayloadPeak ===
      additiveOverlayFrame.clearPayloadPeak,
  'screen 复用完整独立载荷并只在合成根改变亮底混合公式',
);

function captureHostAdditiveFallback()
{
  const fallbackEffect = new BAClickFX(
    {
      effectBackend: 'canvas2d',
      bloomBackend: 'native',
      outputCompositing: 'browser-overlay',
      hostCompositing: 'plus-lighter',
      overlayAlphaLimit: 0.2,
      inputSource: 'manual',
    },
  );

  fallbackEffect.pointerDown({ x: 400, y: 300, pointerId: 72 });
  fallbackEffect.pointerMove({ x: 560, y: 300, pointerId: 72 });
  flushFrames(dom, performance.now(), 1, 50);

  const payloadStyles = [
    ...fallbackEffect.context.filledStyles,
    ...fallbackEffect.context.strokeStyles,
    ...fallbackEffect.context.fillShadowColors,
    ...fallbackEffect.context.linearGradients.flatMap(
      ({ gradient }) => gradient.stops.map(([, color]) => color),
    ),
    ...fallbackEffect.context.conicGradients.flatMap(
      ({ gradient }) => gradient.stops.map(([, color]) => color),
    ),
  ].filter((value) => /^rgba\(/.test(String(value)));
  const result = {
    canvasOutputCompositing: fallbackEffect._getCanvasOutputCompositing(),
    payloadStyles,
    rootBlendMode: fallbackEffect.overlayRoot.style.mixBlendMode,
  };

  fallbackEffect.destroy();
  return result;
}

const nativeHostAdditiveFrame = captureHostAdditiveFallback();

assert(
  nativeHostAdditiveFrame.canvasOutputCompositing === 'host-additive' &&
    nativeHostAdditiveFrame.rootBlendMode === 'plus-lighter' &&
    nativeHostAdditiveFrame.payloadStyles.length > 0,
  'Native 回退生成 Canvas 宿主 Add 的 sRGB 载荷',
);

const compositingSwitchEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    outputCompositing: 'browser-overlay',
    hostCompositing: 'plus-lighter',
    isolatedCompositing: false,
    inputSource: 'manual',
  },
);
const hostCompositingEvents = [];

compositingSwitchEffect.canvas.addEventListener(
  HOST_COMPOSITING_CHANGE_EVENT,
  (event) =>
  {
    hostCompositingEvents.push(event.detail);
  },
);

assert(
  compositingSwitchEffect.overlayRoot.style.mixBlendMode ===
      'plus-lighter' &&
    compositingSwitchEffect.canvas.parentElement ===
      compositingSwitchEffect.overlayRoot &&
    compositingSwitchEffect.getEffectiveHostCompositing() ===
      'plus-lighter',
  '构造时宿主 Add 即挂载完整覆盖层组而不是单独混合内部 Canvas',
);

compositingSwitchEffect.lastSoftwareBloomFrame = { canvas: {} };
compositingSwitchEffect.updateConfig(
  {
    overlayColorCompensation: 'bright-core',
    overlayAlphaLimit: 0.7,
    hostCompositing: 'source-over',
  },
);
const switchedCompositingConfig = compositingSwitchEffect.getConfig();

assert(
  switchedCompositingConfig.overlayColorCompensation === 'bright-core' &&
    switchedCompositingConfig.overlayAlphaLimit === 0.7 &&
    switchedCompositingConfig.hostCompositing === 'source-over' &&
    switchedCompositingConfig.requestedHostCompositing === 'source-over' &&
    switchedCompositingConfig.resolvedHostCompositing === 'source-over' &&
    switchedCompositingConfig.compositingWarning === null &&
    compositingSwitchEffect.lastSoftwareBloomFrame === null &&
    compositingSwitchEffect.overlayRoot.style.mixBlendMode === '' &&
    compositingSwitchEffect.canvas.parentElement === dom.body,
  'updateConfig 原子切换透明合同、清除旧快照并刷新 DOM 合成挂载',
);

assertThrowsTypeError(
  () => compositingSwitchEffect.updateConfig(
    {
      overlayColorCompensation: 'bright',
      overlayAlphaLimit: Number.NaN,
      hostCompositing: 'multiply',
      hostCompositingSurface: 'webview',
    },
  ),
  'updateConfig 拒绝非法透明合同值',
);
assert(
  compositingSwitchEffect.getConfig().overlayColorCompensation ===
      'bright-core' &&
    compositingSwitchEffect.getConfig().overlayAlphaLimit === 0.7 &&
    compositingSwitchEffect.getConfig().hostCompositing === 'source-over' &&
    compositingSwitchEffect.getConfig().hostCompositingSurface ===
      'dom-backdrop',
  'updateConfig 校验失败后保留上一份有效透明配置',
);

compositingSwitchEffect.updateConfig({ hostCompositing: 'plus-lighter' });
const knownReference = { width: 8, height: 8 };

assert(
  compositingSwitchEffect.setCompositingReference(knownReference) &&
    compositingSwitchEffect.overlayRoot.style.mixBlendMode === 'plus-lighter' &&
    compositingSwitchEffect.canvas.parentElement ===
      compositingSwitchEffect.overlayRoot &&
    compositingSwitchEffect.getConfig().resolvedHostCompositing ===
      'plus-lighter',
  '没有可消费参考的回退链继续保持未知背景宿主 Add',
);

compositingSwitchEffect.webglEffectRenderer = {
  hasSceneBackground: true,
};
compositingSwitchEffect.webglEffectVisible = true;
compositingSwitchEffect._requestCompositingMountRefresh();

assert(
  compositingSwitchEffect.overlayRoot.style.mixBlendMode === '' &&
    compositingSwitchEffect.canvas.parentElement === dom.body &&
    compositingSwitchEffect.getEffectiveHostCompositing() === 'source-over',
  '活动 WebGL2 参考路径撤销宿主 Add，避免精确差值被二次增亮',
);
compositingSwitchEffect.webglEffectVisible = false;
compositingSwitchEffect.webglEffectRenderer = null;
assert(
  compositingSwitchEffect.setCompositingReference(null) &&
    compositingSwitchEffect.overlayRoot.style.mixBlendMode ===
      'plus-lighter' &&
    compositingSwitchEffect.canvas.parentElement ===
      compositingSwitchEffect.overlayRoot &&
    compositingSwitchEffect.getEffectiveHostCompositing() ===
      'plus-lighter',
  '清除背景参考后立即恢复未知背景宿主 Add 合同',
);

compositingSwitchEffect.updateConfig(
  { hostCompositingSurface: 'transparent-window' },
);
const transparentWindowConfig = compositingSwitchEffect.getConfig();

assert(
  transparentWindowConfig.hostCompositing === 'plus-lighter' &&
    transparentWindowConfig.requestedHostCompositing === 'plus-lighter' &&
    transparentWindowConfig.resolvedHostCompositing === 'source-over' &&
    transparentWindowConfig.compositingWarning ===
      'plus-lighter-requires-visible-backdrop' &&
    compositingSwitchEffect.getEffectiveHostCompositing() === 'source-over' &&
    compositingSwitchEffect.overlayRoot.style.mixBlendMode === '' &&
    compositingSwitchEffect.canvas.parentElement === dom.body &&
    hostCompositingEvents.at(-1)?.compositingWarning ===
      'plus-lighter-requires-visible-backdrop',
  '透明窗口保留请求值但解析为 source-over，并同步状态事件',
);

compositingSwitchEffect.updateConfig({ hostCompositing: 'screen' });
assert(
  compositingSwitchEffect.getConfig().compositingWarning ===
      'screen-requires-visible-backdrop' &&
    hostCompositingEvents.at(-1)?.requestedHostCompositing === 'screen',
  '透明窗口切换 Screen 时更新可诊断警告',
);

compositingSwitchEffect.updateConfig({ hostCompositingSurface: 'native' });
assert(
  compositingSwitchEffect.getEffectiveHostCompositing() === 'screen' &&
    compositingSwitchEffect.overlayRoot.style.mixBlendMode === '' &&
    compositingSwitchEffect.canvas.parentElement ===
      compositingSwitchEffect.overlayRoot &&
    hostCompositingEvents.at(-1)?.hostCompositingSurface === 'native',
  '原生合成器接收完整独立载荷，但库不会误加 CSS 混合',
);

compositingSwitchEffect.updateConfig(
  { hostCompositingSurface: 'dom-backdrop' },
);
assert(
  compositingSwitchEffect.overlayRoot.style.mixBlendMode === 'screen' &&
    compositingSwitchEffect.getConfig().compositingWarning === null,
  '恢复 DOM 背景表面后由内部根节点执行 Screen',
);
compositingSwitchEffect.destroy();

const pausedCompositingEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    outputCompositing: 'browser-overlay',
    hostCompositing: 'plus-lighter',
    inputSource: 'manual',
  },
);

pausedCompositingEffect.boom(700, 450);
let pausedCompositingNow = flushFrames(dom, performance.now(), 1);

pausedCompositingEffect.setPaused(true);
pausedCompositingEffect.updateConfig({ hostCompositing: 'source-over' });

assert(
  pausedCompositingEffect.compositingMountPending === true &&
    pausedCompositingEffect.overlayRoot.style.mixBlendMode ===
      'plus-lighter',
  '暂停时保留旧像素对应的宿主合成模式并延迟挂载切换',
);

pausedCompositingEffect.setPaused(false);
pausedCompositingNow = flushFrames(
  dom,
  pausedCompositingNow,
  1,
);

assert(
  pausedCompositingEffect.compositingMountPending === false &&
    pausedCompositingEffect.overlayRoot.style.mixBlendMode === '',
  '恢复后的首个新合同帧完成后再切换宿主合成模式',
);
pausedCompositingEffect.destroy();

const localAlphaLimitEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    outputCompositing: 'browser-overlay',
    overlayAlphaLimit: 0.7,
    inputSource: 'manual',
  },
);

localAlphaLimitEffect.setFxParam('bloom.clickEmissionScale', 0);
localAlphaLimitEffect.setFxParam('rings.count', 0);
localAlphaLimitEffect.setFxParam('shards.clickCount', 0);
localAlphaLimitEffect.boom(800, 500);
localAlphaLimitEffect.context.getImageDataCalls = [];
localAlphaLimitEffect._limitCanvasOverlayAlpha(1);
const localAlphaRead = localAlphaLimitEffect.context.getImageDataCalls[0];

assert(
  localAlphaLimitEffect._getSoftwareBloomRegions(1).length === 0 &&
    localAlphaRead?.[2] > 0 &&
    localAlphaRead?.[3] > 0 &&
    localAlphaRead[2] < localAlphaLimitEffect.canvas.width &&
    localAlphaRead[3] < localAlphaLimitEffect.canvas.height,
  '零 Bloom 发射时仍按可见几何局部限制最终 Canvas Alpha',
);
localAlphaLimitEffect.destroy();

const continuousCanvasSceneEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    inputSource: 'manual',
  },
);
const continuousCanvasSceneOperations = [];

continuousCanvasSceneEffect.canvasSceneRenderer = {
  available: true,
  contextLost: false,
  beginFrame()
  {
  },
  render()
  {
    return true;
  },
  clear()
  {
  },
  destroy()
  {
  },
};
continuousCanvasSceneEffect._drawCanvasTrails = () =>
{
  continuousCanvasSceneOperations.push(
    continuousCanvasSceneEffect.context.globalCompositeOperation,
  );
};
continuousCanvasSceneEffect.context.globalCompositeOperation = 'source-over';

const firstCanvasSceneFrame = continuousCanvasSceneEffect
  ._renderCanvasSceneEffects(1, false, false);

continuousCanvasSceneEffect.context.globalCompositeOperation = 'source-over';
const secondCanvasSceneFrame = continuousCanvasSceneEffect
  ._renderCanvasSceneEffects(1, false, false);

assert(
  firstCanvasSceneFrame &&
    secondCanvasSceneFrame &&
    continuousCanvasSceneOperations.length === 2 &&
    continuousCanvasSceneOperations.every((operation) =>
      operation === 'lighter'),
  'Canvas Scene 连续帧始终以 Unity One/One 绘制加色层',
);
continuousCanvasSceneEffect.destroy();

const hermiteBoundsEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'software',
    inputSource: 'manual',
  },
);

hermiteBoundsEffect.setFxParam('rings.count', 0);
hermiteBoundsEffect.setFxParam('shards.clickCount', 0);
hermiteBoundsEffect.boom(800, 500);
hermiteBoundsEffect.waves[0].ageMs = 20;
const hermiteDiskDrawStart = hermiteBoundsEffect.bloomRenderer.sourceContext
  .drawImageCalls.length;
hermiteBoundsEffect.waves[0].drawBloom(
  hermiteBoundsEffect.bloomRenderer.sourceContext,
  hermiteBoundsEffect._getScale(),
  1,
);
const renderedDiskRadius = hermiteBoundsEffect.bloomRenderer.sourceContext
  .drawImageCalls.slice(hermiteDiskDrawStart)
  .find((call) => call.args[0]?.width === 512).args[7] * 0.5;
const hermiteEmissionBounds = hermiteBoundsEffect
  ._getSoftwareBloomRegions(hermiteBoundsEffect._getScale())[0]
  .emissionBounds;

assert(
  Math.abs(hermiteEmissionBounds.width - renderedDiskRadius * 2) < 0.000001 &&
    Math.abs(hermiteEmissionBounds.height - renderedDiskRadius * 2) < 0.000001,
  'Software Bloom 发射边界与圆盘 Hermite 扩张曲线严格一致',
);
hermiteBoundsEffect.destroy();

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
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
];
const listenerCount = (type) => dom.windowMock.listeners.get(type)?.size ?? 0;
const pointerListenerBaseline = pointerEventTypes.map(listenerCount);
const touchListenerBaseline = pointerListenerBaseline.slice(4);
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
    pointerEventTypes.slice(0, 4).every((type, index) =>
      listenerCount(type) === pointerListenerBaseline[index] + 1) &&
    pointerEventTypes.slice(4).every((type, index) =>
      listenerCount(type) === touchListenerBaseline[index]),
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

console.log('\n移动端触摸行为');
const touchActionEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    touchAction: 'none',
  },
);
const pointerDownOptions = dom.windowMock.getEventListenerOptions(
  'pointerdown',
  touchActionEffect._onPointerDown,
);
const pointerMoveOptions = dom.windowMock.getEventListenerOptions(
  'pointermove',
  touchActionEffect._onPointerMove,
);
const pointerUpOptions = dom.windowMock.getEventListenerOptions(
  'pointerup',
  touchActionEffect._onPointerUp,
);
const pointerCancelOptions = dom.windowMock.getEventListenerOptions(
  'pointercancel',
  touchActionEffect._onPointerCancel,
);
const touchStartOptions = dom.windowMock.getEventListenerOptions(
  'touchstart',
  touchActionEffect._onTouchStart,
);
assert(
  pointerEventTypes.slice(4).every((type, index) =>
    listenerCount(type) === touchListenerBaseline[index] + 1) &&
    pointerDownOptions?.capture === true &&
    pointerMoveOptions?.capture === true &&
    pointerMoveOptions?.passive === true &&
    pointerUpOptions?.capture === true &&
    pointerCancelOptions?.capture === true &&
    touchStartOptions?.capture === true &&
    touchStartOptions?.passive === false,
  'DOM 输入使用 capture Pointer 生命周期与非 passive Touch 仲裁监听',
);
let noneTouchStartPrevented = 0;

dom.windowMock.dispatch('touchstart',
  {
    target: dom.body,
    cancelable: true,
    touches: [{ identifier: 88, clientX: 10, clientY: 10 }],
    changedTouches: [{ identifier: 88, clientX: 10, clientY: 10 }],
    preventDefault()
    {
      noneTouchStartPrevented++;
    },
  });
dom.windowMock.dispatch('touchcancel',
  {
    target: dom.body,
    touches: [],
    changedTouches: [{ identifier: 88, clientX: 10, clientY: 10 }],
  });
assert(
  noneTouchStartPrevented === 1,
  'touchAction none 在 touchstart 阶段阻止浏览器抢占手势',
);
touchActionEffect.updateConfig({ touchAction: 'auto' });
assert(
  pointerEventTypes.slice(4).every((type, index) =>
    listenerCount(type) === touchListenerBaseline[index]),
  'auto 不保留全局非 passive Touch 监听',
);
const dispatchTouchMove = (
  action,
  start,
  end,
  target = dom.body,
  effect = touchActionEffect,
) =>
{
  let prevented = 0;
  const identifier = 91;

  effect.updateConfig({ touchAction: action });
  dom.windowMock.dispatch('touchstart',
    {
      target,
      changedTouches:
      [
        {
          identifier,
          clientX: start.x,
          clientY: start.y,
        },
      ],
    });
  dom.windowMock.dispatch('touchmove',
    {
      target,
      cancelable: true,
      changedTouches:
      [
        {
          identifier,
          clientX: end.x,
          clientY: end.y,
        },
      ],
      preventDefault()
      {
        prevented++;
      },
    });
  dom.windowMock.dispatch('touchend',
    {
      target,
      changedTouches: [{ identifier }],
    });
  return prevented;
};

const dispatchTouchSequence = (action, moves) =>
{
  const identifier = 93;
  const prevented = [];

  touchActionEffect.updateConfig({ touchAction: action });
  dom.windowMock.dispatch('touchstart',
    {
      target: dom.body,
      touches: [{ identifier, clientX: 10, clientY: 10 }],
      changedTouches: [{ identifier, clientX: 10, clientY: 10 }],
    });

  for (const move of moves)
  {
    let count = 0;
    const touch = { identifier, clientX: move.x, clientY: move.y };

    dom.windowMock.dispatch('touchmove',
      {
        target: dom.body,
        cancelable: true,
        touches: [touch],
        changedTouches: [touch],
        preventDefault()
        {
          count++;
        },
      });
    prevented.push(count);
  }

  dom.windowMock.dispatch('touchend',
    {
      target: dom.body,
      touches: [],
      changedTouches: [{ identifier }],
    });
  return prevented;
};

assert(
  dispatchTouchMove('none', { x: 10, y: 10 }, { x: 110, y: 10 }) === 1 &&
    dispatchTouchMove('pan-x', { x: 10, y: 10 }, { x: 10, y: 110 }) === 1 &&
    dispatchTouchMove('pan-x', { x: 10, y: 10 }, { x: 110, y: 10 }) === 0 &&
    dispatchTouchMove('pan-y', { x: 10, y: 10 }, { x: 110, y: 10 }) === 1 &&
    dispatchTouchMove('pan-y', { x: 10, y: 10 }, { x: 10, y: 110 }) === 0 &&
    dispatchTouchMove('auto', { x: 10, y: 10 }, { x: 110, y: 10 }) === 0 &&
    dispatchTouchMove(
      'manipulation',
      { x: 10, y: 10 },
      { x: 10, y: 110 },
    ) === 0,
  'DOM 触摸行为只阻止 none 与 pan-x/pan-y 的禁止方向',
);
assert(
  dispatchTouchMove(
    'pan-left',
    { x: 100, y: 10 },
    { x: 180, y: 10 },
  ) === 0 &&
    dispatchTouchMove(
      'pan-left',
      { x: 100, y: 10 },
      { x: 20, y: 10 },
    ) === 1 &&
    dispatchTouchMove(
      'pan-right',
      { x: 100, y: 10 },
      { x: 20, y: 10 },
    ) === 0 &&
    dispatchTouchMove(
      'pan-right',
      { x: 100, y: 10 },
      { x: 180, y: 10 },
    ) === 1 &&
    dispatchTouchMove(
      'pan-up',
      { x: 10, y: 100 },
      { x: 10, y: 180 },
    ) === 0 &&
    dispatchTouchMove(
      'pan-up',
      { x: 10, y: 100 },
      { x: 10, y: 20 },
    ) === 1 &&
    dispatchTouchMove(
      'pan-down',
      { x: 10, y: 100 },
      { x: 10, y: 20 },
    ) === 0 &&
    dispatchTouchMove(
      'pan-down',
      { x: 10, y: 100 },
      { x: 10, y: 180 },
    ) === 1 &&
    dispatchTouchMove(
      'pan-x pinch-zoom',
      { x: 10, y: 10 },
      { x: 10, y: 110 },
    ) === 1 &&
    dispatchTouchMove(
      'pan-x pan-y',
      { x: 10, y: 10 },
      { x: 10, y: 110 },
    ) === 0,
  'DOM 触摸策略解析 CSS 方向与组合关键字',
);
assert(
  dispatchTouchSequence(
    'pan-x',
    [{ x: 10, y: 110 }, { x: 210, y: 10 }],
  ).join(',') === '1,1' &&
    dispatchTouchSequence(
      'pan-x',
      [{ x: 110, y: 10 }, { x: 10, y: 210 }],
    ).join(',') === '0,0',
  'pan-x 在首个可判定方向后锁存整次手势',
);

const dispatchPinchMove = (action) =>
{
  const starts =
  [
    { identifier: 94, clientX: 80, clientY: 80 },
    { identifier: 95, clientX: 120, clientY: 80 },
  ];
  const moves =
  [
    { identifier: 94, clientX: 60, clientY: 80 },
    { identifier: 95, clientX: 140, clientY: 80 },
  ];
  let prevented = 0;

  touchActionEffect.updateConfig({ touchAction: action });
  dom.windowMock.dispatch('touchstart',
    {
      target: dom.body,
      touches: starts,
      changedTouches: starts,
    });
  dom.windowMock.dispatch('touchmove',
    {
      target: dom.body,
      cancelable: true,
      touches: moves,
      changedTouches: moves,
      preventDefault()
      {
        prevented++;
      },
    });
  dom.windowMock.dispatch('touchend',
    {
      target: dom.body,
      touches: [],
      changedTouches: moves,
    });
  return prevented;
};

assert(
  dispatchPinchMove('pan-x') === 1 &&
    dispatchPinchMove('pan-x pinch-zoom') === 0,
  '多指缩放仅在 touchAction 显式允许 pinch-zoom 时保留原生行为',
);
touchActionEffect.destroy();

const excludedTouchTarget = new ElementMock('aside');
let touchFilterCallCount = 0;
let expectedTouchFilterEvent = null;
let touchFilterSawExpectedPointer = false;
const filteredTouchEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    touchAction: 'none',
    inputFilter(event)
    {
      touchFilterCallCount++;
      touchFilterSawExpectedPointer = event === expectedTouchFilterEvent;
      return event.target !== excludedTouchTarget;
    },
  },
);

const dispatchFilteredTouchMove = (target, identifier) =>
{
  const start = { x: 10, y: 10 };
  const end = { x: 80, y: 10 };
  const pointer =
  {
    type: 'pointerdown',
    target,
    pointerType: 'touch',
    button: 0,
    pointerId: identifier,
    clientX: start.x,
    clientY: start.y,
  };
  let prevented = 0;

  expectedTouchFilterEvent = pointer;
  dom.windowMock.dispatchEvent(pointer);
  dom.windowMock.dispatch('touchstart',
    {
      target,
      touches: [{ identifier, clientX: start.x, clientY: start.y }],
      changedTouches: [{ identifier, clientX: start.x, clientY: start.y }],
    });
  dom.windowMock.dispatch('touchmove',
    {
      target,
      cancelable: true,
      touches: [{ identifier, clientX: end.x, clientY: end.y }],
      changedTouches: [{ identifier, clientX: end.x, clientY: end.y }],
      preventDefault()
      {
        prevented++;
      },
    });
  dom.windowMock.dispatchEvent(
    {
      ...pointer,
      type: 'pointerup',
      clientX: end.x,
      clientY: end.y,
    });
  dom.windowMock.dispatch('touchend',
    {
      target,
      touches: [],
      changedTouches: [{ identifier, clientX: end.x, clientY: end.y }],
    });
  return prevented;
};

assert(
  dispatchFilteredTouchMove(excludedTouchTarget, 89) === 0 &&
    dispatchFilteredTouchMove(dom.body, 90) === 1 &&
    touchFilterCallCount === 2,
  'Touch 仲裁复用 inputFilter 并保留宿主 UI 手势',
);

const dispatchFilteredTouchOrder = (touchFirst, target, identifier) =>
{
  const touch = { identifier, clientX: 40, clientY: 40, target };
  const movedTouch = { ...touch, clientX: 100 };
  const pointer =
  {
    type: 'pointerdown',
    target,
    pointerType: 'touch',
    button: 0,
    pointerId: identifier,
    clientX: 40,
    clientY: 40,
  };
  const dispatchTouchStart = () => dom.windowMock.dispatch('touchstart',
    {
      target,
      touches: [touch],
      changedTouches: [touch],
    });
  let prevented = 0;

  touchFilterCallCount = 0;
  expectedTouchFilterEvent = pointer;
  touchFilterSawExpectedPointer = false;

  if (touchFirst)
  {
    dispatchTouchStart();
    dom.windowMock.dispatchEvent(pointer);
  }
  else
  {
    dom.windowMock.dispatchEvent(pointer);
    dispatchTouchStart();
  }

  dom.windowMock.dispatch('touchmove',
    {
      target,
      cancelable: true,
      touches: [movedTouch],
      changedTouches: [movedTouch],
      preventDefault()
      {
        prevented++;
      },
    });
  dom.windowMock.dispatchEvent(
    {
      ...pointer,
      type: 'pointercancel',
      clientX: movedTouch.clientX,
    });
  dom.windowMock.dispatch('touchcancel',
    {
      target,
      touches: [],
      changedTouches: [movedTouch],
    });
  return {
    callCount: touchFilterCallCount,
    prevented,
    sawExpectedPointer: touchFilterSawExpectedPointer,
  };
};

const pointerFirstFilterResult = dispatchFilteredTouchOrder(false, dom.body, 97);
const touchFirstFilterResult = dispatchFilteredTouchOrder(true, dom.body, 98);
const touchFirstRejectedFilterResult = dispatchFilteredTouchOrder(
  true,
  excludedTouchTarget,
  101,
);

assert(
  pointerFirstFilterResult.callCount === 1 &&
    pointerFirstFilterResult.sawExpectedPointer &&
    touchFirstFilterResult.callCount === 1 &&
    touchFirstFilterResult.sawExpectedPointer &&
    touchFirstRejectedFilterResult.callCount === 1 &&
    touchFirstRejectedFilterResult.sawExpectedPointer,
  'Pointer/Touch 两种事件顺序都只用真实 PointerEvent 过滤一次',
);
assert(
  pointerFirstFilterResult.prevented === 1 &&
    touchFirstFilterResult.prevented === 1 &&
    touchFirstRejectedFilterResult.prevented === 0,
  'Touch-first 会回填过滤决定并只仲裁接受的手势',
);
assert(
  filteredTouchEffect.pointerDown(
    { x: 20, y: 20, pointerId: 200, pointerType: 'touch' },
  ),
  '触摸占用回归可先建立一根活动指针',
);
const competingPointer =
{
  type: 'pointerdown',
  target: dom.body,
  pointerType: 'touch',
  button: 0,
  pointerId: 201,
  clientX: 40,
  clientY: 40,
};
const competingTouch =
{
  identifier: 201,
  target: dom.body,
  clientX: 40,
  clientY: 40,
};
const movedCompetingTouch = { ...competingTouch, clientX: 100 };
let competingTouchStartPrevented = 0;
let competingTouchMovePrevented = 0;

touchFilterCallCount = 0;
expectedTouchFilterEvent = competingPointer;
touchFilterSawExpectedPointer = false;
dom.windowMock.dispatchEvent(competingPointer);
dom.windowMock.dispatch('touchstart',
  {
    target: dom.body,
    cancelable: true,
    touches: [competingTouch],
    changedTouches: [competingTouch],
    preventDefault()
    {
      competingTouchStartPrevented++;
    },
  });
dom.windowMock.dispatch('touchmove',
  {
    target: dom.body,
    cancelable: true,
    touches: [movedCompetingTouch],
    changedTouches: [movedCompetingTouch],
    preventDefault()
    {
      competingTouchMovePrevented++;
    },
  });
dom.windowMock.dispatchEvent(
  {
    ...competingPointer,
    type: 'pointercancel',
    clientX: movedCompetingTouch.clientX,
  });
dom.windowMock.dispatch('touchcancel',
  {
    target: dom.body,
    touches: [],
    changedTouches: [movedCompetingTouch],
  });
assert(
  touchFilterCallCount === 1 &&
    touchFilterSawExpectedPointer &&
    competingTouchStartPrevented === 0 &&
    competingTouchMovePrevented === 0 &&
    filteredTouchEffect.activePointerId === 200,
  '实例未能启动第二根 Pointer 时不会错误阻止对应原生手势',
);
filteredTouchEffect.pointerCancel(200);
filteredTouchEffect.destroy();

const scopedTouchCanvas = new CanvasMock();
const scopedTouchChild = new ElementMock('span');

scopedTouchCanvas.appendChild(scopedTouchChild);
const scopedTouchEffect = new BAClickFX(
  {
    target: scopedTouchCanvas,
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    touchAction: 'none',
  },
);
const dispatchScopedTouchMove = (target) =>
{
  let prevented = 0;

  dom.windowMock.dispatch('touchstart',
    {
      target,
      changedTouches: [{ identifier: 92, clientX: 20, clientY: 20 }],
    });
  dom.windowMock.dispatch('touchmove',
    {
      target,
      cancelable: true,
      changedTouches: [{ identifier: 92, clientX: 80, clientY: 20 }],
      preventDefault()
      {
        prevented++;
      },
    });
  dom.windowMock.dispatch('touchend',
    {
      target,
      changedTouches: [{ identifier: 92 }],
    });
  return prevented;
};

assert(
  dispatchScopedTouchMove(dom.body) === 0 &&
    dispatchScopedTouchMove(scopedTouchCanvas) === 1 &&
    dispatchScopedTouchMove(scopedTouchChild) === 1,
  'target 实例只阻止自身命中范围内的触摸默认行为',
);

let shadowPrevented = 0;
const shadowHost = new ElementMock('div');
const shadowInnerTarget = new ElementMock('button');
const shadowTouch =
{
  identifier: 96,
  clientX: 20,
  clientY: 20,
  target: shadowInnerTarget,
};
const shadowPath = () =>
  [shadowInnerTarget, scopedTouchCanvas, shadowHost, dom.windowMock];

dom.windowMock.dispatch('touchstart',
  {
    target: shadowHost,
    composedPath: shadowPath,
    changedTouches: [shadowTouch],
  });
dom.windowMock.dispatch('touchmove',
  {
    target: shadowHost,
    composedPath: shadowPath,
    cancelable: true,
    changedTouches:
    [
      { identifier: 96, clientX: 90, clientY: 20 },
    ],
    preventDefault()
    {
      shadowPrevented++;
    },
  });
assert(
  shadowPrevented === 1,
  'Shadow DOM retarget 后仍通过 composedPath 识别 target 作用域',
);
dom.windowMock.dispatch('blur');
assert(
  scopedTouchEffect.touchGestureStarts.size === 0,
  '窗口异常失焦会清空尚未结束的触摸手势',
);
scopedTouchEffect.destroy();
assert(
  pointerEventTypes.every((type, index) =>
    listenerCount(type) === pointerListenerBaseline[index]),
  '销毁实例后完整解除 Pointer 与 Touch 输入监听',
);

const closedShadowHost = new ElementMock('section');
const closedShadowOpenHost = new ElementMock('div');
const closedShadowInner = new ElementMock('button');
const closedOuterRoot =
{
  host: closedShadowHost,
  mode: 'closed',
};

closedShadowInner.getBoundingClientRect = () =>
  ({ left: 0, top: 0, width: 320, height: 240 });
closedShadowInner.getRootNode = () =>
  ({ host: closedShadowOpenHost, mode: 'open' });
closedShadowOpenHost.getRootNode = () => closedOuterRoot;
const closedShadowPath = () =>
  [closedShadowInner, closedShadowOpenHost, closedShadowHost, dom.windowMock];
const dispatchClosedShadowEvent = (event, internalProperties = {}) =>
{
  dom.windowMock.dispatchEvent(event);
  Object.assign(
    event,
    {
      target: closedShadowInner,
      composedPath: closedShadowPath,
      ...internalProperties,
    },
  );
  closedShadowInner.dispatchEvent(event);
};
const closedShadowTouch =
{
  identifier: 99,
  clientX: 30,
  clientY: 30,
  target: closedShadowInner,
};
let closedShadowFilterCalls = 0;
let closedShadowPrevented = 0;
const closedShadowEffect = new BAClickFX(
  {
    target: closedShadowInner,
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    touchAction: 'none',
    inputFilter(event)
    {
      closedShadowFilterCalls++;
      return event.target === closedShadowInner;
    },
  },
);

const closedShadowPointer =
{
  type: 'pointerdown',
  target: closedShadowHost,
  pointerType: 'touch',
  button: 0,
  pointerId: 99,
  clientX: 30,
  clientY: 30,
  composedPath: () => [closedShadowHost, dom.windowMock],
};

// 真实 capture 顺序先经过 window，且 closed Shadow 外部只能看到重定向
// host；进入内部 target 后，实例才应执行过滤并建立拖尾。
dispatchClosedShadowEvent(closedShadowPointer);
const closedShadowStartEvent =
{
  type: 'touchstart',
  target: closedShadowHost,
  composedPath: () => [closedShadowHost, dom.windowMock],
  touches: [{ ...closedShadowTouch, target: closedShadowHost }],
  changedTouches: [{ ...closedShadowTouch, target: closedShadowHost }],
};

dispatchClosedShadowEvent(
  closedShadowStartEvent,
  {
    touches: [closedShadowTouch],
    changedTouches: [closedShadowTouch],
  },
);
const closedShadowMovedTouch = { ...closedShadowTouch, clientX: 90 };
const closedShadowMoveEvent =
{
  type: 'touchmove',
  target: closedShadowHost,
  composedPath: () => [closedShadowHost, dom.windowMock],
  cancelable: true,
  touches: [{ ...closedShadowMovedTouch, target: closedShadowHost }],
  changedTouches: [{ ...closedShadowMovedTouch, target: closedShadowHost }],
  preventDefault()
  {
    closedShadowPrevented++;
  },
};

dispatchClosedShadowEvent(
  closedShadowMoveEvent,
  {
    touches: [closedShadowMovedTouch],
    changedTouches: [closedShadowMovedTouch],
  },
);
const closedShadowCancelEvent =
{
  type: 'touchcancel',
  target: closedShadowHost,
  composedPath: () => [closedShadowHost, dom.windowMock],
  touches: [],
  changedTouches: [{ ...closedShadowTouch, target: closedShadowHost }],
};

dispatchClosedShadowEvent(
  closedShadowCancelEvent,
  { changedTouches: [closedShadowTouch] },
);
assert(
  closedShadowFilterCalls === 1 &&
    closedShadowPrevented === 1 &&
    closedShadowEffect.activePointerId === 99,
  '嵌套 closed Shadow 内部 target 在重定向前过滤并保持触摸仲裁',
);
const pausedClosedShadowTouch = { ...closedShadowTouch, identifier: 100 };
const pausedClosedShadowStartEvent =
{
  type: 'touchstart',
  target: closedShadowHost,
  composedPath: () => [closedShadowHost, dom.windowMock],
  touches: [{ ...pausedClosedShadowTouch, target: closedShadowHost }],
  changedTouches: [{ ...pausedClosedShadowTouch, target: closedShadowHost }],
};

dispatchClosedShadowEvent(
  pausedClosedShadowStartEvent,
  {
    touches: [pausedClosedShadowTouch],
    changedTouches: [pausedClosedShadowTouch],
  },
);
closedShadowEffect.setPaused(true);
let resumedTouchPrevented = 0;

closedShadowEffect.setPaused(false);
const resumedClosedShadowMove = { ...pausedClosedShadowTouch, clientX: 90 };
const resumedClosedShadowMoveEvent =
{
  type: 'touchmove',
  target: closedShadowInner,
  composedPath: closedShadowPath,
  cancelable: true,
  touches: [resumedClosedShadowMove],
  changedTouches: [resumedClosedShadowMove],
  preventDefault()
  {
    resumedTouchPrevented++;
  },
};

closedShadowInner.dispatchEvent(resumedClosedShadowMoveEvent);
assert(
  closedShadowEffect.touchGestureStarts.size === 0 &&
    closedShadowEffect.touchPointerFilterResults.length === 0 &&
    resumedTouchPrevented === 0,
  '暂停会清空触摸仲裁状态，恢复后不接续旧手势',
);
closedShadowEffect.destroy();

const previousPointerEventConstructor = dom.windowMock.PointerEvent;
dom.windowMock.PointerEvent = function PointerEventMock()
{
};
let closedShadowTouchFirstFilterCalls = 0;
let closedShadowTouchFirstPrevented = 0;
const closedShadowTouchFirstEffect = new BAClickFX(
  {
    target: closedShadowInner,
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    touchAction: 'none',
    inputFilter(event)
    {
      closedShadowTouchFirstFilterCalls++;
      return event.target === closedShadowInner;
    },
  },
);
const closedShadowTouchFirstStart =
{
  identifier: 103,
  clientX: 30,
  clientY: 30,
  target: closedShadowInner,
};
const closedShadowTouchFirstMove =
{
  ...closedShadowTouchFirstStart,
  clientX: 90,
};

// Touch-first 也先经过重定向后的 window，再进入真实 host；内部状态保持
// pending，直到随后的真实 PointerEvent 完成 inputFilter 决定。
const closedShadowTouchFirstStartEvent =
{
  type: 'touchstart',
  target: closedShadowHost,
  composedPath: () => [closedShadowHost, dom.windowMock],
  touches:
  [
    { ...closedShadowTouchFirstStart, target: closedShadowHost },
  ],
  changedTouches:
  [
    { ...closedShadowTouchFirstStart, target: closedShadowHost },
  ],
};

dispatchClosedShadowEvent(
  closedShadowTouchFirstStartEvent,
  {
    touches: [closedShadowTouchFirstStart],
    changedTouches: [closedShadowTouchFirstStart],
  },
);
const closedShadowTouchFirstPointer =
{
  type: 'pointerdown',
  target: closedShadowHost,
  pointerType: 'touch',
  button: 0,
  pointerId: closedShadowTouchFirstStart.identifier,
  clientX: closedShadowTouchFirstStart.clientX,
  clientY: closedShadowTouchFirstStart.clientY,
  composedPath: () => [closedShadowHost, dom.windowMock],
};
dom.windowMock.dispatchEvent(closedShadowTouchFirstPointer);
closedShadowTouchFirstPointer.target = closedShadowInner;
closedShadowTouchFirstPointer.composedPath = closedShadowPath;
closedShadowInner.dispatchEvent(closedShadowTouchFirstPointer);
const closedShadowTouchFirstMoveEvent =
{
  type: 'touchmove',
  target: closedShadowHost,
  composedPath: () => [closedShadowHost, dom.windowMock],
  cancelable: true,
  touches:
  [
    { ...closedShadowTouchFirstMove, target: closedShadowHost },
  ],
  changedTouches:
  [
    { ...closedShadowTouchFirstMove, target: closedShadowHost },
  ],
  preventDefault()
  {
    closedShadowTouchFirstPrevented++;
  },
};

dispatchClosedShadowEvent(
  closedShadowTouchFirstMoveEvent,
  {
    touches: [closedShadowTouchFirstMove],
    changedTouches: [closedShadowTouchFirstMove],
  },
);
assert(
  closedShadowTouchFirstFilterCalls === 1 &&
    closedShadowTouchFirstPrevented === 1 &&
    closedShadowTouchFirstEffect.activePointerId === 103 &&
    closedShadowTouchFirstEffect.touchGestureStarts.get(103)?.accepted === true,
  'closed Shadow touch-first 在窗口 capture 让路后由内部 target 回填状态',
);
dom.windowMock.dispatch('pointercancel',
  {
    target: closedShadowHost,
    pointerType: 'touch',
    pointerId: closedShadowTouchFirstStart.identifier,
  });
closedShadowTouchFirstEffect.destroy();
if (previousPointerEventConstructor === undefined)
{
  delete dom.windowMock.PointerEvent;
}
else
{
  dom.windowMock.PointerEvent = previousPointerEventConstructor;
}

dom.windowMock.ontouchstart = null;
let closedShadowFallbackFilterCalls = 0;
const closedShadowFallbackEffect = new BAClickFX(
  {
    target: closedShadowInner,
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    clickEnabled: false,
    touchAction: 'none',
    inputFilter(event)
    {
      closedShadowFallbackFilterCalls++;
      return event.target === closedShadowInner;
    },
  },
);
const closedShadowFallbackStartTouch =
{
  identifier: 104,
  clientX: 30,
  clientY: 60,
  target: closedShadowInner,
};
const closedShadowFallbackMoveTouch =
{
  ...closedShadowFallbackStartTouch,
  clientX: 100,
};
const closedShadowFallbackStartEvent =
{
  type: 'touchstart',
  target: closedShadowHost,
  touches: [closedShadowFallbackStartTouch],
  changedTouches: [closedShadowFallbackStartTouch],
  composedPath: () => [closedShadowHost, dom.windowMock],
};
const closedShadowFallbackMoveEvent =
{
  type: 'touchmove',
  target: closedShadowHost,
  cancelable: true,
  touches: [closedShadowFallbackMoveTouch],
  changedTouches: [closedShadowFallbackMoveTouch],
  composedPath: () => [closedShadowHost, dom.windowMock],
  preventDefault()
  {
    closedShadowFallbackMoveEvent.prevented =
      (closedShadowFallbackMoveEvent.prevented ?? 0) + 1;
  },
};
const closedShadowFallbackEndEvent =
{
  type: 'touchend',
  target: closedShadowHost,
  touches: [],
  changedTouches: [closedShadowFallbackMoveTouch],
  composedPath: () => [closedShadowHost, dom.windowMock],
};

// Touch-only fallback 在 window 看到重定向宿主时让路，再由真实 host
// listener 处理完整的 Touch 生命周期，避免 closed Shadow 下零轨迹。
dispatchClosedShadowEvent(closedShadowFallbackStartEvent);
dispatchClosedShadowEvent(closedShadowFallbackMoveEvent);
dispatchClosedShadowEvent(closedShadowFallbackEndEvent);
assert(
  closedShadowFallbackEffect.usesTouchInputFallback &&
    closedShadowFallbackFilterCalls === 1 &&
    closedShadowFallbackMoveEvent.prevented === 1 &&
    closedShadowFallbackEffect.trailStrokes.length === 1 &&
    closedShadowFallbackEffect.trailStrokes[0].points.length >= 2 &&
    closedShadowFallbackEffect.activePointerId === null,
  'Touch-only closed Shadow 由内部 Touch listener 建立并结束拖尾',
);
closedShadowFallbackEffect.destroy();

let touchFallbackFilterEvent = null;
const touchFallbackFilterEvents = [];
const touchFallbackEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    clickEnabled: false,
    touchAction: 'none',
    inputFilter(event)
    {
      touchFallbackFilterEvent = event;
      touchFallbackFilterEvents.push(event);
      return event.target === dom.body;
    },
  },
);
let touchFallbackPrevented = 0;
const fallbackStartTouch =
{
  identifier: 201,
  clientX: 40,
  clientY: 120,
  target: dom.body,
};
const fallbackMovedTouch =
{
  ...fallbackStartTouch,
  clientX: 240,
};

dom.windowMock.dispatch('touchstart',
  {
    target: dom.body,
    cancelable: true,
    timeStamp: performance.now(),
    touches: [fallbackStartTouch],
    changedTouches: [fallbackStartTouch],
    preventDefault()
    {
      touchFallbackPrevented++;
    },
  });
dom.windowMock.dispatch('touchmove',
  {
    target: dom.body,
    cancelable: true,
    timeStamp: performance.now() + 16,
    touches: [fallbackMovedTouch],
    changedTouches: [fallbackMovedTouch],
    preventDefault()
    {
      touchFallbackPrevented++;
    },
  });
dom.windowMock.dispatch('touchend',
  {
    target: dom.body,
    timeStamp: performance.now() + 32,
    touches: [],
    changedTouches: [fallbackMovedTouch],
  });
assert(
  touchFallbackEffect.usesTouchInputFallback &&
    touchFallbackFilterEvent?.type === 'pointerdown' &&
    touchFallbackFilterEvent?.pointerType === 'touch' &&
    touchFallbackFilterEvent?.pointerId === fallbackStartTouch.identifier &&
    touchFallbackFilterEvent?.isPrimary === true &&
    touchFallbackFilterEvents.length === 1 &&
    touchFallbackPrevented === 2 &&
    touchFallbackEffect.trailStrokes.length === 1 &&
    touchFallbackEffect.trailStrokes[0].points.length >= 2 &&
    touchFallbackEffect.activePointerId === null &&
    touchFallbackEffect.currentTrailStroke === null &&
    touchFallbackEffect.touchGestureStarts.size === 0,
  'Touch-only 宿主在 none 下通过 fallback 建立、移动并结束拖尾',
);

touchFallbackEffect.clear();
touchFallbackFilterEvents.length = 0;
touchFallbackEffect.updateConfig({ touchAction: 'pinch-zoom' });
const pinchFallbackTouches =
[
  {
    identifier: 203,
    clientX: 100,
    clientY: 220,
    target: dom.body,
  },
  {
    identifier: 204,
    clientX: 140,
    clientY: 220,
    target: dom.body,
  },
];
const pinchFallbackMovedTouches =
[
  { ...pinchFallbackTouches[0], clientX: 80 },
  { ...pinchFallbackTouches[1], clientX: 160 },
];
let pinchFallbackPrevented = 0;

dom.windowMock.dispatch('touchstart',
  {
    target: dom.body,
    cancelable: true,
    touches: pinchFallbackTouches,
    changedTouches: pinchFallbackTouches,
    preventDefault()
    {
      pinchFallbackPrevented++;
    },
  });
dom.windowMock.dispatch('touchmove',
  {
    target: dom.body,
    cancelable: true,
    touches: pinchFallbackMovedTouches,
    changedTouches: pinchFallbackMovedTouches,
    preventDefault()
    {
      pinchFallbackPrevented++;
    },
  });
dom.windowMock.dispatch('touchend',
  {
    target: dom.body,
    touches: [],
    changedTouches: pinchFallbackMovedTouches,
  });
assert(
  pinchFallbackPrevented === 0 &&
    touchFallbackFilterEvents.length === 2 &&
    touchFallbackFilterEvents[0].isPrimary === true &&
    touchFallbackFilterEvents[1].isPrimary === false &&
    touchFallbackEffect.activePointerId === null,
  'Touch-only fallback 以 filter 接受数识别 pinch 并保持 isPrimary 语义',
);

touchFallbackEffect.clear();
touchFallbackEffect.updateConfig({ touchAction: 'auto' });
const autoFallbackStart =
{
  identifier: 202,
  clientX: 60,
  clientY: 180,
  target: dom.body,
};
const autoFallbackMove = { ...autoFallbackStart, clientX: 300 };
let autoFallbackPrevented = 0;

dom.windowMock.dispatch('touchstart',
  {
    target: dom.body,
    cancelable: true,
    timeStamp: performance.now() + 48,
    touches: [autoFallbackStart],
    changedTouches: [autoFallbackStart],
    preventDefault()
    {
      autoFallbackPrevented++;
    },
  });
dom.windowMock.dispatch('touchmove',
  {
    target: dom.body,
    cancelable: true,
    timeStamp: performance.now() + 64,
    touches: [autoFallbackMove],
    changedTouches: [autoFallbackMove],
    preventDefault()
    {
      autoFallbackPrevented++;
    },
  });
dom.windowMock.dispatch('touchcancel',
  {
    target: dom.body,
    timeStamp: performance.now() + 80,
    touches: [],
    changedTouches: [autoFallbackMove],
  });
assert(
  touchFallbackEffect.touchActionListenersAttached &&
    autoFallbackPrevented === 0 &&
    touchFallbackEffect.activePointerId === null &&
    touchFallbackEffect.currentTrailStroke === null &&
    touchFallbackEffect.trailStrokes.length === 0,
  'Touch-only fallback 在 auto 下持续监听并由 touchcancel 清理轨迹',
);
touchFallbackEffect.pointerDown({ x: 20, y: 20, pointerId: 205 });
dom.windowMock.dispatch('touchstart',
  {
    target: dom.body,
    touches: [{ identifier: 206, clientX: 30, clientY: 30, target: dom.body }],
    changedTouches:
    [
      { identifier: 206, clientX: 30, clientY: 30, target: dom.body },
    ],
  });
dom.windowMock.dispatch('touchend',
  {
    target: dom.body,
    touches: [],
    changedTouches:
    [
      { identifier: 206, clientX: 30, clientY: 30, target: dom.body },
    ],
  });
assert(
  touchFallbackEffect.activePointerId === 205,
  'Touch-only fallback 的兜底结束不会释放无关手动指针',
);
touchFallbackEffect.pointerCancel(205);
touchFallbackEffect.destroy();
delete dom.windowMock.ontouchstart;
assert(
  pointerEventTypes.every((type, index) =>
    listenerCount(type) === pointerListenerBaseline[index]),
  'Touch-only fallback 销毁后完整解除 Touch 输入监听',
);

const shardOwnerEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    inputSource: 'manual',
  },
);

shardOwnerEffect.setFxParam('shards.maxCount', 1);
shardOwnerEffect.setFxParam('shards.trailSpacing', 20);
shardOwnerEffect.pointerDown({ x: 100, y: 100, pointerId: 81 });
const firstTrailOwnerId = shardOwnerEffect.activeTrailOwnerId;

shardOwnerEffect.pointerMove({ x: 500, y: 100, pointerId: 81 });
const firstOwnerTrailShards = shardOwnerEffect.shards.filter((shard) =>
  shard.kind === 'trail' && shard.ownerId === firstTrailOwnerId);

assert(
  firstOwnerTrailShards.length === 1 &&
    shardOwnerEffect.shards.filter((shard) => shard.kind === 'click').length ===
      UNITY_FX_TOUCH.shards.clickCount,
  '点击碎片不占用当前 FX_Touch 实例的拖尾粒子额度',
);

shardOwnerEffect.pointerUp(81);
shardOwnerEffect.pointerDown({ x: 100, y: 200, pointerId: 82 });
const secondTrailOwnerId = shardOwnerEffect.activeTrailOwnerId;

shardOwnerEffect.pointerMove({ x: 500, y: 200, pointerId: 82 });
const allOwnedTrailShards = shardOwnerEffect.shards.filter((shard) =>
  shard.kind === 'trail');

assert(
  firstTrailOwnerId !== secondTrailOwnerId &&
    allOwnedTrailShards.length === 2 &&
    allOwnedTrailShards.some((shard) =>
      shard.ownerId === firstTrailOwnerId) &&
    allOwnedTrailShards.some((shard) =>
      shard.ownerId === secondTrailOwnerId),
  '旧按下实例的存活拖尾碎片不占用新 FX_Touch 实例额度',
);

firstOwnerTrailShards[0].ageMs = firstOwnerTrailShards[0].lifetimeMs;
shardOwnerEffect._updateShards(
  shardOwnerEffect.clickTimeMs,
  shardOwnerEffect.trailTimeMs,
  shardOwnerEffect._getScale(),
  false,
);
assert(
  !shardOwnerEffect.trailShardCounts.has(firstTrailOwnerId) &&
    shardOwnerEffect.trailShardCounts.get(secondTrailOwnerId) === 1,
  '拖尾碎片死亡后只归还所属 FX_Touch 实例的额度',
);

shardOwnerEffect.pointerCancel(82);
const secondOwnerTrailShard = shardOwnerEffect.shards.find((shard) =>
  shard.kind === 'trail' && shard.ownerId === secondTrailOwnerId);

secondOwnerTrailShard.ageMs = secondOwnerTrailShard.lifetimeMs;
shardOwnerEffect._updateShards(
  shardOwnerEffect.clickTimeMs,
  shardOwnerEffect.trailTimeMs,
  shardOwnerEffect._getScale(),
  false,
);
shardOwnerEffect.pointerDown({ x: 100, y: 300, pointerId: 83 });
const emptyTrailOwnerId = shardOwnerEffect.activeTrailOwnerId;

shardOwnerEffect.pointerUp(83);
assert(
  shardOwnerEffect.trailShardCounts.size === 0 &&
    !shardOwnerEffect.trailShardCounts.has(emptyTrailOwnerId),
  '松开时立即释放没有存活拖尾碎片的空 owner 计数',
);

shardOwnerEffect.setFxParam('shards.maxCount', 50);
shardOwnerEffect.setFxParam('shards.trailSpacing', 1);
shardOwnerEffect.pointerDown({ x: 100, y: 400, pointerId: 84 });
const capacityTrailOwnerId = shardOwnerEffect.activeTrailOwnerId;

shardOwnerEffect.pointerMove({ x: 200, y: 400, pointerId: 84 });
const capacityTrailShards = shardOwnerEffect.shards.filter((shard) =>
  shard.kind === 'trail' && shard.ownerId === capacityTrailOwnerId);

assert(
  capacityTrailShards.length === 50 &&
    shardOwnerEffect.trailShardCounts.get(capacityTrailOwnerId) === 50,
  '超长单段按 Unity maxNumParticles=50 发射，不再截断为 32 枚',
);
shardOwnerEffect.destroy();

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

console.log('\n输入采样率');
const unlimitedSamplingStart = performance.now() + 1000;

dom.setCurrentTime(unlimitedSamplingStart);
const unlimitedSamplingEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    clickEnabled: false,
    inputSource: 'manual',
  },
);

unlimitedSamplingEffect.setFxParam('trail.minVertexDistance', 1);
unlimitedSamplingEffect.setFxParam('shards.maxCount', 0);
unlimitedSamplingEffect.pointerDown({ x: 100, y: 100, pointerId: 71 });
dom.setCurrentTime(unlimitedSamplingStart + 100);
unlimitedSamplingEffect.pointerMove({ x: 200, y: 100, pointerId: 71 });
dom.setCurrentTime(unlimitedSamplingStart + 120);
unlimitedSamplingEffect.pointerMove({ x: 250, y: 200, pointerId: 71 });
dom.setCurrentTime(unlimitedSamplingStart + 200);
unlimitedSamplingEffect.pointerMove({ x: 300, y: 100, pointerId: 71 });

assert(
  unlimitedSamplingEffect.getConfig().inputSamplingRate === 0 &&
    unlimitedSamplingEffect.currentTrailStroke.points.some((point) =>
      point.y > 100),
  '默认 0 Hz 不限频并保留每个输入转折点',
);
unlimitedSamplingEffect.destroy();

const limitedSamplingStart = unlimitedSamplingStart + 1000;

dom.setCurrentTime(limitedSamplingStart);
const limitedSamplingEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    clickEnabled: false,
    inputSamplingRate: 10,
    inputSource: 'manual',
    trailTimeScale: 0.5,
  },
);

limitedSamplingEffect.setFxParam('trail.minVertexDistance', 1);
limitedSamplingEffect.setFxParam('shards.maxCount', 0);
limitedSamplingEffect.pointerDown({ x: 100, y: 100, pointerId: 72 });
dom.setCurrentTime(limitedSamplingStart + 100);
const firstLimitedMove = limitedSamplingEffect.pointerMove(
  { x: 200, y: 100, pointerId: 72 },
);
dom.setCurrentTime(limitedSamplingStart + 120);
const throttledLimitedMove = limitedSamplingEffect.pointerMove(
  { x: 250, y: 200, pointerId: 72 },
);
dom.setCurrentTime(limitedSamplingStart + 200);
const secondLimitedMove = limitedSamplingEffect.pointerMove(
  { x: 300, y: 100, pointerId: 72 },
);

assert(
  firstLimitedMove === true &&
    throttledLimitedMove === true &&
    secondLimitedMove === true &&
    limitedSamplingEffect.currentTrailStroke.points.every((point) =>
      point.y === 100),
  '10 Hz 按真实时间丢弃中间弯点并连接低频采样弦段',
);
assert(
  limitedSamplingEffect.lastInputSampleSourceTime ===
      limitedSamplingStart + 200 &&
    limitedSamplingEffect.lastPointerTime === 100,
  '输入采样 Hz 不受 trailTimeScale 缩放',
);
assert(
  limitedSamplingEffect.setInputSamplingRate(-1) === false &&
    limitedSamplingEffect.getConfig().inputSamplingRate === 10 &&
    limitedSamplingEffect.setInputSamplingRate(0) === true &&
    limitedSamplingEffect.getConfig().inputSamplingRate === 0,
  '采样率便捷 API 拒绝非法值并可恢复不限频',
);
dom.setCurrentTime(limitedSamplingStart + 201);
limitedSamplingEffect.pointerMove({ x: 310, y: 160, pointerId: 72 });
assert(
  limitedSamplingEffect.currentTrailStroke.points.some((point) =>
    point.y > 100),
  '运行时关闭限频后下一次移动立即恢复完整采样',
);
limitedSamplingEffect.pointerCancel(72);
limitedSamplingEffect.destroy();

const coalescedSamplingStart = limitedSamplingStart + 1000;

dom.setCurrentTime(coalescedSamplingStart);
const coalescedSamplingEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    clickEnabled: false,
    inputSamplingRate: 10,
    trailAlways: true,
  },
);

dom.windowMock.dispatch('pointermove',
  {
    pointerType: 'mouse',
    pointerId: 73,
    button: -1,
    clientX: 300,
    clientY: 240,
    timeStamp: coalescedSamplingStart,
    getCoalescedEvents()
    {
      return [
        {
          pointerType: 'mouse',
          pointerId: 73,
          clientX: 100,
          clientY: 240,
          timeStamp: coalescedSamplingStart - 100,
        },
        {
          pointerType: 'mouse',
          pointerId: 73,
          clientX: 300,
          clientY: 240,
          timeStamp: coalescedSamplingStart - 20,
        },
      ];
    },
  });
assert(
  coalescedSamplingEffect.lastPointerPosition.x === 100 &&
    coalescedSamplingEffect.lastInputSampleSourceTime ===
      coalescedSamplingStart - 100,
  'DOM 合并样本分别按各自 timeStamp 限频',
);
coalescedSamplingEffect.pointerCancel(73);
coalescedSamplingEffect.destroy();

const idleSamplingStart = coalescedSamplingStart + 1000;

dom.setCurrentTime(idleSamplingStart);
const idleSamplingEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    clickEnabled: false,
    inputSamplingRate: 1,
    trailAlways: true,
  },
);

idleSamplingEffect.pointerMove({ x: 100, y: 260, pointerId: 74 });
flushFrames(dom, idleSamplingStart, 30);
dom.setCurrentTime(idleSamplingStart + 500);
const throttledIdleMove = idleSamplingEffect.pointerMove(
  { x: 300, y: 260, pointerId: 74 },
);
dom.setCurrentTime(idleSamplingStart + 1000);
idleSamplingEffect.pointerMove({ x: 400, y: 260, pointerId: 74 });
assert(
  throttledIdleMove === true &&
    idleSamplingEffect.lastPointerPosition.x === 400 &&
    idleSamplingEffect.currentTrailStroke.points.length >= 2,
  '低采样率在真实间隔到期后才重建已消失轨迹',
);
idleSamplingEffect.pointerCancel(74);
idleSamplingEffect.destroy();

const fastTrailSamplingStart = idleSamplingStart + 2000;

dom.setCurrentTime(fastTrailSamplingStart);
const fastTrailSamplingEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    clickEnabled: false,
    inputSamplingRate: 10,
    inputSource: 'manual',
    trailTimeScale: 4,
  },
);

fastTrailSamplingEffect.pointerDown({ x: 100, y: 280, pointerId: 75 });
dom.setCurrentTime(fastTrailSamplingStart + 80);
fastTrailSamplingEffect.pointerMove({ x: 200, y: 280, pointerId: 75 });
const positionBeforeSourceInterval = fastTrailSamplingEffect.lastPointerPosition.x;
dom.setCurrentTime(fastTrailSamplingStart + 100);
fastTrailSamplingEffect.pointerMove({ x: 300, y: 280, pointerId: 75 });
assert(
  positionBeforeSourceInterval === 100 &&
    fastTrailSamplingEffect.lastPointerPosition.x === 300,
  '视觉拖尾提前过期不会突破真实输入采样率上限',
);
fastTrailSamplingEffect.pointerCancel(75);
fastTrailSamplingEffect.destroy();

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

timeScaleEffect.updateConfig({ clickTimeScale: 0.01, trailTimeScale: 0.01 });
assert(
  timeScaleEffect.getConfig().clickTimeScale === 0.01 &&
    timeScaleEffect.getConfig().trailTimeScale === 0.01,
  'updateConfig 接受 0.01 的最低时间倍率',
);
assertThrowsTypeError(
  () => timeScaleEffect.updateConfig(
    {
      clickTimeScale: 0.009,
      trailTimeScale: 0,
    },
  ),
  'updateConfig 拒绝低于 0.01 的时间倍率',
);
assert(
  timeScaleEffect.getConfig().clickTimeScale === 0.01 &&
    timeScaleEffect.getConfig().trailTimeScale === 0.01,
  'updateConfig 校验失败后保留原有时间倍率',
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
assert(
  clickGlowResetEffect.context.radialGradients.length === 0 &&
    clickGlowResetEffect.context.drawImageCalls.length > 0,
  '点击发射倍率为零时只关闭光晕、不移除清晰几何',
);
clickGlowResetEffect.clear();
clickGlowResetEffect.setFxParam('bloom.clickEmissionScale', 4);
clickGlowResetEffect.context.fillShadowBlurs = [];
clickGlowResetEffect.context.fillShadowColors = [];
clickGlowResetEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
const boostedNativeGlowAlphas = clickGlowResetEffect.context.radialGradients
  .flatMap(({ gradient }) => gradient.stops.map(([, color]) => getCssAlpha(color)));
assert(
  boostedNativeGlowAlphas.length > 0 &&
    boostedNativeGlowAlphas.some((alpha) => alpha > 0 && alpha < 1) &&
    boostedNativeGlowAlphas.at(-1) === 0,
  '高强度原生辉光仍保留半透明外缘并平滑衰减到零',
);
clickGlowResetEffect.resetFxConfig();
assert(
  clickGlowResetEffect.getFxConfig().bloom.clickEmissionScale === 1,
  'resetFxConfig() 恢复点击发射倍率默认值',
);
clickGlowResetEffect.destroy();

console.log('\nWebGPU 展示暂停合同');
const dormantWebGPUEffect = new BAClickFX(
  {
    effectBackend: 'webgpu',
    bloomBackend: 'webgl2',
  },
);
const dormantWebGPUCanvas = document.createElement('canvas');
let dormantWebGPUSuspendCount = 0;
let dormantWebGPUReleaseCount = 0;
let dormantWebGPUDestroyCount = 0;
let dormantWebGPUPreferHdr = true;
const dormantWebGPURenderer =
{
  available: true,
  status: 'ready',
  deviceManager: { outputMode: 'extended' },
  setPreferHdr(preferHdr)
  {
    dormantWebGPUPreferHdr = preferHdr;
  },
  suspendPresentation()
  {
    dormantWebGPUSuspendCount++;
    this.deviceManager.outputMode = 'unconfigured';
    return true;
  },
  releaseFrameResources()
  {
    dormantWebGPUReleaseCount++;
  },
  clear()
  {
  },
  destroy()
  {
    dormantWebGPUDestroyCount++;
  },
};

dormantWebGPUEffect.overlayParent.appendChild(dormantWebGPUCanvas);
dormantWebGPUEffect.webgpuEffectCanvas = dormantWebGPUCanvas;
dormantWebGPUEffect.webgpuEffectRenderer = dormantWebGPURenderer;
dormantWebGPUCanvas.style.display = 'none';
dormantWebGPUEffect._setWebGPUEffectVisible(false);
assert(
  dormantWebGPUSuspendCount === 1 &&
    dormantWebGPURenderer.deviceManager.outputMode === 'unconfigured',
  '从未显示的 WebGPU Canvas 也会解除 Extended 输出配置',
);

dormantWebGPURenderer.deviceManager.outputMode = 'extended';
dormantWebGPUEffect.webgpuEffectVisible = true;
dormantWebGPUCanvas.style.display = '';
dormantWebGPUEffect._setResolvedEffectBackend('webgpu');
dormantWebGPUEffect.updateConfig({ webgpuPreferHdr: false });
assert(
  dormantWebGPUPreferHdr === false &&
    dormantWebGPUSuspendCount === 2 &&
    dormantWebGPUReleaseCount === 1 &&
    dormantWebGPUCanvas.style.display === 'none' &&
    dormantWebGPUEffect.getConfig().webgpuPreferHdr === false &&
    dormantWebGPUEffect.getConfig().resolvedEffectBackend === 'pending',
  '切到 WebGPU 标准输出时先撤下 Extended Surface 并等待 SDR 首帧',
);

dormantWebGPURenderer.deviceManager.outputMode = 'extended';
dormantWebGPUEffect.webgpuEffectVisible = true;
dormantWebGPUCanvas.style.display = '';
dormantWebGPUEffect.updateConfig({ effectBackend: 'webgl2' });
assert(
  dormantWebGPUSuspendCount === 3 &&
    dormantWebGPUReleaseCount === 2 &&
    dormantWebGPUCanvas.style.display === 'none' &&
    dormantWebGPURenderer.deviceManager.outputMode === 'unconfigured' &&
    dormantWebGPUEffect.getConfig().resolvedWebGPUOutputMode === 'unavailable',
  '切换到 WebGL2 时暂停 HDR Surface 并停止公开缓存 Extended 状态',
);
dormantWebGPURenderer.deviceManager.outputMode = 'extended';
dormantWebGPURenderer.suspendPresentation = () => false;
dormantWebGPUEffect._setWebGPUEffectVisible(false);
assert(
  dormantWebGPUEffect.webgpuEffectRenderer === null &&
    dormantWebGPUEffect.webgpuEffectCanvas === null &&
    dormantWebGPUCanvas.removed &&
    dormantWebGPUDestroyCount === 1,
  '无法暂停 HDR Surface 时释放 Renderer，避免隐藏 Extended Canvas 残留',
);
dormantWebGPUEffect.destroy();
assert(
  dormantWebGPUDestroyCount === 1,
  '提前释放的 WebGPU Renderer 不会在实例销毁时重复释放',
);

console.log('\n完整特效后端 API');
const fullWebGLEffect = new BAClickFX(
  {
    effectBackend: 'webgl2',
    bloomBackend: 'webgl2',
  },
);
const fullWebGLEvents = [];
const fullWebGLCanvas = document.createElement('canvas');
let fullWebGLReleaseCount = 0;
const fullWebGLRenderer =
{
  available: true,
  contextLost: false,
  sourceTarget: true,
  levels: [true],
  clear()
  {
  },
  releaseFrameResources()
  {
    fullWebGLReleaseCount++;
    this.sourceTarget = null;
    this.levels = [];
  },
  destroy()
  {
    this.available = false;
  },
};

fullWebGLEffect.canvas.addEventListener(
  EFFECT_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    fullWebGLEvents.push(event.detail);
  },
);
assert(
  fullWebGLEffect.getConfig().effectBackend === 'webgl2' &&
    fullWebGLEffect.getConfig().resolvedEffectBackend === 'pending',
  '纯 WebGL2 在延迟能力探测前公开 pending，不伪报 Canvas2D 回退',
);
fullWebGLEffect.overlayParent.appendChild(fullWebGLCanvas);
fullWebGLEffect.webglEffectCanvas = fullWebGLCanvas;
fullWebGLEffect.webglEffectRenderer = fullWebGLRenderer;
fullWebGLEffect._ensureWebGLEffectRenderer = () => true;
fullWebGLEffect._resizeWebGLEffectRenderer = () => true;
fullWebGLEffect._renderWebGL2ClickEffects = () => true;
const fullWebGLMainClearCount = fullWebGLEffect.context.clearRectCalls.length;

fullWebGLEffect.boom(960, 540);
let fullWebGLNow = flushFrames(dom, performance.now(), 1);
assert(
  fullWebGLEffect.getConfig().resolvedEffectBackend === 'webgl2' &&
    fullWebGLEvents.length === 1 &&
    fullWebGLEvents[0].requestedEffectBackend === 'webgl2' &&
    fullWebGLEvents[0].resolvedEffectBackend === 'webgl2',
  '纯 WebGL2 首帧成功后只派发一次实际后端，不产生虚假回退事件',
);
assert(
  fullWebGLEffect.context.clearRectCalls.length > fullWebGLMainClearCount,
  'DOM 纯 WebGL2 帧清空备用 Canvas，避免 Context 恢复时叠加旧回退像素',
);
fullWebGLEffect.updateConfig({ bloomBackend: 'native' });
assert(
  fullWebGLEffect.getConfig().resolvedEffectBackend === 'webgl2' &&
    fullWebGLEffect.getConfig().resolvedBloomBackend === 'webgl2' &&
    fullWebGLEvents.length === 1 &&
    fullWebGLReleaseCount === 0,
  '纯 WebGL2 接管时修改备用 Bloom 不释放当前 Scene 或重置后端状态',
);
fullWebGLEffect.updateConfig({ effectBackend: 'canvas2d' });
assert(
  fullWebGLEffect.getConfig().resolvedEffectBackend === 'canvas2d' &&
    fullWebGLEvents.at(-1).resolvedEffectBackend === 'canvas2d' &&
    fullWebGLReleaseCount === 1,
  '切出纯 WebGL2 时同步撤下并释放旧 Scene 帧资源',
);
fullWebGLEffect.updateConfig({ effectBackend: 'webgl2' });
assert(
  fullWebGLEffect.getConfig().resolvedEffectBackend === 'pending' &&
    fullWebGLEvents.at(-1).resolvedEffectBackend === 'pending' &&
    fullWebGLReleaseCount === 2,
  '从 Canvas2D 切回纯 WebGL2 时直接进入 pending，不先伪报回退',
);
fullWebGLNow = flushFrames(dom, fullWebGLNow, 1);
assert(
  fullWebGLEffect.getConfig().resolvedEffectBackend === 'webgl2' &&
    fullWebGLEvents.map((event) => event.resolvedEffectBackend).join(',') ===
      'webgl2,canvas2d,pending,webgl2',
  '完整特效后端按已提交 Scene 顺序派发稳定状态',
);
fullWebGLEffect.destroy();

const unavailableFullWebGLEffect = new BAClickFX(
  {
    effectBackend: 'webgl2',
    bloomBackend: 'software',
  },
);
const unavailableFullWebGLEvents = [];

unavailableFullWebGLEffect.canvas.addEventListener(
  EFFECT_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    unavailableFullWebGLEvents.push(event.detail);
  },
);
assert(
  unavailableFullWebGLEffect.getConfig().resolvedEffectBackend === 'pending',
  '纯 WebGL2 创建失败前保持待探测状态',
);
unavailableFullWebGLEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
assert(
  unavailableFullWebGLEffect.getConfig().resolvedEffectBackend ===
      'canvas2d' &&
    unavailableFullWebGLEvents.length === 1 &&
    unavailableFullWebGLEvents[0].requestedEffectBackend === 'webgl2' &&
    unavailableFullWebGLEvents[0].resolvedEffectBackend === 'canvas2d',
  '纯 WebGL2 创建失败后只派发一次 Canvas2D 实际回退',
);
unavailableFullWebGLEffect.destroy();

const externalFullWebGLCanvas = new CanvasMock();
const externalFullWebGLEffect = new BAClickFX(
  {
    target: externalFullWebGLCanvas,
    effectBackend: 'webgl2',
  },
);
assert(
  externalFullWebGLEffect.getConfig().resolvedEffectBackend === 'canvas2d',
  '外部 Canvas 对纯 WebGL2 请求公开实际 Canvas2D 路径',
);
externalFullWebGLEffect.destroy();

console.log('\nBloom 后端 API');
const unifiedWebGLBloomEffect = new BAClickFX(
  {
    bloomBackend: 'webgl2',
    lightBackgroundContrastAlpha: 0.35,
  },
);
const unifiedWebGLBloomCanvas = document.createElement('canvas');
const unifiedWebGLBloomRenderer =
{
  available: true,
  contextLost: false,
  sourceTarget: true,
  levels: [true],
  clear()
  {
  },
  releaseFrameResources()
  {
    this.sourceTarget = null;
    this.levels = [];
  },
  destroy()
  {
    this.available = false;
  },
};
let unifiedSceneRenderCount = 0;

unifiedWebGLBloomEffect.overlayParent.appendChild(unifiedWebGLBloomCanvas);
unifiedWebGLBloomEffect.webglBloomCanvas = unifiedWebGLBloomCanvas;
unifiedWebGLBloomEffect.webglBloomRenderer = unifiedWebGLBloomRenderer;
unifiedWebGLBloomEffect._ensureWebGLBloomRenderer = () => true;
unifiedWebGLBloomEffect._resizeWebGLBloomRenderer = () => true;
unifiedWebGLBloomEffect._renderWebGL2Scene = () =>
{
  unifiedSceneRenderCount++;
  return true;
};

const unifiedCanvasCounts =
{
  fills: unifiedWebGLBloomEffect.context.fillCount,
  strokes: unifiedWebGLBloomEffect.context.strokeCount,
  images: unifiedWebGLBloomEffect.context.drawImageCalls.length,
};

unifiedWebGLBloomEffect.boom(960, 540);
let unifiedWebGLNow = flushFrames(dom, performance.now(), 1);
assert(
  unifiedSceneRenderCount === 1 &&
    unifiedWebGLBloomEffect.context.fillCount === unifiedCanvasCounts.fills &&
    unifiedWebGLBloomEffect.context.strokeCount ===
      unifiedCanvasCounts.strokes &&
    unifiedWebGLBloomEffect.context.drawImageCalls.length ===
      unifiedCanvasCounts.images &&
    unifiedWebGLBloomEffect.canvas.style.visibility === 'hidden' &&
    unifiedWebGLBloomEffect.contrastCanvas.style.visibility !== 'hidden',
  'WebGL2 Bloom 成功帧隐藏主 Canvas 但保留独立对比层',
);

const fallbackImageStart =
  unifiedWebGLBloomEffect.context.drawImageCalls.length;

unifiedWebGLBloomEffect._renderWebGL2Scene = () => false;
unifiedWebGLBloomEffect._requestRender();
unifiedWebGLNow = flushFrames(dom, unifiedWebGLNow, 1);
assert(
  unifiedWebGLBloomEffect.getConfig().resolvedBloomBackend === 'native' &&
    unifiedWebGLBloomEffect.canvas.style.visibility === '' &&
    !unifiedWebGLBloomEffect.context.drawImageCalls
      .slice(fallbackImageStart)
      .some((call) =>
        call.args[0] === unifiedWebGLBloomEffect.bloomRenderer.outputCanvas),
  'WebGL2 Bloom 当帧失败后直接回退 Native，不执行 Software 回读',
);
unifiedWebGLBloomEffect.destroy();

const reentrantWebGLBloomEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'webgl2',
    outputCompositing: 'browser-overlay',
  },
);
const reentrantWebGLBloomCanvas = document.createElement('canvas');
const reentrantWebGLBloomRenderer =
{
  available: true,
  contextLost: false,
  sourceTarget: true,
  levels: [true],
  clear()
  {
  },
  releaseFrameResources()
  {
    this.sourceTarget = null;
    this.levels = [];
  },
  destroy()
  {
    this.available = false;
  },
};
const reentrantWebGLBloomEvents = [];
const reentrantWebGLBloomDraw =
  reentrantWebGLBloomEffect._drawCanvasFallbackFrame.bind(
    reentrantWebGLBloomEffect,
  );
let reentrantWebGLBloomSoftwareCount = 0;
let reentrantWebGLBloomNativeCount = 0;

reentrantWebGLBloomEffect.overlayParent.appendChild(
  reentrantWebGLBloomCanvas,
);
reentrantWebGLBloomEffect.webglBloomCanvas = reentrantWebGLBloomCanvas;
reentrantWebGLBloomEffect.webglBloomRenderer =
  reentrantWebGLBloomRenderer;
reentrantWebGLBloomEffect._ensureWebGLBloomRenderer = () => true;
reentrantWebGLBloomEffect._resizeWebGLBloomRenderer = () => true;
reentrantWebGLBloomEffect._renderWebGL2Scene = () => false;
reentrantWebGLBloomEffect._renderSoftwareBloom = () =>
{
  reentrantWebGLBloomSoftwareCount++;
};
reentrantWebGLBloomEffect._drawCanvasFallbackFrame =
  (scale, useNativeBloom) =>
  {
    if (useNativeBloom)
    {
      reentrantWebGLBloomNativeCount++;
    }

    reentrantWebGLBloomDraw(scale, useNativeBloom);
  };
reentrantWebGLBloomEffect.canvas.addEventListener(
  BLOOM_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    reentrantWebGLBloomEvents.push(event.detail);
  },
);

reentrantWebGLBloomEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
assert(
  reentrantWebGLBloomEffect.getConfig().bloomBackend === 'webgl2' &&
    reentrantWebGLBloomEffect.getConfig().resolvedBloomBackend === 'native' &&
    reentrantWebGLBloomEvents.slice(-2)
      .map((event) =>
        `${event.requestedBloomBackend}/${event.resolvedBloomBackend}`)
      .join(',') === 'webgl2/webgl2,webgl2/native' &&
    reentrantWebGLBloomSoftwareCount === 0 &&
    reentrantWebGLBloomNativeCount >= 1,
  'WebGL2 Bloom 失败直接使用 Native 且不执行 Software 回读',
);
reentrantWebGLBloomEffect.destroy();

const reentrantFullWebGLEffect = new BAClickFX(
  {
    effectBackend: 'webgl2',
    bloomBackend: 'webgl2',
    outputCompositing: 'browser-overlay',
    hostCompositing: 'plus-lighter',
  },
);
const reentrantFullWebGLEvents = [];
const reentrantFullWebGLDraw =
  reentrantFullWebGLEffect._drawCanvasClickEffects.bind(
    reentrantFullWebGLEffect,
  );
let reentrantFullWebGLSoftwareCount = 0;
let reentrantFullWebGLNativeCount = 0;
const reentrantFullWebGLCompositeOperations = [];

reentrantFullWebGLEffect.webglBloomUnavailable = true;
reentrantFullWebGLEffect.compositingReferenceSource = { width: 8, height: 8 };
reentrantFullWebGLEffect.webglEffectCanvas = document.createElement('canvas');
reentrantFullWebGLEffect.webglEffectRenderer = {
  hasSceneBackground: true,
  clear()
  {
  },
  destroy()
  {
  },
  releaseFrameResources()
  {
  },
};
reentrantFullWebGLEffect.webglEffectVisible = true;
reentrantFullWebGLEffect.overlayParent.appendChild(
  reentrantFullWebGLEffect.webglEffectCanvas,
);
reentrantFullWebGLEffect._prepareWebGLEffectBackend = () => true;
reentrantFullWebGLEffect._renderWebGL2ClickEffects = () => false;
reentrantFullWebGLEffect._renderSoftwareBloom = () =>
{
  reentrantFullWebGLSoftwareCount++;
};
reentrantFullWebGLEffect._drawCanvasClickEffects =
  (scale, useNativeBloom) =>
  {
    reentrantFullWebGLCompositeOperations.push(
      reentrantFullWebGLEffect.context.globalCompositeOperation,
    );

    if (useNativeBloom)
    {
      reentrantFullWebGLNativeCount++;
    }

    reentrantFullWebGLDraw(scale, useNativeBloom);
  };
reentrantFullWebGLEffect.canvas.addEventListener(
  BLOOM_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    reentrantFullWebGLEvents.push(event.detail);
  },
);

reentrantFullWebGLEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
const reentrantFullWebGLFirstRoute = reentrantFullWebGLEvents.slice(-2)
  .map((event) =>
    `${event.requestedBloomBackend}/${event.resolvedBloomBackend}`)
  .join(',');
assert(
  reentrantFullWebGLEffect.getConfig().bloomBackend === 'webgl2' &&
    reentrantFullWebGLEffect.getConfig().resolvedBloomBackend === 'native' &&
    reentrantFullWebGLFirstRoute ===
      'webgl2/webgl2,webgl2/native' &&
    reentrantFullWebGLSoftwareCount === 0 &&
    reentrantFullWebGLNativeCount >= 1 &&
    reentrantFullWebGLCompositeOperations.includes('lighter') &&
    reentrantFullWebGLEvents.filter((event) =>
      event.resolvedBloomBackend === 'software').length === 0,
  '完整 WebGL2 失败直接按 Native 路由重画当前帧',
);
reentrantFullWebGLEffect.destroy();

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
const attemptedWebGLCanvas = dom.createdCanvases
  .slice(canvasCountBeforeWebGLAttempt)
  .find((canvas) => dom.canvasMounts.some((mount) => mount.canvas === canvas));
const attemptedWebGLMount = dom.canvasMounts.find(
  (mount) => mount.canvas === attemptedWebGLCanvas,
);
const canvasCountAfterWebGLAttempt = dom.createdCanvases.length;

flushFrames(dom, webglFirstFrameTime, 1);

assert(
  dom.createdCanvases.length > canvasCountBeforeWebGLAttempt &&
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
    !Object.hasOwn(webglFallbackConfig, 'softwareBloomEnabled') &&
    webglFallbackConfig.resolvedBloomBackend === 'native',
  'getConfig() 保留 WebGL2 请求并公开实际 Native 回退结果',
);
assert(
  webglBackendEvents.length === 1 &&
    webglBackendEvents[0].requestedBloomBackend === 'webgl2' &&
    webglBackendEvents[0].resolvedBloomBackend === 'native',
  'WebGL2 首帧回退时在主 Canvas 派发后端解析状态事件',
);
assert(
  !webglEffect.context.drawImageCalls.some((call) =>
    call.args[0] === webglEffect.bloomRenderer.outputCanvas),
  'WebGL2 不可用时当前帧不执行 Software Bloom 回读',
);
const webglEventCountAfterFallback = webglBackendEvents.length;

webglEffect.updateConfig({ opacity: 0.8 });
flushFrames(dom, webglFirstFrameTime, 1);
assert(
  webglEffect.getConfig().resolvedBloomBackend === 'native' &&
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
  releaseFrameResources()
  {
    this.sourceTarget = null;
    this.levels = [];
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
const directAttemptedCanvas = dom.createdCanvases
  .slice(canvasCountBeforeDirectAttempt)
  .find((canvas) => dom.canvasMounts.some((mount) => mount.canvas === canvas));
const directAttemptedMount = dom.canvasMounts.find(
  (mount) => mount.canvas === directAttemptedCanvas,
);

assert(
  dom.createdCanvases.length > canvasCountBeforeDirectAttempt &&
    directAttemptedMount?.parent === dom.body &&
    directAttemptedCanvas.style.position === 'fixed' &&
    directAttemptedCanvas.removed,
  '直接合成模式下延迟创建的全屏 WebGL Canvas 挂到 body 并使用 fixed 定位',
);
directWebGLEffect.destroy();

const externalCanvas = new CanvasMock();
externalCanvas.style.mixBlendMode = 'screen';
const externalWebGLEffect = new BAClickFX(
  {
    target: externalCanvas,
    bloomBackend: 'webgl2',
    outputCompositing: 'browser-overlay',
    hostCompositing: 'plus-lighter',
  },
);
const canvasMountCountBeforeExternalFallback = dom.canvasMounts.length;

assert(
  externalWebGLEffect.getConfig().resolvedBloomBackend === 'native',
  '已有 Canvas target 无法承载独立 WebGL 层时同步给出已知回退后端',
);
assert(
  externalWebGLEffect.getConfig().isolatedCompositing === false,
  '已有 Canvas target 明确降级为直接合成',
);
assert(
  externalWebGLEffect._getCanvasOutputCompositing() === 'host-additive' &&
    externalCanvas.style.mixBlendMode === 'screen',
  '外部 Canvas 输出完整 Add 载荷但不覆盖调用方的混合样式',
);
externalWebGLEffect.updateConfig({ hostCompositing: 'source-over' });
externalWebGLEffect.updateConfig({ hostCompositing: 'plus-lighter' });
assert(
  externalCanvas.style.mixBlendMode === 'screen',
  '运行时切换宿主合成不会修改外部 Canvas 样式',
);
externalWebGLEffect.updateConfig(
  { hostCompositingSurface: 'transparent-window' },
);
assert(
  externalWebGLEffect._getCanvasOutputCompositing() === 'browser-overlay' &&
    externalWebGLEffect.getEffectiveHostCompositing() === 'source-over' &&
    externalCanvas.style.mixBlendMode === 'screen',
  '透明窗口让外部 Canvas 回退普通覆盖载荷且不篡改调用方样式',
);
externalWebGLEffect.updateConfig({ hostCompositingSurface: 'native' });
assert(
  externalWebGLEffect._getCanvasOutputCompositing() === 'host-additive' &&
    externalWebGLEffect.getEffectiveHostCompositing() === 'plus-lighter' &&
    externalCanvas.style.mixBlendMode === 'screen',
  '原生合成器继续从外部 Canvas 接收完整 Add 载荷',
);
externalWebGLEffect.updateConfig({ isolatedCompositing: true });
assert(
  externalWebGLEffect.getConfig().isolatedCompositing === false,
  '已有 Canvas target 在运行时也不能误报已启用隔离合成',
);
externalWebGLEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
const externalFallbackConfig = externalWebGLEffect.getConfig();

assert(
  dom.canvasMounts.length === canvasMountCountBeforeExternalFallback &&
    externalWebGLEffect.webglBloomCanvas === null &&
    externalFallbackConfig.resolvedBloomBackend === 'native',
  '已有 Canvas target 无法插入独立 GPU 层时直接回退 Native',
);
externalWebGLEffect.destroy();
assert(
  !externalCanvas.removed && externalCanvas.style.mixBlendMode === 'screen',
  '销毁实例不会移除外部 Canvas 或改写调用方混合样式',
);

const bloomSwitchEffect = new BAClickFX(
  {
    bloomBackend: 'native',
  },
);
const bloomSwitchEvents = [];

bloomSwitchEffect.canvas.addEventListener(BLOOM_BACKEND_CHANGE_EVENT, (event) =>
{
  bloomSwitchEvents.push(event.detail.resolvedBloomBackend);
});
let bloomSwitchConfig = bloomSwitchEffect.getConfig();

assert(
  bloomSwitchConfig.bloomBackend === 'native' &&
    !Object.hasOwn(bloomSwitchConfig, 'softwareBloomEnabled') &&
    bloomSwitchConfig.resolvedBloomBackend === 'native',
  '显式 Native Bloom 构造参数进入后端快照',
);
bloomSwitchEffect.updateConfig(
  {
    bloomBackend: 'software',
  },
);
bloomSwitchConfig = bloomSwitchEffect.getConfig();
assert(
  bloomSwitchConfig.bloomBackend === 'software' &&
    bloomSwitchConfig.resolvedBloomBackend === 'software',
  '显式 Software Bloom 更新参数切换软件后端',
);
bloomSwitchEffect.updateConfig(
  {
    bloomBackend: 'webgl2',
  },
);
bloomSwitchConfig = bloomSwitchEffect.getConfig();
assert(
  bloomSwitchConfig.bloomBackend === 'webgl2' &&
    bloomSwitchConfig.resolvedBloomBackend === 'pending',
  '显式 WebGL2 Bloom 更新在延迟探测前进入 pending',
);
bloomSwitchEffect.updateConfig({ bloomBackend: 'auto' });
assert(
  bloomSwitchEffect.getConfig().resolvedBloomBackend === 'pending',
  'pending 期间切换 auto 保持等待探测，不伪造回退结果',
);
flushFrames(dom, performance.now(), 1);
bloomSwitchConfig = bloomSwitchEffect.getConfig();
assert(
  bloomSwitchConfig.bloomBackend === 'auto' &&
    bloomSwitchConfig.resolvedBloomBackend === 'native',
  'auto 会优先尝试 WebGL2，并在当前环境回退 Native',
);
assert(
  bloomSwitchEvents.join(',') === 'software,pending,native',
  '运行时后端 API 按显式 Software、pending、Native 回退依次派发状态',
);
bloomSwitchEffect.destroy();

assertThrowsTypeError(
  () => new BAClickFX({ softwareBloomEnabled: true }),
  '构造函数拒绝已删除的 Software Bloom 布尔别名',
);
const strictUpdateEffect = new BAClickFX({ bloomBackend: 'native' });
const strictUpdateBefore = strictUpdateEffect.getConfig();

assertThrowsTypeError(
  () => strictUpdateEffect.updateConfig(
    {
      opacity: 0.5,
      softwareBloomEnabled: true,
    },
  ),
  'updateConfig 原子拒绝包含已删除字段的配置',
);
assert(
  strictUpdateEffect.getConfig().opacity === strictUpdateBefore.opacity &&
    strictUpdateEffect.getConfig().bloomBackend === strictUpdateBefore.bloomBackend,
  'updateConfig 校验失败不会留下部分状态修改',
);
strictUpdateEffect.destroy();

const contextLifecycleEffect = new BAClickFX(
  {
    // 此用例验证独立 Bloom Canvas 的 Context 生命周期；完整 WebGL2 会接管
    // 场景而不创建该输出层，必须显式选择 Canvas2D。
    effectBackend: 'canvas2d',
    bloomBackend: 'webgl2',
  },
);
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
contextLifecycleEffect.boom(120, 80);
flushFrames(dom, performance.now(), 1);
contextLifecycleEffect._handleWebGLContextLost();
contextLifecycleEffect._handleWebGLContextRestored();
flushFrames(dom, performance.now(), 1);
assert(
  contextLifecycleEvents.slice(0, 4).join(',') ===
    'webgl2,native,pending,webgl2',
  'WebGL Context 丢失与恢复按 WebGL2、Native、pending、WebGL2 更新状态',
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

const atomicEventCount = contextLifecycleEvents.length;

contextLifecycleEffect.updateConfig(
  { bloomBackend: 'webgl2' },
);
assert(
  contextLifecycleEffect.getConfig().resolvedBloomBackend === 'pending' &&
    contextLifecycleEvents.length === atomicEventCount + 1 &&
    contextLifecycleEvents.at(-1) === 'pending',
  '一次更新渲染模式与 Bloom 后端只派发最终 pending 状态',
);
contextLifecycleEffect.destroy();

const reentrantContextLossEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'webgl2',
    outputCompositing: 'browser-overlay',
  },
);
const reentrantContextLossEvents = [];
const reentrantContextLossDraw =
  reentrantContextLossEffect._drawCanvasFallbackFrame.bind(
    reentrantContextLossEffect,
  );
let reentrantContextLossSoftwareCount = 0;
let reentrantContextLossNativeCount = 0;

reentrantContextLossEffect.resolvedBloomBackend = 'webgl2';
reentrantContextLossEffect.webglBloomVisible = true;
reentrantContextLossEffect._renderSoftwareBloom = () =>
{
  reentrantContextLossSoftwareCount++;
};
reentrantContextLossEffect._drawCanvasFallbackFrame =
  (scale, useNativeBloom) =>
  {
    if (useNativeBloom)
    {
      reentrantContextLossNativeCount++;
    }

    reentrantContextLossDraw(scale, useNativeBloom);
  };
reentrantContextLossEffect.canvas.addEventListener(
  BLOOM_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    reentrantContextLossEvents.push(event.detail);
  },
);

reentrantContextLossEffect.boom(120, 80);
reentrantContextLossEffect._handleWebGLContextLost();
assert(
  reentrantContextLossEffect.getConfig().bloomBackend === 'webgl2' &&
    reentrantContextLossEffect.getConfig().resolvedBloomBackend === 'native' &&
    reentrantContextLossEvents
      .map((event) =>
        `${event.requestedBloomBackend}/${event.resolvedBloomBackend}`)
      .join(',') === 'webgl2/native' &&
    reentrantContextLossSoftwareCount === 0 &&
    reentrantContextLossNativeCount >= 1,
  'Context 丢失直接同步重画 Native 且不执行 Software 回读',
);
reentrantContextLossEffect.destroy();

const resizeRecoveryEffect = new BAClickFX(
  {
    bloomBackend: 'webgl2',
  },
);
const resizeRecoveryEvents = [];
const resizeRecoveryCanvas = document.createElement('canvas');
let resizeCanSucceed = false;
let resizeCallCount = 0;

resizeRecoveryEffect.overlayParent.appendChild(resizeRecoveryCanvas);
const resizeRecoveryRenderer =
{
  available: true,
  sourceTarget: null,
  levels: [],
  destroyed: false,
  resize()
  {
    resizeCallCount++;

    if (!resizeCanSucceed)
    {
      this.sourceTarget = null;
      this.levels = [];
      return false;
    }

    this.sourceTarget ??= true;

    if (this.levels.length === 0)
    {
      this.levels.push(true);
    }

    return true;
  },
  clear()
  {
  },
  releaseFrameResources()
  {
    this.sourceTarget = null;
    this.levels = [];
  },
  destroy()
  {
    this.available = false;
    this.destroyed = true;
  },
};

resizeRecoveryEffect.webglBloomCanvas = resizeRecoveryCanvas;
resizeRecoveryEffect.webglBloomRenderer = resizeRecoveryRenderer;
resizeRecoveryEffect.canvas.addEventListener(
  BLOOM_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    resizeRecoveryEvents.push(event.detail.resolvedBloomBackend);
  },
);

let resizeRecoveryNow = flushFrames(dom, performance.now(), 1);

assert(
  resizeRecoveryEffect.getConfig().resolvedBloomBackend === 'native' &&
    resizeRecoveryEvents.join(',') === 'native' &&
    resizeRecoveryEffect.webglBloomRenderer === resizeRecoveryRenderer &&
    resizeRecoveryEffect.webglBloomCanvas === resizeRecoveryCanvas &&
    !resizeRecoveryEffect.webglBloomUnavailable,
  'WebGL2 当前尺寸失败时稳定回退 Native，并保留可恢复的 renderer',
);
resizeRecoveryEffect._requestRender();
resizeRecoveryNow = flushFrames(dom, resizeRecoveryNow, 1);
assert(
  resizeRecoveryEvents.join(',') === 'native' &&
    resizeCallCount === 2,
  'WebGL2 尺寸持续失败时不重复派发后端状态事件',
);

resizeRecoveryEffect.updateConfig(
  {
    bloomBackend: 'auto',
  },
);
assert(
  resizeRecoveryEffect.getConfig().resolvedBloomBackend === 'native' &&
    resizeRecoveryEvents.join(',') === 'native',
  '配置切换不会仅凭可用 Context 把空目标误报为 WebGL2',
);
resizeRecoveryNow = flushFrames(dom, resizeRecoveryNow, 1);
resizeRecoveryRenderer.sourceTarget = true;
resizeRecoveryRenderer.levels = [];
resizeRecoveryEffect.updateConfig(
  {
    bloomBackend: 'webgl2',
  },
);
assert(
  resizeRecoveryEffect.getConfig().resolvedBloomBackend === 'native' &&
    resizeRecoveryEvents.join(',') === 'native',
  '缺少 Bloom 金字塔时仍公开实际回退后端',
);
resizeRecoveryNow = flushFrames(dom, resizeRecoveryNow, 1);
assert(
  resizeRecoveryEffect.getConfig().resolvedBloomBackend === 'native' &&
    resizeRecoveryEvents.join(',') === 'native',
  'Native 回退后仍按目标完整性公开实际后端',
);
resizeRecoveryNow = flushFrames(dom, resizeRecoveryNow, 1);

resizeCanSucceed = true;
resizeRecoveryEffect._requestRender();
resizeRecoveryNow = flushFrames(dom, resizeRecoveryNow, 1);
resizeRecoveryEffect._requestRender();
flushFrames(dom, resizeRecoveryNow, 1);
assert(
  resizeRecoveryEffect.getConfig().resolvedBloomBackend === 'webgl2' &&
    resizeRecoveryEvents.join(',') === 'native,webgl2' &&
    resizeRecoveryRenderer.sourceTarget &&
    resizeRecoveryRenderer.levels.length === 1,
  'WebGL2 尺寸恢复后只派发一次 WebGL2 恢复状态',
);
resizeRecoveryEffect.destroy();
assert(
  resizeRecoveryRenderer.destroyed && resizeRecoveryCanvas.removed,
  '可恢复 WebGL2 renderer 仍由实例销毁流程统一释放',
);

const softwareFailureEffect = new BAClickFX({ bloomBackend: 'software' });
const softwareFailureEvents = [];
let softwareFailureBeginFrameCount = 0;
let softwareFailureNativeRedrawCount = 0;
const softwareFailureFallbackDraw =
  softwareFailureEffect._drawCanvasFallbackFrame.bind(softwareFailureEffect);

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
  softwareFailureBeginFrameCount++;
  softwareFailureEffect.bloomRenderer.available = false;
  return null;
};
softwareFailureEffect._drawCanvasFallbackFrame =
  (scale, useNativeBloom) =>
  {
    if (useNativeBloom)
    {
      softwareFailureNativeRedrawCount++;
    }

    softwareFailureFallbackDraw(scale, useNativeBloom);
  };
softwareFailureEffect.boom(960, 540);
let softwareFailureNow = flushFrames(dom, performance.now(), 1);
assert(
  softwareFailureEffect.getConfig().resolvedBloomBackend === 'native' &&
    softwareFailureEvents.join(',') === 'native' &&
    softwareFailureNativeRedrawCount === 1,
  'Software Bloom 运行时回读失败会同帧重画并公开 Native 回退',
);
softwareFailureNow = flushFrames(dom, softwareFailureNow, 2);
assert(
  softwareFailureEffect.getConfig().resolvedBloomBackend === 'native' &&
    softwareFailureEvents.join(',') === 'native' &&
    softwareFailureBeginFrameCount === 1 &&
    Number.isFinite(softwareFailureNow),
  'Software 失败后稳定使用 Native，不重复回读或形成回退死循环',
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

console.log('\nTrailRenderer 几何');

function captureTexturedWebGLTrail(
  points,
  numCornerVertices = 0,
  numCapVertices = 0,
)
{
  const effect = new BAClickFX(
    {
      effectBackend: 'canvas2d',
      bloomBackend: 'native',
      inputSource: 'manual',
    },
  );
  const triangles = [];
  let fallbackTriangleCount = 0;
  const renderer =
  {
    available: true,
    contextLost: false,
    stats: {},
    beginFrame(options = {})
    {
      if (options.preserveSceneStats !== true)
      {
        triangles.length = 0;
      }
    },
    addTexturedTrailTriangle(...args)
    {
      triangles.push(args);
    },
    addTrailTriangle()
    {
      fallbackTriangleCount++;
    },
    renderScene()
    {
      return true;
    },
    render()
    {
      return true;
    },
    clear()
    {
    },
  };

  effect.fxConfig.trail.numCornerVertices = numCornerVertices;
  effect.fxConfig.trail.numCapVertices = numCapVertices;
  effect.trailStrokes =
  [
    {
      active: false,
      points: points.map((point) =>
      {
        return {
          ...point,
          bornAt: 0,
        };
      }),
      trailFrameData: null,
    },
  ];

  const rendered = effect._renderWebGL2Scene(renderer, 1);
  const trailEmission = effect.fxConfig.bloom.trailEmission;

  effect.destroy();
  return {
    fallbackTriangleCount,
    rendered,
    trailEmission,
    triangles,
  };
}

const straightWebGLTrail = captureTexturedWebGLTrail(
  [{ x: 0, y: 0 }, { x: 10, y: 0 }],
);
const straightVertices = straightWebGLTrail.triangles.flatMap((triangle) =>
  triangle.slice(0, 3));
const straightColors = straightWebGLTrail.triangles.flatMap((triangle) =>
  Array.isArray(triangle[3][0]) ? triangle[3] : [triangle[3]]);
const straightCoverages = straightWebGLTrail.triangles.flatMap((triangle) =>
  Array.isArray(triangle[5]) ? triangle[5] : [triangle[5]]);

assert(
  straightWebGLTrail.rendered &&
    straightWebGLTrail.triangles.length === 2 &&
    straightVertices.length === 6 &&
    straightWebGLTrail.fallbackTriangleCount === 0,
  '完整 WebGL2 直线拖尾只提交 2 个纹理三角，不再调用 LUT 顶点色路径',
);
assert(
  straightVertices.map(({ u, v }) => `${u}:${v}`).join(',') ===
    '1:1,0:1,0:0,1:1,0:0,1:0',
  '完整 WebGL2 按 Unity Stretch 方向映射直段 U/V',
);
assert(
  [straightColors[0], straightColors[3], straightColors[5]].every((color) =>
    color.every((channel) => channel === 0)) &&
    [straightColors[1], straightColors[2], straightColors[4]].every((color) =>
      color[2] === straightWebGLTrail.trailEmission),
  '拖尾 Gradient 使用旧点到新点进度，纹理 U 单独反向',
);
assert(
  JSON.stringify(straightCoverages) === JSON.stringify([0, 1, 1, 0, 1, 0]),
  'WebGL2 以独立顶点通道淡出 Coverage，不修改 Trail_03 RGB 发射',
);

const leftInnerJoin = captureTexturedWebGLTrail(
  [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
  4,
);
const rightInnerJoin = captureTexturedWebGLTrail(
  [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -10 }],
  4,
);
const leftJoinTriangles = leftInnerJoin.triangles.slice(4);
const rightJoinTriangles = rightInnerJoin.triangles.slice(4);

assert(
  leftJoinTriangles.length === 5 &&
    leftJoinTriangles.every((triangle) =>
      triangle.slice(0, 3).every((vertex) => vertex.u === 0.5) &&
      triangle.slice(0, 3).map((vertex) => vertex.v).join(',') === '1,0,0'),
  '左内角按 4 个 Unity 插入点生成 5 个固定 U 的纹理 fan',
);
assert(
  rightJoinTriangles.length === 5 &&
    rightJoinTriangles.every((triangle) =>
      triangle.slice(0, 3).every((vertex) => vertex.u === 0.5) &&
      triangle.slice(0, 3).map((vertex) => vertex.v).join(',') === '0,1,1'),
  '右内角保持与左内角相反的纹理 V 方向',
);

const cappedWebGLTrail = captureTexturedWebGLTrail(
  [{ x: 0, y: 0 }, { x: 10, y: 0 }],
  0,
  1,
);
const startCapVertices = cappedWebGLTrail.triangles[2].slice(0, 3);
const endCapVertices = cappedWebGLTrail.triangles[3].slice(0, 3);

assert(
  startCapVertices.map(({ u, v }) => `${u}:${v}`).join(',') ===
    '1:1,1:0,1:0.5' &&
    endCapVertices.map(({ u, v }) => `${u}:${v}`).join(',') ===
      '0:1,0:0.5,0:0',
  'Unity 单三角端帽固定端点 U，并把尖端映射到横截面 V=0.5',
);

const deferredTrailDataEffect = new BAClickFX(
  {
    effectBackend: 'webgl2',
    bloomBackend: 'webgl2',
    inputSource: 'manual',
  },
);

deferredTrailDataEffect.trailStrokes =
[
  {
    active: true,
    points:
    [
      { x: 10, y: 10, bornAt: 0 },
      { x: 20, y: 10, bornAt: 0 },
    ],
    trailFrameData: null,
  },
];
deferredTrailDataEffect._updateTrail(10, 1, false, false, true);
const texturedFrameData = deferredTrailDataEffect.trailStrokes[0].trailFrameData;

assert(
  texturedFrameData.measurement.segmentLengths.length === 2 &&
    texturedFrameData.pointEnergies === undefined &&
    texturedFrameData.segmentTransverseProfiles === undefined,
  '完整 WebGL2 正常帧只缓存网格测量，不再计算 Canvas 拖尾 LUT',
);
deferredTrailDataEffect._drawCanvasTrails(1, false, false);
const fallbackFrameData = deferredTrailDataEffect.trailStrokes[0].trailFrameData;

assert(
  fallbackFrameData.pointEnergies.length === 2 &&
    fallbackFrameData.segmentTransverseProfiles.length === 1,
  'WebGL2 失败转入 Canvas 时按需恢复完整拖尾 LUT 数据',
);
deferredTrailDataEffect.destroy();

const geometryEffect = new BAClickFX(
  {
    bloomBackend: 'native',
    inputSource: 'manual',
  },
);
let geometryNow = performance.now();

geometryEffect.pointerDown({ x: 100, y: 100, pointerId: 91 });
geometryEffect.waves.length = 0;
geometryEffect.shards.length = 0;

function renderCanvasTrailGeometry(points)
{
  geometryEffect.currentTrailStroke.points = points.map((point) =>
  {
    return {
      ...point,
      bornAt: geometryEffect.trailTimeMs,
    };
  });
  geometryEffect.context.filledPaths = [];
  geometryEffect.context.linearGradients = [];
  geometryEffect.context.drawImageCalls = [];

  if (geometryEffect.nativeTrailBloomSurface)
  {
    geometryEffect.nativeTrailBloomSurface.context.filledPaths = [];
    geometryEffect.nativeTrailBloomSurface.context.linearGradients = [];
    geometryEffect.nativeTrailBloomSurface.context.clearRectCalls = [];
  }

  geometryEffect._requestRender();
  geometryNow = flushFrames(dom, geometryNow, 1);

  const paths = geometryEffect.context.filledPaths;
  const segmentPaths = paths.slice(0, points.length - 1);
  const quads = segmentPaths.filter((path) =>
    path.length === 4);
  const joinedSegments = segmentPaths.filter((path) =>
    path.length === joinedTrailPathLength);
  const triangles = paths.filter((path) =>
    path.length === 3);
  const nativeSurface = geometryEffect.nativeTrailBloomSurface;

  return {
    paths,
    segmentPaths,
    quads,
    joinedSegments,
    triangles,
    gradients: geometryEffect.context.linearGradients,
    nativePaths: nativeSurface.context.filledPaths,
    nativeGradients: nativeSurface.context.linearGradients,
    nativeBlurDraws: geometryEffect.context.drawImageCalls.filter((call) =>
      call.filter !== 'none'),
    nativeClearRects: nativeSurface.context.clearRectCalls,
  };
}

function getPolygonArea(points)
{
  let doubleArea = 0;

  for (let index = 0; index < points.length; index++)
  {
    const current = points[index];
    const next = points[(index + 1) % points.length];

    doubleArea += current[0] * next[1] - current[1] * next[0];
  }

  return Math.abs(doubleArea) * 0.5;
}

const nativeNoOutputPoints =
[
  { x: 100, y: 100 },
  { x: 220, y: 100 },
];
const savedNativeOpacity = geometryEffect.config.opacity;
const savedNativeTrailAlpha = geometryEffect.fxConfig.bloom.trailAlpha;
const savedNativeTrailEmission = geometryEffect.fxConfig.bloom.trailEmission;

geometryEffect.updateConfig({ opacity: 0 });
const zeroOpacityGeometry = renderCanvasTrailGeometry(nativeNoOutputPoints);
geometryEffect.updateConfig({ opacity: savedNativeOpacity });
geometryEffect.setFxParam('bloom.trailAlpha', 0);
const zeroTrailAlphaGeometry = renderCanvasTrailGeometry(nativeNoOutputPoints);
geometryEffect.setFxParam('bloom.trailAlpha', savedNativeTrailAlpha);
geometryEffect.setFxParam('bloom.trailEmission', 0);
const zeroTrailEmissionGeometry = renderCanvasTrailGeometry(nativeNoOutputPoints);
geometryEffect.setFxParam('bloom.trailEmission', savedNativeTrailEmission);
const nativeNoOutputGeometries =
[
  zeroOpacityGeometry,
  zeroTrailAlphaGeometry,
  zeroTrailEmissionGeometry,
];

assert(
  nativeNoOutputGeometries.every((geometry) =>
    geometry.paths.length === 3 &&
      geometry.gradients.length === 3 &&
      geometry.nativePaths.length === 0 &&
      geometry.nativeGradients.length === 0 &&
      geometry.nativeClearRects.length === 0 &&
      geometry.nativeBlurDraws.length === 0),
  'Native 全局能量为零时跳过离屏层，清晰拖尾仍保持原有路径预算',
);

const savedLongitudinalKeys =
  geometryEffect.fxConfig.trail.textureLongitudinalKeys;
const savedTrailGradient = geometryEffect.fxConfig.trail.gradient;
const savedNumCapVertices = geometryEffect.fxConfig.trail.numCapVertices;

geometryEffect.fxConfig.trail.textureLongitudinalKeys =
[
  [0, 0],
  [0.999999, 0],
  [1, 1],
];
const endCapOnlyGeometry = renderCanvasTrailGeometry(nativeNoOutputPoints);
const endCapGradient = endCapOnlyGeometry.nativeGradients.at(-1)?.gradient;

assert(
  endCapOnlyGeometry.nativeBlurDraws.length === 1 &&
    endCapOnlyGeometry.nativePaths.length === 3 &&
    endCapGradient?.stops.some(([, color]) =>
      getCssPremultipliedEnergy(color) > 0),
  'segment 中点透明但 end cap 可见时继续生成 Native 模糊',
);

geometryEffect.setFxParam('trail.numCapVertices', 0);
const caplessTransparentGeometry = renderCanvasTrailGeometry(
  nativeNoOutputPoints,
);

assert(
  caplessTransparentGeometry.paths.length === 1 &&
    caplessTransparentGeometry.nativePaths.length === 0 &&
    caplessTransparentGeometry.nativeGradients.length === 0 &&
    caplessTransparentGeometry.nativeClearRects.length === 0 &&
    caplessTransparentGeometry.nativeBlurDraws.length === 0,
  '无端帽且所有实际 segment 透明时跳过 Native 离屏层',
);

geometryEffect.setFxParam('trail.numCapVertices', savedNumCapVertices);
geometryEffect.fxConfig.trail.gradient =
[
  [0, [255, 255, 255]],
  [1, [255, 255, 255]],
];
geometryEffect.fxConfig.trail.textureLongitudinalKeys =
[
  [0, 1],
  [0.0000000001, 0],
  [0.9999999999, 0],
  [1, 1],
];
const skippedEndpointGeometry = renderCanvasTrailGeometry(
  [
    { x: 100, y: 100 },
    { x: 100.0000005, y: 100 },
    { x: 220, y: 100 },
    { x: 220.0000005, y: 100 },
  ],
);

assert(
  skippedEndpointGeometry.paths.length === 3 &&
    skippedEndpointGeometry.nativePaths.length === 0 &&
    skippedEndpointGeometry.nativeClearRects.length === 0 &&
    skippedEndpointGeometry.nativeBlurDraws.length === 0,
  'Native 按实际网格端帽索引忽略退化首尾段的孤立能量',
);

geometryEffect.fxConfig.trail.textureLongitudinalKeys = savedLongitudinalKeys;
geometryEffect.fxConfig.trail.gradient = savedTrailGradient;

const rightAngleGeometry = renderCanvasTrailGeometry(
  [
    { x: 100, y: 100 },
    { x: 170, y: 100 },
    { x: 170, y: 170 },
  ],
);
const rightAngleFanCount = UNITY_FX_TOUCH.trail.numCornerVertices + 1;
const rightAngleJoinedSegment = rightAngleGeometry.joinedSegments[0];
const rightAngleInner = rightAngleJoinedSegment[1];
const rightAngleTurn = { x: 170, y: 100 };
const rightAngleOuterArc = rightAngleJoinedSegment.slice(2, -1);
const rightAngleNaturalOuterArc = [...rightAngleOuterArc].reverse();
const rightAngleOuterRadius = Math.hypot(
  rightAngleOuterArc[0][0] - rightAngleTurn.x,
  rightAngleOuterArc[0][1] - rightAngleTurn.y,
);

assert(
  rightAngleGeometry.segmentPaths.length === 2 &&
    rightAngleGeometry.quads.length === 1 &&
    rightAngleGeometry.joinedSegments.length === 1 &&
    rightAngleGeometry.triangles.length === 2 &&
    JSON.stringify(rightAngleInner) ===
      JSON.stringify(rightAngleGeometry.segmentPaths[1][0]) &&
    rightAngleJoinedSegment.length === rightAngleFanCount + 4 &&
    Math.abs(
      getPolygonArea(rightAngleJoinedSegment) -
        getPolygonArea(
          [
            rightAngleJoinedSegment[0],
            rightAngleInner,
            rightAngleNaturalOuterArc[0],
            rightAngleJoinedSegment.at(-1),
          ],
        ) -
        getPolygonArea([rightAngleInner, ...rightAngleNaturalOuterArc]),
    ) < 0.000001,
  '90 度折点共享内角，4 个插入点的 fan 并入前一段轮廓',
);
assert(
  rightAngleOuterArc.length ===
      UNITY_FX_TOUCH.trail.numCornerVertices + 2 &&
    rightAngleOuterArc.every(([x, y]) =>
      Math.abs(
        Math.hypot(x - rightAngleTurn.x, y - rightAngleTurn.y) -
          rightAngleOuterRadius,
      ) < 0.000001),
  '圆角保持半带宽半径，numCapVertices=1 生成两个三角端帽',
);
assert(
    rightAngleGeometry.paths.length === 4 &&
    rightAngleGeometry.gradients.length === 4 &&
    rightAngleGeometry.nativeGradients.length === 4 &&
    rightAngleGeometry.gradients.every(({ gradient }) =>
      gradient.stops.length === transverseStopCount) &&
    JSON.stringify(rightAngleGeometry.paths) ===
      JSON.stringify(rightAngleGeometry.nativePaths),
  '清晰层与 Native 离屏层共享同一 Canvas TrailRenderer 网格',
);
const oppositeTurnGeometry = renderCanvasTrailGeometry(
  [
    { x: 100, y: 170 },
    { x: 170, y: 170 },
    { x: 170, y: 100 },
  ],
);
const oppositeJoinedSegment = oppositeTurnGeometry.joinedSegments[0];
const oppositeInner = oppositeJoinedSegment.at(-2);
const oppositeOuterArc = oppositeJoinedSegment.slice(1, -2);

assert(
  oppositeTurnGeometry.segmentPaths.length === 2 &&
    oppositeTurnGeometry.joinedSegments.length === 1 &&
    JSON.stringify(oppositeInner) ===
      JSON.stringify(oppositeTurnGeometry.segmentPaths[1].at(-1)) &&
    Math.abs(
      getPolygonArea(oppositeJoinedSegment) -
        getPolygonArea(
          [
            oppositeJoinedSegment[0],
            oppositeOuterArc[0],
            oppositeInner,
            oppositeJoinedSegment.at(-1),
          ],
        ) -
        getPolygonArea([oppositeInner, ...oppositeOuterArc]),
    ) < 0.000001,
  '反向 90 度折点也保持 segment 与 fan 并集面积，不产生自交',
);

const sharpGeometry = renderCanvasTrailGeometry(
  [
    { x: 100, y: 100 },
    { x: 170, y: 100 },
    { x: 130, y: 140 },
  ],
);
const sharpJoinedSegment = sharpGeometry.joinedSegments[0];
const sharpTurn = { x: 170, y: 100 };
const sharpHalfWidth = Math.hypot(
  sharpJoinedSegment[2][0] - sharpTurn.x,
  sharpJoinedSegment[2][1] - sharpTurn.y,
);
const sharpInnerDistance = Math.hypot(
  sharpJoinedSegment[1][0] - sharpTurn.x,
  sharpJoinedSegment[1][1] - sharpTurn.y,
);

assert(
  sharpGeometry.segmentPaths.length === 2 &&
    sharpGeometry.quads.length === 1 &&
    sharpGeometry.joinedSegments.length === 1 &&
    sharpGeometry.triangles.length === 2 &&
    sharpJoinedSegment.flat().every(Number.isFinite) &&
    sharpInnerDistance > sharpHalfWidth &&
    sharpInnerDistance <= sharpHalfWidth * 4,
  '锐角拖尾保留有限 miter 和合并后的完整圆角 fan',
);

const foldedGeometry = renderCanvasTrailGeometry(
  [
    { x: 100, y: 100 },
    { x: 170, y: 100 },
    { x: 100, y: 101 },
  ],
);
const foldedTurn = { x: 170, y: 100 };
const foldedJointVertices =
[
  foldedGeometry.quads[0][1],
  foldedGeometry.quads[0][2],
  foldedGeometry.quads[1][0],
  foldedGeometry.quads[1][3],
];
const foldedHalfWidth = Math.hypot(
  foldedJointVertices[0][0] - foldedTurn.x,
  foldedJointVertices[0][1] - foldedTurn.y,
);

assert(
  foldedGeometry.quads.length === 2 &&
    foldedGeometry.joinedSegments.length === 0 &&
    foldedGeometry.triangles.length === 2 &&
    foldedGeometry.quads.flat(2).every(Number.isFinite) &&
    foldedJointVertices.every(([x, y]) =>
      Math.abs(
        Math.hypot(x - foldedTurn.x, y - foldedTurn.y) - foldedHalfWidth,
      ) < 0.000001),
  '近 180 度回折退化为稳定截面，不生成无限 miter',
);
const shortSeedGeometry = renderCanvasTrailGeometry(
  [
    { x: 100, y: 100 },
    { x: 100.5, y: 100 },
    { x: 100, y: 105.4 },
  ],
);

assert(
  shortSeedGeometry.segmentPaths.length === 2 &&
    shortSeedGeometry.quads.length === 2 &&
    shortSeedGeometry.joinedSegments.length === 0 &&
    shortSeedGeometry.quads.every((path) => getPolygonArea(path) > 0),
  'trailAlways 的 0.5px 短种子段在 miter 越界时保留独立截面',
);
const budgetPointCount = 64;
const budgetPoints = Array.from(
  { length: budgetPointCount },
  (_, index) =>
  ({
    x: 120 + index * 8,
    y: 200 + index % 2 * 8,
  }),
);
const transverseProfileDescriptor = Object.getOwnPropertyDescriptor(
  geometryEffect.fxConfig.trail,
  'textureTransverseProfileKeys',
);
let transverseProfileEvaluationCount = 0;
let budgetGeometry;

Object.defineProperty(
  geometryEffect.fxConfig.trail,
  'textureTransverseProfileKeys',
  {
    configurable: true,
    enumerable: transverseProfileDescriptor.enumerable,
    get()
    {
      transverseProfileEvaluationCount++;
      return transverseProfileDescriptor.value;
    },
  },
);

try
{
  budgetGeometry = renderCanvasTrailGeometry(budgetPoints);
}
finally
{
  Object.defineProperty(
    geometryEffect.fxConfig.trail,
    'textureTransverseProfileKeys',
    transverseProfileDescriptor,
  );
}

const budgetPointProfileIndices = [];

geometryEffect.currentTrailStroke.trailFrameData.pointTransverseProfiles
  .forEach((profile, index) =>
  {
    if (profile)
    {
      budgetPointProfileIndices.push(index);
    }
  });
const trailLayerDrawBudget = budgetPointCount + 1;
const nativeSkippedBudgetSegmentCount = 16;
const nativeTrailDrawBudget = trailLayerDrawBudget -
  nativeSkippedBudgetSegmentCount - 1;

assert(
  transverseProfileEvaluationCount === budgetPointCount + 1 &&
    JSON.stringify(budgetPointProfileIndices) === JSON.stringify([0, 63]),
  '64 点轨迹只计算 63 个段横截面和两个实际端帽横截面',
);
assert(
  budgetGeometry.segmentPaths.length === budgetPointCount - 1 &&
    budgetGeometry.quads.length === 1 &&
    budgetGeometry.joinedSegments.length === budgetPointCount - 2 &&
    budgetGeometry.triangles.length === 2 &&
    budgetGeometry.paths.length === trailLayerDrawBudget &&
    budgetGeometry.gradients.length === trailLayerDrawBudget &&
    budgetGeometry.gradients
      .slice(0, nativeSkippedBudgetSegmentCount)
      .every(({ gradient }) => gradient.stops.every(([, color]) =>
        getCssPremultipliedEnergy(color) === 0)) &&
    budgetGeometry.nativePaths.length === nativeTrailDrawBudget &&
    budgetGeometry.nativeGradients.length === nativeTrailDrawBudget &&
    JSON.stringify(budgetGeometry.nativePaths[0]) ===
      JSON.stringify(
        budgetGeometry.segmentPaths[nativeSkippedBudgetSegmentCount],
      ) &&
    JSON.stringify(budgetGeometry.nativePaths.at(-1)) ===
      JSON.stringify(budgetGeometry.paths.at(-1)),
  '64 点清晰层保持 65 次提交，Native 跳过 16 个零能量段和 start cap',
);
const budgetBlurDraw = budgetGeometry.nativeBlurDraws[0];
const budgetBlurArgs = budgetBlurDraw?.args ?? [];
const budgetDpr = geometryEffect.nativeTrailBloomSurface.dpr;
const [sourceX, sourceY, sourceWidth, sourceHeight,
  originX, originY, regionWidth, regionHeight] = budgetBlurArgs.slice(1);
// 检查实际提交的模糊支撑区，避免复制生产代码的校准系数和取整公式。
const budgetBlurRadius = Number(budgetBlurDraw?.filter.match(/^blur\(([\d.]+)px\)$/)?.[1]) /
  budgetDpr;
const budgetBlurSupport = budgetBlurRadius * 3;
const budgetNativeVertices = budgetGeometry.nativePaths.flat();

assert(
  budgetGeometry.nativeBlurDraws.length === 1 &&
    budgetBlurArgs[0] === geometryEffect.nativeTrailBloomSurface.canvas &&
    budgetGeometry.nativeClearRects.length === 1 &&
    JSON.stringify(budgetGeometry.nativeClearRects[0]) ===
      JSON.stringify(budgetBlurArgs.slice(1, 5)) &&
    sourceX === 0 && sourceY === 0 &&
    sourceWidth === Math.ceil(regionWidth * budgetDpr) &&
    sourceHeight === Math.ceil(regionHeight * budgetDpr) &&
    Number.isFinite(budgetBlurRadius) && budgetBlurRadius > 0 &&
    // 零能量前缀不应扩大缓冲，但所有可见顶点和三倍模糊半径必须容纳。
    originX > Math.min(...budgetPoints.map(({ x }) => x)) &&
    budgetNativeVertices.every(([x, y]) =>
      x - budgetBlurSupport >= originX &&
        x + budgetBlurSupport <= originX + regionWidth &&
        y - budgetBlurSupport >= originY &&
        y + budgetBlurSupport <= originY + regionHeight),
  'Native 只清理实际采样区域，并完整容纳可见轨迹与模糊支撑区',
);
const repeatedEndpointGeometry = renderCanvasTrailGeometry(
  [
    { x: 100, y: 100 },
    { x: 100, y: 100 },
    { x: 160, y: 100 },
    { x: 220, y: 100 },
    { x: 220, y: 100 },
  ],
);
const repeatedEndpointProfileIndices = [];
const repeatedEndpointSegmentLengths = geometryEffect.currentTrailStroke
  .trailFrameData.measurement.segmentLengths;

geometryEffect.currentTrailStroke.trailFrameData.pointTransverseProfiles
  .forEach((profile, index) =>
  {
    if (profile)
    {
      repeatedEndpointProfileIndices.push(index);
    }
  });

assert(
  JSON.stringify(repeatedEndpointProfileIndices) ===
      JSON.stringify([1, 3]) &&
    JSON.stringify(repeatedEndpointSegmentLengths) ===
      JSON.stringify([0, 0, 60, 60, 0]) &&
    repeatedEndpointGeometry.paths.length === 4 &&
    JSON.stringify(repeatedEndpointGeometry.paths) ===
      JSON.stringify(repeatedEndpointGeometry.nativePaths),
  '重复首尾点按真实端帽索引缓存横截面，并保持 Native 与清晰路径一致',
);
const straightBudgetPoints = Array.from(
  { length: budgetPointCount },
  (_, index) =>
  ({
    x: 100 + index * 8,
    y: 300,
  }),
);
const originalHypot = Math.hypot;
let segmentHypotCount = 0;
let straightBudgetGeometry;

Math.hypot = (...values) =>
{
  segmentHypotCount++;
  return originalHypot(...values);
};

try
{
  straightBudgetGeometry = renderCanvasTrailGeometry(straightBudgetPoints);
}
finally
{
  Math.hypot = originalHypot;
}

const straightSegmentLengths = geometryEffect.currentTrailStroke
  .trailFrameData.measurement.segmentLengths;

assert(
  segmentHypotCount === budgetPointCount - 1 &&
    straightSegmentLengths.length === budgetPointCount &&
    straightSegmentLengths[0] === 0 &&
    straightSegmentLengths.slice(1).every((length) => length === 8) &&
    straightBudgetGeometry.paths.length === budgetPointCount + 1,
  '64 点直线只测量 63 次段长，并让网格复用相同浮点结果',
);
const originalDevicePixelRatio = dom.windowMock.devicePixelRatio;
const dprTrailPoints = [
  { x: 120, y: 240 },
  { x: 220, y: 220 },
  { x: 320, y: 240 },
];
const dprBlurSizes = [1, 2].map((dpr) =>
{
  dom.windowMock.devicePixelRatio = dpr;
  geometryEffect.updateConfig({ maxDpr: 2 });
  const geometry = renderCanvasTrailGeometry(dprTrailPoints);
  const draw = geometry.nativeBlurDraws[0];
  assert(geometryEffect.dpr === dpr && geometry.nativeBlurDraws.length === 1,
    'DPR=' + dpr + ' 的 Native 拖尾只提交一次整体模糊');
  return Number(draw.filter.match(/^blur\(([\d.]+)px\)$/)?.[1]) / dpr;
});
assert(
  Number.isFinite(dprBlurSizes[0]) && dprBlurSizes[0] > 0 &&
    Math.abs(dprBlurSizes[0] - dprBlurSizes[1]) < 0.000001,
  'Native 拖尾在 DPR 1 和 2 下保持相同的 CSS 模糊尺寸',
);
dom.windowMock.devicePixelRatio = originalDevicePixelRatio;
geometryEffect.updateConfig({ maxDpr: 2 });
geometryEffect.pointerCancel(91);
geometryEffect.destroy();


console.log(`\n✅ ${passed} 项 FX_Touch 移植检查通过\n`);
