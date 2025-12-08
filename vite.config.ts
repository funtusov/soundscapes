import { defineConfig } from 'vite'

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'esbuild',
  },
  server: {
    port: 3000,
    open: true,
  },
})
