// Categorisation des transactions : mutation optimiste partagee (page
// Transactions, mode Tri rapide, dialogues) et suggestions de categories
// (memoire de tiers calculee serveur + usage recent lu dans le cache).
// Aucune lecture reseau supplementaire : tout vient du cache TanStack.

import { useMemo } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Transaction } from '@/types/domain'
import {
  apiCategorize,
  countsAsUncategorized,
  patchUncategorizedCount,
  useBootstrap,
  useCategoriesList,
} from '@/lib/data'
import { useTransactions } from '@/lib/queries'
import { enqueue, resolveId } from '@/lib/mutationQueue'
import { payeeKey } from '../../../packages/crypto/src/payee'

export { payeeKey }

export interface CategorizeVars {
  txId: string
  categoryId: string | null
}

/** Applique une categorisation en optimiste sur le cache (liste + badge). */
export function applyCategorizeOptimistic(queryClient: QueryClient, { txId, categoryId }: CategorizeVars) {
  const snapshot = queryClient.getQueryData<Transaction[]>(['transactions'])
  const prev = snapshot?.find((t) => t.id === txId)
  let countDelta = 0
  if (prev) {
    const before = countsAsUncategorized(queryClient, prev)
    const after = countsAsUncategorized(queryClient, { ...prev, categoryId })
    countDelta = (after ? 1 : 0) - (before ? 1 : 0)
    patchUncategorizedCount(queryClient, countDelta)
  }
  queryClient.setQueryData<Transaction[]>(['transactions'], (old) =>
    old?.map((t) => (t.id === txId ? { ...t, categoryId } : t)),
  )
  return { snapshot, countDelta }
}

// Categorisation optimiste : le cache TanStack est mis a jour immediatement,
// l'appel reseau part en arriere-plan, rollback discret en cas d'echec.
export function useCategorize() {
  const queryClient = useQueryClient()
  return useMutation({
    // Serialise derriere une eventuelle creation de categorie en vol : le
    // categoryId cible est resolu temp -> real avant l'envoi.
    mutationFn: ({ txId, categoryId }: CategorizeVars) =>
      enqueue(() => apiCategorize(txId, categoryId === null ? null : resolveId(categoryId)), {
        deps: categoryId === null ? [] : [categoryId],
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] })
      return applyCategorizeOptimistic(queryClient, vars)
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['transactions'], ctx.snapshot)
      if (ctx?.countDelta) patchUncategorizedCount(queryClient, -ctx.countDelta)
    },
    // Pas d'invalidation directe ici : le cache est deja exact (mise a jour
    // optimiste), et le signal Realtime declenche une reconciliation UNIQUE et
    // coalescee en fond (cf. useRealtimeSync + realtimeGate).
  })
}

export type SuggestionReason = 'payee' | 'recent' | 'frequent'

export interface CategorySuggestion {
  categoryId: string
  reason: SuggestionReason
}

const MAX_SUGGESTIONS = 4

/**
 * Suggestions pour un libelle : 1) la categorie memorisee pour ce tiers
 * (bootstrap.payees, calculee serveur), 2) les categories les plus utilisees
 * sur les 90 derniers jours (cache transactions), en excluant les revenus.
 * Ordre stable, sans doublon, au plus MAX_SUGGESTIONS.
 */
export function useCategorySuggestions(label: string | null | undefined): CategorySuggestion[] {
  const boot = useBootstrap().data
  const { data: txs } = useTransactions()
  const categories = useCategoriesList()
  const key = label ? payeeKey(label) : ''

  return useMemo(() => {
    const valid = new Set(categories.filter((c) => !c.isIncome).map((c) => c.id))
    const out: CategorySuggestion[] = []
    const seen = new Set<string>()
    const push = (categoryId: string | null | undefined, reason: SuggestionReason) => {
      if (!categoryId || seen.has(categoryId) || !valid.has(categoryId)) return
      seen.add(categoryId)
      out.push({ categoryId, reason })
    }

    if (key) push(boot?.payees.find((p) => p.key === key)?.categoryId, 'payee')

    if (txs) {
      const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
      const counts = new Map<string, number>()
      let recent: string | null = null
      let recentDate = ''
      for (const t of txs) {
        if (!t.categoryId || t.transferGroupId || t.date < cutoff) continue
        counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1)
        if (t.date > recentDate) {
          recentDate = t.date
          recent = t.categoryId
        }
      }
      push(recent, 'recent')
      for (const [id] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
        if (out.length >= MAX_SUGGESTIONS) break
        push(id, 'frequent')
      }
    }
    return out.slice(0, MAX_SUGGESTIONS)
  }, [boot?.payees, txs, categories, key])
}
