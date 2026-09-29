// Briques communes des graphes de la page Rapports : infobulle en verre,
// puces de legende, identifiants de degrades, mouvement reduit et compteur
// revele au montage. Les couleurs viennent des tokens (CSS) ou de la palette
// du theme (CHART_PALETTES via useChartPalette) : jamais de couleur en dur.

import { useEffect, useId, useState, type ReactNode } from 'react'
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber'
import { cn } from '@/lib/utils'

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

/** Vrai si l'utilisateur demande un mouvement reduit (suivi en direct). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(REDUCED_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(REDUCED_QUERY)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/**
 * Compteur « revele » : part de 0 au montage puis suit la valeur cible en
 * douceur a chaque changement (mois, periode). Mouvement reduit : valeur
 * finale immediate, aucune animation.
 */
export function useRevealNumber(target: number, durationMs = 650): number {
  const [armed, setArmed] = useState(() => typeof window === 'undefined' || window.matchMedia(REDUCED_QUERY).matches)
  useEffect(() => {
    if (armed) return
    const id = requestAnimationFrame(() => setArmed(true))
    return () => cancelAnimationFrame(id)
  }, [armed])
  return useAnimatedNumber(armed ? target : 0, durationMs)
}

/** Identifiants uniques (degrades SVG) : deux graphes ne se marchent jamais dessus. */
export function useChartIds<const K extends string>(...names: K[]): Record<K, string> {
  const base = useId().replace(/:/g, '')
  return Object.fromEntries(names.map((n) => [n, `${n}-${base}`])) as Record<K, string>
}

/** Proprietes d'animation Recharts : courtes, coupees en mouvement reduit. */
export function chartMotion(reduced: boolean) {
  return { isAnimationActive: !reduced, animationDuration: 650, animationEasing: 'ease-out' as const }
}

// ---------------------------------------------------------------------------
// Infobulle en verre
// ---------------------------------------------------------------------------

export function GlassTooltip({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div className="glass pointer-events-none min-w-[9.5rem] rounded-xl border border-line/60 px-3 py-2.5 text-[12.5px] shadow-elevated">
      {title && <p className="mb-1.5 text-[12px] font-medium text-soft">{title}</p>}
      <div className="space-y-1">{children}</div>
    </div>
  )
}

type KeyShape = 'line' | 'dash' | 'dot' | 'bar'

/** Petite cle de serie (trait, pointilles, point ou barre) de la couleur de la serie. */
export function SeriesKey({ color, shape = 'dot', className }: { color: string; shape?: KeyShape; className?: string }) {
  if (shape === 'line' || shape === 'dash') {
    return (
      <svg aria-hidden width="14" height="6" viewBox="0 0 14 6" className={cn('shrink-0', className)}>
        <line
          x1="1"
          y1="3"
          x2="13"
          y2="3"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={shape === 'dash' ? '3 3' : undefined}
        />
      </svg>
    )
  }
  return (
    <span
      aria-hidden
      className={cn('shrink-0', shape === 'bar' ? 'h-2.5 w-2.5 rounded-[3px]' : 'h-2 w-2 rounded-full', className)}
      style={{ backgroundColor: color }}
    />
  )
}

/** Ligne d'infobulle : la valeur d'abord (forte), le libelle ensuite. */
export function TooltipRow({
  color,
  shape,
  label,
  value,
}: {
  color: string
  shape?: KeyShape
  label: ReactNode
  value: ReactNode
}) {
  return (
    <p className="flex items-center gap-2 whitespace-nowrap">
      <SeriesKey color={color} shape={shape} />
      <span className="font-semibold text-ink tnum">{value}</span>
      <span className="text-soft">{label}</span>
    </p>
  )
}

/** Puce de legende (pilule discrete) : cle de serie + libelle en encre attenuee. */
export function LegendChip({ color, shape = 'dot', children }: { color: string; shape?: KeyShape; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-surface2/80 px-2.5 py-1 text-[12px] font-medium text-soft ring-1 ring-inset ring-edge">
      <SeriesKey color={color} shape={shape} />
      {children}
    </span>
  )
}
