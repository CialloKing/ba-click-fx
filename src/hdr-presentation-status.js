/**
 * 合并 Canvas 协商与显示环境提示。浏览器无法在网页内证明面板实际尼特，
 * 因此 ready 只表示浏览器侧条件已经齐备。
 */
export function resolveHdrPresentationState(options = {})
{
  const requested = options.webgpuRequested === true;
  const backend = options.resolvedBackend;
  const outputMode = options.outputMode;

  if (!requested)
  {
    return 'inactive';
  }

  if (backend === 'pending' || outputMode === 'pending')
  {
    return 'pending';
  }

  if (backend !== 'webgpu')
  {
    return 'unavailable';
  }

  if (outputMode === 'standard')
  {
    return 'standard';
  }

  if (outputMode !== 'extended')
  {
    return 'pending';
  }

  return options.dynamicRangeHigh === true
    ? 'ready'
    : 'display-unconfirmed';
}
