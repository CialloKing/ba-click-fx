import './style.css';
import {
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  CONFIG,
  EFFECT_BACKEND_CHANGE_EVENT,
  FX_PARAM_SCHEMA,
  UNITY_FX_TOUCH,
} from './fx.js';
import {
  getThemeBackgroundCss,
  renderThemeSceneBackground,
} from './theme-background.js';
import { resolveHdrPresentationState } from './hdr-presentation-status.js';
import { snapRangeValue } from './range-snap.js';
import {
  formatDiagnosticError,
  getDiagnosticStageValue,
  getWebGPUFailureStage,
} from './webgpu-diagnostics.js';

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

const DEFAULT_HDR_UI_BRIGHTNESS = 4;
let hdrUiEnabled = true;
let hdrUiBrightness = DEFAULT_HDR_UI_BRIGHTNESS;

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
let lightBackgroundContrastOverride = false;

function revokeCustomBackgroundObjectUrl(except = null)
{
  if (
    !customBackgroundObjectUrl ||
    customBackgroundObjectUrl === except
  )
  {
    return;
  }

  // 输入框会保留当前 blob: 值供主题往返后再次应用；只在替换文件或
  // 页面销毁时撤销，避免 UI 指向已经失效的对象 URL。
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
  if (lightBackgroundContrastOverride)
  {
    return;
  }

  applyLightBackgroundContrastAlpha(
    resolvePureWhiteContrastAlpha(effect.getConfig().isolatedCompositing),
    false,
  );
}

