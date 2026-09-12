// Page « À trier » : revue une-par-une (inbox zero) des transactions non
// categorisees. Tout vient du cache TanStack (transactions + bootstrap) : aucune
// lecture reseau supplementaire. Chaque choix est optimiste (useCategorize),
// avec retour haptique et « Annuler » pendant 5 s.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { ChevronRight, Inbox, Sparkles, X } from 'lucide-react'
import type { Transaction } from '@/types/domain'
import { countsAsUncategorized, useAccountsMap, useCategoriesMap, useGroupsMap } from '@/lib/data'
import { useBudgetMonth, useTransactions } from '@/lib/queries'
import { useCategorize, useCategorySuggestions, type SuggestionReason } from '@/lib/categorize'
import { haptic } from '@/lib/haptics'
import { parseBankLabel } from '@/lib/bankLabel'
import { fmtDayLong, fmtEUR } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { CategoryPicker } from '@/components/transactions/CategoryPicker'
import { TxKindChip } from '@/components/transactions/TxKindChip'
import { GroupPill } from '@/components/shared/GroupPill'
import { Amount } from '@/components/shared/Amount'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const SWIPE_THRESHOLD = 80 // px
const UNDO_DELAY_MS = 5000

const REASON_LABELS: Record<SuggestionReason, string> = {
  payee: 'Déjà utilisée pour ce tiers',
  recent: 'Utilisée récemment',
  frequent: 'Souvent utilisée',
}

interface UndoState {
  txId: string
  label: string
}

