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
export function TargetBar({ target, assigned, available }: TargetBarProps) {
  const funded = target.type === 'monthly' ? assigned : available
  const safeFunded = Math.max(funded, 0)
  const ratio = target.amount > 0 ? Math.min(safeFunded / target.amount, 1) : 0
  const done = target.amount > 0 && funded >= target.amount

  const suffix =
    target.type === 'monthly'
      ? '/mois'
      : target.dueMonth
        ? ` d'ici ${fmtMonthLong(target.dueMonth)}`
        : ''
  const label = done
    ? 'Objectif atteint'
    : `${fmtEUR(safeFunded)} sur ${fmtEUR(target.amount)}${suffix}`

  return (
    // Pleine largeur, toujours affichee, sur mobile ET desktop (pas de plafond
    // de largeur). Couleurs de l'accent du THEME (piste = accent attenue) pour
    // rester coherent quel que soit le groupe ; vert quand l'objectif est
    // atteint.
    <div className="mt-2 w-full">
      <div
        className="h-2 w-full overflow-hidden rounded-full lg:h-1.5"
        style={{
          backgroundColor: done ? 'rgb(var(--success) / 0.15)' : 'rgb(var(--accent) / 0.15)',
        }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-300 ease-out"
          style={{
            width: `${Math.max(ratio * 100, safeFunded > 0 ? 3 : 0)}%`,
            backgroundColor: done ? 'rgb(var(--success))' : 'rgb(var(--accent))',
          }}
        />
      </div>
      <p className="mt-1 flex items-baseline justify-between gap-2 text-[12px] lg:text-[11.5px]">
        <span className={cn('flex min-w-0 items-center gap-1', done ? 'text-success' : 'text-soft')}>
          {done && <Check className="h-3 w-3 shrink-0" />}
          <span className="truncate tnum">{label}</span>
        </span>
        <span className={cn('shrink-0 font-medium tnum', done ? 'text-success' : 'text-soft')}>
          {Math.round(ratio * 100)} %
        </span>
      </p>
    </div>
  )
}
