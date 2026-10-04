import { spawn, execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, mkdir, rm, stat, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

async function projectHash(directory)
{
  const hash = createHash('sha256');
  async function visit(path)
  {
    const entries = (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries)
    {
      const target = join(path, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) { hash.update(relative(directory, target)); hash.update(await readFile(target)); }
      else throw new Error(`参考工程包含不支持的链接：${target}`);
    }
  }
  for (const name of ['Assets', 'Packages', 'ProjectSettings']) await visit(join(directory, name));
  return hash.digest('hex');
}

const root = resolve(import.meta.dirname, '..');
const options = {};
for (let index = 2; index < process.argv.length; index++)
{
  const key = process.argv[index];
  if (key === '--capture-only') options.captureOnly = true;
  else if (['--project', '--editor', '--label', '--reuse'].includes(key)) options[key.slice(2)] = process.argv[++index];
  else throw new Error(`未知参数：${key}`);
}
if (!options.project) throw new Error('用法：npm run compare:unity -- --project <Unity工程路径>');
const project = resolve(options.project);
const editor = options.editor ?? 'C:/Program Files/Unity/Hub/Editor/2021.3.45f1/Editor/Unity.exe';
const label = options.label ?? 'stage11';
if (!/^[a-zA-Z0-9_-]+$/.test(label)) throw new Error('label 只能包含字母、数字、横线和下划线');
const output = resolve(options.reuse ?? join(root, 'test-results', `unity-comparison-${label}`));
const input = {
  schema: 1, width: 1950, height: 1097, dpr: 1, stepMs: 10, seed: 20260716,
  cases: [
    { name: 'click', trail: false, captures: [50, 100, 120, 130, 250, 450], points: [{ timeMs: 0, x: 975, y: 548.5 }] },
    { name: 'trail-fixed', trail: true, captures: [140, 410], points: [{ timeMs: 0, x: 759, y: 548.5 }, { timeMs: 0, x: 1191, y: 548.5 }] },
    ...['corner', 'reverse'].map(name => ({
      name: `trail-${name}`, trail: true, captures: [140, 410],
      points: Array.from({ length: 8 }, (_, index) => ({
        timeMs: index * 20,
        x: name === 'corner' ? 759 + Math.min(index, 4) * 54 : 759 + (index <= 4 ? index : 8 - index) * 108,
        y: name === 'corner' ? 440.5 + Math.max(index - 4, 0) * 72 : 548.5,
      })),
    })),
  ],
};
let isolated;
let originalHash;
let originalError;
try
{
  if (!options.reuse)
  {
    const version = await readFile(join(project, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8');
    if (!/^m_EditorVersion: 2021\.3\.45f1\s*$/m.test(version)) throw new Error('参考工程必须是 Unity 2021.3.45f1');
    await stat(editor);
    if (existsSync(output)) throw new Error(`输出目录已存在；使用 --reuse 重放或用 --label 指定新记录：${output}`);
    await mkdir(output, { recursive: true });
    originalHash = await projectHash(project);
    await writeFile(join(output, 'inputs.json'), `${JSON.stringify(input, null, 2)}\n`);
    isolated = await mkdtemp(join(tmpdir(), 'bafx-unity-compare-'));
    for (const directory of ['Assets', 'Packages', 'ProjectSettings'])
    {
      await cp(join(project, directory), join(isolated, directory), { recursive: true });
    }
    const capturePath = join(isolated, 'Assets', 'Editor', 'BaFxTouchPreviewCapture.cs');
    const source = await readFile(capturePath, 'utf8');
    if (!source.includes('public static class BaFxTouchPreviewCapture')) throw new Error('无法识别参考捕获类');
    await writeFile(capturePath, source.replace('public static class BaFxTouchPreviewCapture', 'public static partial class BaFxTouchPreviewCapture'));
    await cp(join(root, 'scripts', 'unity-compare-capture.cs'), join(isolated, 'Assets', 'Editor', 'BaCompareCapture.cs'));
    await cp(join(root, 'scripts', 'unity-compare-ticker.cs'), join(isolated, 'Assets', 'Scripts', 'BaCompareTicker.cs'));
    await writeFile(join(output, 'environment.json'), JSON.stringify({
      unityVersion: '2021.3.45f1', editor, project,
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      capturedAt: new Date().toISOString(),
      sourceProjectHash: originalHash,
    }, null, 2));
    console.log(`Unity 隔离捕获：${output}`);
    // 独立图形进程重置 Unity 的绝对时钟，避免重复轮的过期端点插值发生浮点漂移。
    for (const run of [0, 1]) await new Promise((accept, reject) =>
    {
      const child = spawn(editor, ['-force-d3d11', '-projectPath', isolated,
        '-executeMethod', 'BaFxTouchPreviewCapture.CompareStage11', '-logFile', join(output, 'unity.log'),
        '-baCompareOutput', output, '-baCompareRun', String(run)], { windowsHide: true, stdio: 'ignore' });
      let last = '';
      const progress = setInterval(async () =>
      {
        try
        {
          const current = await readFile(join(output, 'progress.txt'), 'utf8');
          if (current !== last) { console.log(relative(output, current)); last = current; }
        }
        catch { /* 首次导入还没有进度文件。 */ }
      }, 2000);
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 600_000);
      child.once('error', error => { clearTimeout(timeout); clearInterval(progress); reject(error); });
      child.once('exit', async code =>
      {
        clearTimeout(timeout); clearInterval(progress);
        await writeFile(join(output, `capture-process-run${run}.json`), JSON.stringify({ exitCode: code, timedOut }, null, 2)).catch(() => {});
        if (code === 0 && existsSync(join(output, `run${run}-complete.json`))) accept();
        else reject(new Error(`Unity 捕获失败，退出码 ${code}，详见 ${join(output, 'unity.log')}`));
      });
    });
    await writeFile(join(output, 'complete.json'), JSON.stringify({ runs: 2, completed: true }));
    await writeFile(join(output, 'capture-process.json'), JSON.stringify({ exitCode: 0, timedOut: false, independentRuns: 2 }));
  }
  if (!options.captureOnly)
  {
    const { compareUnityCapture } = await import('./unity-compare-browser.mjs');
    await compareUnityCapture({ root, output });
  }
}
catch (error)
{
  originalError = error;
  if (existsSync(output)) await writeFile(join(output, 'command-failure.json'), JSON.stringify({ message: error.message, stack: error.stack }, null, 2)).catch(() => {});
  throw error;
}
finally
{
  let integrityError;
  if (originalHash)
  {
    try
    {
      const afterHash = await projectHash(project);
      await writeFile(join(output, 'source-integrity.json'), JSON.stringify({ before: originalHash, after: afterHash, unchanged: afterHash === originalHash }, null, 2));
      if (afterHash !== originalHash) throw new Error('参考工程目录发生变化，见 source-integrity.json');
    }
    catch (error) { integrityError = error; }
  }
  if (isolated)
  {
    // 只删除本次 mkdtemp 创建且确实在系统临时目录内的隔离副本。
    const inside = relative(resolve(tmpdir()), resolve(isolated));
    if (!inside.startsWith('..') && !isAbsolute(inside) && inside.startsWith('bafx-unity-compare-'))
    {
      await rm(isolated, { recursive: true, force: true }).catch(error => console.warn(`隔离工程清理失败：${error.message}`));
    }
  }
  if (integrityError)
  {
    if (originalError) console.warn(`原始异常之外的完整性检查错误：${integrityError.message}`);
    else throw integrityError;
  }
}
