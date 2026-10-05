import assert from 'node:assert/strict';
import { decodeHalf, compareRgb, compareForegroundRgb, trailEndpoints, encodePreview, srgbEncode, srgbDecode, summarizeTrailMesh } from '../scripts/unity-compare-data.mjs';
import { matchTrailPointTimes } from '../scripts/unity-trail-clock.js';

assert.deepEqual([...decodeHalf(Buffer.from([0, 0, 0, 60, 0, 192, 1, 0]))], [0, 1, -2, 2 ** -24]);
assert.throws(() => decodeHalf(Buffer.from([0])), /长度/);
const reference = Float32Array.of(1, 2, 3, 0);
assert.equal(compareRgb(reference, reference).maximumError, 0);
const metric = compareRgb(reference, Float32Array.of(2, 2, 3, 1));
assert.equal(metric.maximumError, 1);
assert.equal(metric.referenceEnergy, 6);
assert.equal(metric.actualEnergy, 7);
assert.equal(metric.meanAbsoluteError, 1 / 3);
const foreground = compareForegroundRgb(Float32Array.of(0, 0, 0, 0, 1, 0, 0, 1), Float32Array.of(0, 0, 0, 0, 0.5, 0, 0, 1));
assert.equal(foreground.actual.pixels, 1);
assert.equal(foreground.actual.meanAbsoluteError, 1 / 6);
assert.deepEqual(matchTrailPointTimes([{ x: 1, y: 0 }, { x: 0, y: 0 }],
  [0, 1, 2, 1, 0].map((x, i) => ({ x, y: 0, timeMs: i * 20 }))).map(p => p.bornAt), [60, 80]);
assert.equal(compareForegroundRgb(new Float32Array(4), new Float32Array(4)).actual.rmse, 0);
assert.deepEqual(trailEndpoints({ vertices: [{ x: 0, y: 1 }, { x: 0, y: -1 }, { x: 2, y: 1 }, { x: 2, y: -1 }],
  uv: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 0, y: 1 }] }, 100, 100),
  { start: { x: 50, y: 50 }, end: { x: 150, y: 50 } });
assert.throws(() => compareRgb(reference, Float32Array.of(Infinity, 2, 3, 0)), /非有限/);
assert.equal(srgbEncode(0), 0);
assert(Math.abs(srgbEncode(1) - 1) < 1e-14);
assert(Math.abs(srgbDecode(srgbEncode(0.18)) - 0.18) < 1e-14);
assert(compareRgb(Float32Array.of(4, 0, 0, 0), Float32Array.of(srgbDecode(1), 0, 0, 0)).maximumError === 3,
  '保留参考 HDR 值，不能让 SDR 显示域夹取隐藏亮度差异');
const png = encodePreview(reference, 1, 1);
const mesh = { name: 'test', positions: [{}, {}], indices: [0, 1, 2],
  vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] };
assert.equal(summarizeTrailMesh(mesh, {}).projectedArea, 0.5);
const identity = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`e${Math.floor(i / 4)}${i % 4}`, Math.floor(i / 4) === i % 4 ? 1 : 0]));
assert.equal(summarizeTrailMesh({ ...mesh, vertices: mesh.vertices.map(v => ({ ...v, z: 0 })) },
  { cameraWorldToCamera: identity, cameraProjection: identity }).projectedArea, 0.5);
assert.equal(summarizeTrailMesh({ ...mesh, vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0 }] }, {}).visibleTriangles, 0);
assert.equal(png.subarray(1, 4).toString(), 'PNG');
assert.equal(png.readUInt32BE(16), 1);
assert.equal(png.readUInt32BE(20), 1);
console.log('Unity Half 解码、原始 RGB 指标与 PNG 输出检查通过');
