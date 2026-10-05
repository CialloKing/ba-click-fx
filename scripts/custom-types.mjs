import { customApi } from './custom-compiler.mjs';

function shape(value)
{
  if (Array.isArray(value)) return `[${value.map(shape).join(', ')}]`;
  if (value && typeof value === 'object') return `{ ${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${shape(item)};`).join(' ')} }`;
  return typeof value === 'string' ? JSON.stringify(value) : typeof value;
}

export function customTypes(profile)
{
  const methods = {
    resize: 'resize(width?: number, height?: number, dpr?: number): void;',
    setPaused: 'setPaused(paused: boolean, options?: { clear?: boolean }): void;',
    clear: 'clear(): void;', destroy: 'destroy(): void;',
    getConfig: 'getConfig(): BAClickFXConfigSnapshot;',
    getFxConfig: 'getFxConfig(): BAClickFXFxConfig;',
    boom: 'boom(x?: number, y?: number): void;', clearTrail: 'clearTrail(): void;',
    pointerDown: 'pointerDown(input: BAClickFXPointerInput): boolean;',
    pointerMove: 'pointerMove(input: BAClickFXPointerInput): boolean;',
    pointerUp: 'pointerUp(pointerId?: number): boolean;',
    pointerCancel: 'pointerCancel(pointerId?: number): boolean;',
    getEffectiveHostCompositing: 'getEffectiveHostCompositing(): "source-over" | "screen" | "plus-lighter";',
    setCompositingReference: 'setCompositingReference(source: TexImageSource | null, options?: { fit?: "cover" }): boolean;',
  };
  const target = profile.runtime === 'dom' ? 'target?: string | HTMLElement; inputFilter?: (event: PointerEvent) => boolean;'
    : `target: ${profile.runtime === 'worker' ? 'OffscreenCanvas' : 'HTMLCanvasElement'};`;
  return `export interface BAClickFXError extends Error { readonly code: string; }
export interface BAClickFXOptions { ${target} onError?: (error: BAClickFXError) => void; }
export interface BAClickFXPointerInput { x: number; y: number; pointerId?: number; pointerType?: 'mouse' | 'touch' | 'pen'; }
export type BAClickFXFxConfig = ${shape(profile.fxParams)};
export type BAClickFXConfigSnapshot = ${shape(profile.config)} & {
  requestedHostCompositing: 'source-over' | 'screen' | 'plus-lighter';
  resolvedHostCompositing: 'source-over' | 'screen' | 'plus-lighter';
  compositingWarning: string | null;
  resolvedEffectBackend: 'canvas2d' | 'webgl2' | 'webgpu' | 'pending' | 'unavailable';
  resolvedBloomBackend: 'software' | 'native' | 'webgl2' | 'webgpu' | 'pending' | 'unavailable';
  resolvedWebGPUOutputMode: 'standard' | 'extended' | 'pending' | 'unavailable';
  unity: BAClickFXFxConfig;
};
export class BAClickFX {
  constructor(options${profile.runtime === 'dom' ? '?' : ''}: BAClickFXOptions);
  readonly canvas: ${profile.runtime === 'worker' ? 'OffscreenCanvas' : 'HTMLCanvasElement'};
  readonly width: number;
  readonly height: number;
  ${customApi(profile).map(name => methods[name]).join('\n  ')}
}
export default BAClickFX;
`;
}
