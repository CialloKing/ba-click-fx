# Changelog

## 未发布

- 将公共库与展示页的默认最大 DPR 从 `2` 调整为 `1`，降低高 DPR 移动设备上的 Canvas 填充、显存和 Bloom 开销；控制面板仍可按设备性能手动提高到 `3`。
- 展示页新增独立的 Native 拖尾辉光 Alpha 控件，不再与 Software Bloom 拖尾发射校准固定联动；旧版已保存的联动值会迁移为等效 Native Alpha。

## v1.2.28 — 补强移动端 closed Shadow 触摸仲裁

- 修复 PointerEvent 可用的移动浏览器在 closed Shadow 内触摸时，window 重定向的 `touchstart` 未及时阻止默认手势、随后触发 `pointercancel` 导致拖尾中断的问题；现在统一由真实 Shadow host 作用域完成 Touch 生命周期与手势仲裁。
- 增加真实 Edge 移动触摸回归，覆盖 PointerEvent/TouchEvent 两种事件顺序、closed Shadow 重定向、多指与 Touch-only fallback。

## v1.2.27 — Touch-only 移动端拖尾输入修复

- 支持仅提供 TouchEvent、`ontouchstart` 或触摸点能力而不提供 PointerEvent 的旧版移动浏览器/WebView；Touch 生命周期现在转换为统一的指针输入，拖尾可正常建立、采样、结束和取消。
- Touch-only fallback 保留 `inputFilter`、坐标、target、`pointerId` 与 `composedPath()` 合同，并在 `touchend`/`touchcancel`、失焦、暂停和销毁路径完整清理活动指针。
- DOM Pointer 生命周期改用 capture 监听，避免宿主控件停止冒泡后吞掉 `pointerdown`、`pointermove` 或终止事件；closed Shadow DOM 在真实 target 作用域内完成过滤。
- 增加 Touch-only 源码与构建后 IIFE 回归，覆盖 `none`、自动手势取消、监听销毁和移动端拖尾点数。

## v1.2.26 — 修复全屏滚动条坐标偏移

- 修复无 `target` 的全屏 fixed 覆盖层在传统滚动条槽存在时，`window.innerWidth` 与 Canvas CSS 盒子宽度不一致导致的 X 轴坐标偏移。
- 全屏实例现在按已挂载 Canvas 的实测 CSS rect 建立逻辑尺寸和 backing store；Canvas 暂不可测时仍回退到窗口尺寸。
- 增加源码、构建后 IIFE 及 DPR 1/2 的滚动条槽浏览器回归，覆盖 10px 槽宽与 backing store 尺寸合同。
- 修复移动端覆盖层因 `pointer-events: none` 导致 Canvas `touch-action` 不参与命中判定、滑动立即收到 `pointercancel` 而无法形成拖尾的问题；DOM 输入现在按 CSS `touch-action` 的方向/缩放策略在 capture 阶段仲裁原生手势，锁定手势方向并保持 `inputFilter`、target 与 Shadow DOM 作用域边界。
- 展示页与 README 的中英文常见问题补充移动端拖尾说明，明确“触摸行为”各选项与原生滚动、缩放及 `pointercancel` 的关系。
- 将 `pointerup` 与 `pointercancel` 生命周期监听提升到 capture，并按实际 Pointer 启动结果回填 Touch 仲裁，避免宿主阻断冒泡后下一次触摸无法建立拖尾。

## v1.2.25 — 输入采样模拟与感知主题颜色

- 新增 `inputSamplingRate` 和 `setInputSamplingRate(rateHz)` 宿主输入 API：`0` 表示不限频，`1..1000 Hz` 可模拟手机客户端低采样率下的多边形拖尾轨迹；采样时钟基于未缩放的真实输入时间，与 `trailTimeScale` 和渲染帧率正交。
- 展示页在宿主控制 API 中新增输入采样率滑块，覆盖不限频到 `1000 Hz`，使用固定四位纯数字输出，并同步双语文案、本地持久化与重置。
- 新增 `themeColorMode: 'hue-only' | 'relative-oklch'` 和 `setThemeColorMode()`；公共库默认保留旧版仅色相语义，展示页新用户使用推荐的相对 OKLCH 映射，旧颜色设置会安全迁移到兼容模式。
- 相对 OKLCH 会在 HDR/Bloom 之前保留色相、色度与感知明度的相对关系，默认游戏蓝严格恒等，低于 8-bit 的暗部能量保留到最终输出边界。
- 将暗色主题的 RGB 发射与未知背景 `source-over` Coverage 分离，防止暗色透明特效变成实心遮挡，同时不缩放 Scene、Screen/Plus-lighter 或 HDR 能量；Native、Software Bloom、WebGL2 与 WebGPU 均纳入默认恒等、暗色单调、纯黑透明和白底遮挡像素门禁。
- 调整展示页折叠栏默认状态，仅展开背景主题、显示、宿主控制 API 与通用参数；FAQ 的静态及双语运行时文案移除特定宿主名称。
- 中英文 README 新增 Windows 原生桌面测试版入口，并明确当前单主显示器、特效层与 SDR 路径等能力边界。

## v1.2.24 — WebGPU 普通模式

