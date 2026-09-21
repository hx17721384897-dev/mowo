import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/app/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    manifest: true,
    assetsDir: 'assets'
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false
      },
      '/mowo/frontend': {
        target: 'http://127.0.0.1:5500',
        changeOrigin: false
      }
    }
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.TEST_API_BASE || 'http://127.0.0.1:3001',
        changeOrigin: false
      },
      '/mowo/frontend': {
        target: 'http://127.0.0.1:5500',
        changeOrigin: false
      }
    }
  }
})
