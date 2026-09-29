import { useRef, useState } from 'react'
import type { Transaction } from '@/types/domain'
import { useAccountsMap, useIsCrossBudgetTransfer, useTransactions } from '@/lib/data'
import { useUpdateTransaction } from '@/lib/transactions'
import { useUiStore } from '@/stores/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SheetForm, txFormFrom, type TxFormResult } from './TransactionForm'

export function EditTransactionDialog() {
  const editTx = useUiStore((s) => s.editTx)
  const setEditTx = useUiStore((s) => s.setEditTx)
  const isCross = useIsCrossBudgetTransfer()
  const accountById = useAccountsMap()
  const { data: txs } = useTransactions()
  const [failure, setFailure] = useState<string | null>(null)
  // Rollback discret du cache puis REOUVERTURE du dialogue sur les valeurs
  // d'origine avec un message : une edition perdue en silence semblait
  // enregistree alors qu'elle ne l'etait pas.
  const update = useUpdateTransaction((previous) => {
    setFailure('Modification non enregistrée. Vérifie ta connexion et réessaie.')
    setEditTx(previous)
  })

  const close = () => {
    setFailure(null)
    setEditTx(null)
  }

  // Derniere transaction editee, gardee le temps de l'animation de fermeture
  // (la feuille ne se vide pas en glissant).
  const lastTx = useRef<Transaction | null>(null)
  if (editTx) lastTx.current = editTx
  const shownTx = editTx ?? lastTx.current

  // Moitie cote budget d'un virement vers un compte de suivi (serveur recent) :
  // categorie, libelle et note seulement, le reste suit le virement.
  const cross = shownTx ? isCross(shownTx) : false
  const peer =
    cross && shownTx
      ? txs?.find((t) => t.transferGroupId === shownTx.transferGroupId && t.id !== shownTx.id)
      : undefined
  const peerName = peer ? accountById.get(peer.accountId)?.name : undefined
  const lockedReason = cross
    ? `Virement ${shownTx && shownTx.amount < 0 ? 'vers' : 'depuis'} ${peerName ?? 'un compte de suivi'} : montant, date et compte suivent le virement.`
    : null

  const submit = (tx: Transaction) => (r: TxFormResult) => {
    setFailure(null)
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    // Optimisme immediat : on ferme sans attendre le reseau.
    update.mutate({
      transactionId: tx.id,
      accountId: cross ? tx.accountId : r.accountId,
      date: cross ? tx.date : r.date,
      label: r.label,
      categoryId: r.categoryId,
      amount: cross ? tx.amount : r.amount,
      note: r.note,
    })
    close()
  }

  return (
    <Dialog open={editTx !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier la transaction</DialogTitle>
          <DialogDescription>
            {cross ? 'Catégorie, libellé et note.' : 'Montant, date, compte, catégorie, libellé ou note.'}
          </DialogDescription>
        </DialogHeader>
        {failure && (
          <p role="alert" className="mx-5 mb-1 rounded-xl bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium leading-snug text-danger">
            {failure}
          </p>
        )}

        {shownTx && (
          <SheetForm
            key={shownTx.id}
            initial={txFormFrom(shownTx)}
            submitLabel="Enregistrer"
            submittingLabel="Enregistrement…"
            submitting={false}
            lockedReason={lockedReason}
            onSubmit={submit(shownTx)}
            onCancel={close}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