export function TriagePage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const { data: txs, isPending } = useTransactions()
  const categorize = useCategorize()

  // File locale : ids ignores (« Passer ») renvoyes en fin de file. On garde les
  // ids, pas les objets, pour suivre le cache (une transaction categorisee
  // ailleurs disparait d'elle-meme).
  const [skipped, setSkipped] = useState<string[]>([])
  const [doneCount, setDoneCount] = useState(0)
  const [undo, setUndo] = useState<UndoState | null>(null)
  // Cle d'animation : change a chaque passage a la carte suivante.
  const [slideKey, setSlideKey] = useState(0)
  const [dragX, setDragX] = useState(0)

  const pending = useMemo(() => {
    if (!txs) return []
    return txs
      .filter((t) => countsAsUncategorized(queryClient, t))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  }, [txs, queryClient])

  // Total de la session : ce qui reste + ce qui a ete fait ici.
  const total = pending.length + doneCount

  const queue = useMemo(() => {
    const skippedSet = new Set(skipped)
    const fresh = pending.filter((t) => !skippedSet.has(t.id))
    const byId = new Map(pending.map((t) => [t.id, t]))
    const later = skipped.map((id) => byId.get(id)).filter((t): t is Transaction => Boolean(t))
    return [...fresh, ...later]
  }, [pending, skipped])

  const current = queue[0] ?? null
  const currentSkipped = current ? skipped.includes(current.id) : false
  const suggestions = useCategorySuggestions(current?.label)
  const categoriesMap = useCategoriesMap()
  const groupsMap = useGroupsMap()
  const accountsMap = useAccountsMap()

  const advance = useCallback(() => {
    setSlideKey((k) => k + 1)
    setDragX(0)
  }, [])

  // Expiration du lien « Annuler ».
  useEffect(() => {
    if (!undo) return
    const timer = window.setTimeout(() => setUndo(null), UNDO_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [undo])

  const pick = useCallback(
    (categoryId: string) => {
      if (!current) return
      categorize.mutate({ txId: current.id, categoryId })
      haptic(10)
      setDoneCount((n) => n + 1)
      setUndo({ txId: current.id, label: parseBankLabel(current.label).short })
      setSkipped((s) => s.filter((id) => id !== current.id))
      advance()
    },
    [current, categorize, advance],
  )

  const skip = useCallback(() => {
    if (!current) return
    setSkipped((s) => [...s.filter((id) => id !== current.id), current.id])
    advance()
  }, [current, advance])

  const handleUndo = useCallback(() => {
    if (!undo) return
    categorize.mutate({ txId: undo.txId, categoryId: null })
    setDoneCount((n) => Math.max(0, n - 1))
    setUndo(null)
    advance()
  }, [undo, categorize, advance])

  const goBack = useCallback(() => {
    if (window.history.length > 1) router.history.back()
    else void navigate({ to: '/transactions' })
  }, [router, navigate])

  // Raccourcis clavier (desktop) : 1-4 suggestion, S passer.
  useEffect(() => {
    if (!isDesktop || !current) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= 4 && suggestions[n - 1]) {
        e.preventDefault()
        pick(suggestions[n - 1]!.categoryId)
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        skip()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isDesktop, current, suggestions, pick, skip])

  // Swipe gauche = Passer (mobile uniquement, pointer events).
  const dragStart = useRef<number | null>(null)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (isDesktop || e.pointerType === 'mouse') return
    dragStart.current = e.clientX
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current === null) return
    const dx = e.clientX - dragStart.current
    setDragX(Math.min(0, dx))
  }
  const onPointerEnd = () => {
    if (dragStart.current === null) return
    const dx = dragX
    dragStart.current = null
    if (dx <= -SWIPE_THRESHOLD) {
      haptic(6)
      skip()
    } else {
      setDragX(0)
    }
  }

  if (isPending) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  // Etats terminaux : rien a trier au depart, ou tout trie pendant la session.
  if (!current) {
    return (
      <div className="mx-auto max-w-lg">
        <CloseRow onClose={goBack} />
        {doneCount > 0 ? <DoneState count={doneCount} /> : <NothingState />}
        {undo && <UndoLink label={undo.label} onUndo={handleUndo} />}
      </div>
    )
  }

  const parsed = parseBankLabel(current.label)
  const account = accountsMap.get(current.accountId)
  const position = Math.min(doneCount + 1, total)
  const progress = total > 0 ? (doneCount / total) * 100 : 0

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <CloseRow onClose={goBack} />

      {/* Progression de la session */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[13px]">
          <span className="font-medium text-ink tnum">
            {position} sur {total}
          </span>
          {isDesktop && <span className="text-soft">1-4 : suggestion, S : passer</span>}
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-accent/15"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-label="Progression du tri"
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out motion-reduce:transition-none"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Carte de la transaction courante (glisse a chaque changement) */}
      <div
        key={slideKey}
        className="animate-in slide-in-from-right-8 fade-in-0 duration-300 motion-reduce:animate-none"
      >
        <Card
          className={cn('touch-pan-y select-none p-5', dragX === 0 && 'transition-transform duration-200')}
          style={{ transform: dragX ? `translateX(${dragX}px)` : undefined, opacity: 1 + dragX / 400 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[19px] font-semibold leading-snug text-ink">{parsed.short}</p>
              {parsed.short !== current.label && (
                <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-soft">{current.label}</p>
              )}
            </div>
            <TxKindChip kind={parsed.kind} />
          </div>
          <Amount
            cents={current.amount}
            colored
            signed
            className="mt-4 block text-[32px] font-semibold leading-none"
          />
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-soft">
            <span>{fmtDayLong(current.date)}</span>
            {account && (
              <span className="inline-flex items-center rounded-full bg-surface2 px-2.5 py-0.5 text-[12px] font-medium text-ink">
                {account.name}
              </span>
            )}
          </div>
          {currentSkipped && (
            <p className="mt-3 text-[12px] italic text-soft">Ignorée pour cette session</p>
          )}
        </Card>
      </div>

      {/* Suggestions */}
      <div className="space-y-2">
        {suggestions.map((s, i) => {
          const cat = categoriesMap.get(s.categoryId)
          if (!cat) return null
          const group = groupsMap.get(cat.groupId)
          return (
            <button
              key={s.categoryId}
              type="button"
              onClick={() => pick(s.categoryId)}
              className="flex h-12 w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 text-left shadow-card transition-colors hover:bg-surface2 active:scale-[0.99]"
            >
              <GroupPill group={group} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">{cat.name}</span>
                <span className="block truncate text-[11px] text-soft">{REASON_LABELS[s.reason]}</span>
              </span>
              {isDesktop && (
                <kbd className="rounded-md border border-line bg-surface2 px-1.5 text-[11px] text-soft">
                  {i + 1}
                </kbd>
              )}
            </button>
          )
        })}

        <CategoryPicker label={current.label} onSelect={(id) => id && pick(id)}>
          <span className="flex h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-line px-3 text-[14px] font-medium text-ink transition-colors hover:bg-surface2">
            Autre catégorie…
            <ChevronRight className="h-4 w-4 text-soft" />
          </span>
        </CategoryPicker>

        <Button variant="ghost" className="h-12 w-full" onClick={skip}>
          Passer
        </Button>
      </div>

      {undo && <UndoLink label={undo.label} onUndo={handleUndo} />}
    </div>
  )
}

function CloseRow({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[19px] font-semibold tracking-tight lg:hidden">À trier</h2>
      <Button variant="ghost" size="icon" aria-label="Fermer" onClick={onClose} className="ml-auto">
        <X className="h-5 w-5" />
      </Button>
    </div>
  )
}

function UndoLink({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <p className="text-center text-[13px] text-soft">
      <span className="truncate">« {label} » catégorisée. </span>
      <button type="button" onClick={onUndo} className="font-medium text-accent underline-offset-2 hover:underline">
        Annuler
      </button>
    </p>
  )
}

function DoneState({ count }: { count: number }) {
  const navigate = useNavigate()
  const month = useUiStore((s) => s.month)
  const { data: budget } = useBudgetMonth(month)
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center animate-in fade-in-0 zoom-in-95 duration-300 motion-reduce:animate-none">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
        <Sparkles className="h-7 w-7" />
      </span>
      <p className="mt-1 text-[18px] font-semibold">Tout est trié</p>
      <p className="max-w-sm text-[13.5px] leading-relaxed text-soft">
        {count === 1 ? '1 transaction catégorisée' : `${count} transactions catégorisées`} pendant cette
        session.
      </p>
      {budget && (
        <p className="text-[13px] text-soft">
          Prêt à assigner :{' '}
          <span className={cn('tnum font-semibold', budget.rta < 0 ? 'text-danger' : 'text-success')}>
            {fmtEUR(budget.rta)}
          </span>
        </p>
      )}
      <Button className="mt-2" onClick={() => void navigate({ to: '/budget' })}>
        Retour au budget
      </Button>
    </div>
  )
}

function NothingState() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Inbox className="h-7 w-7" />
      </span>
      <p className="mt-1 text-[16px] font-semibold">Rien à trier</p>
      <p className="max-w-sm text-[13.5px] leading-relaxed text-soft">
        Toutes tes transactions sont catégorisées. Ton budget est à jour.
      </p>
      <Button className="mt-2" onClick={() => void navigate({ to: '/budget' })}>
        Retour au budget
      </Button>
    </div>
  )
}
