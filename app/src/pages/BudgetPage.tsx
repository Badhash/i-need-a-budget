import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  GripVertical,
  Redo2,
  Sparkles,
  Target as TargetIcon,
  Undo2,
} from 'lucide-react'
import type { BudgetGroupBlock, BudgetMonth, BudgetRow } from '@/lib/budget'
import type { Category } from '@/mocks/data'
import { useBudgetMonth, useBootstrap, apiSetAssigned } from '@/lib/data'
import { enqueue, resolveId } from '@/lib/mutationQueue'
import { useTargets, neededThisMonth, type Target } from '@/lib/targets'
import { FundTargetsSheet, type FundPlanItem } from '@/components/budget/FundTargetsSheet'
import { Button } from '@/components/ui/button'
import { fmtEUR } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { RtaBanner } from '@/components/budget/RtaBanner'
import { AssignedEditor } from '@/components/budget/AssignedEditor'
import { AssignSheet } from '@/components/budget/AssignSheet'
import {
  CategoryActionSheet,
  type MovePayload,
  type MoveTarget,
} from '@/components/budget/CategoryActionSheet'
import { useLongPress } from '@/hooks/useLongPress'
import { useBudgetHistory } from '@/stores/budgetHistory'
import { useReorderCategoriesMutation, useReorderGroupsMutation } from '@/lib/taxonomy'
import { AvailablePill } from '@/components/budget/AvailablePill'
import { TargetBar } from '@/components/budget/TargetBar'
import { TargetDialog } from '@/components/budget/TargetDialog'
import { GroupPill } from '@/components/shared/GroupPill'
import { EmptyState } from '@/components/shared/EmptyState'
import { Amount } from '@/components/shared/Amount'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Une enveloppe est "vide" quand ses trois colonnes sont a 0 : rien d'assigne,
// aucune activite, aucun disponible reporte. Des qu'UNE colonne est non nulle,
// la ligne reste visible.
function isEmptyRow(row: BudgetRow): boolean {
  return row.assigned === 0 && row.activity === 0 && row.available === 0
}

function useAssignMutation(month: string) {
  const queryClient = useQueryClient()
  const record = useBudgetHistory((s) => s.record)
  const key = ['budget', month] as const
  return useMutation({
    // Serialise derriere une eventuelle creation de categorie en vol : le
    // categoryId est resolu temp -> real au moment de l'envoi (assigner sur une
    // enveloppe tout juste creee ne part plus avec un id 'temp-*').
    mutationFn: (input: { categoryId: string; amount: number; skipHistory?: boolean }) =>
      enqueue(
        () => apiSetAssigned({ categoryId: resolveId(input.categoryId), amount: input.amount, month }),
        { deps: [input.categoryId] },
      ),
    // Mise a jour OPTIMISTE : la valeur assignee, le Disponible de la ligne, les
    // totaux du groupe et le Pret a assigner changent INSTANTANEMENT dans le cache.
    // Le POST /api part en arriere-plan ; la reconciliation serveur (signal
    // Realtime) est silencieuse car elle renvoie les memes chiffres. Aucune valeur
    // ne "saute" apres un aller-retour reseau (voir CLAUDE.md, reactivite percue).
    onMutate: async ({ categoryId, amount, skipHistory }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BudgetMonth>(key)
      // Enregistre l'action pour l'undo/redo (sauf les replays undo/redo eux-memes).
      // prev = montant assigne actuel lu dans le cache avant application.
      if (!skipHistory && previous) {
        let prev = 0
        for (const g of previous.groups)
          for (const r of g.rows) if (r.category.id === categoryId) prev = r.assigned
        if (prev !== amount) record({ categoryId, month, prev, next: amount })
      }
      queryClient.setQueryData<BudgetMonth>(key, (old) => {
        if (!old) return old
        // delta = nouveau montant - ancien montant. available = rollover +
        // assigned + activity -> il varie du meme delta. RTA baisse du delta.
        let delta = 0
        const groups = old.groups.map((group) => {
          let groupDelta = 0
          const rows = group.rows.map((row) => {
            if (row.category.id !== categoryId) return row
            delta = amount - row.assigned
            groupDelta = delta
            return { ...row, assigned: amount, available: row.available + delta }
          })
          if (groupDelta === 0) return group
          return {
            ...group,
            rows,
            totals: {
              ...group.totals,
              assigned: group.totals.assigned + groupDelta,
              available: group.totals.available + groupDelta,
            },
          }
        })
        if (delta === 0) return old
        return {
          ...old,
          groups,
          rta: old.rta - delta,
          totals: {
            ...old.totals,
            assigned: old.totals.assigned + delta,
            available: old.totals.available + delta,
          },
        }
      })
      return { previous }
    },
    // Rollback discret si le reseau echoue : on restaure l'etat d'avant.
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    // Pas d'invalidation ici : le signal Realtime (debounce) reconcilie en fond.
  })
}

