import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { overspendingOf, type BudgetGroupBlock, type BudgetMonth, type BudgetRow } from '@/lib/budget'
import { neededThisMonth, type Target } from '@/lib/targets'
import { useBudgetMonth } from '@/lib/data'
import { fmtEUR } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { AssignSheet } from '@/components/budget/AssignSheet'
import { CategoryActionSheet } from '@/components/budget/CategoryActionSheet'
import { useLongPress } from '@/hooks/useLongPress'
import { useReorderCategoriesMutation } from '@/lib/taxonomy'
import { AvailableChip } from '@/components/budget/AvailableChip'
import { TargetBar } from '@/components/budget/TargetBar'
import { useEnvelopeVisibility } from '@/components/budget/useEnvelopeVisibility'
import { GroupPill } from '@/components/shared/GroupPill'
import { Amount } from '@/components/shared/Amount'
import { cn } from '@/lib/utils'
import {
  isEmptyRow,
  useAssignMutation,
  useMoveMutation,
  moveTargetsFor,
} from '@/components/budget/budgetMutations'
import type { GridProps } from '@/components/budget/gridTypes'

/**
 * Consommation d'une enveloppe sur le mois : part depensee de l'argent dont
 * elle disposait (report + assigne = disponible - activite). null = rien a
 * montrer (ni argent ni depense).
 */
function consumption(available: number, activity: number): number | null {
  const spent = Math.max(-activity, 0)
  const start = available - activity
  if (start <= 0) return spent > 0 ? 1 : null
  return Math.min(spent / start, 1)
}

/** Fine jauge de consommation a la couleur du groupe (rouge si depassement). */
function SpentLine({ ratio, color, over }: { ratio: number; color: string; over: boolean }) {
  return (
    <span aria-hidden className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-ink/[0.06]">
      <span
        className={cn('block h-full rounded-full transition-[width] duration-600 ease-spring', over && 'bg-danger')}
        style={{
          width: `${Math.max(ratio * 100, ratio > 0 ? 3 : 0)}%`,
          backgroundColor: over ? undefined : `var(--cat-${color}-fg)`,
          opacity: over ? 1 : 0.75,
        }}
      />
    </span>
  )
}

/**
 * Ligne d'enveloppe mobile, volontairement minimale : nom + Disponible (et la
 * jauge d'objectif ou de consommation). Tape = feuille d'assignation ; appui
 * long = menu contextuel (assigner, objectif, deplacer, masquer...). Le detail
 * (assigne, activite) vit dans les feuilles, pas dans la liste.
 */
function MobileCategoryRow({
  row,
  block,
  target,
  month,
  onTap,
  onLongPress,
}: {
  row: BudgetRow
  block: BudgetGroupBlock
  target: Target | undefined
  month: string
  onTap: () => void
  onLongPress: () => void
}) {
  const { handlers, firedRecently } = useLongPress(onLongPress)
  const underfunded = target ? neededThisMonth(target, month, row.assigned, row.available) > 0 : false
  const spent = target ? null : consumption(row.available, row.activity)

  return (
    <button
      type="button"
      {...handlers}
      onClick={() => {
        if (!firedRecently()) onTap()
      }}
      className="flex min-h-[60px] w-full select-none flex-col justify-center px-4 py-3 text-left transition-colors duration-150 [-webkit-touch-callout:none] active:bg-surface2/70"
      aria-label={`${row.category.name}, disponible ${fmtEUR(row.available)} : assigner (appui long pour plus d'actions)`}
    >
      <span className="flex w-full items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium text-ink">{row.category.name}</span>
        <AvailableChip cents={row.available} underfunded={underfunded} pulse />
      </span>
      {target ? (
        <TargetBar
          target={target}
          assigned={row.assigned}
          available={row.available}
          color={block.group.color}
          month={month}
        />
      ) : (
        spent !== null && <SpentLine ratio={spent} color={block.group.color} over={row.available < 0} />
      )}
    </button>
  )
}

