export const TRIANGLE_TEXTURE_SIZE = 128;

const PALETTE_BASE64 = 'AAAAAK2urbT/+/////////f39/+kpKS2OTo5GQAAACSqp6qRpKSkkf///9oQDBAOVVVVbaqqqtpVVVVIpaalpKqrqrYABAAAAAAAFwAEACRlY2VxVVdVbRgYGAj/+//b3t/e3lVTVUiqp6q2qqqqtlVTVSRVVVUkqqqqkRAUEBP38/fsAAAAIVpXWm1SUVJlCAQIAKyrrNrCwcLIWldaSEpFSkGko6S29/P3/6SmpLako6SRpKakkefj5+T39/faWllaWgAEACL3+/fxUlZSZ1JTUm3FxcXl9/P32lJRUktSU1JIp6intvf79/+sq6y2CAQIJAgMCCSnqKeRrKuskQgMCAD3+/fa//v/2mNlY2SlpqWnCAgIJFdVV21aWVptCAgIAFdVV0haWVpIvbq9wD8+Pzavq6+aEAwQFU9PT23v7+//UlJSbe/v79pPT09IUlJSSK2ura8hJCElp6enkaSopJFXV1dtUlZSbcbDxshCQUI5r7CvnBAUEBn38/fzVVZVbVVWVUiqqKq2KSwpK+fr5/tNTk0jrKqskZqcmo/////pa2lraaqrqtpVV1VI9/f396SnpJGEgoSCAAAAElpaWkmkp6S2rKystggICAFPT08k7+/v/VJSUiSfn5+Q////63Nxc3MFBQUFV1ZXSKyqrLaMjoyMn5+fkQAAABRfXV9uEAwQAq+ur9rOy87LCAgICEpKSl+6uLrDMSwxLaSipJFSUVJt1tPW00JFQkTn5+fkTU1NYQ==';
const RUNS_BASE64 = '/wD/AP8A/wD/AP8A/wD/AIsAAQEEAnQDAQQBBQUAAQYEAnQDAQQBBwYAAQgDAnQDAQkIAAEKdQMBCgELCAABDHUDAQwKAAENcwMBDQsAAQ5zAwEODAABDwQCbQMBEAIRCwABEgQCbQMBEwIRDAABFAMCbAMBFQMRDAABFgEXAgJrAwEYBBENAAEZAgJrAwEOEgABGgECagMBGxMAARwBAmoDAR0UAAEIaQMBHhUAAR8BCmcDASABIRYAASJnAwEjFwABJAElZQMBJhgAASQBJ2UDASgYAAIRASkBKmADAgQBKwERGAACEQETASpgAwIEARMBERgAAxEBLGADAQQBLQIRGAAEEQEuXwMBLwMRHAABDl8DATAgAAEbXQMBGyEAAR1dAwEdIgABHlsDAR4hAAIRATEBMlgDAioBEwERIAADEQEzWAMBKgE0AhEgAAQRATVXAwE2AxEgAAQRATdXAwE4AxEkAAEkATkCOlADAwIBOygAASQBPAI6UAMDAgE9KAACJAE+ATpQAwICAT8BQCgAAyQBQVADAQIBQgJAKwABQ1EDAQwuAAENTwMBDS8AAQ5PAwEOMAABG00DAUQwAAEkATwCBEgDAwIBRTAAAiQBRgEESAMCAgFHAUgwAAMkAS9IAwECAUICSDAAAyQBSUgDAQIBSgJINAABGgMCQAMEAgFLNwABHAMCQAMEAgFMOAABCAICQAMDAgFNOQABBwICQAMDAgFOOgABTwFQQAMCBAFRPAABUkADAQQBLz0AAVNAAwEEAVQ+AAFVPwMBBT8AAUUDBDgDBDoBVj8AAUgBVwIEOAMDOgFYQAACSAEvAQQ4AwI6AUEBEUAAAkgBWQEEOAMCOgFaARFDAAFbOQMBDUUAAVw5AwEORgABXTcDAR5HAAFeNgMBXwEHRwABEQFgAgIzAwEiSAACEQFCAQIyAwEKASRIAAIRAWEBAjIDAScBJEgAAxEBYjEDATsCJEsAAWMEAiwDAWQBZU4AAWYDAiwDAWdPAAFIAUICAisDAWhQAAFIAUcCAisDAWlSAAENKwMBagERUgABDisDAWsBEVMAARspAwEQAhFTAAEHAWwoAwETAhFUAAFtAzokAwFuWAABQQI6IwMBCgFvWAABOAI6IwMBcFoAAXEBOiIDAXIBc1oAAXQBdSADAgQBdlwAAXcgAwEEAQldAAEHAXgfAwEEAQdeAAF5HwMBUV8AASQBQQI6GAMDAgFCAXpfAAEkAXsCOhgDAwIBSmAAAiQBOQE6GAMCAgF8AUhgAAIkATwBOhgDAgIBRQFIYwABfRgDAVABfmUAAX8BChcDAVJnAAGAFwMBT2cAAYEBghUDAYNoAAERAWECAhMDASdoAAIRAWIBAhIDATsBJGgAAhEBEwECEgMBPAEkaAADEQFgEQMBIgIkawABhAFCAwIMAwEYbwABGQMCDAMBhXAAARoCAgsDAYZxAAEcAgILAwGHcgABiAEqCgMBPwEkcgABBwE2CQMBCgE8ASRzAAGJCQMBIgIkdAABigcDASUDJHQAATgDOgQCAYt4AAFxAjoDAgF8eQABBwI6AwIBRXoAAW0BOgICAWYBSHsAAYwBKgE2fQABjQEqAYl+AAGI/wD/AMEA';

