/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** SHA du commit deploye (workflow deploy-pages). */
  readonly VITE_BUILD_ID?: string
  /** '1' = mode demonstration (donnees factices en memoire, jamais en prod). */
  readonly VITE_DEMO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Version de build injectee par vite.config.ts (date Europe/Paris + SHA court). */
declare const __APP_VERSION__: string
