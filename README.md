# ba-click-fx

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/CialloKing/ba-click-fx/actions/workflows/build.yml/badge.svg)](https://github.com/CialloKing/ba-click-fx/actions)

网页版《蔚蓝档案》(Blue Archive) 点击与拖拽特效，基于 120fps 视频逐帧校准，纯 Canvas 2D 实现，零外部资源依赖。

**在线演示：**[ba-click-fx.cialloking.top](https://ba-click-fx.cialloking.top)

## 目录

- [快速开始](#快速开始)
- [效果说明](#效果说明)
- [控制面板](#控制面板)
- [运行时 API](#运行时-api)
- [项目结构](#项目结构)
- [部署](#部署)
- [致谢](#致谢)
- [许可](#许可)

## 快速开始

```bash
npm install
npm run dev        # 启动开发服务器
npm run build      # 生产构建 → dist/
npm run preview    # 预览生产版本
```

在你自己的页面中引入：

```html
<canvas id="sparkCanvas"></canvas>
<script type="module" src="/src/main.js"></script>
```

Canvas 自动铺满窗口，`pointer-events: none` 不拦截页面交互。

## 效果说明

### 点击特效

| 元素 | 表现 | 120fps 时序 |
|---|---|---|
| 圆盘 | 白色闪光快速扩展为蓝色圆盘，2 帧达最大、12.5 帧消散 | 帧 0 → 帧 25 |
| 圆环 | 2 段高亮弧线，第 4 帧出现，弧长先增至 3/4 圆再逆时针缩至 1/6 圆，半径持续 ease-out 外扩 | 帧 4 → 帧 54 |
| 碎片 | 4 个三角粒子从圆盘边缘同时爆射、不旋转、从近 0 尺寸变大，脉冲闪烁 | 帧 3 出现 |

### 拖尾光轨

6 层叠加渲染，模拟 Unity TrailRenderer + ParticleSystem：

| 层 | 说明 |
|---|---|
| 暗轨线 | 残留在旧轨迹上的细蓝线 |
| 柔和外光 | 宽而淡的分段扩散光晕 |
| Ribbon 能量带 | 半透明带状材质 |
| 主蓝色轨迹 | 核心轨迹，宽度沿路径变细 |
| 中心高光 | 浅蓝高亮芯线 |
| 蓝白热点 | 最近一段弧线持续发亮 |

- 头部 3 层发光圆点
- 碎片按距离随机散布，间距为平均值而非固定值
- 速度映射宽度/长度，消散时间恒定
- 指数平滑过滤手抖微颤

## 控制面板

点击右上角 ⚙ 打开，共 **7 个分区、26 个控件**：

| 分区 | 控件 |
|---|---|
| 基础 | 主题颜色、全局缩放、透明度、最大 DPR、拖尾画质 |
| 速度 | 点击速度、拖拽速度 |
| 拖尾 | 启用/始终显示/基础宽度/轨迹长度/消散速度/平滑/亮度/偏白程度 |
| 发光 | 多层柔光、阴影发光、点击柔光 |
| 圆环 | 旋转速度、光晕强度、弧线宽度、透明度 |
| 碎片 | 间距、慢速概率、快速概率、大碎片概率、最大数量 |

设置自动保存到浏览器 localStorage，刷新不丢失。按 **B** 键在屏幕中央触发点击特效，底部提示栏可关闭。

## 运行时 API

`window.BASparkDemo` 暴露完整配置接口：

### 基础

| 方法 | 参数 | 范围 | 默认值 |
|---|---|---|---|
| `setColor(r,g,b)` | 主题颜色 | 0~255 | `92, 155, 255` |
| `setScale(s)` | 全局缩放 | 0.5~3 | `1.10` |
| `setOpacity(o)` | 圆盘/halo/碎片透明度 | 0.1~1 | `0.50` |
| `setSpeed(click,trail)` | 点击/拖拽速度 | 0.2~3 | `1.00, 1.05` |
| `setDpr(d)` | 设备像素比上限 | 1~2 | `1` |
| `setTrailRenderScale(s)` | 拖尾离屏画布缩放 | 0.5~1 | `1` |

### 发光

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setGlow(enabled)` | 阴影发光 (shadowBlur, 性能开销高) | `false` |
| `setFakeGlow(enabled)` | 多层柔光 | `true` |
| `setClickFakeGlow(enabled)` | 点击特效柔光 | `true` |

### 拖尾

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setTrail(enabled)` | 开关拖拽轨迹 | `true` |
| `setTrailAlways(enabled)` | 鼠标移动时始终显示 | `false` |
| `setTrailBrightness(alpha,whiteMix)` | 拖尾整体亮度与偏白程度 (0~1) | `0.96, 0.26` |
| `setTrailWidth(baseFast,baseSlow)` | 快速/慢速基础宽度 (0.5~6) | `1.18, 0.92` |
| `setTrailLength(slow,fast)` | 慢速/快速长度上限 | `900, 4200` |
| `setTrailLife(slow,fast)` | 轨迹消散速度 (帧, 60fps 基准) | `22, 22` |
| `setTrailDecay(tail,head,release)` | 尾部/头部/松手后消散倍率 | `1.28, 0.95, 1.18` |
| `setTrailSpeedDecay(d)` | 速度因子衰减率 (0.8~0.999) | `0.988` |
| `setTrailSpeedRange(min,max)` | 速度因子映射范围 (px/ms) | `0.035, 2.2` |
| `setTrailSampling(step,max)` | 输入采样间距与最大点数 | `0.85, 80` |
| `setTrailRenderSampling(step,max)` | 渲染重采样间距与最大点数 | `0.75, 2400` |
| `setTrailSmooth(f)` | 鼠标坐标指数平滑 (0~0.9) | `0.5` |
| `setTrailLayerAlpha(main,core,hot,glow,sGlow,rail)` | 6 层透明度独立调节 | `0.98,0.58,0.38,0.34,0.16,0.28` |

### 圆环

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setRingRotationSpeed(v)` | 旋转角速度 (0~0.05 rad/帧) | `0.008` |
| `setRingGlow(v)` | 光晕强度 emissionAlpha (0~1) | `0.35` |
| `setRingWidth(v)` | 弧线基础宽度 minW (0.3~3) | `0.9` |
| `setRingAlpha(v)` | 圆环透明度 (0.1~1) | `0.9` |

### 碎片

| 方法 | 说明 | 默认值 |
|---|---|---|
| `setMaxShards(n)` | 最大碎片数量 (0~200) | `30` |
| `setShardSpacing(d)` | 间距平均值 px (20~500) | `300` |
| `setShardChance(slow,fast)` | 慢速/快速额外概率 | `0.02, 0.12` |
| `setShardLargeChance(p)` | 大碎片概率 | `0.80` |
| `setMoveSparkChance(p)` | 移动时随机撒点概率 (0~0.05) | `0` |

### 工具

| 方法 | 说明 |
|---|---|
| `boom(x, y)` | 手动触发点击特效，默认屏幕中央 |
| `clearTrail()` | 清除所有拖尾轨迹 |
| `getConfig()` | 返回当前配置深拷贝 |
| `resetConfig()` | 恢复默认配置 |
| `saveSettings()` | 导出面板设置为 JSON 字符串 |
| `loadSettings(json)` | 导入 JSON 并立即应用 |
| `CONFIG` | 直接引用配置对象（只读推荐） |

## 项目结构

```
ba-click-fx/
├── src/
│   ├── main.js        # 动画循环、Canvas 渲染、事件处理、UI 绑定、API
│   ├── config.js       # 所有可调参数集中管理（~190 个变量）
│   ├── draw.js         # 绘图工具函数
│   ├── utils.js        # 纯数学工具（缓动、颜色、smoothstep 等）
│   └── style.css       # 演示页样式
├── index.html          # 演示页面 + 控制面板
├── dist/               # 生产构建输出（3 文件，~45KB）
├── vite.config.js      # Vite 配置 (target: es2020)
└── .github/workflows/  # CI 构建检查
```

### 架构特点

- **双层 Canvas**：主 Canvas 渲染点击特效，离屏 trailCanvas 独立渲染拖尾 → `lighter` 混合合成
- **对象池**：ClickWave 和 SparkParticle 回收复用，避免 GC 抖动
- **按需渲染**：无活跃特效时自动停止 `requestAnimationFrame`
- **60fps 基准**：所有帧数参数归一化到 60fps，运行时间隔缩放适配任意刷新率

## 部署

### Cloudflare Pages（推荐，免费）

1. Dashboard → Workers & Pages → Pages → 连接 Git
2. 选 `CialloKing/ba-click-fx`，构建命令 `npm run build`，输出目录 `dist`
3. 保存部署后绑定自定义域名

### 其他平台

`dist/` 目录是纯静态文件，可部署到任意静态托管（GitHub Pages、Netlify、Vercel、Nginx 等）。

## 致谢

- [DoomVoss/BASpark](https://github.com/DoomVoss/BASpark) — 蔚蓝档案点击特效早期 Web 实现
- [VanillaNahida/BA-Spark-Cursor](https://github.com/VanillaNahida/BA-Spark-Cursor) — 蔚蓝档案光标特效实现

本项目基于 120fps 录屏逐帧校准，从 Unity 原始 Prefab 结构映射到 Canvas 2D。

## 许可

MIT
