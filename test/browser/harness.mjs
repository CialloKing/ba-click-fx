import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { chromium } from 'playwright-core';
import { createServer as createViteServer } from 'vite';

function findExecutable(candidates)
{
  for (const candidate of candidates)
  {
    if (!candidate)
    {
      continue;
    }

    try
    {
      accessSync(candidate, constants.X_OK);
      return candidate;
    }
    catch
    {
      // 继续检查下一个系统安装位置。
    }
  }

  return null;
}

export function findChromiumExecutable()
{
  const explicit = process.env.BACLICKFX_CHROMIUM_PATH;

  if (explicit)
  {
    // CI 显式路径失效时必须失败，不能静默改用另一个浏览器。
    return findExecutable([explicit]);
  }

  const programFiles = process.env.ProgramFiles;
  const programFilesX86 = process.env['ProgramFiles(x86)'];
  const localAppData = process.env.LOCALAPPDATA;
  const candidates = [
    programFilesX86 && join(
      programFilesX86,
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    programFiles && join(
      programFiles,
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    localAppData && join(
      localAppData,
      'Microsoft',
      'Edge',
      'Application',
      'msedge.exe',
    ),
    programFiles && join(
      programFiles,
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
    programFilesX86 && join(
      programFilesX86,
      'Google',
      'Chrome',
      'Application',
      'chrome.exe',
    ),
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];

  return findExecutable(candidates);
}

export function getExecutableVersion(executablePath)
{
  if (process.platform === 'win32')
  {
    const escapedPath = executablePath.replaceAll("'", "''");
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-Item -LiteralPath '${escapedPath}').VersionInfo.ProductVersion`,
      ],
      {
        encoding: 'utf8',
      },
    );

    return result.stdout.trim() || 'unknown';
  }

  const result = spawnSync(executablePath, ['--version'],
    {
      encoding: 'utf8',
    });

  return result.stdout.trim() || result.stderr.trim() || 'unknown';
}

export async function getAvailablePort()
{
  const probe = createNetServer();

  await new Promise((resolvePromise, rejectPromise) =>
  {
    probe.once('error', rejectPromise);
    probe.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = probe.address();

  await new Promise((resolvePromise, rejectPromise) =>
  {
    probe.close((error) =>
    {
      if (error)
      {
        rejectPromise(error);
        return;
      }

      resolvePromise();
    });
  });
  return address.port;
}

export async function startViteServer(rootDir)
{
  const port = await getAvailablePort();
  const server = await createViteServer(
    {
      appType: 'spa',
      clearScreen: false,
      logLevel: 'error',
      root: rootDir,
      server:
      {
        host: '127.0.0.1',
        port,
        strictPort: true,
      },
    },
  );
  await server.listen();
  const address = server.httpServer.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    server,
  };
}

export function launchChromium(executablePath)
{
  return chromium.launch(
    {
      args:
      [
        '--disable-background-networking',
        '--disable-extensions',
        '--force-color-profile=srgb',
        '--ignore-gpu-blocklist',
        '--use-angle=swiftshader',
      ],
      executablePath,
      headless: true,
    },
  );
}

export async function closeBrowserRuntime({ browser, vite })
{
  await browser?.close().catch(() => {});
  await vite?.close().catch(() => {});
}

export async function writeFailureArtifacts({
  artifactDir,
  currentLabel,
  currentPage,
  metrics,
  error,
})
{
  mkdirSync(artifactDir, { recursive: true });
  const safeLabel = currentLabel.replaceAll(/[^a-zA-Z0-9_.-]+/g, '-');

  if (currentPage)
  {
    try
    {
      await currentPage.screenshot(
        {
          animations: 'disabled',
          fullPage: true,
          path: join(artifactDir, `${safeLabel}.png`),
        },
      );
    }
    catch (screenshotError)
    {
      metrics.screenshotError = screenshotError.message;
    }
  }

  writeFileSync(
    join(artifactDir, 'failure.json'),
    `${JSON.stringify(
      {
        label: currentLabel,
        error:
        {
          message: error.message,
          stack: error.stack,
          detail: error.detail ?? null,
        },
        metrics,
      },
      null,
      2,
    )}\n`,
  );
}