- 新增名为 `WebGPU` 的普通渲染模式：固定协商 Standard SDR Canvas，不请求 `toneMapping: extended` 或 `rgba16float` Canvas Surface，且不显示 HDR/实验标记；内部保留 `rgba16float` 线性 Scene 与 Unity MXFinalBloom 精度以维持效果一致，原 `WebGPU HDR（实验）` 模式保持兼容。
- 新增公开 `webgpuPreferHdr` 输出偏好，完成 Standard/HDR 运行时原子切换、Device 复用、Surface 重新配置、状态诊断、重置和持久化合同，同步 TypeScript 声明与中英文档。
- 补齐高级控制面板的公开参数接口与浏览器结构回归，收紧透明合成控件同步检查，并稳定高 DPR WebGL 像素夹具读回。
- 增加 WebGPU Standard 直接渲染、公共路由、双语标签、设置恢复、Device 丢失回退及 Standard → HDR 重新协商门禁。

## v1.2.23 — 展示页控制面板分组优化

- 将背景主题作为“显示”折叠栏下方的独立分组，并稳定面板标题的中英文映射。
- 重整点击特效、碎片、拖尾轨迹和 Bloom 参数归属，补齐 17 个公开碎片参数的调整、重置与持久化控件。
- 修正拖尾碎片上限默认值与碎片间距步进，并新增浏览器结构回归门禁，防止参数再次错分。

## v1.2.22 — 三角碎片圆角与展示交互修复

- 修复浅色背景下使用覆盖层颜色补偿 `bright-core` 时，点击特效高能核心异常偏白、偏亮的问题。
- HDR 显示映射区域默认折叠，仅在选择 WebGPU 模式后自动展开；后端状态刷新不会覆盖用户的手动折叠选择。
- 新增 `setTriangleRoundness(value)`、`shards.roundness` 和展示页圆角滑块，使用真实图集边界的直边与相切圆弧从原三角连续调整到同尺寸圆形，并重映射纹理以消除内部尖三角；点击、拖尾和现存粒子即时响应，并纳入 Schema 2 的校验与迁移合同。

## v1.2.21 — HDR UI 与 WebGPU 输出生命周期修复

- 展示页新增 CSS HDR UI 高光和 `1..16` 亮度控制；仅在主特效实际协商为 `rgba16float + toneMapping: extended`，且浏览器支持扩展 `color(srgb-linear ...)` 与 `dynamic-range-limit: no-limit` 时启用，不进入公共 API。
- UI 高光直接应用于标题、状态区、面板边缘和交互控件，不再创建第二个全屏 `rgba16float` Surface，也不经过会钳制扩展亮度的 CSS `plus-lighter`。
- 修复 WebGPU、WebGL2 往返切换时旧 HDR Surface 和公开输出状态残留，并补充 Device 复用、暂停恢复及后端回退浏览器门禁。
- 固定 120 ms 点击帧回归验证 UI HDR 亮度与特效 HDR 亮度保持隔离，不修改 Unity 参数、粒子状态或点击特效像素。

## v1.2.20 — WebGPU 真实 HDR 与高亮色相控制

- 新增完整 WebGPU 特效后端：使用 `rgba16float` Scene、多级 MXFinalBloom 和 `toneMapping: extended` 输出真实超白 HDR 高光；Extended Canvas 不可用时保留 WebGPU Standard SDR，设备不可用或丢失时回退完整 WebGL2。
- 新增 WebGPU HDR 展示校准 API 与控制面板：支持线性峰值、`0..32` 整体亮度、渐进白核和 `0..1` 高亮色相保持；这些选项仅作用于 Extended 最终展示，不修改 Unity 参数、粒子数量、几何或 Bloom 算法。
- 增加分层 HDR 诊断状态，分别报告实际特效后端、Canvas 输出模式、浏览器动态范围与最终 HDR 判断；只有 `resolvedWebGPUOutputMode === 'extended'` 才声明浏览器侧 HDR 已就绪。
- 新增宿主合成表面能力合同及请求值/解析值诊断；透明 WebView2、Electron 等窗口不能执行 DOM Screen/Add 时自动回退 `source-over`，避免将独立高 Alpha Add 载荷误送入普通窗口合成。
- Software Bloom 改为仅在调用方显式请求时启用，不再作为 WebGL2 或 WebGPU 失败后的自动回退，降低透明桌面和低性能设备的意外 CPU、内存开销。
- 对照解包 Unity 工程锁定跨后端数量与投影基线：每次点击保持 2 个圆环、4 个点击碎片，每个拖尾实例最多 50 个碎片；浏览器矩阵继续验证 WebGPU、WebGL2 与回退链不会改写这些游戏参数。

## v1.2.19 — Bloom 上采样纹理反接修复

- 修复 MXFinalBloom 反向金字塔的两张纹理角色接反：恢复游戏的“累计粗级按 `SampleScale` 四点扩散，再单点加入当前细级”顺序，并使用累计粗级的 `texelSize`；同步完整 WebGL2、WebGL2 Bloom、Software Bloom RGB 与透明 Coverage 传输链。
- 将含糊的 high/low mip 命名替换为 `accumulatedCoarse` / `currentFine`，加入粗级和细级非对称脉冲数值门禁及两份 WebGL2 绑定源码门禁，确保加法交换律和均匀场测试无法再次掩盖纹理反接。
- 依据权威 `UnityMouseFxLab` 的机器码审计与五级 Up 中间缓冲复核实现：正确式全通道 MAE 仅为半浮点量化级，反接式误差高出 `142–394` 倍；更新修复后的 Chromium 像素基线。
- 记录问题症状、旧 Unity 重建工程误导风险、修复步骤、EXR 数值证据和长期检查清单，详见 [Bloom 上采样纹理反接回归复盘](docs/bloom-upsample-order-regression.md)。

