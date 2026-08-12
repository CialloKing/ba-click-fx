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
const webgpuDeviceJs = fs.readFileSync(
  path.join(root, 'src', 'webgpu-device.js'),
  'utf8',
);
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
const panelMarkup = indexHtml.match(
  /<aside\b[^>]*\bid="panel"[^>]*>[\s\S]*?<\/aside>/,
)?.[0] ?? '';
const defaultOpenPanelDetailIds = [
  ...panelMarkup.matchAll(
    /<details\b(?=[^>]*\bopen\b)(?=[^>]*\bid="([^"]+)")[^>]*>/g,
  ),
].map((match) => match[1]);

verify(
  panelMarkup.length > 0 &&
    JSON.stringify(defaultOpenPanelDetailIds) === JSON.stringify([
      'themeDetails',
      'displayDetails',
      'hostApiDetails',
      'sharedShardsDetails',
    ]),
  '控制面板默认仅展开背景主题、显示、宿主控制 API 与通用参数',
);
const introFaqMarkup = indexHtml.match(
  /<div id="introFAQContent">[\s\S]*?<\/div>/,
)?.[0] ?? '';
const localizedFaqDefinitions = mainJs.match(
  /^\s+introFAQContent:[^\n]+$/gm,
) ?? [];
const localizedMobileTouchFaqDefinitions = mainJs.match(
  /^\s+introMobileTouchFAQContent:[^\n]+$/gm,
) ?? [];

verify(
  introFaqMarkup.length > 0 &&
    !introFaqMarkup.includes('BASpark') &&
    localizedFaqDefinitions.length === 2 &&
    localizedFaqDefinitions.every((content) => !content.includes('BASpark')),
  '展示页静态与双语 FAQ 均不显示 BASpark 字样',
);
verify(
  /移动端浏览器滑动时为什么没有轨迹拖尾/.test(introFaqMarkup) &&
    /“触摸行为”切换为“禁止默认手势”/.test(introFaqMarkup) &&
    /pointercancel/.test(introFaqMarkup) &&
    localizedMobileTouchFaqDefinitions.length === 2 &&
    /移动端浏览器滑动时为什么没有轨迹拖尾/.test(
      localizedMobileTouchFaqDefinitions[0],
    ) &&
    /“触摸行为”切换为“禁止默认手势”/.test(
      localizedMobileTouchFaqDefinitions[0],
    ) &&
    /Why does dragging fail to leave a trail in a mobile browser/.test(
      localizedMobileTouchFaqDefinitions[1],
    ) &&
    /Switch Touch Action to Disable Default Gestures/.test(
      localizedMobileTouchFaqDefinitions[1],
    ) &&
    /d\.introMobileTouchFAQContent/.test(mainJs) &&
    /移动端浏览器滑动时为什么没有轨迹拖尾/.test(readmeZh) &&
    /touchAction: 'none'/.test(readmeZh) &&
    /Why does dragging fail to leave a trail in a mobile browser/.test(
      readmeEn,
    ) &&
    /touchAction: 'none'/.test(readmeEn),
  '展示页静态、双语运行时与 README FAQ 说明移动端触摸行为切换',
);
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
const shardRoundnessControl = indexHtml.match(
  /<input\s+[^>]*id="ctrlShardRoundness"[^>]*>/,
)?.[0] ?? '';

verify(
  /min="0"/.test(shardRoundnessControl) &&
    /max="1"/.test(shardRoundnessControl) &&
    /step="0\.01"/.test(shardRoundnessControl) &&
    /value="0"/.test(shardRoundnessControl),
  '展示页提供默认关闭的碎片圆角比例滑块',
);
verify(
  /bindRange\('ctrlShardRoundness', 'outShardRoundness',[\s\S]*?setTriangleRoundness\(v\)\)/.test(mainJs),
  '碎片圆角滑块通过公开便捷 API 生效',
);
verify(
  /\['ctrlShardRoundness', 'outShardRoundness', shardDefaults\.roundness, false\]/.test(mainJs) &&
    /\['ctrlShardRoundness', 'shards\.roundness'\]/.test(mainJs) &&
    /ctrlShardRoundness: d\.labelShardRoundness/.test(mainJs),
  '碎片圆角滑块支持重置、本地恢复与双语标签',
);
const nativeTrailAlphaControl = indexHtml.match(
  /<input\s+[^>]*id="ctrlBloomTrailAlpha"[^>]*>/,
)?.[0] ?? '';

