import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
} from 'lucide-react'
import { overspendingOf, type BudgetGroupBlock, type BudgetMonth } from '@/lib/budget'
import type { Category } from '@/types/domain'
import type { Target } from '@/lib/targets'
import { fmtEUR } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { AssignedEditor } from '@/components/budget/AssignedEditor'
import { useReorderCategoriesMutation, useReorderGroupsMutation } from '@/lib/taxonomy'
import { AvailablePill } from '@/components/budget/AvailablePill'
import { TargetBar } from '@/components/budget/TargetBar'
import { GroupPill } from '@/components/shared/GroupPill'
import { Amount } from '@/components/shared/Amount'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { isEmptyRow, useAssignMutation } from '@/components/budget/budgetMutations'
import type { GridProps } from '@/components/budget/gridTypes'
import { SpentBar, TargetTrigger } from '@/components/budget/rowParts'

// Etat du glisser-deposer desktop. Deux natures d'element deplacables :
// un GROUPE (reordonne les groupes entre eux) ou une CATEGORIE (reordonne les
// enveloppes DANS leur groupe ; le groupId d'origine borne la cible valide).
type DragItem =
  | { kind: 'group'; id: string }
  | { kind: 'category'; groupId: string; id: string }

// Cible de depot survolee : la ligne et le cote (avant / apres) selon la
// position du curseur dans la ligne.
interface DropTarget {
  id: string
  after: boolean
}

interface DndApi {
  drag: DragItem | null
  dropTarget: DropTarget | null
  onGroupDragStart: (e: React.DragEvent, groupId: string) => void
  onCategoryDragStart: (e: React.DragEvent, groupId: string, categoryId: string) => void
  onGroupRowOver: (e: React.DragEvent, groupId: string) => void
  onCategoryRowOver: (e: React.DragEvent, groupId: string, categoryId: string) => void
  onDrop: () => void
  onDragEnd: () => void
}

// True si le curseur est dans la moitie basse de la ligne survolee : on
// inserera alors l'element APRES cette ligne (sinon avant).
function isAfter(e: React.DragEvent): boolean {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY - rect.top > rect.height / 2
}

// Classe d'indicateur de depot : lisere accent en haut (avant) ou en bas
// (apres) de la ligne cible, en box-shadow inset pour ne PAS decaler la grille.
function dropIndicatorClass(dropTarget: DropTarget | null, rowId: string): string {
  if (!dropTarget || dropTarget.id !== rowId) return ''
  return dropTarget.after
    ? 'shadow-[inset_0_-2px_0_0_rgb(var(--accent))]'
    : 'shadow-[inset_0_2px_0_0_rgb(var(--accent))]'
}

// Poignee de glissement, revelee au survol de la ligne (les <tr> portent la
// classe `group`). Seule la poignee est `draggable` : l'edition inline de
// l'assigne et les clics existants ne declenchent jamais de drag.
function DragHandle({
  onDragStart,
  onDragEnd,
  label,
}: {
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  label: string
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className="shrink-0 cursor-grab rounded-md p-0.5 text-soft/60 opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
    >
      <GripVertical className="h-4 w-4" aria-hidden />
    </button>
  )
}

