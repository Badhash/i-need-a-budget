// Valeurs rapides proposees a l'assignation d'une enveloppe (feuille mobile et
// editeur desktop) : « assigné le mois dernier », « dépensé le mois dernier »,
// « moyenne 3 mois » et « objectif » (part du mois). Aucune lecture reseau
// supplementaire hors le budget du mois precedent (petit, mis en cache) :
// l'activite des mois passes se deduit du cache des transactions.

import { useMemo } from 'react'
import { useAccountsList, useBootstrap, useBudgetMonth, useTransactions } from '@/lib/data'
import { addMonths, MIN_MONTH, monthOf } from '@/lib/format'
import { neededThisMonth, useTargets } from '@/lib/targets'
import type { BudgetRow } from '@/lib/budget'

export type AssignSuggestionKey = 'lastAssigned' | 'lastSpent' | 'avg3' | 'target'

export interface AssignSuggestion {
  key: AssignSuggestionKey
  label: string
  /** Montant ASSIGNE propose pour le mois (centimes, >= 0). */
  cents: number
}

/**
 * Suggestions pour la ligne `row` du mois `month`. Les montants sont des
 * valeurs d'ASSIGNATION absolues (a poser telles quelles). Doublons et zeros
 * retires ; ordre stable : objectif, assigne le mois dernier, depense le mois
 * dernier, moyenne 3 mois.
 */
export function useAssignSuggestions(row: BudgetRow | null, month: string): AssignSuggestion[] {
  const boot = useBootstrap().data
  const accounts = useAccountsList()
  const { data: txs } = useTransactions()
  const { data: targets } = useTargets()
  const startMonth = boot?.budgetStartMonth ?? null
  const floor = startMonth && startMonth > MIN_MONTH ? startMonth : MIN_MONTH
  const prevMonth = addMonths(month, -1)
  const hasPrev = prevMonth >= floor
  // Budget du mois precedent (assigne exact) : charge a la demande puis en
  // cache ; le mois precedent du mois courant est deja precharge au demarrage.
  const prevBudget = useBudgetMonth(hasPrev ? prevMonth : month).data
  const categoryId = row?.category.id ?? null

  return useMemo(() => {
    if (!row || !categoryId) return []
    const onBudget = new Set(accounts.filter((a) => a.onBudget).map((a) => a.id))

    // Activite (centimes signes) de la categorie par mois, depuis le cache.
    const activityOf = (m: string): number => {
      let sum = 0
      for (const t of txs ?? []) {
        if (t.categoryId !== categoryId || !onBudget.has(t.accountId)) continue
        if (monthOf(t.date) === m) sum += t.amount
      }
      return sum
    }
    const spentOf = (m: string) => Math.max(0, -activityOf(m))

    const out: AssignSuggestion[] = []
    const push = (key: AssignSuggestionKey, label: string, cents: number | null) => {
      if (cents === null || cents <= 0) return
      if (out.some((s) => s.cents === cents)) return
      out.push({ key, label, cents })
    }

    const target = targets?.get(categoryId)
    if (target) {
      const goal =
        target.type === 'monthly'
          ? target.amount
          : row.assigned + neededThisMonth(target, month, row.assigned, row.available)
      push('target', 'Objectif', goal)
    }

    if (hasPrev) {
      const prevRow = prevBudget && prevBudget.month === prevMonth
        ? prevBudget.groups.flatMap((g) => g.rows).find((r) => r.category.id === categoryId)
        : undefined
      push('lastAssigned', 'Assigné le mois dernier', prevRow ? prevRow.assigned : null)
      push('lastSpent', 'Dépensé le mois dernier', spentOf(prevMonth))
      const months = [1, 2, 3].map((d) => addMonths(month, -d)).filter((m) => m >= floor)
      if (months.length > 0) {
        const avg = Math.round(months.reduce((s, m) => s + spentOf(m), 0) / months.length)
        push('avg3', `Moyenne ${months.length} mois`, avg)
      }
    }
    return out
  }, [row, categoryId, accounts, txs, targets, month, hasPrev, prevBudget, prevMonth, floor])
}
