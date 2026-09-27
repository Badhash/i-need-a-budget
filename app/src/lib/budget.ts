// Types du moteur d'enveloppes cote UI. Le CALCUL est desormais realise par
// l'Edge Function /api (packages/engine) ; ce module ne conserve que les
// definitions de types partagees par les composants budget.

import type { Category, CategoryGroup } from '@/types/domain'

export interface BudgetRow {
  category: Category
  assigned: number
  activity: number
  available: number
}

export interface BudgetGroupBlock {
  group: CategoryGroup
  rows: BudgetRow[]
  totals: { assigned: number; activity: number; available: number }
}

export interface BudgetMonth {
  month: string
  rta: number
  groups: BudgetGroupBlock[]
  totals: { assigned: number; activity: number; available: number }
}

/** Depassements d'un ensemble de lignes : nombre d'enveloppes negatives et manque total (> 0). */
export function overspendingOf(rows: BudgetRow[]): { count: number; missing: number } {
  let count = 0
  let missing = 0
  for (const row of rows) {
    if (row.available < 0) {
      count += 1
      missing += -row.available
    }
  }
  return { count, missing }
}
