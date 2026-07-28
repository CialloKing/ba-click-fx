import './style.css';
import {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  EFFECT_BACKEND_CHANGE_EVENT,
} from './fx.js';

function acceptDemoPointer(event)
{
  const panel = document.getElementById('panel');

  // 展示页把控制面板视作宿主 UI；手动模式也必须由适配层执行同样过滤。
  return !panel?.contains(event.target);
}

// ── 创建特效引擎 ────────────────────────────────────────────────────────
const effect = new BAClickFX(
  {
    inputFilter: acceptDemoPointer,
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

function setCustomBackgroundControlsVisible(visible)
{
  for (const id of ['customBgCtrl', 'ctrlCustomBg', 'btnApplyBg'])
  {
    const element = document.getElementById(id);

    if (element)
    {
      element.style.display = visible ? '' : 'none';
    }
  }
}

function selectTheme(name)
{
  document.querySelectorAll('.theme-btn').forEach((button) =>
  {
    button.classList.toggle('active', button.dataset.theme === name);
  });
  setCustomBackgroundControlsVisible(name === 'custom');
}

function applyTheme(name)
{
  if (name === 'custom')
  {
    selectTheme(name);
    return true;
  }

  const bg = THEMES[name];

  if (!bg)
  {
    return false;
  }

  document.body.style.background = bg;
  selectTheme(name);
  return true;
}

function escapeCssUrl(value)
{
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replace(/[\n\r\f]/g, '');
}

function resolveCustomBackground(value)
{
  const trimmed = value.trim();

  if (!trimmed)
  {
    return null;
  }

  if (CSS.supports('background', trimmed))
  {
    return trimmed;
  }

  // 输入框同时接受完整 CSS 和裸图片 URL；后者需要显式包装成 background。
  const imageBackground = `url("${escapeCssUrl(trimmed)}") center / cover no-repeat fixed`;

  return CSS.supports('background', imageBackground)
    ? imageBackground
    : null;
}

function applyCustomBackground(value, persist = true)
{
  const resolved = resolveCustomBackground(value);

  if (!resolved)
  {
    return false;
  }

  const input = document.getElementById('ctrlCustomBg');
  const rawValue = value.trim();

  document.body.style.background = resolved;

  if (input)
  {
    input.value = rawValue;
  }

  selectTheme('custom');

  if (persist)
  {
    localStorage.setItem('bafx-theme', 'custom');
    localStorage.setItem('bafx-custom-bg', rawValue);
  }

  return true;
}

// ── 控件绑定 ────────────────────────────────────────────────────────────
function bindRange(id, outId, onChange, intOnly = false, applyEvent = 'input')
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

    if (applyEvent === 'input')
    {
      onChange(value);
    }

    localStorage.setItem('bafx-' + id, el.value);
  });

  if (applyEvent !== 'input')
  {
    el.addEventListener(applyEvent, () =>
    {
      onChange(parseFloat(el.value));
    });
  }
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
// DPR 会重建 Canvas 与 RenderTarget，拖动结束后再应用可避免连续抖动。
bindRange('ctrlDpr', 'outDpr', (value) =>
{
  effect.updateConfig(
    {
      maxDpr: value,
    },
  );
}, false, 'change');

bindToggle('ctrlIsolatedCompositing', (checked) =>
  effect.updateConfig({ isolatedCompositing: checked }));
bindToggle('ctrlClick', (checked) => effect.updateConfig({ clickEnabled: checked }));
bindToggle('ctrlTrail', (checked) => effect.updateConfig({ trailEnabled: checked }));
bindToggle('ctrlTrailAlways', (checked) => effect.updateConfig({ trailAlways: checked }));
bindRange('ctrlClickTimeScale', 'outClickTimeScale', (value) =>
  effect.updateConfig({ clickTimeScale: value }));
bindRange('ctrlTrailTimeScale', 'outTrailTimeScale', (value) =>
  effect.updateConfig({ trailTimeScale: value }));

// ── 宿主控制 API 演示 ───────────────────────────────────────────────────
const ctrlInputSource = document.getElementById('ctrlInputSource');
const ctrlPaused = document.getElementById('ctrlPaused');
const ctrlPauseClear = document.getElementById('ctrlPauseClear');
let currentInputSource = 'dom';
let manualPointerId = null;

