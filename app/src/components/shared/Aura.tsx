import { cn } from '@/lib/utils'

export type AuraTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral'
export type AuraIntensity = 'soft' | 'normal' | 'strong'

interface AuraProps {
  /** Couleur du halo : accent = aurore du theme (--aura-1 / --aura-2). */
  tone?: AuraTone
  /** soft (discret), normal (defaut du theme), strong (double lueur). */
  intensity?: AuraIntensity
  className?: string
}

// Couleurs des deux lueurs (tokens triplets RGB) par tonalite.
const STOPS: Record<AuraTone, [string, string]> = {
  accent: ['--aura-1', '--aura-2'],
  success: ['--success', '--aura-2'],
  warning: ['--warning', '--coin'],
  danger: ['--danger', '--accent'],
  neutral: ['--soft', '--soft'],
}

function glow(color: string, alpha: string, layers: number): string {
  const layer = `radial-gradient(closest-side, rgb(var(${color}) / var(${alpha})), transparent)`
  return Array.from({ length: layers }, () => layer).join(', ')
}

/**
 * Halo decoratif « aurore » : deux lueurs radiales tres douces, en coins
 * opposes, SOUS le contenu. A placer dans un parent `relative isolate
 * overflow-hidden` (Card variant="hero" le fait seul). Purement visuel :
 * aria-hidden, jamais interactif. Opacites de base par theme et mode
 * (--aura-a / --aura-b dans tokens.css).
 */
export function Aura({ tone = 'accent', intensity = 'normal', className }: AuraProps) {
  const [c1, c2] = STOPS[tone]
  const layers = intensity === 'strong' ? 2 : 1
  const opacity = intensity === 'soft' ? 0.6 : tone === 'neutral' ? 0.7 : 1
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]', className)}
      style={{ opacity }}
    >
      <div
        className="absolute -right-[20%] -top-[45%] h-[110%] w-[75%] rounded-full blur-2xl"
        style={{ background: glow(c1, '--aura-a', layers) }}
      />
      <div
        className="absolute -bottom-[55%] -left-[15%] h-full w-[65%] rounded-full blur-2xl"
        style={{ background: glow(c2, '--aura-b', layers) }}
      />
    </div>
  )
}
