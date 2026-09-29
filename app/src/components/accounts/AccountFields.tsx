// Champs d'un compte, partages par la creation (page Comptes, onboarding) et
// l'edition (nom, banque, type) : un seul formulaire, une seule validation.

import { useId } from 'react'
import { Landmark } from 'lucide-react'
import type { AccountKind } from '@/types/domain'
import { evalAmountCents, MIN_MONTH, today } from '@/lib/format'
import { Input } from '@/components/ui/input'
import { SignedAmountInput } from '@/components/shared/SignedAmountInput'
import { cn } from '@/lib/utils'
import { KIND_META } from './accountKinds'
import { KindPicker } from './KindPicker'
import { SwitchRow } from './Switch'

// Meme borne basse que le selecteur de mois : un solde d'ouverture ne doit pas
// tomber dans un mois que l'app ne sait pas afficher.
export const MIN_OPENING_DATE = `${MIN_MONTH}-01`

export interface AccountDraft {
  kind: AccountKind
  name: string
  institution: string
  /** Saisie brute du solde d'ouverture (negatif autorise : encours de carte). */
  balance: string
  openingDate: string
  onBudget: boolean
  /** L'interrupteur a ete touche : changer de type ne le modifie plus. */
  onBudgetTouched: boolean
}

export function emptyDraft(init: Partial<AccountDraft> = {}): AccountDraft {
  return {
    kind: 'checking',
    name: '',
    institution: '',
    balance: '',
    openingDate: today(),
    onBudget: true,
    onBudgetTouched: false,
    ...init,
  }
}

export type DraftField = 'name' | 'institution' | 'balance' | 'date'

export interface DraftCheck {
  error: string | null
  field?: DraftField
  /** Solde d'ouverture en centimes (0 si vide). */
  cents: number
}

/** Parser strict partage : « 1.234,56 » est rejete, le negatif autorise. */
export function parseSignedEuros(raw: string): number | null {
  if (!raw.trim()) return 0
  return evalAmountCents(raw)
}

export function validateDraft(draft: AccountDraft, withOpening: boolean): DraftCheck {
  if (!draft.name.trim()) return { error: 'Donnez un nom au compte.', field: 'name', cents: 0 }
  if (!draft.institution.trim()) return { error: "Indiquez la banque ou l'établissement.", field: 'institution', cents: 0 }
  if (!withOpening) return { error: null, cents: 0 }
  const cents = parseSignedEuros(draft.balance)
  if (cents === null) {
    return { error: 'Saisissez un solde valide, par exemple 1234,56 (négatif autorisé).', field: 'balance', cents: 0 }
  }
  if (!draft.openingDate || draft.openingDate < MIN_OPENING_DATE || draft.openingDate > today()) {
    return { error: "La date d'ouverture doit être antérieure ou égale à aujourd'hui.", field: 'date', cents }
  }
  return { error: null, cents }
}

export function AccountFields({
  draft,
  onChange,
  withOpening,
  invalidField,
  onSubmit,
  className,
}: {
  draft: AccountDraft
  onChange: (next: AccountDraft) => void
  /** Creation : solde d'ouverture, date et inclusion dans le budget. */
  withOpening: boolean
  invalidField?: DraftField
  /** Entree dans un champ texte : valide le formulaire. */
  onSubmit?: () => void
  className?: string
}) {
  const uid = useId()
  const set = (patch: Partial<AccountDraft>) => onChange({ ...draft, ...patch })
  const setKind = (kind: AccountKind) => {
    // Un placement se suit hors budget par defaut (PEA, assurance-vie), tant
    // que l'utilisateur n'a pas choisi lui-meme.
    const onBudget = withOpening && !draft.onBudgetTouched ? !KIND_META[kind].trackingByDefault : draft.onBudget
    set({ kind, onBudget })
  }
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault()
      onSubmit()
    }
  }
  const invalid = (field: DraftField) =>
    invalidField === field ? 'border-danger/60 hover:border-danger/60 focus:border-danger/70 focus:ring-danger/15' : undefined

  return (
    <div className={cn('space-y-5', className)}>
      <div>
        <p className="label-caps mb-2">Type</p>
        <KindPicker value={draft.kind} onChange={setKind} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-name`} className="label-caps mb-1.5 block">
            Nom du compte
          </label>
          <Input
            id={`${uid}-name`}
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            onKeyDown={enter}
            placeholder={KIND_META[draft.kind].placeholder}
            maxLength={80}
            autoComplete="off"
            aria-invalid={invalidField === 'name' || undefined}
            className={invalid('name')}
          />
        </div>
        <div>
          <label htmlFor={`${uid}-institution`} className="label-caps mb-1.5 block">
            Banque
          </label>
          <Input
            id={`${uid}-institution`}
            value={draft.institution}
            onChange={(e) => set({ institution: e.target.value })}
            onKeyDown={enter}
            placeholder="Ma banque"
            maxLength={80}
            autoComplete="off"
            aria-invalid={invalidField === 'institution' || undefined}
            className={invalid('institution')}
          />
        </div>
      </div>

      {withOpening && (
        <>
          <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr]">
            <div>
              <label htmlFor={`${uid}-balance`} className="label-caps mb-1.5 block">
                Solde actuel
              </label>
              <SignedAmountInput
                id={`${uid}-balance`}
                value={draft.balance}
                onChange={(balance) => set({ balance })}
                onEnter={onSubmit}
                placeholder="0,00"
                invalid={invalidField === 'balance'}
                aria-describedby={`${uid}-balance-hint`}
              />
            </div>
            <div>
              <label htmlFor={`${uid}-date`} className="label-caps mb-1.5 block">
                Depuis le
              </label>
              <Input
                id={`${uid}-date`}
                type="date"
                value={draft.openingDate}
                min={MIN_OPENING_DATE}
                max={today()}
                onChange={(e) => set({ openingDate: e.target.value })}
                aria-invalid={invalidField === 'date' || undefined}
                className={invalid('date')}
              />
            </div>
          </div>
          <p id={`${uid}-balance-hint`} className="-mt-2 text-[12.5px] leading-snug text-soft">
            {draft.kind === 'card_deferred'
              ? "Pour une carte à débit différé : l'encours non encore prélevé, souvent négatif."
              : 'Le solde du compte à cette date : le point de départ de son historique.'}
          </p>

          <div className="rounded-2xl bg-surface2/70 ring-1 ring-inset ring-edge">
            <SwitchRow
              checked={draft.onBudget}
              onCheckedChange={(onBudget) => set({ onBudget, onBudgetTouched: true })}
              icon={
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-ink dark:text-accent">
                  <Landmark className="h-[18px] w-[18px]" />
                </span>
              }
              title="Inclus dans le budget"
              description={
                draft.onBudget
                  ? "Son solde d'ouverture rejoint le Prêt à assigner."
                  : 'Compte de suivi : compté dans la valeur nette, hors budget.'
              }
            />
          </div>
        </>
      )}
    </div>
  )
}
