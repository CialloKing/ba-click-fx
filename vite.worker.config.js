import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: 'src/worker-entry.js',
      name: 'BAClickFXWorker',
      formats: ['iife'],
      fileName: () => 'ba-click-fx.worker.iife.js',
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