## v1.2.18 — Unity Bloom 曝光与亮底合成修复

- 修复 Bloom 强度被直接按 `1.7` 乘入 Final Pass 导致的约 13.6 倍过曝白块；与解包工程 `BaGameBloomRendererFeature.ConvertIntensity()` 保持一致，先将序列化曝光刻度换算为 `2^(Intensity / 10) - 1`，再交给 Shader 合成。完整原因、修复步骤和防回归清单见 [Bloom Intensity 13.6 倍过曝回归复盘](docs/bloom-intensity-regression.md)。
- 恢复 `Clamp` 与 `Threshold` 相同的 CPU `GammaToLinearSpace` 路径，并在换算后按 Shader `half` 上限截断；统一纯 WebGL2、WebGL2 Bloom 与软件 Bloom 的数值合同和浏览器像素基线。
- 为未知中高亮背景新增 `hostCompositing: 'screen'` 完整载荷合同，并将展示页“DOM Add（近似）”迁移到 Screen，使新增亮度随背景变亮自动收敛，修复 `plus-lighter` 在亮底过早饱和造成的白核与过亮光晕。
- 保留 `plus-lighter` 供已知黑色或暗色宿主使用，保留外部 Canvas 的样式所有权，并确保激活合成参考时恢复 `source-over`，避免重复混合。
- 增加亮底 DOM 合成像素矩阵、旧配置迁移与跨后端回归门禁；修复过程和长期维护规则见 [DOM Add 亮底过曝回归复盘](docs/dom-add-light-background-regression.md)。

## v1.2.17 — 外部 Canvas 宿主样式与透明合成稳定性

- 保留外部 Canvas 调用方对 `style.mixBlendMode` 的所有权；使用 `hostCompositing: 'plus-lighter'` 时继续输出完整 Add 载荷，不再静默改写宿主样式。
- 补充构造、运行时切换和销毁路径的外部 Canvas 样式回归，确保宿主 CSS、WebView 或原生 Add 合成可以独立接管最终显示。
- 通过完整源代码、打包和真实 Chromium 像素回归验证透明合成后端、DPR 与回退链在本版本保持稳定。

## v1.2.16 — 合成参考模式重构

- 以 `setCompositingReference(source, { fit: 'cover' })` 取代场景背景布尔开关；传入匹配当前页面的栅格参考可获得精确合成，传入 `null` 则明确使用未知透明背景兼容路径
- 展示页将页面 CSS 背景与渲染器合成参考分离，改为“匹配当前页面（精确）”和“未知透明背景（兼容）”两种可见模式，避免背景选择隐式改变输出合同
- 迁移类型声明、发布校验和浏览器像素回归到新 API，覆盖完整 WebGL2、回退链与两种合成参考模式
- 正式收敛透明合成 API：`outputCompositing: 'scene' | 'browser-overlay'`、`overlayAlphaPolicy: 'coverage' | 'visual-max'`、`overlayColorCompensation: 'none' | 'bright-core'`、默认 `overlayAlphaLimit: 250 / 255`，以及 `hostCompositing: 'source-over' | 'plus-lighter'`
- `browser-overlay + coverage` 作为未知背景默认透明合同，使用清晰 Scene Coverage 与独立 Bloom 传输 Alpha 的和；`visual-max` 取两种传输量的较大值，提供 v1.2.15 风格的低遮挡视觉近似，但最终 `maxRGB` 仍不参与 Alpha 生成
- `bright-core` 与 Alpha 策略正交，只按清晰发射和 Bloom 能量补偿高能核心，不整体混白 RGB 或提亮低能拖尾；所有 `source-over` 组合继续满足预乘约束 `RGB <= Alpha`
- 删除旧 `unknownBackgroundAppearance` 兼容镜像；构造参数、`updateConfig()`、`getConfig()` 与类型声明只保留彼此正交的 `overlayAlphaPolicy` 和 `overlayColorCompensation`
- `plus-lighter` 改为独立 Add 载荷合同并忽略 Alpha 策略、颜色补偿与 Alpha 上限；CSS 合成仅作为 SDR DOM 近似，严格 Unity 加色仍要求宿主在线性 HDR 目标中执行 Add，已知背景继续使用 `scene + setCompositingReference()` 精确路径
- 对照解包工程的 `BaGameBloomRendererFeature` 与 Shader 修正 Bloom 数值合同：Threshold 与 Clamp 均经 CPU `GammaToLinearSpace` 换算、Intensity 经 CPU 曝光刻度换算后线性乘入、上采样对累计粗级（更高 mip 索引）做四点扩散并单点加入当前细级，并保留 soft-knee 无条件增加的误差项

## v1.2.15 — 参数契约与透明覆盖层收敛

