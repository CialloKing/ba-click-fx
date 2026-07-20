import './style.css';
import { BAClickFX, BLOOM_BACKEND_CHANGE_EVENT } from './fx.js';

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
function bindRange(id, outId, onChange, intOnly = false)
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

    out.textContent = intOnly ? String(Math.round(value)) : value.toFixed(2);
    onChange(value);
    localStorage.setItem('bafx-' + id, el.value);
  });
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
bindToggle('ctrlTrailAlways', (checked) => effect.updateConfig({ trailAlways: checked }));

// ── 渲染模式 → renderingMode + bloomBackend ──────────────────────────
const ctrlRenderMode = document.getElementById('ctrlRenderMode');
const RENDER_MODE_CONFIGS = Object.freeze(
  {
    'software-bloom': { renderingMode: 'enhanced', bloomBackend: 'software' },
    'webgl2-bloom': { renderingMode: 'enhanced', bloomBackend: 'webgl2' },
    'native-bloom': { renderingMode: 'enhanced', bloomBackend: 'native' },
    legacy: { renderingMode: 'legacy' },
  },
);

function updateRenderBackendStatus()
{
  const status = document.getElementById('renderBackendStatus');

  if (!status)
  {
    return;
  }

  const d = I18N[currentLang] || I18N.zh;
  const snapshot = effect.getConfig();
  const backendLabels = {
    auto: d.renderAutoBloom,
    software: d.renderSoftwareBloom,
    webgl2: d.renderWebGL2Bloom,
    native: d.renderNativeBloom,
    legacy: d.renderLegacy,
  };
  const resolved = snapshot.resolvedBloomBackend;
  const expected = snapshot.renderingMode === 'legacy'
    ? 'legacy'
    : snapshot.bloomBackend;
  const resolvedLabel = backendLabels[resolved] || resolved;
  const requestedLabel = backendLabels[expected] || expected;

  if (resolved === 'pending')
  {
    status.textContent = d.renderBackendPending.replace('{requested}', requestedLabel);
    return;
  }

  if (resolved !== expected && expected !== 'auto')
  {
    status.textContent = d.renderBackendFallback
      .replace('{resolved}', resolvedLabel)
      .replace('{requested}', requestedLabel);
    return;
  }

  status.textContent = d.renderBackendActive.replace('{backend}', resolvedLabel);
}

function applyRenderMode(mode)
{
  const config = RENDER_MODE_CONFIGS[mode] || RENDER_MODE_CONFIGS['software-bloom'];

  effect.updateConfig(config);
  updateRenderBackendStatus();
  // 事件负责持续同步运行时变化；RAF 兼容不支持 CustomEvent 的旧环境。
  requestAnimationFrame(updateRenderBackendStatus);
}

effect.canvas.addEventListener(
  BLOOM_BACKEND_CHANGE_EVENT,
  updateRenderBackendStatus,
);

if (ctrlRenderMode)
{
  ctrlRenderMode.addEventListener('change', () =>
  {
    const mode = ctrlRenderMode.value;

    applyRenderMode(mode);
    localStorage.setItem('bafx-ctrlRenderMode', mode);
  });
}

// ── 特效参数 → setFxParam ──────────────────────────────────────────────
bindRange('ctrlRingHdr', 'outRingHdr', (v) => effect.setFxParam('rings.hdrIntensity', v));
bindRange('ctrlRingRadMin', 'outRingRadMin', (v) => effect.setFxParam('rings.radiusMin', v));
bindRange('ctrlRingRadMax', 'outRingRadMax', (v) => effect.setFxParam('rings.radiusMax', v));
bindRange('ctrlRingWStart', 'outRingWStart', (v) => effect.setFxParam('rings.widthStart', v));
bindRange('ctrlRingWEnd', 'outRingWEnd', (v) => effect.setFxParam('rings.widthEnd', v));
bindRange('ctrlRingLife', 'outRingLife', (v) => effect.setFxParam('rings.lifetimeMs', v), true);
bindRange('ctrlClickShards', 'outClickShards', (v) => effect.setFxParam('shards.clickCount', v), true);
bindRange('ctrlMaxShards', 'outMaxShards', (v) => effect.setFxParam('shards.maxCount', v), true);
bindRange('ctrlBloomRing', 'outBloomRing', (v) => effect.setFxParam('bloom.ringBlur', v));
bindRange('ctrlBloomThreshold', 'outBloomThreshold', (v) =>
  effect.setFxParam('bloom.threshold', v));
