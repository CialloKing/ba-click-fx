# DOM Add 亮底过曝回归复盘

本文记录 `ba-click-fx` 1.2.17 在“透明覆盖层 + DOM Add（近似）+ 未知透明背景”下出现白核和光晕过亮的原因、修复过程与永久门禁。凡是修改 `hostCompositing`、透明载荷、CSS 混合模式、合成参考或亮底浏览器像素基线，都应先阅读本文。

## 结论

这次问题不是 Bloom 强度再次放大，也不是 Scene/Bloom 被重复绘制。根因是把一张已经从 Linear 编码到 sRGB 的独立特效载荷，再用 CSS `plus-lighter` 加到同样已编码的页面背景上。

设：

- `B` 为线性背景；
- `E` 为线性特效与 Bloom 能量；
- `f()` 为 Linear 到 sRGB 的编码；
- `clamp()` 为 SDR `0..1` 钳制。

Unity 已知 Scene 的最终结果是：

```text
Unity = f(B + E)
```

旧 DOM Add 的结果是：

```text
plus-lighter = clamp(f(B) + f(E))
```

`f()` 在主要显示范围内是凹函数，因此 `f(E)` 作为独立增量只在黑底成立；只要背景不是黑色，它就系统性偏大。背景越亮，结果越早到达白色饱和平台。

## Unity 依据

本次审计使用外部解包对照工程：

```text
D:\WebProjects\BA鼠标输入与点击特效系统\UnityMouseFxLab\UnityMouseFxLab
```

关键证据：

- `ProjectSettings/ProjectSettings.asset` 使用 Linear Color Space。
- `Assets/Scripts/BaGameBloomRendererFeature.cs` 先把已经完成的 Scene 复制进 UI HDR Render Target，再绘制 UI，最后对整份目标执行 Bloom。
- `Assets/Shaders/BaGameBloom.shader` 的 Composite 读取 Scene 与 Bloom，执行 `source.rgb += bloom` 后覆盖写回；Composite Pass 没有再次声明 `Blend One One`。
- `Assets/Shaders/BaTouchAdditive.shader`、`BaTouchAlphaBlendAdd.shader` 与 `BaTouchDissolve.shader` 的 Blend 描述粒子写入同一 HDR Scene 的方式，不是透明桌面窗口的最终合成公式。
- `Assets/Editor/BaFxTouchPreviewCapture.cs` 的审计链在 ARGBHalf/Linear 中完成渲染，最终才输出 ARGB32/sRGB。

因此，严格还原必须让真实背景在 Linear/HDR Final Pass 前参与计算。未知桌面背景不在网页覆盖层的可见范围内，数学上不可能由一张固定透明载荷对所有背景逐像素复现 Unity。

## 为什么不能降低 Bloom 强度

共享 `bloom.intensity` 已按 Unity CPU 合同从序列值 `1.7` 换算到约 `0.125058`。完整 WebGL2 的 Scene 与 Bloom 也只在线性空间合并一次。

若为了压低 `plus-lighter` 的亮底结果而调整下列任一项：

- `bloom.intensity`；
- 材质 HDR；
- Bloom mip 或上采样核；
- Final Pass 的共享发射倍率；

那么黑底、已知 Scene、拖尾和所有回退后端都会一起变暗，真正正确的游戏管线反而会被破坏。宿主背景参与的位置错误，必须在宿主合成边界解决。

## 修复方案

### 1. 新增 `screen` 宿主合同

`hostCompositing` 现在接受：

```text
source-over | screen | plus-lighter
```

`screen` 与 `plus-lighter` 都消费同一份独立完整载荷，并忽略 `overlayAlphaPolicy`、`overlayColorCompensation` 与 `overlayAlphaLimit`。区别只发生在完整图层组与宿主背景的最后一次混合。

对不透明背景，Screen 的有效增量可写成：

```text
screen = f(B) + f(E) * (1 - f(B))
```

它具有两个重要边界：

- 黑底保留完整 `f(E)`；
- 背景趋近白色时，新增亮度自动趋近零。

它仍不是 Unity Linear/HDR 的逐像素等价式，但对未知中高亮背景比固定 sRGB 加法稳定得多。

### 2. 展示页迁移现有 DOM Add 选项

展示页“DOM Add（近似）”从 `plus-lighter` 改为 `screen`。旧展示页可能在 `localStorage` 保存了 `plus-lighter`；加载时会迁移为 `screen`，避免升级后继续复现过曝。

公共 API 没有删除 `plus-lighter`。已知黑色或暗色宿主仍可显式选择它，现有集成不会因枚举值消失而失效。

### 3. 所有后端共享独立载荷判定

`isIndependentHostCompositing()` 集中定义 `screen` 与 `plus-lighter` 的共同载荷合同。完整 WebGL2、WebGL2 Bloom、Software Bloom、Native 和 Legacy 都使用该判定：

