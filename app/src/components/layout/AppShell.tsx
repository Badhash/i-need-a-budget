import { Outlet, useRouterState } from '@tanstack/react-router'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { BottomNav, Fab } from '@/components/layout/BottomNav'
import { AddTransactionDialog } from '@/components/transactions/AddTransactionDialog'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { useThemeController } from '@/hooks/useTheme'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { useBootstrap } from '@/lib/data'

export function AppShell() {
  useThemeController()
  useRealtimeSync()
  const boot = useBootstrap()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Etat vide : aucun compte -> onboarding (l'etape 1 seede les categories,
  // l'etape 2 cree le compte ; on reste sur l'onboarding tant qu'aucun compte
  // n'existe). La page Reglages reste accessible (deconnexion).
  const needsOnboarding = boot.data !== undefined && boot.data.accounts.length === 0
  const showOnboarding = needsOnboarding && pathname !== '/reglages'

  return (
    <div className="min-h-dvh">
      <Sidebar />
      <div className="lg:pl-64">
        <Header />
        <main className="mx-auto max-w-content px-4 pb-32 pt-6 lg:px-8 lg:pb-12">
          {showOnboarding ? <OnboardingPage /> : <Outlet />}
        </main>
      </div>
      <BottomNav />
      <Fab />
      <AddTransactionDialog />
    </div>
  )
}
