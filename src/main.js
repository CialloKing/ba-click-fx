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
    subDiskTiming: '圆盘时序',
    subDisk: '圆盘',
    subSoftGlow: '柔光',
    subArcSeg: '弧段',
    subColorFade: '颜色衰减',
    subShardFlicker: '碎片闪烁',
    subArcDetail: '弧段细节',
    subJitter: '半径抖动',
    subNormalGrow: '正常段增长',
    subCollapseTiming: '收缩时序',
    subTrailInput: '输入参数',
    labelColor: '主题颜色',
    labelScale: '全局缩放',
    labelOpacity: '不透明度',
    labelDpr: '最大 DPR',
    labelTrailRenderScale: '拖尾画质',
    labelClickEnabled: '启用点击特效',
    labelClickSpeed: '播放速度',
    labelSparksCount: '碎片数量',
    labelClickTotalLife: '特效时长',
    labelClickScaleMul: '点击缩放',
    labelClickHaloRadius: '光晕半径',
    labelClickFakeGlow: '点击柔光',
    labelDiskSize: '圆盘大小',
    labelDiskGlowRadius: '柔光范围',
    labelDiskGlowAlpha: '柔光透明度',
    labelClickShardFlicker: '闪烁周期',
    labelRingWhiteMix: '偏白程度',
    labelShardSpacing: '间距',
    labelShardChanceSlow: '慢速概率',
    labelShardChanceFast: '快速概率',
    labelShardLargeChance: '大碎片概率',
    labelMaxShards: '最大数量',
    labelRingRotation: '旋转速度',
    labelRingGlow: '光晕强度',
    labelRingWidth: '弧线宽度',
    labelRingWidthEndMul: '宽度收缩',
    labelRingAlpha: '透明度',
    labelRingDelay: '出现延迟',
    labelRingMaxLife: '总时长',
    labelRingBaseRadiusMul: '起始半径倍率',
    labelRingPostDiskGrow: '扩张量',
    labelRingGlowRadiusAdd: '发光半径',
    labelRingSoftGlowRadiusAdd: '柔光半径',
    labelRingGlowAlpha: '内层透明度',
    labelRingSoftGlowAlpha: '外层透明度',
    labelRingSegCount: '弧段数量',
    labelRingArcLen: '弧长',
    labelRingColorFadeStart: '衰减起点',
    labelRingColorEndWhiteMix: '末尾白混合',
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
    labelGlow: '真实光影',
    labelTrailGlowRadius: '光晕范围',
    labelTrailGlowIntensity: '光晕强度',
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
    labelDiskMaxLife: '存在帧数',
    labelDiskExpandEnd: '扩张比例',
    labelDiskColorEnd: '颜色过渡',
    labelDiskFadeStart: '淡出时机',
    labelRingMaxW: '最大宽度',
    labelRingExtraChance: '额外弧段概率',
    labelRingClusterChance: '聚拢概率',
    labelRingLenMulMin: '弧长倍率下限',
    labelRingLenMulMax: '弧长倍率上限',
    labelRingJitterMin: '抖动下限',
    labelRingJitterMax: '抖动上限',
    labelRingNormalGrowMin: '增长率下限',
    labelRingNormalGrowMax: '增长率上限',
    labelRingGrowEnd: '增长终点',
    labelRingCollapseStart: '收缩起点',
    labelRingFadeStart: '淡出起点',
    labelTrailMinDistance: '采样间距',
    labelTrailMaxJumpDistance: '断笔距离',
    labelTrailMaxCoalesced: '合并事件上限',
    labelTrailShardFlicker: '闪烁周期',
    labelTrailShardMinAlpha: '最低亮度',
    labelTrailShardSizePulse: '大小脉冲',
    labelTrailRailWidth: '轨道线宽度',
    labelTrailRibbonWidth: '能量带宽度',
    labelTrailRibbonAlpha: '能量带透明度',
    btnReset: '重置默认',
    customBgLabel: '自定义背景',
    customBgPlaceholder: 'CSS background 值或图片 URL…',
    btnApplyBg: '应用背景',
    introTitle: 'ba-click-fx',
    introP1: 'Blue Archive / 蔚蓝档案 style mouse click effect and cursor trail animation for web. Click, drag, or move your mouse to preview the effect.',
    introP2: 'ba-click-fx is a pure Canvas 2D JavaScript library for mouse click effects, cursor trail animation, glowing rings, particle sparks, and drag trails. Zero external dependencies.',
    introInstallSummary: '安装方式 / Installation',
    introInstallContent: '<p><strong>npm</strong></p><pre><code>npm install ba-click-fx</code></pre><p><strong>CDN</strong></p><pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.1.3/dist/ba-click-fx.iife.js"&gt;&lt;/script&gt;</code></pre>',
    introFAQSummary: '常见问题 / FAQ',
    introFAQContent: '<p><strong>ba-click-fx 和蔚蓝档案有关吗？</strong> 这是一个受蔚蓝档案 UI 点击和拖尾效果启发的粉丝向视觉特效库。</p><p><strong>需要图片素材或 WebGL 吗？</strong> 不需要，纯 Canvas 2D 实现，零外部运行时依赖。</p><p><strong>能用在博客或个人主页吗？</strong> 可以，支持 npm、CDN 和直接 script 引入三种方式。</p>',
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
    subDiskTiming: 'Disk Timing',
    subDisk: 'Disk',
    subSoftGlow: 'Soft Glow',
    subArcSeg: 'Arc Segments',
    subColorFade: 'Color Fade',
    subShardFlicker: 'Shard Flicker',
    subArcDetail: 'Arc Detail',
    subJitter: 'Radius Jitter',
    subNormalGrow: 'Normal Grow',
    subCollapseTiming: 'Collapse Timing',
    subTrailInput: 'Input Params',
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
    labelDiskSize: 'Disk Size',
    labelDiskGlowRadius: 'Glow Range',
    labelDiskGlowAlpha: 'Glow Opacity',
    labelClickShardFlicker: 'Flicker Period',
    labelRingWhiteMix: 'Whiteness',
    labelShardSpacing: 'Spacing',
    labelShardChanceSlow: 'Slow Chance',
    labelShardChanceFast: 'Fast Chance',
    labelShardLargeChance: 'Large Shard Chance',
    labelMaxShards: 'Max Count',
    labelRingRotation: 'Rotation Speed',
    labelRingGlow: 'Glow Intensity',
    labelRingWidth: 'Arc Width',
    labelRingWidthEndMul: 'Width Shrink',
    labelRingAlpha: 'Opacity',
    labelRingDelay: 'Appear Delay',
    labelRingMaxLife: 'Total Duration',
    labelRingBaseRadiusMul: 'Initial Radius',
    labelRingPostDiskGrow: 'Expansion',
    labelRingGlowRadiusAdd: 'Glow Radius',
    labelRingSoftGlowRadiusAdd: 'Soft Glow Radius',
    labelRingGlowAlpha: 'Inner Opacity',
    labelRingSoftGlowAlpha: 'Outer Opacity',
    labelRingSegCount: 'Segment Count',
    labelRingArcLen: 'Arc Length',
    labelRingColorFadeStart: 'Fade Start',
    labelRingColorEndWhiteMix: 'End Whiteness',
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
    labelGlow: 'Real Glow',
    labelTrailGlowRadius: 'Glow Radius',
    labelTrailGlowIntensity: 'Glow Intensity',
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
    labelDiskMaxLife: 'Disk Lifetime',
    labelDiskExpandEnd: 'Expansion Ratio',
    labelDiskColorEnd: 'Color Transition',
    labelDiskFadeStart: 'Fade Start',
    labelRingMaxW: 'Max Width',
    labelRingExtraChance: 'Extra Arc Chance',
    labelRingClusterChance: 'Cluster Chance',
    labelRingLenMulMin: 'Arc Length Min',
    labelRingLenMulMax: 'Arc Length Max',
    labelRingJitterMin: 'Jitter Min',
    labelRingJitterMax: 'Jitter Max',
    labelRingNormalGrowMin: 'Grow Min',
    labelRingNormalGrowMax: 'Grow Max',
    labelRingGrowEnd: 'Grow End',
    labelRingCollapseStart: 'Collapse Start',
    labelRingFadeStart: 'Fade Start',
    labelTrailMinDistance: 'Sample Distance',
    labelTrailMaxJumpDistance: 'Jump Distance',
    labelTrailMaxCoalesced: 'Max Coalesced',
    labelTrailShardFlicker: 'Flicker Period',
    labelTrailShardMinAlpha: 'Min Brightness',
    labelTrailShardSizePulse: 'Size Pulse',
    labelTrailRailWidth: 'Rail Width',
    labelTrailRibbonWidth: 'Ribbon Width',
    labelTrailRibbonAlpha: 'Ribbon Alpha',
    btnReset: 'Reset Defaults',
    customBgLabel: 'Custom Background',
    customBgPlaceholder: 'CSS background value or image URL…',
    btnApplyBg: 'Apply Background',
    introTitle: 'ba-click-fx',
    introP1: 'Blue Archive style mouse click effect and cursor trail animation for web. Click, drag, or move your mouse to preview the effect.',
    introP2: 'ba-click-fx is a pure Canvas 2D JavaScript library for mouse click effects, cursor trail animation, glowing rings, particle sparks, and drag trails. Zero external dependencies.',
    introInstallSummary: 'Installation',
    introInstallContent: '<p><strong>npm</strong></p><pre><code>npm install ba-click-fx</code></pre><p><strong>CDN</strong></p><pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.1.3/dist/ba-click-fx.iife.js"&gt;&lt;/script&gt;</code></pre>',
    introFAQSummary: 'FAQ',
    introFAQContent: '<p><strong>Is ba-click-fx related to Blue Archive?</strong> It is a fan-made visual effect library inspired by the UI click and trail effects of Blue Archive.</p><p><strong>Does it require images or WebGL?</strong> No. It uses pure Canvas 2D and has zero external runtime dependencies.</p><p><strong>Can I use it on a blog or personal homepage?</strong> Yes. It supports npm, CDN, and direct script usage.</p>',
  },
};

