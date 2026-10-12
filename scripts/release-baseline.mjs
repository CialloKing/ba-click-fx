import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// 哈希来自 v1.3.11 正式 Release；不能以当前源码重建结果替代独立旧版。
export const baselineAssets = {
  full: { filename: 'ba-click-fx.js', sha256: '66269e1d52e52f05e52574c17ba7d1a1eb95130153b30b6904d454c699bab660' },
  slim: { filename: 'ba-click-fx.slim-webgl2-128.js', sha256: 'a60454b440f60723026c8abe6593fcb31ef6fc7501bbd8dfacb0e06494497702' },
};

export async function releaseBaseline(root)
{
  const directory = join(root, 'test-results/public-release-v1.3.11');
  mkdirSync(directory, { recursive: true });
  for (const asset of Object.values(baselineAssets))
  {
    const path = join(directory, asset.filename);
    if (!existsSync(path))
    {
      const response = await fetch('https://github.com/CialloKing/ba-click-fx/releases/download/v1.3.11/' + asset.filename);
      assert(response.ok, 'Download v1.3.11: ' + response.status);
      writeFileSync(path, Buffer.from(await response.arrayBuffer()));
    }
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
    assert.equal(digest, asset.sha256, 'Independent v1.3.11 baseline hash: ' + asset.filename);
  }
  return { directory, assets: baselineAssets };
}