- 新增只读 `FX_PARAM_SCHEMA`、`FX_PARAM_SCHEMA_VERSION = 1` 与 `FX_PARAM_MIGRATIONS`，为公开标量参数提供类型、硬边界、默认值、单位、分组、稳定顺序、本地化键、推荐控件范围、关联路径和 Enhanced/Legacy 模式基线
- 加入 `bloom.scatter` 到 `bloom.diffusion` 的 v0→v1 路径和值迁移；兼容旧 API 曾接受的任意非负有限值，因两者无可靠视觉等价换算而统一恢复 Unity 默认 `7` 并报告 `defaulted`；新增 Schema 驱动的 `setFxParams(patch, { schemaVersion, strict, reset })`，返回 `applied`、`normalized`、`rejected`、`committed` 与当前 Schema 版本，严格模式任一错误整批回滚
- 新增包根 `applyFxParamPatch(patch, { schemaVersion, strict })`，允许设置页在不创建 DOM 或渲染实例时迁移并校验不可信持久化补丁，且不会公开内部候选配置树
- `setFxParam()` 改为返回是否提交成功；未知路径、非法类型与非有限数不再静默失败；`resetFxConfig()` 现在恢复当前 Enhanced 或 Legacy 模式基线
- 将 `themeColor` 纳入构造参数、`updateConfig()` 与 `getConfig()` 的实例状态，并导出默认游戏蓝 `DEFAULT_THEME_COLOR = '#4ca7ff'`；非法颜色统一恢复默认值
- 对照 Unity `Circle_01` 纹理和材质混合重新使用完整二维 RGB/R Coverage，修正 Canvas、Software、Native 与 Legacy 圆盘的边缘、中心能量和生命周期透明度；未改动嵌入纹理数据
- 完整 WebGL2 圆环改为上传只读 Ring3 Alpha 并在 Fragment Shader 中执行 Bilinear + Clamp 采样和硬 `clip`，消除 96×8 顶点 Alpha 插值造成的细小溶解边界偏差；拓扑和嵌入纹理数据保持不变
- 完整 WebGL2 与 WebGL2 Bloom 无损保留 Unity `FX_TEX_Trail_03` 的完整 `512×512 RGB`，并为透明输出派生“任一 RGB 非零即覆盖”的二值支持面 Alpha；按 sRGB、Bilinear、Repeat、无 Mipmap 在 Fragment Shader 逐片元采样，保留 Gradient × `23.968628` 材质能量，不把 HDR 明度解释为最终 Alpha；严格复现 Stretch U、非对称 V、4 个圆角插入点与单三角端帽，将普通段从 96 顶点降至 6 顶点；Canvas、Software、Native 与 Legacy 继续使用能力受限近似
- Disk、MeshTri 与 Ring (3)/(4) 的启用 Gradient RGB 改为保留 OriginalPrefab 归一化浮点真值，不再提前量化为整数 8-bit；拖尾距离粒子只受 Unity 每实例 `maxNumParticles=50` 限制，移除单次输入额外的 32 枚截断
- 增加真实 Chromium 的 Trail_03 独立像素探针，验证完整 WebGL2 与 WebGL2 Bloom 的头尾能量、非对称横截面方向和逐项一致性；明确区分 Unity 语义 UV 与 PNG 顶行优先字节上传所需的 WebGL V 补偿
- 软件 Bloom 的透明覆盖层改用清晰 Scene 与 Bloom 的剩余 Coverage 合成，避免中心 Alpha 重复抬高；Canvas 路径保持 `scene` 的加色语义，并在 `transparent-overlay` 下采用受预乘 Alpha 限制的兼容输出
- WebGL2 Bloom 成功路径继续复用已验收的完整 WebGL2 Scene，同时移除每帧不可见的 Canvas 重复栅格化；GPU 当帧失败时才补画 Canvas 并进入 Software / Native 回退
- 后端解析状态事件允许宿主同步切换路由；在 WebGL2 当帧失败或 Context 丢失事件中立即选择 Native 时，会按新路由重画当前帧并跳过 Software Bloom 像素回读
- 统一完整 WebGL2、独立 WebGL2 Bloom、软件 Bloom 与原生回退的 Unity `GammaToLinearSpace` 阈值换算；Clamp 在换算后按 Shader half 上限 `65504` 截断，默认序列值仍为 `65472`
- 修复原生辉光与 Legacy 在高 DPR 下仍按 CSS 像素计算模糊半径的问题，使点击光晕和原生拖尾的物理像素扩散范围不再随设备像素比缩小
- 增加基于系统 Edge / Chromium 的真实浏览器像素回归门禁，覆盖五种模式、透明度梯度、黑白与棋盘背景、隔离合成、DPR、Shadow DOM、场景背景及 WebGL Context 恢复；固定基线仅用于浏览器实现回归，不替代 Unity HDR 工程真值
- 为完整 WebGL2 与独立 WebGL2 Bloom 增加 `transparent-overlay + trail-only` 的 `opacity=0/0.5/1` 完整失败链，并为 `scene` 与 `transparent-overlay` 增加 Trail_03 Context 生命周期矩阵；验证 Software / Native 回退、恢复首帧、静态纹理重建、输出层所有权、Alpha 连续性及实际非零拖尾区域的 Coverage 背景透出
- 文档明确合成配置契约与能力边界：展示页及严格游戏还原默认使用 `scene`，BASpark 等透明桌面宿主显式使用 `transparent-overlay`；`isolatedCompositing` 只隔离库内图层且无法读取桌面，逐像素匹配的已知背景应通过 `setSceneBackground()` 进入完整 WebGL2 Scene
- 明确 Unity Additive 固定目标 Alpha 属于不透明相机缓冲合同；无匹配背景的透明 Canvas 必须使用传输 Alpha 或 Coverage Alpha，严格一致声明仅覆盖已知背景下的最终 RGB
- 明确未知背景的标准 `source-over` 无法同时满足严格 Unity 加色、纯 Coverage Alpha 和白底绝不变暗；不采用 `min(coverage, maxRGB)` 将发射亮度重新解释为遮挡率，避免黑色或低能拖尾丢失 Coverage、透明度非线性及后端切换突跳

