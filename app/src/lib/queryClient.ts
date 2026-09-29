// QueryClient de l'app : politique d'essais, pause hors ligne et retours
// visibles des echecs, en un seul endroit.
//
//   - Donnees figees (staleTime: Infinity) : apres le prechargement du
//     demarrage, la navigation est instantanee ; la fraicheur passe par le
//     signal Realtime, les mutations optimistes et l'actualisation manuelle
//     (une invalidation force le refetch quel que soit le staleTime).
//   - Essais : UNIQUEMENT les echecs reseau (3 au plus, attente croissante),
//     jamais une erreur metier 4xx/5xx (deterministe, et chaque essai coute de
//     l'egress). Hors ligne, l'essai suivant attend le retour du reseau.
//   - networkMode 'online' + onlineManager (lib/connectivity) : une mutation
//     emise hors ligne est mise en PAUSE avant tout appel (son onMutate a deja
//     applique l'etat optimiste, qui reste affiche) puis reprise au retour du
//     reseau, dans l'ordre d'emission.
//   - Echec definitif d'une mutation : toast avec « Réessayer »
//     (lib/mutationFeedback) ; session expiree : « Se reconnecter ».

import { MutationCache, QueryCache, QueryClient, onlineManager } from '@tanstack/react-query'
import { installConnectivity, isNetworkError } from '@/lib/connectivity'
import { MAX_NETWORK_RETRIES, isRetryExhausted, networkRetryDelay, whenQueueIdle } from '@/lib/mutationQueue'
import {
  noteMutationSettled,
  reportMutationError,
  reportQueryError,
} from '@/lib/mutationFeedback'
import { trackServerSync } from '@/lib/freshness'

/** Essai supplementaire seulement pour une coupure reseau (jamais une erreur metier). */
export function shouldRetryNetwork(failureCount: number, error: unknown): boolean {
  if (!isNetworkError(error) || isRetryExhausted(error)) return false
  // Hors ligne : l'essai suivant attendra le reseau (pause TanStack), sans
  // consommer le quota reserve aux coupures breves en ligne.
  if (!onlineManager.isOnline()) return true
  return failureCount < MAX_NETWORK_RETRIES
}

class AppQueryClient extends QueryClient {
  // Au retour du reseau (ou du focus), TanStack reprend les mutations en pause
  // PUIS relance les requetes en attente. Les ecritures retenues dans la file
  // (lib/mutationQueue) ne sont pas « en pause » pour lui : on attend aussi
  // leur envoi, pour qu'une lecture ne rapporte pas l'etat serveur d'avant
  // elles (valeur optimiste qui « saute »). Attente plafonnee par la file.
  override async resumePausedMutations(): Promise<unknown> {
    const result = await super.resumePausedMutations()
    await whenQueueIdle()
    return result
  }
}

export function createAppQueryClient(): QueryClient {
  // Avant le montage : TanStack doit suivre NOTRE etat en ligne (sondes).
  installConnectivity()
  const client = new AppQueryClient({
    queryCache: new QueryCache({
      onError: (error) => reportQueryError(error),
    }),
    mutationCache: new MutationCache({
      onSuccess: () => noteMutationSettled(true),
      onError: (error, variables, _onMutateResult, mutation, context) => {
        noteMutationSettled(false)
        reportMutationError(error, variables, mutation, context.client)
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        networkMode: 'online',
        retry: shouldRetryNetwork,
        retryDelay: networkRetryDelay,
      },
      mutations: {
        networkMode: 'online',
        retry: shouldRetryNetwork,
        retryDelay: networkRetryDelay,
      },
    },
  })
  trackServerSync(client)
  return client
}
