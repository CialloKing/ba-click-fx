#!/usr/bin/env node

/**
 * 检查演示页与 Unity 参数源是否保持单一真值。
 * 控制面板仅通过 setFxParam 修改参数，不会绕过引擎直接改写配置。
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const mainJs = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const readmeZh = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const readmeEn = fs.readFileSync(path.join(root, 'README.en.md'), 'utf8');
const themeBackgroundJs = fs.readFileSync(
  path.join(root, 'src', 'theme-background.js'),
  'utf8',
);
const rangeSnapJs = fs.readFileSync(
  path.join(root, 'src', 'range-snap.js'),
  'utf8',
);
const hdrPresentationStatusJs = fs.readFileSync(
  path.join(root, 'src', 'hdr-presentation-status.js'),
  'utf8',
);
const styleCss = fs.readFileSync(path.join(root, 'src', 'style.css'), 'utf8');
const engineJs = fs.readFileSync(path.join(root, 'src', 'fx.js'), 'utf8');
const configJs = fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8');
const typeDefinitions = fs.readFileSync(
  path.join(root, 'src', 'ba-click-fx.d.ts'),
  'utf8',
);

function verify(condition, message)
{
  if (!condition)
  {
    throw new Error(`[verify-sync] ${message}`);
  }

  console.log(`  ✓ ${message}`);
}

function getFunctionSource(source, name)
{
  const signature = 'function ' + name + '(';
  const start = source.indexOf(signature);

  if (start < 0)
  {
    return '';
  }

  // 参数默认值可能包含对象字面量；函数体花括号固定独占下一行。
  const openingBrace = source.indexOf('\n{', start) + 1;

  if (openingBrace <= 0)
  {
    return '';
  }
  let depth = 0;

  for (let index = openingBrace; index < source.length; index++)
  {
    if (source[index] === '{')
    {
      depth++;
    }
    else if (source[index] === '}')
    {
      depth--;

      if (depth === 0)
      {
        return source.slice(start, index + 1);
      }
    }
  }

  return '';
}

verify(/setFxParam/.test(mainJs), '控制面板通过 setFxParam 修改参数，不绕过引擎');
const clickGlowControl = indexHtml.match(
  /<input\s+[^>]*id="ctrlClickGlow"[^>]*>/,
)?.[0] ?? '';

verify(
  /min="0"/.test(clickGlowControl) &&
    /max="4"/.test(clickGlowControl) &&
    /step="0\.01"/.test(clickGlowControl) &&
    /value="1"/.test(clickGlowControl),
  '展示页提供默认值为 1 的精细点击辉光强度滑块',
);
verify(
  /bindRange\('ctrlClickGlow', 'outClickGlow',[\s\S]*?setFxParam\('bloom\.clickEmissionScale', v\)\)/.test(mainJs),
  '点击辉光滑块通过公开 setFxParam 路径生效',
);
verify(
  /\['ctrlClickGlow', 'outClickGlow', 1, false\]/.test(mainJs) &&
    /\['ctrlClickGlow', 'bloom\.clickEmissionScale'\]/.test(mainJs),
  '点击辉光滑块支持重置与本地设置恢复',
);
const preciseRangeSteps =
{
  ctrlScale: '0.01',
  ctrlOpacity: '0.01',
  ctrlDpr: '0.1',
  ctrlClickTimeScale: '0.01',
  ctrlTrailTimeScale: '0.01',
  ctrlRingWStart: '0.01',
  ctrlRingWEnd: '0.01',
  ctrlRingLife: '1',
  ctrlMaxShards: '1',
  ctrlBloomRing: '0.1',
  ctrlBloomThreshold: '0.01',
  ctrlBloomIntensity: '0.01',
  ctrlBloomDiffusion: '0.01',
  ctrlClickGlow: '0.01',
  ctrlDiskRadius: '0.01',
  ctrlDiskLife: '1',
  ctrlAngVelMul: '0.01',
  ctrlArcSamples: '1',
  ctrlClickShardLifeMin: '1',
  ctrlClickShardLifeMax: '1',
  ctrlHitRadius: '0.01',
  ctrlHitLife: '1',
  ctrlFlareRadius: '0.01',
  ctrlFlareLife: '1',
  ctrlTrailW: '0.01',
  ctrlTrailGlowW: '0.1',
  ctrlTrailLife: '1',
  ctrlTrailOpacity: '0.01',
  ctrlGeomWidth: '0.01',
  ctrlMinVertDist: '0.01',
  ctrlTrailShardLifeMin: '1',
  ctrlTrailShardLifeMax: '1',
  ctrlBloomDisk: '0.1',
};

for (const [controlId, expectedStep] of Object.entries(preciseRangeSteps))
{
  const control = indexHtml.match(
    new RegExp(`<input\\s+[^>]*id="${controlId}"[^>]*>`),
  )?.[0] ?? '';

  verify(
    control.includes(`step="${expectedStep}"`),
    `${controlId} 使用精细步进 ${expectedStep}`,
  );
}

for (const controlId of ['ctrlClickTimeScale', 'ctrlTrailTimeScale'])
{
  const control = indexHtml.match(
    new RegExp(`<input\\s+[^>]*id="${controlId}"[^>]*>`),
  )?.[0] ?? '';

  verify(
    control.includes('min="0.01"'),
    `${controlId} 与 API 共享 0.01 最低时间倍率`,
  );
}

verify(
  /bindRange\('ctrlDpr', 'outDpr',[\s\S]*?\}, false, 'change'\);/.test(mainJs) &&
    /dprEl\.dispatchEvent\(new Event\('input'\)\);[\s\S]*?dprEl\.dispatchEvent\(new Event\('change'\)\);/.test(mainJs) &&
    !/maxDpr: Math\.round/.test(mainJs),
  '小数 DPR 仅在提交时应用，并按原精度恢复',
);
const ringCountControl = indexHtml.match(
  /<input\s+[^>]*id="ctrlRingCount"[^>]*>/,
)?.[0] ?? '';

verify(
  /min="0"/.test(ringCountControl) &&
    /max="6"/.test(ringCountControl) &&
    /step="1"/.test(ringCountControl) &&
    /value="2"/.test(ringCountControl),
  '圆环数量滑块允许使用 0 关闭圆环，并保持整数步进',
);
verify(/inputFilter/.test(mainJs), '演示页把信息卡映射为 Unity UGUI 输入过滤区');
const inputSourceSelect = indexHtml.match(
  /<select id="ctrlInputSource"[\s\S]*?<\/select>/,
)?.[0] ?? '';

verify(
  /<option value="dom" selected>/.test(inputSourceSelect) &&
    /<option value="manual">/.test(inputSourceSelect),
  '展示页可切换 DOM 自动监听与宿主手动输入',
);
verify(
  /effect\.pointerDown\(input\)/.test(mainJs) &&
    /effect\.pointerMove\(input\)/.test(mainJs) &&
    /effect\.pointerUp\(pointerId\)/.test(mainJs) &&
    /effect\.pointerCancel\(pointerId\)/.test(mainJs),
  '展示页手动模式通过四个公开指针 API 注入完整生命周期',
);
verify(
  /bindRange\('ctrlClickTimeScale', 'outClickTimeScale',[\s\S]*?clickTimeScale: value/.test(mainJs) &&
    /bindRange\('ctrlTrailTimeScale', 'outTrailTimeScale',[\s\S]*?trailTimeScale: value/.test(mainJs),
  '展示页提供点击与拖尾独立时间倍率控件',
);
const bindRangeSource = getFunctionSource(mainJs, 'bindRange');
verify(
  /snapRangeValue/.test(rangeSnapJs) &&
    /pointerSnapValue/.test(bindRangeSource) &&
    /isPointerAdjustment/.test(bindRangeSource) &&
    /snapRangeValue\(rawValue, pointerSnapValue, parseFloat\(el\.step\)\)/.test(
      bindRangeSource,
    ) &&
    /'input', 1\);/.test(mainJs),
  '时间倍率滑块在指针拖动时可吸附默认 1.00 倍率',
);
verify(
  /effect\.setPaused\(ctrlPaused\.checked,[\s\S]*?clear: ctrlPauseClear/.test(mainJs),
  '展示页通过 setPaused 演示暂停与可选清屏',
);
verify(
  /applyInputSource\('dom', false\)/.test(mainJs) &&
    /clickTimeScale: 1/.test(mainJs) &&
    /trailTimeScale: 1/.test(mainJs) &&
    /bafx-ctrlInputSource/.test(mainJs),
  '宿主 API 控件支持重置与本地设置恢复',
);
const renderModeSelect = indexHtml.match(
  /<select id="ctrlRenderMode"[\s\S]*?<\/select>/,
)?.[0] ?? '';
const renderModeValues = [...renderModeSelect.matchAll(/<option value="([^"]+)"/g)]
  .map((match) => match[1]);

function hasRenderModeConfig(mode, expected)
{
  const escapedMode = mode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyPattern = mode === 'legacy'
    ? "(?:'legacy'|legacy)"
    : `'${escapedMode}'`;
  // 展示页配置采用多行对象；先限制到单个模式块，避免跨块字段误匹配。
  const configSource = mainJs.match(
    new RegExp(`${keyPattern}:\\s*\\{([\\s\\S]*?)\\n\\s*\\},?`),
  )?.[1] ?? '';

  return Object.entries(expected).every(([key, value]) =>
    new RegExp(`\\b${key}:\\s*'${value}'`).test(configSource));
}

verify(
  JSON.stringify(renderModeValues) === JSON.stringify([
    'full-webgpu',
    'full-webgl2',
    'webgl2-bloom',
    'software-bloom',
    'native-bloom',
    'legacy',
  ]),
  '展示页按 WebGPU HDR、纯 WebGL2、WebGL2 Bloom、Software、Native 与 Legacy 排列六档渲染开关',
);
verify(
  /<option value="full-webgl2" selected>/.test(renderModeSelect) &&
    /const DEFAULT_RENDER_MODE = 'full-webgl2'/.test(mainJs),
  '展示页 HTML、恢复与重置路径统一默认使用纯 WebGL2',
);
verify(
  hasRenderModeConfig('full-webgpu',
    {
      effectBackend: 'webgpu',
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
    }) &&
    hasRenderModeConfig('full-webgl2',
    {
      effectBackend: 'webgl2',
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
    }) &&
    hasRenderModeConfig('webgl2-bloom',
      {
        effectBackend: 'canvas2d',
        renderingMode: 'enhanced',
        bloomBackend: 'webgl2',
      }) &&
    hasRenderModeConfig('software-bloom',
      {
        effectBackend: 'canvas2d',
        renderingMode: 'enhanced',
        bloomBackend: 'software',
      }) &&
    hasRenderModeConfig('native-bloom',
      {
        effectBackend: 'canvas2d',
        renderingMode: 'enhanced',
        bloomBackend: 'native',
      }) &&
    hasRenderModeConfig('legacy',
      {
        effectBackend: 'canvas2d',
        renderingMode: 'legacy',
      }),
  '展示页六档开关映射到对应的完整特效、渲染模式与 Bloom API',
);
verify(
  /renderWebGPUOutputExtended: 'Extended HDR · rgba16float'/.test(mainJs) &&
    /renderHdrVerdictReady: '浏览器侧 HDR 已就绪'/.test(mainJs) &&
    /renderHdrVerdictReady: 'Browser-side HDR ready'/.test(mainJs) &&
    /matchMedia\('\(dynamic-range: high\)'\)/.test(mainJs) &&
    /dynamicRangeQuery\.addEventListener\('change'/.test(mainJs) &&
    /snapshot\.resolvedWebGPUOutputMode/.test(mainJs) &&
    /id="renderCanvasOutputValue"/.test(indexHtml) &&
    /id="renderDynamicRangeValue"/.test(indexHtml) &&
    /id="renderHdrVerdictValue"/.test(indexHtml) &&
    /'ready'/.test(hdrPresentationStatusJs) &&
    /'display-unconfirmed'/.test(hdrPresentationStatusJs) &&
    /'standard'/.test(hdrPresentationStatusJs) &&
    /'pending'/.test(hdrPresentationStatusJs) &&
    /'unavailable'/.test(hdrPresentationStatusJs) &&
    /'inactive'/.test(hdrPresentationStatusJs),
  '展示页分层报告 WebGPU 后端、Canvas 输出、显示环境与 HDR 判断',
);
verify(
  /resolvedWebGPUOutputMode === \\'extended\\'/.test(mainJs) &&
    /resolvedWebGPUOutputMode === 'extended'/.test(readmeZh) &&
    /resolvedWebGPUOutputMode === 'extended'/.test(readmeEn) &&
    /rgba16float \+ toneMapping: extended/.test(readmeZh) &&
    /rgba16float \+ toneMapping: extended/.test(readmeEn),
  '展示页与中英文文档明确只有 extended WebGPU Canvas 代表真实 HDR',
);
const hdrPresentationPresetSelect = indexHtml.match(
  /<select id="ctrlHdrPresentationPreset"[\s\S]*?<\/select>/,
)?.[0] ?? '';
const hdrPresentationPresetValues = [
  ...hdrPresentationPresetSelect.matchAll(/<option value="([^"]+)"/g),
].map((match) => match[1]);

verify(
  JSON.stringify(hdrPresentationPresetValues) === JSON.stringify([
    'balanced',
    'bright',
    'color',
    'custom',
  ]) &&
    /id="ctrlWebGPUHdrBrightness" min="0" max="32" step="0\.1" value="1" disabled/.test(indexHtml) &&
    /id="ctrlWebGPUHdrColorPreservation" min="0" max="1" step="0\.01" value="0" disabled/.test(indexHtml) &&
    /webgpuHdrBrightness: CONFIG\.webgpuHdrBrightness/.test(mainJs) &&
    /webgpuHdrColorPreservation: CONFIG\.webgpuHdrColorPreservation/.test(mainJs) &&
    /webgpuHdrColorPreservation: 1/.test(mainJs) &&
    /snapshot\.resolvedEffectBackend === 'webgpu'/.test(mainJs) &&
    /snapshot\.resolvedWebGPUOutputMode === 'extended'/.test(mainJs) &&
    /bafx-ctrlHdrPresentationPreset/.test(mainJs) &&
    /\.\.\.HDR_PRESENTATION_PRESETS\.balanced/.test(mainJs),
  'HDR 展示控件覆盖整体亮度、预设、Extended 启用、持久化与重置',
);
const syncHdrUiOverlaySource = getFunctionSource(
  mainJs,
  'syncHdrUiOverlay',
);
const applyHdrUiSettingsSource = getFunctionSource(
  mainJs,
  'applyHdrUiSettings',
);
const supportsHdrUiCssSource = getFunctionSource(
  mainJs,
  'supportsHdrUiCss',
);
const updateHdrUiCssColorsSource = getFunctionSource(
  mainJs,
  'updateHdrUiCssColors',
);
const hdrUiBrightnessControl = indexHtml.match(
  /<input[^>]*id="ctrlHdrUiBrightness"[^>]*>/,
)?.[0] ?? '';
const renderModePosition = indexHtml.indexOf('id="ctrlRenderMode"');
const hdrUiControlsPosition = indexHtml.indexOf('id="hdrUiControls"');
const outputCompositingPosition = indexHtml.indexOf(
  'id="ctrlOutputCompositing"',
);

verify(
  !/hdrUiCanvas|hdr-ui-canvas/.test(indexHtml) &&
    /id="ctrlHdrUiEnabled" checked disabled/.test(indexHtml) &&
    /min="1"/.test(hdrUiBrightnessControl) &&
    /max="16"/.test(hdrUiBrightnessControl) &&
    /step="0\.25"/.test(hdrUiBrightnessControl) &&
    /value="4"/.test(hdrUiBrightnessControl) &&
    /const DEFAULT_HDR_UI_BRIGHTNESS = 4;/.test(mainJs) &&
    renderModePosition < hdrUiControlsPosition &&
    hdrUiControlsPosition < outputCompositingPosition,
  '展示页在渲染模式后直接提供默认 4 倍的 UI HDR 亮度控制',
);
verify(
  /resolvedEffectBackend === 'webgpu'/.test(syncHdrUiOverlaySource) &&
    /resolvedWebGPUOutputMode === 'extended'/.test(syncHdrUiOverlaySource) &&
    /supportsHdrUiCss\(\)/.test(syncHdrUiOverlaySource) &&
    /updateHdrUiCssColors\(\)/.test(syncHdrUiOverlaySource) &&
    /dataset\.hdrUiState = 'unavailable'/.test(syncHdrUiOverlaySource) &&
    /dataset\.hdrUiState = hdrUiEnabled \? 'extended' : 'disabled'/.test(
      syncHdrUiOverlaySource,
    ) &&
    /CSS\.supports\('color', 'color\(srgb-linear 0\.25 1 2\)'\)/.test(
      supportsHdrUiCssSource,
    ) &&
    /CSS\.supports\('dynamic-range-limit', 'no-limit'\)/.test(
      supportsHdrUiCssSource,
    ) &&
    /Math\.max\(1, Math\.min\(16, settings\.brightness\)\)/.test(
      applyHdrUiSettingsSource,
    ) &&
    /bafx-ctrlHdrUiEnabled/.test(applyHdrUiSettingsSource) &&
    /bafx-ctrlHdrUiBrightness/.test(applyHdrUiSettingsSource) &&
    /--hdr-ui-primary-core/.test(updateHdrUiCssColorsSource) &&
    /--hdr-ui-green-glow/.test(updateHdrUiCssColorsSource) &&
    /body\[data-hdr-ui-state='extended'\][\s\S]*?dynamic-range-limit: no-limit;/.test(
      styleCss,
    ) &&
    !/hdr-ui-canvas|mix-blend-mode: plus-lighter/.test(styleCss) &&
    !/WebGPUHdrUiRenderer|webgpu-hdr-ui/.test(mainJs) &&
    !/effect\.updateConfig|setFxParams?|webgpuHdrBrightness/.test(
      applyHdrUiSettingsSource,
    ) &&
    !/hdrUi/i.test(typeDefinitions),
  'UI HDR 严格依赖 Extended、位于特效层下方且保持为展示页私有能力',
);
const outputCompositingSelect = indexHtml.match(
  /<select id="ctrlOutputCompositing"[\s\S]*?<\/select>/,
)?.[0] ?? '';
const outputCompositingValues = [
  ...outputCompositingSelect.matchAll(/<option value="([^"]+)"/g),
].map((match) => match[1]);

verify(
  JSON.stringify(outputCompositingValues) === JSON.stringify([
    'scene',
    'browser-overlay',
  ]) &&
    /<option value="scene" selected>/.test(outputCompositingSelect),
  '展示页提供默认使用 Scene 的透明覆盖层输出模式开关',
);
verify(
  /labelOutputCompositing: '输出合成'/.test(mainJs) &&
    /outputCompositingTransparentOverlay: '透明覆盖层'/.test(mainJs) &&
    /labelOutputCompositing: 'Output Compositing'/.test(mainJs) &&
    /outputCompositingTransparentOverlay: 'Transparent Overlay'/.test(mainJs) &&
    /#ctrlOutputCompositing option/.test(mainJs),
  '输出合成控件支持中英文选项',
);
verify(
  /effect\.updateConfig\(\{ outputCompositing: resolved \}\)/.test(mainJs) &&
    /localStorage\.setItem\('bafx-ctrlOutputCompositing', resolved\)/.test(mainJs) &&
    /localStorage\.getItem\([\s\S]*?'bafx-ctrlOutputCompositing'[\s\S]*?\)/.test(mainJs) &&
    /applyOutputCompositing\(savedOutputCompositing\)/.test(mainJs),
  '输出合成选择通过公开配置生效并支持本地恢复',
);
verify(
  /ctrlOutputCompositing'\)\.value =[\s\S]*?DEFAULT_OUTPUT_COMPOSITING/.test(mainJs) &&
    /outputCompositing: DEFAULT_OUTPUT_COMPOSITING/.test(mainJs) &&
    /const DEFAULT_OUTPUT_COMPOSITING = 'scene'/.test(mainJs),
  '展示页重置操作恢复 Scene 输出合同',
);
const overlayAlphaPolicySelect = indexHtml.match(
  /<select\b[^>]*\bid="ctrlOverlayAlphaPolicy"[^>]*>[\s\S]*?<\/select>/,
)?.[0] ?? '';
const overlayColorCompensationSelect = indexHtml.match(
  /<select\b[^>]*\bid="ctrlOverlayColorCompensation"[^>]*>[\s\S]*?<\/select>/,
)?.[0] ?? '';
const hostCompositingSelect = indexHtml.match(
  /<select id="ctrlHostCompositing"[\s\S]*?<\/select>/,
)?.[0] ?? '';
const overlayAlphaLimitControl = indexHtml.match(
  /<input\b[^>]*\bid="ctrlOverlayAlphaLimit"[^>]*>/,
)?.[0] ?? '';
const overlayAlphaPolicyValues = [
  ...overlayAlphaPolicySelect.matchAll(/<option value="([^"]+)"/g),
].map((match) => match[1]);
const overlayColorCompensationValues = [
  ...overlayColorCompensationSelect.matchAll(/<option value="([^"]+)"/g),
].map((match) => match[1]);
const hostCompositingValues = [
  ...hostCompositingSelect.matchAll(/<option value="([^"]+)"/g),
].map((match) => match[1]);

verify(
  JSON.stringify(overlayAlphaPolicyValues) === JSON.stringify([
    'coverage',
    'visual-max',
  ]) &&
    /<option value="coverage" selected>/.test(
      overlayAlphaPolicySelect,
    ) &&
    JSON.stringify(overlayColorCompensationValues) === JSON.stringify([
      'none',
      'bright-core',
    ]) &&
    /<option value="none" selected>/.test(
      overlayColorCompensationSelect,
    ) &&
    JSON.stringify(hostCompositingValues) === JSON.stringify([
      'source-over',
      'screen',
    ]) &&
    /<option value="source-over" selected>/.test(hostCompositingSelect),
  '透明覆盖层提供相互独立的 Alpha、颜色与宿主合成选择',
);
verify(
  /min="0"/.test(overlayAlphaLimitControl) &&
    /max="1"/.test(overlayAlphaLimitControl) &&
    /step="0\.00392156862745098"/.test(overlayAlphaLimitControl) &&
    /value="0\.9803921568627451"/.test(overlayAlphaLimitControl) &&
    /const DEFAULT_OVERLAY_ALPHA_LIMIT = CONFIG\.overlayAlphaLimit/.test(
      mainJs,
    ),
  '覆盖层 Alpha 上限滑块覆盖 0..1 并精确使用 250/255 默认值',
);
const syncTransparentControlsSource = getFunctionSource(
  mainJs,
  'syncTransparentCompositingControlState',
);
const applyOverlayAlphaPolicySource = getFunctionSource(
  mainJs,
  'applyOverlayAlphaPolicy',
);
const applyOverlayColorCompensationSource = getFunctionSource(
  mainJs,
  'applyOverlayColorCompensation',
);
const applyOverlayAlphaLimitSource = getFunctionSource(
  mainJs,
  'applyOverlayAlphaLimit',
);
const applyHostCompositingSource = getFunctionSource(
  mainJs,
  'applyHostCompositing',
);

verify(
  /outputCompositing === 'browser-overlay'/.test(
    syncTransparentControlsSource,
  ) &&
    /hostCompositing === 'source-over'/.test(
      syncTransparentControlsSource,
    ) &&
    /ctrlOverlayAlphaPolicy\.disabled = !sourceOverEnabled/.test(
      syncTransparentControlsSource,
    ) &&
    /ctrlOverlayColorCompensation\.disabled = !sourceOverEnabled/.test(
      syncTransparentControlsSource,
    ) &&
    /ctrlOverlayAlphaLimit\.disabled = !sourceOverEnabled/.test(
      syncTransparentControlsSource,
    ) &&
    /ctrlHostCompositing\.disabled = !enabled/.test(
      syncTransparentControlsSource,
    ) &&
    /syncTransparentCompositingControlState\([\s\S]*?resolved/.test(
      applyHostCompositingSource,
    ) &&
    /mode === 'plus-lighter' \? 'screen' : mode/.test(
      applyHostCompositingSource,
    ),
  '透明合成控件按输出模式启用并迁移旧 DOM Add 值',
);
verify(
  /overlayAlphaPolicy: resolved/.test(
    applyOverlayAlphaPolicySource,
  ) &&
    /overlayColorCompensation: resolved/.test(
      applyOverlayColorCompensationSource,
  ) &&
    /overlayAlphaLimit: resolved/.test(applyOverlayAlphaLimitSource) &&
    /hostCompositing: resolved/.test(applyHostCompositingSource) &&
    /localStorage\.setItem\('bafx-ctrlOverlayAlphaPolicy', resolved\)/.test(
      mainJs,
    ) &&
    /localStorage\.setItem\('bafx-ctrlOverlayColorCompensation', resolved\)/.test(
      mainJs,
    ) &&
    /localStorage\.setItem\('bafx-ctrlOverlayAlphaLimit', String\(resolved\)\)/.test(
      mainJs,
    ) &&
    /localStorage\.setItem\('bafx-ctrlHostCompositing', resolved\)/.test(
      mainJs,
    ),
  '四个透明合成控件分别通过 updateConfig 生效并持久化',
);
verify(
  /bafx-ctrlOverlayAlphaPolicy[\s\S]*?applyOverlayAlphaPolicy\(savedOverlayAlphaPolicy\)/.test(
    mainJs,
  ) &&
    /bafx-ctrlOverlayColorCompensation[\s\S]*?applyOverlayColorCompensation\(savedOverlayColorCompensation\)/.test(
    mainJs,
  ) &&
    /bafx-ctrlOverlayAlphaLimit[\s\S]*?applyOverlayAlphaLimit\([\s\S]*?savedOverlayAlphaLimit/.test(
      mainJs,
    ) &&
    /bafx-ctrlHostCompositing[\s\S]*?applyHostCompositing\(savedHostCompositing\)/.test(
      mainJs,
    ) &&
    /overlayAlphaPolicy: DEFAULT_OVERLAY_ALPHA_POLICY/.test(
      mainJs,
    ) &&
    /overlayColorCompensation: DEFAULT_OVERLAY_COLOR_COMPENSATION/.test(
      mainJs,
    ) &&
    /overlayAlphaLimit: DEFAULT_OVERLAY_ALPHA_LIMIT/.test(mainJs) &&
    /hostCompositing: DEFAULT_HOST_COMPOSITING/.test(mainJs),
  '透明合成配置支持本地恢复与统一重置',
);
verify(
  /DOM Add 使用 Screen 自适应亮底[\s\S]*?停用 Alpha 策略、颜色补偿和 Alpha 上限[\s\S]*?浏览器视觉近似/.test(
    indexHtml,
  ) &&
    /overlayAlphaPolicyVisualMax: '旧版视觉最大值'/.test(mainJs) &&
    /overlayColorCompensationBrightCore: 'Light-background Bright Core'/.test(
      mainJs,
    ) &&
    /DOM Add uses Screen to adapt to light backdrops and disables the Alpha policy, color compensation, and Alpha limit/.test(
      mainJs,
    ),
  '双语文案明确 DOM Add 的亮底适配与无效控制项',
);
verify(
  /BLOOM_BACKEND_CHANGE_EVENT/.test(mainJs) &&
    /renderBackendPending/.test(mainJs),
  '展示页监听后端解析事件并单独显示 WebGL2 延迟探测状态',
);
const isolatedCompositingControl = indexHtml.match(
  /<input\s+[^>]*id="ctrlIsolatedCompositing"[^>]*>/,
)?.[0] ?? '';
const compositingReferenceControl = indexHtml.match(
  /<select id="ctrlCompositingReference"[\s\S]*?<\/select>/,
)?.[0] ?? '';
const compositingReferenceValues = [
  ...compositingReferenceControl.matchAll(/<option value="([^"]+)"/g),
].map((match) => match[1]);

verify(
  /type="checkbox"/.test(isolatedCompositingControl) &&
    !/\bchecked\b/.test(isolatedCompositingControl),
  '展示页提供默认关闭的隔离合成兼容开关',
);
verify(
  JSON.stringify(compositingReferenceValues) === JSON.stringify([
    'match-page',
    'unknown',
  ]) &&
    /<option value="match-page" selected>/.test(compositingReferenceControl) &&
    /id="compositingReferenceStatus"/.test(indexHtml),
  '展示页提供默认匹配当前页面的合成参考选择与状态提示',
);
verify(
  /labelCompositingReference: '特效背景参考'/.test(mainJs) &&
    /labelCompositingReference: 'Effect Reference'/.test(mainJs) &&
    /ctrlCompositingReference: d\.labelCompositingReference/.test(mainJs) &&
    /compositingReferenceMatchPage: '匹配当前页面（精确）'/.test(mainJs) &&
    /compositingReferenceUnknown: '未知透明背景（兼容）'/.test(mainJs) &&
    /compositingReferenceMatchPage: 'Current Page \(Exact\)'/.test(mainJs) &&
    /compositingReferenceUnknown: 'Unknown Background'/.test(mainJs),
  '合成参考选择与状态文案支持中英文',
);
verify(
  /function applyCompositingReferenceMode\(mode\)/.test(mainJs) &&
    /const resolved = COMPOSITING_REFERENCE_MODES\.has\(mode\)/.test(mainJs) &&
    /localStorage\.setItem\('bafx-ctrlCompositingReference', resolved\)/.test(mainJs) &&
    /const savedCompositingReference = localStorage\.getItem\([\s\S]*?'bafx-ctrlCompositingReference'[\s\S]*?\)/.test(mainJs) &&
    /applyCompositingReferenceMode\(savedCompositingReference\)/.test(mainJs),
  '合成参考模式通过公开 API 生效，并可持久化恢复',
);
const staticFaqContent = indexHtml.match(
  /<div id="introFAQContent">[\s\S]*?<\/div>/,
)?.[0] ?? '';

verify(
  /特效背景参考/.test(staticFaqContent) &&
    /匹配当前页面/.test(staticFaqContent) &&
    /未知透明背景/.test(staticFaqContent) &&
    /setCompositingReference\(null\)/.test(mainJs) &&
    /Effect Reference offers Current Page or Unknown Background/.test(mainJs) &&
    /setCompositingReference\(image, \{ fit:/.test(mainJs),
  '静态与双语 FAQ 说明匹配参考和未知背景的明确合同',
);
verify(
  /纯白背景下特效颜色太浅/.test(staticFaqContent) &&
    /关闭“隔离合成”时会保留游戏原始的低可见度表现/.test(staticFaqContent) &&
    /开启后，展示页自动叠加不参与 Bloom 的淡青对比轮廓/.test(staticFaqContent) &&
    /纯白背景下特效颜色太浅/.test(mainJs) &&
    /Effects look washed out on a pure white background/.test(mainJs) &&
    /With Isolated Compositing off/.test(mainJs) &&
    /pale-cyan contrast outline/.test(mainJs),
  '静态与双语 FAQ 说明隔离合成切换纯白的原始与可见性表现',
);
verify(
  /const PURE_WHITE_ISOLATED_CONTRAST_ALPHA = 0\.35/.test(mainJs) &&
    /function resolvePureWhiteContrastAlpha\(isolatedCompositing\)/.test(mainJs) &&
    /function syncPureWhiteIsolationContrast\(\)/.test(mainJs) &&
    /function applyIsolatedCompositing\(checked\)[\s\S]*?isolatedCompositing: checked,[\s\S]*?lightBackgroundContrastAlpha: resolvePureWhiteContrastAlpha\(checked\)/.test(mainJs) &&
    /bindToggle\('ctrlIsolatedCompositing', applyIsolatedCompositing\)/.test(mainJs),
  '展示页隔离合成开关会同步切换纯白对比层',
);
verify(
  /localStorage\.getItem\('bafx-ctrlIsolatedCompositing'\)/.test(mainJs) &&
    /savedIsolatedCompositing !== null/.test(mainJs) &&
    /const isolated = savedIsolatedCompositing === 'true'/.test(mainJs) &&
    /applyIsolatedCompositing\(isolated\)/.test(mainJs),
  '展示页会恢复已持久化的隔离与纯白对比选项',
);
verify(
  /getElementById\('ctrlIsolatedCompositing'\)\.checked = false/.test(mainJs) &&
    /isolatedCompositing: false/.test(mainJs) &&
    /lightBackgroundContrastAlpha: 0/.test(mainJs),
  '展示页重置操作恢复游戏的直接加色默认值',
);
verify(
  /body\.compositing-reference-matched::before,[\s\S]*?body\.theme-pure-white::before[\s\S]*?display: none/.test(
    styleCss,
  ) &&
    /classList\.toggle\('theme-pure-white', name === PURE_WHITE_THEME\)/.test(mainJs) &&
    /classList\.remove\('theme-pure-white'\)[\s\S]*?applyPageCompositingReferenceImage/.test(mainJs),
  '纯白主题关闭装饰网格，并在自定义背景切换时不保留旧参考',
);
const applyThemeSource = getFunctionSource(mainJs, 'applyTheme');
const applyThemeCompositingReferenceSource = getFunctionSource(
  mainJs,
  'applyThemeCompositingReference',
);
const updateThemeCompositingReferenceSource = getFunctionSource(
  mainJs,
  'updateThemeCompositingReference',
);
const syncCompositingReferenceSource = getFunctionSource(
  mainJs,
  'syncCompositingReference',
);
const hasMatchedCompositingReferenceSource = getFunctionSource(
  mainJs,
  'hasMatchedCompositingReference',
);
const applyCustomBackgroundSource = getFunctionSource(
  mainJs,
  'applyCustomBackground',
);
const applyPageCompositingReferenceImageSource = getFunctionSource(
  mainJs,
  'applyPageCompositingReferenceImage',
);

verify(
  /getThemeBackgroundCss,[\s\S]*?renderThemeSceneBackground,[\s\S]*?from '\.\/theme-background\.js';/.test(mainJs) &&
    /const THEME_DEFINITIONS = Object\.freeze/.test(themeBackgroundJs) &&
    /export function getThemeBackgroundCss/.test(themeBackgroundJs) &&
    /export function renderThemeSceneBackground/.test(themeBackgroundJs) &&
    !/\bTHEMES\b/.test(mainJs),
  '内置主题 CSS 与场景栅格化共用单一数据源',
);
verify(
  /getThemeBackgroundCss\(name\)/.test(applyThemeSource) &&
    /document\.body\.style\.backgroundAttachment = 'fixed';/.test(applyThemeSource) &&
    /syncPureWhiteIsolationContrast\(\)/.test(applyThemeSource) &&
    /applyThemeCompositingReference\(name\)/.test(applyThemeSource),
  '内置主题统一进入对应的页面合成参考选择路径',
);
verify(
  /pageBackgroundRequestId\+\+/.test(
    applyThemeCompositingReferenceSource,
  ) &&
    /activeThemeReference = name/.test(
      applyThemeCompositingReferenceSource,
    ) &&
    /pageBackgroundRasterSource = null/.test(
      applyThemeCompositingReferenceSource,
    ) &&
    /syncCompositingReference\(\)/.test(
      applyThemeCompositingReferenceSource,
    ) &&
    /updateThemeCompositingReference\(\)/.test(
      applyThemeCompositingReferenceSource,
    ),
  '主题切换先清除旧参考，再生成可重连的当前主题栅格源',
);
verify(
  /renderThemeSceneBackground\([\s\S]*?themeReferenceCanvas,[\s\S]*?activeThemeReference/.test(
    updateThemeCompositingReferenceSource,
  ) &&
    /pageBackgroundRasterSource = themeReferenceCanvas/.test(
      updateThemeCompositingReferenceSource,
    ) &&
    /syncCompositingReference\(\)/.test(
      updateThemeCompositingReferenceSource,
    ),
  '内置主题栅格源会交给合成参考同步入口',
);
verify(
  /syncPureWhiteIsolationContrast\(\)/.test(applyCustomBackgroundSource) &&
    /applyPageCompositingReferenceImage\(resolveCompositingReferenceUrl\(rawValue\)\)/.test(
      applyCustomBackgroundSource,
    ) &&
    /stopThemeReferenceSync\(\)/.test(
      applyPageCompositingReferenceImageSource,
    ) &&
    /image\.crossOrigin = 'anonymous'/.test(
      applyPageCompositingReferenceImageSource,
    ) &&
    /pageBackgroundRasterSource = image/.test(
      applyPageCompositingReferenceImageSource,
    ) &&
    /pageBackgroundRasterSource = null/.test(
      applyPageCompositingReferenceImageSource,
    ),
  '自定义背景独立显示，已解码图片才会作为 CORS 合规的合成参考上传',
);
verify(
  /const source = compositingReferenceMode === 'match-page'[\s\S]*?\? pageBackgroundRasterSource[\s\S]*?: null/.test(
    syncCompositingReferenceSource,
  ) &&
    /effect\.setCompositingReference\(source, \{ fit: 'cover' \}\)/.test(
      syncCompositingReferenceSource,
    ) &&
    /compositing-reference-matched/.test(syncCompositingReferenceSource) &&
    /compositingReferenceMode === 'match-page'/.test(
      hasMatchedCompositingReferenceSource,
    ) &&
    /effect\.compositingReferenceSource === pageBackgroundRasterSource/.test(
      hasMatchedCompositingReferenceSource,
    ),
  '展示页只在参考与页面匹配时提交像素并隐藏未参与合成的装饰层',
);
const compositingReferenceRestoreIndex = mainJs.indexOf(
  'const savedCompositingReference = localStorage.getItem(',
);
const themeRestoreIndex = mainJs.indexOf(
  "const theme = localStorage.getItem('bafx-theme');",
);

verify(
  compositingReferenceRestoreIndex >= 0 &&
    themeRestoreIndex > compositingReferenceRestoreIndex &&
    mainJs.indexOf(
      'applyCompositingReferenceMode(savedCompositingReference);',
      compositingReferenceRestoreIndex,
    ) < themeRestoreIndex,
  '合成参考偏好会在主题或自定义图片源恢复前先应用',
);
verify(
  /const DEFAULT_COMPOSITING_REFERENCE_MODE = 'match-page'/.test(mainJs) &&
    /compositingReferenceMode = DEFAULT_COMPOSITING_REFERENCE_MODE/.test(mainJs) &&
    /getElementById\('ctrlCompositingReference'\)\.value =[\s\S]*?DEFAULT_COMPOSITING_REFERENCE_MODE/.test(mainJs) &&
    /else\s*\{\s*applyTheme\('蔚蓝'\);\s*\}/.test(mainJs),
  '重置和首次加载均恢复匹配当前页面的合成参考策略',
);
verify(
  /setCompositingReference\(null\)/.test(mainJs) &&
    /未知背景/.test(mainJs) &&
    /Unknown Background/.test(mainJs) &&
    /pageBackgroundRasterSource = null/.test(
      applyPageCompositingReferenceImageSource,
    ),
  '新 API 明确将未知背景与宿主 CSS 背景管理分离',
);
verify(
  /new URL\(trimmed, document\.baseURI\)/.test(
    getFunctionSource(mainJs, 'resolveCompositingReferenceUrl'),
  ) &&
    /url\.protocol !== 'file:'/.test(
      getFunctionSource(mainJs, 'resolveCompositingReferenceUrl'),
    ),
  '自定义裸图片 URL 会把 file: 交给受信任宿主，其他协议仍保持白名单限制',
);
verify(
  /ctrlColor\.addEventListener\('input',[\s\S]*?effect\.setThemeColor\(ctrlColor\.value\)[\s\S]*?\}\);[\s\S]*?effect\.setThemeColor\(ctrlColor\.value\)/.test(mainJs),
  '展示页首次加载会主动应用颜色控件默认值',
);
verify(
  /id="ctrlColor" value="#4ca7ff"/.test(indexHtml) &&
    /effect\.setThemeColor\('#4ca7ff'\)/.test(mainJs),
  '展示页首次加载与重置都使用游戏基准蓝',
);
verify(
  /isolatedCompositing: false/.test(configJs) &&
    /lightBackgroundContrastAlpha: 0/.test(configJs) &&
    /typeof overrides\.isolatedCompositing === 'boolean'/.test(configJs),
  '严格默认关闭网页兼容合成，createConfig 仍接受布尔覆盖值',
);
verify(
  /this\.compositingReferenceSource = null/.test(engineJs) &&
    /this\.compositingReferenceFit = 'cover'/.test(engineJs) &&
    /setCompositingReference\(source, options = \{\}\)/.test(engineJs) &&
    /this\.compositingReferenceSource = source/.test(engineJs) &&
    /source === null[\s\S]*?releaseFrameResources\(\)/.test(engineJs) &&
    /export interface BAClickFXCompositingReferenceOptions/.test(
      typeDefinitions,
    ) &&
    /setCompositingReference\([\s\S]*?source: TexImageSource \| null,[\s\S]*?options\?: BAClickFXCompositingReferenceOptions/.test(
      typeDefinitions,
    ) &&
    !/compositingReferenceSource/.test(configJs),
  '合成参考通过公开 API 管理资源状态，并以 TypeScript 类型明确 cover 合同',
);
verify(
  /const DEFAULT_EFFECT_BACKEND = 'webgl2'/.test(configJs) &&
    /const DEFAULT_BLOOM_BACKEND = 'webgl2'/.test(configJs),
  '库配置默认使用纯 WebGL2，并保留 WebGL2 Bloom 回退请求',
);
verify(
  /function createOverlayRoot/.test(engineJs) &&
    /root\.style\.isolation = 'isolate'/.test(engineJs) &&
    /_applyCompositingMount\(\)/.test(engineJs),
  '引擎通过透明隔离根挂载多 Canvas 合成层',
);
verify(
  /typeof overrides\.isolatedCompositing === 'boolean'/.test(engineJs) &&
    /this\.config\.isolatedCompositing = isolated/.test(engineJs),
  '引擎支持运行时切换隔离与直接合成',
);
verify(
  /const hasDedicatedSceneOutput =[\s\S]*?useGpuClickEffects \|\| useWebGL2Bloom \|\| canvasSceneRendered/.test(engineJs) &&
    /_renderLightBackgroundContrast\([\s\S]*?useSoftwareBloom && !hasDedicatedSceneOutput/.test(engineJs),
  'GPU 与场景 Final Pass 成功时仍按几何重建纯白对比遮罩',
);
const canvasSceneRendererSource = engineJs.match(
  /  _ensureCanvasSceneRenderer\(\)[\s\S]*?\n  _resizeCanvasSceneRenderer\(\)/,
)?.[0] ?? '';

verify(
  /setOverlayStyle\([\s\S]*?canvas,[\s\S]*?'2147483646'/.test(
    canvasSceneRendererSource,
  ) &&
    /this\.overlayParent\.appendChild\(canvas\)/.test(
      canvasSceneRendererSource,
    ),
  'Canvas Scene Final Pass 位于纯白对比层下方',
);
const canvasOutputVisibilitySource = engineJs.match(
  /  _setCanvasOutputVisible\(visible\)[\s\S]*?\n  _invalidateSceneBackgroundOutputs\(\)/,
)?.[0] ?? '';

verify(
  /this\.canvas\.style\.visibility = visibility/.test(
    canvasOutputVisibilitySource,
  ) &&
    /const contrastEnabled =[\s\S]*?lightBackgroundContrastAlpha > 0/.test(
      canvasOutputVisibilitySource,
    ) &&
    /visible \|\| contrastEnabled \? '' : 'hidden'/.test(
      canvasOutputVisibilitySource,
    ),
  '纯白对比层仅在启用后脱离主 Canvas 的输出可见性',
);
verify(/UNITY_FX_TOUCH/.test(engineJs), '渲染引擎直接消费 Unity 参数源');
verify(/pointerdown/.test(engineJs) && /pointerup/.test(engineJs), '按下、拖拽和松开共享同一输入生命周期');
verify(!/ringNoise/.test(engineJs), '圆环溶解保持为单个连续弧带');
verify(/rotationDirection/.test(engineJs), '圆环旋转方向由 Unity 参数固定为逆时针');
verify(
  /evaluateUnitySmoothCurve/.test(engineJs) &&
    /angularVelocityMinKeys/.test(configJs) &&
    /angularVelocityMaxKeys/.test(configJs),
  '圆环角速度使用 Unity 双曲线并随生命周期衰减',
);
verify(
  /hdrIntensity: 5\.992157/.test(configJs) &&
    /evaluateSrgbGradientEnergy/.test(engineJs) &&
    /srgbToLinearChannel/.test(engineJs),
  '圆环保留 Unity HDR 原值并在线性色彩空间计算粒子颜色',
);
verify(
  /ringCfg\.dissolveDirection/.test(engineJs),
  '圆环溶解方向由实例配置驱动',
);
verify(
  /evaluateUnityHermiteCurve/.test(engineJs) &&
    /textureAlpha >= threshold \? textureAlpha : 0/.test(engineJs) &&
    !/dissolveSoftness|dissolveEdgeIntensity|dissolveEdgeRatio/.test(engineJs),
  '圆环使用 Unity Hermite 阈值和原 Shader 二值 clip',
);
verify(
  /sampleRing3Alpha/.test(engineJs) &&
    /textureUvMin: 0\.0005000000237487257/.test(configJs) &&
    /textureUvMax: 0\.999500036239624/.test(configJs) &&
    /bandToOuterRadius: 0\.0598573766034603/.test(configJs),
  '圆环精确采样 Ring3，并保留 Cylinder002 UV 与固定环宽比例',
);

console.log('\n✅ Unity 参数同步检查通过\n');
