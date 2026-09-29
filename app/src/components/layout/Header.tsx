import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Monitor,
  Moon,
  Settings,
  Sun,
  TriangleAlert,
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
import { overspendingOf } from '@/lib/budget'
import { Amount } from '@/components/shared/Amount'
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

  // Fleches de 36px a l'oeil, zone de toucher etendue a 44px (pseudo-element,
  // sans changer la mise en page) ; au-dessus du libelle voisin (z-10) pour
  // garder la bande qu'ils partagent.
  const arrow =
    "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-soft transition-[background-color,color,transform] duration-150 ease-spring after:absolute after:-inset-1 after:content-[''] hover:bg-ink/[0.06] hover:text-ink active:scale-90 disabled:pointer-events-none disabled:opacity-30"

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
        className="relative min-w-[112px] whitespace-nowrap rounded-full px-1.5 py-1.5 text-center text-[14px] font-semibold tracking-tight text-ink transition-colors after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] hover:bg-ink/[0.04] lg:min-w-[128px]"
        title="Revenir au mois courant"
      >
        <span key={month} className="inline-block animate-fade-in whitespace-nowrap tnum">
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

/**
 * Menu compte DESKTOP : e-mail, choix du theme et deconnexion. Le theme y a
 * rejoint le compte (comme sur mobile) pour laisser sa place a l'indicateur
 * de fraicheur ; le mode clair/sombre garde son bouton direct.
 */
