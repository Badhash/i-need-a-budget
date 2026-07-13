// Client de l'Edge Function sync-bank (Enable Banking).
// Isole du reste du front : si la fonction n'est pas encore deployee ou renvoie
// une erreur, les appels echouent proprement (throw) et l'appelant gere via
// try/catch. Rien ici ne doit faire crasher l'UI.

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'
import { apiCall } from '@/lib/api'

const SYNC_URL = `${SUPABASE_URL}/functions/v1/sync-bank`
const ANON_KEY = SUPABASE_ANON_KEY

export interface EbAccountLink {
  uid: string
  name: string | null
  iban: string | null
  product: string | null
  linkedAccountId: string | null
  linkedAccountName: string | null
}

export interface BankConnection {
  id: string
  institution: string
  validUntil: string | null
  status: 'active' | 'expiring' | 'expired' | 'pending'
  accounts: EbAccountLink[]
}

/** Lie (accountId) ou detache (accountId null) un compte bancaire EB a un compte local. */
export async function apiLinkBankAccount(input: {
  connectionId: string
  providerAccountUid: string
  accountId: string | null
}): Promise<void> {
  await apiCall('linkBankAccount', input)
}

export interface Aspsp {
  name: string
  country: string
  logo: string | null
}

/**
 * Liste des connexions bancaires de l'utilisateur, lue via l'Edge Function /api
 * (action getBankConnections). Le tri/statut est calcule cote serveur.
 */
export function useBankConnections(): UseQueryResult<BankConnection[]> {
  return useQuery({
    queryKey: ['bankConnections'],
    queryFn: async () => {
      const { connections } = await apiCall<{ connections: BankConnection[] }>('getBankConnections')
      return connections
    },
  })
}

// Appel bas niveau vers l'endpoint sync-bank, JWT de la session courante joint
// (meme schema d'auth que apiCall). Lance en cas d'erreur : l'appelant catch.
async function syncBankCall<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Session expiree, reconnecte-toi.')

  const res = await fetch(SYNC_URL, {
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
    const message = (body as { error?: string } | null)?.error ?? `Erreur ${res.status}`
    throw new Error(message)
  }
  return body as T
}

/**
 * Liste des banques (ASPSP) disponibles pour la France, pour le selecteur de
 * banque. Passe par sync-bank -> Enable Banking. staleTime long : la liste
 * bouge peu et l'appel authentifie EB n'a pas besoin d'etre refait souvent.
 */
export function useAspsps(): UseQueryResult<Aspsp[]> {
  return useQuery({
    queryKey: ['aspsps'],
    queryFn: () => syncBankCall<{ aspsps: Aspsp[] }>('listAspsps').then((r) => r.aspsps),
    staleTime: 60 * 60 * 1000,
    retry: false,
  })
}

/** Demarre le flow d'auth PSD2 : retourne l'URL de redirection Enable Banking. */
export async function bankStartAuth(redirectUrl: string, aspspName: string): Promise<{ url: string }> {
  return syncBankCall<{ url: string }>('startAuth', { redirectUrl, aspspName })
}

/**
 * Finalise le flow d'auth PSD2 : echange le code OAuth renvoye par Enable
 * Banking (au retour de redirection) contre une connexion bancaire persistee.
 */
export async function bankFinalizeAuth(code: string): Promise<{ ok: boolean; connectionId: string }> {
  return syncBankCall<{ ok: boolean; connectionId: string }>('finalizeAuth', { code })
}

export interface BankSyncResult {
  imported: number
  linked: number
  transfersLinked?: number
}

/**
 * Declenche une synchronisation immediate. `imported` = transactions importees,
 * `linked` = comptes bancaires associes a un compte local (0 = rien a importer).
 * `sinceDays` (optionnel) : profondeur d'import de l'historique en jours.
 */
export async function bankSync(sinceDays?: number): Promise<BankSyncResult> {
  return syncBankCall<BankSyncResult>('sync', sinceDays !== undefined ? { sinceDays } : {})
}

export interface BankReconcileResult {
  adjusted: { accountId: string; accountName: string; delta: number }[]
}

/**
 * Reconciliation des soldes : ajuste le solde d'ouverture de chaque compte lie
 * pour que le solde local corresponde au solde bancaire reel. `delta` en centimes.
 */
export async function bankReconcile(): Promise<BankReconcileResult> {
  return syncBankCall<BankReconcileResult>('reconcile')
}
