// Transactions : couche optimiste partagee par la page Transactions et les
// dialogues (ajout, edition, suppression differee avec annulation, conversion
// en virement), preferences de saisie par appareil et libelles de jour.
//
// Principes (CLAUDE.md, reactivite percue) :
//   - chaque action se reflete immediatement dans le cache ['transactions']
//     (et dans les soldes / le compteur « À catégoriser » portes par
//     bootstrap) ; l'appel /api part en arriere-plan dans la file serialisee
//     (mutationQueue), une action sur une ligne encore temporaire attend donc
//     l'id serveur (deps) ;
//   - un echec annule UNIQUEMENT ce que l'action avait change (retour cible) :
//     jamais de restauration d'un instantane complet de la liste, qui
//     effacerait une autre action optimiste concurrente ;
//   - les operations locales encore en vol (ajouts non confirmes, suppressions
//     differees) sont reappliquees sur toute reponse serveur de la liste
//     arrivee entre-temps : une relecture concurrente ne fait ni reapparaitre
//     une ligne supprimee ni disparaitre une ligne ajoutee.

import {
  MutationObserver as QueryMutationObserver,
  useMutation,
  useQueryClient,
  type QueryCacheNotifyEvent,
  type QueryClient,
} from '@tanstack/react-query'
import type { Account, Transaction } from '@/types/domain'
import { apiCall } from '@/lib/api'
import {
  apiAddTransaction,
  apiUpdateTransaction,
  BOOTSTRAP_KEY,
  countsAsUncategorized,
  hasServerFeature,
  patchAccountBalances,
  patchUncategorizedCount,
  TRANSACTIONS_KEY,
  type Bootstrap,
  type UpdateTransactionInput,
} from '@/lib/data'
import { enqueue, isTempId, newTempId, registerRealId, resolveId } from '@/lib/mutationQueue'
import { forgetPayeeOptimistic, learnPayeeOptimistic, scheduleBudgetRefetch } from '@/lib/categorize'
import { followTxId, registerConfirmedTx, txRowKey } from '@/lib/txIds'
import { fmtDayLong, today } from '@/lib/format'

type BalanceDelta = { accountId: string; delta: number }

// ---------------------------------------------------------------------------
// Lecture / ecriture du cache
// ---------------------------------------------------------------------------

function readTxs(queryClient: QueryClient): Transaction[] | undefined {
  return queryClient.getQueryData<Transaction[]>(TRANSACTIONS_KEY)
}

function writeTxs(queryClient: QueryClient, update: (old: Transaction[]) => Transaction[]): void {
  queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, (old) => (old ? update(old) : old))
}

function findTx(queryClient: QueryClient, id: string): Transaction | undefined {
  return readTxs(queryClient)?.find((t) => t.id === id)
}

/**
 * Insere une ligne a sa place chronologique (liste anti-chronologique) : en
 * tete des lignes du meme jour, comme une nouvelle saisie. `beforeId` force la
 * position exacte (restauration d'une suppression annulee).
 */
export function insertTx(list: Transaction[], tx: Transaction, beforeId?: string | null): Transaction[] {
  if (beforeId) {
    const at = list.findIndex((t) => t.id === beforeId)
    if (at >= 0) return [...list.slice(0, at), tx, ...list.slice(at)]
  }
  const at = list.findIndex((t) => t.date <= tx.date)
  if (at < 0) return [...list, tx]
  return [...list.slice(0, at), tx, ...list.slice(at)]
}

/** Soldes de comptes et compteur « À catégoriser » : applique des deltas optimistes. */
function applyDeltas(queryClient: QueryClient, balances: BalanceDelta[], count: number): void {
  patchAccountBalances(queryClient, balances)
  patchUncategorizedCount(queryClient, count)
}

/** Retire des deltas appliques par applyDeltas (retour arriere d'une action). */
function reverseDeltas(queryClient: QueryClient, balances: BalanceDelta[], count: number): void {
  patchAccountBalances(
    queryClient,
    balances.map((d) => ({ ...d, delta: -d.delta })),
  )
  patchUncategorizedCount(queryClient, -count)
}

