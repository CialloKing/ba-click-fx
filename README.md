# ba-click-fx

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)

**Blue Archive / 蔚蓝档案 style mouse click effect and cursor trail animation for web.**

`ba-click-fx` 是一个网页版《蔚蓝档案》(Blue Archive) 点击与拖拽特效库，使用纯 **Canvas 2D** 实现游戏风格的鼠标点击动画、蓝色圆盘、旋转圆环、碎片粒子、拖尾光轨和拖拽轨迹效果。

A lightweight **Blue Archive style cursor effect** library for the web. It provides **mouse click effects**, **touch effects**, **cursor trail animation**, **particle sparks**, **glowing rings**, and **drag trails** with zero external runtime dependencies.

**Online Demo:** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

> Click, drag, or move your mouse on the demo page to preview the Blue Archive style click effect and cursor trail.

<!-- TODO: add a demo GIF
<p align="center">
  <img src="./docs/assets/ba-click-fx-demo.gif" alt="Blue Archive click effect and cursor trail demo" width="720">
</p>
-->

---

## 目录

- [在线演示](#在线演示)
- [特性](#特性)
- [快速开始](#快速开始)
- [三种使用方式](#三种使用方式)
  - [npm 安装](#1-npm-安装)
  - [CDN 引入](#2-cdn-引入)
  - [直接下载](#3-直接下载)
- [常见用法](#常见用法)
- [API 文档](#api-文档)
- [效果说明](#效果说明)
- [和其他项目的区别](#和其他项目的区别)
- [项目结构](#项目结构)
- [开发说明](#开发说明)
- [致谢](#致谢)
- [许可](#许可)

---

## 在线演示

打开 [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)，随意点击、拖动鼠标即可预览效果。页面右上角 ⚙ 可打开控制面板，实时调整颜色、大小、拖尾长度、碎片数量等参数。

---

## 特性

- Blue Archive / 蔚蓝档案风格点击特效
- Mouse click effect / touch effect / cursor trail effect
- 蓝色圆盘、旋转圆环、碎片粒子、拖尾光轨
- 支持点击、拖拽、移动轨迹和手动触发
- 纯 Canvas 2D 实现，无图片素材依赖
- 零外部运行时依赖，适合普通网页、博客、个人主页和前端项目
- 支持 npm、CDN、直接下载三种接入方式
- 支持颜色、缩放、透明度、速度、拖尾长度、圆环、碎片、发光等大量可调参数
- 60+ 可调参数，演示页控制面板可实时预览

---

## 快速开始

只想看效果？打开 [在线演示](https://ba-click-fx.cialloking.top) 随便点击、拖拽即可。

本地运行：

```bash
git clone https://github.com/CialloKing/ba-click-fx.git
cd ba-click-fx
npm install
npm run dev
```

构建：

```bash
npm run build
```

---

## 三种使用方式

### 1. npm 安装

```bash
npm install ba-click-fx
```

最简用法：

```js
import { BAClickFX } from 'ba-click-fx';

const spark = new BAClickFX();
```

带自定义配置：

```js
import { BAClickFX } from 'ba-click-fx';

const spark = new BAClickFX({
  color: [105, 161, 255],
  scale: 1.1,
  opacity: 0.5,
  trailEnabled: true,
  trailAlways: false,
});
```

### 2. CDN 引入

一行 `<script>` 标签即可，无需构建工具：

固定版本（推荐）：

```html
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.0.8/dist/ba-click-fx.iife.js"></script>
<script>
  const spark = new BAClickFX();
</script>
```

始终使用最新版本：

```html
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx/dist/ba-click-fx.iife.js"></script>
<script>
  const spark = new BAClickFX();
</script>
```

### 3. 直接下载

从 [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases) 下载构建产物（`ba-click-fx.js`、`ba-click-fx.iife.js`、`ba-click-fx.cjs`、`ba-click-fx.d.ts`），或直接 clone 仓库使用 `dist/` 目录中的文件，适合静态站点：

```html
<canvas id="myCanvas"></canvas>
<script type="module">
  import { BAClickFX } from './ba-click-fx.js';
  const spark = new BAClickFX({ target: '#myCanvas' });
</script>
```

---

## 常见用法

挂载到指定 canvas：

```js
const fx = new BAClickFX({
  target: '#myCanvas',
});
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
new BAClickFX(options?: BAClickFXOptions)
```

| 选项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `target` | `string \| HTMLElement` | 自动创建 | 挂载目标：CSS 选择器或已有 `<canvas>` |
| `color` | `[r, g, b]` | `[105, 161, 255]` | 主题颜色 |
| `scale` | `number` | `1.10` | 全局缩放 (0.5~3) |
| `opacity` | `number` | `0.50` | 透明度 (0.1~1) |
| `trailAlways` | `boolean` | `false` | 鼠标移动时也显示拖尾 |
| `trailEnabled` | `boolean` | `true` | 启用拖尾轨迹 |

### 实例方法

#### 基础

| 方法 | 说明 |
|---|---|
| `setColor(r, g, b)` | 主题颜色 (0~255) |
| `setScale(s)` | 全局缩放 (0.5~3) |
| `setOpacity(o)` | 透明度 (0.1~1) |
| `setSpeed(click, trail?)` | 点击/拖拽速度 (0.2~3) |
| `setDpr(d)` | 最大设备像素比 (1~2) |
| `setTrailRenderScale(s)` | 拖尾离屏画布缩放 (0.5~1) |

#### 发光

| 方法 | 说明 |
|---|---|
| `setGlow(enabled)` | shadowBlur 发光（性能开销较高） |
| `setFakeGlow(enabled)` | 多层柔光（推荐） |
| `setClickFakeGlow(enabled)` | 点击特效柔光 |

#### 圆环

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setRingRotationSpeed(v)` | 旋转角速度 (0~0.05) | `0.008` |
| `setRingGlow(v)` | 光晕强度 (0~1) | `0.35` |
| `setRingWidth(v)` | 弧线宽度 (0.3~3) | `0.9` |
| `setRingAlpha(v)` | 圆环透明度 (0.1~1) | `0.9` |
| `setRingDelay(v)` | 出现延迟 (0~10) | `2` |
| `setRingMaxLife(v)` | 总时长 (10~60) | `27` |
| `setRingBaseRadiusMul(v)` | 起始半径倍率 (0.2~1) | `0.47` |
| `setRingPostDiskGrow(v)` | 扩张量 (5~60) | `24` |
| `setRingGlowRadiusAdd(v)` | 发光半径 (10~150) | `54` |
| `setRingSoftGlowRadiusAdd(v)` | 柔光半径 (20~200) | `96` |
| `setRingRadiusGrowEnd(v)` | 扩张进度阈值 (0.2~1) | `0.66` |

#### 拖尾

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setTrail(enabled)` | 开关拖尾 | `true` |
| `setTrailAlways(enabled)` | 移动时也显示 | `false` |
| `setTrailBrightness(a)` | 整体亮度 (0.1~1) | `0.96` |
| `setTrailWhiteMix(v)` | 偏白程度 (0~1) | `0.08` |
| `setTrailWidth(fast, slow?)` | 基础线宽 (0.5~6) | `3` |
| `setTrailLength(slow, fast?)` | 轨迹长度上限 | `900, 4200` |
| `setTrailLife(slow, fast?)` | 消散速度 (5~400) | `22` |
| `setTrailDecay(tail, head, release)` | 尾部/头部/松手消散倍率 | `1.28, 0.95, 1.18` |
| `setTrailSmooth(f)` | 鼠标平滑 (0~0.9) | `0.5` |
| `setTrailSpeedRange(min, max)` | 速度映射区间 (px/ms) | `0.035, 2.2` |
| `setTrailSpeedMin(v)` | 最小速度阈值 (0.005~0.5) | `0.035` |
| `setTrailSpeedMax(v)` | 最大速度阈值 (0.5~5) | `2.2` |
| `setTrailSpeedDecay(d)` | 速度衰减率 (0.8~0.999) | `0.988` |
| `setTrailTailDecayMul(v)` | 单独设置尾部衰减 | `1.28` |
| `setTrailHeadDecayMul(v)` | 单独设置头部衰减 | `0.95` |
| `setTrailReleaseDecayMul(v)` | 单独设置松手衰减 | `1.18` |
| `setTrailSampling(step, max)` | 输入采样间距与最大点数 | `0.85, 80` |
| `setTrailRenderSampling(step, max)` | 渲染重采样间距与最大点数 | `0.75, 2400` |

#### 拖尾图层透明度

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setTrailMainAlpha(v)` | 主轨迹 | `1` |
| `setTrailCoreAlpha(v)` | 中心高光 | `0.78` |
| `setTrailHotAlpha(v)` | 蓝白热点 | `0.34` |
| `setTrailGlowAlpha(v)` | 蓝色发光 | `0.18` |
| `setTrailSoftGlowAlpha(v)` | 柔和外光 | `0.045` |
| `setTrailRailAlpha(v)` | 细轨 | `0.02` |
| `setTrailGlowWidthMul(v)` | 发光宽度 (0.3~8) | `1.7` |
| `setTrailSoftGlowWidthMul(v)` | 柔光宽度 (0.5~15) | `2.4` |

#### 碎片

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setSparksCount(n)` | 点击碎片数量 (0~12) | `4` |
| `setMaxShards(n)` | 最大碎片数 (0~200) | `38` |
| `setShardSpacing(d)` | 间距 (20~500) | `220` |
| `setShardChance(slow, fast)` | 额外概率 | `0.04, 0.18` |
| `setShardLargeChance(p)` | 大碎片概率 | `0.62` |
| `setMoveSparkChance(v)` | 移动随机撒点概率 (0~0.05) | `0` |

#### 生命周期

| 方法 | 说明 |
|---|---|
| `boom(x?, y?)` | 手动触发点击特效，默认屏幕中央 |
| `clearTrail()` | 清除所有拖尾 |
| `getConfig()` | 返回当前配置深拷贝 |
| `resetConfig()` | 恢复默认配置 |
| `destroy()` | 销毁实例：移除 Canvas、事件、动画 |

---

## 效果说明

### 点击特效

| 元素 | 表现 |
|---|---|
| 圆盘 | 白色闪光 → 蓝色圆盘，快速扩张后消散 |
| 圆环 | 2 段高亮弧线，逆时针旋转收缩 |
| 碎片 | 三角粒子从圆盘边缘爆射，脉冲闪烁 |

### 拖尾光轨

6 层叠加渲染，模拟 Unity TrailRenderer + ParticleSystem：

| 层 | 说明 |
|---|---|
| 暗轨线 | 残留在旧轨迹上的细蓝线 |
| 柔和外光 | 宽而淡的扩散光晕 |
| Ribbon 能量带 | 半透明带状材质 |
| 主蓝色轨迹 | 核心轨迹，宽度沿路径变细 |
| 中心高光 | 浅蓝高亮芯线 |
| 蓝白热点 | 最近弧线持续发亮 |

碎片沿轨迹按距离散布，支持大/小两种尺寸随机混合。

---

## 和其他项目的区别

`ba-click-fx` 更关注网页版《蔚蓝档案》点击反馈的细节还原，而不是普通网页烟花或简单鼠标拖尾效果。

相比通用 cursor effects，本项目重点实现：

- 游戏风格的点击圆盘、旋转圆环和碎片爆发
- 更接近原游戏观感的蓝色拖尾光轨
- 拖尾从尾部到头部连续消散，而不是整条轨迹同时淡出
- 鼠标快速移动时保持连续轨迹
- 点击、拖拽、移动轨迹、手动触发都可控制
- 60+ 参数可调，适合继续校准游戏原版效果

Related projects:

- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor)
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark)
- [ZM-Kimu/Blue-Archive-Touch-Effect](https://github.com/ZM-Kimu/Blue-Archive-Touch-Effect)

---

## 项目结构

```
ba-click-fx/
├── src/
│   ├── ba-spark.js      # 特效引擎（BAClickFX 类）
│   ├── main.js           # 演示页面入口 + 控制面板 UI
│   ├── config.js         # 所有可调参数
│   ├── utils.js          # 纯数学工具
│   ├── style.css         # 演示页样式
│   └── ba-click-fx.d.ts  # TypeScript 声明
├── scripts/
│   └── build.mjs         # 构建脚本
├── test/
│   └── smoke.js          # 冒烟测试
├── index.html            # 演示页面
├── dist/                 # 构建输出
│   ├── index.html        # 演示页
│   ├── ba-click-fx.js    # ESM 库
│   ├── ba-click-fx.cjs   # CommonJS
│   ├── ba-click-fx.iife.js  # IIFE CDN
│   └── ba-click-fx.d.ts  # TypeScript 声明
├── vite.config.js        # 演示页 Vite 配置
├── vite.lib.config.js    # 库模式 Vite 配置
└── package.json
```

### 架构特点

- **双层 Canvas**：主 Canvas 渲染点击特效，离屏 trailCanvas 独立渲染拖尾 → `lighter` 混合
- **对象池**：ClickWave 和 SparkParticle 回收复用，避免 GC 抖动
- **按需渲染**：无活跃特效时自动停止 `requestAnimationFrame`
- **60fps 基准**：所有帧数参数归一化到 60fps，运行时缩放适配任意刷新率
- **零外部依赖**：仅依赖标准 Canvas 2D API

---

## 开发说明

本项目主要通过 AI 辅助生成和迭代完成，并经过实际运行测试、参数调校和效果校准。项目目标是尽可能还原《蔚蓝档案》风格的网页点击特效与拖尾轨迹，同时保持纯 Canvas 2D、零运行时依赖和易集成的特性。

---

## 致谢

- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor) — 蔚蓝档案光标特效实现
- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark) — 蔚蓝档案点击特效早期 Web 实现

上面的这两个项目对于鼠标轨迹的还原都不够像游戏内的原始特效，本项目在前两个项目的基础上优化了点击特效和轨迹特效，并且增加了大量可自定义选项。

---

## 许可

MIT
