import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Target as TargetIcon } from 'lucide-react'
import type { BudgetGroupBlock } from '@/lib/budget'
import type { Category } from '@/mocks/data'
import { useBudgetMonth, apiSetAssigned } from '@/lib/data'
import { useTargets, type Target } from '@/lib/targets'
import { useUiStore } from '@/stores/ui'
import { RtaBanner } from '@/components/budget/RtaBanner'
import { AssignedEditor } from '@/components/budget/AssignedEditor'
import { AvailablePill } from '@/components/budget/AvailablePill'
import { TargetBar } from '@/components/budget/TargetBar'
import { TargetDialog } from '@/components/budget/TargetDialog'
import { GroupPill } from '@/components/shared/GroupPill'
import { Amount } from '@/components/shared/Amount'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function useAssignMutation(month: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { categoryId: string; amount: number }) =>
      apiSetAssigned({ ...input, month }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['budget'] })
    },
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
                : 'text-soft/50 opacity-0 hover:bg-surface2 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100',
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

function MobileGroups({ groups, month, targets, onOpenTarget }: GridProps) {
  const assign = useAssignMutation(month)

  return (
    <div className="space-y-4 lg:hidden">
      {groups.map((block) => (
        <Card key={block.group.id} className="overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <GroupPill group={block.group} size="md" />
            <div className="flex-1">
              <p className="font-semibold">{block.group.name}</p>
              <p className="text-[12px] text-soft">
                Dépensé <Amount cents={-block.totals.activity} />
              </p>
            </div>
            <AvailablePill cents={block.totals.available} />
          </div>
          <div className="divide-y divide-line/60">
            {block.rows.map((row) => {
              const target = targets.get(row.category.id)
              return (
                <div key={row.category.id} className="flex min-h-[56px] items-center gap-2 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{row.category.name}</p>
                    {target && (
                      <TargetBar
                        target={target}
                        assigned={row.assigned}
                        available={row.available}
                        color={block.group.color}
                      />
                    )}
                    <div className="mt-0.5 flex items-center gap-1 text-[12px] text-soft">
                      <span>Assigné</span>
                      <AssignedEditor
                        value={row.assigned}
                        onCommit={(cents) => assign.mutate({ categoryId: row.category.id, amount: cents })}
                        className="h-10 -my-2.5 px-2 text-[13px]"
                      />
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <AvailablePill cents={row.available} />
                    <p className="mt-1 text-[11.5px] text-soft tnum">
                      Activité <Amount cents={row.activity} />
                    </p>
                  </div>
                  <TargetTrigger
                    category={row.category}
                    hasTarget={target !== undefined}
                    onOpen={onOpenTarget}
                    variant="mobile"
                  />
                </div>
              )
            })}
          </div>
        </Card>
      ))}
    </div>
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
  const { data: budget } = useBudgetMonth(month)
  const { data: targets } = useTargets()
  const [targetCat, setTargetCat] = useState<Category | null>(null)

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
