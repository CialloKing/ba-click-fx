# Changelog

## v1.2.8 — Bloom 视觉校准与点击辉光调节

- 新增默认开启的 `isolatedCompositing`，先在透明隔离组内合成主特效、WebGL2 Bloom 和浅色背景兼容层，再整体覆盖页面，改善纯白背景上的蓝青色保留
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
- 弧线采样精度、旋转方向、根持续时间 API
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
