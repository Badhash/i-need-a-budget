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
async function preloadAll(
  queryClient: QueryClient,
  onProgress: (completed: number, total: number) => void,
): Promise<void> {
  const months = monthRange(MIN_MONTH, MAX_MONTH)

  // Etape bloquante : la taxonomie doit exister avant d'adapter les budgets.
  // On la compte dans la progression globale. En cas d'echec, on entre quand
  // meme (les budgets seront alors ignores et se chargeront a la demande).
  let taxo: Bootstrap | undefined
  // bootstrap (1) + 5 lectures globales (transactions, objectifs, regles,
  // connexions bancaires, logs de sync) + budget & rapport de chaque mois.
  const total = 1 + 5 + months.length * 2
  let completed = 0
  const tick = () => onProgress(++completed, total)

  try {
    taxo = await queryClient.ensureQueryData({ queryKey: BOOTSTRAP_KEY, queryFn: fetchBootstrap })
  } catch {
    // Bootstrap indisponible : on n'echoue pas, mais on ne precharge pas les
    // budgets (ils requierent la taxonomie).
  }
  tick()

  const tasks: Promise<unknown>[] = [
    queryClient.prefetchQuery({ queryKey: TRANSACTIONS_KEY, queryFn: fetchTransactions }).finally(tick),
    queryClient.prefetchQuery({ queryKey: TARGETS_KEY, queryFn: fetchTargets }).finally(tick),
    queryClient.prefetchQuery({ queryKey: RULES_KEY, queryFn: fetchRules }).finally(tick),
    queryClient
      .prefetchQuery({ queryKey: BANK_CONNECTIONS_KEY, queryFn: fetchBankConnections })
      .finally(tick),
    queryClient.prefetchQuery({ queryKey: SYNC_LOGS_KEY, queryFn: fetchSyncLogs }).finally(tick),
  ]

  for (const m of months) {
    if (taxo) {
      const captured = taxo
      tasks.push(
        queryClient.prefetchQuery({ queryKey: budgetKey(m), queryFn: () => fetchBudgetMonth(m, captured) }).finally(tick),
      )
    } else {
      // Pas de taxonomie : on ne peut pas construire le budget, mais on marque
      // l'etape comme terminee pour que la progression atteigne 100 %.
      tick()
    }
    tasks.push(
      queryClient.prefetchQuery({ queryKey: reportsKey(m), queryFn: () => fetchReports(m) }).finally(tick),
    )
  }

  await Promise.allSettled(tasks)
}

/**
 * Porte de demarrage (utilisateur connecte) : precharge toutes les donnees de
 * fond avec une barre de progression, puis rend l'app. Le prechargement est
 * lance une seule fois (garde de ref, robuste au double-montage StrictMode).
 */
function AuthedBootGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0)
  const startedRef = useRef(false)

  useEffect(() => {
    // Garde de ref (et non un flag "cancelled" de nettoyage) : sous StrictMode
    // l'effet est monte/demonte/remonte. Un flag cancelled pose au nettoyage du
    // premier montage annulerait le seul prechargement reellement lance (le
    // second montage ressort ici immediatement), laissant l'app bloquee. La ref
    // garantit une unique execution qui va toujours jusqu'a `ready`.
    if (startedRef.current) return
    startedRef.current = true

    // Progression monotone : ensureQueryData/prefetchQuery sont idempotents (le
    // cache deduplique), donc un eventuel double appel ne fait jamais reculer la
    // barre.
    const onProgress = (done: number, total: number) => {
      setProgress((prev) => Math.max(prev, total > 0 ? (done / total) * 100 : 100))
    }

    void preloadAll(queryClient, onProgress).finally(() => {
      setProgress(100)
      setReady(true)
    })
  }, [queryClient])

  if (!ready) {
    return <AppLoader progress={progress} />
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
