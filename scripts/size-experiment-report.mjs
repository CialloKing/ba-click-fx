import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeExperimentReport(output, report)
{
  const kib = value => (value / 1024).toFixed(1);
  if (!report.browser?.complete)
  {
    const message = '本轮只有构建结果，浏览器验收尚未完成。旧的画面报告不能作为本轮验收证据。';
    const table = report.results.map(build => `| ${build.name} | ${build.strategy} | ${kib(build.totals.gzip)} |`).join('\n');
    writeFileSync(join(output, 'report.md'), '# 体积实验构建结果\n\n' + message +
      '\n\n| 配置 | 方案 | 总 gzip KiB |\n|---|---|---:|\n' + table + '\n');
    writeFileSync(join(output, 'report.html'), '<!doctype html><meta charset="utf-8"><h1>体积实验构建结果</h1><p>' + message + '</p><p>请查看 results.json 或 report.md。</p>');
    return;
  }
  const rows = report.results.map(build =>
  {
    const measurement = report.browser.results.find(item => item.name === build.name && item.strategy === build.strategy);
    return { name: build.name, strategy: build.strategy, exact: build.exact, asynchronous: build.asynchronous,
      scriptGzip: kib(build.files[0].gzip), raw: kib(build.totals.raw), gzip: kib(build.totals.gzip), brotli: kib(build.totals.brotli),
      importMs: measurement.importMs.median.toFixed(2), initMs: measurement.initMs.median.toFixed(2),
      cpuP95: measurement.cpuFrameMs.p95.toFixed(3), samples: measurement.samples };
  });
  const table = rows.map(row => `| ${row.name} | ${row.strategy} | ${row.scriptGzip} | ${row.gzip} | ${row.importMs} | ${row.initMs} | ${row.samples[0].mae.toFixed(4)} |`).join('\n');
  writeFileSync(join(output, 'report.md'), `# 定制构建体积方案对照\n\n版本 ${report.version}；基准提交 ${report.commit}；浏览器 ${report.browser.browser}。\n\n` +
    `覆盖 ${rows.length} 个构建。大小单位 KiB，时间单位 ms。JS 与外置资源分别压缩后求和；不含声明、许可证、HTTP 请求头。\n\n` +
    '| 配置 | 方案 | 入口 JS gzip | 总 gzip | 冷导入中位数 | 初始化中位数 | 初始画面 RGBA MAE |\n|---|---|---:|---:|---:|---:|---:|\n' + table +
    '\n\n冷导入和初始化各三次独立浏览器上下文；CPU p50/p95 各 90 帧。局域回环网络和无头浏览器不代表真实网站下载、物理显示 FPS 或 HDR 显示效果。\n\n' +
    'baseline/minified/lossless-deflate/external-deflate 要求像素逐字节一致；降采样和程序化只记录差异，不放宽无损验收阈值。空白像素会稀释全图 MAE，因此交互报告同时显示活跃区域误差和差异图。\n\n' +
    '外置方案使用额外资源请求和模块顶层 await，目标为 ES2022。程序化方案替换 Trail、Circle、Ring3 三种纹理，继续复用当前渲染管线和三角纹理，并非完整轻量渲染器。\n\n' +
    'Native/Software 的精确图像对照固定 willReadFrequently=true，以稳定 Canvas2D 读回；加载与 CPU 帧性能仍用默认上下文单独测量。\n\n' +
    '[打开交互画面对照](./report.html)\n');
  const data = JSON.stringify(rows).replaceAll('<', '\\u003c');
  const names = [...new Set(rows.map(row => row.name))];
  const strategies = [...new Set(rows.map(row => row.strategy))];
  const options = values => values.map(value => `<option>${value}</option>`).join('');
  writeFileSync(join(output, 'report.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>定制构建体积实验</title>
<style>
body{font:15px/1.6 system-ui,sans-serif;max-width:1280px;margin:32px auto;padding:0 24px;color:#192a3c;background:#f3f6fa}
h1{margin-bottom:8px}p{color:#465a71}select,button{font:inherit;padding:6px 12px;border:1px solid #b9c8da;border-radius:6px;background:white;margin-right:8px}
table{width:100%;border-collapse:collapse;background:white;margin:20px 0}td,th{padding:9px;text-align:right;border-bottom:1px solid #e1e8f0}td:first-child,th:first-child{text-align:left}
.images{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.images figure{margin:0;background:white;border-radius:8px;overflow:hidden}.images img{width:100%;background:#14283d;display:block;image-rendering:auto}.images.light img{background:white}.images.checker img{background-color:#eee;background-image:conic-gradient(#ddd 25%,transparent 0 50%,#ddd 0 75%,transparent 0);background-size:20px 20px}
figcaption{padding:10px}#metrics{background:white;padding:12px;border-radius:8px}small{color:#5d7188}
</style><h1>定制构建体积实验</h1><p>版本 ${report.version} · ${report.browser.browser} · 离屏渲染读回图像</p>
<label>配置 <select id="profile">${options(names)}</select></label><label>方案 <select id="strategy">${options(strategies)}</select></label>
<label>画面 <select id="sample"></select></label><button id="backdrop">切换背景</button>
<table><thead><tr><th>方案</th><th>原始总 KiB</th><th>入口 gzip KiB</th><th>总 gzip KiB</th><th>总 Brotli KiB</th><th>导入 ms</th><th>初始化 ms</th><th>CPU p95 ms</th></tr></thead><tbody id="sizes"></tbody></table>
<div id="metrics"></div><div class="images" id="images"><figure><img id="baseline"><figcaption>当前定制版</figcaption></figure><figure><img id="candidate"><figcaption>实验方案</figcaption></figure><figure><img id="difference"><figcaption>差异 ×4；Alpha 差异显示为蓝色</figcaption></figure></div>
<p><small>无损方案执行逐字节验收。Native/Software 像素对照启用 willReadFrequently，性能另用默认上下文测量。全图 MAE 包含空白像素，不能视为整体拟合百分比。冷导入/初始化各采样三次，CPU 采样 90 帧；回环网络及无头浏览器结果不能代替实际下载和显示性能。外置方案总大小已包括 trail.bin。</small></p>
<script>
const rows=${data}; const profile=document.querySelector('#profile'),strategy=document.querySelector('#strategy'),sample=document.querySelector('#sample');
strategy.value=rows.some(row=>row.strategy==='lossless-deflate')?'lossless-deflate':rows[0].strategy;
function update(reset){
 const selected=rows.filter(row=>row.name===profile.value),current=selected.find(row=>row.strategy===strategy.value)||selected[0];
 if(reset){sample.innerHTML=current.samples.map(item=>'<option>'+item.sample+'</option>').join('');if(current.samples.some(item=>item.sample==='active-trail'))sample.value='active-trail';}
 document.querySelector('#sizes').innerHTML=selected.map(row=>'<tr><td>'+row.strategy+'</td><td>'+row.raw+'</td><td>'+row.scriptGzip+'</td><td>'+row.gzip+'</td><td>'+row.brotli+'</td><td>'+row.importMs+'</td><td>'+row.initMs+'</td><td>'+row.cpuP95+'</td></tr>').join('');
 const metrics=current.samples.find(item=>item.sample===sample.value)||current.samples[0];
 document.querySelector('#metrics').textContent='全图 RGBA MAE '+metrics.mae.toFixed(4)+' · 活跃区域 MAE '+metrics.activeRgbaMae.toFixed(4)+' · 变化像素 '+metrics.changedPercent.toFixed(2)+'% · 最大通道误差 '+metrics.maximumChannelError+' · '+(current.exact?'要求逐字节一致':'允许画面变化，记录实际差异')+(current.asynchronous?' · 导入等待外置资源':'');
 const prefix=profile.value+'/';document.querySelector('#baseline').src=prefix+'baseline/'+metrics.sample+'.png';document.querySelector('#candidate').src=prefix+current.strategy+'/'+metrics.sample+'.png';document.querySelector('#difference').src=prefix+current.strategy+'/'+metrics.sample+'-diff.png';
}
profile.onchange=strategy.onchange=()=>update(true);sample.onchange=()=>update(false);let backdrop=0;document.querySelector('#backdrop').onclick=()=>{document.querySelector('#images').className='images '+['','light','checker'][++backdrop%3];};update(true);
</script></html>`);
}
