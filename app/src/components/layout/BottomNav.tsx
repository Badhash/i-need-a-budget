import { Link, useRouterState } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { NAV_ITEMS } from '@/components/layout/nav'
import { useBootstrap } from '@/lib/data'
import { useUiStore } from '@/stores/ui'

// Barre de navigation flottante facon iOS : pilule de verre depoli posee
// au-dessus de l'indicateur home (safe-area), pastille active qui glisse d'un
// onglet a l'autre. Les gouttieres laterales laissent passer les taps
// (pointer-events-none sur le conteneur, auto sur la barre).
export function BottomNav() {
  // Compteur porte par le cache bootstrap (calcule serveur) : la nav ne charge
  // plus toute la liste des transactions (cf. Sidebar).
  const badge = useBootstrap().data?.uncategorizedCount ?? 0
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const activeIndex = NAV_ITEMS.findIndex((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] lg:hidden">
      <nav
        aria-label="Navigation principale"
        className="glass pointer-events-auto relative flex w-full max-w-md items-stretch rounded-[28px] border border-edge p-1.5 shadow-elevated"
      >
        {/* Pastille active : une largeur d'onglet, translatee d'un onglet par pas. */}
        <span
          aria-hidden
          className="absolute bottom-1.5 left-1.5 top-1.5 rounded-[22px] bg-accent/10 ring-1 ring-inset ring-accent/15 transition-[transform,opacity] duration-280 ease-spring"
          style={{
            width: `calc((100% - 12px) / ${NAV_ITEMS.length})`,
            transform: `translateX(${Math.max(activeIndex, 0) * 100}%)`,
            opacity: activeIndex >= 0 ? 1 : 0,
          }}
        />
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="group relative z-10 flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 rounded-[22px] text-soft transition-[color,transform] duration-200 ease-spring active:scale-95 data-[status=active]:text-accent-ink"
          >
            <span className="relative">
              <Icon
                className="h-[22px] w-[22px] transition-transform duration-280 ease-spring group-data-[status=active]:-translate-y-px group-data-[status=active]:scale-110"
                strokeWidth={2.1}
              />
              {to === '/transactions' && badge > 0 && (
                <span
                  key={badge}
                  className="absolute -right-3 -top-2 flex h-[18px] min-w-[18px] animate-pop items-center justify-center rounded-full bg-warning px-1 text-[10.5px] font-bold leading-none text-white ring-2 ring-surface dark:text-bg tnum"
                >
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </span>
            <span className="text-[10.5px] font-semibold leading-none tracking-wide">{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}

// Decalage et hauteur (6,5rem, h-14) repris par le Toaster, qui pose sa pile
// juste au-dessus : les modifier ensemble.
export function Fab() {
  const setAddTxOpen = useUiStore((s) => s.setAddTxOpen)
  return (
    <button
      type="button"
      onClick={() => setAddTxOpen(true)}
      aria-label="Ajouter une transaction"
      className="fixed bottom-[calc(6.5rem+env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-accentfg shadow-fab ring-1 ring-inset ring-accentfg/15 transition-transform duration-200 ease-spring active:scale-90 lg:hidden"
    >
      <Plus className="h-6 w-6" strokeWidth={2.4} />
    </button>
  )
}