function isManualInput()
{
  return currentInputSource === 'manual';
}

function toManualPointerInput(event)
{
  const rect = effect.canvas.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pointerId: event.pointerId ?? 1,
    pointerType: event.pointerType || 'mouse',
  };
}

function acceptManualPointerDown(event)
{
  const pointerType = event.pointerType || 'mouse';

  // 通用 API 接受宿主转换后的逻辑主指针；网页适配层单独保留左键交互习惯。
  if (pointerType === 'mouse' && event.button > 0)
  {
    return false;
  }

  return acceptDemoPointer(event);
}

function updateHostApiStatus()
{
  const status = document.getElementById('hostApiStatus');

  if (!status)
  {
    return;
  }

  const dictionary = I18N[currentLang] || I18N.zh;

  if (ctrlPaused?.checked)
  {
    status.textContent = dictionary.hostApiPaused;
  }
  else if (isManualInput())
  {
    status.textContent = dictionary.hostApiManual;
  }
  else
  {
    status.textContent = dictionary.hostApiDom;
  }
}

function applyInputSource(inputSource, persist = true)
{
  const resolvedSource = inputSource === 'manual' ? 'manual' : 'dom';

  manualPointerId = null;
  effect.updateConfig({ inputSource: resolvedSource });
  // 指针移动是高频路径；缓存展示页状态可避免为每个样本深拷贝完整配置。
  currentInputSource = resolvedSource;

  if (ctrlInputSource)
  {
    ctrlInputSource.value = resolvedSource;
  }

  if (persist)
  {
    localStorage.setItem('bafx-ctrlInputSource', resolvedSource);
  }

  updateHostApiStatus();
}

if (ctrlInputSource)
{
  ctrlInputSource.addEventListener('change', () =>
  {
    applyInputSource(ctrlInputSource.value);
  });
}

if (ctrlPauseClear)
{
  ctrlPauseClear.addEventListener('change', () =>
  {
    localStorage.setItem('bafx-ctrlPauseClear', String(ctrlPauseClear.checked));
  });
}

if (ctrlPaused)
{
  ctrlPaused.addEventListener('change', () =>
  {
    manualPointerId = null;
    effect.setPaused(ctrlPaused.checked,
      {
        clear: ctrlPauseClear?.checked === true,
      });
    updateHostApiStatus();
  });
}

window.addEventListener('pointerdown', (event) =>
{
  if (!isManualInput() || !acceptManualPointerDown(event))
  {
    return;
  }

  const input = toManualPointerInput(event);

  if (effect.pointerDown(input))
  {
    manualPointerId = input.pointerId;
  }
});

window.addEventListener('pointermove', (event) =>
{
  if (
    !isManualInput() ||
    (manualPointerId === null && !acceptDemoPointer(event))
  )
  {
    return;
  }

  const input = toManualPointerInput(event);

  if (effect.pointerMove(input) && manualPointerId === null)
  {
    // trailAlways 没有 pointerDown，首个有效移动样本建立逻辑悬停指针。
    manualPointerId = input.pointerId;
  }
});

window.addEventListener('pointerup', (event) =>
{
  if (!isManualInput())
  {
    return;
  }

  const pointerId = event.pointerId ?? 1;

  if (effect.pointerUp(pointerId) && pointerId === manualPointerId)
  {
    manualPointerId = null;
  }
});

window.addEventListener('pointercancel', (event) =>
{
  if (!isManualInput())
  {
    return;
  }

  const pointerId = event.pointerId ?? 1;

  if (effect.pointerCancel(pointerId) && pointerId === manualPointerId)
  {
    manualPointerId = null;
  }
});

window.addEventListener('blur', () =>
{
  // 引擎会同步取消活动指针；适配层也丢弃自己的镜像状态。
  manualPointerId = null;
});

