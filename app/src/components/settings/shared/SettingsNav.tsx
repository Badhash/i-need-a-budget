// Navigation interne de la page Reglages : sections a ancres (defilement JS,
// le hash de l'URL porte la route), menu colle a gauche sur desktop, puces de
// saut rapide collees sous le header sur mobile, section active suivie au
// defilement. Le decalage de chaque section vient de son scroll-margin-top
// (meme valeur pour le saut et pour le suivi).

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SettingsNavItem {
  id: string
  label: string
  icon: LucideIcon
}

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

function marginTop(el: Element): number {
  return parseFloat(getComputedStyle(el).scrollMarginTop) || 0
}

/** Section active au defilement + saut vers une section. */
export function useSettingsNav(items: SettingsNavItem[]): [string, (id: string) => void] {
  const ids = items.map((i) => i.id).join('|')
  const [active, setActive] = useState(items[0]?.id ?? '')
  // Pendant un saut programme, le suivi reste sur la cible (pas de defilement
  // des puces a travers toutes les sections survolees).
  const lockUntil = useRef(0)

  useEffect(() => {
    const list = ids.split('|')
    let frame = 0
    const update = () => {
      frame = 0
      if (Date.now() < lockUntil.current) return
      let current = list[0] ?? ''
      for (const id of list) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top - marginTop(el) <= 2) current = id
      }
      // Bas de page atteint : la derniere section (souvent courte) est active.
      const bottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      if (bottom && window.scrollY > 0) current = list[list.length - 1] ?? current
      setActive(current)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ids])

  const goTo = useCallback((id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const smooth = !prefersReducedMotion()
    lockUntil.current = Date.now() + (smooth ? 900 : 100)
    setActive(id)
    el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
    // Focus deplace sur le titre de la section (lecteurs d'ecran, clavier).
    el.querySelector<HTMLElement>('[data-section-title]')?.focus({ preventScroll: true })
  }, [])

  return [active, goTo]
}

/** Menu colle (desktop) : sections avec icone, section active surlignee. */
export function SettingsSideNav({
  items,
  active,
  onSelect,
  footer,
}: {
  items: SettingsNavItem[]
  active: string
  onSelect: (id: string) => void
  footer?: ReactNode
}) {
  return (
    <nav
      aria-label="Sections des réglages"
      className="sticky top-[calc(4.5rem+1.75rem)] hidden w-52 shrink-0 self-start lg:block xl:w-56"
    >
      <ul className="space-y-0.5">
        {items.map(({ id, label, icon: Icon }) => {
          const current = id === active
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSelect(id)}
                aria-current={current ? 'location' : undefined}
                className={cn(
                  'group flex h-10 w-full items-center gap-3 rounded-xl px-2.5 text-left text-[14px] font-medium transition-[background-color,color,box-shadow] duration-150',
                  current
                    ? 'bg-surface text-ink shadow-card ring-1 ring-inset ring-edge'
                    : 'text-soft hover:bg-ink/[0.04] hover:text-ink',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-150',
                    current ? 'bg-accent/10 text-accent-ink dark:text-accent' : 'text-soft group-hover:text-ink',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                {label}
              </button>
            </li>
          )
        })}
      </ul>
      {footer && <div className="mt-6 border-t border-line/70 px-2.5 pt-4">{footer}</div>}
    </nav>
  )
}

/** Puces de saut rapide (mobile), collees sous le header. */
export function SettingsChips({
  items,
  active,
  onSelect,
}: {
  items: SettingsNavItem[]
  active: string
  onSelect: (id: string) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)

  // La puce active reste visible dans la rangee (defilement horizontal seul).
  useEffect(() => {
    const row = scroller.current
    const chip = row?.querySelector<HTMLElement>(`[data-chip="${active}"]`)
    if (!row || !chip) return
    const left = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2
    row.scrollTo({ left: Math.max(0, left), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [active])

  return (
    <nav
      aria-label="Aller à une section"
      className="glass-bar sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-30 -mx-4 border-b border-edge/70 px-safe lg:hidden"
    >
      <div ref={scroller} className="flex gap-2 overflow-x-auto px-4 py-2 scrollbar-none">
        {items.map(({ id, label, icon: Icon }) => {
          const current = id === active
          return (
            <button
              key={id}
              type="button"
              data-chip={id}
              onClick={() => onSelect(id)}
              aria-current={current ? 'location' : undefined}
              className={cn(
                "relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] font-medium transition-[background-color,color,box-shadow] duration-150 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
                current
                  ? 'bg-accent text-accentfg shadow-button'
                  : 'bg-surface text-soft shadow-card ring-1 ring-inset ring-edge active:bg-surface2',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

/** Section a ancre : medaillon d'icone, titre (cible du focus), description. */
export function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  id: string
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-[calc(7.25rem+env(safe-area-inset-top))] space-y-3 lg:scroll-mt-28"
    >
      <div className="flex items-end justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-accentfg shadow-button"
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} />
          </span>
          <div className="min-w-0">
            <h2
              id={`${id}-title`}
              data-section-title
              tabIndex={-1}
              className="truncate text-[17px] font-semibold leading-tight tracking-tight text-ink outline-none lg:text-[19px]"
            >
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[13px] leading-snug text-soft">{description}</p>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  )
}
