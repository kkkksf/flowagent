import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  // node-pty 必须保持 external：它是原生模块，运行时动态 require prebuilds/*.node，
  // 一旦被 rollup 打进 bundle 就会报 "Could not dynamically require ./prebuilds/..."
  main: { build: { rollupOptions: { external: ['electron', 'node-pty'], input: 'src/index.ts' }, outDir: 'out/main' } },
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
