// Couche de donnees pour les objectifs (targets) : lecture via l'Edge Function
// /api (action listTargets), mutations setTarget / deleteTarget. Un objectif au
// plus par categorie (upsert cote serveur via target_idx). Montants en centimes.

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { apiCall } from '@/lib/api'
import { enqueue, resolveId } from '@/lib/mutationQueue'
import { monthRange } from '@/lib/format'

/**
 * Types d'objectif :
 * - monthly : assigner `amount` chaque mois ;
 * - byDate  : accumuler `amount` de disponible d'ici `dueMonth` ;
 * - refill  : recharger l'enveloppe jusqu'a `amount` chaque mois, report
 *   compris (fonctionnalite serveur refillTargets, cf. lib/features.ts).
 */
export type TargetType = 'monthly' | 'byDate' | 'refill'

export interface Target {
  id: string
  categoryId: string
  type: TargetType
  amount: number
  dueMonth: string | null
}

export const TARGETS_KEY = ['targets'] as const

export async function fetchTargets(): Promise<Target[]> {
  const { targets } = await apiCall<{ targets: Target[] }>('listTargets')
  return targets
}

/** Objectifs indexes par categorie (cle = categoryId), partagent la meme query. */
export function useTargets(): UseQueryResult<Map<string, Target>> {
  return useQuery({
    queryKey: TARGETS_KEY,
    queryFn: fetchTargets,
    select: (list) => new Map(list.map((t) => [t.categoryId, t])),
  })
}

/**
 * Montant qu'il RESTE a assigner ce mois-ci pour honorer l'objectif d'une
 * categorie (en centimes, toujours >= 0). Zero = objectif deja finance, la
 * categorie est alors ignoree par l'assignation guidee (INAB-6).
 *
 * Definition du "besoin" par type d'objectif (aligne sur la notion de progression
 * de TargetBar : monthly -> compare l'assigne du mois, byDate et refill ->
 * comparent le disponible cumule) :
 *
 * - monthly : besoin = max(0, montant cible - assigne(M)). C'est exactement la
 *   regle du ticket : on complete l'assignation du mois jusqu'a la cible.
 *
 * - refill : besoin = max(0, montant cible - disponible(M)). Le disponible
 *   inclut le report du mois precedent et l'assigne du mois : une fois le
 *   manque assigne, le disponible atteint la cible et le besoin retombe a 0.
 *
 * - byDate : l'objectif est d'accumuler `montant` de disponible d'ici l'echeance.
 *   On repartit le reste a accumuler sur le nombre de mois restants (mois courant
 *   inclus), arrondi au centime SUPERIEUR (ceil) pour atteindre la cible a temps.
 *
 *   POINT CLE (corrige un bug de reproposition en boucle) : la part du mois se
 *   calcule depuis la position AVANT l'assignation de ce mois-ci
 *   (`available - assigned` = report des mois precedents + activite), puis on
 *   RETRANCHE ce qui est deja assigne ce mois. Sinon, financer la part augmentait
 *   `available`, et au clic suivant une nouvelle fraction du reste etait
 *   reproposee (montants degressifs a l'infini). Avec ce retrait, une fois la
 *   part du mois posee, le besoin retombe a 0 et y reste. Un objectif en retard
 *   (echeance <= mois courant) ou sans echeance demande a completer jusqu'a la
 *   cible immediatement (1 seul mois).
 */
export function neededThisMonth(
  target: Target,
  month: string,
  assigned: number,
  available: number,
): number {
  if (target.amount <= 0) return 0
  if (target.type === 'monthly') {
    return Math.max(0, target.amount - assigned)
  }
  if (target.type === 'refill') {
    return Math.max(0, target.amount - available)
  }
  // Position de depart du mois : disponible hors assignation de ce mois-ci.
  const availableBeforeAssign = available - assigned
  const remaining = Math.max(0, target.amount - availableBeforeAssign)
  if (remaining === 0) return 0
  // monthRange est inclusif des deux bornes -> nombre de mois restants, min 1.
  const monthsLeft = target.dueMonth && target.dueMonth > month ? monthRange(month, target.dueMonth).length : 1
  const monthlyPortion = Math.min(remaining, Math.ceil(remaining / monthsLeft))
  // Supplement a ajouter a l'assignation de ce mois pour atteindre la part.
  return Math.max(0, monthlyPortion - assigned)
}

