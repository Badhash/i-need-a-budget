import { useEffect, useRef } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { router } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { bankFinalizeAuth } from '@/lib/bank'

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
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg">
        <Loader2 className="h-6 w-6 animate-spin text-soft" />
      </div>
    )
  }

  return (
    <RouterProvider
      router={router}
      context={{
        auth: { isAuthenticated: status === 'authed', userId: session?.user.id ?? null },
      }}
    />
  )
}