bindRange('ctrlBloomIntensity', 'outBloomIntensity', (v) =>
  effect.setFxParam('bloom.intensity', v));
bindRange('ctrlBloomScatter', 'outBloomScatter', (v) =>
  effect.setFxParam('bloom.scatter', v));
bindRange('ctrlTrailW', 'outTrailW', (v) => effect.setFxParam('trail.width', v));
bindRange('ctrlTrailGlowW', 'outTrailGlowW', (v) => effect.setFxParam('trail.outerGlowWidth', v));
bindRange('ctrlTrailLife', 'outTrailLife', (v) => effect.setFxParam('trail.lifetimeMs', v), true);
bindRange('ctrlShardSpacing', 'outShardSpacing', (v) => effect.setFxParam('shards.trailSpacing', v), true);
bindRange('ctrlBloomTrail', 'outBloomTrail', (v) =>
{
  // 软件卷积会摊薄亮线，原生单路径滤镜不会；保持不同标定避免回退过亮。
  effect.setFxParam('bloom.trailEmissionAlpha', v);
  effect.setFxParam('bloom.trailAlpha', v * 0.18);
});
bindRange('ctrlTrailOpacity', 'outTrailOpacity', (v) => effect.setFxParam('trail.trailOpacity', v));

// ── 新暴露的数值参数 ──────────────────────────────────────────────────
bindRange('ctrlRingCount', 'outRingCount', (v) => effect.setFxParam('rings.count', v), true);
bindRange('ctrlDiskRadius', 'outDiskRadius', (v) => effect.setFxParam('disk.radius', v), true);
bindRange('ctrlDiskLife', 'outDiskLife', (v) => effect.setFxParam('disk.lifetimeMs', v), true);
bindRange('ctrlAngVelMul', 'outAngVelMul', (v) => effect.setFxParam('rings.angularVelocityMultiplier', v));
bindRange('ctrlArcSamples', 'outArcSamples', (v) => effect.setFxParam('rings.arcSamples', v), true);
bindRange('ctrlRingDir', 'outRingDir', (v) =>
{
  effect.setFxParam('rings.rotationDirection', Math.round(v));
  const out = document.getElementById('outRingDir');

  if (out)
  {
    out.textContent = v < 0 ? '逆时针' : '顺时针';
  }
});
bindRange('ctrlRootDuration', 'outRootDuration', (v) => effect.setFxParam('rootDurationMs', v), true);
bindRange('ctrlClickShardLifeMin', 'outClickShardLifeMin', (v) => effect.setFxParam('shards.clickLifetimeMinMs', v), true);
bindRange('ctrlClickShardLifeMax', 'outClickShardLifeMax', (v) => effect.setFxParam('shards.clickLifetimeMaxMs', v), true);

// ── Hit / Flare ────────────────────────────────────────────────────────
bindToggle('ctrlHitEnabled', (c) => effect.setFxParam('hit.enabled', c));
bindRange('ctrlHitRadius', 'outHitRadius', (v) => effect.setFxParam('hit.radius', v), true);
bindRange('ctrlHitLife', 'outHitLife', (v) => effect.setFxParam('hit.lifetimeMs', v), true);
bindToggle('ctrlFlareEnabled', (c) => effect.setFxParam('flare.enabled', c));
bindRange('ctrlFlareRadius', 'outFlareRadius', (v) => effect.setFxParam('flare.radius', v), true);
bindRange('ctrlFlareLife', 'outFlareLife', (v) => effect.setFxParam('flare.lifetimeMs', v), true);
bindRange('ctrlFlareRays', 'outFlareRays', (v) => effect.setFxParam('flare.rayCount', v), true);
bindRange('ctrlGeomWidth', 'outGeomWidth', (v) => effect.setFxParam('trail.geometryWidth', v));
bindRange('ctrlMinVertDist', 'outMinVertDist', (v) => effect.setFxParam('trail.minVertexDistance', v));
bindRange('ctrlTrailShardLifeMin', 'outTrailShardLifeMin', (v) => effect.setFxParam('shards.trailLifetimeMinMs', v), true);
bindRange('ctrlTrailShardLifeMax', 'outTrailShardLifeMax', (v) => effect.setFxParam('shards.trailLifetimeMaxMs', v), true);
bindRange('ctrlBloomDisk', 'outBloomDisk', (v) => effect.setFxParam('bloom.diskBlur', v));

