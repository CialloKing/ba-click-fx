# 渲染与合成指南

[返回 README](https://github.com/CialloKing/ba-click-fx/blob/main/README.md) · [English](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.en.md)

[API 参考](https://github.com/CialloKing/ba-click-fx/blob/main/docs/api-reference.md) · [渲染与合成](https://github.com/CialloKing/ba-click-fx/blob/main/docs/rendering-guide.md) · [Worker 接入](https://github.com/CialloKing/ba-click-fx/blob/main/docs/worker-guide.md)

## 网页接入配置

大多数普通网页无法在每一帧可靠读取并上传特效下方的真实背景像素：CSS 多层背景、滚动内容、动画、视频、跨域图片和浏览器安全策略都会使“实时背景参考”不可用。若宿主不能提供与特效位置逐像素匹配的不透明 `setCompositingReference()`，网页集成建议使用下面这组配置：

| 展示页选项 | API 配置 | 用途 |
|---|---|---|
| 输出合成：**透明覆盖层** | `outputCompositing: 'browser-overlay'` | 输出带 Alpha 的独立覆盖层，由网页宿主完成最后一次合成 |
| 特效背景参考：**未知透明背景（兼容）** | 不提供参考，或调用 `setCompositingReference(null)` | 不假设库能够读到页面背景 |
| 宿主合成：**DOM Add（近似）** | `hostCompositing: 'screen'` | 推荐默认选择；适合未知的中灰、浅色或变化背景，亮底会自动收敛 |
| 宿主合成：**Plus-lighter（原始加色）** | `hostCompositing: 'plus-lighter'` | 适合黑色、暗色或可控宿主，保留更激进的加色；亮底容易提前饱和 |

宿主表面决定最后一次混合发生在哪里：

| 宿主表面 | API 配置 | 合成边界 |
|---|---|---|
| DOM 背景（默认） | `hostCompositingSurface: 'dom-backdrop'` | 库拥有的覆盖层可由 DOM 执行 `screen` / `plus-lighter` |
| 透明窗口 | `hostCompositingSurface: 'transparent-window'` | CSS 混合无法跨越操作系统窗口边界；未知背景下独立混合会解析为 `source-over` |
| 原生合成器 | `hostCompositingSurface: 'native'` | 由外部 WebView/原生合成器执行最终混合，外部 Canvas 的样式仍由宿主管理 |

在 `browser-overlay`、未知背景且请求 `screen` 或 `plus-lighter` 时，透明窗口会在 `getConfig()` 中报告 `resolvedHostCompositing: 'source-over'`，并设置 `compositingWarning` 为 `screen-requires-visible-backdrop` 或 `plus-lighter-requires-visible-backdrop`。只有当前输出路径实际使用合成参考时，才恢复 `source-over`，避免重复混合。`setCompositingReference()` 返回 `true` 仅表示参考已被接受，不保证当前路径已使用它；通过 `getEffectiveHostCompositing()` 或 `getConfig().resolvedHostCompositing` 判断实际宿主合成模式。

以下为推荐组合，库默认配置仍是 `scene + source-over`。

最小示例（`screen` 与 `plus-lighter` 按页面底色二选一）：

```js
const fx = new BAClickFX(
{
  outputCompositing: 'browser-overlay',
  hostCompositing: 'screen', // DOM Add（近似）；暗色宿主可改为 'plus-lighter'
  hostCompositingSurface: 'dom-backdrop',
});

fx.setCompositingReference(null);
```

这条路径是浏览器/DOM 的 SDR 视觉近似，不是对 Unity 线性 HDR Scene 的逐像素复现。只有能够提供实时、逐像素匹配的背景参考，或由宿主在线性 HDR Render Target 中合成时，才应使用默认的 `scene` 精确路径。

## 后端选择

`effectBackend` 决定清晰几何与 Bloom 是否全部由 WebGPU 或 WebGL2 接管；`webgpuPreferHdr` 只决定 WebGPU 最终 Canvas 是否尝试 Extended HDR，`false` 会强制 Standard SDR。Canvas 2D 路径再通过 `bloomBackend` 选择 Bloom 实现。展示页提供六种直观组合：

| 展示页选项 | API 配置 | 说明 |
|---|---|---|
| WebGPU | `{ effectBackend: 'webgpu', webgpuPreferHdr: false, bloomBackend: 'webgl2' }` | 正式的普通 WebGPU 模式；只配置浏览器首选 Standard SDR Canvas，不请求 `toneMapping: extended`，同时保留与 Unity 对齐的线性 Scene 与 MXFinalBloom |
| WebGPU HDR（实验） | `{ effectBackend: 'webgpu', webgpuPreferHdr: true, bloomBackend: 'webgl2' }` | 异步申请 WebGPU，并优先配置 `rgba16float + toneMapping: extended`；HDR Canvas 不可用时继续使用 WebGPU 标准 SDR 输出，Device 不可用或丢失时回退完整 WebGL2 |
| 纯 WebGL2 | `{ effectBackend: 'webgl2', bloomBackend: 'webgl2' }` | 默认；完整 Scene、Coverage 与 MXFinalBloom 均在一个 WebGL2 HDR 管线中完成；失败时回退 Canvas 2D 链 |
| WebGL2 Bloom | `{ effectBackend: 'canvas2d', bloomBackend: 'webgl2' }` | 兼容选择器；GPU 可用时复用与纯 WebGL2 相同的完整 HDR Scene，失败时回退 Canvas 2D 与原生辉光 |
| 软件 Bloom | `{ effectBackend: 'canvas2d', bloomBackend: 'software' }` | 兼容实现，使用 8 位 Canvas 遮罩、像素回读和全视口 Float32 Bloom 缓冲 |
| 原生辉光 | `{ effectBackend: 'canvas2d', bloomBackend: 'native' }` | 使用 Canvas 2D 多尺度光晕近似点击 Bloom，拖尾使用局部模糊；无需回读画布，仍与完整 GPU 后处理存在差异 |

展示页在六档渲染选项之外提供独立的“隔离合成”开关。该开关默认关闭，与渲染后端正交；它只控制多张 Canvas 的最终 CSS 合成边界，不改变 Bloom 阈值、模糊或颜色计算，也不是降低 Bloom 计算量的性能开关。

### 原生辉光

原生点击辉光从共享材质、Circle 纹理与圆环溶解数据估算发射能量，应用 Threshold、Soft Knee、Clamp 和曝光强度，再按视口、DPR 与 Diffusion 近似多级扩散。圆环能量按半径与宽度估算，再做各向同性径向扩散；当前不按可见弧段施加角向遮罩。光晕独立叠加，不会为增亮而重复绘制光盘；原生 `opacity` 在光晕生成后应用，避免半透明时光晕突然消失。已知背景的 Canvas Final Pass 使用单独的半分辨率 sRGB 光晕缓冲，减轻暗部色带。源面积、环带卷积和径向扩散仍采用近似，细碎弧段、重叠点击与 HDR 高亮不会与 WebGPU/WebGL2 逐像素一致。

### WebGPU 与 HDR

WebGPU 可用不等于屏幕 HDR 可用。只有 `getConfig().resolvedWebGPUOutputMode === 'extended'` 才表示 Canvas 已协商扩展动态范围，并会把线性 HDR 结果编码为扩展 sRGB、保留超过 SDR 白色的高光；`'standard'` 表示 WebGPU Scene 与 Bloom 正常运行，但最终 Canvas 仍是 SDR；`'pending'` 表示正在申请设备或提交首帧；`'unavailable'` 表示当前没有可用的 WebGPU 输出。真正看到超白高光还需要 HDR 显示器、系统已开启 HDR、浏览器实现 WebGPU HDR Canvas，以及 `rgba16float + toneMapping: extended` 配置成功。

设置 `webgpuPreferHdr: false` 会在任何浏览器上跳过 Extended 配置，直接使用浏览器首选的 Standard SDR Canvas；这是展示页“WebGPU”普通模式的固定合同。内部 `rgba16float` Scene 仍用于保留预过滤前的发射能量和 Unity MXFinalBloom 精度，它不是 HDR 显示输出；是否真实输出 HDR 仍只由 `resolvedWebGPUOutputMode` 判断。

展示页在 HDR 摘要下提供默认折叠的“WebGPU 诊断详情”，分别报告安全上下文、WebGPU API、Canvas Context、Adapter、Device、Extended Canvas、Standard SDR、首帧管线、图形/视频动态范围和 CSS HDR 语法支持，并保留稳定的失败阶段代码与浏览器异常文本。`(video-dynamic-range: high)` 只是视频输出环境提示，不参与 WebGPU HDR 成功判定。`CSS.supports()` 也只证明浏览器接受相关语法，不证明当前屏幕正在输出 HDR。网页无法可靠读取操作系统 HDR 开关或显示器尼特；最终浏览器侧判据仍是 `resolvedWebGPUOutputMode === 'extended'`。

展示页的“UI HDR”是演示站点私有功能。除特效实际解析为 WebGPU Extended 外，浏览器还必须支持 `color(srgb-linear ...)` 扩展色和 `dynamic-range-limit: no-limit`；否则控件会自动禁用。它直接给标题、状态区、面板边缘和交互控件应用 CSS HDR 描边与光晕，不创建第二个全屏 Canvas，也不经过 `mix-blend-mode`。范围 `1..16` 的“UI HDR 亮度”不属于 `BAClickFX` 公共 API，不会修改 `webgpuHdrBrightness`、Unity 特效参数或点击特效像素。

`webgpuHdrPeak`、`webgpuHdrBrightness`、`webgpuHdrColorPreservation`、`webgpuHdrWhiteCore`、`webgpuHdrWhiteStart` 和 `webgpuHdrWhiteEnd` 只校准 WebGPU Extended Canvas 的最终 HDR 展示映射；WebGPU Standard、WebGL2 和 Canvas 2D 输出不受影响，也不会修改 Unity 特效参数、粒子数量、几何或 Bloom 算法。其中 `webgpuHdrBrightness` 是范围 `0..32` 的线性倍率：存在匹配的合成参考时只放大背景上方的特效增量，不会增亮参考背景本身。较高倍率允许高级用户利用更大的显示高光余量，但可能被浏览器、系统或显示器裁剪、压缩或色调映射，因而不代表固定尼特值。

`webgpuHdrColorPreservation` 控制高亮增量恢复原始线性 RGB 色度方向的程度，范围 `0..1`，默认 `0` 保持现有渐进白核外观；设为 `1` 时，HDR shoulder 仍决定峰值，但高倍率不会继续放大项目自身产生的白核偏色。展示页“保留原始色相”预设会同时将该值设为 `1`、将 `webgpuHdrWhiteCore` 设为 `0`。这能消除渲染器自身的高倍率偏白，但不能阻止浏览器、系统或显示器在超出实际 HDR 色彩体积时降低饱和度。

### 后端回退与状态

显式 `effectBackend: 'webgpu'` 和 `'auto'` 都按 WebGPU → WebGL2 → Canvas 2D 的顺序解析完整特效后端。默认值仍为稳定的 `'webgl2'`，因此升级不会自动改变现有页面的渲染后端。

`bloomBackend: 'auto'` 和默认值 `'webgl2'` 优先尝试 GPU，失败时直接回退原生辉光，不自动启用软件 Bloom。只有显式选择 `'software'` 时才使用软件 Bloom，像素回读不可用则回退原生辉光。完整 GPU Scene 成功时由该后端统一计算 Bloom；`bloomBackend` 决定 Canvas 2D 路径的 Bloom 选择。

为保持已经验收的颜色、透明度和边缘采样，WebGL2 Bloom 在 GPU 成功时会有意复用 `WebGL2EffectRenderer` 的完整 Scene，而不是上传一份 8 位 Canvas Scene。因此它与纯 WebGL2 的成功帧使用相同 Shader 和像素管线，也不会预先栅格随后被隐藏的 Canvas。两者的区别是兼容合同：WebGL2 Bloom 仍保留 `effectBackend: 'canvas2d'` 请求及其 Native 回退链，纯 WebGL2 则由完整特效后端直接接管。

## 输出与宿主合成

`outputCompositing: 'scene'` 是默认值，保持 Unity 面向 Scene Render Target 的直接加色 RGB 语义。展示页和要求严格游戏还原的集成都应使用该模式，并通过 `setCompositingReference()` 提供与实际底图逐像素匹配的已知背景；这是完整 GPU 路径精确求值 Scene RGB 的合同。`'browser-overlay'` 供普通网页覆盖层以及 BASpark、WebView2、Electron 等透明桌面宿主显式选择，HDR 发射和 Bloom 能量仍独立计算，最终 Alpha 不再由最终 RGB 最大通道决定。

未知背景下的透明输出由以下配置继续细分。Alpha 分配与颜色补偿互不隐式切换：

| 配置 | 合同 |
|---|---|
| `overlayAlphaPolicy: 'coverage'` | 默认透明合同。请求 Alpha 由清晰 Scene Coverage 与独立 Bloom 传输 Alpha 相加，再受生命周期、`opacity` 和最终上限约束；适合优先保证遮挡率和跨后端连续性的宿主 |
| `overlayAlphaPolicy: 'visual-max'` | v1.2.15 风格的视觉近似。请求 Alpha 取清晰 Scene Coverage 与 Bloom 传输 Alpha 的较大值，使重叠区域保留更低遮挡率；Alpha 仍只来自这两种独立传输量，绝不会由最终 `maxRGB` 生成 |
| `overlayColorCompensation: 'none'` | 默认不改写透明载荷的颜色关系 |
| `overlayColorCompensation: 'bright-core'` | 未知浅色背景的可见性近似。只按独立的清晰发射能量与 Bloom 能量补偿高能核心，不会把全部 RGB 混向白色，也不会把低能拖尾尾端变成灰白色；仍保持预乘约束 `RGB <= Alpha`，但不宣称逐像素还原 Unity |
| `overlayAlphaLimit` | `browser-overlay + source-over` 的最终 Alpha 容量，默认 `250 / 255`，有限值钳制到 `0..1`。容量不足时预乘 RGB 等比收敛；它不改变特效 `opacity`、HDR 发射强度或 Bloom 强度 |
| `hostCompositing: 'source-over'` | 默认宿主合同，使用以上 Alpha 策略、颜色补偿和 Alpha 上限 |
| `hostCompositing: 'screen'` | 未知中高亮背景的独立完整载荷合同。库自有图层组使用一次 CSS `screen`，背景越亮，新增亮度越自动收敛；忽略 Alpha 策略、颜色补偿和 Alpha 上限 |
| `hostCompositing: 'plus-lighter'` | 未知背景下的独立 Add 载荷合同。渲染器输出完整加色载荷并由宿主执行一次 `plus-lighter`，因此忽略 `overlayAlphaPolicy`、`overlayColorCompensation` 与 `overlayAlphaLimit` |

旧的 `unknownBackgroundAppearance` 已从构造参数、`updateConfig()`、`getConfig()` 和类型声明中删除。颜色补偿只由 `overlayColorCompensation` 控制，Alpha 分配只由 `overlayAlphaPolicy` 控制，两者不会再通过兼容镜像隐式联动。

`hostCompositingSurface` 会与输出模式和合成参考一起解析实际宿主合同。`getConfig()` 返回调用方请求的 `requestedHostCompositing`、实际生效的 `resolvedHostCompositing`、`hostCompositingSurface` 和 `compositingWarning`；`getEffectiveHostCompositing()` 只返回实际生效模式。宿主合成状态变化时，主 Canvas 会派发 `HOST_COMPOSITING_CHANGE_EVENT`（事件名 `baclickfxhostcompositingchange`）。

`screen` 和 `plus-lighter` 都只是 SDR DOM 合成近似，并受浏览器色彩管理和实现差异影响。Unity 的最终画面是把背景与特效在线性 HDR 中合成后统一编码；未知桌面像素不在覆盖层进程内，因此没有任何单张透明载荷能对所有背景逐像素等价。`screen` 在黑底保留完整载荷，并在背景接近白色时自动减少增量，是展示页“DOM Add（近似）”和未知中高亮背景的推荐选择。`plus-lighter` 保留给已知黑色或暗色宿主；它把 sRGB 载荷直接相加，在亮底会提前饱和。

库创建覆盖层时会在完整图层组上执行一次所选宿主混合；若 `target` 是调用方传入的 `<canvas>`，库只输出独立完整载荷，不会修改该元素的 `mix-blend-mode`，最终 CSS、WebView 或原生合成由宿主负责。要严格匹配 Unity 的 `Blend One One`、`Blend SrcAlpha One, One One` 等结果，必须提供匹配背景参考让完整 WebGPU/WebGL2 后端在线性 HDR Scene 中求值，或由宿主在线性 HDR Render Target 中执行合成。当当前输出路径实际使用合成参考时，库会回到已知 Scene 的普通 `source-over` 最终输出，避免重复混合。仅保存参考源、但当前路径尚未使用它时，不会因此撤销宿主混合。

亮底过曝的根因和 DOM Add 选择规则见 [DOM Add 亮底过曝回归复盘](https://github.com/CialloKing/ba-click-fx/blob/main/docs/dom-add-light-background-regression.md)。使用 `screen` 处理未知中高亮背景，使用 `plus-lighter` 前先确认宿主是黑色或暗色；不要通过降低 Bloom 强度掩盖宿主合成问题。

`isolatedCompositing` 默认是 `false`，各 Canvas 直接挂载到目标容器或页面。设为 `true` 后，库拥有的主特效层、WebGPU/WebGL2 层和浅色背景兼容层会先在透明隔离组内解析，再将整个组覆盖到页面上，避免浏览器分别把兼容层与纯白页面合成后丢失蓝青色对比。默认 `source-over` 合同不会在外层再次混合；只有显式选择独立完整载荷时，完整图层组才执行一次所选的 `screen` 或 `plus-lighter`。隔离合成是非游戏的网页白底兼容选项，可通过 `updateConfig()` 在运行时切换。

若 `target` 是已有的 `HTMLCanvasElement`，库无法安全插入完整特效、Bloom、对比和隔离所需的额外 DOM 图层，因此完整特效的 `'webgpu'` / `'webgl2'` / `'auto'` 会回退 `canvas2d`，Bloom 的 `'webgl2'` / `'auto'` 会回退原生辉光，`isolatedCompositing` 也会被强制降级为 `false`。`getConfig()` 中的 `effectBackend` / `bloomBackend` 保留请求值，实际后端请读取 `resolvedEffectBackend` / `resolvedBloomBackend`。直接传入的 `OffscreenCanvas` 是一个有意支持的例外：纯 WebGL2 可以直接拥有该画布，显式 `'canvas2d'` 也可以工作，但无法使用依赖 DOM/CSS 多图层的 WebGPU、隔离合成等能力。外部 Canvas 的 CSS 和最终宿主合成始终由调用方负责。默认全屏覆盖层不受 `HTMLCanvasElement` 限制；普通容器也可以使用，但必须自行建立定位上下文（通常设置 `position: relative`）。

隔离根按 `BAClickFX` 实例独立创建和销毁。同一页面的多个隔离实例不会跨根混合内部兼容层；一个实例切换模式或销毁也不会移动、删除其他实例的 Canvas。

保留 `scene` 输出的纯白网页可选择隔离合成作为兼容方案；只有在 `outputCompositing: 'scene'` 下仍需额外清晰轮廓时，再按需提高浅色背景兼容层：

```js
const fx = new BAClickFX(
{
  isolatedCompositing: true,
  lightBackgroundContrastAlpha: 0.35,
});
```

透明桌面宿主推荐显式固定完整 WebGL2 与透明覆盖层输出，并关闭非游戏的浅色轮廓层：

```js
const fx = new BAClickFX(
{
  effectBackend: 'webgl2',
  bloomBackend: 'webgl2',
  outputCompositing: 'browser-overlay',
  overlayAlphaPolicy: 'coverage',
  overlayColorCompensation: 'none',
  overlayAlphaLimit: 250 / 255,
  hostCompositing: 'source-over',
  hostCompositingSurface: 'transparent-window',
  lightBackgroundContrastAlpha: 0,
});
```

若要接近 v1.2.15 的透明遮挡观感，可把 `overlayAlphaPolicy` 改为 `'visual-max'`；这只改变独立 Coverage/Bloom 传输量之间的 Alpha 分配，不会从 `maxRGB` 生成 Alpha。未知浅色桌面若更重视高能核心可见性，可另行把 `overlayColorCompensation` 改为 `'bright-core'`，无需同时改变 Alpha 策略。支持 DOM 混合的未知亮底宿主可设置 `hostCompositing: 'screen'`；已知黑色或暗色宿主才建议使用更激进的 `'plus-lighter'`。两者都忽略 Alpha 策略、颜色补偿和 Alpha 上限，且都只是 SDR 近似。

这些兼容选项的职责彼此独立：`isolatedCompositing` 只决定多张库自有 Canvas 是否先在一个透明组内合成，不读取页面或桌面像素；`lightBackgroundContrastAlpha` 只在 `scene` 输出下增加非游戏的 `darken` 轮廓，在 `browser-overlay` 下会被忽略；`setCompositingReference()` 才会把一张已知的不透明栅格参考送入渲染管线。它们不能互相替代。

## 合成参考与线性合成

`setCompositingReference()` 可把特效下方真实且不透明的栅格参考交给渲染器；它不设置或修改宿主页面 CSS 背景。`scene + setCompositingReference()` 是已知背景的精确路径：只有 WebGPU、纯 WebGL2，或成功解析到 GPU 的 WebGL2 Bloom，收到与实际显示内容逐像素匹配的已知参考时，才能在渲染合同内声明最终 RGB Scene 按 Unity 线性 HDR 管线严格求值。原生辉光使用 Canvas Final Pass；软件 Bloom 仍使用普通 DOM 背景路径，这些能力受限的回退实现不能宣称与完整 GPU Scene 或 Unity 逐像素等价。

透明桌面下的真实桌面通常对库不可见。调用 `setCompositingReference(null)` 清除参考，或从未提供参考时，渲染器进入未知背景路径，只能输出带 Alpha 的覆盖层，再由操作系统或宿主合成；未知背景无法在数学上复现 Unity 对已知不透明 HDR Scene 的逐像素结果。`browser-overlay` 的目标是让 Alpha 始终来自独立的 Coverage/Bloom 传输量，并通过 `overlayAlphaPolicy` 显式选择它们的分配方式，而不是绕过这一信息边界。

标准预乘 `source-over` 满足 `Cout = Coverlay + Cbackground × (1 - A)`；严格 Unity 加色的目标则是 `Cbackground + E`。因此所需的 `Coverlay = E + A × Cbackground` 依赖库无法读取的背景。对未知背景，单张透明覆盖层不可能同时保证严格 Unity 加色、最终 Alpha 只表示 Coverage、以及在纯白背景上绝不变暗。`browser-overlay + overlayAlphaPolicy: 'coverage'` 明确优先保持 Coverage 传输和与跨后端连续性；`'visual-max'` 只提供 v1.2.15 风格的低遮挡视觉近似。需要严格 Scene RGB 时，应使用默认 `scene` 并通过 `setCompositingReference()` 提供逐像素匹配的已知参考。

实现不会用 `min(coverage, maxRGB)` 把最终 Alpha 限制到当前 RGB 亮度。该近似虽然能减少部分白底压暗，却会把发射亮度重新解释为遮挡率，使黑色或低能拖尾丢失 Coverage，并破坏 `opacity` 线性和后端切换连续性。

解包 Shader 中 Additive 的目标 Alpha 固定为 `1`，Dissolve 也有独立的 Alpha 混合因子；这些值描述的是粒子写入游戏不透明相机目标时的缓冲合同，不是透明桌面窗口的遮挡率。未提供匹配背景时若机械复制这些 Alpha，粒子 Quad 会变成不透明矩形。因此无背景的 `scene` Final Pass 使用能承载预乘 RGB 的传输 Alpha，`browser-overlay` 则按所选策略组合清晰 Coverage 与 Bloom 传输 Alpha；两者都不宣称复现 Unity 相机目标中对最终画面无可见影响的 Alpha。严格一致声明只针对上一段限定条件下的最终 RGB。

```js
const image = new Image();
image.crossOrigin = 'anonymous';
image.src = 'https://example.com/background.jpg';
await image.decode();

fx.setCompositingReference(image, { fit: 'cover' });
// 清除合成参考，进入未知背景路径；不会修改宿主页面 CSS 背景。
fx.setCompositingReference(null);
```

当前只支持居中 `cover`，裁剪规则与 CSS `background-size: cover` 对齐。调用方负责图片解码和 CORS：跨域服务器必须允许匿名读取，否则 WebGL 无法上传纹理，方法会返回 `false` 或候选后端保持安全回退。传入 `null` 会清除参考并释放仅供 Canvas Final Pass 使用的全尺寸帧资源。Renderer 会保留已接受的参考源以支持 WebGL Context 恢复，因此在替换参考或销毁实例前不要关闭 `ImageBitmap`、`VideoFrame` 等可释放源。Canvas、Video 等动态源在调用时上传当前帧；内容变化后应再次调用。

展示页的“本地图片”选择器会把 `File` 转成当前文档的 `blob:` URL，再分别设置 CSS 页面背景和 `setCompositingReference(image)`，因此不需要外部服务器提供 CORS。该 URL 只在当前页面会话有效，不会写入 `localStorage`，切换背景或卸载页面时会被释放；刷新页面后需要重新选择文件。手输的 `file://` URL 会作为普通自定义背景文本保存，并交给允许读取本地协议且允许作为 Canvas/WebGL 纹理使用的受信任桌面宿主；普通 HTTP/HTTPS 页面仍受浏览器本地资源权限限制，应使用选择器。

模式切换会释放闲置后端的全尺寸纹理和 FBO，但保留 WebGL Context、Program、静态纹理与已接受的合成参考源；重新启用时只重建当前尺寸需要的帧资源。参考切换是跨 Renderer 的原子操作：任一已创建后端拒绝新源时，库会回滚到旧参考，无法回滚的候选实例会被丢弃并在需要时懒重建。

## 效果说明

### 点击特效

| 元素 | 表现 |
|---|---|
| 中心光盘 | 白色→蓝色渐变短圆盘，快速扩张后消散，持续 200ms |
| 溶解圆环 | 2 枚旋转环带，弧线从完整逐渐缩短至消失，持续 600ms |
| 点击碎片 | 4 枚三角形粒子从点击位置飞溅，脉冲闪烁 |

圆环的 `radiusMin` / `radiusMax` 是从 MeshTri 的 Start Size 与相机比例换算出的外半径基准值；实际外半径还会乘 Unity 生命周期大小曲线。默认 `widthStart` / `widthEnd` 均为 `1`，只调节资源环宽，实际环宽始终按 `外半径 × 0.0598573766 × 环宽倍率` 计算。

原 Shader 使用 `Blend SrcAlpha One, One One`。ParticleSystemRenderer 的 Apply Active Color Space 会把启用的 Color over Lifetime 顶点色解码到 Linear，再与 `FX_MAT_Touch_Tri3` 的白色 5.992157 HDR 材质相乘。溶解不是连续压低所有像素的透明度，而是以阈值处理二维纹理 Alpha；通过测试的像素继续保留纹理覆盖率。完整 WebGL2 在 Fragment Shader 中按原 UV 对 Ring3 执行 Bilinear + Clamp 采样后硬裁剪，不再插值 96×8 网格顶点的预采样 Alpha。大小和溶解阈值均使用资源关键帧及其入/出切线执行 Unity 三次 Hermite 插值，而不是线性插值或通用 smoothstep。

Ring (3)/(4) 碎片还会在线性空间乘 `startColor = 0.5377358`，因此白色阶段的实际峰值能量约为 `1.50`，而不是直接使用材质的 `5.99`。三角形按 `FX_TEX_Triangle_02_1` 的两个图集帧随机朝向，轮廓面积与生命周期尺寸曲线也来自资源，不再使用偏大的等边三角形近似。

### 拖尾轨迹

拖尾按 Unity 原资源的同一条渲染链复现：

| 层 | 说明 |
|---|---|
| 几何带与亮芯 | 直接绘制原始 2.7px HDR 几何带，再由 Bloom 自然扩张为柔和亮芯 |
| Gradient 与 Stretch UV | Gradient 按网页的旧点→新点顺序反转；纹理 U 单独按 `1 - progress` 映射，使 Unity 的 `U=0` 仍位于最新点 |
| 完整 WebGL2 纹理 | 上传完整 `512×512 RGB` 的 `FX_TEX_Trail_03`，按原 sRGB、Bilinear、Repeat、无 Mipmap 设置在 Fragment Shader 逐片元采样；sRGB 解码到 Linear 后再乘 Gradient 与材质强度 `23.968628` |
| Canvas 兼容纹理 | 软件 Bloom 和原生辉光使用紧凑二维 LUT 近似纵向亮度、横向羽化与非零边缘，避免逐三角软件纹理栅格化造成卡顿 |
| Bloom | 对圆环、圆盘、拖尾和三角碎片的 HDR 发射缓冲使用所选 Bloom 后端 |

纯 WebGL2 与成功解析到 GPU 的 WebGL2 Bloom 使用同一完整纹理批次：普通段只提交两个纹理三角，圆角插入点保持折点 U，单三角端帽的尖端固定为 `V=0.5`。完整 RGB 纹理保留原资源无法由对称单通道轮廓表达的逐通道与上下非对称细节；Canvas 能力受限路径只保证参数、几何、生命周期和总体能量关系，不宣称逐纹理像素等价。

碎片沿轨迹按距离散布。

### Bloom 渲染后端

WebGPU 后端使用独立 WGSL Scene、`rgba16float` 发射目标和多级 Bloom 金字塔，并复用 WebGL2 已经验证的 CPU 粒子网格构建逻辑。它不会创建 WebGL Context，也不会上传一份 Canvas 2D 中间图；Scene、预过滤、下采样、累积上采样和 Final Pass 都由 WebGPU 提交。Final Pass 在 `extended` 模式把线性 RGB 编码为扩展 sRGB 且不截断超白值，在 `standard` 模式执行限制到 SDR 范围的同一编码和现有透明输出合同。

纯 WebGL2 与 WebGL2 Bloom 共用 `WebGL2EffectRenderer`、HDR 发射参数和 Bloom 配置，并在 GPU 上构建圆环、光盘、拖尾与碎片 Scene；成功帧在一次 Final Pass 中输出清晰层、Coverage 与 Bloom。WebGL2 Bloom 仍保留独立的兼容回退链，但不再生成或上传隐藏的 8 位 Canvas Scene。

Bloom 的阈值、曝光换算、mip 金字塔和累积式上采样遵循 Unity `Hidden/MXFinalBloom` 合同。需要修改这些数学或像素基线时，请先阅读 [Bloom Intensity 13.6 倍过曝回归复盘](https://github.com/CialloKing/ba-click-fx/blob/main/docs/bloom-intensity-regression.md) 与 [Bloom 上采样纹理反接回归复盘](https://github.com/CialloKing/ba-click-fx/blob/main/docs/bloom-upsample-order-regression.md)。

WebGPU 可用性由实际申请 Adapter/Device、创建 `webgpu` Canvas Context 和资源管线决定；HDR 输出再由 `rgba16float + toneMapping: extended` 的实际 `configure()` 结果独立决定。WebGL2 可用性由创建 Context、检查 `EXT_color_buffer_float` 并验证 `RGBA16F` 帧缓冲决定。完整特效使用 `effectBackend` / `resolvedEffectBackend`，WebGPU 输出使用 `resolvedWebGPUOutputMode`，Bloom 使用 `bloomBackend` / `resolvedBloomBackend`；首次异步探测、首帧提交和恢复验证期间会短暂返回 `pending`。Device 或 Context 丢失时旧 GPU Canvas 立即撤下，下一条后端资源链验证成功后才重新接管。

### JavaScript 软件 Bloom

仅在显式选择 `bloomBackend: 'software'` 时，软件后端会把 HDR 发射亮度绘制到全视口遮罩，使用可复用的 Float32 mip 缓冲在 JavaScript 中近似 MXFinalBloom；像素读回/写回不可用时，圆环和光盘退回原生多尺度光晕，拖尾在局部离屏缓冲中模糊。该路径保留参数、几何、生命周期和总体能量关系，但受 8 位 Canvas 输入与预乘 Alpha 限制，不能宣称与完整 GPU Scene 逐像素等价。其阈值、曝光和上采样合同与上面的 Bloom 复盘文档同步。

默认的 `isolatedCompositing: false` 让输出层直接与 DOM 背景合成；在纯白背景上，Unity 加色结果必然失去颜色和对比度。设为 `true` 后，各输出层会先在透明组内合成，再将带颜色与 Alpha 的结果覆盖到页面。这不会改变 Bloom 算法，只是用于纯白网页背景的非游戏兼容路径。需要按游戏方式让背景参与线性 Scene 计算时，应使用 `setCompositingReference()`，而不是把隔离合成当作背景采样替代品。

`lightBackgroundContrastAlpha` 默认是 `0`，因此不会创建游戏资源之外的可见轮廓。设为 `0.35` 时，库拥有的覆盖层会在主特效层上方增加独立的 `darken` 淡青色遮罩；它不接收或产生 Bloom，只用于提升纯白背景上的清晰轮廓。该层与隔离合成都属于非游戏网页兼容选项。直接传入已有 Canvas 时既无法插入这层独立背景合成层，也会强制关闭隔离合成。

### 后端能力边界

| 路径 | 能力边界 |
|---|---|
| WebGPU Extended HDR | `rgba16float + toneMapping: extended` 成功时，Scene、Coverage 与 MXFinalBloom 保留在线性浮点管线中，最终 Canvas 可提交超过 SDR 白色的高光 |
| WebGPU Standard | WebGPU Scene 与 Bloom 仍在浮点管线中运行，但最终 Canvas 使用浏览器首选标准格式并压缩到 SDR；不能声称真实 HDR 输出 |
| 纯 WebGL2 | 默认选择器；在提供匹配背景时，把几何、Coverage、HDR Scene 与 MXFinalBloom 全部保留在同一浮点管线中 |
| WebGL2 Bloom | GPU 成功时复用与纯 WebGL2 相同的完整浮点 Scene；区别是保留 Canvas 2D 请求状态和 Native 失败回退合同 |
| 软件 Bloom | Bloom 金字塔使用 Float32 缓冲，但输入来自 8 位 Canvas；透明覆盖层只能用剩余 Coverage 近似承载 Bloom，不能独立保存任意 HDR RGB |
| 原生辉光 | 采样材质发射与溶解形状，按相同阈值和曝光生成 Canvas 多尺度近似；不具备完整 `RGBA16F` Scene 与逐像素累积上采样 |

因此，“严格根据 Unity 工程还原”指参数、纹理采样、曲线、混合意图及完整 GPU 已知 Scene 路径的实现依据；它不表示浏览器所有后端、任意网页背景和透明桌面合成都能逐像素等同游戏截图。回退链优先保证生命周期、几何关系、Coverage 单调性和可用性，不伪装缺失的 HDR Scene 或显示能力。

## 项目结构

```
ba-click-fx/
├── src/
│   ├── fx.js            # 主引擎：ParticleSystem + TrailRenderer 生命周期
│   ├── main.js           # 演示页面入口 + 控制面板 UI
│   ├── config.js         # Unity FX_Touch 粒子参数只读快照
│   ├── trail-texture.js  # WebGL2 无损 Trail_03 RGB 纹理数据
│   ├── software-bloom.js # MXFinalBloom Float32 mip 与加色合成
│   ├── webgpu-device.js   # WebGPU Adapter/Device 与 HDR Canvas 输出协商
│   ├── webgpu-effect.js   # WebGPU Scene、Bloom 金字塔与 Final Pass
│   ├── webgpu-shaders.js  # WGSL 几何与后处理 Shader
│   ├── webgl2-effect.js  # 纯 WebGL2 / WebGL2 Bloom 共享 Scene 与 Final Pass
│   ├── webgl2-canvas-scene.js # Native 的 Canvas Scene Final Pass
│   ├── webgl2-bloom.js   # WebGL2 Bloom 参考实现与回归基线
│   └── style.css         # 演示页样式
├── scripts/
│   ├── build.mjs         # 构建脚本
│   └── verify-*.mjs/cjs  # 发布校验脚本
├── test/
│   ├── smoke.js          # dist 运行时接线与生命周期验证
│   ├── source-contract.js # 源码入口与 Unity 资源静态合同
│   └── browser/          # 核心、生命周期、Demo 与 Unity 浏览器门禁
├── index.html            # 演示页面
├── dist/                 # 构建输出
│   ├── ba-click-fx.js    # ESM 库
│   ├── config.js          # ESM 配置子入口
│   └── worker.js          # ESM Worker 子入口
└── package.json
```

### 架构特点

- **隔离合成层**：默认关闭；可显式启用透明隔离组，改善非游戏纯白网页背景上的颜色保留
- **WebGPU Scene**：异步申请 Device，使用 `rgba16float` 线性 Scene 与 WGSL Bloom；普通模式固定 Standard SDR，HDR 模式仅在 `extended` 成功时保留真实超白输出，Device 失败时回退 WebGL2
- **纯 WebGL2 Scene**：完整几何、Coverage、背景与 MXFinalBloom 在一个 HDR 管线中完成并一次输出
- **Canvas Scene Final Pass**：原生辉光复用 Canvas 生成的 Scene 近似；提供场景背景时统一执行背景衰减与颜色编码，但不宣称具备完整 WebGL2 的浮点精度
- **主特效层**：Canvas 路径内部以 `lighter` 累积发射能量，最终覆盖层使用预乘 Alpha 输出，避免 CSS 二次加亮
- **浅色背景兼容层**：默认强度为 0；可显式设为 0.35，使用不参与 Bloom 的 `darken` Canvas 提升纯白背景可见性
- **软件 Bloom**：全视口工作画布 + Float32 MXFinalBloom 金字塔；像素读回不可用时回退原生多尺度光晕
- **WebGL2 Bloom**：兼容选择器在 GPU 成功时复用完整 WebGL2 Scene，不重复栅格隐藏 Canvas；能力不足时直接回退原生辉光
- **资源生命周期**：WebGPU Device 或 WebGL Context 丢失立即回退；模式切换释放全尺寸帧目标并保留仍可复用的静态 GPU 资源
- **按需渲染**：无活跃特效时自动停止 `requestAnimationFrame`
- **零外部依赖**：仅使用浏览器原生 Canvas 2D / WebGL2 / WebGPU API，不引入第三方运行时
