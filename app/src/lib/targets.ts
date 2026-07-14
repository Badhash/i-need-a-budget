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

const TARGETS_KEY = ['targets'] as const

async function fetchTargets(): Promise<Target[]> {
  const { targets } = await apiCall<{ targets: Target[] }>('listTargets')
  return targets
}

/** Liste brute des objectifs. */
export function useTargetsList(): UseQueryResult<Target[]> {
  return useQuery({ queryKey: TARGETS_KEY, queryFn: fetchTargets })
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
 *   TargetBar mesure deja la progression via le disponible cumule ; on reutilise
 *   cette meme base. Reste a financer globalement = max(0, montant - disponible).
 *   Aucune notion de "part mensuelle sur la trajectoire" n'existe encore dans le
 *   code, donc on la DEFINIT ici de facon lineaire : on etale le reste sur le
 *   nombre de mois restants jusqu'a l'echeance (mois courant inclus), et on
 *   arrondit au centime SUPERIEUR (ceil) pour garantir d'atteindre la cible a
 *   temps malgre l'arrondi. Un objectif deja en retard (echeance <= mois courant)
 *   ou sans echeance demande la totalite du reste immediatement (1 seul mois).
 *   Le disponible inclut deja l'assigne du mois courant : le besoin renvoye est
 *   donc bien le SUPPLEMENT a ajouter a l'assignation de ce mois.
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
  const remaining = Math.max(0, target.amount - available)
  if (remaining === 0) return 0
  // monthRange est inclusif des deux bornes -> nombre de mois restants, min 1.
  const monthsLeft = target.dueMonth && target.dueMonth > month ? monthRange(month, target.dueMonth).length : 1
  return Math.min(remaining, Math.ceil(remaining / monthsLeft))
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
