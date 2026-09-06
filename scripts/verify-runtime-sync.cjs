#!/usr/bin/env node

/**
 * 运行时同步合同入口。
 *
 * verify-sync 仍保存合同实现，按阶段标记只运行运行时部分。
 */

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const result = spawnSync(
  process.execPath,
  [path.join(__dirname, 'verify-sync.cjs')],
  {
    env: { ...process.env, BA_CLICK_FX_VERIFY_SCOPE: 'runtime' },
    stdio: 'inherit',
  },
);

if (result.error)
{
  throw result.error;
}

process.exitCode = result.status ?? 1;
