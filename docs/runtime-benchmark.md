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
几何验收另覆盖首次使用、容量增长与复用、64 连发、已停用后端、动态存储归零及恢复画面，
WebGL2 同时核对 Buffer/VAO 身份保持，销毁后继续持有 Renderer 也不保留大数组。
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
在计时之外。逐项枚举中间目标容量、Uniform 数和绑定缓存，几何另记录 CPU 数组字节、
WebGL Buffer 存储大小和 WebGPU 登记的 Buffer 大小；这些容量均不等于进程内存或实际显存。
回收后首帧包含资源重建，旧版在相同空闲边界可能仍持有几何。构建耗时应使用
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

## 兼容内存与构建更新对照（2026-10-17）

独立基线为 `3cb106952041f51b382d380dafe5444e02f71f85`，修改前保存源码、完整/精简产物、
七项定制配置及哈希。完整入口使用 512² Trail / Zopfli，SHA-256 为
`03fd3b8cae1aaeac603be1efcaedbe5c49af2cb949998b092592ac2f7579bc61`。
基线保存在本地 `test-results/compat-memory-baseline-3cb1069/manifest.json`，对照前重新核验。
独立 GPU 验收 36 项通过，包含真实 Worker 与空闲释放/恢复画面对照。

| 容量口径 | 旧版 | 本轮 |
|---|---:|---:|
| GPU Renderer 初始五类 CPU 顶点数组 | 671,744 B | 0 B |
| 连发压力后空闲 CPU 几何（含索引/采样缓存） | 1,516,568 B | 0 B |
| 同场景空闲 WebGL2 动态 Buffer 存储 | 884,064 B | 0 B |
| 同场景空闲 WebGPU 动态 Buffer 登记容量 | 1,400,832 B | 0 B |

这些数值只描述夹具中受控资源的持有容量，不表示进程内存或实际显存下降同样的字节数。
普通 resize、短暂切换和可见暂停保持资源；30 秒边界、销毁及已停用后端分别验证。

性能采样使用 Windows、Edge 149.0.4022.69 无头模式、320×240、DPR=1。旧版/候选五轮交替，
每组预热 120 帧后记录 180 帧，固定随机数和逻辑时间；CPU 计时包括输入更新和提交，GPU 完成等待单独记录。
空闲恢复另采每组七次首帧及 140 个稳定帧。WebGPU 像素在当前帧提交后、异步让出之前读取，
避免展示纹理被提交到浏览器后失效；初次使用异步等待后的截图记录已废弃，修正后全部重新采样并通过哈希对照。

| 耗时中位数（ms，旧版 → 本轮） | WebGL2 | WebGPU |
|---|---:|---:|
| 初始化（每组一次，含设备就绪） | 24.9 → 24.2 | 276.3 → 269.2 |
| 连续混合交互 | 0.4 → 0.4 | 0.4 → 0.4 |
| 空闲恢复首帧 | 1.3 → 1.5 | 0.4 → 0.4 |
| 空闲恢复首帧 P95 | 1.8 → 2.2 | 0.6 → 0.7 |
| 恢复后的稳定帧 | 0.3 → 0.3 | 0.2 → 0.2 |

本机计时分辨率约 0.1 ms，初始化样本也较少；只记录成本，不据此宣称启动或帧率提升。
恢复首帧的额外重建是归还长期空闲容量的代价。

两项逐帧实验各自只改变一个实现，与已完成内存改动的代码比较。每项要求五轮至少四轮同向改善、
整体中位耗时改善至少 5%，且其他场景中位数和 P95 不退化超过 5%；计时受限或结果不稳定时不合入。
下表的“改善轮数”按各轮中位数计算；未超过浮点舍入差异的变化视为相同。

| 独立实验 | 后端/场景 | 中位数 ms（原 → 实验） | P95 ms（原 → 实验） | 改善轮数 |
|---|---|---:|---:|---:|
| 按容量分配并上传有效区间 | WebGL2/点击 | 0.3 → 0.3 | 0.6 → 0.5 | 1/5 |
| 同上 | WebGL2/连续拖尾 | 0.4 → 0.3 | 0.6 → 0.6 | 2/5 |
| 同上 | WebGL2/64 连发 | 0.7 → 0.8 | 1.1 → 1.2 | 2/5 |
| 跳过已空备用 Canvas 清屏 | WebGL2/点击 | 0.3 → 0.3 | 0.6 → 0.5 | 1/5 |
| 同上 | WebGL2/连续拖尾 | 0.3 → 0.3 | 0.6 → 0.6 | 1/5 |
| 同上 | WebGL2/64 连发 | 0.7 → 0.7 | 1.2 → 1.1 | 1/5 |
| 同上 | WebGPU/点击 | 0.3 → 0.2 | 0.4 → 0.4 | 3/5 |
| 同上 | WebGPU/连续拖尾 | 0.4 → 0.4 | 0.5 → 0.5 | 0/5 |
| 同上 | WebGPU/64 连发 | 0.6 → 0.6 | 0.8 → 0.8 | 0/5 |

两项均不合入。上传实验的连发中位数/P95 退化约 14.3%/9.1%，且改善轮数不足；清屏实验也没有
四轮同向改善。0.1 ms 的计时分辨率进一步限制了小差异的可信度。正式代码保留原上传和清屏路径，
未改变 Shader、采样密度、纹理精度、公开 API、类型、默认参数或同步构造。
本地 `test-results/compat-perf/` 保留三组原始样本、源文件哈希及汇总；准备和运行脚本为
`test-results/compat-perf-prepare.mjs`、`test-results/compat-perf.mjs`。这些实验不加入默认发布门禁。

本轮完整 `npm run check:release` 通过，共 79 次定制配置构建、35 次缓存复用，
定制构建累计 123.6 秒，包含主构建、静态检查和全部浏览器验收的编排耗时 464.6 秒。
这些计数来自本轮实际执行，包含原先已有的定制检查内部复用，不将全部 35 次归因于本轮改动；
未运行旧编排的同条件全量计时，因此不报告发布总耗时的提升比例。完整版主构建及精简版独立参考
构建不计入这组定制缓存次数，耗时已包含在总计中。报告保存在
`test-results/release-browser/results.json`；独立命令仍可运行，导入专项不会执行测试或读取宿主参数。
