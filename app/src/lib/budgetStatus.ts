// Statut d'enveloppe facon YNAB, derive de l'objectif et des trois colonnes du
// mois. Utilise par la grille budget (libelle a droite du nom + tonalite de la
// pastille Disponible). Aucune dependance UI : module pur.

import { neededThisMonth, type Target } from '@/lib/targets'
import { fmtEUR } from '@/lib/format'

export interface EnvelopeStatus {
  kind: 'overspent' | 'underfunded' | 'fullySpent' | 'onTrack'
  label: string
  /** Supplement a assigner ce mois pour honorer l'objectif (underfunded). */
  needed?: number
}

interface RowAmounts {
  assigned: number
  activity: number
  available: number
}

/**
 * Regles (alignees sur YNAB) :
 * - disponible < 0 -> Depassement (rouge) ;
 * - objectif pas encore finance ce mois -> "X manquants" (ambre) ;
 * - enveloppe alimentee puis entierement consommee -> "Entierement depense" ;
 * - objectif finance -> "En bonne voie" ;
 * - pas d'objectif et rien a signaler -> null (pas de libelle).
 */
export function envelopeStatus(
  target: Target | undefined,
  month: string,
  row: RowAmounts,
): EnvelopeStatus | null {
  if (row.available < 0) return { kind: 'overspent', label: 'Dépassement' }
  if (target) {
    const needed = neededThisMonth(target, month, row.assigned, row.available)
    if (needed > 0) return { kind: 'underfunded', label: `${fmtEUR(needed)} manquants`, needed }
    if (row.available === 0 && row.assigned > 0)
      return { kind: 'fullySpent', label: 'Entièrement dépensé' }
    return { kind: 'onTrack', label: 'En bonne voie' }
  }
  if (row.available === 0 && row.assigned > 0)
    return { kind: 'fullySpent', label: 'Entièrement dépensé' }
  return null
}

/**
 * Ratio [0..1] pour l'anneau de progression de la pastille Disponible :
 * avec objectif, part financee de la cible (assigne du mois pour monthly,
 * disponible cumule pour byDate) ; sans objectif, part restante de ce qui a
 * ete alimente (disponible / (disponible + depense)).
 */
export function fundedRatio(target: Target | undefined, row: RowAmounts): number {
  if (row.available <= 0) return 0
  if (target && target.amount > 0) {
    const funded = target.type === 'monthly' ? row.assigned : row.available
    return Math.min(Math.max(funded / target.amount, 0), 1)
  }
  const spent = Math.max(-row.activity, 0)
  const base = row.available + spent
  return base > 0 ? Math.min(row.available / base, 1) : 1
}

/** Tonalite de la pastille Disponible selon le statut (couleurs du theme INAB). */
export function pillTone(
  status: EnvelopeStatus | null,
  available: number,
): 'success' | 'warning' | 'neutral' | 'danger' {
  if (available < 0) return 'danger'
  if (available > 0) return 'success'
  if (status?.kind === 'underfunded') return 'warning'
  return 'neutral'
}