/**
 * Relecture ciblee APRES les ecritures deja en file (serialisee comme elles) :
 * une reponse lue avant une ecriture en vol l'effacerait (« valeur qui
 * saute »). La lecture elle-meme ne bloque pas la file.
 */
export function refetchAfterWrites(queryClient: QueryClient, keys: readonly (readonly unknown[])[]): void {
  void enqueue(async () => {
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey })
  })
}

// ---------------------------------------------------------------------------
// Operations locales en vol, reappliquees sur les reponses serveur
// ---------------------------------------------------------------------------

interface PendingAdd {
  /** Derniere version optimiste connue (une categorisation a pu la modifier). */
  tx: Transaction
  /** Ids presents dans la liste a l'ajout : une ligne inconnue identique est la creation. */
  knownIds: Set<string>
}

export interface PendingRemoval {
  tx: Transaction
  /** Ligne qui suivait la supprimee dans le cache (restauration a l'identique). */
  beforeId: string | null
  balances: BalanceDelta[]
  count: number
}

const pendingAdds = new Map<string, PendingAdd>()
const pendingDeletes = new Map<string, PendingRemoval>()
// Ajouts de la session (cle stable -> horodatage) : mise en lumiere discrete.
const addedAt = new Map<string, number>()

export { followTxId, txRowKey }

/** Ligne ajoutee a l'instant (moins de `ms`) : mise en lumiere a l'apparition. */
export function isFreshlyAdded(id: string, ms = 2500): boolean {
  const at = addedAt.get(txRowKey(id))
  return at !== undefined && Date.now() - at < ms
}

/** Ligne encore en cours de creation (id temporaire, action serveur en attente). */
export function isUnconfirmedTx(id: string): boolean {
  return isTempId(id)
}

function sameContent(a: Transaction, b: Transaction): boolean {
  return a.accountId === b.accountId && a.date === b.date && a.amount === b.amount && a.label === b.label
}

function reapplyPending(list: Transaction[]): Transaction[] {
  let out = list
  if (pendingDeletes.size > 0) {
    const filtered = out.filter((t) => !pendingDeletes.has(t.id))
    if (filtered.length !== out.length) out = filtered
  }
  for (const [tempId, pending] of pendingAdds) {
    if (out.some((t) => t.id === tempId)) continue
    // La relecture contient deja la ligne creee (reponse de l'ajout pas encore
    // recue) : pas de doublon, la confirmation remplacera l'id temporaire.
    if (out.some((t) => !pending.knownIds.has(t.id) && sameContent(t, pending.tx))) continue
    out = insertTx(out, pending.tx)
  }
  return out
}

const overlayInstalled = new WeakSet<QueryClient>()

function isTxListEvent(event: QueryCacheNotifyEvent): boolean {
  return event.type === 'updated' && event.query.queryKey[0] === TRANSACTIONS_KEY[0] && event.query.queryKey.length === 1
}

/**
 * Installe (une fois par client) le suivi des reponses serveur de la liste :
 * les operations locales en vol y sont reappliquees. Les ecritures manuelles
 * du cache (optimistes) mettent a jour la derniere version des ajouts en vol.
 */
export function ensureTxOverlay(queryClient: QueryClient): void {
  if (overlayInstalled.has(queryClient)) return
  overlayInstalled.add(queryClient)
  queryClient.getQueryCache().subscribe((event) => {
    if (!isTxListEvent(event) || event.type !== 'updated' || event.action.type !== 'success') return
    const data = event.query.state.data as Transaction[] | undefined
    if (!data || (pendingAdds.size === 0 && pendingDeletes.size === 0)) return
    if (event.action.manual) {
      for (const pending of pendingAdds.values()) {
        const current = data.find((t) => t.id === pending.tx.id)
        if (current) pending.tx = current
      }
      return
    }
    const next = reapplyPending(data)
    if (next !== data) queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, next)
  })
}

