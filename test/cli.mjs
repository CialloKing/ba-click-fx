import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 同一专项既可独立运行，也可由发布编排直接调用；导入不消费宿主 argv。
export function isMain(meta)
{
  return !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === meta.url;
}
