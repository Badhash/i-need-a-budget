import type { Account, Category, CategoryGroup, Transaction } from '@/types/domain'
import { parseBankLabel, type ParsedLabel } from '@/lib/bankLabel'

export interface TxRow {
  tx: Transaction
  account: Account
  category: Category | null
  group: CategoryGroup | null
  parsed: ParsedLabel
}

export type Maps = {
  accountById: Map<string, Account>
  categoryById: Map<string, Category>
  groupById: Map<string, CategoryGroup>
}

export function toRow(tx: Transaction, maps: Maps): TxRow | null {
  const account = maps.accountById.get(tx.accountId)
  if (!account) return null
  const category = tx.categoryId ? (maps.categoryById.get(tx.categoryId) ?? null) : null
  const group = category ? (maps.groupById.get(category.groupId) ?? null) : null
  return { tx, account, category, group, parsed: parseBankLabel(tx.label) }
}

export const PAGE_SIZE = 50

/** Recherche insensible a la casse ET aux accents (« epargne » trouve « Épargne »). */
export function normSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export const MOBILE_CHUNK = 50
