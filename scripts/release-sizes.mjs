import { brotliCompressSync, gzipSync } from 'node:zlib';

export function scriptSizes(bytes)
{
  return { raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length };
}

export function compareSizes(previous, current)
{
  // 体积用于报告；功能维护不能受历史版本的永久大小上限约束。
  return Object.fromEntries(Object.keys(current).map(format => [format, {
    previous: previous[format], current: current[format],
    deltaBytes: current[format] - previous[format],
    deltaPercent: (current[format] - previous[format]) / previous[format] * 100,
  }]));
}

export function sizeComparisonRows(edition, comparison)
{
  const signed = number => (number > 0 ? '+' : '') + number;
  return Object.entries(comparison).map(([format, value]) =>
    `| ${edition} | ${format} | ${value.previous} | ${value.current} | ${signed(value.deltaBytes)} | ${signed(Number(value.deltaPercent.toFixed(2)))}% |`).join('\n');
}
