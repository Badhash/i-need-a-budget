// Actions d'une ligne partagees par le menu desktop et la feuille de detail :
// modifier, convertir en virement (ou relier l'operation de montant oppose du
// compte cible) / annuler le virement, creer une regle, supprimer (avec
// « Annuler »). Toutes optimistes, retour dans l'emplacement de toast unique
// de la page.

import { useQueryClient } from '@tanstack/react-query'
import type { Account, Transaction } from '@/types/domain'
import { TRANSACTIONS_KEY, useAccountsList, useServerFeatures } from '@/lib/data'
import { useCategorize } from '@/lib/categorize'
import { fmtDateShort } from '@/lib/format'
import { ruleValueFromLabel } from '@/lib/rules'
import { findTransferCounterpart } from '@/lib/transferPairs'
import {
  conversionKeepsCategory,
  useConvertToTransfer,
  useLinkTransfer,
  useRevertTransfer,
} from '@/lib/transactions'
import { useUiStore } from '@/stores/ui'
import { deleteWithUndo, dropFeedback, showFeedback } from './feedback'
import { useTxList } from './listContext'
import type { TxRow } from './txRow'

export interface TransferTarget {
  account: Account
  /** Explication a afficher sous le compte (virement vers un compte de suivi). */
  hint: string | null
}

export type TxRowActions = ReturnType<typeof useTxRowActions>

export function useTxRowActions() {
  const queryClient = useQueryClient()
  const accounts = useAccountsList()
  const features = useServerFeatures()
  const setEditTx = useUiStore((s) => s.setEditTx)
  const { openCreateRule } = useTxList()
  const categorize = useCategorize()
  const convertMutation = useConvertToTransfer()
  const linkMutation = useLinkTransfer()
  const revertMutation = useRevertTransfer()

  /** Comptes cibles d'une conversion : ouverts, hors compte de la ligne. */
  const transferTargets = (row: TxRow): TransferTarget[] =>
    accounts
      .filter((a) => a.id !== row.tx.accountId && !a.closed)
      .sort((a, b) => Number(b.onBudget) - Number(a.onBudget))
      .map((account) => ({
        account,
        hint:
          features.has('crossBudgetTransfers') && row.account.onBudget && !account.onBudget
            ? 'Catégorie conservée : l’argent sort du budget'
            : null,
      }))

  /**
   * Operation de montant oppose deja presente sur le compte cible (virement
   * importe des deux cotes, 3 jours d'ecart au plus) : a relier plutot qu'un
   * miroir, qui doublerait le solde. Lit la liste en cache a la demande
   * (appelee a l'ouverture du menu seulement) ; null sans linkTransfers.
   */
  const counterpartFor = (row: TxRow, target: Account): Transaction | null => {
    if (!features.has('linkTransfers')) return null
    const txs = queryClient.getQueryData<Transaction[]>(TRANSACTIONS_KEY) ?? []
    return findTransferCounterpart(txs, row.tx, target.id)
  }

  /** Une moitie de virement ne se modifie que si elle est croisee (serveur recent). */
  const canEdit = (row: TxRow) => !row.tx.transferGroupId || row.cross

  const edit = (row: TxRow) => setEditTx(row.tx)

  const convert = (row: TxRow, target: Account) => {
    const keep = conversionKeepsCategory(queryClient, row.tx, target.id)
    const previous = row.tx.categoryId
    const txId = row.tx.id
    const key = showFeedback({
      message: `Virement ${row.tx.amount < 0 ? 'vers' : 'depuis'} ${target.name}`,
      description: keep ? 'Catégorie conservée' : previous ? 'Catégorie retirée : virement interne' : undefined,
      icon: 'transfer',
      undo: () => {
        revertMutation.mutate({ txId })
        // La conversion avait retire la categorie : on la repose.
        if (!keep && previous) categorize.mutate({ txId, categoryId: previous })
      },
    })
    convertMutation.mutate({ txId, targetAccountId: target.id }, { onError: () => dropFeedback(key) })
  }

  const link = (row: TxRow, target: Account, counterpart: Transaction) => {
    const txId = row.tx.id
    const counterpartId = counterpart.id
    // Categories retirees par la liaison (virement neutre), reposees par « Annuler ».
    const restore = [row.tx, counterpart]
      .filter((t) => t.categoryId && !conversionKeepsCategory(queryClient, t, t.id === txId ? target.id : row.tx.accountId))
      .map((t) => ({ txId: t.id, categoryId: t.categoryId as string }))
    const keep = conversionKeepsCategory(queryClient, row.tx, target.id)
    const linked = `Relié à l’opération du ${fmtDateShort(counterpart.date)}`
    const key = showFeedback({
      message: `Virement ${row.tx.amount < 0 ? 'vers' : 'depuis'} ${target.name}`,
      description: keep
        ? `${linked}, catégorie conservée`
        : restore.length > 0
          ? `${linked}, ${restore.length > 1 ? 'catégories retirées' : 'catégorie retirée'}`
          : linked,
      icon: 'transfer',
      undo: () => {
        revertMutation.mutate({ txId })
        for (const vars of restore) categorize.mutate(vars)
      },
    })
    linkMutation.mutate(
      { txId, counterpartId, targetAccountId: target.id },
      { onError: () => dropFeedback(key) },
    )
  }

  const revert = (row: TxRow) => {
    const key = showFeedback({
      message: 'Virement annulé',
      description: 'La transaction redevient ordinaire.',
      icon: 'undo',
    })
    revertMutation.mutate({ txId: row.tx.id }, { onError: () => dropFeedback(key) })
  }

  // Une regle vise une enveloppe : une categorie de revenus n'est pas reprise.
  const createRule = (row: TxRow) =>
    openCreateRule(
      ruleValueFromLabel(row.tx.label),
      row.category && !row.category.isIncome ? row.category.id : undefined,
    )

  const remove = (row: TxRow) => deleteWithUndo(queryClient, row.tx)

  return { transferTargets, counterpartFor, canEdit, edit, convert, link, revert, createRule, remove }
}
