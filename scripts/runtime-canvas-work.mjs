// 只用于独立计数；所有包装在 finally 中恢复，不进入发布运行时。
export function trackCanvasWork(fx, canvasPrototype, gradientPrototype)
{
  const counts = { linearGradients: 0, conicGradients: 0, radialGradients: 0,
    linearStops: 0, conicStops: 0, radialStops: 0, cachedLinearAssignments: 0,
    boundsRequests: 0, boundsComputations: 0 };
  const kinds = new WeakMap();
  const created = new WeakSet();
  const restores = [];
  const wrap = (object, name, wrapper) =>
  {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    const original = object[name];
    object[name] = wrapper(original);
    restores.push(() => descriptor ? Object.defineProperty(object, name, descriptor) : delete object[name]);
  };
  const restore = () => { for (const undo of restores.splice(0).reverse()) undo(); };
  try
  {
    for (const stroke of fx.trailStrokes)
      for (const mesh of stroke.trailFrameData?.meshCache?.values() ?? [])
        for (const group of mesh.canvasGradientCache ?? [])
          for (const records of [group.segments, group.caps])
            for (const record of records.values()) kinds.set(record.gradient, 'linear');
    for (const kind of ['linear', 'conic', 'radial'])
    {
      const name = `create${kind[0].toUpperCase()}${kind.slice(1)}Gradient`;
      if (typeof canvasPrototype[name] !== 'function') continue;
      wrap(canvasPrototype, name, original => function (...args)
      {
        const gradient = original.apply(this, args);
        counts[`${kind}Gradients`]++;
        kinds.set(gradient, kind); created.add(gradient);
        return gradient;
      });
    }
    wrap(gradientPrototype, 'addColorStop', original => function (...args)
    {
      const kind = kinds.get(this);
      if (kind) counts[`${kind}Stops`]++;
      return original.apply(this, args);
    });
    const style = Object.getOwnPropertyDescriptor(canvasPrototype, 'fillStyle');
    if (style?.set)
    {
      Object.defineProperty(canvasPrototype, 'fillStyle', { ...style, set(value)
      {
        if (kinds.get(value) === 'linear' && !created.has(value)) counts.cachedLinearAssignments++;
        return style.set.call(this, value);
      } });
      restores.push(() => Object.defineProperty(canvasPrototype, 'fillStyle', style));
    }
    for (const [name, key] of [['_getCanvasOverlayPixelBounds', 'boundsRequests'], ['_getCanvasOverlayBounds', 'boundsComputations']])
      wrap(fx, name, original => function (...args) { counts[key]++; return original.apply(this, args); });
  }
  catch (error) { restore(); throw error; }
  return { counts, restore };
}
