#!/usr/bin/env node

/**
 * 检查公共配置、类型声明、Unity 参数源与引擎实现的同步合同。
 * 展示页控件、样式和 README 合同由 verify-demo-sync.cjs 单独负责。
 */

const {
  getFunctionSource,
  readText,
  verify,
} = require('./verify-sync.cjs');

const engineJs = readText('src/fx.js');
const configJs = readText('src/config.js');
const typeDefinitions = readText('src/ba-click-fx.d.ts');

verify(
  /DEFAULT_THEME_COLOR_MODE = 'relative-oklch'/.test(configJs) &&
    /themeColorMode: DEFAULT_THEME_COLOR_MODE/.test(configJs) &&
    /\['hue-only', 'relative-oklch'\]/.test(configJs) &&
    /setThemeColorMode\(mode\)/.test(engineJs) &&
    /DEFAULT_THEME_COLOR_MODE,/.test(engineJs),
  '公共库默认使用相对 OKLCH 并导出主题模式 API',
);
verify(
  /isolatedCompositing: false/.test(configJs) &&
    /lightBackgroundContrastAlpha: 0/.test(configJs) &&
    /isolatedCompositing: value => typeof value === 'boolean'/.test(configJs),
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

// Canvas 合成层与指针生命周期由浏览器核心/生命周期合同覆盖；
// 这里保留 Unity 参数源静态合同，避免重复实现正则。
verify(/UNITY_FX_TOUCH/.test(engineJs), '渲染引擎直接消费 Unity 参数源');
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


console.log('\n✅ 运行时同步检查通过\n');
