# Bloom Intensity 13.6 倍过曝回归复盘

本文记录 `ba-click-fx` 1.2.17 中 Bloom 变成大面积白色光团的原因、修复过程和长期维护规则。凡是修改 Bloom 参数、Final Pass、Shader uniform、后端切换或浏览器像素基线，都应先阅读本文。

## 结论

`bloom.intensity = 1.7` 是 Unity 面板和资源中的序列化曝光刻度，不是可以直接传给 Shader 的线性倍率。

游戏在 CPU 绑定 Shader 参数前执行：

```text
shaderIntensity = 2^(serializedIntensity / 10) - 1
```

默认值的结果为：

```text
serializedIntensity = 1.7
shaderIntensity     ≈ 0.125058484688809
错误放大倍数        = 1.7 / shaderIntensity
                    ≈ 13.5936398416
```

因此，把 `1.7` 直接乘入 Final Pass 会把 Bloom 能量放大约 13.6 倍。网页最终输出还会钳制到 SDR 范围，蓝色光盘和光晕便会形成大面积白色饱和平台。

## 为什么这个错误容易重复出现

1. 资源和配置里能看到的值确实是 `1.7`，很容易被误认为 Shader 倍率。
2. Final Shader 对 `_Bloom_Settings.y` 做线性乘法，但真正的曝光换算发生在更早的 C# 参数绑定阶段。只看 Shader 会漏掉 CPU 合同。
3. 三个网页后端分别提交最终强度；只修一条路径会造成 WebGL2、Software 和回退链观感不一致。
4. 浏览器像素基线只能检测“实现是否变化”，不能证明“实现是否符合 Unity”。如果先校准基线，错误画面也会被记录成新的正确值。
5. 纯白背景、透明覆盖层和 CSS 合成会改变可见对比度，容易掩盖真正的 HDR 数值错误。

## Unity 依据

本次审计使用外部工程：

```text
D:\WebProjects\BA鼠标输入与点击特效系统\UnityMouseFxLab\UnityMouseFxLab
```

关键证据：

- `Assets/Scripts/BaGameBloomRendererFeature.cs` 的 `ConvertIntensity()` 在设置 `_Bloom_Settings.y` 前执行曝光换算。
- `Assets/Shaders/BaGameBloom.shader` 只消费换算后的 `_Bloom_Settings.y`；Shader 中的线性乘法不代表序列化值可以直接传入。
- `Reference/光晕还原审计.md` 记录资源序列值 `Intensity = 1.7`，并确认 Composite 使用曝光式 Intensity。

对应 JavaScript 必须保持：

```js
Math.expm1(intensity / 10 * Math.LN2)
```

使用 `Math.expm1()` 是为了在强度接近零时避免 `Math.exp(x) - 1` 的精度损失。

## 回归经过

| 阶段 | 提交 | 结果 |
|---|---|---|
| 首次处理 | `59bd4ec` | 已识别浏览器 Final Pass 缺少 Unity 相机后续 HDR 输出，恢复曝光换算 |
| 建立门禁 | `4b86643` | 提取共享曝光函数，并加入 `1.7 -> 0.125058` 的独立数值断言 |
| 门禁削弱 | `6fc391c` | 保留内联换算，但删除共享函数和独立数值断言，使后续语义改写更难被发现 |
| 再次引入 | `83d3488` | 三个后端改为直接使用 `1.7`，Bloom 能量增加约 13.6 倍 |
| 错误固化 | `44f2259` | 在过曝实现上重新校准 Chromium 基线，白色饱和被误记为正常输出 |
| 正式修复 | `9c61953` | 新增统一换算函数，三后端恢复 CPU 曝光合同 |
| 基线恢复 | `8ca8e57` | 按修复后的真实 Chromium 输出重新校准像素合同 |

这段历史说明：像素基线变更必须有 Unity CPU、Shader 或资源证据，不能只以“新输出稳定”为理由接受。

## 修复过程

### 1. 固定症状，暂不校准基线

首先保留失败截图和旧像素差异。典型症状是：

- 点击中心由蓝色变成白色；
- 多个径向采样点连续达到最大 Alpha；
- 光晕面积和平均 Alpha 同时明显增加；
- Software Bloom 的高能输入几乎全部编码为白色。

此时不得先运行 `--calibrate`，否则会丢失回归信号。

### 2. 沿完整数据流核对语义

核对顺序必须是：

