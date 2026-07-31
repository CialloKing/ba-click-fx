/**
 * FX_Touch 移植烟雾测试。
 *
 * 测试只锁定从 Unity 恢复出的行为参数和生命周期；不再维护旧调参 API。
 */

const sourceMode = process.argv.includes('--source');
const modulePath = sourceMode
  ? '../src/fx.js'
  : '../dist/ba-click-fx.js';
const module = await import(modulePath);
let ring3AlphaSource = null;
let circleTextureSource = null;
let trailTextureSource = null;
let trailCoverageSource = null;
let triangleTextureSource = null;
let trailCoverageGolden = null;
let createHash = null;
let webgl2EffectSourceText = null;
let webgl2BloomSourceText = null;

if (sourceMode)
{
  ring3AlphaSource = await import('../src/ring3-alpha.js');
  circleTextureSource = await import('../src/circle-texture.js');
  trailTextureSource = await import('../src/trail-texture.js');
  trailCoverageSource = await import('../src/trail-coverage.js');
  triangleTextureSource = await import('../src/triangle-texture.js');
  ({ createHash } = await import('node:crypto'));
  const { readFileSync } = await import('node:fs');

  trailCoverageGolden = JSON.parse(readFileSync(
    new URL('./trail-coverage-golden.json', import.meta.url),
    'utf8',
  ));
  webgl2EffectSourceText = readFileSync(
    new URL('../src/webgl2-effect.js', import.meta.url),
    'utf8',
  );
  webgl2BloomSourceText = readFileSync(
    new URL('../src/webgl2-bloom.js', import.meta.url),
    'utf8',
  );
}

