// Actions d'une ligne partagees par le menu desktop et la feuille de detail :
// modifier, convertir en virement / annuler le virement, creer une regle,
// supprimer (avec « Annuler »). Toutes optimistes, retour dans l'emplacement
// de toast unique de la page.

import { useQueryClient } from '@tanstack/react-query'
import type { Account } from '@/types/domain'
import { useAccountsList, useServerFeatures } from '@/lib/data'
import { useCategorize } from '@/lib/categorize'
import { ruleValueFromLabel } from '@/lib/rules'
import { conversionKeepsCategory, useConvertToTransfer, useRevertTransfer } from '@/lib/transactions'
import { useUiStore } from '@/stores/ui'
import { deleteWithUndo, dropFeedback, showFeedback } from './feedback'
import { useTxList } from './listContext'
import type { TxRow } from './txRow'

export interface TransferTarget {
  account: Account
  /** Explication a afficher sous le compte (virement vers un compte de suivi). */
  hint: string | null
}

export function useTxRowActions() {
  const queryClient = useQueryClient()
  const accounts = useAccountsList()
  const features = useServerFeatures()
  const setEditTx = useUiStore((s) => s.setEditTx)
  const { openCreateRule } = useTxList()
  const categorize = useCategorize()
  const convertMutation = useConvertToTransfer()
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

  return { transferTargets, canEdit, edit, convert, revert, createRule, remove }
}
