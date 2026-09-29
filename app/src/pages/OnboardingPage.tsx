import { lazy, Suspense, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Sparkles } from 'lucide-react'
import { apiSeedDefaults, useBootstrap } from '@/lib/data'
import { BrandMark } from '@/components/layout/BrandMark'
import { Aura } from '@/components/shared/Aura'
import { GroupPill } from '@/components/shared/GroupPill'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Cle partagee avec le routeur : un seul rechargement de rattrapage par session.
const CHUNK_RELOAD_FLAG = 'inab:chunk-reload'

// Formulaire du premier compte charge a la demande (hors bundle de demarrage).
// Apres un deploiement, une PWA restee ouverte peut viser un ancien chunk
// disparu : on recharge UNE fois (nouveau bundle), comme le routeur.
const FirstAccountForm = lazy(() =>
  import('@/components/accounts/FirstAccountForm').then(
    (m) => {
      try {
        sessionStorage.removeItem(CHUNK_RELOAD_FLAG)
      } catch {
        // ignore
      }
      return m
    },
    (err: unknown) => {
      let reloaded = false
      try {
        reloaded = sessionStorage.getItem(CHUNK_RELOAD_FLAG) === '1'
        if (!reloaded) sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1')
      } catch {
        // Stockage indisponible : on tente quand meme le rechargement.
      }
      if (reloaded) throw err
      window.location.reload()
      return new Promise<never>(() => undefined)
    },
  ),
)

function FormSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[52px] rounded-xl sm:h-[76px]" />
        ))}
      </div>
      <Skeleton className="h-[72px] rounded-2xl" />
      <Skeleton className="h-11 rounded-xl" />
      <Skeleton className="h-11 rounded-xl" />
      <Skeleton className="h-12 rounded-xl" />
    </div>
  )
}

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
          <li
            key={item.n}
            className={cn('flex items-center gap-3', i === 0 && 'flex-1')}
            aria-current={current ? 'step' : undefined}
          >
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
            done
              ? 'bg-success/15 text-success'
              : active
                ? 'bg-accent/10 text-accent-ink dark:text-accent'
                : 'bg-surface2 text-soft',
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

/** Etat vide apres login : initialise la taxonomie puis cree un premier compte. */
export function OnboardingPage() {
  const queryClient = useQueryClient()
  const boot = useBootstrap()
  const groups = (boot.data?.groups ?? []).filter((g) => !g.hidden).sort((a, b) => a.sortOrder - b.sortOrder)
  const hasCategories = (boot.data?.categories.length ?? 0) > 0

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

  const step: 1 | 2 = hasCategories ? 2 : 1

  return (
    <div className="mx-auto w-full max-w-xl animate-fade-up space-y-4 sm:space-y-5">
      <header className="relative isolate overflow-hidden rounded-3xl border border-edge bg-surface p-6 shadow-raised sm:p-8">
        <Aura intensity="strong" />
        <BrandMark size="lg" />
        <h1 className="mt-5 text-[28px] font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">
          Bienvenue
        </h1>
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
              <p className="mt-3 text-[13px] font-medium text-danger">
                Impossible d'initialiser les catégories. Réessayez.
              </p>
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
        <Suspense fallback={<FormSkeleton />}>
          <FirstAccountForm enabled={hasCategories} />
        </Suspense>
      </StepCard>
    </div>
  )
}
