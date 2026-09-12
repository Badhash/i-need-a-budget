import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { useCategoriesList, useCategoriesMap, useGroupsList, useGroupsMap } from '@/lib/data'
import { useCategorySuggestions, type SuggestionReason } from '@/lib/categorize'
import { haptic } from '@/lib/haptics'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useKeyboardInset } from '@/hooks/useKeyboardInset'
import { GroupPill } from '@/components/shared/GroupPill'

interface CategoryPickerProps {
  children: ReactNode
  onSelect: (categoryId: string | null) => void
  includeIncome?: boolean
  /** Libelle de la transaction : active la ligne « Suggestions » (tiers
   * memorise, categories recentes/frequentes). Sans libelle, pas de ligne. */
  label?: string
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
    <div className="px-1 pb-1">
      <p className="px-1 py-1 text-[11px] font-semibold uppercase tracking-wide text-soft">Suggestions</p>
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
              className="inline-flex min-h-[36px] max-w-full items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-[12.5px] font-medium transition-opacity hover:opacity-80 lg:min-h-0"
              style={{
                backgroundColor: group ? `var(--cat-${group.color}-bg)` : undefined,
                color: group ? `var(--cat-${group.color}-fg)` : undefined,
              }}
            >
              <GroupPill group={group} size="sm" className="bg-surface/60" />
              <span className="truncate">{cat.name}</span>
              <span className="text-[10px] font-normal opacity-70">{REASON_HINT[s.reason]}</span>
            </button>
          )
        })}
      </div>
      <div className="mt-1 border-t border-line/60" />
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

const PANEL_WIDTH = 256 // px
const VIEWPORT_MARGIN = 12 // px

/**
 * Categorisation rapide : le declencheur (children, ex. une pastille) ouvre un
 * popover avec un champ de recherche et la liste des categories groupees.
 *
 * Le panneau est rendu dans un PORTAIL (document.body) en position fixed : les
 * cartes de transaction ont overflow-hidden (coins arrondis), un popover en
 * position absolute a l'interieur serait clippe. Le portail l'en sort.
 *
 * DESKTOP : popover ancre sous le declencheur, recale au scroll/resize.
 * MOBILE : feuille posee EN BAS, au-dessus du clavier (comme AssignSheet). On
 * n'ancre PAS au declencheur : quand le champ de recherche prend le focus, iOS
 * scrolle la page pour reveler l'input et la transaction remonte — un popover
 * ancre suivrait ce scroll et se retrouverait detache tout en haut (bug). La
 * feuille basse, calee sur le clavier via useKeyboardInset, reste stable.
 */
