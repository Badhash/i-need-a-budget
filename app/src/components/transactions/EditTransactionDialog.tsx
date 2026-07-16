import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  apiUpdateTransaction,
  countsAsUncategorized,
  patchUncategorizedCount,
  type UpdateTransactionInput,
} from '@/lib/data'
import type { Transaction } from '@/types/domain'
import { useUiStore } from '@/stores/ui'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
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
function useUpdateTransaction() {
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
      if (prev) {
        const before = countsAsUncategorized(prev.categoryId, prev.transferGroupId, prev.date)
        const after = countsAsUncategorized(input.categoryId, prev.transferGroupId, input.date)
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
      return { snapshot, countDelta }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshot) queryClient.setQueryData(['transactions'], ctx.snapshot)
      if (ctx?.countDelta) patchUncategorizedCount(queryClient, -ctx.countDelta)
    },
    // Deja reflete de facon optimiste : reconciliation en fond via le signal
    // Realtime coalesce (pas d'invalidation directe qui rechargerait toute la
    // table chiffree a chaque edition).
  })
}

export function EditTransactionDialog() {
  const editTx = useUiStore((s) => s.editTx)
  const setEditTx = useUiStore((s) => s.setEditTx)
  const keyboardInset = useKeyboardInset()
  const update = useUpdateTransaction()

  const close = () => setEditTx(null)

  const submit = (tx: Transaction) => (r: TxFormResult) => {
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
