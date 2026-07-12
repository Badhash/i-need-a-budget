import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base relative : compatible GitHub Pages (project site) grace au hash routing /#/
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          charts: ['recharts'],
          tanstack: ['@tanstack/react-query', '@tanstack/react-router', '@tanstack/react-table'],
        },
      },
    },
  },
})
