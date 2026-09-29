import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleSlash, Search } from 'lucide-react'
import { useCategoriesList, useCategoriesMap, useGroupsList, useGroupsMap } from '@/lib/data'
import { useCategorySuggestions, type SuggestionReason } from '@/lib/categorize'
import { haptic } from '@/lib/haptics'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { GroupPill } from '@/components/shared/GroupPill'
import { cn } from '@/lib/utils'

interface CategoryPickerProps {
  children: ReactNode
  onSelect: (categoryId: string | null) => void
  includeIncome?: boolean
  /** Libelle de la transaction : active la ligne « Suggestions » (tiers
   * memorise, categories recentes/frequentes). Sans libelle, pas de ligne. */
  label?: string
  /** Categorie actuelle : cochee, et proposee meme si elle est masquee. */
  value?: string | null
  /** Empeche l'ouverture (ex. ligne en cours d'enregistrement). */
  disabled?: boolean
}

const REASON_HINT: Record<SuggestionReason, string> = {
  payee: 'tiers',
  recent: 'récent',
  frequent: 'fréquent',
}

/**
 * Ligne de suggestions (jusqu'a 4 chips) au-dessus de la liste. Composant
 * separe : le hook de suggestions lit le cache des transactions, on ne le
 * monte donc que lorsqu'un libelle est fourni (jamais depuis la page Regles).
 */
function SuggestionsRow({ label, onPick }: { label: string; onPick: (id: string) => void }) {
  const suggestions = useCategorySuggestions(label)
  const categoryById = useCategoriesMap()
  const groupById = useGroupsMap()
  if (suggestions.length === 0) return null
  return (
    <div className="px-1 pb-1.5">
      <p className="px-1.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-soft">Suggestions</p>
      <div className="flex flex-wrap gap-1.5 px-1">
        {suggestions.map((s) => {
          const cat = categoryById.get(s.categoryId)
          if (!cat) return null
          const group = groupById.get(cat.groupId)
          return (
            <button
              key={s.categoryId}
              type="button"
              title={REASON_HINT[s.reason]}
              onClick={() => onPick(s.categoryId)}
              className="inline-flex min-h-[40px] max-w-full items-center gap-1.5 rounded-full py-1 pl-1 pr-3 text-[13px] font-medium shadow-highlight ring-1 ring-inset ring-ink/[0.05] transition-transform duration-150 ease-spring active:scale-95 lg:min-h-0"
              style={{
                backgroundColor: group ? `var(--cat-${group.color}-bg)` : undefined,
                color: group ? `var(--cat-${group.color}-fg)` : undefined,
              }}
            >
              <GroupPill group={group} size="sm" className="h-6 w-6 bg-surface/60 [&_svg]:h-3 [&_svg]:w-3" />
              <span className="truncate">{cat.name}</span>
              {s.reason === 'payee' && <span className="text-[10.5px] font-semibold opacity-70">tiers</span>}
            </button>
          )
        })}
      </div>
      <div className="mx-1 mt-2 border-t border-edge" />
    </div>
  )
}

// Normalisation insensible casse/accents pour la recherche.
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const PANEL_WIDTH = 288 // px
const VIEWPORT_MARGIN = 12 // px

/**
 * Categorisation rapide : le declencheur (children, ex. une pastille) ouvre un
 * popover avec un champ de recherche et la liste des categories groupees.
 * Les categories masquees (ou d'un groupe masque) n'y figurent pas, sauf la
 * categorie actuelle. Clavier (desktop) : fleches pour parcourir, Entree pour
 * choisir, Echap pour fermer.
 *
 * Le panneau est rendu dans un PORTAIL (document.body) en position fixed : les
 * cartes de transaction ont overflow-hidden (coins arrondis), un popover en
 * position absolute a l'interieur serait clippe. Le portail l'en sort.
 *
 * DESKTOP : popover ancre sous le declencheur (au-dessus si la place manque),
 * recale au scroll/resize.
 * MOBILE : feuille posee EN BAS, au-dessus du clavier (comme AssignSheet). On
 * n'ancre PAS au declencheur : quand le champ de recherche prend le focus, iOS
 * scrolle la page pour reveler l'input et la transaction remonte — un popover
 * ancre suivrait ce scroll et se retrouverait detache tout en haut (bug). La
 * feuille basse, calee sur le clavier via useKeyboardInset, reste stable.
 */