// ── 渲染模式 → renderingMode + bloomBackend ──────────────────────────
const ctrlRenderMode = document.getElementById('ctrlRenderMode');
const DEFAULT_RENDER_MODE = 'webgl2-bloom';
const RENDER_MODE_CONFIGS = Object.freeze(
  {
    'full-webgl2':
    {
      effectBackend: 'webgl2',
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
    },
    'software-bloom':
    {
      effectBackend: 'canvas2d',
      renderingMode: 'enhanced',
      bloomBackend: 'software',
    },
    'webgl2-bloom':
    {
      effectBackend: 'canvas2d',
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
    },
    'native-bloom':
    {
      effectBackend: 'canvas2d',
      renderingMode: 'enhanced',
      bloomBackend: 'native',
    },
    legacy:
    {
      effectBackend: 'canvas2d',
      renderingMode: 'legacy',
    },
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
    canvas2d: d.renderCanvas2D,
    auto: d.renderAutoBloom,
    software: d.renderSoftwareBloom,
    webgl2: d.renderWebGL2Bloom,
    native: d.renderNativeBloom,
    legacy: d.renderLegacy,
  };
  const useEffectBackend = snapshot.renderingMode !== 'legacy' &&
    snapshot.effectBackend !== 'canvas2d';
  const resolved = useEffectBackend
    ? snapshot.resolvedEffectBackend
    : snapshot.resolvedBloomBackend;
  const expected = useEffectBackend
    ? snapshot.effectBackend
    : snapshot.renderingMode === 'legacy'
      ? 'legacy'
      : snapshot.bloomBackend;
  const webGL2Label = useEffectBackend
    ? d.renderFullWebGL2
    : d.renderWebGL2Bloom;

  backendLabels.webgl2 = webGL2Label;
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
  const config = RENDER_MODE_CONFIGS[mode] ||
    RENDER_MODE_CONFIGS[DEFAULT_RENDER_MODE];

  effect.updateConfig(config);
  updateRenderBackendStatus();
  // 事件负责持续同步运行时变化；RAF 兼容不支持 CustomEvent 的旧环境。
  requestAnimationFrame(updateRenderBackendStatus);
}

effect.canvas.addEventListener(
  BLOOM_BACKEND_CHANGE_EVENT,
  updateRenderBackendStatus,
);
effect.canvas.addEventListener(
  EFFECT_BACKEND_CHANGE_EVENT,
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
bindRange('ctrlBloomDiffusion', 'outBloomDiffusion', (v) =>
  effect.setFxParam('bloom.diffusion', v));
bindRange('ctrlClickGlow', 'outClickGlow', (v) =>
  effect.setFxParam('bloom.clickEmissionScale', v));
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
function formatRingDirection(value, lang = currentLang)
{
  if (lang === 'en')
  {
    return value < 0 ? 'Counterclockwise' : 'Clockwise';
  }

  return value < 0 ? '逆时针' : '顺时针';
}

bindRange('ctrlRingCount', 'outRingCount', (v) => effect.setFxParam('rings.count', v), true);
bindRange('ctrlDiskRadius', 'outDiskRadius', (v) => effect.setFxParam('disk.radius', v));
bindRange('ctrlDiskLife', 'outDiskLife', (v) => effect.setFxParam('disk.lifetimeMs', v), true);
bindRange('ctrlAngVelMul', 'outAngVelMul', (v) => effect.setFxParam('rings.angularVelocityMultiplier', v));
bindRange('ctrlArcSamples', 'outArcSamples', (v) => effect.setFxParam('rings.arcSamples', v), true);
bindRange('ctrlRingDir', 'outRingDir', (v) =>
{
  effect.setFxParam('rings.rotationDirection', Math.round(v));
  const out = document.getElementById('outRingDir');

  if (out)
  {
    out.textContent = formatRingDirection(v);
  }
});
bindRange('ctrlClickShardLifeMin', 'outClickShardLifeMin', (v) => effect.setFxParam('shards.clickLifetimeMinMs', v), true);
bindRange('ctrlClickShardLifeMax', 'outClickShardLifeMax', (v) => effect.setFxParam('shards.clickLifetimeMaxMs', v), true);

// ── Hit / Flare ────────────────────────────────────────────────────────
bindToggle('ctrlHitEnabled', (c) => effect.setFxParam('hit.enabled', c));
bindRange('ctrlHitRadius', 'outHitRadius', (v) => effect.setFxParam('hit.radius', v));
bindRange('ctrlHitLife', 'outHitLife', (v) => effect.setFxParam('hit.lifetimeMs', v), true);
bindToggle('ctrlFlareEnabled', (c) => effect.setFxParam('flare.enabled', c));
bindRange('ctrlFlareRadius', 'outFlareRadius', (v) => effect.setFxParam('flare.radius', v));
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
  // HTML 默认值不会触发 input；显式应用可让持久化恢复共用同一入口。
  effect.setThemeColor(ctrlColor.value);
}

