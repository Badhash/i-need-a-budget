import { Sparkles, TriangleAlert } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { GroupPill } from '@/components/shared/GroupPill'
import { Amount } from '@/components/shared/Amount'
import { Aura } from '@/components/shared/Aura'
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
 * sur desktop ; cibles tactiles >= 44px. Valider = UNE etape d'historique.
 */
export function FundTargetsSheet({ open, items, total, rta, onConfirm, onClose }: FundTargetsSheetProps) {
  const rtaAfter = rta - total
  const overBudget = rtaAfter < 0

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader className="pr-14 pt-6">
          <DialogTitle className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-accentfg shadow-button">
              <Sparkles className="h-5 w-5" />
            </span>
            Financer les objectifs
          </DialogTitle>
          <DialogDescription>
            {items.length === 1
              ? 'Une enveloppe va être complétée pour tenir son objectif ce mois-ci.'
              : `${items.length} enveloppes vont être complétées pour tenir leur objectif ce mois-ci.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <ul className="stagger divide-y divide-line/60">
            {items.map((item) => (
              <li key={item.categoryId} className="flex min-h-[60px] items-center gap-3 py-2.5">
                <GroupPill group={item.group} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium text-ink">{item.categoryName}</p>
                  <p className="text-[12.5px] text-soft tnum">
                    Assigné {fmtEUR(item.currentAssigned)} → {fmtEUR(item.currentAssigned + item.add)}
                  </p>
                </div>
                <Amount cents={item.add} signed className="shrink-0 text-[15px] font-semibold text-success" />
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 border-t border-line/70 p-5">
          <div className="relative isolate overflow-hidden rounded-2xl border border-edge bg-surface2/40 px-4 py-3.5">
            <Aura tone={overBudget ? 'danger' : 'accent'} intensity="soft" />
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[14px] font-medium text-soft">Total à assigner</span>
              <Amount cents={total} className="text-[19px] font-semibold tracking-tight text-ink" />
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-3">
              <span className="text-[13px] text-soft">Prêt à assigner après</span>
              <Amount
                cents={rtaAfter}
                className={cn('text-[15px] font-semibold', overBudget ? 'text-danger' : 'text-ink')}
              />
            </div>
          </div>

          {overBudget && (
            <p className="flex items-start gap-2 rounded-xl bg-danger/10 p-3 text-[13px] font-medium leading-snug text-danger">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              Ce financement dépasse votre Prêt à assigner de {fmtEUR(-rtaAfter)}. Vous pouvez tout de même
              valider : le Prêt à assigner passera en négatif.
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
