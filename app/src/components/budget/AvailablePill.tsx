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

// Capsule mobile des lignes d'enveloppe : "assigne / activite" separes par une
// diagonale. Code couleur en un coup d'oeil :
//   - TEINTE DE FOND = ce qui reste (disponible) : vert si positif, rouge si
//     depassement, neutre si zero ;
//   - l'ASSIGNE en ton neutre (reference), l'ACTIVITE coloree selon le signe
//     (rouge = depense, vert = rentree).
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
        'inline-flex items-center rounded-full px-2.5 py-1 text-[12.5px] font-semibold tnum',
        available > 0 && 'bg-success/10',
        available === 0 && 'bg-surface2',
        available < 0 && 'bg-danger/10',
        className,
      )}
      title={`Assigné ${fmtEUR(assigned)} · Activité ${fmtEUR(activity)} · Disponible ${fmtEUR(available)}`}
    >
      <span className="text-ink">{fmtCompact(assigned)}</span>
      <span className="mx-1 text-soft/50" aria-hidden>
        /
      </span>
      <span
        className={cn(
          activity < 0 && 'text-danger',
          activity > 0 && 'text-success',
          activity === 0 && 'text-soft',
        )}
      >
        {fmtCompact(activity)}
      </span>
    </span>
  )
}
