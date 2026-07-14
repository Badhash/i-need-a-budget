// Types du domaine metier (comptes, groupes, categories, transactions).
// Aucune donnee : uniquement les definitions de types partagees par l'app.

import type { CatColor } from '@/styles/themes'

export type GroupIcon = 'home' | 'car' | 'sparkles' | 'repeat' | 'piggy' | 'banknote'
export type AccountKind = 'checking' | 'savings' | 'investment' | 'card_deferred'

export interface Account {
  id: string
  name: string
  institution: string
  kind: AccountKind
  onBudget: boolean
  openingBalance: number // centimes, au 31/01/2026
}

export interface CategoryGroup {
  id: string
  name: string
  color: CatColor
  icon: GroupIcon
  sortOrder: number
}

export interface Category {
  id: string
  groupId: string
  name: string
  sortOrder: number
  /** true = categorie de revenus (contrat du moteur : porte par la categorie) */
  isIncome: boolean
}

export interface Transaction {
  id: string
  accountId: string
  date: string // YYYY-MM-DD
  label: string
  categoryId: string | null
  amount: number // centimes, negatif = depense
  /** non nul = moitie d'un transfert lie (contrat du moteur) */
  transferGroupId?: string | null
  note?: string
}
