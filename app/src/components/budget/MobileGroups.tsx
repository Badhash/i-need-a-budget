import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import { overspendingOf, type BudgetGroupBlock, type BudgetMonth, type BudgetRow } from '@/lib/budget'
import type { Target } from '@/lib/targets'
import { useUiStore } from '@/stores/ui'
import { AssignSheet } from '@/components/budget/AssignSheet'
import {
  CategoryActionSheet,
} from '@/components/budget/CategoryActionSheet'
import { useLongPress } from '@/hooks/useLongPress'
import { useReorderCategoriesMutation } from '@/lib/taxonomy'
import { AvailablePill, AssignActivityPill } from '@/components/budget/AvailablePill'
import { TargetBar } from '@/components/budget/TargetBar'
import { GroupPill } from '@/components/shared/GroupPill'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  isEmptyRow,
  useAssignMutation,
  useMoveMutation,
  moveTargetsFor,
} from '@/components/budget/budgetMutations'
import type { GridProps } from '@/components/budget/gridTypes'

/**
 * Ligne d'enveloppe mobile, volontairement minimale : nom + disponible (et la
 * barre d'objectif s'il y en a un). Tape = feuille d'assignation ; appui long
 * = menu contextuel (renommer, objectif, deplacer, supprimer). Tout le detail
 * (assigne, activite) vit dans la feuille, pas dans la liste.
 */
function MobileCategoryRow({
  row,
  block,
  target,
  onTap,
  onLongPress,
}: {
  row: BudgetRow
  block: BudgetGroupBlock
  target: Target | undefined
  onTap: () => void
  onLongPress: () => void
}) {
  const { handlers, firedRecently } = useLongPress(onLongPress)

  return (
    <button
      type="button"
      {...handlers}
      onClick={() => {
        if (!firedRecently()) onTap()
      }}
      className="flex min-h-[56px] w-full select-none flex-col justify-center gap-1.5 px-4 py-3 text-left transition-colors [-webkit-touch-callout:none] active:bg-surface2/60"
      aria-label={`${row.category.name} : assigner (appui long pour plus d'actions)`}
    >
      <div className="flex w-full items-center gap-3">
        <p className="min-w-0 flex-1 truncate font-medium">{row.category.name}</p>
        <AssignActivityPill assigned={row.assigned} activity={row.activity} available={row.available} />
      </div>
      {/* Barre d'objectif en PLEINE LARGEUR de la carte, sous le nom + le montant. */}
      {target && (
        <TargetBar
          target={target}
          assigned={row.assigned}
          available={row.available}
          color={block.group.color}
        />
      )}
    </button>
  )
}

