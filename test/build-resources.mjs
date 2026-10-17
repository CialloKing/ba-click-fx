import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resourceVite } from '../scripts/resource-vite.mjs';
import { normalizeProfile } from '../scripts/build-profile.mjs';
import { compressionSession, compressResource, compressionInfo } from '../scripts/resource-compression.mjs';
import { createBuildResources, resizeTexture, trailSource } from '../scripts/build-resources.mjs';
import { TRAIL_TEXTURE_RGB, TRAIL_TEXTURE_COVERAGE, TRAIL_TEXTURE_RGBA } from '../src/trail-texture.js';
import { createTrailCoverage } from '../scripts/trail-coverage-data.mjs';
import { CIRCLE_TEXTURE_RGBA } from '../src/circle-texture.js';
import { RING3_ALPHA } from '../src/ring3-alpha.js';
import { RING_MESH_VERTICES, RING_MESH_INDICES } from '../src/ring-mesh.js';
import { isMain } from './cli.mjs';

export async function runBuildResources()
{
  const root = resolve(import.meta.dirname, '..');
  const session = compressionSession();
  try
  {
    assert.deepEqual(createTrailCoverage(TRAIL_TEXTURE_RGB, 512, 512), TRAIL_TEXTURE_COVERAGE,
      'Shared derivation preserves the independently embedded Coverage bytes');
    assert.deepEqual(createTrailCoverage(new Uint8Array([
      0, 0, 0, 10, 20, 0, 0, 0, 0, 40, 5, 10,
    ]), 2, 2), new Uint8Array([0, 128, 0, 255]), 'Zero columns, channel maxima and rounding');
    assert.equal((await createBuildResources(root, normalizeProfile({ backend: 'webgl2', runtime: 'dom', resources: { encoding: 'original' } }))).size, 0);
    assert.equal((await createBuildResources(root, normalizeProfile({ backend: 'webgl2', runtime: 'dom', features: { trail: false, click: false } }))).size, 0);
    for (const encoding of ['deflate', 'zopfli'])
    {
      for (const trailSize of [128, 256, 512])
      {
        const profile = normalizeProfile({ backend: 'webgl2', runtime: 'dom', resources: { trailSize, encoding } });
        const directory = resolve(root, 'test-results/resource-codecs', encoding, String(trailSize));
        mkdirSync(directory, { recursive: true });
        const decoded = {};
        for (const [filename, code] of await createBuildResources(root, profile))
        {
          if (filename === 'trail-texture.js')
            assert.equal(code.includes('PACKED_TRAIL_TEXTURE_COVERAGE'), trailSize !== 512,
              'Only full-resolution GPU builds remove the embedded Coverage payload');
          const path = resolve(directory, filename);
          writeFileSync(path, code);
          decoded[filename] = await import(pathToFileURL(path).href);
        }
        const trail = decoded['trail-texture.js'];
        assert.equal(trail.TRAIL_TEXTURE_WIDTH, trailSize);
        assert.deepEqual(trail.TRAIL_TEXTURE_RGB, resizeTexture(TRAIL_TEXTURE_RGB, 3, trailSize));
        assert.deepEqual(trail.TRAIL_TEXTURE_COVERAGE, resizeTexture(TRAIL_TEXTURE_COVERAGE, 1, trailSize));
        if (trailSize === 512) assert.deepEqual(trail.TRAIL_TEXTURE_RGBA, TRAIL_TEXTURE_RGBA);
        assert.deepEqual(decoded['circle-texture.js'].CIRCLE_TEXTURE_RGBA, CIRCLE_TEXTURE_RGBA);
        assert.deepEqual(decoded['ring3-alpha.js'].RING3_ALPHA, RING3_ALPHA);
        for (const [name, expected] of [['RING_MESH_VERTICES', RING_MESH_VERTICES], ['RING_MESH_INDICES', RING_MESH_INDICES]])
        {
          const actual = decoded['ring-mesh.js'][name];
          assert.deepEqual(Buffer.from(actual.buffer), Buffer.from(expected.buffer));
        }
      }
      for (const backend of [undefined, 'webgpu', 'webgpu-hdr', 'webgl2-bloom', 'software', 'native'])
      {
        const profile = { resources: { trailSize: 512, encoding }, features: { trail: true } };
        if (backend) profile.backend = backend;
        const source = (await createBuildResources(root, profile)).get('trail-texture.js');
        assert.equal(source.includes('PACKED_TRAIL_TEXTURE_COVERAGE'),
          ['webgl2-bloom', 'software', 'native'].includes(backend), 'Backend-specific Coverage storage');
        if (!backend)
        {
          const audit = (await createBuildResources(root, profile, { deriveCoverage: false })).get('trail-texture.js');
          assert(audit.includes('PACKED_TRAIL_TEXTURE_COVERAGE'), 'Codec experiments retain both audited assets');
        }
      }
    }
    await assert.rejects(trailSource(root, 128, false, 'deflate', true));
    await assert.rejects(trailSource(root, 512, true, 'deflate', true));
    const external = await trailSource(root, 512, true);
    assert(external.asset && external.source.includes('payload.subarray(rgbEnd)'));
    const input = Buffer.from('cache round trip');
    await compressResource(input, 'deflate');
    const cacheFile = createHash('sha256').update(input).update(JSON.stringify(compressionInfo('deflate'))).digest('hex') + '.deflate';
    assert(existsSync(resolve(session.directory, cacheFile)));
    const child = `import { compressResource } from ${JSON.stringify(pathToFileURL(resolve(root, 'scripts/resource-compression.mjs')).href)}; await compressResource(Buffer.from('cache round trip'), 'deflate');`;
    execFileSync(process.execPath, ['--input-type=module', '-e', child]);
    // 故意破坏子进程即将读取的缓存，确认构建钩子把压缩错误传给 Vite。
    writeFileSync(resolve(session.directory, cacheFile), Buffer.from('invalid compressed data'));
    assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', child], { stdio: 'pipe' }));
    await assert.rejects(resourceVite(root, { resources: { encoding: 'invalid', trailSize: 128 }, features: { trail: true } }).buildStart());
  }
  finally
  {
    session.close();
  }
  console.log('resource codecs preserve exact texture and mesh bytes');

  if (session.owned)
  {
    assert(!existsSync(session.directory), 'Owned temporary cache must be cleaned');
  }
}

if (isMain(import.meta))
{
  await runBuildResources();
}