## v1.2.14 — 完整 WebGL2 与统一线性场景输出

- 将纯 WebGL2 从实验选项升级为正式第五种渲染模式，使用独立 `effectBackend`、`resolvedEffectBackend` 与 `baclickfxeffectbackendchange` 状态契约；不可用时安全回退 Canvas 2D 链
- 默认完整特效后端与展示页模式改为纯 WebGL2；显式旧版 Bloom 参数继续选择 Canvas 2D 兼容路径，避免既有集成被默认值覆盖
- 纯 WebGL2 接管圆盘、离散圆环、三角碎片、TrailRenderer 主体和 MXFinalBloom，并按 Unity 解包纹理、材质 Alpha、生命周期曲线及预乘输出校准透明覆盖率
- 新增 `outputCompositing: 'scene' | 'transparent-overlay'`，分离 HDR 发光能量、几何 Coverage 与最终输出 Alpha，统一各后端的桌面透明叠加语义
- WebGL2 Bloom 改为与纯 WebGL2 复用完整 Scene Renderer；原生辉光和 Legacy 接入 Canvas Final Pass，使清晰层、点击附加层、轨迹、辉光与背景使用一致的线性颜色及覆盖率规则
- 新增 `setSceneBackground(source, { fit: 'cover' })`，支持将已解码栅格背景交给 WebGL2 Scene 和 Native / Legacy Final Pass；展示页同步自定义图片、CORS 回退与居中 cover 裁剪
- 修复圆盘透明度饱和、Circle_01 边缘与生命周期衰减、圆环中心空洞、三角图集分段错位，以及多后端桌面过亮和颜色不一致
- 最终合成或 WebGL Context 丢失时同步恢复稳定 Canvas 输出；Context 恢复后重新验证背景与全部目标，失败实例允许一次懒重建，不暴露空帧或残缺 Scene
- 场景背景更新改为跨 Renderer 原子切换和逆序回滚；模式切换释放闲置全尺寸纹理与 FBO，同时保留 Program、静态纹理和背景源以降低恢复成本
- 中英文 README、发布类型、展示页简介与 FAQ 同步五种模式、双后端状态事件、场景背景生命周期和纯白背景隔离合成说明

## v1.2.13 — Unity 材质校准与多后端稳定性

- 保持 v1.2.12 的稳定 Bloom 回退基线，不纳入已撤销的完整 WebGL2 与原生三尺度点击辉光实验
- Legacy 点击按 Unity 解包资源校准光盘、圆环投影与绘制顺序，并使用原始 `Ring3` Alpha 精确栅格化完整环带及阴影
- 原生辉光拖尾在单层局部模糊前执行 MXFinalBloom 高亮阈值提取，减少低能尾段的均匀光雾，同时保持点击光晕的中间视觉基线
- TrailRenderer 保留 Unity 的圆角、端帽、弧长 Stretch 能量与横向纹理轮廓，并减少长轨迹的临时分配和无输出绘制
- WebGL2 Bloom 完善尺寸分配失败后的状态清理、重试与资源释放，避免半分配资源和重复失败残留
- 修复 IIFE 构建验证沙箱，并保留展示页快速人工检查入口与细粒度参数控制

## v1.2.12 — Bloom 回退与非 Bloom 优化

- 软件 Bloom、WebGL2 Bloom、原生辉光和 Legacy 的 Bloom 参数及后端合成基线保持 v1.2.11 稳定实现，未纳入实验性完整 WebGL2 与共享 Bloom 管线改动
- 保留 Unity `TrailRenderer` 的非 Bloom 几何：4 个圆角插入点、1 个端帽顶点、有限锐角 miter，以及按弧长在段中点采样的 Stretch 能量与横向纹理轮廓；每个 Canvas segment 和 cap 只提交一次路径与渐变，避免长轨迹卡顿，并约束短段 miter 防止自交
- `pointerCancel()` 在多屏切换、暂停和异常恢复时立即移除当前轨迹；`pointerUp()` 继续让已有拖尾按 0.3 秒自然衰减
- 圆环数量为 `0` 时按实际可见层生命周期停止 RAF，避免光盘结束后继续空转；数量和模糊参数允许显式设为 `0`
- 展示页连续参数使用更细步进，小数 DPR 仅在提交时重建 Canvas 并按原精度恢复；寿命、数量和采样精度保留合理整数控制，并补齐 Hit/Flare 重置项
- 常见问题继续提示纯白背景开启隔离合成；演示 GIF 改由 v1.2.12 Release 资产提供，并从全部可达 Git 历史中移除

## v1.2.11 — Unity 解包资源严格对齐

