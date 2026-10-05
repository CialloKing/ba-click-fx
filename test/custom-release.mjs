// 在同一进程内共享已构建的固定配置，保留两套检查各自的覆盖范围。
await import('./build-profile.js');
await import('./custom-build.js');
await import('./browser/custom-runtime.mjs');