export function CategoryPicker({
  children,
  onSelect,
  includeIncome = false,
  label,
  value = null,
  disabled = false,
}: CategoryPickerProps) {
  // Le declencheur reste leger (une pastille par ligne de liste) : lectures de
  // taxonomie, mesures du clavier et ecouteurs ne vivent que dans le panneau,
  // monte a l'ouverture.
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLSpanElement>(null)

  return (
    <span ref={triggerRef} className="inline-flex max-w-full">
      {/* Le declencheur reel (une pastille bouton) reste children ; ce wrapper
          ne sert qu'a ancrer le popover et a basculer l'ouverture. Le clic ne
          remonte pas a la ligne (ouverture du detail). */}
      <span
        onClick={(e) => {
          e.stopPropagation()
          if (!disabled) setOpen((o) => !o)
        }}
        className="inline-flex max-w-full"
      >
        {children}
      </span>
      {open && (
        <PickerPanel
          triggerRef={triggerRef}
          includeIncome={includeIncome}
          label={label}
          value={value}
          onClose={() => setOpen(false)}
          onChoose={(id) => {
            onSelect(id)
            setOpen(false)
          }}
        />
      )}
    </span>
  )
}

interface PickerPanelProps {
  triggerRef: React.RefObject<HTMLSpanElement>
  includeIncome: boolean
  label?: string
  value: string | null
  onClose: () => void
  onChoose: (categoryId: string | null) => void
}

