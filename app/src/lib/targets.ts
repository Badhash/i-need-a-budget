// Couche de donnees pour les objectifs (targets) : lecture via l'Edge Function
// /api (action listTargets), mutations setTarget / deleteTarget. Un objectif au
// plus par categorie (upsert cote serveur via target_idx). Montants en centimes.

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { apiCall } from '@/lib/api'
import { monthRange } from '@/lib/format'

export interface Target {
  id: string
  categoryId: string
  type: 'monthly' | 'byDate'
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
 * de TargetBar : monthly -> compare l'assigne du mois, byDate -> compare le
 * disponible cumule) :
 *
 * - monthly : besoin = max(0, montant cible - assigne(M)). C'est exactement la
 *   regle du ticket : on complete l'assignation du mois jusqu'a la cible.
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

export interface SetTargetInput {
  categoryId: string
  type: 'monthly' | 'byDate'
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
