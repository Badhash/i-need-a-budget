// Formulaire du premier compte (onboarding), charge a la demande : le shell
// importe l'onboarding de facon statique, ce module (formulaire de compte,
// mutations des comptes) reste ainsi hors du bundle de demarrage.

import { useState } from 'react'
import { newAccountVars, useCreateFirstAccount } from '@/lib/accounts'
import { Button } from '@/components/ui/button'
import { AccountFields, emptyDraft, validateDraft, type AccountDraft, type DraftField } from './AccountFields'

// Saisie en cours conservee le temps de la session : un aller-retour vers les
// Reglages (seule page accessible pendant l'onboarding) ne la perd pas.
let savedDraft: AccountDraft | null = null

export default function FirstAccountForm({ enabled }: { enabled: boolean }) {
  const [draft, setDraftState] = useState<AccountDraft>(
    () => savedDraft ?? emptyDraft({ name: 'Compte courant', institution: 'Ma banque' }),
  )
  const [error, setError] = useState<{ message: string; field?: DraftField } | null>(null)
  const setDraft = (next: AccountDraft) => {
    savedDraft = next
    setDraftState(next)
    if (error) setError(null)
  }

  const create = useCreateFirstAccount({
    onCreated: () => {
      savedDraft = null
    },
  })

  const submit = () => {
    if (!enabled || create.isPending) return
    const check = validateDraft(draft, true)
    if (check.error) {
      setError({ message: check.error, field: check.field })
      return
    }
    setError(null)
    create.mutate(
      newAccountVars({
        name: draft.name.trim(),
        institution: draft.institution.trim(),
        kind: draft.kind,
        onBudget: draft.onBudget,
        openingBalance: check.cents,
        openingDate: draft.openingDate,
      }),
      {
        onError: () => setError({ message: 'Création impossible pour le moment. Vérifiez la connexion et réessayez.' }),
      },
    )
  }

  return (
    <>
      <fieldset disabled={!enabled} className="contents">
        <AccountFields draft={draft} onChange={setDraft} withOpening invalidField={error?.field} onSubmit={submit} />
      </fieldset>
      {error && <p className="mt-4 text-[13px] font-medium text-danger">{error.message}</p>}
      <Button size="lg" className="mt-5 w-full" onClick={submit} disabled={!enabled || create.isPending}>
        {create.isPending ? 'Création du compte…' : 'Créer le compte et commencer'}
      </Button>
      {!enabled && <p className="mt-2.5 text-center text-[12.5px] text-soft">Initialisez d'abord vos enveloppes.</p>}
    </>
  )
}
