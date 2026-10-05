import { copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { readProfile } from './build-profile.mjs';
import { customTypes } from './custom-types.mjs';

export function buildCustom(root, path, runVite)
{
  const profile = readProfile(path);
  const outDir = join(root, 'dist-custom');
  mkdirSync(outDir, { recursive: true });
  const entry = join(outDir, '.entry.js');
  writeFileSync(entry, `export { default, BAClickFX } from '../src/engine-core.js';\n`);
  try
  {
    runVite(['build', '--config', 'vite.lib.config.js'], {
      ...process.env, BA_CLICK_FX_PROFILE: JSON.stringify(profile),
    });
  }
  finally
  {
    rmSync(entry, { force: true });
  }
  const code = readFileSync(join(outDir, 'ba-click-fx.js'));
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  const modules = JSON.parse(readFileSync(join(outDir, 'modules.json'), 'utf8'));
  writeFileSync(join(outDir, 'ba-click-fx.d.ts'), customTypes(profile));
  writeFileSync(join(outDir, 'build-info.json'), JSON.stringify({
    version, ...profile, modules,
    sizes: { raw: code.length, gzip: gzipSync(code).length, brotli: brotliCompressSync(code).length },
  }, null, 2) + '\n');
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) copyFileSync(join(root, name), join(outDir, name));
  console.log(`定制构建完成: ${profile.backend} / ${profile.runtime}`);
}
