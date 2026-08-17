# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-安装-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) [![Edge Add-on](https://img.shields.io/badge/Edge_Add--on-安装-0078D7?logo=microsoftedge&logoColor=white)](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) [![Firefox Add-on](https://img.shields.io/badge/Firefox_Add--on-安装-FF7139?logo=firefoxbrowser&logoColor=white)](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/)

> 📖 [English version](./README.en.md)

**从 Blue Archive Unity UI/FX_Touch 逐参数移植的网页点击特效与光标拖尾动画库。**

`ba-click-fx` 将游戏《蔚蓝档案》的 `FX_Touch.prefab` 中 ParticleSystem 和 TrailRenderer 的完整参数——颜色曲线、大小曲线、旋转速度、溶解阈值、HDR 强度、TrailRenderer 时间与宽度——逐项还原到 Web。默认由 **纯 WebGL2** 接管完整 Scene、Coverage 与 MXFinalBloom；可选普通 WebGPU 标准 SDR 输出，或在浏览器和显示链支持时使用 WebGPU HDR 输出真实超白高光。能力不足时自动回退 WebGL2、Canvas 2D、软件 Bloom 与原生辉光。零外部运行时依赖。

A parameter-level port of the **Blue Archive** UI click effect and cursor trail from Unity to the web. **Full WebGL2** by default, optional standard WebGPU or WebGPU HDR output, automatic Canvas 2D and Bloom fallbacks, and zero external runtime dependencies.

**在线演示：** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

> 🖱 点击、拖拽或移动鼠标即可预览特效。Click, drag, or move your mouse on the demo page to preview.

<p align="center">
  <img src="https://github.com/CialloKing/ba-click-fx/releases/download/v1.2.12/ba-click-fx-demo.gif" alt="demo" width="45%">
  &nbsp;&nbsp;
  <img src="./docs/assets/blue-archive-reference.gif" alt="game reference" width="45%">
</p>
<p align="center"><sub>ba-click-fx 项目演示（左） · 游戏内效果参考（右，仅用于效果对比）</sub></p>

