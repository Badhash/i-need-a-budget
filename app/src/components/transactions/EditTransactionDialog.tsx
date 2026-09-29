import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  apiUpdateTransaction,
  countsAsUncategorized,
  patchAccountBalances,
  patchUncategorizedCount,
  type UpdateTransactionInput,
} from '@/lib/data'
import type { Transaction } from '@/types/domain'
import { useUiStore } from '@/stores/ui'
import { scheduleBudgetRefetch } from '@/lib/categorize'
import { useSheetKeyboardInset } from '@/hooks/useKeyboardInset'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TransactionForm, txFormFrom, type TxFormResult } from './TransactionForm'

// Mise a jour optimiste : la ligne reflete immediatement les nouvelles valeurs
// dans le cache TanStack, le POST part en arriere-plan, rollback si echec.
function useUpdateTransaction(onFailure: (previous: Transaction) => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateTransactionInput) => apiUpdateTransaction(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] })
      const snapshot = queryClient.getQueryData<Transaction[]>(['transactions'])
      // Une edition peut changer la categorie ou le mois : on reajuste le
      // compteur « À catégoriser » du badge en optimiste.
      const prev = snapshot?.find((t) => t.id === input.transactionId)
      let countDelta = 0
      // Soldes de comptes (montant ou compte modifie) en optimiste.
      const balanceDeltas =
        prev === undefined
          ? []
          : prev.accountId === input.accountId
            ? [{ accountId: input.accountId, delta: input.amount - prev.amount }]
            : [
                { accountId: prev.accountId, delta: -prev.amount },
                { accountId: input.accountId, delta: input.amount },
              ]
      patchAccountBalances(queryClient, balanceDeltas)
      if (prev) {
        const before = countsAsUncategorized(queryClient, prev)
        const after = countsAsUncategorized(queryClient, {
          accountId: input.accountId,
          categoryId: input.categoryId,
          transferGroupId: prev.transferGroupId,
          date: input.date,
        })
        countDelta = (after ? 1 : 0) - (before ? 1 : 0)
        patchUncategorizedCount(queryClient, countDelta)
      }
      queryClient.setQueryData<Transaction[]>(['transactions'], (old) =>
        old?.map((t) =>
          t.id === input.transactionId
            ? {
                ...t,
                accountId: input.accountId,
                date: input.date,
                label: input.label,
                categoryId: input.categoryId,
                amount: input.amount,
                note: input.note ?? undefined,
              }
            : t,
        ),
      )
      return { snapshot, countDelta, balanceDeltas, prev }
    },
    // Rollback discret du cache, puis on ROUVRE le dialogue sur les valeurs
    // d'origine avec un message : une edition perdue en silence semblait
    // enregistree alors qu'elle ne l'etait pas.
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['transactions'], ctx.snapshot)
      if (ctx?.countDelta) patchUncategorizedCount(queryClient, -ctx.countDelta)
      if (ctx?.balanceDeltas) {
        patchAccountBalances(queryClient, ctx.balanceDeltas.map((d) => ({ ...d, delta: -d.delta })))
      }
      if (ctx?.prev) onFailure(ctx.prev)
    },
    // Liste et badge deja exacts (optimiste) ; une edition peut changer
    // categorie, montant ou mois : refetch cible et coalesce du budget.
    onSuccess: () => scheduleBudgetRefetch(queryClient),
  })
}

export function EditTransactionDialog() {
  const editTx = useUiStore((s) => s.editTx)
  const setEditTx = useUiStore((s) => s.setEditTx)
  const keyboardInset = useSheetKeyboardInset()
  const [failure, setFailure] = useState<string | null>(null)
  const update = useUpdateTransaction((previous) => {
    setFailure('Modification non enregistrée. Vérifie ta connexion et réessaye.')
    setEditTx(previous)
  })

  const close = () => {
    setFailure(null)
    setEditTx(null)
  }

  const submit = (tx: Transaction) => (r: TxFormResult) => {
    setFailure(null)
    // Optimisme immediat : on ferme sans attendre le reseau.
    update.mutate({
      transactionId: tx.id,
      accountId: r.accountId,
      date: r.date,
      label: r.label,
      categoryId: r.categoryId,
      amount: r.amount,
      note: r.note,
    })
    close()
  }

  return (
    <Dialog open={editTx !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier la transaction</DialogTitle>
          <DialogDescription>Corrigez le montant, la date, le libellé ou la note.</DialogDescription>
        </DialogHeader>
        {failure && <p className="px-5 pb-1 text-[13px] font-medium text-danger">{failure}</p>}

        {editTx && (
          <TransactionForm
            key={editTx.id}
            initial={txFormFrom(editTx)}
            submitLabel="Enregistrer"
            submittingLabel="Enregistrement…"
            submitting={false}
            keyboardInset={keyboardInset}
            onSubmit={submit(editTx)}
            onCancel={close}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