function PickerPanel({ triggerRef, includeIncome, label, value, onClose, onChoose }: PickerPanelProps) {
  const allCategories = useCategoriesList()
  const allGroups = useGroupsList()
  const isDesktop = useIsDesktop()
  const keyboardInset = useKeyboardInset()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Calcule la position du panneau sous le declencheur, borne dans le viewport
  // (au-dessus du declencheur quand la place manque en bas).
  function place() {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = r.left
    if (left + PANEL_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - VIEWPORT_MARGIN - PANEL_WIDTH
    }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN
    const vpHeight = window.visualViewport?.height ?? window.innerHeight
    const below = vpHeight - r.bottom - VIEWPORT_MARGIN
    const above = r.top - VIEWPORT_MARGIN
    if (below < 300 && above > below) {
      const maxHeight = Math.min(440, above - 6)
      setPos({ top: Math.max(VIEWPORT_MARGIN, r.top - 6 - maxHeight), left, maxHeight })
      return
    }
    setPos({ top: r.bottom + 6, left, maxHeight: Math.max(200, Math.min(440, below - 6)) })
  }

  // Ouverture : place le panneau (desktop uniquement), focus sur la recherche.
  useEffect(() => {
    if (isDesktop) place()
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop])

  // Recalage au scroll/resize : DESKTOP uniquement (le popover ancre suit le
  // declencheur). Sur mobile la feuille est calee sur le clavier, pas au scroll.
  useEffect(() => {
    if (!isDesktop) return
    const onMove = () => place()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    window.visualViewport?.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      window.visualViewport?.removeEventListener('resize', onMove)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDesktop])

  // Fermeture au clic hors du declencheur ET du panneau.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [triggerRef, onClose])

  const groups = useMemo(() => {
    const q = norm(query)
    // Revenus en tete quand ils sont proposes (entree d'argent), puis l'ordre
    // du budget.
    const incomeGroups = new Set(allCategories.filter((c) => c.isIncome).map((c) => c.groupId))
    return allGroups
      .slice()
      .sort(
        (a, b) =>
          (includeIncome ? Number(incomeGroups.has(b.id)) - Number(incomeGroups.has(a.id)) : 0) ||
          a.sortOrder - b.sortOrder,
      )
      .map((group) => ({
        group,
        cats: allCategories
          .filter(
            (c) =>
              c.groupId === group.id &&
              (includeIncome || !c.isIncome) &&
              (c.id === value || (!c.hidden && !group.hidden)) &&
              (!q || norm(c.name).includes(q)),
          )
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .filter((x) => x.cats.length > 0)
  }, [allGroups, allCategories, includeIncome, query, value])

  const flat = useMemo(() => groups.flatMap((g) => g.cats), [groups])
  useEffect(() => setActive(0), [query])

  // L'element actif reste visible pendant la navigation clavier.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = onChoose

  let index = -1

  if (isDesktop && pos === null) return null

  return createPortal(
    <>
      {/* Mobile : voile cliquable pour fermer (le mousedown ne se
          declenche pas de facon fiable au toucher hors du panneau). */}
      {!isDesktop && (
        <div
          data-inab-popover=""
          className="fixed inset-0 z-[59] animate-fade-in bg-scrim"
          style={{ pointerEvents: 'auto' }}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          aria-hidden
        />
      )}
      <div
        ref={panelRef}
        data-inab-popover=""
        role="dialog"
        aria-label="Choisir une catégorie"
        style={{
          // pointerEvents force : dans un Dialog Radix modal, body passe en
          // pointer-events:none et un panneau portalise serait inerte.
          pointerEvents: 'auto',
          ...(isDesktop
            ? {
                position: 'fixed' as const,
                top: pos!.top,
                left: pos!.left,
                width: PANEL_WIDTH,
                maxHeight: pos!.maxHeight,
              }
            : {
                position: 'fixed' as const,
                left: VIEWPORT_MARGIN,
                right: VIEWPORT_MARGIN,
                // Clavier ferme : au-dessus de l'indicateur home (safe-area).
                bottom:
                  keyboardInset > 0
                    ? keyboardInset + VIEWPORT_MARGIN
                    : `calc(${VIEWPORT_MARGIN}px + env(safe-area-inset-bottom))`,
                // Feuille aux trois quarts de l'ecran (le voile reste visible),
                // bornee au-dessus du clavier.
                maxHeight: Math.max(
                  240,
                  Math.min(window.innerHeight * 0.75, window.innerHeight - keyboardInset - 6 * VIEWPORT_MARGIN),
                ),
              }),
        }}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'z-[60] flex flex-col border border-edge bg-surface3 p-1.5 shadow-elevated',
          isDesktop ? 'origin-top animate-scale-in rounded-2xl' : 'animate-slide-up rounded-[26px]',
        )}
      >
        <div className="relative p-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                onClose()
              } else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive((i) => Math.min(flat.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const target = flat[active] ?? flat[0]
                if (target) choose(target.id)
              }
            }}
            placeholder="Chercher une catégorie…"
            aria-label="Chercher une catégorie"
            className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-[16px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-soft/70 focus:border-accent/60 focus:ring-4 focus:ring-accent/15 lg:h-9 lg:text-[13.5px]"
          />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-auto overscroll-contain p-1">
          {label !== undefined && !query && (
            <SuggestionsRow
              label={label}
              onPick={(id) => {
                haptic()
                choose(id)
              }}
            />
          )}
          {groups.length === 0 && <p className="px-2.5 py-4 text-[13px] text-soft">Aucune catégorie</p>}
          {groups.map(({ group, cats }) => (
            <div key={group.id} className="pb-1">
              <div className="flex items-center gap-2 px-2 pb-1 pt-2">
                <GroupPill group={group} size="sm" className="h-5 w-5 [&_svg]:h-3 [&_svg]:w-3" />
                <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-soft">
                  {group.name}
                </p>
              </div>
              {cats.map((cat) => {
                index += 1
                const i = index
                const selected = cat.id === value
                return (
                  <button
                    key={cat.id}
                    type="button"
                    data-index={i}
                    onClick={() => choose(cat.id)}
                    onMouseEnter={() => setActive(i)}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[14px] text-ink transition-colors lg:min-h-9 lg:text-[13.5px]',
                      i === active && isDesktop ? 'bg-ink/[0.06]' : 'hover:bg-ink/[0.04]',
                      selected && 'font-semibold',
                    )}
                  >
                    <span
                      className="ml-1 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: `var(--cat-${group.color}-fg)` }}
                    />
                    <span className="min-w-0 flex-1 truncate">{cat.name}</span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-accent-ink dark:text-accent" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="border-t border-edge p-1">
          <button
            type="button"
            onClick={() => choose(null)}
            className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[14px] text-soft transition-colors hover:bg-ink/[0.04] hover:text-ink lg:min-h-9 lg:text-[13.5px]"
          >
            <CircleSlash className="ml-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">Sans catégorie</span>
          </button>
        </div>
      </div>
    </>,
    document.body,
  )
}