// ── 重置 ────────────────────────────────────────────────────────────────
document.getElementById('btnReset').addEventListener('click', () =>
{
  document.getElementById('ctrlScale').value = '1';
  document.getElementById('outScale').textContent = '1.00';
  document.getElementById('ctrlOpacity').value = '1';
  document.getElementById('outOpacity').textContent = '1.00';
  document.getElementById('ctrlDpr').value = '2';
  document.getElementById('outDpr').textContent = '2.00';
  document.getElementById('ctrlRenderMode').value = DEFAULT_RENDER_MODE;
  document.getElementById('ctrlInputSource').value = 'dom';
  document.getElementById('ctrlClickTimeScale').value = '1';
  document.getElementById('outClickTimeScale').textContent = '1.00';
  document.getElementById('ctrlTrailTimeScale').value = '1';
  document.getElementById('outTrailTimeScale').textContent = '1.00';
  document.getElementById('ctrlPaused').checked = false;
  document.getElementById('ctrlPauseClear').checked = false;
  document.getElementById('ctrlIsolatedCompositing').checked = false;
  document.getElementById('ctrlClick').checked = true;
  document.getElementById('ctrlTrail').checked = true;
  document.getElementById('ctrlTrailAlways').checked = false;
  document.getElementById('ctrlHitEnabled').checked = false;
  document.getElementById('ctrlFlareEnabled').checked = false;
  document.getElementById('ctrlColor').value = '#4ca7ff';
  effect.setThemeColor('#4ca7ff');

  // 重置特效参数
  const fxDefaults = [
    ['ctrlRingHdr', 'outRingHdr', 5.992157, false],
    ['ctrlRingRadMin', 'outRingRadMin', 68.92571232, false],
    ['ctrlRingRadMax', 'outRingRadMax', 80.41333104, false],
    ['ctrlRingWStart', 'outRingWStart', 1, false],
    ['ctrlRingWEnd', 'outRingWEnd', 1, false],
    ['ctrlRingLife', 'outRingLife', 600, true],
    ['ctrlClickShards', 'outClickShards', 4, true],
    ['ctrlMaxShards', 'outMaxShards', 96, true],
    ['ctrlBloomRing', 'outBloomRing', 80, false],
    ['ctrlBloomThreshold', 'outBloomThreshold', 1, false],
    ['ctrlBloomIntensity', 'outBloomIntensity', 1.7, false],
    ['ctrlBloomDiffusion', 'outBloomDiffusion', 7, false],
    ['ctrlClickGlow', 'outClickGlow', 1, false],
    ['ctrlTrailW', 'outTrailW', 2.7, false],
    ['ctrlTrailGlowW', 'outTrailGlowW', 9, false],
    ['ctrlTrailLife', 'outTrailLife', 300, true],
    ['ctrlShardSpacing', 'outShardSpacing', 108, true],
    ['ctrlBloomTrail', 'outBloomTrail', 1, false],
    ['ctrlTrailOpacity', 'outTrailOpacity', 1, false],
    // 新暴露参数
    ['ctrlRingCount', 'outRingCount', 2, true],
    ['ctrlDiskRadius', 'outDiskRadius', 64.8, false],
    ['ctrlDiskLife', 'outDiskLife', 200, true],
    ['ctrlAngVelMul', 'outAngVelMul', 11.17, false],
    ['ctrlArcSamples', 'outArcSamples', 96, true],
    ['ctrlRingDir', 'outRingDir', -1, true],
    ['ctrlClickShardLifeMin', 'outClickShardLifeMin', 600, true],
    ['ctrlClickShardLifeMax', 'outClickShardLifeMax', 700, true],
    ['ctrlHitRadius', 'outHitRadius', 24, false],
    ['ctrlHitLife', 'outHitLife', 80, true],
    ['ctrlFlareRadius', 'outFlareRadius', 36, false],
    ['ctrlFlareLife', 'outFlareLife', 150, true],
    ['ctrlFlareRays', 'outFlareRays', 6, true],
    ['ctrlGeomWidth', 'outGeomWidth', 2.7, false],
    ['ctrlMinVertDist', 'outMinVertDist', 5.4, false],
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
  document.getElementById('outRingDir').textContent =
    formatRingDirection(-1);

  effect.resetFxConfig();
  effect.setPaused(false);
  applyInputSource('dom', false);

  effect.updateConfig(
    {
      clickTimeScale: 1,
      trailTimeScale: 1,
      scale: 1,
      opacity: 1,
      clickEnabled: true,
      trailEnabled: true,
      trailAlways: false,
      ...RENDER_MODE_CONFIGS[DEFAULT_RENDER_MODE],
      isolatedCompositing: false,
      lightBackgroundContrastAlpha: 0,
      maxDpr: 2,
    },
  );
  manualPointerId = null;
  updateHostApiStatus();
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
      selectTheme('custom');
    }
    else
    {
      applyTheme(theme);
      localStorage.setItem('bafx-theme', theme);
    }
  });
});

