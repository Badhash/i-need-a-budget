// Mode demonstration : session factice et neutralisation de Supabase Auth.
//
// La session est posee de facon SYNCHRONE dans le store d'auth avant le
// premier rendu (statut 'authed' d'emblee : aucun facteur MFA, donc niveau
// satisfait). Les quelques composants qui interrogent Supabase Auth en direct
// (email du compte, facteurs MFA, deconnexion, page de connexion) recoivent des
// reponses locales : aucune requete ne part vers Supabase.

import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'

export const DEMO_SESSION: Session = {
  access_token: 'demo-access-token',
  refresh_token: 'demo-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 4_102_444_800, // 2100-01-01 : jamais expiree
  user: {
    id: 'demo-user',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'demo@exemple.fr',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    factors: [],
  },
}

const unavailable = () => ({ data: null, error: new Error('Indisponible en mode démonstration.') })

/** Remplace les methodes Auth utilisees par l'app par des reponses locales. */
function stubSupabaseAuth(): void {
  const user = DEMO_SESSION.user
  const auth = supabase.auth as unknown as Record<string, unknown>
  auth.getSession = async () => ({ data: { session: DEMO_SESSION }, error: null })
  auth.getUser = async () => ({ data: { user }, error: null })
  auth.refreshSession = async () => ({ data: { session: DEMO_SESSION, user }, error: null })
  auth.signInWithPassword = async () => ({ data: { session: DEMO_SESSION, user }, error: null })
  // Deconnexion sans effet : la page de connexion retrouve la session et
  // renvoie aussitot vers l'app.
  auth.signOut = async () => ({ error: null })
  auth.onAuthStateChange = () => ({
    data: { subscription: { id: 'demo', callback: () => undefined, unsubscribe: () => undefined } },
  })
  const mfa = supabase.auth.mfa as unknown as Record<string, unknown>
  mfa.listFactors = async () => ({ data: { all: [], totp: [], phone: [] }, error: null })
  mfa.getAuthenticatorAssuranceLevel = async () => ({
    data: { currentLevel: 'aal1', nextLevel: 'aal1', currentAuthenticationMethods: [] },
    error: null,
  })
  mfa.enroll = async () => unavailable()
  mfa.challenge = async () => unavailable()
  mfa.verify = async () => unavailable()
  mfa.unenroll = async () => unavailable()
}

/** Pose la session factice dans le store d'auth (synchrone). */
export function installDemoSession(): void {
  stubSupabaseAuth()
  useAuthStore.getState().setSession(DEMO_SESSION)
}