// ---------------------------------------------------------------------------
// Ordre stable au sein d'un meme jour
// ---------------------------------------------------------------------------
//
// Le serveur trie par date seulement : l'ordre des lignes d'un meme jour peut
// changer d'une relecture a l'autre, et une saisie placee en tete de sa
// journee retomberait en bas a la reconciliation (« valeur qui saute »). Le
// rang de premiere apparition fige l'ordre pour la session : la liste initiale
// garde l'ordre serveur, toute ligne apparue ensuite passe en tete de son jour.

const firstSeen = new Map<string, number>()
let newRank = 0

/** Rang d'affichage d'une ligne au sein de son jour (plus petit = plus haut). */
export function txDayRank(list: readonly Transaction[]): (id: string) => number {
  if (firstSeen.size === 0) {
    list.forEach((t, i) => firstSeen.set(txRowKey(t.id), i))
  } else {
    for (const t of list) {
      const key = txRowKey(t.id)
      if (!firstSeen.has(key)) firstSeen.set(key, --newRank)
    }
  }
  return (id) => firstSeen.get(txRowKey(id)) ?? 0
}

// ---------------------------------------------------------------------------
// Ajout optimiste
// ---------------------------------------------------------------------------

export interface AddTransactionInput {
  accountId: string
  date: string
  label: string
  categoryId: string | null
  amount: number // centimes signes
  note?: string
}

export interface AddTransactionVars extends AddTransactionInput {
  tempId: string
}

interface AddContext {
  tempId: string
  balances: BalanceDelta[]
  count: number
}

function confirmAdd(queryClient: QueryClient, tempId: string, realId: string): void {
  const pending = pendingAdds.get(tempId)
  pendingAdds.delete(tempId)
  registerConfirmedTx(tempId, realId)
  writeTxs(queryClient, (old) => {
    const hasReal = old.some((t) => t.id === realId)
    const hasTemp = old.some((t) => t.id === tempId)
    if (hasTemp && hasReal) return old.filter((t) => t.id !== tempId)
    if (hasTemp) return old.map((t) => (t.id === tempId ? { ...t, id: realId } : t))
    // Ligne effacee par une relecture concurrente : on la repose, confirmee.
    if (!hasReal && pending) return insertTx(old, { ...pending.tx, id: realId })
    return old
  })
}

/**
 * Ajout d'une transaction : la ligne (id temporaire) apparait a sa date,
 * soldes et compteur ajustes ; a la confirmation, l'id serveur remplace l'id
 * temporaire en place (aucune relecture de la liste). Echec : ligne et
 * ajustements retires, `onFailure` recoit la saisie (reouverture du dialogue).
 */
export function useAddTransaction(onFailure: (vars: AddTransactionVars, error: unknown) => void) {
  const queryClient = useQueryClient()
  ensureTxOverlay(queryClient)
  return useMutation({
    // L'erreur est affichee dans le dialogue rouvert : pas de toast global.
    meta: { errorToast: false },
    mutationFn: ({ tempId, ...input }: AddTransactionVars) =>
      enqueue(
        async () => {
          const res = await apiAddTransaction({
            ...input,
            categoryId: input.categoryId === null ? null : resolveId(input.categoryId),
          })
          // Dans la tache : les actions en file derriere l'ajout (categoriser la
          // nouvelle ligne...) partent avec l'id serveur.
          registerRealId(tempId, res.id)
          return res
        },
        { deps: input.categoryId === null ? [] : [input.categoryId] },
      ),
    onMutate: async (vars): Promise<AddContext> => {
      await queryClient.cancelQueries({ queryKey: TRANSACTIONS_KEY })
      const tx: Transaction = {
        id: vars.tempId,
        accountId: vars.accountId,
        date: vars.date,
        label: vars.label,
        categoryId: vars.categoryId,
        amount: vars.amount,
        transferGroupId: null,
        note: vars.note,
        counterparty: null,
      }
      const knownIds = new Set((readTxs(queryClient) ?? []).map((t) => t.id))
      pendingAdds.set(vars.tempId, { tx, knownIds })
      addedAt.set(vars.tempId, Date.now())
      writeTxs(queryClient, (old) => insertTx(old, tx))
      const balances = [{ accountId: vars.accountId, delta: vars.amount }]
      const count = countsAsUncategorized(queryClient, tx) ? 1 : 0
      applyDeltas(queryClient, balances, count)
      return { tempId: vars.tempId, balances, count }
    },
    onSuccess: (res, vars) => {
      confirmAdd(queryClient, vars.tempId, res.id)
      // Une saisie categorisee ou un revenu deplace le budget du mois.
      scheduleBudgetRefetch(queryClient)
    },
    onError: (error, vars, ctx) => {
      pendingAdds.delete(vars.tempId)
      addedAt.delete(vars.tempId)
      writeTxs(queryClient, (old) => old.filter((t) => t.id !== vars.tempId))
      if (ctx) reverseDeltas(queryClient, ctx.balances, ctx.count)
      onFailure(vars, error)
    },
  })
}

