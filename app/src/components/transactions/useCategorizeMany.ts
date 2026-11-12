// Categorisation en lot (toast « Appliquer aux N autres », selection multiple) :
// optimiste en une ecriture du cache (applyCategorizeManyOptimistic), puis UN
// seul appel reseau categorizeMany. Retour cible en cas d'echec : seules les
// categories posees par ce lot sont retirees.

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiCategorizeMany, BOOTSTRAP_KEY } from '@/lib/data'
import {
  applyCategorizeManyOptimistic,
  revertCategorizeOptimistic,
  scheduleBudgetRefetch,
} from '@/lib/categorize'
import { enqueue, resolveId } from '@/lib/mutationQueue'
import { followTxId } from '@/lib/txIds'
import { pauseReads } from '@/lib/pauseReads'

export interface CategorizeManyVars {
  txIds: string[]
  categoryId: string | null
}

// Limite serveur par appel. Au-dela, le lot part en plusieurs appels enchaines
// dans UNE tache de la file : il etait auparavant tronque en silence a 200
// alors que le toast annoncait le nombre demande.
export const CATEGORIZE_MANY_MAX = 200

export function useCategorizeMany() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ txIds, categoryId }: CategorizeManyVars) =>
      enqueue(
        async () => {
          // Ids resolus a l'execution (file) ; valeurs absolues, donc un rejeu
          // complet apres une coupure reseau est sans effet de bord.
          const ids = txIds.map((id) => resolveId(followTxId(id)))
          const category = categoryId === null ? null : resolveId(categoryId)
          let updated = 0
          for (let from = 0; from < ids.length; from += CATEGORIZE_MANY_MAX) {
            const res = await apiCategorizeMany(ids.slice(from, from + CATEGORIZE_MANY_MAX), category)
            updated += res.updated
          }
          return { ok: true as const, updated }
        },
        { deps: categoryId === null ? [] : [categoryId] },
      ),
    onMutate: async ({ txIds, categoryId }) => {
      await Promise.all([
        pauseReads(queryClient, ['transactions']),
        pauseReads(queryClient, BOOTSTRAP_KEY),
        pauseReads(queryClient, ['budget']),
      ])
      return applyCategorizeManyOptimistic(queryClient, txIds.map(followTxId), categoryId)
    },
    onError: (_err, _vars, contexts) => {
      if (contexts) revertCategorizeOptimistic(queryClient, contexts)
    },
    // Liste et badge deja exacts ; refetch cible et coalesce du budget.
    onSuccess: () => scheduleBudgetRefetch(queryClient, { bootstrap: false }),
  })
}
