import assert from 'node:assert/strict';
import { isMain } from './cli.mjs';
import { withCustomBuildSession } from './custom-build-fixture.mjs';

export async function runCustomRelease({ releaseAssets = false, staticChecks = true } = {})
{
  return withCustomBuildSession(async () =>
  {
    if (staticChecks)
    {
      await (await import('./build-profile.js')).runBuildProfile();
      await (await import('./build-resources.mjs')).runBuildResources();
      await (await import('./custom-build.js')).runCustomBuild();
    }
    await (await import('./browser/custom-runtime.mjs')).runCustomRuntime(['--required']);
    const args = releaseAssets ? ['--release-assets'] : [];
    await (await import('./browser/slim-runtime.mjs')).runSlimRuntime(args);
    await (await import('./browser/zopfli-release.mjs')).runZopfliRelease(args);
  });
}

if (isMain(import.meta))
{
  assert(process.argv.slice(2).every(arg => arg === '--required'));
  await runCustomRelease();
}
