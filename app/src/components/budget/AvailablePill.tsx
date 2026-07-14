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

// Capsule mobile des lignes d'enveloppe : "assigne / activite / disponible"
// separes par des diagonales, en un coup d'oeil :
//   - ASSIGNE en ton attenue (contexte : ce qui a ete alloue) ;
//   - ACTIVITE coloree selon le signe (rouge = depense, vert = rentree) ;
//   - DISPONIBLE en gras et colore (vert si reste, rouge si depassement, neutre
//     si zero) : c'est la valeur qui compte.
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
  const Sep = () => (
    <span className="mx-1 text-soft/40" aria-hidden>
      /
    </span>
  )
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-surface2 px-2.5 py-1 text-[12.5px] tnum',
        className,
      )}
      title={`Assigné ${fmtEUR(assigned)} · Activité ${fmtEUR(activity)} · Disponible ${fmtEUR(available)}`}
    >
      <span className="text-soft">{fmtCompact(assigned)}</span>
      <Sep />
      <span
        className={cn(
          activity < 0 && 'text-danger',
          activity > 0 && 'text-success',
          activity === 0 && 'text-soft',
        )}
      >
        {fmtCompact(activity)}
      </span>
      <Sep />
      <span
        className={cn(
          'font-semibold',
          available > 0 && 'text-success',
          available < 0 && 'text-danger',
          available === 0 && 'text-soft',
        )}
      >
        {fmtCompact(available)}
      </span>
    </span>
  )
}
