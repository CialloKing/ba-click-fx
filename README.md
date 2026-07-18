# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-安装-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami)

> 📖 [English version](./README.en.md)

**从 Blue Archive Unity UI/FX_Touch 逐参数移植的网页点击特效与光标拖尾动画库。**

`ba-click-fx` 将游戏《蔚蓝档案》的 `FX_Touch.prefab` 中 ParticleSystem 和 TrailRenderer 的完整参数——颜色曲线、大小曲线、旋转速度、溶解阈值、HDR 强度、TrailRenderer 时间与宽度——逐项还原为纯 **Canvas 2D** 实现。零外部运行时依赖。

A parameter-level port of the **Blue Archive** UI click effect and cursor trail from Unity to the web. Pure **Canvas 2D**, zero external runtime dependencies.

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
- 纯 Canvas 2D，无图片素材、无 WebGL、无外部运行时依赖
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
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.4/dist/ba-click-fx.iife.js"></script>
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
  maxDpr?: number,                // 最大设备像素比，默认 2
  touchAction?: string,           // Canvas touch-action，默认 'auto'
  inputFilter?: (e: PointerEvent) => boolean,
})
```

### 实例方法

| 方法 | 说明 |
|---|---|
| `boom(x, y)` | 在指定坐标触发点击特效 |
| `clear()` | 清除全部视觉对象 |
| `clearTrail()` | 仅清除拖尾和碎片 |
| `destroy()` | 销毁实例，移除事件监听和 Canvas |
| `updateConfig({...})` | 运行时更新 scale/opacity/clickEnabled/trailEnabled/trailAlways/maxDpr/touchAction |
| `setThemeColor('#ff6969')` | 设置主题色，所有蓝色系特效 hue 偏移到此颜色 |
| `setFxParam('rings.hdrIntensity', 1.5)` | 点号路径修改任意特效参数 |
| `getFxConfig()` | 返回当前完整特效配置深拷贝 |
| `resetFxConfig()` | 重置所有特效参数为游戏默认值 |
| `getConfig()` | 返回当前实例配置（含 Unity 参数的只读快照） |

### 可调特效参数（setFxParam 路径）

| 路径 | 默认值 | 说明 |
|---|---|---|
| `rings.hdrIntensity` | 1.0 | 圆环 HDR 强度 |
| `rings.radiusMin` | 51 | 圆环起始半径 |
| `rings.radiusMax` | 59 | 圆环终止半径 |
| `rings.widthStart` | 5.2 | 圆环起始宽度 |
| `rings.widthEnd` | 2.4 | 圆环终止宽度 |
| `rings.lifetimeMs` | 600 | 圆环寿命 (ms) |
| `shards.clickCount` | 4 | 点击碎片数量 |
| `shards.maxCount` | 96 | 碎片上限 |
| `shards.trailSpacing` | 80 | 拖尾碎片间距 |
| `bloom.ringBlur` | 80 | 圆环光晕模糊 |
| `bloom.ringAlpha` | 0.9 | 圆环光晕强度 |
| `bloom.diskBlur` | 65 | 光盘光晕模糊 |
| `bloom.trailAlpha` | 0.18 | 拖尾光晕强度 |
| `trail.width` | 2.5 | 拖尾渐变层宽度 |
| `trail.coreWidth` | 1.7 | 拖尾核心层宽度 |
| `trail.outerGlowWidth` | 9 | 拖尾外发光宽度 |
| `trail.lifetimeMs` | 300 | 拖尾寿命 (ms) |

---

## 效果说明

### 点击特效

| 元素 | 表现 |
|---|---|
| 中心光盘 | 白色→蓝色渐变短圆盘，快速扩张后消散，持续 200ms |
| 溶解圆环 | 2 枚旋转环带，弧线从完整逐渐缩短至消失，持续 600ms |
| 点击碎片 | 4 枚三角形粒子从点击位置飞溅，脉冲闪烁 |

### 拖尾轨迹

3 层叠加渲染，模拟 Unity TrailRenderer + Bloom 后处理：

| 层 | 说明 |
|---|---|
| 核心层 | 渐变蓝色亮芯，尾部 alpha 淡出 |
| 外发光层 | 宽而淡的扩散光晕，模拟 Bloom |
| 渐变填充层 | 颜色随路径距离从亮蓝渐变到透明 |

碎片沿轨迹按距离散布。

---

## 和其他项目的区别

`ba-click-fx` 更关注《蔚蓝档案》游戏内点击反馈的细节还原，v1.2.0 起改为从游戏 Unity Prefab 逐参数移植，保证特效与游戏内视觉效果一致。

相比通用 cursor effects，本项目重点实现：

- 游戏风格的溶解圆环、中心光盘和碎片爆发
- 参数级还原 Unity ParticleSystem 颜色/大小/旋转曲线
- 拖尾从尾部到头部连续消散，而不是整条轨迹同时淡出
- 按窗口高度自动缩放，保持与游戏 UI 一致的相对比例
- 14 个可调参数 + 自定义主题色，适合微调偏好

Related projects:

- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor)
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark)
- [ZM-Kimu/Blue-Archive-Touch-Effect](https://github.com/ZM-Kimu/Blue-Archive-Touch-Effect)

---

## 项目结构

```
ba-click-fx/
├── src/
│   ├── ba-spark.js      # 主引擎：ParticleSystem + TrailRenderer 生命周期
│   ├── main.js           # 演示页面入口 + 控制面板 UI
│   ├── config.js         # Unity FX_Touch 粒子参数只读快照
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

- **单 Canvas**：所有特效在同一 Canvas 上通过 `lighter` 混合渲染
- **按需渲染**：无活跃特效时自动停止 `requestAnimationFrame`
- **零外部依赖**：仅依赖标准 Canvas 2D API

---

## 开发说明

本项目主要通过 AI 生成和迭代完成（**绝无手写代码**），并经过实际运行测试、参数调校和效果校准。项目目标是尽可能还原《蔚蓝档案》风格的网页点击特效与拖尾轨迹，同时保持纯 Canvas 2D、零运行时依赖和易集成的特性。

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
