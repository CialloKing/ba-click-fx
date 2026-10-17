# 核心模块职责

`fx.js` 保持公开入口，`engine-core.js` 负责实例构造、公开方法、宿主接入和帧调度。内部模块的导出仅用于源码协作，不增加 npm 导出路径或类型声明。

| 模块 | 职责 |
|---|---|
| `engine-math.js` | 数值、颜色插值、Hermite 曲线和区域边界计算 |
| `engine-render-state.js` | 当前主题、渐变能量和本帧圆环采样缓存的共享作用域 |
| `engine-materials.js` | 主题映射、线性能量、Canvas 编码和透明合成辅助计算 |
| `engine-canvas-textures.js` | 圆形/三角形纹理、染色工作区、LUT、轻量所有权和空闲回收 |
| `engine-canvas-primitives.js` | 圆盘、圆环、碎片、Hit 和 Flare 的 Canvas 绘制与采样 |
| `engine-particles.js` | ClickWave、ShardParticle 及碎片生成规则 |
| `engine-trail-geometry.js` | 拖尾长度、重复点、折返、网格连接和四项网格缓存 |
| `engine-trail.js` | 轨迹工作区、材质采样、Canvas 绘制和 GPU 几何提交 |
| `engine-effects.js` | 粒子生成、时间推进、集合更新和轨迹工作区管理 |
| `engine-render.js` | Software Bloom、GPU Scene、备用 Canvas、Alpha 收尾和故障回退 |

依赖从基础计算与状态流向材质/纹理、粒子/拖尾、绘制通道和入口。内部模块不反向导入入口。既有输入、后端、生命周期和配置层保持职责；继承链末端为 `ConfigRuntime → EffectRuntime → RenderRuntime → BAClickFX`。两个新增职责层没有构造函数，实例字段仍按原顺序在入口初始化，没有运行时方法注入。

## 共享状态与资源

- 帧入口和上下文丢失回退分别保存四个旧状态值，在原有 `finally` 位置恢复；普通帧不创建状态快照对象。同步重入恢复外层主题和采样缓存，异常恢复与 Canvas `restore()` 的先后顺序保持一致。
- Canvas 缓存只登记 `{ closed, visible }` 标记，不持有引擎实例。位图身份、失败标记、30 秒空闲窗口、可见暂停和最外层绘制结束后回收的规则不变。
- 拖尾工作区由所属轨迹持有。测量数组、网格池和四项网格缓存继续复用；仅嵌套帧临时隔离工作区，退出后释放临时数据并恢复外层数据。
- 动态 GPU/CPU 几何容量、扩容、回收和恢复路径没有调整。容量统计仅表示登记的存储容量，不代表进程内存或实际显存。

## 构建与诊断

`scripts/engine-module-list.js` 是定制编译器和诊断工具共用的显式清单。`engine-source.mjs` 静态展开函数和职责类，合并并检查导入名称，再执行现有常量替换、能力裁剪以及粒子类和 Renderer 方法可达性分析。完整版使用原生 ESM 依赖；发布构建仍输出自包含单文件。

`scripts/engine-fixture.js` 为需要计数或私有状态的探针创建隔离模块副本。同一副本图内每个内部模块只有一个身份，因此引擎与探针访问同一份缓存。Node 和浏览器/Worker 使用同一套依赖重写逻辑；探针不会进入发布产物。

日常运行 `npm run check:fast`，发布前运行 `npm run check:release`。模块边界检查、像素黄金数据、生命周期、故障、真实 Worker、功能裁剪、类型和许可证检查均保留。性能采样单独执行；本次拆分不改变 Shader、采样密度、纹理精度或公开行为，也不重新合入上一轮未通过门槛的上传/清屏实验。
