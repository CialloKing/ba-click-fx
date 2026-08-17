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
    resolvedEffectBackend: config.resolvedEffectBackend,
    destroyed: fx.destroyed,
  };
}

self.addEventListener('message', (event) =>
{
  const { id, type, payload } = event.data;

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

      case 'boom':
        fx.boom(payload.x, payload.y);
        break;

      case 'destroy':
        fx.destroy();
        break;

      case 'state':
        break;

      default:
        throw new Error(`Unknown command: ${type}`);
    }

    self.postMessage({ id, ok: true, result: getState() });
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
