// Masquer / afficher une enveloppe ou un groupe depuis la page Budget.
//
// Le filtrage de la page lit les drapeaux `hidden` du cache bootstrap
// (useCategoriesMap / useGroupsMap). On les patche ICI de facon optimiste en
// plus des mutations de taxonomie : la ligne quitte (ou rejoint) la grille
// instantanement, quel que soit le patch fait par lib/taxonomy.ts (redondant
// mais sans effet quand il pose la meme valeur). En cas d'echec, le drapeau
// est remis en place ; la relecture de bootstrap (onSettled de la taxonomie)
// ramene de toute facon la verite serveur.

import { useCallback } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { BOOTSTRAP_KEY, type Bootstrap } from '@/lib/data'
import { useUpdateCategoryMutation, useUpdateGroupMutation } from '@/lib/taxonomy'
import { toast } from '@/lib/toast'

type Entity = { kind: 'category'; id: string } | { kind: 'group'; id: string }

function patchHidden(queryClient: QueryClient, entity: Entity, hidden: boolean): void {
  queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => {
    if (!old) return old
    if (entity.kind === 'category') {
      return { ...old, categories: old.categories.map((c) => (c.id === entity.id ? { ...c, hidden } : c)) }
    }
    return { ...old, groups: old.groups.map((g) => (g.id === entity.id ? { ...g, hidden } : g)) }
  })
}

export function useEnvelopeVisibility() {
  const queryClient = useQueryClient()
  const updateCategory = useUpdateCategoryMutation()
  const updateGroup = useUpdateGroupMutation()
  const mutateCategory = updateCategory.mutate
  const mutateGroup = updateGroup.mutate

  const setCategoryHidden = useCallback(
    (categoryId: string, hidden: boolean) => {
      const entity: Entity = { kind: 'category', id: categoryId }
      patchHidden(queryClient, entity, hidden)
      mutateCategory({ categoryId, hidden }, { onError: () => patchHidden(queryClient, entity, !hidden) })
    },
    [queryClient, mutateCategory],
  )

  const setGroupHidden = useCallback(
    (groupId: string, hidden: boolean) => {
      const entity: Entity = { kind: 'group', id: groupId }
      patchHidden(queryClient, entity, hidden)
      mutateGroup({ groupId, hidden }, { onError: () => patchHidden(queryClient, entity, !hidden) })
    },
    [queryClient, mutateGroup],
  )

  /** Masque une enveloppe (toast avec « Annuler » pour la reafficher). */
  const hideCategory = useCallback(
    (categoryId: string, name: string) => {
      setCategoryHidden(categoryId, true)
      toast({
        id: `hidden-${categoryId}`,
        message: `«\u00a0${name}\u00a0» masquée`,
        description: 'Elle reste comptée dans le budget, en bas de la page.',
        action: { label: 'Annuler', onClick: () => setCategoryHidden(categoryId, false) },
      })
    },
    [setCategoryHidden],
  )

  const showCategory = useCallback(
    (categoryId: string, name: string) => {
      setCategoryHidden(categoryId, false)
      toast({ id: `hidden-${categoryId}`, message: `«\u00a0${name}\u00a0» de nouveau affichée`, tone: 'success', duration: 3000 })
    },
    [setCategoryHidden],
  )

  const showGroup = useCallback(
    (groupId: string, name: string) => {
      setGroupHidden(groupId, false)
      toast({ id: `hidden-${groupId}`, message: `Groupe «\u00a0${name}\u00a0» de nouveau affiché`, tone: 'success', duration: 3000 })
    },
    [setGroupHidden],
  )

  return { hideCategory, showCategory, showGroup }
}