export function MobileGroups({ groups, month, targets, onOpenTarget, onViewActivity, hideEmptyRows }: GridProps) {
  const assign = useAssignMutation(month)
  const move = useMoveMutation(month)
  const queryClient = useQueryClient()
  const reorder = useReorderCategoriesMutation()
  const collapsedGroups = useUiStore((s) => s.collapsedGroups)
  const toggleGroup = useUiStore((s) => s.toggleGroupCollapsed)
  // Feuille d'assignation (tape) et menu contextuel (appui long).
  const [assignRow, setAssignRow] = useState<BudgetRow | null>(null)
  const [actionCtx, setActionCtx] = useState<{ block: BudgetGroupBlock; index: number } | null>(null)

  // Voisin VISIBLE d'une ligne : avec « Masquer les lignes vides », permuter
  // avec une ligne cachee ne changerait rien a l'ecran.
  const visibleNeighbour = (block: BudgetGroupBlock, index: number, direction: -1 | 1): number | null => {
    const visible = block.rows
      .map((_row, i) => i)
      .filter((i) => !hideEmptyRows || !isEmptyRow(block.rows[i]!))
    const pos = visible.indexOf(index)
    if (pos === -1) return null
    return visible[pos + direction] ?? null
  }

  // Deplace la categorie dans son groupe : reordonne le cache budget
  // immediatement (optimiste) et pousse l'ordre complet cote serveur. La ligne
  // est deplacee (et non permutee) jusqu'a la position de son voisin visible.
  const moveCategory = (block: BudgetGroupBlock, index: number, direction: -1 | 1) => {
    const to = visibleNeighbour(block, index, direction)
    if (to === null) return
    const moveItem = <T,>(list: T[]): T[] => {
      const out = [...list]
      const [item] = out.splice(index, 1)
      out.splice(to, 0, item!)
      return out
    }
    reorder.mutate({ groupId: block.group.id, orderedIds: moveItem(block.rows.map((r) => r.category.id)) })
    queryClient.setQueryData<BudgetMonth>(['budget', month], (old) => {
      if (!old) return old
      return {
        ...old,
        groups: old.groups.map((g) => (g.group.id !== block.group.id ? g : { ...g, rows: moveItem(g.rows) })),
      }
    })
  }

  return (
    <div className="space-y-4 lg:hidden">
      {groups
        // Groupe entierement vide masque (en-tete compris), qu'il soit replie
        // ou non. Un groupe gardant au moins une ligne visible reste affiche.
        .filter((block) => !hideEmptyRows || block.rows.some((row) => !isEmptyRow(row)))
        .map((block) => {
        const collapsed = Boolean(collapsedGroups[block.group.id])
        const Chevron = collapsed ? ChevronRight : ChevronDown
        const groupOverspent = overspendingOf(block.rows)
        return (
          <Card key={block.group.id} className="overflow-hidden">
            <button
              type="button"
              onClick={() => toggleGroup(block.group.id)}
              aria-expanded={!collapsed}
              className="flex min-h-[52px] w-full select-none items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors active:bg-surface2/60"
            >
              <Chevron className="h-5 w-5 shrink-0 text-soft" aria-hidden />
              <GroupPill group={block.group} size="md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{block.group.name}</span>
                {groupOverspent.count > 0 && (
                  <span className="block text-[12px] font-medium text-danger tnum">
                    {groupOverspent.count === 1
                      ? '1 enveloppe en dépassement'
                      : `${groupOverspent.count} enveloppes en dépassement`}
                  </span>
                )}
              </span>
              <AvailablePill
                cents={block.totals.available}
                className={cn(groupOverspent.count > 0 && block.totals.available >= 0 && 'ring-1 ring-danger/40')}
              />
            </button>
            {!collapsed && (
              <div className="divide-y divide-line/60">
                {block.rows
                  // On conserve l'index d'origine (menu contextuel / reordonnancement
                  // s'appuient sur block.rows complet) et on filtre au rendu.
                  .map((row, index) => ({ row, index }))
                  .filter(({ row }) => !hideEmptyRows || !isEmptyRow(row))
                  .map(({ row, index }) => (
                    <MobileCategoryRow
                      key={row.category.id}
                      row={row}
                      block={block}
                      target={targets.get(row.category.id)}
                      onTap={() => setAssignRow(row)}
                      onLongPress={() => setActionCtx({ block, index })}
                    />
                  ))}
              </div>
            )}
          </Card>
        )
      })}
      <AssignSheet
        row={assignRow}
        month={month}
        target={assignRow ? (targets.get(assignRow.category.id) ?? null) : null}
        onCommit={(categoryId, amount) => assign.mutate({ categoryId, amount })}
        onViewActivity={(categoryId) => {
          setAssignRow(null)
          onViewActivity(categoryId)
        }}
        onClose={() => setAssignRow(null)}
      />
      <CategoryActionSheet
        category={actionCtx ? actionCtx.block.rows[actionCtx.index]?.category ?? null : null}
        currentRow={actionCtx ? actionCtx.block.rows[actionCtx.index] ?? null : null}
        moveTargets={
          actionCtx ? moveTargetsFor(groups, actionCtx.block.rows[actionCtx.index]?.category.id) : []
        }
        canMoveUp={actionCtx !== null && visibleNeighbour(actionCtx.block, actionCtx.index, -1) !== null}
        canMoveDown={actionCtx !== null && visibleNeighbour(actionCtx.block, actionCtx.index, 1) !== null}
        onMove={(direction) => {
          if (actionCtx) moveCategory(actionCtx.block, actionCtx.index, direction)
        }}
        onMoveMoney={(payload) => move.mutate(payload)}
        onOpenTarget={onOpenTarget}
        onClose={() => setActionCtx(null)}
      />
    </div>
  )
}
