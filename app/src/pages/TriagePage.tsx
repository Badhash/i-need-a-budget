// Page « À trier » : revue une-par-une (inbox zero) des transactions a
// categoriser. Tout vient du cache TanStack (transactions + bootstrap) : aucune
// lecture reseau supplementaire. Chaque choix est optimiste (useCategorize) ;
// la carte s'envole (CSS, coupe sous mouvement reduit) et la suivante est deja
// la. File : regle du badge « À catégoriser » (countsAsUncategorized, moities
// de virements croises comprises quand le serveur les annonce). Clavier
// (desktop) : 1-4 suggestion, S passer, U ou Ctrl+Z annuler, Entree selecteur.

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import type { Transaction } from '@/types/domain'
import { countsAsUncategorized, useAccountsMap, useBootstrap } from '@/lib/data'
import { useTransactions } from '@/lib/queries'
import { useCategorize } from '@/lib/categorize'
import { usePayeeDefault } from '@/lib/payees'
import { payeeKeyOf } from '@/lib/ruleInsights'
import { useTriageSuggestions } from '@/lib/triage'
import { parseBankLabel } from '@/lib/bankLabel'
import { fmtEURSigned } from '@/lib/format'
import { haptic } from '@/lib/haptics'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { DeckLayers, TriageCard, type TransferInfo } from '@/components/rules/triage/TriageCard'
import { TriageHero, type PayeeSwitchState, type TriageReceipt } from '@/components/rules/triage/TriageHero'
import { ShortcutLegend, TriageChoices } from '@/components/rules/triage/TriageChoices'
import { TriageDone, TriageNothing, TriageSkippedLeft } from '@/components/rules/triage/TriageEnd'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const SWIPE_THRESHOLD = 90 // px
const HISTORY_LIMIT = 30

interface PayeeMemo {
  key: string
  /** Libelle transmis a setPayeeCategory (le serveur re-derive la cle). */
  label: string
  /** Defaut memorise au moment du choix (restaure a l'annulation). */
  initial: string | null
  /** Etat de la bascule « Toujours pour ce tiers ». */
  forced: boolean
}

type HistoryEntry =
  | {
      kind: 'pick'
      txId: string
      label: string
      categoryId: string
      payee: PayeeMemo | null
      /** Pourquoi la memoire de tiers ne s'applique pas (payee null). */
      payeeNote: string | null
    }
  | { kind: 'skip'; txId: string; label: string }

interface Leaving {
  tx: Transaction
  dir: 'left' | 'right'
  categoryId: string | null
  /** Decalage du geste au lacher (la carte repart de la ou est le doigt). */
  dragX: number
  seq: number
}

type Enter = 'deck' | 'undo-pick' | 'undo-skip'

// Apres un choix a la souris, le bouton clique garde le focus : Entree ou
// Espace rejoueraient ce choix sur la carte suivante. On rend le focus.
function releaseFocus(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement && active !== document.body) active.blur()
}

function byRecency(a: Transaction, b: Transaction): number {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : 0
}

