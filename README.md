# ba-click-fx

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

网页版《蔚蓝档案》(Blue Archive) 点击与拖拽特效，纯 Canvas 2D 实现，零外部资源依赖。

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

页面引入 `#sparkCanvas` 画布元素，Canvas 设置 `pointer-events: none` 不拦截页面交互，下方按钮/链接可正常点击。

右侧 **⚙ 控制面板** 可实时调节所有参数，按 **B** 键在屏幕中央触发点击特效。

## 效果说明

### 点击特效
- 蓝色实心圆从点击处向外扩散并渐隐
- 两段弧线围绕圆心旋转，颜色由白色过渡到主题蓝
- 4 个白色三角形粒子向四周爆射，带摩擦力和旋转

### 拖拽光轨
按住鼠标拖动时出现多层发光轨迹，由 5 层叠加混合的折线组成：轨道线、外发光、主轨迹（头粗尾细）、高光芯线。轨迹头部有发光点，路径上随机散落三角形碎片粒子。松开鼠标后轨迹从尾部向头部平滑消退。

## 运行时 API

在浏览器控制台中可通过 `window.BASparkDemo` 实时调整参数：

### 基础

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setColor(r, g, b)` | 主题颜色 | `24, 158, 255` |
| `setScale(scale)` | 全局缩放 (0.5~3) | `1.15` |
| `setOpacity(opacity)` | 全局透明度 (0.1~1) | `0.95` |
| `setSpeed(clickSpeed, trailSpeed)` | 点击/拖拽动画速度 (0.2~3) | `1.15, 1.05` |
| `setDpr(maxDpr)` | 设备像素比上限 (1~2) | `1` |
| `setTrailRenderScale(value)` | 拖尾离屏画布缩放 (0.5~1) | `1` |

### 发光

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setGlow(enabled)` | 阴影发光 (shadowBlur, 性能开销较高) | `false` |
| `setFakeGlow(enabled)` | 多层柔光（拖尾线段光晕） | `true` |
| `setClickFakeGlow(enabled)` | 点击特效柔光 | `false` |

### 拖尾

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setTrail(enabled)` | 开关拖拽轨迹 | `true` |
| `setTrailAlways(enabled)` | 鼠标移动时始终显示轨迹 | `false` |
| `setTrailBrightness(alpha, whiteMix)` | 轨迹亮度与偏白程度 | `0.96, 0.26` |
| `setTrailWidth(baseFast, baseSlow)` | 轨迹基础宽度 (0.5~6) | `1.00, 1.28` |
| `setTrailLength(slow, fast)` | 慢速/快速移动轨迹长度 | `260, 8000` |
| `setTrailLife(lifeSlow, lifeFast)` | 轨迹消散寿命（帧数） | `30, 30` |
| `setTrailDecay(tailDecayMul, headDecayMul, releaseDecayMul)` | 尾部/头部/松手后消散速度 | `1.85, 1.0, 1` |
| `setTrailSpeedDecay(value)` | 速度因子衰减率 (0.8~0.999) | `0.988` |
| `setTrailSpeedRange(speedMin, speedMax)` | 速度因子映射范围 (px/ms) | `0.035, 2.2` |
| `setTrailSampling(step, maxPoints)` | 输入采样间距与最大点数 | `0.85, 80` |
| `setTrailRenderSampling(step, maxPoints)` | 渲染重采样间距与最大点数 | `0.75, 2400` |
| `setTrailSmooth(factor)` | 鼠标坐标指数平滑 (0~0.9) | `0.5` |
| `setTrailLayerAlpha(main, core, hot, glow, softGlow, rail)` | 各层透明度 | `0.98~0.16` |

### 碎片

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setMaxShards(count)` | 碎片最大数量 (0~200) | `56` |
| `setShardSpacing(distance)` | 碎片生成间距 (px) | `112` |
| `setShardChance(slowProb, fastProb)` | 慢速/快速下碎片生成概率 | `0.28, 0.68` |
| `setShardLargeChance(prob)` | 大碎片概率 | `0.45` |
| `setMoveSparkChance(prob)` | 移动时随机撒点概率 | `0` |

### 其他

| 方法 | 说明 |
|---|---|
| `boom(x, y)` | 手动触发一次点击特效 |
| `clearTrail()` | 清除所有轨迹 |
| `getConfig()` | 返回当前配置的浅拷贝 |
| `resetConfig()` | 恢复所有配置为默认值 |

## 技术栈

- Vanilla JavaScript (ES Modules)
- Canvas 2D API
- Vite (开发服务器 & 构建)

## 致谢

本项目参考并改进了以下项目的部分代码：

- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark) — 蔚蓝档案点击特效的早期 Web 实现
- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor) — 蔚蓝档案光标特效实现

相较于上述项目，本项目对鼠标拖拽轨迹进行了优化，使其更贴合游戏内原始特效的表现。

## 许可

MIT
