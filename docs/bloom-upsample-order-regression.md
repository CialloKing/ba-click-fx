# Bloom 上采样纹理反接回归复盘

本文记录 Bloom 光晕近场偏硬、外层呈异常圆形雾层的根因、修复过程和长期维护规则。凡是修改 Bloom mip 命名、Upsample Pass、纹理绑定、`texelSize` 或像素基线，都应先阅读本文。

## 结论

异常不是 `Intensity`、`Threshold` 或 `Diffusion` 数值写反，而是反向金字塔中的两张纹理角色反接。

游戏每次上采样执行：

```text
result = FourTap(accumulatedCoarse, accumulatedCoarseTexel, SampleScale)
       + Center(currentFine)
```

- `accumulatedCoarse` 是上一轮已经累积好的粗级结果，对应 Unity 的 `lastMip` 和 Shader `_MainTex`；
- `currentFine` 是本轮当前分辨率的 down mip，对应 `mipDown[index]` 和 Shader `_BaBloomTex`；
- 输出尺寸与 `currentFine` 相同；
- 四点偏移必须使用 `accumulatedCoarse` 的 `texelSize`。

回归实现恰好相反：它对当前细级做四点采样，只对累计粗级做中心采样。这会重复抹宽近场细节，同时中断累计低频能量应有的逐级扩散，因此不能靠降低 Bloom 强度或修改 Diffusion 掩盖。

## 视觉症状

本次用户截图的主环半径约为 `86px`。以主环半径 `R` 归一化后，蓝通道圆周中位数为：

| 径向区间 | 回归截图 | Unity 100–180ms 参考包络 |
|---|---:|---:|
| `1.35–1.75R` | `84` | `65–71` |
| `1.75–2.25R` | `54` | `43–47` |
| `2.25–3R` | `29` | `24–27` |
| `3–4R` | `7` | `6–11` |

近中场明显偏强，而远尾仍处于参考包络。这说明问题是能量在 mip 间的空间分配错误，不是所有半径同时按同一倍率过曝。典型观感包括：

- 清晰亮环周围形成偏硬、偏厚的亮带；
- 中近场出现近乎均匀的大圆雾层；
- 外晕层次与清晰几何脱节；
- 调低 Intensity 虽会整体变暗，但错误衰减形态仍然存在。

## Unity 依据与参考优先级

权威审计工程为：

```text
D:\WebProjects\BA鼠标输入与点击特效系统\UnityMouseFxLab\UnityMouseFxLab
```

关键证据：

- `Assets/Scripts/BaGameBloomRendererFeature.cs` 将当前细级 `mipDownIds[index]` 绑定到 `_BaBloomTex`，并以累计粗级 `lastMipId` 作为 Blit Source；
- `Assets/Shaders/BaGameBloom.shader` 对 Blit Source `_MainTex` 做 SampleScale 四点采样，再中心采样 `_BaBloomTex` 并相加；
- `Reference/光晕还原审计.md` 记录了机器码核对结果、逐级尺寸和径向参考包络；
- `PackagingHistory_20260726` 下的 `stage_current` 与 `verify_final_project` 保留同一审计结论。

下列旧重建工程不是本合同的权威来源：

```text
D:\WebProjects\BA鼠标输入与点击特效系统\提取资产2\BA_FX_Touch_UnityProject
```

该 2026-07-24 重建仍保留反接版本。以后出现冲突时，应以 2026-07-26 的 `UnityMouseFxLab`、PackagingHistory 和机器码审计记录为准，不能从旧重建复制 Upsample 绑定。

## 为什么容易写反

1. Unity 的变量名是 `_MainTex`、`_BaBloomTex` 和 `lastMip`，只看 Shader 无法直观看出各自来自哪一级。
2. “high mip / low mip”存在两种相反口径：既可指分辨率高低，也可指 mip 索引高低。
3. 四点核的加法满足交换律，均匀输入和最终总能量测试无法区分两张纹理的角色。
4. 像素基线只能记录当前输出；若先校准，它会把错误的径向分布固化为新基线。
5. 旧重建工程也包含反接实现，单纯按文件时间之外的目录名选择参考会再次引入回归。