verify(
  /min="0"/.test(nativeTrailAlphaControl) &&
    /max="1"/.test(nativeTrailAlphaControl) &&
    /step="0\.01"/.test(nativeTrailAlphaControl) &&
    /value="0\.18"/.test(nativeTrailAlphaControl) &&
    /bindRange\('ctrlBloomTrailAlpha', 'outBloomTrailAlpha',[\s\S]*?setFxParam\('bloom\.trailAlpha', v\)\)/.test(mainJs) &&
    /bindRange\('ctrlBloomTrail', 'outBloomTrail',[\s\S]*?setFxParam\('bloom\.trailEmissionAlpha', v\)\)/.test(mainJs) &&
    !/setFxParam\('bloom\.trailAlpha', v \* 0\.18\)/.test(mainJs),
  '展示页分别调整 Software 与 Native 拖尾辉光 Alpha',
);
verify(
  /\['ctrlBloomTrailAlpha', 'outBloomTrailAlpha', 0\.18, false\]/.test(mainJs) &&
    /\['ctrlBloomTrailAlpha', 'bloom\.trailAlpha'\]/.test(mainJs) &&
    /ctrlBloomTrailAlpha: d\.labelBloomTrailAlpha/.test(mainJs) &&
    /legacyTrailCalibration[\s\S]*?calibration \* 0\.18/.test(mainJs),
  'Native 拖尾辉光 Alpha 支持重置、双语、持久化与旧设置迁移',
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
  ctrlShardHdr: '0.01',
  ctrlShardRoundness: '0.01',
  ctrlShardSizeMin: '0.01',
  ctrlShardSizeMax: '0.01',
  ctrlClickShardRadius: '0.01',
  ctrlClickShardSpeedMin: '0.01',
  ctrlClickShardSpeedMax: '0.01',
  ctrlShardSpacing: '0.01',
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
  ctrlTrailShardRadius: '0.01',
  ctrlTrailShardSpeedMin: '0.01',
  ctrlTrailShardSpeedMax: '0.01',
  ctrlBloomDisk: '0.1',
  ctrlBloomTrailAlpha: '0.01',
};

const dprControl = indexHtml.match(
  /<input\s+[^>]*id="ctrlDpr"[^>]*>/,
)?.[0] ?? '';

verify(
  /maxDpr:\s*1/.test(configJs) &&
    /value="1"/.test(dprControl) &&
    /document\.getElementById\('ctrlDpr'\)\.value = String\(CONFIG\.maxDpr\)/.test(mainJs) &&
    /document\.getElementById\('outDpr'\)\.textContent = CONFIG\.maxDpr\.toFixed\(2\)/.test(mainJs) &&
    /maxDpr:\s*CONFIG\.maxDpr/.test(mainJs) &&
    /最大设备像素比，默认 1/.test(readmeZh) &&
    /maxDpr\?: number,\s+\/\/ default 1/.test(readmeEn),
  '公共库与展示页统一默认最大 DPR 为 1',
);

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
const touchActionSelect = indexHtml.match(
  /<select id="ctrlTouchAction"[\s\S]*?<\/select>/,
)?.[0] ?? '';
const touchActionOptions = [
  ...touchActionSelect.matchAll(
    /<option value="([^"]+)"(?: selected)?>([^<]+)<\/option>/g,
  ),
].map((match) => ({ value: match[1], text: match[2] }));
const expectedTouchActionOptions = [
  { value: 'auto', text: '自动' },
  { value: 'none', text: '禁止默认手势' },
  { value: 'pan-x', text: '仅横向平移' },
  { value: 'pan-y', text: '仅纵向平移' },
  { value: 'pinch-zoom', text: '仅双指缩放' },
  { value: 'pan-x pinch-zoom', text: '横向平移与缩放' },
  { value: 'pan-y pinch-zoom', text: '纵向平移与缩放' },
  { value: 'manipulation', text: '直接操作' },
];
const touchActionSetSource = mainJs.match(
  /const TOUCH_ACTIONS = new Set\(\[([\s\S]*?)\]\);/,
)?.[1] ?? '';
const touchActionValues = [
  ...touchActionSetSource.matchAll(/'([^']+)'/g),
].map((match) => match[1]);

