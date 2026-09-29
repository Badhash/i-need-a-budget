// Comptes : appels /api et mutations OPTIMISTES de la page Comptes et de
// l'onboarding (creer, renommer, ajuster le solde, supprimer, inclure dans le
// budget, cloturer).
//
// Principe (CLAUDE.md, reactivite percue) : chaque action se reflete tout de
// suite dans les caches TanStack (bootstrap = comptes et soldes, transactions,
// Pret a assigner des mois en cache, badge « À catégoriser ») ; l'appel /api
// part en arriere-plan dans la file serialisee (mutationQueue) et les ids
// temporaires sont resolus au moment de l'envoi. En cas d'echec, les patchs
// sont annules un par un (rollback discret, sans ecraser les autres mutations
// en vol) ; le toast d'erreur global propose de reessayer. Apres succes, seule
// la relecture ciblee et coalescee du budget (scheduleBudgetRefetch) part.

import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
  type UseMutationOptions,
} from '@tanstack/react-query'
import { apiCall } from '@/lib/api'
import type { BudgetMonth } from '@/lib/budget'
import {
  BOOTSTRAP_KEY,
  TRANSACTIONS_KEY,
  apiAddTransaction,
  apiCreateAccount,
  apiDeleteAccount,
  budgetKey,
  countsAsUncategorized,
  hasServerFeature,
  patchAccountBalances,
  patchUncategorizedCount,
  type AccountWithBalance,
  type Bootstrap,
} from '@/lib/data'
import { scheduleBudgetRefetch } from '@/lib/categorize'
import { toast } from '@/lib/toast'
import { enqueue, newTempId, registerRealId, resolveId } from '@/lib/mutationQueue'
import { addMonths, currentMonth, monthOf, today } from '@/lib/format'
import type { AccountKind, Category, Transaction } from '@/types/domain'
import { countsForBudget, offBudgetTransferGroups } from '../../../packages/engine/src/index'

/** Libelle de la transaction creee par « Ajuster le solde ». */
export const ADJUSTMENT_LABEL = 'Ajustement de solde'
/** Libelle du solde d'ouverture pose par createAccount (serveur). */
export const OPENING_LABEL = "Solde d'ouverture"

// ---------------------------------------------------------------------------
// Appels /api
// ---------------------------------------------------------------------------

export interface AccountPatch {
  accountId: string
  name?: string
  institution?: string
  kind?: AccountKind
  /** Fonctionnalite serveur accountFlags : bascule budget <-> suivi. */
  onBudget?: boolean
  /** Fonctionnalite serveur accountFlags : cloture (solde nul exige) ou reouverture. */
  closed?: boolean
}

/**
 * Edition partielle d'un compte (champs absents = inchanges). Un serveur qui
 * n'annonce pas accountFlags ignore onBudget et closed : l'interface ne les
 * propose qu'avec la fonctionnalite.
 */
export async function apiPatchAccount(input: AccountPatch): Promise<void> {
  await apiCall('updateAccount', { ...input })
}

/**
 * Categorie de revenus qui porte un solde d'ouverture ou un ajustement vers le
 * Pret a assigner : « Solde d'ouverture » si elle existe, sinon la premiere
 * categorie de revenus (meme regle que createAccount cote serveur).
 */
export function openingIncomeCategory(categories: Category[]): Category | undefined {
  return categories.find((c) => c.isIncome && c.name === OPENING_LABEL) ?? categories.find((c) => c.isIncome)
}

// ---------------------------------------------------------------------------
// Ids temporaires : suivi des creations confirmees
// ---------------------------------------------------------------------------

// La file oublie le mapping temp -> reel des qu'elle se vide ; un rollback qui
// survient ensuite (echec d'une mutation dependante) doit pourtant viser le
// compte sous son id serveur. On garde donc les ids confirmes de la session
// (quelques entrees au plus).
const confirmedIds = new Map<string, string>()

function confirmId(tempId: string, realId: string): void {
  confirmedIds.set(tempId, realId)
  registerRealId(tempId, realId)
}

/** Id courant d'une entite creee en optimiste (id serveur des qu'il est connu). */
function currentId(id: string): string {
  return confirmedIds.get(id) ?? resolveId(id)
}

/**
 * Id actuel d'un compte cree dans la session : un ecran ouvert sur l'id
 * temporaire (feuille d'un compte tout juste cree) retrouve le compte apres
 * confirmation serveur.
 */
export function latestAccountId(id: string): string {
  return confirmedIds.get(id) ?? id
}

function isOrphaned(err: unknown): boolean {
  return err instanceof Error && err.name === 'OrphanedMutationError'
}

// ---------------------------------------------------------------------------
// Patchs de cache
// ---------------------------------------------------------------------------

/**
 * Annule les lectures en vol d'une cle avant un patch optimiste (leur reponse,
 * anterieure a l'ecriture, l'ecraserait). Renvoie vrai si une lecture a ete
 * interrompue : l'appelant la relance une fois l'ecriture reglee (sinon la
 * donnee qu'elle apportait, par exemple une ligne ajoutee ailleurs, manquerait).
 */
