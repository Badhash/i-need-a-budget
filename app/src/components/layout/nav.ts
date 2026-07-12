import { ArrowLeftRight, Landmark, PieChart, PiggyBank, Settings, type LucideIcon } from 'lucide-react'

export interface NavItem {
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

export const SETTINGS_ITEM: NavItem = { to: '/reglages', label: 'Réglages', icon: Settings }

export const PAGE_TITLES: Record<string, string> = {
  '/budget': 'Budget',
  '/transactions': 'Transactions',
  '/comptes': 'Comptes',
  '/rapports': 'Rapports',
  '/reglages': 'Réglages',
}
