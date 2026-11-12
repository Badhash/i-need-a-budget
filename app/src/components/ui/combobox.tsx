import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { fieldClasses } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface ComboboxOption {
  value: string
  label: string
  /** En-tete de groupe (comme optgroup) ; les options d'un meme groupe sont regroupees. */
  group?: string
  /** Nom d'une variable CSS pour une pastille ronde optionnelle (ex. 'cat-blue-fg'). */
  colorVar?: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

/** Enleve les accents pour un filtrage insensible casse/accents. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Pastille ronde coloree (variable CSS) affichee avant un label d'option. */
function Dot({ colorVar }: { colorVar: string }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: `var(--${colorVar})` }}
    />
  )
}

/**
 * Combobox single-select avec recherche, generique (imite BankCombobox), au
 * motif ARIA « combobox + listbox » : le focus reste dans le champ, l'option
 * active est annoncee par aria-activedescendant. Affiche le label de l'option
 * selectionnee quand ferme, filtre a l'ouverture, regroupe par `group` si
 * present. La liste s'ouvre au clic, a la frappe ou aux fleches (pas au
 * simple focus : ouverture d'une feuille, retour sur l'onglet).
 * Clavier : fleches haut/bas pour parcourir les options (l'option active
 * reste visible), Entree choisit l'option active apres une recherche ou une
 * navigation aux fleches (sinon elle laisse le formulaire se valider), Echap
 * ferme la liste sans fermer la feuille parente.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = 'Sélectionner…',
  searchPlaceholder = 'Rechercher…',
  className,
  disabled,
  'aria-label': ariaLabel,
}: ComboboxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  // Option active (surlignee, cible d'Entree) : index dans l'ordre affiche, -1 = aucune.
  const [active, setActive] = useState(-1)
  // Vrai des que l'utilisateur a deplace l'option active aux fleches.
  const [navigated, setNavigated] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (index: number) => `${baseId}-option-${index}`

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? '',
    [options, value],
  )

  const filtered = useMemo(() => {
    const q = normalize(query.trim())
    return q ? options.filter((o) => normalize(o.label).includes(q)) : options
  }, [options, query])

  // Regroupe en preservant l'ordre d'apparition des groupes ; `flat` suit
  // l'ordre AFFICHE (celui des fleches et d'Entree).
  const { grouped, flat } = useMemo(() => {
    const order: string[] = []
    const byGroup = new Map<string, ComboboxOption[]>()
    for (const o of filtered) {
      const key = o.group ?? ''
      if (!byGroup.has(key)) {
        byGroup.set(key, [])
        order.push(key)
      }
      byGroup.get(key)!.push(o)
    }
    let index = 0
    const grouped = order.map((key) => ({
      group: key,
      items: byGroup.get(key)!.map((option) => ({ option, index: index++ })),
    }))
    return { grouped, flat: grouped.flatMap((g) => g.items.map((i) => i.option)) }
  }, [filtered])

  // Liste modifiee pendant l'ouverture (options rechargees) : index hors bornes ignore.
  const activeIndex = active < flat.length ? active : -1
  const selectedIndex = flat.findIndex((o) => o.value === value)

  const openList = () => {
    setOpen(true)
    setQuery('')
    setActive(-1)
    setNavigated(false)
  }

  // Toute fermeture vide la recherche : liste fermee, `flat` est la liste complete.
  const closeList = () => {
    setOpen(false)
    setQuery('')
    setActive(-1)
    setNavigated(false)
  }

  const commit = (v: string) => {
    onChange(v)
    closeList()
    if (blurTimer.current) clearTimeout(blurTimer.current)
  }

  // Fleches (ouvrent la liste fermee) : la premiere pression part de l'option
  // choisie, sinon d'un bord ; pas de bouclage.
  const move = (delta: 1 | -1) => {
    const last = flat.length - 1
    if (last < 0) return
    const from = open ? activeIndex : -1
    const next =
      from >= 0 ? Math.min(last, Math.max(0, from + delta)) : selectedIndex >= 0 ? selectedIndex : delta > 0 ? 0 : last
    setOpen(true)
    setActive(next)
    setNavigated(true)
  }

  // Option active (ou choisie, a l'ouverture) gardee visible dans la liste,
  // sans faire defiler la page ni la feuille.
  useEffect(() => {
    if (!open) return
    const index = activeIndex >= 0 ? activeIndex : selectedIndex
    const list = listRef.current
    const el = index >= 0 ? document.getElementById(`${baseId}-option-${index}`) : null
    if (!list || !el) return
    const pad = 6
    if (el.offsetTop < list.scrollTop + pad) list.scrollTop = Math.max(0, el.offsetTop - pad)
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight - pad)
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + pad
  }, [open, activeIndex, selectedIndex, grouped, baseId])

  // Echap, liste ouverte : Radix (Dialog) ecoute la touche en capture sur le
  // document et fermait toute la feuille parente avant nos gestionnaires. La
  // capture sur window passe avant lui ; preventDefault lui signale que la
  // touche est prise (la liste se ferme dans onKeyDown).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && rootRef.current?.contains(e.target as Node)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current)
    },
    [],
  )

  return (
    <div ref={rootRef} className={cn('relative min-w-[160px]', className)}>
      <div className="group relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft transition-colors group-focus-within:text-accent" />
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          value={open ? query : selectedLabel}
          onFocus={() => {
            if (blurTimer.current) clearTimeout(blurTimer.current)
          }}
          onClick={() => {
            // Au clic, y compris apres un choix ou Echap (le champ a deja le
            // focus : onFocus ne se redeclenche pas).
            if (!open) openList()
          }}
          onChange={(e) => {
            // Liste fermee (apres Echap) : le champ affiche le libelle choisi et
            // la frappe s'y ajoutait (« Loyerr », aucun resultat). On ne garde
            // que ce qui vient d'etre tape.
            const typed = e.target.value
            const next = !open && typed.startsWith(selectedLabel) ? typed.slice(selectedLabel.length) : typed
            setQuery(next)
            setOpen(true)
            // Recherche saisie : la premiere option est active (cible d'Entree).
            setActive(next.trim() ? 0 : -1)
            setNavigated(false)
          }}
          onBlur={() => {
            // Delai : un clic sur une option se termine avant la fermeture. Le
            // focus ne peut pas entrer dans la liste (options non focusables,
            // appui sans prise de focus) ; on verifie tout de meme qu'il a
            // bien quitte le composant.
            blurTimer.current = setTimeout(() => {
              if (!rootRef.current?.contains(document.activeElement)) closeList()
            }, 120)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              move(e.key === 'ArrowDown' ? 1 : -1)
            } else if (e.key === 'Enter') {
              // Sans recherche saisie ni navigation aux fleches, Entree ne
              // choisit rien et laisse le formulaire se valider : elle prenait
              // la premiere option, donc « À catégoriser » ou le premier compte
              // a la place du choix fait.
              const target = flat[activeIndex]
              if (open && target && (query.trim() || navigated)) {
                e.preventDefault()
                commit(target.value)
              } else {
                closeList()
              }
            } else if (e.key === 'Escape') {
              closeList()
            }
          }}
          disabled={disabled}
          placeholder={open ? searchPlaceholder : placeholder}
          aria-label={ariaLabel}
          autoComplete="off"
          className={cn('pl-9 pr-9', fieldClasses)}
        />
        <ChevronDown
          className={cn(
            'pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-soft transition-transform duration-200 ease-spring',
            open && 'rotate-180',
          )}
        />
      </div>

      {open && flat.length > 0 && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          // Aucun appui dans la liste (option, en-tete, barre de defilement) ne
          // prend le focus au champ : il fermait la liste.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-50 mt-1.5 max-h-72 w-full origin-top animate-scale-in overflow-auto rounded-2xl border border-edge bg-surface3 p-1.5 shadow-elevated"
        >
          {grouped.map(({ group, items }) => (
            <li
              key={group || '__nogroup__'}
              role={group ? 'group' : 'presentation'}
              aria-labelledby={group ? `${listId}-group-${items[0]!.index}` : undefined}
            >
              {group && (
                <p
                  id={`${listId}-group-${items[0]!.index}`}
                  className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-soft"
                >
                  {group}
                </p>
              )}
              <ul role="presentation">
                {items.map(({ option: o, index }) => {
                  const selected = o.value === value
                  const isActive = index === activeIndex
                  return (
                    <li
                      key={o.value}
                      id={optionId(index)}
                      role="option"
                      aria-selected={selected}
                      onClick={() => commit(o.value)}
                      className={cn(
                        'flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[14px] transition-colors hover:bg-surface2 lg:min-h-9 lg:text-[13.5px]',
                        isActive && 'bg-surface2 ring-1 ring-inset ring-accent/30',
                        selected && 'bg-accent/10 font-medium text-accent-ink hover:bg-accent/15',
                        selected && isActive && 'bg-accent/15',
                      )}
                    >
                      {o.colorVar && <Dot colorVar={o.colorVar} />}
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {selected && <Check className="h-4 w-4 shrink-0" />}
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {open && flat.length === 0 && (
        <div className="absolute z-50 mt-1.5 w-full origin-top animate-scale-in rounded-2xl border border-edge bg-surface3 p-3.5 text-[13px] text-soft shadow-elevated">
          Aucun résultat.
        </div>
      )}
    </div>
  )
}
