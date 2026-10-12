import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeProfile } from '../scripts/build-profile.mjs';
import { compressionSession } from '../scripts/resource-compression.mjs';
import { createBuildResources, resizeTexture } from '../scripts/build-resources.mjs';
import { TRAIL_TEXTURE_RGB, TRAIL_TEXTURE_COVERAGE } from '../src/trail-texture.js';
import { CIRCLE_TEXTURE_RGBA } from '../src/circle-texture.js';
import { RING3_ALPHA } from '../src/ring3-alpha.js';
import { RING_MESH_VERTICES, RING_MESH_INDICES } from '../src/ring-mesh.js';

const root = resolve(import.meta.dirname, '..');
const session = compressionSession();
try
{
for (const encoding of ['deflate', 'zopfli'])
for (const trailSize of [128, 256, 512])
{
  const profile = normalizeProfile({ backend: 'webgl2', runtime: 'dom', resources: { trailSize, encoding } });
  const directory = resolve(root, 'test-results/resource-codecs', encoding, String(trailSize));
  mkdirSync(directory, { recursive: true });
  const decoded = {};
  for (const [filename, code] of await createBuildResources(root, profile))
  {
    const path = resolve(directory, filename);
    writeFileSync(path, code);
    decoded[filename] = await import(pathToFileURL(path).href);
  }
  const trail = decoded['trail-texture.js'];
  assert.equal(trail.TRAIL_TEXTURE_WIDTH, trailSize);
  assert.deepEqual(trail.TRAIL_TEXTURE_RGB, resizeTexture(TRAIL_TEXTURE_RGB, 3, trailSize));
  assert.deepEqual(trail.TRAIL_TEXTURE_COVERAGE, resizeTexture(TRAIL_TEXTURE_COVERAGE, 1, trailSize));
  assert.deepEqual(decoded['circle-texture.js'].CIRCLE_TEXTURE_RGBA, CIRCLE_TEXTURE_RGBA);
  assert.deepEqual(decoded['ring3-alpha.js'].RING3_ALPHA, RING3_ALPHA);
  for (const [name, expected] of [['RING_MESH_VERTICES', RING_MESH_VERTICES], ['RING_MESH_INDICES', RING_MESH_INDICES]])
  {
    const actual = decoded['ring-mesh.js'][name];
    assert.deepEqual(Buffer.from(actual.buffer), Buffer.from(expected.buffer));
  }
}
}
finally
{
  session.close();
}
console.log('resource codecs preserve exact texture and mesh bytes');
