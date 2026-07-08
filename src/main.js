import './style.css';
import { BAClickFX } from './ba-spark.js';
import { createConfig } from './config.js';
import { rgbToHex, hexToRgb } from './utils.js';

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

// 演示页 resetConfig：触发 UI 重置按钮（含面板控件重置 + localStorage 清理）
api.resetConfig = function ()
{
  const btn = document.getElementById('btnReset');

  if (btn)
  {
    btn.click();
  }
};

// 暴露到全局
window.BAClickFXDemo = api;

// ── 国际化 ──────────────────────────────────────────────────────────────
const I18N = {
  zh: {
    langToggle: 'EN',
    hintClick: '🖱 点击任意处',
    hintDrag: '按住拖动留下光轨',
    hintKey: '按 <kbd>空格</kbd> 触发中心特效',
    hintDismissTitle: '关闭提示',
    panelTitle: '控制面板',
    panelPinTitle: '固定面板',
    panelCloseTitle: '关闭面板',
    sectionBasic: '基础',
    sectionTheme: '背景主题',
    sectionClick: '点击特效',
    sectionTrail: '拖尾轨迹',
    sectionTrailLayer: '拖尾图层',
    sectionTrailDecay: '拖尾消散',
    subShards: '碎片',
    subRings: '圆环',
    labelColor: '主题颜色',
    labelScale: '全局缩放',
    labelOpacity: '透明度',
    labelDpr: '最大 DPR',
    labelTrailRenderScale: '拖尾画质',
    labelClickEnabled: '启用点击特效',
    labelClickSpeed: '播放速度',
    labelSparksCount: '碎片数量',
    labelClickTotalLife: '特效时长',
    labelClickScaleMul: '点击缩放',
    labelClickHaloRadius: '光晕半径',
    labelClickFakeGlow: '点击柔光',
    labelShardSpacing: '间距',
    labelShardChanceSlow: '慢速概率',
    labelShardChanceFast: '快速概率',
    labelShardLargeChance: '大碎片概率',
    labelMaxShards: '最大数量',
    labelRingRotation: '旋转速度',
    labelRingGlow: '光晕强度',
    labelRingWidth: '弧线宽度',
    labelRingAlpha: '透明度',
    labelRingDelay: '出现延迟',
    labelRingMaxLife: '总时长',
    labelRingBaseRadiusMul: '起始半径倍率',
    labelRingPostDiskGrow: '扩张量',
    labelRingGlowRadiusAdd: '发光半径',
    labelRingSoftGlowRadiusAdd: '柔光半径',
    labelTrailEnabled: '启用拖尾',
    labelTrailAlways: '始终显示',
    labelTrailSpeed: '拖拽速度',
    labelTrailWidth: '基础宽度',
    labelTrailLength: '轨迹长度',
    labelTrailLife: '消散速度',
    labelSmooth: '平滑',
    labelTrailAlpha: '亮度',
    labelTrailWhiteMix: '偏白程度',
    labelFakeGlow: '多层柔光',
    labelGlow: '阴影发光',
    labelTrailMainAlpha: '主轨迹',
    labelTrailCoreAlpha: '中心高光',
    labelTrailHotAlpha: '蓝白热点',
    labelTrailGlowAlpha: '蓝色发光',
    labelTrailSoftGlowAlpha: '柔和外光',
    labelTrailRailAlpha: '细轨',
    labelTrailGlowWidthMul: '发光宽度',
    labelTrailSoftGlowWidthMul: '柔光宽度',
    labelTrailTailDecayMul: '尾部衰减',
    labelTrailHeadDecayMul: '头部衰减',
    labelTrailReleaseDecayMul: '松手衰减',
    labelTrailSpeedDecay: '速度衰减',
    labelTrailSpeedMin: '最小速度',
    labelTrailSpeedMax: '最大速度',
    btnReset: '重置默认',
    customBgLabel: '自定义背景',
    customBgPlaceholder: 'CSS background 值或图片 URL…',
    btnApplyBg: '应用背景',
  },
  en: {
    langToggle: '中文',
    hintClick: '🖱 Click anywhere',
    hintDrag: 'Hold and drag to leave light trails',
    hintKey: 'Press <kbd>Space</kbd> to trigger center effect',
    hintDismissTitle: 'Dismiss',
    panelTitle: 'Control Panel',
    panelPinTitle: 'Pin panel',
    panelCloseTitle: 'Close panel',
    sectionBasic: 'Basic',
    sectionTheme: 'Background Theme',
    sectionClick: 'Click Effect',
    sectionTrail: 'Cursor Trail',
    sectionTrailLayer: 'Trail Layers',
    sectionTrailDecay: 'Trail Decay',
    subShards: 'Shards',
    subRings: 'Rings',
    labelColor: 'Theme Color',
    labelScale: 'Global Scale',
    labelOpacity: 'Opacity',
    labelDpr: 'Max DPR',
    labelTrailRenderScale: 'Trail Quality',
    labelClickEnabled: 'Enable Click Effect',
    labelClickSpeed: 'Playback Speed',
    labelSparksCount: 'Spark Count',
    labelClickTotalLife: 'Effect Duration',
    labelClickScaleMul: 'Click Scale',
    labelClickHaloRadius: 'Halo Radius',
    labelClickFakeGlow: 'Click Soft Glow',
    labelShardSpacing: 'Spacing',
    labelShardChanceSlow: 'Slow Chance',
    labelShardChanceFast: 'Fast Chance',
    labelShardLargeChance: 'Large Shard Chance',
    labelMaxShards: 'Max Count',
    labelRingRotation: 'Rotation Speed',
    labelRingGlow: 'Glow Intensity',
    labelRingWidth: 'Arc Width',
    labelRingAlpha: 'Opacity',
    labelRingDelay: 'Appear Delay',
    labelRingMaxLife: 'Total Duration',
    labelRingBaseRadiusMul: 'Initial Radius',
    labelRingPostDiskGrow: 'Expansion',
    labelRingGlowRadiusAdd: 'Glow Radius',
    labelRingSoftGlowRadiusAdd: 'Soft Glow Radius',
    labelTrailEnabled: 'Enable Trail',
    labelTrailAlways: 'Always Show',
    labelTrailSpeed: 'Drag Speed',
    labelTrailWidth: 'Base Width',
    labelTrailLength: 'Trail Length',
    labelTrailLife: 'Fade Speed',
    labelSmooth: 'Smoothing',
    labelTrailAlpha: 'Brightness',
    labelTrailWhiteMix: 'Whiteness',
    labelFakeGlow: 'Multi-layer Glow',
    labelGlow: 'Shadow Glow',
    labelTrailMainAlpha: 'Main Trail',
    labelTrailCoreAlpha: 'Center Highlight',
    labelTrailHotAlpha: 'Blue-White Hotspot',
    labelTrailGlowAlpha: 'Blue Glow',
    labelTrailSoftGlowAlpha: 'Soft Outer Glow',
    labelTrailRailAlpha: 'Thin Rail',
    labelTrailGlowWidthMul: 'Glow Width',
    labelTrailSoftGlowWidthMul: 'Soft Glow Width',
    labelTrailTailDecayMul: 'Tail Decay',
    labelTrailHeadDecayMul: 'Head Decay',
    labelTrailReleaseDecayMul: 'Release Decay',
    labelTrailSpeedDecay: 'Speed Decay',
    labelTrailSpeedMin: 'Min Speed',
    labelTrailSpeedMax: 'Max Speed',
    btnReset: 'Reset Defaults',
    customBgLabel: 'Custom Background',
    customBgPlaceholder: 'CSS background value or image URL…',
    btnApplyBg: 'Apply Background',
  },
};

