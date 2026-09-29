// Actions de taxonomie du menu de ligne de la grille desktop (renommer,
// deplacer vers un groupe, masquer, supprimer ; renommer / masquer un groupe).
// Chaque action passe par les hooks de lib/taxonomy.ts, qui appliquent le
// patch optimiste (bootstrap + budgets en cache) et le rollback : la grille ne
// duplique aucun patch. Les actions reversibles proposent « Annuler » dans un
// toast (CLAUDE.md : un toast de confirmation offre l'annulation).

import { useQueryClient } from '@tanstack/react-query'
import type { BudgetGroupBlock } from '@/lib/budget'
import type { Category, CategoryGroup } from '@/types/domain'
import { BOOTSTRAP_KEY, type Bootstrap } from '@/lib/data'
import {
  useDeleteCategoryMutation,
  useReorderCategoriesMutation,
  useUpdateCategoryMutation,
  useUpdateGroupMutation,
} from '@/lib/taxonomy'
import { toast } from '@/lib/toast'

export function useGridTaxonomyActions() {
  const queryClient = useQueryClient()
  const updateCategory = useUpdateCategoryMutation()
  const deleteCategory = useDeleteCategoryMutation()
  const updateGroup = useUpdateGroupMutation()
  const reorderCategories = useReorderCategoriesMutation()

  const renameCategory = (category: Category, name: string) => {
    updateCategory.mutate({ categoryId: category.id, name })
  }

  const hideCategory = (category: Category) => {
    updateCategory.mutate({ categoryId: category.id, hidden: true })
    toast({
      id: `grid-hide-${category.id}`,
      message: `« ${category.name} » est masquée`,
      description: 'Son disponible reste compté dans le budget.',
      action: {
        label: 'Annuler',
        onClick: () => updateCategory.mutate({ categoryId: category.id, hidden: false }),
      },
    })
  }

  // Deplacement vers un autre groupe : le serveur place l'enveloppe en fin de
  // groupe cible. « Annuler » la ramene puis restaure sa place d'origine (ordre
  // capture avant le deplacement, limite aux enveloppes encore dans le groupe).
  const moveCategoryToGroup = (category: Category, from: BudgetGroupBlock, to: CategoryGroup) => {
    const originalOrder = from.rows.map((r) => r.category.id)
    updateCategory.mutate({ categoryId: category.id, groupId: to.id })
    toast({
      id: `grid-move-${category.id}`,
      message: `« ${category.name} » déplacée dans « ${to.name} »`,
      action: {
        label: 'Annuler',
        onClick: () => {
          updateCategory.mutate({ categoryId: category.id, groupId: from.group.id })
          const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
          const inGroup = new Set(
            (boot?.categories ?? []).filter((c) => c.groupId === from.group.id).map((c) => c.id),
          )
          inGroup.add(category.id)
          const orderedIds = originalOrder.filter((id) => inGroup.has(id))
          // Deja derniere : le retour en fin de groupe suffit.
          if (orderedIds.length > 1 && orderedIds[orderedIds.length - 1] !== category.id) {
            reorderCategories.mutate({ groupId: from.group.id, orderedIds })
          }
        },
      },
    })
  }

  const removeCategory = (category: Category) => {
    deleteCategory.mutate({ categoryId: category.id })
  }

  const renameGroup = (group: CategoryGroup, name: string) => {
    updateGroup.mutate({ groupId: group.id, name })
  }

  const hideGroup = (group: CategoryGroup) => {
    updateGroup.mutate({ groupId: group.id, hidden: true })
    toast({
      id: `grid-hide-group-${group.id}`,
      message: `Groupe « ${group.name} » masqué`,
      description: 'Ses enveloppes restent comptées dans le budget.',
      action: {
        label: 'Annuler',
        onClick: () => updateGroup.mutate({ groupId: group.id, hidden: false }),
      },
    })
  }

  return { renameCategory, hideCategory, moveCategoryToGroup, removeCategory, renameGroup, hideGroup }
}