const {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  CONFIG,
  DEFAULT_THEME_COLOR,
  EFFECT_BACKEND_CHANGE_EVENT,
  FX_PARAM_MIGRATIONS,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  UNITY_FX_TOUCH,
  applyFxParamPatch,
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

function getCanvasBrightness(value)
{
  const match = String(value).match(/^brightness\(([\d.e+-]+)\)$/i);

  return match ? Number(match[1]) : 1;
}

function getHardClipOffsets(stops)
{
  const offsets = [];

  for (let index = 1; index < stops.length; index++)
  {
    const [previousOffset, previousColor] = stops[index - 1];
    const [offset, color] = stops[index];

    if (
      offset === previousOffset &&
      (getCssAlpha(previousColor) > 0) !== (getCssAlpha(color) > 0)
    )
    {
      offsets.push(offset);
    }
  }

  return offsets;
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

const fxSchemaPaths = new Set(FX_PARAM_SCHEMA.map((entry) => entry.path));
const readUnityScalar = (path) => path.split('.').reduce(
  (value, key) => value[key],
  UNITY_FX_TOUCH,
);

assert(
  FX_PARAM_SCHEMA.length > 0 &&
    fxSchemaPaths.size === FX_PARAM_SCHEMA.length &&
    FX_PARAM_SCHEMA.every((entry) =>
      entry.default === readUnityScalar(entry.path)),
  '公开参数 schema 路径唯一且默认值来自 Unity 参数源',
);
assert(
  Object.isFrozen(FX_PARAM_SCHEMA) &&
    FX_PARAM_SCHEMA.every((entry) => Object.isFrozen(entry)) &&
    JSON.parse(JSON.stringify(FX_PARAM_SCHEMA)).length ===
      FX_PARAM_SCHEMA.length,
  '公开参数 schema 深只读且可直接 JSON 序列化',
);
assert(
  !fxSchemaPaths.has('rootDurationMs') &&
    !fxSchemaPaths.has('rings.colorKeys') &&
    !fxSchemaPaths.has('rings.textureUvMin'),
  '公开参数 schema 不暴露对象池元数据、曲线或纹理采样真值',
);
assert(UNITY_FX_TOUCH.rootDurationMs === 1000, '根粒子持续 1 秒');
assert(UNITY_FX_TOUCH.disk.lifetimeMs === 200, '短圆盘持续 0.2 秒');
// OriginalPrefab 直接序列化归一化 float；完整数组断言避免未来再次把
// 启用粒子的 RGB 提前取整成 8-bit 近似值。
const originalPrefabEnabledColorKeys =
[
  [
    [0, [255, 255, 255]],
    [0.1205921, [0.24056602 * 255, 0.39061815 * 255, 255]],
  ],
  [
    [0.1117723, [255, 255, 255]],
    [0.5000076, [0.2971698 * 255, 0.6532865 * 255, 255]],
    [1, [0.2971698 * 255, 0.6532865 * 255, 255]],
  ],
  [
    [0, [255, 255, 255]],
    [0.1823606, [255, 255, 255]],
    [0.282353, [0.3726415 * 255, 0.7731873 * 255, 255]],
    [0.4617685, [0.37254903 * 255, 0.7725491 * 255, 255]],
    [0.6617685, [0.3529412 * 255, 0.7294118 * 255, 0.9450981 * 255]],
    [0.8264744, [0.37254903 * 255, 0.7725491 * 255, 255]],
    [1, [0.37254903 * 255, 0.7725491 * 255, 255]],
  ],
];

assert(
  JSON.stringify(
    [
      UNITY_FX_TOUCH.disk.colorKeys,
      UNITY_FX_TOUCH.rings.colorKeys,
      UNITY_FX_TOUCH.shards.colorKeys,
    ],
  ) === JSON.stringify(originalPrefabEnabledColorKeys),
  '启用粒子的 Gradient RGB 保留 OriginalPrefab 归一化 float 真值',
);
assert(
  JSON.stringify(UNITY_FX_TOUCH.disk.sizeKeys) === JSON.stringify(
    [
      [0, 0.32583582, 2.4004734, 2.4004734],
      [0.21392822, 0.7159773, 0.9115745, 0.9115745],
      [1, 1, 0, 0],
    ],
  ),
  '短圆盘尺寸保留 Unity 的四字段 Hermite 关键帧',
);
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
  UNITY_FX_TOUCH.rings.textureUvMin === 0.0005000000237487257 &&
    UNITY_FX_TOUCH.rings.textureUvMax === 0.999500036239624,
  '圆环使用 Cylinder002 导出的精确 UV 范围采样 Ring3 Alpha',
);

if (sourceMode)
{
  const {
    RING3_ALPHA,
    RING3_ALPHA_HEIGHT,
    RING3_ALPHA_WIDTH,
    sampleRing3Alpha,
  } = ring3AlphaSource;
  const ring3AlphaHash = createHash('sha256')
    .update(RING3_ALPHA)
    .digest('hex');

  assert(
    RING3_ALPHA_WIDTH === 256 &&
      RING3_ALPHA_HEIGHT === 128 &&
      RING3_ALPHA.length === RING3_ALPHA_WIDTH * RING3_ALPHA_HEIGHT,
    'Ring3 Alpha LUT 解码为完整的 256x128 字节纹理',
  );
  assert(
    ring3AlphaHash ===
      '6c1d74367a72a0ac830b0f5fdd8f0ee93bc9453c9b8c3cc4d470c2becca9d220',
    'Ring3 Alpha LUT 的完整字节 SHA256 与解包纹理一致',
  );
  assert(
    webgl2EffectSourceText.includes('gl.R8') &&
      webgl2EffectSourceText.includes(
        'float textureAlpha = texture(u_texture, v_uv).r;',
      ) &&
      webgl2EffectSourceText.includes(
        'layout(location = 1) in vec2 a_uv;',
      ) &&
      !webgl2EffectSourceText.includes('a_textureAlpha') &&
      !webgl2EffectSourceText.includes('sampleTextureAlpha'),
    '完整 WebGL2 在 Fragment Shader 逐片元采样 Ring3 并执行溶解裁剪',
  );

  const finalShaderSource = webgl2EffectSourceText.match(
    /const FINAL_FRAGMENT_SHADER = `([\s\S]*?)`;/,
  )?.[1] ?? '';
  const sceneOverlayShaderSource = webgl2EffectSourceText.match(
    /const SCENE_OVERLAY_FRAGMENT_SHADER = `([\s\S]*?)`;/,
  )?.[1] ?? '';
  const transparentFinalStart = finalShaderSource.indexOf(
    'if (u_transparentOverlay)',
  );
  const sceneFinalStart = finalShaderSource.indexOf(
    'float maximumSrgb',
    transparentFinalStart,
  );
  const transparentFinalSource = finalShaderSource.slice(
    transparentFinalStart,
    sceneFinalStart,
  );

  for (const [label, source] of [
    ['完整 WebGL2', webgl2EffectSourceText],
    ['WebGL2 Bloom', webgl2BloomSourceText],
  ])
  {
    const prefilterShaderSource = source.match(
      /const PREFILTER_FRAGMENT_SHADER = `([\s\S]*?)`;/,
    )?.[1] ?? '';
    const downsampleShaderSource = source.match(
      /const DOWNSAMPLE_FRAGMENT_SHADER = `([\s\S]*?)`;/,
    )?.[1] ?? '';
    const upsampleShaderSource = source.match(
      /const UPSAMPLE_FRAGMENT_SHADER = `([\s\S]*?)`;/,
    )?.[1] ?? '';

    assert(
      prefilterShaderSource.includes('transportEnergy = contribution;') &&
        prefilterShaderSource.includes(
          'outColor = vec4(brightPass, transportEnergy);',
        ) &&
        !prefilterShaderSource.includes('clamp(filtered.a'),
      `${label} Prefilter 将 Bright Pass 最大通道作为独立传输上界`,
    );
    assert(
      downsampleShaderSource.includes('outColor = filtered;') &&
        upsampleShaderSource.includes('outColor = high + low;') &&
        !upsampleShaderSource.includes('max(clamp(high.a'),
      `${label} Bloom RGB 与传输 Alpha 共用同一 mip 加法链`,
    );
  }

  assert(
    transparentFinalSource.includes(
      '? clamp(scene.a, 0.0, 1.0)',
    ) &&
      transparentFinalSource.includes(
        'float bloomTransportAlpha = linearToSrgb(',
      ) &&
      transparentFinalSource.includes(
        'float requestedAlpha = sceneCoverage + bloomTransportAlpha;',
      ) &&
      transparentFinalSource.includes(
        'alpha / max(requestedAlpha, 0.000001)',
      ) &&
      transparentFinalSource.includes(
        'outColor = vec4(srgb * capacityScale, alpha);',
      ) &&
      !transparentFinalSource.includes('premultiplyScale') &&
      !transparentFinalSource.includes('maximumSrgb') &&
      sceneOverlayShaderSource.includes(
        'capacity / max(maximumEnergy, 0.000001)',
      ) &&
      sceneOverlayShaderSource.includes(
        'outColor = vec4(scene.rgb * scale, coverage);',
      ),
    '完整 WebGL2 独立预乘清晰 Coverage 与 Bloom 传输上界',
  );

  const nonSeparableSamples = [
    [129, 80],
    [136, 80],
    [129, 92],
    [136, 92],
  ].map(([x, y]) =>
    Math.round(sampleRing3Alpha(
      (x + 0.5) / RING3_ALPHA_WIDTH,
      (y + 0.5) / RING3_ALPHA_HEIGHT,
    ) * 255));
  const [topLeft, topRight, bottomLeft, bottomRight] = nonSeparableSamples;

  assert(
    JSON.stringify(nonSeparableSamples) ===
      JSON.stringify([243, 239, 246, 226]) &&
      topLeft * bottomRight - topRight * bottomLeft === -3876,
    'Ring3 Alpha 保留无法由 U/V 一维曲线乘积表达的二维采样差异',
  );

  const {
    CIRCLE_TEXTURE_RGBA,
    CIRCLE_TEXTURE_SIZE,
  } = circleTextureSource;
  const firstCircleOffset = (24 * CIRCLE_TEXTURE_SIZE + 256) * 4;
  const secondCircleOffset = (25 * CIRCLE_TEXTURE_SIZE + 234) * 4;

  assert(
    CIRCLE_TEXTURE_SIZE === 512 &&
      CIRCLE_TEXTURE_RGBA.length === 512 * 512 * 4,
    'Circle_01 解码为完整的 512x512 RGBA 纹理',
  );
  assert(
    CIRCLE_TEXTURE_RGBA[firstCircleOffset] ===
        CIRCLE_TEXTURE_RGBA[secondCircleOffset] &&
      CIRCLE_TEXTURE_RGBA[firstCircleOffset + 1] !==
        CIRCLE_TEXTURE_RGBA[secondCircleOffset + 1],
    'Circle_01 保留同半径同 R 采样下无法由径向曲线表达的 G 通道差异',
  );

  const {
    TRAIL_TEXTURE_COVERAGE,
    TRAIL_TEXTURE_HEIGHT,
    TRAIL_TEXTURE_RGB,
    TRAIL_TEXTURE_RGBA,
    TRAIL_TEXTURE_WIDTH,
  } = trailTextureSource;
  const trailTextureHash = createHash('sha256')
    .update(TRAIL_TEXTURE_RGB)
    .digest('hex');
  const trailCoverageHash = createHash('sha256')
    .update(TRAIL_TEXTURE_COVERAGE)
    .digest('hex');
  const trailPixelCount = TRAIL_TEXTURE_WIDTH * TRAIL_TEXTURE_HEIGHT;
  let trailRgbaMatchesAssets = true;

  for (let pixel = 0; pixel < trailPixelCount; pixel++)
  {
    const rgbOffset = pixel * 3;
    const rgbaOffset = pixel * 4;

    if (
      TRAIL_TEXTURE_RGBA[rgbaOffset] !== TRAIL_TEXTURE_RGB[rgbOffset] ||
      TRAIL_TEXTURE_RGBA[rgbaOffset + 1] !==
        TRAIL_TEXTURE_RGB[rgbOffset + 1] ||
      TRAIL_TEXTURE_RGBA[rgbaOffset + 2] !==
        TRAIL_TEXTURE_RGB[rgbOffset + 2] ||
      TRAIL_TEXTURE_RGBA[rgbaOffset + 3] !== TRAIL_TEXTURE_COVERAGE[pixel]
    )
    {
      trailRgbaMatchesAssets = false;
      break;
    }
  }

  const firstTrailPixel = [...TRAIL_TEXTURE_RGB.subarray(0, 3)];
  const upperTrailOffset = (13 * TRAIL_TEXTURE_WIDTH + 20) * 3;
  const lowerTrailOffset = (498 * TRAIL_TEXTURE_WIDTH + 20) * 3;

  assert(
      TRAIL_TEXTURE_WIDTH === 512 &&
      TRAIL_TEXTURE_HEIGHT === 512 &&
      TRAIL_TEXTURE_RGB.length === 512 * 512 * 3 &&
      TRAIL_TEXTURE_COVERAGE.length === 512 * 512 &&
      TRAIL_TEXTURE_RGBA.length === 512 * 512 * 4,
    'Trail_03 解码为完整的 512x512 RGB 与 Coverage RGBA 纹理',
  );
  assert(
    trailTextureHash ===
      '9ef29db2147501c40c1ff0f1cd0848cd6e017a46b0e8aa0af685eef568d4faa0',
    'Trail_03 RGB 的完整字节 SHA256 与解包纹理一致',
  );
  assert(
    trailCoverageHash === trailCoverageGolden.sha256 &&
      trailCoverageHash ===
        '172b0c1b69a4fca13fcbde72c5071c8e4e7e1459dba13042818f399e5a697216' &&
      trailCoverageGolden.counts.partial === 123210 &&
      trailCoverageGolden.samples.every(({ x, y, coverage }) =>
        TRAIL_TEXTURE_COVERAGE[y * TRAIL_TEXTURE_WIDTH + x] === coverage),
    'Trail_03 独立 Coverage 的哈希、灰阶数量和 Golden 采样保持固定',
  );
  assert(
    trailRgbaMatchesAssets,
    'Trail_03 RGBA 分别保留原 RGB 与独立 Coverage 字节',
  );
  assert(
    JSON.stringify(firstTrailPixel) === JSON.stringify([5, 0, 0]) &&
      TRAIL_TEXTURE_RGB[upperTrailOffset + 1] === 71 &&
      TRAIL_TEXTURE_RGB[lowerTrailOffset + 1] === 131,
    'Trail_03 保留逐通道差异和不可由对称横截面表达的纹理细节',
  );
}
if (sourceMode)
{
  const {
    TRIANGLE_TEXTURE_COVERAGE,
    TRIANGLE_TEXTURE_OVERLAY_RGBA,
    TRIANGLE_TEXTURE_RGBA,
    TRIANGLE_TEXTURE_SIZE,
  } = triangleTextureSource;
  const coverageHash = createHash('sha256')
    .update(TRIANGLE_TEXTURE_COVERAGE)
    .digest('hex');
  let overlayMatchesAssets = true;
  let correctedTexels = 0;

  for (let index = 0; index < TRIANGLE_TEXTURE_COVERAGE.length; index++)
  {
    const offset = index * 4;

    correctedTexels += Number(
      TRIANGLE_TEXTURE_COVERAGE[index] !== TRIANGLE_TEXTURE_RGBA[offset + 3],
    );
    overlayMatchesAssets &&=
      TRIANGLE_TEXTURE_OVERLAY_RGBA[offset] ===
        TRIANGLE_TEXTURE_RGBA[offset] &&
      TRIANGLE_TEXTURE_OVERLAY_RGBA[offset + 1] ===
        TRIANGLE_TEXTURE_RGBA[offset + 1] &&
      TRIANGLE_TEXTURE_OVERLAY_RGBA[offset + 2] ===
        TRIANGLE_TEXTURE_RGBA[offset + 2] &&
      TRIANGLE_TEXTURE_OVERLAY_RGBA[offset + 3] ===
        TRIANGLE_TEXTURE_COVERAGE[index];
  }

  assert(
    TRIANGLE_TEXTURE_SIZE === 128 &&
      TRIANGLE_TEXTURE_COVERAGE.length === 128 * 128 &&
      coverageHash ===
        '9c45a4c8a83458648715ac47f758d9a046c65287f09ce124ee88d6f9b0aa39a8' &&
      correctedTexels === 179,
    '三角碎片独立 Coverage 的尺寸、哈希和修正范围保持固定',
  );
  assert(
    overlayMatchesAssets,
    '三角透明覆盖纹理只替换 Alpha 并保持原 RGB 字节',
  );
}
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
assert(
  UNITY_FX_TOUCH.shards.maxCount === 50,
  'Ring (4) 保留 Prefab 每个 FX_Touch 实例 50 枚粒子上限',
);
assert(UNITY_FX_TOUCH.trail.lifetimeMs === 300, 'TrailRenderer.time 为 0.3 秒');
assert(UNITY_FX_TOUCH.trail.geometryWidth === 2.7, '1080p TrailRenderer 几何带宽为 2.7px');
assert(UNITY_FX_TOUCH.trail.width === 2.7, '清晰拖尾本体使用 Unity 的 2.7px 带宽');
assert(
  UNITY_FX_TOUCH.trail.numCornerVertices === 4 &&
    UNITY_FX_TOUCH.trail.numCapVertices === 1,
  'TrailRenderer 使用 4 个圆角插入点和 1 个端帽顶点',
);
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
assert(
  JSON.stringify(UNITY_FX_TOUCH.trail.coverageLongitudinalKeys) ===
    JSON.stringify(
      [
        [0, 0],
        [0.248532, 0],
        [0.97941558, 1],
        [1, 1],
      ],
    ),
  '透明拖尾使用独立的旧端零 Coverage 与头部完整 Coverage 锚点',
);

if (sourceMode)
{
  const coverageKeys = UNITY_FX_TOUCH.trail.coverageLongitudinalKeys;
  const coverageSamples = Array.from({ length: 101 }, (_, index) =>
    trailCoverageSource.evaluateTrailLongitudinalCoverage(
      coverageKeys,
      index / 100,
    ));
  const asymmetricCoverageProfile =
    trailCoverageSource.evaluateTrailTextureCoverageProfile(1 - 20 / 511);

  assert(
    trailCoverageSource.evaluateTrailLongitudinalCoverage(
      coverageKeys,
      0.248532,
    ) === 0 &&
      trailCoverageSource.evaluateTrailLongitudinalCoverage(
        coverageKeys,
        0.61397379,
      ) === 0.5 &&
      trailCoverageSource.evaluateTrailLongitudinalCoverage(
        coverageKeys,
        0.97941558,
      ) === 1 &&
      coverageSamples.every((value, index, values) =>
        value >= 0 && value <= 1 &&
          (index === 0 || value >= values[index - 1])),
    '拖尾纵向 Coverage 以 smootherstep 有界单调连接两个平坦端点',
  );
  assert(
    asymmetricCoverageProfile.length === 17 &&
      asymmetricCoverageProfile[1][1] >
        asymmetricCoverageProfile.at(-2)[1] + 0.03 &&
      Math.max(...asymmetricCoverageProfile.map(([, value]) => value)) === 1,
    'Canvas 后端从固定二维 Coverage 资产采样非对称横截面',
  );
}
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
const joinedTrailPathLength =
  UNITY_FX_TOUCH.trail.numCornerVertices + 5;

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
assert(CONFIG.effectBackend === 'webgl2', '默认由纯 WebGL2 接管完整特效');
assert(CONFIG.bloomBackend === 'webgl2', '默认使用 WebGL2 Bloom 后端');
assert(CONFIG.isolatedCompositing === false, '默认直接与页面加色，保持游戏合成顺序');
assert(CONFIG.inputSource === 'dom', '默认由 DOM 指针事件驱动输入');
assert(
  CONFIG.clickTimeScale === 1 && CONFIG.trailTimeScale === 1,
  '点击与拖尾的默认时间倍率均为 1',
);
assert(
  DEFAULT_THEME_COLOR === '#4ca7ff' &&
    CONFIG.themeColor === DEFAULT_THEME_COLOR,
  '正式入口导出默认游戏蓝并纳入基础配置',
);
assert(
  BLOOM_BACKEND_CHANGE_EVENT === 'baclickfxbackendchange',
  '导出 Bloom 后端解析状态事件名，调用方无需硬编码字符串',
);
assert(
  EFFECT_BACKEND_CHANGE_EVENT === 'baclickfxeffectbackendchange',
  '导出完整特效后端解析状态事件名，调用方无需硬编码字符串',
);
assert(
  FX_PARAM_SCHEMA_VERSION === 1 &&
    FX_PARAM_MIGRATIONS[0]?.changes[0]?.kind === 'replace' &&
    FX_PARAM_MIGRATIONS[0]?.changes[0]?.from === 'bloom.scatter' &&
    FX_PARAM_MIGRATIONS[0]?.changes[0]?.to === 'bloom.diffusion' &&
    FX_PARAM_MIGRATIONS[0]?.changes[0]?.source?.type === 'number' &&
    FX_PARAM_MIGRATIONS[0]?.changes[0]?.source?.min === 0 &&
    !('max' in FX_PARAM_MIGRATIONS[0].changes[0].source) &&
    FX_PARAM_MIGRATIONS[0]?.changes[0]?.value === 7,
  '正式入口导出参数 Schema 版本与迁移合同',
);

const standalonePatch =
{
  'bloom.scatter': 7,
  'rings.hdrIntensity': 6.2,
};
const standalonePatchSnapshot = JSON.stringify(standalonePatch);
const standalonePatchResult = applyFxParamPatch(
  standalonePatch,
  {
    schemaVersion: 0,
    strict: true,
  },
);

assert(
  standalonePatchResult.committed === true &&
    !('nextConfig' in standalonePatchResult) &&
    standalonePatchResult.applied.some((entry) =>
      entry.path === 'bloom.diffusion' && entry.value === 7) &&
    standalonePatchResult.applied.some((entry) =>
      entry.path === 'rings.hdrIntensity' && entry.value === 6.2) &&
    standalonePatchResult.normalized.some((entry) =>
      entry.reason === 'renamed') &&
    standalonePatchResult.normalized.some((entry) =>
      entry.reason === 'defaulted' && entry.from === 7 && entry.to === 7) &&
    JSON.stringify(standalonePatch) === standalonePatchSnapshot,
  '包根 applyFxParamPatch 无实例迁移补丁且不暴露候选配置树',
);

const standaloneStrictResult = applyFxParamPatch(
  {
    'rings.count': 4,
    'unknown.path': 1,
  },
  { strict: true },
);

assert(
  standaloneStrictResult.committed === false &&
    standaloneStrictResult.applied.length === 0 &&
    standaloneStrictResult.rejected[0]?.path === 'unknown.path' &&
    standaloneStrictResult.rejected[0]?.reason === 'unknown-path' &&
    !('nextConfig' in standaloneStrictResult),
  '包根 applyFxParamPatch 严格模式原子拒绝非法补丁',
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
const explicitEffectBackendConfig = createConfig(
  {
    effectBackend: 'webgl2',
    bloomBackend: 'native',
  },
);
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
const minimumTimeScaleConfig = createConfig(
  {
    clickTimeScale: 0.01,
    trailTimeScale: 0.01,
  },
);
const invalidHostControlConfig = createConfig(
  {
    inputSource: 'electron',
    clickTimeScale: 0.009,
    trailTimeScale: 0,
  },
);
const themedConfig = createConfig({ themeColor: '#FF6969' });

assert(
  nativeAliasConfig.bloomBackend === 'native' &&
    nativeAliasConfig.softwareBloomEnabled === false &&
    nativeAliasConfig.effectBackend === 'canvas2d',
  'createConfig 同步旧布尔别名并保留 Canvas2D 兼容路径',
);
assert(
  explicitBackendConfig.bloomBackend === 'webgl2' &&
    explicitBackendConfig.softwareBloomEnabled === true &&
    explicitBackendConfig.effectBackend === 'canvas2d',
  'createConfig 中显式 Bloom 后端优先于旧别名并保留原路径',
);
assert(
  invalidBackendConfig.bloomBackend === CONFIG.bloomBackend,
  'createConfig 忽略无效 Bloom 后端并恢复默认值',
);
assert(
  explicitEffectBackendConfig.effectBackend === 'webgl2' &&
    invalidEffectBackendConfig.effectBackend === CONFIG.effectBackend,
  'createConfig 保留显式纯 WebGL2 并忽略无效完整特效后端',
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
  minimumTimeScaleConfig.clickTimeScale === 0.01 &&
    minimumTimeScaleConfig.trailTimeScale === 0.01,
  'createConfig 接受 0.01 的最低时间倍率',
);
assert(
  invalidHostControlConfig.inputSource === CONFIG.inputSource &&
    invalidHostControlConfig.clickTimeScale === CONFIG.clickTimeScale &&
    invalidHostControlConfig.trailTimeScale === CONFIG.trailTimeScale,
  'createConfig 忽略无效输入模式与低于 0.01 的时间倍率',
);
assert(
  themedConfig.themeColor === '#ff6969' &&
    createConfig({ themeColor: 'red' }).themeColor === DEFAULT_THEME_COLOR,
  'createConfig 规范化主题色并让非法值恢复游戏蓝',
);

console.log('\n指针生命周期');
const dom = installDom();
const paramApiEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'native',
    inputSource: 'manual',
    themeColor: '#FF6969',
  },
);
assert(
  paramApiEffect.getConfig().themeColor === '#ff6969',
  '构造参数主题色进入可读取的实例配置快照',
);
const singleParamAccepted = paramApiEffect.setFxParam(
  'rings.rotationDirection',
  -1,
);
const singleParamRejected = paramApiEffect.setFxParam(
  'bloom.intensity',
  Number.NaN,
);

