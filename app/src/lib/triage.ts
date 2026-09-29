// Tri rapide (page /trier) : suggestions de categories pour la transaction en
// cours, adaptees au sens du montant. Sorties : memoire de tiers, dernier choix
// de la session, categorie recente puis frequente (hors revenus). Entrees
// d'argent : memoire de tiers, categories deja utilisees pour des entrees
// (revenus compris), puis les categories de revenus. Jamais de categorie ou de
// groupe masque. Tout vient du cache TanStack : aucune lecture reseau.

import { useMemo } from 'react'
import type { Category, CategoryGroup, Transaction } from '@/types/domain'
import { useBootstrap, type PayeeDefault } from '@/lib/data'
import { useTransactions } from '@/lib/queries'
import { payeeKeyOf } from '@/lib/ruleInsights'

export type TriageReason = 'payee' | 'session' | 'recent' | 'frequent' | 'income' | 'inflow'

export interface TriageSuggestion {
  categoryId: string
  reason: TriageReason
}

export const TRIAGE_REASON_LABELS: Record<TriageReason, string> = {
  payee: 'Mémorisée pour ce tiers',
  session: 'Ton dernier choix',
  recent: 'Utilisée récemment',
  frequent: 'Souvent utilisée',
  income: 'Va au Prêt à assigner',
  inflow: 'Déjà utilisée pour des entrées',
}

export const MAX_TRIAGE_SUGGESTIONS = 4
const OUTFLOW_DAYS = 90
const INFLOW_DAYS = 365

interface UsageStats {
  /** Categorie de la sortie categorisee la plus recente (90 j). */
  recentOutflow: string | null
  /** Categories des sorties (90 j), par frequence decroissante. */
  outflow: string[]
  /** Categories des entrees (365 j), par frequence decroissante. */
  inflow: string[]
}

const statsCache = new WeakMap<readonly Transaction[], UsageStats>()

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
}

function ranked(counts: Map<string, number>): string[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
}

// Une passe sur le cache par reference de liste (memorisee) : la file de tri
// change de carte sans recompter.
function usageStats(transactions: readonly Transaction[]): UsageStats {
  const cached = statsCache.get(transactions)
  if (cached) return cached
  const outCutoff = isoDaysAgo(OUTFLOW_DAYS)
  const inCutoff = isoDaysAgo(INFLOW_DAYS)
  const outCounts = new Map<string, number>()
  const inCounts = new Map<string, number>()
  let recentOutflow: string | null = null
  let recentDate = ''
  for (const t of transactions) {
    if (!t.categoryId) continue
    if (t.amount < 0) {
      if (t.date < outCutoff) continue
      outCounts.set(t.categoryId, (outCounts.get(t.categoryId) ?? 0) + 1)
      if (t.date > recentDate) {
        recentDate = t.date
        recentOutflow = t.categoryId
      }
    } else if (t.amount > 0 && t.date >= inCutoff) {
      inCounts.set(t.categoryId, (inCounts.get(t.categoryId) ?? 0) + 1)
    }
  }
  const stats = { recentOutflow, outflow: ranked(outCounts), inflow: ranked(inCounts) }
  statsCache.set(transactions, stats)
  return stats
}

/** Calcul pur des suggestions (exporte pour rester testable a la main). */
export function computeTriageSuggestions(input: {
  tx: Transaction
  transactions: readonly Transaction[]
  categories: readonly Category[]
  groups: readonly CategoryGroup[]
  payees: readonly PayeeDefault[]
  /** Categories choisies pendant la session, la plus recente en tete. */
  sessionPicks: readonly string[]
}): TriageSuggestion[] {
  const { tx } = input
  const inflow = tx.amount > 0
  const hiddenGroups = new Set(input.groups.filter((g) => g.hidden).map((g) => g.id))
  const knownGroups = new Set(input.groups.map((g) => g.id))
  const usable = new Map(
    input.categories
      .filter((c) => !c.hidden && knownGroups.has(c.groupId) && !hiddenGroups.has(c.groupId))
      .map((c) => [c.id, c]),
  )
  const out: TriageSuggestion[] = []
  const seen = new Set<string>()
  const push = (categoryId: string | null | undefined, reason: TriageReason) => {
    if (out.length >= MAX_TRIAGE_SUGGESTIONS || !categoryId || seen.has(categoryId)) return
    const category = usable.get(categoryId)
    // Sorties : jamais de revenus. Entrees : tout, revenus compris.
    if (!category || (!inflow && category.isIncome)) return
    seen.add(categoryId)
    out.push({ categoryId, reason })
  }

  const key = payeeKeyOf(tx)
  if (key) push(input.payees.find((p) => p.key === key)?.categoryId, 'payee')

  const stats = usageStats(input.transactions)
  if (inflow) {
    for (const id of stats.inflow) push(id, usable.get(id)?.isIncome ? 'income' : 'inflow')
    const income = [...usable.values()]
      .filter((c) => c.isIncome)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    for (const c of income) push(c.id, 'income')
    for (const id of input.sessionPicks) push(id, 'session')
    for (const id of stats.outflow) push(id, 'frequent')
  } else {
    for (const id of input.sessionPicks.slice(0, 1)) push(id, 'session')
    push(stats.recentOutflow, 'recent')
    for (const id of stats.outflow) push(id, 'frequent')
  }
  return out
}

export function useTriageSuggestions(tx: Transaction | null, sessionPicks: readonly string[]): TriageSuggestion[] {
  const boot = useBootstrap().data
  const { data: transactions } = useTransactions()
  return useMemo(() => {
    if (!tx || !boot || !transactions) return []
    return computeTriageSuggestions({
      tx,
      transactions,
      categories: boot.categories,
      groups: boot.groups,
      payees: boot.payees,
      sessionPicks,
    })
  }, [tx, boot, transactions, sessionPicks])
}