- 对照两套解包 Unity 工程重新核验 `FX_Touch` Prefab、材质、网格与纹理资源，并按固定 UI 正交投影、粒子曲线、材质 HDR、碎片局部缩放和 TrailRenderer 参数校准网页实现
- WebGL2 与软件后端严格复现 `Hidden/MXFinalBloom` 的 4-tap、Box4 mip 和累积上采样路径，并恢复 Intensity 1.7、Threshold 1、Soft Knee 0、Diffusion 7
- 粒子尺寸改为随实际画布高度持续缩放，移除诊断截图尺寸上限和非游戏的高分辨率 Diffusion 补偿
- 为保持 Unity 直接加色语义，`isolatedCompositing` 与 `lightBackgroundContrastAlpha` 默认值分别调整为 `false` 和 `0`
- 纯白网页可显式启用 `{ isolatedCompositing: true, lightBackgroundContrastAlpha: 0.35 }`，展示页双语 FAQ 增加对应说明并修复移动端展开后的裁切
- `pointerCancel()` 与 Unity `Canceled` 路径一致：停止追加并清理活动指针状态，既有可见拖尾继续按 `0.3s` 自然衰减
- 修复极大有限时间倍率导致虚拟时钟溢出、可见对象永久占用 RAF
- 修复外部 Canvas 在 Legacy 与 Enhanced 间切换时未应用对应参数集，以及方向参数被错误钳制为非负值
- `rootDurationMs = 1000` 仅保留为原根 ParticleSystem 的对象池释放元数据，展示页不再将其作为视觉调参
- 展示页默认主题色恢复为游戏蓝 `#4ca7ff`，隔离合成默认关闭，并补齐 Bloom 与方向相关双语文案
- 清理软件 Bloom 中旧 Gaussian 与 Bicubic 上采样的不可达实现，优化 Vite 库构建配置

## v1.2.10 — WebGL2 Bloom 默认与宿主控制 API

- 默认 Bloom 后端改为 WebGL2；能力不足时自动回退软件 Bloom，再回退原生辉光
- 软件 Bloom 关闭局部 mip 金字塔优化，改用单个全视口工作区，消除低频能量铺满局部缓冲产生的矩形光晕范围
- 新增 `'dom'` / `'manual'` 输入来源与通用的 `pointerDown()`、`pointerMove()`、`pointerUp()`、`pointerCancel()` 宿主指针 API
- 新增点击与拖尾独立的 `clickTimeScale` / `trailTimeScale`，寿命、旋转与碎片位移保持同步缩放
- 新增 `setPaused()`，可停止输入和 RAF、取消活动指针、可选清屏，并在恢复时重置时间基准
- 修复 `trailAlways` 无可见内容时仍因活动指针持续申请 RAF，改为下一次移动时按需唤醒
- 修复高频指针输入提前消费拖尾时间增量，导致轨迹碎片在停止移动后才明显出现
- 修复新点击继承出生前帧时间、动态点击倍率追溯生效及暂停前时间丢失
- 修复 `trailAlways` 多指针接管、动态关闭残留状态与空闲后首次移动不可见
- 修复清屏或重新启用拖尾后活动指针无法续接，并保留 DOM 合并样本的原始时间
- 明确 `pointerCancel()` 立即移除当前轨迹，`pointerUp()` 仍让既有轨迹自然衰减
- 修复已松开轨迹错峰衰减到单点后停止 RAF 却残留不可见容器
- 展示页新增 DOM/手动输入切换、独立时间倍率和暂停清屏控件，并提供通用宿主接入代码示例

## v1.2.8 — Bloom 视觉校准与点击辉光调节

- 当时新增并默认开启 `isolatedCompositing`，先在透明隔离组内合成主特效、WebGL2 Bloom 和浅色背景兼容层，再整体覆盖页面，改善纯白背景上的蓝青色保留；v1.2.11 严格对齐后默认值已调整为 `false`
- 支持通过构造参数和 `updateConfig()` 在隔离合成与旧版直接页面合成之间切换，重用现有 Canvas 与 WebGL Context
- 已有 Canvas 作为 `target` 时将隔离合成明确降级为 `false`；普通容器继续由调用方提供定位上下文
- 展示页新增双语隔离合成开关、持久化与重置，并在首次加载时显式应用主题颜色
- 补充外部 Canvas、多实例、WebGL2 延迟挂载、运行时重挂载、销毁和 npm 类型消费验证
- 针对网页局部 mip 与透明 sRGB 合成，将 Bloom Intensity/Scatter 校准为 1.0/0.7，补回游戏截图中的发光强度与大范围低频外晕
- 圆环继续使用 `FX_MAT_Touch_Tri3` 的白色 5.992157 HDR 材质，并保留原 Prefab 启用的 Color over Lifetime 顶点色
- 提升圆环 Bloom 发射至 Unity 材质 Alpha 1.0；局部软件 Bloom 仅在裁剪边缘扣除底色并向内渐退，消除计算矩形且保留真实外晕
- 新增 `bloom.clickEmissionScale` 调节路径和展示页双语滑块，独立缩放圆环、中心光盘辉光而不改变轨迹或清晰几何

## v1.2.7 — 可选 WebGL2 Bloom 后端与切换 API

- 新增可选 WebGL2 GPU Bloom，保留软件 Bloom 作为默认参考实现与兼容回退
- 新增 `bloomBackend: 'auto' | 'software' | 'webgl2' | 'native'`，并通过 `resolvedBloomBackend` 暴露实际后端与延迟探测的 `pending` 状态
- 导出 `BLOOM_BACKEND_CHANGE_EVENT`，后端解析状态变化时在主 Canvas 派发事件
- WebGL2 不可用、浮点 Framebuffer 创建失败或运行时渲染失败时，自动回退软件 Bloom，再回退原生辉光
- 展示页增加 WebGL2 Bloom 选项、实际后端状态、双语文案及本地设置恢复
- 优化 GPU 发射几何批处理，减少圆盘、圆环和拖尾热循环中的临时数组、三角函数与重复采样
- WebGL2 发射源恢复物理像素分辨率，高质量上采样改用与软件参考一致的 B-spline 四次双线性采样

