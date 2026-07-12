// Client Supabase du front — UNIQUEMENT pour l'Auth et le Realtime.
// Le front ne fait JAMAIS de SELECT direct sur les tables : toute lecture/ecriture
// metier passe par l'Edge Function /api (voir lib/api.ts).

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anon) {
  // Ne pas jeter au chargement (sinon l'app entiere casse en dev/CI sans .env) :
  // on log clairement et les appels reels echoueront avec un message parlant.
  console.error(
    'Configuration Supabase absente : definir VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY.',
  )
}

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anon || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Hash routing (/#/) : on gere la navigation nous-memes, pas de parsing d'URL.
      detectSessionInUrl: false,
    },
  },
)