- 不重复生成 Coverage 层；
- 不套用 source-over 的颜色补偿和 Alpha 上限；
- 只在完整图层组根节点执行一次所选宿主混合；
- 外部 Canvas 的 CSS 所有权仍归调用方。

Canvas 回退没有 Unity 的浮点 Scene Final Pass，内部多贡献叠加仍是能力受限的近似；不能把它描述成与完整 WebGL2 或 Unity 逐像素等价。

### 4. 已知背景路径保持不变

当 `setCompositingReference()` 提供与页面逐像素匹配的背景时，完整 WebGL2 继续：

1. 把 sRGB 背景解码到 Linear；
2. 在线性 HDR Scene 中绘制粒子并合成 Bloom；
3. 统一编码最终画面；
4. 恢复 `source-over`，避免 Screen 或 Add 再执行一次。

这是项目中声明严格最终 RGB Scene 还原的路径，本次修复没有调低或改写它。

## 回归测试设计

旧测试只检查 Host Add “不压暗背景”和“存在可见增量”。这种下限断言无法识别大面积白色饱和；白底甚至被排除在可见增量断言之外。

新测试在 Edge/Chromium、DPR 1、固定随机种子、固定 `120ms`、默认 Unity Bloom 强度下，对同一个 `#b8b8b8` 亮灰目标做三路截图：

1. 未知背景 `screen`；
2. 未知背景 `plus-lighter`；
3. 匹配背景参考的完整 WebGL2 Scene 真值。

首先用 `opacity = 0` 证明 CSS 背景和 Scene 参考基线匹配；然后保持同一生命周期比较三路结果。320×240 有效区域的校准值为：

| 路径 | 平均正增量 | 高增量像素 | 白核像素 | 相对 Scene MAE |
|---|---:|---:|---:|---:|
| Known Scene | 0.4723 | 617 | 96 | 0 |
| Screen | 0.7144 | 606 | 92 | 0.2512 |
| Plus-Lighter | 1.7292 | 2330 | 562 | 1.2592 |

长期门禁同时限制：

- Screen 相对 Scene 的误差必须小于 Plus-Lighter 的 40%；
- 平均正增量必须保持在 `0.55..0.85`；
- 高增量像素保持在 `500..700`；
- 白核像素保持在 `60..130`；
- 任一通道饱和像素保持在 `400..560`；
- `screen`、`plus-lighter` 必须确实处于未知参考路径；
- Scene 真值必须确实由 WebGL2 活动参考参与渲染；
- Context 丢失、Canvas 回退和恢复后仍保持各自的宿主混合合同。

这些是有上下界的亮度和面积断言，不允许再次把过曝输出直接校准成“新基线”。

## 永久维护规则

1. 不得用 Bloom 强度、材质 HDR 或几何透明度掩盖宿主合成错误。
2. 展示页未知中高亮背景的 DOM Add 使用 `screen`；`plus-lighter` 只面向黑色或暗色宿主。
3. `screen` 与 `plus-lighter` 必须共享同一独立完整载荷，差异只在最终宿主混合。
4. 独立宿主混合只能在完整图层组根执行一次，子 Canvas 不得各自与桌面混合。
5. 已知参考激活时必须恢复 `source-over`，不得在精确 Scene 上再套 Screen/Add。
6. 未知背景路径只能声明 SDR 视觉近似，不能声明逐像素等价 Unity。
7. 浏览器回归必须包含中高亮背景的误差、白核面积、饱和面积和高增量面积上限。
8. 更新像素基线前必须先证明 Unity 对照、零特效背景参考和活动 WebGL2 路由都正确。

## 修改宿主合成时的检查清单

- [ ] 已核对 Unity 的完整 Scene、Bloom 与 Final Pass 顺序。
- [ ] 没有修改共享 Bloom 曝光换算或材质 HDR。
- [ ] `screen` 和 `plus-lighter` 仍使用相同独立完整载荷。
- [ ] 库自有 Canvas 只在完整根节点执行一次最终混合。
- [ ] 外部 Canvas 的 `mix-blend-mode` 没有被库改写。
- [ ] 已知参考仍强制有效 `source-over`。
- [ ] Screen/Plus 两路确实没有活动背景参考。
- [ ] Scene 对照确实由完整 WebGL2 活动参考渲染。
- [ ] 亮灰绝对亮度、白核、饱和面积和 MAE 门禁全部通过。
- [ ] Context 丢失/恢复仍覆盖 Screen 与 Plus-Lighter。
- [ ] 已执行下列命令并全部通过。

```powershell
npm run test:source
npm run test:bloom
npm run test:config
npm run test:browser
npm run check:release
```

## 快速排查命令

```powershell
rg -n "hostCompositing|screen|plus-lighter|u_hostAdditive" src test
git show 9c5ada9
git show ea96596
git show 599bb20
```

若未来宿主可以把真实桌面作为纹理提供给渲染器，应优先转入匹配背景参考的 Linear/HDR Scene 路径，而不是继续为未知背景增加新的经验亮度系数。
