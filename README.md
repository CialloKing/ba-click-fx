# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-安装-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami)

> 📖 [English version](./README.en.md)

**从 Blue Archive Unity UI/FX_Touch 逐参数移植的网页点击特效与光标拖尾动画库。**

`ba-click-fx` 将游戏《蔚蓝档案》的 `FX_Touch.prefab` 中 ParticleSystem 和 TrailRenderer 的完整参数——颜色曲线、大小曲线、旋转速度、溶解阈值、HDR 强度、TrailRenderer 时间与宽度——逐项还原到 Web。清晰几何使用 **Canvas 2D**，Bloom 默认由 JavaScript 软件管线处理，也可选择 WebGL2 GPU 加速。零外部运行时依赖。

A parameter-level port of the **Blue Archive** UI click effect and cursor trail from Unity to the web. **Canvas 2D** with optional WebGL2 Bloom, zero external runtime dependencies.

**在线演示：** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

> 🖱 点击、拖拽或移动鼠标即可预览特效。Click, drag, or move your mouse on the demo page to preview.

<p align="center">
  <img src="./docs/assets/ba-click-fx-demo.gif" alt="demo" width="45%">
  &nbsp;&nbsp;
  <img src="./docs/assets/blue-archive-reference.gif" alt="game reference" width="45%">
</p>
<p align="center"><sub>ba-click-fx 项目演示（左） · 游戏内效果参考（右，仅用于效果对比）</sub></p>

---

## 目录