document.getElementById('btnApplyBg').addEventListener('click', () =>
{
  const value = document.getElementById('ctrlCustomBg').value.trim();

  applyCustomBackground(value);
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
    labelIsolatedCompositing: '隔离合成',
    hostApiSummary: '宿主控制 API',
    labelInputSource: '输入来源',
    inputSourceDom: 'DOM 自动监听',
    inputSourceManual: '手动注入',
    labelClickTimeScale: '点击速度',
    labelTrailTimeScale: '拖尾速度',
    labelPaused: '暂停输入与动画',
    labelPauseClear: '暂停时清屏',
    hostApiDom: 'DOM 模式：库自动监听 window 指针事件。',
    hostApiManual: '手动模式：展示页通过公开 pointer API 注入输入。',
    hostApiPaused: '已暂停：输入和 RAF 已停止。',
    renderCanvas2D: 'Canvas 2D',
    renderFullWebGL2: '纯 WebGL2（实验）',
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
    labelBloomRing: '原生圆环模糊',
    labelBloomThreshold: 'Bloom 阈值',
    labelBloomIntensity: 'Bloom 强度',
    labelBloomDiffusion: 'Bloom 扩散',
    labelClickGlow: '点击辉光强度',
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
    labelClickShardLifeMin: '点击碎片最短寿命',
    labelClickShardLifeMax: '点击碎片最长寿命',
    labelGeomWidth: '几何带宽',
    labelMinVertDist: '最小采样间距',
    labelTrailShardLifeMin: '拖尾碎片最短寿命',
    labelTrailShardLifeMax: '拖尾碎片最长寿命',
    labelBloomDisk: '原生光盘模糊',
    btnReset: '重置默认',
    customBgLabel: '自定义背景',
    customBgPlaceholder: 'CSS background 值或图片 URL…',
    btnApplyBg: '应用背景',
    introTitle: 'ba-click-fx',
    introP1: 'Blue Archive / 蔚蓝档案风格网页点击特效与鼠标拖尾。点击、拖动或移动鼠标预览效果。',
    introP2: '从 Unity FX_Touch.prefab 逐参数移植的 Canvas 2D 特效库，默认使用 WebGL2 Bloom——溶解圆环、点击碎片、拖尾轨迹。零外部运行时依赖。',
    introInstallSummary: '安装方式 / Installation',
    introInstallContent: '<p><strong>npm</strong></p><pre><code>npm install ba-click-fx</code></pre><p><strong>CDN</strong></p><pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.13/dist/ba-click-fx.iife.js"&gt;&lt;/script&gt;</code></pre>',
    introFAQSummary: '常见问题 / FAQ',
    introFAQContent: '<p><strong>和蔚蓝档案有关吗？</strong> 粉丝向视觉特效库，粒子参数从游戏 Unity Prefab 逐项提取。</p><p><strong>需要素材或 WebGL？</strong> 不需要图片素材；默认使用 WebGL2 Bloom，能力不足时自动回退软件 Bloom，零运行时依赖。</p><p><strong>纯白背景下特效颜色太浅？</strong> 纯白背景会让默认的直接加色丢失蓝青色和对比度，请开启“隔离合成”（<code>isolatedCompositing: true</code>）。需要更清晰的轮廓时，可再设置 <code>lightBackgroundContrastAlpha: 0.35</code>；这两项是网页兼容选项，不是游戏默认路径。</p><p><strong>能用在博客或个人主页吗？</strong> 可以，支持 npm、CDN 和 script 引入。</p>',
    introHostApiSummary: '宿主控制 API / Host Control API',
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
    labelIsolatedCompositing: 'Isolated Compositing',
    hostApiSummary: 'Host Control API',
    labelInputSource: 'Input Source',
    inputSourceDom: 'DOM Listeners',
    inputSourceManual: 'Manual Injection',
    labelClickTimeScale: 'Click Speed',
    labelTrailTimeScale: 'Trail Speed',
    labelPaused: 'Pause Input & Animation',
    labelPauseClear: 'Clear When Paused',
    hostApiDom: 'DOM mode: the library listens for window pointer events.',
    hostApiManual: 'Manual mode: the demo injects input through the public pointer API.',
    hostApiPaused: 'Paused: input and RAF scheduling are stopped.',
    renderCanvas2D: 'Canvas 2D',
    renderFullWebGL2: 'Full WebGL2 (Experimental)',
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
    labelBloomRing: 'Native Ring Blur',
    labelBloomThreshold: 'Bloom Threshold',
    labelBloomIntensity: 'Bloom Intensity',
    labelBloomDiffusion: 'Bloom Diffusion',
    labelClickGlow: 'Click Glow Strength',
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
    labelArcSamples: 'Arc Samples',
    labelRingDir: 'Rotation Direction',
    labelClickShardLifeMin: 'Click Shard Life Min',
    labelClickShardLifeMax: 'Click Shard Life Max',
    labelGeomWidth: 'Geometry Width',
    labelMinVertDist: 'Min Vertex Distance',
    labelTrailShardLifeMin: 'Trail Shard Life Min',
    labelTrailShardLifeMax: 'Trail Shard Life Max',
    labelBloomDisk: 'Native Disk Blur',
    btnReset: 'Reset Defaults',
    customBgLabel: 'Custom Background',
    customBgPlaceholder: 'CSS background or image URL…',
    btnApplyBg: 'Apply',
    introTitle: 'ba-click-fx',
    introP1: 'Blue Archive style mouse click effect and cursor trail for web. Click, drag, or move your mouse to preview.',
    introP2: 'Canvas 2D effect library ported from Unity FX_Touch.prefab, using WebGL2 Bloom by default — dissolve rings, click shards, drag trails. Zero runtime dependencies.',
    introInstallSummary: '安装方式 / Installation',
    introInstallContent: '<p><strong>npm</strong></p><pre><code>npm install ba-click-fx</code></pre><p><strong>CDN</strong></p><pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.13/dist/ba-click-fx.iife.js"&gt;&lt;/script&gt;</code></pre>',
    introFAQSummary: '常见问题 / FAQ',
    introFAQContent: '<p><strong>Is it related to Blue Archive?</strong> A fan-made VFX library with parameters extracted from the game Unity Prefab.</p><p><strong>Needs assets or WebGL?</strong> No image assets. WebGL2 Bloom is the default and falls back to Software Bloom when unavailable. Zero runtime dependencies.</p><p><strong>Effects look washed out on a pure white background?</strong> Direct additive compositing loses cyan-blue color and contrast on pure white. Enable Isolated Compositing (<code>isolatedCompositing: true</code>). For a sharper outline, you can also set <code>lightBackgroundContrastAlpha: 0.35</code>; both are web compatibility options, not the game-default path.</p><p><strong>Can I use it on my blog?</strong> Yes — npm, CDN, and direct script tag are all supported.</p>',
    introHostApiSummary: 'Host Control API / 宿主控制 API',
  },
};