// Applique une nouvelle valeur assignee a une categorie DANS le cache budget :
// ajuste l'assigne et le disponible de la ligne, les totaux du groupe, les
// totaux du mois et le Pret a assigner. Fonction pure reutilisee pour les deux
// cotes d'un deplacement d'argent (source et destination).
function applyAssignToCache(old: BudgetMonth, categoryId: string, amount: number): BudgetMonth {
  let delta = 0
  const groups = old.groups.map((group) => {
    let groupDelta = 0
    const rows = group.rows.map((row) => {
      if (row.category.id !== categoryId) return row
      delta = amount - row.assigned
      groupDelta = delta
      return { ...row, assigned: amount, available: row.available + delta }
    })
    if (groupDelta === 0) return group
    return {
      ...group,
      rows,
      totals: {
        ...group.totals,
        assigned: group.totals.assigned + groupDelta,
        available: group.totals.available + groupDelta,
      },
    }
  })
  if (delta === 0) return old
  return {
    ...old,
    groups,
    rta: old.rta - delta,
    totals: {
      ...old.totals,
      assigned: old.totals.assigned + delta,
      available: old.totals.available + delta,
    },
  }
}

// Deplacement d'argent entre deux enveloppes (couvrir un depassement / deplacer
// un excedent) : deux setAssigned coherents. La mise a jour du cache applique
// les DEUX cotes en une seule passe optimiste ; en cas d'echec reseau, les deux
// sont annules ensemble (restauration du snapshot). Cote serveur, on tente une
// compensation si le second POST echoue apres un premier reussi, pour ne pas
// laisser un etat incoherent (la reconciliation Realtime tranche ensuite).
// Le total assigne (from - X puis to + X) est conserve : le RTA revient a
// l'identique une fois les deux deltas appliques.
function useMoveMutation(month: string) {
  const queryClient = useQueryClient()
  const key = ['budget', month] as const
  return useMutation({
    mutationFn: async ({ fromId, toId, fromAssigned, toAssigned, amount }: MovePayload) => {
      // Comme useAssignMutation : on passe par la file (serialisation FIFO) et on
      // resout temp -> real au moment de l'envoi. Les deux enveloppes deviennent
      // des dependances : si l'une porte encore un id 'temp-*' non resolu, la
      // tache est annulee avant d'atteindre /api.
      const deps = [fromId, toId]
      await enqueue(
        () => apiSetAssigned({ categoryId: resolveId(fromId), amount: fromAssigned - amount, month }),
        { deps },
      )
      try {
        await enqueue(
          () => apiSetAssigned({ categoryId: resolveId(toId), amount: toAssigned + amount, month }),
          { deps },
        )
      } catch (err) {
        // Compensation best-effort : on restaure l'assigne de la source pour
        // eviter un demi-transfert cote serveur. Si elle echoue aussi, la
        // reconciliation Realtime ramenera la verite.
        try {
          await enqueue(
            () => apiSetAssigned({ categoryId: resolveId(fromId), amount: fromAssigned, month }),
            { deps },
          )
        } catch {
          // ignore : le refetch de reconciliation corrigera l'ecart.
        }
        throw err
      }
    },
    onMutate: async ({ fromId, toId, fromAssigned, toAssigned, amount }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BudgetMonth>(key)
      // On applique EXACTEMENT les memes valeurs absolues que les POST serveur
      // (snapshot du moment de l'ouverture de la feuille) pour qu'aucun chiffre
      // ne "saute" a la reconciliation Realtime.
      queryClient.setQueryData<BudgetMonth>(key, (old) => {
        if (!old) return old
        const step1 = applyAssignToCache(old, fromId, fromAssigned - amount)
        return applyAssignToCache(step1, toId, toAssigned + amount)
      })
      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
  })
}

// Aplati toutes les enveloppes du mois (hors celle visee) en candidates de
// transfert, en conservant leur groupe pour l'affichage (pastille + couleur).
function moveTargetsFor(groups: BudgetGroupBlock[], excludeId: string | undefined): MoveTarget[] {
  const targets: MoveTarget[] = []
  for (const block of groups) {
    for (const row of block.rows) {
      if (row.category.id === excludeId) continue
      targets.push({ row, group: block.group })
    }
  }
  return targets
}

function SpentBar({ assigned, activity, color }: { assigned: number; activity: number; color: string }) {
  if (assigned <= 0) return null
  const spent = Math.max(-activity, 0)
  const ratio = Math.min(spent / assigned, 1)
  const over = spent > assigned
  return (
    <div className="mt-1.5 h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-surface2">
      <div
        className="h-full rounded-full transition-[width] duration-300 ease-out"
        style={{
          width: `${Math.max(ratio * 100, spent > 0 ? 4 : 0)}%`,
          backgroundColor: over ? 'rgb(var(--danger))' : `var(--cat-${color}-fg)`,
        }}
      />
    </div>
  )
}

/** Petite affordance ronde qui ouvre le dialog d'objectif d'une categorie. */
function TargetTrigger({
  category,
  hasTarget,
  onOpen,
  variant,
}: {
  category: Category
  hasTarget: boolean
  onOpen: (category: Category) => void
  variant: 'desktop' | 'mobile'
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(category)}
      aria-label={hasTarget ? "Modifier l'objectif" : 'Définir un objectif'}
      title={hasTarget ? "Modifier l'objectif" : 'Définir un objectif'}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl transition-colors',
        variant === 'desktop'
          ? cn(
              "relative h-7 w-7 rounded-lg after:absolute after:-inset-1.5 after:content-['']",
              hasTarget
                ? 'text-accent hover:bg-surface2'
                : 'text-soft/50 opacity-0 hover:bg-surface2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100',
            )
          : cn('h-11 w-11 hover:bg-surface2 active:bg-surface2', hasTarget ? 'text-accent' : 'text-soft'),
      )}
    >
      <TargetIcon className={variant === 'desktop' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
    </button>
  )
}