async function pauseQueries(queryClient: QueryClient, queryKey: QueryKey): Promise<boolean> {
  const wasFetching = queryClient.isFetching({ queryKey }) > 0
  await queryClient.cancelQueries({ queryKey })
  return wasFetching
}

async function pauseAll(queryClient: QueryClient, keys: QueryKey[]): Promise<QueryKey[]> {
  const flags = await Promise.all(keys.map((key) => pauseQueries(queryClient, key)))
  return keys.filter((_, i) => flags[i])
}

function resumeInterrupted(queryClient: QueryClient, keys: QueryKey[] | undefined): void {
  for (const queryKey of keys ?? []) void queryClient.invalidateQueries({ queryKey })
}

const byDateDesc = (a: Transaction, b: Transaction) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)

/** Insere une transaction a sa place (liste triee du plus recent au plus ancien). */
function insertTransaction(queryClient: QueryClient, tx: Transaction): void {
  queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, (old) => {
    if (!old || old.some((t) => t.id === tx.id)) return old
    const index = old.findIndex((t) => t.date <= tx.date)
    const next = old.slice()
    next.splice(index < 0 ? next.length : index, 0, tx)
    return next
  })
}

function removeTransactions(queryClient: QueryClient, keep: (t: Transaction) => boolean): void {
  queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, (old) => {
    if (!old) return old
    const next = old.filter(keep)
    return next.length === old.length ? old : next
  })
}

function mapTransactions(queryClient: QueryClient, fn: (t: Transaction) => Transaction): void {
  queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, (old) => {
    if (!old) return old
    let changed = false
    const next = old.map((t) => {
      const u = fn(t)
      if (u !== t) changed = true
      return u
    })
    return changed ? next : old
  })
}

function mapAccounts(queryClient: QueryClient, fn: (accounts: AccountWithBalance[]) => AccountWithBalance[]): void {
  queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => (old ? { ...old, accounts: fn(old.accounts) } : old))
}

function patchAccountFields(queryClient: QueryClient, ids: string[], patch: Partial<AccountWithBalance>): void {
  mapAccounts(queryClient, (accounts) => accounts.map((a) => (ids.includes(a.id) ? { ...a, ...patch } : a)))
}

/**
 * Ajoute au Pret a assigner de chaque mois de budget EN CACHE la variation que
 * lui donne `deltaFor(mois)` (un revenu du mois O pese sur tous les mois >= O).
 * Renvoie les variations appliquees, pour un rollback exact.
 */
function patchBudgetRta(queryClient: QueryClient, deltaFor: (month: string) => number): Map<string, number> {
  const applied = new Map<string, number>()
  for (const [key, data] of queryClient.getQueriesData<BudgetMonth>({ queryKey: ['budget'] })) {
    const month = key[1]
    if (typeof month !== 'string' || !data) continue
    const delta = deltaFor(month)
    if (delta === 0) continue
    queryClient.setQueryData<BudgetMonth>(key, { ...data, rta: data.rta + delta })
    applied.set(month, delta)
  }
  return applied
}

function unpatchBudgetRta(queryClient: QueryClient, applied: Map<string, number> | undefined): void {
  for (const [month, delta] of applied ?? []) {
    queryClient.setQueryData<BudgetMonth>(budgetKey(month), (old) => (old ? { ...old, rta: old.rta - delta } : old))
  }
}

/**
 * Revenu ponctuel (solde d'ouverture, ajustement categorise en revenus) : il
 * entre au Pret a assigner de son mois et de tous les suivants ; avant le mois
 * de depart du budget, il rejoint le solde de depart (verse au mois de depart).
 */
function patchInflow(queryClient: QueryClient, date: string, amount: number): Map<string, number> {
  const start = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)?.budgetStartMonth ?? null
  const from = start !== null && start > monthOf(date) ? start : monthOf(date)
  return patchBudgetRta(queryClient, (month) => (month >= from ? amount : 0))
}

// ---------------------------------------------------------------------------
// Regles du budget cote client (miroir du moteur, pour les apercus)
// ---------------------------------------------------------------------------

interface BudgetView {
  accounts: { id: string; onBudget: boolean }[]
  categories: Category[]
  transactions: Transaction[]
  startMonth: string | null
  /** Serveur recent : un virement budget <-> suivi fait entrer/sortir l'argent. */
  crossBudget: boolean
}

const EMPTY_GROUPS: ReadonlySet<string> = new Set()

// Regles partagees du moteur : virements croises (budget <-> suivi) reconnus
// seulement si le serveur deploye les applique.
function scopeOf(view: BudgetView, onBudgetIds: Set<string>) {
  const offGroups = view.crossBudget ? offBudgetTransferGroups(view.transactions, onBudgetIds) : EMPTY_GROUPS
  return { onBudgetIds, offGroups }
}

/**
 * Courbe des revenus cumules du Pret a assigner (terme « inflows » du moteur)
 * pour un ensemble de comptes budget : solde de depart brut avant le mois de
 * depart, puis transactions categorisees en revenus comptees au budget.
 */
