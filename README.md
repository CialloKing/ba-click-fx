# ba-click-fx

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)

网页版《蔚蓝档案》(Blue Archive) 点击与拖拽特效，基于 120fps 视频逐帧校准，纯 Canvas 2D 实现，零外部资源依赖。

（本项目纯AI生成，绝无手写代码）

**在线演示：**[ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

---

## 目录

- [快速开始](#快速开始)
- [三种使用方式](#三种使用方式)
  - [npm 安装](#1-npm-安装)
  - [CDN 引入](#2-cdn-引入)
  - [直接下载](#3-直接下载)
- [API 文档](#api-文档)
- [效果说明](#效果说明)
- [项目结构](#项目结构)
- [部署](#部署)
- [致谢](#致谢)
- [许可](#许可)

---

## 快速开始

> 只想看效果？打开 [在线演示](https://ba-click-fx.cialloking.top) 随便点击、拖拽即可。

---

## 三种使用方式

### 1. npm 安装

```bash
npm install ba-click-fx
```

```js
import { BASpark } from 'ba-click-fx';

const spark = new BASpark();

// 可选：自定义配置
const spark = new BASpark({
  color: [105, 161, 255],
  scale: 1.1,
  opacity: 0.5,
});
```

### 2. CDN 引入

一行 `<script>` 标签即可，无需构建工具：

```html
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1/dist/ba-click-fx.iife.js"></script>
<script>
  const spark = new BASpark();
</script>
```

### 3. 直接下载

从 [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases) 下载 `dist/` 目录中的文件，适合静态站点：

```html
<canvas id="myCanvas"></canvas>
<script type="module">
  import { BASpark } from './ba-click-fx.js';
  const spark = new BASpark({ target: '#myCanvas' });
</script>
```

---

## API 文档

### 构造函数

```ts
new BASpark(options?: BASparkOptions)
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
| `setTrailSpeedDecay(d)` | 速度衰减率 (0.8~0.999) | `0.988` |

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

## 项目结构

```
ba-click-fx/
├── src/
│   ├── ba-spark.js      # 特效引擎（BASpark 类）
│   ├── main.js           # 演示页面入口 + 控制面板 UI
│   ├── config.js         # 所有可调参数（~190 个变量）
│   ├── draw.js           # 绘图工具函数
│   ├── utils.js          # 纯数学工具
│   ├── style.css         # 演示页样式
│   └── ba-click-fx.d.ts  # TypeScript 声明
├── index.html            # 演示页面
├── dist/                 # 构建输出
│   ├── index.html        # 演示页
│   ├── ba-click-fx.js    # ESM 库 (~42KB)
│   ├── ba-click-fx.cjs   # CommonJS (~35KB)
│   ├── ba-click-fx.iife  # IIFE CDN (~35KB)
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

## 部署

### Cloudflare Pages（推荐）

1. Dashboard → Workers & Pages → Pages → 连接 Git
2. 选 `CialloKing/ba-click-fx`，构建命令 `npm run build`，输出目录 `dist`
3. 保存部署后绑定自定义域名

### 其他平台

`dist/` 目录是纯静态文件，可部署到任意静态托管（GitHub Pages、Netlify、Vercel、Nginx 等）。

---

## 致谢

- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark) — 蔚蓝档案点击特效早期 Web 实现
- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor) — 蔚蓝档案光标特效实现

本项目基于 120fps 录屏逐帧校准，从 Unity 原始 Prefab 结构映射到 Canvas 2D。

---

## 许可

MIT
