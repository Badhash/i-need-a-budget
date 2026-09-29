// Feuille de suppression d'une categorie, avec reaffectation optionnelle de ses
// transactions : sans cible, elles repassent « À catégoriser » (comportement
// serveur de deleteCategory) ; avec une cible, elles y sont categorisees par
// lots de 200 (categorizeMany, progression affichee) AVANT la suppression.

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Inbox, ReceiptText, Search } from 'lucide-react'
import type { Category, CategoryGroup } from '@/types/domain'
import { useTransactions } from '@/lib/queries'
import { reassignCategoryTransactions, useDeleteCategoryMutation } from '@/lib/taxonomy'
import { toast } from '@/lib/toast'
import { useSheetKeyboardInset } from '@/hooks/useKeyboardInset'
import { GroupPill } from '@/components/shared/GroupPill'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useLatched } from '@/components/settings/shared/useLatched'
import { cn } from '@/lib/utils'

type Mode = 'uncat' | 'reassign'

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`

export function DeleteCategoryDialog({
  category: openCategory,
  groups,
  categories,
  onClose,
}: {
  category: Category | null
  /** Groupes tries (ordre d'affichage). */
  groups: CategoryGroup[]
  categories: Category[]
  onClose: () => void
}) {
  const category = useLatched(openCategory)
  const queryClient = useQueryClient()
  const remove = useDeleteCategoryMutation()
  const { data: txs, isPending: txPending } = useTransactions()
  const keyboardInset = useSheetKeyboardInset()
  const [mode, setMode] = useState<Mode>('uncat')
  const [targetId, setTargetId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Remise a zero a chaque ouverture sur une nouvelle categorie.
  const [openedFor, setOpenedFor] = useState<string | null>(null)
  if (openCategory && openCategory.id !== openedFor) {
    setOpenedFor(openCategory.id)
    setMode('uncat')
    setTargetId(null)
    setQuery('')
    setProgress(null)
    setError(null)
  }

  const txCount = useMemo(
    () => (category && txs ? txs.filter((t) => t.categoryId === category.id).length : 0),
    [category, txs],
  )
  const targetCount = category
    ? (queryClient.getQueryData<{ categoryId: string }[]>(['targets']) ?? []).filter(
        (t) => t.categoryId === category.id,
      ).length
    : 0
  const ruleCount = category
    ? (queryClient.getQueryData<{ categoryId: string }[]>(['rules']) ?? []).filter((r) => r.categoryId === category.id)
        .length
    : 0

  // Cibles possibles : enveloppes visibles (hors revenus et hors la categorie
  // supprimee), groupees et filtrees par la recherche.
  const hiddenGroups = useMemo(() => new Set(groups.filter((g) => g.hidden).map((g) => g.id)), [groups])
  const choices = useMemo(() => {
    const q = norm(query)
    return groups
      .filter((g) => !g.hidden)
      .map((group) => ({
        group,
        cats: categories
          .filter(
            (c) =>
              c.groupId === group.id &&
              c.id !== category?.id &&
              !c.isIncome &&
              !c.hidden &&
              !hiddenGroups.has(c.groupId) &&
              (!q || norm(c.name).includes(q) || norm(group.name).includes(q)),
          )
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .filter((x) => x.cats.length > 0)
  }, [groups, categories, category?.id, hiddenGroups, query])

  const target = categories.find((c) => c.id === targetId) ?? null
  const reassign = mode === 'reassign' && txCount > 0
  const canConfirm = !running && (!reassign || target !== null)

  async function confirm() {
    if (!category || !canConfirm) return
    setError(null)
    let moved = 0
    if (reassign && target) {
      setRunning(true)
      try {
        moved = await reassignCategoryTransactions(queryClient, category.id, target.id, (done, total) =>
          setProgress({ done, total }),
        )
      } catch {
        setRunning(false)
        setError(
          'La réaffectation s’est interrompue. Les transactions déjà réaffectées le restent ; la catégorie n’a pas été supprimée. Réessaie pour terminer.',
        )
        return
      }
      setRunning(false)
    }
    remove.mutate({ categoryId: category.id })
    const left = txCount - moved
    toast({
      message: `« ${category.name} » supprimée`,
      description:
        moved > 0
          ? `${plural(moved, 'transaction réaffectée', 'transactions réaffectées')} à « ${target?.name} »`
          : left > 0
            ? `${plural(left, 'transaction', 'transactions')} à catégoriser`
            : undefined,
      tone: 'success',
    })
    onClose()
  }

  return (
    <Dialog open={openCategory !== null} onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent style={keyboardInset > 0 ? { transform: `translateY(-${keyboardInset}px)` } : undefined}>
        {category && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-8">Supprimer « {category.name} » ?</DialogTitle>
              <DialogDescription>
                Ses montants assignés
                {targetCount > 0 ? ', son objectif' : ''}
                {ruleCount > 0 ? ` et ${plural(ruleCount, 'règle', 'règles')}` : ''} seront supprimés. Cette action est
                irréversible.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-2 pt-1">
              <div className="flex items-center gap-3 rounded-2xl bg-surface2/70 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-soft shadow-card">
                  <ReceiptText className="h-4 w-4" />
                </span>
                {txPending ? (
                  <Skeleton className="h-4 w-40" />
                ) : (
                  <p className="text-[14px]">
                    {txCount > 0 ? (
                      <>
                        <span className="font-semibold tnum">{plural(txCount, 'transaction', 'transactions')}</span>{' '}
                        {txCount > 1 ? 'utilisent' : 'utilise'} cette catégorie.
                      </>
                    ) : (
                      'Aucune transaction dans cette catégorie.'
                    )}
                  </p>
                )}
              </div>

              {txCount > 0 && (
                <div className="space-y-3">
                  <p className="label-caps">Ses transactions</p>
                  <SegmentedControl<Mode>
                    block
                    aria-label="Devenir des transactions"
                    value={mode}
                    onChange={(m) => !running && setMode(m)}
                    options={[
                      { value: 'uncat', label: 'À catégoriser', icon: Inbox },
                      { value: 'reassign', label: 'Réaffecter', icon: ArrowRight },
                    ]}
                  />
                  {mode === 'uncat' ? (
                    <p className="text-[13px] leading-relaxed text-soft">
                      Elles resteront dans leurs comptes, sans catégorie, et apparaîtront dans « À catégoriser ».
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      <p className="text-[13px] text-soft">Réaffecter ses transactions à…</p>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
                        <Input
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="Chercher une catégorie…"
                          aria-label="Chercher une catégorie"
                          className="pl-9"
                          disabled={running}
                        />
                      </div>
                      <div
                        role="radiogroup"
                        aria-label="Catégorie cible"
                        className="max-h-[34dvh] overflow-y-auto rounded-2xl border border-edge p-1 sm:max-h-64"
                      >
                        {choices.length === 0 && (
                          <p className="px-3 py-4 text-center text-[13px] text-soft">Aucune catégorie ne correspond.</p>
                        )}
                        {choices.map(({ group, cats }) => (
                          <div key={group.id}>
                            <p className="flex items-center gap-2 px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-soft">
                              {group.name}
                            </p>
                            {cats.map((c) => {
                              const active = c.id === targetId
                              return (
                                <button
                                  key={c.id}
                                  type="button"
                                  role="radio"
                                  aria-checked={active}
                                  disabled={running}
                                  onClick={() => setTargetId(c.id)}
                                  className={cn(
                                    'flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[14px] transition-colors lg:min-h-10',
                                    active ? 'bg-accent/10 font-medium text-accent-ink' : 'hover:bg-surface2',
                                  )}
                                >
                                  <GroupPill group={group} size="sm" />
                                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                                  {active && <Check className="h-4 w-4 shrink-0" />}
                                </button>
                              )
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {progress && (running || progress.done > 0) && reassign && (
                <div className="space-y-2" aria-live="polite">
                  <div className="flex justify-between text-[12.5px] text-soft">
                    <span>{running ? 'Réaffectation en cours…' : 'Réaffectation'}</span>
                    <span className="tnum">
                      {progress.done.toLocaleString('fr-FR')} / {progress.total.toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <ProgressBar
                    value={progress.total > 0 ? progress.done / progress.total : 1}
                    tone="accent"
                    animateOnMount={false}
                    label="Progression de la réaffectation"
                  />
                </div>
              )}

              {error && (
                <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-[13px] leading-relaxed text-danger">
                  {error}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={onClose} disabled={running}>
                Annuler
              </Button>
              <Button variant="danger" onClick={() => void confirm()} disabled={!canConfirm}>
                {running
                  ? 'Réaffectation…'
                  : reassign
                    ? error
                      ? 'Reprendre et supprimer'
                      : 'Réaffecter et supprimer'
                    : 'Supprimer'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
