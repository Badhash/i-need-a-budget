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
export class OrphanedMutationError extends Error {
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

// Queue « fil » : chaque tâche s'enchaîne sur la précédente, quelle que soit
// son issue (une erreur ne bloque jamais la file). `pending` compte les tâches
// vivantes pour vider le mapping au drainage.
let tail: Promise<unknown> = Promise.resolve()
let pending = 0

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
    return task()
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
  }
}

// Réservé aux tests : remet la file et le mapping à zéro.
export function __resetMutationQueue(): void {
  tail = Promise.resolve()
  pending = 0
  idMap.clear()
}
