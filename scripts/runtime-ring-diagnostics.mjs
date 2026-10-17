import { isolatedEngineFixture, exposeEngineBindings } from './engine-fixture.js';
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
  const stateImport = source.match(/import\s*\{[^}]*\bringSampleCache\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/);
  const scope = stateImport ? 'diagnosticState.' : '';
  if (stateImport) source += `\nimport * as diagnosticState from '${stateImport[1]}';`;
  let result = source + `\nexport const ringWork = { textureSamples: 0, boundarySearches: 0,
    boundaryIterations: 0, preparationRequests: 0, preparations: 0,
    colorEvaluations: 0, stopRequests: 0, stopPreparations: 0, stopDataAllocations: 0 };
    export function resetRingWork() { for (const key of Object.keys(ringWork)) ringWork[key] = 0; }


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
  if (scope) result = result
    .replace('ringSampleCache = new WeakMap();', 'diagnosticState.setRenderState(diagnosticState.themeHueShift, diagnosticState.relativeOklchTheme, diagnosticState.gradientEnergyCache, new WeakMap());')
    .replace('ringSampleCache = previous;', 'diagnosticState.setRenderState(diagnosticState.themeHueShift, diagnosticState.relativeOklchTheme, diagnosticState.gradientEnergyCache, previous);')
    .replace('themeHueShift = hue; relativeOklchTheme = theme;', 'diagnosticState.setRenderState(hue, theme, diagnosticState.gradientEnergyCache, diagnosticState.ringSampleCache);')
    .replace('themeHueShift = previousHue; relativeOklchTheme = previousTheme;', 'diagnosticState.setRenderState(previousHue, previousTheme, diagnosticState.gradientEnergyCache, diagnosticState.ringSampleCache);');
  return exposeEngineBindings(result, ['createDissolvedRingGradient', ...(preparedStops ? ['createRingStopDescriptor'] : [])]);

}

export async function loadRingDiagnosticModule(options = {})
{
  const sourceUrl = options.sourceUrl ?? new URL('/src/engine-core.js', location.href);
  const file = options.file ?? 'engine-core.js';
  return isolatedEngineFixture({ ...options, sourceUrl,
    transform: (name, source) => name === file ? instrumentRingSource(source, sourceUrl) : source,
    expose: { [file]: ['ringWork', 'resetRingWork', 'createDissolvedRingGradient', 'createRingStopDescriptor',
      'hasRingSampleCache', 'readRingSampleScope', 'withRingSampleScope', 'withRingTheme'] },
  });
}