export { newTempId }

// ---------------------------------------------------------------------------
// Edition optimiste
// ---------------------------------------------------------------------------

interface UpdateContext {
  before: Transaction
  after: Transaction
  balances: BalanceDelta[]
  count: number
  payeeKeyAdded: string | null
}

function sameEditable(a: Transaction, b: Transaction): boolean {
  return (
    a.accountId === b.accountId &&
    a.date === b.date &&
    a.label === b.label &&
    a.categoryId === b.categoryId &&
    a.amount === b.amount &&
    (a.note ?? '') === (b.note ?? '')
  )
}

/**
 * Edition d'une transaction : la ligne reflete immediatement les nouvelles
 * valeurs, rollback cible si echec puis `onFailure(ligne d'origine)` (le
 * dialogue se rouvre sur les valeurs d'origine avec un message).
 */
export function useUpdateTransaction(onFailure: (previous: Transaction) => void) {
  const queryClient = useQueryClient()
  ensureTxOverlay(queryClient)
  return useMutation({
    // Echec signale dans le dialogue rouvert : pas de toast global.
    meta: { errorToast: false },
    // Id eventuellement capture avant la confirmation de la ligne (dialogue
    // ouvert sur une saisie toute fraiche) : suivi vers l'id serveur.
    mutationFn: (input: UpdateTransactionInput) => {
      const txId = followTxId(input.transactionId)
      return enqueue(
        () =>
          apiUpdateTransaction({
            ...input,
            transactionId: resolveId(txId),
            categoryId: input.categoryId === null ? null : resolveId(input.categoryId),
          }),
        { deps: input.categoryId === null ? [txId] : [txId, input.categoryId] },
      )
    },
    onMutate: async (input): Promise<UpdateContext | undefined> => {
      await queryClient.cancelQueries({ queryKey: TRANSACTIONS_KEY })
      const before = findTx(queryClient, followTxId(input.transactionId))
      if (!before) return undefined
      const after: Transaction = {
        ...before,
        accountId: input.accountId,
        date: input.date,
        label: input.label,
        categoryId: input.categoryId,
        amount: input.amount,
        note: input.note ?? undefined,
      }
      const balances =
        before.accountId === after.accountId
          ? [{ accountId: after.accountId, delta: after.amount - before.amount }]
          : [
              { accountId: before.accountId, delta: -before.amount },
              { accountId: after.accountId, delta: after.amount },
            ]
      const wasUncat = countsAsUncategorized(queryClient, before)
      writeTxs(queryClient, (old) => old.map((t) => (t.id === before.id ? after : t)))
      const count = (countsAsUncategorized(queryClient, after) ? 1 : 0) - (wasUncat ? 1 : 0)
      applyDeltas(queryClient, balances, count)
      // Le serveur apprend le tiers quand la categorie est posee ou changee.
      const payeeKeyAdded =
        after.categoryId && after.categoryId !== before.categoryId
          ? learnPayeeOptimistic(queryClient, after, after.categoryId)
          : null
      return { before, after, balances, count, payeeKeyAdded }
    },
    onError: (_err, _input, ctx) => {
      if (!ctx) return
      const current = findTx(queryClient, ctx.before.id)
      // Une autre action a modifie la ligne depuis : on ne l'ecrase pas.
      if (!current || sameEditable(current, ctx.after)) {
        if (current) writeTxs(queryClient, (old) => old.map((t) => (t.id === ctx.before.id ? ctx.before : t)))
        reverseDeltas(queryClient, ctx.balances, ctx.count)
      }
      if (ctx.payeeKeyAdded) forgetPayeeOptimistic(queryClient, ctx.payeeKeyAdded)
      onFailure(ctx.before)
    },
    // Liste, soldes et badge deja exacts ; une edition peut changer categorie,
    // montant ou mois : refetch cible et coalesce du budget.
    onSuccess: () => scheduleBudgetRefetch(queryClient),
  })
}

