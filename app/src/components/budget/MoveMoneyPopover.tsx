import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, HandCoins, Search } from 'lucide-react'
import type { BudgetGroupBlock, BudgetRow } from '@/lib/budget'
import type { CategoryGroup } from '@/types/domain'
import { neededThisMonth, type Target } from '@/lib/targets'
import { evalAmountCents, fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { GroupPill } from '@/components/shared/GroupPill'
import { SegmentedControl } from '@/components/ui/segmented'
import { Button } from '@/components/ui/button'
import { moveTargetsFor, type useMoveMutation } from '@/components/budget/budgetMutations'
import { trapTabKey, useAnchoredBox, useDismissOnOutsidePointer } from '@/components/budget/anchoredLayer'

/** Parametres d'un deplacement (meme contrat que useMoveMutation). */
export type MoveMoneyPayload = Parameters<ReturnType<typeof useMoveMutation>['mutate']>[0]

export type MoveMode = 'cover' | 'move'

interface MoveMoneyPopoverProps {
  /** Pastille « Disponible » qui a ouvert le popover (ancre, focus rendu a la fermeture). */
  anchor: HTMLElement
  /** Enveloppe visee, valeurs a jour (cache budget). */
  row: BudgetRow
  group: CategoryGroup
  /** Blocs affiches par la grille : sources et destinations possibles. */
  groups: BudgetGroupBlock[]
  month: string
  /** Pret a assigner du mois (null tant que le budget n'est pas charge). */
  rta: number | null
  targets: Map<string, Target>
  /** Deplacement entre deux enveloppes (useMoveMutation, optimiste). */
  onMove: (payload: MoveMoneyPayload) => void
  /** Echange avec le Pret a assigner : nouvelle valeur assignee de l'enveloppe. */
  onAssign: (categoryId: string, amount: number) => void
  onClose: () => void
}

type PartnerOption =
  | { key: 'rta'; kind: 'rta'; available: number }
  | { key: string; kind: 'envelope'; row: BudgetRow; group: CategoryGroup }

interface Section {
  group: CategoryGroup
  items: Extract<PartnerOption, { kind: 'envelope' }>[]
}

const RTA_KEY = 'rta'
const WIDTH = 376
// Hauteur fixe de la liste : le popover garde sa taille pendant la recherche
// (pas de saut), la liste retrecit seulement si le viewport est trop bas.
const LIST_HEIGHT = 296

/** Recherche insensible a la casse et aux accents. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

function toDraft(cents: number): string {
  return cents <= 0 ? '' : (cents / 100).toFixed(2).replace('.', ',')
}

/**
 * Montant propose a l'ouverture ou au changement de mode : couvrir = le
 * depassement (ou, a defaut, ce qui manque a l'objectif du mois) ; deplacer =
 * tout le disponible.
 */
function defaultAmount(mode: MoveMode, row: BudgetRow, target: Target | undefined, month: string): number {
  if (mode === 'move') return Math.max(row.available, 0)
  if (row.available < 0) return -row.available
  return target ? neededThisMonth(target, month, row.assigned, row.available) : 0
}

/**
 * Pertinence d'une enveloppe partenaire (0 = la plus pertinente).
 * Couvrir depuis : celles qui ont de l'argent d'abord. Deplacer vers : celles
 * en depassement, puis celles dont l'objectif du mois n'est pas finance.
 */
function relevance(mode: MoveMode, row: BudgetRow, target: Target | undefined, month: string): number {
  if (mode === 'cover') return row.available > 0 ? 0 : row.available === 0 ? 1 : 2
  if (row.available < 0) return 0
  if (target && neededThisMonth(target, month, row.assigned, row.available) > 0) return 1
  return 2
}

function toneText(cents: number): string {
  if (cents < 0) return 'text-danger'
  if (cents > 0) return 'text-success'
  return 'text-soft'
}

/** Ligne d'apercu : « nom   avant -> apres ». */
function PreviewLine({ name, from, to }: { name: string; from: number; to: number }) {
  return (
    <div className="flex items-center gap-2 text-[12.5px]">
      <span className="min-w-0 flex-1 truncate text-soft">{name}</span>
      <span className="tnum text-soft">{fmtEUR(from)}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-soft/70" aria-hidden />
      <span className={cn('min-w-[76px] text-right font-semibold tnum', to < 0 ? 'text-danger' : 'text-ink')}>
        {fmtEUR(to)}
      </span>
    </div>
  )
}

/**
 * Popover desktop « Deplacer de l'argent », ancre a la pastille Disponible
 * d'une enveloppe. Deux modes : « Couvrir depuis… » (defaut si depassement,
 * montant = ce qui manque) et « Deplacer vers… » (defaut s'il reste de
 * l'argent, montant = le disponible). Montant libre (expressions acceptees,
 * parseur strict), liste filtrable des autres enveloppes groupees par groupe
 * et triees par pertinence, plus le Pret a assigner en tete. Validation par
 * Entree ou le bouton ; Echap et clic exterieur ferment ; focus piege dans le
 * popover puis rendu a la pastille. Les deux cotes du transfert sont appliques
 * en optimiste par les mutations (useMoveMutation / useAssignMutation).
 */
export function MoveMoneyPopover({
  anchor,
  row,
  group,
  groups,
  month,
  rta,
  targets,
  onMove,
  onAssign,
  onClose,
}: MoveMoneyPopoverProps) {
  const baseId = useId()
  const layerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const target = targets.get(row.category.id)

  // Mode et montant figes a l'ouverture (puis au changement de mode) : les
  // valeurs de l'enveloppe peuvent bouger pendant que le popover est ouvert.
  const [mode, setMode] = useState<MoveMode>(() => (row.available > 0 ? 'move' : 'cover'))
  const [amountDraft, setAmountDraft] = useState(() =>
    toDraft(defaultAmount(row.available > 0 ? 'move' : 'cover', row, target, month)),
  )
  const [query, setQuery] = useState('')
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // Hauteur reelle mesuree avant peinture : le popover, place a gauche de la
  // pastille et centre sur elle, reste entierement dans le viewport.
  const [layerHeight, setLayerHeight] = useState<number | undefined>(undefined)
  const box = useAnchoredBox(anchor, { width: WIDTH, side: 'left', layerHeight, preferHeight: 620, alignOffset: 34 })
  useLayoutEffect(() => {
    const h = layerRef.current?.offsetHeight
    if (h && h !== layerHeight) setLayerHeight(h)
  })
  useDismissOnOutsidePointer(layerRef, anchor, onClose)

  // Ouverture : focus sur la recherche (le montant est deja propose) ;
  // fermeture : focus rendu a la pastille si elle existe encore.
  useEffect(() => {
    const raf = requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }))
    return () => {
      cancelAnimationFrame(raf)
      if (anchor.isConnected) anchor.focus({ preventScroll: true })
    }
  }, [anchor])

  const changeMode = (next: MoveMode) => {
    if (next === mode) return
    setMode(next)
    setAmountDraft(toDraft(defaultAmount(next, row, target, month)))
    setActiveKey(null)
  }

  const { rtaOption, sections, flat } = useMemo(() => {
    const q = normalize(query)
    const showRta = rta !== null && (!q || normalize('Prêt à assigner').includes(q))
    const rtaOption: PartnerOption | null = showRta ? { key: RTA_KEY, kind: 'rta', available: rta } : null

    // Candidates groupees par groupe (ordre de la grille), filtrees par la
    // recherche (nom de l'enveloppe ou du groupe).
    const byGroup = new Map<string, Section & { order: number }>()
    moveTargetsFor(groups, row.category.id).forEach((candidate, order) => {
      if (q && !normalize(candidate.row.category.name).includes(q) && !normalize(candidate.group.name).includes(q)) {
        return
      }
      let section = byGroup.get(candidate.group.id)
      if (!section) {
        section = { group: candidate.group, items: [], order }
        byGroup.set(candidate.group.id, section)
      }
      section.items.push({ key: candidate.row.category.id, kind: 'envelope', row: candidate.row, group: candidate.group })
    })

    const score = (o: Extract<PartnerOption, { kind: 'envelope' }>) =>
      relevance(mode, o.row, targets.get(o.row.category.id), month)
    const sections = [...byGroup.values()]
      .map((section) => {
        const items = section.items
          .map((item, index) => ({ item, index, s: score(item) }))
          .sort((a, b) => {
            if (a.s !== b.s) return a.s - b.s
            // Couvrir : les plus gros disponibles d'abord ; deplacer : les
            // depassements les plus profonds d'abord ; sinon ordre de la grille.
            if (a.s === 0) {
              return mode === 'cover'
                ? b.item.row.available - a.item.row.available
                : a.item.row.available - b.item.row.available
            }
            return a.index - b.index
          })
        return { ...section, items: items.map((x) => x.item), best: items[0]?.s ?? 3 }
      })
      // Groupes tries par leur enveloppe la plus pertinente (ordre de la grille
      // a pertinence egale).
      .sort((a, b) => a.best - b.best || a.order - b.order)

    const flat: PartnerOption[] = [...(rtaOption ? [rtaOption] : []), ...sections.flatMap((s) => s.items)]
    return { rtaOption, sections, flat }
  }, [query, rta, groups, row.category.id, mode, targets, month])

  // Recherche saisie : la premiere enveloppe trouvee devient active (Entree
  // valide aussitot). Option active disparue du filtre : plus d'option active.
  useEffect(() => {
    if (query.trim()) setActiveKey(flat[0]?.key ?? null)
    // flat change aussi quand le cache bouge : seule la saisie reinitialise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])
  const active = flat.find((o) => o.key === activeKey) ?? null

  useEffect(() => {
    if (!activeKey) return
    document.getElementById(`${baseId}-opt-${activeKey}`)?.scrollIntoView({ block: 'nearest' })
  }, [activeKey, baseId])

  const cents = evalAmountCents(amountDraft)
  const amountValid = cents !== null && cents > 0
  const canConfirm = active !== null && amountValid

  // Valide avec l'option donnee (valeurs a jour du cache au moment du clic).
  const commit = useCallback(
    (option: PartnerOption) => {
      if (cents === null || cents <= 0) return
      if (option.kind === 'rta') {
        // Couvrir depuis le Pret a assigner = assigner plus ; y deplacer = assigner moins.
        onAssign(row.category.id, mode === 'cover' ? row.assigned + cents : row.assigned - cents)
      } else {
        // Couvrir : l'enveloppe choisie est la SOURCE ; deplacer : la courante.
        const from = mode === 'cover' ? option.row : row
        const to = mode === 'cover' ? row : option.row
        onMove({
          fromId: from.category.id,
          toId: to.category.id,
          fromAssigned: from.assigned,
          toAssigned: to.assigned,
          amount: cents,
        })
      }
      onClose()
    },
    [cents, mode, row, onAssign, onMove, onClose],
  )
  const confirm = () => {
    if (active) commit(active)
  }

  const moveActive = (direction: 1 | -1) => {
    if (flat.length === 0) return
    const index = flat.findIndex((o) => o.key === activeKey)
    const next =
      index === -1 ? (direction === 1 ? 0 : flat.length - 1) : Math.min(Math.max(index + direction, 0), flat.length - 1)
    setActiveKey(flat[next]!.key)
  }

  if (!box) return null

  const signed = amountValid ? cents : 0
  const selfAfter = mode === 'cover' ? row.available + signed : row.available - signed
  const partnerFrom = active ? (active.kind === 'rta' ? active.available : active.row.available) : 0
  const partnerAfter = mode === 'cover' ? partnerFrom - signed : partnerFrom + signed
  const partnerName = active ? (active.kind === 'rta' ? 'Prêt à assigner' : active.row.category.name) : ''
  const listId = `${baseId}-list`
  const verb = mode === 'cover' ? 'Couvrir' : 'Déplacer'

  const optionClass = (key: string, dim: boolean) =>
    cn(
      'flex h-10 cursor-pointer select-none items-center gap-2.5 rounded-xl px-2 transition-colors duration-100',
      key === activeKey
        ? 'bg-accent/10 shadow-[inset_0_0_0_1px_rgb(var(--accent)/0.35)]'
        : 'hover:bg-ink/[0.04]',
      dim && key !== activeKey && 'opacity-55',
    )

  const optionHandlers = (option: PartnerOption) => ({
    // Le focus reste dans le champ courant : la navigation clavier continue.
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onClick: () => setActiveKey(option.key),
    // Double-clic : choisit et valide d'un geste.
    onDoubleClick: () => commit(option),
  })

  return createPortal(
    <div
      ref={layerRef}
      role="dialog"
      aria-label={`Déplacer de l'argent : ${row.category.name}`}
      data-inab-popover=""
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
          return
        }
        trapTabKey(e)
      }}
      style={{
        position: 'fixed',
        left: box.left,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        maxHeight: box.maxHeight,
      }}
      className={cn(
        'z-50 flex animate-scale-in flex-col rounded-3xl border border-edge bg-surface3 shadow-elevated',
        box.placement === 'left' ? 'origin-right' : box.placement === 'below' ? 'origin-top-right' : 'origin-bottom-right',
      )}
    >
      {/* Fleche vers la pastille (placement lateral). */}
      {box.placement === 'left' && box.arrowY !== undefined && (
        <span
          aria-hidden
          className="pointer-events-none absolute -right-[7px] h-3.5 w-3.5 rotate-45 rounded-[3px] border-r border-t border-edge bg-surface3"
          style={{ top: Math.min(Math.max(box.arrowY - 7, 22), (layerHeight ?? 400) - 36) }}
        />
      )}
      {/* En-tete : l'enveloppe visee et son disponible, puis le sens. */}
      <div className="space-y-3 px-4 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <GroupPill group={group} size="sm" />
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-tight">{row.category.name}</span>
          <span className={cn('shrink-0 text-[13px] font-semibold tnum', toneText(row.available))}>
            {fmtEUR(row.available)}
          </span>
        </div>
        <SegmentedControl
          size="sm"
          block
          aria-label="Sens du déplacement"
          value={mode}
          onChange={changeMode}
          options={[
            { value: 'cover', label: 'Couvrir depuis…', icon: ArrowDownLeft },
            { value: 'move', label: 'Déplacer vers…', icon: ArrowUpRight },
          ]}
        />
        <label className="flex items-center gap-3">
          <span className="label-caps shrink-0">Montant</span>
          <span className="relative flex-1">
            <input
              value={amountDraft}
              onChange={(e) => setAmountDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (canConfirm) confirm()
                else searchRef.current?.focus()
              }}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
              placeholder="0,00"
              aria-label="Montant à déplacer"
              aria-invalid={(amountDraft.trim() !== '' && !amountValid) || undefined}
              className={cn(
                'h-11 w-full rounded-xl border bg-surface pl-3 pr-8 text-right text-[18px] font-semibold tnum outline-none transition-[border-color,box-shadow] duration-150 placeholder:font-normal placeholder:text-soft/50 focus:ring-4 [@media(pointer:coarse)]:text-[18px]',
                amountDraft.trim() !== '' && !amountValid
                  ? 'border-danger/70 focus:ring-danger/15'
                  : 'border-line focus:border-accent/70 focus:ring-accent/15',
              )}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[15px] font-medium text-soft">
              €
            </span>
          </span>
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" aria-hidden />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                moveActive(e.key === 'ArrowDown' ? 1 : -1)
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (canConfirm) confirm()
                else if (!active && flat[0]) setActiveKey(flat[0].key)
              }
            }}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeKey ? `${baseId}-opt-${activeKey}` : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder={mode === 'cover' ? 'Prendre dans quelle enveloppe ?' : 'Vers quelle enveloppe ?'}
            aria-label={mode === 'cover' ? "Enveloppe d'où prendre l'argent" : "Enveloppe qui reçoit l'argent"}
            className="h-10 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-[14px] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-soft/70 focus:border-accent/70 focus:ring-4 focus:ring-accent/15 [@media(pointer:coarse)]:text-[16px]"
          />
        </div>
      </div>

      {/* Liste : Pret a assigner puis enveloppes groupees. */}
      <div
        id={listId}
        role="listbox"
        aria-label="Enveloppes"
        style={{ height: LIST_HEIGHT }}
        className="min-h-[112px] shrink overflow-y-auto overscroll-contain border-t border-edge px-2 py-1.5"
      >
        {rtaOption && (
          <div
            id={`${baseId}-opt-${RTA_KEY}`}
            role="option"
            aria-selected={activeKey === RTA_KEY}
            className={optionClass(RTA_KEY, mode === 'cover' && rtaOption.available <= 0)}
            {...optionHandlers(rtaOption)}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-accentfg shadow-highlight">
              <HandCoins className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">Prêt à assigner</span>
            <span className={cn('text-[13px] font-semibold tnum', toneText(rtaOption.available))}>
              {fmtEUR(rtaOption.available)}
            </span>
          </div>
        )}
        {sections.map((section) => (
          <div key={section.group.id} role="group" aria-label={section.group.name}>
            <p className="px-2 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-soft" aria-hidden>
              {section.group.name}
            </p>
            {section.items.map((item) => (
              <div
                key={item.key}
                id={`${baseId}-opt-${item.key}`}
                role="option"
                aria-selected={activeKey === item.key}
                className={optionClass(item.key, mode === 'cover' && item.row.available <= 0)}
                {...optionHandlers(item)}
              >
                <GroupPill group={item.group} size="sm" className="h-6 w-6 [&_svg]:h-3 [&_svg]:w-3" />
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{item.row.category.name}</span>
                <span className={cn('text-[13px] font-medium tnum', toneText(item.row.available))}>
                  {fmtEUR(item.row.available)}
                </span>
              </div>
            ))}
          </div>
        ))}
        {flat.length === 0 && (
          <p className="px-3 py-6 text-center text-[13px] text-soft">Aucune enveloppe ne correspond à « {query.trim()} ».</p>
        )}
      </div>

      {/* Apercu des deux cotes puis validation. */}
      <div className="space-y-3 border-t border-edge px-4 pb-4 pt-3">
        {active ? (
          <div className="space-y-1">
            <PreviewLine name={row.category.name} from={row.available} to={selfAfter} />
            <PreviewLine name={partnerName} from={partnerFrom} to={partnerAfter} />
          </div>
        ) : (
          <p className="text-[12.5px] text-soft">
            {mode === 'cover'
              ? "Choisissez l'enveloppe qui cède l'argent."
              : "Choisissez l'enveloppe qui reçoit l'argent."}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button variant="ghost" className="h-10" onClick={onClose}>
            Annuler
          </Button>
          <Button className="h-10 flex-1" onClick={confirm} disabled={!canConfirm}>
            {amountValid ? `${verb} ${fmtEUR(cents)}` : verb}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
