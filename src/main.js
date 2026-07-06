import './style.css';
import { BAClickFX } from './ba-spark.js';
import { CONFIG } from './config.js';

// ── 创建特效引擎实例 ────────────────────────────────────────────────────
const api = new BAClickFX();

// ── 演示页扩展 API（不进入引擎库）────────────────────────────────────────
api.saveSettings = function ()
{
  const data = {};

  for (let i = 0; i < localStorage.length; i++)
  {
    const key = localStorage.key(i);

    if (key.startsWith('bafx-'))
    {
      data[key.slice(5)] = localStorage.getItem(key);
    }
  }

  return JSON.stringify(data, null, 2);
};

api.loadSettings = function (json)
{
  let data;

  try { data = JSON.parse(json); } catch (e) { return false; }

  for (const [id, val] of Object.entries(data))
  {
    const el = document.getElementById(id);

    if (!el) { continue; }

    if (el.type === 'checkbox')
    {
      el.checked = val === 'true';
    }
    else
    {
      el.value = val;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  return true;
};

// 兼容旧 API：resetConfig 通过点击重置按钮触发完整 UI 重置
api._originalResetConfig = api.resetConfig;
api.resetConfig = function ()
{
  const btn = document.getElementById('btnReset');

  if (btn)
  {
    btn.click();
  }
};

// 暴露到全局
window.BAClickFXDdemo = api;

// ── 控制面板 & 交互提示 ──────────────────────────────────────────────────
(function initUI()
{
  const SETTINGS_VERSION = '2026-07-07-trail-render-fast-1';

  if (localStorage.getItem('bafx-version') !== SETTINGS_VERSION)
  {
    for (const key of Object.keys(localStorage))
    {
      if (key.startsWith('bafx-'))
      {
        localStorage.removeItem(key);
      }
    }

    localStorage.setItem('bafx-version', SETTINGS_VERSION);
  }

  // -- 默认值（用于重置）--
  const DEFAULTS = {
    color: '#69a1ff',
    scale: 1.10,
    opacity: 0.5,
    clickSpeed: 1,
    trailSpeed: 1.05,
    trail: true,
    trailAlways: false,
    trailWidth: 3,
    trailLength: 900,
    trailLife: 22,
    fakeGlow: true,
    clickFake: true,
    glow: false,
    shardSpacing: 220,
    shardChanceSlow: 0.04,
    shardChanceFast: 0.18,
    shardLargeChance: 0.62,
    maxShards: 38,
    smooth: 0.5,
    dpr: 1,
    trailRenderScale: 1,
    ringRotation: 0.008,
    ringGlow: 0.35,
    ringWidth: 0.9,
    ringAlpha: 0.9,
    trailBrightness: 0.96,
    trailWhiteMix: 0.08,

    sparksCount: 4,
    clickTotalLife: 27,
    clickScaleMul: 1.3,
    clickHaloRadius: 96,

    ringDelay: 2,
    ringMaxLife: 27,
    ringBaseRadiusMul: 0.47,
    ringPostDiskGrow: 24,
    ringGlowRadiusAdd: 54,
    ringSoftGlowRadiusAdd: 96,

    trailMainAlpha: 1,
    trailCoreAlpha: 0.78,
    trailHotAlpha: 0.34,
    trailGlowAlpha: 0.18,
    trailSoftGlowAlpha: 0.045,
    trailRailAlpha: 0.02,

    trailGlowWidthMul: 1.7,
    trailSoftGlowWidthMul: 2.4,

    trailTailDecayMul: 1.28,
    trailHeadDecayMul: 0.95,
    trailReleaseDecayMul: 1.18,
    trailSpeedDecay: 0.988,
    trailSpeedMin: 0.035,
    trailSpeedMax: 2.2,
  };

  // -- 面板开关 --
  const panel = document.getElementById('panel');
  const toggleBtn = document.getElementById('panelToggle');
  const closeBtn = document.getElementById('panelClose');
  const panelOverlay = document.getElementById('panelOverlay');
  const panelPin = document.getElementById('panelPin');
  let panelPinned = false;

  function openPanel()
  {
    panel.classList.add('open');
    toggleBtn.classList.add('active');
    panelOverlay.classList.add('open');
  }

  function closePanel()
  {
    panel.classList.remove('open');
    toggleBtn.classList.remove('active');
    panelOverlay.classList.remove('open');
  }

  toggleBtn.addEventListener('click', () => {
    panel.classList.contains('open') ? closePanel() : openPanel();
  });
  closeBtn.addEventListener('click', closePanel);

  // 点击遮罩层关闭面板（图钉固定时忽略）
  panelOverlay.addEventListener('click', () => {
    if (!panelPinned)
    {
      closePanel();
    }
  });

  // 图钉按钮
  panelPin.addEventListener('click', () => {
    panelPinned = !panelPinned;
    panelPin.classList.toggle('pinned', panelPinned);
    panelPin.title = panelPinned ? '已固定，点击面板外不会关闭' : '固定面板';
  });

  // -- 提示栏关闭 --
  const hintBar = document.getElementById('hintBar');

  document.getElementById('hintDismiss').addEventListener('click', () => {
    hintBar.classList.add('hidden');
  });

  // -- 背景主题 --
  const BACKGROUND_THEMES = {
    '蔚蓝': 'radial-gradient(circle at top, #1d3558 0%, #101827 45%, #080d16 100%)',
    '深紫': 'radial-gradient(circle at top, #2d1b4e 0%, #1a1028 45%, #0d0616 100%)',
    '深绿': 'radial-gradient(circle at top, #1a3d2a 0%, #0f1a14 45%, #080d0a 100%)',
    '暖金': 'radial-gradient(circle at top, #3d2a1a 0%, #1f1910 45%, #14100a 100%)',
    '纯黑': '#0a0a0f',
  };

  function wrapBgImage(url)
  {
    return `url("${url}") center / cover no-repeat fixed, #080d16`;
  }

  function isImageUrl(value)
  {
    return (
      /^https?:\/\/.+\.(png|jpg|jpeg|gif|webp|svg|avif)(\?.*)?$/i.test(value) ||
      /^https?:\/\/i\.imgur\.com\/.+/i.test(value)
    );
  }

  function setBodyBackground(value)
  {
    const bg = isImageUrl(value) ? wrapBgImage(value) : value;

    document.documentElement.style.background = bg;
  }

  function applyTheme(themeName)
  {
    const themeBtns = document.querySelectorAll('.theme-btn');

    for (const btn of themeBtns)
    {
      btn.classList.toggle('active', btn.dataset.theme === themeName);
    }

    const customBgCtrl = document.getElementById('customBgCtrl');
    const ctrlCustomBg = document.getElementById('ctrlCustomBg');
    const btnApplyBg = document.getElementById('btnApplyBg');
    const isCustom = themeName === 'custom';

    customBgCtrl.style.display = isCustom ? '' : 'none';
    ctrlCustomBg.style.display = isCustom ? '' : 'none';
    btnApplyBg.style.display = isCustom ? '' : 'none';

    if (isCustom)
    {
      const saved = localStorage.getItem('bafx-customBg');

      if (saved)
      {
        ctrlCustomBg.value = saved;
      }

      return;
    }

    const bgValue = BACKGROUND_THEMES[themeName];

    if (bgValue)
    {
      setBodyBackground(bgValue);
    }

    localStorage.setItem('bafx-theme', themeName);
    localStorage.removeItem('bafx-customBg');
  }

  function applyCustomBackground()
  {
    const ctrlCustomBg = document.getElementById('ctrlCustomBg');
    const value = ctrlCustomBg.value.trim();

    if (!value)
    {
      return;
    }

    setBodyBackground(value);
    localStorage.setItem('bafx-customBg', value);
    localStorage.setItem('bafx-theme', 'custom');
  }

  const themePresets = document.getElementById('themePresets');

  for (const btn of themePresets.querySelectorAll('.theme-btn'))
  {
    btn.addEventListener('click', () =>
    {
      applyTheme(btn.dataset.theme);
    });
  }

  document.getElementById('btnApplyBg').addEventListener('click', applyCustomBackground);

  document.getElementById('ctrlCustomBg').addEventListener('keydown', (e) =>
  {
    if (e.key === 'Enter')
    {
      applyCustomBackground();
    }
  });

  // 恢复已保存的主题
  const savedTheme = localStorage.getItem('bafx-theme');
  const savedCustomBg = localStorage.getItem('bafx-customBg');

  if (savedTheme === 'custom' && savedCustomBg)
  {
    applyTheme('custom');
    document.getElementById('ctrlCustomBg').value = savedCustomBg;
    setBodyBackground(savedCustomBg);
  }
  else if (savedTheme && BACKGROUND_THEMES[savedTheme])
  {
    applyTheme(savedTheme);
  }
  else
  {
    applyTheme('蔚蓝');
  }

  // -- 工具函数 --
  function bindRange(id, outputId, setter, intOnly = false)
  {
    const input = document.getElementById(id);
    const output = document.getElementById(outputId);

    if (!input) { return; }

    input.addEventListener('input', () => {
      const v = intOnly ? parseInt(input.value, 10) : parseFloat(input.value);

      output.textContent = intOnly ? v : v.toFixed(2);
      setter(v);
      localStorage.setItem('bafx-' + id, input.value);
    });
  }

  function rgbToHex(r, g, b)
  {
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  function hexToRgb(hex)
  {
    const n = parseInt(hex.slice(1), 16);

    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // -- 绑定控件 --
  const ctrlColor = document.getElementById('ctrlColor');

  ctrlColor.addEventListener('input', () => {
    const [r, g, b] = hexToRgb(ctrlColor.value);

    api.setColor(r, g, b);
    localStorage.setItem('bafx-ctrlColor', ctrlColor.value);
  });

  bindRange('ctrlScale', 'outScale', v => api.setScale(v));
  bindRange('ctrlOpacity', 'outOpacity', v => api.setOpacity(v));
  bindRange('ctrlClickSpeed', 'outClickSpeed', v => {
    const ts = parseFloat(document.getElementById('ctrlTrailSpeed').value);

    api.setSpeed(v, ts);
  });
  bindRange('ctrlTrailSpeed', 'outTrailSpeed', v => {
    const cs = parseFloat(document.getElementById('ctrlClickSpeed').value);

    api.setSpeed(cs, v);
  });

  const ctrlTrail = document.getElementById('ctrlTrail');

  ctrlTrail.addEventListener('change', () => { api.setTrail(ctrlTrail.checked); localStorage.setItem('bafx-ctrlTrail', ctrlTrail.checked); });

  const ctrlTrailAlways = document.getElementById('ctrlTrailAlways');

  ctrlTrailAlways.addEventListener('change', () => { api.setTrailAlways(ctrlTrailAlways.checked); localStorage.setItem('bafx-ctrlTrailAlways', ctrlTrailAlways.checked); });

  bindRange('ctrlTrailWidth', 'outTrailWidth', v => api.setTrailWidth(v));

  bindRange('ctrlTrailLength', 'outTrailLength', v => api.setTrailLength(v), true);
  bindRange('ctrlTrailLife', 'outTrailLife', v => api.setTrailLife(v), true);

  const ctrlFakeGlow = document.getElementById('ctrlFakeGlow');

  ctrlFakeGlow.addEventListener('change', () => { api.setFakeGlow(ctrlFakeGlow.checked); localStorage.setItem('bafx-ctrlFakeGlow', ctrlFakeGlow.checked); });

  const ctrlGlow = document.getElementById('ctrlGlow');

  ctrlGlow.addEventListener('change', () => { api.setGlow(ctrlGlow.checked); localStorage.setItem('bafx-ctrlGlow', ctrlGlow.checked); });

  const ctrlClickFakeGlow = document.getElementById('ctrlClickFakeGlow');

  ctrlClickFakeGlow.addEventListener('change', () => { api.setClickFakeGlow(ctrlClickFakeGlow.checked); localStorage.setItem('bafx-ctrlClickFakeGlow', ctrlClickFakeGlow.checked); });

  bindRange('ctrlShardSpacing', 'outShardSpacing', v => api.setShardSpacing(v), true);

  bindRange('ctrlShardChanceSlow', 'outShardChanceSlow', v => {
    const fast = parseFloat(document.getElementById('ctrlShardChanceFast').value);

    api.setShardChance(v, fast);
  });

  bindRange('ctrlShardChanceFast', 'outShardChanceFast', v => {
    const slow = parseFloat(document.getElementById('ctrlShardChanceSlow').value);

    api.setShardChance(slow, v);
  });

  bindRange('ctrlShardLargeChance', 'outShardLargeChance', v => api.setShardLargeChance(v));
  bindRange('ctrlMaxShards', 'outMaxShards', v => api.setMaxShards(v), true);

  bindRange('ctrlSmooth', 'outSmooth', v => api.setTrailSmooth(v));

  bindRange('ctrlDpr', 'outDpr', v => api.setDpr(v), true);
  bindRange('ctrlTrailRenderScale', 'outTrailRenderScale', v => api.setTrailRenderScale(v));

  bindRange('ctrlRingRotation', 'outRingRotation', v => api.setRingRotationSpeed(v));
  bindRange('ctrlRingGlow', 'outRingGlow', v => api.setRingGlow(v));
  bindRange('ctrlRingWidth', 'outRingWidth', v => api.setRingWidth(v));
  bindRange('ctrlRingAlpha', 'outRingAlpha', v => api.setRingAlpha(v));

  bindRange('ctrlTrailAlpha', 'outTrailAlpha', v => api.setTrailBrightness(v));
  bindRange('ctrlTrailWhiteMix', 'outTrailWhiteMix', v => api.setTrailWhiteMix(v));

  // -- 点击 --
  bindRange('ctrlSparksCount', 'outSparksCount', v => api.setSparksCount(v), true);
  bindRange('ctrlClickTotalLife', 'outClickTotalLife', v => api.setClickTotalLife(v), true);
  bindRange('ctrlClickScaleMul', 'outClickScaleMul', v => api.setClickScaleMul(v));
  bindRange('ctrlClickHaloRadius', 'outClickHaloRadius', v => api.setClickHaloRadius(v), true);

  // -- 圆环高级 --
  bindRange('ctrlRingDelay', 'outRingDelay', v => api.setRingDelay(v));
  bindRange('ctrlRingMaxLife', 'outRingMaxLife', v => api.setRingMaxLife(v), true);
  bindRange('ctrlRingBaseRadiusMul', 'outRingBaseRadiusMul', v => api.setRingBaseRadiusMul(v));
  bindRange('ctrlRingPostDiskGrow', 'outRingPostDiskGrow', v => api.setRingPostDiskGrow(v), true);
  bindRange('ctrlRingGlowRadiusAdd', 'outRingGlowRadiusAdd', v => api.setRingGlowRadiusAdd(v), true);
  bindRange('ctrlRingSoftGlowRadiusAdd', 'outRingSoftGlowRadiusAdd', v => api.setRingSoftGlowRadiusAdd(v), true);

  // -- 拖尾图层 --
  bindRange('ctrlTrailMainAlpha', 'outTrailMainAlpha', v => api.setTrailMainAlpha(v));
  bindRange('ctrlTrailCoreAlpha', 'outTrailCoreAlpha', v => api.setTrailCoreAlpha(v));
  bindRange('ctrlTrailHotAlpha', 'outTrailHotAlpha', v => api.setTrailHotAlpha(v));
  bindRange('ctrlTrailGlowAlpha', 'outTrailGlowAlpha', v => api.setTrailGlowAlpha(v));
  bindRange('ctrlTrailSoftGlowAlpha', 'outTrailSoftGlowAlpha', v => api.setTrailSoftGlowAlpha(v));
  bindRange('ctrlTrailRailAlpha', 'outTrailRailAlpha', v => api.setTrailRailAlpha(v));

  // -- 拖尾发光范围 --
  bindRange('ctrlTrailGlowWidthMul', 'outTrailGlowWidthMul', v => api.setTrailGlowWidthMul(v));
  bindRange('ctrlTrailSoftGlowWidthMul', 'outTrailSoftGlowWidthMul', v => api.setTrailSoftGlowWidthMul(v));

  // -- 拖尾消散 --
  bindRange('ctrlTrailTailDecayMul', 'outTrailTailDecayMul', v => api.setTrailTailDecayMul(v));
  bindRange('ctrlTrailHeadDecayMul', 'outTrailHeadDecayMul', v => api.setTrailHeadDecayMul(v));
  bindRange('ctrlTrailReleaseDecayMul', 'outTrailReleaseDecayMul', v => api.setTrailReleaseDecayMul(v));
  bindRange('ctrlTrailSpeedDecay', 'outTrailSpeedDecay', v => api.setTrailSpeedDecay(v));
  bindRange('ctrlTrailSpeedMin', 'outTrailSpeedMin', v => api.setTrailSpeedMin(v));
  bindRange('ctrlTrailSpeedMax', 'outTrailSpeedMax', v => api.setTrailSpeedMax(v));

  // -- 重置 --
  document.getElementById('btnReset').addEventListener('click', () => {
    ctrlColor.value = DEFAULTS.color;
    const [r, g, b] = hexToRgb(DEFAULTS.color);

    api.setColor(r, g, b);

    const setVal = (id, outId, val, intOnly = false) => {
      const el = document.getElementById(id);
      const out = document.getElementById(outId);

      if (!el || !out) { return; }

      el.value = val;
      out.textContent = intOnly ? val : Number(val).toFixed(2);
    };

    setVal('ctrlScale', 'outScale', DEFAULTS.scale);
    setVal('ctrlOpacity', 'outOpacity', DEFAULTS.opacity);
    setVal('ctrlClickSpeed', 'outClickSpeed', DEFAULTS.clickSpeed);
    setVal('ctrlTrailSpeed', 'outTrailSpeed', DEFAULTS.trailSpeed);
    setVal('ctrlTrailWidth', 'outTrailWidth', DEFAULTS.trailWidth);

    api.setScale(DEFAULTS.scale);
    api.setOpacity(DEFAULTS.opacity);
    api.setSpeed(DEFAULTS.clickSpeed, DEFAULTS.trailSpeed);
    api.setTrailWidth(DEFAULTS.trailWidth);

    setVal('ctrlTrailLength', 'outTrailLength', DEFAULTS.trailLength, true);
    setVal('ctrlTrailLife', 'outTrailLife', DEFAULTS.trailLife, true);
    api.setTrailLength(DEFAULTS.trailLength);
    api.setTrailLife(DEFAULTS.trailLife);

    ctrlTrail.checked = DEFAULTS.trail;
    ctrlTrailAlways.checked = DEFAULTS.trailAlways;
    ctrlFakeGlow.checked = DEFAULTS.fakeGlow;
    ctrlGlow.checked = DEFAULTS.glow;
    ctrlClickFakeGlow.checked = DEFAULTS.clickFake;

    api.setTrail(DEFAULTS.trail);
    api.setTrailAlways(DEFAULTS.trailAlways);
    api.setFakeGlow(DEFAULTS.fakeGlow);
    api.setGlow(DEFAULTS.glow);
    api.setClickFakeGlow(DEFAULTS.clickFake);

    setVal('ctrlShardSpacing', 'outShardSpacing', DEFAULTS.shardSpacing, true);
    setVal('ctrlMaxShards', 'outMaxShards', DEFAULTS.maxShards, true);
    setVal('ctrlShardChanceSlow', 'outShardChanceSlow', DEFAULTS.shardChanceSlow);
    setVal('ctrlShardChanceFast', 'outShardChanceFast', DEFAULTS.shardChanceFast);
    setVal('ctrlShardLargeChance', 'outShardLargeChance', DEFAULTS.shardLargeChance);

    api.setShardSpacing(DEFAULTS.shardSpacing);
    api.setShardChance(DEFAULTS.shardChanceSlow, DEFAULTS.shardChanceFast);
    api.setShardLargeChance(DEFAULTS.shardLargeChance);
    api.setMaxShards(DEFAULTS.maxShards);

    setVal('ctrlSmooth', 'outSmooth', DEFAULTS.smooth);
    api.setTrailSmooth(DEFAULTS.smooth);

    setVal('ctrlDpr', 'outDpr', DEFAULTS.dpr, true);
    api.setDpr(DEFAULTS.dpr);

    setVal('ctrlTrailRenderScale', 'outTrailRenderScale', DEFAULTS.trailRenderScale);
    api.setTrailRenderScale(DEFAULTS.trailRenderScale);
    setVal('ctrlRingRotation', 'outRingRotation', DEFAULTS.ringRotation);
    api.setRingRotationSpeed(DEFAULTS.ringRotation);
    setVal('ctrlRingGlow', 'outRingGlow', DEFAULTS.ringGlow);
    api.setRingGlow(DEFAULTS.ringGlow);
    setVal('ctrlRingWidth', 'outRingWidth', DEFAULTS.ringWidth);
    api.setRingWidth(DEFAULTS.ringWidth);
    setVal('ctrlRingAlpha', 'outRingAlpha', DEFAULTS.ringAlpha);
    api.setRingAlpha(DEFAULTS.ringAlpha);
    setVal('ctrlTrailAlpha', 'outTrailAlpha', DEFAULTS.trailBrightness);
    api.setTrailBrightness(DEFAULTS.trailBrightness);
    setVal('ctrlTrailWhiteMix', 'outTrailWhiteMix', DEFAULTS.trailWhiteMix);
    api.setTrailWhiteMix(DEFAULTS.trailWhiteMix);

    // 点击
    setVal('ctrlSparksCount', 'outSparksCount', DEFAULTS.sparksCount, true);
    api.setSparksCount(DEFAULTS.sparksCount);
    setVal('ctrlClickTotalLife', 'outClickTotalLife', DEFAULTS.clickTotalLife, true);
    api.setClickTotalLife(DEFAULTS.clickTotalLife);
    setVal('ctrlClickScaleMul', 'outClickScaleMul', DEFAULTS.clickScaleMul);
    api.setClickScaleMul(DEFAULTS.clickScaleMul);
    setVal('ctrlClickHaloRadius', 'outClickHaloRadius', DEFAULTS.clickHaloRadius, true);
    api.setClickHaloRadius(DEFAULTS.clickHaloRadius);

    // 圆环高级
    setVal('ctrlRingDelay', 'outRingDelay', DEFAULTS.ringDelay);
    api.setRingDelay(DEFAULTS.ringDelay);
    setVal('ctrlRingMaxLife', 'outRingMaxLife', DEFAULTS.ringMaxLife, true);
    api.setRingMaxLife(DEFAULTS.ringMaxLife);
    setVal('ctrlRingBaseRadiusMul', 'outRingBaseRadiusMul', DEFAULTS.ringBaseRadiusMul);
    api.setRingBaseRadiusMul(DEFAULTS.ringBaseRadiusMul);
    setVal('ctrlRingPostDiskGrow', 'outRingPostDiskGrow', DEFAULTS.ringPostDiskGrow, true);
    api.setRingPostDiskGrow(DEFAULTS.ringPostDiskGrow);
    setVal('ctrlRingGlowRadiusAdd', 'outRingGlowRadiusAdd', DEFAULTS.ringGlowRadiusAdd, true);
    api.setRingGlowRadiusAdd(DEFAULTS.ringGlowRadiusAdd);
    setVal('ctrlRingSoftGlowRadiusAdd', 'outRingSoftGlowRadiusAdd', DEFAULTS.ringSoftGlowRadiusAdd, true);
    api.setRingSoftGlowRadiusAdd(DEFAULTS.ringSoftGlowRadiusAdd);

    // 拖尾图层
    setVal('ctrlTrailMainAlpha', 'outTrailMainAlpha', DEFAULTS.trailMainAlpha);
    api.setTrailMainAlpha(DEFAULTS.trailMainAlpha);
    setVal('ctrlTrailCoreAlpha', 'outTrailCoreAlpha', DEFAULTS.trailCoreAlpha);
    api.setTrailCoreAlpha(DEFAULTS.trailCoreAlpha);
    setVal('ctrlTrailHotAlpha', 'outTrailHotAlpha', DEFAULTS.trailHotAlpha);
    api.setTrailHotAlpha(DEFAULTS.trailHotAlpha);
    setVal('ctrlTrailGlowAlpha', 'outTrailGlowAlpha', DEFAULTS.trailGlowAlpha);
    api.setTrailGlowAlpha(DEFAULTS.trailGlowAlpha);
    setVal('ctrlTrailSoftGlowAlpha', 'outTrailSoftGlowAlpha', DEFAULTS.trailSoftGlowAlpha);
    api.setTrailSoftGlowAlpha(DEFAULTS.trailSoftGlowAlpha);
    setVal('ctrlTrailRailAlpha', 'outTrailRailAlpha', DEFAULTS.trailRailAlpha);
    api.setTrailRailAlpha(DEFAULTS.trailRailAlpha);

    // 拖尾发光
    setVal('ctrlTrailGlowWidthMul', 'outTrailGlowWidthMul', DEFAULTS.trailGlowWidthMul);
    api.setTrailGlowWidthMul(DEFAULTS.trailGlowWidthMul);
    setVal('ctrlTrailSoftGlowWidthMul', 'outTrailSoftGlowWidthMul', DEFAULTS.trailSoftGlowWidthMul);
    api.setTrailSoftGlowWidthMul(DEFAULTS.trailSoftGlowWidthMul);

    // 拖尾消散
    setVal('ctrlTrailTailDecayMul', 'outTrailTailDecayMul', DEFAULTS.trailTailDecayMul);
    api.setTrailTailDecayMul(DEFAULTS.trailTailDecayMul);
    setVal('ctrlTrailHeadDecayMul', 'outTrailHeadDecayMul', DEFAULTS.trailHeadDecayMul);
    api.setTrailHeadDecayMul(DEFAULTS.trailHeadDecayMul);
    setVal('ctrlTrailReleaseDecayMul', 'outTrailReleaseDecayMul', DEFAULTS.trailReleaseDecayMul);
    api.setTrailReleaseDecayMul(DEFAULTS.trailReleaseDecayMul);
    setVal('ctrlTrailSpeedDecay', 'outTrailSpeedDecay', DEFAULTS.trailSpeedDecay);
    api.setTrailSpeedDecay(DEFAULTS.trailSpeedDecay);
    setVal('ctrlTrailSpeedMin', 'outTrailSpeedMin', DEFAULTS.trailSpeedMin);
    api.setTrailSpeedMin(DEFAULTS.trailSpeedMin);
    setVal('ctrlTrailSpeedMax', 'outTrailSpeedMax', DEFAULTS.trailSpeedMax);
    api.setTrailSpeedMax(DEFAULTS.trailSpeedMax);

    // 重置背景主题
    applyTheme('蔚蓝');

    localStorage.clear();
    localStorage.setItem('bafx-version', SETTINGS_VERSION);
  });

  const saved = {};

  for (let i = 0; i < localStorage.length; i++)
  {
    const key = localStorage.key(i);

    if (key.startsWith('bafx-'))
    {
      saved[key.slice(5)] = localStorage.getItem(key);
    }
  }

  for (const [id, val] of Object.entries(saved))
  {
    const el = document.getElementById(id);

    if (!el) { continue; }

    if (el.type === 'checkbox')
    {
      el.checked = val === 'true';
    }
    else
    {
      el.value = val;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
})();
