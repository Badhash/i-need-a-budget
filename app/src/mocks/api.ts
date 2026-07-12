// API mockee : simule l'Edge Function /api (latence artificielle, etat en
// memoire mutable pour que les editions persistent pendant la session).

import {
  accounts,
  buildAssignments,
  buildTransactions,
  type Account,
  type Assignments,
  type Transaction,
} from '@/mocks/data'
import { computeBudgetMonth, type BudgetMonth } from '@/lib/budget'
import { computeReports, type ReportsData } from '@/lib/reports'
import { monthOf, TODAY } from '@/lib/format'

const LATENCY_MS = 350

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

let txs: Transaction[] = buildTransactions()
let assigns: Assignments = buildAssignments()
let manualSeq = 0

export interface AccountWithBalance extends Account {
  balance: number
}

export async function apiGetBudgetMonth(month: string): Promise<BudgetMonth> {
  await sleep(LATENCY_MS)
  return computeBudgetMonth(month, txs, assigns)
}

export async function apiGetTransactions(): Promise<Transaction[]> {
  await sleep(LATENCY_MS)
  return [...txs]
}

export async function apiGetAccounts(): Promise<AccountWithBalance[]> {
  await sleep(LATENCY_MS)
  return accounts.map((acc) => ({
    ...acc,
    balance:
      acc.openingBalance + txs.filter((t) => t.accountId === acc.id).reduce((s, t) => s + t.amount, 0),
  }))
}

export async function apiGetReports(month: string): Promise<ReportsData> {
  await sleep(LATENCY_MS)
  return computeReports(month, txs)
}

export async function apiSetAssigned(input: {
  categoryId: string
  month: string
  amount: number
}): Promise<void> {
  await sleep(150)
  assigns = {
    ...assigns,
    [input.month]: { ...(assigns[input.month] ?? {}), [input.categoryId]: input.amount },
  }
}

export interface NewTransactionInput {
  accountId: string
  date: string
  label: string
  categoryId: string | null
  amount: number // centimes signes
  note?: string
}

export async function apiAddTransaction(input: NewTransactionInput): Promise<Transaction> {
  await sleep(250)
  const tx: Transaction = { id: `tx-manual-${++manualSeq}`, ...input }
  txs = [tx, ...txs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return tx
}

export async function apiCategorize(txId: string, categoryId: string | null): Promise<void> {
  await sleep(150)
  txs = txs.map((t) => (t.id === txId ? { ...t, categoryId } : t))
}

export async function apiResetDemo(): Promise<void> {
  await sleep(200)
  txs = buildTransactions()
  assigns = buildAssignments()
}

export function uncategorizedCount(list: Transaction[]): number {
  return list.filter(
    (t) => !t.categoryId && !t.transferGroupId && monthOf(t.date) <= monthOf(TODAY),
  ).length
}
