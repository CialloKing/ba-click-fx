import assert from 'node:assert/strict';
import { BACKENDS, RUNTIMES, normalizeProfile } from '../scripts/build-profile.mjs';
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
])
{
  assert.throws(() => normalizeProfile({ backend: 'webgl2', runtime: 'worker', ...extra }));
}
assert.equal(normalizeProfile({ backend: 'native', runtime: 'dom', config: { themeColor: '#ABCDEF' } }).config.themeColor, '#abcdef');
console.log('build profile validation passed');
