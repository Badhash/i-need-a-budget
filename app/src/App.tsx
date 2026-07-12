import { useEffect } from 'react'
import { RouterProvider } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { router } from '@/router'
import { useAuthStore } from '@/stores/auth'

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
