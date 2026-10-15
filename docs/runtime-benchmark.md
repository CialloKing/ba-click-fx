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
共用 `limitCanvasAlpha` 保留回读与失败语义；Software 区域调用在上限为 255、
且上下文明确启用 `willReadFrequently` 时跳过。默认 Canvas 保留原回读：移除它会
改变浏览器栅格路径及 RGB 舍入，普通上下文也纳入独立像素和行为验收。
默认上限为 `250/255`，区域限制仍执行；Software 已完成 Alpha 且无需颜色补偿时，
整帧收尾省去一次重复回读，既有默认诊断场景从每帧 5 次降为 4 次。

零强度 Software 保留回读、预过滤及活动范围判定，只跳过后续 RGB/Coverage
金字塔、最终滤波、边缘修正与编码。单层沿用预过滤边界，多层沿用整层边界，
透明输出继续按原顺序写回、绘制及限制 Alpha；直接省掉整段流程会改变
DPR=2 的 visual-max 像素，因此本轮不以进一步减少回读作为收益。

GPU 优化专项复用定制浏览器夹具，检查零强度滤波、恢复强度、透明合成与纹理生命周期，
以及 fractional diffusion、层数边界、尺寸/DPR、1×1 和目标释放后的布局复用：

专项使用非默认点击发光倍率，覆盖完整 WebGL2、WebGPU 与 WebGL2 Bloom。
零强度不创建或重绘专用发光场景；已经分配的目标保留，恢复正数继续复用。
首次使用即为零、直接 Renderer 未传内部标志及固定零强度定制版分别检查。

Coverage 与 Bloom 金字塔按当前合成路径和有效强度分别分配；测试覆盖首次零强度、
恢复正数、再次归零、合成模式切换、参考背景及 WebGL 上下文恢复，已分配的可选目标
在布局有效时继续复用。GPU 空闲专项使用受控定时器验证每实例一次性的 30 秒边界、
交互取消、多实例隔离、可见暂停、clear/destroy、失败状态保留及回收后首帧重建。
完整版与三种 GPU 定制版均执行，另在真实 WebGL2/WebGPU Worker 中验证。

```sh
npm run test:browser:gpu-optimization
# 性能采样独立运行，不进入发布门禁；目录需包含已核验的旧版 JS 和 manifest.json。
npm run test:browser:gpu-optimization -- --benchmark --baseline=test-results/gpu-optimization-baseline-v1.3.12
```

结果与显式性能采样分别写入 `test-results/gpu-optimization/results.json` 和 `benchmark.json`。
`--baseline` 会核对清单中的 SHA-256，并在独立浏览器上下文中逐字节对照旧版输出；
普通 CI 不依赖本地旧文件，仍运行现有像素基线与本专项的路由、资源和生命周期断言。

独立基准清单还可包含五种 GPU 定制配置的 `custom` 记录（`backend`、`runtime`、
`input`、`path`、`sha256`）；测试先核对旧文件哈希及归一化配置，再比较生命周期画面。
GPU 性能结果另记录七轮空闲后首帧和 140 个稳定帧的 CPU 构建/提交耗时，GPU 完成等待
在计时之外。逐项枚举中间目标容量、Uniform 数和绑定缓存，不能把目标容量当作进程
显存读数；回收后首帧包含资源重建，旧版在相同空闲边界仍持有目标。构建耗时应使用
相同源码和压缩会话条件，分别运行旧构建流程与去重后的流程，并核对产物字节一致。

Software 专项复用相同场景，覆盖 Alpha 策略、颜色补偿、DPR、合成参考及回读失败；
使用受控定时器验证 30 秒空闲回收、恢复取消、暂停保持、clear/destroy、重建像素与真实 Worker。
完整版和 Software 定制版均执行缓存验收，不实际等待 30 秒。

```sh
npm run test:browser:software-optimization
npm run test:browser:software-optimization -- --baseline=test-results/software-optimization-baseline
# 独立性能采样使用默认 Canvas 光栅路径，像素验收固定频繁回读上下文。
npm run test:browser:software-optimization -- --benchmark --baseline=test-results/software-optimization-baseline
```

验收和性能分别写入 `test-results/software-optimization/results.json` 与 `benchmark.json`。
独立基准目录的 `manifest.json` 记录提交、版本及主入口/Worker 的字节数和 SHA-256；
对照前核验哈希，避免把本次重建的产物当作旧版。

缓存容量按实例持有的 ArrayBuffer 字节数、工作 Canvas 像素数及辅助缓冲分别记录，
解除引用不等同于浏览器立即降低进程内存。显式性能运行保留 90 帧混合交互样本，
另记录七轮 clear 后首帧和每轮 20 个稳定帧的耗时与分配次数；首帧包括同步资源重建。


移动拖尾专项复用浏览器夹具，覆盖完整 WebGL2、WebGPU、WebGL2 Bloom、Native、Software，
以及完整与定制 GPU Worker。测试持续移动、部分裁切、暂停、主题/端帽/缩放变化及完全过期，
统计首次 60 帧的不同工作对象；预热至 240 帧后，检查后续 120 帧的工作容量不再增长。
计数针对受控工作数组、网格段、GPU 点样本及边界点，不代表整个运行时没有分配。

```sh
npm run test:browser:trail-work
npm run test:browser:trail-work -- --baseline=test-results/round2-baseline-7929389
# 采样独立运行；五轮交替顺序，预热 360 帧后测量 600 帧。
npm run test:browser:trail-work -- --benchmark --baseline=test-results/round2-baseline-7929389
```

结果分别写入 `test-results/trail-work/results.json` 与 `benchmark.json`。基线目录使用前先验证
主入口和相关定制产物的 SHA-256，不用候选构建覆盖旧文件。计时包含输入更新与同步帧构建/提交，
不遍历工作对象；每帧在计时外等待 GPU 完成，避免批量提交积压。GC 记录来自 Chromium trace 的同渲染进程 MinorGC/MajorGC 事件，报告保留原始
帧耗时、GC 事件及可用的堆快照读数。跟踪开销对两组相同，数据不代表 GPU 完成时间或显示帧率。
保留容量用有效点数、距离/样本槽位与网格数表示；堆读数不等于工作区大小，也不等于物理显存。