- [特性](#特性)
- [使用方式](#使用方式)
- [常见用法](#常见用法)
- [API 文档](#api-文档)
- [效果说明](#效果说明)
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
- Canvas 2D 清晰几何，无图片素材、无外部运行时依赖
- 四种展示页渲染选择：WebGL2 Bloom、软件 Bloom（默认参考实现）、原生辉光、Legacy
- 可选 WebGL2 GPU Bloom；不支持时自动回退软件 Bloom，再回退原生辉光
- 支持浏览器插件、npm、CDN、直接下载四种接入方式
- 自定义主题色（HSL hue 偏移）
- 可调参 API：运行时修改圆环 HDR、半径、宽度、寿命、碎片数量、拖尾宽度、Bloom 强度等
- 按窗口高度自动缩放，保持与游戏 UI 一致的相对比例

---

## 使用方式

### 1. 浏览器插件

不想写代码？直接从 [Chrome 应用商店安装 ba-click-fx-extension](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami)，普通网页即可获得蔚蓝档案风格点击特效和光标拖尾。

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
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.8/dist/ba-click-fx.iife.js"></script>
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
  target?: string | HTMLElement,   // 挂载目标，默认全屏
  scale?: number,                  // 全局缩放，默认 1
  opacity?: number,                // 不透明度 0~1，默认 1
  clickEnabled?: boolean,         // 启用点击特效，默认 true
  trailEnabled?: boolean,         // 启用拖尾，默认 true
  trailAlways?: boolean,          // 移动鼠标即显示拖尾（无需按下），默认 false
  renderingMode?: 'enhanced' | 'legacy', // 渲染模式，默认 enhanced
  bloomBackend?: 'auto' | 'software' | 'webgl2' | 'native', // Bloom 后端，默认 software
  softwareBloomEnabled?: boolean, // 兼容旧 API：true 等同 software，false 等同 native
  isolatedCompositing?: boolean,  // 隔离合成，默认 true；false 时直接与页面混合
  lightBackgroundContrastAlpha?: number, // 浅色背景兼容层强度，默认 0.35；设为 0 可关闭
  maxDpr?: number,                // 最大设备像素比，默认 2
  touchAction?: string,           // Canvas touch-action，默认 'auto'
  inputFilter?: (e: PointerEvent) => boolean,
})
```

增强模式下可通过 `bloomBackend` 选择 Bloom 后端；展示页将它与 Legacy 组合成四种直观选项：

| 展示页选项 | API 配置 | 说明 |
|---|---|---|
| WebGL2 Bloom | `{ renderingMode: 'enhanced', bloomBackend: 'webgl2' }` | GPU 执行阈值、Gaussian mip 与 Scatter；不可用时自动回退 |
| 软件 Bloom | `{ renderingMode: 'enhanced', bloomBackend: 'software' }` | 默认且最精确的参考/兼容实现，使用 Canvas 2D 像素回读和 Float32 缓冲 |
| 原生辉光 | `{ renderingMode: 'enhanced', bloomBackend: 'native' }` | 使用 Canvas 2D `shadowBlur`，开销较低但观感与后处理 Bloom 不同 |
| Legacy | `{ renderingMode: 'legacy' }` | 保留旧版 sRGB、合成和辉光行为；此时忽略 Bloom 后端 |

展示页在四档渲染选项之外提供独立的“隔离合成”开关。该开关默认开启，与 Software、WebGL2、Native 或 Legacy 渲染选择正交；它只控制多张 Canvas 的最终 CSS 合成边界，不改变 Bloom 阈值、模糊或颜色计算，也不是降低 Bloom 计算量的性能开关。

`bloomBackend: 'auto'` 会优先尝试 WebGL2，失败时依次使用软件 Bloom 和原生辉光。显式选择 `'webgl2'` 也采用相同回退链；显式选择 `'software'` 时，像素回读不可用则回退原生辉光。默认值仍为 `'software'`，因此不会主动创建 WebGL 上下文。若同时传入 `bloomBackend` 和旧字段 `softwareBloomEnabled`，以 `bloomBackend` 为准。

`isolatedCompositing: true` 会让库拥有的主特效层、WebGL2 Bloom 层和浅色背景兼容层先在透明隔离组内混合，再将整个组覆盖到页面上；这样可以避免 `plus-lighter` 直接与纯白背景相加后把蓝青色钳制成白色。设为 `false` 时，各 Canvas 会直接挂载到目标容器或页面，恢复严格的直接页面合成。该选项可通过 `updateConfig()` 在运行时切换。

WebGL2 Bloom 和隔离合成都需要库拥有 DOM 覆盖层。若 `target` 是一个已有的 `<canvas>`，库无法安全插入额外的 WebGL2、对比或隔离层，因此 `'webgl2'` / `'auto'` 会自动回退到软件 Bloom，`isolatedCompositing` 也会被强制降级为 `false`；`getConfig()` 返回的是降级后的实际配置。默认全屏覆盖层不受此限制。普通容器也可以使用，但容器必须自行建立定位上下文（通常设置 `position: relative`），库不会静默修改宿主样式。

隔离根按 `BAClickFX` 实例独立创建和销毁。同一页面的多个隔离实例不会跨根执行 `plus-lighter`；一个实例切换模式或销毁也不会移动、删除其他实例的 Canvas。

### 实例方法

| 方法 | 说明 |
|---|---|
| `boom(x, y)` | 在指定坐标触发点击特效 |
| `clear()` | 清除全部视觉对象 |
| `clearTrail()` | 仅清除拖尾和碎片 |
| `destroy()` | 销毁实例，移除事件监听和 Canvas |
| `updateConfig({...})` | 运行时更新基础配置、`renderingMode`、`bloomBackend`、`isolatedCompositing`、DPR 与触摸行为 |
| `setThemeColor('#ff6969')` | 设置主题色，所有蓝色系特效 hue 偏移到此颜色 |
| `setFxParam('rings.hdrIntensity', 5.992157)` | 点号路径修改任意特效参数 |
| `getFxConfig()` | 返回当前完整特效配置深拷贝 |
| `resetFxConfig()` | 重置所有特效参数为游戏默认值 |
| `getConfig()` | 返回当前实例配置；`resolvedBloomBackend` 表示最近一次解析结果，WebGL2/auto 首次延迟探测前为 `pending` |

后端解析状态发生变化时，主 Canvas 会派发 `baclickfxbackendchange`。可使用导出的事件名持续同步延迟探测、运行时回退和 WebGL Context 恢复：

```js
import {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
} from 'ba-click-fx';

const fx = new BAClickFX({ bloomBackend: 'webgl2' });

fx.canvas.addEventListener(BLOOM_BACKEND_CHANGE_EVENT, (event) =>
{
  console.log(event.detail.resolvedBloomBackend);
});
```

点击辉光可独立于轨迹调节。该倍率只改变增强模式下圆环和中心光盘的
Bloom 发射；原生辉光使用保持单调的有界 Alpha 映射，Legacy 保持兼容输出：

```js
fx.setFxParam('bloom.clickEmissionScale', 1.25);
```

### 可调特效参数（setFxParam 路径）

| 路径 | 默认值 | 说明 |
|---|---|---|
| `rings.hdrIntensity` | 5.992157 | 圆环 HDR 强度 |
| `rings.radiusMin` | 51.0560832 | MeshTri 随机外半径下限；生命周期大小曲线应用前的基准值 |
| `rings.radiusMax` | 59.5654304 | MeshTri 随机外半径上限；生命周期大小曲线应用前的基准值 |
| `rings.bandToOuterRadius` | 0.0598573766 | 原网格环宽与外半径的固定比值 |
| `rings.widthStart` | 1 | 生命周期起点的资源环宽倍率，不是独立像素宽度 |
| `rings.widthEnd` | 1 | 生命周期终点的资源环宽倍率，不是独立像素宽度 |
| `rings.lifetimeMs` | 600 | 圆环寿命 (ms) |
| `shards.clickCount` | 4 | 点击碎片数量 |
| `shards.maxCount` | 96 | 碎片上限 |
| `shards.trailSpacing` | 80 | 拖尾碎片间距 |
| `bloom.threshold` | 1.0 | 高亮提取阈值 |
| `bloom.softKnee` | 0.5 | 阈值过渡柔和度 |
| `bloom.clamp` | 65472 | URP 预过滤 HDR 上限 |
| `bloom.intensity` | 1.0 | 针对网页透明 sRGB 合成与游戏截图校准的 Bloom 强度 |
| `bloom.scatter` | 0.7 | 针对局部 mip 裁剪补偿的光晕扩散范围 |
| `bloom.resolutionScale` | 0.5 | Bloom 缓冲区相对分辨率（内部限制为 0.1~0.75） |
| `bloom.skipIterations` | 1 | 略过最深层 mip 的迭代数 |
| `bloom.highQualityFiltering` | true | 启用高质量双三次 scatter 上采样 |
| `bloom.clickEmissionScale` | 1.0 | 点击圆环与中心光盘的独立辉光倍率，推荐 `0~4`；不影响清晰几何或轨迹 |
| `bloom.ringEmissionAlpha` | 1.0 | 与 FX_MAT_Touch_Tri3 材质 Alpha 对齐的圆环 HDR 发射 |
| `bloom.diskEmissionAlpha` | 1.0 | 软件 Bloom 光盘 HDR 发射校准 |
| `bloom.ringBlur` | 80 | 像素回读不可用时的圆环原生模糊半径 |
| `bloom.ringAlpha` | 0.35 | 像素回读不可用时的圆环原生模糊强度 |
| `bloom.diskBlur` | 65 | 像素回读不可用时的光盘原生模糊半径 |
| `bloom.diskAlpha` | 0.65 | 像素回读不可用时的光盘原生模糊强度 |
| `bloom.trailCoverageScale` | 1.75 | Canvas 拖尾几何对 Unity 三角带子像素覆盖率的校准 |
| `bloom.trailEmissionAlpha` | 1.0 | 软件 Bloom 拖尾 HDR 发射校准 |
| `bloom.trailAlpha` | 0.18 | 原生局部离屏模糊回退强度 |
| `trail.width` | 2 | 拖尾清晰几何带宽度 |
| `trail.outerGlowWidth` | 9 | 原生局部离屏回退光晕半径 |
| `trail.lifetimeMs` | 300 | 拖尾寿命 (ms) |

---

## 效果说明

### 点击特效

| 元素 | 表现 |
|---|---|
| 中心光盘 | 白色→蓝色渐变短圆盘，快速扩张后消散，持续 200ms |
| 溶解圆环 | 2 枚旋转环带，弧线从完整逐渐缩短至消失，持续 600ms |
| 点击碎片 | 4 枚三角形粒子从点击位置飞溅，脉冲闪烁 |

圆环的 `radiusMin` / `radiusMax` 是从 MeshTri 的 Start Size 与相机比例换算出的外半径基准值；实际外半径还会乘 Unity 生命周期大小曲线。默认 `widthStart` / `widthEnd` 均为 `1`，只调节资源环宽，实际环宽始终按 `外半径 × 0.0598573766 × 环宽倍率` 计算。

原 Shader 使用 `Blend SrcAlpha One, One One`。ParticleSystemRenderer 的 Apply Active Color Space 会把启用的 Color over Lifetime 顶点色解码到 Linear，再与 `FX_MAT_Touch_Tri3` 的白色 5.992157 HDR 材质相乘。溶解不是连续压低所有像素的透明度，而是以阈值处理二维纹理 Alpha；通过测试的像素继续保留纹理覆盖率。大小和溶解阈值均使用资源关键帧及其入/出切线执行 Unity 三次 Hermite 插值，而不是线性插值或通用 smoothstep。

### 拖尾轨迹

拖尾按 Unity 原资源的同一条渲染链近似：

| 层 | 说明 |
|---|---|
| 几何带与亮芯 | 直接绘制原始 2px HDR 几何带，再由 Bloom 自然扩张为柔和亮芯 |
| 纵向包络 | 将原 TrailRenderer Gradient 反向到 Canvas 点序，再乘 `FX_TEX_Trail_03` 经 sRGB→Linear 换算的 Stretch 纹理亮度 |
| Bloom | 只对 HDR 发射缓冲使用所选 Bloom 后端；三角碎片不写入该缓冲 |

碎片沿轨迹按距离散布。

### Bloom 渲染后端

WebGL2 与软件 Bloom 共用同一组 HDR 发射参数和 Bloom 配置。WebGL2 分支在透明 GPU 帧缓冲中绘制圆环、光盘与拖尾发射，再执行阈值/Soft Knee、Gaussian mip 金字塔、Scatter 上采样和加色输出；清晰几何与浅色背景兼容轮廓仍由 Canvas 2D 绘制。这样能在大量特效同时存在时把主要 Bloom 计算从 CPU 和像素回读路径移到 GPU，同时保留软件 Bloom 作为精确参考和兼容实现。

可用性由运行时实际创建 WebGL2 上下文、检查 `EXT_color_buffer_float` 并验证 `RGBA16F` 帧缓冲决定。请求后端与最近一次解析结果可分别通过 `getConfig().bloomBackend` 和 `getConfig().resolvedBloomBackend` 查看；WebGL2/auto 在首次延迟探测或 Context 恢复验证前会短暂返回 `pending`。

### JavaScript 软件 Bloom

默认的 `bloomBackend: 'software'` 会把圆环、光盘和拖尾的 HDR 发射亮度先绘制到局部遮罩，再由 JavaScript 回读像素并按兼容 URP 12 Bloom 的结构处理。三角形碎片只绘制清晰本体，不参与 Bloom：

1. 将 8 位遮罩解码到可复用的 Float32 RGB 缓冲区。
2. 以高质量 13-tap 预过滤执行带 Soft Knee 的阈值提取，生成 1/2 分辨率 mip0。
3. 使用可分离 9-tap Gaussian 下采样建立 mip 金字塔；`bloom.skipIterations` 控制略过的最深层迭代。
4. 按 `bloom.scatter` 从低分辨率 mip 向上混合；开启 `bloom.highQualityFiltering` 时使用双三次采样。
5. 将线性 Bloom 能量转换为 sRGB 加色 RGBA，按 `bloom.intensity` 以 `lighter` 叠加到主画布；后续 CSS 合成边界由 `isolatedCompositing` 决定。

默认的 `isolatedCompositing: true` 会先在透明组内完成主层的 `plus-lighter`、WebGL2 Bloom 层的 `plus-lighter` 和兼容层的 `darken` 混合，再将带颜色与 Alpha 的组合结果覆盖到页面。它不修改 Bloom 算法，却能让纯白背景上的蓝青色、饱和度和柔和辉光保持可见。设为 `false` 后，主层直接以 `plus-lighter` 与 DOM 背景混合；严格加色在纯白背景上必然失去颜色和对比度，这也是用于对照旧输出的兼容路径。

由库自动创建覆盖层时，主特效层上方还会放置一个独立的 `darken` 兼容层：它默认使用 `0.35` Alpha 的淡青色补足清晰轮廓，不接收或产生 Bloom。兼容层必须位于加色层上方，否则主层会把刚补出的淡青对比重新加回纯白。该层是为网页浅色背景增加可见性的有意兼容偏差，并非 Unity 加色管线的一部分；将 `lightBackgroundContrastAlpha` 设为 `0` 可关闭。直接传入已有 Canvas 时既无法插入这层独立背景合成层，也会强制关闭隔离合成。

这条软件管线用于获得接近 URP 12 Bloom 的视觉观感，并非逐像素复刻 GPU 后处理。渲染器按完整模糊支撑范围合并相邻特效，彼此独立的特效区域则分别处理，避免回读它们之间的大块空白；区域内部也只回读发射几何而跳过外围纯透明 padding，最终只编码和上传实际辉光区域。renderer 池和 Float32 金字塔缓冲会跨帧复用，尺寸收缩时会清除完整容量 Canvas，避免旧辉光被平滑缩放成矩形边缘细线。HQ 13-tap 预过滤和 Gaussian 降采样使用等价的标量内联累加，并在完整覆盖当前 mip 时跳过多余的缓冲清零。同一渲染 pass 内的两枚圆环共享一次 Linear Gradient 能量计算；拖尾的距离与分段发射能量也只计算一次，发射遮罩量化后严格为零的暗尾不会重复描画，过期顶点则批量移除。软件 Bloom 合成前的清晰主 Canvas 会直接复用为浅色背景对比遮罩。生命周期始终按真实时间推进，避免低帧率反向延长特效并造成继续积压。以上优化不改变 Bloom 阈值、分辨率、mip 数量、Scatter 或高质量过滤。软件 Bloom 工作缓冲区不会挂载到 DOM，也不使用 WebGL、float16 Canvas 或外部依赖。若运行环境不支持 Canvas 像素回读/写回，圆环和光盘会退回原生 `shadowBlur`；拖尾则按真实弧长把发射颜色写入局部离屏缓冲，再整体模糊一次，既避免采样接缝累积，也不会在回环轨迹尾部产生错误高亮。三角形碎片始终只绘制清晰本体，不写入 Bloom 发射缓冲。

---

## 和其他项目的区别

`ba-click-fx` 更关注《蔚蓝档案》游戏内点击反馈的细节还原，v1.2.0 起改为从游戏 Unity Prefab 逐参数移植，保证特效与游戏内视觉效果一致。

相比通用 cursor effects，本项目重点实现：

- 游戏风格的溶解圆环、中心光盘和碎片爆发
- 参数级还原 Unity ParticleSystem 颜色/大小/旋转曲线
- 拖尾从尾部到头部连续消散，而不是整条轨迹同时淡出
- 按窗口高度自动缩放，保持与游戏 UI 一致的相对比例
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
│   ├── software-bloom.js # URP 12 风格 Float32 mip Bloom 与加色合成
│   ├── webgl2-bloom.js   # WebGL2 HDR 发射、Gaussian mip 与 Scatter 合成
│   ├── utils.js          # 纯数学工具
│   └── style.css         # 演示页样式
├── scripts/
│   ├── build.mjs         # 构建脚本
│   └── verify-*.mjs/cjs  # 发布校验脚本
├── test/
│   └── smoke.js          # 48 项移植验证测试
├── index.html            # 演示页面
├── dist/                 # 构建输出
│   ├── ba-click-fx.js    # ESM 库
│   ├── ba-click-fx.cjs   # CommonJS
│   └── ba-click-fx.iife.js  # IIFE CDN
└── package.json
```

### 架构特点

- **隔离合成层**：默认把主特效、WebGL2 Bloom 和浅色背景兼容 Canvas 放在透明隔离组中合成，再整体覆盖页面；可关闭以恢复直接页面加色
- **主特效层**：内部特效通过 `lighter` 合成，主 Canvas 使用 `plus-lighter`；其混合背景由 `isolatedCompositing` 决定
- **浅色背景兼容层**：自动覆盖层模式额外使用不参与 Bloom 的 `darken` Canvas，以 0.35 Alpha 淡青色维持纯白背景可见性
- **软件 Bloom**：局部工作画布 + Float32 Gaussian mip 金字塔；像素读回不可用时回退 `shadowBlur`
- **WebGL2 Bloom**：可选透明 GPU 覆盖层执行 HDR 预过滤、Gaussian mip 和 Scatter；能力不足时沿回退链降级
- **按需渲染**：无活跃特效时自动停止 `requestAnimationFrame`
- **零外部依赖**：仅使用浏览器原生 Canvas 2D / WebGL2 API，不引入第三方运行时

---

## 开发说明

本项目主要通过 AI 生成和迭代完成（**绝无手写代码**），并经过实际运行测试、参数调校和效果校准。项目目标是尽可能还原《蔚蓝档案》风格的网页点击特效与拖尾轨迹，同时保持软件 Bloom 默认兼容、WebGL2 可选加速、零外部运行时依赖和易集成的特性。

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
