import { Sparkles, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type EmptyTone = 'accent' | 'success' | 'warning' | 'danger'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void
  /** Petite icone composee en bas a droite du medaillon (defaut : etincelles). */
  badgeIcon?: LucideIcon
  tone?: EmptyTone
  /** Version resserree (dans une carte ou une feuille). */
  compact?: boolean
  className?: string
}

// Classes statiques par ton (JIT Tailwind).
const TONES: Record<EmptyTone, { disc: string; icon: string; halo: string; badge: string }> = {
  accent: {
    disc: 'from-accent/20 via-accent/10 to-aura-2/15 ring-accent/20',
    icon: 'text-accent-ink dark:text-accent',
    halo: 'bg-accent/25',
    badge: 'text-accent-ink dark:text-accent',
  },
  success: {
    disc: 'from-success/20 via-success/10 to-aura-2/10 ring-success/20',
    icon: 'text-success',
    halo: 'bg-success/20',
    badge: 'text-success',
  },
  warning: {
    disc: 'from-warning/20 via-warning/10 to-coin/10 ring-warning/20',
    icon: 'text-warning',
    halo: 'bg-warning/20',
    badge: 'text-warning',
  },
  danger: {
    disc: 'from-danger/20 via-danger/10 to-accent/10 ring-danger/20',
    icon: 'text-danger',
    halo: 'bg-danger/20',
    badge: 'text-danger',
  },
}

/**
 * Etat vide illustre : medaillon en degrade doux avec une icone composee,
 * titre court, une phrase, un seul appel a l'action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
  badgeIcon: BadgeIcon = Sparkles,
  tone = 'accent',
  compact = false,
  className,
}: EmptyStateProps) {
  const t = TONES[tone]
  return (
    <div
      className={cn(
        'flex animate-fade-up flex-col items-center justify-center text-center',
        compact ? 'px-4 py-8' : 'px-6 py-14',
        className,
      )}
    >
      <div className={cn('relative isolate', compact ? 'mb-4' : 'mb-6')}>
        <span
          aria-hidden
          className={cn('absolute inset-0 -z-10 rounded-full', compact ? 'scale-125 blur-xl' : 'scale-150 blur-2xl', t.halo)}
        />
        <span
          aria-hidden
          className={cn(
            'relative flex items-center justify-center rounded-full bg-gradient-to-br shadow-highlight ring-1 ring-inset',
            compact ? 'h-16 w-16' : 'h-20 w-20',
            t.disc,
          )}
        >
          <Icon className={cn(compact ? 'h-7 w-7' : 'h-8 w-8', t.icon)} strokeWidth={1.8} />
        </span>
        <span
          aria-hidden
          className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full border border-edge bg-surface3 shadow-raised"
        >
          <BadgeIcon className={cn('h-4 w-4', t.badge)} strokeWidth={2} />
        </span>
        <span aria-hidden className="absolute -left-3 top-1 h-2 w-2 rounded-full bg-aura-2/50" />
        <span aria-hidden className="absolute -right-4 top-5 h-1.5 w-1.5 rounded-full bg-accent/40" />
      </div>
      <p className={cn('font-semibold tracking-tight text-ink', compact ? 'text-[16px]' : 'text-[18px]')}>{title}</p>
      <p className="mt-1.5 max-w-sm text-balance text-[14px] leading-relaxed text-soft">{description}</p>
      {actionLabel && onAction && (
        <Button className={compact ? 'mt-4' : 'mt-6'} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
