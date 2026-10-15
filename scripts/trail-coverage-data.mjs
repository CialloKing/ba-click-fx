// 仅使用原始 RGB 字节；主题、Bloom 和最终输出不能改变透明覆盖轮廓。
// 此函数也嵌入发布模块，保持自包含且不依赖 Node.js API。
export function createTrailCoverage(rgb, width, height)
{
  const coverage = new Uint8Array(width * height);

  for (let x = 0; x < width; x++)
  {
    let columnPeak = 0;

    for (let y = 0; y < height; y++)
    {
      const offset = (y * width + x) * 3;
      columnPeak = Math.max(columnPeak, rgb[offset], rgb[offset + 1], rgb[offset + 2]);
    }

    if (columnPeak === 0)
    {
      continue;
    }

    for (let y = 0; y < height; y++)
    {
      const sourceOffset = (y * width + x) * 3;
      const support = Math.max(rgb[sourceOffset], rgb[sourceOffset + 1], rgb[sourceOffset + 2]);
      // 保留离线审计的运算顺序和舍入，不能先量化每列亮度。
      coverage[y * width + x] = Math.round(support / columnPeak * 255);
    }
  }

  return coverage;
}
