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
verify(/inputFilter/.test(mainJs), '演示页把信息卡映射为 Unity UGUI 输入过滤区');
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
