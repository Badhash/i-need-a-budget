import { ArrowLeftRight, Landmark, PieChart, PiggyBank, Settings, Wand2, type LucideIcon } from 'lucide-react'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/budget', label: 'Budget', icon: PiggyBank },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/comptes', label: 'Comptes', icon: Landmark },
  { to: '/rapports', label: 'Rapports', icon: PieChart },
]

// Elements secondaires (hors bottom nav mobile) : accessibles depuis la sidebar
// desktop et, pour les Règles, depuis une carte des Réglages sur mobile.
export const RULES_ITEM: NavItem = { to: '/regles', label: 'Règles', icon: Wand2 }
export const SETTINGS_ITEM: NavItem = { to: '/reglages', label: 'Réglages', icon: Settings }

export const PAGE_TITLES: Record<string, string> = {
  '/budget': 'Budget',
  '/transactions': 'Transactions',
  '/comptes': 'Comptes',
  '/rapports': 'Rapports',
  '/regles': 'Règles',
  '/reglages': 'Réglages',
}
