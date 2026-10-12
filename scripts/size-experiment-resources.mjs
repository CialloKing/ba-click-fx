import { replaceRanges, rewriteResource, trailSource } from './build-resources.mjs';
export { markResourceInitializersPure } from './build-resources.mjs';

function proceduralSources(root)
{
  // 噪声只使用坐标函数，避免消耗粒子系统的随机数并改变运动轨迹。
  const trail = rewriteResource(root, 'trail-texture.js', {
    TRAIL_TEXTURE_WIDTH: '64', TRAIL_TEXTURE_HEIGHT: '64',
    PACKED_TRAIL_TEXTURE_RGB: "''", PACKED_TRAIL_TEXTURE_COVERAGE: "''",
  }, {
    decodePaethTexture: `function decodePaethTexture(encoded, outputLength, channels)
{
  const output = new Uint8Array(outputLength);
  for (let y = 0; y < TRAIL_TEXTURE_HEIGHT; y++)
  {
    for (let x = 0; x < TRAIL_TEXTURE_WIDTH; x++)
    {
      const u = x / TRAIL_TEXTURE_WIDTH * Math.PI * 2;
      const center = 0.5 + Math.sin(u) * 0.08;
      const width = 0.11 + Math.cos(u * 3) * 0.035;
      const energy = Math.exp(-Math.pow((y / TRAIL_TEXTURE_HEIGHT - center) / width, 2)) *
        (0.72 + 0.28 * Math.cos(u * 2)) * (0.86 + 0.14 * Math.sin((x * 17 + y * 31) * 0.31));
      const value = Math.round(255 * (channels === 1 ? Math.pow(energy, 0.65) : energy));
      const offset = (y * TRAIL_TEXTURE_WIDTH + x) * channels;
      for (let channel = 0; channel < channels; channel++) { output[offset + channel] = value; }
    }
  }
  return output;
}`,
  });
  const circle = rewriteResource(root, 'circle-texture.js', {
    CIRCLE_TEXTURE_SIZE: '64', RUNS_BASE64_CHUNKS: '[]',
  }, {
    decodeCircleTexture: `function decodeCircleTexture()
{
  const output = new Uint8Array(CIRCLE_TEXTURE_SIZE * CIRCLE_TEXTURE_SIZE * 4);
  for (let y = 0; y < CIRCLE_TEXTURE_SIZE; y++)
  {
    for (let x = 0; x < CIRCLE_TEXTURE_SIZE; x++)
    {
      const radius = Math.hypot((x + 0.5) / CIRCLE_TEXTURE_SIZE * 2 - 1, (y + 0.5) / CIRCLE_TEXTURE_SIZE * 2 - 1);
      const offset = (y * CIRCLE_TEXTURE_SIZE + x) * 4;
      output[offset] = output[offset + 2] = Math.round(255 * Math.exp(-Math.pow(radius * 1.65, 6)));
      output[offset + 1] = Math.round(255 * Math.exp(-Math.pow(radius * 2.2, 4)));
      output[offset + 3] = 255;
    }
  }
  return output;
}`,
  });
  const ring = rewriteResource(root, 'ring3-alpha.js', { PACKED_RING3_ALPHA: "''" }, {
    decodeRing3Alpha: `function decodeRing3Alpha()
{
  const output = new Uint8Array(RING3_ALPHA_WIDTH * RING3_ALPHA_HEIGHT);
  for (let y = 0; y < RING3_ALPHA_HEIGHT; y++)
  {
    for (let x = 0; x < RING3_ALPHA_WIDTH; x++)
    {
      const u = x / RING3_ALPHA_WIDTH * Math.PI * 2;
      const v = y / (RING3_ALPHA_HEIGHT - 1);
      const wave = 0.68 + 0.32 * Math.sin(u * 3 + Math.sin(v * Math.PI * 2) * 1.5);
      output[y * RING3_ALPHA_WIDTH + x] = Math.round(255 * (0.2 + 0.8 * Math.pow(v, 0.75)) * wave);
    }
  }
  return output;
}`,
  });
  return new Map([['trail-texture.js', trail], ['circle-texture.js', circle], ['ring3-alpha.js', ring]]);
}

export async function createExperimentResources(root, strategy)
{
  const sources = new Map();
  const assets = new Map();
  if (strategy === 'procedural')
  {
    return { sources: proceduralSources(root), assets, exact: false, asynchronous: false };
  }
  if (['lossless-deflate', 'trail-256', 'trail-128', 'external-deflate'].includes(strategy))
  {
    const width = strategy === 'trail-256' ? 256 : strategy === 'trail-128' ? 128 : 512;
    const result = await trailSource(root, width, strategy === 'external-deflate');
    sources.set('trail-texture.js', result.source);
    if (result.asset)
    {
      assets.set('trail.bin', result.asset);
    }
  }
  return { sources, assets, exact: !['trail-256', 'trail-128'].includes(strategy),
    asynchronous: strategy === 'external-deflate' };
}
