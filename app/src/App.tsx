import { useEffect, useRef, type ReactNode } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { router } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { bankFinalizeAuth } from '@/lib/bank'
import { useBootstrap, useBudgetMonth, useTransactions } from '@/lib/data'
import { useUiStore } from '@/stores/ui'
import { AppLoader } from '@/components/shared/AppLoader'

/**
 * Porte de demarrage (utilisateur connecte) : precharge les donnees de fond
 * — comptes, budget du mois courant, transactions — et affiche l'ecran de
 * chargement tant qu'elles ne sont pas pretes. Une fois le cache TanStack
 * peuple, la navigation entre les vues est instantanee. Sur une base
 * volumineuse (milliers de transactions), evite d'afficher des pages a moitie
 * remplies.
 */
function AuthedBootGate({ children }: { children: ReactNode }) {
  const month = useUiStore((s) => s.month)
  const boot = useBootstrap()
  const budget = useBudgetMonth(month)
  const transactions = useTransactions()

  // On attend le socle (comptes) + le budget du mois affiche par defaut. Les
  // transactions se chargent en parallele ; une erreur ne bloque jamais l'entree
  // dans l'app (les vues gerent leurs propres etats vides/erreur).
  if (boot.isLoading || budget.isLoading || transactions.isLoading) {
    return <AppLoader />
  }
  return <>{children}</>
}

export function App() {
  const queryClient = useQueryClient()
  const status = useAuthStore((s) => s.status)
  const session = useAuthStore((s) => s.session)
  const setSession = useAuthStore((s) => s.setSession)

  useEffect(() => {
    let prevUserId: string | null = null

    void supabase.auth.getSession().then(({ data }) => {
      prevUserId = data.session?.user.id ?? null
      setSession(data.session)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const uid = nextSession?.user.id ?? null
      // Vider le cache uniquement au changement d'identite (login/logout),
      // pas a chaque rafraichissement de token.
      if (uid !== prevUserId) {
        queryClient.clear()
        prevUserId = uid
      }
      setSession(nextSession)
    })

    return () => subscription.unsubscribe()
  }, [queryClient, setSession])

  // Rejouer les gardes de route a chaque changement de session.
  useEffect(() => {
    void router.invalidate()
  }, [session])

  // Capture du code OAuth renvoye par Enable Banking au retour du consentement.
  // Le redirect PSD2 arrive sur origin+pathname (avant le fragment du
  // hash-router), donc on lit window.location.search et non le hash. Une seule
  // prise en charge par apparition du code, quel que soit le nombre de rendus.
  const finalizedCodeRef = useRef<string | null>(null)
  useEffect(() => {
    if (status !== 'authed') return
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code || finalizedCodeRef.current === code) return
    finalizedCodeRef.current = code

    void (async () => {
      try {
        await bankFinalizeAuth(code)
        await queryClient.invalidateQueries({ queryKey: ['bankConnections'] })
        // Retour de consentement : ramener l'utilisateur sur les reglages
        // (section bancaire), pas sur le budget.
        void router.navigate({ to: '/reglages' })
      } catch (err) {
        // Echec silencieux : un retour de consentement ne doit jamais casser l'app.
        console.error('Finalisation de la connexion bancaire echouee', err)
      } finally {
        // Nettoyer l'URL (retirer code/state) sans recharger ni toucher au hash.
        params.delete('code')
        params.delete('state')
        const search = params.toString()
        const cleanUrl =
          window.location.origin +
          window.location.pathname +
          (search ? `?${search}` : '') +
          window.location.hash
        window.history.replaceState(null, '', cleanUrl)
      }
    })()
  }, [status, queryClient])

  if (status === 'loading') {
    return <AppLoader message="Connexion…" />
  }

  const routerTree = (
    <RouterProvider
      router={router}
      context={{
        auth: { isAuthenticated: status === 'authed', userId: session?.user.id ?? null },
      }}
    />
  )

  // Connecte : on precharge les donnees derriere l'ecran de chargement. Non
  // connecte : acces direct au routeur (page de connexion).
  return status === 'authed' ? <AuthedBootGate>{routerTree}</AuthedBootGate> : routerTree
}
