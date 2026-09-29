import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, Eye, Keyboard, Layers } from 'lucide-react'
import { overspendingOf, type BudgetGroupBlock, type BudgetMonth, type BudgetRow } from '@/lib/budget'
import type { Category } from '@/types/domain'
import { neededThisMonth, type Target } from '@/lib/targets'
import { fmtEUR } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { useBudgetMonth, useCategoriesList, useGroupsList } from '@/lib/data'
import { useReorderCategoriesMutation, useReorderGroupsMutation } from '@/lib/taxonomy'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/EmptyState'
import { GroupPill } from '@/components/shared/GroupPill'
import { cn } from '@/lib/utils'
import { isEmptyRow, useAssignMutation, useMoveMutation } from '@/components/budget/budgetMutations'
import type { GridProps } from '@/components/budget/gridTypes'
import { AssignedEditor } from '@/components/budget/AssignedEditor'
import { AssignQuickValues } from '@/components/budget/AssignQuickValues'
import { AvailableButton, availableTone } from '@/components/budget/AvailablePill'
import { MoveMoneyPopover } from '@/components/budget/MoveMoneyPopover'
import { PointMenu, RowMenuButton, type GridMenuModel } from '@/components/budget/DesktopCategoryMenu'
import { DeleteCategoryDialog } from '@/components/budget/DeleteCategoryDialog'
import { DragHandle, GroupMeter, InlineRename, SpentBar, TargetTrigger } from '@/components/budget/rowParts'
import { TargetBar } from '@/components/budget/TargetBar'
import { useGridTaxonomyActions } from '@/components/budget/useGridTaxonomyActions'

// ---------------------------------------------------------------------------
// Glisser-deposer (reordonnancement)
// ---------------------------------------------------------------------------

// Deux natures d'element deplacables : un GROUPE (reordonne les groupes entre
// eux) ou une CATEGORIE (reordonne les enveloppes DANS leur groupe ; le groupId
// d'origine borne la cible valide).
type DragItem = { kind: 'group'; id: string } | { kind: 'category'; groupId: string; id: string }

// Cible de depot survolee : la ligne et le cote (avant / apres) selon la
// position du curseur dans la ligne.
interface DropTarget {
  id: string
  after: boolean
}

interface DndApi {
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

// Indicateur de depot : lisere accent en haut (avant) ou en bas (apres) de la
// ligne cible, en ombre interieure sur les cellules (ne decale pas la grille).
function dropIndicatorClass(dropTarget: DropTarget | null, rowId: string): string {
  if (!dropTarget || dropTarget.id !== rowId) return ''
  return dropTarget.after
    ? '[&>td]:shadow-[inset_0_-2px_0_0_rgb(var(--accent))]'
    : '[&>td]:shadow-[inset_0_2px_0_0_rgb(var(--accent))]'
}

// ---------------------------------------------------------------------------
// Constantes de mise en page
// ---------------------------------------------------------------------------

// En-tete de colonnes collant, sous le header de l'app (4.5rem + filet). Une
// page qui ajoute sa propre barre collante decale la grille en posant
// --budget-grid-sticky-top sur un ancetre.
const STICKY_TOP = 'var(--budget-grid-sticky-top, calc(4.5rem + 1px + env(safe-area-inset-top)))'

const TH =
  'sticky z-20 border-b border-edge bg-surface/95 py-3 font-medium backdrop-blur-xl label-caps'

// Filet entre enveloppes (cellules : border-collapse separate).
const ROW_CELL = 'border-t border-line/60 align-middle'

/** Touche de clavier dessinee (aide de la grille). */
function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line bg-surface px-1.5 font-sans text-[11px] font-medium text-ink shadow-[inset_0_-1px_0_rgb(var(--line))]">
      {children}
    </kbd>
  )
}

type RenameTarget = { kind: 'category' | 'group'; id: string }
type PointMenuState = { kind: 'category' | 'group'; id: string; x: number; y: number; seq: number }

/**
 * Grille budget DESKTOP (>= 1024px) : tableau dense a en-tete collant, groupes
 * repliables avec totaux et jauge, enveloppes avec objectif ou consommation du
 * mois, et la boucle clavier YNAB (Entree valide et passe a l'enveloppe
 * visible suivante). Clic sur un disponible : popover « Deplacer de l'argent ».
 * Menu de ligne (bouton « ... » ou clic droit) : renommer, deplacer vers un
 * groupe, objectif, masquer, supprimer. Toutes les actions sont optimistes.
 */
