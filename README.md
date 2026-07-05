# ba-click-fx

网页版《蔚蓝档案》(Blue Archive) 点击与拖拽特效，纯 Canvas 2D 实现，零外部资源依赖。

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

## 效果说明

### 点击特效
- 蓝色实心圆从点击处向外扩散并渐隐
- 两段弧线围绕圆心旋转，颜色由白色过渡到主题蓝
- 4 个白色三角形粒子向四周爆射，带摩擦力和旋转

### 拖拽光轨
按住鼠标拖动时出现多层发光轨迹，由 5 层叠加混合的折线组成：轨道线、外发光、主轨迹（头粗尾细）、高光芯线。轨迹头部有发光点，路径上随机散落三角形碎片粒子。松开鼠标后轨迹从尾部向头部平滑消退。

## 运行时 API

在浏览器控制台中可通过 `window.BASparkDemo` 实时调整参数：

| 方法 | 说明 |
|---|---|
| `setColor(r, g, b)` | 修改主题颜色 |
| `setScale(scale)` | 全局缩放 |
| `setOpacity(opacity)` | 全局透明度 |
| `setSpeed(clickSpeed, trailSpeed)` | 点击/拖拽动画速度 |
| `setGlow(enabled)` | 启用真实发光 (shadowBlur) |
| `setFakeGlow(enabled)` | 启用伪发光（多层绘制） |
| `setTrail(enabled)` | 开关拖拽轨迹 |
| `setTrailBrightness(alpha, whiteMix)` | 轨迹亮度 |
| `setTrailWidth(baseFast, baseSlow)` | 轨迹宽度 |
| `setTrailLength(slow, fast)` | 轨迹长度 |
| `boom(x, y)` | 手动触发一次点击特效 |
| `clearTrail()` | 清除所有轨迹 |

按 **B** 键可在屏幕中央触发一次点击特效。

## 技术栈

- Vanilla JavaScript (ES Modules)
- Canvas 2D API
- Vite (开发服务器 & 构建)

## 许可

MIT
