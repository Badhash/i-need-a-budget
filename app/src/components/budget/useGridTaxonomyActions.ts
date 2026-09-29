// Actions de taxonomie du menu de ligne de la grille desktop (renommer,
// deplacer vers un groupe, masquer, supprimer ; renommer / masquer un groupe).
// Chaque action passe par les hooks de lib/taxonomy.ts, qui appliquent le
// patch optimiste (bootstrap + budgets en cache) et le rollback. Seul le
// drapeau `hidden` est en plus pose ICI dans le cache bootstrap (la page filtre
// la grille sur ce drapeau) : la ligne quitte la grille instantanement quel
// que soit le patch de la taxonomie (redondant mais sans effet quand il pose
// la meme valeur), et il est remis en place si l'appel echoue. Les actions
// reversibles proposent « Annuler » dans un toast (meme identifiant que les
// toasts de la page : ils se remplacent au lieu de s'empiler).

import { useQueryClient, type QueryClient } from '@tanstack/react-query'
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

type Entity = { kind: 'category' | 'group'; id: string }

function patchHidden(queryClient: QueryClient, entity: Entity, hidden: boolean): void {
  queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => {
    if (!old) return old
    if (entity.kind === 'category') {
      return { ...old, categories: old.categories.map((c) => (c.id === entity.id ? { ...c, hidden } : c)) }
    }
    return { ...old, groups: old.groups.map((g) => (g.id === entity.id ? { ...g, hidden } : g)) }
  })
}

/** « Nom » avec les espaces insecables de la typographie francaise. */
const quoted = (name: string) => `« ${name} »`

export function useGridTaxonomyActions() {
  const queryClient = useQueryClient()
  const updateCategory = useUpdateCategoryMutation()
  const deleteCategory = useDeleteCategoryMutation()
  const updateGroup = useUpdateGroupMutation()
  const reorderCategories = useReorderCategoriesMutation()

  const setCategoryHidden = (categoryId: string, hidden: boolean) => {
    const entity: Entity = { kind: 'category', id: categoryId }
    patchHidden(queryClient, entity, hidden)
    updateCategory.mutate({ categoryId, hidden }, { onError: () => patchHidden(queryClient, entity, !hidden) })
  }

  const setGroupHidden = (groupId: string, hidden: boolean) => {
    const entity: Entity = { kind: 'group', id: groupId }
    patchHidden(queryClient, entity, hidden)
    updateGroup.mutate({ groupId, hidden }, { onError: () => patchHidden(queryClient, entity, !hidden) })
  }

  const renameCategory = (category: Category, name: string) => {
    updateCategory.mutate({ categoryId: category.id, name })
  }

  const hideCategory = (category: Category) => {
    setCategoryHidden(category.id, true)
    toast({
      id: `hidden-${category.id}`,
      message: `${quoted(category.name)} masquée`,
      description: 'Elle reste comptée dans le budget, en bas de la page.',
      action: { label: 'Annuler', onClick: () => setCategoryHidden(category.id, false) },
    })
  }

  // Deplacement vers un autre groupe : le serveur place l'enveloppe en fin de
  // groupe cible. « Annuler » la ramene puis restaure sa place d'origine (ordre
  // capture avant le deplacement, limite aux enveloppes encore dans le groupe).
  const moveCategoryToGroup = (category: Category, from: BudgetGroupBlock, to: CategoryGroup) => {
    const originalOrder = from.rows.map((r) => r.category.id)
    updateCategory.mutate({ categoryId: category.id, groupId: to.id })
    toast({
      id: `moved-${category.id}`,
      message: `${quoted(category.name)} déplacée dans ${quoted(to.name)}`,
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
    setGroupHidden(group.id, true)
    toast({
      id: `hidden-${group.id}`,
      message: `Groupe ${quoted(group.name)} masqué`,
      description: 'Ses enveloppes restent comptées dans le budget, en bas de la page.',
      action: { label: 'Annuler', onClick: () => setGroupHidden(group.id, false) },
    })
  }

  return { renameCategory, hideCategory, moveCategoryToGroup, removeCategory, renameGroup, hideGroup }
}
