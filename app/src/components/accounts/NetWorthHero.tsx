import { Link } from '@tanstack/react-router'
import { ChevronRight, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { useBudgetMonth } from '@/lib/data'
import { fmtEURSigned, fmtPercent } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { Amount } from '@/components/shared/Amount'
import { useMountedFlag } from '@/components/shared/ProgressBar'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { fmtAccountCount } from './accountKinds'

interface NetWorthHeroProps {
  budgetTotal: number
  trackingTotal: number
  budgetCount: number
  trackingCount: number
  /** Variation de la valeur nette depuis le 1er du mois (null : inconnue). */
  monthChange: number | null
}

function TrendChip({ value }: { value: number }) {
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold tnum ring-1 ring-inset',
        value > 0 && 'bg-success/10 text-success ring-success/15',
        value < 0 && 'bg-danger/10 text-danger ring-danger/15',
        value === 0 && 'bg-surface2 text-soft ring-line/60',
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.4} />
      {value === 0 ? 'Stable ce mois-ci' : `${fmtEURSigned(value)} ce mois-ci`}
    </span>
  )
}

/**
 * Lien vers le budget avec le Pret a assigner du mois affiche : un ajustement
 * de solde ou un nouveau compte le fait bouger sous les yeux (compteur anime).
 */
function RtaChip() {
  const month = useUiStore((s) => s.month)
  const { data: budget } = useBudgetMonth(month)
  if (!budget) return null
  const negative = budget.rta < 0
  return (
    <Link
      to="/budget"
      className={cn(
        "group relative inline-flex min-h-[32px] items-center gap-1.5 rounded-full py-1 pl-3 pr-2 text-[12.5px] font-medium ring-1 ring-inset transition-colors duration-150 after:absolute after:-inset-1.5 after:content-['']",
        negative
          ? 'bg-danger/10 text-danger ring-danger/15 hover:bg-danger/15'
          : 'bg-surface/70 text-soft ring-edge hover:text-ink dark:bg-surface2/60',
      )}
    >
      Prêt à assigner
      <Amount
        cents={budget.rta}
        animate
        className={cn('font-semibold', negative ? 'text-danger' : 'text-success')}
      />
      <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 ease-spring group-hover:translate-x-0.5" />
    </Link>
  )
}

function Legend({
  dotClass,
  label,
  amount,
  sub,
}: {
  dotClass: string
  label: string
  amount: number
  sub: string
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-soft">
        <span aria-hidden className={cn('h-2 w-2 shrink-0 rounded-full', dotClass)} />
        {label}
      </p>
      <Amount cents={amount} animate className={cn('mt-1 block text-[18px] font-semibold tracking-tight', amount < 0 ? 'text-danger' : 'text-ink')} />
      <p className="mt-0.5 truncate text-[12.5px] text-soft tnum">{sub}</p>
    </div>
  )
}

/**
 * Heros de la page Comptes : valeur nette (compteur anime sur halo aurore),
 * sa variation du mois, et le partage Budget / Suivi en barre bicolore fine
 * (accent = budget, second ton de l'aurore = suivi).
 */
export function NetWorthHero({ budgetTotal, trackingTotal, budgetCount, trackingCount, monthChange }: NetWorthHeroProps) {
  const total = budgetTotal + trackingTotal
  const b = Math.max(0, budgetTotal)
  const t = Math.max(0, trackingTotal)
  const sum = b + t
  const budgetShare = sum > 0 ? b / sum : 0
  const trackingShare = sum > 0 ? t / sum : 0
  const mounted = useMountedFlag(true)

  return (
    <Card variant="hero" tone={total < 0 ? 'danger' : 'accent'} className="p-5 sm:p-6 lg:p-8">
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-12">
        <div className="min-w-0">
          <p className="label-caps">Valeur nette</p>
          <Amount
            cents={total}
            size="hero"
            animate
            className={cn('mt-2 block', total < 0 ? 'text-danger' : 'text-ink')}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {monthChange !== null && <TrendChip value={monthChange} />}
            <RtaChip />
          </div>
        </div>

        <div className="mt-7 lg:mt-0">
          <div
            className="flex h-2 w-full gap-1"
            role="img"
            aria-label={`Budget ${fmtPercent(budgetShare)}, suivi ${fmtPercent(trackingShare)}`}
          >
            {sum === 0 ? (
              <span className="h-full w-full rounded-full bg-ink/[0.08]" />
            ) : (
              <>
                {budgetShare > 0 && (
                  <span
                    className="h-full min-w-2 rounded-full bg-brand transition-[width] duration-600 ease-spring"
                    style={{ width: `${mounted ? budgetShare * 100 : 0}%` }}
                  />
                )}
                {trackingShare > 0 && (
                  <span
                    className="h-full min-w-2 flex-1 rounded-full bg-aura-2 transition-[width] duration-600 ease-spring"
                    style={{ opacity: mounted ? 1 : 0 }}
                  />
                )}
              </>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Legend
              dotClass="bg-brand"
              label="Budget"
              amount={budgetTotal}
              sub={`${fmtAccountCount(budgetCount)}${sum > 0 ? ` · ${fmtPercent(budgetShare)}` : ''}`}
            />
            <Legend
              dotClass="bg-aura-2"
              label="Suivi"
              amount={trackingTotal}
              sub={
                trackingCount === 0
                  ? 'Aucun compte'
                  : `${fmtAccountCount(trackingCount)}${sum > 0 ? ` · ${fmtPercent(trackingShare)}` : ''}`
              }
            />
          </div>
        </div>
      </div>
    </Card>
  )
}
