// Client Supabase du front — UNIQUEMENT pour l'Auth et le Realtime.
// Le front ne fait JAMAIS de SELECT direct sur les tables : toute lecture/ecriture
// metier passe par l'Edge Function /api (voir lib/api.ts).

import { createClient } from '@supabase/supabase-js'

// URL et cle publiques injectees au build (workflow deploy-pages). On retire tout
// slash final de l'URL : sinon "${URL}/functions/v1/api" et les appels Auth
// produisent un double slash ("...co//auth/v1") que le routeur Supabase rejette
// (PGRST125 "Invalid path specified in request URL").
const rawUrl = import.meta.env.VITE_SUPABASE_URL
const rawAnon = import.meta.env.VITE_SUPABASE_ANON_KEY

// On ne garde que l'ORIGINE (schema + hote) : retire un slash final ET un chemin
// colle par erreur (ex. ".../rest/v1"), qui feraient router les appels Auth /
// Functions vers PostgREST -> PGRST125 "Invalid path specified in request URL".
function toOrigin(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  try {
    return new URL(trimmed).origin
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

export const SUPABASE_URL = toOrigin(rawUrl)
export const SUPABASE_ANON_KEY = (rawAnon ?? '').trim()

// Mode demonstration (VITE_DEMO=1, constante resolue au build) : aucun appel
// Supabase, configuration inutile (cf. src/dev/demo).
const DEMO = import.meta.env.VITE_DEMO === '1'

if ((!SUPABASE_URL || !SUPABASE_ANON_KEY) && !DEMO) {
  // Ne pas jeter au chargement (sinon l'app entiere casse en dev/CI sans .env) :
  // on log clairement et les appels reels echoueront avec un message parlant.
  console.error(
    'Configuration Supabase absente : definir VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.',
  )
}

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder-anon-key',
  {
    auth: {
      // Mode demonstration : Auth inerte. Session en memoire seulement (jamais
      // celle qu'un `npm run dev` a stockee pour le meme origine), aucun
      // rafraichissement de jeton ni initialisation : GoTrue n'emet aucune
      // requete. Hors demo, options inchangees.
      persistSession: !DEMO,
      autoRefreshToken: !DEMO,
      // Hash routing (/#/) : on gere la navigation nous-memes, pas de parsing d'URL.
      detectSessionInUrl: false,
      ...(DEMO ? { storageKey: 'inab-demo-auth', skipAutoInitialize: true } : {}),
    },
  },
)
