// Calculs budget cote mocks (version allegee du futur packages/engine).
// Regles YNAB : available = rollover + assigned + activity,
// rollover = max(available(M-1), 0), l'overspending est deduit du RTA.

import {
  accounts,
  categories,
  categoryGroups,
  INCOME_GROUP_ID,
  type Assignments,
  type Category,
  type CategoryGroup,
  type Transaction,
} from '@/mocks/data'
import { MIN_MONTH, monthOf, monthRange } from '@/lib/format'

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

const incomeCategoryIds = new Set(categories.filter((c) => c.isIncome).map((c) => c.id))
const onBudgetAccountIds = new Set(accounts.filter((a) => a.onBudget).map((a) => a.id))

export function isIncomeCategory(categoryId: string | null): boolean {
  return categoryId !== null && incomeCategoryIds.has(categoryId)
}

export function computeBudgetMonth(
  requestedMonth: string,
  txs: Transaction[],
  assigns: Assignments,
): BudgetMonth {
  // Garde-fou : la fenetre budgetaire commence a MIN_MONTH
  const month = requestedMonth < MIN_MONTH ? MIN_MONTH : requestedMonth
  const months = monthRange(MIN_MONTH, month)
  const envelopeCats = categories.filter((c) => c.groupId !== INCOME_GROUP_ID)

  // activity[m][cat] : somme des transactions categorisees du mois
  const activity = new Map<string, Map<string, number>>()
  let cumulativeInflows = 0
  for (const tx of txs) {
    const m = monthOf(tx.date)
    if (m > month || m < MIN_MONTH) continue
    if (tx.transferGroupId) continue
    if (!onBudgetAccountIds.has(tx.accountId)) continue
    if (isIncomeCategory(tx.categoryId)) {
      cumulativeInflows += tx.amount
      continue
    }
    if (!tx.categoryId) continue
    if (!activity.has(m)) activity.set(m, new Map())
    const byCat = activity.get(m)!
    byCat.set(tx.categoryId, (byCat.get(tx.categoryId) ?? 0) + tx.amount)
  }

  let cumulativeAssigned = 0
  let cumulativeOverspend = 0 // mois strictement anterieurs au mois cible
  const prevAvailable = new Map<string, number>()
  let result: Map<string, BudgetRow> = new Map()

  for (const m of months) {
    const monthAssigns = assigns[m] ?? {}
    const monthActivity = activity.get(m) ?? new Map<string, number>()
    const rows = new Map<string, BudgetRow>()
    let monthOverspend = 0

    for (const cat of envelopeCats) {
      const assigned = monthAssigns[cat.id] ?? 0
      const act = monthActivity.get(cat.id) ?? 0
      const rollover = Math.max(prevAvailable.get(cat.id) ?? 0, 0)
      const available = rollover + assigned + act
      rows.set(cat.id, { category: cat, assigned, activity: act, available })
      cumulativeAssigned += assigned
      if (available < 0) monthOverspend += -available
      prevAvailable.set(cat.id, available)
    }

    if (m !== month) cumulativeOverspend += monthOverspend
    result = rows
  }

  const rta = cumulativeInflows - cumulativeAssigned - cumulativeOverspend

  const groups: BudgetGroupBlock[] = categoryGroups
    .filter((g) => g.id !== INCOME_GROUP_ID)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((group) => {
      const rows = categories
        .filter((c) => c.groupId === group.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => result.get(c.id)!)
      return {
        group,
        rows,
        totals: {
          assigned: rows.reduce((s, r) => s + r.assigned, 0),
          activity: rows.reduce((s, r) => s + r.activity, 0),
          available: rows.reduce((s, r) => s + r.available, 0),
        },
      }
    })

  return {
    month,
    rta,
    groups,
    totals: {
      assigned: groups.reduce((s, g) => s + g.totals.assigned, 0),
      activity: groups.reduce((s, g) => s + g.totals.activity, 0),
      available: groups.reduce((s, g) => s + g.totals.available, 0),
    },
  }
}