function switchLanguage(lang)
{
  const t = I18N[lang] ?? I18N.zh;

  document.getElementById('langToggle').textContent = t.langToggle;

  // 提示栏
  const hintBar = document.getElementById('hintBar');
  const hintSpans = hintBar.querySelectorAll('span');
  if (hintSpans.length >= 3)
  {
    hintSpans[0].innerHTML = t.hintClick;
    hintSpans[1].innerHTML = t.hintDrag;
    hintSpans[2].innerHTML = t.hintKey;
  }
  document.getElementById('hintDismiss').title = t.hintDismissTitle;

  // 面板头部
  const panel = document.getElementById('panel');
  panel.querySelector('h2').textContent = t.panelTitle;
  document.getElementById('panelPin').title = t.panelPinTitle;
  document.getElementById('panelClose').title = t.panelCloseTitle;

  // 面板段落标题
  const sections = panel.querySelectorAll('.panel-section h3');
  const sectionKeys = ['sectionBasic', 'sectionTheme', 'sectionClick', 'sectionTrail', 'sectionTrailLayer', 'sectionTrailDecay'];
  sections.forEach((h3, i) => { if (t[sectionKeys[i]]) { h3.textContent = t[sectionKeys[i]]; } });

  // 子标题
  const subHeadings = panel.querySelectorAll('.sub-heading');
  const subKeys = ['subShards', 'subRings'];
  subHeadings.forEach((h4, i) => { if (t[subKeys[i]]) { h4.textContent = t[subKeys[i]]; } });

  // 标签（通过 id 映射）
  const labelMap = {
    ctrlColor: 'labelColor', ctrlScale: 'labelScale', ctrlOpacity: 'labelOpacity',
    ctrlDpr: 'labelDpr', ctrlTrailRenderScale: 'labelTrailRenderScale',
    ctrlClick: 'labelClickEnabled',
    ctrlClickSpeed: 'labelClickSpeed', ctrlSparksCount: 'labelSparksCount',
    ctrlClickTotalLife: 'labelClickTotalLife', ctrlClickScaleMul: 'labelClickScaleMul',
    ctrlClickHaloRadius: 'labelClickHaloRadius', ctrlClickFakeGlow: 'labelClickFakeGlow',
    ctrlShardSpacing: 'labelShardSpacing', ctrlShardChanceSlow: 'labelShardChanceSlow',
    ctrlShardChanceFast: 'labelShardChanceFast', ctrlShardLargeChance: 'labelShardLargeChance',
    ctrlMaxShards: 'labelMaxShards',
    ctrlRingRotation: 'labelRingRotation', ctrlRingGlow: 'labelRingGlow',
    ctrlRingWidth: 'labelRingWidth', ctrlRingAlpha: 'labelRingAlpha',
    ctrlRingDelay: 'labelRingDelay', ctrlRingMaxLife: 'labelRingMaxLife',
    ctrlRingBaseRadiusMul: 'labelRingBaseRadiusMul', ctrlRingPostDiskGrow: 'labelRingPostDiskGrow',
    ctrlRingGlowRadiusAdd: 'labelRingGlowRadiusAdd', ctrlRingSoftGlowRadiusAdd: 'labelRingSoftGlowRadiusAdd',
    ctrlTrail: 'labelTrailEnabled', ctrlTrailAlways: 'labelTrailAlways',
    ctrlTrailSpeed: 'labelTrailSpeed', ctrlTrailWidth: 'labelTrailWidth',
    ctrlTrailLength: 'labelTrailLength', ctrlTrailLife: 'labelTrailLife',
    ctrlSmooth: 'labelSmooth', ctrlTrailAlpha: 'labelTrailAlpha',
    ctrlTrailWhiteMix: 'labelTrailWhiteMix', ctrlFakeGlow: 'labelFakeGlow',
    ctrlGlow: 'labelGlow',
    ctrlTrailMainAlpha: 'labelTrailMainAlpha', ctrlTrailCoreAlpha: 'labelTrailCoreAlpha',
    ctrlTrailHotAlpha: 'labelTrailHotAlpha', ctrlTrailGlowAlpha: 'labelTrailGlowAlpha',
    ctrlTrailSoftGlowAlpha: 'labelTrailSoftGlowAlpha', ctrlTrailRailAlpha: 'labelTrailRailAlpha',
    ctrlTrailGlowWidthMul: 'labelTrailGlowWidthMul', ctrlTrailSoftGlowWidthMul: 'labelTrailSoftGlowWidthMul',
    ctrlTrailTailDecayMul: 'labelTrailTailDecayMul', ctrlTrailHeadDecayMul: 'labelTrailHeadDecayMul',
    ctrlTrailReleaseDecayMul: 'labelTrailReleaseDecayMul', ctrlTrailSpeedDecay: 'labelTrailSpeedDecay',
    ctrlTrailSpeedMin: 'labelTrailSpeedMin', ctrlTrailSpeedMax: 'labelTrailSpeedMax',
  };

  for (const [id, key] of Object.entries(labelMap))
  {
    const ctrl = document.getElementById(id);
    if (!ctrl) { continue; }
    const span = ctrl.parentElement?.querySelector('span');
    if (span) { span.childNodes[0].textContent = t[key] + ' '; }
  }

  // 按钮
  document.getElementById('btnReset').textContent = t.btnReset;
  document.getElementById('ctrlCustomBg').placeholder = t.customBgPlaceholder;
  document.querySelector('.custom-bg-ctrl span').textContent = t.customBgLabel;
  document.getElementById('btnApplyBg').textContent = t.btnApplyBg;

  localStorage.setItem('bafx-lang', lang);
}

