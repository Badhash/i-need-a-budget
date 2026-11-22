import { memo } from 'react'
import { Umbrella } from 'lucide-react'
import type { Analytics } from '@/lib/analytics'
import { fmtEUR } from '@/lib/format'
import { Amount } from '@/components/shared/Amount'
import { ProgressBar, type ProgressTone } from '@/components/shared/ProgressBar'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { BadgeSkeleton, CaptionSkeleton, InlineSkeleton, WidgetCard } from '@/components/reports/WidgetCard'

// Matelas conseille : 3 a 6 mois de depenses. La jauge s'arrete a 6 mois.
const GOAL_MIN = 3
const GOAL_MAX = 6
const QUESTION = 'Combien de mois je tiens ?'
const CAPTION = 'Sans revenus, au rythme de tes dépenses habituelles'

const MONTHS = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

function toneOf(months: number): ProgressTone {
  if (months < 1) return 'danger'
  if (months < GOAL_MIN) return 'warning'
  return months < GOAL_MAX ? 'accent' : 'success'
}

function verdict(months: number): { badge: string; text: string; variant: 'danger' | 'warning' | 'accent' | 'success' } {
  if (months < 1)
    return { badge: 'À reconstituer', variant: 'danger', text: 'Moins d’un mois d’avance : la priorité est de remettre de l’argent de côté.' }
  if (months < GOAL_MIN)
    return { badge: 'En construction', variant: 'warning', text: 'Un bon début : vise 3 mois de dépenses de côté pour être serein.' }
  if (months < GOAL_MAX)
    return { badge: 'Matelas solide', variant: 'accent', text: 'Entre 3 et 6 mois : la zone conseillée pour faire face à un imprévu.' }
  return { badge: 'Large avance', variant: 'success', text: 'Plus de 6 mois d’avance : l’excédent peut travailler (épargne, placements).' }
}

/**
 * Autonomie : combien de mois l'argent des comptes budget couvre les depenses
 * habituelles (moyenne des mois clos, hors operations exceptionnelles et
 * categories hors depenses). Repere : 3 a 6 mois.
 */
export const RunwayWidget = memo(function RunwayWidget({ a, className }: { a: Analytics; className?: string }) {
  const { cash, monthlySpending, months } = a.runway
  const known = months !== null && cash > 0
  const v = known ? verdict(months) : null
  return (
    <WidgetCard
      icon={Umbrella}
      question={QUESTION}
      caption={CAPTION}
      action={v ? <Badge variant={v.variant} className="py-1 font-semibold">{v.badge}</Badge> : undefined}
      className={className}
    >
      <div>
        <p className="text-[12.5px] text-soft">Ton matelas de sécurité</p>
        <p className="mt-0.5 text-[26px] font-semibold tracking-[-0.015em] text-ink tnum">
          {known ? `${MONTHS.format(months)} mois` : '—'}
        </p>
      </div>
      <ProgressBar
        value={known ? Math.min(months, GOAL_MAX) / GOAL_MAX : 0}
        target={GOAL_MIN / GOAL_MAX}
        tone={known ? toneOf(months) : 'neutral'}
        label={known ? `${MONTHS.format(months)} mois de dépenses de côté, repère à ${GOAL_MIN} mois` : 'Matelas inconnu'}
      />
      {/* Graduations : le repere de 3 mois tombe au milieu de la jauge (3 sur 6). */}
      <div aria-hidden className="relative -mt-2 h-4 text-[11.5px] text-soft tnum">
        <span className="absolute left-0">0</span>
        <span className="absolute left-1/2 -translate-x-1/2">{GOAL_MIN} mois</span>
        <span className="absolute right-0">{GOAL_MAX} mois et +</span>
      </div>
      <dl className="space-y-1.5 border-t border-line/70 pt-3 text-[13px]">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-soft">Sur tes comptes budget</dt>
          <dd>
            <Amount cents={cash} colored={cash < 0} className="font-semibold text-ink" />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-soft">Dépenses habituelles</dt>
          <dd className="font-semibold text-ink tnum">
            {monthlySpending !== null ? `${fmtEUR(monthlySpending)} / mois` : 'pas encore de moyenne'}
          </dd>
        </div>
      </dl>
      <p className="text-[12.5px] leading-snug text-soft">
        {v
          ? v.text
          : cash <= 0
            ? 'Tes comptes budget sont à zéro ou à découvert à la fin du mois.'
            : 'Il faut un premier mois complet pour estimer ton rythme de dépenses.'}
      </p>
    </WidgetCard>
  )
})

export function RunwaySkeleton({ className }: { className?: string }) {
  return (
    <WidgetCard
      icon={Umbrella}
      question={QUESTION}
      caption={CAPTION}
      action={<BadgeSkeleton text="Matelas solide" />}
      className={className}
    >
      <div aria-hidden>
        <p className="text-[12.5px] text-soft">Ton matelas de sécurité</p>
        <p className="mt-0.5 text-[26px] font-semibold">
          <InlineSkeleton className="h-[0.8em] w-[4em]" />
        </p>
      </div>
      <Skeleton aria-hidden className="h-2 w-full rounded-full" />
      <div aria-hidden className="-mt-2 h-4" />
      <div aria-hidden className="space-y-1.5 border-t border-line/70 pt-3 text-[13px]">
        <p className="flex justify-between">
          <CaptionSkeleton className="w-36" />
          <CaptionSkeleton className="w-20" />
        </p>
        <p className="flex justify-between">
          <CaptionSkeleton className="w-32" />
          <CaptionSkeleton className="w-24" />
        </p>
      </div>
      <p aria-hidden className="text-[12.5px]">
        <InlineSkeleton className="h-3 w-full" />
      </p>
    </WidgetCard>
  )
}
