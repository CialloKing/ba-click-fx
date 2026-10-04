# Unity 同状态视觉对照

本地专项需要 Unity 2021.3.45f1、现有捕获脚本及支持 WebGL2 的 Chrome/Edge。它不属于常规发布检查，也不要求 Unity 与网页像素误差为零。

```powershell
npm run compare:unity -- --project 'D:\WebProjects\BA鼠标输入与点击特效系统\UnityMouseFxLab\UnityMouseFxLab'
```

命令只复制 Assets、Packages、ProjectSettings 到临时工程，原工程目录在捕获前后计算 SHA-256。正常图形模式使用 D3D11，不使用 `-batchmode` 或 `-nographics`。输入、固定种子及 10 ms 步长记录在输出目录，捕获执行两轮并检查同步状态、BakeMesh 与原始 HDR 缓冲字节一致。粒子状态和图形缓冲均在同一次帧末捕获，拖尾由真实 PlayerLoop 推进及过期裁剪。

默认输出为 `test-results/unity-comparison-stage11`。已存在目录不会覆盖；使用 `--label <名称>`建立新采集，使用 `--reuse <输出目录>`重新执行网页对照。退出异常判为执行失败，即使文件已经完整。WebGPU 只在设备不可用时标记跳过，实际渲染或回读错误会失败。

网页直接提交采集的最终位置、尺寸、旋转、线性顶点色及溶解阈值，不重新随机或求值生命周期。BakeMesh 用于核对状态和记录几何差异；网页保留当前 96×8 圆环，Unity 原网格为 64×1。拖尾使用采集的原始点集和当前网页材质及网格。

`comparison.json` 保存每层最大误差、MAE、RMSE、RGB 能量、输入核对信息及设备状态；`comparison.md`用于查看。中间层以线性 RGB 比较。最终层使用原网页 Shader 的 SDR 编码输出，Unity Composite 显式 sRGB 编码后比较，报告标明该域。诊断仅把输出附件换成浮点附件，不改 Shader。两种 API 的回读显式统一为 bottom-left；PNG 仅用于查看，差异图固定放大 16 倍，不自动对齐、缩放或改写基线。

原始参考数据为小端 RGBA Half gzip，网页为 RGBA Float32 gzip。`50_Camera_After_Transfer`保留在参考采集中用于检查宿主传输；网页对应最终层是 `40_Composite`。这些采集与完整 Unity 工程均不提交 Git。

重复轮使用两个独立图形进程，重置 Unity 绝对时钟；临时工程只建立一次，第二轮复用本次导入生成的缓存。若原 Prefab 的拖尾投影三角退化，报告记录 `referenceGeometry.visibleTriangles`、实际宽度及曲线求值；空参考图不能用于声称正常可见 Unity 拖尾的像素还原程度，也不会通过改变 Prefab 来隐藏问题。
