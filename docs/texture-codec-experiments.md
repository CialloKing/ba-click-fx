# 纹理无损压缩算法实验

[English](texture-codec-experiments.en.md)

这组实验比较正式完整版与固定配置 WebGL2 / 128² 精简版的纹理编码。两组分别保持原来的分辨率、参数、功能和像素字节；所有体积包含所需解码器。实验脚本独立于正常构建和 Release 流程，正式 profile 仍使用原有编码选项。

## 复现

使用项目要求的 Node.js 24 或更高版本、`npm ci` 和项目可以检测到的 Chromium：

```sh
# 构建、八类资源字节校验、浏览器画面与生命周期验收
npm run experiment:codecs

# 同一验收加冷导入、初始化和纯解码计时
npm run experiment:codecs -- --benchmark

# 只构建和校验资源；筛选方案时自动保留相应发布版本的对照
npm run experiment:codecs -- --build-only --edition=full --codec=zstd
```

`--edition` 接受 `full`、`slim`；`--codec` 接受 `original`、`deflate`、`zopfli`、`brotli`、`zstd`。`original` 只用于完整版对照。

每次重新构建所选产物，不复用上次运行的成功状态。输出位于 `test-results/codec-experiments/`：`results.json`、`report.md`、`browser-results.json`，以及各版本的 `ba-click-fx.js`、`build-info.json`、校验模块、四个时刻的 PNG 和差异图。校验模块和报告不是部署资源，不计入 JS 体积。

## 方法

正式的 Paeth、Circle 对称/RLE、Ring3 预测/4-bit 残差和网格序列化直接复用。实验只替换六个数据块的外层压缩：拖尾 RGB、Coverage、Circle RLE、Ring3 Alpha、圆环顶点和索引。三角纹理维持当前编码。

为保持编码器对照口径，实验显式保留 Trail RGB 和 Coverage 两份审计资产，不启用正式 512² GPU 构建的 Coverage 重建。以下历史数据也采用双资产布局；实验体积不能直接当作当前发布包体，推导收益须在同编码、同配置下另行比较。

| 方案 | 构建压缩 | 运行时同步解码 |
|---|---|---|
| `original` | 完整版当前 LZ4 和其他资源原编码 | 当前资源解码器 |
| `deflate` | Node DEFLATE raw，等级 9 | fflate 0.8.3 |
| `zopfli` | @gfx/zopfli 1.0.15，15 次迭代，仍输出 DEFLATE raw | fflate 0.8.3 |
| `brotli` | Node Brotli，质量 11 | brotli 2.1.0 的 JS 解码器 |
| `zstd` | Node Zstandard，等级 22 | fzstd 0.1.1 |

Zopfli 的 WebAssembly 只在构建端使用。正常运行在模块导入时解码资源，解码后的数组供渲染器复用；纯解码基准的重复执行只是测量方法。

## 2026-10-12 实测

源码基础为 v1.3.11；Node 24.16.0，Windows，本机 Chromium 149.0.4022.69。两组对照 JS 均与 v1.3.11 发布附件逐字节相同。KiB 为 1024 字节，gzip/Brotli 列是整个 JS 的传输压缩大小。

| 产物 | 编码 | JS raw KiB | gzip KiB | Brotli KiB |
|---|---|---:|---:|---:|
| 完整版 | 当前原编码 | 655.8 | 248.5 | 217.3 |
| 完整版 | DEFLATE | 518.6 | 195.3 | 170.6 |
| 完整版 | Zopfli | 505.3 | 185.3 | 160.7 |
| 完整版 | Brotli JS | 588.4 | 235.9 | 209.8 |
| 完整版 | Zstandard | 506.9 | 184.5 | 159.7 |
| 精简版 | 当前 DEFLATE | 193.9 | 78.6 | 70.0 |
| 精简版 | Zopfli | 190.7 | 76.2 | 67.5 |
| 精简版 | Brotli JS | 272.8 | 131.9 | 121.1 |
| 精简版 | Zstandard | 194.4 | 77.9 | 69.2 |

| 产物 | 编码 | 六块纯解码 median / p95 ms | 冷导入 median ms |
|---|---|---:|---:|
| 完整版 | 当前原编码 | 未单独测量 | 136.7 |
| 完整版 | DEFLATE | 9.3 / 11.8 | 139.4 |
| 完整版 | Zopfli | 8.3 / 10.0 | 155.1 |
| 完整版 | Brotli JS | 9.7 / 13.2 | 243.2 |
| 完整版 | Zstandard | 4.5 / 5.5 | 246.2 |
| 精简版 | 当前 DEFLATE | 2.3 / 2.9 | 56.7 |
| 精简版 | Zopfli | 2.2 / 3.1 | 51.5 |
| 精简版 | Brotli JS | 3.9 / 5.8 | 86.8 |
| 精简版 | Zstandard | 1.5 / 1.7 | 60.9 |

纯解码先预热五轮，再采样 25 轮；排除 Base64、Paeth 还原、网络和 GPU 上传。冷导入及初始化各取三个独立浏览器上下文，冷导入包含本地服务器请求、解析和完整资源初始化。两者不能混用为同一个性能指标；样本只描述本机无头浏览器，尤其不能据此保证各设备的启动速度排名。原始 JSON 保留启动计时的最小值、中位数和最大值。

## 验收与结论

9 个构建的八类资源共 72 项字节校验通过，包含两组拖尾、Circle、Ring3、三角 RGBA/Coverage 和网格浮点/索引位模式。36 个 WebGL2 场景覆盖早期、晚期、连续拖尾和合成参考，均与各自对照逐字节一致。精简版四种方案还通过初始化失败、上下文恢复、输入、多实例、暂停、尺寸/DPR 和重复销毁检查；原有 `test:browser:slim` 也通过。

完整版保留全部后端，但这次实际画面对照只运行 WebGL2；其他后端没有新增浏览器画面验收。GPU 显存、真实显示帧率和物理 HDR 不在本次测量范围。

Zopfli 是适合进一步集成的候选：完整版 raw 降低约 23%，gzip 降低约 25%；精简版 raw 减少 3312 字节，而且沿用现有同步解码器。Zstandard 在完整版的传输大小和纯解码上略有优势，但本次冷导入较慢，进一步集成前应复测。Brotli 数据本身较小，所测试 JS 解码器的成本使其整包收益不足，精简版更明显。

本机 `DecompressionStream` 支持 `deflate-raw`，不支持 `brotli` 或 `zstd`；本次没有把异步原生解码方案算作已通过的候选。更换压缩算法也不会降低解压后纹理数组和 GPU 纹理的大小。
