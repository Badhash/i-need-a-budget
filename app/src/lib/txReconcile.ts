// Reconciliation PARTIELLE de la liste ['transactions'] (constat API-LOG-02).
//
// La liste porte tout l'historique, texte compris : la relire a chaque signal
// Realtime (sync bancaire, echo de tes propres ecritures) etait le poste
// d'egress dominant de la page Transactions. A la place, la reconciliation ne
// relit que :
//   - les RECENT_MONTHS derniers mois (ceux que la sync bancaire alimente) ;
//   - les mois modifies localement depuis la derniere reponse serveur, trouves
//     en comparant le cache a cette reponse (les mises a jour optimistes
//     remplacent les objets qu'elles touchent, les autres gardent leur
//     identite) ;
// puis fusionne ces mois dans le cache. Un rechargement COMPLET (queryFn
// normal) reste la regle quand le dernier date de plus de FULL_RELOAD_AFTER_MS,
// quand trop de mois sont concernes, et pour toute invalidation explicite
// (actualisation manuelle, synchro manuelle, import, regles...) : celles-ci ne
// passent pas par ce module.
//
// Si le cache change pendant la lecture (ecriture locale intercalee), la
// reponse est ecartee : elle pourrait etre anterieure a cette ecriture, et
// l'ecriture declenchera elle-meme une reconciliation. Liste non affichee : la
// reconciliation est differee au prochain affichage (aucune lecture inutile).

import type { QueryCacheNotifyEvent, QueryClient } from '@tanstack/react-query'
import { apiCall } from '@/lib/api'
import { TRANSACTIONS_KEY, toTransaction, type ApiTransaction } from '@/lib/data'
import { markServerSync } from '@/lib/freshness'
import { addMonths, currentMonth, monthOf } from '@/lib/format'
import { whenQueueIdle } from '@/lib/mutationQueue'
import { hasPendingTxOps } from '@/lib/transactions'
import type { Transaction } from '@/types/domain'

const RECENT_MONTHS = 3
// Plafond du serveur (listTransactions) : au-dela, rechargement complet.
const MAX_MONTHS = 24
const FULL_RELOAD_AFTER_MS = 6 * 60 * 60 * 1000

// Dernier etat SERVEUR de la liste, lu DANS le cache apres chaque reponse
// (le partage structurel de TanStack y reutilise les objets inchanges : c'est
// leur identite qui sert a reperer les modifications locales).
interface ServerSnapshot {
  data: readonly Transaction[]
  /** Instant du dernier chargement COMPLET de l'historique. */
  fullAt: number
}
let snapshot: ServerSnapshot | null = null

function noteServer(data: readonly Transaction[] | undefined, full: boolean): void {
  if (!data) return
  snapshot = { data, fullAt: full ? Date.now() : (snapshot?.fullAt ?? 0) }
}

/** Hydratation du cache par le demarrage (bootstrapFull) : historique complet. */
export function noteServerTransactions(queryClient: QueryClient): void {
  noteServer(queryClient.getQueryData<Transaction[]>(TRANSACTIONS_KEY), true)
}

let deferred = false
let inFlight: Promise<void> | null = null
const installed = new WeakSet<QueryClient>()

/** Vrai pour la query de la liste complete (['transactions'] exactement). */
export function isTransactionsList(query: { queryKey: readonly unknown[] }): boolean {
  return query.queryKey.length === 1 && query.queryKey[0] === TRANSACTIONS_KEY[0]
}

function sameTx(a: Transaction, b: Transaction): boolean {
  return (
    a.id === b.id &&
    a.accountId === b.accountId &&
    a.date === b.date &&
    a.label === b.label &&
    a.categoryId === b.categoryId &&
    a.amount === b.amount &&
    (a.transferGroupId ?? null) === (b.transferGroupId ?? null) &&
    (a.note ?? '') === (b.note ?? '') &&
    (a.counterparty ?? null) === (b.counterparty ?? null) &&
    !!a.synthetic === !!b.synthetic
  )
}

/** Mois ou le cache differe de la derniere reponse serveur (ecritures locales). */
export function locallyTouchedMonths(
  server: readonly Transaction[],
  current: readonly Transaction[],
): Set<string> {
  const inServer = new Set(server)
  const inCurrent = new Set(current)
  const months = new Set<string>()
  for (const t of current) if (!inServer.has(t)) months.add(monthOf(t.date))
  for (const t of server) if (!inCurrent.has(t)) months.add(monthOf(t.date))
  return months
}

/**
 * Remplace dans `current` les lignes des mois `months` par `fresh` (reponse
 * serveur de ces mois). Une ligne inchangee garde son objet (pas de rendu
 * inutile) ; une ligne qui a quitte ces mois est retiree par son id.
 */