// ---------------------------------------------------------------------------
// Suppression differee (annulable)
// ---------------------------------------------------------------------------

function removalOf(queryClient: QueryClient, tx: Transaction): PendingRemoval {
  const list = readTxs(queryClient) ?? []
  const at = list.findIndex((t) => t.id === tx.id)
  return {
    tx,
    beforeId: at >= 0 ? (list[at + 1]?.id ?? null) : null,
    // Le miroir d'un virement est supprime ou delie par le serveur (inconnu
    // ici) : seul le solde de la ligne supprimee est ajuste, le reste est relu
    // au succes.
    balances: [{ accountId: tx.accountId, delta: -tx.amount }],
    count: countsAsUncategorized(queryClient, tx) ? -1 : 0,
  }
}

function removeRow(queryClient: QueryClient, removal: PendingRemoval): void {
  writeTxs(queryClient, (old) => old.filter((t) => t.id !== removal.tx.id))
  applyDeltas(queryClient, removal.balances, removal.count)
}

function restoreRow(queryClient: QueryClient, removal: PendingRemoval): void {
  const present = findTx(queryClient, removal.tx.id) !== undefined
  if (!present) writeTxs(queryClient, (old) => insertTx(old, removal.tx, removal.beforeId))
  reverseDeltas(queryClient, removal.balances, removal.count)
}

/**
 * Retire une ligne de la liste SANS appel serveur : la suppression reelle
 * part a l'expiration de son toast (commitPendingDeletes) ou jamais si
 * l'utilisateur annule (restorePendingDeletes). Refuse les lignes non
 * confirmees (creation en vol).
 */
export function removeTxPending(queryClient: QueryClient, txId: string): Transaction | null {
  ensureTxOverlay(queryClient)
  if (pendingDeletes.has(txId) || isTempId(txId)) return null
  const tx = findTx(queryClient, txId)
  if (!tx) return null
  const removal = removalOf(queryClient, tx)
  pendingDeletes.set(txId, removal)
  removeRow(queryClient, removal)
  return tx
}

/** « Annuler » : les lignes reviennent a leur place, aucun appel serveur. */
export function restorePendingDeletes(queryClient: QueryClient, ids: string[]): void {
  // Ordre inverse : chaque ligne retrouve la voisine qui la suivait.
  for (const id of [...ids].reverse()) {
    const removal = pendingDeletes.get(id)
    if (!removal) continue
    pendingDeletes.delete(id)
    restoreRow(queryClient, removal)
  }
}

export function hasPendingDeletes(): boolean {
  return pendingDeletes.size > 0
}

interface DeleteVars {
  removal: PendingRemoval
}

