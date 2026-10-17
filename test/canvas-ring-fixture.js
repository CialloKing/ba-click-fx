import { readFileSync } from 'node:fs';
import { loadRingDiagnosticModule } from '../scripts/runtime-ring-diagnostics.mjs';

// 实际私有算法的 stop/回调序列黄金数据；只在测试副本中暴露函数。
export async function ringFixture(sourceText = null)
{
  const url = new URL('../src/engine-core.js', import.meta.url);
  const module = await loadRingDiagnosticModule({ sourceUrl: url, file: sourceText ? 'engine-core.js' : 'engine-canvas-primitives.js',
    readSource: sourceUrl => sourceText && sourceUrl.pathname.endsWith('/engine-core.js') ? sourceText : readFileSync(sourceUrl, 'utf8') });
  const records = [];
  for (const arcSamples of [1, 32, 33, 96, 96.5, 512])
    for (const direction of [-1, 0, 1])
      for (const radialProgress of [0, 0.0625, 0.5, 0.9375, 1])
        for (const threshold of [0, 0.000001, 0.35, 0.999999, 1])
          for (const [textureUvMin, textureUvMax] of [[0, 1], [0.1, 0.9]])
          {
            const config = { arcSamples, dissolveDirection: direction, textureUvMin, textureUvMax };
            const calls = [], stops = [];
            module.createDissolvedRingGradient({ createConicGradient: () => ({ addColorStop(position, color) { stops.push([position, color]); } }) },
              config, threshold, radialProgress, value => { calls.push(value); return value; });
            records.push({ arcSamples, direction, radialProgress, threshold, textureUvMin, textureUvMax, calls, stops });
          }
  return { module, records };
}