function applyIsolatedCompositing(checked)
{
  effect.updateConfig({ isolatedCompositing: checked });
  syncPureWhiteIsolationContrast();
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
const ctrlInputSamplingRate = document.getElementById('ctrlInputSamplingRate');
const outInputSamplingRate = document.getElementById('outInputSamplingRate');
const ctrlPaused = document.getElementById('ctrlPaused');
const ctrlPauseClear = document.getElementById('ctrlPauseClear');
const ctrlTouchAction = document.getElementById('ctrlTouchAction');
const DEFAULT_INPUT_SAMPLING_RATE = 0;
const TOUCH_ACTIONS = new Set([
  'auto',
  'none',
  'pan-x',
  'pan-y',
  'manipulation',
]);
let currentInputSource = 'dom';
let manualPointerId = null;

function isManualInput()
{
  return currentInputSource === 'manual';
}

function normalizeDemoInputSamplingRate(value)
{
  const rate = Number(value);

  return Number.isInteger(rate) && rate >= 0 && rate <= 1000
    ? rate
    : DEFAULT_INPUT_SAMPLING_RATE;
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

function applyInputSamplingRate(value, persist = true)
{
  const rate = normalizeDemoInputSamplingRate(value);

  // 统一通过公开 API 生效，展示页不直接写入实例内部配置。
  effect.setInputSamplingRate(rate);

  if (ctrlInputSamplingRate)
  {
    ctrlInputSamplingRate.value = String(rate);
  }

  if (outInputSamplingRate)
  {
    outInputSamplingRate.textContent = String(rate);
  }

  if (persist)
  {
    localStorage.setItem('bafx-ctrlInputSamplingRate', String(rate));
  }
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

if (ctrlInputSamplingRate)
{
  ctrlInputSamplingRate.addEventListener('input', () =>
  {
    applyInputSamplingRate(ctrlInputSamplingRate.value);
  });
}

if (ctrlTouchAction)
{
  ctrlTouchAction.addEventListener('change', () =>
  {
    const resolved = TOUCH_ACTIONS.has(ctrlTouchAction.value)
      ? ctrlTouchAction.value
      : 'auto';

    ctrlTouchAction.value = resolved;
    effect.updateConfig({ touchAction: resolved });
    localStorage.setItem('bafx-ctrlTouchAction', resolved);
  });
}

document.getElementById('btnTriggerBoom')?.addEventListener('click', () =>
{
  effect.boom(effect.width / 2, effect.height / 2);
});

document.getElementById('btnClearTrail')?.addEventListener('click', () =>
{
  effect.clearTrail();
});

document.getElementById('btnClearEffects')?.addEventListener('click', () =>
{
  effect.clear();
});

document.getElementById('btnCopyConfig')?.addEventListener('click', async () =>
{
  const payload = JSON.stringify(
    {
      config: effect.getConfig(),
      fx: effect.getFxConfig(),
      effectiveHostCompositing: effect.getEffectiveHostCompositing(),
    },
    null,
    2,
  );
  const dictionary = I18N[currentLang] || I18N.zh;

  try
  {
    await navigator.clipboard.writeText(payload);
    document.getElementById('hostApiStatus').textContent =
      dictionary.hostApiConfigCopied;
  }
  catch
  {
    document.getElementById('hostApiStatus').textContent =
      dictionary.hostApiConfigCopyFailed;
  }
});

document.getElementById('btnApplyFxParams')?.addEventListener('click', () =>
{
  const currentFxConfig = effect.getFxConfig();
  const patch = Object.fromEntries(
    FX_PARAM_SCHEMA.map(({ path }) =>
    {
      const value = path.split('.').reduce(
        (config, key) => config?.[key],
        currentFxConfig,
      );

      return [path, value];
    }),
  );
  const result = effect.setFxParams(patch, { strict: true });
  const dictionary = I18N[currentLang] || I18N.zh;

  document.getElementById('hostApiStatus').textContent = result.committed
    ? dictionary.hostApiParamsApplied
    : dictionary.hostApiParamsApplyFailed;
});

document.getElementById('btnDestroyInstance')?.addEventListener('click', () =>
{
  const dictionary = I18N[currentLang] || I18N.zh;

  if (window.confirm(dictionary.confirmDestroyInstance))
  {
    effect.destroy();
    window.location.reload();
  }
});

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
const videoDynamicRangeQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(video-dynamic-range: high)')
  : null;
const WEBGPU_DIAGNOSTIC_REFRESH_MS = 250;
let webgpuDiagnosticRefreshTimer = null;
const RENDER_MODE_CONFIGS = Object.freeze(
  {
    'full-webgpu-sdr':
    {
      effectBackend: 'webgpu',
      webgpuPreferHdr: false,
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
    },
    'full-webgpu':
    {
      effectBackend: 'webgpu',
      webgpuPreferHdr: true,
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
    },
    'full-webgl2':
    {
      effectBackend: 'webgl2',
      webgpuPreferHdr: true,
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
    },
    'software-bloom':
    {
      effectBackend: 'canvas2d',
      webgpuPreferHdr: true,
      renderingMode: 'enhanced',
      bloomBackend: 'software',
    },
    'webgl2-bloom':
    {
      effectBackend: 'canvas2d',
      webgpuPreferHdr: true,
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
    },
    'native-bloom':
    {
      effectBackend: 'canvas2d',
      webgpuPreferHdr: true,
      renderingMode: 'enhanced',
      bloomBackend: 'native',
    },
    legacy:
    {
      effectBackend: 'canvas2d',
      webgpuPreferHdr: true,
      renderingMode: 'legacy',
    },
  },
);
const HDR_PRESENTATION_PRESETS = Object.freeze(
  {
    balanced:
    {
      webgpuHdrPeak: CONFIG.webgpuHdrPeak,
      webgpuHdrBrightness: CONFIG.webgpuHdrBrightness,
      webgpuHdrColorPreservation: CONFIG.webgpuHdrColorPreservation,
      webgpuHdrWhiteCore: CONFIG.webgpuHdrWhiteCore,
      webgpuHdrWhiteStart: CONFIG.webgpuHdrWhiteStart,
      webgpuHdrWhiteEnd: CONFIG.webgpuHdrWhiteEnd,
    },
    bright:
    {
      webgpuHdrPeak: 3.5,
      webgpuHdrBrightness: 1,
      webgpuHdrColorPreservation: 0,
      webgpuHdrWhiteCore: 0.8,
      webgpuHdrWhiteStart: 0.75,
      webgpuHdrWhiteEnd: 4,
    },
    color:
    {
      webgpuHdrPeak: 3,
      webgpuHdrBrightness: 1,
      webgpuHdrColorPreservation: 1,
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
      'ctrlWebGPUHdrBrightness',
      'outWebGPUHdrBrightness',
      'webgpuHdrBrightness',
    ],
    [
      'ctrlWebGPUHdrColorPreservation',
      'outWebGPUHdrColorPreservation',
      'webgpuHdrColorPreservation',
    ],
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

function srgbChannelToLinear(value)
{
  const channel = Math.max(0, Math.min(1, value));

  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function hexToLinearRgb(value)
{
  const match = /^#([0-9a-f]{6})$/i.exec(value ?? '');

  if (!match)
  {
    return [0.205, 0.863, 1];
  }

  return [0, 2, 4].map((offset) =>
    srgbChannelToLinear(parseInt(match[1].slice(offset, offset + 2), 16) / 255));
}

function mixLinearRgb(left, right, amount)
{
  return left.map((value, index) =>
    value + (right[index] - value) * amount);
}

function supportsHdrUiCss()
{
  return typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('color', 'color(srgb-linear 0.25 1 2)') &&
    CSS.supports('dynamic-range-limit', 'no-limit');
}

function syncWebGPUDiagnosticRefresh(requested, renderer, manager)
{
  const detailsOpen = document.getElementById(
    'webgpuDiagnosticDetails',
  )?.open === true;
  const pending = detailsOpen && requested && renderer !== null &&
    (renderer.status === 'pending' || manager?.status === 'pending');

  if (!pending)
  {
    if (webgpuDiagnosticRefreshTimer !== null)
    {
      window.clearTimeout(webgpuDiagnosticRefreshTimer);
      webgpuDiagnosticRefreshTimer = null;
    }

    return;
  }

  if (webgpuDiagnosticRefreshTimer !== null)
  {
    return;
  }

  // Adapter and Device requests have no intermediate public event. Poll only
  // while an actual Renderer is pending so a paused, unstarted request stays idle.
  webgpuDiagnosticRefreshTimer = window.setTimeout(() =>
  {
    webgpuDiagnosticRefreshTimer = null;
    updateRenderBackendStatus();
  }, WEBGPU_DIAGNOSTIC_REFRESH_MS);
}

function updateWebGPUDiagnosticDetails(
  snapshot,
  dictionary,
  dynamicRangeHigh,
)
{
  const requested = snapshot.renderingMode !== 'legacy' &&
    (snapshot.effectBackend === 'webgpu' || snapshot.effectBackend === 'auto');
  const renderer = requested ? effect.webgpuEffectRenderer : null;
  const manager = renderer?.deviceManager ?? null;
  const diagnostics = manager?.diagnostics ?? null;
  const stages = diagnostics?.stages ?? {};
  const videoDynamicRangeHigh = videoDynamicRangeQuery?.matches ?? null;
  const preferredFormat = manager?.canvasFormat ?? (() =>
  {
    try
    {
      return navigator.gpu?.getPreferredCanvasFormat?.() ??
        dictionary.renderWebGPUPreferredFormat;
    }
    catch
    {
      return dictionary.renderWebGPUPreferredFormat;
    }
  })();
  let extendedValue = getDiagnosticStageValue(
    stages.extendedConfigure,
    requested,
    dictionary,
  );
  let sdrValue = requested
    ? dictionary.diagnosticInactive
    : dictionary.diagnosticNotTested;
  let pipelineValue = dictionary.diagnosticNotTested;
  const resolvedBackend = snapshot.resolvedEffectBackend;
  const rendererFallback = requested &&
    renderer?.status === 'ready' &&
    resolvedBackend !== 'pending' &&
    resolvedBackend !== 'webgpu';

  syncWebGPUDiagnosticRefresh(requested, renderer, manager);

  if (manager?.outputMode === 'extended')
  {
    extendedValue = dictionary.diagnosticExtendedActive;
    sdrValue = dictionary.diagnosticNotNeeded;
  }
  else if (manager?.outputMode === 'standard')
  {
    extendedValue = stages.extendedConfigure?.status === 'failed'
      ? dictionary.diagnosticExtendedRejected
      : dictionary.diagnosticSkipped;
    sdrValue = dictionary.diagnosticSdrActive.replace(
      '{format}',
      preferredFormat,
    );
  }
  else if (requested && stages.extendedConfigure?.status === 'failed')
  {
    extendedValue = dictionary.diagnosticExtendedRejected;
  }

  if (requested)
  {
    if (
      resolvedBackend === 'webgpu' &&
      renderer?.status === 'ready'
    )
    {
      pipelineValue = dictionary.diagnosticPipelineActive;
    }
    else if (rendererFallback)
    {
      pipelineValue = dictionary.diagnosticPipelineFallback.replace(
        '{backend}',
        resolvedBackend,
      );
    }
    else if (renderer?.status === 'ready')
    {
      pipelineValue = dictionary.diagnosticPipelineWaiting;
    }
    else if (renderer?.status === 'lost')
    {
      pipelineValue = dictionary.diagnosticLost;
    }
    else if (renderer?.status === 'unavailable')
    {
      pipelineValue = dictionary.diagnosticUnavailable;
    }
    else
    {
      pipelineValue = dictionary.diagnosticPending;
    }
  }

  const values = {
    diagnosticSecureContextValue: window.isSecureContext
      ? dictionary.diagnosticSecure
      : dictionary.diagnosticInsecure,
    diagnosticWebGPUApiValue:
      typeof navigator.gpu?.requestAdapter === 'function'
        ? dictionary.diagnosticAvailable
        : dictionary.diagnosticUnavailable,
    diagnosticCanvasContextValue: getDiagnosticStageValue(
      stages.context,
      requested,
      dictionary,
    ),
    diagnosticAdapterValue: getDiagnosticStageValue(
      stages.adapter,
      requested,
      dictionary,
    ),
    diagnosticDeviceValue: getDiagnosticStageValue(
      stages.device,
      requested,
      dictionary,
    ),
    diagnosticExtendedCanvasValue: extendedValue,
    diagnosticSdrFallbackValue: sdrValue,
    diagnosticPipelineValue: pipelineValue,
    diagnosticGraphicsRangeValue: dynamicRangeHigh === true
      ? dictionary.diagnosticRangeHigh
      : dynamicRangeHigh === false
        ? dictionary.diagnosticRangeNotHigh
        : dictionary.diagnosticUnknown,
    diagnosticVideoRangeValue: videoDynamicRangeHigh === true
      ? dictionary.diagnosticRangeHigh
      : videoDynamicRangeHigh === false
        ? dictionary.diagnosticRangeNotHigh
        : dictionary.diagnosticUnknown,
    diagnosticCssHdrValue: supportsHdrUiCss()
      ? dictionary.diagnosticSupported
      : dictionary.diagnosticUnsupported,
  };

  for (const [id, value] of Object.entries(values))
  {
    const element = document.getElementById(id);

    if (element)
    {
      element.textContent = value;
    }
  }

  const failureElement = document.getElementById('webgpuDiagnosticFailure');
  const failureStage = requested
    ? getWebGPUFailureStage(
        renderer,
        manager,
        diagnostics,
        rendererFallback,
      )
    : null;
  const failedStage = failureStage
    ? Object.values(stages).find(
      (stage) => stage?.failureStage === failureStage,
    )
    : null;
  const rendererFailure = failureStage === 'renderer-unavailable' ||
    failureStage === 'renderer-frame-failed';
  const failure = rendererFailure
    ? renderer?.failure
    : failedStage?.error ?? manager?.failure ?? renderer?.failure;

  if (failureElement)
  {
    failureElement.hidden = failureStage === null;
    failureElement.textContent = failureStage === null
      ? ''
      : dictionary.diagnosticFailure
        .replace('{stage}', failureStage)
        .replace(
          '{message}',
          formatDiagnosticError(failure) || dictionary.diagnosticFailureUnknown,
        );
  }
}

function formatHdrUiCssColor(linearColor, intensity, alpha)
{
  const channels = linearColor.map((value) =>
    Math.max(0, value * intensity).toFixed(6));

  return `color(srgb-linear ${channels.join(' ')} / ${alpha})`;
}

function updateHdrUiCssColors()
{
  const theme = hexToLinearRgb(
    document.getElementById('ctrlColor')?.value ?? '#4ca7ff',
  );
  const cyan = [
    srgbChannelToLinear(125 / 255),
    srgbChannelToLinear(239 / 255),
    1,
  ];
  const green = [
    srgbChannelToLinear(123 / 255),
    srgbChannelToLinear(225 / 255),
    srgbChannelToLinear(177 / 255),
  ];
  const primary = mixLinearRgb(theme, cyan, 0.68);
  const root = document.documentElement;

  root.style.setProperty(
    '--hdr-ui-primary-core',
    formatHdrUiCssColor(primary, hdrUiBrightness * 1.2, 0.96),
  );
  root.style.setProperty(
    '--hdr-ui-primary-glow',
    formatHdrUiCssColor(primary, hdrUiBrightness * 0.42, 0.72),
  );
  root.style.setProperty(
    '--hdr-ui-green-core',
    formatHdrUiCssColor(green, hdrUiBrightness, 0.92),
  );
  root.style.setProperty(
    '--hdr-ui-green-glow',
    formatHdrUiCssColor(green, hdrUiBrightness * 0.34, 0.68),
  );
}

function syncHdrUiControls(extendedActive)
{
  const container = document.getElementById('hdrUiControls');
  const enabledControl = document.getElementById('ctrlHdrUiEnabled');
  const brightnessControl = document.getElementById('ctrlHdrUiBrightness');
  const brightnessOutput = document.getElementById('outHdrUiBrightness');

  container?.classList.toggle('is-inactive', !extendedActive);
  container?.setAttribute('aria-disabled', String(!extendedActive));

  if (enabledControl)
  {
    enabledControl.disabled = !extendedActive;
    enabledControl.checked = hdrUiEnabled;
  }

  if (brightnessControl)
  {
    brightnessControl.disabled = !extendedActive || !hdrUiEnabled;
    brightnessControl.value = String(hdrUiBrightness);
  }

  if (brightnessOutput)
  {
    brightnessOutput.textContent = hdrUiBrightness.toFixed(2);
  }
}

function syncHdrUiOverlay(snapshot = effect.getConfig())
{
  const extendedActive = snapshot.resolvedEffectBackend === 'webgpu' &&
    snapshot.resolvedWebGPUOutputMode === 'extended';
  const cssAvailable = supportsHdrUiCss();
  const available = extendedActive && cssAvailable;

  syncHdrUiControls(available);
  // 变量始终跟随滑块和主题，重新进入 Extended 时无需等待额外事件。
  updateHdrUiCssColors();

  if (!extendedActive)
  {
    document.body.dataset.hdrUiState = 'inactive';
    return false;
  }

  if (!cssAvailable)
  {
    document.body.dataset.hdrUiState = 'unavailable';
    return false;
  }

  document.body.dataset.hdrUiState = hdrUiEnabled ? 'extended' : 'disabled';
  return hdrUiEnabled;
}

function applyHdrUiSettings(settings = {}, persist = true)
{
  if (typeof settings.enabled === 'boolean')
  {
    hdrUiEnabled = settings.enabled;
  }

  if (Number.isFinite(settings.brightness))
  {
    hdrUiBrightness = Math.max(1, Math.min(16, settings.brightness));
  }

  if (persist)
  {
    localStorage.setItem('bafx-ctrlHdrUiEnabled', String(hdrUiEnabled));
    localStorage.setItem(
      'bafx-ctrlHdrUiBrightness',
      String(hdrUiBrightness),
    );
  }

  syncHdrUiOverlay(effect.getConfig());
}

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

function syncHdrPresentationDetails(mode)
{
  const details = document.getElementById('hdrPresentationDetails');

  if (details)
  {
    // 只在明确选择或恢复模式时切换；运行时状态刷新应尊重用户手动折叠。
    details.open = mode === 'full-webgpu';
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
  const webgpuLabel = snapshot.webgpuPreferHdr
    ? d.renderFullWebGPU
    : d.renderFullWebGPUStandard;
  const backendLabels = {
    canvas2d: d.renderCanvas2D,
    auto: d.renderAutoBloom,
    software: d.renderSoftwareBloom,
    webgpu: webgpuLabel,
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
  const hdrRequested = webgpuRequested && snapshot.webgpuPreferHdr;
  const outputMode = snapshot.resolvedWebGPUOutputMode;
  const dynamicRangeHigh = dynamicRangeQuery?.matches ?? null;
  const presentationState = resolveHdrPresentationState(
    {
      webgpuRequested: hdrRequested,
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
  updateWebGPUDiagnosticDetails(snapshot, d, dynamicRangeHigh);
  status.dataset.hdrState = presentationState;
  syncHdrPresentationControls(snapshot);
  syncHdrUiOverlay(snapshot);
}

function applyRenderMode(mode)
{
  const normalizedMode = RENDER_MODE_CONFIGS[mode]
    ? mode
    : DEFAULT_RENDER_MODE;
  const config = RENDER_MODE_CONFIGS[normalizedMode];

  syncHdrPresentationDetails(normalizedMode);
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

for (const query of [dynamicRangeQuery, videoDynamicRangeQuery])
{
  if (typeof query?.addEventListener === 'function')
  {
    query.addEventListener('change', updateRenderBackendStatus);
  }
  else if (typeof query?.addListener === 'function')
  {
    // 兼容仍只实现旧 MediaQueryList 监听接口的浏览器。
    query.addListener(updateRenderBackendStatus);
  }
}

document.getElementById('webgpuDiagnosticDetails')?.addEventListener(
  'toggle',
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

const ctrlHdrUiEnabled = document.getElementById('ctrlHdrUiEnabled');
const ctrlHdrUiBrightness = document.getElementById('ctrlHdrUiBrightness');

ctrlHdrUiEnabled?.addEventListener('change', () =>
{
  applyHdrUiSettings({ enabled: ctrlHdrUiEnabled.checked });
});
ctrlHdrUiBrightness?.addEventListener('input', () =>
{
  applyHdrUiSettings({ brightness: Number(ctrlHdrUiBrightness.value) });
});

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
const ctrlHostCompositingSurface = document.getElementById(
  'ctrlHostCompositingSurface',
);
const ctrlLightBackgroundContrastAlpha = document.getElementById(
  'ctrlLightBackgroundContrastAlpha',
);
const outLightBackgroundContrastAlpha = document.getElementById(
  'outLightBackgroundContrastAlpha',
);
const sourceOverOnlyControls = document.querySelectorAll(
  '.source-over-only-control',
);
const DEFAULT_OUTPUT_COMPOSITING = 'scene';
const DEFAULT_OVERLAY_ALPHA_POLICY = CONFIG.overlayAlphaPolicy;
const DEFAULT_OVERLAY_COLOR_COMPENSATION =
  CONFIG.overlayColorCompensation;
const DEFAULT_OVERLAY_ALPHA_LIMIT = CONFIG.overlayAlphaLimit;
const DEFAULT_HOST_COMPOSITING = CONFIG.hostCompositing;
const DEFAULT_HOST_COMPOSITING_SURFACE = CONFIG.hostCompositingSurface;
const DEFAULT_LIGHT_BACKGROUND_CONTRAST_ALPHA =
  CONFIG.lightBackgroundContrastAlpha;
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
  'plus-lighter',
]);
const HOST_COMPOSITING_SURFACES = new Set([
  'dom-backdrop',
  'transparent-window',
  'native',
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

  if (ctrlHostCompositingSurface)
  {
    ctrlHostCompositingSurface.disabled = !enabled;
  }

  if (ctrlLightBackgroundContrastAlpha)
  {
    ctrlLightBackgroundContrastAlpha.disabled = enabled;
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
  const resolved = HOST_COMPOSITING_MODES.has(mode)
    ? mode
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

function applyHostCompositingSurface(surface)
{
  const resolved = HOST_COMPOSITING_SURFACES.has(surface)
    ? surface
    : DEFAULT_HOST_COMPOSITING_SURFACE;

  if (ctrlHostCompositingSurface)
  {
    ctrlHostCompositingSurface.value = resolved;
  }

  effect.updateConfig({ hostCompositingSurface: resolved });
  syncTransparentCompositingControlState(
    ctrlOutputCompositing?.value,
    ctrlHostCompositing?.value,
  );
  return resolved;
}

function applyLightBackgroundContrastAlpha(value, persist = true)
{
  const numericValue = Number(value);
  const resolved = Number.isFinite(numericValue)
    ? Math.max(0, Math.min(1, numericValue))
    : DEFAULT_LIGHT_BACKGROUND_CONTRAST_ALPHA;

  if (ctrlLightBackgroundContrastAlpha)
  {
    ctrlLightBackgroundContrastAlpha.value = String(resolved);
  }

  if (outLightBackgroundContrastAlpha)
  {
    outLightBackgroundContrastAlpha.textContent = resolved.toFixed(2);
  }

  effect.updateConfig({ lightBackgroundContrastAlpha: resolved });

  if (persist)
  {
    lightBackgroundContrastOverride = true;
    localStorage.setItem(
      'bafx-ctrlLightBackgroundContrastAlpha',
      String(resolved),
    );
  }

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

if (ctrlHostCompositingSurface)
{
  ctrlHostCompositingSurface.addEventListener('change', () =>
  {
    const resolved = applyHostCompositingSurface(
      ctrlHostCompositingSurface.value,
    );

    localStorage.setItem('bafx-ctrlHostCompositingSurface', resolved);
  });
}

if (ctrlLightBackgroundContrastAlpha)
{
  ctrlLightBackgroundContrastAlpha.addEventListener('input', () =>
  {
    applyLightBackgroundContrastAlpha(
      ctrlLightBackgroundContrastAlpha.value,
    );
  });
}

// ── 特效参数 → setFxParam ──────────────────────────────────────────────
bindRange('ctrlRingHdr', 'outRingHdr', (v) => effect.setFxParam('rings.hdrIntensity', v));
bindRange('ctrlRingRadMin', 'outRingRadMin', (v) => effect.setFxParam('rings.radiusMin', v));
bindRange('ctrlRingRadMax', 'outRingRadMax', (v) => effect.setFxParam('rings.radiusMax', v));
bindRange('ctrlRingBandRatio', 'outRingBandRatio', (v) =>
  effect.setFxParam('rings.bandToOuterRadius', v));
bindRange('ctrlRingWStart', 'outRingWStart', (v) => effect.setFxParam('rings.widthStart', v));
bindRange('ctrlRingWEnd', 'outRingWEnd', (v) => effect.setFxParam('rings.widthEnd', v));
bindRange('ctrlRingLife', 'outRingLife', (v) => effect.setFxParam('rings.lifetimeMs', v), true);
bindRange('ctrlShardHdr', 'outShardHdr', (v) =>
  effect.setFxParam('shards.hdrIntensity', v));
bindRange('ctrlClickShards', 'outClickShards', (v) => effect.setFxParam('shards.clickCount', v), true);
bindRange('ctrlShardRoundness', 'outShardRoundness', (v) =>
  effect.setTriangleRoundness(v));
bindRange('ctrlShardSizeMin', 'outShardSizeMin', (v) =>
  effect.setFxParam('shards.sizeMin', v));
bindRange('ctrlShardSizeMax', 'outShardSizeMax', (v) =>
  effect.setFxParam('shards.sizeMax', v));
bindRange('ctrlClickShardRadius', 'outClickShardRadius', (v) =>
  effect.setFxParam('shards.clickRadius', v));
bindRange('ctrlClickShardSpeedMin', 'outClickShardSpeedMin', (v) =>
  effect.setFxParam('shards.clickSpeedMin', v));
bindRange('ctrlClickShardSpeedMax', 'outClickShardSpeedMax', (v) =>
  effect.setFxParam('shards.clickSpeedMax', v));
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
bindRange('ctrlShardSpacing', 'outShardSpacing', (v) =>
  effect.setFxParam('shards.trailSpacing', v));
bindRange('ctrlTrailShardRadius', 'outTrailShardRadius', (v) =>
  effect.setFxParam('shards.trailRadius', v));
bindRange('ctrlTrailShardSpeedMin', 'outTrailShardSpeedMin', (v) =>
  effect.setFxParam('shards.trailSpeedMin', v));
bindRange('ctrlTrailShardSpeedMax', 'outTrailShardSpeedMax', (v) =>
  effect.setFxParam('shards.trailSpeedMax', v));
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

function formatDissolveDirection(value, lang = currentLang)
{
  if (lang === 'en')
  {
    return value < 0 ? 'Reverse' : 'Forward';
  }

  return value < 0 ? '反向' : '正向';
}

bindRange('ctrlRingCount', 'outRingCount', (v) => effect.setFxParam('rings.count', v), true);
bindRange('ctrlDiskRadius', 'outDiskRadius', (v) => effect.setFxParam('disk.radius', v));
bindRange('ctrlDiskLife', 'outDiskLife', (v) => effect.setFxParam('disk.lifetimeMs', v), true);
bindRange('ctrlAngVelMul', 'outAngVelMul', (v) => effect.setFxParam('rings.angularVelocityMultiplier', v));
bindRange('ctrlArcSamples', 'outArcSamples', (v) => effect.setFxParam('rings.arcSamples', v), true);
bindRange('ctrlRadialSamples', 'outRadialSamples', (v) =>
  effect.setFxParam('rings.radialSamples', v), true);
bindRange('ctrlRingDir', 'outRingDir', (v) =>
{
  effect.setFxParam('rings.rotationDirection', Math.round(v));
  const out = document.getElementById('outRingDir');

  if (out)
  {
    out.textContent = formatRingDirection(v);
  }
});
bindRange('ctrlDissolveDir', 'outDissolveDir', (v) =>
{
  effect.setFxParam('rings.dissolveDirection', Math.round(v));
  const out = document.getElementById('outDissolveDir');

  if (out)
  {
    out.textContent = formatDissolveDirection(v);
  }
}, true);
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
bindRange('ctrlCornerVerts', 'outCornerVerts', (v) =>
  effect.setFxParam('trail.numCornerVertices', v), true);
bindRange('ctrlCapVerts', 'outCapVerts', (v) =>
  effect.setFxParam('trail.numCapVertices', v), true);
bindRange('ctrlTrailShardLifeMin', 'outTrailShardLifeMin', (v) => effect.setFxParam('shards.trailLifetimeMinMs', v), true);
bindRange('ctrlTrailShardLifeMax', 'outTrailShardLifeMax', (v) => effect.setFxParam('shards.trailLifetimeMaxMs', v), true);
bindRange('ctrlBloomDisk', 'outBloomDisk', (v) => effect.setFxParam('bloom.diskBlur', v));
bindRange('ctrlBloomSoftKnee', 'outBloomSoftKnee', (v) =>
  effect.setFxParam('bloom.softKnee', v));
bindRange('ctrlBloomClamp', 'outBloomClamp', (v) =>
  effect.setFxParam('bloom.clamp', v), true);
bindRange('ctrlBloomResolution', 'outBloomResolution', (v) =>
  effect.setFxParam('bloom.resolutionScale', v));
bindRange('ctrlBloomEmission', 'outBloomEmission', (v) =>
  effect.setFxParam('bloom.emissionRange', v));
bindRange('ctrlBloomDiskEmission', 'outBloomDiskEmission', (v) =>
  effect.setFxParam('bloom.diskEmission', v));
bindRange('ctrlBloomTrailEmission', 'outBloomTrailEmission', (v) =>
  effect.setFxParam('bloom.trailEmission', v));
bindRange('ctrlBloomTrailCoverage', 'outBloomTrailCoverage', (v) =>
  effect.setFxParam('bloom.trailCoverageScale', v));
bindRange('ctrlBloomRingCoreAlpha', 'outBloomRingCoreAlpha', (v) =>
  effect.setFxParam('bloom.ringEmissionAlpha', v));
bindRange('ctrlBloomDiskCoreAlpha', 'outBloomDiskCoreAlpha', (v) =>
  effect.setFxParam('bloom.diskEmissionAlpha', v));
bindRange('ctrlBloomRingAlpha', 'outBloomRingAlpha', (v) =>
  effect.setFxParam('bloom.ringAlpha', v));
bindRange('ctrlBloomDiskAlpha', 'outBloomDiskAlpha', (v) =>
  effect.setFxParam('bloom.diskAlpha', v));

// ── 主题颜色 ────────────────────────────────────────────────────────────
const ctrlColor = document.getElementById('ctrlColor');

if (ctrlColor)
{
  ctrlColor.addEventListener('input', () =>
  {
    effect.setThemeColor(ctrlColor.value);
    localStorage.setItem('bafx-ctrlColor', ctrlColor.value);
    syncHdrUiOverlay(effect.getConfig());
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
  syncHdrPresentationDetails(DEFAULT_RENDER_MODE);
  document.getElementById('ctrlHdrPresentationPreset').value = 'balanced';
  document.getElementById('ctrlHdrUiEnabled').checked = true;
  document.getElementById('ctrlHdrUiBrightness').value =
    String(DEFAULT_HDR_UI_BRIGHTNESS);
  document.getElementById('outHdrUiBrightness').textContent =
    DEFAULT_HDR_UI_BRIGHTNESS.toFixed(2);
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
  if (ctrlHostCompositingSurface)
  {
    ctrlHostCompositingSurface.value = DEFAULT_HOST_COMPOSITING_SURFACE;
  }
  syncTransparentCompositingControlState(DEFAULT_OUTPUT_COMPOSITING);
  document.getElementById('ctrlInputSource').value = 'dom';
  applyInputSamplingRate(DEFAULT_INPUT_SAMPLING_RATE, false);
  document.getElementById('ctrlClickTimeScale').value = '1';
  document.getElementById('outClickTimeScale').textContent = '1.00';
  document.getElementById('ctrlTrailTimeScale').value = '1';
  document.getElementById('outTrailTimeScale').textContent = '1.00';
  document.getElementById('ctrlPaused').checked = false;
  document.getElementById('ctrlPauseClear').checked = false;
  document.getElementById('ctrlIsolatedCompositing').checked = false;
  lightBackgroundContrastOverride = false;
  if (ctrlLightBackgroundContrastAlpha)
  {
    ctrlLightBackgroundContrastAlpha.value =
      String(DEFAULT_LIGHT_BACKGROUND_CONTRAST_ALPHA);
  }
  if (outLightBackgroundContrastAlpha)
  {
    outLightBackgroundContrastAlpha.textContent =
      DEFAULT_LIGHT_BACKGROUND_CONTRAST_ALPHA.toFixed(2);
  }
  if (ctrlTouchAction)
  {
    ctrlTouchAction.value = 'auto';
  }
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
  const shardDefaults = UNITY_FX_TOUCH.shards;
  const fxDefaults = [
    ['ctrlRingHdr', 'outRingHdr', 5.992157, false],
    ['ctrlRingRadMin', 'outRingRadMin', 68.92571232, false],
    ['ctrlRingRadMax', 'outRingRadMax', 80.41333104, false],
    ['ctrlRingBandRatio', 'outRingBandRatio', 0.0598573766034603, false],
    ['ctrlRingWStart', 'outRingWStart', 1, false],
    ['ctrlRingWEnd', 'outRingWEnd', 1, false],
    ['ctrlRingLife', 'outRingLife', 600, true],
    ['ctrlShardHdr', 'outShardHdr', shardDefaults.hdrIntensity, false],
    ['ctrlShardRoundness', 'outShardRoundness', shardDefaults.roundness, false],
    ['ctrlShardSizeMin', 'outShardSizeMin', shardDefaults.sizeMin, false],
    ['ctrlShardSizeMax', 'outShardSizeMax', shardDefaults.sizeMax, false],
    ['ctrlClickShards', 'outClickShards', shardDefaults.clickCount, true],
    ['ctrlClickShardLifeMin', 'outClickShardLifeMin', shardDefaults.clickLifetimeMinMs, true],
    ['ctrlClickShardLifeMax', 'outClickShardLifeMax', shardDefaults.clickLifetimeMaxMs, true],
    ['ctrlClickShardRadius', 'outClickShardRadius', shardDefaults.clickRadius, false],
    ['ctrlClickShardSpeedMin', 'outClickShardSpeedMin', shardDefaults.clickSpeedMin, false],
    ['ctrlClickShardSpeedMax', 'outClickShardSpeedMax', shardDefaults.clickSpeedMax, false],
    ['ctrlShardSpacing', 'outShardSpacing', shardDefaults.trailSpacing, false],
    ['ctrlMaxShards', 'outMaxShards', shardDefaults.maxCount, true],
    ['ctrlTrailShardLifeMin', 'outTrailShardLifeMin', shardDefaults.trailLifetimeMinMs, true],
    ['ctrlTrailShardLifeMax', 'outTrailShardLifeMax', shardDefaults.trailLifetimeMaxMs, true],
    ['ctrlTrailShardRadius', 'outTrailShardRadius', shardDefaults.trailRadius, false],
    ['ctrlTrailShardSpeedMin', 'outTrailShardSpeedMin', shardDefaults.trailSpeedMin, false],
    ['ctrlTrailShardSpeedMax', 'outTrailShardSpeedMax', shardDefaults.trailSpeedMax, false],
    ['ctrlBloomRing', 'outBloomRing', 80, false],
    ['ctrlBloomThreshold', 'outBloomThreshold', 1, false],
    ['ctrlBloomIntensity', 'outBloomIntensity', 1.7, false],
    ['ctrlBloomDiffusion', 'outBloomDiffusion', 7, false],
    ['ctrlClickGlow', 'outClickGlow', 1, false],
    ['ctrlTrailW', 'outTrailW', 2.7, false],
    ['ctrlTrailGlowW', 'outTrailGlowW', 9, false],
    ['ctrlTrailLife', 'outTrailLife', 300, true],
    ['ctrlBloomTrail', 'outBloomTrail', 1, false],
    ['ctrlTrailOpacity', 'outTrailOpacity', 1, false],
    // 新暴露参数
    ['ctrlRingCount', 'outRingCount', 2, true],
    ['ctrlDiskRadius', 'outDiskRadius', 64.8, false],
    ['ctrlDiskLife', 'outDiskLife', 200, true],
    ['ctrlAngVelMul', 'outAngVelMul', 11.17, false],
    ['ctrlArcSamples', 'outArcSamples', 96, true],
    ['ctrlRadialSamples', 'outRadialSamples', 8, true],
    ['ctrlRingDir', 'outRingDir', -1, true],
    ['ctrlDissolveDir', 'outDissolveDir', 1, true],
    ['ctrlHitRadius', 'outHitRadius', 24, false],
    ['ctrlHitLife', 'outHitLife', 80, true],
    ['ctrlFlareRadius', 'outFlareRadius', 36, false],
    ['ctrlFlareLife', 'outFlareLife', 150, true],
    ['ctrlFlareRays', 'outFlareRays', 6, true],
    ['ctrlGeomWidth', 'outGeomWidth', 2.7, false],
    ['ctrlMinVertDist', 'outMinVertDist', 5.4, false],
    ['ctrlCornerVerts', 'outCornerVerts', 4, true],
    ['ctrlCapVerts', 'outCapVerts', 1, true],
    ['ctrlBloomDisk', 'outBloomDisk', 65, false],
    ['ctrlBloomSoftKnee', 'outBloomSoftKnee', 0, false],
    ['ctrlBloomClamp', 'outBloomClamp', 65472, true],
    ['ctrlBloomResolution', 'outBloomResolution', 0.5, false],
    ['ctrlBloomEmission', 'outBloomEmission', 23.968628, false],
    ['ctrlBloomDiskEmission', 'outBloomDiskEmission', 2, false],
    ['ctrlBloomTrailEmission', 'outBloomTrailEmission', 23.968628, false],
    ['ctrlBloomTrailCoverage', 'outBloomTrailCoverage', 1, false],
    ['ctrlBloomRingCoreAlpha', 'outBloomRingCoreAlpha', 1, false],
    ['ctrlBloomDiskCoreAlpha', 'outBloomDiskCoreAlpha', 1, false],
    ['ctrlBloomRingAlpha', 'outBloomRingAlpha', 0.35, false],
    ['ctrlBloomDiskAlpha', 'outBloomDiskAlpha', 0.65, false],
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
  document.getElementById('outDissolveDir').textContent =
    formatDissolveDirection(1);

  effect.resetFxConfig();
  effect.setPaused(false);
  applyInputSource('dom', false);
  compositingReferenceMode = DEFAULT_COMPOSITING_REFERENCE_MODE;

  effect.updateConfig(
    {
      clickTimeScale: 1,
      trailTimeScale: 1,
      inputSamplingRate: DEFAULT_INPUT_SAMPLING_RATE,
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
      hostCompositingSurface: DEFAULT_HOST_COMPOSITING_SURFACE,
      isolatedCompositing: false,
      lightBackgroundContrastAlpha: DEFAULT_LIGHT_BACKGROUND_CONTRAST_ALPHA,
      maxDpr: 2,
      touchAction: 'auto',
    },
  );
  applyHdrUiSettings(
    { enabled: true, brightness: DEFAULT_HDR_UI_BRIGHTNESS },
    false,
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
    displaySummary: '显示',
    sectionTheme: '背景主题',
    themeBlue: '蔚蓝（默认）',
    themePurple: '深紫',
    themeGreen: '深绿',
    themeGold: '暖金',
    themeBlack: '纯黑',
    themeWhite: '纯白',
    themeCustom: '自定义',
    sectionClick: '点击特效',
    sectionShards: '碎片',
    sectionTrail: '拖尾轨迹',
    sectionBloom: 'Bloom',
    ringSummary: '圆环',
    diskSummary: '光盘',
    hitFlareSummary: 'Hit / Flare',
    sharedShardsSummary: '通用参数',
    clickShardsSummary: '点击碎片',
    trailShardsSummary: '拖尾碎片',
    trailLayerSummary: '轨迹图层',
    bloomPipelineSummary: '全局 Bloom',
    bloomClickSummary: '点击辉光',
    bloomTrailSummary: '拖尾辉光',
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
    hostCompositingPlusLighter: 'Plus-lighter（原始加色）',
    labelHostCompositingSurface: '宿主表面',
    hostSurfaceDomBackdrop: 'DOM 背景',
    hostSurfaceTransparentWindow: '透明窗口',
    hostSurfaceNative: '原生合成器',
    transparentCompositingNote: 'Screen 会自适应亮底；Plus-lighter 保留更激进的加色；独立宿主合成会停用 Alpha 策略、颜色补偿和 Alpha 上限。透明覆盖层策略都是浏览器视觉近似。',
    labelCompositingReference: '特效背景参考',
    compositingReferenceMatchPage: '匹配当前页面（精确）',
    compositingReferenceUnknown: '未知透明背景（兼容）',
    compositingReferenceMatchedStatus: '正在使用与当前页面匹配的合成参考。',
    compositingReferenceUnknownStatus: '未知背景兼容输出：亮度会随宿主背景变化。',
    compositingReferenceUnavailableStatus: '当前页面背景无法作为合成参考，已使用未知背景输出。',
    labelIsolatedCompositing: '隔离合成',
    labelLightBackgroundContrastAlpha: '浅色背景对比',
    hostApiSummary: '宿主控制 API',
    labelInputSource: '输入来源',
    inputSourceDom: 'DOM 自动监听',
    inputSourceManual: '手动注入',
    labelInputSamplingRate: '输入采样率上限 (Hz)',
    labelClickTimeScale: '点击速度',
    labelTrailTimeScale: '拖尾速度',
    labelPaused: '暂停输入与动画',
    labelPauseClear: '暂停时清屏',
    labelTouchAction: '触摸行为',
    touchActionAuto: '自动',
    touchActionNone: '禁止默认手势',
    touchActionPanX: '仅横向平移',
    touchActionPanY: '仅纵向平移',
    touchActionManipulation: '直接操作',
    hostApiDom: 'DOM 模式：库自动监听 window 指针事件。',
    hostApiManual: '手动模式：展示页通过公开 pointer API 注入输入。',
    hostApiPaused: '已暂停：输入和 RAF 已停止。',
    hostApiConfigCopied: '当前配置已复制到剪贴板。',
    hostApiConfigCopyFailed: '无法访问剪贴板，请检查浏览器权限。',
    hostApiParamsApplied: '当前参数已通过批量 API 原子应用。',
    hostApiParamsApplyFailed: '参数批量应用失败，当前配置未改变。',
    confirmDestroyInstance: '销毁当前特效实例并刷新展示页？',
    btnTriggerBoom: '触发中心点击',
    btnClearTrail: '清除拖尾',
    btnClearEffects: '清除全部',
    btnCopyConfig: '复制当前配置',
    btnApplyFxParams: '原子应用参数',
    btnDestroyInstance: '销毁并刷新',
    renderCanvas2D: 'Canvas 2D',
    renderFullWebGPUStandard: 'WebGPU',
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
    renderWebGPUOutputUnavailable: 'WebGPU Canvas 不可用',
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
    webgpuDiagnosticSummary: 'WebGPU 诊断详情',
    diagnosticSecureContextLabel: '页面环境',
    diagnosticWebGPUApiLabel: 'WebGPU API',
    diagnosticCanvasContextLabel: 'Canvas Context',
    diagnosticAdapterLabel: 'Adapter',
    diagnosticDeviceLabel: 'Device',
    diagnosticExtendedCanvasLabel: 'Extended Canvas',
    diagnosticSdrFallbackLabel: 'Standard SDR',
    diagnosticPipelineLabel: '渲染管线',
    diagnosticGraphicsRangeLabel: '图形动态范围',
    diagnosticVideoRangeLabel: '视频动态范围',
    diagnosticCssHdrLabel: 'CSS HDR 语法',
    diagnosticSecure: '安全上下文',
    diagnosticInsecure: '非安全上下文',
    diagnosticAvailable: '可用',
    diagnosticReady: '就绪',
    diagnosticPending: '正在检测',
    diagnosticFailed: '失败',
    diagnosticLost: '设备已丢失',
    diagnosticSkipped: '未请求',
    diagnosticNotTested: '尚未检测',
    diagnosticInactive: '未启用',
    diagnosticUnavailable: '不可用',
    diagnosticExtendedActive: '已启用 · rgba16float',
    diagnosticExtendedRejected: '配置被拒绝',
    diagnosticNotNeeded: '无需回退',
    diagnosticSdrActive: '已启用 · {format}',
    diagnosticPipelineActive: '就绪 · 首帧已提交',
    diagnosticPipelineWaiting: '资源就绪 · 等待首帧',
    diagnosticPipelineFallback: '已回退 · {backend}',
    diagnosticRangeHigh: 'High（浏览器报告）',
    diagnosticRangeNotHigh: '未报告 High',
    diagnosticUnknown: '浏览器未提供',
    diagnosticSupported: '支持',
    diagnosticUnsupported: '不支持',
    diagnosticFailure: '最近失败：{stage} · {message}',
    diagnosticFailureUnknown: '浏览器未提供详细原因',
    diagnosticNote: '视频动态范围报告 High 不代表 WebGPU Canvas HDR 可用。',
    hdrPresentationHeading: 'HDR 显示映射',
    labelHdrPresentationPreset: '高光预设',
    hdrPresentationPresetBalanced: '平衡白核（默认）',
    hdrPresentationPresetBright: '明亮白核',
    hdrPresentationPresetColor: '保留原始色相',
    hdrPresentationPresetCustom: '自定义',
    labelWebGPUHdrPeak: '线性峰值',
    labelWebGPUHdrBrightness: 'HDR 整体亮度',
    labelWebGPUHdrColorPreservation: 'HDR 色相保持',
    labelWebGPUHdrWhiteCore: '白核强度',
    labelWebGPUHdrWhiteStart: '白核起点',
    labelWebGPUHdrWhiteEnd: '白核终点',
    labelHdrUiEnabled: 'HDR UI 高光',
    labelHdrUiBrightness: 'UI HDR 亮度',
    labelClickEnabled: '启用点击特效',
    labelRingHdr: '圆环 HDR 强度',
    labelRingRadMin: '圆环起始半径',
    labelRingRadMax: '圆环终止半径',
    labelRingBandRatio: '圆环带宽比例',
    labelRingWStart: '圆环起始厚度倍率',
    labelRingWEnd: '圆环终止厚度倍率',
    labelRingLife: '圆环寿命',
    labelShardHdr: '碎片 HDR 强度',
    labelShardSizeMin: '碎片最小尺寸',
    labelShardSizeMax: '碎片最大尺寸',
    labelClickShards: '点击碎片数量',
    labelShardRoundness: '碎片圆角',
    labelClickShardRadius: '点击发射半径',
    labelClickShardSpeedMin: '点击碎片最低速度',
    labelClickShardSpeedMax: '点击碎片最高速度',
    labelTrailShardRadius: '拖尾发射半径',
    labelTrailShardSpeedMin: '拖尾碎片最低速度',
    labelTrailShardSpeedMax: '拖尾碎片最高速度',
    labelMaxShards: '拖尾碎片上限',
    labelBloomRing: '原生圆环模糊',
    labelBloomThreshold: 'Bloom 阈值',
    labelBloomSoftKnee: 'Bloom 柔化膝点',
    labelBloomClamp: 'Bloom 亮度钳位',
    labelBloomIntensity: 'Bloom 强度',
    labelBloomDiffusion: 'Bloom 扩散',
    labelBloomResolution: 'Bloom 分辨率倍率',
    labelBloomEmission: 'Bloom 发射范围',
    labelClickGlow: '点击辉光强度',
    labelBloomDiskEmission: '光盘发射强度',
    labelBloomRingCoreAlpha: '圆环核心发射 Alpha',
    labelBloomDiskCoreAlpha: '光盘核心发射 Alpha',
    labelBloomRingAlpha: '圆环辉光 Alpha',
    labelBloomDiskAlpha: '光盘辉光 Alpha',
    labelTrailEnabled: '启用拖尾',
    labelTrailAlways: '始终显示',
    labelTrailW: '拖尾宽度',
    labelTrailGlowW: '外发光宽度',
    labelTrailLife: '拖尾寿命',
    labelShardSpacing: '拖尾碎片间距',
    labelBloomTrail: 'Bloom 拖尾发射校准',
    labelBloomTrailEmission: '拖尾发射强度',
    labelBloomTrailCoverage: '拖尾覆盖倍率',
    labelTrailOpacity: '拖尾整体透明度',
    labelRingCount: '圆环数量',
    labelDiskRadius: '光盘半径',
    labelDiskLife: '光盘寿命',
    labelAngVelMul: '旋转速度倍率',
    labelArcSamples: '弧线采样精度',
    labelRadialSamples: '径向采样精度',
    labelRingDir: '旋转方向',
    labelDissolveDir: '溶解方向',
    labelClickShardLifeMin: '点击碎片最短寿命',
    labelClickShardLifeMax: '点击碎片最长寿命',
    labelGeomWidth: '几何带宽',
    labelMinVertDist: '最小采样间距',
    labelCornerVerts: '折点圆角顶点数',
    labelCapVerts: '端帽顶点数',
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
    introP2: '从 Unity FX_Touch.prefab 逐参数移植，默认使用纯 WebGL2，可选标准 WebGPU 与 WebGPU 真实 HDR，并提供 WebGL2 Bloom、软件 Bloom、原生辉光和 Legacy 回退路径。零外部运行时依赖。',
    introInstallSummary: '安装方式 / Installation',
    introInstallContent: '<p><strong>npm</strong></p><pre><code>npm install ba-click-fx</code></pre><p><strong>CDN</strong></p><pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.24/dist/ba-click-fx.iife.js"&gt;&lt;/script&gt;</code></pre>',
    introFAQSummary: '常见问题 / FAQ',
    introWebGPUFAQContent: '<p><strong>WebGPU 一定会显示真实 HDR 吗？</strong> 不会。只有 <code>resolvedWebGPUOutputMode === \'extended\'</code> 才表示 Canvas 会以扩展 sRGB 编码保留超过 SDR 白色的高光；还需要 HDR 显示器、系统 HDR 和浏览器 WebGPU HDR Canvas 同时可用。</p>',
    introFAQContent: '<p><strong>和蔚蓝档案有关吗？</strong> 粉丝向视觉特效库，粒子参数从游戏 Unity Prefab 逐项提取。</p><p><strong>需要素材或 WebGL？</strong> 特效本身不需要图片素材。默认使用纯 WebGL2；能力不足时会自动回退 Canvas 2D、软件 Bloom 与原生辉光。</p><p><strong>内置主题和自定义图片背景怎样参与游戏式合成？</strong> 页面主题始终由 CSS 单独显示。“特效背景参考”可选“匹配当前页面”或“未知透明背景”：前者把内置主题或已解码图片传入渲染器，后者调用 <code>setCompositingReference(null)</code> 并保留透明宿主的 Coverage 合同。纯白主题在关闭“隔离合成”时保留接近游戏原始的低可见度；开启后会自动使用 <code>lightBackgroundContrastAlpha: 0.35</code> 补足网页白底可见性。已解码图片通过 <code>setCompositingReference(image, { fit: \'cover\' })</code> 提供给纯 WebGL2、WebGL2 Bloom，以及原生辉光/Legacy 的 Canvas Final Pass。跨域图片必须允许 CORS；本地图片选择器会生成当前页面的 <code>blob:</code> URL，不需要 CORS，但刷新后需要重新选择。手输 <code>file://</code> 会交给允许读取本地协议且允许作为 Canvas/WebGL 纹理使用的受信任桌面宿主；普通 HTTP/HTTPS 页面仍受浏览器本地资源权限限制，请使用本地图片选择器。</p><p><strong>透明桌面应怎样选择合成模式？</strong> 展示页和严格游戏还原保留默认 <code>scene</code>；WebView2、Electron 等透明宿主显式使用 <code>browser-overlay</code>。未知背景下，标准 <code>source-over</code> 无法同时实现严格 Unity 加色、纯 Coverage Alpha 和白底绝不变暗；隔离合成不会读取桌面，已知背景应通过 <code>setCompositingReference()</code> 提供给渲染器。</p><p><strong>纯白背景下特效颜色太浅？</strong> 关闭“隔离合成”时会保留游戏原始的低可见度表现；开启后，展示页自动叠加不参与 Bloom 的淡青对比轮廓，使效果在常见网页白底上保持可见。其他宿主也可按需显式设置 <code>lightBackgroundContrastAlpha</code>。</p><p><strong>能用在博客或个人主页吗？</strong> 可以，支持 npm、CDN 和 script 引入。</p>',
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
    displaySummary: 'Display',
    sectionTheme: 'Background Theme',
    themeBlue: 'Blue (Default)',
    themePurple: 'Deep Purple',
    themeGreen: 'Deep Green',
    themeGold: 'Warm Gold',
    themeBlack: 'Pure Black',
    themeWhite: 'Pure White',
    themeCustom: 'Custom',
    sectionClick: 'Click Effect',
    sectionShards: 'Shards',
    sectionTrail: 'Cursor Trail',
    sectionBloom: 'Bloom',
    ringSummary: 'Ring',
    diskSummary: 'Disk',
    hitFlareSummary: 'Hit / Flare',
    sharedShardsSummary: 'Shared',
    clickShardsSummary: 'Click Shards',
    trailShardsSummary: 'Trail Shards',
    trailLayerSummary: 'Trail Layer',
    bloomPipelineSummary: 'Global Bloom',
    bloomClickSummary: 'Click Glow',
    bloomTrailSummary: 'Trail Glow',
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
    hostCompositingPlusLighter: 'Plus-lighter (Original Additive)',
    labelHostCompositingSurface: 'Host Surface',
    hostSurfaceDomBackdrop: 'DOM Backdrop',
    hostSurfaceTransparentWindow: 'Transparent Window',
    hostSurfaceNative: 'Native Compositor',
    transparentCompositingNote: 'Screen adapts to light backdrops; Plus-lighter preserves more aggressive additive output. Independent host compositing disables the Alpha policy, color compensation, and Alpha limit; transparent-overlay policies are browser approximations.',
    labelCompositingReference: 'Effect Reference',
    compositingReferenceMatchPage: 'Current Page (Exact)',
    compositingReferenceUnknown: 'Unknown Background',
    compositingReferenceMatchedStatus: 'Using a compositing reference matched to the current page.',
    compositingReferenceUnknownStatus: 'Unknown-background output: brightness varies with the host background.',
    compositingReferenceUnavailableStatus: 'The current page cannot provide a compositing reference; using unknown-background output.',
    labelIsolatedCompositing: 'Isolated Compositing',
    labelLightBackgroundContrastAlpha: 'Light-background Contrast',
    hostApiSummary: 'Host Control API',
    labelInputSource: 'Input Source',
    inputSourceDom: 'DOM Listeners',
    inputSourceManual: 'Manual Injection',
    labelInputSamplingRate: 'Input Sampling Rate Limit (Hz)',
    labelClickTimeScale: 'Click Speed',
    labelTrailTimeScale: 'Trail Speed',
    labelPaused: 'Pause Input & Animation',
    labelPauseClear: 'Clear When Paused',
    labelTouchAction: 'Touch Action',
    touchActionAuto: 'Auto',
    touchActionNone: 'Disable Default Gestures',
    touchActionPanX: 'Pan X Only',
    touchActionPanY: 'Pan Y Only',
    touchActionManipulation: 'Manipulation',
    hostApiDom: 'DOM mode: the library listens for window pointer events.',
    hostApiManual: 'Manual mode: the demo injects input through the public pointer API.',
    hostApiPaused: 'Paused: input and RAF scheduling are stopped.',
    hostApiConfigCopied: 'Current configuration copied to the clipboard.',
    hostApiConfigCopyFailed: 'Clipboard access failed; check browser permissions.',
    hostApiParamsApplied: 'Current parameters were applied atomically through the batch API.',
    hostApiParamsApplyFailed: 'Batch parameter application failed; the current configuration was unchanged.',
    confirmDestroyInstance: 'Destroy the current effect instance and reload the demo?',
    btnTriggerBoom: 'Trigger Center Click',
    btnClearTrail: 'Clear Trail',
    btnClearEffects: 'Clear All',
    btnCopyConfig: 'Copy Current Config',
    btnApplyFxParams: 'Apply Parameters Atomically',
    btnDestroyInstance: 'Destroy and Reload',
    renderCanvas2D: 'Canvas 2D',
    renderFullWebGPUStandard: 'WebGPU',
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
    renderWebGPUOutputUnavailable: 'WebGPU Canvas unavailable',
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
    webgpuDiagnosticSummary: 'WebGPU Diagnostics',
    diagnosticSecureContextLabel: 'Page Context',
    diagnosticWebGPUApiLabel: 'WebGPU API',
    diagnosticCanvasContextLabel: 'Canvas Context',
    diagnosticAdapterLabel: 'Adapter',
    diagnosticDeviceLabel: 'Device',
    diagnosticExtendedCanvasLabel: 'Extended Canvas',
    diagnosticSdrFallbackLabel: 'Standard SDR',
    diagnosticPipelineLabel: 'Render Pipeline',
    diagnosticGraphicsRangeLabel: 'Graphics Range',
    diagnosticVideoRangeLabel: 'Video Range',
    diagnosticCssHdrLabel: 'CSS HDR Syntax',
    diagnosticSecure: 'Secure context',
    diagnosticInsecure: 'Insecure context',
    diagnosticAvailable: 'Available',
    diagnosticReady: 'Ready',
    diagnosticPending: 'Detecting',
    diagnosticFailed: 'Failed',
    diagnosticLost: 'Device lost',
    diagnosticSkipped: 'Not requested',
    diagnosticNotTested: 'Not tested',
    diagnosticInactive: 'Inactive',
    diagnosticUnavailable: 'Unavailable',
    diagnosticExtendedActive: 'Active · rgba16float',
    diagnosticExtendedRejected: 'Configuration rejected',
    diagnosticNotNeeded: 'Not needed',
    diagnosticSdrActive: 'Active · {format}',
    diagnosticPipelineActive: 'Ready · first frame submitted',
    diagnosticPipelineWaiting: 'Resources ready · awaiting first frame',
    diagnosticPipelineFallback: 'Fell back · {backend}',
    diagnosticRangeHigh: 'High (reported by browser)',
    diagnosticRangeNotHigh: 'High not reported',
    diagnosticUnknown: 'Not exposed by browser',
    diagnosticSupported: 'Supported',
    diagnosticUnsupported: 'Unsupported',
    diagnosticFailure: 'Latest failure: {stage} · {message}',
    diagnosticFailureUnknown: 'No detailed reason exposed by browser',
    diagnosticNote: 'Video range reporting High does not imply HDR WebGPU Canvas availability.',
    hdrPresentationHeading: 'HDR Presentation Mapping',
    labelHdrPresentationPreset: 'Highlight Preset',
    hdrPresentationPresetBalanced: 'Balanced White Core (Default)',
    hdrPresentationPresetBright: 'Bright White Core',
    hdrPresentationPresetColor: 'Preserve Original Hue',
    hdrPresentationPresetCustom: 'Custom',
    labelWebGPUHdrPeak: 'Linear Peak',
    labelWebGPUHdrBrightness: 'HDR Overall Brightness',
    labelWebGPUHdrColorPreservation: 'HDR Hue Preservation',
    labelWebGPUHdrWhiteCore: 'White-core Strength',
    labelWebGPUHdrWhiteStart: 'White-core Start',
    labelWebGPUHdrWhiteEnd: 'White-core End',
    labelHdrUiEnabled: 'HDR UI Highlights',
    labelHdrUiBrightness: 'UI HDR Brightness',
    labelClickEnabled: 'Enable Click',
    labelRingHdr: 'Ring HDR Intensity',
    labelRingRadMin: 'Ring Radius Min',
    labelRingRadMax: 'Ring Radius Max',
    labelRingBandRatio: 'Ring Band Ratio',
    labelRingWStart: 'Ring Start Width Scale',
    labelRingWEnd: 'Ring End Width Scale',
    labelRingLife: 'Ring Lifetime',
    labelShardHdr: 'Shard HDR Intensity',
    labelShardSizeMin: 'Shard Size Min',
    labelShardSizeMax: 'Shard Size Max',
    labelClickShards: 'Click Shard Count',
    labelShardRoundness: 'Shard Roundness',
    labelClickShardRadius: 'Click Emission Radius',
    labelClickShardSpeedMin: 'Click Shard Speed Min',
    labelClickShardSpeedMax: 'Click Shard Speed Max',
    labelTrailShardRadius: 'Trail Emission Radius',
    labelTrailShardSpeedMin: 'Trail Shard Speed Min',
    labelTrailShardSpeedMax: 'Trail Shard Speed Max',
    labelMaxShards: 'Trail Shard Limit',
    labelBloomRing: 'Native Ring Blur',
    labelBloomThreshold: 'Bloom Threshold',
    labelBloomSoftKnee: 'Bloom Soft Knee',
    labelBloomClamp: 'Bloom Clamp',
    labelBloomIntensity: 'Bloom Intensity',
    labelBloomDiffusion: 'Bloom Diffusion',
    labelBloomResolution: 'Bloom Resolution Scale',
    labelBloomEmission: 'Bloom Emission Range',
    labelClickGlow: 'Click Glow Strength',
    labelBloomDiskEmission: 'Disk Emission Strength',
    labelBloomRingCoreAlpha: 'Ring Core Emission Alpha',
    labelBloomDiskCoreAlpha: 'Disk Core Emission Alpha',
    labelBloomRingAlpha: 'Ring Glow Alpha',
    labelBloomDiskAlpha: 'Disk Glow Alpha',
    labelTrailEnabled: 'Enable Trail',
    labelTrailAlways: 'Always Show',
    labelTrailW: 'Trail Width',
    labelTrailGlowW: 'Outer Glow Width',
    labelTrailLife: 'Trail Lifetime',
    labelShardSpacing: 'Trail Shard Spacing',
    labelBloomTrail: 'Bloom Trail Emission Scale',
    labelBloomTrailEmission: 'Trail Emission Strength',
    labelBloomTrailCoverage: 'Trail Coverage Scale',
    labelTrailOpacity: 'Trail Overall Opacity',
    labelRingCount: 'Ring Count',
    labelDiskRadius: 'Disk Radius',
    labelDiskLife: 'Disk Lifetime',
    labelAngVelMul: 'Rotation Speed',
    labelArcSamples: 'Arc Samples',
    labelRadialSamples: 'Radial Samples',
    labelRingDir: 'Rotation Direction',
    labelDissolveDir: 'Dissolve Direction',
    labelClickShardLifeMin: 'Click Shard Life Min',
    labelClickShardLifeMax: 'Click Shard Life Max',
    labelGeomWidth: 'Geometry Width',
    labelMinVertDist: 'Min Vertex Distance',
    labelCornerVerts: 'Corner Vertices',
    labelCapVerts: 'Cap Vertices',
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
    introP2: 'Ported from Unity FX_Touch.prefab with Full WebGL2 by default, optional standard WebGPU and real WebGPU HDR, plus WebGL2 Bloom, Software Bloom, Native Glow, and Legacy fallbacks. Zero runtime dependencies.',
    introInstallSummary: '安装方式 / Installation',
    introInstallContent: '<p><strong>npm</strong></p><pre><code>npm install ba-click-fx</code></pre><p><strong>CDN</strong></p><pre><code>&lt;script src="https://cdn.jsdelivr.net/npm/ba-click-fx@1.2.24/dist/ba-click-fx.iife.js"&gt;&lt;/script&gt;</code></pre>',
    introFAQSummary: '常见问题 / FAQ',
    introWebGPUFAQContent: '<p><strong>Does WebGPU always produce real HDR?</strong> No. Only <code>resolvedWebGPUOutputMode === \'extended\'</code> means the Canvas preserves highlights above SDR white in extended sRGB; an HDR display, system HDR, and browser WebGPU HDR Canvas support are also required.</p>',
    introFAQContent: '<p><strong>Is it related to Blue Archive?</strong> A fan-made VFX library with parameters extracted from the game Unity Prefab.</p><p><strong>Needs assets or WebGL?</strong> The effect itself needs no image assets. Full WebGL2 is the default; unsupported environments fall back to Canvas 2D, Software Bloom, and Native Glow.</p><p><strong>How do built-in themes and custom images join the game-style composite?</strong> The page theme always remains a separate CSS concern. Effect Reference offers Current Page or Unknown Background: the former supplies a built-in theme or decoded image to the renderer, while the latter calls <code>setCompositingReference(null)</code> and preserves the Coverage contract for a transparent host. With Isolated Compositing off, Pure White keeps the lower-visibility result closest to the game original. With it on, the demo automatically uses <code>lightBackgroundContrastAlpha: 0.35</code> to keep the effect visible on ordinary web white backgrounds. Decoded images are passed to <code>setCompositingReference(image, { fit: \'cover\' })</code> for Full WebGL2, WebGL2 Bloom, and the Native/Legacy Canvas Final Pass. Cross-origin images must allow CORS. The local-image picker creates a page-session <code>blob:</code> URL, so it needs no CORS but must be selected again after a reload. A typed <code>file://</code> URL is passed through for desktop hosts that permit both local-protocol reads and Canvas/WebGL texture use; regular HTTP/HTTPS pages remain subject to browser local-resource permissions and should use the local-image picker.</p><p><strong>Which compositing mode should a transparent desktop use?</strong> The demo and strict game reproduction keep the default <code>scene</code>; transparent hosts such as WebView2 and Electron select <code>browser-overlay</code> explicitly. Over an unknown background, standard <code>source-over</code> cannot simultaneously provide strict Unity additive RGB, pure Coverage alpha, and no white-background darkening. Isolation cannot read desktop pixels; provide a known background with <code>setCompositingReference()</code>.</p><p><strong>Effects look washed out on a pure white background?</strong> With Isolated Compositing off, the demo preserves the game-original lower-visibility result. With it on, the demo adds a pale-cyan contrast outline outside Bloom so the effect remains visible on ordinary web white backgrounds. Other hosts can set <code>lightBackgroundContrastAlpha</code> explicitly as needed.</p><p><strong>Can I use it on my blog?</strong> Yes — npm, CDN, and direct script tag are all supported.</p>',
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

  // 面板重排后标题不能依赖 DOM 序号，否则新增分组会让翻译串位。
  const panelHeadingMap = {
    sectionBasicHeading: d.sectionBasic,
    displaySummary: d.displaySummary,
    themeSummary: d.sectionTheme,
    sectionClickHeading: d.sectionClick,
    ringSummary: d.ringSummary,
    diskSummary: d.diskSummary,
    hitFlareSummary: d.hitFlareSummary,
    sectionShardsHeading: d.sectionShards,
    sharedShardsSummary: d.sharedShardsSummary,
    clickShardsSummary: d.clickShardsSummary,
    trailShardsSummary: d.trailShardsSummary,
    sectionTrailHeading: d.sectionTrail,
    trailLayerSummary: d.trailLayerSummary,
    sectionBloomHeading: d.sectionBloom,
    bloomPipelineSummary: d.bloomPipelineSummary,
    bloomClickSummary: d.bloomClickSummary,
    bloomTrailSummary: d.bloomTrailSummary,
  };

  Object.entries(panelHeadingMap).forEach(([id, text]) =>
  {
    const heading = document.getElementById(id);

    if (heading)
    {
      heading.textContent = text;
    }
  });

  const themeTitleMap = {
    '蔚蓝': d.themeBlue,
    '深紫': d.themePurple,
    '深绿': d.themeGreen,
    '暖金': d.themeGold,
    '纯黑': d.themeBlack,
    '纯白': d.themeWhite,
    custom: d.themeCustom,
  };

  document.querySelectorAll('.theme-btn[data-theme]').forEach((button) =>
  {
    const title = themeTitleMap[button.dataset.theme];

    if (title)
    {
      button.title = title;
      button.setAttribute('aria-label', title);
    }
  });

  // 控件标签：span 中可能包含 <output>，只替换文本前缀
  const labelMap = {
    ctrlColor: d.labelColor,
    ctrlScale: d.labelScale,
    ctrlOpacity: d.labelOpacity,
    ctrlDpr: d.labelDpr,
    ctrlRenderMode: d.labelRenderMode,
    ctrlHdrPresentationPreset: d.labelHdrPresentationPreset,
    ctrlWebGPUHdrPeak: d.labelWebGPUHdrPeak,
    ctrlWebGPUHdrBrightness: d.labelWebGPUHdrBrightness,
    ctrlWebGPUHdrColorPreservation: d.labelWebGPUHdrColorPreservation,
    ctrlWebGPUHdrWhiteCore: d.labelWebGPUHdrWhiteCore,
    ctrlWebGPUHdrWhiteStart: d.labelWebGPUHdrWhiteStart,
    ctrlWebGPUHdrWhiteEnd: d.labelWebGPUHdrWhiteEnd,
    ctrlHdrUiEnabled: d.labelHdrUiEnabled,
    ctrlHdrUiBrightness: d.labelHdrUiBrightness,
    ctrlOutputCompositing: d.labelOutputCompositing,
    ctrlOverlayAlphaPolicy: d.labelOverlayAlphaPolicy,
    ctrlOverlayColorCompensation: d.labelOverlayColorCompensation,
    ctrlOverlayAlphaLimit: d.labelOverlayAlphaLimit,
    ctrlHostCompositing: d.labelHostCompositing,
    ctrlHostCompositingSurface: d.labelHostCompositingSurface,
    ctrlCompositingReference: d.labelCompositingReference,
    ctrlIsolatedCompositing: d.labelIsolatedCompositing,
    ctrlLightBackgroundContrastAlpha: d.labelLightBackgroundContrastAlpha,
    ctrlInputSource: d.labelInputSource,
    ctrlInputSamplingRate: d.labelInputSamplingRate,
    ctrlClickTimeScale: d.labelClickTimeScale,
    ctrlTrailTimeScale: d.labelTrailTimeScale,
    ctrlPaused: d.labelPaused,
    ctrlPauseClear: d.labelPauseClear,
    ctrlTouchAction: d.labelTouchAction,
    ctrlClick: d.labelClickEnabled,
    ctrlRingHdr: d.labelRingHdr,
    ctrlRingRadMin: d.labelRingRadMin,
    ctrlRingRadMax: d.labelRingRadMax,
    ctrlRingBandRatio: d.labelRingBandRatio,
    ctrlRingWStart: d.labelRingWStart,
    ctrlRingWEnd: d.labelRingWEnd,
    ctrlRingLife: d.labelRingLife,
    ctrlShardHdr: d.labelShardHdr,
    ctrlShardSizeMin: d.labelShardSizeMin,
    ctrlShardSizeMax: d.labelShardSizeMax,
    ctrlClickShards: d.labelClickShards,
    ctrlShardRoundness: d.labelShardRoundness,
    ctrlClickShardRadius: d.labelClickShardRadius,
    ctrlClickShardSpeedMin: d.labelClickShardSpeedMin,
    ctrlClickShardSpeedMax: d.labelClickShardSpeedMax,
    ctrlTrailShardRadius: d.labelTrailShardRadius,
    ctrlTrailShardSpeedMin: d.labelTrailShardSpeedMin,
    ctrlTrailShardSpeedMax: d.labelTrailShardSpeedMax,
    ctrlMaxShards: d.labelMaxShards,
    ctrlBloomRing: d.labelBloomRing,
    ctrlBloomThreshold: d.labelBloomThreshold,
    ctrlBloomSoftKnee: d.labelBloomSoftKnee,
    ctrlBloomClamp: d.labelBloomClamp,
    ctrlBloomIntensity: d.labelBloomIntensity,
    ctrlBloomDiffusion: d.labelBloomDiffusion,
    ctrlBloomResolution: d.labelBloomResolution,
    ctrlBloomEmission: d.labelBloomEmission,
    ctrlClickGlow: d.labelClickGlow,
    ctrlBloomDiskEmission: d.labelBloomDiskEmission,
    ctrlBloomRingCoreAlpha: d.labelBloomRingCoreAlpha,
    ctrlBloomDiskCoreAlpha: d.labelBloomDiskCoreAlpha,
    ctrlBloomRingAlpha: d.labelBloomRingAlpha,
    ctrlBloomDiskAlpha: d.labelBloomDiskAlpha,
    ctrlTrail: d.labelTrailEnabled,
    ctrlTrailAlways: d.labelTrailAlways,
    ctrlTrailW: d.labelTrailW,
    ctrlTrailGlowW: d.labelTrailGlowW,
    ctrlTrailLife: d.labelTrailLife,
    ctrlShardSpacing: d.labelShardSpacing,
    ctrlBloomTrail: d.labelBloomTrail,
    ctrlBloomTrailEmission: d.labelBloomTrailEmission,
    ctrlBloomTrailCoverage: d.labelBloomTrailCoverage,
    ctrlTrailOpacity: d.labelTrailOpacity,
    ctrlRingCount: d.labelRingCount,
    ctrlDiskRadius: d.labelDiskRadius,
    ctrlDiskLife: d.labelDiskLife,
    ctrlAngVelMul: d.labelAngVelMul,
    ctrlArcSamples: d.labelArcSamples,
    ctrlRadialSamples: d.labelRadialSamples,
    ctrlRingDir: d.labelRingDir,
    ctrlDissolveDir: d.labelDissolveDir,
    ctrlClickShardLifeMin: d.labelClickShardLifeMin,
    ctrlClickShardLifeMax: d.labelClickShardLifeMax,
    ctrlGeomWidth: d.labelGeomWidth,
    ctrlMinVertDist: d.labelMinVertDist,
    ctrlCornerVerts: d.labelCornerVerts,
    ctrlCapVerts: d.labelCapVerts,
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

  const dissolveDirectionControl = document.getElementById('ctrlDissolveDir');
  const dissolveDirectionOutput = document.getElementById('outDissolveDir');

  if (dissolveDirectionControl && dissolveDirectionOutput)
  {
    dissolveDirectionOutput.textContent = formatDissolveDirection(
      Number(dissolveDirectionControl.value),
      currentLang,
    );
  }

  // 渲染模式下拉选项文本
  const renderModeOptions = {
    'full-webgpu-sdr': d.renderFullWebGPUStandard,
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
    'plus-lighter': d.hostCompositingPlusLighter,
  };

  document.querySelectorAll('#ctrlHostCompositing option').forEach((option) =>
  {
    if (hostCompositingOptions[option.value])
    {
      option.textContent = hostCompositingOptions[option.value];
    }
  });

  const hostSurfaceOptions = {
    'dom-backdrop': d.hostSurfaceDomBackdrop,
    'transparent-window': d.hostSurfaceTransparentWindow,
    native: d.hostSurfaceNative,
  };

  document.querySelectorAll(
    '#ctrlHostCompositingSurface option',
  ).forEach((option) =>
  {
    if (hostSurfaceOptions[option.value])
    {
      option.textContent = hostSurfaceOptions[option.value];
    }
  });

  document.getElementById('transparentCompositingNote').textContent =
    d.transparentCompositingNote;

  const diagnosticLabels = {
    diagnosticSecureContextLabel: d.diagnosticSecureContextLabel,
    diagnosticWebGPUApiLabel: d.diagnosticWebGPUApiLabel,
    diagnosticCanvasContextLabel: d.diagnosticCanvasContextLabel,
    diagnosticAdapterLabel: d.diagnosticAdapterLabel,
    diagnosticDeviceLabel: d.diagnosticDeviceLabel,
    diagnosticExtendedCanvasLabel: d.diagnosticExtendedCanvasLabel,
    diagnosticSdrFallbackLabel: d.diagnosticSdrFallbackLabel,
    diagnosticPipelineLabel: d.diagnosticPipelineLabel,
    diagnosticGraphicsRangeLabel: d.diagnosticGraphicsRangeLabel,
    diagnosticVideoRangeLabel: d.diagnosticVideoRangeLabel,
    diagnosticCssHdrLabel: d.diagnosticCssHdrLabel,
  };

  for (const [id, text] of Object.entries(diagnosticLabels))
  {
    const element = document.getElementById(id);

    if (element)
    {
      element.textContent = text;
    }
  }

  document.getElementById('webgpuDiagnosticSummary').textContent =
    d.webgpuDiagnosticSummary;
  document.getElementById('webgpuDiagnosticNote').textContent =
    d.diagnosticNote;

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

  const touchActionOptions = {
    auto: d.touchActionAuto,
    none: d.touchActionNone,
    'pan-x': d.touchActionPanX,
    'pan-y': d.touchActionPanY,
    manipulation: d.touchActionManipulation,
  };

  document.querySelectorAll('#ctrlTouchAction option').forEach((option) =>
  {
    if (touchActionOptions[option.value])
    {
      option.textContent = touchActionOptions[option.value];
    }
  });

  // 按钮
  document.getElementById('hostApiSummary').textContent = d.hostApiSummary;
  document.getElementById('hdrPresentationHeading').textContent =
    d.hdrPresentationHeading;
  document.getElementById('btnReset').textContent = d.btnReset;
  document.getElementById('btnTriggerBoom').textContent = d.btnTriggerBoom;
  document.getElementById('btnClearTrail').textContent = d.btnClearTrail;
  document.getElementById('btnClearEffects').textContent = d.btnClearEffects;
  document.getElementById('btnCopyConfig').textContent = d.btnCopyConfig;
  document.getElementById('btnApplyFxParams').textContent =
    d.btnApplyFxParams;
  document.getElementById('btnDestroyInstance').textContent =
    d.btnDestroyInstance;
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
  const savedInputSamplingRate = localStorage.getItem(
    'bafx-ctrlInputSamplingRate',
  );

  applyInputSource(savedInputSource === 'manual' ? 'manual' : 'dom', false);
  applyInputSamplingRate(savedInputSamplingRate, false);

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

  const savedHdrUiBrightness = Number(
    localStorage.getItem('bafx-ctrlHdrUiBrightness'),
  );

  applyHdrUiSettings(
    {
      enabled: localStorage.getItem('bafx-ctrlHdrUiEnabled') !== 'false',
      brightness: Number.isFinite(savedHdrUiBrightness) &&
        savedHdrUiBrightness > 0
        ? savedHdrUiBrightness
        : DEFAULT_HDR_UI_BRIGHTNESS,
    },
    false,
  );

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

  const savedHostCompositingSurface = localStorage.getItem(
    'bafx-ctrlHostCompositingSurface',
  );

  applyHostCompositingSurface(savedHostCompositingSurface);

  const savedLightBackgroundContrastAlpha = localStorage.getItem(
    'bafx-ctrlLightBackgroundContrastAlpha',
  );

  if (
    savedLightBackgroundContrastAlpha !== null &&
    Number.isFinite(Number(savedLightBackgroundContrastAlpha))
  )
  {
    lightBackgroundContrastOverride = true;
    applyLightBackgroundContrastAlpha(
      savedLightBackgroundContrastAlpha,
      false,
    );
  }
  else
  {
    lightBackgroundContrastOverride = false;
    syncPureWhiteIsolationContrast();
  }

  const savedTouchAction = localStorage.getItem('bafx-ctrlTouchAction');

  if (ctrlTouchAction)
  {
    const resolvedTouchAction = TOUCH_ACTIONS.has(savedTouchAction)
      ? savedTouchAction
      : 'auto';

    ctrlTouchAction.value = resolvedTouchAction;
    effect.updateConfig({ touchAction: resolvedTouchAction });
  }

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
    ['ctrlRingBandRatio', 'rings.bandToOuterRadius'],
    ['ctrlRingWStart', 'rings.widthStart'],
    ['ctrlRingWEnd', 'rings.widthEnd'],
    ['ctrlRingLife', 'rings.lifetimeMs'],
    ['ctrlShardHdr', 'shards.hdrIntensity'],
    ['ctrlClickShards', 'shards.clickCount'],
    ['ctrlShardRoundness', 'shards.roundness'],
    ['ctrlShardSizeMin', 'shards.sizeMin'],
    ['ctrlShardSizeMax', 'shards.sizeMax'],
    ['ctrlClickShardRadius', 'shards.clickRadius'],
    ['ctrlClickShardSpeedMin', 'shards.clickSpeedMin'],
    ['ctrlClickShardSpeedMax', 'shards.clickSpeedMax'],
    ['ctrlMaxShards', 'shards.maxCount'],
    ['ctrlBloomRing', 'bloom.ringBlur'],
    ['ctrlBloomThreshold', 'bloom.threshold'],
    ['ctrlBloomSoftKnee', 'bloom.softKnee'],
    ['ctrlBloomClamp', 'bloom.clamp'],
    ['ctrlBloomIntensity', 'bloom.intensity'],
    ['ctrlBloomDiffusion', 'bloom.diffusion'],
    ['ctrlBloomResolution', 'bloom.resolutionScale'],
    ['ctrlBloomEmission', 'bloom.emissionRange'],
    ['ctrlClickGlow', 'bloom.clickEmissionScale'],
    ['ctrlBloomDiskEmission', 'bloom.diskEmission'],
    ['ctrlBloomTrailEmission', 'bloom.trailEmission'],
    ['ctrlBloomTrailCoverage', 'bloom.trailCoverageScale'],
    ['ctrlBloomRingCoreAlpha', 'bloom.ringEmissionAlpha'],
    ['ctrlBloomDiskCoreAlpha', 'bloom.diskEmissionAlpha'],
    ['ctrlBloomRingAlpha', 'bloom.ringAlpha'],
    ['ctrlBloomDiskAlpha', 'bloom.diskAlpha'],
    ['ctrlTrailW', 'trail.width'],
    ['ctrlTrailGlowW', 'trail.outerGlowWidth'],
    ['ctrlTrailLife', 'trail.lifetimeMs'],
    ['ctrlShardSpacing', 'shards.trailSpacing'],
    ['ctrlTrailShardRadius', 'shards.trailRadius'],
    ['ctrlTrailShardSpeedMin', 'shards.trailSpeedMin'],
    ['ctrlTrailShardSpeedMax', 'shards.trailSpeedMax'],
    ['ctrlBloomTrail', 'bloom.trailEmissionAlpha'],
    ['ctrlTrailOpacity', 'trail.trailOpacity'],
    ['ctrlRingCount', 'rings.count'],
    ['ctrlDiskRadius', 'disk.radius'],
    ['ctrlDiskLife', 'disk.lifetimeMs'],
    ['ctrlAngVelMul', 'rings.angularVelocityMultiplier'],
    ['ctrlArcSamples', 'rings.arcSamples'],
    ['ctrlRadialSamples', 'rings.radialSamples'],
    ['ctrlRingDir', 'rings.rotationDirection'],
    ['ctrlDissolveDir', 'rings.dissolveDirection'],
    ['ctrlClickShardLifeMin', 'shards.clickLifetimeMinMs'],
    ['ctrlClickShardLifeMax', 'shards.clickLifetimeMaxMs'],
    ['ctrlGeomWidth', 'trail.geometryWidth'],
    ['ctrlMinVertDist', 'trail.minVertexDistance'],
    ['ctrlCornerVerts', 'trail.numCornerVertices'],
    ['ctrlCapVerts', 'trail.numCapVertices'],
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
