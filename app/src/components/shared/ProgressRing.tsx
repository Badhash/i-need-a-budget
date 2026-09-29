import { useId, type ReactNode } from 'react'
import { PROGRESS_TONES, useMountedFlag, type ProgressTone } from '@/components/shared/ProgressBar'
import { cn } from '@/lib/utils'

interface ProgressRingProps {
  /** Progression 0..1 (bornee). */
  value: number
  tone?: ProgressTone
  /** Diametre en px (defaut 44). */
  size?: number
  /** Epaisseur du trait en px (defaut : ~10 % du diametre, min 3). */
  strokeWidth?: number
  /** Contenu centre (pourcentage, icone). */
  children?: ReactNode
  animateOnMount?: boolean
  className?: string
  label?: string
}

/** Anneau de progression SVG (trait arrondi, anime) ; accent = degrade de marque. */
export function ProgressRing({
  value,
  tone = 'accent',
  size = 44,
  strokeWidth,
  children,
  animateOnMount = true,
  className,
  label,
}: ProgressRingProps) {
  const mounted = useMountedFlag(animateOnMount)
  const gradientId = `ring-${useId().replace(/:/g, '')}`
  const ratio = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  const stroke = strokeWidth ?? Math.max(3, Math.round(size / 10))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - (mounted ? ratio : 0))
  const t = PROGRESS_TONES[tone]
  const center = size / 2

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      aria-label={label}
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        {tone === 'accent' && (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style={{ stopColor: 'rgb(var(--accent))' }} />
              <stop offset="100%" style={{ stopColor: 'rgb(var(--accent-2))' }} />
            </linearGradient>
          </defs>
        )}
        <circle cx={center} cy={center} r={radius} fill="none" strokeWidth={stroke} className={t.trackStroke} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          // Un trait de longueur nulle a bouts ronds dessinerait un point.
          strokeOpacity={ratio > 0 ? 1 : 0}
          className={cn('transition-[stroke-dashoffset] duration-600 ease-spring', tone !== 'accent' && t.stroke)}
          style={tone === 'accent' ? { stroke: `url(#${gradientId})` } : undefined}
        />
      </svg>
      {children !== undefined && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tnum">
          {children}
        </div>
      )}
    </div>
  )
}