function deleteMutationOptions(queryClient: QueryClient) {
  return {
    mutationKey: ['transactions', 'delete'],
    mutationFn: ({ removal }: DeleteVars) =>
      enqueue(() => apiCall('deleteTransaction', { transactionId: resolveId(removal.tx.id) }), {
        deps: [removal.tx.id],
      }),
    // Premiere execution : la ligne est deja retiree (suppression differee).
    // Relance apres un echec (ligne restauree) : on la retire de nouveau.
    onMutate: ({ removal }: DeleteVars): PendingRemoval => {
      if (findTx(queryClient, removal.tx.id)) {
        const again = removalOf(queryClient, removal.tx)
        removeRow(queryClient, again)
        return again
      }
      return removal
    },
    onError: (_err: unknown, { removal }: DeleteVars, ctx: PendingRemoval | undefined) => {
      restoreRow(queryClient, ctx ?? removal)
    },
    onSuccess: (_data: unknown, { removal }: DeleteVars) => {
      // Virement : le serveur supprime ou delie aussi le MIROIR (autre compte),
      // inconnu du cache ; sans relecture il resterait affiche orphelin.
      if (removal.tx.transferGroupId) refetchAfterWrites(queryClient, [TRANSACTIONS_KEY, BOOTSTRAP_KEY])
      scheduleBudgetRefetch(queryClient)
    },
  }
}

/**
 * Envoie les suppressions differees (toutes, ou le lot donne) : expiration du
 * toast, page masquee ou quittee. Hors cycle de vie React (MutationObserver) :
 * l'envoi survit a la fermeture de la page.
 */
