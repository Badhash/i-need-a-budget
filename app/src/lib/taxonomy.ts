// Edition de la taxonomie (groupes de categories et categories) : appels /api
// et hooks de mutation optimistes. Conformement a CLAUDE.md, chaque action se
// reflete instantanement dans l'UI (setQueryData) sur le cache ['bootstrap']
// ET sur chaque budget mensuel en cache (['budget', mois]) : creation,
// renommage, deplacement, masquage, suppression, ordre, couleur et icone d'un
// groupe. Le POST part en arriere-plan, rollback discret en cas d'echec puis
// invalidation silencieuse et scopee de ['bootstrap'] et ['budget'].

import { useMutation, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { apiCall } from '@/lib/api'
import { enqueue, isTempId, registerRealId, resolveId } from '@/lib/mutationQueue'
import {
  BOOTSTRAP_KEY,
  TRANSACTIONS_KEY,
  apiCategorizeMany,
  countsAsUncategorized,
  fetchTransactions,
  isCrossBudgetTransfer,
  patchUncategorizedCount,
  type Bootstrap,
} from '@/lib/data'
import type { BudgetGroupBlock, BudgetMonth, BudgetRow } from '@/lib/budget'
import type { Category, CategoryGroup, GroupIcon, Transaction } from '@/types/domain'
import type { CatColor } from '@/styles/themes'

const BUDGET_PREFIX = ['budget'] as const
const TARGETS_KEY = ['targets'] as const
const RULES_KEY = ['rules'] as const

// ---------------------------------------------------------------------------
// Appels /api (contrats figes)
// ---------------------------------------------------------------------------

export async function apiCreateCategory(input: { groupId: string; name: string }): Promise<{ id: string }> {
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

export async function apiDeleteCategory(input: { categoryId: string }): Promise<{ ok: true; uncategorized: number }> {
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

export async function apiReorderCategories(input: { groupId: string; orderedIds: string[] }): Promise<void> {
  await apiCall('reorderCategories', input)
}

export async function apiReorderGroups(input: { orderedIds: string[] }): Promise<void> {
  await apiCall('reorderCategoryGroups', input)
}

// ---------------------------------------------------------------------------
// Budgets mensuels en cache : transformations pures
// ---------------------------------------------------------------------------
//
// Le budget d'un mois (forme groupee, cf. adaptBudget) duplique la taxonomie :
// chaque ligne porte sa categorie, chaque bloc son groupe. Les chiffres
// (assigne, activite, disponible, Pret a assigner) ne sont PAS recalcules ici
// (il faudrait rejouer le moteur) : seules la structure et les libelles suivent
// la taxonomie, les totaux des blocs sont resommes a partir des lignes, et le
// refetch de fin (settle) remet les chiffres a la verite serveur.

type BudgetSnapshot = [QueryKey, BudgetMonth | undefined][]

function sumRows(rows: BudgetRow[]): BudgetGroupBlock['totals'] {
  return {
    assigned: rows.reduce((s, r) => s + r.assigned, 0),
    activity: rows.reduce((s, r) => s + r.activity, 0),
    available: rows.reduce((s, r) => s + r.available, 0),
  }
}

function withGroups(month: BudgetMonth, groups: BudgetGroupBlock[]): BudgetMonth {
  return {
    ...month,
    groups,
    totals: {
      assigned: groups.reduce((s, g) => s + g.totals.assigned, 0),
      activity: groups.reduce((s, g) => s + g.totals.activity, 0),
      available: groups.reduce((s, g) => s + g.totals.available, 0),
    },
  }
}

function makeBlock(group: CategoryGroup, rows: BudgetRow[]): BudgetGroupBlock {
  return { group, rows, totals: sumRows(rows) }
}

/**
 * Remplace les lignes des blocs (fn renvoie la meme reference si rien ne
 * change) ; un bloc devenu vide disparait, comme dans adaptBudget.
 */
function mapRows(month: BudgetMonth, fn: (rows: BudgetRow[], block: BudgetGroupBlock) => BudgetRow[]): BudgetMonth {
  let changed = false
  const groups = month.groups
    .map((b) => {
      const rows = fn(b.rows, b)
      if (rows === b.rows) return b
      changed = true
      return makeBlock(b.group, rows)
    })
    .filter((b) => b.rows.length > 0)
  return changed ? withGroups(month, groups) : month
}

/** Patche la categorie portee par une ligne (nom, masquage, id). */
function patchRowCategory(month: BudgetMonth, categoryId: string, patch: (c: Category) => Category): BudgetMonth {
  return mapRows(month, (rows) =>
    rows.some((r) => r.category.id === categoryId)
      ? rows.map((r) => (r.category.id === categoryId ? { ...r, category: patch(r.category) } : r))
      : rows,
  )
}

/** Retire la ligne d'une categorie (suppression). */
function removeRow(month: BudgetMonth, categoryId: string): BudgetMonth {
  return mapRows(month, (rows) =>
    rows.some((r) => r.category.id === categoryId) ? rows.filter((r) => r.category.id !== categoryId) : rows,
  )
}

/**
 * Ajoute une ligne a la FIN du bloc de son groupe (creation, ou deplacement :
 * le serveur place la categorie en fin de groupe cible), en creant le bloc a sa
 * place (ordre des groupes du bootstrap) s'il n'existe pas encore ce mois-ci.
 */
function appendRow(month: BudgetMonth, row: BudgetRow, boot: Bootstrap | undefined): BudgetMonth {
  const groupId = row.category.groupId
  if (month.groups.some((b) => b.group.id === groupId)) {
    return withGroups(
      month,
      month.groups.map((b) => (b.group.id === groupId ? makeBlock(b.group, [...b.rows, row]) : b)),
    )
  }
  const group = boot?.groups.find((g) => g.id === groupId)
  if (!group) return month
  const order = new Map((boot?.groups ?? []).map((g) => [g.id, g.sortOrder]))
  const rank = (g: CategoryGroup) => order.get(g.id) ?? g.sortOrder
  const groups = [...month.groups, makeBlock(group, [row])].sort((a, b) => rank(a.group) - rank(b.group))
  return withGroups(month, groups)
}

/** Deplace la ligne d'une categorie vers le groupe porte par `category`. */
function moveRow(month: BudgetMonth, category: Category, boot: Bootstrap | undefined): BudgetMonth {
  let moved: BudgetRow | undefined
  for (const b of month.groups) moved ??= b.rows.find((r) => r.category.id === category.id)
  if (!moved) return month
  if (moved.category.groupId === category.groupId) return patchRowCategory(month, category.id, () => category)
  return appendRow(removeRow(month, category.id), { ...moved, category }, boot)
}

/**
 * Trie selon un ordre donne : ids fournis en tete dans cet ordre, les autres
 * gardent ensuite leur ordre relatif (meme regle que applyOrder cote serveur).
 * Idempotent : la grille budget a pu appliquer deja le meme ordre au mois
 * affiche. Renvoie la meme reference si l'ordre ne change pas.
 */
function sortByIds<T>(items: T[], idOf: (item: T) => string, orderedIds: string[]): T[] {
  const pos = new Map(orderedIds.map((id, i) => [id, i]))
  const indexed = items.map((item, i) => ({ item, i, p: pos.get(idOf(item)) }))
  indexed.sort((a, b) => {
    if (a.p !== undefined && b.p !== undefined) return a.p - b.p
    if (a.p !== undefined) return -1
    if (b.p !== undefined) return 1
    return a.i - b.i
  })
  return indexed.every((x, i) => x.i === i) ? items : indexed.map((x) => x.item)
}

function patchBlockGroup(month: BudgetMonth, groupId: string, patch: (g: CategoryGroup) => CategoryGroup): BudgetMonth {
  if (!month.groups.some((b) => b.group.id === groupId)) return month
  return { ...month, groups: month.groups.map((b) => (b.group.id === groupId ? { ...b, group: patch(b.group) } : b)) }
}

/** Applique une transformation a chaque budget mensuel en cache. */
function forEachBudget(queryClient: QueryClient, fn: (month: BudgetMonth) => BudgetMonth) {
  for (const [key, data] of queryClient.getQueriesData<BudgetMonth>({ queryKey: BUDGET_PREFIX })) {
    if (!data) continue
    const next = fn(data)
    if (next !== data) queryClient.setQueryData<BudgetMonth>(key, next)
  }
}

// ---------------------------------------------------------------------------
// Aide : snapshot + application optimiste (bootstrap + budgets)
// ---------------------------------------------------------------------------

interface OptimisticContext {
  previous: Bootstrap | undefined
  budgets: BudgetSnapshot
  // Id optimiste 'temp-*' insere par une mutation de creation : remplace par
  // l'id serveur des la reponse (onSuccess), avant meme le refetch.
  tempId?: string
}

// isTempId provient de mutationQueue (source unique du prefixe temporaire) : un
// id optimiste ne doit jamais partir dans un appel /api (requireUuid le
// rejetterait en 400).

/**
 * Applique `apply` au bootstrap puis `applyBudget` a chaque budget mensuel en
 * cache (avec le bootstrap deja patche). Les lectures en vol sont annulees
 * d'abord : une reponse anterieure a la mutation ecraserait sinon la valeur
 * optimiste (« valeur qui saute »).
 */
async function snapshotAndApply(
  queryClient: QueryClient,
  apply: (old: Bootstrap) => Bootstrap,
  applyBudget?: (month: BudgetMonth, boot: Bootstrap | undefined) => BudgetMonth,
): Promise<OptimisticContext> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: BOOTSTRAP_KEY }),
    applyBudget ? queryClient.cancelQueries({ queryKey: BUDGET_PREFIX }) : undefined,
  ])
  const previous = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
  queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => (old ? apply(old) : old))
  if (!applyBudget) return { previous, budgets: [] }
  const budgets: BudgetSnapshot = queryClient.getQueriesData<BudgetMonth>({ queryKey: BUDGET_PREFIX })
  const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
  forEachBudget(queryClient, (month) => applyBudget(month, boot))
  return { previous, budgets }
}