// ── 主题颜色 ────────────────────────────────────────────────────────────
const ctrlColor = document.getElementById('ctrlColor');

if (ctrlColor)
{
  ctrlColor.addEventListener('input', () =>
  {
    effect.setThemeColor(ctrlColor.value);
    localStorage.setItem('bafx-ctrlColor', ctrlColor.value);
  });
}

// ── 重置 ────────────────────────────────────────────────────────────────
document.getElementById('btnReset').addEventListener('click', () =>
{
  document.getElementById('ctrlScale').value = '1';
  document.getElementById('outScale').textContent = '1.00';
  document.getElementById('ctrlOpacity').value = '1';
  document.getElementById('outOpacity').textContent = '1.00';
  document.getElementById('ctrlDpr').value = '2';
  document.getElementById('outDpr').textContent = '2';
  document.getElementById('ctrlRenderMode').value = 'software-bloom';
  document.getElementById('ctrlClick').checked = true;
  document.getElementById('ctrlTrail').checked = true;
  document.getElementById('ctrlTrailAlways').checked = false;
  document.getElementById('ctrlHitEnabled').checked = false;
  document.getElementById('ctrlFlareEnabled').checked = false;
  document.getElementById('ctrlColor').value = '#69a1ff';
  effect.setThemeColor('#69a1ff');

  // 重置特效参数
  const fxDefaults = [
    ['ctrlRingHdr', 'outRingHdr', 5.992157, false],
    ['ctrlRingRadMin', 'outRingRadMin', 51.0560832, false],
    ['ctrlRingRadMax', 'outRingRadMax', 59.5654304, false],
    ['ctrlRingWStart', 'outRingWStart', 1, false],
    ['ctrlRingWEnd', 'outRingWEnd', 1, false],
    ['ctrlRingLife', 'outRingLife', 600, true],
    ['ctrlClickShards', 'outClickShards', 4, true],
    ['ctrlMaxShards', 'outMaxShards', 96, true],
    ['ctrlBloomRing', 'outBloomRing', 80, false],
    ['ctrlBloomThreshold', 'outBloomThreshold', 1, false],
    ['ctrlBloomIntensity', 'outBloomIntensity', 0.45, false],
    ['ctrlBloomScatter', 'outBloomScatter', 0.35, false],
    ['ctrlTrailW', 'outTrailW', 2, false],
    ['ctrlTrailGlowW', 'outTrailGlowW', 9, false],
    ['ctrlTrailLife', 'outTrailLife', 300, true],
    ['ctrlShardSpacing', 'outShardSpacing', 80, true],
    ['ctrlBloomTrail', 'outBloomTrail', 1, false],
    ['ctrlTrailOpacity', 'outTrailOpacity', 1, false],
    // 新暴露参数
    ['ctrlRingCount', 'outRingCount', 2, true],
    ['ctrlDiskRadius', 'outDiskRadius', 48, true],
    ['ctrlDiskLife', 'outDiskLife', 200, true],
    ['ctrlAngVelMul', 'outAngVelMul', 11.17, false],
    ['ctrlArcSamples', 'outArcSamples', 96, true],
    ['ctrlRingDir', 'outRingDir', -1, true],
    ['ctrlRootDuration', 'outRootDuration', 1000, true],
    ['ctrlClickShardLifeMin', 'outClickShardLifeMin', 600, true],
    ['ctrlClickShardLifeMax', 'outClickShardLifeMax', 700, true],
    ['ctrlGeomWidth', 'outGeomWidth', 2, false],
    ['ctrlMinVertDist', 'outMinVertDist', 4, false],
    ['ctrlTrailShardLifeMin', 'outTrailShardLifeMin', 200, true],
    ['ctrlTrailShardLifeMax', 'outTrailShardLifeMax', 400, true],
    ['ctrlBloomDisk', 'outBloomDisk', 65, false],
  ];

  fxDefaults.forEach(([id, outId, val, intOnly]) =>
  {
    const el = document.getElementById(id);

    if (el)
    {
      el.value = String(val);
    }

    const out = document.getElementById(outId);

    if (out)
    {
      out.textContent = intOnly ? String(val) : val.toFixed(2);
    }
  });

  effect.resetFxConfig();

  effect.updateConfig(
    {
      scale: 1,
      opacity: 1,
      clickEnabled: true,
      trailEnabled: true,
      trailAlways: false,
      renderingMode: 'enhanced',
      bloomBackend: 'software',
      lightBackgroundContrastAlpha: 0.35,
      maxDpr: 2,
    },
  );
  requestAnimationFrame(updateRenderBackendStatus);
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
  panelToggle.style.right = '356px';
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
  zh: {
    langToggle: 'EN',
    hintClick: '🖱 点击任意处',
    hintDrag: '按住拖动留下光轨',
    hintKey: '按 <kbd>空格</kbd> 触发中心特效',
    hintDismissTitle: '关闭提示',
    introDismissTitle: '关闭',
    panelTitle: '控制面板',
    panelPinTitle: '固定面板',
    panelCloseTitle: '关闭面板',
    panelToggleTitle: '控制面板',
    sectionBasic: '基础',
    sectionTheme: '背景主题',
    sectionClick: '点击特效',
    sectionTrail: '拖尾轨迹',
    labelColor: '主题颜色',
    labelScale: '全局缩放',
    labelOpacity: '不透明度',
    labelDpr: '最大 DPR',
    labelRenderMode: '渲染模式',
    renderSoftwareBloom: '软件 Bloom',
    renderWebGL2Bloom: 'WebGL2 Bloom',
    renderNativeBloom: '原生辉光',
    renderLegacy: 'Legacy',
    renderAutoBloom: '自动选择',
    renderBackendActive: '实际后端：{backend}',
    renderBackendPending: '正在检测 {requested}…',
    renderBackendFallback: '实际后端：{resolved}（{requested} 不可用，已自动回退）',
    labelClickEnabled: '启用点击特效',
    labelRingHdr: '圆环 HDR 强度',
    labelRingRadMin: '圆环起始半径',
    labelRingRadMax: '圆环终止半径',
    labelRingWStart: '圆环起始厚度倍率',
    labelRingWEnd: '圆环终止厚度倍率',
    labelRingLife: '圆环寿命',
    labelClickShards: '点击碎片数量',
    labelMaxShards: '碎片上限',
    labelBloomRing: 'Bloom 圆环模糊',
    labelBloomThreshold: 'Bloom 阈值',
    labelBloomIntensity: 'Bloom 强度',
    labelBloomScatter: 'Bloom 扩散',
    labelTrailEnabled: '启用拖尾',
    labelTrailAlways: '始终显示',
    labelTrailW: '拖尾宽度',
    labelTrailGlowW: '外发光宽度',
    labelTrailLife: '拖尾寿命',
    labelShardSpacing: '碎片间距',
    labelBloomTrail: 'Bloom 拖尾发射校准',
    labelTrailOpacity: '拖尾整体透明度',
    labelRingCount: '圆环数量',
    labelDiskRadius: '光盘半径',
    labelDiskLife: '光盘寿命',
    labelAngVelMul: '旋转速度倍率',
    labelArcSamples: '弧线采样精度',
    labelRingDir: '旋转方向',
    labelRootDuration: '根持续时间',
    labelClickShardLifeMin: '点击碎片最短寿命',
    labelClickShardLifeMax: '点击碎片最长寿命',
    labelGeomWidth: '几何带宽',
    labelMinVertDist: '最小采样间距',
    labelTrailShardLifeMin: '拖尾碎片最短寿命',
    labelTrailShardLifeMax: '拖尾碎片最长寿命',
    labelBloomDisk: 'Bloom 光盘模糊',
    btnReset: '重置默认',
    customBgLabel: '自定义背景',
    customBgPlaceholder: 'CSS background 值或图片 URL…',
    btnApplyBg: '应用背景',
    introTitle: 'ba-click-fx',
    introP1: 'Blue Archive / 蔚蓝档案风格网页点击特效与鼠标拖尾。点击、拖动或移动鼠标预览效果。',
    introP2: '从 Unity FX_Touch.prefab 逐参数移植的 Canvas 2D 特效库，可选 WebGL2 Bloom 加速——溶解圆环、点击碎片、拖尾轨迹。零外部运行时依赖。',
    introInstallSummary: '安装方式 / Installation',
    introInstallContent: '<p><strong>npm</strong></p><pre><code>npm install ba-click-fx</code></pre><p><strong>CDN</strong></p><pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.6/dist/ba-click-fx.iife.js"&gt;&lt;/script&gt;</code></pre>',
    introFAQSummary: '常见问题 / FAQ',
    introFAQContent: '<p><strong>和蔚蓝档案有关吗？</strong> 粉丝向视觉特效库，粒子参数从游戏 Unity Prefab 逐项提取。</p><p><strong>需要素材或 WebGL？</strong> 不需要图片素材；默认软件 Bloom 只使用 Canvas 2D，也可选 WebGL2 加速，零运行时依赖。</p><p><strong>能用在博客或个人主页吗？</strong> 可以，支持 npm、CDN 和 script 引入。</p>',
  },
  en: {
    langToggle: '中文',
    hintClick: '🖱 Click anywhere',
    hintDrag: 'Hold and drag to leave trails',
    hintKey: 'Press <kbd>Space</kbd> to trigger effect',
    hintDismissTitle: 'Dismiss',
    introDismissTitle: 'Close',
    panelTitle: 'Control Panel',
    panelPinTitle: 'Pin Panel',
    panelCloseTitle: 'Close Panel',
    panelToggleTitle: 'Control Panel',
    sectionBasic: 'Basic',
    sectionTheme: 'Background Theme',
    sectionClick: 'Click Effect',
    sectionTrail: 'Cursor Trail',
    labelColor: 'Theme Color',
    labelScale: 'Global Scale',
    labelOpacity: 'Opacity',
    labelDpr: 'Max DPR',
    labelRenderMode: 'Render Mode',
    renderSoftwareBloom: 'Software Bloom',
    renderWebGL2Bloom: 'WebGL2 Bloom',
    renderNativeBloom: 'Native Glow',
    renderLegacy: 'Legacy',
    renderAutoBloom: 'Auto',
    renderBackendActive: 'Active backend: {backend}',
    renderBackendPending: 'Detecting {requested}…',
    renderBackendFallback: 'Active backend: {resolved} ({requested} unavailable; fell back automatically)',
    labelClickEnabled: 'Enable Click',
    labelRingHdr: 'Ring HDR Intensity',
    labelRingRadMin: 'Ring Radius Min',
    labelRingRadMax: 'Ring Radius Max',
    labelRingWStart: 'Ring Start Width Scale',
    labelRingWEnd: 'Ring End Width Scale',
    labelRingLife: 'Ring Lifetime',
    labelClickShards: 'Click Shard Count',
    labelMaxShards: 'Max Shards',
    labelBloomRing: 'Bloom Ring Blur',
    labelBloomThreshold: 'Bloom Threshold',
    labelBloomIntensity: 'Bloom Intensity',
    labelBloomScatter: 'Bloom Scatter',
    labelTrailEnabled: 'Enable Trail',
    labelTrailAlways: 'Always Show',
    labelTrailW: 'Trail Width',
    labelTrailGlowW: 'Outer Glow Width',
    labelTrailLife: 'Trail Lifetime',
    labelShardSpacing: 'Shard Spacing',
    labelBloomTrail: 'Bloom Trail Emission Scale',
    labelTrailOpacity: 'Trail Overall Opacity',
    labelRingCount: 'Ring Count',
    labelDiskRadius: 'Disk Radius',
    labelDiskLife: 'Disk Lifetime',
    labelAngVelMul: 'Rotation Speed',
    labelClickShardLifeMin: 'Click Shard Life Min',
    labelClickShardLifeMax: 'Click Shard Life Max',
    labelGeomWidth: 'Geometry Width',
    labelMinVertDist: 'Min Vertex Distance',
    labelTrailShardLifeMin: 'Trail Shard Life Min',
    labelTrailShardLifeMax: 'Trail Shard Life Max',
    labelBloomDisk: 'Bloom Disk Blur',
    btnReset: 'Reset Defaults',
    customBgLabel: 'Custom Background',
    customBgPlaceholder: 'CSS background or image URL…',
    btnApplyBg: 'Apply',
    introTitle: 'ba-click-fx',
    introP1: 'Blue Archive style mouse click effect and cursor trail for web. Click, drag, or move your mouse to preview.',
    introP2: 'Canvas 2D effect library ported from Unity FX_Touch.prefab, with optional WebGL2 Bloom acceleration — dissolve rings, click shards, drag trails. Zero runtime dependencies.',
    introInstallSummary: '安装方式 / Installation',
    introInstallContent: '<p><strong>npm</strong></p><pre><code>npm install ba-click-fx</code></pre><p><strong>CDN</strong></p><pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.6/dist/ba-click-fx.iife.js"&gt;&lt;/script&gt;</code></pre>',
    introFAQSummary: '常见问题 / FAQ',
    introFAQContent: '<p><strong>Is it related to Blue Archive?</strong> A fan-made VFX library with parameters extracted from the game Unity Prefab.</p><p><strong>Needs assets or WebGL?</strong> No image assets. Software Bloom uses Canvas 2D by default, while WebGL2 acceleration is optional. Zero runtime dependencies.</p><p><strong>Can I use it on my blog?</strong> Yes — npm, CDN, and direct script tag are all supported.</p>',
  },
};

function switchLanguage(lang)
{
  currentLang = lang;
  localStorage.setItem('bafx-lang', lang);

  const d = I18N[lang] || I18N.zh;

  document.getElementById('langToggle').textContent = d.langToggle;

  // 提示栏：保留 dismiss 按钮，替换内容
  const hintBar = document.getElementById('hintBar');
  const hintDismiss = document.getElementById('hintDismiss');

  hintBar.querySelectorAll('span:not(.hint-sep)').forEach((s, i) =>
  {
    const texts = [d.hintClick, d.hintDrag, d.hintKey];

    if (i < 3)
    {
      s.innerHTML = texts[i];
    }
  });

  // 面板标题 + 按钮 title
  document.querySelector('.panel-header h2').textContent = d.panelTitle;
  document.getElementById('panelPin').title = d.panelPinTitle;
  document.getElementById('panelClose').title = d.panelCloseTitle;
  document.getElementById('panelToggle').title = d.panelToggleTitle;
  document.getElementById('hintDismiss').title = d.hintDismissTitle || 'Close';
  document.getElementById('introDismiss').title = d.introDismissTitle || 'Close';

  // 段落标题
  const h3s = document.querySelectorAll('.panel-section h3');

  if (h3s[0])
  {
    h3s[0].textContent = d.sectionBasic;
  }

  if (h3s[1])
  {
    h3s[1].textContent = d.sectionTheme;
  }

  if (h3s[2])
  {
    h3s[2].textContent = d.sectionClick;
  }

  if (h3s[3])
  {
    h3s[3].textContent = d.sectionTrail;
  }

  // 控件标签：span 中可能包含 <output>，只替换文本前缀
  const labelMap = {
    ctrlColor: d.labelColor,
    ctrlScale: d.labelScale,
    ctrlOpacity: d.labelOpacity,
    ctrlDpr: d.labelDpr,
    ctrlRenderMode: d.labelRenderMode,
    ctrlClick: d.labelClickEnabled,
    ctrlRingHdr: d.labelRingHdr,
    ctrlRingRadMin: d.labelRingRadMin,
    ctrlRingRadMax: d.labelRingRadMax,
    ctrlRingWStart: d.labelRingWStart,
    ctrlRingWEnd: d.labelRingWEnd,
    ctrlRingLife: d.labelRingLife,
    ctrlClickShards: d.labelClickShards,
    ctrlMaxShards: d.labelMaxShards,
    ctrlBloomRing: d.labelBloomRing,
    ctrlBloomThreshold: d.labelBloomThreshold,
    ctrlBloomIntensity: d.labelBloomIntensity,
    ctrlBloomScatter: d.labelBloomScatter,
    ctrlTrail: d.labelTrailEnabled,
    ctrlTrailAlways: d.labelTrailAlways,
    ctrlTrailW: d.labelTrailW,
    ctrlTrailGlowW: d.labelTrailGlowW,
    ctrlTrailLife: d.labelTrailLife,
    ctrlShardSpacing: d.labelShardSpacing,
    ctrlBloomTrail: d.labelBloomTrail,
    ctrlTrailOpacity: d.labelTrailOpacity,
    ctrlRingCount: d.labelRingCount,
    ctrlDiskRadius: d.labelDiskRadius,
    ctrlDiskLife: d.labelDiskLife,
    ctrlAngVelMul: d.labelAngVelMul,
    ctrlArcSamples: d.labelArcSamples,
    ctrlRingDir: d.labelRingDir,
    ctrlRootDuration: d.labelRootDuration,
    ctrlClickShardLifeMin: d.labelClickShardLifeMin,
    ctrlClickShardLifeMax: d.labelClickShardLifeMax,
    ctrlGeomWidth: d.labelGeomWidth,
    ctrlMinVertDist: d.labelMinVertDist,
    ctrlTrailShardLifeMin: d.labelTrailShardLifeMin,
    ctrlTrailShardLifeMax: d.labelTrailShardLifeMax,
    ctrlBloomDisk: d.labelBloomDisk,
  };

  Object.entries(labelMap).forEach(([id, text]) =>
  {
    const el = document.getElementById(id);

    if (!el)
    {
      return;
    }

    const span = el.closest('label')?.querySelector('span:first-child');

    if (!span)
    {
      return;
    }

    const output = span.querySelector('output');

    if (output)
    {
      // 保留 output 及其后的文本节点（如 " ms"），只替换第一个文本节点
      for (const node of span.childNodes)
      {
        if (node.nodeType === Node.TEXT_NODE)
        {
          node.textContent = text + ' ';
          break;
        }
      }
    }
    else
    {
      span.textContent = text;
    }
  });

  // 渲染模式下拉选项文本
  const renderModeOptions = {
    'software-bloom': d.renderSoftwareBloom,
    'webgl2-bloom': d.renderWebGL2Bloom,
    'native-bloom': d.renderNativeBloom,
    'legacy': d.renderLegacy,
  };

  document.querySelectorAll('#ctrlRenderMode option').forEach((opt) =>
  {
    if (renderModeOptions[opt.value])
    {
      opt.textContent = renderModeOptions[opt.value];
    }
  });

  // 按钮
  document.getElementById('btnReset').textContent = d.btnReset;
  document.getElementById('customBgCtrl')?.querySelector('span') && (document.getElementById('customBgCtrl').querySelector('span').textContent = d.customBgLabel);
  document.getElementById('ctrlCustomBg').placeholder = d.customBgPlaceholder;
  document.getElementById('btnApplyBg').textContent = d.btnApplyBg;

  // 介绍区
  document.getElementById('introTitle').textContent = d.introTitle;
  document.getElementById('introP1').textContent = d.introP1;
  document.getElementById('introP2').textContent = d.introP2;
  document.getElementById('introInstallSummary').textContent = d.introInstallSummary;
  document.getElementById('introInstallContent').innerHTML = d.introInstallContent;
  document.getElementById('introFAQSummary').textContent = d.introFAQSummary;
  document.getElementById('introFAQContent').innerHTML = d.introFAQContent;
  updateRenderBackendStatus();
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

  const savedRenderMode = localStorage.getItem('bafx-ctrlRenderMode');
  const initialRenderMode = savedRenderMode && RENDER_MODE_CONFIGS[savedRenderMode]
    ? savedRenderMode
    : 'software-bloom';
  const renderModeEl = document.getElementById('ctrlRenderMode');

  if (renderModeEl)
  {
    renderModeEl.value = initialRenderMode;
  }

  // 默认值也走同一条路径，确保首次打开即可显示能力探测后的实际后端。
  applyRenderMode(initialRenderMode);

  if (localStorage.getItem('bafx-ctrlTrail') === 'false')
  {
    const el = document.getElementById('ctrlTrail');

    if (el)
    {
      el.checked = false;
    }

    effect.updateConfig({ trailEnabled: false });
  }

  // 恢复始终显示拖尾
  if (localStorage.getItem('bafx-ctrlTrailAlways') === 'true')
  {
    const el = document.getElementById('ctrlTrailAlways');

    if (el)
    {
      el.checked = true;
    }

    effect.updateConfig({ trailAlways: true });
  }

  // 恢复 FX 参数滑块
  const fxSliders = [
    ['ctrlRingHdr', 'rings.hdrIntensity'],
    ['ctrlRingRadMin', 'rings.radiusMin'],
    ['ctrlRingRadMax', 'rings.radiusMax'],
    ['ctrlRingWStart', 'rings.widthStart'],
    ['ctrlRingWEnd', 'rings.widthEnd'],
    ['ctrlRingLife', 'rings.lifetimeMs'],
    ['ctrlClickShards', 'shards.clickCount'],
    ['ctrlMaxShards', 'shards.maxCount'],
    ['ctrlBloomRing', 'bloom.ringBlur'],
    ['ctrlBloomThreshold', 'bloom.threshold'],
    ['ctrlBloomIntensity', 'bloom.intensity'],
    ['ctrlBloomScatter', 'bloom.scatter'],
    ['ctrlTrailW', 'trail.width'],
    ['ctrlTrailGlowW', 'trail.outerGlowWidth'],
    ['ctrlTrailLife', 'trail.lifetimeMs'],
    ['ctrlShardSpacing', 'shards.trailSpacing'],
    ['ctrlBloomTrail', 'bloom.trailEmissionAlpha'],
    ['ctrlTrailOpacity', 'trail.trailOpacity'],
    ['ctrlRingCount', 'rings.count'],
    ['ctrlDiskRadius', 'disk.radius'],
    ['ctrlDiskLife', 'disk.lifetimeMs'],
    ['ctrlAngVelMul', 'rings.angularVelocityMultiplier'],
    ['ctrlArcSamples', 'rings.arcSamples'],
    ['ctrlRingDir', 'rings.rotationDirection'],
    ['ctrlRootDuration', 'rootDurationMs'],
    ['ctrlClickShardLifeMin', 'shards.clickLifetimeMinMs'],
    ['ctrlClickShardLifeMax', 'shards.clickLifetimeMaxMs'],
    ['ctrlGeomWidth', 'trail.geometryWidth'],
    ['ctrlMinVertDist', 'trail.minVertexDistance'],
    ['ctrlTrailShardLifeMin', 'shards.trailLifetimeMinMs'],
    ['ctrlTrailShardLifeMax', 'shards.trailLifetimeMaxMs'],
    ['ctrlBloomDisk', 'bloom.diskBlur'],
    ['ctrlHitRadius', 'hit.radius'],
    ['ctrlHitLife', 'hit.lifetimeMs'],
    ['ctrlFlareRadius', 'flare.radius'],
    ['ctrlFlareLife', 'flare.lifetimeMs'],
    ['ctrlFlareRays', 'flare.rayCount'],
  ];

  // 恢复 Hit/Flare 开关
  if (localStorage.getItem('bafx-ctrlHitEnabled') === 'true')
  {
    const el = document.getElementById('ctrlHitEnabled');

    if (el)
    {
      el.checked = true;
    }

    effect.setFxParam('hit.enabled', true);
  }

  if (localStorage.getItem('bafx-ctrlFlareEnabled') === 'true')
  {
    const el = document.getElementById('ctrlFlareEnabled');

    if (el)
    {
      el.checked = true;
    }

    effect.setFxParam('flare.enabled', true);
  }

  fxSliders.forEach(([elId, paramPath]) =>
  {
    const saved = localStorage.getItem('bafx-' + elId);

    if (saved)
    {
      const el = document.getElementById(elId);

      if (el)
      {
        // 复用真实 input 处理器，确保输出文本和联动参数一并恢复。
        el.value = saved;
        el.dispatchEvent(new Event('input'));
      }
      else
      {
        effect.setFxParam(paramPath, parseFloat(saved));
      }
    }
  });

  // 恢复主题颜色
  const savedColor = localStorage.getItem('bafx-ctrlColor');

  if (savedColor && /^#[0-9a-f]{6}$/i.test(savedColor))
  {
    if (ctrlColor)
    {
      ctrlColor.value = savedColor;
    }

    effect.setThemeColor(savedColor);
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
