function collector()
{
  const seen = new WeakSet();
  const counts = { arrays: 0, samples: 0, segments: 0, points: 0 };
  const add = (value, kind) =>
  {
    if (value && !seen.has(value)) { seen.add(value); counts[kind]++; }
  };
  return { counts, visit(data)
  {
    if (!data) return;
    for (const key of ['pointProgresses', 'segmentProgresses', 'pointCoverageFactors', 'segmentCoverageFactors',
      'pointEnergies', 'segmentEnergies', 'segmentMaximumEnergies', 'pointTransverseProfiles', 'pointCoverageProfiles',
      'segmentTransverseProfiles', 'segmentCoverageProfiles']) add(data[key], 'arrays');
    add(data.measurement.distances, 'arrays'); add(data.measurement.segmentLengths, 'arrays');
    for (const key of ['pointEnergies', 'segmentEnergies', 'segmentTransverseProfiles', 'segmentCoverageProfiles'])
    {
      const count = key.startsWith('point') ? data.pointCount ?? data[key]?.length : data.segmentCount ?? data[key]?.length;
      for (let index = 0; index < count; index++)
      {
        const value = data[key]?.[index]; add(value, 'arrays');
        if (key.endsWith('Profiles')) for (const pair of value ?? []) add(pair, 'arrays');
      }
    }
    for (const sample of data.gpuPointCache?.samples ?? [])
    { add(sample, 'samples'); add(sample.color, 'arrays'); }
    for (const mesh of data.meshCache?.values() ?? [])
    {
      add(mesh.segments, 'arrays'); add(mesh.caps, 'arrays');
      for (const segment of mesh.segments)
      {
        if (!segment) continue;
        add(segment, 'segments');
        for (const key of ['tangent', 'normal', 'fromLeft', 'fromRight', 'toLeft', 'toRight']) add(segment[key], 'points');
        const join = segment.endJoin;
        if (join) { add(join.inner, 'points'); add(join.outerArc, 'arrays'); for (const point of join.outerArc) add(point, 'points'); }
      }
      for (const cap of mesh.caps) for (const point of cap.points) add(point, 'points');
    }
  } };
}

export async function probeTrailWork(fx, render, capture, full, benchmark = false, realNow)
{
  fx.clear();
  if (full) { fx.updateConfig({ clickEnabled: false }); fx.setFxParam('shards.maxCount', 0); }
  const hashes = [], work = collector();
  const move = frame =>
  {
    fx.pointerMove({ x: 160 + 100 * Math.sin(frame % 120 * 0.25),
      y: 120 + 80 * Math.cos(frame % 120 * 0.25), pointerId: 71 });
    render(17);
  };
  fx.pointerDown({ x: 10, y: 120, pointerId: 71 }); render(17);
  fx.pointerMove({ x: 100, y: 120, pointerId: 71 });
  for (let frame = 0; frame < 60; frame++)
  {
    move(frame); work.visit(fx.currentTrailStroke?.trailFrameData);
    if (!benchmark && frame % 15 === 0) hashes.push((await capture()).hash);
  }
  const first60 = { ...work.counts };
  const warmEnd = benchmark ? 360 : 240;
  const measuredEnd = benchmark ? 960 : 360;
  for (let frame = 60; frame < warmEnd; frame++) { move(frame); work.visit(fx.currentTrailStroke?.trailFrameData); }
  const warm = { ...work.counts };
  const frameMs = [];
  const heapBefore = benchmark ? performance.memory?.usedJSHeapSize ?? null : null;
  if (benchmark) performance.mark('trail-measure-start');
  for (let frame = warmEnd; frame < measuredEnd; frame++)
  {
    const start = benchmark ? realNow() : 0;
    move(frame);
    if (benchmark) frameMs.push(realNow() - start);
    else work.visit(fx.currentTrailStroke?.trailFrameData);
  }
  if (benchmark) performance.mark('trail-measure-end');
  const heapAfter = benchmark ? performance.memory?.usedJSHeapSize ?? null : null;
  const growth = Object.fromEntries(Object.keys(warm).map(key => [key, work.counts[key] - warm[key]]));
  const stroke = fx.currentTrailStroke;
  const retained = { points: stroke?.trailFrameData?.pointCount ?? stroke?.renderPoints?.length,
    distanceCapacity: stroke?.trailFrameData?.measurement.distances.length,
    sampleCapacity: stroke?.trailFrameData?.gpuPointCache?.pool?.length ?? stroke?.trailFrameData?.gpuPointCache?.samples.length,
    meshSlots: stroke?.trailFrameData?.meshCache?.size };
  if (!benchmark)
  {
    hashes.push((await capture()).hash);
    fx.setPaused(true); render(100); hashes.push((await capture()).hash); fx.setPaused(false);
    if (full)
    {
      fx.setThemeColor('#ff6699'); fx.setFxParams({ 'trail.numCornerVertices': 4, 'trail.numCapVertices': 1 });
      move(measuredEnd); hashes.push((await capture()).hash);
      fx.updateConfig({ scale: 1.3 }); move(measuredEnd + 1); hashes.push((await capture()).hash);
    }
    fx.pointerUp({ x: 160, y: 120, pointerId: 71 });
    render(80); hashes.push((await capture()).hash);
    render(2000); hashes.push((await capture()).hash);
  }
  fx.clearTrail();
  const released = !stroke?.trailFrameData && !stroke?.trailWork;
  return { hashes, first60, warm, growth, retained, released, frameMs, heapBefore, heapAfter };
}