function UserMenu() {
  const { email, initial } = useAccountEmail()
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={CHROME_BUTTON} aria-label="Compte et thème">
          <Avatar initial={initial} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="max-w-[240px] truncate normal-case tracking-normal text-[12.5px] font-normal text-soft">
          {email || 'Compte'}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Thème</DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={(e) => {
              // Le menu reste ouvert : on voit le theme s'appliquer.
              e.preventDefault()
              setTheme(t.id)
            }}
          >
            <ThemeSwatch color={t.preview.accent} />
            <span className="flex-1">{t.label}</span>
            {theme === t.id && <Check className="h-4 w-4 text-accent" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
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
        {/* Selecteur segmente clair / sombre / systeme : de vrais items du menu
            (navigation clavier), qui laissent le menu ouvert apres le choix. */}
        <div className="grid grid-cols-3 gap-1 p-1">
          {MODES.map(({ id, label, icon: Icon }) => (
            <DropdownMenuItem
              key={id}
              onSelect={(e) => {
                e.preventDefault()
                setMode(id)
              }}
              aria-checked={mode === id}
              role="menuitemradio"
              className={cn(
                'min-h-11 flex-col justify-center gap-1 px-1 text-[11.5px] font-medium',
                mode === id
                  ? 'bg-accent/10 text-accent-ink data-[highlighted]:bg-accent/15'
                  : 'text-soft data-[highlighted]:text-ink',
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        {/* Sous 360px, l'engrenage du header cede sa place : Reglages ici. */}
        <DropdownMenuItem asChild className="min-[360px]:hidden">
          <Link to="/reglages">
            <Settings className="h-4 w-4" />
            <span className="flex-1">Réglages</span>
          </Link>
        </DropdownMenuItem>
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
 * remplace le heros du Pret a assigner (mobile). Met en avant le Pret a
 * assigner (vert, coche quand chaque euro a un role, rouge si negatif), signale
 * les depassements du mois (nombre et manque, en rouge) et rappelle Assigne /
 * Depense / Disponible sur grand ecran. Reutilise la meme query
 * useBudgetMonth(month) que la page Budget (aucune lecture supplementaire).
 */
function HeaderBudgetSummary() {
  const month = useUiStore((s) => s.month)
  const { data: budget } = useBudgetMonth(month)
  if (!budget) return null
  const negative = budget.rta < 0
  // Enveloppes masquees comprises : c'est de l'argent reel qui manque.
  const over = overspendingOf(budget.groups.flatMap((g) => g.rows))
  const balanced = budget.rta === 0 && over.count === 0
  const rtaColor = negative ? 'text-danger' : 'text-success'
  const overTitle = `${over.count === 1 ? '1 enveloppe' : `${over.count} enveloppes`} en dépassement : ${fmtEUR(over.missing)} à couvrir, sinon retirés du Prêt à assigner le mois prochain.`
  const rtaTitle = negative
    ? 'Vous avez assigné plus que vos revenus disponibles.'
    : balanced
      ? 'Chaque euro a un rôle.'
      : undefined

  return (
    <div className="hidden min-w-0 items-center gap-2.5 lg:flex xl:gap-3">
      {/* 1024-1279px : bloc compact sur deux lignes (la place manque a cote
          du selecteur de mois). */}
      <div className="flex min-w-0 flex-col justify-center gap-0.5 xl:hidden" title={rtaTitle}>
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-soft">Prêt à assigner</span>
          {balanced && <Check className="h-3.5 w-3.5 self-center text-success" strokeWidth={3} />}
          <Amount cents={budget.rta} animate className={cn('text-[15px] font-semibold leading-none', rtaColor)} />
        </span>
        {over.count > 0 && (
          <span
            className="flex items-center gap-1 whitespace-nowrap text-[12px] font-semibold leading-none text-danger tnum"
            title={overTitle}
          >
            <TriangleAlert className="h-3 w-3 shrink-0" strokeWidth={2.4} />
            {over.count} en dépassement · {fmtEUR(over.missing)}
          </span>
        )}
      </div>

      {/* 1280px et plus : pastilles. */}
      <div
        className={cn(
          'hidden shrink-0 items-center gap-2.5 rounded-full py-1.5 pl-3.5 pr-4 ring-1 ring-inset xl:flex',
          negative ? 'bg-danger/10 ring-danger/20' : 'bg-success/10 ring-success/20',
        )}
        title={rtaTitle}
      >
        <span className="whitespace-nowrap text-[11.5px] font-medium uppercase tracking-[0.08em] text-soft">
          Prêt à assigner
        </span>
        {balanced && <Check className="-mr-1 h-3.5 w-3.5 animate-scale-in text-success" strokeWidth={3} />}
        <Amount cents={budget.rta} animate className={cn('text-[15px] font-semibold leading-none', rtaColor)} />
      </div>
      {over.count > 0 && (
        <div
          className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-danger/10 py-1.5 pl-2.5 pr-3.5 text-danger ring-1 ring-inset ring-danger/20 xl:flex"
          title={overTitle}
        >
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" strokeWidth={2.4} />
          <span className="text-[13px] font-semibold leading-none tnum">
            {over.count} en dépassement
            <span className="font-medium"> · {fmtEUR(over.missing)}</span>
          </span>
        </div>
      )}
      {/* Rappel du mois sur tres grand ecran, quand rien d'autre ne reclame la place. */}
      {over.count === 0 && (
        <dl className="ml-2 hidden items-center gap-5 2xl:flex">
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
      )}
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
        {/* Mobile : marque + titre de la page. Sur les pages a selecteur de
            mois, le mois tient lieu de titre : la marque lui cede sa place
            (avec l'indicateur de fraicheur, tout tient sur une ligne des 320px). */}
        {!showMonth && (
          <div className="flex min-w-0 flex-1 items-center gap-2.5 lg:hidden">
            <BrandMark size="sm" />
            {showMobileTitle && (
              <span className="truncate text-[17px] font-semibold tracking-tight text-ink">{title}</span>
            )}
          </div>
        )}

        {/* Desktop : titre de page affirme. */}
        <h1 className="hidden shrink-0 text-[24px] font-semibold tracking-[-0.02em] text-ink lg:block">{title}</h1>
        {isBudget && <HeaderBudgetSummary />}

        {showMonth && (
          <div className="flex min-w-0 flex-1 items-center justify-start lg:justify-end">
            <MonthSelector />
          </div>
        )}
        {!showMonth && <div className="hidden flex-1 lg:block" />}

        <div className="flex shrink-0 items-center gap-0.5 lg:gap-1">
          {/* Icone seule la ou le selecteur de mois occupe la place. */}
          <FreshnessIndicator compact={showMonth} />
          {/* Desktop : mode clair/sombre direct, compte + theme en menu. */}
          <div className="hidden items-center gap-1 lg:flex">
            <ModeToggle />
            <UserMenu />
          </div>
          {/* Mobile : un menu compte + apparence, et le raccourci Reglages
              (dans le menu sous 360px). */}
          <div className="flex items-center lg:hidden">
            <MobileAccountMenu />
            <Link to="/reglages" aria-label="Réglages" className={cn(CHROME_BUTTON, 'max-[359px]:hidden')}>
              <Settings className="h-[19px] w-[19px]" />
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
