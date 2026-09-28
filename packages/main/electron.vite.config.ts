import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: { build: { rollupOptions: { external: ['electron'], input: 'src/index.ts' }, outDir: 'out/main' } },
  preload: { build: { rollupOptions: { external: ['electron'], input: 'src/preload.ts' }, outDir: 'out/preload' } },
  renderer: {
    root: '../renderer',
    plugins: [react()],
    build: {
      outDir: '../main/out/renderer',
      rollupOptions: { input: resolve(__dirname, '../renderer/index.html') },
    },
  },
})
