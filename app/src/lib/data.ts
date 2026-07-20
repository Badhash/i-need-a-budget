// Couche de donnees reelle : consomme l'Edge Function /api (via apiCall) et
// remplace les mocks. La taxonomie (comptes, groupes, categories avec de vrais
// UUID) provient de l'action bootstrap ; les composants la lisent via les
// selecteurs ci-dessous. Tous les montants sont en centimes.

import { useMemo } from 'react'
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query'
import { apiCall } from '@/lib/api'
import type {
  Account,
  AccountKind,
  Category,
  CategoryGroup,
  GroupIcon,
  Transaction,
} from '@/types/domain'
import type { CatColor } from '@/styles/themes'
import type { BudgetMonth, BudgetGroupBlock, BudgetRow } from '@/lib/budget'
import type { ReportsData } from '@/lib/reports'
import { monthOf, TODAY } from '@/lib/format'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AccountWithBalance extends Account {
  balance: number
}

interface NewTransactionInput {
  accountId: string
  date: string
  label: string
  categoryId: string | null
  amount: number // centimes signes
  note?: string
}

/** Forme brute renvoyee par l'action bootstrap. */
interface BootstrapAccount {
  id: string
  name: string
  institution: string
  kind: AccountKind
  onBudget: boolean
  closed: boolean
  connectionId: string | null
  providerAccountUid: string | null
  balance: number
}

interface BootstrapGroup {
  id: string
  name: string
  color: string
  icon: string
  sortOrder: number
  hidden: boolean
}

interface BootstrapCategory {
  id: string
  groupId: string
  name: string
  isIncome: boolean
  sortOrder: number
  hidden: boolean
}

interface BootstrapResponse {
  accounts: BootstrapAccount[]
  groups: BootstrapGroup[]
  categories: BootstrapCategory[]
  uncategorizedCount: number
}

/** Taxonomie hydratee (objets du domaine, prets pour l'UI). */
export interface Bootstrap {
  accounts: AccountWithBalance[]
  groups: CategoryGroup[]
  categories: Category[]
  uncategorizedCount: number
}

// Forme plate renvoyee par getBudgetMonth (sortie du moteur).
interface FlatCategoryMonth {
  categoryId: string
  rollover: number
  assigned: number
  activity: number
  available: number
}
interface FlatBudgetMonth {
  month: string
  readyToAssign: number
  categories: FlatCategoryMonth[]
  totals: { assigned: number; activity: number; available: number }
}

// Transaction telle que servie par /api (avant mapping vers le type UI).
interface ApiTransaction {
  id: string
  accountId: string
  categoryId: string | null
  bookingDate: string
  bookingMonth: string
  amount: number
  counterparty?: string | null
  transferGroupId?: string | null
  notes?: string | null
  label: string
}

// ---------------------------------------------------------------------------
// Hydratation de la taxonomie
// ---------------------------------------------------------------------------

function hydrateBootstrap(raw: BootstrapResponse): Bootstrap {
  return {
    accounts: raw.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      institution: a.institution,
      kind: a.kind,
      onBudget: a.onBudget,
      openingBalance: 0,
      balance: a.balance,
    })),
    groups: raw.groups.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color as CatColor,
      icon: g.icon as GroupIcon,
      sortOrder: g.sortOrder,
    })),
    categories: raw.categories.map((c) => ({
      id: c.id,
      groupId: c.groupId,
      name: c.name,
      isIncome: c.isIncome,
      sortOrder: c.sortOrder,
    })),
    uncategorizedCount: raw.uncategorizedCount,
  }
}

export async function fetchBootstrap(): Promise<Bootstrap> {
  const raw = await apiCall<BootstrapResponse>('bootstrap')
  return hydrateBootstrap(raw)
}

export const BOOTSTRAP_KEY = ['bootstrap'] as const

export function useBootstrap(): UseQueryResult<Bootstrap> {
  return useQuery({ queryKey: BOOTSTRAP_KEY, queryFn: fetchBootstrap })
}

// Selecteurs derives (partagent la meme query que bootstrap : pas de refetch).
export function useAccountsList(): AccountWithBalance[] {
  return useQuery({ queryKey: BOOTSTRAP_KEY, queryFn: fetchBootstrap, select: (b) => b.accounts })
    .data ?? []
}

export function useCategoriesList(): Category[] {
  return useQuery({ queryKey: BOOTSTRAP_KEY, queryFn: fetchBootstrap, select: (b) => b.categories })
    .data ?? []
}

export function useGroupsList(): CategoryGroup[] {
  return useQuery({ queryKey: BOOTSTRAP_KEY, queryFn: fetchBootstrap, select: (b) => b.groups }).data ?? []
}

// Les selecteurs ci-dessous partagent la meme query que bootstrap : tant que la
// donnee ne change pas, la liste source garde la meme reference, donc le useMemo
// ne reconstruit la Map qu'apres un vrai refetch (et non a chaque render).
export function useAccountsMap(): Map<string, AccountWithBalance> {
  const list = useAccountsList()
  return useMemo(() => new Map(list.map((a) => [a.id, a])), [list])
}