function inflowCurve(view: BudgetView, onBudgetIds: Set<string>): (month: string) => number {
  const { offGroups } = scopeOf(view, onBudgetIds)
  const income = new Set(view.categories.filter((c) => c.isIncome).map((c) => c.id))
  const start = view.startMonth
  const byMonth = new Map<string, number>()
  for (const t of view.transactions) {
    if (!onBudgetIds.has(t.accountId)) continue
    const m = monthOf(t.date)
    let key = m
    if (start !== null && m < start) {
      // Historique gele : somme brute versee au mois de depart.
      key = start
    } else if (!t.categoryId || !income.has(t.categoryId) || !countsForBudget(t, onBudgetIds, offGroups)) {
      continue
    }
    byMonth.set(key, (byMonth.get(key) ?? 0) + t.amount)
  }
  const months = [...byMonth.keys()].sort()
  return (month) => {
    if (start !== null && month < start) return 0
    let sum = 0
    for (const m of months) {
      if (m > month) break
      sum += byMonth.get(m)!
    }
    return sum
  }
}

/** Nombre de transactions « À catégoriser » (meme regle que le badge serveur). */
function uncategorizedCountOf(view: BudgetView, onBudgetIds: Set<string>, current: string): number {
  const { offGroups } = scopeOf(view, onBudgetIds)
  let count = 0
  for (const t of view.transactions) {
    if (t.categoryId) continue
    const m = monthOf(t.date)
    if (m > current || (view.startMonth !== null && m < view.startMonth)) continue
    if (countsForBudget(t, onBudgetIds, offGroups)) count += 1
  }
  return count
}

export interface InclusionEffect {
  /**
   * Variation du Pret a assigner du mois vise : revenus du compte (et solde de
   * depart s'il precede le mois de depart). L'effet sur les depassements des
   * mois passes n'est pas estime : le budget relu fait foi.
   */
  rtaDelta: number
  /** Variation du badge « À catégoriser ». */
  uncategorizedDelta: number
  /** Somme des operations du compte categorisees en enveloppes (hors revenus). */
  envelopeActivity: number
}

function viewFromCaches(queryClient: QueryClient): BudgetView | null {
  const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
  const transactions = queryClient.getQueryData<Transaction[]>(TRANSACTIONS_KEY)
  if (!boot || !transactions) return null
  return {
    accounts: boot.accounts,
    categories: boot.categories,
    transactions,
    startMonth: boot.budgetStartMonth,
    crossBudget: boot.features.includes('crossBudgetTransfers'),
  }
}

function onBudgetSets(view: BudgetView, accountId: string, nextOnBudget: boolean) {
  const before = new Set(view.accounts.filter((a) => a.onBudget).map((a) => a.id))
  const after = new Set(before)
  if (nextOnBudget) after.add(accountId)
  else after.delete(accountId)
  return { before, after }
}

/**
 * Effet attendu de la bascule budget <-> suivi d'un compte sur le mois `month`
 * (apercu de la confirmation, patch optimiste).
 */
export function inclusionEffect(
  view: BudgetView,
  accountId: string,
  nextOnBudget: boolean,
  month: string,
  current: string = currentMonth(),
): InclusionEffect {
  const { before, after } = onBudgetSets(view, accountId, nextOnBudget)
  const rtaDelta = inflowCurve(view, after)(month) - inflowCurve(view, before)(month)
  const uncategorizedDelta = uncategorizedCountOf(view, after, current) - uncategorizedCountOf(view, before, current)
  const withAccount = nextOnBudget ? after : before
  const { offGroups } = scopeOf(view, withAccount)
  const income = new Set(view.categories.filter((c) => c.isIncome).map((c) => c.id))
  let envelopeActivity = 0
  for (const t of view.transactions) {
    if (t.accountId !== accountId || !t.categoryId || income.has(t.categoryId)) continue
    if (view.startMonth !== null && monthOf(t.date) < view.startMonth) continue
    if (countsForBudget(t, withAccount, offGroups)) envelopeActivity += t.amount
  }
  return { rtaDelta, uncategorizedDelta, envelopeActivity }
}

/** Variante hook-free : lit les caches (confirmation de bascule). */
export function inclusionEffectFromCaches(
  queryClient: QueryClient,
  accountId: string,
  nextOnBudget: boolean,
  month: string,
): InclusionEffect | null {
  const view = viewFromCaches(queryClient)
  return view ? inclusionEffect(view, accountId, nextOnBudget, month) : null
}

// ---------------------------------------------------------------------------
// Statistiques d'affichage (sparkline, derniere operation, variation du mois)
// ---------------------------------------------------------------------------

export interface AccountStats {
  /** Soldes echantillonnes du plus ancien au plus recent (dernier = solde actuel). */
  series: number[]
  /** Date de la derniere operation passee (<= aujourd'hui), null si aucune. */
  lastActivity: string | null
  /** Variation du solde depuis le 1er du mois courant. */
  monthChange: number
}

