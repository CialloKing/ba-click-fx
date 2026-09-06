import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(new URL('./run.mjs', import.meta.url));

export function runBrowserSuite(name)
{
  const forwardedArguments = process.argv.slice(2).filter(
    (argument) => !argument.startsWith('--suite='),
  );
  const result = spawnSync(
    process.execPath,
    [runnerPath, `--suite=${name}`, ...forwardedArguments],
    { stdio: 'inherit' },
  );

  if (result.error)
  {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}
