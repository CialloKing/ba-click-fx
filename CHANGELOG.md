# Changelog

## v1.2.15 — 参数契约与透明覆盖层收敛

- 新增只读 `FX_PARAM_SCHEMA`、`FX_PARAM_SCHEMA_VERSION = 1` 与 `FX_PARAM_MIGRATIONS`，为公开标量参数提供类型、硬边界、默认值、单位、分组、稳定顺序、本地化键、推荐控件范围、关联路径和 Enhanced/Legacy 模式基线
- 加入 `bloom.scatter` 到 `bloom.diffusion` 的 v0→v1 路径迁移；新增 Schema 驱动的 `setFxParams(patch, { schemaVersion, strict, reset })`，返回 `applied`、`normalized`、`rejected`、`committed` 与当前 Schema 版本，严格模式任一错误整批回滚
- `setFxParam()` 改为返回是否提交成功；未知路径、非法类型与非有限数不再静默失败；`resetFxConfig()` 现在恢复当前 Enhanced 或 Legacy 模式基线
- 将 `themeColor` 纳入构造参数、`updateConfig()` 与 `getConfig()` 的实例状态，并导出默认游戏蓝 `DEFAULT_THEME_COLOR = '#4ca7ff'`；非法颜色统一恢复默认值
- 对照 Unity `Circle_01` 纹理和材质混合重新使用完整二维 RGB/R Coverage，修正 Canvas、Software、Native 与 Legacy 圆盘的边缘、中心能量和生命周期透明度；未改动嵌入纹理数据
- 软件 Bloom 的透明覆盖层改用清晰 Scene 与 Bloom 的剩余 Coverage 合成，避免中心 Alpha 重复抬高；Canvas 路径保持 `scene` 的加色语义，并在 `transparent-overlay` 下采用受预乘 Alpha 限制的兼容输出
- WebGL2 Bloom 成功路径继续复用已验收的完整 WebGL2 Scene，同时移除每帧不可见的 Canvas 重复栅格化；GPU 当帧失败时才补画 Canvas 并进入 Software / Native 回退
- 修复原生辉光与 Legacy 在高 DPR 下仍按 CSS 像素计算模糊半径的问题，使点击光晕和原生拖尾的物理像素扩散范围不再随设备像素比缩小
- 增加基于系统 Edge / Chromium 的真实浏览器像素回归门禁，覆盖五种模式、透明度梯度、黑白与棋盘背景、隔离合成、DPR、Shadow DOM、场景背景及 WebGL Context 恢复；固定基线仅用于浏览器实现回归，不替代 Unity HDR 工程真值
- 文档明确合成配置契约与能力边界：透明桌面推荐完整 WebGL2、`transparent-overlay` 和零浅色轮廓；纯白网页建议开启隔离合成；完整 WebGL2 Scene 配合逐像素匹配的已知背景才能严格复现 Unity 线性 HDR Scene，其他回退路径不承诺逐像素等价

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
