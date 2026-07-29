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
const styleCss = fs.readFileSync(path.join(root, 'src', 'style.css'), 'utf8');
const engineJs = fs.readFileSync(path.join(root, 'src', 'fx.js'), 'utf8');
const configJs = fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8');

function verify(condition, message)
{
  if (!condition)
  {
    throw new Error(`[verify-sync] ${message}`);
  }

  console.log(`  ✓ ${message}`);
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

verify(
  /type="checkbox"/.test(isolatedCompositingControl) &&
    !/\bchecked\b/.test(isolatedCompositingControl),
  '展示页提供默认关闭的隔离合成兼容开关',
);
const staticFaqContent = indexHtml.match(
  /<div id="introFAQContent">[\s\S]*?<\/div>/,
)?.[0] ?? '';

verify(
  /纯白背景下特效颜色太浅/.test(staticFaqContent) &&
    /isolatedCompositing: true/.test(staticFaqContent) &&
    /纯白背景下特效颜色太浅/.test(mainJs) &&
    /Effects look washed out on a pure white background/.test(mainJs) &&
    /lightBackgroundContrastAlpha: 0\.35/.test(mainJs),
  '静态与双语 FAQ 提示纯白背景启用隔离合成',
);
verify(
  /bindToggle\('ctrlIsolatedCompositing',[\s\S]*?effect\.updateConfig\(\{ isolatedCompositing: checked \}\)\)/.test(mainJs),
  '展示页隔离合成开关通过公开 updateConfig API 生效并复用持久化绑定',
);
verify(
  /localStorage\.getItem\('bafx-ctrlIsolatedCompositing'\)/.test(mainJs) &&
    /savedIsolatedCompositing !== null/.test(mainJs) &&
    /const isolated = savedIsolatedCompositing === 'true'/.test(mainJs) &&
    /effect\.updateConfig\(\{ isolatedCompositing: isolated \}\)/.test(mainJs),
  '展示页会恢复已持久化的隔离或直接合成选项',
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
    /classList\.toggle\('theme-pure-white', name === '纯白'\)/.test(mainJs) &&
    /classList\.remove\('theme-pure-white'\)[\s\S]*?applySceneBackgroundImage/.test(mainJs),
  '纯白主题关闭装饰网格，自定义栅格背景仍走原子 Scene 加载路径',
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
