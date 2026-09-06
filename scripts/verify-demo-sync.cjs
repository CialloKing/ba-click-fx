#!/usr/bin/env node

/**
 * Demo 与文档同步合同。
 *
 * 这些检查只读取展示层文件，便于在 Demo 改动时单独定位失败原因。
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'verify-sync.cjs')],
  {
    env: { ...process.env, BA_CLICK_FX_VERIFY_SCOPE: 'demo' },
    stdio: 'inherit',
  },
);

if (result.error)
{
  throw result.error;
}

process.exitCode = result.status ?? 1;
