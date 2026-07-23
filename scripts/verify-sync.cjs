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
    /step="0\.05"/.test(clickGlowControl) &&
    /value="1"/.test(clickGlowControl),
  '展示页提供默认值为 1 的点击辉光强度滑块',
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
verify(/inputFilter/.test(mainJs), '演示页把信息卡映射为 Unity UGUI 输入过滤区');
const renderModeSelect = indexHtml.match(
  /<select id="ctrlRenderMode"[\s\S]*?<\/select>/,
)?.[0] ?? '';
const renderModeValues = [...renderModeSelect.matchAll(/<option value="([^"]+)"/g)]
  .map((match) => match[1]);

verify(
  JSON.stringify(renderModeValues) === JSON.stringify([
    'software-bloom',
    'webgl2-bloom',
    'native-bloom',
    'legacy',
  ]),
  '展示页提供 WebGL2、Software、Native 与 Legacy 四档渲染开关',
);
verify(
  /'software-bloom': \{ renderingMode: 'enhanced', bloomBackend: 'software' \}/.test(mainJs) &&
    /'webgl2-bloom': \{ renderingMode: 'enhanced', bloomBackend: 'webgl2' \}/.test(mainJs) &&
    /'native-bloom': \{ renderingMode: 'enhanced', bloomBackend: 'native' \}/.test(mainJs) &&
    /legacy: \{ renderingMode: 'legacy' \}/.test(mainJs),
  '展示页四档开关映射到对应的公开 renderingMode 与 bloomBackend API',
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
    /\bchecked\b/.test(isolatedCompositingControl),
  '展示页提供默认开启的隔离合成开关',
);
verify(
  /bindToggle\('ctrlIsolatedCompositing',[\s\S]*?effect\.updateConfig\(\{ isolatedCompositing: checked \}\)\)/.test(mainJs),
  '展示页隔离合成开关通过公开 updateConfig API 生效并复用持久化绑定',
);
verify(
  /localStorage\.getItem\('bafx-ctrlIsolatedCompositing'\)/.test(mainJs) &&
    /savedIsolatedCompositing === 'false'/.test(mainJs) &&
    /effect\.updateConfig\(\{ isolatedCompositing: false \}\)/.test(mainJs),
  '展示页会恢复已持久化的直接合成选项',
);
verify(
  /getElementById\('ctrlIsolatedCompositing'\)\.checked = true/.test(mainJs) &&
    /isolatedCompositing: true/.test(mainJs),
  '展示页重置操作同时恢复隔离合成控件和引擎配置',
);
verify(
  /ctrlColor\.addEventListener\('input',[\s\S]*?effect\.setThemeColor\(ctrlColor\.value\)[\s\S]*?\}\);[\s\S]*?effect\.setThemeColor\(ctrlColor\.value\)/.test(mainJs),
  '展示页首次加载会主动应用颜色控件默认值',
);
verify(
  /isolatedCompositing: true/.test(configJs) &&
    /typeof overrides\.isolatedCompositing === 'boolean'/.test(configJs),
  '隔离合成默认开启，createConfig 仅接受布尔覆盖值',
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
  /textureRadialAlphaKeys/.test(configJs) &&
    /bandToOuterRadius/.test(configJs),
  '圆环保留纹理径向亮度与 MeshTri 固定环宽比例',
);

console.log('\n✅ Unity 参数同步检查通过\n');
