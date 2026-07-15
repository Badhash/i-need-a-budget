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