function switchLanguage(lang)
{
  currentLang = lang;
  localStorage.setItem('bafx-lang', lang);

  const d = I18N[lang] || I18N.zh;
  const ringDirection = document.getElementById('ctrlRingDir');
  const ringDirectionOutput = document.getElementById('outRingDir');

  if (ringDirection && ringDirectionOutput)
  {
    ringDirectionOutput.textContent = formatRingDirection(
      Number(ringDirection.value),
      lang,
    );
  }

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
    ctrlIsolatedCompositing: d.labelIsolatedCompositing,
    ctrlInputSource: d.labelInputSource,
    ctrlClickTimeScale: d.labelClickTimeScale,
    ctrlTrailTimeScale: d.labelTrailTimeScale,
    ctrlPaused: d.labelPaused,
    ctrlPauseClear: d.labelPauseClear,
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
    ctrlBloomDiffusion: d.labelBloomDiffusion,
    ctrlClickGlow: d.labelClickGlow,
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
    'full-webgl2': d.renderFullWebGL2,
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

  const inputSourceOptions = {
    dom: d.inputSourceDom,
    manual: d.inputSourceManual,
  };

  document.querySelectorAll('#ctrlInputSource option').forEach((option) =>
  {
    if (inputSourceOptions[option.value])
    {
      option.textContent = inputSourceOptions[option.value];
    }
  });

  // 按钮
  document.getElementById('hostApiSummary').textContent = d.hostApiSummary;
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
  document.getElementById('introHostApiSummary').textContent = d.introHostApiSummary;
  updateRenderBackendStatus();
  updateHostApiStatus();
}

