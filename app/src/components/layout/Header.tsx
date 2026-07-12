import { Link, useRouterState } from '@tanstack/react-router'
import { Check, ChevronLeft, ChevronRight, Moon, Palette, Settings, Sun, Wallet } from 'lucide-react'
import { PAGE_TITLES } from '@/components/layout/nav'
import { THEMES } from '@/styles/themes'
import { resolveDark, useUiStore } from '@/stores/ui'
import { addMonths, fmtMonthTitle, MAX_MONTH, MIN_MONTH } from '@/lib/format'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

function MonthSelector() {
  const month = useUiStore((s) => s.month)
  const shiftMonth = useUiStore((s) => s.shiftMonth)
  const resetMonth = useUiStore((s) => s.resetMonth)

  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-line bg-surface p-0.5">
      <Button
        variant="ghost"
        size="iconSm"
        onClick={() => shiftMonth(-1)}
        disabled={addMonths(month, -1) < MIN_MONTH}
        aria-label="Mois précédent"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <button
        onClick={resetMonth}
        className="min-w-[96px] rounded-lg px-1.5 py-1.5 text-center text-[13.5px] font-semibold transition-colors hover:bg-surface2 lg:min-w-[120px] lg:px-2 lg:text-[14px]"
        title="Revenir au mois courant"
      >
        {fmtMonthTitle(month)}
      </button>
      <Button
        variant="ghost"
        size="iconSm"
        onClick={() => shiftMonth(1)}
        disabled={addMonths(month, 1) > MAX_MONTH}
        aria-label="Mois suivant"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  )
}

function ThemeMenu() {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Choisir le thème">
          <Palette className="h-[18px] w-[18px]" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Thème</DropdownMenuLabel>
        {THEMES.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => setTheme(t.id)}>
            <span
              className="h-4 w-4 rounded-full border border-black/10"
              style={{ backgroundColor: t.preview.accent }}
            />
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
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? 'Passer en mode clair' : 'Passer en mode sombre'}
      onClick={() => setMode(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </Button>
  )
}

export function Header() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const title = PAGE_TITLES[pathname] ?? 'Budget'

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-content items-center gap-1.5 px-3 sm:gap-3 sm:px-4 lg:px-8">
        <div className="hidden items-center gap-2.5 min-[380px]:flex lg:hidden">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accentfg">
            <Wallet className="h-4 w-4" />
          </span>
        </div>
        <h1 className={cn('text-[19px] font-semibold tracking-tight', 'hidden lg:block')}>{title}</h1>

        <div className="flex flex-1 items-center justify-center lg:justify-end">
          <MonthSelector />
        </div>

        <div className="flex items-center gap-0.5">
          <ThemeMenu />
          <ModeToggle />
          <Link
            to="/reglages"
            aria-label="Réglages"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-soft transition-colors hover:bg-surface2 hover:text-ink lg:hidden"
          >
            <Settings className="h-[18px] w-[18px]" />
          </Link>
        </div>
      </div>
    </header>
  )
}
