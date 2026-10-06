// Client de l'Edge Function /api : endpoint unique a actions typees.
// Chaque appel joint le JWT de la session Supabase courante. Le serveur
// dechiffre en memoire et renvoie du JSON en clair sur TLS.

import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import { markLocalWrite } from '@/lib/realtimeGate'
import { mfaSatisfied } from '@/lib/mfa'
import {
  NetworkError,
  isNetworkError,
  reportNetworkFailure,
  reportNetworkSuccess,
} from '@/lib/connectivity'

// Erreurs reseau : definies dans lib/connectivity (sans dependance a ce module),
// reexportees ici a cote d'ApiError pour les appelants.
export { NetworkError, isNetworkError }

const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1/api`
const ANON_KEY = SUPABASE_ANON_KEY

// Actions de LECTURE (aucune ecriture DB, donc aucun signal Realtime provoque).
// Tout le reste est une ecriture : on horodate l'ecriture locale pour que la
// reconciliation Realtime la reconnaisse comme redondante (cf. realtimeGate).
// ^bootstrap couvre bootstrap ET bootstrapFull (le demarrage de l'app n'est pas
// une ecriture : sans ca, chaque ouverture ouvrait la fenetre de silence 30 s).
// ^push : les actions de notifications n'ecrivent que push_state, table sans
// signal Realtime.
const READ_ACTION = /^(get|list|export|bootstrap|push)/

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Code machine renvoye par le serveur (ex. mfa_required). */
    public code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Le serveur exige un jeton aal2 des que l'utilisateur a un facteur TOTP
// verifie. Si notre session locale se croit complete (objet user sans
// facteurs, ex. MFA activee depuis un autre appareil), on rafraichit la session
// pour recuperer les facteurs : la garde d'auth bascule alors sur la saisie du
// code. Si le rafraichissement ne change rien, deconnexion locale (retour au
// mot de passe) plutot qu'une boucle de 403.
let mfaRecovering = false
async function recoverFromMfaRequired(): Promise<void> {
  if (mfaRecovering) return
  mfaRecovering = true
  try {
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session || mfaSatisfied(data.session)) {
      await supabase.auth.signOut({ scope: 'local' })
    }
  } catch {
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
  } finally {
    mfaRecovering = false
  }
}

export async function apiCall<T>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  // Mode demonstration (VITE_DEMO=1) : serveur factice en memoire, charge a la
  // demande. Branche morte hors demo : le module est absent du build de prod.
  if (import.meta.env.VITE_DEMO === '1') {
    const { demoApiCall } = await import('@/dev/demo')
    try {
      const result = await demoApiCall<T>(action, params)
      reportNetworkSuccess()
      return result
    } catch (err) {
      // Meme contrat que le vrai transport : coupure -> NetworkError (et sonde),
      // erreur metier -> ApiError, preuve que le serveur a repondu.
      if (isNetworkError(err)) {
        reportNetworkFailure()
        throw new NetworkError()
      }
      if (err instanceof ApiError) reportNetworkSuccess()
      throw err
    }
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession()
  if (!session) {
    // Jeton expire dont le rafraichissement a echoue FAUTE DE RESEAU : ce n'est
    // pas une session expiree (pas de « Se reconnecter » hors ligne), la
    // requete sera rejouee au retour du reseau.
    if (sessionError && isAuthRetryableFetchError(sessionError)) {
      reportNetworkFailure()
      throw new NetworkError()
    }
    throw new ApiError(401, 'Session expiree, reconnecte-toi.')
  }

  // Ecriture : on horodate AVANT l'envoi (le signal Realtime peut arriver via
  // websocket avant meme que ce fetch ne resolve) et de nouveau au succes.
  const isWrite = !READ_ACTION.test(action)
  if (isWrite) markLocalWrite()

  // fetch() ne rejette que sans reponse (coupure, DNS, CORS) : NetworkError,
  // rejouable. Une reponse, meme en erreur, prouve que le reseau fonctionne.
  let res: Response
  let text: string
  try {
    res = await fetch(FUNCTIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ action, params }),
    })
    text = await res.text()
  } catch {
    reportNetworkFailure()
    throw new NetworkError()
  }
  reportNetworkSuccess()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    const errBody = body as { error?: string; code?: string } | null
    const message = errBody?.error ?? `Erreur ${res.status}`
    if (res.status === 403 && errBody?.code === 'mfa_required') void recoverFromMfaRequired()
    throw new ApiError(res.status, message, errBody?.code)
  }
  // Re-horodate au succes : etend la fenetre de silence jusqu'apres le commit
  // serveur (le trigger Realtime tire sur le commit, donc apres la reponse).
  if (isWrite) markLocalWrite()
  return body as T
}