export function DesktopGrid({ groups, month, targets, onOpenTarget, onViewActivity, hideEmptyRows }: GridProps) {
  const assign = useAssignMutation(month)
  const queryClient = useQueryClient()
  const reorderCategories = useReorderCategoriesMutation()
  const reorderGroups = useReorderGroupsMutation()
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const budgetKey = ['budget', month] as const

  const reset = () => {
    setDrag(null)
    setDropTarget(null)
  }

  // Retire `dragId` de `items` et le reinsere avant/apres la cible. Renvoie
  // null si l'ordre est inchange (drop sur soi-meme, no-op).
  const reorderIds = (items: string[], dragId: string, target: DropTarget): string[] | null => {
    const without = items.filter((id) => id !== dragId)
    let idx = without.indexOf(target.id)
    if (idx === -1) return null
    if (target.after) idx += 1
    without.splice(idx, 0, dragId)
    if (without.length === items.length && without.every((id, i) => id === items[i])) return null
    return without
  }

  const onDrop = () => {
    if (!drag || !dropTarget) return reset()

    if (drag.kind === 'group') {
      const next = reorderIds(
        groups.map((b) => b.group.id),
        drag.id,
        dropTarget,
      )
      if (next) {
        reorderGroups.mutate({ orderedIds: next })
        // Reflet optimiste sur le cache budget (le hook ne touche que
        // ['bootstrap']) : les groupes se reordonnent instantanement.
        const pos = new Map(next.map((id, i) => [id, i]))
        queryClient.setQueryData<BudgetMonth>(budgetKey, (old) =>
          old
            ? {
                ...old,
                groups: [...old.groups].sort(
                  (a, b) => (pos.get(a.group.id) ?? 0) - (pos.get(b.group.id) ?? 0),
                ),
              }
            : old,
        )
      }
    } else {
      // Enveloppe : reordonnancement DANS son groupe uniquement. Un depot sur
      // un autre groupe n'est jamais une cible valide (onCategoryRowOver le
      // filtre), donc le drag est ignore proprement.
      const block = groups.find((b) => b.group.id === drag.groupId)
      const next = block
        ? reorderIds(
            block.rows.map((r) => r.category.id),
            drag.id,
            dropTarget,
          )
        : null
      if (next) {
        reorderCategories.mutate({ groupId: drag.groupId, orderedIds: next })
        const pos = new Map(next.map((id, i) => [id, i]))
        queryClient.setQueryData<BudgetMonth>(budgetKey, (old) =>
          old
            ? {
                ...old,
                groups: old.groups.map((g) =>
                  g.group.id === drag.groupId
                    ? {
                        ...g,
                        rows: [...g.rows].sort(
                          (a, b) =>
                            (pos.get(a.category.id) ?? 0) - (pos.get(b.category.id) ?? 0),
                        ),
                      }
                    : g,
                ),
              }
            : old,
        )
      }
    }
    reset()
  }

  const dnd: DndApi = {
    drag,
    dropTarget,
    onGroupDragStart: (e, groupId) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', groupId)
      setDrag({ kind: 'group', id: groupId })
    },
    onCategoryDragStart: (e, groupId, categoryId) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', categoryId)
      setDrag({ kind: 'category', groupId, id: categoryId })
    },
    // Ligne d'en-tete de groupe : cible valide seulement pour un drag de
    // groupe. preventDefault autorise le drop.
    onGroupRowOver: (e, groupId) => {
      if (!drag || drag.kind !== 'group') return
      e.preventDefault()
      setDropTarget({ id: groupId, after: isAfter(e) })
    },
    // Ligne d'enveloppe : cible valide seulement pour un drag de categorie
    // ISSUE DU MEME groupe (inter-groupes hors perimetre).
    onCategoryRowOver: (e, groupId, categoryId) => {
      if (!drag || drag.kind !== 'category' || drag.groupId !== groupId) return
      e.preventDefault()
      setDropTarget({ id: categoryId, after: isAfter(e) })
    },
    onDrop,
    onDragEnd: reset,
  }

  return (
    <Card className="hidden overflow-hidden lg:block">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-line">
            <th className="px-5 py-3 text-left label-caps font-medium">Catégorie</th>
            <th className="w-40 px-5 py-3 text-right label-caps font-medium">Assigné</th>
            <th className="w-40 px-5 py-3 text-right label-caps font-medium">Activité</th>
            <th className="w-44 px-5 py-3 text-right label-caps font-medium">Disponible</th>
          </tr>
        </thead>
        <tbody>
          {groups
            // Un groupe dont TOUTES les lignes sont vides est masque entierement
            // (en-tete compris), qu'il soit replie ou non.
            .filter((block) => !hideEmptyRows || block.rows.some((row) => !isEmptyRow(row)))
            .map((block) => (
              <GroupRows
                key={block.group.id}
                block={block}
                targets={targets}
                onOpenTarget={onOpenTarget}
                onViewActivity={onViewActivity}
                onAssign={(categoryId, amount) => assign.mutate({ categoryId, amount })}
                dnd={dnd}
                hideEmptyRows={hideEmptyRows}
              />
            ))}
        </tbody>
      </table>
    </Card>
  )
}

