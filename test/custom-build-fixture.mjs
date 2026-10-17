import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compressionSession } from '../scripts/resource-compression.mjs';
import { normalizeProfile } from '../scripts/build-profile.mjs';

const root = resolve(import.meta.dirname, '..');
const builds = new Map();
let reused = 0;
let buildMs = 0;
let session = null;
let sessionDepth = 0;

export async function withCustomBuildSession(run)
{
  if (sessionDepth === 0)
  {
    builds.clear();
    reused = 0;
    buildMs = 0;
    session ??= compressionSession();
  }
  sessionDepth++;
  try
  {
    return await run();
  }
  finally
  {
    if (--sessionDepth === 0)
    {
      session.close();
      session = null;
      builds.clear();
      reused = 0;
      buildMs = 0;
    }
  }
}

export function buildCustomFixture(input)
{
  session ??= compressionSession();
  const key = createHash('sha256').update(JSON.stringify(normalizeProfile(input))).digest('hex');
  if (builds.has(key))
  {
    reused++;
    return builds.get(key);
  }

  // 只复用当前进程已完成的构建；磁盘上的旧文件不能作为验收依据。
  const directory = resolve(root, 'test-results/custom-builds', key);
  mkdirSync(directory, { recursive: true });
  const profilePath = resolve(directory, 'profile.json');
  writeFileSync(profilePath, JSON.stringify(input));
  const start = performance.now();
  execFileSync(process.execPath, ['scripts/build.mjs', '--profile', profilePath], { cwd: root, stdio: 'pipe' });
  buildMs += performance.now() - start;
  for (const name of ['ba-click-fx.js', 'ba-click-fx.d.ts', 'build-info.json', 'modules.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])
    copyFileSync(resolve(root, 'dist-custom', name), resolve(directory, name));
  const build = { directory, url: `/test-results/custom-builds/${key}/ba-click-fx.js`,
    info: JSON.parse(readFileSync(resolve(directory, 'build-info.json'), 'utf8')) };
  builds.set(key, build);
  return build;
}

export function customBuildStats()
{
  return { built: builds.size, reused, buildMs };
}
