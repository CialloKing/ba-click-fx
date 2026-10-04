// 开发夹具重放最终状态；不使用网页随机数，也不再求值粒子曲线。
export async function replayUnityGeometry(renderer, particles, state, configuration)
{
  const height = particles.renderSize.height;
  const pixels = height / 2;
  const screen = point => ({ x: 975 + point.x * pixels, y: height / 2 - point.y * pixels });
  const inputs = [];
  for (const system of particles.systems)
  {
    const mesh = state.particles.find(candidate => candidate.name === system.name);
    if (!mesh) throw new Error(`没有 ${system.name} 的同步网格状态`);
    if (!state.showParticles || system.particleCount === 0) continue;
    const count = system.name === 'MeshTri' ? 130 : 4;
    if (mesh.vertices.length !== count * system.particleCount) throw new Error(`${system.name} 网格与粒子数量不匹配`);
    const used = new Set();
    for (const particle of system.particles)
    {
      const center = screen(particle.worldPosition);
      const effectiveScale = mesh.scalingMode === 'Shape' ? 1 : mesh.scale.x;
      const expectedRadius = particle.size * effectiveScale * (count === 130 ? 1.0636684 : 0.5);
      let match = null;
      for (let block = 0; block < system.particleCount; block++)
      {
        if (used.has(block)) continue;
        const offset = block * count;
        const vertices = mesh.vertices.slice(offset, offset + count);
        let x = 0; let y = 0;
        // 环带接缝重复；用包围框中心校验，避免均值被重复点偏移。
        if (count === 4)
        {
          for (const vertex of vertices) { x += vertex.x / 4; y += vertex.y / 4; }
        }
        else
        {
          x = (Math.min(...vertices.map(v => v.x)) + Math.max(...vertices.map(v => v.x))) / 2;
          y = (Math.min(...vertices.map(v => v.y)) + Math.max(...vertices.map(v => v.y))) / 2;
        }
        const radius = count === 130 ? Math.max(...vertices.map(v => Math.hypot(v.x - particle.worldPosition.x, v.y - particle.worldPosition.y)))
          : Math.hypot(vertices[1].x - vertices[0].x, vertices[1].y - vertices[0].y) / 2;
        const error = Math.hypot(x - particle.worldPosition.x, y - particle.worldPosition.y) + Math.abs(radius - expectedRadius);
        if (!match || error < match.error) match = { block, offset, vertices, radius, error };
      }
      if (!match || match.error > 0.0001) throw new Error(`${system.name} 烘焙几何与粒子状态不一致：${match?.error}`);
      used.add(match.block);
      const color = mesh.colors[match.offset];
      if (!color) throw new Error('缺少 Unity 最终线性顶点色');
      const energy = ['r', 'g', 'b'].map(channel => color[channel] * mesh.materialColor[channel] * mesh.materialIntensity);
      const rotation = -2 * Math.atan2(particle.rotation.z, particle.rotation.w);
      if (system.name === 'ring')
      {
        renderer.addAlphaBlendDisk(center.x, center.y, match.radius * pixels, energy, 1, color.a, rotation);
      }
      else if (system.name === 'MeshTri')
      {
        const candidates = match.vertices.map((vertex, index) => ({ vertex, uv: mesh.uv[match.offset + index] }));
        const seam = candidates.filter(vertex => vertex.uv.y > 0.99).sort((a, b) => a.uv.x - b.uv.x)[0];
        if (!seam) throw new Error('缺少圆环外缘接缝');
        const angle = Math.atan2(-(seam.vertex.y - particle.worldPosition.y), seam.vertex.x - particle.worldPosition.x);
        const outerRadius = match.radius * pixels;
        const width = outerRadius * configuration.rings.bandToOuterRadius;
        renderer.addDissolveRing(center.x, center.y, outerRadius - width * 0.5, width, angle,
          configuration.rings.radialSamples, configuration.rings.arcSamples, energy, color.a,
          particle.custom1.x, configuration.rings.textureUvMin, configuration.rings.textureUvMax, configuration.rings.dissolveDirection);
      }
      else
      {
        renderer.addTriangle(center.x, center.y, match.radius * 2 * pixels, rotation, energy, color.a, particle.atlasFrame, 0);
      }
      inputs.push({ system: system.name, index: particle.index, center, radius: match.radius * pixels, geometryStateError: match.error });
    }
  }
  let trailModule;
  for (const trail of state.trails)
  {
    if (!trail.enabled || trail.positions.length < 2) continue;
    if (!trailModule)
    {
      let source = await (await fetch('/src/fx.js')).text();
      source = source.replace(/from\s*(['"])((?:\.\/|\/)[^'"]+)\1/g, (_, quote, path) => `from '${new URL(path, new URL('/src/fx.js', location.href)).href}'`);
      source += '\nexport { appendTrailWebGLScene, createTrailMesh };';
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      try { trailModule = await import(url); } finally { URL.revokeObjectURL(url); }
    }
    const points = trail.positions.map(position => ({ ...screen(position), t: state.timeMs }));
    trailModule.appendTrailWebGLScene(renderer, points, height / 1080, 1, configuration);
    inputs.push({ system: 'TrailRenderer', pointCount: points.length, unityVertices: trail.vertices.length,
      webVertices: renderer.trailVertexCount, points });
  }
  return inputs;
}

function base64(bytes)
{
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export async function captureWebStages(backend, particles, state)
{
  const { UNITY_FX_TOUCH } = await import('/src/config.js');
  const { WebGL2EffectRenderer } = await import('/src/webgl2-effect.js');
  const { WebGPUEffectRenderer } = await import('/src/webgpu-effect.js');
  const width = particles.renderSize.width; const height = particles.renderSize.height;
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const renderer = backend === 'webgl2' ? new WebGL2EffectRenderer(canvas) : new WebGPUEffectRenderer(canvas, { preferHdr: false });
  let restoreTexture;
  let diagnosticFinal;
  let validationScope = false;
  try
  {
    if (backend === 'webgpu')
    {
      const deviceReady = await renderer.deviceManager.ready;
      await renderer.ready;
      if (!renderer.available)
      {
        if (deviceReady) throw new Error('WebGPU 已获得设备但渲染器初始化失败');
        return { skipped: true, reason: renderer.deviceManager.diagnostics ?? renderer.status };
      }
      const device = renderer.device;
      device.pushErrorScope('validation'); validationScope = true;
      const original = device.createTexture;
      device.createTexture = function (description) { return original.call(this, { ...description, usage: description.usage | GPUTextureUsage.COPY_SRC }); };
      restoreTexture = () => { device.createTexture = original; };
    }
    if (!renderer.available) throw new Error(`${backend} 初始化失败`);
    if (!renderer.resize(width, height, 1, 0.5, 7)) throw new Error(`${backend} resize 失败`);
    const background = document.createElement('canvas'); background.width = width; background.height = height;
    const context = background.getContext('2d'); context.fillStyle = 'black'; context.fillRect(0, 0, width, height);
    if (!renderer.setCompositingReference(background)) throw new Error('已知黑色背景上传失败');
    renderer.beginFrame();
    const inputs = await replayUnityGeometry(renderer, particles, state, UNITY_FX_TOUCH);
    const settings = { ...UNITY_FX_TOUCH.bloom, outputCompositing: 'scene', opacity: 1, overlayAlphaLimit: 1 };
    if (!renderer.renderScene(settings) || !renderer.render(settings, { preserveCanvas: true })) throw new Error(`${backend} 实际渲染失败`);
    const stages = [['00_UI_HDR', renderer.sourceTarget], ...renderer.levels.map((level, index) =>
      [index === 0 ? '10_Prefilter_Down00' : `20_Down${String(index).padStart(2, '0')}`, level.down]),
    ...renderer.levels.slice(0, -1).map((level, index) => [`30_Up${String(index).padStart(2, '0')}`, level.up])];
    if (backend === 'webgl2')
    {
      const gl = renderer.gl;
      const final = renderer._renderFinal;
      diagnosticFinal = renderer._createTarget(width, height);
      const bind = gl.bindFramebuffer;
      try
      {
        // 原 Final Shader 不变，仅把相同输出写到浮点附件以免 8-bit 读回量化。
        gl.bindFramebuffer = function (target, framebuffer) { return bind.call(this, target, framebuffer ?? diagnosticFinal.framebuffer); };
        final.call(renderer, renderer.levels.length > 1 ? renderer.levels[0].up.texture : renderer.levels[0].down.texture, settings, true, true, false);
      }
      finally { gl.bindFramebuffer = bind; }
      stages.push(['40_Composite', diagnosticFinal]);
      for (const [name, target] of stages)
      {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        const values = new Float32Array(target.width * target.height * 4);
        gl.readPixels(0, 0, target.width, target.height, gl.RGBA, gl.FLOAT, values);
        if (gl.getError() !== gl.NO_ERROR) throw new Error(`${name} 浮点回读失败`);
        await window.saveUnityStage({ name, width: target.width, height: target.height, format: 'float32', bytes: base64(new Uint8Array(values.buffer)) });
      }
    }
    else
    {
      const device = renderer.device;
      diagnosticFinal = device.createTexture({ size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
      const oldPipeline = renderer.finalPipeline; const draw = renderer._drawFullscreen;
      try
      {
        renderer.finalPipeline = renderer._createFullscreenPipeline('fragmentFinal', 'rgba16float');
        renderer._drawFullscreen = function (encoder, pipeline, target, ...rest)
        {
          return draw.call(this, encoder, pipeline, pipeline === this.finalPipeline ? diagnosticFinal.createView() : target, ...rest);
        };
        if (!renderer.render(settings, { preserveCanvas: true })) throw new Error('WebGPU 浮点 Final 提交失败');
      }
      finally { renderer._drawFullscreen = draw; renderer.finalPipeline = oldPipeline; }
      stages.push(['40_Composite', { texture: diagnosticFinal, width, height }]);
      await device.queue.onSubmittedWorkDone();
      for (const [name, target] of stages)
      {
        const rowBytes = Math.ceil(target.width * 8 / 256) * 256;
        const buffer = device.createBuffer({ size: rowBytes * target.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try
        {
          const encoder = device.createCommandEncoder();
          encoder.copyTextureToBuffer({ texture: target.texture }, { buffer, bytesPerRow: rowBytes }, [target.width, target.height]);
          device.queue.submit([encoder.finish()]);
          await buffer.mapAsync(GPUMapMode.READ);
          const mapped = new Uint8Array(buffer.getMappedRange());
          const packed = new Uint8Array(target.width * target.height * 8);
          for (let y = 0; y < target.height; y++) packed.set(mapped.subarray(y * rowBytes, y * rowBytes + target.width * 8), (target.height - 1 - y) * target.width * 8);
          await window.saveUnityStage({ name, width: target.width, height: target.height, format: 'float16', bytes: base64(packed) });
        }
        finally { buffer.destroy(); }
      }
    }
    if (validationScope)
    {
      validationScope = false;
      const error = await renderer.device.popErrorScope();
      if (error) throw new Error(`WebGPU 实际提交失败：${error.message}`);
    }
    return { backend, sampleScale: renderer.sampleScale, inputs, outputMode: renderer.deviceManager?.outputMode ?? 'sdr' };
  }
  finally
  {
    if (validationScope) await renderer.device.popErrorScope().catch(() => {});
    restoreTexture?.();
    if (renderer.gl && diagnosticFinal)
    {
      renderer.gl.deleteFramebuffer(diagnosticFinal.framebuffer); renderer.gl.deleteTexture(diagnosticFinal.texture);
    }
    else diagnosticFinal?.destroy();
    renderer.destroy(); canvas.width = 0; canvas.height = 0;
  }
}
