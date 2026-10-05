import
{
  defineConfig,
} from 'vite';
import { customVite } from './scripts/custom-vite.mjs';

const libraryEntries =
{
  'ba-click-fx': 'src/fx.js',
  config: 'src/config.js',
  worker: 'src/worker.js',
};
const selectedEntry = process.env.BA_CLICK_FX_LIB_ENTRY;
const profile = process.env.BA_CLICK_FX_PROFILE ? JSON.parse(process.env.BA_CLICK_FX_PROFILE) : null;

export default defineConfig(
{
  plugins: profile ? [customVite(process.cwd(), profile)] : [],
  build:
  {
    target: 'es2020',
    outDir: profile ? 'dist-custom' : 'dist',
    // Demo 构建先写入 dist，库构建必须保留这些产物。
    emptyOutDir: false,
    // public 目录已由 Demo 构建复制，避免在库构建中重复处理。
    copyPublicDir: false,
    lib:
    {
      entry: profile ? 'dist-custom/.entry.js' : selectedEntry
        ? libraryEntries[selectedEntry]
        : libraryEntries,
      formats: ['es'],
      fileName: (_format, entryName) => `${profile ? 'ba-click-fx' : selectedEntry ?? entryName}.js`,
    },
    rollupOptions:
    {
      output:
      {
        exports: 'named',
        // 单入口发布文件必须自包含；多入口构建保留默认的共享分包行为。
        codeSplitting: profile || selectedEntry ? false : undefined,
      },
    },
  },
});
