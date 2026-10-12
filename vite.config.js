import { resourceVite } from './scripts/resource-vite.mjs';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [resourceVite(process.cwd())],
  build: {
    target: 'es2020',
  },
  server: {
    open: true,
  },
});
