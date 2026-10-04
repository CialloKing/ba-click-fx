# 第十一阶段验证记录

本轮建立 Unity 同状态分层对照，并在 Software 渲染器中复用滤波采样坐标。公共 API、类型、默认配置、Shader、滤波顺序、采样数量及 Canvas 读写保持不变；网页圆环继续使用 96×8 网格。新增提交保留本地，不推送、不发布版本。

## Unity 对照结果及限制

使用 Unity 2021.3.45f1，以正常 D3D11 图形模式运行隔离工程。原工程只读取 Assets、Packages、ProjectSettings；捕获前后目录内容 SHA-256 均为 `ab260b1605beb5b9616a62a46f26595be4a1b96d94c9d237ffae68441039f633`。未修改原 Prefab，也未提交完整工程或缓存。

1950×1097、DPR 1、正交半高 1、AA1、黑色背景和默认主题固定。点击采样为 50、100、120、130、250、450 ms；固定直线、直角和折返拖尾在 140、410 ms 采样。固定输入和种子，10 ms 时间步长。状态、BakeMesh、HDR 中间层及最终画面均在同一次帧末捕获。两个独立图形进程的状态、网格和原始浮点缓冲逐字节一致。

网页重放最终粒子状态及原始拖尾点，不重复应用生命周期曲线。WebGL2 与 Standard WebGPU 均实际执行，共 312 项分层对照，无设备跳过和控制台错误。清晰层、预过滤、降采样及上采样使用原始线性 RGB；最终层同时记录原始 Unity HDR/网页 SDR 解码值的线性误差和 SDR 显示域误差。PNG 只用于查看，差异固定放大 16 倍，无自动对齐或缩放。

点击最终画面存在可测量差异。以下为 WebGL2 的 SDR 显示域结果，RGB 范围为 0～1：

| 点击时刻 | 最大误差 | 全帧 RMSE | 网页相对参考的 RGB 能量变化 |
| --- | ---: | ---: | ---: |
| 50 ms | 0.447499 | 0.000394 | +0.040% |
| 100 ms | 0.537508 | 0.000492 | +0.160% |
| 120 ms | 0.505873 | 0.000741 | +0.280% |
| 130 ms | 0.505682 | 0.000582 | −0.072% |
| 250 ms | 0.818481 | 0.001029 | +0.244% |
| 450 ms | 0.729736 | 0.001084 | −2.072% |

大面积黑色会降低全帧 RMSE，不能据此忽略局部边缘误差。Unity 原圆环为 64×1，网页为 96×8，但这些记录尚不能证明网格是所有差异的唯一原因。本轮仅记录差异，没有修正网页视觉。

**拖尾对照存在参考限制：**原 Prefab 的实际拖尾宽度为 0.005，宽度曲线在 0、0.5、1 均求值得到 1，Alignment 为 Local；捕获的 BakeMesh 在画面平面上的非退化三角数量为 0，Unity 清晰层 RGB 为空。实际点集仍正确生成和过期：直线 2→0 点，直角及折返各 15→5 点。网页按同一原始点集生成可见拖尾，因此报告保留这一差异，不能将空参考图用于宣称正常可见 Unity 拖尾已经还原。几何退化已验证，具体原因尚未确认。

采集文件为 `test-results/unity-comparison-stage11-synchronized/`，其中 `comparison.json`、`comparison.md` 包含各层最大误差、MAE、RMSE、能量、参考几何、设备状态及对照图。以此目录作为验收数据，早期失败尝试不作为通过证据。使用方法见 [Unity 对照说明](unity-comparison.md)。

## Software 坐标复用

每个渲染器为预过滤、各级降采样/上采样和最终滤波保留固定位置的当前采样表，不保存历史尺寸组合。X/Y 表使用 Float64Array，存储随目标宽高之和增长；RGB 与 Coverage 共用相同依赖的表。实际源/目标尺寸或精确偏移变化后重建，布局变化及销毁时解除引用。准备失败清除有效标记，并执行原来的逐 tap 计算路径。

保留四个 tap 的顺序、原权重表达式及每次 Float32 累加。导出函数的签名保持原样，独立调用继续使用原路径。

独立计数运行使用 320×240、透明叠加、diffusion 7、20 个稳定帧：

| 工作量 | 优化前 | 优化后 |
| --- | ---: | ---: |
| RGB 双线性采样 | 4,267,680 | 4,267,680 |
| Coverage/传输标量采样 | 4,267,680 | 4,267,680 |
| 轴向坐标准备 | 17,070,720 | 0 |
| 新建采样表 | 0（原路径无表） | 0 |
| 采样表分配字节 | 0（原路径无表） | 0 |

优化后的冷帧建立 8 份表，进行 2,590 次轴向准备，分配 62,160 字节；稳定帧 160 次请求全部命中。diffusion 变为 7.125 时仅替换 4 份偏移相关表，其余 4 份命中；尺寸变化后 8 份表均更新。减少的是重复坐标计算，采样与滤波工作量没有减少。