assert(
  singleParamAccepted === true &&
    singleParamRejected === false &&
    paramApiEffect.getFxConfig().rings.rotationDirection === -1,
  'setFxParam 返回可检测结果且非法值不改变配置',
);

const partialBatchResult = paramApiEffect.setFxParams(
  {
    'hit.enabled': 0,
    'rings.count': 128,
    'unknown.path': 1,
  },
);

assert(
  partialBatchResult.committed === true &&
    !('nextConfig' in partialBatchResult) &&
    partialBatchResult.applied.length === 2 &&
    partialBatchResult.normalized.some((entry) =>
      entry.path === 'hit.enabled' && entry.to === false) &&
    partialBatchResult.normalized.some((entry) =>
      entry.path === 'rings.count' && entry.to === 64) &&
    partialBatchResult.rejected[0]?.reason === 'unknown-path' &&
    paramApiEffect.getFxConfig().hit.enabled === false &&
    paramApiEffect.getFxConfig().rings.count === 64,
  'setFxParams 非严格模式原子提交有效项并报告规范化与拒绝项',
);

const migratedBatchResult = paramApiEffect.setFxParams(
  {
    'bloom.scatter': 7,
  },
  {
    schemaVersion: 0,
    strict: true,
  },
);

assert(
  migratedBatchResult.committed === true &&
    migratedBatchResult.applied[0]?.path === 'bloom.diffusion' &&
    migratedBatchResult.applied[0]?.value === 7 &&
    migratedBatchResult.normalized.some((entry) =>
      entry.reason === 'renamed') &&
    migratedBatchResult.normalized.some((entry) =>
      entry.reason === 'defaulted' && entry.from === 7 && entry.to === 7) &&
    paramApiEffect.getFxConfig().bloom.diffusion === 7,
  'setFxParams 将 bloom.scatter 迁移为 diffusion 默认值',
);

const beforeStrictInvalidMigration = paramApiEffect.getFxConfig();
const strictInvalidMigrationResult = paramApiEffect.setFxParams(
  {
    'bloom.scatter': -0.01,
    'rings.count': 2,
  },
  {
    schemaVersion: 0,
    strict: true,
  },
);

assert(
  strictInvalidMigrationResult.committed === false &&
    strictInvalidMigrationResult.applied.length === 0 &&
    strictInvalidMigrationResult.normalized.length === 0 &&
    strictInvalidMigrationResult.rejected[0]?.path === 'bloom.scatter' &&
    strictInvalidMigrationResult.rejected[0]?.value === -0.01 &&
    strictInvalidMigrationResult.rejected[0]?.reason === 'out-of-range' &&
    JSON.stringify(paramApiEffect.getFxConfig()) ===
      JSON.stringify(beforeStrictInvalidMigration),
  'setFxParams strict 模式拒绝负数 scatter 并整批回滚',
);

const migrationConflictResult = paramApiEffect.setFxParams(
  {
    'bloom.scatter': 0.35,
    'bloom.diffusion': 6,
  },
  {
    schemaVersion: 0,
  },
);

assert(
  migrationConflictResult.committed === true &&
    migrationConflictResult.applied.length === 1 &&
    migrationConflictResult.applied[0]?.path === 'bloom.diffusion' &&
    migrationConflictResult.applied[0]?.value === 6 &&
    migrationConflictResult.rejected[0]?.path === 'bloom.scatter' &&
    migrationConflictResult.rejected[0]?.value === 0.35 &&
    migrationConflictResult.rejected[0]?.reason === 'migration-conflict' &&
    migrationConflictResult.rejected[0]?.targetPath === 'bloom.diffusion' &&
    paramApiEffect.getFxConfig().bloom.diffusion === 6,
  '实例迁移冲突始终由显式 diffusion 新路径获胜',
);

const beforeStrictMigrationConflict = paramApiEffect.getFxConfig();
const strictMigrationConflictResult = paramApiEffect.setFxParams(
  {
    'bloom.scatter': 1,
    'bloom.diffusion': 8,
  },
  {
    schemaVersion: 0,
    strict: true,
  },
);

