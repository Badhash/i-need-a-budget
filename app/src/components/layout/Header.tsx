import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Settings,
  Sun,
} from 'lucide-react'
import { PAGE_TITLES } from '@/components/layout/nav'
import { BrandMark } from '@/components/layout/BrandMark'
import { FreshnessIndicator } from '@/components/layout/FreshnessIndicator'
import { THEMES, type Mode } from '@/styles/themes'
import { resolveDark, useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { addMonths, currentMonth, fmtEUR, fmtMonthTitle, maxMonth, MIN_MONTH } from '@/lib/format'
import { useBootstrap, useBudgetMonth } from '@/lib/data'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// Bouton rond du chrome (44px mobile, 40px desktop).
const CHROME_BUTTON =
  'inline-flex h-11 w-11 items-center justify-center rounded-full text-soft transition-[background-color,color,transform] duration-150 ease-spring hover:bg-ink/[0.06] hover:text-ink active:scale-90 lg:h-10 lg:w-10'

function MonthSelector() {
  const month = useUiStore((s) => s.month)
  const shiftMonth = useUiStore((s) => s.shiftMonth)
  const resetMonth = useUiStore((s) => s.resetMonth)
  // Rien n'existe avant le mois de depart du budget (« Nouveau budget »).
  const startMonth = useBootstrap().data?.budgetStartMonth ?? null
  const minMonth = startMonth && startMonth > MIN_MONTH ? startMonth : MIN_MONTH
  const isCurrent = month === currentMonth()

  const arrow =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-soft transition-[background-color,color,transform] duration-150 ease-spring hover:bg-ink/[0.06] hover:text-ink active:scale-90 disabled:pointer-events-none disabled:opacity-30'

  return (
    <div className="flex items-center rounded-full border border-edge bg-surface/80 p-0.5 shadow-card dark:bg-surface2/60">
      <button
        type="button"
        className={arrow}
        onClick={() => shiftMonth(-1)}
        disabled={addMonths(month, -1) < minMonth}
        aria-label="Mois précédent"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2.4} />
      </button>
      <button
        type="button"
        onClick={resetMonth}
        className="relative min-w-[112px] rounded-full px-1.5 py-1.5 text-center text-[14px] font-semibold tracking-tight text-ink transition-colors hover:bg-ink/[0.04] lg:min-w-[128px]"
        title="Revenir au mois courant"
      >
        <span key={month} className="inline-block animate-fade-in tnum">
          {fmtMonthTitle(month)}
        </span>
        {/* Point discret : on regarde un autre mois que le mois courant. */}
        {!isCurrent && (
          <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
        )}
      </button>
      <button
        type="button"
        className={arrow}
        onClick={() => shiftMonth(1)}
        disabled={addMonths(month, 1) > maxMonth()}
        aria-label="Mois suivant"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={2.4} />
      </button>
    </div>
  )
}

function ThemeSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="h-4 w-4 shrink-0 rounded-full shadow-highlight ring-1 ring-inset ring-ink/10"
      style={{ backgroundColor: color }}
    />
  )
}

