const query = new URLSearchParams(location.search);
const scenes = {
  article: `<div class="brand">FIELD NOTES / 阅读与设计</div><span class="tag">交互设计</span><span class="tag">2026 · 秋</span>
<h1>在日常页面中，<br>观察光与运动</h1><p class="lead">正文、卡片和浅色留白构成一个普通阅读页面。点击文字、按住鼠标画线，观察光斑是否清晰以及拖尾是否连续。</p>
<div class="card"><h2>好的交互从细节开始</h2><p>光线经过明亮背景时，边缘、透明度和颜色会决定它是否自然。动画不仅出现在空白画布上，也会穿过文字、图标和卡片。</p><button>继续阅读</button></div>
<blockquote>把同一段动作放在相同背景上，才容易看清纹理带来的变化。</blockquote>
<div class="grid"><div class="card"><h2>01 / 点击</h2><p>短按后观察圆环展开、光斑填充以及后期消散。</p></div><div class="card"><h2>02 / 拖尾</h2><p>慢速与快速拖动，比较弯曲处、末端亮点和连贯程度。</p></div></div>`,
  dashboard: `<div class="brand">NORTHSTAR / OVERVIEW</div><h1>项目概览</h1><p class="lead">深色工作界面 · 数据卡片 · 图表 · 彩色标记</p>
<div class="grid"><div class="card"><div class="muted">本周访问</div><div class="metric">24,860</div><span class="tag">↑ 18.6%</span></div><div class="card"><div class="muted">活跃项目</div><div class="metric">36</div><span class="tag">运行正常</span></div></div>
<div class="card"><h2>活动趋势</h2><svg class="chart" viewBox="0 0 600 170" preserveAspectRatio="none" aria-label="活动趋势折线图"><path d="M0 40H600M0 85H600M0 130H600" stroke="#30415d"/><path d="M0 150L55 118L110 132L165 85L220 102L275 62L330 92L385 35L440 64L495 25L550 45L600 12" fill="none" stroke="#58c3f5" stroke-width="3"/><path d="M0 155L100 145L200 115L300 130L400 100L500 115L600 60" fill="none" stroke="#b88df0" stroke-width="3"/></svg></div>
<div class="card"><h2>最近活动</h2><p>● 界面资源更新 <span class="muted">刚刚</span></p><p>● 自动构建完成 <span class="muted">12 分钟前</span></p><p>● 新的设计评审 <span class="muted">今日</span></p></div>`,
  gallery: `<svg class="landscape" viewBox="0 0 900 1100" preserveAspectRatio="xMidYMid slice" aria-label="山地日落插画"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#30447d"/><stop offset=".5" stop-color="#e7a99b"/><stop offset="1" stop-color="#ffd998"/></linearGradient><linearGradient id="water" x2="0" y2="1"><stop stop-color="#609eaa"/><stop offset="1" stop-color="#142e56"/></linearGradient></defs><rect width="900" height="1100" fill="url(#sky)"/><circle cx="660" cy="330" r="125" fill="#ffe1b0"/><path d="M0 580L175 295L295 455L465 210L730 590L900 365V1100H0Z" fill="#687b9c"/><path d="M0 700L240 455L410 670L615 380L900 685V1100H0Z" fill="#344f73"/><path d="M0 755Q450 660 900 755V1100H0Z" fill="url(#water)"/><path d="M0 855Q450 735 900 855M0 935Q450 810 900 935M0 1035Q450 900 900 1035" fill="none" stroke="#b3cddc" stroke-opacity=".3" stroke-width="4"/></svg>
<div class="intro"><div class="brand" style="color:#fff">TRAVEL JOURNAL / 山与湖</div><h1>把片刻<br>留在路上</h1><p class="lead">复杂彩色背景上的透明光效。穿过明亮天空、深色山体与文字区域，比较光晕和细节。</p><span class="tag">山地</span><span class="tag">日落</span></div>
<div class="card"><h2>沿湖慢行</h2><p>傍晚的颜色从暖橙变成深蓝，水面保留着最后一束光。尝试沿山体轮廓拖动，再在明亮区域短按。</p></div>
<div class="grid"><div class="card"><h2>45 km</h2><p>环湖路线</p></div><div class="card"><h2>1,280 m</h2><p>观景点海拔</p></div></div>`,
};
const scene = Object.hasOwn(scenes, query.get('scene')) ? query.get('scene') : 'article';
const backend = ['webgl2', 'webgpu', 'native'].includes(query.get('backend')) ? query.get('backend') : 'webgl2';
const strategy = ['baseline', 'lossless-deflate', 'trail-128', 'procedural'].includes(query.get('strategy')) ? query.get('strategy') : 'baseline';
const labels = { baseline: '当前定制版', 'lossless-deflate': '无损压缩', 'trail-128': '128² 拖尾', procedural: '程序化纹理' };
document.body.className = scene;
document.querySelector('#content').innerHTML = scenes[scene];
document.title = `${labels[strategy]} · ${backend} · ${scene}`;
let randomState = 73;
// 每个隔离页面有相同种子；保留正常时钟与 RAF，便于人工观察实际动画。
Math.random = () => ((randomState = (randomState * 1664525 + 1013904223) >>> 0) / 4294967296);
let fx;
let ready = false;
let inputs = 0;
let mirroredScroll = false;
const status = document.querySelector('#status');
function report(text)
{
  status.textContent = `${labels[strategy]} · ${backend} · ${text}`;
  if (parent !== window)
  {
    parent.postMessage({ sizeLive: true, type: 'status', ready, text }, location.origin);
  }
}