// Coverage 在离线阶段由原始纹理 Alpha 与源 RGB 支持面共同定标。
// 运行时只解码固定字节，不读取主题色、HDR 发射或最终 Bloom 颜色。
const COVERAGE_RUNS_BASE64 = '/wD/AP8A/wD/AP8A/wD/AIsAAa54/wH3AaQFAAEZeP8B9wcAAZF3/wGRCAAB2nX/AdoBDggAAVV1/wFVCgABqnP/AaoLAAFIc/8BSAwAAaRx/wGrDgBx/wEEDgABZW//AVcPAAEIAdtt/wHeEQABSG3/AUgSAAGqa/8BqhMAASRr/wEkFAABkWn/AZEVAAETAdpn/wHsFwABWmf/AVIYAAGsZf8BwhkAAUhl/wFBGgABpAH3YP8C9wGmGwABBAH3YP8C9wEEHAABkWD/AfcBkR4AAeRf/wHaHwABSF//AVogAAGqXf8BqiEAASRd/wEkIgABkVv/AZEjAAEEAfFY/wL3AQQkAAFWWP8B9wFTJgABxVf/AdonAAFLV/8BSCgAAagC+1P/AawpAAEIAvtT/wEMKgABkQH7Uv8BkSwAAdpR/wHaLQABZFH/AVUuAAGqT/8Bqi8AAUhP/wFIMAABqk3/AaYxAAEIAvdL/wEIMgABVwH3Sv8BWjQAAdpJ/wHaNQABSEn/AUg2AAGqR/8BvTcAASRH/wE2OAABkUX/AZo6AEX/ARA6AAFPAe9A/wL3AVI8AAHaQP8B9wHaPQABSED/AfcBSD4AAa4//wGkPwABCAP3OP8E+wEkQAABkQL3OP8D+wGRQgAB2gH3OP8C+wHaQwABVwH3OP8C+wFWRAABxjn/AapFAAE5Of8BSEYAAZw3/wGRRwABFDb/AfNJAAFWNf8BWkoAAdoz/wHaSwABSDP/AUhMAAGqMf8BrE0AASsw/wHrASNOAAGRL/8Bj1AAAdot/wHpUQABWi3/AWlSAAGqK/8Bq1MAAUgr/wFIVAABqin/AatWAAH3KP8BBFYAAZED+yT/AYJYAAHaAvsj/wHaWQABSAL7I/8BSVoAAacB+yL/AawBAVoAASQB7yD/AvcBJFwAAZAg/wH3AZFeAAHrH/8B918AAXMf/wFSYAAB2gL7G/8B2gEFYAABSAL7G/8BSGIAAagB+xr/AaxjAAEIAfsa/wEIZAABjBj/Ae8BkWYAAdoX/wHaZwABXxf/AU9nAAECAa8V/wHLaQABSBX/AUhqAAGqE/8BrGsAAQQT/wEIbAABVhH/AVptAAEIAdoP/wHebwABSA//AUpwAAGqDf8BunEAASQN/wEtcgABkQH3Cv8BkXQAAdoJ/wHaAQh0AAFSCf8BWnYAAdMH/wGsdwABSAP7BP8BRHgAAacC+wP/Aax6AAL7A/8BCHoAAZEB+wL/AZF8AAHkAfcB2n0AAU0B9wFSfgABkf8A/wDBAA==';

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

  // TypedArray 会静默忽略越界写入，必须显式阻止损坏的 RLE 纹理错位渲染。
  if (outputOffset !== output.length)
  {
    throw new Error('三角纹理 RLE 长度无效');
  }

  return output;
}