function ThemeMenu() {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={CHROME_BUTTON} aria-label="Choisir le thème">
          <Palette className="h-[18px] w-[18px]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Thème</DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => setTheme(t.id)}>
            <ThemeSwatch color={t.preview.accent} />
            <span className="flex-1">{t.label}</span>
            {theme === t.id && <Check className="h-4 w-4 text-accent" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ModeToggle() {
  const mode = useUiStore((s) => s.mode)
  const setMode = useUiStore((s) => s.setMode)
  const dark = resolveDark(mode)

  return (
    <button
      type="button"
      className={CHROME_BUTTON}
      aria-label={dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
      onClick={() => setMode(dark ? 'light' : 'dark')}
    >
      {/* L'icone pivote en entrant a chaque bascule. */}
      <span key={dark ? 'sun' : 'moon'} className="animate-scale-in">
        {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
      </span>
    </button>
  )
}

function Avatar({ initial }: { initial: string }) {
  return (
    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-[12px] font-semibold text-accentfg shadow-button">
      {initial}
    </span>
  )
}

function useAccountEmail(): { email: string; initial: string } {
  const session = useAuthStore((s) => s.session)
  const email = session?.user.email ?? ''
  return { email, initial: email ? email[0]!.toUpperCase() : '?' }
}

function UserMenu() {
  const { email, initial } = useAccountEmail()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={CHROME_BUTTON} aria-label="Compte">
          <Avatar initial={initial} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="max-w-[240px] truncate normal-case tracking-normal text-[12.5px] font-normal text-soft">
          {email || 'Compte'}
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void supabase.auth.signOut()}>
          <LogOut className="h-4 w-4" />
          <span className="flex-1">Se déconnecter</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const MODES: { id: Mode; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'Clair', icon: Sun },
  { id: 'dark', label: 'Sombre', icon: Moon },
  { id: 'system', label: 'Système', icon: Monitor },
]

/**
 * Menu compte MOBILE : la place manque dans le header, il regroupe le choix du
 * theme, le mode clair/sombre et la deconnexion (le desktop garde des boutons
 * separes). Meme comportement que ThemeMenu / ModeToggle / UserMenu.
 */
function MobileAccountMenu() {
  const { email, initial } = useAccountEmail()
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const mode = useUiStore((s) => s.mode)
  const setMode = useUiStore((s) => s.setMode)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={CHROME_BUTTON} aria-label="Compte et apparence">
          <Avatar initial={initial} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="truncate normal-case tracking-normal text-[12.5px] font-normal text-soft">
          {email || 'Compte'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Thème</DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => setTheme(t.id)}>
            <ThemeSwatch color={t.preview.accent} />
            <span className="flex-1">{t.label}</span>
            {theme === t.id && <Check className="h-4 w-4 text-accent" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Apparence</DropdownMenuLabel>
        {/* Selecteur segmente clair / sombre / systeme (reste ouvert au choix). */}
        <div className="grid grid-cols-3 gap-1 p-1">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={mode === id}
              className={cn(
                'flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl text-[11.5px] font-medium transition-colors',
                mode === id ? 'bg-accent/10 text-accent-ink' : 'text-soft hover:bg-ink/[0.05] hover:text-ink',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void supabase.auth.signOut()}>
          <LogOut className="h-4 w-4" />
          <span className="flex-1">Se déconnecter</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Resume compact du budget dans le header (DESKTOP uniquement, route /budget) :
 * remplace le gros RtaBanner masque en lg. Met en avant le Pret a assigner
 * (corail/rouge si negatif, vert sinon) et rappelle Assigne / Depense / Disponible
 * du mois. Reutilise la meme query useBudgetMonth(month) que la page Budget.
 */
function HeaderBudgetSummary() {
  const month = useUiStore((s) => s.month)
  const { data: budget } = useBudgetMonth(month)
  if (!budget) return null
  const negative = budget.rta < 0

  return (
    <div className="hidden items-center gap-5 lg:flex">
      <div
        className={cn(
          'flex items-center gap-2.5 rounded-full py-1.5 pl-3.5 pr-4 ring-1 ring-inset',
          negative ? 'bg-danger/10 ring-danger/20' : 'bg-success/10 ring-success/20',
        )}
        title={negative ? 'Vous avez assigné plus que vos revenus disponibles.' : undefined}
      >
        <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-soft">Prêt à assigner</span>
        <span
          className={cn(
            'text-[15px] font-semibold tnum leading-none',
            negative ? 'text-danger' : 'text-success',
          )}
        >
          {fmtEUR(budget.rta)}
        </span>
      </div>
      <dl className="hidden items-center gap-5 xl:flex">
        <div className="flex flex-col leading-tight">
          <dt className="label-caps text-[11px]">Assigné</dt>
          <dd className="tnum text-[13.5px] font-medium text-ink">{fmtEUR(budget.totals.assigned)}</dd>
        </div>
        <div className="flex flex-col leading-tight">
          <dt className="label-caps text-[11px]">Dépensé</dt>
          <dd className="tnum text-[13.5px] font-medium text-ink">{fmtEUR(-budget.totals.activity)}</dd>
        </div>
        <div className="flex flex-col leading-tight">
          <dt className="label-caps text-[11px]">Disponible</dt>
          <dd className="tnum text-[13.5px] font-medium text-ink">{fmtEUR(budget.totals.available)}</dd>
        </div>
      </dl>
    </div>
  )
}

/**
 * Vrai des que la page defile : le header se fond dans la page tout en haut
 * (pas de filet) et se detache (filet + ombre douce) quand le contenu passe
 * dessous, comme les barres iOS. Ecoute passive, un calcul par frame au plus.
 */
function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      setScrolled(window.scrollY > threshold)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [threshold])
  return scrolled
}

// Le selecteur de mois ne s'affiche que la ou il agit : Budget et Rapports.
// Sur Transactions (liste complete paginee), Comptes et Reglages il ne pilote
// rien, on le masque.
const MONTH_PAGES = new Set(['/budget', '/rapports'])
// Pages qui affichent deja leur propre titre sur mobile (pas de doublon).
const OWN_MOBILE_TITLE = new Set(['/trier'])

export function Header() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const title = PAGE_TITLES[pathname] ?? 'Budget'
  const showMonth = MONTH_PAGES.has(pathname)
  const isBudget = pathname === '/budget'
  const showMobileTitle = !showMonth && !OWN_MOBILE_TITLE.has(pathname)
  const scrolled = useScrolled()

  return (
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        'glass-bar pt-safe px-safe sticky top-0 z-40 border-b transition-[border-color,box-shadow] duration-200',
        scrolled ? 'border-edge shadow-bar' : 'border-transparent',
      )}
    >
      <div className="mx-auto flex h-14 max-w-content items-center gap-2 px-3 sm:px-4 lg:h-[4.5rem] lg:gap-5 lg:px-8">
        {/* Mobile : marque (+ titre de la page quand il n'y a pas de mois). */}
        <div className={cn('flex min-w-0 items-center gap-2.5 lg:hidden', !showMonth && 'flex-1')}>
          <BrandMark size="sm" />
          {showMobileTitle && (
            <span className="truncate text-[17px] font-semibold tracking-tight text-ink">{title}</span>
          )}
        </div>

        {/* Desktop : titre de page affirme. */}
        <h1 className="hidden shrink-0 text-[24px] font-semibold tracking-[-0.02em] text-ink lg:block">{title}</h1>
        {isBudget && <HeaderBudgetSummary />}

        {showMonth && (
          <div className="flex min-w-0 flex-1 items-center justify-center lg:justify-end">
            <MonthSelector />
          </div>
        )}
        {!showMonth && <div className="hidden flex-1 lg:block" />}

        <div className="flex shrink-0 items-center gap-0.5 lg:gap-1">
          <FreshnessIndicator />
          {/* Desktop : boutons separes (theme, mode, compte). */}
          <div className="hidden items-center gap-1 lg:flex">
            <ThemeMenu />
            <ModeToggle />
            <UserMenu />
          </div>
          {/* Mobile : un menu compte + apparence, et le raccourci Reglages. */}
          <div className="flex items-center lg:hidden">
            <MobileAccountMenu />
            <Link to="/reglages" aria-label="Réglages" className={CHROME_BUTTON}>
              <Settings className="h-[19px] w-[19px]" />
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
