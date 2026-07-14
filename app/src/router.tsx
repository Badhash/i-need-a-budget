import {
  createHashHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { AppShell } from '@/components/layout/AppShell'
import { LoginPage } from '@/pages/LoginPage'
import { BudgetPage } from '@/pages/BudgetPage'
import { TransactionsPage } from '@/pages/TransactionsPage'
import { AccountsPage } from '@/pages/AccountsPage'
import { ReportsPage } from '@/pages/ReportsPage'
import { RulesPage } from '@/pages/RulesPage'
import { SettingsPage } from '@/pages/SettingsPage'

interface RouterAuthContext {
  auth: { isAuthenticated: boolean; userId: string | null }
}

const rootRoute = createRootRouteWithContext<RouterAuthContext>()({
  component: () => <Outlet />,
})

// Route publique : la page de login vit HORS de la garde.
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

// Layout protege (pathless) : porte AppShell + la garde d'auth. Toutes les
// pages metier en sont enfants.
const protectedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_app',
  component: AppShell,
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: '/login' })
    }
  },
})

// Persistance de la page courante : au hard refresh, on revient sur la
// derniere page visitee au lieu de retomber sur /budget.
const LAST_PATH_KEY = 'inab:last-path'
const LAST_PATH_WHITELIST = [
  '/budget',
  '/transactions',
  '/comptes',
  '/rapports',
  '/regles',
  '/reglages',
] as const

type LastPath = (typeof LAST_PATH_WHITELIST)[number]

/** Chemin sauvegarde s'il est en liste blanche, sinon /budget. */
export function readLastPath(): LastPath {
  try {
    const saved = window.localStorage.getItem(LAST_PATH_KEY)
    if (saved && (LAST_PATH_WHITELIST as readonly string[]).includes(saved)) {
      return saved as LastPath
    }
  } catch {
    // localStorage indisponible : on retombe sur le budget.
  }
  return '/budget'
}

const indexRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: readLastPath() })
  },
})

const budgetRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/budget',
  component: BudgetPage,
})

export const transactionsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/transactions',
  component: TransactionsPage,
  // Pre-filtres de la liste, tous optionnels et combinables :
  //   ?compte=<id>     (navigation depuis Comptes)
  //   ?categorie=<id>  (clic sur une activite du Budget)
  //   ?mois=YYYY-MM    (clic sur une activite du Budget)
  // Les valeurs vides sont ignorees (cle absente = pas de filtre).
  validateSearch: (
    search: Record<string, unknown>,
  ): { compte?: string; categorie?: string; mois?: string } => {
    const out: { compte?: string; categorie?: string; mois?: string } = {}
    if (typeof search.compte === 'string' && search.compte) out.compte = search.compte
    if (typeof search.categorie === 'string' && search.categorie) out.categorie = search.categorie
    if (typeof search.mois === 'string' && search.mois) out.mois = search.mois
    return out
  },
})

const accountsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/comptes',
  component: AccountsPage,
})

const reportsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/rapports',
  component: ReportsPage,
})

const rulesRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/regles',
  component: RulesPage,
})

const settingsRoute = createRoute({
  getParentRoute: () => protectedRoute,
  path: '/reglages',
  component: SettingsPage,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedRoute.addChildren([
    indexRoute,
    budgetRoute,
    transactionsRoute,
    accountsRoute,
    reportsRoute,
    rulesRoute,
    settingsRoute,
  ]),
])

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  context: { auth: { isAuthenticated: false, userId: null } },
})

// Sauvegarde du chemin courant a chaque navigation aboutie (uniquement les
// pages metier en liste blanche : ni /login ni la racine).
router.subscribe('onResolved', ({ toLocation }) => {
  const path = toLocation.pathname
  if ((LAST_PATH_WHITELIST as readonly string[]).includes(path)) {
    try {
      window.localStorage.setItem(LAST_PATH_KEY, path)
    } catch {
      // localStorage indisponible : la persistance est un confort, pas un besoin.
    }
  }
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
