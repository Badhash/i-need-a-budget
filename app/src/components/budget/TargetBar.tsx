import { Check } from 'lucide-react'
import { neededThisMonth, targetProgress, type Target } from '@/lib/targets'
import { fmtEUR, fmtMonthLong } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { ProgressBar, type ProgressTone } from '@/components/shared/ProgressBar'
import { cn } from '@/lib/utils'

interface TargetBarProps {
  target: Target
  /** Montant assigne a la categorie pour le mois courant (centimes). */
  assigned: number
  /** Disponible cumule de la categorie (rollover + assigne + activite). */
  available: number
  /** Couleur pastel du groupe (cle des tokens --cat-<color>-fg). */
  color: string
  /** Mois affiche (defaut : celui du selecteur de mois). */
  month?: string
}

/** Libelle de progression d'un objectif (a gauche de la jauge). */
function progressLabel(target: Target, funded: number, reached: boolean): string {
  const safe = Math.max(funded, 0)
  switch (target.type) {
    case 'monthly':
      return reached ? `Financé · ${fmtEUR(target.amount)}/mois` : `${fmtEUR(safe)} sur ${fmtEUR(target.amount)}/mois`
    case 'refill':
      return reached ? `Enveloppe pleine · ${fmtEUR(target.amount)}` : `Recharge : ${fmtEUR(safe)} sur ${fmtEUR(target.amount)}`
    default:
      if (reached) return `Objectif atteint · ${fmtEUR(target.amount)}`
      return `${fmtEUR(safe)} sur ${fmtEUR(target.amount)}${target.dueMonth ? ` d'ici ${fmtMonthLong(target.dueMonth)}` : ''}`
  }
}

/**
 * Jauge d'objectif affichee sous une enveloppe (liste mobile et grille
 * desktop). Progression : assigne du mois (mensuel), disponible cumule
 * (echeance, recharge). Ton : vert quand le mois est finance, ambre tant
 * qu'il manque de l'argent ce mois-ci (montant rappele a droite), rouge si
 * l'enveloppe est dans le rouge.
 */
export function TargetBar({ target, assigned, available, month }: TargetBarProps) {
  const uiMonth = useUiStore((s) => s.month)
  const m = month ?? uiMonth
  const { funded, ratio, reached } = targetProgress(target, assigned, available)
  const needed = neededThisMonth(target, m, assigned, available)
  const tone: ProgressTone = available < 0 ? 'danger' : needed > 0 ? 'warning' : 'success'

  return (
    <div className="mt-2 w-full">
      <ProgressBar
        value={ratio}
        tone={tone}
        size="sm"
        className="h-2 lg:h-1.5"
        label={`Objectif : ${Math.round(ratio * 100)} %`}
      />
      <p className="mt-1.5 flex items-baseline justify-between gap-2 text-[12px] leading-tight lg:mt-1 lg:text-[11.5px]">
        <span className="min-w-0 truncate text-soft tnum">{progressLabel(target, funded, reached)}</span>
        {needed > 0 ? (
          <span className={cn('shrink-0 font-semibold tnum', tone === 'danger' ? 'text-danger' : 'text-warning')}>
            Encore {fmtEUR(needed)}
          </span>
        ) : (
          <span
            className={cn(
              'flex shrink-0 items-center gap-0.5 font-semibold tnum',
              tone === 'danger' ? 'text-danger' : 'text-success',
            )}
          >
            {tone !== 'danger' && <Check className="h-3 w-3" strokeWidth={3} />}
            {Math.round(ratio * 100)} %
          </span>
        )}
      </p>
    </div>
  )
}