## v1.2.6 — 三档渲染模式与 Bloom 性能优化

- 新增软件 Bloom、原生辉光和 Legacy 三档渲染模式，并支持运行时切换
- 按 Unity FX_Touch 资源完善增强模式的圆环、光盘、拖尾与 Legacy 参数映射
- 优化软件 Bloom 的区域合并、Float32 缓冲复用、有效区域读回和高质量预过滤
- 优化轨迹降采样、拖尾发射计算和过期顶点清理，降低高密度轨迹的卡顿
- 修复 Bloom 缓冲缩小后的残留辉光，消除特效附近的异常细线
- 修复 Legacy 模式的首帧绘制，并消除原生辉光轨迹尾部异常光晕

## v1.2.5 — 面板折叠分组 + 健壮性修复

- 面板 8 个可折叠分组，默认仅展开圆环参数和轨迹图层
- 修复 setFxParam boolean 死代码（Number.isFinite 拦截）
- ba-spark.js 重命名为 fx.js
- restoreSettings 补全 17 个新滑块 + Hit/Flare 开关恢复

## v1.2.4 — Hit/Flare 点击层 + 面板扩展

- 新增 Hit（撞击爆发）+ Flare（星形闪光）点击层，默认关闭
- 面板从 19 滑块扩展至 36 滑块，新增可折叠分组
- 弧线采样精度、旋转方向、根持续时间 API；根持续时间字段现按解包资源确认仅为对象池释放元数据，不参与视觉调参
- 修复 setFxParam boolean 类型 + bindToggle 初始同步

## v1.2.3 — 健壮性全面提升

- 4 处深拷贝改用 structuredClone
- 删除死代码 src/utils.js
- RGB↔HSL 提取共享函数，消除三处重复
- evaluateColor 首尾 keyframe 返回数组副本
- setFxParam 新增范围校验
- 曲线求值器加空数组保护
- getConfig 返回深拷贝
- themeHueShift 实例级安全
- 补全 localStorage 恢复（trailAlways + FX 滑块）
- clearTrail 移除多余 clearRect
- ctrlBloomRing 默认值与 config 对齐
- 重置按钮 intOnly 格式一致

## v1.2.2 — 类型定义同步

- 补全 .d.ts：BAClickFXOptions/BAClickFXConfig 新增 trailAlways
- 补全 .d.ts：BAClickFX 类新增 updateConfig/setThemeColor/setFxParam/getFxConfig/resetFxConfig 声明

## v1.2.1 — 修复 trailAlways 功能缺失

- 恢复 trailAlways 功能（v1.2.0 git 回退时被误删）
- 修复 _acceptPointerDown 将 button=-1（移动未按键）误拦截

## v1.2.0 — Unity FX_Touch Direct Port

- **Architecture**: Replaced the fully parameterized engine with a direct parameter-level port of the Blue Archive `FX_Touch.prefab` ParticleSystem and TrailRenderer.
- All visual parameters (colour curves, size curves, rotation speed, dissolve thresholds, HDR intensity, TrailRenderer time/width) are now locked to the game's original values.
- New constructor API: `scale`, `opacity`, `clickEnabled`, `trailEnabled`, `trailAlways`, `maxDpr`, `touchAction`, `inputFilter`.
- New runtime configuration: `updateConfig()`, `setThemeColor()`, `setFxParam()`, `getFxConfig()`, `resetFxConfig()`.
- Control panel updated with sliders for key parameters: ring HDR/radius/width/lifetime, shard count/max/spacing, trail width/glow/lifetime, bloom blur/alpha.
- Bidirectional taper on dissolve ring endpoints matching `FX_TEX_Grad_Ring3` texture alpha falloff.
- Ring width now follows the game's `sizeOverLifetime.y` curve (fast inflation in first 8% of lifetime).
- Global `SIZE_CORRECTION` factor (0.92) compensates for orthographicSize deviation.
- Trail gradient layer uses alpha-based fade-out (`progress^0.5`) with uniform blue tint to prevent dark artifacts on light backgrounds.
- Bloom glow significantly increased: ring blur 80, disk blur 65, ring alpha 0.9.
- Shard glow removed.
- I18N bilingual support for the demo page.
- 48 smoke tests covering all Unity parameter assertions and lifecycle behaviours.

## v1.1.14 - 2026-07-16

- Restored the v1.1.12 trail layers, widths, colors, multi-layer glow, radial glow profile, and default glow range and intensity after visual review.
- Reduced the default trail white mix to `0.10` so the line keeps more of the configured blue color.
- Adjusted every visible trail layer to increase toward its endpoint, preventing the middle of the trail from appearing brighter than the cursor head.
- Added regression coverage for the restored v1.1.12 defaults and the trail-head brightness invariant.
- No public API or TypeScript declaration changes.

## v1.1.13 - 2026-07-15

