import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, ChevronDown, ChevronUp, Pencil, Trash2, Wand2 } from 'lucide-react'
import { useCategoriesMap, useGroupsMap } from '@/lib/data'
import {
  apiApplyRules,
  apiCreateRule,
  apiDeleteRule,
  apiUpdateRule,
  opLabel,
  useRules,
  type Rule,
  type RuleMatcher,
} from '@/lib/rules'
import { RuleForm } from '@/components/rules/RuleForm'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

function RuleRow({
  rule,
  index,
  count,
  reordering,
  onMove,
  onEdit,
  onDelete,
}: {
  rule: Rule
  index: number
  count: number
  reordering: boolean
  onMove: (index: number, direction: -1 | 1) => void
  onEdit: (rule: Rule) => void
  onDelete: (rule: Rule) => void
}) {
  const categoryById = useCategoriesMap()
  const groupById = useGroupsMap()
  const category = categoryById.get(rule.categoryId)
  const group = category ? groupById.get(category.groupId) : undefined

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
      <div className="flex shrink-0 flex-col text-soft">
        <button
          type="button"
          onClick={() => onMove(index, -1)}
          disabled={index === 0 || reordering}
          className="flex h-11 w-11 items-center justify-center rounded-md transition-colors hover:bg-surface2 hover:text-ink disabled:pointer-events-none disabled:opacity-30 sm:h-6 sm:w-7"
          aria-label="Priorité plus haute"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onMove(index, 1)}
          disabled={index === count - 1 || reordering}
          className="flex h-11 w-11 items-center justify-center rounded-md transition-colors hover:bg-surface2 hover:text-ink disabled:pointer-events-none disabled:opacity-30 sm:h-6 sm:w-7"
          aria-label="Priorité plus basse"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px]">
          <span className="text-soft">Si le libellé</span>
          <span className="font-medium text-ink">{opLabel(rule.matcher.op)}</span>
          <span className="max-w-full truncate rounded-md bg-surface2 px-1.5 py-0.5 font-medium text-ink">
            «&nbsp;{rule.matcher.value}&nbsp;»
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-soft" />
          <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-ink">
            <span
              className={cn('h-2.5 w-2.5 shrink-0 rounded-full', !group && 'bg-soft/40')}
              style={group ? { backgroundColor: `var(--cat-${group.color}-fg)` } : undefined}
            />
            <span className="truncate">{category ? category.name : 'Catégorie inconnue'}</span>
          </span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onEdit(rule)}
          aria-label="Modifier la règle"
          className="h-11 w-11 sm:h-10 sm:w-10"
        >
          <Pencil className="h-[18px] w-[18px]" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(rule)}
          aria-label="Supprimer la règle"
          className="h-11 w-11 text-soft hover:text-danger sm:h-10 sm:w-10"
        >
          <Trash2 className="h-[18px] w-[18px]" />
        </Button>
      </div>
    </div>
  )
}

function RulesSkeleton() {
  return (
    <Card className="divide-y divide-line/60 overflow-hidden">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5">
          <Skeleton className="h-9 w-7 rounded-md" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </Card>
  )
}