export function commitPendingDeletes(queryClient: QueryClient, ids?: string[]): void {
  const targets = ids ?? [...pendingDeletes.keys()]
  for (const id of targets) {
    const removal = pendingDeletes.get(id)
    if (!removal) continue
    pendingDeletes.delete(id)
    const observer = new QueryMutationObserver(queryClient, deleteMutationOptions(queryClient))
    observer.mutate({ removal }).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Conversion en virement / annulation du virement
// ---------------------------------------------------------------------------

function accountsOf(queryClient: QueryClient): Map<string, Account> {
  const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
  return new Map((boot?.accounts ?? []).map((a) => [a.id, a]))
}

/** Compte les lignes (etat courant du cache) qui alimentent le badge « À catégoriser ». */
function uncatCountOf(queryClient: QueryClient, ids: string[]): number {
  let n = 0
  for (const id of ids) {
    const t = findTx(queryClient, id)
    if (t && countsAsUncategorized(queryClient, t)) n += 1
  }
  return n
}

/**
 * Virement entre un compte budget et un compte de suivi (serveur recent) : la
 * moitie cote budget garde sa categorie quand c'est l'origine. Sans la
 * fonctionnalite, tout virement est neutre (categorie retiree).
 */
export function conversionKeepsCategory(
  queryClient: QueryClient,
  tx: Pick<Transaction, 'accountId'>,
  targetAccountId: string,
): boolean {
  if (!hasServerFeature(queryClient, 'crossBudgetTransfers')) return false
  const accounts = accountsOf(queryClient)
  const origin = accounts.get(tx.accountId)
  const target = accounts.get(targetAccountId)
  return Boolean(origin?.onBudget && target && !target.onBudget)
}

interface ConvertVars {
  txId: string
  targetAccountId: string
}

interface ConvertContext {
  before: Transaction
  groupId: string
  mirrorId: string
  balances: BalanceDelta[]
  count: number
}

/**
 * « Convertir en virement » optimiste : la ligne devient une moitie de
 * virement et son miroir apparait sur le compte cible ; la liste est relue
 * au succes (ids serveur du miroir et du groupe).
 */
export function useConvertToTransfer() {
  const queryClient = useQueryClient()
  ensureTxOverlay(queryClient)
  return useMutation({
    mutationFn: ({ txId, targetAccountId }: ConvertVars) =>
      enqueue(
        () =>
          apiCall<{ ok: true; transferGroupId?: string }>('convertToTransfer', {
            transactionId: resolveId(txId),
            targetAccountId,
          }),
        { deps: [txId] },
      ),
    onMutate: async ({ txId, targetAccountId }): Promise<ConvertContext | undefined> => {
      await queryClient.cancelQueries({ queryKey: TRANSACTIONS_KEY })
      const before = findTx(queryClient, txId)
      if (!before || before.transferGroupId) return undefined
      const keep = conversionKeepsCategory(queryClient, before, targetAccountId)
      const groupId = newTempId()
      const mirrorId = newTempId()
      const countBefore = uncatCountOf(queryClient, [txId])
      const origin: Transaction = { ...before, transferGroupId: groupId, categoryId: keep ? before.categoryId : null }
      const mirror: Transaction = {
        id: mirrorId,
        accountId: targetAccountId,
        date: before.date,
        label: before.label,
        categoryId: null,
        amount: -before.amount,
        transferGroupId: groupId,
        counterparty: null,
      }
      writeTxs(queryClient, (old) => insertTx(old.map((t) => (t.id === txId ? origin : t)), mirror, txId))
      const count = uncatCountOf(queryClient, [txId, mirrorId]) - countBefore
      const balances = [{ accountId: targetAccountId, delta: mirror.amount }]
      applyDeltas(queryClient, balances, count)
      return { before, groupId, mirrorId, balances, count }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return
      writeTxs(queryClient, (old) =>
        old
          .filter((t) => t.id !== ctx.mirrorId)
          .map((t) => (t.id === ctx.before.id && t.transferGroupId === ctx.groupId ? ctx.before : t)),
      )
      reverseDeltas(queryClient, ctx.balances, ctx.count)
    },
    // Ids du miroir et du groupe connus du seul serveur : relecture de la
    // liste et des soldes (action rare et explicite), apres les ecritures en
    // file (une annulation immediate ne doit pas etre effacee).
    onSuccess: () => {
      refetchAfterWrites(queryClient, [TRANSACTIONS_KEY, BOOTSTRAP_KEY])
      scheduleBudgetRefetch(queryClient)
    },
  })
}

interface RevertContext {
  kept: Transaction
  mirror: Transaction | null
  mirrorRemoved: boolean
  mirrorBeforeId: string | null
  balances: BalanceDelta[]
  count: number
}

/**
 * « Annuler le virement » optimiste : la ligne redevient ordinaire. Le miroir
 * cree par une conversion (meme libelle, sans contrepartie) est supprime par
 * le serveur, un import bancaire lie est seulement delie : on anticipe, puis
 * la liste est relue au succes.
 */
export function useRevertTransfer() {
  const queryClient = useQueryClient()
  ensureTxOverlay(queryClient)
  return useMutation({
    mutationFn: ({ txId }: { txId: string }) =>
      enqueue(() => apiCall('convertTransferToNormal', { transactionId: resolveId(txId) }), { deps: [txId] }),
    onMutate: async ({ txId }): Promise<RevertContext | undefined> => {
      await queryClient.cancelQueries({ queryKey: TRANSACTIONS_KEY })
      const list = readTxs(queryClient) ?? []
      const kept = list.find((t) => t.id === txId)
      if (!kept?.transferGroupId) return undefined
      const at = list.findIndex((t) => t.transferGroupId === kept.transferGroupId && t.id !== kept.id)
      const mirror = at >= 0 ? list[at] : null
      const mirrorRemoved = Boolean(
        mirror && !mirror.counterparty && mirror.label === kept.label && mirror.amount === -kept.amount,
      )
      const ids = mirror ? [kept.id, mirror.id] : [kept.id]
      const countBefore = uncatCountOf(queryClient, ids)
      writeTxs(queryClient, (old) =>
        old
          .filter((t) => !(mirrorRemoved && mirror && t.id === mirror.id))
          .map((t) => (ids.includes(t.id) ? { ...t, transferGroupId: null } : t)),
      )
      const count = uncatCountOf(queryClient, ids) - countBefore
      const balances = mirrorRemoved && mirror ? [{ accountId: mirror.accountId, delta: -mirror.amount }] : []
      applyDeltas(queryClient, balances, count)
      return {
        kept,
        mirror,
        mirrorRemoved,
        mirrorBeforeId: mirror ? (list[at + 1]?.id ?? null) : null,
        balances,
        count,
      }
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return
      writeTxs(queryClient, (old) => {
        let next = old.map((t) => {
          if (t.id === ctx.kept.id) return { ...t, transferGroupId: ctx.kept.transferGroupId }
          if (ctx.mirror && t.id === ctx.mirror.id) return { ...t, transferGroupId: ctx.mirror.transferGroupId }
          return t
        })
        if (ctx.mirrorRemoved && ctx.mirror && !next.some((t) => t.id === ctx.mirror!.id)) {
          next = insertTx(next, ctx.mirror, ctx.mirrorBeforeId)
        }
        return next
      })
      reverseDeltas(queryClient, ctx.balances, ctx.count)
    },
    onSuccess: () => {
      refetchAfterWrites(queryClient, [TRANSACTIONS_KEY, BOOTSTRAP_KEY])
      scheduleBudgetRefetch(queryClient)
    },
  })
}

// ---------------------------------------------------------------------------
// Preferences de saisie (par appareil)
// ---------------------------------------------------------------------------

export type TxKind = 'expense' | 'income'

interface TxFormPrefs {
  accountId?: string
  kind?: TxKind
}

const PREFS_KEY = 'inab:tx-form'

export function readTxFormPrefs(): TxFormPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as TxFormPrefs
    return {
      accountId: typeof parsed.accountId === 'string' ? parsed.accountId : undefined,
      kind: parsed.kind === 'income' || parsed.kind === 'expense' ? parsed.kind : undefined,
    }
  } catch {
    return {}
  }
}