export function TriagePage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const { data: txs, isPending } = useTransactions()
  const boot = useBootstrap().data
  const accountsMap = useAccountsMap()
  const categorize = useCategorize()
  const payeeDefault = usePayeeDefault()

  // Etat de session : ids passes (renvoyes en fin de file), ids a remettre en
  // tete (annulation), historique des actions (annuler en pile).
  const [skipped, setSkipped] = useState<string[]>([])
  const [front, setFront] = useState<string[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  // Compteur de la session (l'historique d'annulation, lui, est borne).
  const [done, setDone] = useState(0)
  const [reviewSkipped, setReviewSkipped] = useState(false)
  const [leaving, setLeaving] = useState<Leaving | null>(null)
  const [enter, setEnter] = useState<Enter>('deck')
  const [dragX, setDragX] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [finishedAt, setFinishedAt] = useState<number | null>(null)
  const seq = useRef(0)
  const pickerRef = useRef<HTMLButtonElement>(null)

  // File : meme regle que le badge « À catégoriser » (bootstrap dans les
  // dependances : comptes, mois de depart et drapeaux serveur y sont lus).
  const pending = useMemo(() => {
    if (!txs || !boot) return []
    return txs.filter((t) => countsAsUncategorized(queryClient, t)).sort(byRecency)
  }, [txs, boot, queryClient])

  const { queue, later } = useMemo(() => {
    const byId = new Map(pending.map((t) => [t.id, t]))
    const frontSet = new Set(front)
    const skippedSet = new Set(skipped)
    const head = front.map((id) => byId.get(id)).filter((t): t is Transaction => Boolean(t))
    const fresh = pending.filter((t) => !frontSet.has(t.id) && !skippedSet.has(t.id))
    const rest = skipped
      .filter((id) => !frontSet.has(id))
      .map((id) => byId.get(id))
      .filter((t): t is Transaction => Boolean(t))
    return { queue: [...head, ...fresh], later: rest }
  }, [pending, front, skipped])

  const reviewing = queue.length === 0 && reviewSkipped
  const current = queue[0] ?? (reviewSkipped ? (later[0] ?? null) : null)
  const upcoming = useMemo(() => {
    const all = reviewing ? later : [...queue, ...later]
    return all.filter((t) => t.id !== current?.id)
  }, [queue, later, reviewing, current])

  const sessionPicks = useMemo(
    () => history.filter((h): h is Extract<HistoryEntry, { kind: 'pick' }> => h.kind === 'pick').map((h) => h.categoryId).reverse(),
    [history],
  )
  const suggestions = useTriageSuggestions(current, sessionPicks)

  // Fin de session : horodatee une fois pour l'ecran de celebration.
  useEffect(() => {
    if (pending.length === 0 && done > 0 && finishedAt === null) setFinishedAt(Date.now())
    if (pending.length > 0 && finishedAt !== null) setFinishedAt(null)
  }, [pending.length, done, finishedAt])

  const transferOf = useCallback(
    (t: Transaction): TransferInfo | null => {
      if (!t.transferGroupId || !txs) return null
      const other = txs.find((o) => o.transferGroupId === t.transferGroupId && o.id !== t.id)
      const name = other ? accountsMap.get(other.accountId)?.name : undefined
      return name ? { otherAccount: name } : null
    },
    [txs, accountsMap],
  )

  const fly = useCallback((tx: Transaction, dir: 'left' | 'right', categoryId: string | null, fromX: number) => {
    seq.current += 1
    setLeaving({ tx, dir, categoryId, dragX: fromX, seq: seq.current })
    setEnter('deck')
    setDragX(0)
  }, [])

  const pick = useCallback(
    (categoryId: string) => {
      if (!current) return
      const category = boot?.categories.find((c) => c.id === categoryId)
      const key = payeeKeyOf(current)
      const initial = key ? (boot?.payees.find((p) => p.key === key)?.categoryId ?? null) : null
      // « Toujours pour ce tiers » : ni revenus (refuses par le serveur), ni
      // moitie de virement, ni libelle sans mot stable.
      const payee: PayeeMemo | null =
        key && category && !category.isIncome && !current.transferGroupId
          ? { key, label: current.label, initial, forced: initial === categoryId }
          : null
      const payeeNote = payee
        ? null
        : category?.isIncome
          ? 'Revenus : la mémoire des tiers ne les retient pas.'
          : current.transferGroupId
            ? "Virement : la mémoire des tiers ne s'applique pas."
            : 'Libellé sans tiers reconnaissable : rien à mémoriser.'
      const txId = current.id
      categorize.mutate(
        { txId, categoryId },
        {
          // Echec (rollback du cache par useCategorize) : la carte revient
          // dans la file, le choix sort de l'historique et du compteur.
          onError: () => {
            setHistory((h) => h.filter((e) => !(e.kind === 'pick' && e.txId === txId && e.categoryId === categoryId)))
            setDone((n) => Math.max(0, n - 1))
          },
        },
      )
      haptic(10)
      releaseFocus()
      setDone((n) => n + 1)
      setStartedAt((s) => s ?? Date.now())
      setHistory((h) => [
        ...h.slice(-HISTORY_LIMIT + 1),
        { kind: 'pick', txId: current.id, label: parseBankLabel(current.label).short, categoryId, payee, payeeNote },
      ])
      setFront((f) => f.filter((id) => id !== current.id))
      setSkipped((s) => s.filter((id) => id !== current.id))
      fly(current, 'right', categoryId, dragX)
    },
    [current, boot, categorize, fly, dragX],
  )

  const skip = useCallback(() => {
    if (!current) return
    haptic(6)
    releaseFocus()
    setStartedAt((s) => s ?? Date.now())
    setHistory((h) => [...h.slice(-HISTORY_LIMIT + 1), { kind: 'skip', txId: current.id, label: parseBankLabel(current.label).short }])
    setFront((f) => f.filter((id) => id !== current.id))
    setSkipped((s) => [...s.filter((id) => id !== current.id), current.id])
    fly(current, 'left', null, dragX)
  }, [current, fly, dragX])

  const undo = useCallback(() => {
    const last = history[history.length - 1]
    if (!last) return
    haptic(8)
    setHistory((h) => h.slice(0, -1))
    if (last.kind === 'pick') {
      categorize.mutate({ txId: last.txId, categoryId: null })
      setDone((n) => Math.max(0, n - 1))
      // La bascule « Toujours pour ce tiers » a change le defaut : on le remet.
      if (last.payee && last.payee.forced !== (last.payee.initial === last.categoryId)) {
        payeeDefault.mutate({ key: last.payee.key, label: last.payee.label, categoryId: last.payee.initial })
      }
      setEnter('undo-pick')
    } else {
      setSkipped((s) => s.filter((id) => id !== last.txId))
      setEnter('undo-skip')
    }
    setFront((f) => [last.txId, ...f.filter((id) => id !== last.txId)])
    setLeaving(null)
    setDragX(0)
  }, [history, categorize, payeeDefault])

  const lastEntry = history[history.length - 1] ?? null

  const togglePayee = useCallback(() => {
    if (!lastEntry || lastEntry.kind !== 'pick' || !lastEntry.payee) return
    const { payee, categoryId } = lastEntry
    const on = !payee.forced
    const setForced = (forced: boolean) =>
      setHistory((h) =>
        h.map((entry) =>
          entry.kind === 'pick' && entry.txId === lastEntry.txId && entry.payee
            ? { ...entry, payee: { ...entry.payee, forced } }
            : entry,
        ),
      )
    haptic(6)
    payeeDefault.mutate(
      {
        key: payee.key,
        label: payee.label,
        categoryId: on ? categoryId : payee.initial === categoryId ? null : payee.initial,
      },
      // Echec : le cache est deja restaure, la bascule revient avec lui.
      { onError: () => setForced(!on) },
    )
    setForced(on)
  }, [lastEntry, payeeDefault])

  const goBack = useCallback(() => {
    if (window.history.length > 1) router.history.back()
    else void navigate({ to: '/transactions' })
  }, [router, navigate])

  // Raccourcis clavier. Ignores pendant la saisie, quand le selecteur de
  // categorie ou un dialog est ouvert, et en repetition de touche.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (document.querySelector('[data-inab-popover], [role="dialog"]')) return
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && key === 'z') {
        e.preventDefault()
        undo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (/^[1-4]$/.test(key)) {
        const s = suggestions[Number(key) - 1]
        if (s && current) {
          e.preventDefault()
          pick(s.categoryId)
        }
      } else if (key === 's' && current) {
        e.preventDefault()
        skip()
      } else if (key === 'u') {
        e.preventDefault()
        undo()
      } else if (key === 'enter' && current) {
        // Entree sur un bouton focalise garde son action native.
        if (target?.closest('button, a, [role="button"], [role="switch"]')) return
        e.preventDefault()
        // Le bouton ouvre le selecteur et donne le focus a sa recherche.
        pickerRef.current?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [suggestions, current, pick, skip, undo])

  // Glisser vers la gauche = Passer (tactile uniquement).
  const dragStart = useRef<{ x: number; y: number; id: number } | null>(null)
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse') return
    dragStart.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current
    if (!start || start.id !== e.pointerId) return
    const dx = e.clientX - start.x
    // Geste surtout vertical : c'est un defilement, pas un glisser.
    if (dragX === 0 && Math.abs(e.clientY - start.y) > Math.abs(dx)) {
      dragStart.current = null
      return
    }
    setDragX(Math.min(0, dx))
  }
  const onPointerEnd = () => {
    if (!dragStart.current) return
    dragStart.current = null
    if (dragX <= -SWIPE_THRESHOLD) skip()
    else setDragX(0)
  }

  const receipt: TriageReceipt | null = lastEntry
    ? lastEntry.kind === 'pick'
      ? { kind: 'pick', label: lastEntry.label, categoryId: lastEntry.categoryId }
      : { kind: 'skip', label: lastEntry.label }
    : null
  const payeeSwitch: PayeeSwitchState | null =
    lastEntry?.kind === 'pick' && lastEntry.payee
      ? { payeeKey: lastEntry.payee.key, on: lastEntry.payee.forced, onToggle: togglePayee }
      : null

  if (isPending || !boot) {
    return (
      <div className="mx-auto max-w-lg space-y-4 lg:max-w-4xl">
        <Skeleton className="h-[150px] w-full rounded-3xl" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Skeleton className="h-[230px] w-full rounded-3xl" />
          <div className="space-y-2">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  const hero = (
    <TriageHero
      remaining={pending.length}
      done={done}
      receipt={receipt}
      payeeSwitch={payeeSwitch}
      payeeNote={lastEntry?.kind === 'pick' ? lastEntry.payeeNote : null}
      showKeys={isDesktop}
      onUndo={undo}
      onClose={goBack}
    />
  )

  // Etats terminaux : rien au depart, tout trie, ou seulement des passees.
  if (!current) {
    const body =
      pending.length === 0 ? (
        done > 0 ? (
          <TriageDone count={done} durationMs={startedAt && finishedAt ? finishedAt - startedAt : null} />
        ) : (
          <TriageNothing />
        )
      ) : (
        <TriageSkippedLeft count={later.length} onReview={() => setReviewSkipped(true)} onFinish={goBack} />
      )
    return (
      <div className="mx-auto max-w-lg space-y-4 lg:max-w-4xl lg:space-y-6">
        {history.length > 0 && hero}
        <div className="mx-auto max-w-2xl animate-fade-up">{body}</div>
      </div>
    )
  }

  const account = accountsMap.get(current.accountId)
  const dragging = dragX !== 0
  const enterClass =
    enter === 'undo-pick'
      ? 'animate-in fade-in-0 slide-in-from-right-1/3 duration-300'
      : enter === 'undo-skip'
        ? 'animate-in fade-in-0 slide-in-from-left-1/3 duration-300'
        : 'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-3 duration-300'

  const deck = (
    <div className="relative isolate pb-4">
      <DeckLayers count={Math.min(2, upcoming.length)} />
      <div key={`${current.id}-${enter}`} className={cn('ease-spring', enterClass)}>
        <TriageCard
          tx={current}
          accountName={account?.name}
          transfer={transferOf(current)}
          skipped={skipped.includes(current.id)}
          className={cn('touch-pan-y', !dragging && 'transition-transform duration-200 ease-spring')}
          style={
            dragging
              ? { transform: `translateX(${dragX}px) rotate(${dragX / 28}deg)`, opacity: Math.max(0.35, 1 + dragX / 320) }
              : undefined
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
        {dragging && (
          <span
            aria-hidden
            className="pointer-events-none absolute right-5 top-1/2 -translate-y-1/2 rounded-full bg-surface3 px-3 py-1.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-soft shadow-raised ring-1 ring-edge"
            style={{ opacity: Math.min(1, -dragX / SWIPE_THRESHOLD) }}
          >
            Passer
          </span>
        )}
      </div>
      {leaving && (
        <div
          key={leaving.seq}
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 z-10 animate-out fade-out-0 fill-mode-forwards duration-300 ease-in',
            // Desktop : envol court, la carte ne traverse pas la colonne des choix.
            leaving.dir === 'right'
              ? 'slide-out-to-right-full spin-out-6 lg:slide-out-to-right-1/3 lg:spin-out-3'
              : 'slide-out-to-left-full spin-out-[-6deg] lg:slide-out-to-left-1/3 lg:spin-out-[-3deg]',
          )}
          style={{ transform: leaving.dragX ? `translateX(${leaving.dragX}px) rotate(${leaving.dragX / 28}deg)` : undefined }}
          onAnimationEnd={() => setLeaving((l) => (l && l.seq === leaving.seq ? null : l))}
        >
          <TriageCard
            tx={leaving.tx}
            accountName={accountsMap.get(leaving.tx.accountId)?.name}
            transfer={transferOf(leaving.tx)}
            stamp={leaving.categoryId ? { kind: 'pick', categoryId: leaving.categoryId } : { kind: 'skip' }}
          />
        </div>
      )}
    </div>
  )

  const choices = (
    <TriageChoices
      ref={pickerRef}
      tx={current}
      suggestions={suggestions}
      showKeys={isDesktop}
      onPick={pick}
      onSkip={skip}
    />
  )

  return (
    <div className="mx-auto max-w-lg space-y-4 lg:max-w-4xl lg:space-y-6">
      {hero}
      {isDesktop ? (
        <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-6">
          <div className="space-y-5">
            {deck}
            {upcoming.length > 0 && <UpNext items={upcoming.slice(0, 3)} total={upcoming.length} />}
          </div>
          <div className="space-y-4">
            {choices}
            <ShortcutLegend />
          </div>
        </div>
      ) : (
        <>
          {deck}
          {choices}
        </>
      )}
    </div>
  )
}

/** Apercu des prochaines transactions (desktop) : l'elan de la file. */
function UpNext({ items, total }: { items: Transaction[]; total: number }) {
  return (
    <div className="space-y-2 px-1">
      <p className="label-caps">Ensuite</p>
      <ul className="space-y-1.5">
        {items.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-[13.5px] text-soft">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-soft/50" />
            <span className="min-w-0 flex-1 truncate text-ink/80">{parseBankLabel(t.label).short}</span>
            <span className={cn('shrink-0 tnum', t.amount > 0 && 'text-success')}>{fmtEURSigned(t.amount)}</span>
          </li>
        ))}
      </ul>
      {total > items.length && <p className="px-2 text-[12.5px] text-soft">et {total - items.length} de plus</p>}
    </div>
  )
}