/** Jours entre deux dates ISO (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate()
}

/** Nombre de points des courbes : aujourd'hui et le meme jour des 6 mois precedents. */
export const SPARK_MONTHS = 6

/** Dates des points des courbes : le meme jour des 6 mois precedents, puis aujourd'hui. */
export function sparkSampleDates(now: string = today()): string[] {
  const day = Number(now.slice(8, 10))
  const samples: string[] = []
  for (let k = SPARK_MONTHS; k >= 1; k--) {
    const month = addMonths(monthOf(now), -k)
    samples.push(`${month}-${String(Math.min(day, daysInMonth(month))).padStart(2, '0')}`)
  }
  samples.push(now)
  return samples
}

/**
 * Soldes de chaque compte sur les 6 derniers mois, un point par mois AU MEME
 * JOUR que la date du jour (un compte courant oscille avec le salaire : a
 * phase constante, la courbe montre la tendance, pas le cycle mensuel), plus
 * aujourd'hui. Calcul A REBOURS depuis le solde serveur : solde(d) = solde -
 * operations posterieures a d. Aucune lecture reseau : tout vient du cache
 * des transactions.
 */
export function computeAccountStats(
  accounts: AccountWithBalance[],
  transactions: Transaction[],
  now: string = today(),
): Map<string, AccountStats> {
  const samples = sparkSampleDates(now)
  const monthStart = `${monthOf(now)}-01`

  const byAccount = new Map<string, Transaction[]>()
  for (const t of transactions) {
    const list = byAccount.get(t.accountId)
    if (list) list.push(t)
    else byAccount.set(t.accountId, [t])
  }

  const out = new Map<string, AccountStats>()
  for (const account of accounts) {
    const own = (byAccount.get(account.id) ?? []).slice().sort(byDateDesc)
    const series = new Array<number>(samples.length)
    let after = 0
    let idx = 0
    for (let i = samples.length - 1; i >= 0; i--) {
      while (idx < own.length && own[idx]!.date > samples[i]!) {
        after += own[idx]!.amount
        idx += 1
      }
      series[i] = account.balance - after
    }
    // Le dernier point est le solde affiche (operations futures comprises).
    series[series.length - 1] = account.balance
    let lastActivity: string | null = null
    let monthChange = 0
    for (const t of own) {
      if (t.date > now) continue
      if (lastActivity === null) lastActivity = t.date
      if (t.date >= monthStart) monthChange += t.amount
    }
    out.set(account.id, { series, lastActivity, monthChange })
  }
  return out
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

interface WriteContext {
  /** Lectures interrompues par le patch optimiste, relancees au reglement. */
  interrupted?: QueryKey[]
}

const OPTIMISTIC_KEYS: QueryKey[] = [BOOTSTRAP_KEY, TRANSACTIONS_KEY, ['budget']]

// --- Ajuster le solde --------------------------------------------------------

export interface AdjustBalanceVars {
  accountId: string
  /** Ecart signe (centimes) : solde reel - solde affiche. */
  delta: number
  /** Revenus (compte budget) ou null (compte de suivi, pas de revenus). */
  categoryId: string | null
  date: string
  tempId: string
  /**
   * « Ajuster à 0 et clôturer » (accountFlags) : la cloture part dans la MEME
   * tache de la file, juste apres l'ajustement que le serveur doit avoir vu
   * (garde du solde nul). Ordre garanti, et « Réessayer » rejoue les deux.
   */
  closeAfter?: boolean
}

interface AdjustContext extends WriteContext {
  rta?: Map<string, number>
  counted?: boolean
  closed?: boolean
}

/**
 * Identifiant du toast « compte clôturé » d'un ajustement a 0 : en cas de
 * refus de la cloture, le toast d'echec le REMPLACE (pas deux messages
 * contradictoires).
 */
export function closedToastId(accountId: string): string {
  return `account-closed:${accountId}`
}

interface AdjustResult {
  id: string
  /** Ajustement enregistre mais cloture refusee (on garde l'ajustement). */
  closeFailed: boolean
}

/**
 * Prepare un ajustement vers `target` (centimes) a partir du solde EN CACHE
 * (optimismes en vol compris). null si le compte est inconnu ou deja juste.
 */
export function buildAdjustment(queryClient: QueryClient, accountId: string, target: number): AdjustBalanceVars | null {
  const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
  const account = boot?.accounts.find((a) => a.id === accountId)
  if (!account) return null
  const delta = target - account.balance
  if (delta === 0) return null
  // Compte budget : l'ecart part au Pret a assigner (categorie de revenus),
  // comme dans YNAB. Compte de suivi : jamais de categorie.
  const categoryId = account.onBudget ? (openingIncomeCategory(boot?.categories ?? [])?.id ?? null) : null
  return { accountId, delta, categoryId, date: today(), tempId: newTempId() }
}

/**
 * « Ajuster le solde » : une transaction « Ajustement de solde » de l'ecart,
 * categorisee en revenus sur un compte budget (le Pret a assigner bouge tout
 * de suite), sans categorie sur un compte de suivi.
 */
export function useAdjustBalance() {
  const queryClient = useQueryClient()
  const willClose = (vars: AdjustBalanceVars) =>
    vars.closeAfter === true && hasServerFeature(queryClient, 'accountFlags')
  return useMutation<AdjustResult, Error, AdjustBalanceVars, AdjustContext>({
    mutationFn: (vars) =>
      enqueue(
        async () => {
          const res = await apiAddTransaction({
            accountId: resolveId(vars.accountId),
            date: vars.date,
            label: ADJUSTMENT_LABEL,
            categoryId: vars.categoryId === null ? null : resolveId(vars.categoryId),
            amount: vars.delta,
          })
          registerRealId(vars.tempId, res.id)
          let closeFailed = false
          if (willClose(vars)) {
            // L'ajustement est acquis : un refus de la cloture ne doit pas le
            // faire rejouer (doublon). Il est signale a part, sans rollback.
            try {
              await apiPatchAccount({ accountId: resolveId(vars.accountId), closed: true })
            } catch {
              closeFailed = true
            }
          }
          return { id: res.id, closeFailed }
        },
        { deps: vars.categoryId ? [vars.accountId, vars.categoryId] : [vars.accountId] },
      ),
    onMutate: async (vars) => {
      const interrupted = await pauseAll(queryClient, OPTIMISTIC_KEYS)
      const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
      const account = boot?.accounts.find((a) => a.id === vars.accountId)
      const incomeIds = new Set((boot?.categories ?? []).filter((c) => c.isIncome).map((c) => c.id))
      insertTransaction(queryClient, {
        id: vars.tempId,
        accountId: vars.accountId,
        date: vars.date,
        label: ADJUSTMENT_LABEL,
        categoryId: vars.categoryId,
        amount: vars.delta,
        transferGroupId: null,
      })
      patchAccountBalances(queryClient, [{ accountId: vars.accountId, delta: vars.delta }])
      const inflow = account?.onBudget === true && vars.categoryId !== null && incomeIds.has(vars.categoryId)
      const rta = inflow ? patchInflow(queryClient, vars.date, vars.delta) : undefined
      // Compte budget sans categorie de revenus : l'ecart reste a categoriser.
      const counted = countsAsUncategorized(queryClient, { ...vars, transferGroupId: null })
      if (counted) patchUncategorizedCount(queryClient, 1)
      const closed = willClose(vars) && account !== undefined && account.closed !== true
      if (closed) patchAccountFields(queryClient, [vars.accountId], { closed: true })
      return { interrupted, rta, counted, closed }
    },
    onSuccess: (res, vars, ctx) => {
      mapTransactions(queryClient, (t) => (t.id === vars.tempId ? { ...t, id: res.id } : t))
      scheduleBudgetRefetch(queryClient)
      if (res.closeFailed && ctx?.closed) {
        const accountId = currentId(vars.accountId)
        patchAccountFields(queryClient, [vars.accountId, accountId], { closed: false })
        toast({
          id: closedToastId(vars.accountId),
          message: 'Clôture non enregistrée',
          description: 'Le solde est bien ajusté à 0 ; seule la clôture a échoué.',
          tone: 'danger',
          duration: 8000,
          action: { label: 'Réessayer', onClick: () => runAccountFlags(queryClient, { accountId, closed: true }) },
        })
      }
    },
    onError: (_err, vars, ctx) => {
      removeTransactions(queryClient, (t) => t.id !== vars.tempId)
      patchAccountBalances(queryClient, [{ accountId: currentId(vars.accountId), delta: -vars.delta }])
      unpatchBudgetRta(queryClient, ctx?.rta)
      if (ctx?.counted) patchUncategorizedCount(queryClient, -1)
      if (ctx?.closed) patchAccountFields(queryClient, [vars.accountId, currentId(vars.accountId)], { closed: false })
    },
    onSettled: (_d, _e, _v, ctx) => resumeInterrupted(queryClient, ctx?.interrupted),
  })
}

// --- Creer un compte ---------------------------------------------------------

export interface CreateAccountVars {
  name: string
  institution: string
  kind: AccountKind
  onBudget: boolean
  openingBalance: number
  openingDate: string
  tempId: string
  openingTxId: string
}

interface CreateContext extends WriteContext {
  rta?: Map<string, number>
}

/** Variables d'une creation (ids temporaires generes ici). */
export function newAccountVars(input: Omit<CreateAccountVars, 'tempId' | 'openingTxId'>): CreateAccountVars {
  return { ...input, tempId: newTempId(), openingTxId: newTempId() }
}

interface ApiTxLite {
  id: string
  accountId: string
  amount: number
  label?: string
}

/**
 * Retrouve l'id serveur du solde d'ouverture par une lecture BORNEE au mois
 * d'ouverture (quelques Ko) au lieu de recharger tout l'historique.
 */
async function findOpeningTransactionId(accountId: string, vars: CreateAccountVars): Promise<string | null> {
  const { transactions } = await apiCall<{ transactions: ApiTxLite[] }>('getTransactions', {
    month: monthOf(vars.openingDate),
  })
  const match = transactions.find(
    (t) =>
      t.accountId === accountId && t.amount === vars.openingBalance && (t.label ?? OPENING_LABEL) === OPENING_LABEL,
  )
  return match?.id ?? null
}

/** Appel reseau d'une creation (serialise), avec l'id serveur du solde d'ouverture. */
async function createAccountRemote(vars: CreateAccountVars): Promise<{ id: string; openingTxId: string | null }> {
  const { id } = await apiCreateAccount({
    name: vars.name,
    institution: vars.institution,
    kind: vars.kind,
    onBudget: vars.onBudget,
    openingBalance: vars.openingBalance,
    openingDate: vars.openingDate,
  })
  confirmId(vars.tempId, id)
  let openingTxId: string | null = null
  if (vars.openingBalance !== 0) {
    // Best-effort : sans elle, la ligne garde son id temporaire jusqu'a la
    // prochaine reconciliation (le compte, lui, est bien cree).
    openingTxId = await findOpeningTransactionId(id, vars).catch(() => null)
    if (openingTxId) confirmId(vars.openingTxId, openingTxId)
  }
  return { id, openingTxId }
}

/**
 * Insere un compte dans les caches comme le serveur le cree : compte et solde
 * (bootstrap), ligne « Solde d'ouverture » (transactions) et, sur un compte
 * budget, son revenu au Pret a assigner des mois en cache.
 */
function insertAccount(
  queryClient: QueryClient,
  vars: CreateAccountVars,
  ids: { accountId: string; openingTxId: string },
): Map<string, number> | undefined {
  const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
  const account: AccountWithBalance = {
    id: ids.accountId,
    name: vars.name,
    institution: vars.institution,
    kind: vars.kind,
    onBudget: vars.onBudget,
    openingBalance: 0,
    balance: vars.openingBalance,
    closed: false,
  }
  mapAccounts(queryClient, (accounts) =>
    accounts.some((a) => a.id === account.id) ? accounts : [...accounts, account],
  )
  if (vars.openingBalance === 0) return undefined
  const categoryId = vars.onBudget ? (openingIncomeCategory(boot?.categories ?? [])?.id ?? null) : null
  insertTransaction(queryClient, {
    id: ids.openingTxId,
    accountId: ids.accountId,
    date: vars.openingDate,
    label: OPENING_LABEL,
    categoryId,
    amount: vars.openingBalance,
    transferGroupId: null,
  })
  return categoryId ? patchInflow(queryClient, vars.openingDate, vars.openingBalance) : undefined
}

/**
 * Creation OPTIMISTE : le compte (et son solde d'ouverture) apparait
 * aussitot sous un id temporaire ; les actions sur ce compte attendent sa
 * creation dans la file (deps) puis partent avec l'id serveur.
 */
export function useCreateAccount() {
  const queryClient = useQueryClient()
  return useMutation<{ id: string; openingTxId: string | null }, Error, CreateAccountVars, CreateContext>({
    mutationFn: (vars) => enqueue(() => createAccountRemote(vars)),
    onMutate: async (vars) => {
      const interrupted = await pauseAll(queryClient, OPTIMISTIC_KEYS)
      const rta = insertAccount(queryClient, vars, { accountId: vars.tempId, openingTxId: vars.openingTxId })
      return { interrupted, rta }
    },
    onSuccess: ({ id, openingTxId }, vars) => {
      mapAccounts(queryClient, (accounts) =>
        accounts.some((a) => a.id === id)
          ? accounts.filter((a) => a.id !== vars.tempId)
          : accounts.map((a) => (a.id === vars.tempId ? { ...a, id } : a)),
      )
      mapTransactions(queryClient, (t) => {
        if (t.accountId !== vars.tempId && t.id !== vars.openingTxId) return t
        return {
          ...t,
          accountId: t.accountId === vars.tempId ? id : t.accountId,
          id: t.id === vars.openingTxId && openingTxId ? openingTxId : t.id,
        }
      })
      scheduleBudgetRefetch(queryClient)
    },
    onError: (_err, vars, ctx) => {
      mapAccounts(queryClient, (accounts) => accounts.filter((a) => a.id !== vars.tempId))
      removeTransactions(queryClient, (t) => t.accountId !== vars.tempId && t.id !== vars.openingTxId)
      unpatchBudgetRta(queryClient, ctx?.rta)
    },
    onSettled: (_d, _e, _v, ctx) => resumeInterrupted(queryClient, ctx?.interrupted),
  })
}

/**
 * Premier compte (onboarding) : creation CONFIRMEE avant affichage. Tant
 * qu'aucun compte n'existe, l'app montre l'onboarding ; un compte optimiste
 * ferait basculer l'interface avant que le serveur l'ait accepte. Au succes,
 * les caches recoivent le compte sans relire tout l'historique. L'erreur
 * s'affiche dans le formulaire (pas de toast global).
 */
export function useCreateFirstAccount(options: { onCreated?: () => void } = {}) {
  const queryClient = useQueryClient()
  const { onCreated } = options
  return useMutation<{ id: string; openingTxId: string | null }, Error, CreateAccountVars>({
    meta: { errorToast: false },
    mutationFn: (vars) => enqueue(() => createAccountRemote(vars)),
    // Rappel au niveau des options : il s'execute meme si l'onboarding est
    // deja demonte (l'app bascule des que le compte est en cache).
    onSuccess: ({ id, openingTxId }, vars) => {
      insertAccount(queryClient, vars, { accountId: id, openingTxId: openingTxId ?? vars.openingTxId })
      scheduleBudgetRefetch(queryClient)
      onCreated?.()
    },
  })
}

// --- Modifier (nom, etablissement, type) --------------------------------------

export interface UpdateAccountVars {
  accountId: string
  name: string
  institution: string
  kind: AccountKind
}

interface UpdateContext extends WriteContext {
  previous?: Pick<AccountWithBalance, 'name' | 'institution' | 'kind'>
}

/** Edition instantanee des metadonnees : rien a relire, le cache est exact. */
export function useUpdateAccount() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, UpdateAccountVars, UpdateContext>({
    mutationFn: (vars) =>
      enqueue(
        () =>
          apiPatchAccount({
            accountId: resolveId(vars.accountId),
            name: vars.name,
            institution: vars.institution,
            kind: vars.kind,
          }),
        { deps: [vars.accountId] },
      ),
    onMutate: async (vars) => {
      const interrupted = await pauseAll(queryClient, [BOOTSTRAP_KEY])
      const account = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)?.accounts.find((a) => a.id === vars.accountId)
      const previous = account
        ? { name: account.name, institution: account.institution, kind: account.kind }
        : undefined
      patchAccountFields(queryClient, [vars.accountId], {
        name: vars.name,
        institution: vars.institution,
        kind: vars.kind,
      })
      return { interrupted, previous }
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) patchAccountFields(queryClient, [vars.accountId, currentId(vars.accountId)], ctx.previous)
    },
    onSettled: (_d, _e, _v, ctx) => resumeInterrupted(queryClient, ctx?.interrupted),
  })
}

