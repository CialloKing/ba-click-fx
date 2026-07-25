import
{
  defineConfig,
} from 'vite';

const LIB_FILE_NAMES =
{
  es: 'ba-click-fx.js',
  cjs: 'ba-click-fx.cjs',
  iife: 'ba-click-fx.iife.js',
};

export default defineConfig(
{
  build:
  {
    target: 'es2020',
    // Demo 构建先写入 dist，库构建必须保留这些产物。
    emptyOutDir: false,
    // public 目录已由 Demo 构建复制，避免在库构建中重复处理。
    copyPublicDir: false,
    lib:
    {
      entry: 'src/fx.js',
      name: 'BAClickFX',
      formats: ['es', 'cjs', 'iife'],
      fileName: format => LIB_FILE_NAMES[format],
    },
    rollupOptions:
    {
      output:
      {
        exports: 'named',
      },
    },
  },
});
