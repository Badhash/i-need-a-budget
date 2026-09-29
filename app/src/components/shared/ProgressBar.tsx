import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export type ProgressTone = 'success' | 'warning' | 'danger' | 'accent' | 'neutral'

// Classes statiques (JIT Tailwind) : piste attenuee + remplissage plein.
export const PROGRESS_TONES: Record<ProgressTone, { track: string; fill: string; stroke: string; trackStroke: string }> = {
  success: { track: 'bg-success/15', fill: 'bg-success', stroke: 'stroke-success', trackStroke: 'stroke-success/15' },
  warning: { track: 'bg-warning/15', fill: 'bg-gradient-to-r from-warning to-coin', stroke: 'stroke-warning', trackStroke: 'stroke-warning/15' },
  danger: { track: 'bg-danger/15', fill: 'bg-danger', stroke: 'stroke-danger', trackStroke: 'stroke-danger/15' },
  accent: { track: 'bg-accent/15', fill: 'bg-brand', stroke: 'stroke-accent', trackStroke: 'stroke-accent/15' },
  neutral: { track: 'bg-ink/[0.08]', fill: 'bg-soft', stroke: 'stroke-soft', trackStroke: 'stroke-ink/10' },
}

const HEIGHTS = {
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-3',
}

// Largeur minimale d'un remplissage non nul : au moins un disque plein.
const MIN_FILL = {
  sm: 'min-w-1.5',
  md: 'min-w-2',
  lg: 'min-w-3',
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
}

/** Vrai apres la premiere peinture : sert a animer un remplissage depuis 0. */
export function useMountedFlag(enabled: boolean): boolean {
  const [mounted, setMounted] = useState(!enabled)
  useEffect(() => {
    if (!enabled) return
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [enabled])
  return mounted
}

interface ProgressBarProps {
  /** Progression 0..1 (bornee). */
  value: number
  tone?: ProgressTone
  /** Repere optionnel (0..1), ex. la cible attendue a date. */
  target?: number
  size?: keyof typeof HEIGHTS
  /** Anime le remplissage depuis 0 au montage (defaut : oui). */
  animateOnMount?: boolean
  className?: string
  /** Libelle accessible (role progressbar). */
  label?: string
}

/**
 * Jauge arrondie : piste teintee, remplissage anime (courbe ressort), repere
 * de cible optionnel. Le ton porte le sens (success = finance, warning = sous-
 * finance, danger = depassement, accent = neutre de marque).
 */
export function ProgressBar({
  value,
  tone = 'accent',
  target,
  size = 'md',
  animateOnMount = true,
  className,
  label,
}: ProgressBarProps) {
  const mounted = useMountedFlag(animateOnMount)
  const ratio = clamp01(value)
  const t = PROGRESS_TONES[tone]
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label={label}
      className={cn('relative w-full', HEIGHTS[size], className)}
    >
      <div className={cn('absolute inset-0 overflow-hidden rounded-full', t.track)}>
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-600 ease-spring',
            t.fill,
            ratio > 0 && MIN_FILL[size],
          )}
          style={{ width: `${mounted ? ratio * 100 : 0}%` }}
        />
      </div>
      {target !== undefined && (
        <span
          aria-hidden
          className="absolute top-1/2 h-[calc(100%+8px)] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/70 ring-2 ring-surface"
          style={{ left: `${clamp01(target) * 100}%` }}
        />
      )}
    </div>
  )
}
