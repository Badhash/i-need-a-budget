import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Target as TargetIcon } from 'lucide-react'
import type { BudgetGroupBlock, BudgetMonth, BudgetRow } from '@/lib/budget'
import type { Category } from '@/mocks/data'
import { useBudgetMonth, useBootstrap, apiSetAssigned } from '@/lib/data'
import { useTargets, type Target } from '@/lib/targets'
import { useUiStore } from '@/stores/ui'
import { RtaBanner } from '@/components/budget/RtaBanner'
import { AssignedEditor } from '@/components/budget/AssignedEditor'
import { AssignSheet } from '@/components/budget/AssignSheet'
import { CategoryActionSheet } from '@/components/budget/CategoryActionSheet'
import { useLongPress } from '@/hooks/useLongPress'
import { useReorderCategoriesMutation } from '@/lib/taxonomy'
import { AvailablePill } from '@/components/budget/AvailablePill'
import { TargetBar } from '@/components/budget/TargetBar'
import { TargetDialog } from '@/components/budget/TargetDialog'
import { GroupPill } from '@/components/shared/GroupPill'
import { EmptyState } from '@/components/shared/EmptyState'
import { Amount } from '@/components/shared/Amount'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function useAssignMutation(month: string) {
  const queryClient = useQueryClient()
  const key = ['budget', month] as const
  return useMutation({
    mutationFn: (input: { categoryId: string; amount: number }) =>
      apiSetAssigned({ ...input, month }),
    // Mise a jour OPTIMISTE : la valeur assignee, le Disponible de la ligne, les
    // totaux du groupe et le Pret a assigner changent INSTANTANEMENT dans le cache.
    // Le POST /api part en arriere-plan ; la reconciliation serveur (signal
    // Realtime) est silencieuse car elle renvoie les memes chiffres. Aucune valeur
    // ne "saute" apres un aller-retour reseau (voir CLAUDE.md, reactivite percue).
    onMutate: async ({ categoryId, amount }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<BudgetMonth>(key)
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

function SpentBar({ assigned, activity, color }: { assigned: number; activity: number; color: string }) {
  if (assigned <= 0) return null
  const spent = Math.max(-activity, 0)
  const ratio = Math.min(spent / assigned, 1)
  const over = spent > assigned
  return (
    <div className="mt-1.5 h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-surface2">
      <div
        className="h-full rounded-full transition-all"
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
}

function DesktopGrid({ groups, month, targets, onOpenTarget }: GridProps) {
  const assign = useAssignMutation(month)

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
          {groups.map((block) => (
            <GroupRows
              key={block.group.id}
              block={block}
              targets={targets}
              onOpenTarget={onOpenTarget}
              onAssign={(categoryId, amount) => assign.mutate({ categoryId, amount })}
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
  onAssign,
}: {
  block: BudgetGroupBlock
  targets: Map<string, Target>
  onOpenTarget: (category: Category) => void
  onAssign: (categoryId: string, amount: number) => void
}) {
  return (
    <>
      <tr className="bg-surface2/60">
        <td className="px-5 py-2.5">
          <span className="flex items-center gap-2.5">
            <GroupPill group={block.group} size="sm" />
            <span className="font-semibold">{block.group.name}</span>
          </span>
        </td>
        <td className="px-5 py-2.5 text-right">
          <Amount cents={block.totals.assigned} className="font-medium text-soft" />
        </td>
        <td className="px-5 py-2.5 text-right">
          <Amount cents={block.totals.activity} className="font-medium text-soft" />
        </td>
        <td className="px-5 py-2.5 text-right">
          <Amount
            cents={block.totals.available}
            className={cn(
              'font-semibold',
              block.totals.available < 0 ? 'text-danger' : 'text-ink',
            )}
          />
        </td>
      </tr>
      {block.rows.map((row) => {
        const target = targets.get(row.category.id)
        return (
          <tr key={row.category.id} className="group border-t border-line/60 transition-colors hover:bg-surface2/40">
            <td className="px-5 py-2.5">
              <div className="flex items-center gap-1.5">
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
            <td className="px-5 py-1.5 text-right">
              <AssignedEditor value={row.assigned} onCommit={(cents) => onAssign(row.category.id, cents)} />
            </td>
            <td className="px-5 py-2.5 text-right">
              <Amount cents={row.activity} className={cn(row.activity === 0 ? 'text-soft/60' : 'text-soft')} />
            </td>
            <td className="px-5 py-2.5 text-right">
              <AvailablePill cents={row.available} />
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

function MobileGroups({ groups, month, targets, onOpenTarget }: GridProps) {
  const assign = useAssignMutation(month)
  const queryClient = useQueryClient()
  const reorder = useReorderCategoriesMutation()
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
      {groups.map((block) => (
        <Card key={block.group.id} className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <GroupPill group={block.group} size="md" />
            <p className="min-w-0 flex-1 truncate font-semibold">{block.group.name}</p>
            <AvailablePill cents={block.totals.available} />
          </div>
          <div className="divide-y divide-line/60">
            {block.rows.map((row, index) => (
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
        </Card>
      ))}
      <AssignSheet
        row={assignRow}
        target={assignRow ? (targets.get(assignRow.category.id) ?? null) : null}
        onCommit={(categoryId, amount) => assign.mutate({ categoryId, amount })}
        onClose={() => setAssignRow(null)}
      />
      <CategoryActionSheet
        category={actionCtx ? actionCtx.block.rows[actionCtx.index]?.category ?? null : null}
        canMoveUp={actionCtx !== null && actionCtx.index > 0}
        canMoveDown={actionCtx !== null && actionCtx.index < actionCtx.block.rows.length - 1}
        onMove={(direction) => {
          if (actionCtx) moveCategory(actionCtx.block, actionCtx.index, direction)
        }}
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
  const boot = useBootstrap()
  const { data: budget, isError, refetch } = useBudgetMonth(month)
  const { data: targets } = useTargets()
  const [targetCat, setTargetCat] = useState<Category | null>(null)

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

  const targetMap = targets ?? new Map<string, Target>()

  return (
    <div className="space-y-5">
      <RtaBanner budget={budget} />
      <DesktopGrid groups={budget.groups} month={month} targets={targetMap} onOpenTarget={setTargetCat} />
      <MobileGroups groups={budget.groups} month={month} targets={targetMap} onOpenTarget={setTargetCat} />
      <TargetDialog
        category={targetCat}
        target={targetCat ? targetMap.get(targetCat.id) ?? null : null}
        onClose={() => setTargetCat(null)}
      />
    </div>
  )
}
