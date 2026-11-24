import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Version affichee dans l'app (ecran de chargement, reglages) : date du build
// au fuseau de l'utilisateur + SHA court du commit deploye. En CI, le workflow
// fournit VITE_BUILD_ID (= GITHUB_SHA) ; en local, « dev ».
function appVersion(env: Record<string, string>): string {
  const sha = (env.VITE_BUILD_ID || env.GITHUB_SHA || '').slice(0, 7)
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' }).replace(/-/g, '.')
  return `${date} · ${sha || 'dev'}`
}

// Origine Supabase du build (meme regle que lib/supabase.ts : schema + hote,
// valeur factice si la configuration est absente).
function supabaseOrigin(env: Record<string, string>): string {
  try {
    return new URL((env.VITE_SUPABASE_URL || '').trim()).origin
  } catch {
    return 'https://placeholder.supabase.co'
  }
}

// Empreinte CSP d'un script inline (Web Crypto : aucun type Node requis).
async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
}

// Content-Security-Policy du build de production, posee en balise meta (GitHub
// Pages ne permet aucun en-tete HTTP). Elle borne ce qu'un script injecte ou une
// dependance compromise peut faire du jeton de session et du budget dechiffre :
// aucun script hors de l'origine, aucune connexion sortante hors du projet
// Supabase. Les scripts inline d'index.html sont autorises par leur empreinte,
// recalculee a chaque build (les modifier ne demande aucune mise a jour ici).
//  - style-src 'unsafe-inline' : Radix insere une balise <style> a l'execution ;
//  - img-src data: (QR code TOTP) et https: (logos des banques, hote variable) ;
//  - frame-ancestors est ignore en balise meta : non pose.
// Absente en dev (le rechargement a chaud de Vite a besoin de scripts inline).
function contentSecurityPolicy(env: Record<string, string>): Plugin {
  return {
    name: 'inab-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      async handler(html) {
        const inlineScripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
        const hashes = await Promise.all(
          inlineScripts.map(async (m) => `'sha256-${await sha256Base64(m[1])}'`),
        )
        const api = supabaseOrigin(env)
        const policy = [
          "default-src 'none'",
          ["script-src 'self'", ...hashes].join(' '),
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
          "font-src 'self' https://fonts.gstatic.com",
          "img-src 'self' data: https:",
          `connect-src 'self' ${api} ${api.replace(/^http/, 'ws')}`,
          "manifest-src 'self'",
          "worker-src 'self'",
          "base-uri 'none'",
          "form-action 'self'",
          "object-src 'none'",
        ].join('; ')
        const charset = /<meta charset=[^>]*>/i
        // Echec bruyant plutot qu'un deploiement sans politique.
        if (!charset.test(html)) throw new Error('inab-csp : balise <meta charset> introuvable')
        return html.replace(
          charset,
          (tag) => `${tag}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
        )
      },
    },
  }
}

// base relative : compatible GitHub Pages (project site) grace au hash routing /#/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, new URL('.', import.meta.url).pathname, '')
  return {
    base: './',
    plugins: [react(), contentSecurityPolicy(env)],
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
          // Seul le socle charge au demarrage est regroupe. Recharts n'y figure
          // PAS : declare ici, son chunk emportait clsx (partage avec cn()) et
          // etait donc precharge a chaque lancement (426 kB) alors que seule la
          // page Rapports, chargee a la demande, s'en sert. Meme chose pour
          // react-table (page Transactions). Rollup les range avec leurs pages.
          manualChunks: {
            tanstack: ['@tanstack/react-query', '@tanstack/react-router'],
          },
        },
      },
    },
  }
})
