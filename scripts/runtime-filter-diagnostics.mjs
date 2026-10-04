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
