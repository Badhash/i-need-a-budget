// Emplacement de retour UNIQUE de la page Transactions : un seul toast a la
// fois (categorisation, application aux similaires, suppression, virement),
// le suivant remplace le precedent en place. Il porte « Annuler » et, apres
// une categorisation, les actions de suite (appliquer aux N autres, creer une
// regle) : deux toasts ne se chevauchent jamais.
//
// Suppression differee : la ligne disparait tout de suite, l'appel serveur
// part a l'EXPIRATION du toast (minuterie ecoulee, fermeture, remplacement,
// page quittee ou masquee). « Annuler » la restaure sans aucun appel.
// Des suppressions rapprochees se cumulent dans le meme toast (« 3
// transactions supprimées ») et s'annulent ensemble.

import { create } from 'zustand'
import type { QueryClient } from '@tanstack/react-query'
import type { Transaction } from '@/types/domain'
import { commitPendingDeletes, removeTxPending, restorePendingDeletes } from '@/lib/transactions'
import { parseBankLabel } from '@/lib/bankLabel'
import { merchantName } from './txRow'
import { haptic } from '@/lib/haptics'

export type FeedbackIcon = 'check' | 'trash' | 'transfer' | 'undo'

export interface FeedbackLink {
  label: string
  onClick: () => void
}

export interface FeedbackItem {
  /** Identifiant d'affichage (change a chaque toast : relance minuterie et animation). */
  key: number
  message: string
  description?: string
  icon: FeedbackIcon
  /** Bouton « Annuler » (le toast se ferme sans expirer). */
  undo?: () => void
  /** Actions de suite, sur une seconde ligne. */
  links?: FeedbackLink[]
  duration: number
  /** Appele quand le toast part sans « Annuler » (expiration, fermeture, remplacement). */
  onExpire?: () => void
  /** Suppressions differees portees par ce toast. */
  deleteBatch?: string[]
}

type FeedbackInput = Omit<FeedbackItem, 'key' | 'duration'> & { duration?: number }

export const FEEDBACK_DURATION = 5000

export const useFeedbackStore = create<{ item: FeedbackItem | null }>(() => ({ item: null }))

let seq = 0

/** Affiche un retour (remplace le precedent, qui expire : ses suppressions partent). */
export function showFeedback(input: FeedbackInput): number {
  const previous = useFeedbackStore.getState().item
  const key = ++seq
  useFeedbackStore.setState({ item: { duration: FEEDBACK_DURATION, ...input, key } })
  // Lot de suppressions repris par le nouveau toast : il n'expire pas encore.
  const inherited =
    previous?.deleteBatch && input.deleteBatch && previous.deleteBatch.every((id) => input.deleteBatch!.includes(id))
  if (previous && !inherited) previous.onExpire?.()
  return key
}

/** Le toast `key` part sans « Annuler » (minuterie, fermeture) ; sans effet s'il a deja ete remplace. */
export function expireFeedback(key?: number): void {
  const item = useFeedbackStore.getState().item
  if (!item || (key !== undefined && item.key !== key)) return
  useFeedbackStore.setState({ item: null })
  item.onExpire?.()
}

/** « Annuler » du toast `key`. */
export function undoFeedback(key: number): void {
  const item = useFeedbackStore.getState().item
  if (!item || item.key !== key) return
  useFeedbackStore.setState({ item: null })
  haptic(8)
  item.undo?.()
}

/** Retire le toast `key` sans rien declencher (action devenue caduque, ex. echec). */
export function dropFeedback(key: number): void {
  const item = useFeedbackStore.getState().item
  if (item?.key === key) useFeedbackStore.setState({ item: null })
}

/**
 * Supprime une transaction avec « Annuler » : la ligne disparait, l'appel
 * serveur part a l'expiration du toast. Renvoie false si la ligne ne peut pas
 * encore etre supprimee (creation en vol).
 */
export function deleteWithUndo(queryClient: QueryClient, tx: Transaction): boolean {
  if (!removeTxPending(queryClient, tx.id)) return false
  haptic(15)
  const current = useFeedbackStore.getState().item
  const batch = current?.deleteBatch ? [...current.deleteBatch, tx.id] : [tx.id]
  const n = batch.length
  showFeedback({
    message: n === 1 ? 'Transaction supprimée' : `${n} transactions supprimées`,
    description: n === 1 ? merchantName(parseBankLabel(tx.label)) : undefined,
    icon: 'trash',
    undo: () => restorePendingDeletes(queryClient, batch),
    onExpire: () => commitPendingDeletes(queryClient, batch),
    deleteBatch: batch,
  })
  return true
}

const flushInstalled = new WeakSet<QueryClient>()

/**
 * Page masquee (changement d'app, verrouillage) ou quittee : les suppressions
 * differees partent immediatement (la page peut ne jamais revenir) et leur
 * toast se ferme, « Annuler » n'etant plus garanti.
 */
export function installFeedbackFlush(queryClient: QueryClient): void {
  if (flushInstalled.has(queryClient)) return
  flushInstalled.add(queryClient)
  const flush = () => {
    const item = useFeedbackStore.getState().item
    if (item?.deleteBatch) expireFeedback(item.key)
    commitPendingDeletes(queryClient)
  }
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}
