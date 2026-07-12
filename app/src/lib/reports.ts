// Agregations pour la vue Rapports (calculees sur les mocks).

import { accounts, categories, categoryGroups, INCOME_GROUP_ID, type Transaction } from '@/mocks/data'
import type { CatColor } from '@/styles/themes'
import { addMonths, monthOf, monthRange } from '@/lib/format'
import { isIncomeCategory } from '@/lib/budget'

export interface GroupSpending {
  key: string
  label: string
  /** null = depenses non categorisees (rendu neutre) */
  color: CatColor | null
  total: number // centimes positifs
}

export interface MerchantSpending {
  label: string
  total: number // centimes positifs
  count: number
}

export interface MonthCashflow {
  month: string
  income: number
  spending: number
  net: number
}

export interface ReportsData {
  month: string
  spendingByGroup: GroupSpending[]
  totalSpending: number
  prevTotalSpending: number
  topMerchants: MerchantSpending[]
  cashflow: MonthCashflow[] // 6 mois glissants jusqu'au mois selectionne
  savingsRate: { month: string; rate: number; prevRate: number; income: number; saved: number }
}

const catToGroup = new Map(categories.map((c) => [c.id, c.groupId]))
const onBudgetAccountIds = new Set(accounts.filter((a) => a.onBudget).map((a) => a.id))

function isSpending(tx: Transaction): boolean {
  return (
    tx.amount < 0 &&
    !tx.transferGroupId &&
    onBudgetAccountIds.has(tx.accountId) &&
    !isIncomeCategory(tx.categoryId)
  )
}

function spendingOfMonth(txs: Transaction[], month: string): number {
  return txs.filter((t) => monthOf(t.date) === month && isSpending(t)).reduce((s, t) => s - t.amount, 0)
}

function incomeOfMonth(txs: Transaction[], month: string): number {
  return txs
    .filter(
      (t) =>
        monthOf(t.date) === month &&
        isIncomeCategory(t.categoryId) &&
        onBudgetAccountIds.has(t.accountId),
    )
    .reduce((s, t) => s + t.amount, 0)
}

export function computeReports(month: string, txs: Transaction[]): ReportsData {
  const monthTxs = txs.filter((t) => monthOf(t.date) === month)

  const byGroup = new Map<string, number>()
  for (const tx of monthTxs) {
    if (!isSpending(tx)) continue
    const groupId = tx.categoryId ? (catToGroup.get(tx.categoryId) ?? 'uncat') : 'uncat'
    byGroup.set(groupId, (byGroup.get(groupId) ?? 0) - tx.amount)
  }
  const spendingByGroup: GroupSpending[] = categoryGroups
    .filter((g) => g.id !== INCOME_GROUP_ID && byGroup.has(g.id))
    .map((group) => ({
      key: group.id,
      label: group.name,
      color: group.color,
      total: byGroup.get(group.id)!,
    }))
    .sort((a, b) => b.total - a.total)
  if (byGroup.has('uncat')) {
    spendingByGroup.push({
      key: 'uncat',
      label: 'À catégoriser',
      color: null,
      total: byGroup.get('uncat')!,
    })
  }

  const totalSpending = spendingOfMonth(txs, month)
  const prevTotalSpending = spendingOfMonth(txs, addMonths(month, -1))

  const byMerchant = new Map<string, MerchantSpending>()
  for (const tx of monthTxs) {
    if (!isSpending(tx)) continue
    const cur = byMerchant.get(tx.label) ?? { label: tx.label, total: 0, count: 0 }
    cur.total -= tx.amount
    cur.count += 1
    byMerchant.set(tx.label, cur)
  }
  const topMerchants = [...byMerchant.values()].sort((a, b) => b.total - a.total).slice(0, 5)

  const cashflow: MonthCashflow[] = monthRange(addMonths(month, -5), month).map((m) => {
    const income = incomeOfMonth(txs, m)
    const spending = spendingOfMonth(txs, m)
    return { month: m, income, spending, net: income - spending }
  })

  // Taux d'epargne du dernier mois complet (M-1)
  const rateMonth = addMonths(month, -1)
  const rateIncome = incomeOfMonth(txs, rateMonth)
  const rateSpending = spendingOfMonth(txs, rateMonth)
  const prevIncome = incomeOfMonth(txs, addMonths(month, -2))
  const prevSpending = spendingOfMonth(txs, addMonths(month, -2))
  const rate = rateIncome > 0 ? (rateIncome - rateSpending) / rateIncome : 0
  const prevRate = prevIncome > 0 ? (prevIncome - prevSpending) / prevIncome : 0

  return {
    month,
    spendingByGroup,
    totalSpending,
    prevTotalSpending,
    topMerchants,
    cashflow,
    savingsRate: {
      month: rateMonth,
      rate,
      prevRate,
      income: rateIncome,
      saved: rateIncome - rateSpending,
    },
  }
}
