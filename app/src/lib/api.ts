// Client de l'Edge Function /api : endpoint unique a actions typees.
// Chaque appel joint le JWT de la session Supabase courante. Le serveur
// dechiffre en memoire et renvoie du JSON en clair sur TLS.

import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import { markLocalWrite } from '@/lib/realtimeGate'

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1/api`
const ANON_KEY = SUPABASE_ANON_KEY

// Actions de LECTURE (aucune ecriture DB, donc aucun signal Realtime provoque).
// Tout le reste est une ecriture : on horodate l'ecriture locale pour que la
// reconciliation Realtime la reconnaisse comme redondante (cf. realtimeGate).
const READ_ACTION = /^(get|list|export)|^bootstrap$/

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiCall<T>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new ApiError(401, 'Session expiree, reconnecte-toi.')

  // Ecriture : on horodate AVANT l'envoi (le signal Realtime peut arriver via
  // websocket avant meme que ce fetch ne resolve) et de nouveau au succes.
  const isWrite = !READ_ACTION.test(action)
  if (isWrite) markLocalWrite()

  const res = await fetch(FUNCTIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, params }),
  })

  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error ?? `Erreur ${res.status}`
    throw new ApiError(res.status, message)
  }
  // Re-horodate au succes : etend la fenetre de silence jusqu'apres le commit
  // serveur (le trigger Realtime tire sur le commit, donc apres la reponse).
  if (isWrite) markLocalWrite()
  return body as T
}
