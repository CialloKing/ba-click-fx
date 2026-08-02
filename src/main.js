import './style.css';
import {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  CONFIG,
  EFFECT_BACKEND_CHANGE_EVENT,
} from './fx.js';
import {
  getThemeBackgroundCss,
  renderThemeSceneBackground,
} from './theme-background.js';
import { resolveHdrPresentationState } from './hdr-presentation-status.js';
import { snapRangeValue } from './range-snap.js';

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
const PURE_WHITE_THEME = '纯白';
const PURE_WHITE_ISOLATED_CONTRAST_ALPHA = 0.35;
const DEFAULT_COMPOSITING_REFERENCE_MODE = 'match-page';
const COMPOSITING_REFERENCE_MODES = new Set([
  'match-page',
  'unknown',
]);
let pageBackgroundRequestId = 0;
let themeReferenceCanvas = null;
let activeThemeReference = null;
let themeReferenceResizeFrame = 0;
let customBackgroundObjectUrl = null;
let pageBackgroundRasterSource = null;
let compositingReferenceMode = DEFAULT_COMPOSITING_REFERENCE_MODE;

function revokeCustomBackgroundObjectUrl(except = null)
{
  if (
    !customBackgroundObjectUrl ||
    customBackgroundObjectUrl === except
  )
  {
    return;
  }

  // Blob URL 只在当前页面持有的文件会话中有效；离开背景后立即归还内存。
  URL.revokeObjectURL(customBackgroundObjectUrl);
  customBackgroundObjectUrl = null;
}

function stopThemeReferenceSync()
{
  activeThemeReference = null;

  if (themeReferenceResizeFrame !== 0)
  {
    window.cancelAnimationFrame(themeReferenceResizeFrame);
    themeReferenceResizeFrame = 0;
  }
}

function hasMatchedCompositingReference()
{
  return compositingReferenceMode === 'match-page' &&
    pageBackgroundRasterSource !== null &&
    effect.compositingReferenceSource === pageBackgroundRasterSource;
}

function updateCompositingReferenceStatus()
{
  const status = document.getElementById('compositingReferenceStatus');

  if (!status)
  {
    return;
  }

  const d = I18N[currentLang] || I18N.zh;

  if (compositingReferenceMode === 'unknown')
  {
    status.textContent = d.compositingReferenceUnknownStatus;
    return;
  }

  status.textContent = hasMatchedCompositingReference()
    ? d.compositingReferenceMatchedStatus
    : d.compositingReferenceUnavailableStatus;
}

function syncCompositingReference()
{
  const source = compositingReferenceMode === 'match-page'
    ? pageBackgroundRasterSource
    : null;
  const applied = effect.setCompositingReference(source, { fit: 'cover' });

  // 页面主题仍由 CSS 管理；只有参考真的与它匹配时才移除未参与合成的装饰网格。
  document.body.classList.toggle(
    'compositing-reference-matched',
    hasMatchedCompositingReference(),
  );
  updateCompositingReferenceStatus();
  return applied;
}

function updateThemeCompositingReference()
{
  if (!activeThemeReference)
  {
    return false;
  }

  if (!themeReferenceCanvas)
  {
    themeReferenceCanvas = document.createElement('canvas');
  }

  const width = Math.max(1, window.innerWidth || 1);
  const height = Math.max(1, window.innerHeight || 1);
  const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  const rendered = renderThemeSceneBackground(
    themeReferenceCanvas,
    activeThemeReference,
    width,
    height,
    pixelRatio,
  );

  if (!rendered)
  {
    pageBackgroundRasterSource = null;
    syncCompositingReference();
    return false;
  }

  pageBackgroundRasterSource = themeReferenceCanvas;
  return syncCompositingReference();
}

function applyThemeCompositingReference(name)
{
  pageBackgroundRequestId++;
  activeThemeReference = name;

  // 主题换图必须先撤销旧参考，避免上传失败时继续按上一主题的像素合成。
  themeReferenceCanvas = null;
  pageBackgroundRasterSource = null;
  syncCompositingReference();
  return updateThemeCompositingReference();
}

function scheduleThemeReferenceSync()
{
  if (!activeThemeReference || themeReferenceResizeFrame !== 0)
  {
    return;
  }

  themeReferenceResizeFrame = window.requestAnimationFrame(() =>
  {
    themeReferenceResizeFrame = 0;
    updateThemeCompositingReference();
  });
}

window.addEventListener('resize', scheduleThemeReferenceSync);

function applyPageCompositingReferenceImage(url)
{
  const requestId = ++pageBackgroundRequestId;

  // 背景切换期间不能继续用旧参考求差值，否则首个加载帧会使用不匹配的页面。
  stopThemeReferenceSync();
  pageBackgroundRasterSource = null;
  syncCompositingReference();

  if (!url)
  {
    return;
  }

  const image = new Image();

  if (url.protocol === 'http:' || url.protocol === 'https:')
  {
    image.crossOrigin = 'anonymous';
  }

  image.decoding = 'async';
  image.addEventListener('load', () =>
  {
    if (
      requestId !== pageBackgroundRequestId ||
      image.naturalWidth <= 0 ||
      image.naturalHeight <= 0
    )
    {
      return;
    }

    pageBackgroundRasterSource = image;
    syncCompositingReference();
  }, { once: true });
  image.addEventListener('error', () =>
  {
    if (requestId === pageBackgroundRequestId)
    {
      // CSS 页面背景仍可显示；无 CORS 时明确停留在未知背景兼容模式。
      pageBackgroundRasterSource = null;
      syncCompositingReference();
    }
  }, { once: true });
  image.src = url.href;
}

