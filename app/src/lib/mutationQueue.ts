// File de mutations optimistes sérialisée (INAB-4).
//
// Problème résolu : une mutation dépendante (renommer / supprimer / objectif /
// assignation) déclenchée pendant la micro-fenêtre du POST de création d'une
// catégorie partait avec un id temporaire « temp-… », rejeté en 400 par /api,
// puis rollback discret. Les mutations concurrentes n'étaient pas ordonnées et
// les ids temporaires n'étaient pas réconciliés avec les ids serveur avant
// l'envoi des mutations suivantes.
//
// Principe :
//   - L'optimisme UI reste INTACT : chaque mutation continue de faire son
//     setQueryData immédiat dans son onMutate. SEULE la couche RÉSEAU est
//     sérialisée ici.
//   - Une file FIFO GLOBALE (la plus sûre : aucun risque d'interblocage entre
//     files par entité) enchaîne les appels /api : une mutation dépendante ne
//     part jamais tant que la précédente (ex. la création qui produit l'id
//     serveur) n'est pas confirmée.
//   - Un mapping tempId -> realId est renseigné par la création dès qu'elle
//     répond. Les tâches suivantes résolvent leurs ids AU MOMENT de l'envoi,
//     donc avec l'id serveur déjà connu.
//   - Si la création amont échoue, son tempId n'est jamais mappé : les tâches
//     dépendantes sont annulées (mutation orpheline) au lieu d'être envoyées
//     avec un id invalide.
//
// Réseau (hors ligne, coupure) :
//   - Un échec RÉSEAU est rejoué DANS le créneau de la tâche (attente
//     croissante, 3 essais au plus tant que le serveur est joignable) : la file
//     n'avance pas, une tâche dépendante ne part donc jamais avant l'issue
//     définitive de sa création amont (pas d'orpheline sur une simple coupure).
//   - Hors ligne (onlineManager), la tâche attend le retour du réseau sans
//     consommer d'essai. Les mutations émises pendant ce temps sont mises en
//     pause par TanStack AVANT d'appeler enqueue : elles n'entrent dans la file
//     qu'à la reprise, dans leur ordre d'émission, derrière la tâche retenue.
//     Aucune attente croisée : la tâche retenue n'attend que le réseau, jamais
//     une autre mutation (pas d'interblocage).
//   - Les erreurs métier (4xx/5xx) ne sont jamais rejouées.

import { onlineManager } from '@tanstack/react-query'
import { isNetworkError } from '@/lib/connectivity'

const TEMP_PREFIX = 'temp-'

/** Un id optimiste local n'existe pas côté serveur (requireUuid le rejette). */
export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_PREFIX)
}

/** Génère un id optimiste, reconnaissable par isTempId. */
export function newTempId(): string {
  return `${TEMP_PREFIX}${crypto.randomUUID()}`
}

// Mapping tempId -> realId, alimenté par les créations confirmées. Il n'est
// nécessaire que le temps d'un « burst » d'écritures : il est vidé dès que la
// file se draine (voir plus bas), ce qui évite toute fuite mémoire.
const idMap = new Map<string, string>()

/** Enregistre l'id serveur produit par une création pour un id temporaire. */
export function registerRealId(tempId: string, realId: string): void {
  if (isTempId(tempId)) idMap.set(tempId, realId)
}

/**
 * Résout un id éventuellement temporaire vers son id serveur. Renvoie l'id tel
 * quel s'il n'est pas temporaire (chemin normal, inchangé) ou si aucune
 * réconciliation n'est encore connue.
 */
export function resolveId(id: string): string {
  return idMap.get(id) ?? id
}

/** Rejet levé quand la création amont d'un id temporaire a échoué. */
class OrphanedMutationError extends Error {
  constructor(tempId: string) {
    super(`Mutation orpheline : la création de ${tempId} a échoué.`)
    this.name = 'OrphanedMutationError'
  }
}

interface EnqueueOptions {
  // Ids (éventuellement temporaires) dont dépend la tâche : s'ils sont encore
  // non résolus au moment de l'envoi, la création amont a échoué et la tâche
  // est annulée plutôt qu'envoyée avec un id invalide.
  deps?: string[]
}

/** Essais réseau supplémentaires d'une tâche tant que le serveur est joignable. */
export const MAX_NETWORK_RETRIES = 3

