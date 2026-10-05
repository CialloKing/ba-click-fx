# Unity 同状态视觉对照

本地专项需要 Unity 2021.3.45f1、现有捕获脚本及支持 WebGL2 的 Chrome/Edge。它不属于常规发布检查，也不要求 Unity 与网页像素误差为零。

```powershell
npm run compare:unity -- --project 'D:\WebProjects\BA鼠标输入与点击特效系统\UnityMouseFxLab\UnityMouseFxLab'
```

命令只复制 Assets、Packages、ProjectSettings 到临时工程，原工程目录在捕获前后计算 SHA-256。正常图形模式使用 D3D11，不使用 `-batchmode` 或 `-nographics`。输入、固定种子及 10 ms 步长记录在输出目录，捕获执行两轮并检查同步状态、BakeMesh 与原始 HDR 缓冲字节一致。粒子状态和图形缓冲均在同一次帧末捕获，拖尾由真实 PlayerLoop 推进及过期裁剪。

默认输出为 `test-results/unity-comparison-stage12`。已存在目录不会覆盖；使用 `--label <名称>`建立新采集，使用 `--reuse <输出目录>`重新执行网页对照，仍支持第十一阶段旧记录。退出异常判为执行失败，即使文件已经完整。WebGPU 只在设备不可用时标记跳过，实际渲染或回读错误会失败。

同状态比较直接提交采集的最终位置、尺寸、旋转、线性顶点色及溶解阈值，不重新随机或求值点击生命周期。默认圆环使用内嵌的原始 Cylinder002 64×1 模板，自定义采样继续程序生成。拖尾的原始点出生时间由输入顺序匹配，JS 独立计算裁切端点；BakeMesh 只用于验收。

`trail-input-v3-history` 增加每个 10 ms 帧的原始点、BakeMesh、Unity 实际时钟和释放时刻。`web-input` / `input-comparison.md` 使用公共手动指针 API 输入相同事件，由 JS 的生产时钟与更新函数自行计算轨迹，既不注入 Unity 点集，也不使用 BakeMesh 计算端点。释放后的头部宽度可以为零；有效性按整个几何是否退化判断，不能把零宽头部当作提前消失。

新采集用独立目录，例如 `--label fit-after --baseline test-results/unity-comparison-fit-before`。`--runtime-prefix /test-results/unity-fit-before-src/` 可重放冻结的旧源码。旧参考目录保留，前景指标按 Unity、旧版和新版的共同并集遮罩计算；同时记录分层 RGB 总量、有效旧端偏差和消失时刻。

使用默认拟合采集目录时，运行 `node scripts/report-unity-fit.mjs` 可生成阶段汇总，输出到 `test-results/unity-fit-stage1/`。阶段报告、指标 JSON 和对照图片只保留在本地，不提交 Git。

`comparison.json` 保存每层最大误差、MAE、RMSE、RGB 能量、输入核对信息及设备状态；`comparison.md`用于查看。中间层以线性 RGB 比较。最终层同时给出原始 Unity HDR 与网页 SDR 解码值的线性比较，以及夹取并编码参考值后的 SDR 显示域比较。前者保留 Unity 超出 1 的亮度，不用显示域夹取隐藏差异。诊断仅把输出附件换成浮点附件，不改 Shader。两种 API 的回读显式统一为 bottom-left；PNG 仅用于查看，差异图固定放大 16 倍，不自动对齐、缩放或改写基线。

原始参考数据为小端 RGBA Half gzip，网页为 RGBA Float32 gzip。`50_Camera_After_Transfer`保留在参考采集中用于检查宿主传输；网页对应最终层是 `40_Composite`。这些采集与完整 Unity 工程均不提交 Git。

重复轮使用两个独立图形进程，重置 Unity 绝对时钟；临时工程只建立一次，第二轮复用本次导入生成的缓存。若原 Prefab 的拖尾投影三角退化，报告记录 `referenceGeometry.visibleTriangles`、实际宽度及曲线求值；空参考图不能用于声称正常可见 Unity 拖尾的像素还原程度，也不会通过改变 Prefab 来隐藏问题。

第十二阶段使用 `trail-input-v2`：固定直线两端在 0、10 ms 输入，20 ms 释放；直角和折返在 0～140 ms 移动，150 ms 释放。手动 AddPosition 和原预览的移动实例/开启 emitting 使用相同输入，Prefab 与材质不变。`state.json` 记录驱动、输入、释放时间及实例/父级/相机矩阵，`trail-diagnostics.json` 记录两种驱动的点数、投影面积和 HDR 能量。正式网页对照只使用原预览驱动；起始可见采样的几何或 HDR 能量无效时命令失败，不把空图当作有效参考。

本机的两轮捕获确认：手动驱动仍退化，预览驱动生成正常可见并会过期的拖尾。说明此前空图来自捕获驱动差异；这不等于已定位 Unity 内部为何让手动驱动的宽度退化。第十一阶段旧数据保留，因输入版本不同，不直接比较两阶段的工作量或把旧空参考误差解释为正常拖尾误差。

## 已知差异

1.4.0 保留已验证的几何和寿命改进，同时明确以下未完成的 Unity 拟合目标。以下数据来自固定参考工程、1950×1097、DPR 1、黑底、SDR 的阶段对照，不能推广到其他设备或合成条件：

- 50 ms 点击的场景层误差与最终 RMSE 降低，但最终合成 MAE 相对拟合前上升约 41%，未达到“其他点击误差增幅 ≤5%”目标。
- 相同事件由 JS 自行推进时，410 ms 直角与折返拖尾的最终 RGB 总量仍低于 Unity，WebGL2 约 9%、WebGPU 约 6–8%；端点和消失时刻通过，并不代表整条拖尾像素一致。
- 上述结果未验证物理显示帧率、真实 HDR 显示或 GPU 显存；点击随机数、运动模拟与 Native 扩散也未在本轮完成逐像素拟合。

本次发布以源码定制构建为范围，不将这些拟合目标计为已完成。定制版使用与同配置完整版相同的实现，发布检查单独验证两者像素一致；这不等同于两者已与 Unity 完全一致。Unity 参考、视觉黄金数据及原有误差阈值未因定制构建而调整。
