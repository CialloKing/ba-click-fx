export const TRIANGLE_TEXTURE_SIZE = 128;

const PALETTE_BASE64 = 'AAAAAK2urbT/+/////////f39/+kpKS2OTo5GQAAACSqp6qRpKSkkf///9oQDBAOVVVVbaqqqtpVVVVIpaalpKqrqrYABAAAAAAAFwAEACRlY2VxVVdVbRgYGAj/+//b3t/e3lVTVUiqp6q2qqqqtlVTVSRVVVUkqqqqkRAUEBP38/fsAAAAIVpXWm1SUVJlCAQIAKyrrNrCwcLIWldaSEpFSkGko6S29/P3/6SmpLako6SRpKakkefj5+T39/faWllaWgAEACL3+/fxUlZSZ1JTUm3FxcXl9/P32lJRUktSU1JIp6intvf79/+sq6y2CAQIJAgMCCSnqKeRrKuskQgMCAD3+/fa//v/2mNlY2SlpqWnCAgIJFdVV21aWVptCAgIAFdVV0haWVpIvbq9wD8+Pzavq6+aEAwQFU9PT23v7+//UlJSbe/v79pPT09IUlJSSK2ura8hJCElp6enkaSopJFXV1dtUlZSbcbDxshCQUI5r7CvnBAUEBn38/fzVVZVbVVWVUiqqKq2KSwpK+fr5/tNTk0jrKqskZqcmo/////pa2lraaqrqtpVV1VI9/f396SnpJGEgoSCAAAAElpaWkmkp6S2rKystggICAFPT08k7+/v/VJSUiSfn5+Q////63Nxc3MFBQUFV1ZXSKyqrLaMjoyMn5+fkQAAABRfXV9uEAwQAq+ur9rOy87LCAgICEpKSl+6uLrDMSwxLaSipJFSUVJt1tPW00JFQkTn5+fkTU1NYQ==';
const RUNS_BASE64 = '/wD/AP8A/wD/AP8A/wD/AIsAAQEEAnQDAQQBBQUAAQYEAnQDAQQBBwYAAQgDAnQDAQkIAAEKdQMBCgELCAABDHUDAQwKAAENcwMBDQsAAQ5zAwEODAABDwQCbQMBEAIRCwABEgQCbQMBEwIRDAABFAMCbAMBFQMRDAABFgEXAgJrAwEYBBENAAEZAgJrAwEOEgABGgECagMBGxMAARwBAmoDAR0UAAEIaQMBHhUAAR8BCmcDASABIRYAASJnAwEjFwABJAElZQMBJhgAASQBJ2UDASgYAAIRASkBKmADAgQBKwERGAACEQETASpgAwIEARMBERgAAxEBLGADAQQBLQIRGAAEEQEuXwMBLwMRHAABDl8DATAgAAEbXQMBGyEAAR1dAwEdIgABHlsDAR4hAAIRATEBMlgDAioBEwERIAADEQEzWAMBKgE0AhEgAAQRATVXAwE2AxEgAAQRATdXAwE4AxEkAAEkATkCOlADAwIBOygAASQBPAI6UAMDAgE9KAACJAE+ATpQAwICAT8BQCgAAyQBQVADAQIBQgJAKwABQ1EDAQwuAAENTwMBDS8AAQ5PAwEOMAABG00DAUQwAAEkATwCBEgDAwIBRTAAAiQBRgEESAMCAgFHAUgwAAMkAS9IAwECAUICSDAAAyQBSUgDAQIBSgJINAABGgMCQAMEAgFLNwABHAMCQAMEAgFMOAABCAICQAMDAgFNOQABBwICQAMDAgFOOgABTwFQQAMCBAFRPAABUkADAQQBLz0AAVNAAwEEAVQ+AAFVPwMBBT8AAUUDBDgDBDoBVj8AAUgBVwIEOAMDOgFYQAACSAEvAQQ4AwI6AUEBEUAAAkgBWQEEOAMCOgFaARFDAAFbOQMBDUUAAVw5AwEORgABXTcDAR5HAAFeNgMBXwEHRwABEQFgAgIzAwEiSAACEQFCAQIyAwEKASRIAAIRAWEBAjIDAScBJEgAAxEBYjEDATsCJEsAAWMEAiwDAWQBZU4AAWYDAiwDAWdPAAFIAUICAisDAWhQAAFIAUcCAisDAWlSAAENTwMBagERUgABDisDAWsBEVMAARspAwEQAhFTAAEHAWwoAwETAhFUAAFtAzokAwFuWAABQQI6IwMBCgFvWAABOAI6IwMBcFoAAXEBOiIDAXIBc1oAAXQBdSADAgQBdlwAAXcgAwEEAQldAAEHAXgfAwEEAQdeAAF5HwMBUV8AASQBQQI6GAMDAgFCAXpfAAEkAXsCOhgDAwIBSmAAAiQBOQE6GAMCAgF8AUhgAAIkATwBOhgDAgIBRQFIYwABfRgDAVABfmUAAX8BChcDAVJnAAGAFwMBT2cAAYEBghUDAYNoAAERAWECAhMDASdoAAIRAWIBAhIDATsBJGgAAhEBEwECEgMBPAEkaAADEQFgEQMBIgIkawABhAFCAwIMAwEYbwABGQMCDAMBhXAAARoCAgsDAYZxAAEcAgILAwGHcgABiAEqCgMBPwEkcgABBwE2CQMBCgE8ASRzAAGJCQMBIgIkdAABigcDASUDJHQAATgDOgQCAYt4AAFxAjoDAgF8eQABBwI6AwIBRXoAAW0BOgICAWYBSHsAAYwBKgE2fQABjQEqAYl+AAGI/wD/AMEA';

