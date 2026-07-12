import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router'
import { AppShell } from '@/components/layout/AppShell'
import { BudgetPage } from '@/pages/BudgetPage'
import { TransactionsPage } from '@/pages/TransactionsPage'
import { AccountsPage } from '@/pages/AccountsPage'
import { ReportsPage } from '@/pages/ReportsPage'
import { SettingsPage } from '@/pages/SettingsPage'

const rootRoute = createRootRoute({
  component: AppShell,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/budget' })
  },
})

const budgetRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/budget',
  component: BudgetPage,
})

const transactionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/transactions',
  component: TransactionsPage,
})

const accountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/comptes',
  component: AccountsPage,
})

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rapports',
  component: ReportsPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reglages',
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  budgetRoute,
  transactionsRoute,
  accountsRoute,
  reportsRoute,
  settingsRoute,
])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