export function CategoryPicker({ children, onSelect, includeIncome = false, label }: CategoryPickerProps) {
  const allCategories = useCategoriesList()
  const allGroups = useGroupsList()
  const isDesktop = useIsDesktop()
  const keyboardInset = useKeyboardInset()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Calcule la position du panneau sous le declencheur, borne dans le viewport.
  function place() {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let left = r.left
    if (left + PANEL_WIDTH > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - VIEWPORT_MARGIN - PANEL_WIDTH
    }
    if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN
    const top = r.bottom + 4
    const vpHeight = window.visualViewport?.height ?? window.innerHeight
    const maxHeight = Math.max(160, vpHeight - top - VIEWPORT_MARGIN)
    setPos({ top, left, maxHeight })
  }

  // Ouverture : place le panneau (desktop uniquement), vide la recherche, focus.
  useEffect(() => {
    if (!open) return
    if (isDesktop) place()
    setQuery('')
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open, isDesktop])

  // Recalage au scroll/resize : DESKTOP uniquement (le popover ancre suit le
  // declencheur). Sur mobile la feuille est calee sur le clavier, pas au scroll.
  useEffect(() => {
    if (!open || !isDesktop) return
    const onMove = () => place()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    window.visualViewport?.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      window.visualViewport?.removeEventListener('resize', onMove)
    }
  }, [open, isDesktop])

  // Fermeture au clic hors du declencheur ET du panneau.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const groups = useMemo(() => {
    const q = norm(query)
    return allGroups
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((group) => ({
        group,
        cats: allCategories
          .filter(
            (c) =>
              c.groupId === group.id &&
              (includeIncome || !c.isIncome) &&
              (!q || norm(c.name).includes(q)),
          )
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .filter((x) => x.cats.length > 0)
  }, [allGroups, allCategories, includeIncome, query])

  const flat = useMemo(() => groups.flatMap((g) => g.cats), [groups])

  function choose(id: string | null) {
    onSelect(id)
    setOpen(false)
    setQuery('')
  }

  return (
    <span ref={triggerRef} className="inline-flex max-w-full">
      {/* Le declencheur reel (une pastille bouton) reste children ; ce wrapper
          ne sert qu'a ancrer le popover et a basculer l'ouverture. */}
      <span onClick={() => setOpen((o) => !o)} className="inline-flex max-w-full">
        {children}
      </span>
      {open &&
        (isDesktop ? pos !== null : true) &&
        createPortal(
          <>
            {/* Mobile : fond transparent cliquable pour fermer (le mousedown ne
                se declenche pas de facon fiable au toucher hors du panneau). */}
            {!isDesktop && (
              <div
                data-inab-popover=""
                className="fixed inset-0 z-[59]"
                style={{ pointerEvents: 'auto' }}
                onClick={() => setOpen(false)}
                aria-hidden
              />
            )}
          <div
            ref={panelRef}
            data-inab-popover=""
            style={{
              // pointerEvents force : dans un Dialog Radix modal, body passe en
              // pointer-events:none et un panneau portalise serait inerte.
              pointerEvents: 'auto',
              ...(isDesktop
                ? { position: 'fixed' as const, top: pos!.top, left: pos!.left, width: PANEL_WIDTH, maxHeight: pos!.maxHeight }
                : {
                    position: 'fixed' as const,
                    left: VIEWPORT_MARGIN,
                    right: VIEWPORT_MARGIN,
                    bottom: keyboardInset + VIEWPORT_MARGIN,
                    maxHeight: Math.max(200, window.innerHeight - keyboardInset - 2 * VIEWPORT_MARGIN),
                  }),
            }}
            className="z-[60] flex flex-col rounded-xl border border-line bg-surface p-1 shadow-card"
          >
            <div className="relative p-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false)
                  else if (e.key === 'Enter') {
                    e.preventDefault()
                    if (flat[0]) choose(flat[0].id)
                  }
                }}
                placeholder="Chercher une catégorie…"
                aria-label="Chercher une catégorie"
                className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-2 text-[16px] outline-none transition-colors focus:border-accent/60 lg:text-[13.5px]"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1">
              {label !== undefined && !query && (
                <SuggestionsRow
                  label={label}
                  onPick={(id) => {
                    haptic()
                    choose(id)
                  }}
                />
              )}
              {groups.length === 0 && (
                <p className="px-2 py-3 text-[13px] text-soft">Aucune catégorie</p>
              )}
              {groups.map(({ group, cats }, i) => (
                <div key={group.id}>
                  {i > 0 && <div className="my-1 border-t border-line/60" />}
                  <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-soft">
                    {group.name}
                  </p>
                  {cats.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => choose(cat.id)}
                      className="flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-surface2 lg:min-h-0"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: `var(--cat-${group.color}-fg)` }}
                      />
                      <span className="truncate">{cat.name}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="border-t border-line/60 p-1">
              <button
                type="button"
                onClick={() => choose(null)}
                className="flex min-h-[44px] w-full items-center rounded-lg px-2 py-1.5 text-left text-[13.5px] text-soft transition-colors hover:bg-surface2 lg:min-h-0"
              >
                Sans catégorie
              </button>
            </div>
          </div>
          </>,
          document.body,
        )}
    </span>
  )
}