function rollback(queryClient: QueryClient, context: OptimisticContext | undefined) {
  if (context?.previous) queryClient.setQueryData(BOOTSTRAP_KEY, context.previous)
  for (const [key, data] of context?.budgets ?? []) queryClient.setQueryData(key, data)
}

// Invalidation silencieuse et scopee : la reconciliation serveur renvoie les
// memes donnees, donc rien ne "saute" visuellement. Seules les requetes
// affichees refetchent (les autres sont juste marquees perimees).
function settle(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: BOOTSTRAP_KEY })
  void queryClient.invalidateQueries({ queryKey: BUDGET_PREFIX })
}

/** Rang de fin de liste (le serveur place les nouveaux elements apres le dernier). */
function nextSortOrder(rows: { sortOrder: number }[]): number {
  return rows.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 1
}

// ---------------------------------------------------------------------------
// Hooks de mutation
// ---------------------------------------------------------------------------

export function useCreateCategoryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    // Le tempId est genere ici (variables) : partage par onMutate (insertion
    // optimiste) et par la tache reseau (enregistrement tempId -> realId). Le
    // groupId peut lui-meme etre temporaire (categorie creee dans un groupe
    // tout juste cree) : resolveId le remplace par l'id serveur au moment de
    // l'envoi, et deps garantit l'ordre FIFO derriere la creation du groupe.
    mutationFn: ({ groupId, name, tempId }: { groupId: string; name: string; tempId: string }) =>
      enqueue(
        async () => {
          const res = await apiCreateCategory({ groupId: resolveId(groupId), name })
          registerRealId(tempId, res.id)
          return res
        },
        { deps: [groupId] },
      ),
    onMutate: async ({ groupId, name, tempId }): Promise<OptimisticContext> => {
      const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
      const category: Category = {
        id: tempId,
        groupId,
        name,
        isIncome: false,
        hidden: false,
        sortOrder: nextSortOrder((boot?.categories ?? []).filter((c) => c.groupId === groupId)),
      }
      const ctx = await snapshotAndApply(
        queryClient,
        (old) => ({ ...old, categories: [...old.categories, category] }),
        // Nouvelle enveloppe : ligne a zero en fin de groupe, chaque mois.
        (month, b) => appendRow(month, { category, assigned: 0, activity: 0, available: 0 }, b),
      )
      return { ...ctx, tempId }
    },
    // Remplace l'id optimiste par l'id serveur sans attendre le refetch : les
    // mutations suivantes (renommer, supprimer, reordonner, categoriser)
    // manipulent alors un vrai uuid accepte par /api.
    onSuccess: ({ id }, { tempId }) => {
      queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => {
        if (!old || old.categories.some((c) => c.id === id)) return old
        return {
          ...old,
          categories: old.categories.map((c) => (c.id === tempId ? { ...c, id } : c)),
        }
      })
      forEachBudget(queryClient, (month) => patchRowCategory(month, tempId, (c) => ({ ...c, id })))
    },
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