function pointer(data)
{
  const x = data.x * innerWidth;
  const y = data.y * innerHeight;
  const target = document.elementFromPoint(x, y) ?? document.body;
  target.dispatchEvent(new PointerEvent(data.event, { bubbles: true, pointerId: data.pointerId ?? 77,
    pointerType: 'mouse', isPrimary: true, button: 0, buttons: data.buttons ?? 0, clientX: x, clientY: y }));
}

window.addEventListener('message', event =>
{
  if (event.origin !== location.origin || event.source !== parent || !event.data?.sizeLive || !fx)
  {
    return;
  }
  const data = event.data;
  if (data.type === 'pointer' && ready)
  {
    pointer(data);
  }
  if (data.type === 'pause')
  {
    fx.setPaused(data.paused);
  }
  if (data.type === 'reset')
  {
    fx.clearTrail();
    fx.clear();
    randomState = 73;
  }
  if (data.type === 'scroll')
  {
    const y = data.progress * Math.max(0, document.documentElement.scrollHeight - innerHeight);
    if (Math.abs(scrollY - y) > 0.5)
    {
      mirroredScroll = true;
      window.scrollTo(0, y);
    }
  }
});

window.addEventListener('scroll', () =>
{
  if (mirroredScroll)
  {
    mirroredScroll = false;
    return;
  }
  if (parent !== window && query.get('paired') === '1')
  {
    const height = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    parent.postMessage({ sizeLive: true, type: 'scroll', progress: scrollY / height }, location.origin);
  }
}, { passive: true });

for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'])
{
  window.addEventListener(type, event =>
  {
    if (!ready)
    {
      return;
    }
    inputs++;
    report(`就绪 · 输入 ${inputs}`);
    // 仅转发真实宿主输入，避免同步后的 DOM 事件在两个页面之间循环。
    if (event.isTrusted && parent !== window && query.get('paired') === '1')
    {
      parent.postMessage({ sizeLive: true, type: 'pointer', event: type, x: event.clientX / innerWidth,
        y: event.clientY / innerHeight, pointerId: event.pointerId, buttons: event.buttons }, location.origin);
    }
  }, { capture: true, passive: true });
}

try
{
  const { default: BAClickFX } = await import(`/test-results/size-experiments/${backend}-dom/${strategy}/ba-click-fx.js`);
  fx = new BAClickFX({ onError: error => { ready = false; report(`失败：${error.code}`); } });
  const deadline = performance.now() + 15000;
  while (fx.getConfig().resolvedEffectBackend === 'pending')
  {
    if (performance.now() > deadline)
    {
      throw new Error('设备准备超时');
    }
    await new Promise(done => setTimeout(done, 50));
  }
  if (fx.getConfig().resolvedEffectBackend === 'unavailable' || fx.buildFailed)
  {
    throw new Error('后端不可用');
  }
  ready = true;
  report('就绪');
}
catch (error)
{
  ready = false;
  report(`失败：${error.message}`);
}
window.addEventListener('pagehide', () => fx?.destroy(), { once: true });
