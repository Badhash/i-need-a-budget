import { useEffect, useState } from 'react'
import { newAccountVars, useCreateAccount } from '@/lib/accounts'
import { fmtEUR } from '@/lib/format'
import { toast } from '@/lib/toast'
import { haptic } from '@/lib/haptics'
import { useSheetKeyboardInset } from '@/hooks/useKeyboardInset'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AccountFields, emptyDraft, validateDraft, type AccountDraft, type DraftField } from './AccountFields'
import { quoted } from './accountKinds'

/**
 * Creation d'un compte (hors onboarding). Optimiste : la feuille se ferme a la
 * validation et le compte apparait aussitot avec son solde d'ouverture.
 */
export function AddAccountDialog({
  open,
  onOpenChange,
  defaultOnBudget = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Ouvert depuis la section Suivi : compte de suivi propose par defaut. */
  defaultOnBudget?: boolean
}) {
  const create = useCreateAccount()
  const inset = useSheetKeyboardInset()
  const [draft, setDraft] = useState<AccountDraft>(() => emptyDraft({ onBudget: defaultOnBudget }))
  const [error, setError] = useState<{ message: string; field?: DraftField } | null>(null)

  // Formulaire neuf a chaque ouverture (section d'origine prise en compte).
  useEffect(() => {
    if (!open) return
    setDraft(
      emptyDraft({
        onBudget: defaultOnBudget,
        onBudgetTouched: !defaultOnBudget,
        kind: defaultOnBudget ? 'checking' : 'investment',
      }),
    )
    setError(null)
  }, [open, defaultOnBudget])

  const submit = () => {
    const check = validateDraft(draft, true)
    if (check.error) {
      setError({ message: check.error, field: check.field })
      return
    }
    const name = draft.name.trim()
    create.mutate(
      newAccountVars({
        name,
        institution: draft.institution.trim(),
        kind: draft.kind,
        onBudget: draft.onBudget,
        openingBalance: check.cents,
        openingDate: draft.openingDate,
      }),
    )
    haptic(10)
    toast({
      message: `${quoted(name)} ajouté`,
      description: !draft.onBudget
        ? 'Compte de suivi, hors budget.'
        : check.cents > 0
          ? `${fmtEUR(check.cents)} rejoignent le Prêt à assigner.`
          : check.cents < 0
            ? `${fmtEUR(-check.cents)} retirés du Prêt à assigner.`
            : 'Compte inclus dans le budget.',
      tone: 'success',
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pr-14">
          <DialogTitle>Ajouter un compte</DialogTitle>
          <DialogDescription>
            Saisissez son solde actuel : il sert de point de départ, les opérations suivantes s'y ajoutent.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-2">
          <AccountFields
            draft={draft}
            onChange={(next) => {
              setDraft(next)
              if (error) setError(null)
            }}
            withOpening
            invalidField={error?.field}
            onSubmit={submit}
          />
          {error && <p className="mt-3 text-[13px] font-medium text-danger">{error.message}</p>}
        </div>
        <DialogFooter style={inset ? { paddingBottom: inset + 20 } : undefined}>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={submit}>Créer le compte</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