function GroupRows({
  block,
  targets,
  onOpenTarget,
  onViewActivity,
  onAssign,
  dnd,
  hideEmptyRows,
}: {
  block: BudgetGroupBlock
  targets: Map<string, Target>
  onOpenTarget: (category: Category) => void
  onViewActivity: (categoryId: string) => void
  onAssign: (categoryId: string, amount: number) => void
  dnd: DndApi
  hideEmptyRows: boolean
}) {
  const collapsed = useUiStore((s) => Boolean(s.collapsedGroups[block.group.id]))
  const toggle = useUiStore((s) => s.toggleGroupCollapsed)
  const Chevron = collapsed ? ChevronRight : ChevronDown
  const groupOverspent = overspendingOf(block.rows)

  return (
    <>
      <tr
        className={cn(
          'group cursor-pointer select-none bg-surface2/60 transition-colors hover:bg-surface2',
          dropIndicatorClass(dnd.dropTarget, block.group.id),
        )}
        onClick={() => toggle(block.group.id)}
        onDragOver={(e) => dnd.onGroupRowOver(e, block.group.id)}
        onDrop={dnd.onDrop}
        aria-expanded={!collapsed}
      >
        <td className="px-5 py-2">
          <span className="flex items-center gap-2.5">
            <DragHandle
              label={`Déplacer le groupe ${block.group.name}`}
              onDragStart={(e) => dnd.onGroupDragStart(e, block.group.id)}
              onDragEnd={dnd.onDragEnd}
            />
            <Chevron className="h-4 w-4 shrink-0 text-soft" aria-hidden />
            <GroupPill group={block.group} size="sm" />
            <span className="font-semibold">{block.group.name}</span>
          </span>
        </td>
        <td className="px-5 py-2 text-right">
          <Amount cents={block.totals.assigned} className="font-medium text-soft" />
        </td>
        <td className="px-5 py-2 text-right">
          <Amount cents={block.totals.activity} className="font-medium text-soft" />
        </td>
        <td className="px-5 py-2 text-right">
          {/* La somme des disponibles peut masquer un depassement (une enveloppe
              a +50 et une a -30 font +20) : on signale explicitement les
              enveloppes negatives du groupe, meme si la somme est positive. */}
          <span className="inline-flex items-center justify-end gap-2">
            {groupOverspent.count > 0 && (
              <span
                className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold text-danger tnum"
                title={`${groupOverspent.count} enveloppe${groupOverspent.count > 1 ? 's' : ''} en dépassement, ${fmtEUR(groupOverspent.missing)} à couvrir`}
              >
                {groupOverspent.count} en dépassement
              </span>
            )}
            <Amount
              cents={block.totals.available}
              className={cn(
                'font-semibold',
                block.totals.available < 0 || groupOverspent.count > 0 ? 'text-danger' : 'text-ink',
              )}
            />
          </span>
        </td>
      </tr>
      {!collapsed &&
        // Filtrage AU RENDU uniquement : block.rows reste complet pour le
        // reordonnancement (drag-and-drop) et les totaux d'en-tete de groupe.
        block.rows
          .filter((row) => !hideEmptyRows || !isEmptyRow(row))
          .map((row) => {
          const target = targets.get(row.category.id)
          return (
            <tr
              key={row.category.id}
              className={cn(
                'group border-t border-line/60 transition-colors hover:bg-surface2/40',
                dropIndicatorClass(dnd.dropTarget, row.category.id),
              )}
              onDragOver={(e) => dnd.onCategoryRowOver(e, block.group.id, row.category.id)}
              onDrop={dnd.onDrop}
            >
              <td className="px-5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <DragHandle
                    label={`Déplacer l'enveloppe ${row.category.name}`}
                    onDragStart={(e) => dnd.onCategoryDragStart(e, block.group.id, row.category.id)}
                    onDragEnd={dnd.onDragEnd}
                  />
                  <p className="font-medium">{row.category.name}</p>
                  <TargetTrigger
                    category={row.category}
                    hasTarget={target !== undefined}
                    onOpen={onOpenTarget}
                    variant="desktop"
                  />
                </div>
                {target ? (
                  <TargetBar
                    target={target}
                    assigned={row.assigned}
                    available={row.available}
                    color={block.group.color}
                  />
                ) : (
                  <SpentBar assigned={row.assigned} activity={row.activity} color={block.group.color} />
                )}
              </td>
              <td className="px-5 py-1 text-right">
                <AssignedEditor value={row.assigned} onCommit={(cents) => onAssign(row.category.id, cents)} />
              </td>
              <td className="px-5 py-1.5 text-right">
                {row.activity !== 0 ? (
                  <button
                    type="button"
                    onClick={() => onViewActivity(row.category.id)}
                    className="rounded-md text-soft underline-offset-2 transition-colors hover:text-ink hover:underline focus-visible:text-ink"
                    title="Voir les transactions de cette catégorie ce mois-ci"
                  >
                    <Amount cents={row.activity} />
                  </button>
                ) : (
                  <Amount cents={row.activity} className="text-soft/60" />
                )}
              </td>
              <td className="px-5 py-1.5">
                <div className="flex items-center justify-end gap-2">
                  {/* Vider l'enveloppe vers le Pret a assigner : assigne = assigne
                      - disponible -> disponible ramene a 0, le disponible remonte
                      au RTA. Revele au survol de la ligne, seulement si dispo > 0. */}
                  {row.available > 0 && (
                    <button
                      type="button"
                      onClick={() => onAssign(row.category.id, row.assigned - row.available)}
                      className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-soft opacity-0 transition-opacity hover:text-success focus-visible:opacity-100 group-hover:opacity-100"
                      title="Vider cette enveloppe vers le Prêt à assigner"
                    >
                      Vider
                    </button>
                  )}
                  <AvailablePill cents={row.available} />
                </div>
              </td>
            </tr>
          )
        })}
    </>
  )
}
