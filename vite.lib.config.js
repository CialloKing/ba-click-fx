import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
    emptyOutDir: false,  // 不清空 dist，保留 demo 构建产物
    lib: {
      entry: 'src/ba-spark.js',
      name: 'BASpark',
      formats: ['es', 'cjs', 'iife'],
      fileName: (format) =>
        `ba-click-fx.${format === 'iife' ? 'iife' : format === 'cjs' ? 'cjs' : 'js'}`,
    },
    rollupOptions: {
      output: {
        exports: 'named',
      },
    },
  },
});
