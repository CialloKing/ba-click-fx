import { BAClickFX } from './fx.js';

let fx = null;

self.onmessage = (e) =>
{
  const { type, ...data } = e.data;

  switch (type)
  {
    case 'INIT':
    {
      const { canvas, width, height, dpr, options } = data;
      fx = new BAClickFX({
        target: canvas,
        inputSource: 'manual',
        maxDpr: dpr || 1,
        ...options,
      });
      fx.resize(width, height, dpr);
      break;
    }

    case 'RESIZE':
    {
      fx?.resize(data.width, data.height, data.dpr);
      break;
    }

    case 'POINTER_DOWN':
    {
      fx?.pointerDown(data);
      break;
    }

    case 'POINTER_MOVE':
    {
      fx?.pointerMove(data);
      break;
    }

    case 'POINTER_UP':
    {
      fx?.pointerUp(data.pointerId);
      break;
    }

    case 'POINTER_CANCEL':
    {
      fx?.pointerCancel(data.pointerId);
      break;
    }

    case 'BOOM':
    {
      fx?.boom(data.x, data.y);
      break;
    }

    case 'PAUSE':
    {
      fx?.setPaused(data.paused, { clear: data.clear });
      break;
    }

    case 'UPDATE_CONFIG':
    {
      fx?.updateConfig(data.config);
      break;
    }

    case 'SET_THEME_COLOR':
    {
      fx?.setThemeColor(data.color, data.mode);
      break;
    }

    case 'DESTROY':
    {
      fx?.destroy();
      fx = null;
      break;
    }
  }
};
