// Types du moteur d'enveloppes cote UI. Le CALCUL est desormais realise par
// l'Edge Function /api (packages/engine) ; ce module ne conserve que les
// definitions de types partagees par les composants budget.

import type { Category, CategoryGroup } from '@/mocks/data'

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