export function useUpdateCategoryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    // Serialise derriere une eventuelle creation en vol : categoryId (et le
    // groupId cible d'un deplacement) sont resolus temp -> real avant l'envoi.
    mutationFn: ({
      categoryId,
      name,
      groupId,
      hidden,
    }: {
      categoryId: string
      name?: string
      groupId?: string
      hidden?: boolean
    }) =>
      enqueue(
        () =>
          apiUpdateCategory({
            categoryId: resolveId(categoryId),
            name,
            groupId: groupId === undefined ? undefined : resolveId(groupId),
            hidden,
          }),
        { deps: groupId === undefined ? [categoryId] : [categoryId, groupId] },
      ),
    onMutate: ({ categoryId, name, groupId, hidden }) => {
      const boot = queryClient.getQueryData<Bootstrap>(BOOTSTRAP_KEY)
      const current = boot?.categories.find((c) => c.id === categoryId)
      const moving = groupId !== undefined && current !== undefined && groupId !== current.groupId
      // Un deplacement place la categorie a la fin du groupe cible (serveur).
      const movedSort = moving
        ? nextSortOrder((boot?.categories ?? []).filter((c) => c.groupId === groupId && c.id !== categoryId))
        : 0
      const next = (c: Category): Category => ({
        ...c,
        name: name ?? c.name,
        hidden: hidden ?? c.hidden,
        groupId: moving ? groupId : c.groupId,
        sortOrder: moving ? movedSort : c.sortOrder,
      })
      return snapshotAndApply(
        queryClient,
        (old) => ({ ...old, categories: old.categories.map((c) => (c.id === categoryId ? next(c) : c)) }),
        (month, b) => {
          const updated = b?.categories.find((c) => c.id === categoryId)
          if (!updated) return month
          return moving ? moveRow(month, updated, b) : patchRowCategory(month, categoryId, next)
        },
      )
    },
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

