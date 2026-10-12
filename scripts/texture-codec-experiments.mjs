import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { compressionSession } from './resource-compression.mjs';
import { normalizeProfile } from './build-profile.mjs';
import { customVite } from './custom-vite.mjs';
import { resizeTexture } from './build-resources.mjs';
import { scriptSizes } from './size-experiments.mjs';
import { codecPlugin, codecResources, textureCodecs } from './texture-codecs.mjs';
import { TRAIL_TEXTURE_RGB, TRAIL_TEXTURE_COVERAGE } from '../src/trail-texture.js';
import { CIRCLE_TEXTURE_RGBA } from '../src/circle-texture.js';
import { RING3_ALPHA } from '../src/ring3-alpha.js';
import { RING_MESH_VERTICES, RING_MESH_INDICES } from '../src/ring-mesh.js';
import { TRIANGLE_TEXTURE_RGBA, TRIANGLE_TEXTURE_COVERAGE } from '../src/triangle-texture.js';

const root = resolve(import.meta.dirname, '..');
const output = join(root, 'test-results/codec-experiments');
const slimProfile = normalizeProfile(JSON.parse(readFileSync(join(root, 'examples/build-profiles/slim-webgl2-128.json'), 'utf8')));

async function bundle(entry, directory, plugin, filename)
{
  await build({ configFile: false, root, logLevel: 'silent', plugins: [plugin],
    build: { target: 'es2020', outDir: directory, emptyOutDir: false, copyPublicDir: false,
      lib: { entry, formats: ['es'], fileName: () => filename },
      rollupOptions: { output: { exports: 'named', codeSplitting: false } } } });
}

