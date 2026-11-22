// Virements importes des deux cotes : une sortie sur un compte et une entree
// du MEME montant sur un autre compte, a quelques jours d'ecart (delai
// bancaire), sans etre relies. Notion partagee par :
//   - le perimetre des rapports (lib/exceptional.ts) : ces paires non reliees
//     sont ecartees des depenses et des revenus ;
//   - « Convertir en virement » : l'operation existante du compte cible est
//     reliee au lieu de creer un miroir, qui doublerait le solde du compte
//     d'arrivee (fonctionnalite serveur linkTransfers).
//
// Module pur (aucune dependance React), montants en centimes.

import type { Transaction } from '@/types/domain'

/** Ecart de dates maximal entre les deux moities d'une paire (jours). */
export const TRANSFER_PAIR_MAX_DAYS = 3

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86_400_000
}

/** Ecart absolu en jours entre deux dates YYYY-MM-DD. */
export function dayGap(a: string, b: string): number {
  return Math.abs(dayNumber(a) - dayNumber(b))
}

/**
 * Operation du compte `targetAccountId` qui forme avec `tx` un virement
 * importe des deux cotes : montant exactement oppose, a TRANSFER_PAIR_MAX_DAYS
 * jours au plus, pas deja moitie d'un virement. La plus proche en date (a ecart
 * egal, la premiere de la liste) ; null si aucune.
 */
export function findTransferCounterpart(
  txs: readonly Transaction[],
  tx: Pick<Transaction, 'id' | 'accountId' | 'amount' | 'date'>,
  targetAccountId: string,
): Transaction | null {
  if (tx.amount === 0 || tx.accountId === targetAccountId) return null
  let best: Transaction | null = null
  let bestGap = Infinity
  for (const t of txs) {
    if (t.accountId !== targetAccountId || t.amount !== -tx.amount || t.transferGroupId || t.id === tx.id) continue
    const gap = dayGap(t.date, tx.date)
    if (gap <= TRANSFER_PAIR_MAX_DAYS && gap < bestGap) {
      best = t
      bestGap = gap
    }
  }
  return best
}
