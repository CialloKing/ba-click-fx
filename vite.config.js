import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'es2020',
  },
  server: {
    open: true,
  },
});
