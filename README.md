# ba-click-fx — Blue Archive Click Effect and Cursor Trail for Web

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)
[![npm version](https://img.shields.io/npm/v/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)
[![npm downloads](https://img.shields.io/npm/dm/ba-click-fx.svg)](https://www.npmjs.com/package/ba-click-fx)

> 📖 [English version](./README.en.md)

**从 Blue Archive Unity UI/FX_Touch 逐参数移植的网页点击特效与光标拖尾动画库。**

`ba-click-fx` 将游戏《蔚蓝档案》的 `FX_Touch.prefab` 中 ParticleSystem 和 TrailRenderer 的完整参数——颜色曲线、大小曲线、旋转速度、溶解阈值、HDR 强度、TrailRenderer 时间与宽度——逐项还原为纯 **Canvas 2D** 实现。零外部运行时依赖。

**在线演示：** [ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

<p align="center">
  <img src="./docs/assets/ba-click-fx-demo.gif" alt="demo" width="45%">
  &nbsp;&nbsp;
  <img src="./docs/assets/blue-archive-reference.gif" alt="game reference" width="45%">
</p>

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

不想写代码？直接从 [Chrome 应用商店安装 ba-click-fx-extension](https://chromewebstore.google.com/detail/clphaaacolnifhgmeblfeofapccgoami)，普通网页即可获得蔚蓝档案风格点击特效和光标拖尾。源代码：[ba-click-fx-extension](https://github.com/CialloKing/ba-click-fx-extension)。

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
<script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.0/dist/ba-click-fx.iife.js"></script>
<script>
  const fx = new BAClickFX.BAClickFX();
</script>
```

### 4. 直接下载

从 [GitHub Releases](https://github.com/CialloKing/ba-click-fx/releases) 下载构建产物，适合静态站点：

```html
<script type="module">
  import { BAClickFX } from './ba-click-fx.js';
  const fx = new BAClickFX();
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

## API

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

## 本地开发

```bash
git clone https://github.com/CialloKing/ba-click-fx.git
cd ba-click-fx
npm install
npm run dev
npm run build
npm test
```

---

## 效果说明

点击任意空白区域生成：

- **中心光盘** — 白色→蓝色渐变短圆盘，持续 200ms
- **溶解圆环** — 2 枚旋转环带，弧线从完整逐渐缩短至消失，持续 600ms
- **点击碎片** — 4 枚三角形粒子从点击位置飞溅，持续 600~700ms

按住拖动时：

- **拖尾轨迹** — 0.3 秒 TrailRenderer，渐变蓝色光轨 + Bloom 光晕
- **移动碎片** — 按距离间隔生成的三角形碎片

所有参数均从游戏 `FX_Touch.prefab` 的 Unity ParticleSystem / TrailRenderer 配置中逐项提取。

---

## 项目结构

```
src/
├── ba-spark.js    # 主引擎：ParticleSystem + TrailRenderer 生命周期
├── config.js      # Unity FX_Touch 粒子参数只读快照
├── main.js        # 演示页入口
└── style.css      # 演示页样式
dist/              # 构建产物（ESM / CJS / IIFE）
test/
└── smoke.js       # 48 项移植验证测试
```

---

## 本地开发

```bash
git clone https://github.com/CialloKing/ba-click-fx.git
cd ba-click-fx
npm install
npm run dev
npm run build
npm test
```

---

## 致谢

- 蔚蓝档案 (Blue Archive) 游戏 UI 特效为原始设计参考
- 粒子参数提取自国际服 `uiuserinteraction_fx` Bundle (2026-04-06)
- 参考 Unity 源码：FXTouch.cs、TouchEffectCreater.cs、InputWrapper.cs 等

---

## 许可

MIT
