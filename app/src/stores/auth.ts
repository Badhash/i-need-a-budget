// Etat d'auth partage (session Supabase). NON persiste : supabase-js gere deja
// sa propre persistance (localStorage sb-<ref>-auth-token). Ce store ne fait que
// diffuser la session courante aux composants (Header, garde de route).

import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'

export type AuthStatus = 'loading' | 'authed' | 'anon'

interface AuthState {
  status: AuthStatus
  session: Session | null
  setSession: (session: Session | null, ready?: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  session: null,
  setSession: (session, ready = true) =>
    set({ session, status: ready ? (session ? 'authed' : 'anon') : 'loading' }),
}))