## 字节一致性及性能记录

864 组 Float32 黄金数据保持原哈希 `0d2a3592f0fd100bc874b022133613d909443af31fe2c21eef389ae804f4a5ac`，准备路径与原独立路径的完整字节及采样次数一致。覆盖 RGB、Coverage、奇偶尺寸、单像素、HDR、不同偏移、局部范围、脏缓冲、超长输出及共享 ArrayBuffer 的交叠视图。

优化前后额外保存并比较 126 帧真实 Canvas 的完整 ImageData，逐字节一致。覆盖 Native/Software、点击/拖尾、默认及相对 OKLCH 主题、透明度、颜色补偿、连续帧和 Software 回读失败后的回退。原有染色、圆环黄金数据及浏览器像素阈值未修改。

Software 数值检查共 152 项，另覆盖稳定表身份、容量、精确偏移、同物理布局下的 DPR/diffusion 更新、多实例、分配失败及重复销毁。

正式性能测量保留 38 个场景、固定输入和逻辑时钟、三批校准、七轮测量。调用计数、正式耗时和 CPU 采样分别运行，GPU 完成等待在计时区间外。环境为 Windows、Node 24.16.0、Edge 149.0.4022.69、AMD Ryzen 9 7940H/780M，前后工作量一致。

耗时结果有升有降。例如 Software 透明叠加为 35.870→35.775 ms/操作，固定拖尾为 11.710→10.935 ms/操作，移动拖尾为 12.075→14.115 ms/操作。未改动的 Native 对照场景也出现波动；本轮不据此认定整体提速或固定比例收益，不换算 GPU 帧率。确定性的重复计算消除和输出一致性作为验收依据。

| 记录 | 文件 |
| --- | --- |
| 优化前正式记录 | `test-results/runtime-benchmark-stage11-before.json` |
| 优化后正式记录 | `test-results/runtime-benchmark-stage11-after.json` |
| 前后完整报告 | `test-results/runtime-comparison-stage11-before-stage11-after.md` |
| 独立 Software 诊断 | `test-results/runtime-software-stage11-before.json`、`runtime-software-stage11-after.json` |
| 独立 CPU 采样 | `test-results/runtime-software-stage11-before.cpuprofile`、`runtime-software-stage11-after.cpuprofile` |
| 完整 Float32/Canvas 字节 | `test-results/runtime-output-stage11-before.json`、`runtime-output-stage11-after.json` |

采集提交读取原记录：`v1.3.4-9-g0c063e2-dirty` → `v1.3.4-10-ga582c16-dirty`。运行时代码的 Git blob 为 `f30fb621999d0f6901da237a5c4f7815898b44e7` → `068e1da0ce5483bef9d086f29eead7a8614678fc`，不以报告生成时的 HEAD 替换采集版本。

## HDR 检查中发现的状态同步问题

首次完整发布检查在 HDR UI 亮度控件等待处失败。失败快照显示运行时已为 WebGPU Extended，而页面仍显示协商中并禁用控件。证据保存在 `test-results/stage11-release-first-failure/`、`stage11-check-release.log` 和退出码 1；未删除失败记录或增加重试。

尺寸或 HDR 配置更新可先解除 Canvas 配置，再于后续渲染帧恢复同一后端。后端名称没有改变时不会再次触发后端事件，原来的同步与 microtask 刷新无法覆盖此顺序。展示页现在在配置提交后合并一次帧后刷新，读取最新快照，不轮询、不强制启用控件、不改变超时。确定性测试补充了没有后端事件、暂停期间下一帧恢复 Extended 的情况；实际 WebGPU 专项检查的 8 个直接渲染场景及 HDR 状态转换已通过。

## 最终检查

最终 `npm run check:release` 退出码为 0，完整记录为 `test-results/stage11-check-release-final.log` 和 `stage11-check-release-final.exit`。运行前先构建发布产物；类型、tarball、运行时及文档同步检查均通过。

| 检查 | 结果 |
| --- | --- |
| Software 数值检查 | 152 项通过，含准备路径的 864 组字节对照 |
| FX_Touch 移植检查 | 400 项通过 |
| 浏览器 core | 1,109 项断言通过 |
| DedicatedWorker/OffscreenCanvas | 通过 |
| 浏览器 lifecycle | 1,553 项断言通过 |
| 浏览器 demo | 96 项断言通过 |
| 既有浏览器 Unity 参考 | 29 项断言通过 |
| WebGPU 浏览器矩阵 | 实际执行 8 个直接渲染场景，Standard/Extended、HDR 控件、模式切换及设备丢失通过 |
| 新增 Unity 本地专项 | 两轮同步状态/缓冲一致，312 项分层对照完成；视觉差异与退化拖尾参考限制如上 |
| 优化前后真实输出 | 864 组 Float32、126 帧 Canvas 完整字节一致 |

实际渲染错误未作为设备不可用跳过；未调整黄金数据、像素阈值或超时。Unity 本地专项不加入常规发布检查，不要求其他环境安装 Unity。