function decodeBase64(value)
{
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++)
  {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function decodeTriangleTexture()
{
  const palette = decodeBase64(PALETTE_BASE64);
  const runs = decodeBase64(RUNS_BASE64);
  const output = new Uint8Array(
    TRIANGLE_TEXTURE_SIZE * TRIANGLE_TEXTURE_SIZE * 4,
  );
  let outputOffset = 0;

  for (let runOffset = 0; runOffset < runs.length; runOffset += 2)
  {
    const count = runs[runOffset];
    const paletteOffset = runs[runOffset + 1] * 4;

    for (let index = 0; index < count; index++)
    {
      output[outputOffset] = palette[paletteOffset];
      output[outputOffset + 1] = palette[paletteOffset + 1];
      output[outputOffset + 2] = palette[paletteOffset + 2];
      output[outputOffset + 3] = palette[paletteOffset + 3];
      outputOffset += 4;
    }
  }

  return output;
}

function srgbByteToLinearByte(value)
{
  const normalized = value / 255;
  const linear = normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;

  return Math.round(linear * 255);
}

export const TRIANGLE_TEXTURE_RGBA = decodeTriangleTexture();

export function resolveTriangleTextureFrame(textureFrame)
{
  if (Number.isFinite(textureFrame))
  {
    const frame = Math.trunc(textureFrame);

    return ((frame % 2) + 2) % 2;
  }

  if (!Array.isArray(textureFrame) || textureFrame.length < 3)
  {
    return 0;
  }

  const verticalPositions = textureFrame
    .map((point) => Number(point?.[1]))
    .filter((value) => Number.isFinite(value));

  if (verticalPositions.length < 3)
  {
    return 0;
  }

  const minimum = Math.min(...verticalPositions);
  const maximum = Math.max(...verticalPositions);
  const epsilon = Math.max(0.000001, (maximum - minimum) * 0.001);
  const topCount = verticalPositions.filter(
    (value) => Math.abs(value - minimum) <= epsilon,
  ).length;
  const bottomCount = verticalPositions.filter(
    (value) => Math.abs(value - maximum) <= epsilon,
  ).length;

  // 旧轮廓参数中，尖端朝上对应图集的垂直翻转帧。
  return topCount < bottomCount ? 1 : 0;
}

export function createTriangleTextureSources(createCanvas)
{
  if (typeof createCanvas !== 'function')
  {
    return null;
  }

  const colorCanvas = createCanvas();
  const alphaCanvas = createCanvas();

  colorCanvas.width = TRIANGLE_TEXTURE_SIZE;
  colorCanvas.height = TRIANGLE_TEXTURE_SIZE;
  alphaCanvas.width = TRIANGLE_TEXTURE_SIZE;
  alphaCanvas.height = TRIANGLE_TEXTURE_SIZE;

  const colorContext = colorCanvas.getContext('2d');
  const alphaContext = alphaCanvas.getContext('2d');

  if (
    !colorContext ||
    !alphaContext ||
    typeof colorContext.createImageData !== 'function' ||
    typeof alphaContext.createImageData !== 'function'
  )
  {
    colorCanvas.width = 0;
    colorCanvas.height = 0;
    alphaCanvas.width = 0;
    alphaCanvas.height = 0;
    return null;
  }

  const colorImage = colorContext.createImageData(
    TRIANGLE_TEXTURE_SIZE,
    TRIANGLE_TEXTURE_SIZE,
  );
  const alphaImage = alphaContext.createImageData(
    TRIANGLE_TEXTURE_SIZE,
    TRIANGLE_TEXTURE_SIZE,
  );

  for (let offset = 0; offset < TRIANGLE_TEXTURE_RGBA.length; offset += 4)
  {
    // RGB 与 Alpha 分开保存；A=0 的 RGB 仍会参与 Unity 的双线性采样。
    colorImage.data[offset] = srgbByteToLinearByte(
      TRIANGLE_TEXTURE_RGBA[offset],
    );
    colorImage.data[offset + 1] = srgbByteToLinearByte(
      TRIANGLE_TEXTURE_RGBA[offset + 1],
    );
    colorImage.data[offset + 2] = srgbByteToLinearByte(
      TRIANGLE_TEXTURE_RGBA[offset + 2],
    );
    colorImage.data[offset + 3] = 255;
    alphaImage.data[offset] = 255;
    alphaImage.data[offset + 1] = 255;
    alphaImage.data[offset + 2] = 255;
    alphaImage.data[offset + 3] = TRIANGLE_TEXTURE_RGBA[offset + 3];
  }

  colorContext.putImageData(colorImage, 0, 0);
  alphaContext.putImageData(alphaImage, 0, 0);
  return {
    colorCanvas,
    alphaCanvas,
  };
}
