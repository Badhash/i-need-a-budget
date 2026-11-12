// Niveau d'assurance MFA d'une requete, partage par /api et sync-bank.
//
// Le jeton a DEJA ete verifie par auth.getUser() : on ne fait ici que lire son
// claim `aal`. Un utilisateur qui possede un facteur TOTP verifie doit avoir
// passe la verification en deux etapes (aal2) ; un jeton aal1 (mot de passe
// seul, obtenu hors de l'app) est refuse par l'appelant.

interface FactorLike {
  status?: string
}

/** Claims du JWT (payload base64url), {} si illisible. Jamais une decision d'identite. */
export function jwtClaims(authHeader: string): Record<string, unknown> {
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  const payload = token.split('.')[1]
  if (!payload) return {}
  try {
    const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)))
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * True si le jeton est aal2, ou si l'utilisateur n'a aucun facteur verifie.
 *
 * Secret optionnel REQUIRE_MFA=1 : le second facteur devient OBLIGATOIRE, meme
 * sans facteur enrole (fail-closed). Sans lui, un compte dont le TOTP n'est pas
 * (ou plus) enrole s'ouvre au mot de passe seul, et un attaquant qui le connait
 * peut enroler son propre facteur. A activer une fois le TOTP enrole.
 */
export function mfaLevelSatisfied(
  authHeader: string,
  user: { factors?: FactorLike[] | null },
): boolean {
  const required = (Deno.env.get('REQUIRE_MFA') ?? '').trim() === '1'
  const hasVerifiedFactor = (user.factors ?? []).some((f) => f.status === 'verified')
  if (!hasVerifiedFactor && !required) return true
  return jwtClaims(authHeader).aal === 'aal2'
}
