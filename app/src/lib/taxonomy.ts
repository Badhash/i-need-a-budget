// Edition de la taxonomie (groupes de categories et categories) : appels /api
// et hooks de mutation optimistes sur le cache ['bootstrap']. Conformement a
// CLAUDE.md, chaque action se reflete instantanement dans l'UI (setQueryData),
// le POST part en arriere-plan, rollback discret en cas d'echec puis
// invalidation silencieuse de ['bootstrap'] et ['budget'].

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiCall } from '@/lib/api'
import type { Bootstrap } from '@/lib/data'
import type { GroupIcon } from '@/mocks/data'
import type { CatColor } from '@/styles/themes'

const BOOTSTRAP_KEY = ['bootstrap'] as const

// ---------------------------------------------------------------------------
// Appels /api (contrats figes)
// ---------------------------------------------------------------------------

export async function apiCreateCategory(input: {
  groupId: string
  name: string
}): Promise<{ id: string }> {
  return apiCall<{ id: string }>('createCategory', input)
}

export async function apiUpdateCategory(input: {
  categoryId: string
  name?: string
  groupId?: string
  hidden?: boolean
}): Promise<void> {
  await apiCall('updateCategory', input)
}

export async function apiDeleteCategory(input: {
  categoryId: string
}): Promise<{ ok: true; uncategorized: number }> {
  return apiCall<{ ok: true; uncategorized: number }>('deleteCategory', input)
}

export async function apiCreateGroup(input: {
  name: string
  color: CatColor
  icon: GroupIcon
}): Promise<{ id: string }> {
  return apiCall<{ id: string }>('createCategoryGroup', input)
}

export async function apiUpdateGroup(input: {
  groupId: string
  name?: string
  color?: CatColor
  icon?: GroupIcon
  hidden?: boolean
}): Promise<void> {
  await apiCall('updateCategoryGroup', input)
}

export async function apiDeleteGroup(input: { groupId: string }): Promise<void> {
  await apiCall('deleteCategoryGroup', input)
}

export async function apiReorderCategories(input: {
  groupId: string
  orderedIds: string[]
}): Promise<void> {
  await apiCall('reorderCategories', input)
}

export async function apiReorderGroups(input: { orderedIds: string[] }): Promise<void> {
  await apiCall('reorderCategoryGroups', input)
}

// ---------------------------------------------------------------------------
// Aide : mutation optimiste generique sur le cache bootstrap
// ---------------------------------------------------------------------------

interface OptimisticContext {
  previous: Bootstrap | undefined
  // Id optimiste 'temp-*' insere par une mutation de creation : remplace par
  // l'id serveur des la reponse (onSuccess), avant meme le refetch.
  tempId?: string
}

// Un id optimiste n'existe pas cote serveur : il ne doit jamais partir dans un
// appel /api (requireUuid le rejetterait en 400).
function isTempId(id: string): boolean {
  return id.startsWith('temp-')
}

async function snapshotAndApply(
  queryClient: QueryClient,
  apply: (old: Bootstrap) => Bootstrap,
): Promise<OptimisticContext> {
  await queryClient.cancelQueries({ queryKey: BOOTSTRAP_KEY })
  const previous = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
  queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => (old ? apply(old) : old))
  return { previous }
}

function rollback(queryClient: QueryClient, context: OptimisticContext | undefined) {
  if (context?.previous) queryClient.setQueryData(BOOTSTRAP_KEY, context.previous)
}

// Invalidation silencieuse : la reconciliation serveur renvoie les memes
// donnees, donc rien ne "saute" visuellement.
function settle(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: BOOTSTRAP_KEY })
  void queryClient.invalidateQueries({ queryKey: ['budget'] })
}

// ---------------------------------------------------------------------------
// Hooks de mutation
// ---------------------------------------------------------------------------

export function useCreateCategoryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: apiCreateCategory,
    onMutate: async ({ groupId, name }): Promise<OptimisticContext> => {
      // Id temporaire remplace par l'id serveur des onSuccess (voir ci-dessous).
      const tempId = `temp-${crypto.randomUUID()}`
      const ctx = await snapshotAndApply(queryClient, (old) => ({
        ...old,
        categories: [
          ...old.categories,
          {
            id: tempId,
            groupId,
            name,
            isIncome: false,
            sortOrder:
              Math.max(0, ...old.categories.filter((c) => c.groupId === groupId).map((c) => c.sortOrder)) + 1,
          },
        ],
      }))
      return { ...ctx, tempId }
    },
    // Remplace l'id optimiste par l'id serveur sans attendre le refetch : les
    // mutations suivantes (renommer, supprimer, reordonner, categoriser)
    // manipulent alors un vrai uuid accepte par /api.
    onSuccess: ({ id }, _v, ctx) => {
      if (!ctx?.tempId) return
      queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => {
        if (!old || old.categories.some((c) => c.id === id)) return old
        return {
          ...old,
          categories: old.categories.map((c) => (c.id === ctx.tempId ? { ...c, id } : c)),
        }
      })
    },
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

