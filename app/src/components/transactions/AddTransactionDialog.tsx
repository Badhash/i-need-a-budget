import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiAddTransaction, countsAsUncategorized, patchAccountBalances, patchUncategorizedCount, useAccountsList } from '@/lib/data'
import { useSheetKeyboardInset } from '@/hooks/useKeyboardInset'
import { useUiStore } from '@/stores/ui'
import { haptic } from '@/lib/haptics'
import { scheduleBudgetRefetch } from '@/lib/categorize'
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
  const [error, setError] = useState<string | null>(null)
  // iOS : le clavier s'ouvre d'emblee (montant en autofocus) et recouvrait le
  // pied de la feuille (boutons Ajouter / Annuler).
  const keyboardInset = useSheetKeyboardInset()

  // Un echec precedent ne doit pas reapparaitre a l'ouverture suivante.
  useEffect(() => {
    if (open) setError(null)
  }, [open])

  const mutation = useMutation({
    mutationFn: apiAddTransaction,
    // Sans message, un echec reseau fermait le clavier sans rien dire et la
    // saisie semblait perdue : on affiche l'erreur, le formulaire reste rempli.
    onError: () => setError("Ajout impossible pour le moment. Vérifie ta connexion et réessaye."),
    onSuccess: (_data, vars) => {
      setError(null)
      // Retour haptique discret : la saisie est bien enregistree.
      haptic(10)
      // On rafraichit la seule liste (pour afficher la nouvelle ligne) ; le
      // budget/les rapports/les soldes sont reconcilies en fond par le signal
      // Realtime coalesce, sans recharger toute la table chiffree.
      void queryClient.invalidateQueries({ queryKey: ['transactions'] })
      // Solde du compte a jour sans attendre la relecture de fond.
      patchAccountBalances(queryClient, [{ accountId: vars.accountId, delta: vars.amount }])
      // Une saisie categorisee ou un revenu deplace le budget du mois.
      scheduleBudgetRefetch(queryClient)
      // Une saisie manuelle sans categorie (jusqu'a aujourd'hui) alimente le
      // badge « À catégoriser » : on incremente le compteur porte par bootstrap.
      if (countsAsUncategorized(queryClient, { ...vars, transferGroupId: null })) {
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

        {error && (
          <p className="px-5 pb-1 text-[13px] font-medium text-danger">{error}</p>
        )}
        {/* key : reinitialise le formulaire a chaque ouverture */}
        <TransactionForm
          key={open ? 'open' : 'closed'}
          initial={emptyTxForm(accounts[0]?.id ?? '')}
          submitLabel="Ajouter"
          submittingLabel="Ajout…"
          submitting={mutation.isPending}
          keyboardInset={keyboardInset}
          autoFocusAmount
          onSubmit={submit}
          onCancel={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
