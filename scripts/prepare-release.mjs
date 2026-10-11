import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { zipSync, unzipSync } from 'fflate/node';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist-release');
const assets = join(output, 'assets');
const fullFiles = ['ba-click-fx.js', 'ba-click-fx.d.ts', 'config.js', 'config.d.ts', 'worker.js', 'worker.d.ts'];
const slimStem = 'ba-click-fx.slim-webgl2-128';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sizes = bytes => ({ raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length });
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
if (process.env.GITHUB_REF_TYPE === 'tag')
{
  assert.equal(process.env.GITHUB_REF_NAME, 'v' + version, 'Tag and package version differ');
  assert(!dirty, 'Tagged release source must be clean');
}

// 每次从当前源码重新构建；发布打包不复用磁盘上的旧实验或定制产物。
for (const args of [[], ['--profile', 'examples/build-profiles/slim-webgl2-128.json']])
{
  execFileSync(process.execPath, [join(root, 'scripts/build.mjs'), ...args], { cwd: root, stdio: 'inherit' });
}
// 只清理这个脚本专用的输出目录，并拒绝将符号链接作为递归清理目标。
assert.equal(dirname(output), root);
if (existsSync(output))
{
  assert(!lstatSync(output).isSymbolicLink(), 'Release directory must not be a symlink');
  rmSync(output, { recursive: true });
}
mkdirSync(assets, { recursive: true });

function writeEdition(name, files, info, noticePath)
{
  const directory = join(output, name);
  mkdirSync(directory, { recursive: true });
  for (const [filename, source] of files)
  {
    copyFileSync(source, join(directory, filename));
    copyFileSync(source, join(assets, filename));
  }
  copyFileSync(join(root, 'LICENSE'), join(directory, 'LICENSE'));
  copyFileSync(noticePath, join(directory, 'THIRD_PARTY_NOTICES.md'));
  const manifest = { version, commit, dirty, edition: name, ...info,
    files: files.map(([filename, source]) => ({ name: filename, sha256: hash(readFileSync(source)) })) };
  writeFileSync(join(directory, 'build-info.json'), JSON.stringify(manifest, null, 2) + '\n');
  const slim = name === 'slim';
  const script = slim ? slimStem + '.js' : 'ba-click-fx.js';
  for (const english of [false, true])
  {
    const introduction = english
      ? slim ? 'Fixed-profile DOM build: WebGL2, 128x128 trail, click/shards/Bloom/reference enabled. Theme, scale, DPR cap and effect parameters are fixed by the included build profile. It has no alternate backend fallback or dynamic tuning API.'
        : 'Full ESM distribution, including main, configuration and Worker entries.'
      : slim ? '固定配置的 DOM 精简版：仅 WebGL2，128² 拖尾，保留点击、碎片、Bloom 和合成参考。主题、scale、DPR 上限及特效参数由附带的构建配置固定；设备失败通过 onError 通知，不切换其他后端。'
        : '完整版 ESM，包含主入口、配置及 Worker 入口。';
    const detail = english
      ? slim ? 'Constructor options: target, onError, inputFilter. Use resize, setPaused, clear, clearTrail, boom, getConfig, getFxConfig, getEffectiveHostCompositing, setCompositingReference and destroy. Changing fixed settings requires rebuilding from source.'
        : 'Serve these files over HTTP(S); retain the matching TypeScript declarations in the same directory. Worker usage requires transferring an OffscreenCanvas from the host.'
      : slim ? '构造参数为 target、onError、inputFilter。保留 resize、setPaused、clear、clearTrail、boom、getConfig、getFxConfig、getEffectiveHostCompositing、setCompositingReference、destroy。修改固定参数需从源码重新构建。'
        : '通过 HTTP(S) 部署，并将对应类型声明保持在同一目录。Worker 接入需由宿主转移 OffscreenCanvas。';
    writeFileSync(join(directory, english ? 'README.en.md' : 'README.md'), `# ba-click-fx v${version}\n\n${introduction}\n\n${detail}\n\n\`\`\`js\nimport BAClickFX from './${script}';\nconst fx = new BAClickFX({ target: '#fx-host', onError: error => console.error(error) });\n// fx.destroy();\n\`\`\`\n\n[Source and documentation](https://github.com/CialloKing/ba-click-fx/tree/v${version})\n\nKeep LICENSE and THIRD_PARTY_NOTICES.md when deploying.\n`);
  }
  if (slim)
  {
    copyFileSync(join(root, 'examples/build-profiles/slim-webgl2-128.json'), join(directory, 'profile.json'));
  }
  const entries = Object.fromEntries(readdirSync(directory).sort().map(filename =>
    [filename, [readFileSync(join(directory, filename)), { mtime: new Date(1980, 0, 1) }]]));
  const archive = zipSync(entries, { level: 9 });
  const decoded = unzipSync(archive);
  assert.deepEqual(Object.keys(decoded).sort(), Object.keys(entries));
  for (const [filename, [bytes]] of Object.entries(entries))
  {
    assert.deepEqual(Buffer.from(decoded[filename]), bytes, 'ZIP contents: ' + filename);
  }
  const archiveName = `ba-click-fx-v${version}-${slim ? 'slim-webgl2-128' : 'full'}.zip`;
  writeFileSync(join(assets, archiveName), archive);
  return manifest;
}