// --- Supprimer -----------------------------------------------------------------

interface DeleteContext extends WriteContext {
  account?: AccountWithBalance
  index?: number
  own?: Transaction[]
  mirrors?: { id: string; transferGroupId: string }[]
  countDelta?: number
}

/**
 * Suppression (irreversible, confirmee par l'appelant) : le compte et ses
 * transactions disparaissent tout de suite, les moities de virement situees
 * sur d'autres comptes sont deliees (comme le serveur). Le budget, qui change
 * en profondeur, est relu en fond apres confirmation serveur.
 */
export function useDeleteAccount() {
  const queryClient = useQueryClient()
  return useMutation<{ deleted: number }, Error, { accountId: string }, DeleteContext>({
    mutationFn: ({ accountId }) => enqueue(() => apiDeleteAccount(resolveId(accountId)), { deps: [accountId] }),
    onMutate: async ({ accountId }) => {
      const interrupted = await pauseAll(queryClient, OPTIMISTIC_KEYS)
      const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
      const txs = queryClient.getQueryData<Transaction[]>(TRANSACTIONS_KEY) ?? []
      const index = boot?.accounts.findIndex((a) => a.id === accountId) ?? -1
      const account = index >= 0 ? boot?.accounts[index] : undefined
      const own = txs.filter((t) => t.accountId === accountId)
      const groups = new Set(own.map((t) => t.transferGroupId).filter((g): g is string => !!g))
      const mirrors = txs
        .filter((t) => t.accountId !== accountId && t.transferGroupId && groups.has(t.transferGroupId))
        .map((t) => ({ id: t.id, transferGroupId: t.transferGroupId! }))

      // Badge : lignes du compte qui sortent, miroirs delies qui deviennent
      // des transactions ordinaires (a categoriser s'ils n'ont pas de categorie).
      const mirrorIds = new Set(mirrors.map((m) => m.id))
      let countDelta = 0
      const view = viewFromCaches(queryClient)
      if (view && account) {
        const onBudgetIds = new Set(view.accounts.filter((a) => a.onBudget).map((a) => a.id))
        const current = currentMonth()
        const before = uncategorizedCountOf(view, onBudgetIds, current)
        const afterView: BudgetView = {
          ...view,
          accounts: view.accounts.filter((a) => a.id !== accountId),
          transactions: view.transactions
            .filter((t) => t.accountId !== accountId)
            .map((t) => (mirrorIds.has(t.id) ? { ...t, transferGroupId: null } : t)),
        }
        onBudgetIds.delete(accountId)
        countDelta = uncategorizedCountOf(afterView, onBudgetIds, current) - before
      }

      mapAccounts(queryClient, (accounts) => accounts.filter((a) => a.id !== accountId))
      queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, (old) =>
        old
          ?.filter((t) => t.accountId !== accountId)
          .map((t) => (mirrorIds.has(t.id) ? { ...t, transferGroupId: null } : t)),
      )
      patchUncategorizedCount(queryClient, countDelta)
      return { interrupted, account, index, own, mirrors, countDelta }
    },
    onSuccess: () => scheduleBudgetRefetch(queryClient),
    onError: (err, _vars, ctx) => {
      // Compte jamais cree (creation amont en echec) : rien a restaurer.
      if (isOrphaned(err) || !ctx?.account) return
      const account = { ...ctx.account, id: currentId(ctx.account.id) }
      mapAccounts(queryClient, (accounts) => {
        if (accounts.some((a) => a.id === account.id)) return accounts
        const next = accounts.slice()
        next.splice(Math.min(ctx.index ?? next.length, next.length), 0, account)
        return next
      })
      const relink = new Map((ctx.mirrors ?? []).map((m) => [m.id, m.transferGroupId]))
      queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, (old) => {
        if (!old) return old
        const present = new Set(old.map((t) => t.id))
        const restored = (ctx.own ?? []).filter((t) => !present.has(t.id)).map((t) => ({ ...t, accountId: account.id }))
        return [
          ...old.map((t) => (relink.has(t.id) ? { ...t, transferGroupId: relink.get(t.id)! } : t)),
          ...restored,
        ].sort(byDateDesc)
      })
      patchUncategorizedCount(queryClient, -(ctx.countDelta ?? 0))
    },
    onSettled: (_d, _e, _v, ctx) => resumeInterrupted(queryClient, ctx?.interrupted),
  })
}