document.getElementById('langToggle').addEventListener('click', () =>
{
  switchLanguage(currentLang === 'zh' ? 'en' : 'zh');
});

switchLanguage(currentLang);

// ── 恢复持久化设置 ──────────────────────────────────────────────────────
(function restoreSettings()
{
  const savedInputSource = localStorage.getItem('bafx-ctrlInputSource');

  applyInputSource(savedInputSource === 'manual' ? 'manual' : 'dom', false);

  for (const controlId of ['ctrlClickTimeScale', 'ctrlTrailTimeScale'])
  {
    const savedValue = localStorage.getItem('bafx-' + controlId);
    const control = document.getElementById(controlId);

    if (savedValue && control)
    {
      // 复用滑块处理器，避免恢复路径与即时更新产生不同的校验和显示行为。
      control.value = savedValue;
      control.dispatchEvent(new Event('input'));
    }
  }

  if (ctrlPauseClear && localStorage.getItem('bafx-ctrlPauseClear') === 'true')
  {
    ctrlPauseClear.checked = true;
  }

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
    // 复用即时输入路径，确保显示值、持久化值和实际配置保持同一精度。
    dprEl.dispatchEvent(new Event('input'));
    dprEl.dispatchEvent(new Event('change'));
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
    : DEFAULT_RENDER_MODE;
  const renderModeEl = document.getElementById('ctrlRenderMode');

  if (renderModeEl)
  {
    renderModeEl.value = initialRenderMode;
  }

  // 默认值也走同一条路径，确保首次打开即可显示能力探测后的实际后端。
  applyRenderMode(initialRenderMode);

  const isolatedCompositingEl = document.getElementById('ctrlIsolatedCompositing');
  const savedIsolatedCompositing = localStorage.getItem('bafx-ctrlIsolatedCompositing');

  if (isolatedCompositingEl && savedIsolatedCompositing !== null)
  {
    const isolated = savedIsolatedCompositing === 'true';

    isolatedCompositingEl.checked = isolated;
    effect.updateConfig({ isolatedCompositing: isolated });
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
    ['ctrlBloomDiffusion', 'bloom.diffusion'],
    ['ctrlClickGlow', 'bloom.clickEmissionScale'],
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
  const customBg = localStorage.getItem('bafx-custom-bg');
  const customBgInput = document.getElementById('ctrlCustomBg');

  if (customBg && customBgInput)
  {
    customBgInput.value = customBg;
  }

  if (theme === 'custom' || (!theme && customBg))
  {
    if (!customBg || !applyCustomBackground(customBg, false))
    {
      applyTheme('蔚蓝');
    }
  }
  else if (theme && THEMES[theme])
  {
    applyTheme(theme);
  }
})();

// 页面销毁时清理
window.addEventListener('beforeunload', () =>
{
  effect.destroy();
});
