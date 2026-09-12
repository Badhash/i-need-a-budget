// Categorisation en lot (toast « Appliquer aux N autres », selection multiple
// mobile) : optimiste ligne par ligne via applyCategorizeOptimistic, puis UN
// seul appel reseau categorizeMany. Rollback complet en cas d'echec.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { Transaction } from '@/types/domain'
import { apiCategorizeMany, patchUncategorizedCount } from '@/lib/data'
import { applyCategorizeOptimistic } from '@/lib/categorize'
import { enqueue, resolveId } from '@/lib/mutationQueue'

export interface CategorizeManyVars {
  txIds: string[]
  categoryId: string | null
}

// Limite serveur : au-dela, on tronque (le cache optimiste suit la meme borne).
const MAX_IDS = 200

export function useCategorizeMany() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ txIds, categoryId }: CategorizeManyVars) =>
      enqueue(
        () =>
          apiCategorizeMany(
            txIds.slice(0, MAX_IDS),
            categoryId === null ? null : resolveId(categoryId),
          ),
        { deps: categoryId === null ? [] : [categoryId] },
      ),
    onMutate: async ({ txIds, categoryId }) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] })
      const snapshot = queryClient.getQueryData<Transaction[]>(['transactions'])
      let countDelta = 0
      for (const txId of txIds.slice(0, MAX_IDS)) {
        countDelta += applyCategorizeOptimistic(queryClient, { txId, categoryId }).countDelta
      }
      return { snapshot, countDelta }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['transactions'], ctx.snapshot)
      if (ctx?.countDelta) patchUncategorizedCount(queryClient, -ctx.countDelta)
    },
    // Pas d'invalidation directe : le cache est deja exact, la reconciliation
    // passe par le signal Realtime coalesce (cf. useRealtimeSync).
  })
}