interface DeleteContext extends OptimisticContext {
  transactions: Transaction[] | undefined
  countDelta: number
  targets: unknown
  rules: unknown
}

export function useDeleteCategoryMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    // Supprimer pendant la fenetre de creation attendait jusqu'ici que l'id
    // serveur existe : la file resout categoryId apres confirmation.
    mutationFn: ({ categoryId }: { categoryId: string }) =>
      enqueue(() => apiDeleteCategory({ categoryId: resolveId(categoryId) }), {
        deps: [categoryId],
      }),
    onMutate: async ({ categoryId }): Promise<DeleteContext> => {
      await queryClient.cancelQueries({ queryKey: TRANSACTIONS_KEY })
      // Le serveur decategorise les transactions de la categorie : meme effet
      // en optimiste sur la liste et sur le badge « À catégoriser » (compteur
      // du bootstrap), au lieu d'un refetch complet de ['transactions'].
      const transactions = queryClient.getQueryData<Transaction[]>(TRANSACTIONS_KEY)
      let countDelta = 0
      let touched = false
      for (const t of transactions ?? []) {
        if (t.categoryId !== categoryId) continue
        touched = true
        const before = countsAsUncategorized(queryClient, t)
        const after = countsAsUncategorized(queryClient, { ...t, categoryId: null })
        countDelta += (after ? 1 : 0) - (before ? 1 : 0)
      }
      if (touched) {
        queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, (old) =>
          old?.map((t) => (t.categoryId === categoryId ? { ...t, categoryId: null } : t)),
        )
      }
      // Objectif et regles de la categorie : purges aussi cote serveur.
      const targets = queryClient.getQueryData(TARGETS_KEY)
      const rules = queryClient.getQueryData(RULES_KEY)
      const withoutCategory = (old: { categoryId: string }[] | undefined) =>
        old?.some((x) => x.categoryId === categoryId) ? old.filter((x) => x.categoryId !== categoryId) : old
      queryClient.setQueryData<{ categoryId: string }[]>(TARGETS_KEY, withoutCategory)
      queryClient.setQueryData<{ categoryId: string }[]>(RULES_KEY, withoutCategory)

      const ctx = await snapshotAndApply(
        queryClient,
        (old) => ({ ...old, categories: old.categories.filter((c) => c.id !== categoryId) }),
        (month) => removeRow(month, categoryId),
      )
      patchUncategorizedCount(queryClient, countDelta)
      return { ...ctx, transactions, countDelta, targets, rules }
    },
    onError: (_e, _v, ctx) => {
      rollback(queryClient, ctx)
      if (!ctx) return
      if (ctx.transactions) queryClient.setQueryData(TRANSACTIONS_KEY, ctx.transactions)
      patchUncategorizedCount(queryClient, -ctx.countDelta)
      if (ctx.targets !== undefined) queryClient.setQueryData(TARGETS_KEY, ctx.targets)
      if (ctx.rules !== undefined) queryClient.setQueryData(RULES_KEY, ctx.rules)
    },
    // Liste des transactions et badge deja exacts (optimiste) : seuls le
    // bootstrap (compteur serveur) et les budgets sont relus.
    onSettled: () => settle(queryClient),
  })
}

