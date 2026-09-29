import { useId } from 'react'
import { cn } from '@/lib/utils'

export type SparklineTone = 'accent' | 'aura' | 'danger' | 'neutral'

// Couleurs en style CSS (les attributs SVG ne resolvent pas var()).
const COLORS: Record<SparklineTone, string> = {
  accent: 'rgb(var(--accent))',
  aura: 'rgb(var(--aura-2))',
  danger: 'rgb(var(--danger))',
  neutral: 'rgb(var(--soft))',
}

const W = 100
const H = 32
const PAD = 3

type Point = [number, number]

/**
 * Trace lisse sans depassement (interpolation monotone de Fritsch-Carlson,
 * comme curveMonotoneX de d3) : une courbe de solde ne doit jamais inventer un
 * creux ou un pic qui n'existe pas.
 */
function monotonePath(pts: Point[]): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0]![0]},${pts[0]![1]}`
  if (n === 2) return `M${pts[0]![0]},${pts[0]![1]}L${pts[1]![0]},${pts[1]![1]}`
  const m = new Array<number>(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    const [x0, y0] = pts[i - 1]!
    const [x1, y1] = pts[i]!
    const [x2, y2] = pts[i + 1]!
    const h0 = x1 - x0
    const h1 = x2 - x1
    const s0 = (y1 - y0) / h0
    const s1 = (y2 - y1) / h1
    const p = (s0 * h1 + s1 * h0) / (h0 + h1)
    m[i] = (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0
  }
  const end = (a: Point, b: Point, t: number) => {
    const h = b[0] - a[0]
    return h ? (3 * (b[1] - a[1])) / h / 2 - t / 2 : t
  }
  m[0] = end(pts[0]!, pts[1]!, m[1]!)
  m[n - 1] = end(pts[n - 2]!, pts[n - 1]!, m[n - 2]!)
  let d = `M${pts[0]![0]},${pts[0]![1]}`
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!
    const [x1, y1] = pts[i + 1]!
    const dx = (x1 - x0) / 3
    d += `C${x0 + dx},${y0 + dx * m[i]!} ${x1 - dx},${y1 - dx * m[i + 1]!} ${x1},${y1}`
  }
  return d
}

interface SparklineProps {
  values: number[]
  tone?: SparklineTone
  /** Remplissage degrade sous la courbe. */
  area?: boolean
  /** Point lumineux sur la derniere valeur (le solde actuel). */
  endDot?: boolean
  strokeWidth?: number
  className?: string
}

/**
 * Mini-courbe SVG pure (sans Recharts) : s'etire a la largeur de son
 * conteneur, trait d'epaisseur constante, degrade qui s'eteint vers le bas et
 * vers le passe. Decorative (aria-hidden) : le montant voisin porte le sens.
 */
export function Sparkline({
  values,
  tone = 'accent',
  area = true,
  endDot = true,
  strokeWidth = 2,
  className,
}: SparklineProps) {
  const id = useId().replace(/:/g, '')
  if (values.length < 2) return <div aria-hidden className={className} />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const pts: Point[] = values.map((v, i) => [
    (i / (values.length - 1)) * W,
    span === 0 ? H / 2 : PAD + (1 - (v - min) / span) * (H - 2 * PAD),
  ])
  const line = monotonePath(pts)
  const color = COLORS[tone]
  const last = pts[pts.length - 1]!

  return (
    <div aria-hidden className={cn('relative animate-fade-in', className)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
        <defs>
          <linearGradient id={`${id}-fill`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={H}>
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.24 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
          <linearGradient id={`${id}-stroke`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.35 }} />
            <stop offset="70%" style={{ stopColor: color, stopOpacity: 0.9 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        {area && <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${id}-fill)`} stroke="none" />}
        <path
          d={line}
          fill="none"
          stroke={`url(#${id}-stroke)`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {endDot && (
        <span
          className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-surface"
          style={{ left: '100%', top: `${(last[1] / H) * 100}%`, backgroundColor: color }}
        />
      )}
    </div>
  )
}
