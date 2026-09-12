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

## 目录

- [特性](#特性)
- [使用方式](#使用方式)
- [常见用法](#常见用法)
- [API 文档](#api-文档)
- [专题文档](#专题文档)
- [常见问题](#常见问题)
- [开发说明](#开发说明)
- [桌面版与相关项目](#桌面版windows-测试版)
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

<a id="2-npm-安装"></a>

### npm

```bash
npm install ba-click-fx
```

```js
import { BAClickFX } from 'ba-click-fx';
const fx = new BAClickFX();
```

<a id="3-cdn-引入"></a>

### CDN

```html
<script type="module">
  import { BAClickFX } from 'https://cdn.jsdelivr.net/npm/ba-click-fx@1.3.3/dist/ba-click-fx.js';
  const fx = new BAClickFX();
</script>
```

<a id="4-直接下载"></a>

### 直接下载

从 [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases) 下载 ESM 构建产物（`ba-click-fx.js`、`config.js`、`worker.js` 及对应 `.d.ts` 声明）：

本包和 CDN 构建仅提供 ESM。浏览器直接引入时需要 `type="module"`；`require()` 和普通 `<script>` 标签不是当前发布格式，需要先由 bundler 打包。

```html
<div id="fx-host"></div>
<style>#fx-host { position: relative; min-height: 240px; }</style>
<script type="module">
  import { BAClickFX } from './ba-click-fx.js';
  const fx = new BAClickFX({ target: '#fx-host' });
</script>
```

省略 `target` 会创建全屏覆盖层；普通网页容器应使用定位元素。已有 `HTMLCanvasElement` 适合需要自行管理单张 Canvas 的宿主，但会关闭多层 DOM 合成并使完整 GPU/Bloom 路径安全降级。

<a id="1-浏览器插件"></a>

### 浏览器插件

不想写代码？直接安装浏览器扩展，即可为所有网页添加蔚蓝档案风格点击特效和光标拖尾：

| 商店 | 安装链接 |
|------|----------|
| **Chrome** | [Chrome Web Store](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) |
| **Edge** | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) |
| **Firefox** | [Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/) |

源代码：[ba-click-fx-extension](https://github.com/CialloKing/ba-click-fx-extension)

## 常见用法

### 网页集成建议：未知背景输出合成

普通网页通常无法提供与页面内容逐像素匹配的背景参考，推荐以下配置。它与库默认的 `scene + source-over` 不同，需显式设置：

```js
import { BAClickFX } from 'ba-click-fx';

const fx = new BAClickFX(
{
  outputCompositing: 'browser-overlay',
  hostCompositing: 'screen',
  hostCompositingSurface: 'dom-backdrop',
});
```

`screen` 适合未知、中灰或浅色 DOM 背景，是 SDR 视觉近似。只有已知黑色或暗色宿主才考虑 `plus-lighter`。透明桌面窗口应改用 `transparent-window + source-over`；CSS 混合不能跨越操作系统窗口边界。完整选择规则见 [渲染与合成指南](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md)。

### 拖尾、主题色和开关

以下示例沿用上面的 `fx` 实例。默认拖尾需要按住指针，开启 `trailAlways` 后移动即可显示：

```js
fx.updateConfig({ trailAlways: true });
fx.setThemeColor('#ff80b5');
fx.updateConfig({ scale: 0.8, opacity: 0.7 });
fx.setFxParam('bloom.intensity', 1.7);
fx.boom(fx.width / 2, fx.height / 2);
fx.updateConfig({ clickEnabled: true, trailEnabled: true });
```

将 `clickEnabled` 或 `trailEnabled` 设为 `false` 可关闭对应效果。 `boom()` 使用 Canvas 局部 CSS 像素坐标。主题色只接受六位十六进制值；非法值恢复默认游戏蓝。主题色仅更新当前实例；刷新后恢复需要宿主自行保存、读取并应用。

### 采样率与播放速度

```js
fx.updateConfig({ inputSamplingRate: 30 });
fx.updateConfig({ clickTimeScale: 1.5, trailTimeScale: 0.8 });
```

采样率接受 `0`（不限频）或 `1..1000` Hz，仅限制移动输入，不限制渲染帧率。时间倍率 `1` 为原速，`2` 为两倍速；暂停请使用 `setPaused()`。

### 暂停与卸载清理

```js
fx.setPaused(true, { clear: true });
fx.setPaused(false);
fx.clearTrail();
fx.clear();
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

以下入口保留原章节名称，便于旧链接继续访问。专题均提供中英文版本。

### 合成参考与线性合成

[合成参考与线性合成](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#合成参考与线性合成)

### 宿主输入与指针生命周期

[宿主输入与指针生命周期](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md#宿主输入与指针生命周期)

### 宿主拥有的 Worker 与 OffscreenCanvas

[Worker 完整示例与清理流程](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.md)

### 独立时间倍率

[独立时间倍率说明](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md#独立时间倍率)

### 暂停与恢复

[暂停、恢复与按需渲染](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md#暂停与恢复)

### 参数 Schema 与批量写入

[参数 Schema、迁移与持久化示例](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md#参数-schema-与批量写入)

### 常用可调特效参数（完整清单以 FX_PARAM_SCHEMA 为准）

[常用参数表与默认值](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md#常用可调特效参数完整清单以-fx_param_schema-为准)

### 效果说明

[点击、拖尾及后端能力边界](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#效果说明)

#### 点击特效

[点击特效](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#点击特效)

#### 拖尾轨迹

[拖尾轨迹](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#拖尾轨迹)

#### Bloom 渲染后端

[Bloom 渲染后端](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#bloom-渲染后端)

#### JavaScript 软件 Bloom

[JavaScript 软件 Bloom](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#javascript-软件-bloom)

#### 后端能力边界

[后端能力边界](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#后端能力边界)

### 项目结构

[项目结构与渲染架构](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#项目结构)

#### 架构特点

[架构特点](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#架构特点)

## 常见问题

### WebGPU 模式一定会显示真实 HDR 吗？

不会。只有 `resolvedWebGPUOutputMode === 'extended'` 表示 Canvas 协商成功；还需要显示器、系统和浏览器支持。普通 WebGPU SDR 模式使用 `webgpuPreferHdr: false`。

### 移动端浏览器滑动时为什么没有轨迹拖尾？

展示页默认的“触摸行为：自动”会保留浏览器原生滚动；浏览器接管手势后发送 `pointercancel`，当前拖尾会中止。把控制面板中的“触摸行为”切换为“禁止默认手势”即可在任意滑动方向持续触发拖尾，对应 API 为 `touchAction: 'none'`。页面仍需单轴滚动时，可选择“仅横向平移”或“仅纵向平移”；浏览器允许的方向继续滚动并中止拖尾，未被浏览器接管的方向保留拖尾。该设置也会改变页面原生滚动与缩放手势。

### 为什么纯白背景上的颜色变淡？

白色背景已经没有继续增亮的通道空间。普通未知背景网页先使用上面的推荐配置；若保留 `scene` 输出且需要非游戏的颜色保留，可显式启用隔离合成。原理与选择见 [渲染指南](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md)。

### 隔离合成能否替代合成参考？

不能。隔离只改变 DOM 图层的合成边界。严格已知 Scene 计算需要实际匹配的背景参考，详见 [setCompositingReference()](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#合成参考与线性合成)。

### 未知背景上能否同时得到严格 Unity 加色、纯 Coverage Alpha，并保证白底绝不变暗？

不能同时保证，原因及透明输出合同见 [输出与宿主合成](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#输出与宿主合成)。

### 如何恢复接近 v1.2.15 的透明覆盖层观感？

透明覆盖层可显式选择 `overlayAlphaPolicy: 'visual-max'`；颜色补偿独立控制。详见 [透明输出策略](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#输出与宿主合成)。

### 透明桌面宿主应该使用什么配置？

[透明窗口配置与能力边界](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md#输出与宿主合成)。

## 开发说明

需要 Node.js `>=24.0.0`，CI 使用 `24.19.0`。浏览器直接使用已构建 ESM 不需要 Node.js。

```bash
git clone https://github.com/CialloKing/ba-click-fx.git
cd ba-click-fx
npm ci
npm run dev
```

开发服务器启动后，在另一个终端执行检查：

```bash
npm run check
```

`check` 执行构建、测试、同步校验和打包安装检查。核心像素与 Worker 浏览器验证可单独运行 `npm run test:browser`。

浏览器检查需要 Chrome / Edge，可用 `BACLICKFX_CHROMIUM_PATH` 指定路径。

## 桌面版（Windows 测试版）

[ba-click-fx-desktop](https://github.com/CialloKing/ba-click-fx-desktop) 是独立实现的 Windows 原生桌面版，不复用本项目的 JavaScript / WebGL / WebGPU 运行时。

当前仍是**首个测试版本（Alpha）**，已验证的支持边界是单主屏、FX-only、SDR：覆盖层鼠标穿透且不抢焦点，可通过通知区域菜单或 `Ctrl+Alt+F12` 退出；Control Center 可暂停/恢复并调整核心效果参数。不要据此推断多屏、HDR、捕获或录制能力已经受支持。

桌面版的安装包、构建方式、测试状态和架构决策请以[外部仓库](https://github.com/CialloKing/ba-click-fx-desktop)为准。

## 和其他项目的区别

`ba-click-fx` 更关注《蔚蓝档案》游戏内点击反馈的细节还原，v1.2.0 起改为从游戏 Unity Prefab 逐参数移植。参数与渲染依据来自 Unity 工程；最终像素是否一致仍取决于后端、已知场景背景、色彩管理与宿主合成链。

相比通用 cursor effects，本项目重点实现：

- 游戏风格的溶解圆环、中心光盘和碎片爆发
- 参数级还原 Unity ParticleSystem 颜色/大小/旋转曲线
- 旧轨迹点先消失，拖尾沿路径连续缩短，而不是整条轨迹同时淡出
- 粒子尺寸随画布高度持续缩放，保持 Unity UI 相对比例
- 20+ 个可调参数 + 自定义主题色，适合微调偏好

Related projects:

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