verify(
  JSON.stringify(touchActionOptions) ===
      JSON.stringify(expectedTouchActionOptions) &&
    JSON.stringify(touchActionValues) === JSON.stringify(
      expectedTouchActionOptions.map(({ value }) => value),
    ),
  '展示页触摸行为下拉框与运行时白名单统一提供八种策略',
);
verify(
  /touchActionPinchZoom: '仅双指缩放'/.test(mainJs) &&
    /touchActionPanXPinchZoom: '横向平移与缩放'/.test(mainJs) &&
    /touchActionPanYPinchZoom: '纵向平移与缩放'/.test(mainJs) &&
    /touchActionPinchZoom: 'Pinch Zoom Only'/.test(mainJs) &&
    /touchActionPanXPinchZoom: 'Pan X \+ Pinch Zoom'/.test(mainJs) &&
    /touchActionPanYPinchZoom: 'Pan Y \+ Pinch Zoom'/.test(mainJs) &&
    /'pinch-zoom': d\.touchActionPinchZoom/.test(mainJs) &&
    /'pan-x pinch-zoom': d\.touchActionPanXPinchZoom/.test(mainJs) &&
    /'pan-y pinch-zoom': d\.touchActionPanYPinchZoom/.test(mainJs) &&
    /effect\.updateConfig\(\{ touchAction: resolved \}\)/.test(mainJs) &&
    /localStorage\.setItem\('bafx-ctrlTouchAction', resolved\)/.test(mainJs),
  '保留缩放的触摸行为支持双语切换并复用配置持久化通路',
);
const inputSamplingRateControl = indexHtml.match(
  /<input type="range" id="ctrlInputSamplingRate"[^>]*>/,
)?.[0] ?? '';
const inputSamplingPresetMarkup = indexHtml.match(
  /<datalist id="inputSamplingRatePresets">[\s\S]*?<\/datalist>/,
)?.[0] ?? '';
const inputSamplingPresets = Array.from(
  inputSamplingPresetMarkup.matchAll(/<option value="(\d+)">/g),
  (match) => Number(match[1]),
);

verify(
  /min="0"/.test(inputSamplingRateControl) &&
    /max="1000"/.test(inputSamplingRateControl) &&
    /step="1"/.test(inputSamplingRateControl) &&
    /value="0"/.test(inputSamplingRateControl) &&
    JSON.stringify(inputSamplingPresets) === JSON.stringify([
      0,
      15,
      30,
      60,
      120,
      240,
      500,
      1000,
    ]),
  '输入采样率控件默认不限频并覆盖手机到千赫兹常用档位',
);
verify(
  /effect\.setInputSamplingRate\(rate\)/.test(mainJs) &&
    /bafx-ctrlInputSamplingRate/.test(mainJs) &&
    /applyInputSamplingRate\(savedInputSamplingRate, false\)/.test(mainJs) &&
    /applyInputSamplingRate\(DEFAULT_INPUT_SAMPLING_RATE, false\)/.test(mainJs),
  '输入采样率控件通过公开 API 生效并支持持久化、恢复与重置',
);
verify(
  /labelInputSamplingRate: '输入采样率上限 \(Hz\)'/.test(mainJs) &&
    /labelInputSamplingRate: 'Input Sampling Rate Limit \(Hz\)'/.test(mainJs) &&
    /outInputSamplingRate\.textContent = String\(rate\)/.test(mainJs) &&
    /class="sampling-rate-output">0<\/output>/.test(indexHtml) &&
    /output\.sampling-rate-output[\s\S]*?width: 4ch/.test(styleCss),
  '输入采样率控件提供双语静态单位和固定纯数字输出',
);
verify(
  /inputSamplingRate\?: number/.test(typeDefinitions) &&
    /setInputSamplingRate\(rateHz: number\): boolean/.test(typeDefinitions) &&
    /inputSamplingRate: 30/.test(readmeZh) &&
    /inputSamplingRate: 30/.test(readmeEn) &&
    /1\.\.1000/.test(readmeZh) &&
    /1\.\.1000/.test(readmeEn),
  '输入采样率公共 API 已同步类型声明与中英文文档',
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
  {
    const literal = typeof value === 'string'
      ? `'${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`
      : String(value);

    return new RegExp(`\\b${key}:\\s*${literal}`).test(configSource);
  });
}

