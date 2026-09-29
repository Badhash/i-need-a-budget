import { useState } from 'react'
import { useAccountsList } from '@/lib/data'
import { useUiStore } from '@/stores/ui'
import { haptic } from '@/lib/haptics'
import { fmtEURSigned } from '@/lib/format'
import { toast } from '@/lib/toast'
import { parseBankLabel } from '@/lib/bankLabel'
import {
  defaultTxAccountId,
  newTempId,
  readTxFormPrefs,
  useAddTransaction,
  writeTxFormPrefs,
  type AddTransactionVars,
} from '@/lib/transactions'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  emptyTxForm,
  keepSheetOnFieldEscape,
  SheetForm,
  txFormFrom,
  type TxFormInitial,
  type TxFormResult,
} from './TransactionForm'

const FAILURE_MESSAGE = "L'ajout n'a pas abouti. Vérifie ta connexion et réessaie : ta saisie est conservée."

/**
 * Ajout d'une transaction : le dialogue se ferme DES l'envoi, la ligne
 * apparait aussitot dans la liste (id temporaire), soldes et compteur sont
 * ajustes ; l'id serveur la remplace en place a la confirmation. Echec :
 * tout est retire et le dialogue se rouvre pre-rempli avec un message.
 */
export function AddTransactionDialog() {
  const open = useUiStore((s) => s.addTxOpen)
  const setOpen = useUiStore((s) => s.setAddTxOpen)
  const accounts = useAccountsList()
  // Saisie a reprendre apres un echec (reouverture pre-remplie). La version
  // remonte le formulaire quand un brouillon arrive dialogue ouvert.
  const [draft, setDraft] = useState<{ initial: TxFormInitial; error: string; version: number } | null>(null)

  const add = useAddTransaction((vars: AddTransactionVars) => {
    const initial = txFormFrom({ ...vars, note: vars.note ?? null })
    // Un nouvel ajout est deja en cours de saisie : on ne l'ecrase pas, la
    // saisie echouee reste recuperable depuis le toast.
    if (useUiStore.getState().addTxOpen) {
      toast({
        id: 'tx-add-failed',
        tone: 'danger',
        message: "L'ajout n'a pas abouti",
        description: `${parseBankLabel(vars.label).short} · ${fmtEURSigned(vars.amount)}`,
        duration: 0,
        action: {
          label: 'Reprendre',
          onClick: () => {
            setDraft({ initial, error: FAILURE_MESSAGE, version: Date.now() })
            setOpen(true)
          },
        },
      })
      return
    }
    setDraft({ initial, error: FAILURE_MESSAGE, version: Date.now() })
    setOpen(true)
  })

  // Chaque envoi repart d'un formulaire vierge a la prochaine ouverture (le
  // contenu du dialogue survit a son animation de fermeture).
  const [submits, setSubmits] = useState(0)

  const submit = (r: TxFormResult) => {
    const tempId = newTempId()
    haptic(10)
    // Le champ actif perd le focus AVANT le rendu : le clavier se replie et
    // la mesure de clavier ne force pas une mise en page en plein commit.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    add.mutate({
      tempId,
      accountId: r.accountId,
      date: r.date,
      label: r.label,
      categoryId: r.categoryId,
      amount: r.amount,
      note: r.note ?? undefined,
    })
    // Preference par appareil : compte et sens de la derniere saisie.
    writeTxFormPrefs({ accountId: r.accountId, kind: r.kind })
    setDraft(null)
    setSubmits((n) => n + 1)
    setOpen(false)
    // Hors de la liste (budget, comptes...), un mot confirme la saisie.
    if (!window.location.hash.startsWith('#/transactions')) {
      toast({
        id: 'tx-added',
        tone: 'success',
        message: 'Transaction ajoutée',
        description: `${parseBankLabel(r.label).short} · ${fmtEURSigned(r.amount)}`,
        duration: 3000,
      })
    }
  }

  const close = (next: boolean) => {
    if (!next) setDraft(null)
    setOpen(next)
  }

  const prefs = readTxFormPrefs()
  const initial = draft?.initial ?? emptyTxForm(defaultTxAccountId(accounts, prefs.accountId), prefs.kind)

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent onEscapeKeyDown={keepSheetOnFieldEscape}>
        <DialogHeader>
          <DialogTitle>Nouvelle transaction</DialogTitle>
          <DialogDescription>Saisie manuelle, en attendant la synchronisation bancaire.</DialogDescription>
        </DialogHeader>

        {draft && (
          <p role="alert" className="mx-5 mb-1 rounded-xl bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium leading-snug text-danger">
            {draft.error}
          </p>
        )}
        {/* Contenu demonte a la fermeture : formulaire neuf a chaque ouverture.
            key : reprise d'un brouillon, ou nouvel ajout juste apres un envoi. */}
        <SheetForm
          key={`${submits}-${draft?.version ?? 0}`}
          initial={initial}
          submitLabel="Ajouter"
          submittingLabel="Ajout…"
          submitting={false}
          autoFocusAmount={!draft}
          onSubmit={submit}
          onCancel={() => close(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
