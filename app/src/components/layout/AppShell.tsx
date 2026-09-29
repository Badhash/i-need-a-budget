import { Outlet, useRouterState } from '@tanstack/react-router'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { BottomNav, Fab } from '@/components/layout/BottomNav'
import { UpdateBanner } from '@/components/shared/UpdateBanner'
import { Toaster } from '@/components/shared/Toaster'
import { AddTransactionDialog } from '@/components/transactions/AddTransactionDialog'
import { EditTransactionDialog } from '@/components/transactions/EditTransactionDialog'
import { OnboardingPage } from '@/pages/OnboardingPage'
import { useThemeController } from '@/hooks/useTheme'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { useBootstrap } from '@/lib/data'
import { supabase } from '@/lib/supabase'

/**
 * Lueur d'aurore en haut de page (fixe, derriere tout le contenu) : donne sa
 * teinte au header vitre et a l'ecran, sans jamais gener la lecture.
 */
function TopAura() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[26rem] bg-[radial-gradient(55%_100%_at_50%_0%,rgb(var(--aura-1)/0.10),transparent_72%)] dark:bg-[radial-gradient(55%_100%_at_50%_0%,rgb(var(--aura-1)/0.16),transparent_72%)] lg:left-64"
    />
  )
}

export function AppShell() {
  useThemeController()
  useRealtimeSync()
  const boot = useBootstrap()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  // Etat vide : aucun compte -> onboarding (l'etape 1 seede les categories,
  // l'etape 2 cree le compte ; on reste sur l'onboarding tant qu'aucun compte
  // n'existe). La page Reglages reste accessible (theme, deconnexion).
  const needsOnboarding = boot.data !== undefined && boot.data.accounts.length === 0
  const showOnboarding = needsOnboarding && pathname !== '/reglages'

  // Onboarding = flow plein ecran, centre verticalement, SANS le chrome de l'app
  // (header, mois, navigation) qui n'a pas encore de sens. Sortie discrete.
  if (showOnboarding) {
    return (
      <div className="relative isolate flex min-h-app flex-col bg-bg">
        <TopAura />
        <main className="flex flex-1 items-center justify-center px-4 py-10">
          <OnboardingPage />
        </main>
        <button
          onClick={() => void supabase.auth.signOut()}
          className="pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 text-center text-[13px] font-medium text-soft transition-colors hover:text-ink"
        >
          Se déconnecter
        </button>
        <Toaster />
      </div>
    )
  }

  return (
    <div className="min-h-app">
      <TopAura />
      <Sidebar />
      <div className="lg:pl-64">
        <Header />
        <main className="mx-auto max-w-content px-4 pb-32 pt-6 lg:px-8 lg:pb-12">
          <UpdateBanner />
          {/* Fondu d'entree a chaque changement de page (opacite seule : une
              transformation ferait des elements fixed de la page des enfants
              positionnes le temps de l'animation). */}
          <div key={pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomNav />
      <Fab />
      <AddTransactionDialog />
      <EditTransactionDialog />
      <Toaster />
    </div>
  )
}
