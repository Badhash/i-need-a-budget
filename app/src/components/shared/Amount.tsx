import { cn } from '@/lib/utils'
import { fmtEUR, fmtEURSigned } from '@/lib/format'

interface AmountProps {
  cents: number
  className?: string
  /** colore le montant : rouge si negatif, vert si positif */
  colored?: boolean
  /** force l'affichage du signe + */
  signed?: boolean
}

export function Amount({ cents, className, colored, signed }: AmountProps) {
  return (
    <span
      className={cn(
        'tnum',
        colored && cents < 0 && 'text-danger',
        colored && cents > 0 && 'text-success',
        className,
      )}
    >
      {signed ? fmtEURSigned(cents) : fmtEUR(cents)}
    </span>
  )
}
