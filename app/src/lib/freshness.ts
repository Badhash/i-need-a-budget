// Fraicheur des donnees affichees et actualisation manuelle (indicateur du
// header, tirer pour rafraichir sur mobile).
//
// « Mis à jour il y a 3 min » = dernier chargement SERVEUR des donnees a
// l'ecran : taxonomie (bootstrap), budget du mois, transactions, rapports. On
// ne lit pas dataUpdatedAt tel quel : il bouge aussi a chaque mise a jour
// optimiste (setQueryData) et dirait « À jour » apres une simple assignation,
// sans rien avoir compare au serveur. Seules les requetes observees (a
// l'ecran) comptent, et la plus ancienne fait foi.
//
// L'actualisation est SCOPEE (jamais d'invalidation globale : egress du free
// tier) : bootstrap, le mois de budget affiche, les transactions et le mois de
// rapports affiche. Seules les requetes a l'ecran repartent au serveur ; les
// autres sont juste marquees perimees pour leur prochain affichage.

import { useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { hashKey, onlineManager, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { BOOTSTRAP_KEY, TRANSACTIONS_KEY, budgetKey, reportsKey } from '@/lib/data'
import { checkConnectivity, isNetworkError } from '@/lib/connectivity'
import { whenQueueIdle } from '@/lib/mutationQueue'
import { ApiError } from '@/lib/api'
import { isSessionExpired } from '@/lib/mutationFeedback'
import { toast } from '@/lib/toast'
import { useUiStore } from '@/stores/ui'

const TRACKED = new Set(['bootstrap', 'budget', 'transactions', 'reports'])

export function isTrackedQuery(query: { queryKey: readonly unknown[] }): boolean {
  return TRACKED.has(String(query.queryKey[0]))
}

// Instant du dernier chargement serveur de chaque requete suivie (par hash de cle).
const serverSyncAt = new Map<string, number>()

/** Suit les chargements serveur (hors setQueryData) des requetes suivies. */
export function trackServerSync(client: QueryClient): () => void {
  return client.getQueryCache().subscribe((event) => {
    if (event.type === 'removed') {
      serverSyncAt.delete(event.query.queryHash)
      return
    }
    if (event.type !== 'updated' || event.action.type !== 'success' || event.action.manual) return
    if (isTrackedQuery(event.query)) serverSyncAt.set(event.query.queryHash, event.query.state.dataUpdatedAt)
  })
}

/** Donnees injectees depuis une reponse serveur par setQueryData (demarrage consolide). */
export function markServerSync(keys: readonly (readonly unknown[])[], at = Date.now()): void {
  for (const key of keys) serverSyncAt.set(hashKey(key), at)
}

/** Plus ancien chargement serveur parmi les requetes suivies a l'ecran, ou null. */
export function lastServerSync(client: QueryClient): number | null {
  let oldest: number | null = null
  for (const query of client.getQueryCache().getAll()) {
    if (!isTrackedQuery(query) || query.getObserversCount() === 0 || query.state.data === undefined) continue
    const at = serverSyncAt.get(query.queryHash) ?? query.state.dataUpdatedAt
    if (oldest === null || at < oldest) oldest = at
  }
  return oldest
}

export function useLastServerSync(): number | null {
  const client = useQueryClient()
  return useSyncExternalStore(
    (listener) => client.getQueryCache().subscribe(listener),
    () => lastServerSync(client),
    () => null,
  )
}

/** Libelle d'anciennete : « À jour » sous la minute, puis min, h, j. */
export function formatSyncAge(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60000)
  if (minutes < 1) return 'À jour'
  if (minutes < 60) return `Mis à jour il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Mis à jour il y a ${hours} h`
  return `Mis à jour il y a ${Math.floor(hours / 24)} j`
}

// ---------------------------------------------------------------------------
// Actualisation manuelle
// ---------------------------------------------------------------------------

interface RefreshState {
  /** Actualisation manuelle en cours (icone qui tourne, indicateur de traction). */
  refreshing: boolean
}

export const useRefreshStore = create<RefreshState>(() => ({ refreshing: false }))

export type RefreshOutcome = 'ok' | 'offline' | 'error'

interface RefreshResult {
  outcome: RefreshOutcome
  error?: unknown
}

// Duree minimale de l'animation : une actualisation eclair doit quand meme se
// voir (sinon l'icone tressaute sans que l'on sache si quelque chose a eu lieu).
const MIN_SPIN_MS = 650
// Au-dela, on rend la main (reseau qui ne repond pas) ; les requetes en vol
// terminent en arriere-plan.
const MAX_WAIT_MS = 20000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Resout des que TanStack bascule hors ligne : les requetes en pause
// reprendront seules au retour du reseau, inutile de faire tourner l'icone.
function whenOffline(): { promise: Promise<RefreshResult>; cancel: () => void } {
  let unsubscribe = () => {}
  const promise = new Promise<RefreshResult>((resolve) => {
    unsubscribe = onlineManager.subscribe((online) => {
      if (!online) resolve({ outcome: 'offline' })
    })
  })
  return { promise, cancel: () => unsubscribe() }
}

async function runRefresh(client: QueryClient): Promise<RefreshResult> {
  if (!onlineManager.isOnline()) {
    // Hors ligne : on verifie la connexion (une sonde), sans rien invalider.
    if (!(await checkConnectivity())) return { outcome: 'offline' }
  }
  // Derriere les ecritures encore en file : la lecture voit l'etat serveur
  // APRES elles (aucune valeur optimiste ne « saute »).
  await whenQueueIdle(8000)
  const month = useUiStore.getState().month
  const keys = [BOOTSTRAP_KEY, budgetKey(month), TRANSACTIONS_KEY, reportsKey(month)]
  const settled = Promise.allSettled(
    keys.map((queryKey) => client.invalidateQueries({ queryKey, exact: true }, { throwOnError: true })),
  ).then((results): RefreshResult => {
    const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (!failure) return { outcome: 'ok' }
    return { outcome: isNetworkError(failure.reason) ? 'offline' : 'error', error: failure.reason }
  })
  const offline = whenOffline()
  try {
    return await Promise.race([
      settled,
      offline.promise,
      sleep(MAX_WAIT_MS).then((): RefreshResult => ({ outcome: 'ok' })),
    ])
  } finally {
    offline.cancel()
  }
}

function describeRefreshError(error: unknown): string {
  if (error instanceof ApiError && error.status >= 500) return 'Le serveur a rencontré une erreur.'
  return "Le serveur n'a pas pu répondre."
}

/**
 * Actualise les donnees a l'ecran (appui sur l'indicateur de fraicheur, tirer
 * pour rafraichir). Une seule actualisation a la fois ; un echec serveur est
 * signale par un toast avec « Réessayer » (la session expiree a deja le sien).
 */
export async function refreshData(client: QueryClient): Promise<RefreshOutcome> {
  if (useRefreshStore.getState().refreshing) return 'ok'
  useRefreshStore.setState({ refreshing: true })
  const startedAt = Date.now()
  let result: RefreshResult
  try {
    result = await runRefresh(client)
  } catch (error) {
    result = { outcome: 'error', error }
  }
  const elapsed = Date.now() - startedAt
  if (elapsed < MIN_SPIN_MS) await sleep(MIN_SPIN_MS - elapsed)
  useRefreshStore.setState({ refreshing: false })
  if (result.outcome === 'error' && !isSessionExpired(result.error)) {
    toast({
      id: 'refresh-error',
      tone: 'danger',
      message: 'Actualisation impossible',
      description: describeRefreshError(result.error),
      action: { label: 'Réessayer', onClick: () => void refreshData(client) },
    })
  }
  return result.outcome
}