export function DesktopGrid({ groups, month, targets, onOpenTarget, onViewActivity, hideEmptyRows }: GridProps) {
  const assign = useAssignMutation(month)
  const move = useMoveMutation(month)
  const actions = useGridTaxonomyActions()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const reorderCategories = useReorderCategoriesMutation()
  const reorderGroups = useReorderGroupsMutation()
  const rta = useBudgetMonth(month).data?.rta ?? null
  const allGroups = useGroupsList()
  const allCategories = useCategoriesList()
  const collapsedGroups = useUiStore((s) => s.collapsedGroups)
  const toggleGroup = useUiStore((s) => s.toggleGroupCollapsed)
  const setHideEmptyRows = useUiStore((s) => s.setHideEmptyRows)
  const tableRef = useRef<HTMLTableElement>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [moveCtx, setMoveCtx] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const [renaming, setRenaming] = useState<RenameTarget | null>(null)
  const [deleting, setDeleting] = useState<BudgetRow | null>(null)
  const [pointMenu, setPointMenu] = useState<PointMenuState | null>(null)
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)

  // Blocs et lignes AFFICHES (filtrage au rendu uniquement : block.rows reste
  // complet pour le reordonnancement et les totaux). Un groupe dont toutes les
  // lignes sont vides est masque en entier quand « Masquer les lignes vides »
  // est actif ; un groupe replie n'affiche que son en-tete.
  const shown = useMemo(
    () =>
      groups
        .filter((block) => !hideEmptyRows || block.rows.some((row) => !isEmptyRow(row)))
        .map((block) => ({
          block,
          rows: collapsedGroups[block.group.id]
            ? []
            : block.rows.filter((row) => !row.category.isIncome && (!hideEmptyRows || !isEmptyRow(row))),
        })),
    [groups, hideEmptyRows, collapsedGroups],
  )
  // Ordre des lignes VISIBLES : parcours clavier (Entree, Tab, fleches).
  const visibleOrder = useMemo(() => shown.flatMap((s) => s.rows.map((r) => r.category.id)), [shown])

  // Changement de mois : on sort de toute edition en cours.
  useEffect(() => {
    setEditingId(null)
    setMoveCtx(null)
    setRenaming(null)
    setPointMenu(null)
  }, [month])

  // Ligne en edition disparue (groupe replie, ligne masquee) : fin d'edition.
  useEffect(() => {
    if (editingId && !visibleOrder.includes(editingId)) setEditingId(null)
  }, [editingId, visibleOrder])

  // ----- Navigation clavier -------------------------------------------------

  const navigate_ = useCallback(
    (fromId: string, direction: 1 | -1): boolean => {
      const next = visibleOrder[visibleOrder.indexOf(fromId) + direction]
      if (!next) return false
      setEditingId(next)
      return true
    },
    [visibleOrder],
  )

  const focusAssignButton = useCallback((categoryId: string) => {
    const button = tableRef.current?.querySelector<HTMLButtonElement>(
      `[data-assign-key="${CSS.escape(categoryId)}"]`,
    )
    if (!button) return
    button.focus({ preventScroll: true })
    button.scrollIntoView({ block: 'nearest' })
  }, [])

  const focusMove = useCallback(
    (fromId: string, direction: 1 | -1) => {
      const next = visibleOrder[visibleOrder.indexOf(fromId) + direction]
      if (next) focusAssignButton(next)
    },
    [visibleOrder, focusAssignButton],
  )

  const exitEdit = useCallback((categoryId: string) => {
    setEditingId((current) => (current === categoryId ? null : current))
  }, [])

  // ----- Menus et actions de taxonomie --------------------------------------

  // Groupes de destination d'un deplacement : visibles, hors groupes de revenus
  // (une enveloppe n'a rien a y faire), tries comme la grille.
  const destinationGroups = useMemo(() => {
    const incomeOnly = new Set<string>()
    const byGroup = new Map<string, boolean>()
    for (const c of allCategories) byGroup.set(c.groupId, (byGroup.get(c.groupId) ?? true) && c.isIncome)
    for (const [groupId, allIncome] of byGroup) if (allIncome) incomeOnly.add(groupId)
    return allGroups
      .filter((g) => !g.hidden && !incomeOnly.has(g.id))
      .sort((a, b) => a.sortOrder - b.sortOrder)
  }, [allGroups, allCategories])

  const endRename = (target: RenameTarget, viaKeyboard: boolean) => {
    setRenaming(null)
    if (!viaKeyboard) return
    requestAnimationFrame(() => {
      if (target.kind === 'category') focusAssignButton(target.id)
      else
        tableRef.current
          ?.querySelector<HTMLButtonElement>(`[data-group-toggle="${CSS.escape(target.id)}"]`)
          ?.focus({ preventScroll: true })
    })
  }

  const categoryMenu = (row: BudgetRow, block: BudgetGroupBlock): GridMenuModel => ({
    kind: 'category',
    name: row.category.name,
    hasTarget: targets.has(row.category.id),
    moveGroups: destinationGroups.filter((g) => g.id !== block.group.id),
    onRename: () => setRenaming({ kind: 'category', id: row.category.id }),
    onMoveToGroup: (group) => actions.moveCategoryToGroup(row.category, block, group),
    onOpenTarget: () => onOpenTarget(row.category),
    onHide: () => actions.hideCategory(row.category),
    onDelete: () => setDeleting(row),
  })

  const groupMenu = (block: BudgetGroupBlock): GridMenuModel => ({
    kind: 'group',
    name: block.group.name,
    onRename: () => setRenaming({ kind: 'group', id: block.group.id }),
    onHide: () => actions.hideGroup(block.group),
  })

  // Clic droit sur une ligne : menu au curseur (le menu natif reste dans les champs).
  const openPointMenu = (e: React.MouseEvent, kind: 'category' | 'group', id: string) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return
    e.preventDefault()
    setPointMenu({ kind, id, x: e.clientX, y: e.clientY, seq: Date.now() })
  }

  let pointModel: GridMenuModel | null = null
  if (pointMenu) {
    for (const block of groups) {
      if (pointMenu.kind === 'group' && block.group.id === pointMenu.id) pointModel = groupMenu(block)
      const row = pointMenu.kind === 'category' ? block.rows.find((r) => r.category.id === pointMenu.id) : undefined
      if (row) pointModel = categoryMenu(row, block)
    }
  }

  // ----- Deplacer de l'argent -----------------------------------------------

  let moveRow: { row: BudgetRow; block: BudgetGroupBlock } | null = null
  if (moveCtx) {
    for (const block of groups) {
      const row = block.rows.find((r) => r.category.id === moveCtx.id)
      if (row) moveRow = { row, block }
    }
  }
  // Pastille disparue (ligne masquee, groupe replie) ou enveloppe supprimee.
  useEffect(() => {
    if (moveCtx && (!moveCtx.anchor.isConnected || !moveRow)) setMoveCtx(null)
  })

  const toggleMove = useCallback((categoryId: string, anchor: HTMLElement) => {
    setMoveCtx((current) => (current?.id === categoryId ? null : { id: categoryId, anchor }))
  }, [])
  const closeMove = useCallback(() => setMoveCtx(null), [])

  // ----- Glisser-deposer ----------------------------------------------------

  const budgetKey = ['budget', month] as const
  const resetDrag = () => {
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
    if (!drag || !dropTarget) return resetDrag()
    if (drag.kind === 'group') {
      const next = reorderIds(
        groups.map((b) => b.group.id),
        drag.id,
        dropTarget,
      )
      if (next) {
        reorderGroups.mutate({ orderedIds: next })
        // Reflet optimiste immediat sur le mois affiche (le hook patche aussi
        // les budgets en cache, de facon idempotente).
        const pos = new Map(next.map((id, i) => [id, i]))
        queryClient.setQueryData<BudgetMonth>(budgetKey, (old) =>
          old
            ? {
                ...old,
                groups: [...old.groups].sort((a, b) => (pos.get(a.group.id) ?? 0) - (pos.get(b.group.id) ?? 0)),
              }
            : old,
        )
      }
    } else {
      // Enveloppe : reordonnancement DANS son groupe uniquement (un depot sur
      // un autre groupe n'est jamais une cible valide, cf. onCategoryRowOver).
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
                          (a, b) => (pos.get(a.category.id) ?? 0) - (pos.get(b.category.id) ?? 0),
                        ),
                      }
                    : g,
                ),
              }
            : old,
        )
      }
    }
    resetDrag()
  }

  const dnd: DndApi = {
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
    // En-tete de groupe : cible valide seulement pour un drag de groupe.
    onGroupRowOver: (e, groupId) => {
      if (!drag || drag.kind !== 'group') return
      e.preventDefault()
      setDropTarget({ id: groupId, after: isAfter(e) })
    },
    // Enveloppe : cible valide seulement pour un drag du MEME groupe.
    onCategoryRowOver: (e, groupId, categoryId) => {
      if (!drag || drag.kind !== 'category' || drag.groupId !== groupId) return
      e.preventDefault()
      setDropTarget({ id: categoryId, after: isAfter(e) })
    },
    onDrop,
    onDragEnd: resetDrag,
  }

  // ----- Rendu --------------------------------------------------------------

  if (groups.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Layers}
          title="Aucune enveloppe à budgéter"
          description="Créez vos groupes et vos catégories pour donner un rôle à chaque euro."
          actionLabel="Gérer les catégories"
          onAction={() => navigate({ to: '/reglages' })}
          compact
        />
      </Card>
    )
  }

  if (shown.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Eye}
          title="Toutes les enveloppes sont vides"
          description="Rien d'assigné, rien de dépensé ce mois-ci : les lignes vides sont masquées."
          actionLabel="Afficher toutes les lignes"
          onAction={() => setHideEmptyRows(false)}
          compact
        />
      </Card>
    )
  }

  const envelopeCount = groups.reduce((n, b) => n + b.rows.length, 0)

  return (
    <Card className="overflow-clip">
      <table ref={tableRef} className="w-full table-fixed border-separate border-spacing-0 text-[14px]">
        <colgroup>
          <col />
          <col className="w-[140px] xl:w-[172px]" />
          <col className="w-[124px] xl:w-[160px]" />
          <col className="w-[140px] xl:w-[188px]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" style={{ top: STICKY_TOP }} className={cn(TH, 'pl-[60px] pr-3 text-left')}>
              <span className="inline-flex items-center gap-2">
                Catégorie
                <span className="rounded-full bg-ink/[0.05] px-1.5 py-px text-[11px] normal-case tracking-normal tnum">
                  {envelopeCount}
                </span>
              </span>
            </th>
            <th scope="col" style={{ top: STICKY_TOP }} className={cn(TH, 'pl-2 pr-5 text-right xl:pr-6')}>
              Assigné
            </th>
            <th scope="col" style={{ top: STICKY_TOP }} className={cn(TH, 'pl-2 pr-5 text-right xl:pr-6')}>
              Activité
            </th>
            <th scope="col" style={{ top: STICKY_TOP }} className={cn(TH, 'pl-2 pr-7 text-right xl:pr-8')}>
              Disponible
            </th>
          </tr>
        </thead>
        {shown.map(({ block, rows }, index) => (
          <tbody key={block.group.id}>
            <GroupHeaderRow
              block={block}
              first={index === 0}
              collapsed={Boolean(collapsedGroups[block.group.id])}
              onToggle={() => toggleGroup(block.group.id)}
              dnd={dnd}
              renaming={renaming?.kind === 'group' && renaming.id === block.group.id}
              onRenameCommit={(name) => actions.renameGroup(block.group, name)}
              onRenameDone={(viaKeyboard) => endRename({ kind: 'group', id: block.group.id }, viaKeyboard)}
              menu={groupMenu(block)}
              onContextMenu={(e) => openPointMenu(e, 'group', block.group.id)}
            />
            {rows.map((row) => (
              <EnvelopeRow
                key={row.category.id}
                row={row}
                block={block}
                month={month}
                target={targets.get(row.category.id)}
                editing={editingId === row.category.id}
                renaming={renaming?.kind === 'category' && renaming.id === row.category.id}
                moveOpen={moveCtx?.id === row.category.id}
                dnd={dnd}
                menu={categoryMenu(row, block)}
                onStartEdit={() => setEditingId(row.category.id)}
                onCommit={(cents) => assign.mutate({ categoryId: row.category.id, amount: cents })}
                onNavigate={(direction) => navigate_(row.category.id, direction)}
                onFocusMove={(direction) => focusMove(row.category.id, direction)}
                onExit={() => exitEdit(row.category.id)}
                onRenameCommit={(name) => actions.renameCategory(row.category, name)}
                onRenameDone={(viaKeyboard) => endRename({ kind: 'category', id: row.category.id }, viaKeyboard)}
                onOpenTarget={onOpenTarget}
                onViewActivity={onViewActivity}
                onToggleMove={toggleMove}
                onContextMenu={(e) => openPointMenu(e, 'category', row.category.id)}
              />
            ))}
          </tbody>
        ))}
      </table>

      {/* Aide clavier discrete : la boucle d'assignation au clavier et les
          gestes caches (clic sur un disponible, clic droit). */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-edge px-5 py-3 text-[12px] text-soft">
        <Keyboard className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Entrée</Kbd> enveloppe suivante
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>Échap</Kbd> annuler
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> naviguer
        </span>
        <span className="ml-auto">Disponible : cliquer pour déplacer · Clic droit : actions</span>
      </div>

      {moveCtx && moveRow && (
        <MoveMoneyPopover
          key={moveCtx.id}
          anchor={moveCtx.anchor}
          row={moveRow.row}
          group={moveRow.block.group}
          groups={groups}
          month={month}
          rta={rta}
          targets={targets}
          onMove={(payload) => move.mutate(payload)}
          onAssign={(categoryId, amount) => assign.mutate({ categoryId, amount })}
          onClose={closeMove}
        />
      )}
      {pointMenu && pointModel && (
        <PointMenu
          key={pointMenu.seq}
          x={pointMenu.x}
          y={pointMenu.y}
          model={pointModel}
          onClose={() => setPointMenu(null)}
        />
      )}
      <DeleteCategoryDialog
        row={deleting}
        onConfirm={(row) => actions.removeCategory(row.category)}
        onClose={() => setDeleting(null)}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// En-tete de groupe
// ---------------------------------------------------------------------------

function GroupHeaderRow({
  block,
  first,
  collapsed,
  onToggle,
  dnd,
  renaming,
  onRenameCommit,
  onRenameDone,
  menu,
  onContextMenu,
}: {
  block: BudgetGroupBlock
  first: boolean
  collapsed: boolean
  onToggle: () => void
  dnd: DndApi
  renaming: boolean
  onRenameCommit: (name: string) => void
  onRenameDone: (viaKeyboard: boolean) => void
  menu: GridMenuModel
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const { group, totals } = block
  const overspent = overspendingOf(block.rows)
  const cell = cn('align-middle', !first && 'border-t border-edge')

  return (
    <tr
      className={cn(
        'group/row cursor-pointer select-none bg-surface2/45 transition-colors duration-150 hover:bg-surface2/80 dark:bg-surface2/30 dark:hover:bg-surface2/55',
        dropIndicatorClass(dnd.dropTarget, group.id),
      )}
      // Lueur pastel du groupe depuis la gauche : identite du groupe, sans
      // couleur semantique (la teinte vient des tokens --cat-*).
      style={{ backgroundImage: `linear-gradient(90deg, var(--cat-${group.color}-bg) 0%, transparent 42%)` }}
      onClick={onToggle}
      onContextMenu={onContextMenu}
      onDragOver={(e) => dnd.onGroupRowOver(e, group.id)}
      onDrop={dnd.onDrop}
    >
      <td className={cn(cell, 'relative py-2 pl-6 pr-3')}>
        <DragHandle
          label={`Déplacer le groupe ${group.name}`}
          onDragStart={(e) => dnd.onGroupDragStart(e, group.id)}
          onDragEnd={dnd.onDragEnd}
          className="absolute left-1 top-1/2 -translate-y-1/2"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-group-toggle={group.id}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Déplier ${group.name}` : `Replier ${group.name}`}
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-soft transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-ink/[0.06] hover:text-ink focus-visible:ring-offset-surface"
          >
            <ChevronDown
              className={cn('h-4 w-4 transition-transform duration-200 ease-spring', collapsed && '-rotate-90')}
              aria-hidden
            />
          </button>
          <GroupPill group={group} size="sm" />
          {renaming ? (
            <InlineRename
              initial={group.name}
              label="Nouveau nom du groupe"
              onCommit={onRenameCommit}
              onDone={onRenameDone}
              className="ml-0.5 max-w-[280px]"
            />
          ) : (
            <span className="ml-0.5 min-w-[5.5rem] truncate text-[14.5px] font-semibold tracking-tight" title={group.name}>
              {group.name}
            </span>
          )}
          {collapsed && !renaming && (
            <span className="shrink-0 text-[12px] text-soft tnum">
              · {block.rows.length} enveloppe{block.rows.length > 1 ? 's' : ''}
            </span>
          )}
          {/* La somme des disponibles peut masquer un depassement (+50 et -30
              font +20) : les enveloppes negatives du groupe sont signalees. */}
          {overspent.count > 0 && !renaming && (
            <Badge
              variant="danger"
              size="sm"
              dot
              className="ml-1 shrink-0"
              title={`${overspent.count} enveloppe${overspent.count > 1 ? 's' : ''} en dépassement, ${fmtEUR(overspent.missing)} à couvrir`}
            >
              <span className="xl:hidden">{overspent.count}</span>
              <span className="hidden xl:inline">
                {overspent.count > 1 ? `${overspent.count} dépassements` : 'Dépassement'}
              </span>
              <span className="sr-only">
                {' '}
                enveloppe{overspent.count > 1 ? 's' : ''} en dépassement, {fmtEUR(overspent.missing)} à couvrir
              </span>
            </Badge>
          )}
          <GroupMeter
            className="ml-auto hidden xl:inline-flex"
            available={totals.available}
            activity={totals.activity}
            color={group.color}
          />
          <RowMenuButton model={menu} className="ml-auto xl:ml-1" />
        </div>
      </td>
      <td className={cn(cell, 'pl-2 pr-5 text-right text-[13.5px] font-medium text-soft tnum xl:pr-6')}>
        {fmtEUR(totals.assigned)}
      </td>
      <td className={cn(cell, 'pl-2 pr-5 text-right text-[13.5px] font-medium text-soft tnum xl:pr-6')}>
        {fmtEUR(totals.activity)}
      </td>
      <td
        className={cn(
          cell,
          'pl-2 pr-7 text-right text-[14px] font-semibold tnum xl:pr-8',
          totals.available < 0 ? 'text-danger' : 'text-ink',
        )}
      >
        {fmtEUR(totals.available)}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Ligne d'enveloppe
// ---------------------------------------------------------------------------

interface EnvelopeRowProps {
  row: BudgetRow
  block: BudgetGroupBlock
  month: string
  target: Target | undefined
  editing: boolean
  renaming: boolean
  moveOpen: boolean
  dnd: DndApi
  menu: GridMenuModel
  onStartEdit: () => void
  onCommit: (cents: number) => void
  onNavigate: (direction: 1 | -1) => boolean
  onFocusMove: (direction: 1 | -1) => void
  onExit: () => void
  onRenameCommit: (name: string) => void
  onRenameDone: (viaKeyboard: boolean) => void
  onOpenTarget: (category: Category) => void
  onViewActivity: (categoryId: string) => void
  onToggleMove: (categoryId: string, anchor: HTMLElement) => void
  onContextMenu: (e: React.MouseEvent) => void
}

function EnvelopeRow({
  row,
  block,
  month,
  target,
  editing,
  renaming,
  moveOpen,
  dnd,
  menu,
  onStartEdit,
  onCommit,
  onNavigate,
  onFocusMove,
  onExit,
  onRenameCommit,
  onRenameDone,
  onOpenTarget,
  onViewActivity,
  onToggleMove,
  onContextMenu,
}: EnvelopeRowProps) {
  // Brouillon valide de l'assigne pendant la saisie : apercu du disponible.
  const [preview, setPreview] = useState<number | null>(null)
  useEffect(() => {
    if (!editing) setPreview(null)
  }, [editing])

  const { category } = row
  const empty = isEmptyRow(row)
  const underfunded = (assigned: number, available: number) =>
    target !== undefined && neededThisMonth(target, month, assigned, available) > 0
  const tone = availableTone(row.available, underfunded(row.assigned, row.available))
  const previewAvailable =
    editing && preview !== null && preview !== row.assigned ? row.available + (preview - row.assigned) : null

  return (
    <tr
      data-editing={editing || undefined}
      className={cn(
        'group/row transition-colors duration-150 hover:bg-ink/[0.02] focus-within:bg-accent/[0.04] data-[editing]:bg-accent/[0.06]',
        dropIndicatorClass(dnd.dropTarget, category.id),
      )}
      onContextMenu={onContextMenu}
      onDragOver={(e) => dnd.onCategoryRowOver(e, block.group.id, category.id)}
      onDrop={dnd.onDrop}
    >
      <td className={cn(ROW_CELL, 'relative py-2 pl-[60px] pr-3')}>
        {/* Lisere d'accent de la ligne active (edition, focus clavier). */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent opacity-0 transition-opacity duration-150 group-focus-within/row:opacity-100 group-data-[editing]/row:opacity-100"
        />
        <DragHandle
          label={`Déplacer l'enveloppe ${category.name}`}
          onDragStart={(e) => dnd.onCategoryDragStart(e, block.group.id, category.id)}
          onDragEnd={dnd.onDragEnd}
          className="absolute left-1 top-2"
        />
        <div>
          <div className="min-w-0">
            <div className="flex h-6 items-center gap-1">
              {renaming ? (
                <InlineRename
                  initial={category.name}
                  label="Nouveau nom de l'enveloppe"
                  onCommit={onRenameCommit}
                  onDone={onRenameDone}
                  className="-ml-2.5 max-w-[320px]"
                />
              ) : (
                <span
                  className={cn('truncate text-[14.5px] font-medium', empty ? 'text-soft' : 'text-ink')}
                  title={category.name}
                >
                  {category.name}
                </span>
              )}
              {target && !renaming && (
                <TargetTrigger category={category} hasTarget onOpen={onOpenTarget} variant="desktop" />
              )}
              <RowMenuButton model={menu} className="ml-auto" />
            </div>
            {target ? (
              <TargetBar target={target} assigned={row.assigned} available={row.available} color={block.group.color} />
            ) : (
              <SpentBar available={row.available} activity={row.activity} color={block.group.color} />
            )}
          </div>
        </div>
      </td>
      <td className={cn(ROW_CELL, 'px-2 text-right xl:px-3')}>
        <AssignedEditor
          value={row.assigned}
          editing={editing}
          label={category.name}
          navKey={category.id}
          onStartEdit={onStartEdit}
          onCommit={onCommit}
          onNavigate={onNavigate}
          onFocusMove={onFocusMove}
          onExit={onExit}
          onPreview={setPreview}
          renderOverlay={(api) => (
            <AssignQuickValues
              row={row}
              month={month}
              anchor={api.anchor}
              draftCents={api.draftCents}
              isExpression={api.isExpression}
              onPick={api.commitValue}
            />
          )}
        />
      </td>
      <td className={cn(ROW_CELL, 'px-2 text-right xl:px-3')}>
        {row.activity !== 0 ? (
          <button
            type="button"
            onClick={() => onViewActivity(category.id)}
            className={cn(
              'inline-flex h-8 items-center rounded-lg px-3 text-[14px] tnum transition-colors duration-150 hover:bg-ink/[0.04] hover:text-ink hover:underline hover:decoration-line hover:underline-offset-4 focus-visible:ring-offset-surface',
              row.activity > 0 ? 'text-success' : 'text-soft',
            )}
            title="Voir les transactions de cette catégorie ce mois-ci"
            aria-label={`Activité de ${category.name} : ${fmtEUR(row.activity)}. Voir les transactions`}
          >
            {fmtEUR(row.activity)}
          </button>
        ) : (
          <span className="inline-flex h-8 items-center px-3 text-[14px] text-soft/50 tnum">{fmtEUR(0)}</span>
        )}
      </td>
      <td className={cn(ROW_CELL, 'pl-2 pr-4 text-right xl:pl-3 xl:pr-5')}>
        <AvailableButton
          cents={row.available}
          tone={tone}
          preview={
            previewAvailable !== null
              ? { cents: previewAvailable, tone: availableTone(previewAvailable, underfunded(preview!, previewAvailable)) }
              : null
          }
          onClick={(e) => onToggleMove(category.id, e.currentTarget)}
          aria-haspopup="dialog"
          aria-expanded={moveOpen}
          aria-label={`Disponible de ${category.name} : ${fmtEUR(row.available)}. Déplacer de l'argent`}
          title={row.available < 0 ? 'Couvrir ce dépassement' : "Déplacer de l'argent"}
        />
      </td>
    </tr>
  )
}