export function useCreateGroupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    // tempId genere dans les variables (cf. useCreateCategoryMutation) : la
    // tache reseau enregistre tempId -> realId pour les mutations dependantes.
    mutationFn: ({ name, color, icon, tempId }: { name: string; color: CatColor; icon: GroupIcon; tempId: string }) =>
      enqueue(async () => {
        const res = await apiCreateGroup({ name, color, icon })
        registerRealId(tempId, res.id)
        return res
      }),
    onMutate: async ({ name, color, icon, tempId }): Promise<OptimisticContext> => {
      // Groupe vide : aucun bloc budget tant qu'il n'a pas de categorie.
      const ctx = await snapshotAndApply(queryClient, (old) => ({
        ...old,
        groups: [...old.groups, { id: tempId, name, color, icon, hidden: false, sortOrder: nextSortOrder(old.groups) }],
      }))
      return { ...ctx, tempId }
    },
    // Meme principe que useCreateCategoryMutation : id serveur des onSuccess,
    // y compris pour les categories deja creees dans ce groupe.
    onSuccess: ({ id }, { tempId }) => {
      queryClient.setQueryData<Bootstrap>(BOOTSTRAP_KEY, (old) => {
        if (!old || old.groups.some((g) => g.id === id)) return old
        return {
          ...old,
          groups: old.groups.map((g) => (g.id === tempId ? { ...g, id } : g)),
          categories: old.categories.map((c) => (c.groupId === tempId ? { ...c, groupId: id } : c)),
        }
      })
      forEachBudget(queryClient, (month) =>
        mapRows(
          patchBlockGroup(month, tempId, (g) => ({ ...g, id })),
          (rows) =>
            rows.some((r) => r.category.groupId === tempId)
              ? rows.map((r) =>
                  r.category.groupId === tempId ? { ...r, category: { ...r.category, groupId: id } } : r,
                )
              : rows,
        ),
      )
    },
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

export function useUpdateGroupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      groupId,
      name,
      color,
      icon,
      hidden,
    }: {
      groupId: string
      name?: string
      color?: CatColor
      icon?: GroupIcon
      hidden?: boolean
    }) =>
      enqueue(() => apiUpdateGroup({ groupId: resolveId(groupId), name, color, icon, hidden }), {
        deps: [groupId],
      }),
    onMutate: ({ groupId, name, color, icon, hidden }) => {
      const next = (g: CategoryGroup): CategoryGroup => ({
        ...g,
        name: name ?? g.name,
        color: color ?? g.color,
        icon: icon ?? g.icon,
        hidden: hidden ?? g.hidden,
      })
      return snapshotAndApply(
        queryClient,
        (old) => ({ ...old, groups: old.groups.map((g) => (g.id === groupId ? next(g) : g)) }),
        (month) => patchBlockGroup(month, groupId, next),
      )
    },
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

export function useDeleteGroupMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId }: { groupId: string }) =>
      enqueue(() => apiDeleteGroup({ groupId: resolveId(groupId) }), { deps: [groupId] }),
    onMutate: ({ groupId }) =>
      snapshotAndApply(
        queryClient,
        (old) => ({ ...old, groups: old.groups.filter((g) => g.id !== groupId) }),
        // Un groupe supprimable est vide : pas de bloc, sauf etat transitoire.
        (month) =>
          month.groups.some((b) => b.group.id === groupId)
            ? withGroups(
                month,
                month.groups.filter((b) => b.group.id !== groupId),
              )
            : month,
      ),
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