assert(
  strictMigrationConflictResult.committed === false &&
    strictMigrationConflictResult.applied.length === 0 &&
    strictMigrationConflictResult.rejected[0]?.reason ===
      'migration-conflict' &&
    JSON.stringify(paramApiEffect.getFxConfig()) ===
      JSON.stringify(beforeStrictMigrationConflict),
  '实例 strict 迁移冲突整批回滚且不改变当前配置',
);

const beforeStrictBatch = paramApiEffect.getFxConfig();
const strictBatchResult = paramApiEffect.setFxParams(
  {
    'rings.count': 2,
    'rings.notReal': 1,
  },
  { strict: true },
);

assert(
  strictBatchResult.committed === false &&
    strictBatchResult.applied.length === 0 &&
    JSON.stringify(paramApiEffect.getFxConfig()) ===
      JSON.stringify(beforeStrictBatch),
  'setFxParams 严格模式在任一拒绝项出现时回滚整批',
);
paramApiEffect.destroy();
assert(
  paramApiEffect.setFxParams({ 'rings.count': 1 }).rejected[0]?.reason ===
    'destroyed',
  '销毁后的批量参数写入返回可检测拒绝原因',
);

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
    isolatedCompositing: true,
    lightBackgroundContrastAlpha: 0.35,
  },
);
assert(
  effect.getConfig().effectBackend === 'canvas2d' &&
  effect.getConfig().bloomBackend === 'webgl2' &&
    effect.getConfig().resolvedBloomBackend === 'pending',
  'Canvas2D 实例在延迟能力探测前请求 WebGL2 Bloom 并公开 pending',
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
const isPrimaryRingStop = ([offset]) =>
  Math.abs(
    offset * UNITY_FX_TOUCH.rings.arcSamples -
      Math.round(offset * UNITY_FX_TOUCH.rings.arcSamples),
  ) < 0.000000000001;
const earlierPrimaryStops = earlierStops.filter(isPrimaryRingStop);
const laterPrimaryStops = laterStops.filter(isPrimaryRingStop);
const earlierSurvivingStops = earlierPrimaryStops.filter(([, color]) =>
  getCssAlpha(color) > 0);
const laterSurvivingStops = laterPrimaryStops.filter(([, color]) =>
  getCssAlpha(color) > 0);
const earlierHardClipOffsets = earlierRing.gradients.flatMap((gradient) =>
  getHardClipOffsets(gradient.stops));

assert(
  earlierRing.fillCount === UNITY_FX_TOUCH.rings.radialSamples &&
    earlierRing.gradients.length === UNITY_FX_TOUCH.rings.radialSamples &&
    earlierRing.fillStyles.every((style, index) =>
      style === earlierRing.gradients[index]),
  '圆环用 radialSamples 条 conic gradient 环带还原纹理径向亮度',
);
assert(
  earlierRing.gradients.every((gradient) =>
    gradient.stops.length >= UNITY_FX_TOUCH.rings.arcSamples + 1 &&
      gradient.stops[0][0] === 0 &&
      gradient.stops.at(-1)[0] === 1) &&
    earlierPrimaryStops.length ===
      UNITY_FX_TOUCH.rings.radialSamples *
        (UNITY_FX_TOUCH.rings.arcSamples + 1),
  '每条径向环带保留完整主采样，并允许插入 Ring3 clip 边界',
);
assert(
  earlierHardClipOffsets.length >= UNITY_FX_TOUCH.rings.radialSamples * 2 &&
    earlierHardClipOffsets.every((offset) => offset > 0 && offset < 1),
  'Ring3 clip 边界用同 offset 的透明与可见 stop 保持硬跳变',
);
assert(
  laterSurvivingStops.length < earlierSurvivingStops.length,
  '生命周期晚期溶解阈值升高，通过 clip 的纹理采样点更少',
);
const colorProbeOffset = 0.3125;
const edgeProbeColor = earlierRing.gradients[0].stops.find(
  ([offset]) => offset === colorProbeOffset,
)?.[1];
const centerProbeColor = earlierRing.gradients[
  Math.floor(UNITY_FX_TOUCH.rings.radialSamples * 0.5)
].stops.find(([offset]) => offset === colorProbeOffset)?.[1];
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
    lastBloomCompositeSettings.outputCompositing === 'scene' &&
    !('iterations' in lastBloomCompositeSettings),
  '软件 Bloom 合成保留 Scene 输出、MXFinalBloom diffusion 且不再传旧迭代数',
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
  const diskDrawStart = effect.bloomRenderer.sourceContext.drawImageCalls.length;
  probeWave.drawBloom(effect.bloomRenderer.sourceContext, 1, 1);

  const ringPeak = effect.bloomRenderer.sourceContext.conicGradients
    .flatMap((entry) => entry.gradient.stops)
    .reduce(
      (maximum, [, color]) => Math.max(maximum, getCssColorEnergy(color)),
      0,
    );
  const diskDraw = effect.bloomRenderer.sourceContext.drawImageCalls
    .slice(diskDrawStart)
    .find((call) =>
      call.args[0]?.width === 512 && call.args[0]?.height === 512);
  const diskTextureCanvas = diskDraw?.args[0];
  const brightnessDraw = diskTextureCanvas?.context.drawImageCalls
    .findLast((call) => String(call.filter).startsWith('brightness('));
  const diskPeak = getCanvasBrightness(brightnessDraw?.filter);
  const webglCalls = { disks: [], rings: [] };

  probeWave.appendWebGLBloom(
    {
      addDisk(...args)
      {
        webglCalls.disks.push(args);
      },
      addRing(...args)
      {
        webglCalls.rings.push(args);
      },
    },
    1,
    1,
  );

  return {
    brightnessDraw,
    diskDraw,
    diskPeak,
    diskTextureCanvas,
    ringPeak,
    webglCalls,
  };
}

const baseClickEmission = sampleClickEmission(1);
probeWave.ageMs = 190;
const lateDiskCalls = [];
const lateCanvasDiskDrawStart =
  effect.bloomRenderer.sourceContext.drawImageCalls.length;

probeWave.drawBloom(effect.bloomRenderer.sourceContext, 1, 1);
const lateCanvasDiskDraw = effect.bloomRenderer.sourceContext.drawImageCalls
  .slice(lateCanvasDiskDrawStart)
  .find((call) => call.args[0] === baseClickEmission.diskTextureCanvas);
const lateCanvasBrightnessDraw = baseClickEmission.diskTextureCanvas.context
  .drawImageCalls.findLast((call) =>
    String(call.filter).startsWith('brightness('));

probeWave.appendWebGLBloom(
  {
    addDisk(...args)
    {
      lateDiskCalls.push(args);
    },
    addRing()
    {
    },
  },
  1,
  1,
);
assert(
  lateDiskCalls[0][4] === baseClickEmission.webglCalls.disks[0][4] &&
    lateCanvasDiskDraw?.globalAlpha === baseClickEmission.diskDraw.globalAlpha &&
    getCanvasBrightness(lateCanvasBrightnessDraw?.filter) ===
      baseClickEmission.diskPeak,
  '光盘 RGB 发射不随 Particle Alpha 衰减，仅由 200ms 生命周期截断',
);
const circleTintCanvas = baseClickEmission.brightnessDraw?.args[0];
const circleColorCanvas = circleTintCanvas?.context.drawImageCalls.at(-1)?.args[0];
const circleCoverageDraw = baseClickEmission.diskTextureCanvas?.context
  .drawImageCalls.findLast((call) =>
    call.compositeOperation === 'destination-in');
const circleCoverageCanvas = circleCoverageDraw?.args[0];

assert(
  baseClickEmission.diskTextureCanvas?.width === 512 &&
    baseClickEmission.diskTextureCanvas?.height === 512 &&
    circleTintCanvas?.width === 512 &&
    circleColorCanvas?.context.putImageDataCount === 1 &&
    circleCoverageCanvas?.context.putImageDataCount === 1 &&
    circleTintCanvas.context.putImageDataCount === 0 &&
    baseClickEmission.diskTextureCanvas.context.putImageDataCount === 0,
  '光盘发射使用完整 Circle_01 二维 RGB/Coverage，动态帧不执行像素回写',
);
const boostedClickEmission = sampleClickEmission(2);