> 🖥 **桌面版（Windows 测试版）**：[ba-click-fx-desktop](https://github.com/CialloKing/ba-click-fx-desktop) 使用 C++ / Win32 API / Direct3D 11 从零实现同样的特效，详见[桌面版](#桌面版windows-测试版)章节。

---

## 目录

- [特性](#特性)
- [使用方式](#使用方式)
- [桌面版（Windows 测试版）](#桌面版windows-测试版)
- [常见用法](#常见用法)
- [API 文档](#api-文档)
- [效果说明](#效果说明)
- [常见问题](#常见问题)
- [和其他项目的区别](#和其他项目的区别)
- [项目结构](#项目结构)
- [开发说明](#开发说明)
- [致谢](#致谢)
- [许可](#许可)

---

## 特性

- 从 Unity FX_Touch.prefab 逐参数移植，非"相似风格"模拟
- 溶解圆环（MeshTri）、中心光盘（ring）、点击碎片（Ring 3/4）、拖尾轨迹（TrailRenderer）
- 所有粒子参数锁定为游戏原始值：颜色渐变、大小曲线、旋转速度、溶解阈值、HDR 强度
- Canvas 2D、纯 WebGL2 与 WebGPU 共用已经验证的特效几何，无外部运行时依赖
- 七种展示页渲染选择：WebGPU、WebGPU HDR（实验）、纯 WebGL2（默认）、WebGL2 Bloom、软件 Bloom、原生辉光、Legacy
- WebGPU 使用 `rgba16float` 线性 Scene 与多级 Bloom；普通模式强制标准 SDR Canvas，HDR 模式才尝试 `extended` 输出并保留超过 SDR 白色的高光
- WebGPU 不可用或 Device 丢失时自动回退完整 WebGL2，再沿 Canvas 2D、软件 Bloom、原生辉光链降级
- 核心可由高级宿主放入 Worker，直接使用 `OffscreenCanvas`、纯 WebGL2、手动输入与显式尺寸同步
- 支持浏览器插件、npm、CDN、直接下载四种接入方式
- 主题色支持兼容的 HSL 色相偏移和推荐的相对 OKLCH 完整颜色映射
- 可调参 API：运行时修改圆环 HDR、半径、宽度、寿命、碎片数量、拖尾宽度、Bloom 强度等
- 粒子尺寸随画布高度持续缩放，保持与 Unity UI 相同的相对比例

---

## 使用方式

### 1. 浏览器插件

不想写代码？直接安装浏览器扩展，即可为所有网页添加蔚蓝档案风格点击特效和光标拖尾：

| 商店 | 安装链接 |
|------|----------|
| **Chrome** | [Chrome Web Store](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami) |
| **Edge** | [Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/ba-click-fx/gocfepocmghimclocjafcihcplnpjpkc) |
| **Firefox** | [Firefox Add-ons](https://addons.mozilla.org/zh-CN/firefox/addon/ba-click-fx/) |

- 安装后默认开启，无需给每个网站添加脚本
- 点击特效与光标拖尾可分别开关，可按网站临时禁用
- 可调整主题颜色、透明度、特效大小和画质
- Canvas 位于 Shadow DOM 内，不影响页面布局
- 纯本地渲染，不请求远程资源

源代码：[ba-click-fx-extension](https://github.com/CialloKing/ba-click-fx-extension)

### 2. npm 安装

```bash
npm install ba-click-fx
```

```js
import { BAClickFX } from 'ba-click-fx';
const fx = new BAClickFX();
```

### 3. CDN 引入

```html
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.3.0/dist/ba-click-fx.iife.js"></script>
<script>
  const fx = new BAClickFX.BAClickFX();
</script>
```

IIFE 构建会把模块对象暴露为全局变量 `BAClickFX`，构造函数位于 `BAClickFX.BAClickFX`。

### 4. 直接下载

从 [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases) 下载构建产物（`ba-click-fx.js`、`ba-click-fx.iife.js`、`ba-click-fx.cjs`、`ba-click-fx.d.ts`）：

```html
<canvas id="myCanvas"></canvas>
<script type="module">
  import { BAClickFX } from './ba-click-fx.js';
  const fx = new BAClickFX({ target: '#myCanvas' });
</script>
```

---

## 桌面版（Windows 测试版）

[ba-click-fx-desktop](https://github.com/CialloKing/ba-click-fx-desktop) 是独立实现的 Windows 原生桌面版：它不复用本项目的 JavaScript / WebGL / WebGPU 代码，而是使用 **C++20、Win32 API、Direct3D 11、HLSL 与 DirectComposition** 从零重新实现同一套蔚蓝档案点击特效与光标拖尾。Unity/游戏资源仍是视觉真值，网页版只作为行为与参数语义参考。

当前发布的是**首个测试版本（Alpha）**，支持合同以单主屏 FX-only / SDR 路径为准：

- 单文件运行：静态链接 Visual C++ 运行库，只使用 Windows 自带的 D3D11、DirectComposition、WIC 和 D3DCompiler 系统组件
- Overlay 鼠标穿透且不抢焦点；可通过通知区域图标右键退出，也可按 `Ctrl+Alt+F12`
- 附带独立的 Control Center（`BAFX.ControlCenter.exe`，纯 Win32 Common Controls，无需 Windows App SDK）：通过本地 Named Pipe 连接 Host，支持暂停/恢复特效，并调整效果大小、拖尾长度与宽度、Bloom 强度与质量等配置
- 构建与测试基于 CMake 预设（Visual Studio 2026 + Windows SDK），架构与决策文档见桌面版仓库的 `ARCHITECTURE.md` 与 `docs/adr`

---

## 常见用法

挂载到指定 canvas：

```js
const fx = new BAClickFX({ target: '#myCanvas' });
```

手动触发点击特效：

```js
fx.boom(window.innerWidth / 2, window.innerHeight / 2);
```

页面卸载时销毁：

```js
fx.destroy();
```

---

## API 文档

### 构造函数

```ts
new BAClickFX(options?: {
  target?: string | HTMLElement | OffscreenCanvas, // 挂载目标，DOM 中省略时默认全屏
  scale?: number,                  // 全局缩放，默认 1
  opacity?: number,                // 不透明度 0~1，默认 1
  themeColor?: string,             // 六位十六进制主题色，默认 #4ca7ff
  themeColorMode?: 'hue-only' | 'relative-oklch', // 公共库默认 hue-only
  outputCompositing?: 'scene' | 'browser-overlay', // 输出合成，默认 scene
  overlayAlphaPolicy?: 'coverage' | 'visual-max', // 覆盖层 Alpha 策略，默认 coverage
  overlayColorCompensation?: 'none' | 'bright-core', // 覆盖层颜色补偿，默认 none
  overlayAlphaLimit?: number,      // 网页覆盖层 Alpha 上限，默认 250/255
  hostCompositing?: 'source-over' | 'screen' | 'plus-lighter', // 宿主合成，默认 source-over
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
  renderingMode?: 'enhanced' | 'legacy', // 渲染模式，默认 enhanced
  bloomBackend?: 'auto' | 'software' | 'webgl2' | 'native', // Bloom 后端，默认 webgl2
  softwareBloomEnabled?: boolean, // 兼容旧 API：true 等同 software，false 等同 native
  isolatedCompositing?: boolean,  // 隔离合成，默认 false；true 为非游戏白底兼容选项
  lightBackgroundContrastAlpha?: number, // 浅色背景兼容层强度，默认 0
  maxDpr?: number,                // 最大设备像素比，默认 1；可按设备性能显式提高
  touchAction?: string,           // DOM 触摸手势策略，默认 'auto'
  inputFilter?: (e: PointerEvent) => boolean,
})
```

`touchAction` 接受 CSS `touch-action` 关键字及组合，例如 `none`、`pan-x`、`pan-y`、`pan-left`、`pan-right`、`pan-up`、`pan-down`、`pinch-zoom` 和它们的空格组合。DOM 自动输入只在策略需要禁止某个方向或缩放时注册 capture Touch 仲裁监听；`auto`、`manipulation` 与显式允许全部方向/缩放的组合保留浏览器原生快速滚动。覆盖层 Canvas 不参与命中测试时，库会在首次可判定方向的移动时锁定本次手势，并通过 `inputFilter` 排除宿主控件；`inputSource: 'manual'` 不注册这些 DOM 监听。

`effectBackend` 决定清晰几何与 Bloom 是否全部由 WebGPU 或 WebGL2 接管；`webgpuPreferHdr` 只决定 WebGPU 最终 Canvas 是否尝试 Extended HDR，`false` 会强制 Standard SDR。Canvas 2D 路径再通过 `bloomBackend` 选择 Bloom 实现。展示页提供七种直观组合：

| 展示页选项 | API 配置 | 说明 |
|---|---|---|
| WebGPU | `{ effectBackend: 'webgpu', webgpuPreferHdr: false, renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | 正式的普通 WebGPU 模式；只配置浏览器首选 Standard SDR Canvas，不请求 `toneMapping: extended`，同时保留与 Unity 对齐的线性 Scene 与 MXFinalBloom |
| WebGPU HDR（实验） | `{ effectBackend: 'webgpu', webgpuPreferHdr: true, renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | 异步申请 WebGPU，并优先配置 `rgba16float + toneMapping: extended`；HDR Canvas 不可用时继续使用 WebGPU 标准 SDR 输出，Device 不可用或丢失时回退完整 WebGL2 |
| 纯 WebGL2 | `{ effectBackend: 'webgl2', renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | 默认；完整 Scene、Coverage 与 MXFinalBloom 均在一个 WebGL2 HDR 管线中完成；失败时回退 Canvas 2D 链 |
| WebGL2 Bloom | `{ effectBackend: 'canvas2d', renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | 兼容选择器；GPU 可用时复用与纯 WebGL2 相同的完整 HDR Scene，失败时沿 Canvas 2D 的 Software / Native 链回退 |
| 软件 Bloom | `{ effectBackend: 'canvas2d', renderingMode: 'enhanced', bloomBackend: 'software' }` | 兼容实现，使用 8 位 Canvas 遮罩、像素回读和全视口 Float32 Bloom 缓冲 |
| 原生辉光 | `{ effectBackend: 'canvas2d', renderingMode: 'enhanced', bloomBackend: 'native' }` | 使用 Canvas 2D `shadowBlur`，开销较低但观感与后处理 Bloom 不同 |
| Legacy | `{ effectBackend: 'canvas2d', renderingMode: 'legacy' }` | 使用 Unity 材质能量和纹理轮廓，以 Canvas `shadowBlur` 提供兼容辉光；此时忽略 Bloom 后端 |

展示页在七档渲染选项之外提供独立的“隔离合成”开关。该开关默认关闭，与渲染后端正交；它只控制多张 Canvas 的最终 CSS 合成边界，不改变 Bloom 阈值、模糊或颜色计算，也不是降低 Bloom 计算量的性能开关。

WebGPU 可用不等于屏幕 HDR 可用。只有 `getConfig().resolvedWebGPUOutputMode === 'extended'` 才表示 Canvas 已协商扩展动态范围，并会把线性 HDR 结果编码为扩展 sRGB、保留超过 SDR 白色的高光；`'standard'` 表示 WebGPU Scene 与 Bloom 正常运行，但最终 Canvas 仍是 SDR；`'pending'` 表示正在申请设备或提交首帧；`'unavailable'` 表示当前没有可用的 WebGPU 输出。真正看到超白高光还需要 HDR 显示器、系统已开启 HDR、浏览器实现 WebGPU HDR Canvas，以及 `rgba16float + toneMapping: extended` 配置成功。

设置 `webgpuPreferHdr: false` 会在任何浏览器上跳过 Extended 配置，直接使用浏览器首选的 Standard SDR Canvas；这是展示页“WebGPU”普通模式的固定合同。内部 `rgba16float` Scene 仍用于保留预过滤前的发射能量和 Unity MXFinalBloom 精度，它不是 HDR 显示输出；是否真实输出 HDR 仍只由 `resolvedWebGPUOutputMode` 判断。

展示页在 HDR 摘要下提供默认折叠的“WebGPU 诊断详情”，分别报告安全上下文、WebGPU API、Canvas Context、Adapter、Device、Extended Canvas、Standard SDR、首帧管线、图形/视频动态范围和 CSS HDR 语法支持，并保留稳定的失败阶段代码与浏览器异常文本。`(video-dynamic-range: high)` 只是视频输出环境提示，不参与 WebGPU HDR 成功判定。`CSS.supports()` 也只证明浏览器接受相关语法，不证明当前屏幕正在输出 HDR。网页无法可靠读取操作系统 HDR 开关或显示器尼特；最终浏览器侧判据仍是 `resolvedWebGPUOutputMode === 'extended'`。

展示页的“UI HDR”是演示站点私有功能。除特效实际解析为 WebGPU Extended 外，浏览器还必须支持 `color(srgb-linear ...)` 扩展色和 `dynamic-range-limit: no-limit`；否则控件会自动禁用。它直接给标题、状态区、面板边缘和交互控件应用 CSS HDR 描边与光晕，不创建第二个全屏 Canvas，也不经过 `mix-blend-mode`。范围 `1..16` 的“UI HDR 亮度”不属于 `BAClickFX` 公共 API，不会修改 `webgpuHdrBrightness`、Unity 特效参数或点击特效像素。

`webgpuHdrPeak`、`webgpuHdrBrightness`、`webgpuHdrColorPreservation`、`webgpuHdrWhiteCore`、`webgpuHdrWhiteStart` 和 `webgpuHdrWhiteEnd` 只校准 WebGPU Extended Canvas 的最终 HDR 展示映射；WebGPU Standard、WebGL2 和 Canvas 2D 输出不受影响，也不会修改 Unity 特效参数、粒子数量、几何或 Bloom 算法。其中 `webgpuHdrBrightness` 是范围 `0..32` 的线性倍率：存在匹配的合成参考时只放大背景上方的特效增量，不会增亮参考背景本身。较高倍率允许高级用户利用更大的显示高光余量，但可能被浏览器、系统或显示器裁剪、压缩或色调映射，因而不代表固定尼特值。

`webgpuHdrColorPreservation` 控制高亮增量恢复原始线性 RGB 色度方向的程度，范围 `0..1`，默认 `0` 保持现有渐进白核外观；设为 `1` 时，HDR shoulder 仍决定峰值，但高倍率不会继续放大项目自身产生的白核偏色。展示页“保留原始色相”预设会同时将该值设为 `1`、将 `webgpuHdrWhiteCore` 设为 `0`。这能消除渲染器自身的高倍率偏白，但不能阻止浏览器、系统或显示器在超出实际 HDR 色彩体积时降低饱和度。

显式 `effectBackend: 'webgpu'` 和 `'auto'` 都按 WebGPU → WebGL2 → Canvas 2D 的顺序解析完整特效后端。默认值仍为稳定的 `'webgl2'`，因此升级不会自动改变现有页面的渲染后端。

`bloomBackend: 'auto'` 会优先尝试 WebGL2，失败时依次使用软件 Bloom 和原生辉光。默认值 `'webgl2'` 采用相同回退链；显式选择 `'software'` 时，像素回读不可用则回退原生辉光。为兼容 1.2.13 及更早版本，构造参数或 `createConfig()` 只要显式提供 `bloomBackend` / `softwareBloomEnabled` 而未提供 `effectBackend`，就继续保留 `effectBackend: 'canvas2d'` 的配置和回退状态合同；显式 `effectBackend` 始终优先。若同时传入 `bloomBackend` 和旧字段 `softwareBloomEnabled`，以 `bloomBackend` 为准；旧字段仍保持 `true` 等价于 `'software'`、`false` 等价于 `'native'`。

为保持已经验收的颜色、透明度和边缘采样，WebGL2 Bloom 在 GPU 成功时会有意复用 `WebGL2EffectRenderer` 的完整 Scene，而不是上传一份 8 位 Canvas Scene。因此它与纯 WebGL2 的成功帧使用相同 Shader 和像素管线，也不会预先栅格随后被隐藏的 Canvas。两者的区别是兼容合同：WebGL2 Bloom 仍保留 `effectBackend: 'canvas2d'` 请求及其 Software / Native 回退链，纯 WebGL2 则由完整特效后端直接接管。

`outputCompositing: 'scene'` 是默认值，保持 Unity 面向 Scene Render Target 的直接加色 RGB 语义。展示页和要求严格游戏还原的集成都应使用该模式，并通过 `setCompositingReference()` 提供与实际底图逐像素匹配的已知背景；这是完整 GPU 路径精确求值 Scene RGB 的合同。`'browser-overlay'` 供 BASpark、WebView2、Electron 等透明桌面宿主显式选择，HDR 发射和 Bloom 能量仍独立计算，最终 Alpha 不再由最终 RGB 最大通道决定。

未知背景下的透明输出由四项正交配置继续细分。Alpha 分配与颜色补偿互不隐式切换：

| 配置 | 合同 |
|---|---|
| `overlayAlphaPolicy: 'coverage'` | 默认透明合同。请求 Alpha 由清晰 Scene Coverage 与独立 Bloom 传输 Alpha 相加，再受生命周期、`opacity` 和最终上限约束；适合优先保证遮挡率和跨后端连续性的宿主 |
| `overlayAlphaPolicy: 'visual-max'` | v1.2.15 风格的视觉近似。请求 Alpha 取清晰 Scene Coverage 与 Bloom 传输 Alpha 的较大值，使重叠区域保留更低遮挡率；Alpha 仍只来自这两种独立传输量，绝不会由最终 `maxRGB` 生成 |
| `overlayColorCompensation: 'none'` | 默认不改写透明载荷的颜色关系 |
| `overlayColorCompensation: 'bright-core'` | 未知浅色背景的可见性近似。只按独立的清晰发射能量与 Bloom 能量补偿高能核心，不会把全部 RGB 混向白色，也不会把低能拖尾尾端变成灰白色；仍保持预乘约束 `RGB <= Alpha`，但不宣称逐像素还原 Unity |
| `overlayAlphaLimit` | `browser-overlay + source-over` 的最终 Alpha 容量，默认 `250 / 255`，有限值钳制到 `0..1`。容量不足时预乘 RGB 等比收敛；它不改变特效 `opacity`、HDR 发射强度或 Bloom 强度 |
| `hostCompositing: 'source-over'` | 默认宿主合同，使用以上 Alpha 策略、颜色补偿和 Alpha 上限 |
| `hostCompositing: 'screen'` | 未知中高亮背景的独立完整载荷合同。库自有图层组使用一次 CSS `screen`，背景越亮，新增亮度越自动收敛；忽略 Alpha 策略、颜色补偿和 Alpha 上限 |
| `hostCompositing: 'plus-lighter'` | 未知背景下的独立 Add 载荷合同。渲染器输出完整加色载荷并由宿主执行一次 `plus-lighter`，因此忽略 `overlayAlphaPolicy`、`overlayColorCompensation` 与 `overlayAlphaLimit` |

旧的 `unknownBackgroundAppearance` 已从构造参数、`updateConfig()`、`getConfig()` 和类型声明中删除。颜色补偿只由 `overlayColorCompensation` 控制，Alpha 分配只由 `overlayAlphaPolicy` 控制，两者不会再通过兼容镜像隐式联动。

`screen` 和 `plus-lighter` 都只是 SDR DOM 合成近似，并受浏览器色彩管理和实现差异影响。Unity 的最终画面是把背景与特效在线性 HDR 中合成后统一编码；未知桌面像素不在覆盖层进程内，因此没有任何单张透明载荷能对所有背景逐像素等价。`screen` 在黑底保留完整载荷，并在背景接近白色时自动减少增量，是展示页“DOM Add（近似）”和未知中高亮背景的推荐选择。`plus-lighter` 保留给已知黑色或暗色宿主；它把 sRGB 载荷直接相加，在亮底会提前饱和。

库创建覆盖层时会在完整图层组上执行一次所选宿主混合；若 `target` 是调用方传入的 `<canvas>`，库只输出独立完整载荷，不会修改该元素的 `mix-blend-mode`，最终 CSS、WebView 或原生合成由宿主负责。要严格匹配 Unity 的 `Blend One One`、`Blend SrcAlpha One, One One` 等结果，必须提供匹配背景参考让完整 WebGPU/WebGL2 后端在线性 HDR Scene 中求值，或由宿主在线性 HDR Render Target 中执行合成。若已激活合成参考，库会回到已知 Scene 的普通 `source-over` 最终输出，避免重复混合。

> 维护者注意：不要用降低 Bloom 强度来修复亮底过曝。修改宿主合成、透明载荷或亮底像素基线前，必须阅读 [DOM Add 亮底过曝回归复盘](https://github.com/CialloKing/ba-click-fx/blob/main/docs/dom-add-light-background-regression.md)。

`isolatedCompositing` 默认是 `false`，各 Canvas 直接挂载到目标容器或页面。设为 `true` 后，库拥有的主特效层、WebGPU/WebGL2 层和浅色背景兼容层会先在透明隔离组内解析，再将整个组覆盖到页面上，避免浏览器分别把兼容层与纯白页面合成后丢失蓝青色对比。默认 `source-over` 合同不会在外层再次混合；只有显式选择独立完整载荷时，完整图层组才执行一次所选的 `screen` 或 `plus-lighter`。隔离合成是非游戏的网页白底兼容选项，可通过 `updateConfig()` 在运行时切换。

若 `target` 是已有的 `HTMLCanvasElement`，库无法安全插入完整特效、Bloom、对比和隔离所需的额外 DOM 图层，因此完整特效的 `'webgpu'` / `'webgl2'` / `'auto'` 会回退 `canvas2d`，Bloom 的 `'webgl2'` / `'auto'` 会回退软件 Bloom，`isolatedCompositing` 也会被强制降级为 `false`；`getConfig()` 返回降级后的实际配置。直接传入的 `OffscreenCanvas` 是一个有意支持的例外：纯 WebGL2 可以直接拥有该画布，显式 `'canvas2d'` 也可以工作，但无法使用依赖 DOM/CSS 多图层的 WebGPU、隔离合成等能力。外部 Canvas 的 CSS 和最终宿主合成始终由调用方负责。默认全屏覆盖层不受 `HTMLCanvasElement` 限制；普通容器也可以使用，但必须自行建立定位上下文（通常设置 `position: relative`）。

隔离根按 `BAClickFX` 实例独立创建和销毁。同一页面的多个隔离实例不会跨根混合内部兼容层；一个实例切换模式或销毁也不会移动、删除其他实例的 Canvas。

纯白网页背景建议开启隔离合成；只有在 `outputCompositing: 'scene'` 下仍需额外清晰轮廓时，再按需提高浅色背景兼容层：

```js
const fx = new BAClickFX(
{
  isolatedCompositing: true,
  lightBackgroundContrastAlpha: 0.35,
});
```

透明桌面宿主推荐显式固定完整 WebGL2 与透明覆盖层输出，并关闭非游戏的浅色轮廓层：

```js
const fx = new BAClickFX(
{
  effectBackend: 'webgl2',
  bloomBackend: 'webgl2',
  outputCompositing: 'browser-overlay',
  overlayAlphaPolicy: 'coverage',
  overlayColorCompensation: 'none',
  overlayAlphaLimit: 250 / 255,
  hostCompositing: 'source-over',
  lightBackgroundContrastAlpha: 0,
});
```

若要接近 v1.2.15 的透明遮挡观感，可把 `overlayAlphaPolicy` 改为 `'visual-max'`；这只改变独立 Coverage/Bloom 传输量之间的 Alpha 分配，不会从 `maxRGB` 生成 Alpha。未知浅色桌面若更重视高能核心可见性，可另行把 `overlayColorCompensation` 改为 `'bright-core'`，无需同时改变 Alpha 策略。支持 DOM 混合的未知亮底宿主可设置 `hostCompositing: 'screen'`；已知黑色或暗色宿主才建议使用更激进的 `'plus-lighter'`。两者都忽略 Alpha 策略、颜色补偿和 Alpha 上限，且都只是 SDR 近似。

这些兼容选项的职责彼此独立：`isolatedCompositing` 只决定多张库自有 Canvas 是否先在一个透明组内合成，不读取页面或桌面像素；`lightBackgroundContrastAlpha` 只在 `scene` 输出下增加非游戏的 `darken` 轮廓，在 `browser-overlay` 下会被忽略；`setCompositingReference()` 才会把一张已知的不透明栅格参考送入渲染管线。它们不能互相替代。

### 合成参考与线性合成

`setCompositingReference()` 可把特效下方真实且不透明的栅格参考交给渲染器；它不设置或修改宿主页面 CSS 背景。`scene + setCompositingReference()` 是已知背景的精确路径：只有 WebGPU、纯 WebGL2，或成功解析到 GPU 的 WebGL2 Bloom，收到与实际显示内容逐像素匹配的已知参考时，才能在渲染合同内声明最终 RGB Scene 按 Unity 线性 HDR 管线严格求值。原生辉光和 Legacy 使用 Canvas Final Pass；软件 Bloom 仍使用普通 DOM 背景路径，这些能力受限的回退实现不能宣称与完整 GPU Scene 或 Unity 逐像素等价。

透明桌面下的真实桌面通常对库不可见。调用 `setCompositingReference(null)` 清除参考，或从未提供参考时，渲染器进入未知背景路径，只能输出带 Alpha 的覆盖层，再由操作系统或宿主合成；未知背景无法在数学上复现 Unity 对已知不透明 HDR Scene 的逐像素结果。`browser-overlay` 的目标是让 Alpha 始终来自独立的 Coverage/Bloom 传输量，并通过 `overlayAlphaPolicy` 显式选择它们的分配方式，而不是绕过这一信息边界。

标准预乘 `source-over` 满足 `Cout = Coverlay + Cbackground × (1 - A)`；严格 Unity 加色的目标则是 `Cbackground + E`。因此所需的 `Coverlay = E + A × Cbackground` 依赖库无法读取的背景。对未知背景，单张透明覆盖层不可能同时保证严格 Unity 加色、最终 Alpha 只表示 Coverage、以及在纯白背景上绝不变暗。`browser-overlay + overlayAlphaPolicy: 'coverage'` 明确优先保持 Coverage 传输和与跨后端连续性；`'visual-max'` 只提供 v1.2.15 风格的低遮挡视觉近似。需要严格 Scene RGB 时，应使用默认 `scene` 并通过 `setCompositingReference()` 提供逐像素匹配的已知参考。

实现不会用 `min(coverage, maxRGB)` 把最终 Alpha 限制到当前 RGB 亮度。该近似虽然能减少部分白底压暗，却会把发射亮度重新解释为遮挡率，使黑色或低能拖尾丢失 Coverage，并破坏 `opacity` 线性和后端切换连续性。

解包 Shader 中 Additive 的目标 Alpha 固定为 `1`，Dissolve 也有独立的 Alpha 混合因子；这些值描述的是粒子写入游戏不透明相机目标时的缓冲合同，不是透明桌面窗口的遮挡率。未提供匹配背景时若机械复制这些 Alpha，粒子 Quad 会变成不透明矩形。因此无背景的 `scene` Final Pass 使用能承载预乘 RGB 的传输 Alpha，`browser-overlay` 则按所选策略组合清晰 Coverage 与 Bloom 传输 Alpha；两者都不宣称复现 Unity 相机目标中对最终画面无可见影响的 Alpha。严格一致声明只针对上一段限定条件下的最终 RGB。

```js
const image = new Image();
image.crossOrigin = 'anonymous';
image.src = 'https://example.com/background.jpg';
await image.decode();

fx.setCompositingReference(image, { fit: 'cover' });
// 清除合成参考，进入未知背景路径；不会修改宿主页面 CSS 背景。
fx.setCompositingReference(null);
```

当前只支持居中 `cover`，裁剪规则与 CSS `background-size: cover` 对齐。调用方负责图片解码和 CORS：跨域服务器必须允许匿名读取，否则 WebGL 无法上传纹理，方法会返回 `false` 或候选后端保持安全回退。传入 `null` 会清除参考并释放仅供 Canvas Final Pass 使用的全尺寸帧资源。Renderer 会保留已接受的参考源以支持 WebGL Context 恢复，因此在替换参考或销毁实例前不要关闭 `ImageBitmap`、`VideoFrame` 等可释放源。Canvas、Video 等动态源在调用时上传当前帧；内容变化后应再次调用。

展示页的“本地图片”选择器会把 `File` 转成当前文档的 `blob:` URL，再分别设置 CSS 页面背景和 `setCompositingReference(image)`，因此不需要外部服务器提供 CORS。该 URL 只在当前页面会话有效，不会写入 `localStorage`，切换背景或卸载页面时会被释放；刷新页面后需要重新选择文件。手输的 `file://` URL 会作为普通自定义背景文本保存，并交给允许读取本地协议且允许作为 Canvas/WebGL 纹理使用的受信任桌面宿主；普通 HTTP/HTTPS 页面仍受浏览器本地资源权限限制，应使用选择器。

模式切换会释放闲置后端的全尺寸纹理和 FBO，但保留 WebGL Context、Program、静态纹理与已接受的合成参考源；重新启用时只重建当前尺寸需要的帧资源。参考切换是跨 Renderer 的原子操作：任一已创建后端拒绝新源时，库会回滚到旧参考，无法回滚的候选实例会被丢弃并在需要时懒重建。

### 宿主输入与指针生命周期

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

### 宿主拥有的 Worker 与 OffscreenCanvas

`BAClickFX` 可以在 Dedicated Worker 中直接接收 `OffscreenCanvas`，但库不会创建 Worker、转移 Canvas、代理 DOM 输入或管理 Worker 生命周期。这些职责留给宿主，可以避免把应用协议和打包策略固化进库。下面是一个最小的宿主协议。

这里的 Worker 专指浏览器 `DedicatedWorker`，不是 Node.js `worker_threads`。Node.js 24 仅是本项目的开发与 CI 工具链；浏览器端 Worker 是否可用取决于 `Worker`、模块脚本、`OffscreenCanvas` 和所选 Canvas Context 的实现。

主线程负责读取真实 Canvas 几何、把 DOM 坐标转换为 Canvas 局部 CSS 像素，并转发尺寸、DPR 和指针生命周期：

```js
// main.js
const canvas = document.querySelector('#fx');
const worker = new Worker(new URL('./fx-worker.js', import.meta.url),
{
  type: 'module',
});

function post(type, payload = {})
{
  worker.postMessage({ type, payload });
}

function getViewport()
{
  const rect = canvas.getBoundingClientRect();

  return {
    width: rect.width,
    height: rect.height,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  };
}

function getPointer(event)
{
  const rect = canvas.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
  };
}

const offscreen = canvas.transferControlToOffscreen();

worker.postMessage(
  {
    type: 'init',
    payload: { canvas: offscreen, ...getViewport() },
  },
  [offscreen],
);

const resizeObserver = new ResizeObserver(() => post('resize', getViewport()));

resizeObserver.observe(canvas);
worker.addEventListener('message', (event) =>
{
  if (event.data.type === 'destroyed')
  {
    resizeObserver.disconnect();
    worker.terminate();
  }
});
canvas.addEventListener('pointerdown', (event) =>
  post('pointerDown', getPointer(event)));
window.addEventListener('pointermove', (event) =>
  post('pointerMove', getPointer(event)));
window.addEventListener('pointerup', (event) =>
  post('pointerUp', { pointerId: event.pointerId }));
window.addEventListener('pointercancel', (event) =>
  post('pointerCancel', { pointerId: event.pointerId }));

// 其他公开控制也沿同一宿主协议转发。
function boom(x, y)
{
  post('boom', { x, y });
}

function setOpacity(opacity)
{
  post('updateConfig', { opacity });
}

function setPaused(paused, clear = false)
{
  post('setPaused', { paused, options: { clear } });
}

// 卸载时先让实例释放资源，收到确认后再由宿主终止 Worker。
function destroy()
{
  post('destroy');
}
```

Worker 导入普通 ESM 构建，使用 `manual` 输入并显式选择纯 WebGL2：

```js
// fx-worker.js
import { BAClickFX } from 'ba-click-fx';

let fx = null;

self.addEventListener('message', (event) =>
{
  const { type, payload } = event.data;

  switch (type)
  {
    case 'init':
      fx = new BAClickFX(
        {
          target: payload.canvas,
          inputSource: 'manual',
          effectBackend: 'webgl2',
          maxDpr: 2,
        },
      );
      fx.resize(payload.width, payload.height, payload.dpr);
      break;
    case 'resize':
      fx.resize(payload.width, payload.height, payload.dpr);
      break;
    case 'pointerDown':
      fx.pointerDown(payload);
      break;
    case 'pointerMove':
      fx.pointerMove(payload);
      break;
    case 'pointerUp':
      fx.pointerUp(payload.pointerId);
      break;
    case 'pointerCancel':
      fx.pointerCancel(payload.pointerId);
      break;
    case 'boom':
      fx.boom(payload.x, payload.y);
      break;
    case 'updateConfig':
      fx.updateConfig(payload);
      break;
    case 'setPaused':
      fx.setPaused(payload.paused, payload.options);
      break;
    case 'destroy':
      fx?.destroy();
      fx = null;
      self.postMessage({ type: 'destroyed' });
      break;
  }
});
```

`resize(width, height, dpr)` 的宽高与 manual 输入坐标都使用 Canvas 局部 CSS 像素；库再按 `dpr` 调整实际 backing store，且 DPR 仍受 `maxDpr` 限制。`OffscreenCanvas` 没有 DOM 布局信息，因此 Worker 中不会自动获知 CSS resize 或设备 DPR 变化。

Canvas 的上下文类型会被第一次 `getContext()` 锁定。直接 Offscreen 路径应在构造时固定为 `effectBackend: 'webgl2'`（推荐）或显式 `'canvas2d'`；不要再通过 `updateConfig()` 在两种上下文之间切换，需要切换时应销毁实例并转移一张新的 Canvas。当前 Worker 合同不包含 WebGPU、DOM 多图层合成或自动输入代理。

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

### 独立时间倍率

`clickTimeScale` 和 `trailTimeScale` 都必须是有限且不小于 `0.01` 的数字。`1` 为原始速度，`2` 表示两倍速度且持续时间减半，`0.5` 表示半速且持续时间加倍；`0` 不表示暂停，低于 `0.01` 的值会被忽略。两个倍率都可通过 `updateConfig()` 实时更新：

```js
fx.updateConfig(
{
  clickTimeScale: 1.5,
  trailTimeScale: 0.8,
});
```

`clickTimeScale` 同时缩放点击波纹生命周期、旋转、点击碎片寿命和位移；`trailTimeScale` 同时缩放拖尾衰减、拖尾碎片寿命和位移。倍率不会改变 `minVertexDistance`、`trailSpacing` 等空间采样参数。

### 暂停与恢复

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

### 实例方法

| 方法 | 说明 |
|---|---|
| `resize(width?, height?, dpr?)` | 显式同步 Canvas 的 CSS 尺寸与 DPR，主要用于 Worker / OffscreenCanvas 宿主 |
| `boom(x, y)` | 在指定坐标触发单次点击特效，不创建拖尾状态 |
| `pointerDown(input)` | 开始一次点击和拖尾生命周期 |
| `pointerMove(input)` | 为当前逻辑指针追加拖尾采样点 |
| `pointerUp(pointerId?)` | 正常结束指针，已有拖尾自然消失 |
| `pointerCancel(pointerId?)` | 强制取消指针并立即移除当前轨迹 |
| `setPaused(paused, options?)` | 暂停或恢复输入与动画调度，可选在暂停时清屏 |
| `setInputSamplingRate(rateHz)` | 设置移动输入采样率上限；接受 `0` 或 `1..1000`，成功返回 `true` |
| `setCompositingReference(source, { fit: 'cover' })` | 设置各渲染后端共享的已知栅格合成参考；传入 `null` 清除参考并进入未知背景路径 |
| `clear()` | 清除全部视觉对象 |
| `clearTrail()` | 仅清除拖尾和碎片 |
| `destroy()` | 销毁实例，移除事件监听和 Canvas |
| `updateConfig({...})` | 运行时更新基础配置、输入来源/采样率、时间倍率、完整特效/Bloom 后端、DPR 与触摸行为 |
| `setThemeColor('#4ca7ff')` | 设置并保存主题色；非法值恢复默认游戏蓝 |
| `setThemeColorMode(mode)` | 切换主题颜色映射模式；接受 `hue-only` 或 `relative-oklch`，成功返回 `true` |
| `setTriangleRoundness(value)` | 设置三角碎片圆角比例；与 `setFxParam('shards.roundness', value)` 等价 |
| `setFxParam('rings.hdrIntensity', 5.992157)` | 修改单个点号路径；成功返回 `true`，拒绝时返回 `false` |
| `setFxParams(patch, options?)` | 按 Schema 验证并批量应用点号路径补丁，返回逐项处理结果 |
| `getFxConfig()` | 返回当前完整特效配置深拷贝 |
| `resetFxConfig()` | 重置所有特效参数为当前 Enhanced 或 Legacy 模式的默认基线 |
| `getConfig()` | 返回当前实例配置；除完整特效和 Bloom 的解析结果外，`resolvedWebGPUOutputMode` 独立报告 `extended`、`standard`、`pending` 或 `unavailable` |

后端解析状态发生变化时，主 Canvas 会分别派发 `baclickfxeffectbackendchange` 和 `baclickfxbackendchange`。可使用导出的事件名持续同步延迟探测、运行时回退、WebGPU Device 丢失和 WebGL Context 恢复：

```js
import {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
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
```

`resolvedEffectBackend === 'webgpu'` 只证明 WebGPU Scene 已接管当前输出。判断真实 HDR 必须同时读取 `resolvedWebGPUOutputMode === 'extended'`；不要用 `matchMedia('(dynamic-range: high)')` 代替实际 Canvas 配置结果。

### 参数 Schema 与批量写入

库导出只读的 `FX_PARAM_SCHEMA`、当前 `FX_PARAM_SCHEMA_VERSION` 和 `FX_PARAM_MIGRATIONS`。Schema 描述每个公开标量路径的类型、硬边界、默认值、单位、分组、稳定展示顺序、本地化键、推荐控件范围、关联参数和 Enhanced/Legacy 模式基线，宿主无需再手抄控件清单。`step` 与 `display.step` 只指导宿主 UI；`setFxParam()` / `setFxParams()` 不按步进量化或取整，只校验类型、有限值和 `min` / `max` 硬边界。需要整数控件的宿主应在提交前自行取整。

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

```js
const storedPatch =
{
  'bloom.scatter': 0.35,
};
const migrated = applyFxParamPatch(
  storedPatch,
  {
    schemaVersion: 0,
    strict: true,
  },
);

if (migrated.committed)
{
  const normalizedPatch = Object.fromEntries(
    migrated.applied.map(({ path, value }) => [path, value]),
  );

  localStorage.setItem('ba-click-fx', JSON.stringify(normalizedPatch));
}
```

包根 `applyFxParamPatch()` 固定以游戏默认参数作为内部校验基线，只接受 `schemaVersion` 与 `strict`，不会修改实例，也不会公开完整 Unity 配置树。此处 `committed` 表示候选补丁可以安全写回存储；实例级 `setFxParams()` 的 `committed` 才表示配置已提交到当前渲染实例。模式重置仍由实例级 `reset: true` 负责。

返回对象包含 `applied`、`normalized`、`rejected`、`committed` 和 `schemaVersion`：`applied` 是最终接受的路径和值；`normalized` 记录路径重命名、旧值恢复默认、数值钳制或布尔转换；`rejected` 给出路径、原值和原因；`committed` 表示候选配置是否真正提交。默认 `strict: false` 会提交合法项并报告拒绝项；`strict: true` 只要出现一个拒绝项就回滚整批，且 `applied` 为空。`reset: true` 会先恢复当前 Enhanced 或 Legacy 模式的默认基线，再应用同一批补丁；即使补丁为空，也会提交该重置。`setFxParam()` 复用相同校验并采用严格单项语义。

`themeColor` 和 `themeColorMode` 都是实例配置状态：可在构造参数或 `updateConfig()` 中设置，`setThemeColor()` 与 `setThemeColorMode()` 使用同一规范化路径，`getConfig()` 会返回当前值。主题色只接受六位十六进制颜色；空字符串或非法值恢复导出的 `DEFAULT_THEME_COLOR`（`#4ca7ff`）。非法主题颜色模式会被拒绝，`setThemeColorMode()` 返回 `false` 并保持当前模式不变。两项配置都不会改写 `UNITY_FX_TOUCH` 或 `FX_PARAM_SCHEMA` 的 Unity 参数基线。

公共库导出的 `DEFAULT_THEME_COLOR_MODE` 为 `hue-only`，用于兼容旧配置和旧像素结果：只把主题色的 HSL 色相差应用到 Unity 原始颜色，继续保留资源自带的饱和度、明度与 HDR 发射能量；没有 `themeColorMode` 字段的既有配置也按此模式解释。展示页只对没有既有设置的新用户采用推荐的 `relative-oklch`，不会静默迁移已保存的模式。

`relative-oklch` 以默认游戏蓝 `#4ca7ff` 为基准，将主题色相对基准的 OKLCH 色相、色度和感知明度变化映射到 Unity 原始颜色。明度会在线性 RGB HDR 发射进入 Bloom 预过滤之前调整能量，因此较暗主题会自然减少超过阈值的 Bloom，而不是在 Final Pass 中压暗已经生成的光晕。当透明覆盖层使用未知背景的 `source-over` 传输时，引擎还会按目标颜色的 sRGB 峰值独立限制 Coverage Alpha，避免暗色变成实心遮挡；该限制不缩放 Scene、Screen/Plus-lighter 或 HDR 发射能量。默认游戏蓝必须走恒等映射，保持 Unity 默认像素不变；纯黑主题的发光能量为零，在未知背景透明覆盖中不会生成黑色遮罩或残留光晕。已知 Scene 仍保留 Unity 材质原本的 Alpha 混合语义。

`setTriangleRoundness(value)` 是 `setFxParam('shards.roundness', value)` 的便捷 API。默认值 `0` 完全保留当前三角图集；`0..1` 基于原图集三角边界，用与直边相切的圆弧连续磨平尖角，并同步重映射纹理以避免出现内部尖三角；`1` 会把所有点击和拖尾三角碎片变成同尺寸圆形。运行时修改会让现存粒子在下一帧即时响应。有限的越界值由 Schema 钳制到 `0..1`，非有限值会被拒绝。

```js
fx.setTriangleRoundness(0.5);
fx.setFxParam('shards.roundness', 0.5);
```

点击辉光可独立于轨迹调节。该倍率只改变增强模式下圆环和中心光盘的
Bloom 发射；原生辉光使用保持单调的有界 Alpha 映射，Legacy 保持兼容输出：

```js
fx.setFxParam('bloom.clickEmissionScale', 1.25);
```

### 常用可调特效参数（完整清单以 FX_PARAM_SCHEMA 为准）

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

---

## 效果说明

### 点击特效

| 元素 | 表现 |
|---|---|
| 中心光盘 | 白色→蓝色渐变短圆盘，快速扩张后消散，持续 200ms |
| 溶解圆环 | 2 枚旋转环带，弧线从完整逐渐缩短至消失，持续 600ms |
| 点击碎片 | 4 枚三角形粒子从点击位置飞溅，脉冲闪烁 |

圆环的 `radiusMin` / `radiusMax` 是从 MeshTri 的 Start Size 与相机比例换算出的外半径基准值；实际外半径还会乘 Unity 生命周期大小曲线。默认 `widthStart` / `widthEnd` 均为 `1`，只调节资源环宽，实际环宽始终按 `外半径 × 0.0598573766 × 环宽倍率` 计算。

原 Shader 使用 `Blend SrcAlpha One, One One`。ParticleSystemRenderer 的 Apply Active Color Space 会把启用的 Color over Lifetime 顶点色解码到 Linear，再与 `FX_MAT_Touch_Tri3` 的白色 5.992157 HDR 材质相乘。溶解不是连续压低所有像素的透明度，而是以阈值处理二维纹理 Alpha；通过测试的像素继续保留纹理覆盖率。完整 WebGL2 在 Fragment Shader 中按原 UV 对 Ring3 执行 Bilinear + Clamp 采样后硬裁剪，不再插值 96×8 网格顶点的预采样 Alpha。大小和溶解阈值均使用资源关键帧及其入/出切线执行 Unity 三次 Hermite 插值，而不是线性插值或通用 smoothstep。

Ring (3)/(4) 碎片还会在线性空间乘 `startColor = 0.5377358`，因此白色阶段的实际峰值能量约为 `1.50`，而不是直接使用材质的 `5.99`。三角形按 `FX_TEX_Triangle_02_1` 的两个图集帧随机朝向，轮廓面积与生命周期尺寸曲线也来自资源，不再使用偏大的等边三角形近似。

### 拖尾轨迹

拖尾按 Unity 原资源的同一条渲染链复现：

| 层 | 说明 |
|---|---|
| 几何带与亮芯 | 直接绘制原始 2.7px HDR 几何带，再由 Bloom 自然扩张为柔和亮芯 |
| Gradient 与 Stretch UV | Gradient 按网页的旧点→新点顺序反转；纹理 U 单独按 `1 - progress` 映射，使 Unity 的 `U=0` 仍位于最新点 |
| 完整 WebGL2 纹理 | 上传完整 `512×512 RGB` 的 `FX_TEX_Trail_03`，按原 sRGB、Bilinear、Repeat、无 Mipmap 设置在 Fragment Shader 逐片元采样；sRGB 解码到 Linear 后再乘 Gradient 与材质强度 `23.968628` |
| Canvas 兼容纹理 | 软件 Bloom、原生辉光和 Legacy 使用紧凑二维 LUT 近似纵向亮度、横向羽化与非零边缘，避免逐三角软件纹理栅格化造成卡顿 |
| Bloom | 对圆环、圆盘、拖尾和三角碎片的 HDR 发射缓冲使用所选 Bloom 后端 |

纯 WebGL2 与成功解析到 GPU 的 WebGL2 Bloom 使用同一完整纹理批次：普通段只提交两个纹理三角，圆角插入点保持折点 U，单三角端帽的尖端固定为 `V=0.5`。完整 RGB 纹理保留原资源无法由对称单通道轮廓表达的逐通道与上下非对称细节；Canvas 能力受限路径只保证参数、几何、生命周期和总体能量关系，不宣称逐纹理像素等价。

碎片沿轨迹按距离散布。

### Bloom 渲染后端

WebGPU 后端使用独立 WGSL Scene、`rgba16float` 发射目标和多级 Bloom 金字塔，并复用 WebGL2 已经验证的 CPU 粒子网格构建逻辑。它不会创建 WebGL Context，也不会上传一份 Canvas 2D 中间图；Scene、预过滤、下采样、累积上采样和 Final Pass 都由 WebGPU 提交。Final Pass 在 `extended` 模式把线性 RGB 编码为扩展 sRGB 且不截断超白值，在 `standard` 模式执行限制到 SDR 范围的同一编码和现有透明输出合同。

纯 WebGL2 与 WebGL2 Bloom 共用 `WebGL2EffectRenderer`、HDR 发射参数和 Bloom 配置，并都直接在 GPU 中构建圆环、光盘、拖尾与碎片 Scene。两者随后按游戏 `Hidden/MXFinalBloom` 的 4-tap 预过滤、Box4 mip、累积式上采样和 CPU 曝光换算后的线性强度倍率，在一次 Final Pass 中输出清晰层、Coverage 与 Bloom。WebGL2 Bloom 作为兼容选择器保留独立的后端状态与 Canvas 回退链，但成功帧不再生成或上传 8 位 Canvas Scene。

`bloom.threshold` 与 `bloom.clamp` 在进入线性 HDR 预过滤前都按 Unity `GammaToLinearSpace` 换算；Clamp 换算后还受 Shader `half` 的 `65504` 上限约束，因此默认序列值 `65472` 的有效值为 `65504`。`bloom.intensity` 是序列化的曝光刻度，CPU 先按 `2^(Intensity / 10) - 1` 换算（默认 `1.7` 得到约 `0.125058`），Shader 再线性乘入 Bloom。

> 维护者注意：直接把 `1.7` 乘入 Final Pass 会将 Bloom 放大约 13.6 倍。修改 Intensity、Final Pass、Shader uniform 或像素基线前，必须阅读 [Bloom Intensity 13.6 倍过曝回归复盘](https://github.com/CialloKing/ba-click-fx/blob/main/docs/bloom-intensity-regression.md)。

> 维护者注意：每轮上采样必须对“累计粗级”做四点扩散，再单点加入“当前细级”；两者反接会让近场偏硬、外晕层次异常。修改 mip 命名、纹理绑定、texelSize 或 Upsample Shader 前，必须阅读 [Bloom 上采样纹理反接回归复盘](https://github.com/CialloKing/ba-click-fx/blob/main/docs/bloom-upsample-order-regression.md)。

WebGPU 可用性由实际申请 Adapter/Device、创建 `webgpu` Canvas Context 和资源管线决定；HDR 输出再由 `rgba16float + toneMapping: extended` 的实际 `configure()` 结果独立决定。WebGL2 可用性由创建 Context、检查 `EXT_color_buffer_float` 并验证 `RGBA16F` 帧缓冲决定。完整特效使用 `effectBackend` / `resolvedEffectBackend`，WebGPU 输出使用 `resolvedWebGPUOutputMode`，Bloom 使用 `bloomBackend` / `resolvedBloomBackend`；首次异步探测、首帧提交和恢复验证期间会短暂返回 `pending`。Device 或 Context 丢失时旧 GPU Canvas 立即撤下，下一条后端资源链验证成功后才重新接管。

### JavaScript 软件 Bloom

显式选择 `bloomBackend: 'software'` 或 WebGL2 不可用时，软件后端会把 HDR 发射亮度绘制到全视口遮罩，再由 JavaScript 回读像素并复现 MXFinalBloom 的主要结构：

1. 将 8 位遮罩解码到可复用的 Float32 RGB 缓冲区。
2. 以 4-tap 预过滤执行阈值提取，生成 1/2 分辨率 mip0。
3. 使用 Box4 下采样建立由 `bloom.diffusion` 决定层数的 mip 金字塔。
4. 从最低分辨率 mip 开始，对累计粗级以 SampleScale 四点采样，再单点加入当前细级；两张输入不可互换。
5. 将 `bloom.intensity` 按游戏 CPU 的曝光刻度换算后线性乘入，再执行最终四点采样与 sRGB 加色合成。

默认的 `isolatedCompositing: false` 让输出层直接与 DOM 背景合成；在纯白背景上，Unity 加色结果必然失去颜色和对比度。设为 `true` 后，各输出层会先在透明组内合成，再将带颜色与 Alpha 的结果覆盖到页面。这不会改变 Bloom 算法，只是用于纯白网页背景的非游戏兼容路径。需要按游戏方式让背景参与线性 Scene 计算时，应使用 `setCompositingReference()`，而不是把隔离合成当作背景采样替代品。

`lightBackgroundContrastAlpha` 默认是 `0`，因此不会创建游戏资源之外的可见轮廓。设为 `0.35` 时，库拥有的覆盖层会在主特效层上方增加独立的 `darken` 淡青色遮罩；它不接收或产生 Bloom，只用于提升纯白背景上的清晰轮廓。该层与隔离合成都属于非游戏网页兼容选项。直接传入已有 Canvas 时既无法插入这层独立背景合成层，也会强制关闭隔离合成。

软件后端固定使用单个全视口 mip 金字塔，Float32 缓冲跨帧复用；发射遮罩仍只回读实际几何覆盖的子区域。它与 WebGL2 后端使用相同的层数公式、SampleScale、四点采样和线性强度倍率，但输入先经过 8 位 Canvas 编码，透明输出还受预乘 Alpha 可表达范围限制。若运行环境不支持 Canvas 像素回读/写回，圆环和光盘会退回原生 `shadowBlur`，拖尾则在局部离屏缓冲中整体模糊。

### 后端能力边界

| 路径 | 能力边界 |
|---|---|
| WebGPU Extended HDR | `rgba16float + toneMapping: extended` 成功时，Scene、Coverage 与 MXFinalBloom 保留在线性浮点管线中，最终 Canvas 可提交超过 SDR 白色的高光 |
| WebGPU Standard | WebGPU Scene 与 Bloom 仍在浮点管线中运行，但最终 Canvas 使用浏览器首选标准格式并压缩到 SDR；不能声称真实 HDR 输出 |
| 纯 WebGL2 | 默认选择器；在提供匹配背景时，把几何、Coverage、HDR Scene 与 MXFinalBloom 全部保留在同一浮点管线中 |
| WebGL2 Bloom | GPU 成功时复用与纯 WebGL2 相同的完整浮点 Scene；区别是保留 Canvas 2D 请求状态和 Software / Native 失败回退合同 |
| 软件 Bloom | Bloom 金字塔使用 Float32 缓冲，但输入来自 8 位 Canvas；透明覆盖层只能用剩余 Coverage 近似承载 Bloom，不能独立保存任意 HDR RGB |
| 原生辉光 | 使用 Canvas `shadowBlur` 的有界近似，不具备 `RGBA16F`、阈值预过滤和多级累积上采样，观感不会等同 MXFinalBloom |
| Legacy | 保留兼容参数映射和旧 Canvas 合成风格；重置恢复 Legacy 基线，但辉光仍受 `shadowBlur` 与 Canvas 混合限制 |

因此，“严格根据 Unity 工程还原”指参数、纹理采样、曲线、混合意图及完整 GPU 已知 Scene 路径的实现依据；它不表示浏览器所有后端、任意网页背景和透明桌面合成都能逐像素等同游戏截图。回退链优先保证生命周期、几何关系、Coverage 单调性和可用性，不伪装缺失的 HDR Scene 或显示能力。

---

## 常见问题

### WebGPU 模式一定会显示真实 HDR 吗？

不会。展示页“WebGPU”普通模式会固定为 `standard` SDR；“WebGPU HDR（实验）”也可能在 Extended 配置不可用时回退到 `standard`。只有 `getConfig().resolvedWebGPUOutputMode === 'extended'` 才表示 Canvas 会以扩展 sRGB 编码保留超过 SDR 白色的高光。显示器、系统 HDR、浏览器 WebGPU HDR Canvas 和 `rgba16float + extended` 缺一不可。截图、Canvas 像素回读和普通 SDR 屏幕也不能证明最终面板实际输出了多少尼特。

### 移动端浏览器滑动时为什么没有轨迹拖尾？

展示页默认的“触摸行为：自动”会保留浏览器原生滚动；浏览器接管手势后发送 `pointercancel`，当前拖尾会中止。把控制面板中的“触摸行为”切换为“禁止默认手势”即可在任意滑动方向持续触发拖尾，对应 API 为 `touchAction: 'none'`。页面仍需单轴滚动时，可选择“仅横向平移”或“仅纵向平移”；浏览器允许的方向继续滚动并中止拖尾，未被浏览器接管的方向保留拖尾。该设置也会改变页面原生滚动与缩放手势。

### 为什么纯白背景上的颜色变淡？

Unity 的点击特效使用加色混合；接近白色的目标已经没有足够通道空间继续变亮，因此直接合成时蓝青色对比会下降。纯白网页背景建议开启 `isolatedCompositing: true`，让库自有输出层先在透明组中解析。若使用 `scene` 输出仍需要更清晰的非游戏轮廓，可再按需设置 `lightBackgroundContrastAlpha`；透明桌面的 `browser-overlay` 模式应保持该值为 `0`。

### 隔离合成能否替代合成参考？

不能。隔离合成只改变多 Canvas 的 CSS 合成边界，不读取页面或桌面像素，也不改变 Bloom 算法。需要让背景参与和游戏相同的线性 HDR Scene 计算时，必须向完整 GPU Scene（WebGPU、纯 WebGL2 或成功解析到 GPU 的 WebGL2 Bloom）提供与实际显示内容匹配的 `setCompositingReference()`；未知或动态桌面背景无法逐像素复现该结果。

### 未知背景上能否同时得到严格 Unity 加色、纯 Coverage Alpha，并保证白底绝不变暗？

不能。`source-over` 只有覆盖层 RGB 与 Alpha，严格加色所需的输出 RGB 又依赖底层背景颜色；库无法从透明桌面读取该颜色。展示与严格还原应保留默认 `scene`，已知背景通过 `setCompositingReference()` 交给渲染器；透明桌面宿主显式使用 `browser-overlay`，默认以 `overlayAlphaPolicy: 'coverage'` 保证 Coverage 传输和与透明度连续性，而不宣称对任意背景逐像素等同 Unity。

### 如何恢复接近 v1.2.15 的透明覆盖层观感？

使用 `overlayAlphaPolicy: 'visual-max'`。它在清晰 Scene Coverage 与 Bloom 传输 Alpha 之间取较大值，恢复旧版较低遮挡率的视觉近似；最终 `maxRGB` 只用于把预乘 RGB 收敛到可用 Alpha 容量，绝不参与 Alpha 生成。颜色是独立选择：保持 `overlayColorCompensation: 'none'` 可只恢复 Alpha 观感；未知浅色背景需要更醒目的高能核心时，再单独启用 `'bright-core'`。后者不会整体提白低能拖尾。

### 透明桌面宿主应该使用什么配置？

默认建议使用 `effectBackend: 'webgl2'`、`bloomBackend: 'webgl2'`、`outputCompositing: 'browser-overlay'`、`overlayAlphaPolicy: 'coverage'`、`overlayColorCompensation: 'none'`、`overlayAlphaLimit: 250 / 255`、`hostCompositing: 'source-over'` 和 `lightBackgroundContrastAlpha: 0`。需要 v1.2.15 风格的较低遮挡视觉近似时，仅切换 Alpha 策略为 `'visual-max'`；未知浅色背景可独立启用 `'bright-core'`，它只补偿受发射与 Bloom 能量门控的高能核心。需要不压暗背景的 DOM 近似时，中高亮或变化背景使用 `'screen'`，只有黑色/暗色背景使用 `'plus-lighter'`；两者都不使用 Alpha 策略、颜色补偿和 Alpha 上限。严格 Unity 一致必须提供匹配背景参考或由宿主在线性 HDR 目标中合成。选择 WebGPU 的宿主还应监听解析状态并读取 `resolvedWebGPUOutputMode`，因为 Device 或 Context 丢失会进入兼容回退；回退路径保持透明度合同，但不能承诺真实 HDR 或与完整 GPU Bloom 完全相同。

---

## 和其他项目的区别

`ba-click-fx` 更关注《蔚蓝档案》游戏内点击反馈的细节还原，v1.2.0 起改为从游戏 Unity Prefab 逐参数移植。参数与渲染依据来自 Unity 工程；最终像素是否一致仍取决于后端、已知场景背景、色彩管理与宿主合成链。

相比通用 cursor effects，本项目重点实现：

- 游戏风格的溶解圆环、中心光盘和碎片爆发
- 参数级还原 Unity ParticleSystem 颜色/大小/旋转曲线
- 拖尾从尾部到头部连续消散，而不是整条轨迹同时淡出
- 粒子尺寸随画布高度持续缩放，保持 Unity UI 相对比例
- 20+ 个可调参数 + 自定义主题色，适合微调偏好

Related projects:

- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor)
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark)
- [ZM-Kimu/Blue-Archive-Touch-Effect](https://github.com/ZM-Kimu/Blue-Archive-Touch-Effect)

---

## 项目结构

```
ba-click-fx/
├── src/
│   ├── fx.js            # 主引擎：ParticleSystem + TrailRenderer 生命周期
│   ├── main.js           # 演示页面入口 + 控制面板 UI
│   ├── config.js         # Unity FX_Touch 粒子参数只读快照
│   ├── trail-texture.js  # WebGL2 无损 Trail_03 RGB 纹理数据
│   ├── software-bloom.js # MXFinalBloom Float32 mip 与加色合成
│   ├── webgpu-device.js   # WebGPU Adapter/Device 与 HDR Canvas 输出协商
│   ├── webgpu-effect.js   # WebGPU Scene、Bloom 金字塔与 Final Pass
│   ├── webgpu-shaders.js  # WGSL 几何与后处理 Shader
│   ├── webgl2-effect.js  # 纯 WebGL2 / WebGL2 Bloom 共享 Scene 与 Final Pass
│   ├── webgl2-canvas-scene.js # Native / Legacy 的 Canvas Scene Final Pass
│   ├── webgl2-bloom.js   # WebGL2 Bloom 参考实现与回归基线
│   └── style.css         # 演示页样式
├── scripts/
│   ├── build.mjs         # 构建脚本
│   └── verify-*.mjs/cjs  # 发布校验脚本
├── test/
│   └── smoke.js          # 移植、后端状态与生命周期验证
├── index.html            # 演示页面
├── dist/                 # 构建输出
│   ├── ba-click-fx.js    # ESM 库
│   ├── ba-click-fx.cjs   # CommonJS
│   └── ba-click-fx.iife.js  # IIFE CDN
└── package.json
```

### 架构特点

- **隔离合成层**：默认关闭；可显式启用透明隔离组，改善非游戏纯白网页背景上的颜色保留
- **WebGPU Scene**：异步申请 Device，使用 `rgba16float` 线性 Scene 与 WGSL Bloom；普通模式固定 Standard SDR，HDR 模式仅在 `extended` 成功时保留真实超白输出，Device 失败时回退 WebGL2
- **纯 WebGL2 Scene**：完整几何、Coverage、背景与 MXFinalBloom 在一个 HDR 管线中完成并一次输出
- **Canvas Scene Final Pass**：原生辉光和 Legacy 复用 Canvas 生成的 Scene 近似；提供场景背景时统一执行背景衰减与颜色编码，但不宣称具备完整 WebGL2 的浮点精度
- **主特效层**：Canvas 路径内部以 `lighter` 累积发射能量，最终覆盖层使用预乘 Alpha 输出，避免 CSS 二次加亮
- **浅色背景兼容层**：默认强度为 0；可显式设为 0.35，使用不参与 Bloom 的 `darken` Canvas 提升纯白背景可见性
- **软件 Bloom**：全视口工作画布 + Float32 MXFinalBloom 金字塔；像素读回不可用时回退 `shadowBlur`
- **WebGL2 Bloom**：兼容选择器在 GPU 成功时复用完整 WebGL2 Scene，不重复栅格隐藏 Canvas；能力不足时沿 Software / Native 链降级
- **资源生命周期**：WebGPU Device 或 WebGL Context 丢失立即回退；模式切换释放全尺寸帧目标并保留仍可复用的静态 GPU 资源
- **按需渲染**：无活跃特效时自动停止 `requestAnimationFrame`
- **零外部依赖**：仅使用浏览器原生 Canvas 2D / WebGL2 / WebGPU API，不引入第三方运行时

---

## 开发说明

本项目主要通过 AI 生成和迭代完成（**绝无手写代码**），并经过实际运行测试、参数调校和效果校准。项目目标是尽可能还原《蔚蓝档案》风格的网页点击特效与拖尾轨迹，同时保持 WebGL2 默认加速、软件 Bloom 自动回退、零外部运行时依赖和易集成的特性。

本地开发与 CI 统一使用 **Node.js 24 LTS**；当前验证版本为 Node.js `24.19.0`（Krypton）和 npm `11.17.0`。`package.json` 中的 `node >=18` 仍表示已构建库对 Node.js 使用者的运行时兼容范围，不代表开发工具链版本。

### Unity 资源真值门禁

新版 `UnityMouseFxLab` 是固定 UI Pass 的唯一基线：`Matrix4x4.Ortho(-aspect, aspect, -1, 1)` 等价于 `orthographicSize = 1.0`。旧 `提取资产2` 的 `1.35` 只是早期预览相机值，不能覆盖新版机器码与序列化资源证据。Prefab 数量固定为 2 个圆环、4 个点击碎片，以及每次按下实例最多 50 个拖尾碎片。

修改 Unity 参数、投影换算或粒子创建逻辑前，必须先阅读 [Unity 固定 UI Pass 真值与验证合同](https://github.com/CialloKing/ba-click-fx/blob/main/docs/unity-reference-baseline.md)，并依次执行：

```powershell
npm run verify:unity-reference -- --project "D:\WebProjects\BA鼠标输入与点击特效系统\UnityMouseFxLab\UnityMouseFxLab"
npm run test:browser:unity-counts
npm run build
npm run test:browser:built
npm run test:browser:webgpu:optional
```

聚焦数量门禁与完整浏览器矩阵复用同一断言，可不受其他像素用例的前置成败影响。标准矩阵验证 WebGL2、Canvas 和 Legacy 路径，独立的可选 WebGPU 运行时门禁在设备可用时验证同一数量合同。若资源审计和跨后端数量断言均未暴露偏差，应继续检查像素换算、DPR、时序、颜色空间、合成和 Bloom，不得为了迎合视觉现象改写已经确认的 Unity 数值。

发布前统一执行：

```bash
npm ci
npm run check
```

`check` 会按顺序完成构建、测试、演示同步、版本/入口、npm 精确文件清单和本地包安装检查。

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
