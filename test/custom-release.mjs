import { compressionSession } from '../scripts/resource-compression.mjs';
const session = compressionSession();
try
{
  // 在同一进程内共享已构建的固定配置，保留两套检查各自的覆盖范围。
  await import('./build-profile.js');
  await import('./build-resources.mjs');
  await import('./custom-build.js');
  await import('./browser/custom-runtime.mjs');
  await import('./browser/slim-runtime.mjs');
  await import('./browser/zopfli-release.mjs');
}
finally
{
  session.close();
}