function switchLanguage(lang)
{
  const t = I18N[lang] ?? I18N.zh;

  document.getElementById('langToggle').textContent = t.langToggle;

  // 提示栏
  const hintBar = document.getElementById('hintBar');
  const hintSpans = hintBar.querySelectorAll('span:not(.hint-sep)');
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
  const subKeys = [
    'subDisk', 'subDiskTiming', 'subShards', 'subRings', 'subSoftGlow', 'subArcSeg', 'subColorFade',
    'subArcDetail', 'subJitter', 'subNormalGrow', 'subCollapseTiming',
    'subShardFlicker', 'subTrailInput',
  ];
  subHeadings.forEach((h4, i) => { if (t[subKeys[i]]) { h4.textContent = t[subKeys[i]]; } });

  // 标签（通过 id 映射）
  const labelMap = {
    ctrlColor: 'labelColor', ctrlScale: 'labelScale', ctrlOpacity: 'labelOpacity',
    ctrlDpr: 'labelDpr', ctrlTrailRenderScale: 'labelTrailRenderScale',
    ctrlClick: 'labelClickEnabled',
    ctrlClickSpeed: 'labelClickSpeed', ctrlSparksCount: 'labelSparksCount',
    ctrlClickTotalLife: 'labelClickTotalLife', ctrlClickScaleMul: 'labelClickScaleMul',
    ctrlClickHaloRadius: 'labelClickHaloRadius', ctrlClickFakeGlow: 'labelClickFakeGlow',
    ctrlDiskSize: 'labelDiskSize', ctrlDiskGlowRadius: 'labelDiskGlowRadius',
    ctrlDiskGlowAlpha: 'labelDiskGlowAlpha',
    ctrlClickShardFlicker: 'labelClickShardFlicker',
    ctrlShardSpacing: 'labelShardSpacing', ctrlShardChanceSlow: 'labelShardChanceSlow',
    ctrlShardChanceFast: 'labelShardChanceFast', ctrlShardLargeChance: 'labelShardLargeChance',
    ctrlMaxShards: 'labelMaxShards',
    ctrlRingRotation: 'labelRingRotation', ctrlRingGlow: 'labelRingGlow',
    ctrlRingWidth: 'labelRingWidth', ctrlRingWidthEndMul: 'labelRingWidthEndMul',
    ctrlRingAlpha: 'labelRingAlpha', ctrlRingWhiteMix: 'labelRingWhiteMix',
    ctrlRingDelay: 'labelRingDelay', ctrlRingMaxLife: 'labelRingMaxLife',
    ctrlRingBaseRadiusMul: 'labelRingBaseRadiusMul', ctrlRingPostDiskGrow: 'labelRingPostDiskGrow',
    ctrlRingGlowRadiusAdd: 'labelRingGlowRadiusAdd', ctrlRingSoftGlowRadiusAdd: 'labelRingSoftGlowRadiusAdd',
    ctrlRingGlowAlpha: 'labelRingGlowAlpha', ctrlRingSoftGlowAlpha: 'labelRingSoftGlowAlpha',
    ctrlRingSegCount: 'labelRingSegCount', ctrlRingArcLen: 'labelRingArcLen',
    ctrlRingColorFadeStart: 'labelRingColorFadeStart', ctrlRingColorEndWhiteMix: 'labelRingColorEndWhiteMix',
    ctrlTrail: 'labelTrailEnabled', ctrlTrailAlways: 'labelTrailAlways',
    ctrlTrailSpeed: 'labelTrailSpeed', ctrlTrailWidth: 'labelTrailWidth',
    ctrlTrailLength: 'labelTrailLength', ctrlTrailLife: 'labelTrailLife',
    ctrlSmooth: 'labelSmooth', ctrlTrailAlpha: 'labelTrailAlpha',
    ctrlTrailWhiteMix: 'labelTrailWhiteMix', ctrlFakeGlow: 'labelFakeGlow',
    ctrlGlow: 'labelGlow',
    ctrlTrailGlowRadius: 'labelTrailGlowRadius',
    ctrlTrailGlowIntensity: 'labelTrailGlowIntensity',
    ctrlTrailMainAlpha: 'labelTrailMainAlpha', ctrlTrailCoreAlpha: 'labelTrailCoreAlpha',
    ctrlTrailHotAlpha: 'labelTrailHotAlpha', ctrlTrailGlowAlpha: 'labelTrailGlowAlpha',
    ctrlTrailSoftGlowAlpha: 'labelTrailSoftGlowAlpha', ctrlTrailRailAlpha: 'labelTrailRailAlpha',
    ctrlTrailGlowWidthMul: 'labelTrailGlowWidthMul', ctrlTrailSoftGlowWidthMul: 'labelTrailSoftGlowWidthMul',
    ctrlTrailTailDecayMul: 'labelTrailTailDecayMul', ctrlTrailHeadDecayMul: 'labelTrailHeadDecayMul',
    ctrlTrailReleaseDecayMul: 'labelTrailReleaseDecayMul', ctrlTrailSpeedDecay: 'labelTrailSpeedDecay',
    ctrlTrailSpeedMin: 'labelTrailSpeedMin', ctrlTrailSpeedMax: 'labelTrailSpeedMax',
    ctrlDiskMaxLife: 'labelDiskMaxLife', ctrlDiskExpandEnd: 'labelDiskExpandEnd',
    ctrlDiskColorEnd: 'labelDiskColorEnd', ctrlDiskFadeStart: 'labelDiskFadeStart',
    ctrlRingMaxW: 'labelRingMaxW',
    ctrlRingExtraChance: 'labelRingExtraChance', ctrlRingClusterChance: 'labelRingClusterChance',
    ctrlRingLenMulMin: 'labelRingLenMulMin', ctrlRingLenMulMax: 'labelRingLenMulMax',
    ctrlRingJitterMin: 'labelRingJitterMin', ctrlRingJitterMax: 'labelRingJitterMax',
    ctrlRingNormalGrowMin: 'labelRingNormalGrowMin', ctrlRingNormalGrowMax: 'labelRingNormalGrowMax',
    ctrlRingGrowEnd: 'labelRingGrowEnd', ctrlRingCollapseStart: 'labelRingCollapseStart',
    ctrlRingFadeStart: 'labelRingFadeStart',
    ctrlTrailMinDistance: 'labelTrailMinDistance', ctrlTrailMaxJumpDistance: 'labelTrailMaxJumpDistance',
    ctrlTrailMaxCoalesced: 'labelTrailMaxCoalesced',
    ctrlTrailShardFlicker: 'labelTrailShardFlicker', ctrlTrailShardMinAlpha: 'labelTrailShardMinAlpha',
    ctrlTrailShardSizePulse: 'labelTrailShardSizePulse',
    ctrlTrailRailWidth: 'labelTrailRailWidth', ctrlTrailRibbonWidth: 'labelTrailRibbonWidth',
    ctrlTrailRibbonAlpha: 'labelTrailRibbonAlpha',
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

  // 介绍区块
  const introTitle = document.getElementById('introTitle');
  const introP1 = document.getElementById('introP1');
  const introP2 = document.getElementById('introP2');
  const introInstallSummary = document.getElementById('introInstallSummary');
  const introInstallContent = document.getElementById('introInstallContent');
  const introFAQSummary = document.getElementById('introFAQSummary');
  const introFAQContent = document.getElementById('introFAQContent');
  if (introTitle) { introTitle.textContent = t.introTitle; }
  if (introP1) { introP1.textContent = t.introP1; }
  if (introP2) { introP2.textContent = t.introP2; }
  if (introInstallSummary) { introInstallSummary.textContent = t.introInstallSummary; }
  if (introInstallContent) { introInstallContent.innerHTML = t.introInstallContent; }
  if (introFAQSummary) { introFAQSummary.textContent = t.introFAQSummary; }
  if (introFAQContent) { introFAQContent.innerHTML = t.introFAQContent; }

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
  const SETTINGS_VERSION = '2026-07-10-new-api-controls';

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
      trailGlowRadius: c.trail.glowRadiusMul,
      trailGlowIntensity: c.trail.glowIntensity,
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
      ringWidthEndMul: c.rings.widthEndMul,
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

      // 新增 API
      diskSize: c.filledCircle.rAddRate,
      diskGlowRadius: c.filledCircle.glowRadiusMul,
      diskGlowAlpha: c.filledCircle.glowAlpha,
      clickShardFlicker: c.click.shardFlickerPeriod,
      trailShardFlicker: c.trail.shardFlickerPeriod,
      trailShardMinAlpha: c.trail.shardFlickerMinAlpha,
      trailShardSizePulse: c.trail.shardFlickerSizePulse,
      ringGlowAlpha: c.rings.glowAlpha,
      ringSoftGlowAlpha: c.rings.softGlowAlpha,
      ringColorFadeStart: c.rings.colorFadeStart,
      ringColorEndWhiteMix: c.rings.colorEndWhiteMix,
      ringSegCount: c.rings.segmentCountMin,
      ringArcLen: c.rings.lenFull,

      // 圆盘时序
      diskMaxLife: c.filledCircle.maxLife,
      diskExpandEnd: c.filledCircle.expandEnd,
      diskColorEnd: c.filledCircle.colorEnd,
      diskFadeStart: c.filledCircle.fadeStart,

      // 弧线环精细
      ringMaxW: c.rings.maxW,
      ringExtraChance: c.rings.segmentExtraChance,
      ringClusterChance: c.rings.segmentClusterChance,
      ringLenMulMin: c.rings.lenMulMin,
      ringLenMulMax: c.rings.lenMulMax,
      ringJitterMin: c.rings.radiusJitterMin,
      ringJitterMax: c.rings.radiusJitterMax,
      ringNormalGrowMin: c.rings.segmentRadiusGrowMin,
      ringNormalGrowMax: c.rings.segmentRadiusGrowMax,
      ringGrowEnd: c.rings.growEnd,
      ringCollapseStart: c.rings.collapseStart,
      ringFadeStart: c.rings.fadeStart,

      // 轨迹输入
      trailMinDistance: c.trail.minDistance,
      trailMaxJumpDistance: c.trail.maxJumpDistance,
      trailMaxCoalesced: c.trail.maxCoalescedEvents,

      // 轨迹渲染层
      trailRailWidth: c.trail.railWidthSlow,
      trailRibbonWidth: c.trail.ribbonWidthMul,
      trailRibbonAlpha: c.trail.ribbonAlpha,
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

  // -- 介绍区块关闭（关闭后仍保留在 DOM 中以供 SEO）--
  const introSection = document.getElementById('introSection');

  // 若之前关闭过则恢复隐藏状态
  if (localStorage.getItem('bafx-intro-hidden') === 'true')
  {
    introSection.classList.add('hidden');
  }

  document.getElementById('introDismiss').addEventListener('click', () => {
    introSection.classList.add('hidden');
    localStorage.setItem('bafx-intro-hidden', 'true');
  });

  // -- 背景主题 --
  const BACKGROUND_THEMES = {
    '蔚蓝': 'radial-gradient(circle at top, #1d3558 0%, #101827 45%, #080d16 100%)',
    '深紫': 'radial-gradient(circle at top, #2d1b4e 0%, #1a1028 45%, #0d0616 100%)',
    '深绿': 'radial-gradient(circle at top, #1a3d2a 0%, #0f1a14 45%, #080d0a 100%)',
    '暖金': 'radial-gradient(circle at top, #3d2a1a 0%, #1f1910 45%, #14100a 100%)',
    '纯黑': '#000000',
    '纯白': '#ffffff',
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

  bindRange('ctrlTrailGlowRadius', 'outTrailGlowRadius', v => api.setTrailGlowRadius(v), true);
  bindRange('ctrlTrailGlowIntensity', 'outTrailGlowIntensity', v => api.setTrailGlowIntensity(v));

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
  bindRange('ctrlRingGlow', 'outRingGlow', v => api.setRingEmission(v));
  bindRange('ctrlRingWidth', 'outRingWidth', v => api.setRingWidth(v));
  bindRange('ctrlRingWidthEndMul', 'outRingWidthEndMul', v => api.setRingWidthEndMul(v));
  bindRange('ctrlRingAlpha', 'outRingAlpha', v => api.setRingAlpha(v));
  bindRange('ctrlRingWhiteMix', 'outRingWhiteMix', v => api.setRingWhiteMix(v));
  bindRange('ctrlRingGlowAlpha', 'outRingGlowAlpha', v => api.setRingGlowAlpha(v));
  bindRange('ctrlRingSoftGlowAlpha', 'outRingSoftGlowAlpha', v => api.setRingSoftGlowAlpha(v));
  bindRange('ctrlRingColorFadeStart', 'outRingColorFadeStart', v => api.setRingColorFadeStart(v));
  bindRange('ctrlRingColorEndWhiteMix', 'outRingColorEndWhiteMix', v => api.setRingColorEndWhiteMix(v));

  bindRange('ctrlTrailAlpha', 'outTrailAlpha', v => api.setTrailBrightness(v));
  bindRange('ctrlTrailWhiteMix', 'outTrailWhiteMix', v => api.setTrailWhiteMix(v));

  // -- 点击 --
  bindRange('ctrlSparksCount', 'outSparksCount', v => api.setSparksCount(v), true);
  bindRange('ctrlClickTotalLife', 'outClickTotalLife', v => api.setClickTotalLife(v), true);
  bindRange('ctrlClickScaleMul', 'outClickScaleMul', v => api.setClickScaleMul(v));
  bindRange('ctrlClickHaloRadius', 'outClickHaloRadius', v => api.setClickHaloRadius(v), true);

  bindRange('ctrlDiskSize', 'outDiskSize', v => api.setDiskSize(v), true);
  bindRange('ctrlDiskGlowRadius', 'outDiskGlowRadius', v => {
    const a = parseFloat(document.getElementById('ctrlDiskGlowAlpha').value);
    api.setDiskGlow(v, a);
  });
  bindRange('ctrlDiskGlowAlpha', 'outDiskGlowAlpha', v => {
    const r = parseFloat(document.getElementById('ctrlDiskGlowRadius').value);
    api.setDiskGlow(r, v);
  });
  bindRange('ctrlClickShardFlicker', 'outClickShardFlicker', v => api.setClickShardFlicker(v), true);

  // -- 圆环高级 --
  bindRange('ctrlRingDelay', 'outRingDelay', v => api.setRingDelay(v));
  bindRange('ctrlRingMaxLife', 'outRingMaxLife', v => api.setRingMaxLife(v), true);
  bindRange('ctrlRingBaseRadiusMul', 'outRingBaseRadiusMul', v => api.setRingBaseRadiusMul(v));
  bindRange('ctrlRingPostDiskGrow', 'outRingPostDiskGrow', v => api.setRingPostDiskGrow(v), true);
  bindRange('ctrlRingGlowRadiusAdd', 'outRingGlowRadiusAdd', v => api.setRingGlowRadiusAdd(v), true);
  bindRange('ctrlRingSoftGlowRadiusAdd', 'outRingSoftGlowRadiusAdd', v => api.setRingSoftGlowRadiusAdd(v), true);

  bindRange('ctrlRingSegCount', 'outRingSegCount', v => api.setRingSegmentCount(v), true);
  bindRange('ctrlRingArcLen', 'outRingArcLen', v => api.setRingArcLength(v));

  // -- 圆盘时序 --
  bindRange('ctrlDiskMaxLife', 'outDiskMaxLife', v => {
    const ee = parseFloat(document.getElementById('ctrlDiskExpandEnd').value);
    const ce = parseFloat(document.getElementById('ctrlDiskColorEnd').value);
    const fs = parseFloat(document.getElementById('ctrlDiskFadeStart').value);
    api.setDiskTiming(v, ee, ce, fs);
  });
  bindRange('ctrlDiskExpandEnd', 'outDiskExpandEnd', v => {
    const ml = parseFloat(document.getElementById('ctrlDiskMaxLife').value);
    const ce = parseFloat(document.getElementById('ctrlDiskColorEnd').value);
    const fs = parseFloat(document.getElementById('ctrlDiskFadeStart').value);
    api.setDiskTiming(ml, v, ce, fs);
  });
  bindRange('ctrlDiskColorEnd', 'outDiskColorEnd', v => {
    const ml = parseFloat(document.getElementById('ctrlDiskMaxLife').value);
    const ee = parseFloat(document.getElementById('ctrlDiskExpandEnd').value);
    const fs = parseFloat(document.getElementById('ctrlDiskFadeStart').value);
    api.setDiskTiming(ml, ee, v, fs);
  });
  bindRange('ctrlDiskFadeStart', 'outDiskFadeStart', v => {
    const ml = parseFloat(document.getElementById('ctrlDiskMaxLife').value);
    const ee = parseFloat(document.getElementById('ctrlDiskExpandEnd').value);
    const ce = parseFloat(document.getElementById('ctrlDiskColorEnd').value);
    api.setDiskTiming(ml, ee, ce, v);
  });

  // -- 弧线环精细 --
  bindRange('ctrlRingMaxW', 'outRingMaxW', v => {
    const minW = parseFloat(document.getElementById('ctrlRingWidth').value);
    api.setRingWidth(minW, v);
  });

  bindRange('ctrlRingExtraChance', 'outRingExtraChance', v => {
    const cc = parseFloat(document.getElementById('ctrlRingClusterChance').value);
    const lmin = parseFloat(document.getElementById('ctrlRingLenMulMin').value);
    const lmax = parseFloat(document.getElementById('ctrlRingLenMulMax').value);
    api.setRingSegmentDetail(v, cc, lmin, lmax);
  });
  bindRange('ctrlRingClusterChance', 'outRingClusterChance', v => {
    const ec = parseFloat(document.getElementById('ctrlRingExtraChance').value);
    const lmin = parseFloat(document.getElementById('ctrlRingLenMulMin').value);
    const lmax = parseFloat(document.getElementById('ctrlRingLenMulMax').value);
    api.setRingSegmentDetail(ec, v, lmin, lmax);
  });
  bindRange('ctrlRingLenMulMin', 'outRingLenMulMin', v => {
    const ec = parseFloat(document.getElementById('ctrlRingExtraChance').value);
    const cc = parseFloat(document.getElementById('ctrlRingClusterChance').value);
    const lmax = parseFloat(document.getElementById('ctrlRingLenMulMax').value);
    api.setRingSegmentDetail(ec, cc, v, lmax);
  });
  bindRange('ctrlRingLenMulMax', 'outRingLenMulMax', v => {
    const ec = parseFloat(document.getElementById('ctrlRingExtraChance').value);
    const cc = parseFloat(document.getElementById('ctrlRingClusterChance').value);
    const lmin = parseFloat(document.getElementById('ctrlRingLenMulMin').value);
    api.setRingSegmentDetail(ec, cc, lmin, v);
  });

  bindRange('ctrlRingJitterMin', 'outRingJitterMin', v => {
    const mx = parseFloat(document.getElementById('ctrlRingJitterMax').value);
    api.setRingRadiusJitter(v, mx);
  });
  bindRange('ctrlRingJitterMax', 'outRingJitterMax', v => {
    const mn = parseFloat(document.getElementById('ctrlRingJitterMin').value);
    api.setRingRadiusJitter(mn, v);
  });

  bindRange('ctrlRingNormalGrowMin', 'outRingNormalGrowMin', v => {
    const mx = parseFloat(document.getElementById('ctrlRingNormalGrowMax').value);
    api.setRingNormalGrow(v, mx);
  });
  bindRange('ctrlRingNormalGrowMax', 'outRingNormalGrowMax', v => {
    const mn = parseFloat(document.getElementById('ctrlRingNormalGrowMin').value);
    api.setRingNormalGrow(mn, v);
  });

  bindRange('ctrlRingGrowEnd', 'outRingGrowEnd', v => {
    const cs = parseFloat(document.getElementById('ctrlRingCollapseStart').value);
    const fs = parseFloat(document.getElementById('ctrlRingFadeStart').value);
    api.setRingCollapseTiming(v, cs, fs);
  });
  bindRange('ctrlRingCollapseStart', 'outRingCollapseStart', v => {
    const ge = parseFloat(document.getElementById('ctrlRingGrowEnd').value);
    const fs = parseFloat(document.getElementById('ctrlRingFadeStart').value);
    api.setRingCollapseTiming(ge, v, fs);
  });
  bindRange('ctrlRingFadeStart', 'outRingFadeStart', v => {
    const ge = parseFloat(document.getElementById('ctrlRingGrowEnd').value);
    const cs = parseFloat(document.getElementById('ctrlRingCollapseStart').value);
    api.setRingCollapseTiming(ge, cs, v);
  });

  // -- 轨迹输入参数 --
  bindRange('ctrlTrailMinDistance', 'outTrailMinDistance', v => api.setTrailMinDistance(v));
  bindRange('ctrlTrailMaxJumpDistance', 'outTrailMaxJumpDistance', v => api.setTrailMaxJumpDistance(v), true);
  bindRange('ctrlTrailMaxCoalesced', 'outTrailMaxCoalesced', v => api.setTrailMaxCoalescedEvents(v), true);

  // -- 轨迹渲染层宽度 --
  bindRange('ctrlTrailRailWidth', 'outTrailRailWidth', v => api.setTrailRailWidth(v));
  bindRange('ctrlTrailRibbonWidth', 'outTrailRibbonWidth', v => {
    const a = parseFloat(document.getElementById('ctrlTrailRibbonAlpha').value);
    api.setTrailRibbon(v, a);
  });
  bindRange('ctrlTrailRibbonAlpha', 'outTrailRibbonAlpha', v => {
    const w = parseFloat(document.getElementById('ctrlTrailRibbonWidth').value);
    api.setTrailRibbon(w, v);
  });

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

  // -- 拖尾碎片闪烁 --
  bindRange('ctrlTrailShardFlicker', 'outTrailShardFlicker', v => {
    const ma = parseFloat(document.getElementById('ctrlTrailShardMinAlpha').value);
    const sp = parseFloat(document.getElementById('ctrlTrailShardSizePulse').value);
    api.setTrailShardFlicker(v, ma, sp);
  }, true);
  bindRange('ctrlTrailShardMinAlpha', 'outTrailShardMinAlpha', v => {
    const p = parseFloat(document.getElementById('ctrlTrailShardFlicker').value);
    const sp = parseFloat(document.getElementById('ctrlTrailShardSizePulse').value);
    api.setTrailShardFlicker(p, v, sp);
  });
  bindRange('ctrlTrailShardSizePulse', 'outTrailShardSizePulse', v => {
    const p = parseFloat(document.getElementById('ctrlTrailShardFlicker').value);
    const ma = parseFloat(document.getElementById('ctrlTrailShardMinAlpha').value);
    api.setTrailShardFlicker(p, ma, v);
  });

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
    setVal('ctrlTrailGlowRadius', 'outTrailGlowRadius', DEFAULTS.trailGlowRadius, true);
    api.setTrailGlowRadius(DEFAULTS.trailGlowRadius);
    setVal('ctrlTrailGlowIntensity', 'outTrailGlowIntensity', DEFAULTS.trailGlowIntensity);
    api.setTrailGlowIntensity(DEFAULTS.trailGlowIntensity);
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
    api.setRingEmission(DEFAULTS.ringGlow);
    setVal('ctrlRingWidth', 'outRingWidth', DEFAULTS.ringWidth);
    api.setRingWidth(DEFAULTS.ringWidth);
    setVal('ctrlRingWidthEndMul', 'outRingWidthEndMul', DEFAULTS.ringWidthEndMul);
    api.setRingWidthEndMul(DEFAULTS.ringWidthEndMul);
    setVal('ctrlRingAlpha', 'outRingAlpha', DEFAULTS.ringAlpha);
    api.setRingAlpha(DEFAULTS.ringAlpha);
    setVal('ctrlRingWhiteMix', 'outRingWhiteMix', DEFAULTS.ringWhiteMix);
    api.setRingWhiteMix(DEFAULTS.ringWhiteMix);
    setVal('ctrlRingGlowAlpha', 'outRingGlowAlpha', DEFAULTS.ringGlowAlpha);
    api.setRingGlowAlpha(DEFAULTS.ringGlowAlpha);
    setVal('ctrlRingSoftGlowAlpha', 'outRingSoftGlowAlpha', DEFAULTS.ringSoftGlowAlpha);
    api.setRingSoftGlowAlpha(DEFAULTS.ringSoftGlowAlpha);
    setVal('ctrlRingColorFadeStart', 'outRingColorFadeStart', DEFAULTS.ringColorFadeStart);
    api.setRingColorFadeStart(DEFAULTS.ringColorFadeStart);
    setVal('ctrlRingColorEndWhiteMix', 'outRingColorEndWhiteMix', DEFAULTS.ringColorEndWhiteMix);
    api.setRingColorEndWhiteMix(DEFAULTS.ringColorEndWhiteMix);
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

    setVal('ctrlDiskSize', 'outDiskSize', DEFAULTS.diskSize, true);
    api.setDiskSize(DEFAULTS.diskSize);
    document.getElementById('ctrlDiskGlowRadius').value = DEFAULTS.diskGlowRadius;
    document.getElementById('ctrlDiskGlowAlpha').value = DEFAULTS.diskGlowAlpha;
    document.getElementById('outDiskGlowRadius').textContent = DEFAULTS.diskGlowRadius.toFixed(2);
    document.getElementById('outDiskGlowAlpha').textContent = DEFAULTS.diskGlowAlpha.toFixed(2);
    api.setDiskGlow(DEFAULTS.diskGlowRadius, DEFAULTS.diskGlowAlpha);

    setVal('ctrlClickShardFlicker', 'outClickShardFlicker', DEFAULTS.clickShardFlicker, true);
    api.setClickShardFlicker(DEFAULTS.clickShardFlicker);

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

    setVal('ctrlRingSegCount', 'outRingSegCount', DEFAULTS.ringSegCount, true);
    api.setRingSegmentCount(DEFAULTS.ringSegCount);
    setVal('ctrlRingArcLen', 'outRingArcLen', DEFAULTS.ringArcLen);
    api.setRingArcLength(DEFAULTS.ringArcLen);

    // 圆盘时序
    setVal('ctrlDiskMaxLife', 'outDiskMaxLife', DEFAULTS.diskMaxLife);
    setVal('ctrlDiskExpandEnd', 'outDiskExpandEnd', DEFAULTS.diskExpandEnd);
    setVal('ctrlDiskColorEnd', 'outDiskColorEnd', DEFAULTS.diskColorEnd);
    setVal('ctrlDiskFadeStart', 'outDiskFadeStart', DEFAULTS.diskFadeStart);
    api.setDiskTiming(DEFAULTS.diskMaxLife, DEFAULTS.diskExpandEnd, DEFAULTS.diskColorEnd, DEFAULTS.diskFadeStart);

    // 弧线环精细
    setVal('ctrlRingMaxW', 'outRingMaxW', DEFAULTS.ringMaxW);
    api.setRingWidth(DEFAULTS.ringWidth, DEFAULTS.ringMaxW);
    setVal('ctrlRingExtraChance', 'outRingExtraChance', DEFAULTS.ringExtraChance);
    setVal('ctrlRingClusterChance', 'outRingClusterChance', DEFAULTS.ringClusterChance);
    setVal('ctrlRingLenMulMin', 'outRingLenMulMin', DEFAULTS.ringLenMulMin);
    setVal('ctrlRingLenMulMax', 'outRingLenMulMax', DEFAULTS.ringLenMulMax);
    api.setRingSegmentDetail(DEFAULTS.ringExtraChance, DEFAULTS.ringClusterChance, DEFAULTS.ringLenMulMin, DEFAULTS.ringLenMulMax);
    setVal('ctrlRingJitterMin', 'outRingJitterMin', DEFAULTS.ringJitterMin);
    setVal('ctrlRingJitterMax', 'outRingJitterMax', DEFAULTS.ringJitterMax);
    api.setRingRadiusJitter(DEFAULTS.ringJitterMin, DEFAULTS.ringJitterMax);
    setVal('ctrlRingNormalGrowMin', 'outRingNormalGrowMin', DEFAULTS.ringNormalGrowMin);
    setVal('ctrlRingNormalGrowMax', 'outRingNormalGrowMax', DEFAULTS.ringNormalGrowMax);
    api.setRingNormalGrow(DEFAULTS.ringNormalGrowMin, DEFAULTS.ringNormalGrowMax);
    setVal('ctrlRingGrowEnd', 'outRingGrowEnd', DEFAULTS.ringGrowEnd);
    setVal('ctrlRingCollapseStart', 'outRingCollapseStart', DEFAULTS.ringCollapseStart);
    setVal('ctrlRingFadeStart', 'outRingFadeStart', DEFAULTS.ringFadeStart);
    api.setRingCollapseTiming(DEFAULTS.ringGrowEnd, DEFAULTS.ringCollapseStart, DEFAULTS.ringFadeStart);

    // 轨迹输入参数
    setVal('ctrlTrailMinDistance', 'outTrailMinDistance', DEFAULTS.trailMinDistance);
    api.setTrailMinDistance(DEFAULTS.trailMinDistance);
    setVal('ctrlTrailMaxJumpDistance', 'outTrailMaxJumpDistance', DEFAULTS.trailMaxJumpDistance, true);
    api.setTrailMaxJumpDistance(DEFAULTS.trailMaxJumpDistance);
    setVal('ctrlTrailMaxCoalesced', 'outTrailMaxCoalesced', DEFAULTS.trailMaxCoalesced, true);
    api.setTrailMaxCoalescedEvents(DEFAULTS.trailMaxCoalesced);

    // 轨迹渲染层宽度
    setVal('ctrlTrailRailWidth', 'outTrailRailWidth', DEFAULTS.trailRailWidth);
    api.setTrailRailWidth(DEFAULTS.trailRailWidth);
    setVal('ctrlTrailRibbonWidth', 'outTrailRibbonWidth', DEFAULTS.trailRibbonWidth);
    setVal('ctrlTrailRibbonAlpha', 'outTrailRibbonAlpha', DEFAULTS.trailRibbonAlpha);
    api.setTrailRibbon(DEFAULTS.trailRibbonWidth, DEFAULTS.trailRibbonAlpha);

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

    setVal('ctrlTrailShardFlicker', 'outTrailShardFlicker', DEFAULTS.trailShardFlicker, true);
    setVal('ctrlTrailShardMinAlpha', 'outTrailShardMinAlpha', DEFAULTS.trailShardMinAlpha);
    setVal('ctrlTrailShardSizePulse', 'outTrailShardSizePulse', DEFAULTS.trailShardSizePulse);
    api.setTrailShardFlicker(DEFAULTS.trailShardFlicker, DEFAULTS.trailShardMinAlpha, DEFAULTS.trailShardSizePulse);

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