因此，网页代码不再使用 `high` / `low` 表示这两个输入，而统一使用：

```text
currentFine
accumulatedCoarse
accumulatedCoarseTexel
```

## 回归经过

| 阶段 | 提交 | 结果 |
|---|---|---|
| 原正确实现 | `3358756^` | 当前细级中心采样，累计粗级四点扩散 |
| 再次引入 | `3358756` | 因 high/low 语义误判，将两张纹理和 texelSize 反接 |
| 正式修复 | `d73297d` | 三条后端恢复 Unity 顺序，改用无歧义命名并加入非对称脉冲门禁 |

## 修复范围

三个执行路径必须保持相同合同：

- `src/webgl2-effect.js`：完整 WebGL2 Scene、Coverage 与 Bloom；
- `src/webgl2-bloom.js`：独立 WebGL2 Bloom 兼容路径；
- `src/software-bloom.js`：Float32 RGB 金字塔与透明输出的 Coverage 传输金字塔。

WebGL2 每轮必须绑定：

```text
u_accumulatedCoarse      <- accumulatedCoarseTexture
u_currentFine            <- fineLevel.down.texture
u_accumulatedCoarseTexel <- 1 / accumulatedCoarseLevel.size
render target            <- fineLevel.up
```

Software Bloom 必须使用完全相同的空间核。Coverage 传输 Alpha 也要跟随 RGB 的 mip 加法链，否则透明覆盖层会生成不同于可见 Bloom 的轮廓。

## 永久回归门禁

均匀场不能识别输入反接，因为四点均值和中心采样的结果相同。测试必须至少包含两个非对称输入：

1. `2×2` 累计粗级左上角红色脉冲为 `4`，`4×4` 当前细级为零。首行应约为：

   ```text
   [2.35736346, 1.58967817, 1.48106349, 0.71337807]
   ```

   这固定了累计粗级使用 `SampleScale / 2` 四点偏移。

2. `4×4` 当前细级左上角红色脉冲为 `8`，累计粗级为零。前两像素必须为：

   ```text
   [8, 0]
   ```

   这固定了当前细级只做中心采样，不会被再次扩散。

源码合同测试还要同时检查两份 WebGL2 Shader 与纹理绑定，不能只检查最终 `a + b` 或重新校准浏览器截图。

## 修改 Bloom 上采样时的检查清单

- [ ] 已确认参考来自 `UnityMouseFxLab` 或 2026-07-26 PackagingHistory，而非旧 `提取资产2` 重建。
- [ ] `accumulatedCoarse` 是四点采样输入。
- [ ] 四点偏移使用累计粗级的 `texelSize`。
- [ ] `currentFine` 只做中心采样。
- [ ] 输出尺寸与当前细级一致。
- [ ] Full WebGL2、WebGL2 Bloom、Software RGB 和 Software Coverage 同步修改。
- [ ] 粗级脉冲与细级脉冲数值断言均通过。
- [ ] 未用 Intensity、Diffusion、材质 HDR 或全局缩放补偿错误形态。
- [ ] 未在确认 Unity 合同前运行 `--calibrate`。
- [ ] 已在黑色已知 Scene 上检查归一化径向衰减。
- [ ] 已执行下列命令并全部通过。

```powershell
npm run test:bloom
npm run check:release
```

需要重新校准浏览器基线时，只能在上述检查完成后执行：

```powershell
npm run test:browser:built -- --calibrate
git diff -- test/browser/baseline.json
npm run test:browser:built
```

## 快速排查命令

```powershell
rg -n "accumulatedCoarse|currentFine|_renderUpsample|upsampleBoxAndAdd" src test
git show 3358756
git show d73297d
```

如果未来游戏版本改变了 Upsample 合同，应先更新 Unity 机器码或运行时抓帧证据，再修改三条网页路径与非对称脉冲测试。不得仅凭旧重建代码、变量名或一张已校准截图改变输入顺序。
