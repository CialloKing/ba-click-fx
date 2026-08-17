import { BAClickFX } from '../../dist/ba-click-fx.js';

let fx = null;

function getState()
{
  const config = fx.getConfig();

  return {
    width: fx.width,
    height: fx.height,
    dpr: fx.dpr,
    backingWidth: fx.canvas.width,
    backingHeight: fx.canvas.height,
    effectBackend: config.effectBackend,
    renderingMode: config.renderingMode,
    resolvedEffectBackend: config.resolvedEffectBackend,
    destroyed: fx.destroyed,
  };
}

function readPresentedPixels()
{
  const renderer = fx?.webglEffectRenderer;
  const gl = renderer?.gl;
  const width = fx?.canvas?.width ?? 0;
  const height = fx?.canvas?.height ?? 0;
  const pixels = new Uint8Array(width * height * 4);
  let visiblePixels = 0;
  let maximumChannel = 0;
  let minimumX = width;
  let maximumX = -1;

  if (!gl || renderer.contextLost || width <= 0 || height <= 0)
  {
    return { width, height, visiblePixels, maximumChannel, visibleWidth: 0 };
  }

  const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.finish();
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);

  for (let index = 0; index < pixels.length; index += 4)
  {
    const energy = Math.max(
      pixels[index],
      pixels[index + 1],
      pixels[index + 2],
    );

    if (energy <= 8)
    {
      continue;
    }

    const x = (index / 4) % width;

    visiblePixels++;
    maximumChannel = Math.max(maximumChannel, energy);
    minimumX = Math.min(minimumX, x);
    maximumX = Math.max(maximumX, x);
  }

  return {
    width,
    height,
    visiblePixels,
    maximumChannel,
    visibleWidth: maximumX >= minimumX ? maximumX - minimumX + 1 : 0,
  };
}

function inspectPresentedPixels()
{
  return new Promise((resolve) =>
  {
    const inspect = () => resolve(readPresentedPixels());

    // Queue after the engine's pending frame so preserveDrawingBuffer=false
    // cannot discard the default framebuffer before the test reads it.
    if (typeof requestAnimationFrame === 'function')
    {
      requestAnimationFrame(inspect);
      return;
    }

    setTimeout(inspect, 1000 / 60);
  });
}

self.addEventListener('message', async (event) =>
{
  const { id, type, payload } = event.data;
  let result = null;

  try
  {
    switch (type)
    {
      case 'init':
        fx = new BAClickFX(
          {
            target: payload.canvas,
            inputSource: 'manual',
            effectBackend: 'webgl2',
            maxDpr: 2,
          },
        );
        // SwiftShader 帧缓冲读回可能超过默认 300ms；延长测试几何寿命，
        // 让像素断言验证 Worker 渲染，而不是依赖 CI 机器速度。
        fx.setFxParam('trail.lifetimeMs', 10000);
        fx.resize(payload.width, payload.height, payload.dpr);
        break;

      case 'resize':
        fx.resize(payload.width, payload.height, payload.dpr);
        break;

      case 'pointerDown':
        fx.pointerDown(payload);
        break;

      case 'pointerMove':
        fx.pointerMove(payload);
        break;

      case 'pointerUp':
        fx.pointerUp(payload.pointerId);
        break;

      case 'clearTrail':
        fx.clearTrail();
        break;

      case 'boom':
        fx.boom(payload.x, payload.y);
        break;

      case 'updateConfig':
        fx.updateConfig(payload);
        break;

      case 'destroy':
        fx.destroy();
        break;

      case 'state':
        break;

      case 'pixels':
        result = await inspectPresentedPixels();
        break;

      default:
        throw new Error(`Unknown command: ${type}`);
    }

    self.postMessage({ id, ok: true, result: result ?? getState() });
  }
  catch (error)
  {
    self.postMessage(
      {
        id,
        ok: false,
        error: String(error?.stack ?? error),
      },
    );
  }
});
