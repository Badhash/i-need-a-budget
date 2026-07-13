// Couche de donnees pour les objectifs (targets) : lecture via l'Edge Function
// /api (action listTargets), mutations setTarget / deleteTarget. Un objectif au
// plus par categorie (upsert cote serveur via target_idx). Montants en centimes.

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { apiCall } from '@/lib/api'

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
