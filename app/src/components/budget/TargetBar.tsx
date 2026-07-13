import { Check } from 'lucide-react'
import type { Target } from '@/lib/targets'
import { fmtEUR, fmtMonthLong } from '@/lib/format'
import { cn } from '@/lib/utils'

interface TargetBarProps {
  target: Target
  /** Montant assigne a la categorie pour le mois courant (centimes). */
  assigned: number
  /** Disponible cumule de la categorie (rollover + assigne + activite). */
  available: number
  /** Couleur pastel du groupe (cle des tokens --cat-<color>-fg). */
  color: string
}

/**
 * Barre de progression "finance" affichee sous une categorie qui porte un
 * objectif. Objectif mensuel : progression = assigne / montant. Objectif pour
 * une date : progression = disponible cumule / montant (epargne accumulee).
 */
export function TargetBar({ target, assigned, available, color }: TargetBarProps) {
  const funded = target.type === 'monthly' ? assigned : available
  const safeFunded = Math.max(funded, 0)
  const ratio = target.amount > 0 ? Math.min(safeFunded / target.amount, 1) : 0
  const done = target.amount > 0 && funded >= target.amount

  const label =
    target.type === 'monthly'
      ? `Objectif ${fmtEUR(target.amount)}/mois`
      : `Objectif ${fmtEUR(target.amount)}${target.dueMonth ? ` d'ici ${fmtMonthLong(target.dueMonth)}` : ''}`

  return (
    <div className="mt-1.5 max-w-[200px]">
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface2">
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out"
          style={{
            width: `${Math.max(ratio * 100, safeFunded > 0 ? 4 : 0)}%`,
            backgroundColor: done ? 'rgb(var(--success))' : `var(--cat-${color}-fg)`,
          }}
        />
      </div>
      <p className={cn('mt-1 flex items-center gap-1 text-[11.5px]', done ? 'text-success' : 'text-soft')}>
        {done && <Check className="h-3 w-3 shrink-0" />}
        <span>{label}</span>
      </p>
    </div>
  )
}
