import { useLayoutEffect, useRef, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { NAV_ITEMS, RULES_ITEM, SETTINGS_ITEM } from '@/components/layout/nav'
import { BrandMark } from '@/components/layout/BrandMark'
import { useBudgetMonth } from '@/lib/queries'
import { useBootstrap } from '@/lib/data'
import { useUiStore } from '@/stores/ui'
import { Amount } from '@/components/shared/Amount'
import { Aura } from '@/components/shared/Aura'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

function NavLink({ to, label, icon: Icon, badge }: { to: string; label: string; icon: LucideIcon; badge?: number }) {
  return (
    <Link
      to={to}
      className="group relative z-10 flex h-11 items-center gap-3 rounded-xl px-3 text-[14px] font-medium text-soft transition-colors duration-150 hover:text-ink data-[status=active]:text-accent-ink [&:not([data-status=active])]:hover:bg-ink/[0.04]"
    >
      <Icon className="h-[18px] w-[18px] transition-transform duration-200 ease-spring group-hover:scale-105" />
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span
          key={badge}
          className="animate-pop rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning ring-1 ring-inset ring-warning/20 tnum"
        >
          {badge}
        </span>
      )}
    </Link>
  )
}

/**
 * Indicateur actif glissant : mesure le lien actif (data-status="active" pose
 * par le routeur) et deplace une pastille sous lui. Pas d'animation a la
 * premiere mesure (pas de glissement depuis le haut au chargement).
 */
function useActiveIndicator(pathname: string) {
  const navRef = useRef<HTMLElement>(null)
  const [box, setBox] = useState<{ top: number; height: number; visible: boolean; animate: boolean }>({
    top: 0,
    height: 44,
    visible: false,
    animate: false,
  })

  useLayoutEffect(() => {
    const measure = () => {
      const active = navRef.current?.querySelector<HTMLElement>('[data-status="active"]')
      setBox((prev) =>
        active
          ? { top: active.offsetTop, height: active.offsetHeight, visible: true, animate: prev.visible }
          : { ...prev, visible: false, animate: prev.visible },
      )
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [pathname])

  return { navRef, box }
}

export function Sidebar() {
  const month = useUiStore((s) => s.month)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const boot = useBootstrap()
  const { data: budget, isError: budgetError } = useBudgetMonth(month)
  // Compteur « À catégoriser » deja calcule serveur et porte par le cache
  // bootstrap : on ne charge PLUS toute la liste des transactions dans la nav
  // (elle restait active en permanence et se rechargeait a chaque mutation).
  const badge = boot.data?.uncategorizedCount ?? 0
  // Une erreur du bootstrap desactive la query budget : on la surveille aussi
  // pour ne pas rester bloque en skeleton dans la nav.
  const hasBudgetError = budgetError || boot.isError
  const { navRef, box } = useActiveIndicator(pathname)
  const negative = budget !== undefined && budget.rta < 0

  return (
    <aside className="glass-bar fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-edge px-3 pb-5 pt-6 lg:flex">
      <div className="mb-8 flex items-center gap-3 px-3">
        <BrandMark />
        <div className="leading-tight">
          <p className="text-[15px] font-semibold tracking-tight text-ink">I Need A Budget</p>
          <p className="text-[12px] text-soft">Budget par enveloppes</p>
        </div>
      </div>

      <nav ref={navRef} aria-label="Navigation principale" className="relative flex flex-col gap-1">
        <span
          aria-hidden
          className={cn(
            'absolute inset-x-0 top-0 rounded-xl bg-accent/10 ring-1 ring-inset ring-accent/15',
            box.animate && 'transition-[transform,height,opacity] duration-280 ease-spring',
          )}
          style={{
            transform: `translateY(${box.top}px)`,
            height: box.height,
            opacity: box.visible ? 1 : 0,
          }}
        />
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.to} {...item} badge={item.to === '/transactions' ? badge : undefined} />
        ))}
        <div aria-hidden className="mx-3 my-2 h-px bg-line/70" />
        <NavLink {...RULES_ITEM} />
        <NavLink {...SETTINGS_ITEM} />
      </nav>

      <Link
        to="/budget"
        className="group relative isolate mt-auto block overflow-hidden rounded-2xl border border-edge bg-surface p-4 shadow-card transition-[transform,box-shadow] duration-200 ease-spring hover:-translate-y-0.5 hover:shadow-raised active:scale-[0.99]"
      >
        <Aura tone={negative ? 'danger' : 'success'} intensity="soft" />
        <div className="flex items-center justify-between gap-2">
          <p className="label-caps">Prêt à assigner</p>
          <ChevronRight className="h-4 w-4 text-soft transition-transform duration-200 ease-spring group-hover:translate-x-0.5" />
        </div>
        {budget ? (
          <Amount
            cents={budget.rta}
            animate
            className={cn(
              'mt-1.5 block text-[24px] font-semibold leading-tight tracking-[-0.015em]',
              budget.rta >= 0 ? 'text-success' : 'text-danger',
            )}
          />
        ) : hasBudgetError ? (
          <span className="mt-1.5 block text-[24px] font-semibold text-soft" aria-hidden="true">
            —
          </span>
        ) : (
          <Skeleton className="mt-2 h-7 w-28" />
        )}
        <p className="mt-1 text-[12px] leading-snug text-soft">
          {budget && budget.rta < 0
            ? 'Vous avez assigné plus que vos revenus.'
            : 'Donnez un rôle à chaque euro.'}
        </p>
      </Link>
    </aside>
  )
}
