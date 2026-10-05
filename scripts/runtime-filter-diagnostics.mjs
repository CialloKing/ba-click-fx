// 仅开发工具改写私有源码，避免为发布运行时增加计数接口。
export function instrumentFilterSource(source, sourceUrl)
{
  source = source.replace(/from\s*(['"])((?:\.\/|\/)[^'"]+)\1/g,
    (_, quote, path) => `from '${new URL(path, sourceUrl).href}'`);
  for (const [name, body] of [
    ['addBilinearRgb', 'filterWork.rgbSamples++; filterWork.axisPreparations += 2;'],
    ['sampleBilinearScalar', 'filterWork.scalarSamples++; filterWork.axisPreparations += 2;'],
    ['addPreparedBilinearRgb', 'filterWork.rgbSamples++;'],
    ['samplePreparedBilinearScalar', 'filterWork.scalarSamples++;'],
  ]) source = source.replace(new RegExp(`(function ${name}\\([\\s\\S]*?\\)\\s*\\{)`), `$1\n${body}`);
  source = source.replace('const values = new Float64Array(targetLength * 6);',
    'const values = new Float64Array(targetLength * 6); filterWork.allocatedBytes += values.byteLength;');
  source = source.replace('const safe = clamp(center +', 'filterWork.axisPreparations++; const safe = clamp(center +');
  source = source.replace(/function prepareFilterSampling[\s\S]*?\n\}/, body =>
    body.replace('return sampling;', 'filterWork.tableCreations++; return sampling;'));
  source = source.replace(/(_getSamplingPlan\([\s\S]*?\)\s*\{)/, '$1\nfilterWork.requests++;');
  return source + '\nexport const filterWork = { rgbSamples: 0, scalarSamples: 0, axisPreparations: 0, allocatedBytes: 0, tableCreations: 0, requests: 0 };';
}

export async function countSoftwareFiltering()
{
  const sourceUrl = new URL('/src/software-bloom.js', location.href);
  const url = URL.createObjectURL(new Blob([instrumentFilterSource(await (await fetch(sourceUrl)).text(), sourceUrl)], { type: 'text/javascript' }));
  let renderer;
  try
  {
    const { SoftwareBloomRenderer, filterWork } = await import(url);
    const { UNITY_FX_TOUCH } = await import('/src/config.js');
    renderer = new SoftwareBloomRenderer(() => document.createElement('canvas'));
    const target = document.createElement('canvas'); target.width = 320; target.height = 240;
    const context = target.getContext('2d');
    const frame = (width = 320, diffusion = 7) =>
    {
      const source = renderer.beginFrame(width, 240, 0.5, { x: 0, y: 0, width, height: 240 }, diffusion, 1);
      const coverage = renderer.beginCoverageFrame('browser-overlay');
      for (const surface of [source, coverage])
      {
        surface.fillStyle = 'white'; surface.fillRect(30, 30, 100, 90);
      }
      if (!renderer.composite(context, { ...UNITY_FX_TOUCH.bloom, outputCompositing: 'browser-overlay', encodingRange: 8 }))
        throw new Error('滤波计数夹具合成失败');
    };
    const take = callback =>
    {
      for (const key of Object.keys(filterWork)) filterWork[key] = 0;
      callback(); return { ...filterWork, cacheHits: filterWork.requests - filterWork.tableCreations };
    };
    const cold = take(() => frame());
    const stable = take(() => { for (let i = 0; i < 20; i++) frame(); });
    const diffusion = take(() => frame(320, 7.125));
    const resized = take(() => frame(311, 7.125));
    return { cold, stable, diffusion, resized, stableFrames: 20,
      note: '滤波 tap 数量与坐标准备分别计数；RGB/Coverage 使用同依赖的表。计数源码不参与正式耗时。' };
  }
  finally { renderer?.destroy(); URL.revokeObjectURL(url); }
}

export async function countSoftwareBuffers()
{
  const { SoftwareBloomRenderer } = await import('/src/software-bloom.js');
  const records = [];
  for (const [width, height] of [[320, 240], [1950, 1097]])
  {
    const renderer = new SoftwareBloomRenderer(() => document.createElement('canvas'));
    let allocations = 0; let allocatedBytes = 0;
    const resize = renderer._resizeFloatBuffer;
    renderer._resizeFloatBuffer = function (buffer, length)
    {
      const output = resize.call(this, buffer, length);
      if (output.buffer !== buffer.buffer) { allocations++; allocatedBytes += output.buffer.byteLength; }
      return output;
    };
    const take = (regionWidth, regionHeight, diffusion = 7) =>
    {
      allocations = 0; allocatedBytes = 0;
      if (!renderer.beginFrame(regionWidth, regionHeight, 0.5,
        { x: 0, y: 0, width: regionWidth, height: regionHeight }, diffusion, 1) ||
        !renderer.beginCoverageFrame('browser-overlay') || !renderer._ensureCoverageBuffers())
        throw new Error('缓冲计数布局准备失败');
      const buffers = new Set([renderer.sourceLinear.buffer, renderer.sourceCoverage.buffer,
        renderer.sceneCoverageMip0.buffer, ...[...renderer.levelStorage, ...renderer.coverageLevelStorage]
          .flatMap(level => [level.down.buffer, level.up.buffer, level.scratch.buffer])]);
      return { allocations, allocatedBytes, heldBytes: [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0),
        levels: renderer.levels.map(level => [level.width, level.height]),
        scratchBytes: [...renderer.levels, ...renderer.coverageLevels].reduce((sum, level) => sum + level.scratch.buffer.byteLength, 0),
        lastUpBytes: renderer.levels.at(-1).up.buffer.byteLength + renderer.coverageLevels.at(-1).up.buffer.byteLength };
    };
    try
    {
      records.push({ width, height, cold: take(width, height), stable: take(width, height),
        fewerLevels: take(width, height, 5), moreLevels: take(width, height, 8),
        shrunk: take(65, 33), restored: take(width, height) });
    }
    finally { delete renderer._resizeFloatBuffer; renderer.destroy(); }
  }
  return { records, note: '独立计数使用真实 Canvas 布局，字节按唯一 ArrayBuffer 计数；不参与正式耗时。' };
}
