import assert from 'node:assert/strict';
import { BACKENDS, RUNTIMES, normalizeProfile } from '../scripts/build-profile.mjs';
import { isMain } from './cli.mjs';

export async function runBuildProfile()
{
  for (const backend of BACKENDS)
  {
    for (const runtime of RUNTIMES)
    {
      const profile = normalizeProfile({ backend, runtime });
      assert.equal(profile.config.inputSource, runtime === 'dom' ? 'dom' : 'manual');
      assert.equal(profile.config.webgpuPreferHdr, backend === 'webgpu-hdr');
      assert.equal(profile.features.trail, true);
    }
  }
  for (const extra of [
    { surprise: 1 }, { features: { trail: 1 } }, { features: { typo: true } },
    { features: null }, { config: null }, { fxParams: null },
    { config: { isolatedCompositing: true } },
    { config: { effectBackend: 'auto' } }, { config: { typo: 1 } },
    { features: { trail: false }, config: { trailAlways: true } },
    { features: { bloom: false }, fxParams: { 'bloom.intensity': 1 } },
    { features: { trail: false }, fxParams: { 'trail.width': 2 } },
    { features: { click: false }, fxParams: { 'disk.radius': 30 } },
    { fxParams: { 'unknown.value': 1 } },
    { resources: null }, { resources: { unknown: 1 } },
    { resources: { trailSize: 64 } }, { resources: { trailSize: '128' } },
    { resources: { encoding: 'procedural' } }, { resources: { trailSize: 128, encoding: 'original' } },
    { resources: { trailSize: null } }, { resources: { encoding: null } },
    { features: { trail: false }, resources: { trailSize: 128, encoding: 'deflate' } },
  ])
  {
    assert.throws(() => normalizeProfile({ backend: 'webgl2', runtime: 'worker', ...extra }));
  }
  assert.equal(normalizeProfile({ backend: 'native', runtime: 'dom', config: { themeColor: '#ABCDEF' } }).config.themeColor, '#abcdef');
  assert.deepEqual(normalizeProfile({ backend: 'webgl2', runtime: 'dom' }).resources, { trailSize: 512, encoding: 'zopfli' });
  assert.equal(normalizeProfile({ backend: 'webgl2', runtime: 'dom', resources: { trailSize: 128, encoding: 'deflate' } }).resources.trailSize, 128);
  console.log('build profile validation passed');

  assert.equal(normalizeProfile({ backend: 'webgl2', runtime: 'dom', resources: { trailSize: 128 } }).resources.encoding, 'zopfli');
}

if (isMain(import.meta))
{
  await runBuildProfile();
}