/**
 * Progression affichee d'un objectif et montant « finance » compare a la
 * cible : l'assigne du mois pour monthly, le disponible cumule sinon (byDate :
 * epargne accumulee ; refill : niveau de l'enveloppe, report compris).
 */
export function targetProgress(
  target: Target,
  assigned: number,
  available: number,
): { funded: number; ratio: number; reached: boolean } {
  const funded = target.type === 'monthly' ? assigned : available
  const ratio = target.amount > 0 ? Math.min(Math.max(funded, 0) / target.amount, 1) : 0
  return { funded, ratio, reached: target.amount > 0 && funded >= target.amount }
}

export interface SetTargetInput {
  categoryId: string
  type: TargetType
  amount: number
  dueMonth?: string | null
}

export async function apiSetTarget(input: SetTargetInput): Promise<void> {
  await apiCall('setTarget', {
    categoryId: input.categoryId,
    type: input.type,
    amount: input.amount,
    dueMonth: input.dueMonth ?? null,
  })
}

export async function apiDeleteTarget(categoryId: string): Promise<void> {
  await apiCall('deleteTarget', { categoryId })
}

// ---------------------------------------------------------------------------
// Mutations optimistes : la liste des objectifs (cache ['targets']) change
// INSTANTANEMENT, le POST part en arriere-plan (file serialisee : un objectif
// pose sur une categorie tout juste creee attend son id serveur). Rollback
// discret en cas d'echec, puis relecture scopee de ['targets'] seulement.
// ---------------------------------------------------------------------------

interface TargetsContext {
  previous: Target[] | undefined
}

export function useSetTargetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SetTargetInput) =>
      enqueue(() => apiSetTarget({ ...input, categoryId: resolveId(input.categoryId) }), {
        deps: [input.categoryId],
      }),
    onMutate: async (input): Promise<TargetsContext> => {
      await queryClient.cancelQueries({ queryKey: TARGETS_KEY })
      const previous = queryClient.getQueryData<Target[]>(TARGETS_KEY)
      queryClient.setQueryData<Target[]>(TARGETS_KEY, (old) => {
        const list = old ?? []
        const existing = list.find((t) => t.categoryId === input.categoryId)
        const next: Target = {
          id: existing?.id ?? `temp-target-${input.categoryId}`,
          categoryId: input.categoryId,
          type: input.type,
          amount: input.amount,
          dueMonth: input.type === 'byDate' ? (input.dueMonth ?? null) : null,
        }
        return existing ? list.map((t) => (t === existing ? next : t)) : [...list, next]
      })
      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(TARGETS_KEY, context.previous)
      void queryClient.invalidateQueries({ queryKey: TARGETS_KEY })
    },
  })
}

export function useDeleteTargetMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (categoryId: string) =>
      enqueue(() => apiDeleteTarget(resolveId(categoryId)), { deps: [categoryId] }),
    onMutate: async (categoryId): Promise<TargetsContext> => {
      await queryClient.cancelQueries({ queryKey: TARGETS_KEY })
      const previous = queryClient.getQueryData<Target[]>(TARGETS_KEY)
      queryClient.setQueryData<Target[]>(TARGETS_KEY, (old) => old?.filter((t) => t.categoryId !== categoryId))
      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(TARGETS_KEY, context.previous)
      void queryClient.invalidateQueries({ queryKey: TARGETS_KEY })
    },
  })
}
