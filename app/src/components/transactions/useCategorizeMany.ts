// Categorisation en lot (toast « Appliquer aux N autres », selection multiple) :
// optimiste en une ecriture du cache (applyCategorizeManyOptimistic), puis UN
// seul appel reseau categorizeMany. Retour cible en cas d'echec : seules les
// categories posees par ce lot sont retirees.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiCategorizeMany } from '@/lib/data'
import {
  applyCategorizeManyOptimistic,
  revertCategorizeOptimistic,
  scheduleBudgetRefetch,
} from '@/lib/categorize'
import { enqueue, resolveId } from '@/lib/mutationQueue'

export interface CategorizeManyVars {
  txIds: string[]
  categoryId: string | null
}

// Limite serveur : au-dela, on tronque (le cache optimiste suit la meme borne).
export const CATEGORIZE_MANY_MAX = 200

export function useCategorizeMany() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ txIds, categoryId }: CategorizeManyVars) =>
      enqueue(
        () =>
          apiCategorizeMany(
            txIds.slice(0, CATEGORIZE_MANY_MAX).map(resolveId),
            categoryId === null ? null : resolveId(categoryId),
          ),
        { deps: categoryId === null ? [] : [categoryId] },
      ),
    onMutate: async ({ txIds, categoryId }) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] })
      return applyCategorizeManyOptimistic(queryClient, txIds.slice(0, CATEGORIZE_MANY_MAX), categoryId)
    },
    onError: (_err, _vars, contexts) => {
      if (contexts) revertCategorizeOptimistic(queryClient, contexts)
    },
    // Liste et badge deja exacts ; refetch cible et coalesce du budget.
    onSuccess: () => scheduleBudgetRefetch(queryClient),
  })
}