const slimInfo = JSON.parse(readFileSync(join(root, 'dist-custom/build-info.json'), 'utf8'));
assert.equal(slimInfo.version, version);
assert.equal(slimInfo.backend, 'webgl2');
assert.equal(slimInfo.runtime, 'dom');
assert.deepEqual(slimInfo.resources, { trailSize: 128, encoding: 'deflate' });
assert(Object.values(slimInfo.features).every(Boolean));
assert.equal(slimInfo.sizes.raw, readFileSync(join(root, 'dist-custom/ba-click-fx.js')).length);
assert(readFileSync(join(root, 'dist-custom/THIRD_PARTY_NOTICES.md'), 'utf8').includes('## fflate'));
const full = writeEdition('full', fullFiles.map(filename => [filename, join(root, 'dist', filename)]),
  { sizes: sizes(readFileSync(join(root, 'dist/ba-click-fx.js'))) }, join(root, 'THIRD_PARTY_NOTICES.md'));
const slim = writeEdition('slim', [
  [slimStem + '.js', join(root, 'dist-custom/ba-click-fx.js')],
  [slimStem + '.d.ts', join(root, 'dist-custom/ba-click-fx.d.ts')],
], slimInfo, join(root, 'dist-custom/THIRD_PARTY_NOTICES.md'));
const assetFiles = readdirSync(assets).sort();
assert.equal(assetFiles.length, 10);
const sums = assetFiles.map(filename => `${hash(readFileSync(join(assets, filename)))}  ${filename}`);
writeFileSync(join(assets, 'SHA256SUMS'), sums.join('\n') + '\n');
for (const line of readFileSync(join(assets, 'SHA256SUMS'), 'utf8').trim().split('\n'))
{
  const [expected, filename] = line.split('  ');
  assert.equal(hash(readFileSync(join(assets, filename))), expected);
}
writeFileSync(join(output, 'build-info.json'), JSON.stringify({ version, commit, dirty, full, slim, assets: assetFiles }, null, 2) + '\n');
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(/^## /m)[1].trim();
assert(changelog.startsWith('v' + version + ' '), 'Changelog version differs');
writeFileSync(join(output, 'notes.md'), `## ${changelog}\n\n| 产物 | 主 JS raw | gzip | Brotli |\n|---|---:|---:|---:|\n${[full, slim].map(edition => `| ${edition.edition === 'full' ? '完整版' : '固定配置 WebGL2 / 128² DOM 精简版'} | ${(edition.sizes.raw / 1024).toFixed(1)} KiB | ${(edition.sizes.gzip / 1024).toFixed(1)} KiB | ${(edition.sizes.brotli / 1024).toFixed(1)} KiB |`).join('\n')}\n\n精简版仅接受宿主与回调选项；固定参数见 ZIP 中的 profile.json 和 build-info.json。保留点击、拖尾、碎片、Bloom、合成参考及生命周期接口。无动态调参和其他后端回退。\n\nZIP 附带类型、使用说明、构建信息及许可证。SHA256SUMS 覆盖全部 10 个文件附件；Source code 为 GitHub 自动生成的源码归档。\n`);
console.log(`发布附件已准备: v${version}, ${join(assets, 'SHA256SUMS')}`);
