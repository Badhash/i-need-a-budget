import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { router } from '@/router'
import { useAuthStore } from '@/stores/auth'
import {
  BANK_CONNECTIONS_KEY,
  SYNC_LOGS_KEY,
  bankFinalizeAuth,
  fetchBankConnections,
  fetchSyncLogs,
} from '@/lib/bank'
import {
  BOOTSTRAP_KEY,
  TRANSACTIONS_KEY,
  budgetKey,
  fetchBootstrap,
  fetchBudgetMonth,
  fetchReports,
  fetchTransactions,
  reportsKey,
  type Bootstrap,
} from '@/lib/data'
import { RULES_KEY, fetchRules } from '@/lib/rules'
import { TARGETS_KEY, fetchTargets } from '@/lib/targets'
import { MAX_MONTH, MIN_MONTH } from '@/lib/format'
import { monthRange } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { AppLoader } from '@/components/shared/AppLoader'

/**
 * Precharge en parallele TOUTES les donnees atteignables de l'app dans le cache
 * TanStack, en incrementant `onProgress` au fil des queries terminees. Objectif :
 * apres cet ecran, toute navigation (changer de mois passe/futur, ouvrir
 * n'importe quelle page) est instantanee, sans spinner ni refetch visible.
 *
 * La bootstrap (taxonomie) est chargee d'abord car les budgets en dependent
 * (adaptation forme plate -> groupee). Le reste part en parallele via
 * Promise.allSettled : une query en erreur ne bloque JAMAIS l'entree dans l'app,
 * les vues gerent leurs propres etats vides/erreur.
 *
 * Prechargement (par mois de MIN_MONTH a MAX_MONTH inclus) : bootstrap,
 * transactions, objectifs, regles, connexions bancaires, logs de sync, budget de
 * chaque mois, rapport de chaque mois.
 */
// Prechargement CRITIQUE (bloque le loader, mais rapide) : le strict minimum
// pour afficher la premiere page (Budget du mois courant) — taxonomie, budget du
// mois affiche, transactions. On n'attend PAS tous les mois/rapports : l'ancienne
// approche (tout precharger avant d'entrer) faisait patienter 20-30 s a chaque
// lancement. Renvoie la taxonomie pour enchainer le prechargement de fond.
async function preloadCritical(
  queryClient: QueryClient,
  month: string,
): Promise<Bootstrap | undefined> {
  let taxo: Bootstrap | undefined
  try {
    taxo = await queryClient.ensureQueryData({ queryKey: BOOTSTRAP_KEY, queryFn: fetchBootstrap })
  } catch {
    // Bootstrap indisponible : on entre quand meme, les vues gerent leurs etats.
  }
  await Promise.allSettled([
    queryClient.prefetchQuery({ queryKey: TRANSACTIONS_KEY, queryFn: fetchTransactions }),
    taxo
      ? queryClient.prefetchQuery({
          queryKey: budgetKey(month),
          queryFn: () => fetchBudgetMonth(month, taxo as Bootstrap),
        })
      : Promise.resolve(),
  ])
  return taxo
}

// Prechargement de FOND (non bloquant) : lance APRES l'entree dans l'app, sans
// aucun loader. Rechauffe silencieusement les autres mois de budget, tous les
// rapports, et les donnees secondaires (objectifs, regles, banque). Grace au
// staleTime long, naviguer vers un autre mois est alors instantane ; et si un
// mois n'est pas encore chaud, sa vue affiche brievement son propre squelette
// au lieu de bloquer TOUT le demarrage.
function preloadRest(queryClient: QueryClient, taxo: Bootstrap | undefined, currentMonth: string): void {
  const tasks: Promise<unknown>[] = [
    queryClient.prefetchQuery({ queryKey: TARGETS_KEY, queryFn: fetchTargets }),
    queryClient.prefetchQuery({ queryKey: RULES_KEY, queryFn: fetchRules }),
    queryClient.prefetchQuery({ queryKey: BANK_CONNECTIONS_KEY, queryFn: fetchBankConnections }),
    queryClient.prefetchQuery({ queryKey: SYNC_LOGS_KEY, queryFn: fetchSyncLogs }),
  ]
  for (const m of monthRange(MIN_MONTH, MAX_MONTH)) {
    if (taxo && m !== currentMonth) {
      const captured = taxo
      tasks.push(
        queryClient.prefetchQuery({ queryKey: budgetKey(m), queryFn: () => fetchBudgetMonth(m, captured) }),
      )
    }
    tasks.push(queryClient.prefetchQuery({ queryKey: reportsKey(m), queryFn: () => fetchReports(m) }))
  }
  void Promise.allSettled(tasks)
}

/**
 * Porte de demarrage (utilisateur connecte) : attend UNIQUEMENT le strict
 * necessaire (mois courant), rend l'app, puis rechauffe le reste en fond. Lance
 * une seule fois (garde de ref, robuste au double-montage StrictMode).
 */
function AuthedBootGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const month = useUiStore((s) => s.month)
  const [ready, setReady] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void preloadCritical(queryClient, month).then((taxo) => {
      setReady(true)
      preloadRest(queryClient, taxo, month)
    })
    // `month` lu une seule fois (garde de ref) : c'est le mois affiche au demarrage.
  }, [queryClient, month])

  if (!ready) {
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