export function writeTxFormPrefs(prefs: TxFormPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Stockage indisponible (navigation privee) : la preference est un confort.
  }
}

/** Compte proposable dans un selecteur : ouvert (les comptes clos n'ont plus d'activite). */
export function isSelectableAccount(account: Pick<Account, 'closed'>): boolean {
  return !account.closed
}

/**
 * Compte propose par defaut a la saisie : le dernier utilise sur cet appareil
 * s'il reste un compte budget ouvert, sinon le premier compte courant budget,
 * sinon le premier compte budget ouvert. Jamais un compte de suivi ni un
 * compte clos ; chaine vide si aucun ne convient (choix explicite demande).
 */
export function defaultTxAccountId(accounts: readonly Account[], preferred?: string): string {
  const candidates = accounts.filter((a) => a.onBudget && !a.closed)
  if (preferred && candidates.some((a) => a.id === preferred)) return preferred
  return (candidates.find((a) => a.kind === 'checking') ?? candidates[0])?.id ?? ''
}

// ---------------------------------------------------------------------------
// Libelles de jour
// ---------------------------------------------------------------------------

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

// En-tetes deja calcules (Intl est couteux et chaque liste en affiche des
// dizaines) ; la cle inclut le jour courant (« Aujourd'hui » change a minuit).
const headingCache = new Map<string, { primary: string; secondary: string | null }>()

/** En-tete d'un jour : « Aujourd'hui », « Hier », sinon « Mardi 29 septembre » (+ annee si besoin). */
export function dayHeading(date: string): { primary: string; secondary: string | null } {
  const now = today()
  const cacheKey = `${now}|${date}`
  const hit = headingCache.get(cacheKey)
  if (hit) return hit
  if (headingCache.size > 2000) headingCache.clear()
  const heading = computeDayHeading(date, now)
  headingCache.set(cacheKey, heading)
  return heading
}

function computeDayHeading(date: string, now: string): { primary: string; secondary: string | null } {
  const long = fmtDayLong(date)
  const withYear = date.slice(0, 4) !== now.slice(0, 4) ? `${long} ${date.slice(0, 4)}` : long
  if (date === now) return { primary: "Aujourd'hui", secondary: long.toLowerCase() }
  if (date === isoMinusDays(now, 1)) return { primary: 'Hier', secondary: long.toLowerCase() }
  if (date > now) return { primary: withYear, secondary: 'à venir' }
  return { primary: withYear, secondary: null }
}
