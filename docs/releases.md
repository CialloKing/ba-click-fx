# 完整版与精简版发布

[返回 README](../README.md) · [English](./releases.en.md)

同一版本、标签和 Release 同时提供完整版与固定配置的 WebGL2 / 128² DOM 精简版。npm/CDN 默认包为完整版。精简版固定普通网页推荐的 `browser-overlay + screen + dom-backdrop`，保留点击、拖尾、碎片、Bloom、合成参考；仅接受宿主和回调参数，修改合成配置、主题、scale、DPR 上限或特效参数需从源码重新构建。没有其他渲染后端回退。

## 本地准备与验收

先同步 package.json、锁文件、Changelog、双语文档与下载链接，然后运行：

```bash
npm ci
npm run check:release
npm run release:prepare
npm run test:browser:slim -- --release-assets
npm run test:browser:zopfli -- --release-assets
```

完整门禁保留既有运行时、类型、浏览器、Worker、生命周期和设备覆盖。精简版额外比较已接受的 128² 画面，检查无损资源字节、四个像素场景、输入、多实例、初始化失败和 WebGL 上下文恢复。`npm run benchmark:custom` 独立采样，不作为默认发布门禁。

`release:prepare` 从当前源码重新构建两种产物，写入 `dist-release`，验证 ZIP 内容并生成 SHA256SUMS。`test:browser:slim -- --release-assets` 检查实际待上传的 JS。`build-info.json` 记录版本、提交与工作区状态；正式标签的源码必须已提交且工作区干净。实验报告不进入附件。

完整版、精简版与普通定制构建默认使用 Zopfli（15 次迭代），运行时内嵌 fflate 同步解码。完整版保留 512² 与全部接口和后端，精简版保留 128² 预设。构建信息记录编码、尺寸和压缩参数；发布准备要求 Zopfli、主入口与 Worker 一致及许可证完整。raw/gzip/Brotli 与 SHA-256 已核验的 v1.3.11 正式附件比较，只报告当前字节数、增减字节和百分比，不设置大小上限。`test:browser:zopfli` 对两版实际待上传 JS 与这个独立基线执行四场景逐字节像素对照；资源、类型、像素和哈希失败仍阻断验收，必需检查不能跳过。

Zopfli 会增加构建时间，显式运行 `npm run benchmark:codecs` 分别记录冷构建、解码、导入和初始化及本机测量范围。交付前先提交全部修改，再从干净工作区重新生成附件。实验分支的发布准备与后续合并、标签、正式发布分开进行，npm 发布也单独处理。

## 附件

| 内容 | 文件 |
|---|---|
| 完整版原有入口与类型 | `ba-click-fx.js`、`ba-click-fx.d.ts`、`config.js`、`config.d.ts`、`worker.js`、`worker.d.ts` |
| 精简版单文件与类型 | `ba-click-fx.slim-webgl2-128.js`、`ba-click-fx.slim-webgl2-128.d.ts` |
| 完整版 ZIP | `ba-click-fx-v<版本>-full.zip` |
| 精简版 ZIP | `ba-click-fx-v<版本>-slim-webgl2-128.zip` |
| 全部十个文件的 SHA-256 | `SHA256SUMS` |

ZIP 包含使用说明、构建信息、LICENSE、THIRD_PARTY_NOTICES.md；精简版额外包含 profile.json。两版 ZIP 和 npm 包均附带完整 fflate 许可证且只收录一次。完整版声明服务于包名导入，TypeScript 推荐使用 npm；精简版声明支持对应文件的相对 ESM 导入。gzip/Brotli 体积由脚本记录，用于比较，不额外发布压缩脚本附件。GitHub 的 Source code 为自动生成的源码归档。

## 标签发布

主分支合并后，确认对应提交的 Build CI 通过。需要实际发布时才创建并推送标签：

```bash
git tag -a v1.3.13 -m "发布v1.3.13：完整版与WebGL2精简版"
git push origin v1.3.13
```

标签触发同一工作流重新验收。Linux 完成包与定制构建检查；Windows 构建附件并运行完整浏览器与精简版验收。两项均成功后，发布任务核对版本、提交和 SHA256SUMS，创建草稿，上传 11 个附件，下载验证数量和所有哈希，然后转为正式 Release。失败时不会发布正式版本；上传后校验失败会保留草稿供排查。
