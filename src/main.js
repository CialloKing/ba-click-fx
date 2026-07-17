import './style.css';
import { BAClickFX } from './ba-spark.js';

// ── 创建特效引擎 ────────────────────────────────────────────────────────
const effect = new BAClickFX(
  {
    inputFilter(event)
    {
      // 游戏中 Pointer over UGUI 时不生成 FX_Touch；控制面板等价于 UGUI
      const panel = document.getElementById('panel');

      if (panel && panel.contains(event.target))
      {
        return false;
      }

      return true;
    },
  },
);

window.BAClickFXDemo = effect;

// ── 主题预设 ────────────────────────────────────────────────────────────
const THEMES = {
  '蔚蓝': 'radial-gradient(circle at 30% 20%, #1d3558 0%, #101827 45%, #080d16 100%)',
  '深紫': 'radial-gradient(circle at 30% 20%, #2d1b4e 0%, #1a1028 45%, #0d0616 100%)',
  '深绿': 'radial-gradient(circle at 30% 20%, #1a3d2a 0%, #0f1a14 45%, #080d0a 100%)',
  '暖金': 'radial-gradient(circle at 30% 20%, #3d2a1a 0%, #1f1910 45%, #14100a 100%)',
  '纯黑': '#000000',
  '纯白': '#ffffff',
};

function applyTheme(name)
{
  if (name === 'custom')
  {
    return;
  }

  const bg = THEMES[name];

  if (bg)
  {
    document.body.style.background = bg;
  }

  document.querySelectorAll('.theme-btn').forEach((btn) =>
  {
    btn.classList.toggle('active', btn.dataset.theme === name);
  });
}

// ── 控件绑定 ────────────────────────────────────────────────────────────
function bindRange(id, outId, onChange)
{
  const el = document.getElementById(id);
  const out = document.getElementById(outId);

  if (!el || !out)
  {
    return;
  }

  el.addEventListener('input', () =>
  {
    const value = parseFloat(el.value);

    out.textContent = value.toFixed(2);
    onChange(value);
    localStorage.setItem('bafx-' + id, el.value);
  });

  // 初始化输出值
  out.textContent = parseFloat(el.value).toFixed(2);
}

function bindToggle(id, onChange)
{
  const el = document.getElementById(id);

  if (!el)
  {
    return;
  }

  el.addEventListener('change', () =>
  {
    onChange(el.checked);
    localStorage.setItem('bafx-' + id, String(el.checked));
  });
}

// ── 基础控件 → updateConfig ─────────────────────────────────────────────
bindRange('ctrlScale', 'outScale', (v) => effect.updateConfig({ scale: v }));
bindRange('ctrlOpacity', 'outOpacity', (v) => effect.updateConfig({ opacity: v }));
bindRange('ctrlDpr', 'outDpr', (v) => effect.updateConfig({ maxDpr: Math.round(v) }));

bindToggle('ctrlClick', (checked) => effect.updateConfig({ clickEnabled: checked }));
bindToggle('ctrlTrail', (checked) => effect.updateConfig({ trailEnabled: checked }));

// ── 重置 ────────────────────────────────────────────────────────────────
document.getElementById('btnReset').addEventListener('click', () =>
{
  document.getElementById('ctrlScale').value = '1';
  document.getElementById('outScale').textContent = '1.00';
  document.getElementById('ctrlOpacity').value = '1';
  document.getElementById('outOpacity').textContent = '1.00';
  document.getElementById('ctrlDpr').value = '2';
  document.getElementById('outDpr').textContent = '2';
  document.getElementById('ctrlClick').checked = true;
  document.getElementById('ctrlTrail').checked = true;

  effect.updateConfig({ scale: 1, opacity: 1, clickEnabled: true, trailEnabled: true, maxDpr: 2 });
  applyTheme('蔚蓝');

  for (const key of Object.keys(localStorage))
  {
    if (key.startsWith('bafx-'))
    {
      localStorage.removeItem(key);
    }
  }
});

// ── 背景主题 ────────────────────────────────────────────────────────────
document.querySelectorAll('.theme-btn').forEach((btn) =>
{
  btn.addEventListener('click', () =>
  {
    const theme = btn.dataset.theme;

    if (theme === 'custom')
    {
      document.getElementById('customBgCtrl').style.display = '';
      document.getElementById('ctrlCustomBg').style.display = '';
      document.getElementById('btnApplyBg').style.display = '';
    }
    else
    {
      document.getElementById('customBgCtrl').style.display = 'none';
      document.getElementById('ctrlCustomBg').style.display = 'none';
      document.getElementById('btnApplyBg').style.display = 'none';
      applyTheme(theme);
      localStorage.setItem('bafx-theme', theme);
    }
  });
});

document.getElementById('btnApplyBg').addEventListener('click', () =>
{
  const value = document.getElementById('ctrlCustomBg').value.trim();

  if (value)
  {
    document.body.style.background = value;
    localStorage.setItem('bafx-custom-bg', value);
  }
});

