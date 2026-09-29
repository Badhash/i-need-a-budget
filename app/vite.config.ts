import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Version affichee dans l'app (ecran de chargement, reglages) : date du build
// au fuseau de l'utilisateur + SHA court du commit deploye. En CI, le workflow
// fournit VITE_BUILD_ID (= GITHUB_SHA) ; en local, « dev ».
function appVersion(env: Record<string, string>): string {
  const sha = (env.VITE_BUILD_ID || env.GITHUB_SHA || '').slice(0, 7)
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }).replace(/-/g, '.')
  return `${date} · ${sha || 'dev'}`
}

// base relative : compatible GitHub Pages (project site) grace au hash routing /#/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL('.', import.meta.url).pathname, '')
  return {
    base: './',
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion(env)),
    },
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
  }
})
