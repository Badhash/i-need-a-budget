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
  /** Compte archive (clos) : masque des listes et des selecteurs, solde nul. */
  closed?: boolean
}

export interface CategoryGroup {
  id: string
  name: string
  color: CatColor
  icon: GroupIcon
  sortOrder: number
  /** Groupe masque : ses categories sont masquees du budget et des selecteurs. */
  hidden?: boolean
}

export interface Category {
  id: string
  groupId: string
  name: string
  sortOrder: number
  /** true = categorie de revenus (contrat du moteur : porte par la categorie) */
  isIncome: boolean
  /** Categorie masquee (archivee) : hors grille et selecteurs, toujours comptee
   * par le moteur (son disponible reste dans le budget). */
  hidden?: boolean
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
  /** Contrepartie bancaire (nom du tiers fourni par la banque), si connue. */
  counterparty?: string | null
}
