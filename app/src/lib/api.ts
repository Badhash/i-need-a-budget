// Client de l'Edge Function /api : endpoint unique a actions typees.
// Chaque appel joint le JWT de la session Supabase courante. Le serveur
// dechiffre en memoire et renvoie du JSON en clair sur TLS.

import { supabase } from '@/lib/supabase'

const FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/api`
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export class ApiError extends Error {
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
  return body as T
}