// --- Inclure dans le budget / cloturer (fonctionnalite accountFlags) ---------

export interface AccountFlagsVars {
  accountId: string
  onBudget?: boolean
  closed?: boolean
}

interface FlagsContext extends WriteContext {
  previous?: { onBudget: boolean; closed: boolean }
  rta?: Map<string, number>
  countDelta?: number
}

/**
 * Bascule budget <-> suivi et cloture / reouverture. Le compte change de
 * section tout de suite ; le Pret a assigner (part revenus) et le badge sont
 * patches, puis budget, soldes et badge sont relus de facon ciblee : la
 * bascule touche tout le budget. Reservee aux serveurs qui annoncent
 * accountFlags (les appelants masquent les controles sinon).
 */
function flagsMutationOptions(
  queryClient: QueryClient,
): UseMutationOptions<void, Error, AccountFlagsVars, FlagsContext> {
  return {
    mutationFn: async (vars) => {
      // Garde : un serveur ancien ignorerait silencieusement ces champs.
      if (!hasServerFeature(queryClient, 'accountFlags')) throw new Error('fonctionnalite accountFlags indisponible')
      return enqueue(
        () => apiPatchAccount({ accountId: resolveId(vars.accountId), onBudget: vars.onBudget, closed: vars.closed }),
        { deps: [vars.accountId] },
      )
    },
    onMutate: async (vars) => {
      const interrupted = await pauseAll(queryClient, OPTIMISTIC_KEYS)
      const account = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)?.accounts.find((a) => a.id === vars.accountId)
      if (!account) return { interrupted }
      const previous = { onBudget: account.onBudget, closed: account.closed === true }
      let rta: Map<string, number> | undefined
      let countDelta = 0
      if (vars.onBudget !== undefined && vars.onBudget !== account.onBudget) {
        const view = viewFromCaches(queryClient)
        if (view) {
          const { before, after } = onBudgetSets(view, vars.accountId, vars.onBudget)
          const curveBefore = inflowCurve(view, before)
          const curveAfter = inflowCurve(view, after)
          rta = patchBudgetRta(queryClient, (month) => curveAfter(month) - curveBefore(month))
          const current = currentMonth()
          countDelta = uncategorizedCountOf(view, after, current) - uncategorizedCountOf(view, before, current)
          patchUncategorizedCount(queryClient, countDelta)
        }
      }
      patchAccountFields(queryClient, [vars.accountId], {
        ...(vars.onBudget !== undefined ? { onBudget: vars.onBudget } : {}),
        ...(vars.closed !== undefined ? { closed: vars.closed } : {}),
      })
      return { interrupted, previous, rta, countDelta }
    },
    onSuccess: () => scheduleBudgetRefetch(queryClient),
    onError: (_err, vars, ctx) => {
      if (ctx?.previous) patchAccountFields(queryClient, [vars.accountId, currentId(vars.accountId)], ctx.previous)
      unpatchBudgetRta(queryClient, ctx?.rta)
      if (ctx?.countDelta) patchUncategorizedCount(queryClient, -ctx.countDelta)
    },
    onSettled: (_d, _e, _v, ctx) => resumeInterrupted(queryClient, ctx?.interrupted),
  }
}

export function useSetAccountFlags() {
  const queryClient = useQueryClient()
  return useMutation(flagsMutationOptions(queryClient))
}

/**
 * Meme mutation, lancee hors composant (action d'un toast) : elle passe par
 * le MutationCache comme les autres (retours d'erreur, reprise hors ligne).
 */
function runAccountFlags(queryClient: QueryClient, vars: AccountFlagsVars): void {
  void queryClient
    .getMutationCache()
    .build(queryClient, flagsMutationOptions(queryClient))
    .execute(vars)
    .catch(() => undefined)
}
