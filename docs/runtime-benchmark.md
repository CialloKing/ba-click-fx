# 运行时性能记录

在同一机器和浏览器环境中分别运行：

```sh
npm run benchmark:runtime -- before
# 完成运行时修改后
npm run benchmark:runtime -- after
npm run benchmark:report -- test-results/runtime-benchmark-before.json test-results/runtime-benchmark-after.json
```

JSON、独立 Software 诊断、CPU Profile 和对比 Markdown 均保存在 `test-results`。
报告读取 JSON 内的采集提交，展开 GPU 子场景；只有显式跳过才标记跳过。
每轮操作数可能因校准而变化，独立计数保留自己的窗口，不能按计时轮数换算。
环境或实际工作量不一致、数据缺失或计时受限时，不报告提升比例。

计时使用固定随机数和逻辑时间，三批中位数校准、七轮正式测量。
GPU 完成等待位于计时之外；结果表示 CPU 构建和提交耗时，不表示真实 GPU 帧率。
带包装的分阶段诊断用于定位开销，不可替代无包装的正式计时。

Software 诊断保留六类回读用途，`finalFrameStages` 细分区域 Alpha 限制、
Software 收尾与整帧最终处理；各子类的次数、像素、字节、耗时和失败数与父类核对。
独立计数记录一个帧的有界 `trace`，相邻无参数路径绘制用 `calls` 合并，
矩形参数及图像尺寸保留在 `args`。超过容量由 `truncated` 和 `dropped` 显式标记。
诊断包含默认、圆角碎片、visual-max，以及 Alpha 上限为 1 的普通/颜色补偿场景。

采集期间不要编辑浏览器加载的文件：Vite 热更新会中断当前页面，使该次测量无效。

Alpha 上限量化为 255 时，字节图像可以省去回读后的 Alpha 扫描。
默认上限为 `250/255`，不会进入该快速路径；Canvas 读写次数仍保持原样。
因此验收关注扫描访问数和输出字节，不把默认场景的计时波动解释为此优化的收益。

GPU 优化专项复用定制浏览器夹具，检查零强度滤波、恢复强度、透明合成与纹理生命周期，
以及 fractional diffusion、层数边界、尺寸/DPR、1×1 和目标释放后的布局复用：

```sh
npm run test:browser:gpu-optimization
# 性能采样独立运行，不进入发布门禁；目录需包含已核验的旧版 JS 和 manifest.json。
npm run test:browser:gpu-optimization -- --benchmark --baseline=test-results/gpu-optimization-baseline-v1.3.12
```

结果与显式性能采样分别写入 `test-results/gpu-optimization/results.json` 和 `benchmark.json`。
`--baseline` 会核对清单中的 SHA-256，并在独立浏览器上下文中逐字节对照旧版输出；
普通 CI 不依赖本地旧文件，仍运行现有像素基线与本专项的路由、资源和生命周期断言。