export function useReorderCategoriesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    // Serialise derriere les creations en vol : au moment de l'envoi, groupId
    // et les ids sont resolus temp -> real. Ceux qui restent temporaires (une
    // creation a echoue) sont ecartes ; l'ordre local reste applique de maniere
    // optimiste et le refetch retablit l'ordre complet. Groupe encore
    // temporaire : aucun appel, l'ordre local suffit.
    mutationFn: ({ groupId, orderedIds }: { groupId: string; orderedIds: string[] }) =>
      enqueue(async () => {
        const realGroup = resolveId(groupId)
        if (isTempId(realGroup)) return
        const serverIds = orderedIds.map(resolveId).filter((id) => !isTempId(id))
        if (serverIds.length === 0) return
        await apiReorderCategories({ groupId: realGroup, orderedIds: serverIds })
      }),
    onMutate: ({ groupId, orderedIds }) =>
      snapshotAndApply(
        queryClient,
        (old) => {
          const order = new Map(orderedIds.map((id, i) => [id, i + 1]))
          return {
            ...old,
            categories: old.categories.map((c) => (order.has(c.id) ? { ...c, sortOrder: order.get(c.id)! } : c)),
          }
        },
        // Tri idempotent : la grille budget a pu deja reordonner le mois affiche.
        (month) =>
          mapRows(month, (rows, b) =>
            b.group.id === groupId ? sortByIds(rows, (r) => r.category.id, orderedIds) : rows,
          ),
      ),
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

export function useReorderGroupsMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    // Meme garde que useReorderCategoriesMutation : ids resolus puis jamais
    // d'id 'temp-*' vers /api.
    mutationFn: ({ orderedIds }: { orderedIds: string[] }) =>
      enqueue(async () => {
        const serverIds = orderedIds.map(resolveId).filter((id) => !isTempId(id))
        if (serverIds.length === 0) return
        await apiReorderGroups({ orderedIds: serverIds })
      }),
    onMutate: ({ orderedIds }) =>
      snapshotAndApply(
        queryClient,
        (old) => {
          const order = new Map(orderedIds.map((id, i) => [id, i + 1]))
          return {
            ...old,
            groups: old.groups.map((g) => (order.has(g.id) ? { ...g, sortOrder: order.get(g.id)! } : g)),
          }
        },
        (month) => {
          const groups = sortByIds(month.groups, (b) => b.group.id, orderedIds)
          return groups === month.groups ? month : { ...month, groups }
        },
      ),
    onError: (_e, _v, ctx) => rollback(queryClient, ctx),
    onSettled: () => settle(queryClient),
  })
}

// ---------------------------------------------------------------------------
// Reaffectation des transactions d'une categorie (avant sa suppression)
// ---------------------------------------------------------------------------

/** Limite serveur de categorizeMany. */
export const REASSIGN_BATCH = 200

/**
 * Transactions qu'une reaffectation deplacerait : celles de la categorie, hors
 * moities de virement neutres (le serveur les ignore ; seule la moitie cote
 * budget d'un virement vers un compte de suivi se categorise, serveur recent).
 */
export function reassignableTransactions(
  queryClient: QueryClient,
  txs: Transaction[],
  categoryId: string,
): Transaction[] {
  return txs.filter((t) => t.categoryId === categoryId && (!t.transferGroupId || isCrossBudgetTransfer(queryClient, t)))
}

function setCategoryOf(queryClient: QueryClient, ids: Set<string>, categoryId: string) {
  queryClient.setQueryData<Transaction[]>(TRANSACTIONS_KEY, (old) =>
    old?.map((t) => (ids.has(t.id) ? { ...t, categoryId } : t)),
  )
}

/**
 * Reaffecte les transactions de `fromId` a `toId` par lots de 200 (limite de
 * categorizeMany), la liste des transactions etant patchee en optimiste lot par
 * lot. Un lot en echec est remis sur `fromId` et l'erreur remonte : les lots
 * deja confirmes restent reaffectes, relancer reprend avec ce qui reste.
 * Renvoie le nombre de transactions reaffectees.
 */
export async function reassignCategoryTransactions(
  queryClient: QueryClient,
  fromId: string,
  toId: string,
  onProgress: (done: number, total: number) => void,
): Promise<number> {
  const txs = await queryClient.ensureQueryData({ queryKey: TRANSACTIONS_KEY, queryFn: fetchTransactions })
  const ids = reassignableTransactions(queryClient, txs, fromId).map((t) => t.id)
  onProgress(0, ids.length)
  let done = 0
  for (let i = 0; i < ids.length; i += REASSIGN_BATCH) {
    const batch = ids.slice(i, i + REASSIGN_BATCH)
    const batchIds = new Set(batch)
    setCategoryOf(queryClient, batchIds, toId)
    try {
      // File des mutations : ordre garanti derriere une creation en vol de la
      // categorie cible (id temporaire resolu a l'envoi).
      await enqueue(() => apiCategorizeMany(batch, resolveId(toId)), { deps: [toId] })
    } catch (err) {
      setCategoryOf(queryClient, batchIds, fromId)
      throw err
    }
    done += batch.length
    onProgress(done, ids.length)
  }
  return done
}