verify(
  JSON.stringify(renderModeValues) === JSON.stringify([
    'full-webgpu-sdr',
    'full-webgpu',
    'full-webgl2',
    'webgl2-bloom',
    'software-bloom',
    'native-bloom',
    'legacy',
  ]),
  '展示页按 WebGPU、WebGPU HDR、纯 WebGL2、WebGL2 Bloom、Software、Native 与 Legacy 排列七档渲染开关',
);
verify(
  /<option value="full-webgl2" selected>/.test(renderModeSelect) &&
    /const DEFAULT_RENDER_MODE = 'full-webgl2'/.test(mainJs),
  '展示页 HTML、恢复与重置路径统一默认使用纯 WebGL2',
);
verify(
  hasRenderModeConfig('full-webgpu-sdr',
    {
      effectBackend: 'webgpu',
      webgpuPreferHdr: false,
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
    }) &&
    hasRenderModeConfig('full-webgpu',
    {
      effectBackend: 'webgpu',
      webgpuPreferHdr: true,
      renderingMode: 'enhanced',
      bloomBackend: 'webgl2',
    }) &&
    hasRenderModeConfig('full-webgl2',
    {
      effectBackend: 'webgl2',
      webgpuPreferHdr: true,
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
  '展示页七档开关映射到对应的完整特效、WebGPU 输出偏好、渲染模式与 Bloom API',
);
verify(
  /<option value="full-webgpu-sdr">WebGPU<\/option>/.test(
    renderModeSelect,
  ) &&
    /renderFullWebGPUStandard: 'WebGPU'/.test(mainJs) &&
    /renderFullWebGPU: 'WebGPU HDR（实验）'/.test(mainJs) &&
    /renderFullWebGPU: 'WebGPU HDR \(Experimental\)'/.test(mainJs),
  '普通 WebGPU 中英文名称不带 HDR 或实验标记，旧 HDR 模式名称保持兼容',
);
verify(
  /renderWebGPUOutputExtended: 'Extended HDR · rgba16float'/.test(mainJs) &&
    /renderHdrVerdictReady: '浏览器侧 HDR 已就绪'/.test(mainJs) &&
    /renderHdrVerdictReady: 'Browser-side HDR ready'/.test(mainJs) &&
    /matchMedia\('\(dynamic-range: high\)'\)/.test(mainJs) &&
    /matchMedia\('\(video-dynamic-range: high\)'\)/.test(mainJs) &&
    /\[dynamicRangeQuery, videoDynamicRangeQuery\]/.test(mainJs) &&
    /query\.addEventListener\('change'/.test(mainJs) &&
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
const updateWebGPUDiagnosticDetailsSource = getFunctionSource(
  mainJs,
  'updateWebGPUDiagnosticDetails',
);
const syncWebGPUDiagnosticRefreshSource = getFunctionSource(
  mainJs,
  'syncWebGPUDiagnosticRefresh',
);
const diagnosticValueIds = [
  'diagnosticSecureContextValue',
  'diagnosticWebGPUApiValue',
  'diagnosticCanvasContextValue',
  'diagnosticAdapterValue',
  'diagnosticDeviceValue',
  'diagnosticExtendedCanvasValue',
  'diagnosticSdrFallbackValue',
  'diagnosticPipelineValue',
  'diagnosticGraphicsRangeValue',
  'diagnosticVideoRangeValue',
  'diagnosticCssHdrValue',
];

verify(
  /id="webgpuDiagnosticDetails"/.test(indexHtml) &&
    /id="webgpuDiagnosticFailure"[^>]*hidden/.test(indexHtml) &&
    diagnosticValueIds.every((id) => indexHtml.includes(`id="${id}"`)) &&
    /manager\?\.diagnostics/.test(updateWebGPUDiagnosticDetailsSource) &&
    /window\.isSecureContext/.test(updateWebGPUDiagnosticDetailsSource) &&
    /navigator\.gpu\?\.requestAdapter/.test(
      updateWebGPUDiagnosticDetailsSource,
    ) &&
    /videoDynamicRangeQuery\?\.matches/.test(
      updateWebGPUDiagnosticDetailsSource,
    ) &&
    /supportsHdrUiCss\(\)/.test(updateWebGPUDiagnosticDetailsSource) &&
    /extended-configure-failed/.test(webgpuDeviceJs) &&
    /standard-configure-failed/.test(webgpuDeviceJs) &&
    /device-lost/.test(webgpuDeviceJs) &&
    /get diagnostics\(\)/.test(webgpuDeviceJs) &&
    /manager\?\.status === 'pending'/.test(
      syncWebGPUDiagnosticRefreshSource,
    ) &&
    /webgpuDiagnosticDetails/.test(syncWebGPUDiagnosticRefreshSource) &&
    /\.open === true/.test(syncWebGPUDiagnosticRefreshSource) &&
    /window\.setTimeout/.test(syncWebGPUDiagnosticRefreshSource) &&
    /\.webgpu-diagnostic-failure/.test(styleCss),
  '展示页折叠报告 WebGPU 初始化、输出协商、动态范围与失败阶段',
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
const hdrPresentationDetails = indexHtml.match(
  /<details id="hdrPresentationDetails"[^>]*>[\s\S]*?<\/details>/,
)?.[0] ?? '';
const syncHdrPresentationDetailsSource = getFunctionSource(
  mainJs,
  'syncHdrPresentationDetails',
);
const applyRenderModeSource = getFunctionSource(mainJs, 'applyRenderMode');
const updateRenderBackendStatusSource = getFunctionSource(
  mainJs,
  'updateRenderBackendStatus',
);

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
verify(
  /^<details id="hdrPresentationDetails">/.test(hdrPresentationDetails) &&
    /<summary id="hdrPresentationHeading">/.test(hdrPresentationDetails) &&
    /details\.open = mode === 'full-webgpu'/.test(
      syncHdrPresentationDetailsSource,
    ) &&
    /syncHdrPresentationDetails\(normalizedMode\)/.test(applyRenderModeSource) &&
    /syncHdrPresentationDetails\(DEFAULT_RENDER_MODE\)/.test(mainJs) &&
    !/syncHdrPresentationDetails/.test(updateRenderBackendStatusSource),
  'HDR 显示映射默认折叠，仅随请求模式切换且状态刷新尊重手动折叠',
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
    /展示页的“UI HDR”是演示站点私有功能/.test(readmeZh) &&
    /The demo's UI HDR controls are demo-only/.test(readmeEn) &&
    /dynamic-range-limit: no-limit/.test(readmeZh) &&
    /dynamic-range-limit: no-limit/.test(readmeEn) &&
    !/hdrUi/i.test(typeDefinitions),
  'UI HDR 严格依赖 Extended 与 CSS HDR，且保持为展示页私有能力',
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
const hostCompositingSurfaceSelect = indexHtml.match(
  /<select id="ctrlHostCompositingSurface"[\s\S]*?<\/select>/,
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
const hostCompositingSurfaceValues = [
  ...hostCompositingSurfaceSelect.matchAll(/<option value="([^"]+)"/g),
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
      'plus-lighter',
    ]) &&
    JSON.stringify(hostCompositingSurfaceValues) === JSON.stringify([
      'dom-backdrop',
      'transparent-window',
      'native',
    ]) &&
    /<option value="source-over" selected>/.test(hostCompositingSelect) &&
    /<option value="dom-backdrop" selected>/.test(
      hostCompositingSurfaceSelect,
    ),
  '透明覆盖层提供独立的 Alpha、颜色、宿主合成与宿主表面选择',
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
const applyHostCompositingSurfaceSource = getFunctionSource(
  mainJs,
  'applyHostCompositingSurface',
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
    /ctrlHostCompositingSurface\.disabled = !enabled/.test(
      syncTransparentControlsSource,
    ) &&
    /syncTransparentCompositingControlState\([\s\S]*?resolved/.test(
      applyHostCompositingSource,
    ) &&
    /HOST_COMPOSITING_MODES\.has\(mode\)/.test(
      applyHostCompositingSource,
    ),
  '透明合成控件按输出模式启用并验证当前宿主合成模式',
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
    /hostCompositingSurface: resolved/.test(
      applyHostCompositingSurfaceSource,
    ) &&
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
    ) &&
    /localStorage\.setItem\('bafx-ctrlHostCompositingSurface', resolved\)/.test(
      mainJs,
    ),
  '五个透明合成控件分别通过 updateConfig 生效并持久化',
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
    /bafx-ctrlHostCompositingSurface[\s\S]*?applyHostCompositingSurface\([\s\S]*?savedHostCompositingSurface/.test(
      mainJs,
    ) &&
    /overlayAlphaPolicy: DEFAULT_OVERLAY_ALPHA_POLICY/.test(
      mainJs,
    ) &&
    /overlayColorCompensation: DEFAULT_OVERLAY_COLOR_COMPENSATION/.test(
      mainJs,
    ) &&
    /overlayAlphaLimit: DEFAULT_OVERLAY_ALPHA_LIMIT/.test(mainJs) &&
    /hostCompositing: DEFAULT_HOST_COMPOSITING/.test(mainJs) &&
    /hostCompositingSurface: DEFAULT_HOST_COMPOSITING_SURFACE/.test(mainJs),
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
    /Screen adapts to light backdrops; Plus-lighter preserves more aggressive additive output\. Independent host compositing disables the Alpha policy, color compensation, and Alpha limit/.test(
      mainJs,
    ),
  '双语文案明确 Screen、Plus-lighter 与无效控制项',
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
    /function syncPureWhiteIsolationContrast\(\)[\s\S]*?lightBackgroundContrastOverride[\s\S]*?applyLightBackgroundContrastAlpha\([\s\S]*?resolvePureWhiteContrastAlpha\(effect\.getConfig\(\)\.isolatedCompositing\)/.test(mainJs) &&
    /function applyIsolatedCompositing\(checked\)[\s\S]*?effect\.updateConfig\(\{ isolatedCompositing: checked \}\);[\s\S]*?syncPureWhiteIsolationContrast\(\)/.test(mainJs) &&
    /bindToggle\('ctrlIsolatedCompositing', applyIsolatedCompositing\)/.test(mainJs),
  '展示页隔离合成开关会同步默认纯白对比层并保留手动覆盖',
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
    /applyThemeCompositingReference\(name\)/.test(applyThemeSource) &&
    !/revokeCustomBackgroundObjectUrl/.test(applyThemeSource),
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
    ) &&
    /revokeCustomBackgroundObjectUrl\(rawValue\)/.test(
      applyCustomBackgroundSource,
    ),
  '自定义背景保留可重用的本地 URL，并只上传已解码的合成参考',
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
  /ctrlColor\.addEventListener\('input',[\s\S]*?effect\.setThemeColor\(ctrlColor\.value\)[\s\S]*?\}\);/.test(mainJs) &&
    /effect\.setThemeColor\(restoredColor\)/.test(mainJs),
  '展示页输入与首次恢复都会主动应用颜色控件值',
);
verify(
  /id="ctrlColor" value="#4ca7ff"/.test(indexHtml) &&
    /effect\.setThemeColor\('#4ca7ff'\)/.test(mainJs),
  '展示页首次加载与重置都使用游戏基准蓝',
);
verify(
  /DEFAULT_THEME_COLOR_MODE = 'hue-only'/.test(configJs) &&
    /themeColorMode: DEFAULT_THEME_COLOR_MODE/.test(configJs) &&
    /\['hue-only', 'relative-oklch'\]/.test(configJs) &&
    /setThemeColorMode\(mode\)/.test(engineJs) &&
    /DEFAULT_THEME_COLOR_MODE,/.test(engineJs),
  '公共库保留 hue-only 默认并导出相对 OKLCH 主题模式 API',
);
verify(
  /id="ctrlThemeColorMode"/.test(indexHtml) &&
    /value="relative-oklch" selected/.test(indexHtml) &&
    /value="hue-only"/.test(indexHtml) &&
    /DEFAULT_DEMO_THEME_COLOR_MODE = 'relative-oklch'/.test(mainJs) &&
    /effect\.setThemeColorMode\(mode\)/.test(mainJs),
  '展示页提供推荐相对 OKLCH 与兼容仅色相模式',
);
verify(
  /bafx-ctrlThemeColorMode/.test(mainJs) &&
    /savedColor !== null[\s\S]*?LEGACY_THEME_COLOR_MODE[\s\S]*?DEFAULT_DEMO_THEME_COLOR_MODE/.test(mainJs) &&
    /applyThemeColorMode\(DEFAULT_DEMO_THEME_COLOR_MODE, false\)/.test(mainJs) &&
    /applyThemeColorMode\(restoredThemeColorMode\)/.test(mainJs),
  '主题映射模式支持新用户默认、旧颜色兼容迁移、持久化与重置',
);
verify(
  /BAClickFXThemeColorMode = 'hue-only' \| 'relative-oklch'/.test(
    typeDefinitions,
  ) &&
    /DEFAULT_THEME_COLOR_MODE: 'hue-only'/.test(typeDefinitions) &&
    /setThemeColorMode\(mode: BAClickFXThemeColorMode\): boolean/.test(
      typeDefinitions,
    ) &&
    /relative-oklch/.test(readmeZh) &&
    /relative-oklch/.test(readmeEn),
  '主题映射模式已同步类型声明与中英文文档',
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
    /const DEFAULT_BLOOM_BACKEND = 'webgl2'/.test(configJs) &&
    /webgpuPreferHdr: true/.test(configJs) &&
    /webgpuPreferHdr\?: boolean/.test(typeDefinitions) &&
    /webgpuPreferHdr: boolean/.test(typeDefinitions),
  '库默认使用纯 WebGL2、保留 HDR 输出偏好，并公开 WebGPU 标准输出类型合同',
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