interface GridProps {
  groups: BudgetGroupBlock[]
  month: string
  targets: Map<string, Target>
  onOpenTarget: (category: Category) => void
  // Clic sur une activite non nulle : ouvre la liste des transactions filtree
  // sur cette categorie et le mois affiche.
  onViewActivity: (categoryId: string) => void
  // Masque les lignes d'enveloppes entierement vides (les trois colonnes a 0).
  hideEmptyRows: boolean
}

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

function DesktopGrid({ groups, month, targets, onOpenTarget, onViewActivity, hideEmptyRows }: GridProps) {
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
          <Amount
            cents={block.totals.available}
            className={cn(
              'font-semibold',
              block.totals.available < 0 ? 'text-danger' : 'text-ink',
            )}
          />
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
      className="flex min-h-[56px] w-full select-none items-center gap-3 px-4 py-3 text-left transition-colors [-webkit-touch-callout:none] active:bg-surface2/60"
      aria-label={`${row.category.name} : assigner (appui long pour plus d'actions)`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{row.category.name}</p>
        {target && (
          <TargetBar
            target={target}
            assigned={row.assigned}
            available={row.available}
            color={block.group.color}
          />
        )}
      </div>
      <AvailablePill cents={row.available} />
    </button>
  )
}

function MobileGroups({ groups, month, targets, onOpenTarget, onViewActivity, hideEmptyRows }: GridProps) {
  const assign = useAssignMutation(month)
  const move = useMoveMutation(month)
  const queryClient = useQueryClient()
  const reorder = useReorderCategoriesMutation()
  const collapsedGroups = useUiStore((s) => s.collapsedGroups)
  const toggleGroup = useUiStore((s) => s.toggleGroupCollapsed)
  // Feuille d'assignation (tape) et menu contextuel (appui long).
  const [assignRow, setAssignRow] = useState<BudgetRow | null>(null)
  const [actionCtx, setActionCtx] = useState<{ block: BudgetGroupBlock; index: number } | null>(null)

  // Deplace la categorie dans son groupe : reordonne le cache budget
  // immediatement (optimiste) et pousse l'ordre complet cote serveur.
  const moveCategory = (block: BudgetGroupBlock, index: number, direction: -1 | 1) => {
    const to = index + direction
    if (to < 0 || to >= block.rows.length) return
    const ids = block.rows.map((r) => r.category.id)
    ;[ids[index], ids[to]] = [ids[to]!, ids[index]!]
    reorder.mutate({ groupId: block.group.id, orderedIds: ids })
    queryClient.setQueryData<BudgetMonth>(['budget', month], (old) => {
      if (!old) return old
      return {
        ...old,
        groups: old.groups.map((g) => {
          if (g.group.id !== block.group.id) return g
          const rows = [...g.rows]
          ;[rows[index], rows[to]] = [rows[to]!, rows[index]!]
          return { ...g, rows }
        }),
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
              <p className="min-w-0 flex-1 truncate font-semibold">{block.group.name}</p>
              <AvailablePill cents={block.totals.available} />
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
        canMoveUp={actionCtx !== null && actionCtx.index > 0}
        canMoveDown={actionCtx !== null && actionCtx.index < actionCtx.block.rows.length - 1}
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

/** Etat d'erreur du budget : evite un skeleton infini si le chargement echoue. */
function BudgetError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <EmptyState
        icon={AlertTriangle}
        title="Impossible de charger le budget"
        description="Une erreur est survenue lors du chargement de vos données. Vérifiez votre connexion, puis réessayez."
        actionLabel="Réessayer"
        onAction={onRetry}
      />
    </Card>
  )
}

function BudgetSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-[104px] rounded-2xl" />
      <Card className="p-5">
        <div className="space-y-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export function BudgetPage() {
  const month = useUiStore((s) => s.month)
  const navigate = useNavigate()
  // Ouvre la liste des transactions filtree sur la categorie cliquee et le mois
  // affiche (mois comptable = date.slice(0,7) cote Transactions).
  const viewActivity = (categoryId: string) =>
    navigate({ to: '/transactions', search: { categorie: categoryId, mois: month } })
  const boot = useBootstrap()
  const { data: budget, isError, refetch } = useBudgetMonth(month)
  const { data: targets } = useTargets()
  const [targetCat, setTargetCat] = useState<Category | null>(null)
  const [fundOpen, setFundOpen] = useState(false)
  // Mutation d'assignation partagee pour l'assignation guidee : chaque ligne du
  // plan est appliquee via la MEME mutation optimiste que la saisie manuelle
  // (cache mis a jour immediatement, POST en fond, rollback par ligne si echec).
  const assign = useAssignMutation(month)
  const collapsedGroups = useUiStore((s) => s.collapsedGroups)
  const setCollapsedGroups = useUiStore((s) => s.setCollapsedGroups)
  const hideEmptyRows = useUiStore((s) => s.hideEmptyRows)
  const setHideEmptyRows = useUiStore((s) => s.setHideEmptyRows)

  // Undo/redo LOCAL, limite a la page Budget et aux assignations. L'historique est
  // vide au changement de mois affiche (les entrees ne concernent que ce mois-la).
  const undo = useBudgetHistory((s) => s.undo)
  const redo = useBudgetHistory((s) => s.redo)
  const clearHistory = useBudgetHistory((s) => s.clear)
  const canUndo = useBudgetHistory((s) => s.past.length > 0)
  const canRedo = useBudgetHistory((s) => s.future.length > 0)

  useEffect(() => {
    clearHistory()
  }, [month, clearHistory])

  const handleUndo = useCallback(() => {
    const change = undo()
    if (change) assign.mutate({ categoryId: change.categoryId, amount: change.prev, skipHistory: true })
  }, [undo, assign])
  const handleRedo = useCallback(() => {
    const change = redo()
    if (change) assign.mutate({ categoryId: change.categoryId, amount: change.next, skipHistory: true })
  }, [redo, assign])

  // Raccourcis clavier (desktop) : Ctrl/Cmd+Z = annuler, Ctrl/Cmd+Maj+Z = refaire.
  // Ignore quand le focus est dans un champ de saisie (edition inline de l'assigne).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.preventDefault()
      if (e.shiftKey) handleRedo()
      else handleUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleUndo, handleRedo])

  const targetMap = targets ?? new Map<string, Target>()

  // Plan de financement du mois courant : pour chaque categorie ayant un objectif,
  // le supplement a assigner (neededThisMonth). On ignore les objectifs deja
  // finances (add = 0). Recalcule a chaque changement de budget/objectifs.
  const fundPlan = useMemo<FundPlanItem[]>(() => {
    if (!budget) return []
    const items: FundPlanItem[] = []
    for (const block of budget.groups) {
      for (const row of block.rows) {
        const target = targetMap.get(row.category.id)
        if (!target) continue
        const add = neededThisMonth(target, month, row.assigned, row.available)
        if (add <= 0) continue
        items.push({
          categoryId: row.category.id,
          categoryName: row.category.name,
          group: block.group,
          currentAssigned: row.assigned,
          add,
        })
      }
    }
    return items
  }, [budget, targetMap, month])

  const fundTotal = fundPlan.reduce((sum, item) => sum + item.add, 0)

  const confirmFunding = () => {
    // Applique chaque assignation en absolu (assigne actuel + supplement). Chaque
    // mutate part independamment : rollback individuel en cas d'echec reseau.
    for (const item of fundPlan) {
      assign.mutate({ categoryId: item.categoryId, amount: item.currentAssigned + item.add })
    }
    setFundOpen(false)
  }

  // L'erreur du bootstrap desactive la query budget : on la surveille aussi
  // pour ne pas rester bloque en skeleton.
  if (boot.isError || isError) {
    return (
      <BudgetError
        onRetry={() => {
          void boot.refetch()
          void refetch()
        }}
      />
    )
  }

  if (!budget) return <BudgetSkeleton />

  const groupIds = budget.groups.map((b) => b.group.id)
  const allCollapsed = groupIds.length > 0 && groupIds.every((id) => collapsedGroups[id])
  const toggleAllGroups = () => {
    if (allCollapsed) setCollapsedGroups({})
    else setCollapsedGroups(Object.fromEntries(groupIds.map((id) => [id, true])))
  }

  return (
    <div className="space-y-5">
      {/* Desktop : le resume est dans le header (HeaderBudgetSummary). Mobile :
          on garde le grand bandeau sticky. */}
      <div className="lg:hidden">
        <RtaBanner budget={budget} />
      </div>
      {/* Tout replier / tout deplier les groupes du budget. */}
      {groupIds.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          {/* Annuler / Refaire : LOCAL a la page Budget, uniquement les
              assignations d'enveloppe. Raccourcis Ctrl/Cmd+Z et Ctrl/Cmd+Maj+Z. */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleUndo}
              disabled={!canUndo}
              title="Annuler la dernière assignation (Ctrl+Z)"
              aria-label="Annuler la dernière assignation"
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-soft transition-colors hover:bg-surface2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Undo2 className="h-4 w-4" />
              <span className="hidden sm:inline">Annuler</span>
            </button>
            <button
              type="button"
              onClick={handleRedo}
              disabled={!canRedo}
              title="Refaire (Ctrl+Maj+Z)"
              aria-label="Refaire l'assignation annulée"
              className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-soft transition-colors hover:bg-surface2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Redo2 className="h-4 w-4" />
              <span className="hidden sm:inline">Refaire</span>
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => setHideEmptyRows(!hideEmptyRows)}
            className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-soft transition-colors hover:bg-surface2 hover:text-ink"
          >
            {hideEmptyRows ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {hideEmptyRows ? 'Afficher toutes les lignes' : 'Masquer les lignes vides'}
          </button>
          <button
            type="button"
            onClick={toggleAllGroups}
            className="flex min-h-[40px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium text-soft transition-colors hover:bg-surface2 hover:text-ink"
          >
            {allCollapsed ? (
              <ChevronsUpDown className="h-4 w-4" />
            ) : (
              <ChevronsDownUp className="h-4 w-4" />
            )}
            {allCollapsed ? 'Tout déplier' : 'Tout replier'}
          </button>
          </div>
        </div>
      )}
      {fundPlan.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="min-w-0">
            <p className="text-[15px] font-semibold">Financer les objectifs</p>
            <p className="text-[13px] text-soft">
              {fundPlan.length === 1
                ? '1 catégorie à compléter'
                : `${fundPlan.length} catégories à compléter`}{' '}
              · <span className="tnum">{fmtEUR(fundTotal)}</span>
            </p>
          </div>
          <Button className="h-11 shrink-0 gap-2" onClick={() => setFundOpen(true)}>
            <Sparkles className="h-4 w-4" />
            Financer
          </Button>
        </div>
      )}
      <DesktopGrid
        groups={budget.groups}
        month={month}
        targets={targetMap}
        onOpenTarget={setTargetCat}
        onViewActivity={viewActivity}
        hideEmptyRows={hideEmptyRows}
      />
      <MobileGroups
        groups={budget.groups}
        month={month}
        targets={targetMap}
        onOpenTarget={setTargetCat}
        onViewActivity={viewActivity}
        hideEmptyRows={hideEmptyRows}
      />
      <FundTargetsSheet
        open={fundOpen}
        items={fundPlan}
        total={fundTotal}
        rta={budget.rta}
        onConfirm={confirmFunding}
        onClose={() => setFundOpen(false)}
      />
      <TargetDialog
        category={targetCat}
        target={targetCat ? targetMap.get(targetCat.id) ?? null : null}
        onClose={() => setTargetCat(null)}
      />
    </div>
  )
}
