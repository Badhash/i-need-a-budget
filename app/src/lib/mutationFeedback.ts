// Retours visibles des echecs d'ecriture (branches sur le MutationCache, cf.
// lib/queryClient). Avant : une assignation, une categorisation ou un
// deplacement refuse etait annule EN SILENCE (rollback optimiste). Desormais
// chaque echec definitif (apres les essais reseau) affiche un toast
// « Modification non enregistrée » avec « Réessayer », qui rejoue la meme
// mutation avec les memes variables : son onMutate reapplique l'etat optimiste.
//
// Une mutation dont l'ecran montre deja l'erreur (formulaire, feuille) le
// declare avec `meta: { errorToast: false }` : aucun toast.
//
// Les echecs rapproches (serveur indisponible, creation puis ses dependantes)
// se cumulent dans UN toast (« 3 modifications non enregistrées ») ; son
// bouton les rejoue toutes, dans leur ordre d'origine.

import {
  CancelledError,
  type Mutation,
  type MutationFunctionContext,
  type MutationOptions,
  type QueryClient,
} from '@tanstack/react-query'
import { ApiError } from '@/lib/api'
import { isNetworkError } from '@/lib/connectivity'
import { supabase } from '@/lib/supabase'
import { toast, useToastStore } from '@/lib/toast'

const ERROR_TOAST_ID = 'mutation-error'
const SESSION_TOAST_ID = 'session-expired'
// Un toast d'erreur porte une action : il reste le temps de la lire et d'agir
// (minuterie suspendue au survol, cf. Toaster).
const ERROR_TOAST_MS = 8000

type AnyMutationOptions = MutationOptions<unknown, unknown, unknown, unknown>

interface FailedMutation {
  options: AnyMutationOptions
  variables: unknown
}

// Echecs couverts par le toast d'erreur affiche (vide des qu'il a disparu).
let failed: FailedMutation[] = []

function toastVisible(id: string): boolean {
  return useToastStore.getState().toasts.some((t) => t.id === id && !t.closing)
}

/** Raison courte et lisible d'un echec d'ecriture (description du toast). */
export function describeMutationError(error: unknown): string {
  if (isNetworkError(error)) return 'Connexion au serveur impossible.'
  if (error instanceof ApiError) {
    if (error.status === 403) return 'Action non autorisée.'
    if (error.status === 404) return 'Élément introuvable, peut-être supprimé entre-temps.'
    if (error.status === 409) return 'Conflit avec une autre modification.'
    if (error.status === 413) return "Trop de données envoyées d'un coup."
    if (error.status === 429) return 'Trop de demandes, réessaie dans un instant.'
    if (error.status >= 500) return 'Le serveur a rencontré une erreur.'
    return 'Le serveur a refusé la modification.'
  }
  if (error instanceof Error && error.name === 'OrphanedMutationError') {
    return "L'élément dont elle dépend n'a pas pu être créé."
  }
  return 'Une erreur inattendue est survenue.'
}

/** Jeton refuse par le serveur ou session locale absente. */
export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

async function signInAgain(): Promise<void> {
  try {
    // Deconnexion LOCALE : le jeton n'est de toute facon plus accepte, inutile
    // (et parfois impossible) de prevenir le serveur.
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // deja deconnecte
  }
  // La garde de route redirige deja a la deconnexion ; filet si la session
  // locale n'a pas change (hash router : navigation par le fragment).
  if (!window.location.hash.startsWith('#/login')) window.location.hash = '#/login'
}

/** Toast unique « Session expirée » (collant jusqu'a l'action ou la fermeture). */
export function showSessionExpired(): void {
  toast({
    id: SESSION_TOAST_ID,
    tone: 'warning',
    message: 'Session expirée',
    description: 'Reconnecte-toi pour enregistrer tes modifications.',
    duration: 0,
    action: { label: 'Se reconnecter', onClick: () => void signInAgain() },
  })
}

// Relance une mutation echouee (memes options, memes variables) et resout des
// qu'elle a atteint le reseau, ou qu'elle est en pause hors ligne : la suivante
// ne demarre qu'ensuite, l'ordre d'envoi d'origine est garde (une creation
// part avant les mutations qui dependent de son id).
function startReplay(client: QueryClient, { options, variables }: FailedMutation): Promise<void> {
  return new Promise((resolve) => {
    const cache = client.getMutationCache()
    const mutationFn = options.mutationFn
    const mutation = cache.build(client, {
      ...options,
      mutationFn: (vars: unknown, context: MutationFunctionContext) => {
        resolve()
        return mutationFn ? mutationFn(vars, context) : Promise.reject(new Error('No mutationFn found'))
      },
    })
    const unsubscribe = cache.subscribe((event) => {
      if (event.mutation !== mutation) return
      const { isPaused, status } = mutation.state
      if (isPaused || status === 'error' || status === 'success') {
        unsubscribe()
        resolve()
      }
    })
    // Un nouvel echec repasse par le MutationCache (nouveau toast) : rien a
    // traiter ici.
    void mutation
      .execute(variables)
      .catch(() => undefined)
      .finally(() => {
        unsubscribe()
        resolve()
      })
  })
}

async function replayFailed(client: QueryClient): Promise<void> {
  const batch = failed
  failed = []
  for (const item of batch) await startReplay(client, item)
}

/**
 * Echec definitif d'une mutation (MutationCache.onError). Le rollback
 * optimiste reste celui de la mutation ; on ne fait que le rendre visible.
 */
export function reportMutationError(
  error: unknown,
  variables: unknown,
  mutation: Mutation<unknown, unknown, unknown, unknown>,
  client: QueryClient,
): void {
  if (mutation.meta?.errorToast === false) return
  if (error instanceof CancelledError) return
  if (isSessionExpired(error)) {
    showSessionExpired()
    return
  }
  // MFA exigee : la garde d'auth bascule sur la saisie du code (cf. lib/api).
  if (error instanceof ApiError && error.code === 'mfa_required') return

  if (!toastVisible(ERROR_TOAST_ID)) failed = []
  failed.push({ options: mutation.options as AnyMutationOptions, variables })
  const count = failed.length
  toast({
    id: ERROR_TOAST_ID,
    tone: 'danger',
    message: count === 1 ? 'Modification non enregistrée' : `${count} modifications non enregistrées`,
    description: describeMutationError(error),
    duration: ERROR_TOAST_MS,
    action: { label: 'Réessayer', onClick: () => void replayFailed(client) },
  })
}

/** Echec definitif d'une requete (QueryCache.onError) : seule la session expiree est signalee. */
export function reportQueryError(error: unknown): void {
  if (isSessionExpired(error)) showSessionExpired()
}

// Bilan des mutations terminees, lu par la pastille hors ligne pour annoncer
// « Modifications synchronisées » seulement si tout l'arriere est passe.
let settledOk = 0
let settledFailed = 0

export function noteMutationSettled(ok: boolean): void {
  if (ok) settledOk += 1
  else settledFailed += 1
}

export function mutationSettledCounts(): { ok: number; failed: number } {
  return { ok: settledOk, failed: settledFailed }
}
