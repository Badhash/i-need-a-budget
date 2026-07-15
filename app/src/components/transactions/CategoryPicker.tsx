import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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

/**
 * Categorisation rapide : le declencheur (children, ex. une pastille) ouvre un
 * popover avec un champ de recherche et la liste des categories groupees. Meme
 * UX que le Combobox (recherche insensible casse/accents, fermeture au clic
 * exterieur / Echap, Entree = premier resultat).
 */
export function CategoryPicker({ children, onSelect, includeIncome = false }: CategoryPickerProps) {
  const allCategories = useCategoriesList()
  const allGroups = useGroupsList()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLSpanElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fermeture au clic hors du popover.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // A l'ouverture : vide la recherche et donne le focus au champ.
  useEffect(() => {
    if (open) {
      setQuery('')
      requestAnimationFrame(() => inputRef.current?.focus())
    }
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
    <span ref={containerRef} className="relative inline-flex max-w-full">
      {/* Le declencheur reel (une pastille bouton) reste children ; ce wrapper
          ne sert qu'a ancrer le popover et a basculer l'ouverture. */}
      <span onClick={() => setOpen((o) => !o)} className="inline-flex max-w-full">
        {children}
      </span>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface p-1 shadow-card">
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
          <div className="max-h-64 overflow-auto p-1">
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
        </div>
      )}
    </span>
  )
}
