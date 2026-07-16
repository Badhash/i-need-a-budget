// Coordination entre ecritures locales et reconciliation Realtime.
//
// Chaque ecriture locale (mutation via /api) est DEJA refletee dans le cache
// TanStack par une mise a jour OPTIMISTE. Le signal Realtime qu'elle provoque
// (trigger Postgres -> broadcast) est donc REDONDANT : le refetch qu'il
// declencherait renverrait exactement les memes chiffres, en retelechargeant
// toute la table chiffree (cout d'egress majeur, cf. free tier Supabase).
//
// On memorise l'instant de la derniere ecriture locale. useRealtimeSync s'en
// sert pour COALESCER une rafale d'ecritures locales en une seule
// reconciliation (une fois l'activite calmee), au lieu d'un refetch par clic.
// Les signaux "externes" (sync bancaire, autre appareil) tombent en dehors de
// cette fenetre et sont reconcilies normalement.

let lastLocalWriteAt = 0

/** A appeler juste avant/apres une ecriture locale via /api. */
export function markLocalWrite(): void {
  lastLocalWriteAt = Date.now()
}

/** Millisecondes ecoulees depuis la derniere ecriture locale. */
export function msSinceLocalWrite(): number {
  return Date.now() - lastLocalWriteAt
}
