import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { useCategoriesList, useGroupsList } from '@/lib/data'

interface CategoryPickerProps {
  children: ReactNode
  onSelect: (categoryId: string | null) => void
  includeIncome?: boolean
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
 * position absolute a l'interieur serait clippe. Le portail l'en sort. La
 * position est calculee depuis le rect du declencheur, recalee au scroll/resize,
 * et la hauteur max suit le viewport visible (clavier iOS).
 */
export function CategoryPicker({ children, onSelect, includeIncome = false }: CategoryPickerProps) {
  const allCategories = useCategoriesList()
  const allGroups = useGroupsList()
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

  // Ouverture : place le panneau, vide la recherche, focus le champ.
  useEffect(() => {
    if (!open) return
    place()
    setQuery('')
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [open])

  // Recalage au scroll (capture pour attraper les conteneurs internes) et resize.
  useEffect(() => {
    if (!open) return
    const onMove = () => place()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    window.visualViewport?.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      window.visualViewport?.removeEventListener('resize', onMove)
    }
  }, [open])

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
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: PANEL_WIDTH, maxHeight: pos.maxHeight }}
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
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-surface2"
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
                className="flex w-full items-center rounded-lg px-2 py-1.5 text-left text-[13.5px] text-soft transition-colors hover:bg-surface2"
              >
                Sans catégorie
              </button>
            </div>
          </div>,
          document.body,
        )}
    </span>
  )
}