assert(
  boostedClickEmission.ringPeak >= baseClickEmission.ringPeak * 1.8 &&
    boostedClickEmission.diskPeak >= baseClickEmission.diskPeak * 1.8,
  '点击发射倍率在线性能量上同步增强软件 Bloom 的圆环与光盘',
);
assert(
  boostedClickEmission.diskDraw.globalAlpha ===
      baseClickEmission.diskDraw.globalAlpha,
  '点击发射倍率只改变光盘 RGB，不改变纹理 Coverage',
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
const visibleTrailGradients = effect.context.linearGradients.slice(
  0,
  trailSegmentCount,
);
const visibleTrailPaths = effect.context.filledPaths.slice(
  0,
  trailSegmentCount,
);
const bloomTrailGradients =
  effect.bloomRenderer.sourceContext.linearGradients;
const firstVisibleSegment = visibleTrailPaths[0];
const measuredVisibleTrailWidth = Math.hypot(
  firstVisibleSegment.at(-1)[0] - firstVisibleSegment[0][0],
  firstVisibleSegment.at(-1)[1] - firstVisibleSegment[0][1],
);

assert(
  visibleTrailPaths.length === trailSegmentCount &&
    visibleTrailPaths.every((path) =>
      path.length === 4 || path.length === joinedTrailPathLength) &&
    visibleTrailGradients.length === trailSegmentCount &&
    Math.abs(
      measuredVisibleTrailWidth -
        UNITY_FX_TOUCH.trail.width * SIZE_CORRECTION,
    ) < 0.01,
  '可见拖尾横截面保持 Unity 的 2.7px 几何带宽',
);
assert(
  visibleTrailGradients[0].gradient.stops.every(
    ([, color]) => color === 'rgba(0, 0, 0, 0)',
  ),
  '拖尾零纹理能量严格编码为透明，不会在浅色背景形成黑段',
);
const firstVisiblePeak = visibleTrailGradients[0].gradient.stops.reduce(
  (maximum, [, color]) => Math.max(maximum, getCssPremultipliedEnergy(color)),
  0,
);
const lastVisiblePeak = visibleTrailGradients.at(-1).gradient.stops.reduce(
  (maximum, [, color]) => Math.max(maximum, getCssPremultipliedEnergy(color)),
  0,
);

assert(
  lastVisiblePeak > firstVisiblePeak + 100,
  '可见拖尾按原 Gradient 与 Stretch 纹理由尾部向头部增强',
);
assert(
  visibleTrailGradients.every(({ gradient }) =>
    gradient.stops.length === transverseStopCount) &&
    getCssPremultipliedEnergy(
      visibleTrailGradients.at(-1).gradient.stops[8][1],
    ) >
      getCssPremultipliedEnergy(
        visibleTrailGradients.at(-1).gradient.stops[0][1],
      ),
  '拖尾每一段都以一次横截面渐变从透明边缘羽化到明亮中心',
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
  '同一帧缓存拖尾端点与中点能量',
);
const expectedBloomSegmentCount = cachedTrailFrameData
  .segmentMaximumEnergies
  .filter((energy) =>
    energy * effect.config.opacity *
      (effect.fxConfig.trail.trailOpacity ?? 1) *
      effect.fxConfig.bloom.trailEmissionAlpha >
      0.5 * Math.max(1, effect.fxConfig.bloom.emissionRange) / 255)
  .length;
const bloomTrailSegmentGradients = bloomTrailGradients.slice(
  0,
  expectedBloomSegmentCount,
);

assert(
  bloomTrailSegmentGradients.length === expectedBloomSegmentCount &&
    bloomTrailGradients.length <= expectedBloomSegmentCount + 2 &&
    expectedBloomSegmentCount < trailSegmentCount,
  'Bloom 发射沿用量化裁剪，每个网格面只提交一次',
);
const firstBloomPeak = bloomTrailSegmentGradients[0].gradient.stops.reduce(
  (maximum, [, color]) => Math.max(maximum, getCssColorEnergy(color)),
  0,
);
const lastBloomPeak = bloomTrailSegmentGradients.at(-1).gradient.stops.reduce(
  (maximum, [, color]) => Math.max(maximum, getCssColorEnergy(color)),
  0,
);

assert(
  lastBloomPeak > firstBloomPeak + 20,
  'Bloom 发射仍只在拖尾头部保持高亮',
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

const shardTextureDraw = shardProbeContext.drawImageCalls.at(-1);
const shardTextureContext = shardTextureDraw.args[0].context;
const shardBloomEnergy = getCssColorEnergy(
  shardTextureContext.fillRects.at(-1).fillStyle,
);
const shardAtlasDraws = shardTextureContext.drawImageCalls.slice(-2);

assert(
  shardBloomEnergy >= 15 && shardBloomEnergy <= 17,
  '碎片 Bloom 在线性空间乘入 0.5377358 起始色，峰值不再按白色粒子放大',
);
assert(
  JSON.stringify(shardTextureDraw.args.slice(1)) ===
      JSON.stringify([-10, -10, 20, 20]) &&
    shardAtlasDraws.length === 2 &&
    shardAtlasDraws.every((call) => call.transform[3] === -1),
  'Canvas 碎片按 Unity 图集翻转帧与 Hermite 峰值尺寸绘制完整 Quad',
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
    shardWebGLCalls[0][6] === 1,
  'WebGL2 碎片与 Canvas 使用相同的起始色能量和图集帧',
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

effect.updateConfig(
  {
    softwareBloomEnabled: false,
    outputCompositing: 'transparent-overlay',
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

function captureTransparentSoftwareFrame(opacity)
{
  const transparentEffect = new BAClickFX(
    {
      effectBackend: 'canvas2d',
      bloomBackend: 'software',
      outputCompositing: 'transparent-overlay',
      inputSource: 'manual',
      opacity,
      lightBackgroundContrastAlpha: 0.35,
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
  };

  transparentEffect.destroy();
  return result;
}

const zeroOverlayFrame = captureTransparentSoftwareFrame(0);
const halfOverlayFrame = captureTransparentSoftwareFrame(0.5);
const fullOverlayFrame = captureTransparentSoftwareFrame(1);

assert(
  halfOverlayFrame.coverageModes.every((mode) =>
    mode === 'transparent-overlay') &&
    halfOverlayFrame.compositeSettings?.outputCompositing ===
      'transparent-overlay',
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
timeScaleEffect.updateConfig(
  {
    clickTimeScale: 0.009,
    trailTimeScale: 0,
  },
);
assert(
  timeScaleEffect.getConfig().clickTimeScale === 0.01 &&
    timeScaleEffect.getConfig().trailTimeScale === 0.01,
  'updateConfig 忽略低于 0.01 的时间倍率并保留有效值',
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
    if (blur > 0)
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
clickGlowResetEffect.boom(960, 540);
flushFrames(dom, performance.now(), 1);
const boostedNativeGlowAlphas = clickGlowResetEffect.context.fillShadowBlurs
  .reduce((alphas, blur, index) =>
  {
    if (blur > 0)
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

const legacyResetEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    renderingMode: 'legacy',
  },
);

legacyResetEffect.setFxParam('trail.width', 20);
legacyResetEffect.setFxParam('bloom.trailAlpha', 0.6);
const legacyResetPatch = legacyResetEffect.setFxParams(
  {
    'rings.count': 3,
  },
  {
    reset: true,
    strict: true,
  },
);
let legacyResetConfig = legacyResetEffect.getFxConfig();

assert(
  legacyResetPatch.committed === true &&
    legacyResetConfig.rings.count === 3 &&
    legacyResetConfig.trail.width === 4 &&
    legacyResetConfig.bloom.trailAlpha === 0,
  'setFxParams reset 先恢复当前 Legacy 基线再原子应用补丁',
);
legacyResetEffect.setFxParam('trail.width', 12);
legacyResetEffect.setFxParam('rings.count', 0);
legacyResetEffect.resetFxConfig();
legacyResetConfig = legacyResetEffect.getFxConfig();
assert(
  legacyResetConfig.rings.count === UNITY_FX_TOUCH.rings.count &&
    legacyResetConfig.trail.width === 4 &&
    legacyResetConfig.trail.coreWidth === 1.7 &&
    legacyResetConfig.bloom.trailAlpha === 0 &&
    legacyResetConfig.bloom.ringBlur === 80 &&
    legacyResetConfig.bloom.diskBlur === 65,
  'resetFxConfig 恢复 Legacy 模式完整默认基线而不是裸 Unity 配置',
);
legacyResetEffect.destroy();

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
fullWebGLEffect.boom(960, 540);
let fullWebGLNow = flushFrames(dom, performance.now(), 1);
assert(
  fullWebGLEffect.getConfig().resolvedEffectBackend === 'webgl2' &&
    fullWebGLEvents.length === 1 &&
    fullWebGLEvents[0].requestedEffectBackend === 'webgl2' &&
    fullWebGLEvents[0].resolvedEffectBackend === 'webgl2',
  '纯 WebGL2 首帧成功后只派发一次实际后端，不产生虚假回退事件',
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
const legacyFullWebGLEffect = new BAClickFX(
  {
    effectBackend: 'webgl2',
    renderingMode: 'legacy',
  },
);

assert(
  externalFullWebGLEffect.getConfig().resolvedEffectBackend === 'canvas2d' &&
    legacyFullWebGLEffect.getConfig().resolvedEffectBackend === 'canvas2d',
  '外部 Canvas 与 Legacy 对纯 WebGL2 请求同步公开实际 Canvas2D 路径',
);
externalFullWebGLEffect.destroy();
legacyFullWebGLEffect.destroy();

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
  unifiedWebGLBloomEffect.getConfig().resolvedBloomBackend === 'software' &&
    unifiedWebGLBloomEffect.canvas.style.visibility === '' &&
    unifiedWebGLBloomEffect.context.drawImageCalls
      .slice(fallbackImageStart)
      .some((call) =>
        call.args[0] === unifiedWebGLBloomEffect.bloomRenderer.outputCanvas),
  'WebGL2 Bloom 当帧失败后才补画 Canvas 并完成软件 Bloom 回退',
);
unifiedWebGLBloomEffect.destroy();

const reentrantWebGLBloomEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'webgl2',
    outputCompositing: 'transparent-overlay',
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
  (scale, useNativeBloom, legacy) =>
  {
    if (useNativeBloom)
    {
      reentrantWebGLBloomNativeCount++;
    }

    reentrantWebGLBloomDraw(scale, useNativeBloom, legacy);
  };
reentrantWebGLBloomEffect.canvas.addEventListener(
  BLOOM_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    reentrantWebGLBloomEvents.push(event.detail);

    if (event.detail.resolvedBloomBackend === 'software')
    {
      reentrantWebGLBloomEffect.updateConfig({ bloomBackend: 'native' });
    }
  },
);

reentrantWebGLBloomEffect.boom(960, 540);
let reentrantWebGLBloomNow = flushFrames(dom, performance.now(), 1);
const reentrantWebGLBloomEventCount = reentrantWebGLBloomEvents.length;

reentrantWebGLBloomNow = flushFrames(dom, reentrantWebGLBloomNow, 1);
assert(
  reentrantWebGLBloomEffect.getConfig().bloomBackend === 'native' &&
    reentrantWebGLBloomEffect.getConfig().resolvedBloomBackend === 'native' &&
    reentrantWebGLBloomEvents.slice(-2)
      .map((event) =>
        `${event.requestedBloomBackend}/${event.resolvedBloomBackend}`)
      .join(',') === 'webgl2/software,native/native' &&
    reentrantWebGLBloomSoftwareCount === 0 &&
    reentrantWebGLBloomNativeCount >= 1 &&
    reentrantWebGLBloomEvents.length === reentrantWebGLBloomEventCount,
  'WebGL2 Bloom 失败事件内切换 Native 会跳过同帧 Software 回读',
);
reentrantWebGLBloomEffect.destroy();

const reentrantFullWebGLEffect = new BAClickFX(
  {
    effectBackend: 'webgl2',
    bloomBackend: 'webgl2',
    outputCompositing: 'transparent-overlay',
  },
);
const reentrantFullWebGLEvents = [];
const reentrantFullWebGLDraw =
  reentrantFullWebGLEffect._drawCanvasClickEffects.bind(
    reentrantFullWebGLEffect,
  );
let reentrantFullWebGLSoftwareCount = 0;
let reentrantFullWebGLNativeCount = 0;

reentrantFullWebGLEffect.webglBloomUnavailable = true;
reentrantFullWebGLEffect._prepareWebGLEffectBackend = () => true;
reentrantFullWebGLEffect._renderWebGL2ClickEffects = () => false;
reentrantFullWebGLEffect._renderSoftwareBloom = () =>
{
  reentrantFullWebGLSoftwareCount++;
};
reentrantFullWebGLEffect._drawCanvasClickEffects =
  (scale, useNativeBloom, legacy) =>
  {
    if (useNativeBloom)
    {
      reentrantFullWebGLNativeCount++;
    }

    reentrantFullWebGLDraw(scale, useNativeBloom, legacy);
  };
reentrantFullWebGLEffect.canvas.addEventListener(
  BLOOM_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    reentrantFullWebGLEvents.push(event.detail);

    if (event.detail.resolvedBloomBackend === 'software')
    {
      reentrantFullWebGLEffect.updateConfig({ bloomBackend: 'native' });
    }
  },
);

reentrantFullWebGLEffect.boom(960, 540);
let reentrantFullWebGLNow = flushFrames(dom, performance.now(), 1);
const reentrantFullWebGLFirstRoute = reentrantFullWebGLEvents.slice(-2)
  .map((event) =>
    `${event.requestedBloomBackend}/${event.resolvedBloomBackend}`)
  .join(',');

reentrantFullWebGLNow = flushFrames(dom, reentrantFullWebGLNow, 1);
assert(
  reentrantFullWebGLEffect.getConfig().bloomBackend === 'native' &&
    reentrantFullWebGLEffect.getConfig().resolvedBloomBackend === 'native' &&
    reentrantFullWebGLFirstRoute ===
      'webgl2/software,native/native' &&
    reentrantFullWebGLSoftwareCount === 0 &&
    reentrantFullWebGLNativeCount >= 1 &&
    reentrantFullWebGLEvents.filter((event) =>
      event.resolvedBloomBackend === 'software').length === 1,
  '完整 WebGL2 失败事件内切换 Native 会按新路由重画当前帧',
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
  '已有 Canvas target 切换 Legacy 时保留 Unity 几何并应用兼容合成',
);
externalWebGLEffect.updateConfig({ renderingMode: 'enhanced' });
assert(
  externalWebGLEffect.getFxConfig().rings.hdrIntensity ===
      UNITY_FX_TOUCH.rings.hdrIntensity &&
    externalWebGLEffect.getFxConfig().rings.bandToOuterRadius ===
      UNITY_FX_TOUCH.rings.bandToOuterRadius,
  '已有 Canvas target 切回增强模式时恢复 Unity 参数集',
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
contextLifecycleEffect.boom(120, 80);
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

const reentrantContextLossEffect = new BAClickFX(
  {
    effectBackend: 'canvas2d',
    bloomBackend: 'webgl2',
    outputCompositing: 'transparent-overlay',
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
  (scale, useNativeBloom, legacy) =>
  {
    if (useNativeBloom)
    {
      reentrantContextLossNativeCount++;
    }

    reentrantContextLossDraw(scale, useNativeBloom, legacy);
  };
reentrantContextLossEffect.canvas.addEventListener(
  BLOOM_BACKEND_CHANGE_EVENT,
  (event) =>
  {
    reentrantContextLossEvents.push(event.detail);

    if (event.detail.resolvedBloomBackend === 'software')
    {
      reentrantContextLossEffect.updateConfig({ bloomBackend: 'native' });
    }
  },
);

reentrantContextLossEffect.boom(120, 80);
reentrantContextLossEffect._handleWebGLContextLost();
const reentrantContextLossEventCount = reentrantContextLossEvents.length;

flushFrames(dom, performance.now(), 1);
assert(
  reentrantContextLossEffect.getConfig().bloomBackend === 'native' &&
    reentrantContextLossEffect.getConfig().resolvedBloomBackend === 'native' &&
    reentrantContextLossEvents
      .map((event) =>
        `${event.requestedBloomBackend}/${event.resolvedBloomBackend}`)
      .join(',') === 'webgl2/software,native/native' &&
    reentrantContextLossSoftwareCount === 0 &&
    reentrantContextLossNativeCount >= 1 &&
    reentrantContextLossEvents.length === reentrantContextLossEventCount,
  'Context 丢失事件内切换 Native 会跳过同步 Software 回读',
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
  resizeRecoveryEffect.getConfig().resolvedBloomBackend === 'software' &&
    resizeRecoveryEvents.join(',') === 'software' &&
    resizeRecoveryEffect.webglBloomRenderer === resizeRecoveryRenderer &&
    resizeRecoveryEffect.webglBloomCanvas === resizeRecoveryCanvas &&
    !resizeRecoveryEffect.webglBloomUnavailable,
  'WebGL2 当前尺寸失败时稳定回退 Software，并保留可恢复的 renderer',
);
resizeRecoveryEffect._requestRender();
resizeRecoveryNow = flushFrames(dom, resizeRecoveryNow, 1);
assert(
  resizeRecoveryEvents.join(',') === 'software' &&
    resizeCallCount === 2,
  'WebGL2 尺寸持续失败时不重复派发后端状态事件',
);

resizeRecoveryEffect.updateConfig(
  {
    bloomBackend: 'auto',
  },
);
assert(
  resizeRecoveryEffect.getConfig().resolvedBloomBackend === 'software' &&
    resizeRecoveryEvents.join(',') === 'software',
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
  resizeRecoveryEffect.getConfig().resolvedBloomBackend === 'software' &&
    resizeRecoveryEvents.join(',') === 'software',
  '缺少 Bloom 金字塔时仍公开实际回退后端',
);
resizeRecoveryNow = flushFrames(dom, resizeRecoveryNow, 1);
resizeRecoveryEffect.updateConfig(
  {
    renderingMode: 'legacy',
  },
);
resizeRecoveryEffect.updateConfig(
  {
    renderingMode: 'enhanced',
  },
);
assert(
  resizeRecoveryEffect.getConfig().resolvedBloomBackend === 'software' &&
    resizeRecoveryEvents.join(',') === 'software,legacy,software',
  'Legacy 往返后仍按目标完整性公开 Software 回退',
);
resizeRecoveryNow = flushFrames(dom, resizeRecoveryNow, 1);

resizeCanSucceed = true;
resizeRecoveryEffect._requestRender();
resizeRecoveryNow = flushFrames(dom, resizeRecoveryNow, 1);
resizeRecoveryEffect._requestRender();
flushFrames(dom, resizeRecoveryNow, 1);
assert(
  resizeRecoveryEffect.getConfig().resolvedBloomBackend === 'webgl2' &&
    resizeRecoveryEvents.join(',') === 'software,legacy,software,webgl2' &&
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
  (scale, useNativeBloom, legacy) =>
  {
    if (useNativeBloom)
    {
      softwareFailureNativeRedrawCount++;
    }

    softwareFailureFallbackDraw(scale, useNativeBloom, legacy);
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
  let legacyTriangleCount = 0;
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
      legacyTriangleCount++;
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
    legacyTriangleCount,
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
    straightWebGLTrail.legacyTriangleCount === 0,
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
  JSON.stringify(straightCoverages) === JSON.stringify([0, 1, 1, 0, 1, 0]) &&
    (!sourceMode || (
      webgl2EffectSourceText.includes(
        'layout(location = 4) in float a_coverageFactor;',
      ) &&
      webgl2EffectSourceText.includes(
        'clamp(v_coverageFactor, 0.0, 1.0) * geometryCoverage;',
      ) &&
      webgl2EffectSourceText.includes(
        '(u_alphaModulatesEmission ? coverage : particleAlpha);',
      )
    )),
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
deferredTrailDataEffect._updateTrail(10, 1, false, false, false, true);
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
const budgetVisiblePoints = budgetPoints.slice(
  nativeSkippedBudgetSegmentCount,
);
const budgetMinimumX = Math.min(...budgetVisiblePoints.map(({ x }) => x));
const budgetMinimumY = Math.min(...budgetVisiblePoints.map(({ y }) => y));
const budgetMaximumX = Math.max(...budgetVisiblePoints.map(({ x }) => x));
const budgetMaximumY = Math.max(...budgetVisiblePoints.map(({ y }) => y));
const budgetScale = geometryEffect._getScale();
const budgetBlurRadius = UNITY_FX_TOUCH.trail.outerGlowWidth * budgetScale;
const budgetHalfWidth = Math.max(
  0.5,
  UNITY_FX_TOUCH.trail.geometryWidth * budgetScale * 0.5,
);
const budgetMargin = Math.ceil(
  budgetBlurRadius * 3 + budgetHalfWidth + 2,
);
const budgetOriginX = Math.floor(budgetMinimumX - budgetMargin);
const budgetOriginY = Math.floor(budgetMinimumY - budgetMargin);
const budgetRegionWidth = Math.max(
  1,
  Math.ceil(budgetMaximumX + budgetMargin) - budgetOriginX,
);
const budgetRegionHeight = Math.max(
  1,
  Math.ceil(budgetMaximumY + budgetMargin) - budgetOriginY,
);
const budgetFullRegionWidth = Math.max(
  1,
  Math.ceil(Math.max(...budgetPoints.map(({ x }) => x)) + budgetMargin) -
    Math.floor(Math.min(...budgetPoints.map(({ x }) => x)) - budgetMargin),
);
const budgetDpr = geometryEffect.nativeTrailBloomSurface.dpr;
const expectedBudgetSource = [
  0,
  0,
  Math.ceil(budgetRegionWidth * budgetDpr),
  Math.ceil(budgetRegionHeight * budgetDpr),
];
const expectedBudgetDestination = [
  budgetOriginX,
  budgetOriginY,
  budgetRegionWidth,
  budgetRegionHeight,
];
const budgetBlurSupport = budgetBlurRadius * 3 + 2;
const budgetNativeVertices = budgetGeometry.nativePaths.flat();

assert(
  budgetGeometry.nativeBlurDraws.length === 1 &&
    budgetBlurArgs[0] === geometryEffect.nativeTrailBloomSurface.canvas &&
    budgetGeometry.nativeClearRects.length === 1 &&
    JSON.stringify(budgetGeometry.nativeClearRects[0]) ===
      JSON.stringify(expectedBudgetSource) &&
    JSON.stringify(budgetBlurArgs.slice(1, 5)) ===
      JSON.stringify(expectedBudgetSource) &&
    JSON.stringify(budgetBlurArgs.slice(5)) ===
      JSON.stringify(expectedBudgetDestination) &&
    budgetRegionWidth < budgetFullRegionWidth &&
    budgetNativeVertices.every(([x, y]) =>
      x - budgetBlurSupport >= budgetOriginX &&
        x + budgetBlurSupport <= budgetOriginX + budgetRegionWidth &&
        y - budgetBlurSupport >= budgetOriginY &&
        y + budgetBlurSupport <= budgetOriginY + budgetRegionHeight),
  'Native 只按可见轨迹边界清理缓冲，并为折点和整体模糊保留完整支撑区',
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

dom.windowMock.devicePixelRatio = 2;
geometryEffect.updateConfig({ maxDpr: 2 });
const dprTwoTrailGeometry = renderCanvasTrailGeometry(
  [
    { x: 120, y: 240 },
    { x: 220, y: 220 },
    { x: 320, y: 240 },
  ],
);
const expectedDprTwoTrailBlur =
  UNITY_FX_TOUCH.trail.outerGlowWidth * geometryEffect._getScale() * 2;

assert(
  geometryEffect.dpr === 2 &&
    dprTwoTrailGeometry.nativeBlurDraws.length === 1 &&
    dprTwoTrailGeometry.nativeBlurDraws[0].filter ===
      `blur(${expectedDprTwoTrailBlur}px)`,
  'Native 拖尾模糊按 DPR 换算到物理像素并保持 CSS 光晕尺寸',
);
dom.windowMock.devicePixelRatio = originalDevicePixelRatio;
geometryEffect.updateConfig({ maxDpr: 2 });
geometryEffect.pointerCancel(91);
geometryEffect.destroy();

console.log('\nLegacy 模式');
const legacyEffect = new BAClickFX(
  {
    renderingMode: 'legacy',
    bloomBackend: 'software',
    inputSource: 'manual',
  },
);

assert(
  legacyEffect.getConfig().resolvedBloomBackend === 'legacy',
  'Legacy 构造完成后无需等待 RAF 即公开实际渲染模式',
);
const legacyClickGeometry = legacyEffect.getFxConfig();

assert(
  legacyClickGeometry.disk.radius === UNITY_FX_TOUCH.disk.radius &&
    legacyClickGeometry.rings.radiusMin === UNITY_FX_TOUCH.rings.radiusMin &&
    legacyClickGeometry.rings.radiusMax === UNITY_FX_TOUCH.rings.radiusMax,
  'Legacy 圆盘与圆环使用最终游戏工程的 Ortho 1.0 尺度',
);
assert(
  JSON.stringify(legacyClickGeometry.disk.sizeKeys) ===
      JSON.stringify(UNITY_FX_TOUCH.disk.sizeKeys) &&
    JSON.stringify(legacyClickGeometry.rings.sizeKeys) ===
      JSON.stringify(UNITY_FX_TOUCH.rings.sizeKeys) &&
    JSON.stringify(legacyClickGeometry.rings.dissolveKeys) ===
      JSON.stringify(UNITY_FX_TOUCH.rings.dissolveKeys) &&
    legacyClickGeometry.rings.bandToOuterRadius ===
      UNITY_FX_TOUCH.rings.bandToOuterRadius &&
    JSON.stringify(legacyClickGeometry.disk.textureRadialEnergyKeys) ===
      JSON.stringify(UNITY_FX_TOUCH.disk.textureRadialEnergyKeys) &&
    legacyClickGeometry.rings.textureUvMin ===
      UNITY_FX_TOUCH.rings.textureUvMin &&
    legacyClickGeometry.rings.textureUvMax ===
      UNITY_FX_TOUCH.rings.textureUvMax,
  'Legacy 保留 Hermite、Mesh 环宽、圆盘纹理与 Ring3 精确 UV',
);
legacyEffect.setFxParam('bloom.clickEmissionScale', 0);
legacyEffect.setFxParam('rings.hdrIntensity', 4);
legacyEffect.boom(960, 540);
const legacyWave = legacyEffect.waves[0];

legacyWave.ageMs = 100;
legacyEffect.context.drawImageCalls = [];
legacyWave.drawBase(legacyEffect.context, 1, 1, true, true);
const legacyDiskRadiusAt100Ms = legacyEffect.context.drawImageCalls
  .find((call) => call.args[0]?.width === 512 && call.args.length === 9)
  ?.args[7] * 0.5;

assert(
  Math.abs(legacyDiskRadiusAt100Ms - 58.77068378895867) < 0.0000001,
  'Legacy 圆盘在 100ms 按 Unity Hermite 曲线扩张到正确半径',
);

legacyWave.ageMs = 300;
legacyEffect.context.conicGradients = [];
legacyEffect.context.drawImageCalls = [];
const legacyRingRasterizer = legacyEffect._getLegacyRingRasterizer();
const controlledLegacyPutStart =
  legacyRingRasterizer.context.putImageDataCount;

legacyWave.drawRings(
  legacyEffect.context,
  1,
  1,
  true,
  true,
  legacyRingRasterizer,
  legacyEffect.dpr,
);
const controlledLegacyRingDraws = legacyEffect.context.drawImageCalls.filter(
  (call) => call.args[0] === legacyRingRasterizer.canvas,
);
const controlledLegacyMaskData = legacyRingRasterizer.imageData.data;
let controlledVisibleSample = -1;
let controlledClippedSample = -1;
let controlledHdrSample = -1;
let controlledMaskMatchesClip = true;

for (let index = 0; index < legacyRingRasterizer.sampleCount; index++)
{
  const offset = legacyRingRasterizer.pixelOffsets[index];
  const expectedVisible = legacyRingRasterizer.sampleAlphas[index] >=
    legacyRingRasterizer.lastThreshold;
  const visible = controlledLegacyMaskData[offset + 3] > 0;

  if (visible && controlledVisibleSample < 0)
  {
    controlledVisibleSample = index;
  }

  if (!visible && controlledClippedSample < 0)
  {
    controlledClippedSample = index;
  }

  if (
    visible &&
    controlledHdrSample < 0 &&
    controlledLegacyMaskData[offset] > 0 &&
    controlledLegacyMaskData[offset] < 255 &&
    controlledLegacyMaskData[offset + 1] === 255 &&
    controlledLegacyMaskData[offset + 2] === 255 &&
    controlledLegacyMaskData[offset + 3] === 255
  )
  {
    controlledHdrSample = index;
  }

  if (visible !== expectedVisible)
  {
    controlledMaskMatchesClip = false;
    break;
  }
}

assert(
  legacyEffect.context.conicGradients.length === 0 &&
    legacyRingRasterizer.context.putImageDataCount ===
      controlledLegacyPutStart + 1 &&
    controlledLegacyRingDraws.length === UNITY_FX_TOUCH.rings.count &&
    controlledLegacyRingDraws.every((call) =>
      call.args[0] === legacyRingRasterizer.canvas),
  'Legacy 每个 wave 只栅格一次 Ring3，并让两枚圆环共享同一像素纹理',
);
assert(
  controlledVisibleSample >= 0 &&
    controlledClippedSample >= 0 &&
    controlledMaskMatchesClip,
  'Legacy Ring3 对全部极坐标像素执行 Bilinear 后 hard clip，不遗漏窄断口',
);
const controlledHdrOffset = legacyRingRasterizer.pixelOffsets[
  controlledHdrSample
];

assert(
  controlledHdrSample >= 0 &&
    controlledLegacyMaskData[controlledHdrOffset] > 0 &&
    controlledLegacyMaskData[controlledHdrOffset] < 255 &&
    controlledLegacyMaskData[controlledHdrOffset + 1] === 255 &&
    controlledLegacyMaskData[controlledHdrOffset + 2] === 255 &&
    controlledLegacyMaskData[controlledHdrOffset + 3] === 255,
  'Legacy 圆环本体保留 Tri3 的 Linear 插值与 HDR 材质能量',
);

if (sourceMode)
{
  const sampleIndex = Math.floor(legacyRingRasterizer.sampleCount * 0.37);
  const angularProgress = legacyRingRasterizer.angularProgresses[sampleIndex];
  const radialProgress = (
    legacyRingRasterizer.radialDistances[sampleIndex] -
      (1 - legacyRingRasterizer.lastBandRatio)
  ) / legacyRingRasterizer.lastBandRatio;
  const ringCfg = legacyEffect.getFxConfig().rings;
  const textureProgress = ringCfg.dissolveDirection >= 0
    ? angularProgress
    : 1 - angularProgress;
  const uvSpan = ringCfg.textureUvMax - ringCfg.textureUvMin;
  const expectedAlpha = ring3AlphaSource.sampleRing3Alpha(
    ringCfg.textureUvMin + uvSpan * textureProgress,
    ringCfg.textureUvMin + uvSpan * radialProgress,
  );

  assert(
    Math.abs(
      legacyRingRasterizer.sampleAlphas[sampleIndex] - expectedAlpha,
    ) < 0.00001,
    'Legacy 极坐标缓存逐像素复用 Ring3 原纹理 Bilinear 采样器',
  );
}

const stableLegacyCanvas = legacyRingRasterizer.canvas;
const stableLegacyImageData = legacyRingRasterizer.imageData;
const stableLegacyPixelOffsets = legacyRingRasterizer.pixelOffsets;
const stableLegacySampleAlphas = legacyRingRasterizer.sampleAlphas;
const stableLegacyCacheRevision = legacyRingRasterizer.cacheRevision;

for (const ageMs of [420, 480])
{
  legacyWave.ageMs = ageMs;
  legacyWave.drawRings(
    legacyEffect.context,
    1,
    1,
    true,
    true,
    legacyRingRasterizer,
    legacyEffect.dpr,
  );

  for (let index = 0; index < legacyRingRasterizer.sampleCount; index++)
  {
    const offset = legacyRingRasterizer.pixelOffsets[index];
    const expectedVisible = legacyRingRasterizer.sampleAlphas[index] >=
      legacyRingRasterizer.lastThreshold;

    if ((legacyRingRasterizer.imageData.data[offset + 3] > 0) !== expectedVisible)
    {
      controlledMaskMatchesClip = false;
      break;
    }
  }
}

assert(
  controlledMaskMatchesClip &&
    legacyRingRasterizer.canvas === stableLegacyCanvas &&
    legacyRingRasterizer.imageData === stableLegacyImageData &&
    legacyRingRasterizer.pixelOffsets === stableLegacyPixelOffsets &&
    legacyRingRasterizer.sampleAlphas === stableLegacySampleAlphas &&
    legacyRingRasterizer.cacheRevision === stableLegacyCacheRevision,
  'Legacy 在 0.7/0.8 生命周期完整裁剪 Ring3，并跨帧复用像素缓冲',
);
legacyEffect.setFxParam('bloom.clickEmissionScale', 1);
legacyWave.ageMs = 0;
legacyEffect.context.filledPaths = [];
legacyEffect.context.filledStyles = [];
legacyEffect.context.fillShadowBlurs = [];
legacyEffect.context.fillShadowColors = [];
legacyEffect.context.fillOrders = [];
legacyEffect.context.radialGradients = [];
legacyEffect.context.conicGradients = [];
legacyEffect.context.drawImageCalls = [];
const legacyFramePutStart = legacyRingRasterizer.context.putImageDataCount;
let legacyNow = flushFrames(dom, performance.now(), 1);
const legacyDiskDraw = legacyEffect.context.drawImageCalls.find((call) =>
  call.args[0]?.width === 512 &&
    call.args[0]?.height === 512 &&
    call.args.length === 9);
const legacyRingDraws = legacyEffect.context.drawImageCalls.filter(
  (call) => call.args[0] === legacyRingRasterizer.canvas,
);
const legacyTriangleDraws = legacyEffect.context.drawImageCalls.filter((call) =>
  call.args[0] !== legacyRingRasterizer.canvas &&
    call.args.length === 5 &&
    call.args[1] < 0 &&
    call.args[2] < 0 &&
    call.args[3] === call.args[4]);
const legacyScale = legacyEffect._getScale();

assert(
  legacyEffect.context.conicGradients.length === 0 &&
    legacyRingRasterizer.context.putImageDataCount ===
      legacyFramePutStart + 1 &&
    legacyRingDraws.length === UNITY_FX_TOUCH.rings.count,
  'Legacy 运行帧不再构建 96x8 conic band，并让两枚圆环共用一次纹理更新',
);
assert(
  legacyTriangleDraws.length === UNITY_FX_TOUCH.shards.clickCount,
  'Legacy 点击后的第一帧同时绘制三角碎片',
);
assert(
  Math.min(...legacyRingDraws.map((call) => call.order)) >
    Math.max(...legacyTriangleDraws.map((call) => call.order)),
  'Tri3 圆环按材质 queue 4499 在圆盘和碎片之后绘制',
);
assert(
  legacyDiskDraw?.compositeOperation === 'source-over' &&
    legacyDiskDraw.shadowBlur === legacyEffect.getFxConfig().bloom.diskBlur &&
    getCssAlpha(legacyDiskDraw.shadowColor) > 0 &&
    Math.abs(legacyDiskDraw.rotation - legacyWave.diskRotation) < 0.000001,
  'Legacy 圆盘旋转完整 Circle_01 二维纹理，并继续使用原生辉光近似',
);
assert(
  legacyEffect.getFxConfig().rings.hdrIntensity === 4 &&
    legacyRingDraws.every((call, index) =>
      call.shadowBlur === legacyEffect.getFxConfig().bloom.ringBlur *
        legacyScale &&
      getCssAlpha(call.shadowColor) > 0 &&
      call.imageSmoothingEnabled === false &&
      call.args[7] === call.args[8] &&
      Math.abs(call.rotation - legacyWave.rings[index].rotation) < 0.000001),
  'Legacy 圆环保留 HDR 本体，并让每枚完整像素环带只生成一次原生辉光',
);
assert(
  legacyRingDraws.every((call) =>
    call.shadowBlur > 0 && getCssAlpha(call.shadowColor) > 0),
  '点击发射倍率不改变 Legacy 兼容圆环辉光',
);

legacyNow = flushFrames(dom, legacyNow, 50);
legacyEffect.updateConfig({ clickEnabled: false });
legacyEffect.context.shadowBlur = 24;
legacyEffect.context.shadowColor = 'rgba(255, 0, 0, 1)';
legacyEffect.pointerDown({ x: 100, y: 200, pointerId: 92 });
legacyEffect.currentTrailStroke.points = Array.from(
  { length: 64 },
  (_, index) =>
  ({
    x: 100 + index * 8,
    y: 200 + index % 2 * 8,
    bornAt: legacyEffect.trailTimeMs,
  }),
);
legacyEffect.context.strokeCount = 0;
legacyEffect.context.lineJoinWrites = [];
legacyEffect.context.strokeShadowBlurs = [];
legacyEffect.context.strokeStyles = [];
legacyEffect.context.strokedPaths = [];
legacyNow = flushFrames(dom, legacyNow, 1);
const legacyTrailPaths = legacyEffect.context.strokedPaths;
const legacyTrailFrameData = legacyEffect.currentTrailStroke.trailFrameData;
const legacyGradientChannels = [0, 31, 62].map((index) =>
  getCssChannels(legacyEffect.context.strokeStyles[index]).slice(0, 3));

assert(
  legacyEffect.getFxConfig().bloom.trailAlpha === 0 &&
    legacyTrailFrameData.measurement.segmentLengths === null &&
    legacyTrailFrameData.pointProgresses.length === 64 &&
    legacyTrailFrameData.segmentProgresses.length === 63 &&
    legacyTrailFrameData.pointCoverageFactors[0] === 0 &&
    legacyTrailFrameData.pointCoverageFactors.at(-1) === 1 &&
    legacyTrailFrameData.pointCoverageFactors.every((value, index, values) =>
      index === 0 || value >= values[index - 1]) &&
    legacyEffect.context.strokeCount === 64 &&
    legacyTrailPaths.filter((path) => path.length === 2).length === 63 &&
    legacyTrailPaths.filter((path) => path.length === 64).length === 1 &&
    legacyEffect.context.strokeStyles.every((style) =>
      getCssAlpha(style) > 0) &&
    legacyEffect.context.strokeStyles.at(-1) ===
      'rgba(116, 225, 255, 0.72)' &&
    JSON.stringify(legacyEffect.context.lineJoinWrites) ===
      JSON.stringify(['round']) &&
    JSON.stringify(legacyGradientChannels) ===
      JSON.stringify([[0, 101, 220], [0, 143, 233], [0, 238, 255]]) &&
    legacyEffect.context.strokeShadowBlurs.every((blur) => blur === 0),
  'Legacy 跳过透明外层，并只为核心整路径写入圆角连接',
);
legacyEffect.setFxParam('bloom.trailAlpha', 0.25);
legacyEffect.context.lineJoinWrites = [];
legacyEffect.context.strokeStyles = [];
legacyEffect.context.strokedPaths = [];
legacyNow = flushFrames(dom, legacyNow, 1);

assert(
  legacyEffect.context.strokedPaths.length === 65 &&
    legacyEffect.context.strokedPaths[0].length === 64 &&
    legacyEffect.context.strokeStyles[0] === 'rgba(0, 88, 224, 0.25)' &&
    JSON.stringify(legacyEffect.context.lineJoinWrites) ===
      JSON.stringify(['round', 'round']),
  'Legacy 正 Alpha 外层恢复描边，渐变段仍不重复写入圆角连接',
);
legacyEffect.setFxParam('bloom.trailAlpha', 0);
legacyEffect.updateConfig({ themeColor: '#FF6969' });
legacyEffect.context.strokeStyles = [];
legacyNow = flushFrames(dom, legacyNow, 1);
const themedLegacyGradientChannels = [0, 31, 62].map((index) =>
  getCssChannels(legacyEffect.context.strokeStyles[index]).slice(0, 3));

legacyEffect.setThemeColor('');
legacyEffect.context.strokeStyles = [];
legacyNow = flushFrames(dom, legacyNow, 1);
const restoredLegacyGradientChannels = [0, 31, 62].map((index) =>
  getCssChannels(legacyEffect.context.strokeStyles[index]).slice(0, 3));

assert(
  JSON.stringify(themedLegacyGradientChannels) !==
      JSON.stringify(legacyGradientChannels) &&
    JSON.stringify(restoredLegacyGradientChannels) ===
      JSON.stringify(legacyGradientChannels) &&
    legacyEffect.getConfig().themeColor === DEFAULT_THEME_COLOR,
  'updateConfig 与 setThemeColor 共享状态且不会污染 Legacy 默认渐变',
);
assert(
  dom.appendedCanvases.includes(legacyEffect.contrastCanvas) &&
    legacyEffect.contrastCanvas.style.display === 'none',
  'Legacy 初始实例预挂载并隐藏对比层，便于运行时安全切回增强模式',
);
legacyEffect.updateConfig({ renderingMode: 'enhanced' });
legacyNow = flushFrames(dom, legacyNow, 1);
const restoredEnhancedTrailData = legacyEffect.currentTrailStroke
  .trailFrameData;
const enhancedClickGeometry = legacyEffect.getFxConfig();

assert(
  legacyEffect.canvas.style.mixBlendMode === '' &&
    legacyEffect.contrastCanvas.style.display === '' &&
    legacyEffect.getConfig().resolvedBloomBackend === 'software' &&
    enhancedClickGeometry.disk.radius === UNITY_FX_TOUCH.disk.radius &&
    enhancedClickGeometry.rings.radiusMin ===
      UNITY_FX_TOUCH.rings.radiusMin &&
    enhancedClickGeometry.rings.radiusMax ===
      UNITY_FX_TOUCH.rings.radiusMax &&
    restoredEnhancedTrailData.pointEnergies.length === 64 &&
    restoredEnhancedTrailData.segmentEnergies.length === 63,
  'Legacy 实例运行时切回增强模式会恢复预乘输出、对比层与 Unity 尺度',
);
legacyEffect.pointerCancel(92);
legacyEffect.updateConfig({ renderingMode: 'legacy' });
const restoredLegacyClickGeometry = legacyEffect.getFxConfig();
assert(
  legacyEffect.canvas.style.mixBlendMode === '' &&
    legacyEffect.canvas.style.zIndex === '2147483647' &&
    legacyEffect.contrastCanvas.style.display === 'none' &&
    legacyEffect.getConfig().resolvedBloomBackend === 'legacy' &&
    restoredLegacyClickGeometry.disk.radius === legacyClickGeometry.disk.radius &&
    restoredLegacyClickGeometry.rings.radiusMin ===
      legacyClickGeometry.rings.radiusMin &&
    restoredLegacyClickGeometry.rings.radiusMax ===
      legacyClickGeometry.rings.radiusMax,
  '切回 Legacy 时保持 Unity 尺度并隐藏增强模式对比层',
);
legacyWave.ageMs = 100;
legacyEffect.context.drawImageCalls = [];
legacyWave.drawBase(
  legacyEffect.context,
  1,
  1,
  true,
  'transparent-overlay',
  2,
);
const dprTwoDiskDraw = legacyEffect.context.drawImageCalls.find((call) =>
  call.args[0]?.width === 512 && call.args.length === 9);

legacyWave.ageMs = 300;
legacyEffect.context.drawImageCalls = [];
legacyWave.drawRings(
  legacyEffect.context,
  1,
  1,
  true,
  true,
  legacyRingRasterizer,
  2,
  'transparent-overlay',
);
const dprTwoRingDraws = legacyEffect.context.drawImageCalls.filter((call) =>
  call.args[0] === legacyRingRasterizer.canvas);

assert(
  dprTwoDiskDraw?.shadowBlur === legacyClickGeometry.bloom.diskBlur * 2 &&
    dprTwoRingDraws.length === UNITY_FX_TOUCH.rings.count &&
    dprTwoRingDraws.every((call) =>
      call.shadowBlur === legacyClickGeometry.bloom.ringBlur * 2),
  'Native 与 Legacy 点击模糊按 DPR 保持相同 CSS 光晕范围',
);
legacyEffect.destroy();
assert(legacyEffect.destroyed, 'Legacy 实例可正常结束完整生命周期并销毁');

console.log(`\n✅ ${passed} 项 FX_Touch 移植检查通过\n`);
