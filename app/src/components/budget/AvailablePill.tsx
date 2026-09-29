import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes } from 'react'
import { fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'

export function AvailablePill({ cents, className }: { cents: number; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[13px] font-semibold tnum',
        cents > 0 && 'bg-success/10 text-success',
        cents === 0 && 'bg-surface2 text-soft',
        cents < 0 && 'bg-danger/10 text-danger',
        className,
      )}
    >
      {fmtEUR(cents)}
    </span>
  )
}

// Montant compact (euros entiers) pour tenir deux valeurs dans une capsule etroite.
function fmtCompact(cents: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

// Capsule mobile des lignes d'enveloppe : trois cases collees
// "assigne | activite | disponible", entierement derivees des tokens du
// theme (corail / menthe / nuit) pour se decliner automatiquement :
//   - ASSIGNE : contexte neutre, fond surface, texte attenue ;
//   - ACTIVITE : mouvement du mois, teinte selon le signe (danger = depense,
//     success = rentree, neutre si zero) ;
//   - DISPONIBLE : la valeur cle, teintee dans l'ACCENT du theme quand il
//     reste de l'argent (corail, menthe ou violet selon le theme actif),
//     danger si depassement, neutre si zero.
export function AssignActivityPill({
  assigned,
  activity,
  available,
  className,
}: {
  assigned: number
  activity: number
  available: number
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-stretch divide-x divide-line overflow-hidden rounded-full border border-line text-[12.5px] font-medium tnum',
        className,
      )}
      title={`Assigné ${fmtEUR(assigned)} · Activité ${fmtEUR(activity)} · Disponible ${fmtEUR(available)}`}
    >
      <span className="bg-surface2 px-2 py-1 text-soft">{fmtCompact(assigned)}</span>
      <span
        className={cn(
          'px-2 py-1',
          activity < 0 && 'bg-danger/10 text-danger',
          activity > 0 && 'bg-success/10 text-success',
          activity === 0 && 'bg-surface2 text-soft',
        )}
      >
        {fmtCompact(activity)}
      </span>
      <span
        className={cn(
          'px-2 py-1 font-semibold',
          available > 0 && 'bg-accent/15 text-accent',
          available < 0 && 'bg-danger/15 text-danger',
          available === 0 && 'bg-surface2 text-soft',
        )}
      >
        {fmtCompact(available)}
      </span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Grille desktop : pastille « Disponible » cliquable (deplacer de l'argent)
// ---------------------------------------------------------------------------

/**
 * Ton semantique d'un disponible : danger si negatif (depassement), warning si
 * un objectif reste sous-finance ce mois-ci, success s'il reste de l'argent,
 * neutre a zero.
 */
export type AvailableTone = 'success' | 'warning' | 'danger' | 'neutral'

export function availableTone(cents: number, underfunded = false): AvailableTone {
  if (cents < 0) return 'danger'
  if (underfunded) return 'warning'
  if (cents > 0) return 'success'
  return 'neutral'
}

// Classes statiques (JIT Tailwind) : fond teinte, texte AA, filet interieur,
// survol un cran plus dense, etat ouvert (popover) souligne par un anneau.
const TONE_CLASSES: Record<AvailableTone, string> = {
  success:
    'bg-success/10 text-success ring-success/20 hover:bg-success/15 hover:ring-success/35 aria-expanded:ring-success/50',
  warning:
    'bg-warning/10 text-warning ring-warning/25 hover:bg-warning/15 hover:ring-warning/40 aria-expanded:ring-warning/55',
  danger: 'bg-danger/10 text-danger ring-danger/20 hover:bg-danger/15 hover:ring-danger/35 aria-expanded:ring-danger/50',
  neutral: 'bg-ink/[0.05] text-soft ring-line hover:bg-ink/[0.08] hover:text-ink aria-expanded:ring-soft/50',
}

interface AvailableButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Montant affiche (centimes). */
  cents: number
  tone: AvailableTone
  /** Apercu pendant la saisie de l'assigne : contour pointille = pas encore valide. */
  draft?: boolean
  /**
   * Affichage immediat, sans compteur : apercu de saisie, ou valeur tout juste
   * validee en attendant le cache (le compteur repartirait de l'ancienne).
   */
  instant?: boolean
}

// Sortie douce (ease-out quartique), comme useAnimatedNumber.
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4)

/**
 * Compteur vers la valeur cible (450 ms), qui peut aussi SAUTER directement a
 * la cible (`instant`) : le point de depart du prochain compteur est alors la
 * valeur affichee, jamais une valeur perimee. Coupe sous prefers-reduced-motion.
 */
function useCountTo(target: number, instant: boolean): number {
  const [value, setValue] = useState(target)
  const shownRef = useRef(target)
  useEffect(() => {
    const from = shownRef.current
    if (from === target) return
    if (instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shownRef.current = target
      setValue(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 450)
      const current = Math.round(from + (target - from) * easeOut(t))
      shownRef.current = current
      setValue(current)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, instant])
  return instant ? target : value
}

/**
 * Pastille « Disponible » de la grille desktop : bouton qui ouvre le popover
 * de deplacement d'argent. Largeur minimale commune pour que les montants
 * s'alignent en colonne, chiffres tabulaires ; un changement de valeur (argent
 * deplace, reconciliation) defile en compteur.
 */
export const AvailableButton = forwardRef<HTMLButtonElement, AvailableButtonProps>(
  ({ cents, tone, draft, instant = false, className, ...props }, ref) => {
    const shown = useCountTo(cents, instant)
    return (
      <button
        ref={ref}
        type="button"
        className={cn(
          'relative inline-flex h-8 min-w-[84px] items-center justify-end rounded-full px-3 text-[13.5px] font-semibold tnum ring-1 ring-inset xl:min-w-[92px]',
          'transition-[background-color,box-shadow,color,transform] duration-150 ease-spring active:scale-[0.97]',
          "after:absolute after:-inset-1.5 after:content-['']",
          'focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-0',
          TONE_CLASSES[tone],
          draft && 'outline-dashed outline-1 outline-offset-2 outline-ink/30',
          className,
        )}
        {...props}
      >
        {fmtEUR(shown)}
      </button>
    )
  },
)
AvailableButton.displayName = 'AvailableButton'
