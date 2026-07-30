import {
  TRAIL_TEXTURE_COVERAGE,
  TRAIL_TEXTURE_HEIGHT,
  TRAIL_TEXTURE_WIDTH,
} from './trail-texture.js';

const DEFAULT_PROFILE_SAMPLE_COUNT = 17;

function clamp01(value)
{
  return Math.min(1, Math.max(0, value));
}

function lerp(from, to, progress)
{
  return from + (to - from) * progress;
}

function smootherstep(progress)
{
  const t = clamp01(progress);

  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Coverage keys describe the transparent-host transport envelope, not Unity
 * Gradient Alpha. Smootherstep keeps both ends flat when old points expire.
 */
export function evaluateTrailLongitudinalCoverage(keys, progress)
{
  if (!Array.isArray(keys) || keys.length === 0)
  {
    // Preserve custom configurations created before the internal curve existed.
    return 1;
  }

  const t = clamp01(progress);

  if (t <= keys[0][0])
  {
    return clamp01(keys[0][1]);
  }

  for (let index = 1; index < keys.length; index++)
  {
    const previous = keys[index - 1];
    const current = keys[index];

    if (t <= current[0])
    {
      const span = current[0] - previous[0];
      const localProgress = span > 0 ? (t - previous[0]) / span : 1;

      return clamp01(lerp(
        previous[1],
        current[1],
        smootherstep(localProgress),
      ));
    }
  }

  return clamp01(keys.at(-1)[1]);
}

function sampleTrailTextureCoverage(u, v)
{
  const x = clamp01(u) * (TRAIL_TEXTURE_WIDTH - 1);
  const y = clamp01(v) * (TRAIL_TEXTURE_HEIGHT - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(TRAIL_TEXTURE_WIDTH - 1, x0 + 1);
  const y1 = Math.min(TRAIL_TEXTURE_HEIGHT - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = lerp(
    TRAIL_TEXTURE_COVERAGE[y0 * TRAIL_TEXTURE_WIDTH + x0],
    TRAIL_TEXTURE_COVERAGE[y0 * TRAIL_TEXTURE_WIDTH + x1],
    tx,
  );
  const bottom = lerp(
    TRAIL_TEXTURE_COVERAGE[y1 * TRAIL_TEXTURE_WIDTH + x0],
    TRAIL_TEXTURE_COVERAGE[y1 * TRAIL_TEXTURE_WIDTH + x1],
    tx,
  );

  return lerp(top, bottom, ty) / 255;
}

export function evaluateTrailTextureCoverageProfile(
  progress,
  sampleCount = DEFAULT_PROFILE_SAMPLE_COUNT,
)
{
  const count = Math.max(2, Math.floor(sampleCount));
  const u = 1 - clamp01(progress);
  const profile = new Array(count);

  for (let index = 0; index < count; index++)
  {
    const position = index / (count - 1);

    // Canvas fromLeft maps to WebGL V=1; retain the original asymmetric mask.
    profile[index] = [
      position,
      sampleTrailTextureCoverage(u, 1 - position),
    ];
  }

  return profile;
}