export function mergeMonths(
  current: readonly Transaction[],
  fresh: readonly Transaction[],
  months: ReadonlySet<string>,
): Transaction[] {
  const byId = new Map(current.map((t) => [t.id, t]))
  const freshIds = new Set(fresh.map((t) => t.id))
  const kept = current.filter((t) => !months.has(monthOf(t.date)) && !freshIds.has(t.id))
  const reused = fresh.map((t) => {
    const old = byId.get(t.id)
    return old && sameTx(old, t) ? old : t
  })
  // Tri stable : l'ordre au sein d'un jour est fige a l'affichage (txDayRank).
  return [...reused, ...kept].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

function reloadFully(queryClient: QueryClient): void {
  deferred = false
  void queryClient.invalidateQueries({ queryKey: TRANSACTIONS_KEY, exact: true })
}

async function runPartial(queryClient: QueryClient): Promise<void> {
  // Derriere les ecritures en file : la lecture voit l'etat serveur apres elles.
  await whenQueueIdle(8000)
  const query = queryClient.getQueryCache().find<Transaction[]>({ queryKey: TRANSACTIONS_KEY, exact: true })
  const current = query?.state.data
  if (!query || !current) return
  // Rechargement complet deja demande ou en cours : il suffit.
  if (query.state.isInvalidated || query.state.fetchStatus !== 'idle') return
  // Ajout ou suppression en attente : sa propre reconciliation suivra.
  if (hasPendingTxOps()) return
  if (!snapshot || Date.now() - snapshot.fullAt > FULL_RELOAD_AFTER_MS) {
    reloadFully(queryClient)
    return
  }
  const months = locallyTouchedMonths(snapshot.data, current)
  const now = currentMonth()
  for (let i = 0; i < RECENT_MONTHS; i++) months.add(addMonths(now, -i))
  if (months.size > MAX_MONTHS) {
    reloadFully(queryClient)
    return
  }

  const res = await apiCall<{ transactions: ApiTransaction[]; months?: string[] }>('listTransactions', {
    months: [...months].sort(),
  })
  const latest = queryClient.getQueryData<Transaction[]>(TRANSACTIONS_KEY)
  // Cache modifie pendant la lecture (ecriture locale, rechargement complet) :
  // reponse peut-etre perimee, ecartee.
  if (latest !== current) return
  const fresh = res.transactions.map(toTransaction)
  // Serveur anterieur au filtre (pas d'echo `months`) : historique complet.
  const next = res.months ? mergeMonths(current, fresh, months) : fresh
  queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, next)
  noteServer(queryClient.getQueryData<Transaction[]>(TRANSACTIONS_KEY), !res.months)
  markServerSync([TRANSACTIONS_KEY])
}

/**
 * Reconciliation de la liste des transactions apres un signal Realtime ou un
 * retour au premier plan. Liste absente du cache : rien a faire. Liste non
 * affichee : differee a son prochain affichage.
 */
export function reconcileTransactions(queryClient: QueryClient): Promise<void> {
  installTxReconcile(queryClient)
  const query = queryClient.getQueryCache().find({ queryKey: TRANSACTIONS_KEY, exact: true })
  if (!query || query.state.data === undefined) return Promise.resolve()
  if (query.getObserversCount() === 0) {
    deferred = true
    return Promise.resolve()
  }
  deferred = false
  if (inFlight) return inFlight
  inFlight = runPartial(queryClient)
    .catch(() => {
      // Echec de la lecture partielle (reseau, serveur) : la prochaine
      // reconciliation reessaiera ; l'ecran garde le cache, deja coherent.
      deferred = true
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

/**
 * A installer au demarrage (une fois par client) : suit les reponses serveur
 * de la liste (etat de reference) et relance une reconciliation differee quand
 * la liste retrouve un observateur.
 */
export function installTxReconcile(queryClient: QueryClient): void {
  if (installed.has(queryClient)) return
  installed.add(queryClient)
  queryClient.getQueryCache().subscribe((event: QueryCacheNotifyEvent) => {
    if (!isTransactionsList(event.query)) return
    if (event.type === 'updated' && event.action.type === 'success' && !event.action.manual) {
      // Chargement complet (queryFn) : nouvel etat de reference.
      deferred = false
      noteServer(event.query.state.data as Transaction[] | undefined, true)
      return
    }
    if (!deferred || event.type !== 'observerAdded') return
    // Sortie du gestionnaire d'evenement : l'observateur finit de s'abonner
    // (et un eventuel rechargement complet de demarrer) avant la decision.
    setTimeout(() => void reconcileTransactions(queryClient), 0)
  })
}
