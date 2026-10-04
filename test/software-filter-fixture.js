import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export async function filterFixture(sourceText = null, captureBytes = false, prepared = false)
{
  const sourceUrl = new URL('../src/software-bloom.js', import.meta.url);
  let source = (sourceText ?? readFileSync(sourceUrl, 'utf8')).replace(/from '(\.\/[^']+)'/g,
    (_, path) => `from '${new URL(path, sourceUrl).href}'`);
  for (const [name, field] of [['addBilinearRgb', 'rgbSamples'], ['sampleBilinearScalar', 'scalarSamples'],
    ['addPreparedBilinearRgb', 'rgbSamples'], ['samplePreparedBilinearScalar', 'scalarSamples']])
    source = source.replace(new RegExp(`(function ${name}\\([\\s\\S]*?\\)\\s*\\{)`), `$1\nwork.${field}++;`);
  source += '\nexport const work = { rgbSamples: 0, scalarSamples: 0 };\nexport { filterBoxScalar, upsampleTransportAndAdd, filterBloomForComposite };';
  if (prepared) source += '\nexport { prepareFilterSampling, prefilterBloomPrepared, downsampleBox, upsampleBoxAndAdd };';
  const kernels = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const records = [];
  let seed = 12345;
  const allocate = length => Float32Array.from({ length }, () =>
  {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed % 7 === 0 ? 0 : (seed / 4294967296) ** 3 * 64;
  });
  for (const name of ['prefilter', 'downsample', 'upsample', 'scalar', 'transport', 'composite'])
  for (const [width, height] of [[1, 1], [3, 5], [8, 6], [17, 13]])
  for (const offset of [0, 1.42925835, 2])
  for (const bounded of [false, true])
  for (const layout of ['separate', 'same', 'overlap', 'coarse-overlap', 'shared-disjoint', 'tail'])
  {
    const channels = ['scalar', 'transport'].includes(name) ? 1 : 3;
    const smallWidth = Math.max(1, Math.ceil(width / 2));
    const smallHeight = Math.max(1, Math.ceil(height / 2));
    const fullOutput = ['upsample', 'transport', 'composite'].includes(name);
    const outputWidth = fullOutput ? width : smallWidth;
    const outputHeight = fullOutput ? height : smallHeight;
    const length = outputWidth * outputHeight * channels;
    const sourceLength = width * height * channels;
    const backing = allocate(sourceLength + length + 1);
    const input = backing.subarray(0, sourceLength);
    const coarseLength = smallWidth * smallHeight * channels;
    const coarseBacking = allocate(Math.max(coarseLength, length + 1));
    const coarse = coarseBacking.subarray(0, coarseLength);
    const output = layout === 'same' ? backing.subarray(0, length)
      : layout === 'overlap' ? backing.subarray(1, length + 1)
      : layout === 'coarse-overlap' ? coarseBacking.subarray(1, length + 1)
      : layout === 'shared-disjoint' ? backing.subarray(sourceLength + 1)
      : allocate(length + (layout === 'tail' ? 4 : 0));
    const transport = allocate(outputWidth * outputHeight);
    const bounds = bounded ? { minimumX: 0, minimumY: 0,
      maximumX: Math.floor(width / 2), maximumY: Math.floor(height / 2) } : null;
    let fillCalls = 0;
    let fillFloats = 0;
    for (const buffer of [output, transport])
      buffer.fill = function (...args)
      {
        fillCalls++;
        fillFloats += this.length;
        return Float32Array.prototype.fill.apply(this, args);
      };
    const before = { ...kernels.work };
    const plan = prepared ? kernels.prepareFilterSampling(
      ['upsample', 'transport'].includes(name) ? smallWidth : width,
      ['upsample', 'transport'].includes(name) ? smallHeight : height,
      outputWidth, outputHeight, ['prefilter', 'downsample'].includes(name) ? 1 : name === 'scalar' ? offset : Math.max(0, offset) * 0.5) : null;
    let result;
    if (name === 'prefilter') result = (prepared ? kernels.prefilterBloomPrepared : kernels.prefilterBloom)(input, width, height,
      output, outputWidth, outputHeight, 0.8, 0.5, 65472, true, 1, bounds, transport, plan);
    if (name === 'downsample') result = prepared
      ? kernels.downsampleBox(input, width, height, output, outputWidth, outputHeight, plan)
      : kernels.downsampleGaussian(input, width, height, null, output, outputWidth, outputHeight, bounds);
    if (name === 'upsample') result = prepared
      ? kernels.upsampleBoxAndAdd(input, width, height, coarse, smallWidth, smallHeight, output, offset, plan)
      : kernels.upsampleAndMixBloom(input, width, height, coarse, smallWidth, smallHeight, output, offset, true, bounds, bounds);
    if (name === 'scalar') result = kernels.filterBoxScalar(input, width, height,
      output, outputWidth, outputHeight, offset, bounds, bounded, plan);
    if (name === 'transport') result = kernels.upsampleTransportAndAdd(input, width, height,
      coarse, smallWidth, smallHeight, output, offset, plan);
    if (name === 'composite') result = kernels.filterBloomForComposite(input, width, height, output, offset, plan);
    const bytes = Buffer.concat([...[input, coarse, output, transport].map(buffer =>
      Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)),
      Buffer.from(JSON.stringify(result) ?? 'undefined')]);
    records.push({ name, width, height, offset, bounded, layout, hash: createHash('sha256').update(bytes).digest('hex'),
      ...(captureBytes ? { bytes: bytes.toString('base64') } : {}),
      rgbSamples: kernels.work.rgbSamples - before.rgbSamples,
      scalarSamples: kernels.work.scalarSamples - before.scalarSamples, fillCalls, fillFloats });
  }
  return records;
}
