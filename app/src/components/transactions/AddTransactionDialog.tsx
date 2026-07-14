import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiAddTransaction, useAccountsList } from '@/lib/data'
import { useUiStore } from '@/stores/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { emptyTxForm, TransactionForm, type TxFormResult } from './TransactionForm'

export function AddTransactionDialog() {
  const open = useUiStore((s) => s.addTxOpen)
  const setOpen = useUiStore((s) => s.setAddTxOpen)
  const queryClient = useQueryClient()
  const accounts = useAccountsList()

  const mutation = useMutation({
    mutationFn: apiAddTransaction,
    onSuccess: () => {
      // Ajouter une transaction touche la liste, l'activite des enveloppes
      // (budget), les agregats (reports) et les soldes/compteurs (bootstrap).
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
      void queryClient.invalidateQueries({ queryKey: ['budget'] })
      void queryClient.invalidateQueries({ queryKey: ['reports'] })
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      setOpen(false)
    },
  })

  const submit = (r: TxFormResult) => {
    mutation.mutate({
      accountId: r.accountId,
      date: r.date,
      label: r.label,
      categoryId: r.categoryId,
      amount: r.amount,
      note: r.note ?? undefined,
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajouter une transaction</DialogTitle>
          <DialogDescription>Saisie manuelle, en attendant la synchronisation bancaire.</DialogDescription>
        </DialogHeader>

        {/* key : reinitialise le formulaire a chaque ouverture */}
        <TransactionForm
          key={open ? 'open' : 'closed'}
          initial={emptyTxForm(accounts[0]?.id ?? '')}
          submitLabel="Ajouter"
          submittingLabel="Ajout…"
          submitting={mutation.isPending}
          autoFocusAmount
          onSubmit={submit}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
