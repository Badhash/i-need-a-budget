// Abonnement au signal Realtime prive : broadcast VIDE sur le topic
// changes:<user_id>. A reception, on invalide les queries TanStack -> refetch
// via /api. Aucune donnee metier ne transite par le canal.

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { msSinceLocalWrite } from '@/lib/realtimeGate'

// Fenetre de silence : un signal Realtime qui tombe dans les QUIET_WINDOW_MS
// apres une ecriture LOCALE est considere comme l'echo de cette ecriture. Le
// cache optimiste etant deja exact, on ne reconcilie pas immediatement ; on
// attend que l'activite se calme pour ne faire qu'UN seul refetch de securite.
// Cela evite de retelecharger toute la table chiffree a chaque clic (le poste
// d'egress dominant sur le free tier). Les signaux SANS ecriture locale recente
// (sync bancaire, autre appareil) sont, eux, reconcilies promptement.
//
// Fenetre volontairement large (30s) : elle ne retarde QUE la reconciliation de
// tes propres ecritures, deja refletees a l'ecran (aucun effet visible). Plus
// elle est large, plus une longue session d'edition se coalesce en un seul
// refetch. Un changement externe survenant pendant ton activite est reconcilie
// au plus tard a la fin de la fenetre ; hors activite, il l'est en 300ms.
const QUIET_WINDOW_MS = 30000
const EXTERNAL_DEBOUNCE_MS = 300

export function useRealtimeSync() {
  const queryClient = useQueryClient()

  useEffect(() => {
    let channel: RealtimeChannel | null = null
    let active = true
    let timer: ReturnType<typeof setTimeout> | null = null

    // Planifie la reconciliation en fonction de l'origine probable du signal :
    // - ecriture locale recente -> on repousse jusqu'a la fin de la fenetre de
    //   silence ; tant que tu cliques, le refetch est differe, puis UN seul
    //   refetch tombe une fois l'activite calmee (rafale coalescee).
    // - aucune ecriture locale recente (= changement externe) -> petit debounce
    //   puis refetch, pour refleter vite la nouveaute (ex. sync bancaire).
    const scheduleInvalidate = () => {
      if (timer) clearTimeout(timer)
      const since = msSinceLocalWrite()
      const delay = since < QUIET_WINDOW_MS ? QUIET_WINDOW_MS - since : EXTERNAL_DEBOUNCE_MS
      timer = setTimeout(() => {
        // Une nouvelle ecriture locale a pu tomber pendant l'attente : on
        // repousse encore tant qu'on est dans la fenetre de silence.
        if (msSinceLocalWrite() < QUIET_WINDOW_MS) {
          scheduleInvalidate()
          return
        }
        timer = null
        void queryClient.invalidateQueries()
      }, delay)
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
