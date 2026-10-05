import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TRIANGLE_TEXTURE_RGBA, TRIANGLE_TEXTURE_COVERAGE,
  createRoundedTriangleCoverage } from '../src/triangle-texture.js';

// 只在测试副本中暴露内部染色和轻量计数，不增加发布 API。
export async function tintFixture(sourceText = null, captureBytes = false)
{
  const sourceUrl = new URL('../src/engine-core.js', import.meta.url);
  let source = (sourceText ?? readFileSync(sourceUrl, 'utf8')).replace(/from '(\.\/[^']+)'/g,
    (_, path) => `from '${new URL(path, sourceUrl).href}'`);
  for (const [name, statements] of [
    ['sampleTextureChannel', 'work.preparations++; work.samples++;'],
    ['prepareTextureSample', 'work.preparations++;'],
    ['samplePreparedTextureChannel', 'work.samples++;'],
  ]) source = source.replace(new RegExp(`(function ${name}\\([\\s\\S]*?\\)\\s*\\{)`), `$1\n${statements}`);
  source += '\nexport const work = { preparations: 0, samples: 0 };\nexport { prepareLinearTintedTextureCanvas };';
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const records = [];
  for (const roundness of [0, 0.000001, 0.5, 0.999999, 1])
  for (const frameIndex of [0, 1])
  for (const variant of [0, 1])
  for (const useTextureAlpha of [false, true])
  for (const preserveCoverageColor of [false, true])
  {
    const frames = [0, 1].map(() => ({ key: null, canvas: {},
      image: { width: 128, height: 128, data: new Uint8ClampedArray(128 * 128 * 4) },
      context: { setTransform() {}, putImageData() {} } }));
    const resources = { linearTextureRgba: TRIANGLE_TEXTURE_RGBA,
      linearTextureCoverage: TRIANGLE_TEXTURE_COVERAGE, linearTintFrameCount: 2,
      linearTintFrames: frames };
    const shape = { roundness, coverage: createRoundedTriangleCoverage(roundness), useTextureAlpha };
    const before = { ...module.work };
    const args = [resources, 128, variant ? [0.13, 2.1, 0.7] : [1.2, 0.4, 2.1],
      variant ? 0.3 : 1.3, variant ? 2.5 : 1, frameIndex, variant ? 1 : 0, shape, preserveCoverageColor];
    module.prepareLinearTintedTextureCanvas(...args);
    const after = { ...module.work };
    module.prepareLinearTintedTextureCanvas(...args);
    if (JSON.stringify(module.work) !== JSON.stringify(after)) throw new Error('相同染色参数没有命中缓存');
    const bytes = Buffer.from(frames[frameIndex].image.data);
    let visible = 0;
    for (let index = 3; index < bytes.length; index += 4) visible += bytes[index] > 0 ? 1 : 0;
    records.push({ roundness, frameIndex, variant, useTextureAlpha, preserveCoverageColor,
      hash: createHash('sha256').update(bytes).digest('hex'), visible,
      preparations: after.preparations - before.preparations, samples: after.samples - before.samples,
      ...(captureBytes ? { bytes: bytes.toString('base64') } : {}) });
  }
  return records;
}