```text
Unity 序列化资源
  -> C# Renderer Feature
  -> MaterialPropertyBlock / Shader uniform
  -> Bloom Composite Shader
  -> 浏览器最终输出
```

不能从 Shader 中的乘法反推面板值就是线性倍率。

### 3. 计算预期倍率

把序列值 `1.7` 分别代入正确公式和错误直传路径，得到约 13.5936 倍差异。这个数量级与截图中的大范围白色饱和一致，从而排除投影尺度和上采样核是主要原因。

### 4. 在单一边界集中换算

换算集中在 `src/bloom-color-space.js` 的 `resolveUnityBloomIntensity()`。配置、公开 API 和 `getConfig()` 继续保存序列值 `1.7`；只有 CPU 向最终合成阶段提交参数时才转换。

三个消费者必须统一调用该函数：

- `src/software-bloom.js` 的最终 RGBA 编码；
- `src/webgl2-bloom.js` 的 `u_intensity`；
- `src/webgl2-effect.js` 的 `u_intensity`。

不得在配置创建、Shader 或调用方再次换算，否则会产生双重曝光转换。

### 5. 先锁数值，再更新像素基线

数值测试必须固定：

```text
resolveUnityBloomIntensity(1.7) ≈ 0.12505848468881
```

同时保留高能 HDR 输入的确定 RGBA8 输出，确保它不会退化成整片 `[255, 255, 255, 255]`。

只有数值测试、Unity 证据和三后端实现都确认后，才能更新浏览器像素基线。

### 6. 在真实浏览器和黑底上复核

本次修复后的 Full WebGL2 回归信号：

| 指标 | 错误直传 `1.7` | 修复后 |
|---|---:|---:|
| 中心 RGB | `[0.835294, 1, 1]` | `[0.262745, 0.352941, 0.788235]` |
| 平均 Alpha | `0.036873` | `0.014395` |
| 可见边界 | `96 x 96` | `91 x 90` |

最终还要在黑色已知 Scene 上点击检查：应看到小范围蓝色光盘、细圆环、碎片和柔和外晕，不能出现截图所示的大面积白色光团。

## 永久维护规则

1. `bloom.intensity` 在配置层永远表示 Unity 序列化曝光刻度。
2. `resolveUnityBloomIntensity()` 是唯一允许的曝光换算入口。
3. 所有最终 Bloom 后端必须恰好换算一次。
4. 不得因 Shader 内是线性乘法而删除 CPU 换算。
5. 不得用降低材质 HDR、改变投影尺度或修改上采样核来掩盖 Intensity 过曝。
6. 浏览器基线失败时先查实现和 Unity 证据，最后才考虑校准。
7. 校准后必须审查 `test/browser/baseline.json`；中心 RGB 接近全白、径向连续饱和或平均 Alpha 倍增都属于阻断信号。
8. 修改强度语义时必须同时检查 Software Bloom、WebGL2 Bloom 和完整 WebGL2。

## 修改 Bloom 时的检查清单

- [ ] 已核对 Unity C# 参数绑定，而不只是 Shader。
- [ ] `bloom.intensity` 的公开配置值仍为序列值 `1.7`。
- [ ] `resolveUnityBloomIntensity(1.7)` 仍约等于 `0.12505848468881`。
- [ ] 三个最终后端均调用统一换算函数，且没有双重换算。
- [ ] 高能 Software Bloom 数值测试没有退化成全白。
- [ ] 未在调查开始时运行浏览器基线校准。
- [ ] 已审查像素基线中的中心 RGB、径向 Alpha、平均 Alpha 和边界。
- [ ] 已在黑色已知 Scene 上与 Unity 参考截图检查形态和衰减。
- [ ] 已执行下列命令并全部通过。

```powershell
npm run test:bloom
npm run check:release
```

需要重新校准时，只能在上述检查完成后执行：

```powershell
npm run test:browser:built -- --calibrate
git diff -- test/browser/baseline.json
npm run test:browser:built
```

## 快速排查命令

检查强度的所有使用位置：

```powershell
rg -n "settings\.intensity|bloom\.intensity|u_intensity|resolveUnityBloomIntensity" src test
```

查看这次回归与修复：

```powershell
git show 83d3488
git show 4b86643
git show 6fc391c
git show 9c61953
git show 8ca8e57
```

如果未来 Unity 工程或游戏版本改变了 CPU 合同，应先添加新的来源证据和数值测试，再修改统一换算函数；不得让单个后端自行解释序列化参数。