// ── 面板开关 ────────────────────────────────────────────────────────────
const panel = document.getElementById('panel');
const panelOverlay = document.getElementById('panelOverlay');
const panelToggle = document.getElementById('panelToggle');
const panelClose = document.getElementById('panelClose');
const panelPin = document.getElementById('panelPin');
let panelPinned = false;

function openPanel()
{
  panel.classList.add('open');
  panelOverlay.classList.add('open');
  panelToggle.style.right = '296px';
}

function closePanel()
{
  if (panelPinned)
  {
    return;
  }

  panel.classList.remove('open');
  panelOverlay.classList.remove('open');
  panelToggle.style.right = '';
}

panelToggle.addEventListener('click', openPanel);
panelClose.addEventListener('click', closePanel);
panelOverlay.addEventListener('click', closePanel);

panelPin.addEventListener('click', () =>
{
  panelPinned = !panelPinned;
  panelPin.textContent = panelPinned ? '📌' : '📍';
});

// ── 介绍/提示 ────────────────────────────────────────────────────────────
document.getElementById('introDismiss').addEventListener('click', () =>
{
  document.getElementById('introSection').style.display = 'none';
  localStorage.setItem('bafx-intro-dismissed', '1');
});

document.getElementById('hintDismiss').addEventListener('click', () =>
{
  document.getElementById('hintBar').style.display = 'none';
  localStorage.setItem('bafx-hint-dismissed', '1');
});

if (localStorage.getItem('bafx-intro-dismissed'))
{
  document.getElementById('introSection').style.display = 'none';
}

if (localStorage.getItem('bafx-hint-dismissed'))
{
  document.getElementById('hintBar').style.display = 'none';
}

// ── 空格触发 ────────────────────────────────────────────────────────────
window.addEventListener('keydown', (event) =>
{
  if (event.code !== 'Space' || event.repeat)
  {
    return;
  }

  event.preventDefault();
  effect.boom(effect.width / 2, effect.height / 2);
});

// ── 语言切换 ────────────────────────────────────────────────────────────
let currentLang = localStorage.getItem('bafx-lang') || 'zh';

const I18N = {
  zh: { langToggle: 'EN' },
  en: { langToggle: '中文' },
};

function switchLanguage(lang)
{
  currentLang = lang;
  localStorage.setItem('bafx-lang', lang);

  const dict = I18N[lang] || I18N.zh;

  document.getElementById('langToggle').textContent = dict.langToggle;
}

document.getElementById('langToggle').addEventListener('click', () =>
{
  switchLanguage(currentLang === 'zh' ? 'en' : 'zh');
});

switchLanguage(currentLang);

// ── 恢复持久化设置 ──────────────────────────────────────────────────────
(function restoreSettings()
{
  const scaleEl = document.getElementById('ctrlScale');

  if (scaleEl && localStorage.getItem('bafx-ctrlScale'))
  {
    scaleEl.value = localStorage.getItem('bafx-ctrlScale');
    document.getElementById('outScale').textContent = parseFloat(scaleEl.value).toFixed(2);
    effect.updateConfig({ scale: parseFloat(scaleEl.value) });
  }

  const opacityEl = document.getElementById('ctrlOpacity');

  if (opacityEl && localStorage.getItem('bafx-ctrlOpacity'))
  {
    opacityEl.value = localStorage.getItem('bafx-ctrlOpacity');
    document.getElementById('outOpacity').textContent = parseFloat(opacityEl.value).toFixed(2);
    effect.updateConfig({ opacity: parseFloat(opacityEl.value) });
  }

  const dprEl = document.getElementById('ctrlDpr');

  if (dprEl && localStorage.getItem('bafx-ctrlDpr'))
  {
    dprEl.value = localStorage.getItem('bafx-ctrlDpr');
    document.getElementById('outDpr').textContent = dprEl.value;
    effect.updateConfig({ maxDpr: Math.round(parseFloat(dprEl.value)) });
  }

  if (localStorage.getItem('bafx-ctrlClick') === 'false')
  {
    const el = document.getElementById('ctrlClick');

    if (el)
    {
      el.checked = false;
    }

    effect.updateConfig({ clickEnabled: false });
  }

  if (localStorage.getItem('bafx-ctrlTrail') === 'false')
  {
    const el = document.getElementById('ctrlTrail');

    if (el)
    {
      el.checked = false;
    }

    effect.updateConfig({ trailEnabled: false });
  }

  const theme = localStorage.getItem('bafx-theme');

  if (theme && THEMES[theme])
  {
    applyTheme(theme);
  }

  const customBg = localStorage.getItem('bafx-custom-bg');

  if (customBg)
  {
    document.body.style.background = customBg;
  }
})();

// 页面销毁时清理
window.addEventListener('beforeunload', () =>
{
  effect.destroy();
});
