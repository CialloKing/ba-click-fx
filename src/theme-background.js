// The CSS preview and the WebGL scene must originate from the same theme data.
// Keeping the gradient stops here prevents a CSS-only theme from darkening the
// effect when the renderer needs a known scene background.
const THEME_DEFINITIONS = Object.freeze(
  {
    '蔚蓝': Object.freeze(
      {
        type: 'radial',
        centerX: 0.3,
        centerY: 0.2,
        stops: Object.freeze(
          [
            Object.freeze([0, '#1d3558']),
            Object.freeze([0.45, '#101827']),
            Object.freeze([1, '#080d16']),
          ],
        ),
      },
    ),
    '深紫': Object.freeze(
      {
        type: 'radial',
        centerX: 0.3,
        centerY: 0.2,
        stops: Object.freeze(
          [
            Object.freeze([0, '#2d1b4e']),
            Object.freeze([0.45, '#1a1028']),
            Object.freeze([1, '#0d0616']),
          ],
        ),
      },
    ),
    '深绿': Object.freeze(
      {
        type: 'radial',
        centerX: 0.3,
        centerY: 0.2,
        stops: Object.freeze(
          [
            Object.freeze([0, '#1a3d2a']),
            Object.freeze([0.45, '#0f1a14']),
            Object.freeze([1, '#080d0a']),
          ],
        ),
      },
    ),
    '暖金': Object.freeze(
      {
        type: 'radial',
        centerX: 0.3,
        centerY: 0.2,
        stops: Object.freeze(
          [
            Object.freeze([0, '#3d2a1a']),
            Object.freeze([0.45, '#1f1910']),
            Object.freeze([1, '#14100a']),
          ],
        ),
      },
    ),
    '纯黑': Object.freeze(
      {
        type: 'solid',
        color: '#000000',
      },
    ),
    '纯白': Object.freeze(
      {
        type: 'solid',
        color: '#ffffff',
      },
    ),
  },
);

function getThemeDefinition(name)
{
  return typeof name === 'string'
    ? THEME_DEFINITIONS[name] ?? null
    : null;
}

function formatPercent(value)
{
  return `${Math.round(value * 100)}%`;
}

function normalizeDimension(value)
{
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : 0;
}

function normalizePixelRatio(value)
{
  return Number.isFinite(value) && value > 0
    ? Math.min(2, Math.max(1, value))
    : 1;
}

export function getThemeBackgroundCss(name)
{
  const definition = getThemeDefinition(name);

  if (!definition)
  {
    return null;
  }

  if (definition.type === 'solid')
  {
    return definition.color;
  }

  const stops = definition.stops
    .map(([offset, color]) => `${color} ${formatPercent(offset)}`)
    .join(', ');

  return `radial-gradient(circle at ${formatPercent(definition.centerX)} ${
    formatPercent(definition.centerY)
  }, ${stops})`;
}

export function renderThemeSceneBackground(
  canvas,
  name,
  cssWidth,
  cssHeight,
  pixelRatio = 1,
)
{
  const definition = getThemeDefinition(name);
  const width = normalizeDimension(cssWidth);
  const height = normalizeDimension(cssHeight);

  if (!definition || !canvas || width <= 0 || height <= 0)
  {
    return false;
  }

  const scale = normalizePixelRatio(pixelRatio);
  const rasterWidth = Math.max(1, Math.round(width * scale));
  const rasterHeight = Math.max(1, Math.round(height * scale));

  canvas.width = rasterWidth;
  canvas.height = rasterHeight;

  const context = canvas.getContext?.('2d');

  if (!context)
  {
    return false;
  }

  if (definition.type === 'solid')
  {
    context.fillStyle = definition.color;
  }
  else
  {
    const centerX = rasterWidth * definition.centerX;
    const centerY = rasterHeight * definition.centerY;
    const radius = Math.hypot(
      Math.max(centerX, rasterWidth - centerX),
      Math.max(centerY, rasterHeight - centerY),
    );
    const gradient = context.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      radius,
    );

    for (const [offset, color] of definition.stops)
    {
      gradient.addColorStop(offset, color);
    }

    context.fillStyle = gradient;
  }

  context.fillRect(0, 0, rasterWidth, rasterHeight);
  return true;
}