- Reworked the trail width and opacity profiles so the cursor head is the brightest and widest point, followed by a monotonic fade toward the tail.
- Added a path-progress blue-to-cyan color ramp, reduced white mixing, and kept the short head highlight without washing out the main trail.
- Changed the default trail base width to `4.00` and replaced the default multi-layer fake glow with a width-coupled real radial glow.
- Softened the real glow edge with denser sampling, a ten-stop radial falloff, and higher precision for very low alpha values while keeping the outer radius bounded.
- Fixed the RGBA string cache so its quantized key and stored alpha always use the same precision, eliminating call-order-dependent low-alpha output.
- Preserved the previous trail shard size, count, spacing, and random distribution, and made no public API, click-effect geometry, or click timing changes.

## v1.1.12 - 2026-07-15

- Replaced the demo's unstyled Mouse Leave selector with an accessible themed native select, including dark options, focus states, a custom arrow, forced-colors fallback, and bilingual option labels.
- Fixed five stale `readDefaults()` config paths that displayed `NaN` after resetting rotation jitter, small-radius ring, and trail-gradient controls.
- Aligned the shard-spacing and ring-alpha HTML defaults with the actual config, and preserved each range output's declared decimal precision during input and reset.
- Centralized demo setting restoration so invalid range, color, and select values safely restore only the affected control without clearing other preferences.
- Hardened `BAClickFXDemo.loadSettings()` against malformed JSON roots and reused the same validated restoration path as startup settings.
- Extended the demo synchronization check to resolve every direct `createConfig()` reference, reject missing or non-finite defaults, and cross-check range HTML values, outputs, and reset config values before release.
- No Canvas effect configuration, geometry, timing, easing, randomness, drawing, compositing, core API, or TypeScript changes.

## v1.1.11 - 2026-07-14

- Added the opt-in `clamp` trail boundary mode, which attempts Pointer Capture and clamps each delivered trail sample to the Canvas edge before smoothing and interpolation.
- Added the optional constructor `inputFilter` and `setInputFilter()` API so host pages can reject Pointer input before layout reads, coalesced-event sampling, and particle creation.
- Kept `pointerup`, `pointercancel`, and `blur` cleanup independent from input filtering, safely rejected filter exceptions, and released the host callback reference during destruction.
- Added the `clamp` option and working mode binding to the demo selector, plus complete TypeScript, package-consumer, and smoke-test coverage.
- Completed bindings, defaults, bilingual labels, and reset handling for the existing advanced demo controls so the repository synchronization check passes again.
- No default configuration, existing boundary-mode behavior, color, opacity, geometry, timing, easing, random distribution, drawing formula, draw order, or compositing changes.

## v1.1.10 - 2026-07-13

- Centralized finite-number normalization across constructor options, render options, `boom()`, colors, and every public numeric setter.
- Invalid numeric conversions, `NaN`, `Infinity`, and `Symbol` inputs now fall back safely; existing finite values, numeric strings, and `null` conversion behavior are unchanged.
- Added complete TypeScript types for the configuration returned by `getConfig()` and marked the live `CONFIG` reference as deprecated.
- Added strict TypeScript consumer compilation and ESM/CommonJS default-export checks against the packed npm tarball.
- Reused the trail update's live-point count and bounded the trail render cache without changing forward sampling, deduplication, suffix retention, or Canvas command order.
- Made fractional `renderMaxPoints` values safe by applying the existing integer point-limit meaning at the internal allocation boundary.
- No default configuration, public runtime API, color, opacity, geometry, timing, easing, random distribution, drawing formula, draw order, or compositing changes.

## v1.1.9 - 2026-07-13

- Added opt-in Canvas render budgets and runtime render metrics for large surfaces.
- Added explicit size refresh support for externally managed Canvas elements.
- Added debounced `ResizeObserver`, `visualViewport`, and device-pixel-ratio monitoring with complete teardown.
- Paused rendering while an external Canvas has a zero-sized layout box and resumed after its size is refreshed.
- Prevented multiple live engines from clearing or resizing the same main Canvas.
- Kept the default, no-budget rendering dimensions and visual output for non-zero Canvas layouts identical to v1.1.8.
- Deferred local click-wave scratch canvases to preserve the existing production drawing path and strict visual equivalence.

## v1.1.8 - 2026-07-13

- Added `auto`, `pause-connect`, and `continue` trail behavior outside the Canvas.
- Made trail disabling and clearing release their trail-only input and particle state.
- Hardened construction, destruction, Pointer Capture, RAF, timer, and Canvas cleanup.
- Added package metadata, exact file-list, CI, prepack, and prepublish verification.
- Corrected the IIFE examples to use `BAClickFX.BAClickFX`.
- No color, opacity, geometry, timing, easing, random distribution, drawing formula, or default visual changes.

## v1.1.7 - 2026-07-13

- Reused the Canvas bounds across each batch of coalesced pointer events.
- Fixed the `maxCoalescedEvents = 1` sampling edge case.
- Removed unused internal allocation and dead code.
- No visual effect, default configuration, or public API changes.

## v1.1.0 - 2026-07-09

- Published `ba-click-fx` to npm.
- Added Blue Archive style mouse click effect and cursor trail animation.
- Added ESM, CommonJS, IIFE and TypeScript declaration builds.
- Added online demo, CDN usage and direct download support.
- Added SEO optimization: meta tags, Open Graph, robots.txt, sitemap.xml.
- Added npm version and downloads badges to README.
