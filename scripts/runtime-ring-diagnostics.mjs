// 计数只注入测试副本；正式耗时和 CPU 采样始终使用未包装的源码。
export function instrumentRingSource(source, sourceUrl)
{
  source = source.replace(/from (['"])([./][^'"]+)\1/g,
    (_, quote, path) => `from '${new URL(path, sourceUrl).href}'`);
  const prepared = source.includes('function prepareRingGradientSamples(');
  const preparedStops = source.includes('function prepareRingGradientStops(');
  for (const [name, statements] of [
    ['evaluateRingTextureAlpha', 'ringWork.textureSamples++;'],
    ['findRingClipBoundary', 'ringWork.boundarySearches++;'],
    ['getRingGradientSamples', 'ringWork.preparationRequests++;'],
    ['prepareRingGradientSamples', 'ringWork.preparations++;'],
    ['getRingGradientStops', 'ringWork.stopRequests++;'],
    ['prepareRingGradientStops', 'ringWork.stopPreparations++;'],
  ])
  {
    source = source.replace(new RegExp(`(function ${name}\\([\\s\\S]*?\\)\\s*\\{)`), `$1\n${statements}`);
  }
  source = source.replace(/(function createDissolvedRingGradient\([\s\S]*?\)\s*\{)/,
    `$1\nconst originalColor = colorForLuminance; colorForLuminance = value => { ringWork.colorEvaluations++; return originalColor(value); };${preparedStops ? '' : '\nringWork.stopRequests++; ringWork.stopPreparations++;'}`);
  if (preparedStops) source = source.replace('return stops;', 'if (stops) ringWork.stopDataAllocations++; return stops;');
  if (!prepared) source = source.replace('const gradient = context.createConicGradient(0, 0, 0);',
    'const gradient = context.createConicGradient(0, 0, 0);\n  ringWork.preparationRequests++; ringWork.preparations++;');
  const start = source.indexOf('function findRingClipBoundary(');
  const end = source.indexOf('\nfunction ', start + 1);
  source = source.slice(0, start) + source.slice(start, end).replace(
    'const middle = (start + end) * 0.5;', 'ringWork.boundaryIterations++;\n    const middle = (start + end) * 0.5;') + source.slice(end);
  return source + `\nexport const ringWork = { textureSamples: 0, boundarySearches: 0,
    boundaryIterations: 0, preparationRequests: 0, preparations: 0,
    colorEvaluations: 0, stopRequests: 0, stopPreparations: 0, stopDataAllocations: 0 };
    export function resetRingWork() { for (const key of Object.keys(ringWork)) ringWork[key] = 0; }
    export { createDissolvedRingGradient };
    ${preparedStops ? 'export { createRingStopDescriptor };' : ''}
    export const hasRingSampleCache = ${prepared};
    export function readRingSampleScope() { return ${prepared ? 'ringSampleCache' : 'null'}; }
    export function withRingSampleScope(callback) {
      ${prepared ? 'const previous = ringSampleCache; ringSampleCache = new WeakMap(); try { return callback(); } finally { ringSampleCache = previous; }' : 'return callback();'}
    }
    export function withRingTheme(hue, theme, callback) {
      const previousHue = themeHueShift, previousTheme = relativeOklchTheme;
      themeHueShift = hue; relativeOklchTheme = theme;
      try { return callback(); } finally { themeHueShift = previousHue; relativeOklchTheme = previousTheme; }
    }`;
}

export async function loadRingDiagnosticModule()
{
  const sourceUrl = new URL('/src/engine-core.js', location.href);
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`圆环诊断源码读取失败：${response.status}`);
  const url = URL.createObjectURL(new Blob([instrumentRingSource(await response.text(), sourceUrl)], { type: 'text/javascript' }));
  try { return await import(url); }
  finally { URL.revokeObjectURL(url); }
}
