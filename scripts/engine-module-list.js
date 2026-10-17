// 显式的内部展开顺序；编译器和隔离诊断副本共用，不参与公开入口。
export const ENGINE_HELPERS = ['engine-math.js', 'engine-render-state.js', 'engine-materials.js', 'engine-canvas-textures.js',
  'engine-canvas-primitives.js', 'engine-particles.js', 'engine-trail-geometry.js', 'engine-trail.js'];
export const ENGINE_RUNTIMES = [
  'engine-input.js', 'engine-backends.js', 'engine-lifecycle.js', 'engine-config.js', 'engine-effects.js',
];
export const ENGINE_MODULES = [...ENGINE_HELPERS, ...ENGINE_RUNTIMES, 'engine-core.js'];