// 语言切换按钮
document.getElementById('langToggle').addEventListener('click', () =>
{
  const next = localStorage.getItem('bafx-lang') === 'en' ? 'zh' : 'en';
  switchLanguage(next);
});

// ── 控制面板 & 交互提示 ──
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

  // -- 默认值（用于重置）— 从 config 模块自动提取，避免重复维护 --
  function readDefaults()
  {
    const c = createConfig();

    return {
      color: '#' + c.color.map(v => v.toString(16).padStart(2, '0')).join(''),
      scale: c.scale,
      opacity: c.opacity,
      clickSpeed: c.clickSpeed,
      trailSpeed: c.trailSpeed,
      trail: c.trail.enabled,
      clickEnabled: c.clickEnabled,
      trailAlways: c.trail.always,
      trailWidth: c.trail.baseWidthSlow,
      trailLength: c.trail.lengthSlow,
      trailLife: c.trail.lifeSlow,
      fakeGlow: c.glow.fake,
      clickFake: c.glow.clickFake,
      glow: c.glow.enabled,
      shardSpacing: c.trail.shardSpacing,
      shardChanceSlow: c.trail.shardChanceSlow,
      shardChanceFast: c.trail.shardChanceFast,
      shardLargeChance: c.trail.shardLargeChance,
      maxShards: c.trail.maxSparkParticles,
      smooth: c.trail.smoothFactor,
      dpr: c.maxDpr,
      trailRenderScale: c.trailRenderScale,
      ringRotation: c.rings.rotationSpeed,
      ringGlow: c.rings.emissionAlpha,
      ringWidth: c.rings.minW,
      ringAlpha: c.rings.alpha,
      ringWhiteMix: c.rings.whiteMix,
      trailBrightness: c.trail.alpha,
      trailWhiteMix: c.trail.whiteMix,
      sparksCount: c.sparksCount,
      clickTotalLife: c.click.totalLife,
      clickScaleMul: c.click.scaleMul,
      clickHaloRadius: c.click.haloRadius,
      ringDelay: c.rings.delay,
      ringMaxLife: c.rings.maxLife,
      ringBaseRadiusMul: c.rings.baseRadiusMul,
      ringPostDiskGrow: c.rings.postDiskGrow,
      ringGlowRadiusAdd: c.rings.glowRadiusAdd,
      ringSoftGlowRadiusAdd: c.rings.softGlowRadiusAdd,
      trailMainAlpha: c.trail.mainAlpha,
      trailCoreAlpha: c.trail.coreAlpha,
      trailHotAlpha: c.trail.hotAlpha,
      trailGlowAlpha: c.trail.glowAlpha,
      trailSoftGlowAlpha: c.trail.softGlowAlpha,
      trailRailAlpha: c.trail.railAlpha,
      trailGlowWidthMul: c.trail.glowWidthMul,
      trailSoftGlowWidthMul: c.trail.softGlowWidthMul,
      trailTailDecayMul: c.trail.tailDecayMul,
      trailHeadDecayMul: c.trail.headDecayMul,
      trailReleaseDecayMul: c.trail.releaseDecayMul,
      trailSpeedDecay: c.trail.speedDecay,
      trailSpeedMin: c.trail.speedMin,
      trailSpeedMax: c.trail.speedMax,
    };
  }
  const DEFAULTS = readDefaults();

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

  const ctrlClick = document.getElementById('ctrlClick');

  ctrlClick.addEventListener('change', () => { api.setClick(ctrlClick.checked); localStorage.setItem('bafx-ctrlClick', ctrlClick.checked); });

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
  bindRange('ctrlRingWhiteMix', 'outRingWhiteMix', v => api.setRingWhiteMix(v));

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
    ctrlClick.checked = DEFAULTS.clickEnabled;

    api.setTrail(DEFAULTS.trail);
    api.setTrailAlways(DEFAULTS.trailAlways);
    api.setFakeGlow(DEFAULTS.fakeGlow);
    api.setGlow(DEFAULTS.glow);
    api.setClickFakeGlow(DEFAULTS.clickFake);
    api.setClick(DEFAULTS.clickEnabled);

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
    setVal('ctrlRingWhiteMix', 'outRingWhiteMix', DEFAULTS.ringWhiteMix);
    api.setRingWhiteMix(DEFAULTS.ringWhiteMix);
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

    // 只删除 bafx- 前缀的键，不影响同域名下其他应用
    for (const key of Object.keys(localStorage))
    {
      if (key.startsWith('bafx-'))
      {
        localStorage.removeItem(key);
      }
    }

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

  // 按空格键在屏幕中央触发点击特效（仅演示页功能）
  window.addEventListener('keydown', (event) =>
  {
    if (event.key === ' ')
    {
      event.preventDefault();
      api.boom();
    }
  });

  // 语言初始化
  const savedLang = localStorage.getItem('bafx-lang') || 'zh';
  switchLanguage(savedLang);
})();
