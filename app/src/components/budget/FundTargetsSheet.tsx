import { TriangleAlert, Target as TargetIcon } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { GroupPill } from '@/components/shared/GroupPill'
import { Amount } from '@/components/shared/Amount'
import { fmtEUR } from '@/lib/format'
import type { CategoryGroup } from '@/types/domain'
import { cn } from '@/lib/utils'

/** Une ligne du plan de financement : ce qui sera AJOUTE a une categorie. */
export interface FundPlanItem {
  categoryId: string
  categoryName: string
  group: CategoryGroup
  /** Assignation actuelle du mois (centimes). */
  currentAssigned: number
  /** Supplement a assigner ce mois pour honorer l'objectif (centimes, > 0). */
  add: number
}

interface FundTargetsSheetProps {
  open: boolean
  items: FundPlanItem[]
  /** Total a assigner = somme des `add`. */
  total: number
  /** Pret a assigner AVANT l'operation. */
  rta: number
  onConfirm: () => void
  onClose: () => void
}

/**
 * Apercu de l'assignation guidee "Financer les objectifs" (INAB-6). Liste les
 * categories concernees, le montant ajoute a chacune et le total, puis le Pret a
 * assigner restant apres l'operation. Si le total depasse le RTA disponible, on
 * AVERTIT sans bloquer (assigner plus que le RTA est autorise, RTA affiche en
 * rouge — coherent avec CLAUDE.md). Feuille en bas sur mobile, modale au centre
 * sur desktop ; cibles tactiles >= 44px.
 */
export function FundTargetsSheet({ open, items, total, rta, onConfirm, onClose }: FundTargetsSheetProps) {
  const rtaAfter = rta - total
  const overBudget = rtaAfter < 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <TargetIcon className="h-4 w-4" />
            </span>
            Financer les objectifs
          </DialogTitle>
          <DialogDescription>
            {items.length === 1
              ? 'Une catégorie va être complétée pour atteindre son objectif ce mois-ci.'
              : `${items.length} catégories vont être complétées pour atteindre leur objectif ce mois-ci.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <ul className="divide-y divide-line/60">
            {items.map((item) => (
              <li key={item.categoryId} className="flex items-center gap-3 py-2.5">
                <GroupPill group={item.group} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{item.categoryName}</p>
                  <p className="text-[12.5px] text-soft tnum">
                    {fmtEUR(item.currentAssigned)} → {fmtEUR(item.currentAssigned + item.add)}
                  </p>
                </div>
                <Amount cents={item.add} signed className="shrink-0 text-[15px] font-semibold text-success" />
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 border-t border-line p-5">
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-medium text-soft">Total à assigner</span>
            <Amount cents={total} className="text-[17px] font-semibold" />
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[14px] font-medium text-soft">Prêt à assigner après</span>
            <Amount
              cents={rtaAfter}
              className={cn('text-[17px] font-semibold', overBudget ? 'text-danger' : 'text-ink')}
            />
          </div>

          {overBudget && (
            <p className="flex items-start gap-2 rounded-xl bg-danger/10 p-3 text-[13px] font-medium text-danger">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Ce financement dépasse votre Prêt à assigner de {fmtEUR(-rtaAfter)}. Vous pouvez
              tout de même valider : le Prêt à assigner passera en négatif.
            </p>
          )}

          <Button className="h-12 w-full text-[15px]" onClick={onConfirm}>
            Assigner {fmtEUR(total)}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
