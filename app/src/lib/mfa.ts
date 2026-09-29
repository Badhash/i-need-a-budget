// Niveau MFA d'une session, cote front (miroir de supabase/functions/api/mfa.ts).
//
// Une session dont l'utilisateur possede un facteur TOTP verifie n'est
// « complete » que si son jeton est de niveau aal2 (code saisi). Tant que ce
// n'est pas le cas, l'app ne doit ni entrer ni precharger le budget : le
// serveur refuse d'ailleurs ces jetons (403 mfa_required).

import type { Session } from '@supabase/supabase-js'

/** Claim `aal` du JWT (payload base64url), null si illisible. */
export function jwtAal(accessToken: string): string | null {
  const payload = accessToken.split('.')[1]
  if (!payload) return null
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded)) as { aal?: unknown }
    return typeof claims.aal === 'string' ? claims.aal : null
  } catch {
    return null
  }
}

/** True si aucun facteur verifie, ou si le jeton est deja aal2. */
export function mfaSatisfied(session: Session): boolean {
  const hasVerifiedFactor = (session.user.factors ?? []).some((f) => f.status === 'verified')
  if (!hasVerifiedFactor) return true
  return jwtAal(session.access_token) === 'aal2'
}
