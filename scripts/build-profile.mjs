import { readFileSync } from 'node:fs';
import { CONFIG, UNITY_FX_TOUCH, createConfig } from '../src/config.js';
import { applyFxParamPatch } from '../src/fx-param-patch.js';

export const BACKENDS = ['webgl2', 'webgpu', 'webgpu-hdr', 'webgl2-bloom', 'software', 'native'];
export const RUNTIMES = ['dom', 'manual', 'worker'];
const featureNames = ['click', 'trail', 'shards', 'bloom', 'compositingReference'];
const controlledConfig = ['effectBackend', 'bloomBackend', 'webgpuPreferHdr', 'inputSource', 'clickEnabled', 'trailEnabled'];

function object(value, name)
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
  {
    throw new TypeError(`${name} 必须是对象`);
  }
  return value;
}

function keys(value, allowed, name)
{
  for (const key of Object.keys(value))
  {
    if (!allowed.includes(key))
    {
      throw new TypeError(`${name} 未知字段: ${key}`);
    }
  }
}

export function normalizeProfile(input)
{
  object(input, 'profile');
  keys(input, ['backend', 'runtime', 'features', 'config', 'fxParams'], 'profile');
  if (!BACKENDS.includes(input.backend) || !RUNTIMES.includes(input.runtime))
  {
    throw new TypeError('profile 必须选择有效的 backend 和 runtime');
  }
  const overrides = object(input.features === undefined ? {} : input.features, 'features');
  keys(overrides, featureNames, 'features');
  for (const [key, value] of Object.entries(overrides))
  {
    if (typeof value !== 'boolean')
    {
      throw new TypeError(`features.${key} 必须是布尔值`);
    }
  }
  const features = Object.fromEntries(featureNames.map(key => [key, overrides[key] ?? true]));
  const configInput = object(input.config === undefined ? {} : input.config, 'config');
  for (const key of controlledConfig)
  {
    if (Object.hasOwn(configInput, key))
    {
      throw new TypeError(`config.${key} 由 profile 统一决定`);
    }
  }
  if (!features.trail && configInput.trailAlways === true)
  {
    throw new TypeError('trailAlways 与关闭 trail 冲突');
  }
  if (input.runtime !== 'dom' && configInput.isolatedCompositing === true)
  {
    throw new TypeError('独立 Canvas 不支持 isolatedCompositing');
  }
  const gpu = ['webgl2', 'webgpu', 'webgpu-hdr'].includes(input.backend);
  const config = createConfig({
    ...configInput,
    effectBackend: gpu ? input.backend.startsWith('webgpu') ? 'webgpu' : 'webgl2' : 'canvas2d',
    bloomBackend: input.backend === 'webgl2-bloom' ? 'webgl2' : ['software', 'native'].includes(input.backend) ? input.backend : 'native',
    webgpuPreferHdr: input.backend === 'webgpu-hdr',
    inputSource: input.runtime === 'dom' ? 'dom' : 'manual',
    clickEnabled: features.click,
    trailEnabled: features.trail,
    isolatedCompositing: input.runtime === 'dom' ? configInput.isolatedCompositing ?? CONFIG.isolatedCompositing : false,
  });
  const result = applyFxParamPatch(object(input.fxParams === undefined ? {} : input.fxParams, 'fxParams'), {
    baseline: UNITY_FX_TOUCH,
    strict: true,
  });
  if (result.rejected.length)
  {
    throw new TypeError(`fxParams 被拒绝: ${JSON.stringify(result.rejected)}`);
  }
  for (const path of Object.keys(input.fxParams ?? {}))
  {
    const group = path.split('.')[0];
    const feature = ['hit', 'flare', 'disk', 'rings'].includes(group) ? 'click' : group;
    if (featureNames.includes(feature) && !features[feature])
    {
      throw new TypeError(`关闭 ${feature} 时不能指定 ${path}`);
    }
  }
  // 使用同一参数补丁器归一化，避免构建版与完整版的数值语义分叉。
  const fxParams = result.nextConfig;
  if (!features.bloom)
  {
    fxParams.bloom.intensity = 0;
  }
  return { backend: input.backend, runtime: input.runtime, features, config, fxParams, normalized: result.normalized };
}

export function readProfile(path)
{
  return normalizeProfile(JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')));
}