async function buildCodec(edition, codec)
{
  const width = edition === 'slim' ? 128 : 512;
  const directory = join(output, edition, codec);
  mkdirSync(directory, { recursive: true });
  const resources = await codecResources(root, width, codec);
  const sourceRoot = relative(directory, join(root, 'src')).replaceAll('\\', '/');
  const entry = join(directory, '.entry.js');
  writeFileSync(entry, `export { default, BAClickFX } from '${sourceRoot}/engine-core.js';\n`);
  const plugin = () => codecPlugin(root, resources, codec, edition === 'slim' ? customVite(root, { ...slimProfile, resources: { ...slimProfile.resources, encoding: 'original' } }) : {});
  await bundle(edition === 'slim' ? entry : join(root, 'src/fx.js'), directory, plugin(), 'ba-click-fx.js');
  const sizes = scriptSizes(readFileSync(join(directory, 'ba-click-fx.js'), 'utf8'));

  // 从相同资源替换规则另建校验模块，检查所有消费者使用的字节；不计入部署大小。
  const exports = ['trail-texture.js', 'circle-texture.js', 'ring3-alpha.js', 'ring-mesh.js', 'triangle-texture.js'];
  writeFileSync(entry, exports.map(name => `export * from '${sourceRoot}/${name}';`).join('\n') +
    `\nexport { inflateSync as decodePayload } from 'virtual:texture-codec';\nexport const packets = ${JSON.stringify(resources.packets)};\n`);
  await bundle(entry, directory, codecPlugin(root, resources, codec), 'resource-check.js');
  const actual = await import(pathToFileURL(join(directory, 'resource-check.js')).href);
  for (const [name, expected] of Object.entries({
    TRAIL_TEXTURE_RGB: resizeTexture(TRAIL_TEXTURE_RGB, 3, width),
    TRAIL_TEXTURE_COVERAGE: resizeTexture(TRAIL_TEXTURE_COVERAGE, 1, width),
    CIRCLE_TEXTURE_RGBA, RING3_ALPHA, TRIANGLE_TEXTURE_RGBA, TRIANGLE_TEXTURE_COVERAGE,
    RING_MESH_VERTICES, RING_MESH_INDICES,
  }))
  {
    assert.deepEqual(Buffer.from(actual[name].buffer, actual[name].byteOffset, actual[name].byteLength),
      Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength), `${edition}/${codec}/${name}: byte equality`);
  }
  for (const packet of resources.packets)
  {
    assert.equal(actual.decodePayload(Buffer.from(packet.encoded, 'base64')).length, packet.inputBytes);
  }
  const full = edition === 'full';
  const result = { name: edition, codec, strategy: codec === (full ? 'original' : 'deflate') ? 'baseline' : codec,
    full, directory, profile: full ? normalizeProfile({ backend: 'webgl2', runtime: 'dom' }) : slimProfile,
    exact: true, checkDomFaults: !full, sizes, width, byteChecks: 8,
    recompressionMs: resources.compressionMs,
    payloadBytes: resources.packets.length ? resources.packets.reduce((sum, packet) => sum + packet.packedBytes, 0) : null,
    packets: resources.packets.map(({ encoded, ...packet }) => packet) };
  writeFileSync(join(directory, 'build-info.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`${edition}/${codec}: raw=${sizes.raw}, gzip=${sizes.gzip}, br=${sizes.brotli}; eight resource byte checks passed`);
  return result;
}

export function writeReport(report)
{
  writeFileSync(join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  const kib = value => (value / 1024).toFixed(1);
  const lines = ['# 纹理无损压缩实验', '', `版本 ${report.version}；提交 ${report.commit}；Node ${report.node}；运行开始时工作区有改动：${report.dirty}。`, '',
    '| 产物 | 编码 | JS raw KiB | gzip KiB | Brotli KiB | 资源校验 |', '|---|---|---:|---:|---:|---:|',
    ...report.results.map(result => `| ${result.name} | ${result.codec} | ${kib(result.sizes.raw)} | ${kib(result.sizes.gzip)} | ${kib(result.sizes.brotli)} | ${result.byteChecks}/8 |`), '',
    '体积计入所需解码器；resource-check.js、报告和图片是校验工具，不计入部署体积。完整版保留 512²、全部后端和可变配置；精简版使用正式 128² 网页配置。', '',
    report.browser ? `浏览器 ${report.browser.browser}；完成：${report.browser.complete}；逐字节场景 ${report.browser.results.reduce((sum, result) => sum + result.samples.length, 0)} 个。` : '浏览器验收尚未运行。', ''];
  if (report.decoding)
  {
    lines.push('| 产物 | 编码 | 解码 median ms | 解码 p95 ms | 冷导入 median ms | 初始化 median ms |', '|---|---|---:|---:|---:|---:|');
    for (const build of report.results)
    {
      const result = report.decoding.results.find(item => item.name === build.name && item.codec === build.codec);
      const startup = report.browser.results.find(item => item.name === build.name && item.strategy === build.strategy);
      lines.push(`| ${build.name} | ${build.codec} | ${result?.medianMs.toFixed(3) ?? '-'} | ${result?.p95Ms.toFixed(3) ?? '-'} | ${startup.importMs.median.toFixed(1)} | ${startup.initMs.median.toFixed(1)} |`);
    }
    lines.push('', '同步解码计时包含六个数据块，不包含 Base64、Paeth 还原或 GPU 上传；冷导入包含网络、解析和完整资源初始化，各使用三个独立上下文。计时只描述当前机器与无头浏览器。', '',
      'DecompressionStream 支持探测：`' + JSON.stringify(report.decoding.nativeFormats) + '`。', '');
  }
  writeFileSync(join(output, 'report.md'), lines.join('\n'));
}

async function main()
{
  const args = process.argv.slice(2);
  assert(args.every(arg => ['--build-only', '--benchmark'].includes(arg) || arg.startsWith('--edition=') || arg.startsWith('--codec=')),
    'Usage: experiment:codecs [--build-only] [--benchmark] [--edition=full|slim] [--codec=original|deflate|zopfli|brotli|zstd]');
  const edition = args.find(arg => arg.startsWith('--edition='))?.slice(10);
  const codec = args.find(arg => arg.startsWith('--codec='))?.slice(8);
  assert(!edition || ['full', 'slim'].includes(edition), 'Unknown edition');
  assert(!codec || textureCodecs.includes(codec), 'Unknown codec');
  assert(edition !== 'slim' || codec !== 'original', 'The original encoding is only a full-edition baseline');
  const report = { version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    node: process.version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    dependencies: Object.fromEntries(['@gfx/zopfli', 'brotli', 'fzstd', 'fflate'].map(name =>
      [name, JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version])),
    complete: false, results: [] };
  mkdirSync(output, { recursive: true });
  // 新运行先覆盖旧状态；失败时不能让上一次成功的结果冒充本次验收。
  writeReport(report);
  for (const selected of ['full', 'slim'].filter(value => !edition || value === edition))
  {
    if (codec === 'original' && selected === 'slim')
    {
      continue;
    }
    const baseline = selected === 'full' ? 'original' : 'deflate';
    for (const mode of textureCodecs.filter(value => (selected === 'full' || value !== 'original') &&
      (!codec || value === codec || value === baseline)))
    {
      report.results.push(await buildCodec(selected, mode));
    }
  }
  assert(report.results.length, 'No matching experiments');
  writeReport(report);
  if (!args.includes('--build-only'))
  {
    const { compareExperiments } = await import('./size-experiment-browser.mjs');
    report.browser = await compareExperiments(root, output, report.results,
      { benchmark: false, startupTrials: args.includes('--benchmark') ? 3 : 0 });
    if (args.includes('--benchmark'))
    {
      const { benchmarkTextureCodecs } = await import('./texture-codec-benchmark.mjs');
      report.decoding = await benchmarkTextureCodecs(root, report.results);
    }
    writeReport(report);
  }
  report.complete = true;
  writeReport(report);
  console.log('Report: ' + join(output, 'report.md'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
{
  const session = compressionSession();
  try
  {
    await main();
  }
  finally
  {
    session.close();
  }
}
