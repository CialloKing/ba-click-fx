const names = { article: '浅色文章', dashboard: '深色仪表盘', gallery: '彩色插画' };
const query = new URLSearchParams(location.search);
const scene = Object.hasOwn(names, query.get('scene')) ? query.get('scene') : 'article';
const backend = document.querySelector('#backend');
const strategy = document.querySelector('#strategy');
const frames = [document.querySelector('#left'), document.querySelector('#right')];
const statuses = [document.querySelector('#left-status'), document.querySelector('#right-status')];
let replay = false;
let paused = false;
let generation = 0;
const ready = [false, false];
document.title = `${names[scene]} · 当前版 / 程序化版`;
document.querySelector(`nav a[href="?scene=${scene}"]`).setAttribute('aria-current', 'page');

function send(command)
{
  for (const frame of frames)
  {
    frame.contentWindow.postMessage({ sizeLive: true, ...command }, location.origin);
  }
}

function load()
{
  generation++;
  replay = false;
  paused = false;
  ready.fill(false);
  document.querySelector('#replay').textContent = '循环演示';
  document.querySelector('#pause').textContent = '暂停';
  document.querySelector('#replay').setAttribute('aria-pressed', 'false');
  document.querySelector('#right-title').textContent = strategy.selectedOptions[0].textContent;
  document.title = `${names[scene]} · 当前版 / ${strategy.selectedOptions[0].textContent}`;
  for (const [index, mode] of ['baseline', strategy.value].entries())
  {
    const path = `host.html?scene=${scene}&backend=${backend.value}&strategy=${mode}`;
    statuses[index].textContent = '加载中';
    frames[index].src = path + '&paired=1';
    document.querySelector(index ? '#right-open' : '#left-open').href = path;
  }
}

window.addEventListener('message', event =>
{
  const index = frames.findIndex(frame => frame.contentWindow === event.source);
  if (event.origin !== location.origin || index < 0 || !event.data?.sizeLive)
  {
    return;
  }
  const data = event.data;
  if (data.type === 'status')
  {
    ready[index] = data.ready;
    statuses[index].textContent = data.text;
  }
  if (data.type === 'pointer' && !replay && !paused && ready.every(Boolean))
  {
    frames[1 - index].contentWindow.postMessage(data, location.origin);
  }
  if (data.type === 'scroll')
  {
    frames[1 - index].contentWindow.postMessage(data, location.origin);
  }
});

async function animate(token)
{
  while (replay && token === generation)
  {
    send({ type: 'reset' });
    const start = performance.now();
    send({ type: 'pointer', event: 'pointerdown', x: 0.2, y: 0.38, buttons: 1, pointerId: 77 });
    await new Promise(done =>
    {
      function frame(now)
      {
        if (!replay || token !== generation)
        {
          done();
          return;
        }
        const progress = Math.min(1, (now - start) / 1400);
        send({ type: 'pointer', event: 'pointermove', x: 0.2 + progress * 0.6,
          y: 0.38 + Math.sin(progress * Math.PI * 2) * 0.16, buttons: 1, pointerId: 77 });
        if (progress < 1)
        {
          requestAnimationFrame(frame);
        }
        else
        {
          send({ type: 'pointer', event: 'pointerup', x: 0.8, y: 0.38, buttons: 0, pointerId: 77 });
          done();
        }
      }
      requestAnimationFrame(frame);
    });
    await new Promise(done => setTimeout(done, 1100));
  }
}

document.querySelector('#replay').onclick = event =>
{
  if (!ready.every(Boolean))
  {
    return;
  }
  replay = !replay;
  generation++;
  paused = false;
  send({ type: 'pause', paused: false });
  document.querySelector('#pause').textContent = '暂停';
  event.currentTarget.textContent = replay ? '停止演示' : '循环演示';
  event.currentTarget.setAttribute('aria-pressed', String(replay));
  if (replay)
  {
    animate(generation);
  }
  else
  {
    send({ type: 'reset' });
  }
};
document.querySelector('#pause').onclick = event =>
{
  if (replay)
  {
    // 暂停保留当前画面，不走停止演示的清空路径。
    replay = false;
    generation++;
    document.querySelector('#replay').textContent = '循环演示';
    document.querySelector('#replay').setAttribute('aria-pressed', 'false');
  }
  paused = !paused;
  send({ type: 'pause', paused });
  event.currentTarget.textContent = paused ? '继续动画' : '暂停';
};
document.querySelector('#clear').onclick = () =>
{
  replay = false;
  generation++;
  document.querySelector('#replay').textContent = '循环演示';
  document.querySelector('#replay').setAttribute('aria-pressed', 'false');
  send({ type: 'reset' });
};
backend.onchange = strategy.onchange = load;
load();
