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
          void queryClient.invalidateQueries()
        })
        .subscribe()
    })()

    return () => {
      active = false
      if (channel) void supabase.removeChannel(channel)
    }
  }, [queryClient])
}