export function useCategoriesMap(): Map<string, Category> {
  const list = useCategoriesList()
  return useMemo(() => new Map(list.map((c) => [c.id, c])), [list])
}

export function useGroupsMap(): Map<string, CategoryGroup> {
  const list = useGroupsList()
  return useMemo(() => new Map(list.map((g) => [g.id, g])), [list])
}

// ---------------------------------------------------------------------------
// Adaptateur budget : forme plate (moteur) -> forme groupee attendue par l'UI
// ---------------------------------------------------------------------------

function adaptBudget(flat: FlatBudgetMonth, taxo: Bootstrap): BudgetMonth {
  const byCat = new Map(flat.categories.map((r) => [r.categoryId, r]))
  const groupById = new Map(taxo.groups.map((g) => [g.id, g]))

  // Categories hors revenus, regroupees par groupe.
  const envelopeCats = taxo.categories.filter((c) => !c.isIncome)
  const catsByGroup = new Map<string, Category[]>()
  for (const cat of envelopeCats) {
    const list = catsByGroup.get(cat.groupId) ?? []
    list.push(cat)
    catsByGroup.set(cat.groupId, list)
  }

  const groups: BudgetGroupBlock[] = [...catsByGroup.entries()]
    .map(([groupId, cats]) => ({ group: groupById.get(groupId), cats }))
    .filter((e): e is { group: CategoryGroup; cats: Category[] } => e.group !== undefined)
    .sort((a, b) => a.group.sortOrder - b.group.sortOrder)
    .map(({ group, cats }) => {
      const rows: BudgetRow[] = cats
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((category) => {
          const r = byCat.get(category.id)
          return {
            category,
            assigned: r?.assigned ?? 0,
            activity: r?.activity ?? 0,
            available: r?.available ?? 0,
          }
        })
      return {
        group,
        rows,
        totals: {
          assigned: rows.reduce((s, r) => s + r.assigned, 0),
          activity: rows.reduce((s, r) => s + r.activity, 0),
          available: rows.reduce((s, r) => s + r.available, 0),
        },
      }
    })

  return {
    month: flat.month,
    rta: flat.readyToAssign,
    groups,
    totals: {
      assigned: groups.reduce((s, g) => s + g.totals.assigned, 0),
      activity: groups.reduce((s, g) => s + g.totals.activity, 0),
      available: groups.reduce((s, g) => s + g.totals.available, 0),
    },
  }
}

// ---------------------------------------------------------------------------
// Hooks de lecture
// ---------------------------------------------------------------------------

/** Cle de query du budget d'un mois (partagee hook + prefetch). */
export const budgetKey = (month: string) => ['budget', month] as const

/**
 * Charge le budget d'un mois. La taxonomie (bootstrap) est requise pour adapter
 * la forme plate du moteur en forme groupee : hook et prefetch passent la meme
 * instance deja en cache, aucune logique dupliquee.
 */
export async function fetchBudgetMonth(month: string, taxo: Bootstrap): Promise<BudgetMonth> {
  const flat = await apiCall<FlatBudgetMonth>('getBudgetMonth', { month })
  return adaptBudget(flat, taxo)
}

export function useBudgetMonth(month: string): UseQueryResult<BudgetMonth> {
  const boot = useBootstrap()
  return useQuery({
    queryKey: budgetKey(month),
    enabled: boot.data !== undefined,
    queryFn: () => fetchBudgetMonth(month, boot.data!),
  })
}

function toTransaction(t: ApiTransaction): Transaction {
  return {
    id: t.id,
    accountId: t.accountId,
    date: t.bookingDate,
    label: t.label,
    categoryId: t.categoryId,
    amount: t.amount,
    transferGroupId: t.transferGroupId ?? null,
    note: t.notes ?? undefined,
  }
}

export const TRANSACTIONS_KEY = ['transactions'] as const

export async function fetchTransactions(): Promise<Transaction[]> {
  const { transactions } = await apiCall<{ transactions: ApiTransaction[] }>('listTransactions')
  return transactions.map(toTransaction)
}

export function useTransactions(): UseQueryResult<Transaction[]> {
  return useQuery({ queryKey: TRANSACTIONS_KEY, queryFn: fetchTransactions })
}

export function useAccounts(): UseQueryResult<AccountWithBalance[]> {
  return useQuery({ queryKey: BOOTSTRAP_KEY, queryFn: fetchBootstrap, select: (b) => b.accounts })
}

export const reportsKey = (month: string) => ['reports', month] as const

function fetchReports(month: string): Promise<ReportsData> {
  return apiCall<ReportsData>('getReports', { month })
}

