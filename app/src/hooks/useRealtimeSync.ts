// Abonnement au signal Realtime prive : broadcast VIDE sur le topic
// changes:<user_id>. A reception, on invalide les queries TanStack -> refetch
// via /api. Aucune donnee metier ne transite par le canal.

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export function useRealtimeSync() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let channel: RealtimeChannel | null = null
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null

    // Reconciliation debouncee : une rafale d'ecritures (ex. plusieurs
    // assignations d'affilee, ou un import de 50 lignes) declenche UN seul
    // refetch ~300ms apres la derniere. Combine aux mises a jour optimistes,
    // l'UI reste instantanee et le reseau discret (voir CLAUDE.md, reactivite).
    const scheduleInvalidate = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void queryClient.invalidateQueries()
      }, 300)
    }

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session || !active) return

      // Canal prive : le token doit etre transmis a Realtime pour passer la RLS
      // de realtime.messages (sinon le join est refuse silencieusement).
      await supabase.realtime.setAuth(session.access_token)

      channel = supabase
        .channel(`changes:${session.user.id}`, { config: { private: true } })
        .on('broadcast', { event: 'db-change' }, () => {
          scheduleInvalidate()
        })
        .subscribe()
    })()

    return () => {
      active = false
      if (timer) clearTimeout(timer)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [queryClient])
}