export function MobileGroups({ groups, month, targets, onOpenTarget, onViewActivity, hideEmptyRows }: GridProps) {
  const assign = useAssignMutation(month)
  const move = useMoveMutation(month)
  const queryClient = useQueryClient()
  const reorder = useReorderCategoriesMutation()
  const { hideCategory } = useEnvelopeVisibility()
  // Meme query que la page (en cache) : Pret a assigner pour l'apercu.
  const rta = useBudgetMonth(month).data?.rta
  const collapsedGroups = useUiStore((s) => s.collapsedGroups)
  const toggleGroup = useUiStore((s) => s.toggleGroupCollapsed)
  // Feuille d'assignation (tape) et menu contextuel (appui long). Les lignes
  // sont relues dans `groups` a chaque rendu : la feuille suit le cache.
  const [assignCtx, setAssignCtx] = useState<{ groupId: string; categoryId: string } | null>(null)
  const [actionCtx, setActionCtx] = useState<{ groupId: string; categoryId: string } | null>(null)

  const blockOf = (groupId: string) => groups.find((b) => b.group.id === groupId)
  const locate = (ctx: { groupId: string; categoryId: string } | null) => {
    if (!ctx) return null
    const block = blockOf(ctx.groupId)
    const index = block ? block.rows.findIndex((r) => r.category.id === ctx.categoryId) : -1
    return block && index >= 0 ? { block, index, row: block.rows[index]! } : null
  }
  const assignAt = locate(assignCtx)
  const actionAt = locate(actionCtx)

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
  // immediatement (optimiste) et pousse l'ordre cote serveur. La ligne est
  // deplacee (et non permutee) jusqu'a la position de son voisin visible. Les
  // blocs recus ne contiennent que les enveloppes AFFICHEES (les masquees en
  // sont retirees) : l'ordre s'applique par identifiant, les enveloppes
  // masquees gardant leur ordre relatif en fin de groupe (comme le serveur).
  const moveCategory = (block: BudgetGroupBlock, index: number, direction: -1 | 1) => {
    const to = visibleNeighbour(block, index, direction)
    if (to === null) return
    const ids = block.rows.map((r) => r.category.id)
    const [moved] = ids.splice(index, 1)
    ids.splice(to, 0, moved!)
    reorder.mutate({ groupId: block.group.id, orderedIds: ids })
    const pos = new Map(ids.map((id, i) => [id, i]))
    queryClient.setQueryData<BudgetMonth>(['budget', month], (old) => {
      if (!old) return old
      return {
        ...old,
        groups: old.groups.map((g) =>
          g.group.id !== block.group.id
            ? g
            : {
                ...g,
                rows: [...g.rows].sort(
                  (a, b) =>
                    (pos.get(a.category.id) ?? Number.MAX_SAFE_INTEGER) -
                    (pos.get(b.category.id) ?? Number.MAX_SAFE_INTEGER),
                ),
              },
        ),
      }
    })
  }

  const visibleGroups = groups
    // Groupe entierement vide masque (en-tete compris), qu'il soit replie
    // ou non. Un groupe gardant au moins une ligne visible reste affiche.
    .filter((block) => !hideEmptyRows || block.rows.some((row) => !isEmptyRow(row)))

  return (
    <div className="stagger space-y-4 lg:hidden">
      {visibleGroups.map((block) => {
        const collapsed = Boolean(collapsedGroups[block.group.id])
        const groupOverspent = overspendingOf(block.rows)
        const spent = consumption(block.totals.available, block.totals.activity)
        // Filtrage AU RENDU : block.rows reste complet pour le menu
        // contextuel et le reordonnancement (index d'origine).
        const shownRows = block.rows.filter((row) => !hideEmptyRows || !isEmptyRow(row))
        return (
          <section
            key={block.group.id}
            aria-label={block.group.name}
            className="overflow-hidden rounded-2xl border border-edge bg-surface shadow-card"
          >
            <button
              type="button"
              onClick={() => toggleGroup(block.group.id)}
              aria-expanded={!collapsed}
              className="flex min-h-[68px] w-full select-none flex-col justify-center px-4 py-3.5 text-left transition-colors duration-150 active:bg-surface2/70"
            >
              <span className="flex w-full items-center gap-3">
                <GroupPill group={block.group} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold tracking-tight text-ink">
                    {block.group.name}
                  </span>
                  <span className="block truncate text-[12.5px] text-soft tnum">
                    {groupOverspent.count > 0 ? (
                      <span className="font-medium text-danger">
                        {groupOverspent.count} en dépassement
                      </span>
                    ) : block.totals.activity < 0 ? (
                      `${fmtEUR(-block.totals.activity)} dépensés`
                    ) : (
                      `${block.rows.length === 1 ? '1 enveloppe' : `${block.rows.length} enveloppes`}`
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  {/* Rouge seulement si le total est negatif : un depassement
                      masque par la somme est signale par la ligne du dessous. */}
                  <Amount
                    cents={block.totals.available}
                    animate
                    className={cn(
                      'block text-[16px] font-semibold tracking-tight',
                      block.totals.available < 0 ? 'text-danger' : block.totals.available > 0 ? 'text-ink' : 'text-soft',
                    )}
                  />
                  <span className="block text-[11.5px] text-soft">disponible</span>
                </span>
                <ChevronDown
                  aria-hidden
                  className={cn(
                    '-mr-1 h-5 w-5 shrink-0 text-soft transition-transform duration-200 ease-spring',
                    collapsed && '-rotate-90',
                  )}
                />
              </span>
              {spent !== null && (
                <SpentLine ratio={spent} color={block.group.color} over={groupOverspent.count > 0 && block.totals.available < 0} />
              )}
            </button>
            {/* Repli anime (hauteur 0fr <-> 1fr) ; replie, le contenu devient
                invisible : ni focus clavier ni lecteur d'ecran. */}
            <div
              className={cn(
                'grid transition-[grid-template-rows,visibility] duration-280 ease-spring',
                collapsed ? 'invisible grid-rows-[0fr]' : 'visible grid-rows-[1fr]',
              )}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="divide-y divide-line/60 border-t border-line/70">
                  {shownRows.map((row) => (
                    <MobileCategoryRow
                      key={row.category.id}
                      row={row}
                      block={block}
                      target={targets.get(row.category.id)}
                      month={month}
                      onTap={() => setAssignCtx({ groupId: block.group.id, categoryId: row.category.id })}
                      onLongPress={() => setActionCtx({ groupId: block.group.id, categoryId: row.category.id })}
                    />
                  ))}
                </div>
              </div>
            </div>
          </section>
        )
      })}
      <AssignSheet
        row={assignAt?.row ?? null}
        month={month}
        group={assignAt?.block.group}
        rta={rta}
        target={assignAt ? (targets.get(assignAt.row.category.id) ?? null) : null}
        onCommit={(categoryId, amount) => assign.mutate({ categoryId, amount })}
        onViewActivity={(categoryId) => {
          setAssignCtx(null)
          onViewActivity(categoryId)
        }}
        onClose={() => setAssignCtx(null)}
      />
      <CategoryActionSheet
        category={actionAt?.row.category ?? null}
        currentRow={actionAt?.row ?? null}
        group={actionAt?.block.group}
        target={actionAt ? (targets.get(actionAt.row.category.id) ?? null) : null}
        moveTargets={actionAt ? moveTargetsFor(groups, actionAt.row.category.id) : []}
        canMoveUp={actionAt !== null && visibleNeighbour(actionAt.block, actionAt.index, -1) !== null}
        canMoveDown={actionAt !== null && visibleNeighbour(actionAt.block, actionAt.index, 1) !== null}
        onMove={(direction) => {
          if (actionAt) moveCategory(actionAt.block, actionAt.index, direction)
        }}
        onMoveMoney={(payload) => move.mutate(payload)}
        onOpenTarget={onOpenTarget}
        onAssign={() => {
          if (actionCtx) setAssignCtx(actionCtx)
        }}
        onViewActivity={onViewActivity}
        onHide={() => {
          if (actionAt) hideCategory(actionAt.row.category.id, actionAt.row.category.name)
        }}
        onClose={() => setActionCtx(null)}
      />
    </div>
  )
}