// ---------------------------------------------------------------------------
// Demarrage consolide : un seul appel /api (bootstrapFull) qui derive taxonomie,
// budget du mois, transactions et rapports d'un UNIQUE chargement serveur des
// transactions. Evite le double/triple chargement de la table au lancement.
// ---------------------------------------------------------------------------

interface BootstrapFullResponse {
  bootstrap: BootstrapResponse
  budget: FlatBudgetMonth
  transactions: ApiTransaction[]
  reports: ReportsData
}

/** Donnees de demarrage hydratees, pretes a peupler les caches TanStack. */
export interface BootstrapFull {
  bootstrap: Bootstrap
  budget: BudgetMonth
  transactions: Transaction[]
  reports: ReportsData
}

export async function fetchBootstrapFull(month: string): Promise<BootstrapFull> {
  const raw = await apiCall<BootstrapFullResponse>('bootstrapFull', { month })
  const bootstrap = hydrateBootstrap(raw.bootstrap)
  return {
    bootstrap,
    budget: adaptBudget(raw.budget, bootstrap),
    transactions: raw.transactions.map(toTransaction),
    reports: raw.reports,
  }
}

export function useReports(month: string): UseQueryResult<ReportsData> {
  return useQuery({
    queryKey: reportsKey(month),
    queryFn: () => fetchReports(month),
  })
}

// ---------------------------------------------------------------------------
// Mutations (appelees inline par les pages)
// ---------------------------------------------------------------------------

export async function apiSetAssigned(input: {
  categoryId: string
  month: string
  amount: number
}): Promise<void> {
  await apiCall('setAssigned', input)
}

export async function apiCategorize(txId: string, categoryId: string | null): Promise<void> {
  await apiCall('categorizeTransaction', { transactionId: txId, categoryId })
}

export async function apiAddTransaction(input: NewTransactionInput): Promise<{ id: string }> {
  return apiCall<{ id: string }>('addTransaction', {
    accountId: input.accountId,
    date: input.date,
    label: input.label,
    categoryId: input.categoryId,
    amount: input.amount,
    notes: input.note,
  })
}

export interface UpdateTransactionInput {
  transactionId: string
  accountId: string
  date: string
  label: string
  categoryId: string | null
  amount: number // centimes signes
  note?: string | null
}

export async function apiUpdateTransaction(input: UpdateTransactionInput): Promise<void> {
  await apiCall('updateTransaction', {
    transactionId: input.transactionId,
    accountId: input.accountId,
    date: input.date,
    label: input.label,
    categoryId: input.categoryId,
    amount: input.amount,
    notes: input.note ?? null,
  })
}

interface CreateAccountInput {
  name: string
  institution: string
  kind: AccountKind
  onBudget: boolean
  openingBalance: number
  openingDate: string
}

export async function apiCreateAccount(input: CreateAccountInput): Promise<{ id: string }> {
  return apiCall<{ id: string }>('createAccount', { ...input })
}

interface UpdateAccountInput {
  accountId: string
  name: string
  institution: string
  kind: AccountKind
}

/** Edite les metadonnees d'un compte (nom, etablissement, type). */
export async function apiUpdateAccount(input: UpdateAccountInput): Promise<void> {
  await apiCall('updateAccount', { ...input })
}

/** Supprime un compte et TOUTES ses transactions (les miroirs de transferts
 * sur les autres comptes sont delies, pas supprimes). Irreversible. */
export async function apiDeleteAccount(accountId: string): Promise<{ deleted: number }> {
  return apiCall<{ deleted: number }>('deleteAccount', { accountId })
}

export async function apiSeedDefaults(): Promise<void> {
  await apiCall('seedDefaults')
}

/** Nombre de transactions non categorisees (hors transferts) jusqu'a aujourd'hui. */
export function uncategorizedCount(list: Transaction[]): number {
  return list.filter(
    (t) => !t.categoryId && !t.transferGroupId && monthOf(t.date) <= monthOf(TODAY),
  ).length
}

/**
 * True si une transaction compte dans le badge « À catégoriser » : sans
 * categorie, hors transfert, et pas dans le futur (meme regle que le serveur,
 * cf. buildBootstrap dans l'Edge Function /api).
 */
export function countsAsUncategorized(
  categoryId: string | null,
  transferGroupId: string | null | undefined,
  date: string,
): boolean {
  return !categoryId && !transferGroupId && monthOf(date) <= monthOf(TODAY)
}

/**
 * Ajuste de facon OPTIMISTE le compteur « À catégoriser » porte par le cache
 * bootstrap. Le badge de la nav lit ce compteur (deja calcule serveur) au lieu
 * de charger toute la liste des transactions : sans ce patch, il ne bougerait
 * qu'a la prochaine reconciliation (fenetre de silence Realtime de 30s).
 */
export function patchUncategorizedCount(queryClient: QueryClient, delta: number): void {
  if (delta === 0) return
  queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) =>
    old ? { ...old, uncategorizedCount: Math.max(0, old.uncategorizedCount + delta) } : old,
  )
}
