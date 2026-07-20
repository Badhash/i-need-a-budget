import { CheckCircle2 } from 'lucide-react'
import { fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'

export type PillTone = 'success' | 'warning' | 'neutral' | 'danger'

// Anneau de progression facon YNAB dans la pastille Disponible : cercle de
// piste attenue + arc proportionnel au ratio finance (stroke-dasharray sur la
// circonference, depart a midi via la rotation -90deg).
function ProgressRing({ ratio }: { ratio: number }) {
  const r = 5
  const c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 14 14" className="h-3.5 w-3.5 shrink-0 -rotate-90" aria-hidden>
      <circle cx="7" cy="7" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <circle
        cx="7"
        cy="7"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeDasharray={`${Math.max(ratio, 0.02) * c} ${c}`}
        strokeLinecap="round"
      />
    </svg>
  )
}

const toneClasses: Record<PillTone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  neutral: 'bg-surface2 text-soft',
  danger: 'bg-danger/10 text-danger',
}

export function AvailablePill({
  cents,
  tone,
  ratio,
  done,
  className,
}: {
  cents: number
  /** Tonalite explicite (statut YNAB) ; par defaut derivee du signe du montant. */
  tone?: PillTone
  /** Ratio [0..1] de l'anneau de progression ; omis = pas d'anneau. */
  ratio?: number
  /** Enveloppe entierement consommee : coche a la place de l'anneau. */
  done?: boolean
  className?: string
}) {
  const resolved: PillTone = tone ?? (cents > 0 ? 'success' : cents < 0 ? 'danger' : 'neutral')
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-semibold tnum',
        toneClasses[resolved],
        className,
      )}
    >
      {done ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      ) : ratio !== undefined ? (
        <ProgressRing ratio={ratio} />
      ) : null}
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
