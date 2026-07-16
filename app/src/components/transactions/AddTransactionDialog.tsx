import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiAddTransaction, countsAsUncategorized, patchUncategorizedCount, useAccountsList } from '@/lib/data'
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
    onSuccess: (_data, vars) => {
      // On rafraichit la seule liste (pour afficher la nouvelle ligne) ; le
      // budget/les rapports/les soldes sont reconcilies en fond par le signal
      // Realtime coalesce, sans recharger toute la table chiffree.
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
      // Une saisie manuelle sans categorie (jusqu'a aujourd'hui) alimente le
      // badge « À catégoriser » : on incremente le compteur porte par bootstrap.
      if (countsAsUncategorized(vars.categoryId, null, vars.date)) {
        patchUncategorizedCount(queryClient, 1)
      }
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
