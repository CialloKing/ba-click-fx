import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { brotliCompressSync, constants, inflateRawSync, zstdCompressSync } from 'node:zlib';
import { deflateAsync } from '@gfx/zopfli';
import { parseAst } from 'rolldown/parseAst';
import { createBuildResources, markResourceInitializersPure, replaceRanges } from './build-resources.mjs';
import { normalizeProfile } from './build-profile.mjs';

export const textureCodecs = ['original', 'deflate', 'zopfli', 'brotli', 'zstd'];
const packedNames = new Set(['PACKED_TRAIL_TEXTURE_RGB', 'PACKED_TRAIL_TEXTURE_COVERAGE',
  'RUNS_BASE64_CHUNKS', 'PACKED_RING3_ALPHA', 'RING_MESH_VERTICES', 'RING_MESH_INDICES']);

function literals(node, result = [])
{
  if (!node || typeof node !== 'object')
  {
    return result;
  }
  if (node.type === 'Literal' && typeof node.value === 'string')
  {
    result.push(node);
    return result;
  }
  for (const value of Object.values(node))
  {
    if (Array.isArray(value))
    {
      value.forEach(child => literals(child, result));
    }
    else if (value && typeof value === 'object')
    {
      literals(value, result);
    }
  }
  return result;
}

export function decoderSource(codec)
{
  if (codec === 'brotli')
  {
    return `import { decompress } from 'brotli/decompress';
export function inflateSync(bytes, options) { return decompress(bytes, options?.out?.length); }`;
  }
  if (codec === 'zstd')
  {
    return `import { decompress } from 'fzstd';
export function inflateSync(bytes, options) { return decompress(bytes, options?.out); }`;
  }
  return "export { inflateSync } from 'fflate/browser';";
}

export async function codecResources(root, width, codec)
{
  assert(textureCodecs.includes(codec), 'Unknown texture codec');
  assert([128, 512].includes(width), 'Unknown texture dimensions');
  const sources = codec === 'original' ? new Map() : await createBuildResources(root,
    normalizeProfile({ backend: 'webgl2', runtime: 'dom', resources: { trailSize: width, encoding: 'deflate' } }));
  const packets = [];
  let compressionMs = 0;
  for (const [filename, source] of sources)
  {
    const edits = [];
    const declarations = parseAst(source).body.flatMap(statement => (statement.declaration ?? statement).declarations ?? []);
    for (const declaration of declarations.filter(item => packedNames.has(item.id.name)))
    {
      const strings = literals(declaration.init);
      // 复用正式构建的 Paeth、RLE 和几何字节，实验只替换最外层编码。
      assert.equal(strings.length, 1, 'Packed resource layout changed: ' + declaration.id.name);
      const literal = strings[0];
      const current = Buffer.from(literal.value, 'base64');
      const bytes = inflateRawSync(current);
      const start = performance.now();
      const packed = codec === 'zopfli' ? Buffer.from(await deflateAsync(bytes, { numiterations: 15 }))
        : codec === 'brotli' ? brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
        : codec === 'zstd' ? zstdCompressSync(bytes, { params: { [constants.ZSTD_c_compressionLevel]: 22 } }) : current;
      compressionMs += performance.now() - start;
      const encoded = packed.toString('base64');
      edits.push([literal.start, literal.end, JSON.stringify(encoded)]);
      packets.push({ name: declaration.id.name, encoded, inputBytes: bytes.length, packedBytes: packed.length,
        sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const code = replaceRanges(source, edits);
    sources.set(filename, ['brotli', 'zstd'].includes(codec)
      ? code.replace("import { inflateSync } from 'fflate/browser';", "import { inflateSync } from 'virtual:texture-codec';") : code);
  }
  return { sources, packets, compressionMs };
}

export function codecPlugin(root, resources, codec, base = {})
{
  const load = base.load;
  const resolveId = base.resolveId;
  const prefix = root.replaceAll('\\', '/') + '/src/';
  return {
    ...base, name: 'texture-codec-experiment', enforce: 'pre',
    resolveId(id)
    {
      return id === 'virtual:texture-codec' ? '\0' + id : resolveId?.call(this, id);
    },
    load(id)
    {
      if (id === '\0virtual:texture-codec')
      {
        return decoderSource(codec);
      }
      const path = id.replaceAll('\\', '/');
      const filename = path.startsWith(prefix) ? path.slice(prefix.length) : null;
      const source = resources.sources.get(filename);
      return source && load ? markResourceInitializersPure(source, filename) : source ?? load?.call(this, id);
    },
  };
}