function setCustomBackgroundControlsVisible(visible)
{
  for (const id of [
    'customBgCtrl',
    'ctrlCustomBg',
    'customBgFileCtrl',
    'ctrlCustomBgFile',
    'btnApplyBg',
  ])
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

function resolvePureWhiteContrastAlpha(isolatedCompositing)
{
  // 库无法读取任意宿主背景；展示页只为已知的内置纯白主题自动补足轮廓。
  return isolatedCompositing === true &&
    document.body.classList.contains('theme-pure-white')
    ? PURE_WHITE_ISOLATED_CONTRAST_ALPHA
    : 0;
}

function syncPureWhiteIsolationContrast()
{
  effect.updateConfig(
    {
      lightBackgroundContrastAlpha: resolvePureWhiteContrastAlpha(
        effect.getConfig().isolatedCompositing,
      ),
    },
  );
}

function applyIsolatedCompositing(checked)
{
  effect.updateConfig(
    {
      isolatedCompositing: checked,
      lightBackgroundContrastAlpha: resolvePureWhiteContrastAlpha(checked),
    },
  );
}

function applyTheme(name)
{
  if (name === 'custom')
  {
    selectTheme(name);
    return true;
  }

  const bg = getThemeBackgroundCss(name);

  if (!bg)
  {
    return false;
  }

  revokeCustomBackgroundObjectUrl();
  document.body.style.background = bg;
  document.body.style.backgroundAttachment = 'fixed';
  document.body.classList.toggle('theme-pure-white', name === PURE_WHITE_THEME);
  syncPureWhiteIsolationContrast();
  applyThemeCompositingReference(name);
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

function resolveCompositingReferenceUrl(value)
{
  const trimmed = value.trim();

  if (!trimmed || CSS.supports('background', trimmed))
  {
    // 通用 CSS、渐变和多图层不能可靠还原为一张宿主场景纹理。
    return null;
  }

  try
  {
    const url = new URL(trimmed, document.baseURI);

    if (
      url.protocol !== 'http:' &&
      url.protocol !== 'https:' &&
      url.protocol !== 'data:' &&
      url.protocol !== 'blob:' &&
      url.protocol !== 'file:'
    )
    {
      return null;
    }

    // file: 不会提升网页的本地文件权限。只有同时允许本地读取和
    // Canvas/WebGL 纹理上传的受信任桌面宿主才能使用；普通 HTTP(S) 页面
    // 被浏览器拦截时仍可使用文件选择器。

    return url;
  }
  catch
  {
    return null;
  }
}

function containsBlobUrl(value)
{
  const trimmed = value.trim();

  return trimmed.startsWith('blob:') ||
    /url\(\s*["']?blob:/i.test(trimmed);
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
  document.body.classList.remove('theme-pure-white');
  syncPureWhiteIsolationContrast();
  applyPageCompositingReferenceImage(resolveCompositingReferenceUrl(rawValue));
  revokeCustomBackgroundObjectUrl(rawValue);

  if (input)
  {
    input.value = rawValue;
  }

  selectTheme('custom');

  if (persist)
  {
    localStorage.setItem('bafx-theme', 'custom');

    if (containsBlobUrl(rawValue))
    {
      // 刷新后的新文档无法可靠复用旧 blob: URL，不能把失效地址恢复成背景。
      localStorage.removeItem('bafx-custom-bg');
    }
    else
    {
      localStorage.setItem('bafx-custom-bg', rawValue);
    }
  }

  return true;
}

function applyCustomBackgroundFile(file)
{
  if (!file || (file.type && !file.type.startsWith('image/')))
  {
    return false;
  }

  const objectUrl = URL.createObjectURL(file);

  if (!applyCustomBackground(objectUrl, false))
  {
    URL.revokeObjectURL(objectUrl);
    return false;
  }

  customBackgroundObjectUrl = objectUrl;
  localStorage.setItem('bafx-theme', 'custom');
  // File 对象和 blob: URL 都不能跨刷新持久化；仅保留当前会话的显示状态。
  localStorage.removeItem('bafx-custom-bg');
  return true;
}

// ── 控件绑定 ────────────────────────────────────────────────────────────
function bindRange(
  id,
  outId,
  onChange,
  intOnly = false,
  applyEvent = 'input',
  pointerSnapValue = null,
)
{
  const el = document.getElementById(id);
  const out = document.getElementById(outId);

  if (!el || !out)
  {
    return;
  }

  let isPointerAdjustment = false;

  if (pointerSnapValue !== null)
  {
    const endPointerAdjustment = () =>
    {
      isPointerAdjustment = false;
    };

    el.addEventListener('pointerdown', () =>
    {
      isPointerAdjustment = true;
    });
    el.addEventListener('pointerup', endPointerAdjustment);
    el.addEventListener('pointercancel', endPointerAdjustment);
    el.addEventListener('lostpointercapture', endPointerAdjustment);
    el.addEventListener('change', endPointerAdjustment);
  }

  el.addEventListener('input', () =>
  {
    const rawValue = parseFloat(el.value);
    // 399 个 0.01 档位无法全部映射到窄侧栏的物理像素；只在拖动时
    // 吸附默认速度一格，键盘、恢复设置和公开 API 仍保留完整精度。
    const value = isPointerAdjustment
      ? snapRangeValue(rawValue, pointerSnapValue, parseFloat(el.step))
      : rawValue;

    if (value !== rawValue)
    {
      el.value = String(value);
    }

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

bindToggle('ctrlIsolatedCompositing', applyIsolatedCompositing);

const ctrlCompositingReference =
  document.getElementById('ctrlCompositingReference');

function applyCompositingReferenceMode(mode)
{
  const resolved = COMPOSITING_REFERENCE_MODES.has(mode)
    ? mode
    : DEFAULT_COMPOSITING_REFERENCE_MODE;

  compositingReferenceMode = resolved;

  if (ctrlCompositingReference)
  {
    ctrlCompositingReference.value = resolved;
  }

  syncCompositingReference();
  return resolved;
}

if (ctrlCompositingReference)
{
  ctrlCompositingReference.addEventListener('change', () =>
  {
    const resolved = applyCompositingReferenceMode(
      ctrlCompositingReference.value,
    );

    localStorage.setItem('bafx-ctrlCompositingReference', resolved);
  });
}

bindToggle('ctrlClick', (checked) => effect.updateConfig({ clickEnabled: checked }));
bindToggle('ctrlTrail', (checked) => effect.updateConfig({ trailEnabled: checked }));
bindToggle('ctrlTrailAlways', (checked) => effect.updateConfig({ trailAlways: checked }));
bindRange('ctrlClickTimeScale', 'outClickTimeScale', (value) =>
  effect.updateConfig({ clickTimeScale: value }), false, 'input', 1);
bindRange('ctrlTrailTimeScale', 'outTrailTimeScale', (value) =>
  effect.updateConfig({ trailTimeScale: value }), false, 'input', 1);

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

// ── 渲染模式 → effectBackend + renderingMode + bloomBackend ─────────
const ctrlRenderMode = document.getElementById('ctrlRenderMode');
const DEFAULT_RENDER_MODE = 'full-webgl2';
const dynamicRangeQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(dynamic-range: high)')
  : null;
const RENDER_MODE_CONFIGS = Object.freeze(
  {
    'full-webgpu':
    {
      effectBackend: 'webgpu',
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
    },
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
const HDR_PRESENTATION_PRESETS = Object.freeze(
  {
    balanced:
    {
      webgpuHdrPeak: CONFIG.webgpuHdrPeak,
      webgpuHdrWhiteCore: CONFIG.webgpuHdrWhiteCore,
      webgpuHdrWhiteStart: CONFIG.webgpuHdrWhiteStart,
      webgpuHdrWhiteEnd: CONFIG.webgpuHdrWhiteEnd,
    },
    bright:
    {
      webgpuHdrPeak: 3.5,
      webgpuHdrWhiteCore: 0.8,
      webgpuHdrWhiteStart: 0.75,
      webgpuHdrWhiteEnd: 4,
    },
    color:
    {
      webgpuHdrPeak: 3,
      webgpuHdrWhiteCore: 0,
      webgpuHdrWhiteStart: 1,
      webgpuHdrWhiteEnd: 5,
    },
  },
);
const HDR_PRESENTATION_CONTROLS = Object.freeze(
  [
    ['ctrlWebGPUHdrPeak', 'outWebGPUHdrPeak', 'webgpuHdrPeak'],
    [
      'ctrlWebGPUHdrWhiteCore',
      'outWebGPUHdrWhiteCore',
      'webgpuHdrWhiteCore',
    ],
    [
      'ctrlWebGPUHdrWhiteStart',
      'outWebGPUHdrWhiteStart',
      'webgpuHdrWhiteStart',
    ],
    [
      'ctrlWebGPUHdrWhiteEnd',
      'outWebGPUHdrWhiteEnd',
      'webgpuHdrWhiteEnd',
    ],
  ],
);

function findHdrPresentationPreset(snapshot)
{
  for (const [name, preset] of Object.entries(HDR_PRESENTATION_PRESETS))
  {
    if (Object.entries(preset).every(([key, value]) =>
      Math.abs(snapshot[key] - value) <= 0.000001))
    {
      return name;
    }
  }

  return 'custom';
}

function persistHdrPresentation(snapshot)
{
  for (const [controlId, , configKey] of HDR_PRESENTATION_CONTROLS)
  {
    localStorage.setItem('bafx-' + controlId, String(snapshot[configKey]));
  }

  localStorage.setItem(
    'bafx-ctrlHdrPresentationPreset',
    findHdrPresentationPreset(snapshot),
  );
}

function syncHdrPresentationControls(snapshot = effect.getConfig())
{
  const container = document.getElementById('hdrPresentationControls');
  const presetControl = document.getElementById(
    'ctrlHdrPresentationPreset',
  );
  const active = snapshot.resolvedEffectBackend === 'webgpu' &&
    snapshot.resolvedWebGPUOutputMode === 'extended';

  container?.classList.toggle('is-inactive', !active);
  container?.setAttribute('aria-disabled', String(!active));

  if (presetControl)
  {
    presetControl.disabled = !active;
    presetControl.value = findHdrPresentationPreset(snapshot);
  }

  for (const [controlId, outputId, configKey] of HDR_PRESENTATION_CONTROLS)
  {
    const control = document.getElementById(controlId);
    const output = document.getElementById(outputId);

    if (control)
    {
      control.disabled = !active;
      control.value = String(snapshot[configKey]);
    }

    if (output)
    {
      output.textContent = snapshot[configKey].toFixed(2);
    }
  }
}

function applyHdrPresentation(overrides, persist = true)
{
  effect.updateConfig(overrides);
  const snapshot = effect.getConfig();

  syncHdrPresentationControls(snapshot);

  if (persist)
  {
    persistHdrPresentation(snapshot);
  }
}

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
    webgpu: d.renderFullWebGPU,
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
  const webgpuRequested = expected === 'webgpu' || expected === 'auto';
  const outputMode = snapshot.resolvedWebGPUOutputMode;
  const dynamicRangeHigh = dynamicRangeQuery?.matches ?? null;
  const presentationState = resolveHdrPresentationState(
    {
      webgpuRequested,
      resolvedBackend: resolved,
      outputMode,
      dynamicRangeHigh,
    },
  );
  let backendValue;

  if (resolved === 'pending')
  {
    backendValue = d.renderBackendPending.replace('{requested}', requestedLabel);
  }
  else if (resolved !== expected && expected !== 'auto')
  {
    backendValue = d.renderBackendFallback
      .replace('{resolved}', resolvedLabel)
      .replace('{requested}', requestedLabel);
  }
  else
  {
    backendValue = d.renderBackendActive.replace('{backend}', resolvedLabel);
  }

  let canvasOutputValue = webgpuRequested
    ? d.renderWebGPUOutputPending
    : d.renderWebGPUOutputInactive;

  // 渲染器会被保留供后续复用；未选择 WebGPU 时不能把它缓存的协商结果
  // 当作当前 Canvas 的输出能力展示。
  if (webgpuRequested && outputMode === 'extended')
  {
    canvasOutputValue = d.renderWebGPUOutputExtended;
  }
  else if (webgpuRequested && outputMode === 'standard')
  {
    let standardFormat = d.renderWebGPUPreferredFormat;

    try
    {
      standardFormat = navigator.gpu?.getPreferredCanvasFormat?.() ??
        standardFormat;
    }
    catch
    {
      // 状态展示不能影响已经成功的 SDR 回退。
    }

    canvasOutputValue = d.renderWebGPUOutputStandard.replace(
      '{format}',
      standardFormat,
    );
  }
  else if (presentationState === 'unavailable')
  {
    canvasOutputValue = d.renderWebGPUOutputUnavailable;
  }

  const dynamicRangeValue = dynamicRangeHigh === true
    ? d.renderDynamicRangeHigh
    : dynamicRangeHigh === false
      ? d.renderDynamicRangeStandard
      : d.renderDynamicRangeUnknown;
  const verdictValues = {
    ready: d.renderHdrVerdictReady,
    'display-unconfirmed': d.renderHdrVerdictDisplayUnconfirmed,
    standard: d.renderHdrVerdictStandard,
    pending: d.renderHdrVerdictPending,
    unavailable: d.renderHdrVerdictUnavailable,
    inactive: d.renderHdrVerdictInactive,
  };
  const values = {
    renderBackendValue: backendValue,
    renderCanvasOutputValue: canvasOutputValue,
    renderDynamicRangeValue: dynamicRangeValue,
    renderHdrVerdictValue: verdictValues[presentationState],
  };

  for (const [id, value] of Object.entries(values))
  {
    const element = document.getElementById(id);

    if (element)
    {
      element.textContent = value;
    }
  }

  document.getElementById('renderBackendLabel').textContent =
    d.renderBackendLabel;
  document.getElementById('renderCanvasOutputLabel').textContent =
    d.renderCanvasOutputLabel;
  document.getElementById('renderDynamicRangeLabel').textContent =
    d.renderDynamicRangeLabel;
  document.getElementById('renderHdrVerdictLabel').textContent =
    d.renderHdrVerdictLabel;
  document.getElementById('renderHdrStatusNote').textContent =
    d.renderHdrStatusNote;
  status.dataset.hdrState = presentationState;
  syncHdrPresentationControls(snapshot);
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

if (typeof dynamicRangeQuery?.addEventListener === 'function')
{
  dynamicRangeQuery.addEventListener('change', updateRenderBackendStatus);
}
else if (typeof dynamicRangeQuery?.addListener === 'function')
{
  // 兼容仍只实现旧 MediaQueryList 监听接口的浏览器。
  dynamicRangeQuery.addListener(updateRenderBackendStatus);
}

if (ctrlRenderMode)
{
  ctrlRenderMode.addEventListener('change', () =>
  {
    const mode = ctrlRenderMode.value;

    applyRenderMode(mode);
    localStorage.setItem('bafx-ctrlRenderMode', mode);
  });
}

const ctrlHdrPresentationPreset = document.getElementById(
  'ctrlHdrPresentationPreset',
);

if (ctrlHdrPresentationPreset)
{
  ctrlHdrPresentationPreset.addEventListener('change', () =>
  {
    const preset = HDR_PRESENTATION_PRESETS[ctrlHdrPresentationPreset.value];

    if (preset)
    {
      applyHdrPresentation(preset);
    }
  });
}

for (const [controlId, outputId, configKey] of HDR_PRESENTATION_CONTROLS)
{
  bindRange(controlId, outputId, (value) =>
  {
    applyHdrPresentation({ [configKey]: value });
  });
}

// ── 输出合成 → outputCompositing ───────────────────────────────────────
const ctrlOutputCompositing = document.getElementById('ctrlOutputCompositing');
const transparentCompositingControls = document.getElementById(
  'transparentCompositingControls',
);
const ctrlOverlayAlphaPolicy = document.getElementById(
  'ctrlOverlayAlphaPolicy',
);
const ctrlOverlayColorCompensation = document.getElementById(
  'ctrlOverlayColorCompensation',
);
const ctrlOverlayAlphaLimit = document.getElementById('ctrlOverlayAlphaLimit');
const outOverlayAlphaLimit = document.getElementById('outOverlayAlphaLimit');
const ctrlHostCompositing = document.getElementById('ctrlHostCompositing');
const sourceOverOnlyControls = document.querySelectorAll(
  '.source-over-only-control',
);
const DEFAULT_OUTPUT_COMPOSITING = 'scene';
const DEFAULT_OVERLAY_ALPHA_POLICY = CONFIG.overlayAlphaPolicy;
const DEFAULT_OVERLAY_COLOR_COMPENSATION =
  CONFIG.overlayColorCompensation;
const DEFAULT_OVERLAY_ALPHA_LIMIT = CONFIG.overlayAlphaLimit;
const DEFAULT_HOST_COMPOSITING = CONFIG.hostCompositing;
const OUTPUT_COMPOSITING_MODES = new Set([
  'scene',
  'browser-overlay',
]);
const OVERLAY_ALPHA_POLICIES = new Set([
  'coverage',
  'visual-max',
]);
const OVERLAY_COLOR_COMPENSATIONS = new Set([
  'none',
  'bright-core',
]);
const HOST_COMPOSITING_MODES = new Set([
  'source-over',
  'screen',
]);

function syncTransparentCompositingControlState(
  outputCompositing,
  hostCompositing = ctrlHostCompositing?.value,
)
{
  const enabled = outputCompositing === 'browser-overlay';
  const sourceOverEnabled = enabled && hostCompositing === 'source-over';

  transparentCompositingControls?.classList.toggle('is-inactive', !enabled);
  transparentCompositingControls?.setAttribute(
    'aria-disabled',
    String(!enabled),
  );

  if (ctrlOverlayAlphaPolicy)
  {
    ctrlOverlayAlphaPolicy.disabled = !sourceOverEnabled;
  }

  if (ctrlOverlayColorCompensation)
  {
    ctrlOverlayColorCompensation.disabled = !sourceOverEnabled;
  }

  if (ctrlOverlayAlphaLimit)
  {
    ctrlOverlayAlphaLimit.disabled = !sourceOverEnabled;
  }

  if (ctrlHostCompositing)
  {
    ctrlHostCompositing.disabled = !enabled;
  }

  for (const control of sourceOverOnlyControls)
  {
    control.classList.toggle('is-inactive', !sourceOverEnabled);
    control.setAttribute('aria-disabled', String(!sourceOverEnabled));
  }
}

function applyOverlayAlphaPolicy(policy)
{
  const resolved = OVERLAY_ALPHA_POLICIES.has(policy)
    ? policy
    : DEFAULT_OVERLAY_ALPHA_POLICY;

  if (ctrlOverlayAlphaPolicy)
  {
    ctrlOverlayAlphaPolicy.value = resolved;
  }

  effect.updateConfig({ overlayAlphaPolicy: resolved });
  return resolved;
}

function applyOverlayColorCompensation(compensation)
{
  const resolved = OVERLAY_COLOR_COMPENSATIONS.has(compensation)
    ? compensation
    : DEFAULT_OVERLAY_COLOR_COMPENSATION;

  if (ctrlOverlayColorCompensation)
  {
    ctrlOverlayColorCompensation.value = resolved;
  }

  effect.updateConfig({ overlayColorCompensation: resolved });
  return resolved;
}

function applyOverlayAlphaLimit(value)
{
  const numericValue = Number(value);
  const resolved = Number.isFinite(numericValue)
    ? Math.max(0, Math.min(1, numericValue))
    : DEFAULT_OVERLAY_ALPHA_LIMIT;

  if (ctrlOverlayAlphaLimit)
  {
    ctrlOverlayAlphaLimit.value = String(resolved);
  }

  if (outOverlayAlphaLimit)
  {
    outOverlayAlphaLimit.textContent = resolved.toFixed(2);
  }

  effect.updateConfig({ overlayAlphaLimit: resolved });
  return resolved;
}

function applyHostCompositing(mode)
{
  // 1.2.17 早期展示页曾把 DOM Add 保存为 plus-lighter。亮底修复后将
  // 该展示项迁移到 screen；公共 API 仍保留 plus-lighter 给暗底宿主。
  const migratedMode = mode === 'plus-lighter' ? 'screen' : mode;
  const resolved = HOST_COMPOSITING_MODES.has(migratedMode)
    ? migratedMode
    : DEFAULT_HOST_COMPOSITING;

  if (ctrlHostCompositing)
  {
    ctrlHostCompositing.value = resolved;
  }

  effect.updateConfig({ hostCompositing: resolved });
  syncTransparentCompositingControlState(
    ctrlOutputCompositing?.value,
    resolved,
  );
  return resolved;
}

function applyOutputCompositing(mode)
{
  const resolved = OUTPUT_COMPOSITING_MODES.has(mode)
    ? mode
    : DEFAULT_OUTPUT_COMPOSITING;

  if (ctrlOutputCompositing)
  {
    ctrlOutputCompositing.value = resolved;
  }

  syncTransparentCompositingControlState(
    resolved,
    ctrlHostCompositing?.value,
  );
  effect.updateConfig({ outputCompositing: resolved });
  return resolved;
}

if (ctrlOutputCompositing)
{
  ctrlOutputCompositing.addEventListener('change', () =>
  {
    const resolved = applyOutputCompositing(ctrlOutputCompositing.value);

    localStorage.setItem('bafx-ctrlOutputCompositing', resolved);
  });
}

if (ctrlOverlayAlphaPolicy)
{
  ctrlOverlayAlphaPolicy.addEventListener('change', () =>
  {
    const resolved = applyOverlayAlphaPolicy(
      ctrlOverlayAlphaPolicy.value,
    );

    localStorage.setItem('bafx-ctrlOverlayAlphaPolicy', resolved);
  });
}

if (ctrlOverlayColorCompensation)
{
  ctrlOverlayColorCompensation.addEventListener('change', () =>
  {
    const resolved = applyOverlayColorCompensation(
      ctrlOverlayColorCompensation.value,
    );

    localStorage.setItem('bafx-ctrlOverlayColorCompensation', resolved);
  });
}

if (ctrlOverlayAlphaLimit)
{
  ctrlOverlayAlphaLimit.addEventListener('input', () =>
  {
    const resolved = applyOverlayAlphaLimit(ctrlOverlayAlphaLimit.value);

    localStorage.setItem('bafx-ctrlOverlayAlphaLimit', String(resolved));
  });
}

if (ctrlHostCompositing)
{
  ctrlHostCompositing.addEventListener('change', () =>
  {
    const resolved = applyHostCompositing(ctrlHostCompositing.value);

    localStorage.setItem('bafx-ctrlHostCompositing', resolved);
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
  document.getElementById('ctrlHdrPresentationPreset').value = 'balanced';
  document.getElementById('ctrlOutputCompositing').value =
    DEFAULT_OUTPUT_COMPOSITING;
  document.getElementById('ctrlOverlayAlphaPolicy').value =
    DEFAULT_OVERLAY_ALPHA_POLICY;
  document.getElementById('ctrlOverlayColorCompensation').value =
    DEFAULT_OVERLAY_COLOR_COMPENSATION;
  document.getElementById('ctrlOverlayAlphaLimit').value =
    String(DEFAULT_OVERLAY_ALPHA_LIMIT);
  document.getElementById('outOverlayAlphaLimit').textContent =
    DEFAULT_OVERLAY_ALPHA_LIMIT.toFixed(2);
  document.getElementById('ctrlHostCompositing').value =
    DEFAULT_HOST_COMPOSITING;
  syncTransparentCompositingControlState(DEFAULT_OUTPUT_COMPOSITING);
  document.getElementById('ctrlInputSource').value = 'dom';
  document.getElementById('ctrlClickTimeScale').value = '1';
  document.getElementById('outClickTimeScale').textContent = '1.00';
  document.getElementById('ctrlTrailTimeScale').value = '1';
  document.getElementById('outTrailTimeScale').textContent = '1.00';
  document.getElementById('ctrlPaused').checked = false;
  document.getElementById('ctrlPauseClear').checked = false;
  document.getElementById('ctrlIsolatedCompositing').checked = false;
  document.getElementById('ctrlCompositingReference').value =
    DEFAULT_COMPOSITING_REFERENCE_MODE;
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
    ['ctrlMaxShards', 'outMaxShards', 50, true],
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
  compositingReferenceMode = DEFAULT_COMPOSITING_REFERENCE_MODE;

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
      ...HDR_PRESENTATION_PRESETS.balanced,
      outputCompositing: DEFAULT_OUTPUT_COMPOSITING,
      overlayAlphaPolicy: DEFAULT_OVERLAY_ALPHA_POLICY,
      overlayColorCompensation: DEFAULT_OVERLAY_COLOR_COMPENSATION,
      overlayAlphaLimit: DEFAULT_OVERLAY_ALPHA_LIMIT,
      hostCompositing: DEFAULT_HOST_COMPOSITING,
      isolatedCompositing: false,
      lightBackgroundContrastAlpha: 0,
      maxDpr: 2,
    },
  );
  manualPointerId = null;
  updateHostApiStatus();
  requestAnimationFrame(updateRenderBackendStatus);
  syncHdrPresentationControls(effect.getConfig());
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

const ctrlCustomBgFile = document.getElementById('ctrlCustomBgFile');

if (ctrlCustomBgFile)
{
  ctrlCustomBgFile.addEventListener('change', () =>
  {
    applyCustomBackgroundFile(ctrlCustomBgFile.files?.[0]);
  });
}

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
    labelOutputCompositing: '输出合成',
    outputCompositingScene: '场景合成',
    outputCompositingTransparentOverlay: '透明覆盖层',
    labelOverlayAlphaPolicy: '覆盖层 Alpha 策略',
    overlayAlphaPolicyCoverage: 'Coverage 传输和',
    overlayAlphaPolicyVisualMax: '旧版视觉最大值',
    labelOverlayColorCompensation: '覆盖层颜色补偿',
    overlayColorCompensationNone: '不补偿',
    overlayColorCompensationBrightCore: '浅色背景高能核心',
    labelOverlayAlphaLimit: '覆盖层 Alpha 上限',
    labelHostCompositing: '宿主合成',
    hostCompositingSourceOver: 'Source-over',
    hostCompositingDomAdd: 'DOM Add（近似）',
    transparentCompositingNote: 'DOM Add 使用 Screen 自适应亮底，并停用 Alpha 策略、颜色补偿和 Alpha 上限；透明覆盖层策略都是浏览器视觉近似。',
    labelCompositingReference: '特效背景参考',
    compositingReferenceMatchPage: '匹配当前页面（精确）',
    compositingReferenceUnknown: '未知透明背景（兼容）',
    compositingReferenceMatchedStatus: '正在使用与当前页面匹配的合成参考。',
    compositingReferenceUnknownStatus: '未知背景兼容输出：亮度会随宿主背景变化。',
    compositingReferenceUnavailableStatus: '当前页面背景无法作为合成参考，已使用未知背景输出。',
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
    renderFullWebGPU: 'WebGPU HDR（实验）',
    renderFullWebGL2: '纯 WebGL2',
    renderSoftwareBloom: '软件 Bloom',
    renderWebGL2Bloom: 'WebGL2 Bloom',
    renderNativeBloom: '原生辉光',
    renderLegacy: 'Legacy',
    renderAutoBloom: '自动选择',
    renderBackendLabel: '实际后端',
    renderCanvasOutputLabel: 'Canvas 输出',
    renderDynamicRangeLabel: '显示环境',
    renderHdrVerdictLabel: 'HDR 判断',
    renderBackendActive: '{backend}',
    renderBackendPending: '正在检测 {requested}…',
    renderBackendFallback: '{resolved}（{requested} 不可用，已自动回退）',
    renderWebGPUOutputExtended: 'Extended HDR · rgba16float',
    renderWebGPUOutputStandard: 'Standard SDR · {format}',
    renderWebGPUOutputPending: '正在协商',
    renderWebGPUOutputUnavailable: 'HDR Canvas 不可用',
    renderWebGPUOutputInactive: '未启用',
    renderWebGPUPreferredFormat: '浏览器首选格式',
    renderDynamicRangeHigh: 'High（浏览器报告）',
    renderDynamicRangeStandard: 'Standard（未报告 HDR）',
    renderDynamicRangeUnknown: '浏览器未提供',
    renderHdrVerdictReady: '浏览器侧 HDR 已就绪',
    renderHdrVerdictDisplayUnconfirmed: 'Canvas Extended；显示环境未确认',
    renderHdrVerdictStandard: '当前为 SDR 输出',
    renderHdrVerdictPending: '正在判断',
    renderHdrVerdictUnavailable: 'WebGPU HDR 不可用',
    renderHdrVerdictInactive: '未启用 WebGPU HDR',
    renderHdrStatusNote: '浏览器侧判断；实际峰值亮度由系统和屏幕决定。',
    hdrPresentationHeading: 'HDR 显示映射',
    labelHdrPresentationPreset: '高光预设',
    hdrPresentationPresetBalanced: '平衡白核（默认）',
    hdrPresentationPresetBright: '明亮白核',
    hdrPresentationPresetColor: '保留原始色相',
    hdrPresentationPresetCustom: '自定义',
    labelWebGPUHdrPeak: '线性峰值',
    labelWebGPUHdrWhiteCore: '白核强度',
    labelWebGPUHdrWhiteStart: '白核起点',
    labelWebGPUHdrWhiteEnd: '白核终点',
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
    customBgFileLabel: '本地图片',
    btnApplyBg: '应用背景',
    introTitle: 'ba-click-fx',
    introP1: 'Blue Archive / 蔚蓝档案风格网页点击特效与鼠标拖尾。点击、拖动或移动鼠标预览效果。',
    introP2: '从 Unity FX_Touch.prefab 逐参数移植，默认使用纯 WebGL2，可选 WebGPU 真实 HDR，并提供 WebGL2 Bloom、软件 Bloom、原生辉光和 Legacy 回退路径。零外部运行时依赖。',
    introInstallSummary: '安装方式 / Installation',
    introInstallContent: '<p><strong>npm</strong></p><pre><code>npm install ba-click-fx</code></pre><p><strong>CDN</strong></p><pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.19/dist/ba-click-fx.iife.js"&gt;&lt;/script&gt;</code></pre>',
    introFAQSummary: '常见问题 / FAQ',
    introWebGPUFAQContent: '<p><strong>WebGPU 一定会显示真实 HDR 吗？</strong> 不会。只有 <code>resolvedWebGPUOutputMode === \'extended\'</code> 才表示 Canvas 会以扩展 sRGB 编码保留超过 SDR 白色的高光；还需要 HDR 显示器、系统 HDR 和浏览器 WebGPU HDR Canvas 同时可用。</p>',
    introFAQContent: '<p><strong>和蔚蓝档案有关吗？</strong> 粉丝向视觉特效库，粒子参数从游戏 Unity Prefab 逐项提取。</p><p><strong>需要素材或 WebGL？</strong> 特效本身不需要图片素材。默认使用纯 WebGL2；能力不足时会自动回退 Canvas 2D、软件 Bloom 与原生辉光。</p><p><strong>内置主题和自定义图片背景怎样参与游戏式合成？</strong> 页面主题始终由 CSS 单独显示。“特效背景参考”可选“匹配当前页面”或“未知透明背景”：前者把内置主题或已解码图片传入渲染器，后者调用 <code>setCompositingReference(null)</code> 并保留透明宿主的 Coverage 合同。纯白主题在关闭“隔离合成”时保留接近游戏原始的低可见度；开启后会自动使用 <code>lightBackgroundContrastAlpha: 0.35</code> 补足网页白底可见性。已解码图片通过 <code>setCompositingReference(image, { fit: \'cover\' })</code> 提供给纯 WebGL2、WebGL2 Bloom，以及原生辉光/Legacy 的 Canvas Final Pass。跨域图片必须允许 CORS；本地图片选择器会生成当前页面的 <code>blob:</code> URL，不需要 CORS，但刷新后需要重新选择。手输 <code>file://</code> 会交给允许读取本地协议且允许作为 Canvas/WebGL 纹理使用的受信任桌面宿主；普通 HTTP/HTTPS 页面仍受浏览器本地资源权限限制，请使用本地图片选择器。</p><p><strong>透明桌面应怎样选择合成模式？</strong> 展示页和严格游戏还原保留默认 <code>scene</code>；BASpark、WebView2、Electron 等透明宿主显式使用 <code>browser-overlay</code>。未知背景下，标准 <code>source-over</code> 无法同时实现严格 Unity 加色、纯 Coverage Alpha 和白底绝不变暗；隔离合成不会读取桌面，已知背景应通过 <code>setCompositingReference()</code> 提供给渲染器。</p><p><strong>纯白背景下特效颜色太浅？</strong> 关闭“隔离合成”时会保留游戏原始的低可见度表现；开启后，展示页自动叠加不参与 Bloom 的淡青对比轮廓，使效果在常见网页白底上保持可见。其他宿主也可按需显式设置 <code>lightBackgroundContrastAlpha</code>。</p><p><strong>能用在博客或个人主页吗？</strong> 可以，支持 npm、CDN 和 script 引入。</p>',
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
    labelOutputCompositing: 'Output Compositing',
    outputCompositingScene: 'Scene',
    outputCompositingTransparentOverlay: 'Transparent Overlay',
    labelOverlayAlphaPolicy: 'Overlay Alpha Policy',
    overlayAlphaPolicyCoverage: 'Coverage Transport Sum',
    overlayAlphaPolicyVisualMax: 'Legacy Visual Maximum',
    labelOverlayColorCompensation: 'Overlay Color Compensation',
    overlayColorCompensationNone: 'None',
    overlayColorCompensationBrightCore: 'Light-background Bright Core',
    labelOverlayAlphaLimit: 'Overlay Alpha Limit',
    labelHostCompositing: 'Host Compositing',
    hostCompositingSourceOver: 'Source-over',
    hostCompositingDomAdd: 'DOM Add (Approximate)',
    transparentCompositingNote: 'DOM Add uses Screen to adapt to light backdrops and disables the Alpha policy, color compensation, and Alpha limit; transparent-overlay policies are browser approximations.',
    labelCompositingReference: 'Effect Reference',
    compositingReferenceMatchPage: 'Current Page (Exact)',
    compositingReferenceUnknown: 'Unknown Background',
    compositingReferenceMatchedStatus: 'Using a compositing reference matched to the current page.',
    compositingReferenceUnknownStatus: 'Unknown-background output: brightness varies with the host background.',
    compositingReferenceUnavailableStatus: 'The current page cannot provide a compositing reference; using unknown-background output.',
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
    renderFullWebGPU: 'WebGPU HDR (Experimental)',
    renderFullWebGL2: 'Full WebGL2',
    renderSoftwareBloom: 'Software Bloom',
    renderWebGL2Bloom: 'WebGL2 Bloom',
    renderNativeBloom: 'Native Glow',
    renderLegacy: 'Legacy',
    renderAutoBloom: 'Auto',
    renderBackendLabel: 'Active Backend',
    renderCanvasOutputLabel: 'Canvas Output',
    renderDynamicRangeLabel: 'Display Range',
    renderHdrVerdictLabel: 'HDR Verdict',
    renderBackendActive: '{backend}',
    renderBackendPending: 'Detecting {requested}…',
    renderBackendFallback: '{resolved} ({requested} unavailable; fell back automatically)',
    renderWebGPUOutputExtended: 'Extended HDR · rgba16float',
    renderWebGPUOutputStandard: 'Standard SDR · {format}',
    renderWebGPUOutputPending: 'Negotiating',
    renderWebGPUOutputUnavailable: 'HDR Canvas unavailable',
    renderWebGPUOutputInactive: 'Inactive',
    renderWebGPUPreferredFormat: 'Browser preferred format',
    renderDynamicRangeHigh: 'High (reported by browser)',
    renderDynamicRangeStandard: 'Standard (HDR not reported)',
    renderDynamicRangeUnknown: 'Not exposed by browser',
    renderHdrVerdictReady: 'Browser-side HDR ready',
    renderHdrVerdictDisplayUnconfirmed: 'Canvas Extended; display unconfirmed',
    renderHdrVerdictStandard: 'Currently SDR output',
    renderHdrVerdictPending: 'Evaluating',
    renderHdrVerdictUnavailable: 'WebGPU HDR unavailable',
    renderHdrVerdictInactive: 'WebGPU HDR not enabled',
    renderHdrStatusNote: 'Browser-side verdict; peak luminance depends on the system and display.',
    hdrPresentationHeading: 'HDR Presentation Mapping',
    labelHdrPresentationPreset: 'Highlight Preset',
    hdrPresentationPresetBalanced: 'Balanced White Core (Default)',
    hdrPresentationPresetBright: 'Bright White Core',
    hdrPresentationPresetColor: 'Preserve Original Hue',
    hdrPresentationPresetCustom: 'Custom',
    labelWebGPUHdrPeak: 'Linear Peak',
    labelWebGPUHdrWhiteCore: 'White-core Strength',
    labelWebGPUHdrWhiteStart: 'White-core Start',
    labelWebGPUHdrWhiteEnd: 'White-core End',
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
    customBgFileLabel: 'Local Image',
    btnApplyBg: 'Apply',
    introTitle: 'ba-click-fx',
    introP1: 'Blue Archive style mouse click effect and cursor trail for web. Click, drag, or move your mouse to preview.',
    introP2: 'Ported from Unity FX_Touch.prefab with Full WebGL2 by default, optional real WebGPU HDR, and WebGL2 Bloom, Software Bloom, Native Glow, and Legacy fallbacks. Zero runtime dependencies.',
    introInstallSummary: '安装方式 / Installation',
    introInstallContent: '<p><strong>npm</strong></p><pre><code>npm install ba-click-fx</code></pre><p><strong>CDN</strong></p><pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.19/dist/ba-click-fx.iife.js"&gt;&lt;/script&gt;</code></pre>',
    introFAQSummary: '常见问题 / FAQ',
    introWebGPUFAQContent: '<p><strong>Does WebGPU always produce real HDR?</strong> No. Only <code>resolvedWebGPUOutputMode === \'extended\'</code> means the Canvas preserves highlights above SDR white in extended sRGB; an HDR display, system HDR, and browser WebGPU HDR Canvas support are also required.</p>',
    introFAQContent: '<p><strong>Is it related to Blue Archive?</strong> A fan-made VFX library with parameters extracted from the game Unity Prefab.</p><p><strong>Needs assets or WebGL?</strong> The effect itself needs no image assets. Full WebGL2 is the default; unsupported environments fall back to Canvas 2D, Software Bloom, and Native Glow.</p><p><strong>How do built-in themes and custom images join the game-style composite?</strong> The page theme always remains a separate CSS concern. Effect Reference offers Current Page or Unknown Background: the former supplies a built-in theme or decoded image to the renderer, while the latter calls <code>setCompositingReference(null)</code> and preserves the Coverage contract for a transparent host. With Isolated Compositing off, Pure White keeps the lower-visibility result closest to the game original. With it on, the demo automatically uses <code>lightBackgroundContrastAlpha: 0.35</code> to keep the effect visible on ordinary web white backgrounds. Decoded images are passed to <code>setCompositingReference(image, { fit: \'cover\' })</code> for Full WebGL2, WebGL2 Bloom, and the Native/Legacy Canvas Final Pass. Cross-origin images must allow CORS. The local-image picker creates a page-session <code>blob:</code> URL, so it needs no CORS but must be selected again after a reload. A typed <code>file://</code> URL is passed through for desktop hosts that permit both local-protocol reads and Canvas/WebGL texture use; regular HTTP/HTTPS pages remain subject to browser local-resource permissions and should use the local-image picker.</p><p><strong>Which compositing mode should a transparent desktop use?</strong> The demo and strict game reproduction keep the default <code>scene</code>; transparent hosts such as BASpark, WebView2, and Electron select <code>browser-overlay</code> explicitly. Over an unknown background, standard <code>source-over</code> cannot simultaneously provide strict Unity additive RGB, pure Coverage alpha, and no white-background darkening. Isolation cannot read desktop pixels; provide a known background with <code>setCompositingReference()</code>.</p><p><strong>Effects look washed out on a pure white background?</strong> With Isolated Compositing off, the demo preserves the game-original lower-visibility result. With it on, the demo adds a pale-cyan contrast outline outside Bloom so the effect remains visible on ordinary web white backgrounds. Other hosts can set <code>lightBackgroundContrastAlpha</code> explicitly as needed.</p><p><strong>Can I use it on my blog?</strong> Yes — npm, CDN, and direct script tag are all supported.</p>',
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
    ctrlHdrPresentationPreset: d.labelHdrPresentationPreset,
    ctrlWebGPUHdrPeak: d.labelWebGPUHdrPeak,
    ctrlWebGPUHdrWhiteCore: d.labelWebGPUHdrWhiteCore,
    ctrlWebGPUHdrWhiteStart: d.labelWebGPUHdrWhiteStart,
    ctrlWebGPUHdrWhiteEnd: d.labelWebGPUHdrWhiteEnd,
    ctrlOutputCompositing: d.labelOutputCompositing,
    ctrlOverlayAlphaPolicy: d.labelOverlayAlphaPolicy,
    ctrlOverlayColorCompensation: d.labelOverlayColorCompensation,
    ctrlOverlayAlphaLimit: d.labelOverlayAlphaLimit,
    ctrlHostCompositing: d.labelHostCompositing,
    ctrlCompositingReference: d.labelCompositingReference,
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
    'full-webgpu': d.renderFullWebGPU,
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

  const hdrPresentationPresetOptions = {
    balanced: d.hdrPresentationPresetBalanced,
    bright: d.hdrPresentationPresetBright,
    color: d.hdrPresentationPresetColor,
    custom: d.hdrPresentationPresetCustom,
  };

  document.querySelectorAll(
    '#ctrlHdrPresentationPreset option',
  ).forEach((option) =>
  {
    if (hdrPresentationPresetOptions[option.value])
    {
      option.textContent = hdrPresentationPresetOptions[option.value];
    }
  });

  const outputCompositingOptions = {
    scene: d.outputCompositingScene,
    'browser-overlay': d.outputCompositingTransparentOverlay,
  };

  document.querySelectorAll('#ctrlOutputCompositing option').forEach((option) =>
  {
    if (outputCompositingOptions[option.value])
    {
      option.textContent = outputCompositingOptions[option.value];
    }
  });

  const overlayAlphaPolicyOptions = {
    coverage: d.overlayAlphaPolicyCoverage,
    'visual-max': d.overlayAlphaPolicyVisualMax,
  };

  document.querySelectorAll(
    '#ctrlOverlayAlphaPolicy option',
  ).forEach((option) =>
  {
    if (overlayAlphaPolicyOptions[option.value])
    {
      option.textContent = overlayAlphaPolicyOptions[option.value];
    }
  });

  const overlayColorCompensationOptions = {
    none: d.overlayColorCompensationNone,
    'bright-core': d.overlayColorCompensationBrightCore,
  };

  document.querySelectorAll(
    '#ctrlOverlayColorCompensation option',
  ).forEach((option) =>
  {
    if (overlayColorCompensationOptions[option.value])
    {
      option.textContent = overlayColorCompensationOptions[option.value];
    }
  });

  const hostCompositingOptions = {
    'source-over': d.hostCompositingSourceOver,
    screen: d.hostCompositingDomAdd,
  };

  document.querySelectorAll('#ctrlHostCompositing option').forEach((option) =>
  {
    if (hostCompositingOptions[option.value])
    {
      option.textContent = hostCompositingOptions[option.value];
    }
  });

  document.getElementById('transparentCompositingNote').textContent =
    d.transparentCompositingNote;

  const compositingReferenceOptions = {
    'match-page': d.compositingReferenceMatchPage,
    unknown: d.compositingReferenceUnknown,
  };

  document.querySelectorAll('#ctrlCompositingReference option').forEach((option) =>
  {
    if (compositingReferenceOptions[option.value])
    {
      option.textContent = compositingReferenceOptions[option.value];
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
  document.getElementById('hdrPresentationHeading').textContent =
    d.hdrPresentationHeading;
  document.getElementById('btnReset').textContent = d.btnReset;
  document.getElementById('customBgCtrl')?.querySelector('span') && (document.getElementById('customBgCtrl').querySelector('span').textContent = d.customBgLabel);
  document.getElementById('customBgFileCtrl')?.querySelector('span') && (document.getElementById('customBgFileCtrl').querySelector('span').textContent = d.customBgFileLabel);
  document.getElementById('ctrlCustomBg').placeholder = d.customBgPlaceholder;
  document.getElementById('btnApplyBg').textContent = d.btnApplyBg;

  // 介绍区
  document.getElementById('introTitle').textContent = d.introTitle;
  document.getElementById('introP1').textContent = d.introP1;
  document.getElementById('introP2').textContent = d.introP2;
  document.getElementById('introInstallSummary').textContent = d.introInstallSummary;
  document.getElementById('introInstallContent').innerHTML = d.introInstallContent;
  document.getElementById('introFAQSummary').textContent = d.introFAQSummary;
  document.getElementById('introFAQContent').innerHTML =
    d.introFAQContent + d.introWebGPUFAQContent;
  document.getElementById('introHostApiSummary').textContent = d.introHostApiSummary;
  updateRenderBackendStatus();
  updateCompositingReferenceStatus();
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

  const savedHdrPresentation = {};

  for (const [controlId, , configKey] of HDR_PRESENTATION_CONTROLS)
  {
    const savedValue = localStorage.getItem('bafx-' + controlId);

    if (savedValue !== null && Number.isFinite(Number(savedValue)))
    {
      savedHdrPresentation[configKey] = Number(savedValue);
    }
  }

  const savedHdrPreset = localStorage.getItem(
    'bafx-ctrlHdrPresentationPreset',
  );
  const restoredHdrPresentation = Object.keys(savedHdrPresentation).length > 0
    ? savedHdrPresentation
    : HDR_PRESENTATION_PRESETS[savedHdrPreset] ??
      HDR_PRESENTATION_PRESETS.balanced;

  applyHdrPresentation(restoredHdrPresentation, false);

  const savedOutputCompositing = localStorage.getItem(
    'bafx-ctrlOutputCompositing',
  );

  // 即使没有持久化值，也显式应用 Scene，避免展示控件与构造默认值分叉。
  applyOutputCompositing(savedOutputCompositing);

  const savedOverlayAlphaPolicy = localStorage.getItem(
    'bafx-ctrlOverlayAlphaPolicy',
  );

  applyOverlayAlphaPolicy(savedOverlayAlphaPolicy);

  const savedOverlayColorCompensation = localStorage.getItem(
    'bafx-ctrlOverlayColorCompensation',
  );

  applyOverlayColorCompensation(savedOverlayColorCompensation);

  const savedOverlayAlphaLimit = localStorage.getItem(
    'bafx-ctrlOverlayAlphaLimit',
  );

  applyOverlayAlphaLimit(
    savedOverlayAlphaLimit ?? DEFAULT_OVERLAY_ALPHA_LIMIT,
  );

  const savedHostCompositing = localStorage.getItem(
    'bafx-ctrlHostCompositing',
  );

  applyHostCompositing(savedHostCompositing);

  const isolatedCompositingEl = document.getElementById('ctrlIsolatedCompositing');
  const savedIsolatedCompositing = localStorage.getItem('bafx-ctrlIsolatedCompositing');

  if (isolatedCompositingEl && savedIsolatedCompositing !== null)
  {
    const isolated = savedIsolatedCompositing === 'true';

    isolatedCompositingEl.checked = isolated;
    applyIsolatedCompositing(isolated);
  }

  const savedCompositingReference = localStorage.getItem(
    'bafx-ctrlCompositingReference',
  );

  applyCompositingReferenceMode(savedCompositingReference);

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
  else if (theme && getThemeBackgroundCss(theme))
  {
    applyTheme(theme);
  }
  else
  {
    applyTheme('蔚蓝');
  }
})();

// 页面销毁时清理
window.addEventListener('beforeunload', () =>
{
  revokeCustomBackgroundObjectUrl();
  effect.destroy();
});
