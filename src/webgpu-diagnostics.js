export function formatDiagnosticError(error)
{
  if (!error)
  {
    return '';
  }

  const name = typeof error.name === 'string' && error.name !== 'Error'
    ? error.name
    : '';
  const message = typeof error.message === 'string' && error.message.trim()
    ? error.message
    : typeof error.reason === 'string' && error.reason.trim()
      ? error.reason
      : String(error);

  return name && message ? `${name}: ${message}` : name || message;
}

export function getDiagnosticStageValue(stage, requested, dictionary)
{
  if (!requested || !stage)
  {
    return dictionary.diagnosticNotTested;
  }

  const values = {
    failed: dictionary.diagnosticFailed,
    idle: dictionary.diagnosticNotTested,
    lost: dictionary.diagnosticLost,
    pending: dictionary.diagnosticPending,
    skipped: dictionary.diagnosticSkipped,
    succeeded: dictionary.diagnosticReady,
  };

  return values[stage.status] ?? dictionary.diagnosticUnavailable;
}

export function getWebGPUFailureStage(
  renderer,
  manager,
  diagnostics,
  rendererFallback,
)
{
  const managerFailureStage = diagnostics?.failureStage ?? null;

  if (!renderer)
  {
    return managerFailureStage;
  }

  if (rendererFallback)
  {
    // Extended rejection is compatible with Standard output. Only a failed
    // Standard configuration directly explains a renderer-ready fallback.
    return managerFailureStage === 'standard-configure-failed'
      ? managerFailureStage
      : 'renderer-frame-failed';
  }

  if (renderer.status === 'lost')
  {
    return managerFailureStage ?? 'device-lost';
  }

  if (renderer.status === 'unavailable')
  {
    return manager?.status === 'unavailable' && managerFailureStage
      ? managerFailureStage
      : 'renderer-unavailable';
  }

  return managerFailureStage;
}
