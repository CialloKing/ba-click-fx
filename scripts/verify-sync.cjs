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
const themeBackgroundJs = fs.readFileSync(
  path.join(root, 'src', 'theme-background.js'),
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

  const openingBrace = source.indexOf('{', start);
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
    'full-webgl2',
    'webgl2-bloom',
    'software-bloom',
    'native-bloom',
    'legacy',
  ]),
  '展示页按纯 WebGL2、WebGL2 Bloom、Software、Native 与 Legacy 排列五档渲染开关',
);
verify(
  /<option value="full-webgl2" selected>/.test(renderModeSelect) &&
    /const DEFAULT_RENDER_MODE = 'full-webgl2'/.test(mainJs),
  '展示页 HTML、恢复与重置路径统一默认使用纯 WebGL2',
);
verify(
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
  '展示页五档开关映射到对应的完整特效、渲染模式与 Bloom API',
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
    'transparent-overlay',
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
verify(
  /BLOOM_BACKEND_CHANGE_EVENT/.test(mainJs) &&
    /renderBackendPending/.test(mainJs),
  '展示页监听后端解析事件并单独显示 WebGL2 延迟探测状态',
);
const isolatedCompositingControl = indexHtml.match(
  /<input\s+[^>]*id="ctrlIsolatedCompositing"[^>]*>/,
)?.[0] ?? '';
const sceneBackgroundControl = indexHtml.match(
  /<input\s+[^>]*id="ctrlSceneBackgroundEnabled"[^>]*>/,
)?.[0] ?? '';

verify(
  /type="checkbox"/.test(isolatedCompositingControl) &&
    !/\bchecked\b/.test(isolatedCompositingControl),
  '展示页提供默认关闭的隔离合成兼容开关',
);
verify(
  /type="checkbox"/.test(sceneBackgroundControl) &&
    /\bchecked\b/.test(sceneBackgroundControl) &&
    /labelSceneBackgroundEnabled: '启用场景背景'/.test(mainJs) &&
    /labelSceneBackgroundEnabled: 'Enable Scene Background'/.test(mainJs) &&
    /ctrlSceneBackgroundEnabled: d\.labelSceneBackgroundEnabled/.test(mainJs),
  '展示页提供可本地化的通用场景背景开关',
);
verify(
  /sceneBackgroundEnabledOverride = ctrlSceneBackgroundEnabled\.checked/.test(mainJs) &&
    /applySceneBackgroundEnabled\(sceneBackgroundEnabledOverride\)/.test(mainJs) &&
    /localStorage\.setItem\([\s\S]*?'bafx-ctrlSceneBackgroundEnabled'[\s\S]*?String\(sceneBackgroundEnabledOverride\)/.test(mainJs) &&
    /const savedSceneBackgroundEnabled = localStorage\.getItem\([\s\S]*?'bafx-ctrlSceneBackgroundEnabled'[\s\S]*?\)/.test(mainJs) &&
    /sceneBackgroundEnabledOverride = savedSceneBackgroundEnabled === 'true'/.test(mainJs),
  '场景背景开关通过公开 API 生效，并可全局持久化恢复',
);
const staticFaqContent = indexHtml.match(
  /<div id="introFAQContent">[\s\S]*?<\/div>/,
)?.[0] ?? '';

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
  /body\.scene-background-source::before,[\s\S]*?body\.theme-pure-white::before[\s\S]*?display: none/.test(
    styleCss,
  ) &&
    /classList\.toggle\('theme-pure-white', name === PURE_WHITE_THEME\)/.test(mainJs) &&
    /classList\.remove\('theme-pure-white'\)[\s\S]*?applySceneBackgroundImage/.test(mainJs),
  '纯白主题关闭装饰网格，并在自定义背景切换时不保留旧场景源',
);
const applyThemeSource = getFunctionSource(mainJs, 'applyTheme');
const applyThemeSceneBackgroundSource = getFunctionSource(
  mainJs,
  'applyThemeSceneBackground',
);
const updateThemeSceneBackgroundSource = getFunctionSource(
  mainJs,
  'updateThemeSceneBackground',
);
const applySceneBackgroundEnabledSource = getFunctionSource(
  mainJs,
  'applySceneBackgroundEnabled',
);
const syncSceneBackgroundSourceClassSource = getFunctionSource(
  mainJs,
  'syncSceneBackgroundSourceClass',
);
const applyCustomBackgroundSource = getFunctionSource(
  mainJs,
  'applyCustomBackground',
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
    /applyThemeSceneBackground\(name\)/.test(applyThemeSource) &&
    !/clearSceneBackground\(\)/.test(applyThemeSource),
  '内置主题统一进入对应的 Scene 背景选择路径',
);
verify(
  /applySceneBackgroundEnabledForTheme\(\)/.test(
    applyThemeSceneBackgroundSource,
  ) &&
    !/clearSceneBackground\(\)/.test(applyThemeSceneBackgroundSource) &&
    applyThemeSceneBackgroundSource.indexOf(
      'applySceneBackgroundEnabledForTheme()',
    ) < applyThemeSceneBackgroundSource.indexOf('activeThemeScene = name'),
  '主题切换先应用场景背景开关，再保留对应的可重连栅格源',
);
verify(
  /renderThemeSceneBackground\([\s\S]*?themeSceneCanvas,[\s\S]*?activeThemeScene/.test(
    updateThemeSceneBackgroundSource,
  ) &&
    /effect\.setSceneBackground\(themeSceneCanvas, \{ fit: 'cover' \}\)/.test(
      updateThemeSceneBackgroundSource,
    ) &&
    /syncSceneBackgroundSourceClass\(\)/.test(
      updateThemeSceneBackgroundSource,
    ),
  '内置主题栅格源会交给 Scene 合成，并按开关同步装饰层',
);
verify(
  /stopThemeSceneBackgroundSync\(\)/.test(getFunctionSource(mainJs, 'clearSceneBackground')) &&
    /syncPureWhiteIsolationContrast\(\)/.test(applyCustomBackgroundSource) &&
    /applySceneBackgroundEnabledForTheme\(\)/.test(applyCustomBackgroundSource) &&
    /applySceneBackgroundImage\(resolveSceneBackgroundUrl\(rawValue\)\)/.test(
      applyCustomBackgroundSource,
    ) &&
    applyCustomBackgroundSource.indexOf(
      'applySceneBackgroundEnabledForTheme()',
    ) < applyCustomBackgroundSource.indexOf(
      'applySceneBackgroundImage(resolveSceneBackgroundUrl(rawValue))',
    ),
  '自定义背景沿用全局开关，自定义图片仍按既有路径上传',
);
verify(
  /effect\.setSceneBackgroundEnabled\(enabled\)/.test(
    applySceneBackgroundEnabledSource,
  ) &&
    /control\.checked = actualEnabled/.test(
      applySceneBackgroundEnabledSource,
    ) &&
    /sceneBackgroundEnabled && effect\.sceneBackgroundSource !== null/.test(
      syncSceneBackgroundSourceClassSource,
    ),
  '展示页以公开开关控制渲染器，并只在已启用且有源时隐藏装饰层',
);
const sceneBackgroundRestoreIndex = mainJs.indexOf(
  'const savedSceneBackgroundEnabled = localStorage.getItem(',
);
const themeRestoreIndex = mainJs.indexOf(
  "const theme = localStorage.getItem('bafx-theme');",
);

verify(
  sceneBackgroundRestoreIndex >= 0 &&
    themeRestoreIndex > sceneBackgroundRestoreIndex &&
    mainJs.indexOf(
      'applySceneBackgroundEnabled(sceneBackgroundEnabledOverride);',
      sceneBackgroundRestoreIndex,
    ) < themeRestoreIndex,
  '场景背景人工偏好会在主题源恢复前先应用',
);
verify(
  /return sceneBackgroundEnabledOverride \?\? true/.test(mainJs) &&
    /sceneBackgroundEnabled && effect\.sceneBackgroundSource !== null/.test(mainJs) &&
    /sceneBackgroundEnabledOverride = null/.test(mainJs) &&
    /getElementById\('ctrlSceneBackgroundEnabled'\)\.checked = true/.test(mainJs) &&
    /else\s*\{\s*applyTheme\('蔚蓝'\);\s*\}/.test(mainJs),
  '所有内置主题默认启用场景背景；重置和首次加载均恢复自动策略',
);
verify(
  /纯白主题也保留白色场景纹理/.test(staticFaqContent) &&
    /“启用场景背景”是独立的全局人工覆盖/.test(staticFaqContent) &&
    /纯白主题也保留白色场景纹理/.test(mainJs) &&
    /Enable Scene Background is an independent global manual override/.test(mainJs),
  '静态与双语 FAQ 说明纯白场景纹理和全局人工背景开关的关系',
);
verify(
  /new URL\(trimmed, document\.baseURI\)/.test(
    getFunctionSource(mainJs, 'resolveSceneBackgroundUrl'),
  ) &&
    /url\.protocol !== 'file:'/.test(
      getFunctionSource(mainJs, 'resolveSceneBackgroundUrl'),
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
  /sceneBackgroundEnabled: true/.test(configJs) &&
    /typeof overrides\.sceneBackgroundEnabled === 'boolean'/.test(configJs) &&
    /setSceneBackgroundEnabled\(enabled\)/.test(engineJs) &&
    /typeof overrides\.sceneBackgroundEnabled === 'boolean'[\s\S]*?setSceneBackgroundEnabled\(overrides\.sceneBackgroundEnabled\)/.test(
      engineJs,
    ) &&
    /sceneBackgroundEnabled\?: boolean/.test(typeDefinitions) &&
    /setSceneBackgroundEnabled\(enabled: boolean\): boolean/.test(
      typeDefinitions,
    ),
  '场景背景可通过公开 API 与运行时配置无损开关',
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
  /const hasDedicatedSceneOutput =[\s\S]*?useWebGLClickEffects \|\| useWebGL2Bloom \|\| canvasSceneRendered/.test(engineJs) &&
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
