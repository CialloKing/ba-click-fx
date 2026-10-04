// 同环境改动前/后运行并比较完整帧哈希；不把 Canvas 后端差异固化成跨机器像素阈值。
export async function canvasAlphaFixture({ includeBytes = false, bloomBackend = 'software', bentTrail = false } = {})
{
  const { BAClickFX } = await import('../src/fx.js');
  const nowDescriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  const random = Math.random, raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;width:320px;height:240px;left:0;top:0';
  document.body.appendChild(host);
  let fx;
  const records = [];
  try
  {
    Object.defineProperty(performance, 'now', { configurable: true, value: () => 100 });
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
    for (const [limit, policy, compensation, opacity, theme] of [
      [250 / 255, 'coverage', 'none', 1, '#4ca7ff'],
      [1, 'coverage', 'none', 1, '#4ca7ff'],
      [1, 'coverage', 'bright-core', 0.4, '#ff6699'],
      [1 - 1e-4, 'coverage', 'bright-core', 1, '#4ca7ff'],
      [1, 'visual-max', 'none', 0.4, '#ff6699'],
      [1, 'visual-max', 'bright-core', 1, '#ff6699'],
    ])
    {
      let seed = 12345;
      Math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
      fx = new BAClickFX({ target: host, inputSource: 'manual', effectBackend: 'canvas2d', bloomBackend,
        outputCompositing: 'browser-overlay', overlayAlphaLimit: limit, overlayAlphaPolicy: policy,
        overlayColorCompensation: compensation, opacity, themeColor: theme, themeColorMode: 'relative-oklch' });
      fx.setFxParam('shards.maxCount', 0);
      fx.pointerDown({ x: 20, y: 80, pointerId: 1 });
      fx._appendPointerSample({ x: 280, y: 140 }, fx._getTrailInputTime(100));
      if (bentTrail)
      {
        // 两侧转角、折返及重复点与直线使用同一完整帧字节对照。
        for (const [x, y] of [[180, 40], [80, 160], [180, 40], [180, 40]])
          fx._appendPointerSample({ x, y }, fx._getTrailInputTime(100));
      }
      fx.boom(90, 110); fx.boom(160, 120);
      for (let i = 0; i < 20; i++) fx._renderFrame(220);
      const frames = [];
      const capture = async () =>
      {
        const bytes = fx.context.getImageData(0, 0, fx.canvas.width, fx.canvas.height).data;
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        let binary = '';
        if (includeBytes)
          for (let start = 0; start < bytes.length; start += 16384)
            binary += String.fromCharCode(...bytes.subarray(start, start + 16384));
        frames.push({ hash, byteLength: bytes.byteLength, visible: bytes.some(value => value !== 0), backend: fx.resolvedBloomBackend,
          ...(includeBytes ? { bytes: btoa(binary) } : {}) });
      };
      for (const time of [220, 236, 260])
      {
        fx._renderFrame(time);
        if (fx.resolvedBloomBackend !== bloomBackend || (bloomBackend === 'software' && !fx.lastSoftwareBloomFrame))
          throw Error('Alpha 字节夹具发生意外后端回退');
        await capture();
      }
      // 模拟源回读失败，检查同帧回退在相同输入下仍保持输出。
      const context = bloomBackend === 'software' ? fx.bloomRenderers[0].sourceContext : null;
      if (context)
      {
      const descriptor = Object.getOwnPropertyDescriptor(context, 'getImageData');
      context.getImageData = () => { throw Error('injected Software readback failure'); };
      try { fx._renderFrame(260); await capture(); }
      finally
      {
        if (descriptor) Object.defineProperty(context, 'getImageData', descriptor);
        else delete context.getImageData;
      }
      }
      records.push({ limit, policy, compensation, opacity, theme, width: fx.canvas.width, height: fx.canvas.height, frames });
      fx.destroy(); fx = null;
    }
    return records;
  }
  finally
  {
    try { fx?.destroy(); }
    finally
    {
      host.remove();
      if (nowDescriptor) Object.defineProperty(performance, 'now', nowDescriptor);
      else delete performance.now;
      Math.random = random; window.requestAnimationFrame = raf; window.cancelAnimationFrame = cancel;
    }
  }
}