export function useUpdateCategoryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: apiUpdateCategory,
    onMutate: ({ categoryId, name, groupId }) =>
      snapshotAndApply(queryClient, (old) => ({
        ...old,
        categories: old.categories.map((c) =>
          c.id === categoryId
            ? { ...c, name: name ?? c.name, groupId: groupId ?? c.groupId }
            : c,
        ),
      })),
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

export function useDeleteCategoryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: apiDeleteCategory,
    onMutate: ({ categoryId }) =>
      snapshotAndApply(queryClient, (old) => ({
        ...old,
        categories: old.categories.filter((c) => c.id !== categoryId),
      })),
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => {
      settle(queryClient)
      // deleteCategory decategorise les transactions cote serveur : le cache
      // ['transactions'] doit etre refetch pour que le filtre et le badge
      // "A categoriser" refletent immediatement les lignes liberees (le signal
      // Realtime n'est qu'un filet best-effort).
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

export function useCreateGroupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: apiCreateGroup,
    onMutate: async ({ name, color, icon }): Promise<OptimisticContext> => {
      const tempId = `temp-${crypto.randomUUID()}`
      const ctx = await snapshotAndApply(queryClient, (old) => ({
        ...old,
        groups: [
          ...old.groups,
          {
            id: tempId,
            name,
            color,
            icon,
            sortOrder: Math.max(0, ...old.groups.map((g) => g.sortOrder)) + 1,
          },
        ],
      }))
      return { ...ctx, tempId }
    },
    // Meme principe que useCreateCategoryMutation : id serveur des onSuccess.
    onSuccess: ({ id }, _v, ctx) => {
      if (!ctx?.tempId) return
      queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => {
        if (!old || old.groups.some((g) => g.id === id)) return old
        return {
          ...old,
          groups: old.groups.map((g) => (g.id === ctx.tempId ? { ...g, id } : g)),
        }
      })
    },
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

export function useUpdateGroupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: apiUpdateGroup,
    onMutate: ({ groupId, name, color, icon }) =>
      snapshotAndApply(queryClient, (old) => ({
        ...old,
        groups: old.groups.map((g) =>
          g.id === groupId
            ? { ...g, name: name ?? g.name, color: color ?? g.color, icon: icon ?? g.icon }
            : g,
        ),
      })),
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

export function useDeleteGroupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: apiDeleteGroup,
    onMutate: ({ groupId }) =>
      snapshotAndApply(queryClient, (old) => ({
        ...old,
        groups: old.groups.filter((g) => g.id !== groupId),
      })),
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

export function useReorderCategoriesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    // Les ids optimistes 'temp-*' sont ecartes de l'appel serveur (ils y
    // seraient rejetes en 400) ; l'ordre local reste applique de maniere
    // optimiste et le refetch retablit l'ordre complet une fois les vrais ids
    // connus. Groupe encore temporaire : aucun appel, l'ordre local suffit.
    mutationFn: async ({ groupId, orderedIds }: { groupId: string; orderedIds: string[] }) => {
      if (isTempId(groupId)) return
      const serverIds = orderedIds.filter((id) => !isTempId(id))
      if (serverIds.length === 0) return
      await apiReorderCategories({ groupId, orderedIds: serverIds })
    },
    onMutate: ({ orderedIds }) =>
      snapshotAndApply(queryClient, (old) => {
        const order = new Map(orderedIds.map((id, i) => [id, i + 1]))
        return {
          ...old,
          categories: old.categories.map((c) =>
            order.has(c.id) ? { ...c, sortOrder: order.get(c.id)! } : c,
          ),
        }
      }),
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

export function useReorderGroupsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    // Meme garde que useReorderCategoriesMutation : jamais d'id 'temp-*' vers /api.
    mutationFn: async ({ orderedIds }: { orderedIds: string[] }) => {
      const serverIds = orderedIds.filter((id) => !isTempId(id))
      if (serverIds.length === 0) return
      await apiReorderGroups({ orderedIds: serverIds })
    },
    onMutate: ({ orderedIds }) =>
      snapshotAndApply(queryClient, (old) => {
        const order = new Map(orderedIds.map((id, i) => [id, i + 1]))
        return {
          ...old,
          groups: old.groups.map((g) =>
            order.has(g.id) ? { ...g, sortOrder: order.get(g.id)! } : g,
          ),
        }
      }),
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}
