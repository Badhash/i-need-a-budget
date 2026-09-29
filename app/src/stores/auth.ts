// Etat d'auth partage (session Supabase). NON persiste : supabase-js gere deja
// sa propre persistance (localStorage sb-<ref>-auth-token). Ce store ne fait que
// diffuser la session courante aux composants (Header, garde de route).

import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { mfaSatisfied } from '@/lib/mfa'

// 'mfa' : session presente mais verification en deux etapes non passee (jeton
// aal1 avec un facteur verifie). Traite comme non connecte par la garde de
// route : la page de connexion enchaine directement sur la saisie du code, et
// rien n'est precharge avec ce jeton (le serveur le refuserait de toute facon).
type AuthStatus = 'loading' | 'authed' | 'mfa' | 'anon'

interface AuthState {
  status: AuthStatus
  session: Session | null
  setSession: (session: Session | null, ready?: boolean) => void
}

function statusOf(session: Session | null): AuthStatus {
  if (!session) return 'anon'
  return mfaSatisfied(session) ? 'authed' : 'mfa'
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  session: null,
  setSession: (session, ready = true) =>
    set({ session, status: ready ? statusOf(session) : 'loading' }),
}))