/** Attente avant le n-ième nouvel essai réseau (0 = premier) : 1 s, 2 s, 4 s, 8 s max. */
export function networkRetryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000)
}

// Marque d'une erreur réseau déjà rejouée par la file : TanStack ne doit pas
// relancer la mutation une seconde fois (cf. lib/queryClient).
const EXHAUSTED = Symbol('networkRetriesExhausted')

/** Vrai si la file a déjà épuisé ses essais réseau pour cette erreur. */
export function isRetryExhausted(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as Record<symbol, unknown>)[EXHAUSTED] === true
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Résout dès que TanStack considère le réseau disponible. */
function waitForOnline(): Promise<void> {
  if (onlineManager.isOnline()) return Promise.resolve()
  return new Promise((resolve) => {
    const unsubscribe = onlineManager.subscribe((online) => {
      if (!online) return
      unsubscribe()
      resolve()
    })
  })
}

// Exécute la tâche en rejouant les échecs réseau sans rendre la main à la
// file. Hors ligne : attente du réseau (aucun essai consommé) ; en ligne :
// essais comptés, attente croissante. L'erreur finale est marquée « épuisée ».
async function runWithNetworkRetry<T>(task: () => Promise<T>): Promise<T> {
  let failures = 0
  for (;;) {
    await waitForOnline()
    try {
      return await task()
    } catch (err) {
      if (!isNetworkError(err)) throw err
      // La sonde déclenchée par l'échec (lib/connectivity) a pu basculer hors
      // ligne entre-temps : l'essai n'est alors pas compté.
      if (onlineManager.isOnline()) {
        if (failures >= MAX_NETWORK_RETRIES) {
          if (typeof err === 'object' && err !== null) (err as Record<symbol, unknown>)[EXHAUSTED] = true
          throw err
        }
        await sleep(networkRetryDelay(failures))
        failures += 1
      }
    }
  }
}

// Queue « fil » : chaque tâche s'enchaîne sur la précédente, quelle que soit
// son issue (une erreur ne bloque jamais la file). `pending` compte les tâches
// vivantes pour vider le mapping au drainage.
let tail: Promise<unknown> = Promise.resolve()
let pending = 0
// Attentes de drainage (whenQueueIdle), résolues quand la file se vide.
let idleWaiters: (() => void)[] = []

/**
 * Sérialise `task` derrière toutes les mutations réseau déjà en file et renvoie
 * une promesse qui reflète l'issue réelle de `task` (pour que onSuccess /
 * onError de TanStack Query se comportent normalement).
 */
export function enqueue<T>(task: () => Promise<T>, options: EnqueueOptions = {}): Promise<T> {
  pending += 1

  const guarded = async (): Promise<T> => {
    for (const dep of options.deps ?? []) {
      // resolveId suit les chaînes temp -> real ; s'il reste temporaire, la
      // création amont n'a jamais confirmé son id : mutation orpheline.
      if (isTempId(resolveId(dep))) throw new OrphanedMutationError(dep)
    }
    return runWithNetworkRetry(task)
  }

  const result = tail.then(guarded, guarded)
  // La file avance même si cette tâche rejette : jamais d'interblocage.
  tail = result.then(
    () => undefined,
    () => undefined,
  )
  // Vidage du mapping au drainage complet : hors « burst », les ids serveur
  // vivent déjà dans le cache TanStack, plus besoin du mapping.
  void result.then(release, release)

  return result
}

function release(): void {
  pending -= 1
  if (pending <= 0) {
    pending = 0
    idMap.clear()
    const waiters = idleWaiters
    idleWaiters = []
    waiters.forEach((resolve) => resolve())
  }
}

/**
 * Résout quand la file est vide (toutes les écritures envoyées ou abandonnées),
 * ou au bout de `maxWaitMs` : une lecture lancée ensuite voit l'état serveur
 * APRÈS ces écritures (aucune valeur optimiste ne « saute »). Le plafond évite
 * toute attente sans fin derrière une requête bloquée.
 */
export function whenQueueIdle(maxWaitMs = 15000): Promise<void> {
  if (pending === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, maxWaitMs)
    function done() {
      clearTimeout(timer)
      idleWaiters = idleWaiters.filter((w) => w !== done)
      resolve()
    }
    idleWaiters.push(done)
  })
}
