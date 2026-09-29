import type { ReactNode } from 'react'
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type TrendFormat = 'percent' | 'amount' | 'points'

const PERCENT = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0, signDisplay: 'exceptZero' })
const EUROS = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
})

// En dessous de ces ecarts, la tendance est « stable » (ni verte ni orange) :
// 3 %, 10 € ou 1 point de taux.
const STABLE: Record<TrendFormat, number> = { percent: 0.03, amount: 1_000, points: 0.01 }

function formatDelta(delta: number, format: TrendFormat): string {
  if (format === 'amount') return EUROS.format(delta / 100)
  if (format === 'points') {
    const points = Math.round(delta * 100)
    return `${points > 0 ? '+' : points < 0 ? '−' : ''}${Math.abs(points)} pt${Math.abs(points) > 1 ? 's' : ''}`
  }
  return PERCENT.format(delta)
}

interface TrendBadgeProps {
  /**
   * Variation : ratio (-0.12 = -12 %), ecart en centimes ou ecart de taux
   * (0.05 = 5 points) selon `format`. null = pas de reference (premier mois).
   */
  delta: number | null
  format?: TrendFormat
  /** true si une baisse est une bonne nouvelle (ex. depenses). */
  downIsGood?: boolean
  /** Reference nommee : 'vs moyenne', 'vs août'. */
  label: string
  /** Texte de la pastille neutre sans reference. */
  emptyLabel?: string
  className?: string
}

/**
 * Pastille de tendance : verte si l'evolution est une bonne nouvelle, ambree
 * sinon (attention, pas alarme), NEUTRE sans reference ou quand l'ecart est
 * negligeable. Le sens est porte par l'icone ET le texte, jamais la couleur seule.
 */
export function TrendBadge({
  delta,
  format = 'percent',
  downIsGood = false,
  label,
  emptyLabel = 'Pas de comparaison',
  className,
}: TrendBadgeProps) {
  if (delta === null || !Number.isFinite(delta)) {
    return (
      <Badge variant="neutral" className={cn('gap-1.5 py-1', className)}>
        <Minus aria-hidden />
        {emptyLabel}
      </Badge>
    )
  }
  if (Math.abs(delta) < STABLE[format]) {
    return (
      <Badge variant="neutral" className={cn('gap-1.5 py-1', className)}>
        <Minus aria-hidden />
        Stable {label}
      </Badge>
    )
  }
  const good = downIsGood ? delta < 0 : delta > 0
  const Icon = delta < 0 ? TrendingDown : TrendingUp
  return (
    <Badge variant={good ? 'success' : 'warning'} className={cn('gap-1.5 py-1 font-semibold', className)}>
      <Icon aria-hidden />
      {formatDelta(delta, format)} {label}
    </Badge>
  )
}

/** Typographie francaise : espace insecable avant ? ! : ; (jamais de « ? » seul en fin de ligne). */
export function frenchSpacing(text: string): string {
  return text.replace(/ ([?!:;])/g, '\u00a0$1')
}

interface WidgetCardProps {
  /** La question a laquelle le widget repond. */
  question: string
  icon?: LucideIcon
  /** Precision sous la question (periode, mois, perimetre). */
  caption?: ReactNode
  /** Tendance ou action alignee a droite. */
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** Un widget = une question + un chiffre principal + une tendance + un graphe max. */
export function WidgetCard({ question, icon: Icon, caption, action, children, className }: WidgetCardProps) {
  return (
    <Card className={cn('flex min-w-0 flex-col gap-4 p-5', className)}>
      {/* La tendance passe sous la question quand la carte est etroite
          (mobile) au lieu d'ecraser la question sur trois lignes. */}
      <header className="flex items-start gap-3">
        {Icon && (
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent-ink ring-1 ring-inset ring-accent/15 dark:text-accent"
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 flex-[1_1_13rem]">
            <h3 className="text-balance text-[15px] font-semibold leading-snug tracking-tight text-ink">
              {frenchSpacing(question)}
            </h3>
            {caption && <p className="mt-0.5 text-[12.5px] leading-snug text-soft">{caption}</p>}
          </div>
          {action && <div className="flex shrink-0 items-center">{action}</div>}
        </div>
      </header>
      {children}
    </Card>
  )
}

/** Tendance en attente (squelette de la pastille, meme hauteur de ligne). */
export function ActionSkeleton({ className }: { className?: string }) {
  // 26px : hauteur exacte d'une pastille (texte 12px sur 18px de ligne + 2 x 4px).
  return <Skeleton className={cn('h-[26px] w-28 rounded-full', className)} />
}

/**
 * Squelette EN LIGNE (span) : se pose dans un paragraphe sans casser le HTML
 * (un div dans un p est invalide) et garde la hauteur de ligne du texte.
 */
export function InlineSkeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('skeleton-shimmer inline-block rounded-md bg-ink/[0.06] align-middle', className)} />
}

/** Legende en attente, posee dans la ligne de texte (hauteur de ligne conservee). */
export function CaptionSkeleton({ className }: { className?: string }) {
  return <InlineSkeleton className={cn('h-3 w-32', className)} />
}

/**
 * Pastille en attente a la largeur EXACTE de son texte type (pastille
 * invisible sous le reflet) : l'en-tete se met en page comme avec la vraie.
 */
export function BadgeSkeleton({ text, className }: { text: string; className?: string }) {
  return (
    <span aria-hidden className={cn('relative inline-flex', className)}>
      <Badge variant="neutral" className="invisible gap-1.5 py-1 font-semibold">
        <Minus />
        {text}
      </Badge>
      <Skeleton className="absolute inset-0 rounded-full" />
    </span>
  )
}