function decodeTriangleCoverage()
{
  const runs = decodeBase64(COVERAGE_RUNS_BASE64);
  const output = new Uint8Array(
    TRIANGLE_TEXTURE_SIZE * TRIANGLE_TEXTURE_SIZE,
  );
  let outputOffset = 0;

  for (let runOffset = 0; runOffset < runs.length; runOffset += 2)
  {
    const count = runs[runOffset];
    const value = runs[runOffset + 1];

    output.fill(value, outputOffset, outputOffset + count);
    outputOffset += count;
  }

  if (outputOffset !== output.length)
  {
    throw new Error('三角 Coverage RLE 长度无效');
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
export const TRIANGLE_TEXTURE_COVERAGE = decodeTriangleCoverage();
export const TRIANGLE_TEXTURE_OVERLAY_RGBA = (() =>
{
  const output = TRIANGLE_TEXTURE_RGBA.slice();

  for (let index = 0; index < TRIANGLE_TEXTURE_COVERAGE.length; index++)
  {
    output[index * 4 + 3] = TRIANGLE_TEXTURE_COVERAGE[index];
  }

  return output;
})();

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
  const coverageCanvas = createCanvas();

  colorCanvas.width = TRIANGLE_TEXTURE_SIZE;
  colorCanvas.height = TRIANGLE_TEXTURE_SIZE;
  alphaCanvas.width = TRIANGLE_TEXTURE_SIZE;
  alphaCanvas.height = TRIANGLE_TEXTURE_SIZE;
  coverageCanvas.width = TRIANGLE_TEXTURE_SIZE;
  coverageCanvas.height = TRIANGLE_TEXTURE_SIZE;

  const colorContext = colorCanvas.getContext('2d');
  const alphaContext = alphaCanvas.getContext('2d');
  const coverageContext = coverageCanvas.getContext('2d');

  if (
    !colorContext ||
    !alphaContext ||
    !coverageContext ||
    typeof colorContext.createImageData !== 'function' ||
    typeof alphaContext.createImageData !== 'function' ||
    typeof coverageContext.createImageData !== 'function'
  )
  {
    colorCanvas.width = 0;
    colorCanvas.height = 0;
    alphaCanvas.width = 0;
    alphaCanvas.height = 0;
    coverageCanvas.width = 0;
    coverageCanvas.height = 0;
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
  const coverageImage = coverageContext.createImageData(
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
    coverageImage.data[offset] = 255;
    coverageImage.data[offset + 1] = 255;
    coverageImage.data[offset + 2] = 255;
    coverageImage.data[offset + 3] =
      TRIANGLE_TEXTURE_COVERAGE[offset / 4];
  }

  colorContext.putImageData(colorImage, 0, 0);
  alphaContext.putImageData(alphaImage, 0, 0);
  coverageContext.putImageData(coverageImage, 0, 0);
  return {
    colorCanvas,
    alphaCanvas,
    coverageCanvas,
  };
}
