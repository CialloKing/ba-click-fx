/**
 * Dedicated Worker 入口。
 *
 * Worker 宿主只需要同一个 BAClickFX 核心类；独立子路径用于让打包器
 * 明确识别 Worker 运行时，不再要求宿主从包根猜测入口文件。
 */
export {
  default,
  BAClickFX,
  BLOOM_BACKEND_CHANGE_EVENT,
  CONFIG,
  DEFAULT_THEME_COLOR,
  DEFAULT_THEME_COLOR_MODE,
  EFFECT_BACKEND_CHANGE_EVENT,
  FX_PARAM_MIGRATIONS,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  HOST_COMPOSITING_CHANGE_EVENT,
  UNITY_FX_TOUCH,
  createConfig,
  SIZE_CORRECTION,
  applyFxParamPatch,
} from './fx.js';
