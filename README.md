# ba-click-fx — 蔚蓝档案网页点击特效与光标拖尾

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![GitHub Stars](https://img.shields.io/github/stars/CialloKing/ba-click-fx.svg)](https://github.com/CialloKing/ba-click-fx/stargazers)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-安装-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) [![Edge Add-on](https://img.shields.io/badge/Edge_Add--on-安装-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) [![Firefox Add-on](https://img.shields.io/badge/Firefox_Add--on-安装-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/)

> 📖 [English version](./README.en.md)

**为网页添加《蔚蓝档案》风格的点击圆环、碎片和光标拖尾。** 默认参数来自游戏 Unity 资源，支持主题色与运行时调参，零外部运行时依赖。默认使用 WebGL2；可选 WebGPU，GPU 不可用时使用 Canvas 2D 与原生辉光。

**在线演示：** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

点击、拖拽或移动鼠标即可预览。历史 GIF 用于效果参考，当前功能以在线演示为准。

<p align="center">
  <img src="https://github.com/CialloKing/ba-click-fx/releases/download/v1.2.12/ba-click-fx-demo.gif" alt="demo（历史录制）" width="45%">
  &nbsp;&nbsp;
  <img src="https://raw.githubusercontent.com/CialloKing/ba-click-fx/main/docs/assets/blue-archive-reference.gif" alt="game reference" width="45%">
</p>
<p align="center"><sub>ba-click-fx 项目演示（左，v1.2.12 历史录制） · 游戏内效果参考（右，仅用于效果对比）</sub></p>

## 桌面版（Windows 测试版）

[ba-click-fx-desktop](https://github.com/CialloKing/ba-click-fx-desktop) 是独立实现的 Windows 10/11 x64 原生桌面版，提供点击特效、鼠标拖尾、Control Center、背景感知和 OBS 透明特效输出。

通过 Control Center 或通知区域菜单控制特效启停；全局快捷键默认未绑定，可在控制中心配置。当前人工特效审核以单主屏 SDR 为准，背景捕获与 OBS 输出需满足相应环境要求。

桌面版不复用本项目的 JavaScript / WebGL / WebGPU 运行时。安装包、使用方式和最新支持范围请以[桌面仓库](https://github.com/CialloKing/ba-click-fx-desktop)为准。

## 目录

- [桌面版（Windows 测试版）](#桌面版windows-测试版)
- [特性](#特性)
- [使用方式](#使用方式)
- [网页集成建议](#网页集成建议未知背景输出合成)
- [常见用法](#常见用法)
- [API 文档](#api-文档)
- [专题文档](#专题文档)
- [常见问题](#常见问题)
- [开发说明](#开发说明)
- [和其他项目的区别](#和其他项目的区别)
- [Star 历史](#star-历史)
- [致谢与许可](#致谢与第三方许可)

## 特性

- 点击溶解圆环、中心光盘、碎片爆发与连续拖尾。
- 默认参数来自 Unity 资源，支持主题色与运行时调参。
- WebGL2 默认后端，WebGPU 与实验性 HDR 输出可选。
- GPU 能力不足时回退 Canvas 2D 与原生辉光。
- 支持容器挂载、手动输入及 Dedicated Worker。
- 无活跃特效时自动停止动画调度。

## 使用方式

以下三种方式任选其一，示例已包含普通网页推荐的覆盖层配置。点击页面或按住指针拖动即可看到效果；无需按下的拖尾见[常见用法](#拖尾主题色和开关)。

### npm

```bash
npm install ba-click-fx
```

```js
import { BAClickFX } from 'ba-click-fx';

const fx = new BAClickFX(
{
  outputCompositing: 'browser-overlay',
  hostCompositing: 'screen',
  hostCompositingSurface: 'dom-backdrop',
});
```

将代码放入 Vite 等构建工具的客户端入口；组件框架中在挂载后创建实例，卸载时调用 `fx.destroy()`。

### CDN

```html
<script type="module">
  import { BAClickFX } from 'https://cdn.jsdelivr.net/npm/ba-click-fx@1.3.3/dist/ba-click-fx.js';

  const fx = new BAClickFX(
  {
    outputCompositing: 'browser-overlay',
    hostCompositing: 'screen',
    hostCompositingSurface: 'dom-backdrop',
  });
</script>
```

将这段代码放在页面的 `</body>` 前。

### 直接下载

从 [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases) 下载所需的 ESM 入口。普通网页只需主入口 `ba-click-fx.js`；类型声明的使用方式见表后说明。

| 入口 | JavaScript | 类型声明（包名导入） |
|---|---|---|
| 主入口 | [ba-click-fx.js](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/ba-click-fx.js) | [ba-click-fx.d.ts](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/ba-click-fx.d.ts) |
| 配置 | [config.js](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/config.js) | [config.d.ts](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/config.d.ts) |
| Worker | [worker.js](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/worker.js) | [worker.d.ts](https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.3/worker.d.ts) |

**TypeScript：** 推荐使用上方的 [npm 方式](#npm)，通过 `import { BAClickFX } from 'ba-click-fx'` 自动获取类型；需要自托管时，由构建工具生成并部署静态文件。当前下载的主声明使用 `declare module 'ba-click-fx'`，配置和 Worker 声明也引用该包名。仅把 `.d.ts` 放在下载的 JS 旁边，不能为 `import ... from './ba-click-fx.js'` 提供可直接使用的模块类型，会出现 TS2306（声明文件不是模块）。

本包和 CDN 构建仅提供 ESM。以下是浏览器 JavaScript 示例：使用 `type="module"` 和 `import`，将下载文件与页面一起通过 HTTP(S) 服务访问；不提供 IIFE 或 UMD 全局脚本。

```html
<div id="fx-host"></div>
<style>#fx-host { position: relative; min-height: 240px; }</style>
<script type="module">
  import { BAClickFX } from './ba-click-fx.js';

  const fx = new BAClickFX(
  {
    target: '#fx-host',
    outputCompositing: 'browser-overlay',
    hostCompositing: 'screen',
    hostCompositingSurface: 'dom-backdrop',
  });
</script>
```

将 `ba-click-fx.js` 放在页面同目录，在容器内点击或拖动即可预览。

省略 `target` 会创建全屏覆盖层；普通网页容器应使用定位元素。已有 `HTMLCanvasElement` 适合需要自行管理单张 Canvas 的宿主，但会关闭多层 DOM 合成并使完整 GPU/Bloom 路径安全降级。

### 浏览器插件

不想写代码？直接安装浏览器扩展，即可为所有网页添加蔚蓝档案风格点击特效和光标拖尾：

| 商店 | 安装链接 |
|------|----------|
| **Chrome** | [Chrome Web Store](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) |
| **Edge** | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) |
| **Firefox** | [Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/) |

源代码：[ba-click-fx-extension](https://github.com/CialloKing/ba-click-fx-extension)

## 网页集成建议：未知背景输出合成

上方示例已使用普通网页推荐的 `browser-overlay + screen + dom-backdrop`，无需追加配置。库默认值仍是 `scene + source-over`，也不会自动读取网页背景。

可在在线演示中按下表选择对应选项：

| 展示页选项 | API 配置 | 适用情况 |
|---|---|---|
| 输出合成：**透明覆盖层** | `outputCompositing: 'browser-overlay'` | 输出独立覆盖层，由网页完成最终合成 |
| 特效背景参考：**未知透明背景（兼容）** | 不提供参考，或 `setCompositingReference(null)` | 无法持续提供逐像素匹配的页面背景时使用 |
| 宿主合成：**DOM Add（近似）** | `hostCompositing: 'screen'` | 普通网页推荐，适合未知、中灰、浅色或变化的背景 |
| 宿主合成：**Plus-lighter（原始加色）** | `hostCompositing: 'plus-lighter'` | 仅在已知黑色或暗色背景上考虑；亮底容易提前饱和 |

`screen` 与 `plus-lighter` 二选一。纯白背景没有继续增亮的空间，`screen` 也不能保证白底上的颜色对比；先检查背景与混合方式，再调整辉光强度。

新实例默认没有背景参考；复用曾设置参考的实例时，调用 `fx.setCompositingReference(null)` 清除旧参考。推荐配置属于浏览器/DOM 的 SDR 视觉近似；严格 Unity Scene RGB 需要匹配的已知背景或宿主线性 HDR 合成。

[宿主表面与状态诊断](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#输出与宿主合成)介绍已有 Canvas、透明窗口、实际生效模式和 Alpha 选项的边界；[合成参考与线性合成](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#合成参考与线性合成)说明已知背景的接入方式。

## 常见用法

### 拖尾、主题色和开关

以下示例沿用上面的 `fx` 实例。默认拖尾需要按住指针，开启 `trailAlways` 后移动即可显示：

```js
fx.updateConfig({ trailAlways: true });
fx.setThemeColor('#ff80b5');
fx.updateConfig({ scale: 0.8, opacity: 0.7 });
// 调弱辉光；默认强度为 1.7。
fx.setFxParam('bloom.intensity', 1.2);
```

在当前画布中心触发一次点击：

```js
fx.boom();
```

按需关闭点击，并保留拖尾：

```js
fx.updateConfig({ clickEnabled: false, trailEnabled: true });
```

两个开关分别控制对应效果，设回 `true` 即可重新开启。`boom()` 使用 Canvas 局部 CSS 像素坐标。主题色只接受六位十六进制值；非法值恢复默认游戏蓝。主题色仅更新当前实例；刷新后恢复需要宿主自行保存、读取并应用。

### 采样率与播放速度

```js
fx.updateConfig({ inputSamplingRate: 30 });
fx.updateConfig({ clickTimeScale: 1.5, trailTimeScale: 0.8 });
```

采样率接受 `0`（不限频）或 `1..1000` Hz，仅限制移动输入，不限制渲染帧率。时间倍率 `1` 为原速，`2` 为两倍速；暂停请使用 `setPaused()`。

### 暂停与卸载清理

按实际需要选择操作。需要暂停并清屏时：

```js
fx.setPaused(true, { clear: true });
```

需要恢复输入与动画时：

```js
fx.setPaused(false);
```

仅清除拖尾时调用 `fx.clearTrail()`；清空全部效果时调用 `fx.clear()`。这两个操作不会暂停实例。

仅在组件卸载或不再使用该实例时：

```js
fx.destroy();
```

`clearTrail()` 保留点击特效与点击碎片。`destroy()` 释放实例资源及其监听，只移除库创建的 Canvas。SPA 或组件框架应在客户端挂载时创建实例，并在卸载时调用它；重新挂载时创建新实例。

## API 文档

此处提供速查；完整签名、返回值和运行时规则见 [API 参考](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md)。

### 构造函数

以下默认值属于库本身；推荐网页集成配置需要显式覆盖对应选项。

| 配置 | 默认值 | 说明 |
|---|---|---|
| `target` | 全屏覆盖层 | 定位容器、已有 Canvas 或 OffscreenCanvas |
| `scale` / `opacity` | `1` / `1` | 大小倍率 / 不透明度 |
| `themeColor` | `#4ca7ff` | 六位十六进制颜色 |
| `themeColorMode` | `relative-oklch` | 完整颜色映射；`hue-only` 保留旧色相偏移 |
| `clickEnabled` / `trailEnabled` | `true` / `true` | 分别控制点击和拖尾 |
| `trailAlways` | `false` | 设为 `true` 后无需按下即可显示拖尾 |
| `effectBackend` / `bloomBackend` | `webgl2` / `webgl2` | GPU 失败回退原生辉光；软件 Bloom 仅显式选择 |
| `outputCompositing` | `scene` | 普通未知背景网页推荐显式使用 `browser-overlay` |
| `hostCompositing` | `source-over` | 推荐网页覆盖层配合使用 `screen` |
| `hostCompositingSurface` | `dom-backdrop` | 透明桌面窗口使用 `transparent-window` |
| `maxDpr` | `1` | 最大设备像素比；提高后会增加渲染开销 |
| `touchAction` | `auto` | 默认保留浏览器原生手势 |

### 实例方法

| 方法 | 说明 |
|---|---|
| `resize(width?, height?, dpr?)` | 显式同步 Canvas 的 CSS 尺寸与 DPR，主要用于 Worker / OffscreenCanvas 宿主 |
| `boom(x?, y?)` | 触发单次点击特效；省略坐标时使用画布中心，不创建拖尾状态 |
| `pointerDown(input)` | 开始一次点击和拖尾生命周期 |
| `pointerMove(input)` | 为当前逻辑指针追加拖尾采样点 |
| `pointerUp(pointerId?)` | 正常结束指针，已有拖尾自然消失 |
| `pointerCancel(pointerId?)` | 强制取消指针并立即移除当前轨迹 |
| `setPaused(paused, options?)` | 暂停或恢复输入与动画调度，可选在暂停时清屏 |
| `setInputSamplingRate(rateHz)` | 设置移动输入采样率上限；接受 `0` 或 `1..1000`，成功返回 `true` |
| `setCompositingReference(source, { fit: 'cover' })` | 设置各渲染后端共享的已知栅格合成参考；传入 `null` 清除参考并进入未知背景路径 |
| `clear()` | 清除全部视觉对象 |
| `clearTrail()` | 清除拖尾及拖尾碎片，保留点击特效与点击碎片 |
| `destroy()` | 销毁实例并移除其监听；仅移除库创建的 Canvas |
| `updateConfig({...})` | 运行时更新配置并返回配置快照；`target` 与 `inputFilter` 仅在构造时设置 |
| `setThemeColor('#4ca7ff')` | 更新当前实例的主题色；非法值恢复默认游戏蓝 |
| `setThemeColorMode(mode)` | 切换主题颜色映射模式；接受 `hue-only` 或 `relative-oklch`，成功返回 `true` |
| `setTriangleRoundness(value)` | 设置三角碎片圆角比例；与 `setFxParam('shards.roundness', value)` 等价 |
| `setFxParam('rings.hdrIntensity', 5.992157)` | 修改单个点号路径；成功返回 `true`，拒绝时返回 `false` |
| `setFxParams(patch, options?)` | 按 Schema 验证并批量应用点号路径补丁，返回逐项处理结果 |
| `getFxConfig()` | 返回当前完整特效配置深拷贝 |
| `resetFxConfig()` | 重置所有特效参数为 Unity 基线 |
| `getConfig()` | 返回当前实例配置；除完整特效和 Bloom 的解析结果外，还报告 WebGPU 输出和宿主合成的实际状态 |
| `getEffectiveHostCompositing()` | 返回实际生效的宿主合成模式 |

后端能力延迟探测期间状态可能为 `pending`。用 `getConfig()` 的 `resolvedEffectBackend` / `resolvedBloomBackend` 读取实际后端，使用导出的后端变化事件跟踪回退和恢复。

## 专题文档

### API 与参数

[构造、方法与返回值](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md) · [手动输入](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md#宿主输入与指针生命周期) · [Schema 与持久化](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md#参数-schema-与批量写入) · [主题色](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md#主题颜色)

### 渲染与合成

[后端、HDR 与背景合成](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md) · [点击与拖尾](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#效果说明) · [项目架构](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#项目结构)

### Worker 接入

[完整接入示例](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.md)：主线程与 Worker、尺寸和坐标同步、销毁与能力边界。

## 常见问题

### 常见接入

#### 为什么只移动鼠标没有拖尾？

设置 `fx.updateConfig({ trailAlways: true })`，并确认 `trailEnabled` 为 `true`。默认拖尾需要按住指针；仅移动时不会显示。见[拖尾、主题色和开关](#拖尾主题色和开关)。

#### 移动端浏览器滑动时为什么没有轨迹拖尾？

需要全方向拖尾时设置 `touchAction: 'none'`，展示页对应“触摸行为：禁止默认手势”。默认 `auto` 保留原生滚动，浏览器接管手势后会发送 `pointercancel` 并中止拖尾；仍需单轴滚动时选择 `pan-x` 或 `pan-y`，被接管的方向仍会中止拖尾。该设置会改变页面滚动与缩放手势。见[触摸策略](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md#构造函数)。

#### 容器里的特效尺寸或位置不对怎么办？

为目标容器设置 `position: relative` 和可见的非零宽高，例如 `min-height: 240px`；`target` 指向该容器。隐藏容器显示后可调用 `fx.resize()` 重新同步尺寸。见[容器接入示例](#直接下载)与[尺寸 API](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md#实例方法)。

#### 组件挂载和卸载时如何管理实例？

在客户端挂载后创建一次实例，在卸载时调用 `fx.destroy()`；重新挂载时创建新实例，避免重复初始化。SSR 不应在服务端创建实例。见[暂停与卸载清理](#暂停与卸载清理)。

### 渲染与兼容

#### 为什么纯白背景上的颜色变淡？

普通未知背景网页先使用[推荐配置](#网页集成建议未知背景输出合成)。白底没有继续增亮的通道空间；若保留 `scene` 输出且需要非游戏的颜色保留，可显式启用隔离合成。见[输出与宿主合成](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#输出与宿主合成)。

#### WebGPU 模式一定会显示真实 HDR 吗？

先检查 `fx.getConfig().resolvedWebGPUOutputMode === 'extended'`。仅选择 WebGPU 不保证真实 HDR，还需要显示器、系统和浏览器支持；普通 SDR 模式使用 `webgpuPreferHdr: false`。见[WebGPU 与 HDR](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#webgpu-与-hdr)。

#### 隔离合成能否替代合成参考？

不能。需要严格已知 Scene 计算时，应提供实际匹配的背景参考；隔离只改变 DOM 图层的合成边界。见[合成参考与线性合成](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#合成参考与线性合成)。

#### 未知背景上能否同时得到严格 Unity 加色、纯 Coverage Alpha，并保证白底绝不变暗？

不能同时保证。需要严格 Unity 加色时，使用 `scene` 并提供逐像素匹配的已知背景参考；未知背景网页使用推荐覆盖层配置。原理见[输出与宿主合成](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#输出与宿主合成)。

#### 透明桌面宿主应该使用什么配置？

设置 `outputCompositing: 'browser-overlay'`、`hostCompositingSurface: 'transparent-window'` 和 `hostCompositing: 'source-over'`。CSS 混合不能跨越操作系统窗口边界。见[透明窗口配置与能力边界](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#输出与宿主合成)。

## 开发说明

需要 Node.js `>=24.0.0`，CI 使用 `24.19.0`。浏览器直接使用已构建 ESM 不需要 Node.js。

```bash
git clone https://github.com/CialloKing/ba-click-fx.git
cd ba-click-fx
npm ci
npm run dev
```

日常检查可独立运行，无需先启动开发服务器：

```bash
npm run check
```

`check` 执行构建、测试、同步校验和打包安装检查。核心像素与 Worker 浏览器验证可单独运行 `npm run test:browser`。

浏览器检查需要 Chrome / Edge，可用 `BACLICKFX_CHROMIUM_PATH` 指定路径。

## 和其他项目的区别

`ba-click-fx` 更关注《蔚蓝档案》游戏内点击反馈的细节还原，v1.2.0 起改为从游戏 Unity Prefab 逐参数移植。参数与渲染依据来自 Unity 工程；最终像素是否一致仍取决于后端、已知场景背景、色彩管理与宿主合成链。

相比通用 cursor effects，本项目重点实现：

- 游戏风格的溶解圆环、中心光盘和碎片爆发
- 参数级还原 Unity ParticleSystem 颜色/大小/旋转曲线
- 旧轨迹点先消失，拖尾沿路径连续缩短，而不是整条轨迹同时淡出
- 粒子尺寸随画布高度持续缩放，保持 Unity UI 相对比例
- 数十项可调参数与自定义主题色，适合微调偏好

相关项目：

- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor)
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark)
- [ZM-Kimu/Blue-Archive-Touch-Effect](https://github.com/ZM-Kimu/Blue-Archive-Touch-Effect)

## Star 历史

本仓库在独立的 `star-history` 分支维护 Star 数量历史，并由定时任务每天更新一次。

<p align="center">
  <a href="https://github.com/CialloKing/ba-click-fx/blob/star-history/stars.csv">
    <img src="https://raw.githubusercontent.com/CialloKing/ba-click-fx/refs/heads/star-history/star-history.svg" alt="ba-click-fx Star 数量历史图" width="960">
  </a>
</p>

[查看 CSV 原始数据](https://github.com/CialloKing/ba-click-fx/blob/star-history/stars.csv)。漏跑日期保持缺失，不使用插值或伪造快照补齐。

---

## 致谢与第三方许可

本项目早期的 Canvas 2D 点击特效实现曾参考以下 MIT 许可项目的实现方式、参数设计和视觉表现：

- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark)
- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor)

当前版本已经过大幅重构，包括独立的拖尾采样、速度响应、曲线重建、长度控制和消散系统。

相关版权声明和 MIT 许可文本请参阅 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

---

## 许可

MIT
