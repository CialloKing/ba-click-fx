# Unity 固定 UI Pass 真值与验证合同

本文固定 `ba-click-fx` 的 Unity 外部资源证据优先级、投影换算和粒子数量合同。凡是修改 `src/config.js` 中的 Unity 参数、粒子创建逻辑、画布高度换算或任一渲染后端，都必须先执行本文的资源审计和跨后端数量断言。

## 唯一基线

当前固定 UI Pass 的唯一权威基线是：

```text
D:\WebProjects\BA鼠标输入与点击特效系统\UnityMouseFxLab\UnityMouseFxLab
```

该工程同时保存新版游戏资源、固定 UI Pass 实现、预览捕获代码和可直接打开的基线场景。投影证据必须彼此一致：

| 证据 | 已确认值 | 含义 |
|---|---:|---|
| `BaGameBloomRendererFeature.cs` | `Matrix4x4.Ortho(-aspect, aspect, -1, 1, 0.1, 20)` | 固定 UI Pass 的垂直范围为 `[-1, 1]` |
| `BaFxTouchPreviewCapture.cs` | `CaptureOrthographicSize = 1.0` | 捕获路径使用同一正交高度 |
| `BundleBaseline.unity` | `orthographic size: 1` | 可直接预览场景使用同一相机尺度 |

Unity 的 `orthographicSize` 是相机垂直范围的一半，因此 `bottom = -1`、`top = 1` 与 `orthographicSize = 1.0` 是同一投影合同。网页端从世界单位换算到参考像素时，必须以这个高度为准。

旧工程：

```text
D:\WebProjects\BA鼠标输入与点击特效系统\提取资产2\BA_FX_Touch_UnityProject
```

其中场景相机的 `orthographic size: 1.35` 只是较早的预览相机参数。它不是新版固定 UI Pass 的候选值，不能凭目录时间、截图观感或旧打包文件覆盖 `UnityMouseFxLab` 的机器码和资源审计证据。旧工程可以用于追溯历史，但不能用于裁决新版投影尺度。

## Prefab 数量真值

`UnityMouseFxLab` 中的 `FX_Touch.prefab` 固定以下数量合同：

| 运行时对象 | Prefab 真值 | 网页端合同 |
|---|---:|---|
| 溶解圆环 | 2 | 单次点击创建 2 个圆环 |
| 点击碎片 | 4 | 单次点击创建 4 个点击碎片 |
| 拖尾碎片 | 每次按下实例最多 50 | 足够长的单次拖尾在 50 个碎片处截断 |

`50` 是每次按下产生的单个拖尾实例上限。点击碎片和先前按下留下的实例不占用该实例的 50 个名额，不能用某一帧的全局碎片总数替代这个合同。

## 可重复资源审计

在判断网页参数是否偏离 Unity 之前，先从工程根目录执行：

```powershell
npm run verify:unity-reference -- --project "D:\WebProjects\BA鼠标输入与点击特效系统\UnityMouseFxLab\UnityMouseFxLab"
```

该命令直接读取 Unity 序列化资源和固定 UI Pass 源码，并与 `UNITY_FX_TOUCH` 比较。审计至少覆盖：

- 捕获脚本、基线场景和固定 UI Pass 的 `Ortho 1.0` 一致性；
- `FX_Touch.prefab` 的 2 个圆环、4 个点击碎片和 50 个拖尾碎片上限；
- 网页与 Unity 共用的尺寸、寿命、速度、拖尾和 Bloom 参数。

审计输出会明确标记 `UnityMouseFxLab` 为新版基线，并把旧 `提取资产2` 的 `1.35` 标记为排除的历史预览值。审计失败时，应先确认读取的工程、资源版本和证据链，不能直接修改网页常量让比较重新通过。

## 跨后端数量断言

资源审计通过后，再构建并运行浏览器后端矩阵：

```powershell
npm run build
npm run test:browser:built
npm run test:browser:webgpu:optional
```

标准数量夹具在 `full-webgl2`、`webgl2-bloom`、`software-bloom`、`native` 和 `legacy` 中使用同一输入，并精确断言：

- 配置仍为 2 个圆环、4 个点击碎片、拖尾上限 50；
- 单次点击的运行时圆环和点击碎片数量与 Prefab 一致；
- 单个足够长的拖尾确实达到 50，并在该处封顶；
- 点击碎片与拖尾碎片的分类计数覆盖全部运行时碎片。

独立的 WebGPU 运行时门禁在 WebGPU 可用时验证同一合同，还会检查单个 owner 的实际计数和跟踪表均为 50，并确认点击与拖尾碎片合计生成 `(4 + 50) × 6 = 324` 个三角顶点。使用 `--optional` 只允许机器缺少可用 WebGPU 设备时跳过，不会放宽已成功启动 WebGPU 后的断言。

这些断言验证各后端消费同一份 Prefab 数量真值。生命周期、透明合成和像素基线测试仍有各自职责，不能替代数量合同。

## 偏差处理规则

验证顺序必须保持为：Unity 外部资源审计、跨后端数量断言、视觉诊断。

1. 资源审计失败：先检查 Unity 工程路径、资源版本和新版证据，确认游戏资源确实变化后再更新网页基线。
2. 资源审计通过但数量断言失败：修复粒子创建、实例归属、生命周期或后端路由，不改 Prefab 真值。
3. 两类断言均通过但观感异常：检查投影到像素的换算、Canvas 高度、DPR、采样时刻、颜色空间、宿主合成和 Bloom；不能仅凭截图把 `1.0` 改回 `1.35`，也不能修改 `2 / 4 / 50` 迎合现象。
4. 只有新的游戏版本提供了可复核的机器码和序列化资源证据时，才允许修改这些真值；同一变更必须同步更新资源审计、跨后端断言和本文。

浏览器像素基线只能说明网页输出是否变化，不能证明 Unity 数值发生变化。在外部资源审计和数量断言没有暴露偏差时，禁止通过重标定截图、放宽断言或改写 Unity 常量来制造“修复”。
