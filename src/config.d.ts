import type {
  BAClickFXBloomBackend,
  BAClickFXCompositingWarning,
  BAClickFXConfig,
  BAClickFXEffectBackend,
  BAClickFXHostCompositing,
  BAClickFXHostCompositingSurface,
  BAClickFXInputSource,
  BAClickFXOutputCompositing,
  BAClickFXOverlayAlphaPolicy,
  BAClickFXOverlayColorCompensation,
  BAClickFXThemeColorMode,
} from 'ba-click-fx';

// 类型可以共享，运行时值只能列出 config.js 实际提供的导出。
export type * from 'ba-click-fx';
export {
  CONFIG,
  DEFAULT_THEME_COLOR,
  DEFAULT_THEME_COLOR_MODE,
  FX_PARAM_MIGRATIONS,
  FX_PARAM_SCHEMA,
  FX_PARAM_SCHEMA_VERSION,
  SIZE_CORRECTION,
  UNITY_FX_TOUCH,
  createConfig,
} from 'ba-click-fx';

export const MIN_TIME_SCALE: 0.01;

export function isEffectBackend(value: unknown): value is BAClickFXEffectBackend;
export function normalizeEffectBackend(value: unknown, fallback?: BAClickFXEffectBackend): BAClickFXEffectBackend;
export function isBloomBackend(value: unknown): value is BAClickFXBloomBackend;
export function normalizeBloomBackend(value: unknown, fallback?: BAClickFXBloomBackend): BAClickFXBloomBackend;
export function isInputSource(value: unknown): value is BAClickFXInputSource;
export function isInputSamplingRate(value: unknown): value is number;
export function normalizeInputSamplingRate(value: unknown, fallback?: number): number;
export function isOutputCompositing(value: unknown): value is BAClickFXOutputCompositing;
export function normalizeOutputCompositing(value: unknown, fallback?: BAClickFXOutputCompositing): BAClickFXOutputCompositing;
export function isOverlayAlphaPolicy(value: unknown): value is BAClickFXOverlayAlphaPolicy;
export function normalizeOverlayAlphaPolicyConfig(value: unknown, fallback?: BAClickFXOverlayAlphaPolicy): BAClickFXOverlayAlphaPolicy;
export function isOverlayColorCompensation(value: unknown): value is BAClickFXOverlayColorCompensation;
export function normalizeOverlayColorCompensationConfig(value: unknown, fallback?: BAClickFXOverlayColorCompensation): BAClickFXOverlayColorCompensation;
export function isOverlayAlphaLimit(value: unknown): value is number;
export function normalizeOverlayAlphaLimit(value: unknown, fallback?: number): number;
export function isHostCompositing(value: unknown): value is BAClickFXHostCompositing;
export function isIndependentHostCompositing(value: unknown): value is 'screen' | 'plus-lighter';
export function normalizeHostCompositing(value: unknown, fallback?: BAClickFXHostCompositing): BAClickFXHostCompositing;
export function isHostCompositingSurface(value: unknown): value is BAClickFXHostCompositingSurface;
export function normalizeHostCompositingSurface(value: unknown, fallback?: BAClickFXHostCompositingSurface): BAClickFXHostCompositingSurface;
export function isTimeScale(value: unknown): value is number;
export function normalizeTimeScale(value: unknown, fallback?: number): number;
export function normalizeThemeColor(value: unknown, fallback?: string): string;
export function isThemeColorMode(value: unknown): value is BAClickFXThemeColorMode;

export function normalizeThemeColorMode(
  value: unknown,
  fallback?: BAClickFXThemeColorMode,
): BAClickFXThemeColorMode;

export function resolveHostCompositing(options?: {
  outputCompositing?: BAClickFXOutputCompositing;
  requestedHostCompositing?: BAClickFXHostCompositing;
  hostCompositingSurface?: BAClickFXHostCompositingSurface;
  hasCompositingReference?: boolean;
}): {
  resolvedHostCompositing: BAClickFXHostCompositing;
  compositingWarning: BAClickFXCompositingWarning | null;
};

type HdrPresentation = Pick<BAClickFXConfig,
  'webgpuHdrPeak' | 'webgpuHdrBrightness' | 'webgpuHdrColorPreservation' |
  'webgpuHdrWhiteCore' | 'webgpuHdrWhiteStart' | 'webgpuHdrWhiteEnd'>;
type HdrFallback = Partial<HdrPresentation & {
  peak: number;
  brightness: number;
  colorPreservation: number;
  whiteCore: number;
  whiteStart: number;
  whiteEnd: number;
}>;

export function normalizeWebGPUHdrPresentation(
  overrides?: Partial<Record<keyof HdrPresentation, unknown>>,
  fallback?: HdrFallback,
): HdrPresentation;

export function assertConfigOverrides(
  overrides: unknown,
  options?: {
    allowInstanceOptions?: boolean;
    fallback?: Partial<BAClickFXConfig> & HdrFallback;
  },
): void;
