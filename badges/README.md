# npm lifetime downloads / npm 历史累计下载量

[`npm-downloads.json`](https://github.com/CialloKing/ba-click-fx/blob/stats/npm-downloads.json) on the independent `stats` branch is a generated [Shields Endpoint](https://shields.io/badges/endpoint-badge) used by both READMEs. Source code, documentation, and the workflow stay on `main`; automatic data commits go only to `stats`. Keep `stats` separate from `main` without merging its history.

独立 `stats` 分支中的 [`npm-downloads.json`](https://github.com/CialloKing/ba-click-fx/blob/stats/npm-downloads.json) 由脚本生成，供中英文 README 的累计下载量徽章使用。源码、文档和工作流留在 `main`，自动数据提交只进入 `stats`；请保持两条分支独立，不要将 `stats` 的历史合并到 `main`。

Manually refresh the published badge with GitHub Actions / 手动触发 GitHub Actions 更新线上徽章：

```bash
gh workflow run update-npm-downloads.yml --ref main
```

Test and generate a local preview / 测试并生成本地预览：

```bash
npm run test:npm-downloads
npm run update:npm-downloads
```

The default output is the ignored local file `badges/npm-downloads.json`. Use `--output` to write to a separate checkout, as the workflow does:

默认输出为 Git 忽略的本地文件 `badges/npm-downloads.json`。可用 `--output` 写入独立检出的统计分支，工作流使用：

```bash
npm run update:npm-downloads -- --output ../stats/npm-downloads.json
```

- The package name comes from `package.json`; the first date comes from npm Registry `time.created`.
- Every run queries the [npm download API](https://github.com/npm/registry/blob/main/docs/download-counts.md) by calendar year, from creation through yesterday in UTC. Inclusive date ranges never overlap, and each request covers at most one year, below the API's 18-month limit.
- All periods are summed again on every run, so missed runs and npm corrections are included next time. No previous badge value is added to the result.
- Every response must match its requested package and dates and contain a non-negative integer. Any failed period leaves the previous badge intact.
- GitHub Actions runs daily at 03:23 UTC (11:23 Asia/Shanghai), or manually through `workflow_dispatch`. Logs show exact per-period counts, the total, and the cutoff date. Only a changed badge is committed to `stats`; compact rounding may hide small count changes.

- 包名读取自 `package.json`，起始日期读取自 npm Registry 的 `time.created`。
- 每次按自然年分段查询，从首次发布日累计到 UTC 昨日；两端日期均计入，分段不重叠，单次最多一年。
- 每次重新计算全部历史，漏跑或 npm 修正数据后均可重新汇总；不会将旧徽章值再次累加。
- 校验响应包名、完整日期范围和非负整数下载量；任一分段失败都保留旧徽章。
- 每天北京时间 11:23 自动运行，也支持手动触发；日志保留各段及总量的精确数值和截止日期。仅徽章变化时提交到 `stats`，缩写舍入可能使小幅增长不改变显示值。

Do not edit the generated JSON manually. / 请勿手动编辑生成的 JSON。
