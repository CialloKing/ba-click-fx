import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { deflateAsync } from '@gfx/zopfli';

const cacheVariable = 'BA_CLICK_FX_RESOURCE_CACHE_DIR';
const prefix = 'ba-click-fx-resources-';
const version = JSON.parse(readFileSync(new URL('../node_modules/@gfx/zopfli/package.json', import.meta.url), 'utf8')).version;
const pending = new Map();

export function compressionInfo(encoding)
{
  return encoding === 'zopfli' ? { encoding, encoder: '@gfx/zopfli', version, numiterations: 15 }
    : encoding === 'deflate' ? { encoding, encoder: 'node:zlib', version: process.versions.zlib, level: 9 }
      : { encoding: 'original' };
}

export function compressionSession()
{
  const existing = process.env[cacheVariable];
  const directory = existing || mkdtempSync(join(tmpdir(), prefix));
  // 子进程只能共享本次会话的临时目录；清理时不接受任意递归删除目标。
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !resolve(directory).split(/[\\/]/).at(-1).startsWith(prefix))
  {
    throw new Error('Invalid resource compression cache directory');
  }
  process.env[cacheVariable] = directory;
  let closed = false;
  const close = () =>
  {
    if (!existing && !closed)
    {
      closed = true;
      process.removeListener('exit', close);
      rmSync(directory, { recursive: true, force: true });
      delete process.env[cacheVariable];
      pending.clear();
    }
  };
  if (!existing)
  {
    process.once('exit', close);
  }
  return { directory, close, owned: !existing };
}

export async function compressResource(input, encoding)
{
  if (!['deflate', 'zopfli'].includes(encoding))
  {
    throw new TypeError('Unknown resource compression: ' + encoding);
  }
  const bytes = Buffer.from(input);
  const settings = compressionInfo(encoding);
  const key = createHash('sha256').update(bytes).update(JSON.stringify(settings)).digest('hex');
  const directory = process.env[cacheVariable];
  const memoryKey = `${directory ?? ''}/${key}`;
  if (!pending.has(memoryKey))
  {
    const task = (async () =>
    {
      const path = directory && join(directory, key + '.deflate');
      let packed;
      if (path)
      {
        try
        {
          packed = readFileSync(path);
        }
        catch (error)
        {
          if (error.code !== 'ENOENT')
          {
            throw error;
          }
        }
      }
      if (!packed)
      {
        packed = encoding === 'zopfli'
          ? Buffer.from(await deflateAsync(bytes, { numiterations: settings.numiterations }))
          : deflateRawSync(bytes, { level: settings.level });
      }
      if (!inflateRawSync(packed).equals(bytes))
      {
        throw new Error('Resource compression round-trip failed: ' + key);
      }
      if (path)
      {
        const temporary = path + '.' + process.pid;
        writeFileSync(temporary, packed);
        renameSync(temporary, path);
      }
      return packed;
    })();
    pending.set(memoryKey, task);
  }
  return pending.get(memoryKey);
}
