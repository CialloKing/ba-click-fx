# 从源码构建固定参数的定制版本

[返回 README](../README.md) · [English](https://github.com/CialloKing/ba-click-fx/blob/main/docs/custom-build.en.md)

## 构建与配置

定制版本扩展现有 Vite 构建，复用完整版的输入、生命周期、几何和渲染实现。`npm run build` 仍生成完整版与演示页；带 `--profile` 时只生成 `dist-custom`，不会覆盖 `dist`，也不会把定制文件加入 npm 发布白名单。

需要 Node.js >=24，先在源码目录运行 `npm ci`。复制[Worker 配置示例](../examples/build-profiles/webgl2-worker.json)为自己的 `ba-click-fx.build.json`，然后运行：

```bash
npm run build -- --profile ba-click-fx.build.json
```

也可以直接构建[Native 点击版示例](../examples/build-profiles/native-click-dom.json)：

```bash
npm run build -- --profile examples/build-profiles/native-click-dom.json
```

配置的五个顶层字段如下。`backend`、`runtime` 必填，其余字段可省略。

| 字段 | 内容 |
|---|---|
| `backend` | `webgl2`、`webgpu`、`webgpu-hdr`、`webgl2-bloom`、`software`、`native` |
| `runtime` | `dom`、`manual`、`worker`；每个产物选择一种 |
| `features` | `click`、`trail`、`shards`、`bloom`、`compositingReference`；布尔值，默认全部开启 |
| `config` | 现有普通配置，如主题、尺寸倍率、DPR 上限、输出合成等 |
| `fxParams` | 现有参数 Schema 的路径补丁，如 `"bloom.intensity": 1.7` |

六种模式都可以选择三种接入方式。`webgl2-bloom` 与完整版一样复用完整 WebGL2 Scene；两者成功路径共享实现。`webgpu-hdr` 请求 Extended 输出，实际模式仍由设备和浏览器决定。

普通配置与特效参数沿用现有默认值、验证和归一化规则，最终值记录在 `build-info.json`。未知字段、被拒绝的参数及冲突配置会导致构建失败。以下字段由顶层选择决定，不能重复写入 `config`：`effectBackend`、`bloomBackend`、`webgpuPreferHdr`、`inputSource`、`clickEnabled`、`trailEnabled`。

关闭某功能后不能继续指定该功能的 `fxParams`。`hit`、`flare`、`disk`、`rings` 属于点击；`trailAlways: true` 与关闭拖尾冲突。手动 Canvas 和 Worker 不接受 `isolatedCompositing: true`。关闭 Bloom 会将最终强度固定为 0，并去掉相应工作。

## 产物与接口

`dist-custom` 包含一个自包含 `ba-click-fx.js`、同名顶层 ESM 类型声明、`build-info.json`、`modules.json`、`LICENSE` 和 `THIRD_PARTY_NOTICES.md`。构建信息包含版本、最终普通配置和特效参数、功能、依赖模块及脚本的 raw/gzip/Brotli 字节数。部署脚本与声明时保留许可证和第三方说明。

```js
import BAClickFX, { BAClickFX as NamedBAClickFX } from './ba-click-fx.js';
```

默认导出与命名导出是同一个类。类型声明直接支持上述相对 ESM 导入；定制产物不导出完整版的 Schema、配置工具或 Worker 子入口。

构造参数仅接受 `target`、`onError`，DOM 版本额外接受 `inputFilter`。数值、主题和后端在 profile 中确定，不能在构造时覆盖。

| 能力 | 可用接口 |
|---|---|
| 所有版本 | `resize`、`setPaused`、`clear`、`destroy`、`getConfig`、`getFxConfig`、`getEffectiveHostCompositing` |
| 开启点击 | `boom` |
| 开启拖尾 | `clearTrail` |
| 手动/Worker，且开启点击或拖尾 | `pointerDown`、`pointerMove`、`pointerUp`、`pointerCancel` |
| 开启合成参考 | `setCompositingReference` |

`updateConfig`、`setFxParams`、主题修改、参数重置和后端切换方法不进入产物。参数树不可变，动画状态按实例独立维护；查询返回拷贝。尺寸与实际 DPR 是宿主资源状态，仍可通过 `resize` 管理，但受固定的 `maxDpr` 限制。

每个产物只包含选定模式及必要依赖，没有其他后端的自动回退。Native 的已知背景 Final Pass 仍需要 WebGL2 辅助模块；保留 `compositingReference` 时必须携带这些代码，才能维持原有画面。关闭该能力才能同时移除辅助路径。

## 宿主接入

`dom` 接受定位容器、容器选择器，或省略 `target` 创建全屏覆盖层；已有 Canvas 请选择 `manual`。DOM 版本负责输入监听与尺寸同步。

```js
const fx = new BAClickFX({ target: '#fx-host', onError: error => console.error(error) });
// 卸载宿主时：fx.destroy();
```

`manual` 必须传入 `HTMLCanvasElement`，宿主负责坐标、尺寸、DPR 和指针生命周期。创建实例前不要先获取其他类型的 Canvas Context。

```js
const fx = new BAClickFX({ target: canvas, onError: error => console.error(error) });
fx.resize(320, 240, devicePixelRatio);
fx.pointerDown({ x: 100, y: 80, pointerId: 1 });
fx.pointerMove({ x: 120, y: 90, pointerId: 1 });
fx.pointerUp(1);
```

`worker` 必须在 Dedicated Worker 中接收 `OffscreenCanvas`。宿主创建模块 Worker、转移 Canvas，并维护消息协议。以下是协议骨架；尺寸和指针转发可复用[完整 Worker 示例](./worker-guide.md)。

```js
// 主线程
const worker = new Worker(new URL('./fx-worker.js', import.meta.url), { type: 'module' });
const offscreen = canvas.transferControlToOffscreen();
worker.postMessage({ type: 'init', canvas: offscreen, width: 320, height: 240, dpr: devicePixelRatio }, [offscreen]);
// 将 DOM 坐标换算成 Canvas 局部 CSS 像素后，发送 pointerDown/Move/Up/Cancel。
```

```js
// fx-worker.js，与定制 ba-click-fx.js 一起部署
import BAClickFX from './ba-click-fx.js';
let fx;
self.onmessage = ({ data }) =>
{
  switch (data.type)
  {
    case 'init':
      fx = new BAClickFX({ target: data.canvas, onError: error => postMessage({ type: 'error', code: error.code }) });
      fx.resize(data.width, data.height, data.dpr);
      break;
    case 'resize': fx.resize(data.width, data.height, data.dpr); break;
    case 'pointerDown': fx.pointerDown(data.input); break;
    case 'pointerMove': fx.pointerMove(data.input); break;
    case 'pointerUp': fx.pointerUp(data.pointerId); break;
    case 'pointerCancel': fx.pointerCancel(data.pointerId); break;
    case 'pause': fx.setPaused(data.paused); break;
    case 'clear': fx.clear(); break;
    case 'config': postMessage({ type: 'config', config: fx.getConfig() }); break;
    case 'destroy': fx.destroy(); fx = null; postMessage({ type: 'destroyed' }); break;
  }
};
```

宿主先发送 `init`，只发送当前能力对应的消息；卸载时清理输入监听、发送 `destroy`，收到确认后终止 Worker。设备失败后销毁旧实例，并使用新 Canvas 重建。

## 设备与故障

WebGPU 构造保持同步，设备申请异步进行；准备期间 `getConfig().resolvedWebGPUOutputMode` 为 `pending`，已有输入等待后续输出。初始化期间调用 `destroy()` 会取消后续输出并释放申请到的资源。

设备不可用、初始化或渲染失败、WebGPU Device 丢失时，定制版停止输出并通过构造时的 `onError` 通知宿主。失败实例不能通过取消暂停恢复。同步 Canvas 2D 上下文创建失败也会通知回调并抛出错误；无效构造参数直接抛错。错误 `code` 包括 `initialization-failed`、`device-lost`、`render-failed` 以及 Software/合成辅助路径的故障码。

WebGL 上下文恢复使用原有流程，期间不切换其他模式。HDR 扩展配置失败可以继续使用同一 WebGPU 后端的 Standard 输出；用 `resolvedWebGPUOutputMode` 查询实际的 `standard` 或 `extended`。Extended 配置成功不等同于物理显示器已经显示 HDR。

## 验证与性能

```bash
npm run check:release
```

发布检查包括完整版回归、`test:custom` 的构建与类型检查，以及 `test:browser:custom -- --required` 的实际运行验收。浏览器验证需要 Chrome/Edge，可设置 `BACLICKFX_CHROMIUM_PATH`。测试覆盖六种模式与三种接入、功能裁剪和非默认参数、已知背景、多实例、生命周期及真实 Canvas 转移；固定输入、随机数和时间后逐字节比较完整版与定制版，不更新黄金数据或放宽阈值。WebGPU Worker 额外检查异步初始化、初始化期间销毁、设备丢失和 Standard 输出降级。单独运行 `npm run test:browser:custom` 时，设备不可用会明确标为跳过；发布检查要求全部设备实际运行，出现跳过则失败。

默认浏览器验收只进行画面与生命周期检查，体积和验收结果写入 `test-results/custom-browser/results.json`，不执行性能压测。需要比较性能时显式运行：

```bash
npm run benchmark:custom
# 也可只测名称包含 webgpu 的配置
npm run benchmark:custom -- webgpu
```

基准报告单独写入 `test-results/custom-browser/benchmark.json`，记录导入/初始化耗时、90 帧 CPU 耗时和浏览器公开的堆内存快照，不覆盖验收报告。完整版和定制版使用独立浏览器上下文。完整版尚不支持的接入组合使用 DOM 版作为画面对照，报告的 `actualRuntime` 记录实际接入；这些组合的初始化和内存数据不能视为同一接入方式的性能对照。Worker 未公开的堆内存以 `null` 记录；这些快照不能代替 GPU 显存测量。CPU 耗时包含更新与 GPU 提交；基础 GPU 配置另记录 30 帧真实 RAF 调度及 GPU 完成等待。无头浏览器的调度帧率不能代替物理显示帧率或 HDR 显示验证，相关环境缺失会明确记录。

收益主要来自删除未使用的后端、输入处理、调参系统和功能资源。构建时也预计算主题映射及固定材质的 Bloom 数学常量，沿用相同公式与 double 精度。首轮保留 Shader、纹理编码和 HDR/Bloom 算法，不承诺固定体积或帧率提升；保留大纹理的版本仍可能较大。
