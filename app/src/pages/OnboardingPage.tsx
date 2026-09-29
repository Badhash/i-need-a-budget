import { useState, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Sparkles } from 'lucide-react'
import { apiSeedDefaults, useBootstrap } from '@/lib/data'
import { newAccountVars, useCreateFirstAccount } from '@/lib/accounts'
import { BrandMark } from '@/components/layout/BrandMark'
import { Aura } from '@/components/shared/Aura'
import { GroupPill } from '@/components/shared/GroupPill'
import { Button } from '@/components/ui/button'
import { AccountFields, emptyDraft, validateDraft, type AccountDraft, type DraftField } from '@/components/accounts/AccountFields'
import { cn } from '@/lib/utils'

/** Frise des deux etapes : pastilles reliees par un trait qui se remplit. */
function Stepper({ step }: { step: 1 | 2 }) {
  const items = [
    { n: 1, label: 'Catégories' },
    { n: 2, label: 'Premier compte' },
  ]
  return (
    <ol className="mt-6 flex items-center gap-3" aria-label="Étapes">
      {items.map((item, i) => {
        const done = item.n < step
        const current = item.n === step
        return (
          <li key={item.n} className={cn('flex items-center gap-3', i === 0 && 'flex-1')} aria-current={current ? 'step' : undefined}>
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tnum transition-colors duration-200',
                done && 'bg-success text-white dark:text-bg',
                current && 'bg-brand text-accentfg shadow-button',
                !done && !current && 'bg-surface2 text-soft ring-1 ring-inset ring-line',
              )}
            >
              {done ? <Check className="h-4 w-4" strokeWidth={2.6} /> : item.n}
            </span>
            <span className={cn('whitespace-nowrap text-[13.5px] font-medium', current ? 'text-ink' : 'text-soft')}>
              {item.label}
            </span>
            {i === 0 && (
              <span aria-hidden className="relative h-0.5 min-w-6 flex-1 overflow-hidden rounded-full bg-line">
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-brand transition-[width] duration-600 ease-spring"
                  style={{ width: step > 1 ? '100%' : '0%' }}
                />
              </span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function StepCard({
  n,
  done,
  active,
  title,
  description,
  children,
}: {
  n: number
  done: boolean
  active: boolean
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'rounded-3xl border bg-surface p-5 shadow-card transition-[opacity,border-color,box-shadow] duration-200 sm:p-6',
        active ? 'border-accent/25 shadow-raised' : 'border-edge',
        !active && !done && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-3.5">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold tnum',
            done ? 'bg-success/15 text-success' : active ? 'bg-accent/10 text-accent-ink dark:text-accent' : 'bg-surface2 text-soft',
          )}
        >
          {done ? <Check className="h-[18px] w-[18px]" strokeWidth={2.6} /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold leading-snug tracking-tight text-ink">{title}</h2>
          <p className="mt-0.5 text-[13.5px] leading-snug text-soft">{description}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}

// Saisie en cours conservee le temps de la session : un aller-retour vers les
// Reglages (seule page accessible pendant l'onboarding) ne la perd pas.
let savedDraft: AccountDraft | null = null

/** Etat vide apres login : initialise la taxonomie puis cree un premier compte. */
export function OnboardingPage() {
  const queryClient = useQueryClient()
  const boot = useBootstrap()
  const groups = (boot.data?.groups ?? []).filter((g) => !g.hidden).sort((a, b) => a.sortOrder - b.sortOrder)
  const hasCategories = (boot.data?.categories.length ?? 0) > 0

  const [draft, setDraftState] = useState<AccountDraft>(
    () => savedDraft ?? emptyDraft({ name: 'Compte courant', institution: 'Ma banque' }),
  )
  const [error, setError] = useState<{ message: string; field?: DraftField } | null>(null)
  const setDraft = (next: AccountDraft) => {
    savedDraft = next
    setDraftState(next)
    if (error) setError(null)
  }

  // Onboarding : le cache est quasi vide ; le seed cree la taxonomie (bootstrap)
  // et le budget du mois doit la refleter. Erreur affichee sur place.
  const seed = useMutation({
    mutationFn: apiSeedDefaults,
    meta: { errorToast: false },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['budget'] }),
      ]),
  })

  const create = useCreateFirstAccount({
    onCreated: () => {
      savedDraft = null
    },
  })

  const submit = () => {
    if (!hasCategories || create.isPending) return
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
      { onError: () => setError({ message: 'Création impossible pour le moment. Vérifiez la connexion et réessayez.' }) },
    )
  }

  const step: 1 | 2 = hasCategories ? 2 : 1

  return (
    <div className="mx-auto w-full max-w-xl animate-fade-up space-y-4 sm:space-y-5">
      <header className="relative isolate overflow-hidden rounded-3xl border border-edge bg-surface p-6 shadow-raised sm:p-8">
        <Aura intensity="strong" />
        <BrandMark size="lg" />
        <h1 className="mt-5 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">Bienvenue</h1>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-soft">
          Deux étapes pour un budget où chaque euro a un rôle : vos enveloppes, puis votre premier compte.
        </p>
        <Stepper step={step} />
      </header>

      <StepCard
        n={1}
        done={hasCategories}
        active={!hasCategories}
        title="Vos enveloppes"
        description="Un jeu de groupes et de catégories prêt à l'emploi, modifiable à tout moment."
      >
        {hasCategories ? (
          <div className="flex flex-wrap items-center gap-2">
            {groups.map((group) => (
              <span
                key={group.id}
                className="inline-flex items-center gap-2 rounded-full bg-surface2/80 py-1 pl-1 pr-3 text-[13px] font-medium text-ink ring-1 ring-inset ring-edge"
              >
                <GroupPill group={group} size="sm" />
                {group.name}
              </span>
            ))}
          </div>
        ) : (
          <>
            <Button size="lg" className="w-full sm:w-auto" onClick={() => seed.mutate()} disabled={seed.isPending}>
              <Sparkles className="h-4 w-4" />
              {seed.isPending ? 'Préparation des enveloppes…' : 'Initialiser mes catégories'}
            </Button>
            {seed.isError && (
              <p className="mt-3 text-[13px] font-medium text-danger">Impossible d'initialiser les catégories. Réessayez.</p>
            )}
          </>
        )}
      </StepCard>

      <StepCard
        n={2}
        done={false}
        active={hasCategories}
        title="Votre premier compte"
        description="Son solde actuel devient le point de départ du budget."
      >
        <fieldset disabled={!hasCategories} className="contents">
          <AccountFields
            draft={draft}
            onChange={setDraft}
            withOpening
            invalidField={error?.field}
            onSubmit={submit}
          />
        </fieldset>
        {error && <p className="mt-4 text-[13px] font-medium text-danger">{error.message}</p>}
        <Button size="lg" className="mt-5 w-full" onClick={submit} disabled={!hasCategories || create.isPending}>
          {create.isPending ? 'Création du compte…' : 'Créer le compte et commencer'}
        </Button>
        {!hasCategories && (
          <p className="mt-2.5 text-center text-[12.5px] text-soft">Initialisez d'abord vos enveloppes.</p>
        )}
      </StepCard>
    </div>
  )
}
