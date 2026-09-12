# API 参考

[返回 README](https://github.com/CialloKing/ba-click-fx/blob/main/README.md) · [English](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.en.md)

[API 参考](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md) · [渲染与合成](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md) · [Worker 接入](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.md)

默认值以当前发布类型和配置 Schema 为准。基础选项通过 `updateConfig()` 修改，特效参数通过 `setFxParam()` / `setFxParams()` 修改。

## 构造函数

```ts
new BAClickFX(options?: {
  target?: string | HTMLElement | OffscreenCanvas, // 挂载目标，DOM 中省略时默认全屏
  scale?: number,                  // 全局缩放，默认 1
  opacity?: number,                // 不透明度 0~1，默认 1
  themeColor?: string,             // 六位十六进制主题色，默认 #4ca7ff
  themeColorMode?: 'hue-only' | 'relative-oklch', // 公共库默认 relative-oklch
  outputCompositing?: 'scene' | 'browser-overlay', // 输出合成，默认 scene
  overlayAlphaPolicy?: 'coverage' | 'visual-max', // 覆盖层 Alpha 策略，默认 coverage
  overlayColorCompensation?: 'none' | 'bright-core', // 覆盖层颜色补偿，默认 none
  overlayAlphaLimit?: number,      // 网页覆盖层 Alpha 上限，默认 250/255
  hostCompositing?: 'source-over' | 'screen' | 'plus-lighter', // 宿主合成，默认 source-over
  hostCompositingSurface?: 'dom-backdrop' | 'transparent-window' | 'native', // 最终宿主表面，默认 dom-backdrop
  clickEnabled?: boolean,         // 启用点击特效，默认 true
  trailEnabled?: boolean,         // 启用拖尾，默认 true
  trailAlways?: boolean,          // 移动鼠标即显示拖尾（无需按下），默认 false
  inputSource?: 'dom' | 'manual', // 输入来源，默认 dom
  inputSamplingRate?: number,     // 移动输入采样率上限；0 不限频，1..1000 Hz，默认 0
  clickTimeScale?: number,        // 点击时间倍率，不小于 0.01，默认 1
  trailTimeScale?: number,        // 拖尾时间倍率，不小于 0.01，默认 1
  effectBackend?: 'canvas2d' | 'webgl2' | 'webgpu' | 'auto', // 完整特效后端，默认 webgl2
  webgpuPreferHdr?: boolean,       // true 优先 HDR，false 强制标准 SDR；默认 true
  webgpuHdrPeak?: number,         // Extended 线性峰值 2~4，默认 3
  webgpuHdrBrightness?: number,   // Extended 特效整体亮度倍率 0~32，默认 1
  webgpuHdrColorPreservation?: number, // Extended 高亮色相保持 0~1，默认 0
  webgpuHdrWhiteCore?: number,    // Extended 白核强度 0~1，默认 0.6
  webgpuHdrWhiteStart?: number,   // Extended 白核起点 0~15.99，默认 1
  webgpuHdrWhiteEnd?: number,     // Extended 白核终点 0.01~16，默认 5
  bloomBackend?: 'auto' | 'software' | 'webgl2' | 'native', // Bloom 后端，默认 webgl2
  isolatedCompositing?: boolean,  // 隔离合成，默认 false；true 为非游戏白底兼容选项
  lightBackgroundContrastAlpha?: number, // 浅色背景兼容层强度，默认 0
  maxDpr?: number,                // 最大设备像素比，默认 1；可按设备性能显式提高
  touchAction?: string,           // DOM 触摸手势策略，默认 'auto'
  inputFilter?: (e: PointerEvent) => boolean,
})
```

旧版 `softwareBloomEnabled` 已从当前配置 API 删除；传入该字段会抛出 `TypeError`。请使用 `bloomBackend: 'software'` 或 `bloomBackend: 'native'`，需要自动选择时使用 `'auto'`。

`touchAction` 接受 CSS `touch-action` 关键字及组合，例如 `none`、`pan-x`、`pan-y`、`pan-left`、`pan-right`、`pan-up`、`pan-down`、`pinch-zoom` 和它们的空格组合。DOM 自动输入只在策略需要禁止某个方向或缩放时注册 capture Touch 仲裁监听；`auto`、`manipulation` 与显式允许全部方向/缩放的组合保留浏览器原生快速滚动。覆盖层 Canvas 不参与命中测试时，库会在首次可判定方向的移动时锁定本次手势，并通过 `inputFilter` 排除宿主控件；`inputSource: 'manual'` 不注册这些 DOM 监听。

`target` 和 `inputFilter` 仅在构造时设置。后端、合成与 HDR 的选择规则见 [渲染指南](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md)。

构造成功会返回新实例。配置校验失败会抛出 `TypeError`；缺少浏览器/Worker 环境、目标不存在或无法创建所需 Canvas 上下文等初始化失败会抛出错误。SSR 应在客户端挂载时创建实例；Worker 必须显式传入 `OffscreenCanvas`。

## 类型签名摘要

以下声明用于查阅；实际接入时从包导入对应 API，无需重新声明。构造选项、指针输入、配置快照和批量处理结果等类型的完整字段见 [TypeScript 声明](https://github.com/CialloKing/ba-click-fx/blob/main/src/ba-click-fx.d.ts)。

```ts
import type {
  BAClickFXCompositingReferenceOptions,
  BAClickFXConfigSnapshot,
  BAClickFXHostCompositing,
  BAClickFXOptions,
  BAClickFXParamPatchOptions,
  BAClickFXParamPatchResult,
  BAClickFXParamValue,
  BAClickFXPauseOptions,
  BAClickFXPointerInput,
  BAClickFXStandalonePatchOptions,
  BAClickFXThemeColorMode,
  BAClickFXUpdateOptions,
} from 'ba-click-fx';

declare class BAClickFX
{
  constructor(options?: BAClickFXOptions);
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly width: number;
  readonly height: number;
  resize(width?: number, height?: number, dpr?: number): void;
  boom(x?: number, y?: number): void;
  pointerDown(input: BAClickFXPointerInput): boolean;
  pointerMove(input: BAClickFXPointerInput): boolean;
  pointerUp(pointerId?: number): boolean;
  pointerCancel(pointerId?: number): boolean;
  setPaused(paused: boolean, options?: BAClickFXPauseOptions): void;
  setCompositingReference(
    source: TexImageSource | null,
    options?: BAClickFXCompositingReferenceOptions,
  ): boolean;
  getEffectiveHostCompositing(): BAClickFXHostCompositing;
  updateConfig(overrides: BAClickFXUpdateOptions): BAClickFXConfigSnapshot;
  setThemeColor(hex: string): void;
  setThemeColorMode(mode: BAClickFXThemeColorMode): boolean;
  setInputSamplingRate(rateHz: number): boolean;
  setFxParam(path: string, value: BAClickFXParamValue): boolean;
  setTriangleRoundness(roundness: number): boolean;
  setFxParams(
    patch: Readonly<Record<string, BAClickFXParamValue>>,
    options?: BAClickFXParamPatchOptions,
  ): BAClickFXParamPatchResult;
  getFxConfig(): Record<string, unknown>;
  resetFxConfig(): void;
  clearTrail(): void;
  clear(): void;
  getConfig(): BAClickFXConfigSnapshot;
  destroy(): void;
}

declare function applyFxParamPatch(
  patch: Readonly<Record<string, unknown>>,
  options?: BAClickFXStandalonePatchOptions,
): BAClickFXParamPatchResult;
```

`canvas` 是实例的主画布；只读的 `width` / `height` 表示当前 Canvas 局部 CSS 像素尺寸，不是乘以 DPR 后的像素缓冲尺寸。返回 `void` 的方法不提供成功标志，也不表示下一帧已完成绘制。

## 实例方法

| 方法 | 说明 |
|---|---|
| `resize(width?, height?, dpr?)` | 显式同步 Canvas 的 CSS 尺寸与 DPR，主要用于 Worker / OffscreenCanvas 宿主 |
| `boom(x?, y?)` | 触发单次点击特效；省略坐标时使用画布中心，不创建拖尾状态 |
| `pointerDown(input)` | 开始一次点击和拖尾生命周期；返回是否接受输入 |
| `pointerMove(input)` | 为当前逻辑指针追加拖尾采样点；返回是否接受输入，限频跳过仍返回 `true` |
| `pointerUp(pointerId?)` | 正常结束匹配的指针；成功返回 `true`，已有拖尾自然消失 |
| `pointerCancel(pointerId?)` | 强制取消匹配的指针并立即移除当前轨迹；成功返回 `true` |
| `setPaused(paused, options?)` | 暂停或恢复输入与动画调度，可选在暂停时清屏 |
| `setInputSamplingRate(rateHz)` | 设置移动输入采样率上限；接受 `0` 或 `1..1000`，成功返回 `true` |
| `setCompositingReference(source, { fit: 'cover' })` | 返回参考是否被接受；传入 `null` 清除参考，返回 `false` 时旧参考保持不变 |
| `clear()` | 清除全部视觉对象 |
| `clearTrail()` | 清除拖尾及拖尾碎片，保留点击特效与点击碎片 |
| `destroy()` | 销毁实例并移除其监听；仅移除库创建的 Canvas |
| `updateConfig({...})` | 运行时更新配置并返回配置快照；`target` 与 `inputFilter` 仅在构造时设置 |
| `setThemeColor('#4ca7ff')` | 更新当前实例的主题色；非法值恢复默认游戏蓝 |
| `setThemeColorMode(mode)` | 切换主题颜色映射模式；接受 `hue-only` 或 `relative-oklch`，成功返回 `true` |
| `setTriangleRoundness(value)` | 设置三角碎片圆角比例；与 `setFxParam('shards.roundness', value)` 等价，返回是否成功提交 |
| `setFxParam('rings.hdrIntensity', 5.992157)` | 修改单个点号路径；成功返回 `true`，拒绝时返回 `false` |
| `setFxParams(patch, options?)` | 按 Schema 验证并批量应用点号路径补丁，返回逐项处理结果 |
| `getFxConfig()` | 返回当前完整特效配置深拷贝 |
| `resetFxConfig()` | 重置所有特效参数为 Unity 基线 |
| `getConfig()` | 返回当前实例配置；除完整特效和 Bloom 的解析结果外，还报告 WebGPU 输出和宿主合成的实际状态 |
| `getEffectiveHostCompositing()` | 返回实际生效的宿主合成模式 |

### 返回值与失败条件

- `boom()` 的 `x` / `y` 分别默认使用 `width / 2` / `height / 2`；暂停、销毁或关闭点击时不生成效果。`resize()` 省略尺寸或 DPR 时使用可测量的布局及环境值，DPR 仍受 `maxDpr` 限制；Worker 应显式传入尺寸。
- 指针方法返回 `false` 表示当前状态不接受输入，例如暂停、销毁、非法输入或指针不匹配；`pointerDown()` 还会拒绝另一次尚未结束的按下，`pointerMove()` 在关闭拖尾时也返回 `false`。返回 `true` 不保证追加了可见轨迹点。
- `setInputSamplingRate()` / `setThemeColorMode()` 接受合法值时返回 `true`；非法值或实例销毁时返回 `false`。`setFxParam()` / `setTriangleRoundness()` 返回是否提交成功，有限的越界数值按 Schema 钳制；`setThemeColor()` 返回 `void`，非法颜色恢复默认值。
- `setCompositingReference()` 返回参考是否被接受；无效源、不支持的 `fit`、渲染器拒绝或实例销毁时返回 `false`。接受不等于当前输出路径已使用参考，实际合成模式见 `getEffectiveHostCompositing()`。
- `updateConfig()` 成功时返回与 `getConfig()` 同结构的配置快照。配置对象、字段或值未通过校验时抛出 `TypeError`；实例已销毁或要求切换直接 OffscreenCanvas 的上下文类型时抛出错误。`getFxConfig()` 返回独立的深拷贝。
- `setFxParams()` 与独立的 `applyFxParamPatch()` 返回包含 `committed`、`applied`、`normalized`、`rejected`、`schemaVersion` 的处理结果，详见[批量写入与迁移](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md#参数-schema-与批量写入)。实例销毁后的 `setFxParams()` 返回 `committed: false`，拒绝原因为 `destroyed`。

### 后端与合成事件

后端解析状态发生变化时，主 Canvas 会分别派发 `baclickfxeffectbackendchange` 和 `baclickfxbackendchange`。可使用导出的事件名持续同步延迟探测、运行时回退、WebGPU Device 丢失和 WebGL Context 恢复：

```js
import {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
  HOST_COMPOSITING_CHANGE_EVENT,
} from 'ba-click-fx';

const fx = new BAClickFX(
{
  effectBackend: 'webgpu',
  webgpuPreferHdr: false,
  bloomBackend: 'webgl2',
});

fx.canvas.addEventListener(EFFECT_BACKEND_CHANGE_EVENT, (event) =>
{
  console.log(event.detail.resolvedEffectBackend);
  console.log(fx.getConfig().resolvedWebGPUOutputMode);
});

fx.canvas.addEventListener(BLOOM_BACKEND_CHANGE_EVENT, (event) =>
{
  console.log(event.detail.resolvedBloomBackend);
});

fx.canvas.addEventListener(HOST_COMPOSITING_CHANGE_EVENT, (event) =>
{
  console.log(event.detail.requestedHostCompositing);
  console.log(event.detail.resolvedHostCompositing);
  console.log(event.detail.hostCompositingSurface);
  console.log(event.detail.compositingWarning);
  console.log(fx.getEffectiveHostCompositing());
});
```

`resolvedEffectBackend === 'webgpu'` 只证明 WebGPU Scene 已接管当前输出。判断真实 HDR 必须同时读取 `resolvedWebGPUOutputMode === 'extended'`；不要用 `matchMedia('(dynamic-range: high)')` 代替实际 Canvas 配置结果。

## 宿主输入与指针生命周期

`inputSource` 默认为 `'dom'`，保持现有网页用法：

- `'dom'`：库自动监听 DOM Pointer 事件。
- `'manual'`：不注册自动 DOM 指针监听，由 Electron、WebView2、浏览器插件等宿主调用公开指针方法。调整尺寸、WebGL Context 和其他生命周期监听不受影响。

`pointerDown()`、`pointerMove()`、`pointerUp()` 和 `pointerCancel()` 在两种 `inputSource` 下都可调用，返回值表示输入是否被当前指针状态接受。手动输入的 `x` / `y` 是 Canvas 局部 CSS 像素，库会将其钳制到 Canvas 范围；`pointerId` 默认为 `1`。`inputFilter` 只作用于自动 DOM 输入的准入，不作用于手动输入，因此已在宿主中转换的右键、中键等逻辑主指针不会被库二次拒绝。

```js
const fx = new BAClickFX(
{
  target: '#myCanvas',
  inputSource: 'manual',
});

fx.pointerDown(
{
  x: 120,
  y: 80,
  pointerId: 7,
  pointerType: 'pen',
});
fx.pointerMove(
{
  x: 148,
  y: 96,
  pointerId: 7,
  pointerType: 'pen',
});
fx.pointerUp(7);
```

`pointerDown()` 开始一次点击和拖尾生命周期。`pointerUp()` 会停止追加并让已有拖尾按 Unity 的 `0.3s` TrailRenderer 时间自然消失；`pointerCancel()` 用于多屏切换、暂停与异常恢复，会同时立即移除当前轨迹。`boom(x, y)` 保持为仅生成一次点击的便捷方法，不会建立拖尾指针状态。

`inputSource` 也可以通过 `updateConfig()` 动态切换。切换时会先取消旧来源的活动指针，再按目标模式注册或移除自动 DOM 指针监听，避免宿主接手尚未结束的轨迹。

## 输入采样率

`inputSamplingRate` 用真实输入时间限制 `pointerMove` 的最高采样率，用来模拟手机游戏客户端低频读取触点后形成的多边形拖尾：

- `0` 为默认值，不人为限频，保持既有轨迹与像素输出。
- `1..1000` 表示 Hz；推荐从 `30` 开始模拟手机感，`15` 会呈现更强的折线，`60` 更接近流畅轨迹。
- 它只筛选移动样本，不延迟 `pointerDown()`、`pointerUp()` 或 `pointerCancel()`；DOM 合并事件会按各自 `timeStamp` 判断，手动输入按 API 到达时间判断。
- 它是输入采样率上限，不是新的渲染帧率或固定时钟。实际频率仍受宿主事件频率影响；`trailTimeScale` 与 Unity 的 `trail.minVertexDistance` 保持独立，保留点之间新增的空间顶点仍然共线，因此不会抹掉低频转折。

```js
const fx = new BAClickFX({ inputSamplingRate: 30 });

fx.setInputSamplingRate(15);  // 更明显的手机折线感
fx.setInputSamplingRate(1000); // 高轮询率上限
fx.setInputSamplingRate(0);   // 恢复不限频
```

## 独立时间倍率

`clickTimeScale` 和 `trailTimeScale` 都必须是有限且不小于 `0.01` 的数字。`1` 为原始速度，`2` 表示两倍速度且持续时间减半，`0.5` 表示半速且持续时间加倍；`0` 不表示暂停，低于 `0.01` 的值会被忽略。两个倍率都可通过 `updateConfig()` 实时更新：

```js
fx.updateConfig(
{
  clickTimeScale: 1.5,
  trailTimeScale: 0.8,
});
```

`clickTimeScale` 同时缩放点击波纹生命周期、旋转、点击碎片寿命和位移；`trailTimeScale` 同时缩放拖尾衰减、拖尾碎片寿命和位移。倍率不会改变 `minVertexDistance`、`trailSpacing` 等空间采样参数。

## 暂停与恢复

```js
const pauseOptions =
{
  clear: true,
};

fx.setPaused(true, pauseOptions);
fx.setPaused(false);
```

暂停会取消当前活动指针，忽略 `boom()` 与所有自动或手动指针输入，并停止申请新的 `requestAnimationFrame`。`clear` 只在 `paused` 为 `true` 的调用中生效；`clear: true` 会同时清除全部视觉对象，`setPaused(false, { clear: true })` 不会清屏。恢复时会重置时间基准，暂停期间不会被计入下一帧。

`trailAlways` 也使用按需渲染：活动指针本身不代表存在可见内容。没有波纹、碎片或有效轨迹点后会停止 RAF，下一次 `pointerMove()` 再自动唤醒渲染。

## 参数 Schema 与批量写入

库导出只读的 `FX_PARAM_SCHEMA`、当前 `FX_PARAM_SCHEMA_VERSION` 和 `FX_PARAM_MIGRATIONS`。Schema 描述每个公开标量路径的类型、硬边界、默认值、单位、分组、稳定展示顺序、本地化键、推荐控件范围和关联参数，宿主无需再手抄控件清单。`step` 与 `display.step` 只指导宿主 UI；`setFxParam()` / `setFxParams()` 不按步进量化或取整，只校验类型、有限值和 `min` / `max` 硬边界。需要整数控件的宿主应在提交前自行取整。

当前 `FX_PARAM_SCHEMA_VERSION` 为 `2`。旧版 `bloom.scatter` 与 MXFinalBloom 的 `bloom.diffusion` 不存在可证明的视觉等价换算；从版本 `0` 迁移到 `1` 时，路径会改为 `bloom.diffusion`，旧值则明确恢复为 Unity 默认值 `7`，并在 `normalized` 中分别报告 `renamed` 与 `defaulted`。版本 `1` 到 `2` 是不改写既有路径的空迁移，并为新增的 `shards.roundness` 使用默认值 `0`。持久化补丁应把原始版本传给 `schemaVersion`，由库按 `FX_PARAM_MIGRATIONS` 顺序迁移。高于当前版本、缺失迁移链或迁移后冲突的补丁会被明确拒绝，而不是静默丢弃。

```js
import {
  BAClickFX,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  applyFxParamPatch,
} from 'ba-click-fx';

const fx = new BAClickFX();
const result = fx.setFxParams(
{
  'bloom.scatter': 0.35,
  'rings.hdrIntensity': 6.2,
},
{
  schemaVersion: 0,
  strict: true,
  reset: true,
});

console.log(FX_PARAM_SCHEMA.length, FX_PARAM_SCHEMA_VERSION, result);
```

设置页也可以在不创建 DOM 或渲染实例时迁移并校验持久化补丁：

持久化时同时保存版本与补丁，例如 `{ schemaVersion: 0, patch: { "bloom.scatter": 0.35 } }`。读取时使用记录的版本，不假设它已经是当前版本。以下模块仅在迁移成功时写回；JSON、Schema 或迁移错误都会保留原记录并报告原因。没有版本字段的旧数据应由宿主提供已知的原版本，不能猜测。

```js
import { applyFxParamPatch } from 'ba-click-fx';

// Store the version with the patch so a future library can migrate it.
export function migrateStoredFx(storage = localStorage)
{
  const key = 'ba-click-fx';
  try
  {
    const raw = storage.getItem(key);
    if (raw === null)
    {
      return null;
    }
    const stored = JSON.parse(raw);
    if (!stored || !Number.isInteger(stored.schemaVersion) ||
      stored.schemaVersion < 0 || !stored.patch ||
      typeof stored.patch !== 'object' || Array.isArray(stored.patch))
    {
      throw new TypeError('Expected { schemaVersion, patch }');
    }

    const migrated = applyFxParamPatch(stored.patch,
    {
      schemaVersion: stored.schemaVersion,
      strict: true,
    });
    if (!migrated.committed)
    {
      console.error('FX patch rejected', migrated.rejected);
      return null;
    }

    const record =
    {
      schemaVersion: migrated.schemaVersion,
      patch: Object.fromEntries(
        migrated.applied.map(({ path, value }) => [path, value]),
      ),
    };
    storage.setItem(key, JSON.stringify(record));
    return record;
  }
  catch (error)
  {
    // Invalid JSON or unavailable storage must not overwrite the saved record.
    console.error('FX settings could not be restored', error);
    return null;
  }
}
```

浏览器中调用 `const restored = migrateStoredFx();`；返回记录后，通过 `fx.setFxParams(restored.patch, { schemaVersion: restored.schemaVersion, strict: true, reset: true })` 应用到实例。

包根 `applyFxParamPatch()` 固定以游戏默认参数作为内部校验基线，只接受 `schemaVersion` 与 `strict`，不会修改实例，也不会公开完整 Unity 配置树。此处 `committed` 表示候选补丁可以安全写回存储；实例级 `setFxParams()` 的 `committed` 才表示配置已提交到当前渲染实例。模式重置仍由实例级 `reset: true` 负责。

返回对象包含 `applied`、`normalized`、`rejected`、`committed` 和 `schemaVersion`：`applied` 是最终接受的路径和值；`normalized` 记录路径重命名、旧值恢复默认、数值钳制或布尔转换；`rejected` 给出路径、原值和原因；`committed` 表示候选配置是否真正提交。默认 `strict: false` 会提交合法项并报告拒绝项；`strict: true` 只要出现一个拒绝项就回滚整批，且 `applied` 为空。`reset: true` 会先恢复 Unity 基线，再应用同一批补丁；即使补丁为空，也会提交该重置。`setFxParam()` 复用相同校验并采用严格单项语义。

## 主题颜色

主题色只更新当前实例，不会自动写入浏览器存储。需要刷新后恢复时，由宿主保存 `themeColor` 与 `themeColorMode`，重新读取后通过构造参数或 `updateConfig()` 应用。

`themeColor` 和 `themeColorMode` 都是实例配置状态：可在构造参数或 `updateConfig()` 中设置，`setThemeColor()` 与 `setThemeColorMode()` 使用同一规范化路径，`getConfig()` 会返回当前值。主题色只接受六位十六进制颜色；空字符串或非法值恢复导出的 `DEFAULT_THEME_COLOR`（`#4ca7ff`）。非法主题颜色模式会被拒绝，`setThemeColorMode()` 返回 `false` 并保持当前模式不变。两项配置都不会改写 `UNITY_FX_TOUCH` 或 `FX_PARAM_SCHEMA` 的 Unity 参数基线。

公共库导出的 `DEFAULT_THEME_COLOR_MODE` 为 `relative-oklch`，按 OKLCH 相对映射完整调整主题颜色。需要旧色相行为的宿主必须显式传入 `themeColorMode: 'hue-only'`；展示页对没有显式持久化模式的配置统一采用新默认值。

`relative-oklch` 以默认游戏蓝 `#4ca7ff` 为基准，将主题色相对基准的 OKLCH 色相、色度和感知明度变化映射到 Unity 原始颜色。明度会在线性 RGB HDR 发射进入 Bloom 预过滤之前调整能量，因此较暗主题会自然减少超过阈值的 Bloom，而不是在 Final Pass 中压暗已经生成的光晕。当透明覆盖层使用未知背景的 `source-over` 传输时，引擎还会按目标颜色的 sRGB 峰值独立限制 Coverage Alpha，避免暗色变成实心遮挡；该限制不缩放 Scene、Screen/Plus-lighter 或 HDR 发射能量。默认游戏蓝必须走恒等映射，保持 Unity 默认像素不变；纯黑主题的发光能量为零，在未知背景透明覆盖中不会生成黑色遮罩或残留光晕。已知 Scene 仍保留 Unity 材质原本的 Alpha 混合语义。

## 碎片圆角

`setTriangleRoundness(value)` 是 `setFxParam('shards.roundness', value)` 的便捷 API。默认值 `0` 完全保留当前三角图集；`0..1` 基于原图集三角边界，用与直边相切的圆弧连续磨平尖角，并同步重映射纹理以避免出现内部尖三角；`1` 会把所有点击和拖尾三角碎片变成同尺寸圆形。运行时修改会让现存粒子在下一帧即时响应。有限的越界值由 Schema 钳制到 `0..1`，非有限值会被拒绝。

```js
fx.setTriangleRoundness(0.5);
fx.setFxParam('shards.roundness', 0.5);
```

## 点击辉光

点击辉光可独立于轨迹调节。该倍率只改变圆环和中心光盘的
Bloom 发射；原生辉光使用保持单调的有界 Alpha 映射：

```js
fx.setFxParam('bloom.clickEmissionScale', 1.25);
```

## 常用可调特效参数（完整清单以 FX_PARAM_SCHEMA 为准）

| 路径 | 默认值 | 说明 |
|---|---|---|
| `rings.hdrIntensity` | 5.992157 | 圆环 HDR 强度 |
| `rings.radiusMin` | 68.92571232 | MeshTri 随机外半径下限；生命周期大小曲线应用前的基准值 |
| `rings.radiusMax` | 80.41333104 | MeshTri 随机外半径上限；生命周期大小曲线应用前的基准值 |
| `rings.bandToOuterRadius` | 0.0598573766 | 原网格环宽与外半径的固定比值 |
| `rings.widthStart` | 1 | 生命周期起点的资源环宽倍率，不是独立像素宽度 |
| `rings.widthEnd` | 1 | 生命周期终点的资源环宽倍率，不是独立像素宽度 |
| `rings.lifetimeMs` | 600 | 圆环寿命 (ms) |
| `shards.hdrIntensity` | 5.992157 | 碎片材质 HDR 强度；渲染时还会乘资源起始色 |
| `shards.roundness` | 0 | 三角碎片圆角比例；`0` 保留原图集，`1` 变为同尺寸圆形 |
| `shards.clickCount` | 4 | 点击碎片数量 |
| `shards.maxCount` | 50 | 每次按下实例的拖尾碎片上限；点击碎片和旧实例不占用额度 |
| `shards.trailSpacing` | 108 | 拖尾碎片间距 |
| `bloom.threshold` | 1.0 | Unity 序列化的 Gamma 空间高亮阈值；预过滤前转换到 Linear |
| `bloom.softKnee` | 0 | 阈值过渡柔和度 |
| `bloom.clamp` | 65472 | Unity 序列化的 Gamma 空间预过滤上限；CPU 换算后受 half 上限 65504 约束 |
| `bloom.intensity` | 1.7 | 游戏 MXFinalBloom 的序列化曝光强度；CPU 换算后传给 Shader |
| `bloom.diffusion` | 7 | 决定 mip 层数与 SampleScale 的扩散参数 |
| `bloom.resolutionScale` | 0.5 | Bloom 缓冲区相对分辨率（内部限制为 0.1~0.75） |
| `bloom.clickEmissionScale` | 1.0 | 点击圆环与中心光盘的独立辉光倍率，推荐 `0~4`；不影响清晰几何或轨迹 |
| `bloom.ringEmissionAlpha` | 1.0 | 与 FX_MAT_Touch_Tri3 材质 Alpha 对齐的圆环 HDR 发射 |
| `bloom.diskEmissionAlpha` | 1.0 | 软件 Bloom 光盘 HDR 发射校准 |
| `bloom.ringBlur` | 80 | 像素回读不可用时的圆环原生模糊半径 |
| `bloom.ringAlpha` | 0.35 | 像素回读不可用时的圆环原生模糊强度 |
| `bloom.diskBlur` | 65 | 像素回读不可用时的光盘原生模糊半径 |
| `bloom.diskAlpha` | 0.65 | 像素回读不可用时的光盘原生模糊强度 |
| `bloom.trailCoverageScale` | 1.0 | 保持 Bloom 发射源与 Unity 2.7px 三角带同宽 |
| `bloom.trailEmissionAlpha` | 1.0 | 软件 Bloom 拖尾 HDR 发射校准 |
| `bloom.trailAlpha` | 0.18 | 原生局部离屏模糊回退强度 |
| `trail.width` | 2.7 | 拖尾清晰几何带宽度 |
| `trail.outerGlowWidth` | 9 | 原生局部离屏回退光晕半径 |
| `trail.lifetimeMs` | 300 | 拖尾寿命 (ms) |

`rootDurationMs = 1000` 只保留原 Unity 根 ParticleSystem 的对象池释放元数据。网页端视觉生命周期由各子粒子和 TrailRenderer 自身的寿命决定；该字段不是视觉调参，修改它不会改变画面。
