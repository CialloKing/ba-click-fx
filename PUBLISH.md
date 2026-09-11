# ba-click-fx 发布指南

需要 Node.js `>=24.0.0`、可用的 npm 发布权限和用于浏览器门禁的 Chrome / Edge。日常完整检查使用 `npm run check`；发布前必须通过 `npm run check:release`。

## 准备版本

1. 确认工作区干净，安装锁定依赖：

   ```bash
   git status --short
   npm ci
   ```

2. 按变更范围选择 patch、minor 或 major，先更新包版本但暂不创建标签：

   ```bash
   npm version patch --no-git-tag-version
   ```

3. 同步 CHANGELOG 的最新版本标题、中英文文档及展示页中的版本化 CDN 引用。版本校验会检查这些引用与包版本一致。

## 发布门禁

```bash
npm run check:release
```

该入口先执行 `check`，再执行核心像素、Worker、生命周期、Demo、Unity 数量和可选 WebGPU 浏览器验证。可通过 `BACLICKFX_CHROMIUM_PATH` 指定浏览器路径。Unity 资源变更还应先遵循 [Unity 真值门禁](https://github.com/CialloKing/ba-click-fx/blob/main/docs/unity-reference-baseline.md)。

检查通过后，提交版本相关文件并创建与 `package.json` 一致的 `v<版本号>` 标签，然后推送提交和该标签。使用中文提交说明，并检查暂存区，避免携带无关文件。

## 发布到 npm

```bash
npm publish
```

`prepublishOnly` 会再次执行 `check:release`。按照 npm 返回的认证提示完成发布。

## 发布后验证

在 [npm 包页面](https://www.npmjs.com/package/ba-click-fx) 核对版本，并使用完整版本号验证 CDN。当前格式为 ESM：

```html
<script type="module">
  import { BAClickFX } from 'https://cdn.jsdelivr.net/npm/ba-click-fx@1.3.3/dist/ba-click-fx.js';
  const fx = new BAClickFX();
</script>
```

将示例版本替换为刚发布的版本。CDN 同步可能有延迟，应以实际请求成功为准。发布产物仅包含 ESM 主入口、`config` / `worker` 子入口及对应类型声明，不提供 IIFE 文件。
