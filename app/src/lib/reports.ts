// Types de la vue Rapports. Les agregations sont calculees par l'Edge Function
// /api (getReports) ; ce module ne conserve que les definitions de types.

import type { CatColor } from '@/styles/themes'

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
