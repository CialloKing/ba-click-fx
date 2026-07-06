# ba-click-fx

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)

网页版《蔚蓝档案》(Blue Archive) 点击与拖拽特效，纯 Canvas 2D 实现，零外部资源依赖。

在线演示：[ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

## 快速开始

在页面中放置一个 `<canvas id="sparkCanvas"></canvas>` 元素，引入构建产物即可：

```html
<canvas id="sparkCanvas"></canvas>
<script type="module" src="/src/main.js"></script>
```

Canvas 会自动铺满窗口且不拦截鼠标事件（`pointer-events: none`）。

## 预览

```bash
npm install
npm run dev
```

构建生产版本：

```bash
npm run build
npm run preview
```

## 使用

页面引入 `#sparkCanvas` 画布元素，Canvas 设置 `pointer-events: none` 不拦截页面交互。右侧 **⚙ 控制面板** 可实时调节所有参数（自动保存到浏览器），按 **B** 键在屏幕中央触发点击特效。

## 效果说明

### 点击特效
- 白色闪光快速扩展为蓝色圆盘，约 25 帧后消失（120fps 基准）
- 2 段高亮弧线圆环，弧长先增长后逆时针缩减，圆环半径持续外扩
- 4 个三角碎片从圆盘边缘同时爆射，向外飞行且不旋转

### 拖拽光轨
- 6 层叠加轨迹：暗轨线 + 柔和外光 + Ribbon 能量带 + 主蓝色轨迹 + 中心高光 + 蓝白热点
- 头部有 3 层发光圆点，路径上按移动距离发射三角粒子
- 松开鼠标后轨迹从尾部向头部平滑消退

## 运行时 API

在浏览器控制台中可通过 `window.BASparkDemo` 实时调整参数：

### 基础

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setColor(r, g, b)` | 主题颜色 | `92, 155, 255` |
| `setScale(scale)` | 全局缩放 (0.5~3) | `1.10` |
| `setOpacity(opacity)` | 圆环除外的全局透明度 (0.1~1) | `0.50` |
| `setSpeed(clickSpeed, trailSpeed)` | 点击/拖拽动画速度 (0.2~3) | `1.00, 1.05` |
| `setDpr(maxDpr)` | 设备像素比上限 (1~2) | `1` |
| `setTrailRenderScale(value)` | 拖尾离屏画布缩放 (0.5~1) | `1` |

### 发光

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setGlow(enabled)` | 阴影发光 (性能开销较高) | `false` |
| `setFakeGlow(enabled)` | 多层柔光 | `true` |
| `setClickFakeGlow(enabled)` | 点击特效柔光 | `true` |

### 拖尾

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setTrail(enabled)` | 开关拖拽轨迹 | `true` |
| `setTrailAlways(enabled)` | 鼠标移动时始终显示 | `false` |
| `setTrailBrightness(alpha, whiteMix)` | 轨迹亮度与偏白程度 | `0.96, 0.26` |
| `setTrailWidth(baseFast)` | 轨迹基础宽度 (0.5~6) | `1.18` |
| `setTrailLength(slow)` | 轨迹长度 | `900` |
| `setTrailLife(lifeSlow)` | 轨迹消失速度 (帧数) | `22` |
| `setTrailSmooth(factor)` | 鼠标平滑 (0~0.9) | `0.5` |

### 圆环

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setRingRotationSpeed(value)` | 旋转速度 (0~0.05) | `0.008` |
| `setRingGlow(value)` | 光晕强度 (0~1) | `0.35` |
| `setRingWidth(value)` | 弧线宽度 (0.3~3) | `0.9` |
| `setRingAlpha(value)` | 圆环透明度 (0.1~1) | `0.9` |

### 碎片

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setMaxShards(count)` | 碎片最大数量 (0~200) | `30` |
| `setShardSpacing(distance)` | 碎片间距平均值 (px) | `300` |
| `setShardChance(slowProb, fastProb)` | 慢速/快速额外概率 | `0.02, 0.12` |
| `setShardLargeChance(prob)` | 大碎片概率 | `0.80` |

### 其他

| 方法 | 说明 |
|---|---|
| `boom(x, y)` | 手动触发一次点击特效 |
| `clearTrail()` | 清除所有轨迹 |
| `getConfig()` | 返回当前配置的深拷贝 |
| `resetConfig()` | 恢复所有配置为默认值 |
| `saveSettings()` | 导出面板设置为 JSON 字符串 |
| `loadSettings(json)` | 导入面板设置并立即应用 |

## 技术栈

- Vanilla JavaScript (ES Modules)
- Canvas 2D API
- Vite (开发服务器 & 构建)

## 致谢

本项目参考了以下项目并基于 120fps 视频逐帧校准：

- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark) — 蔚蓝档案点击特效的早期 Web 实现
- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor) — 蔚蓝档案光标特效实现

## 许可

MIT