export function RulesPage() {
  const queryClient = useQueryClient()
  const { data: rules, isError: rulesError, refetch: refetchRules } = useRules()
  const [editing, setEditing] = useState<Rule | null>(null)
  const [applyResult, setApplyResult] = useState<number | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [reorderError, setReorderError] = useState(false)

  const invalidate = () => queryClient.invalidateQueries()

  const nextPriority =
    rules && rules.length > 0 ? Math.max(...rules.map((r) => r.priority)) + 1 : 1

  const createMut = useMutation({
    mutationFn: (input: { matcher: RuleMatcher; categoryId: string }) =>
      apiCreateRule({ matcher: input.matcher, categoryId: input.categoryId, priority: nextPriority }),
    onSuccess: () => {
      setFormKey((k) => k + 1)
      setApplyResult(null)
      invalidate()
    },
  })

  const updateMut = useMutation({
    mutationFn: (input: {
      id: string
      matcher: RuleMatcher
      categoryId: string
      priority: number
    }) => apiUpdateRule(input),
    onSuccess: () => {
      setEditing(null)
      invalidate()
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiDeleteRule(id),
    onSuccess: invalidate,
  })

  const swapMut = useMutation({
    mutationFn: async ({ a, b }: { a: Rule; b: Rule }) => {
      await apiUpdateRule({ id: a.id, matcher: a.matcher, categoryId: a.categoryId, priority: b.priority })
      await apiUpdateRule({ id: b.id, matcher: b.matcher, categoryId: b.categoryId, priority: a.priority })
    },
    onSuccess: () => {
      setReorderError(false)
      invalidate()
    },
    // L'echange n'est pas atomique : si un des deux updates echoue, on
    // resynchronise l'UI sur l'ordre reel du serveur et on signale l'echec.
    onError: () => {
      setReorderError(true)
      queryClient.invalidateQueries({ queryKey: ['rules'] })
    },
  })

  const applyMut = useMutation({
    mutationFn: () => apiApplyRules(),
    onSuccess: (categorized) => {
      setApplyResult(categorized)
      invalidate()
    },
  })

  const move = (i: number, direction: -1 | 1) => {
    if (!rules) return
    const j = i + direction
    if (j < 0 || j >= rules.length) return
    setReorderError(false)
    swapMut.mutate({ a: rules[i], b: rules[j] })
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Règles de catégorisation</CardTitle>
          <p className="text-[13px] leading-relaxed text-soft">
            Catégorise automatiquement les transactions importées selon leur libellé. Les règles
            sont évaluées par ordre de priorité, de haut en bas.
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => applyMut.mutate()}
              disabled={applyMut.isPending || !rules || rules.length === 0}
            >
              <Wand2 className="h-4 w-4" />
              Appliquer aux non catégorisées
            </Button>
            {applyMut.isPending ? (
              <p className="text-[13px] text-soft">Application en cours…</p>
            ) : applyResult !== null ? (
              <p className={cn('text-[13px]', applyResult > 0 ? 'text-success' : 'text-soft')}>
                {applyResult > 0
                  ? `${applyResult} transaction${applyResult > 1 ? 's' : ''} catégorisée${applyResult > 1 ? 's' : ''}.`
                  : 'Aucune transaction à catégoriser.'}
              </p>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nouvelle règle</CardTitle>
        </CardHeader>
        <CardContent>
          <RuleForm
            key={formKey}
            submitLabel="Ajouter"
            pending={createMut.isPending}
            onSubmit={(matcher, categoryId) => createMut.mutate({ matcher, categoryId })}
          />
        </CardContent>
      </Card>

      {rulesError ? (
        <Card>
          <EmptyState
            icon={AlertTriangle}
            title="Impossible de charger les règles"
            description="Une erreur est survenue lors du chargement de vos règles. Vérifiez votre connexion, puis réessayez."
            actionLabel="Réessayer"
            onAction={() => refetchRules()}
          />
        </Card>
      ) : !rules ? (
        <RulesSkeleton />
      ) : rules.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wand2}
            title="Aucune règle pour l'instant"
            description="Ajoutez une règle ci-dessus pour catégoriser automatiquement vos transactions importées."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {reorderError && (
            <p className="flex items-center gap-1.5 px-1 text-[13px] font-medium text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              La réorganisation a échoué. L'ordre affiché a été resynchronisé.
            </p>
          )}
          <Card className="divide-y divide-line/60 overflow-hidden">
            {rules.map((rule, i) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                index={i}
                count={rules.length}
                reordering={swapMut.isPending}
                onMove={move}
                onEdit={setEditing}
                onDelete={(r) => deleteMut.mutate(r.id)}
              />
            ))}
          </Card>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifier la règle</DialogTitle>
            <DialogDescription>Ajustez la condition et la catégorie ciblée.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="p-5 pt-2">
              <RuleForm
                key={editing.id}
                stacked
                initialOp={editing.matcher.op}
                initialValue={editing.matcher.value}
                initialCategoryId={editing.categoryId}
                submitLabel="Enregistrer"
                pending={updateMut.isPending}
                onSubmit={(matcher, categoryId) =>
                  updateMut.mutate({ id: editing.id, matcher, categoryId, priority: editing.priority })
                }
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
