import { Link } from '@tanstack/react-router'
import { ChevronRight, Wand2 } from 'lucide-react'
import { useBootstrap } from '@/lib/data'
import { useAutomationStats } from '@/lib/ruleInsights'
import { fmtPercent } from '@/lib/format'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { ProgressRing } from '@/components/shared/ProgressRing'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { countLabel } from '@/components/rules/RulePreviewPanel'
import { cn } from '@/lib/utils'

interface RulesHeroProps {
  rulesCount: number | undefined
  onApply: () => void
  applying: boolean
}

/**
 * Heros de la page Regles : UNE question, « quelle part de mes depenses se
 * classe toute seule ? ». Anneau = depenses des 90 derniers jours que les
 * regles ou la memoire de tiers reconnaissent ; chiffres de soutien ; et,
 * quand il y en a, les transactions non categorisees qu'elles classeraient
 * tout de suite (« Appliquer maintenant », optimiste).
 */
export function RulesHero({ rulesCount, onApply, applying }: RulesHeroProps) {
  const isDesktop = useIsDesktop()
  const boot = useBootstrap().data
  const stats = useAutomationStats()
  const payees = boot?.payees.length ?? 0
  const uncategorized = boot?.uncategorizedCount ?? 0

  if (!stats || rulesCount === undefined) {
    return <Skeleton className="h-[164px] w-full rounded-3xl lg:h-[152px]" />
  }

  const ratio = stats.recent > 0 ? stats.covered / stats.recent : 0
  const tone = stats.recent === 0 ? 'neutral' : ratio >= 0.8 ? 'success' : 'accent'

  return (
    <Card variant="hero" tone={tone === 'success' ? 'success' : 'accent'} className="p-5 lg:p-7">
      <div className="flex items-center gap-4 lg:gap-6">
        <ProgressRing
          value={ratio}
          tone={tone}
          size={isDesktop ? 96 : 76}
          strokeWidth={isDesktop ? 9 : 8}
          label="Part des dépenses récentes classées automatiquement"
        >
          <span className="text-[17px] font-semibold tracking-tight text-ink lg:text-[21px]">
            {stats.recent > 0 ? fmtPercent(ratio) : '–'}
          </span>
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <p className="label-caps">Catégorisation automatique</p>
          <p className="mt-1 text-[18px] font-semibold leading-tight tracking-tight text-ink lg:text-[24px]">
            {stats.recent === 0
              ? 'Pas encore de dépenses à analyser'
              : `${stats.covered} ${stats.covered > 1 ? 'dépenses' : 'dépense'} sur ${stats.recent} se classent seules`}
          </p>
          <p className="mt-1 text-[13px] leading-snug text-soft">
            Sur 90 jours : tes règles d'abord, puis la mémoire des tiers.
          </p>
        </div>
        {isDesktop && (
          <div className="flex shrink-0 items-stretch gap-2">
            <Stat label="Règles" value={rulesCount} />
            <Stat label="Tiers mémorisés" value={payees} />
            <UncategorizedStat count={uncategorized} />
          </div>
        )}
      </div>

      {!isDesktop && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Règles" value={rulesCount} />
          <Stat label="Tiers" value={payees} />
          <UncategorizedStat count={uncategorized} />
        </div>
      )}

      {stats.applicable > 0 && (
        <div className="mt-4 flex animate-fade-up flex-col gap-3 rounded-2xl bg-surface/70 p-3.5 ring-1 ring-inset ring-edge sm:flex-row sm:items-center lg:mt-5 dark:bg-surface3/70">
          <p className="flex min-w-0 flex-1 items-start gap-2.5 text-[14px] leading-snug text-ink">
            <Wand2 className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent-ink dark:text-accent" />
            <span>
              <strong className="font-semibold tnum">
                {countLabel(stats.applicable, 'transaction non catégorisée', 'transactions non catégorisées')}
              </strong>{' '}
              {stats.applicable > 1 ? 'peuvent' : 'peut'} être classée{stats.applicable > 1 ? 's' : ''} dès maintenant.
            </span>
          </p>
          <Button onClick={onApply} disabled={applying} className="shrink-0">
            Appliquer maintenant
          </Button>
        </div>
      )}
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 rounded-2xl bg-surface/60 px-3 py-2.5 ring-1 ring-inset ring-edge dark:bg-surface3/60 lg:min-w-[104px] lg:px-4">
      <p className="truncate text-[11.5px] font-medium uppercase tracking-[0.06em] text-soft">{label}</p>
      <p className="mt-0.5 text-[20px] font-semibold leading-tight tracking-tight text-ink tnum">{value}</p>
    </div>
  )
}

function UncategorizedStat({ count }: { count: number }) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-1 truncate text-[11.5px] font-medium uppercase tracking-[0.06em] text-soft">
        À trier
        {count > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
      </span>
      <span
        className={cn(
          'mt-0.5 block text-[20px] font-semibold leading-tight tracking-tight tnum',
          count > 0 ? 'text-warning' : 'text-ink',
        )}
      >
        {count}
      </span>
    </>
  )
  const classes =
    'block min-w-0 rounded-2xl bg-surface/60 px-3 py-2.5 ring-1 ring-inset ring-edge dark:bg-surface3/60 lg:min-w-[104px] lg:px-4'
  if (count === 0) return <div className={classes}>{body}</div>
  return (
    <Link to="/trier" className={cn(classes, 'pressable transition-colors hover:bg-surface')} aria-label={`${count} transactions à trier`}>
      {body}
    </Link>
  )
}
