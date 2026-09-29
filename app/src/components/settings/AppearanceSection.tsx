// Apparence : choix du theme (apercus vivants des trois themes, en clair ET en
// sombre, dans leur propre police) et du mode (clair, sombre, systeme). Les
// apercus peignent des mini-ecrans de l'app avec les couleurs de CHAQUE theme :
// les tokens CSS ne decrivant que le theme actif, les teintes viennent des
// metadonnees de styles/themes.ts (THEMES, CHART_PALETTES).

import { useEffect, useRef } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { CHART_PALETTES, THEMES, type Mode, type ThemeMeta } from '@/styles/themes'
import { resolveDark, useUiStore } from '@/stores/ui'
import { Card } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'

interface ScreenColors {
  bg: string
  surface: string
  ink: string
  soft: string
  line: string
  accent: string
  success: string
  cat1: string
  cat2: string
}

function colorsOf(meta: ThemeMeta, dark: boolean): ScreenColors {
  const palette = CHART_PALETTES[meta.id][dark ? 'dark' : 'light']
  return {
    bg: dark ? meta.preview.darkBg : meta.preview.bg,
    surface: dark ? meta.preview.darkSurface : meta.preview.surface,
    // L'encre sombre des themes est la teinte de leur fond clair (tokens.css).
    ink: dark ? meta.preview.bg : meta.preview.text,
    soft: palette.soft,
    line: palette.grid,
    accent: dark ? meta.preview.darkAccent : meta.preview.accent,
    success: palette.success,
    cat1: palette.cats.blue,
    cat2: palette.cats.pink,
  }
}

/** Mini-ecran : heros « Prêt à assigner » sur aurore, jauge, deux enveloppes. */
function MiniScreen({ meta, dark }: { meta: ThemeMeta; dark: boolean }) {
  const c = colorsOf(meta, dark)
  return (
    <div
      className="relative isolate flex-1 overflow-hidden p-2.5"
      style={{ backgroundColor: c.bg, fontFamily: `'${meta.font}', sans-serif` }}
    >
      <div
        aria-hidden
        className="absolute -right-6 -top-8 -z-10 h-20 w-20 rounded-full opacity-40 blur-xl"
        style={{ backgroundColor: c.accent }}
      />
      <div
        className="rounded-lg px-2 py-1.5"
        style={{
          backgroundColor: c.surface,
          boxShadow: dark ? `inset 0 0 0 1px ${c.line}` : `0 1px 2px ${c.line}, 0 4px 10px -6px ${c.line}`,
        }}
      >
        <p className="truncate text-[6.5px] font-medium uppercase tracking-[0.12em]" style={{ color: c.soft }}>
          Prêt à assigner
        </p>
        <p className="text-[13px] font-semibold leading-tight tnum" style={{ color: c.ink }}>
          1 234<span className="text-[8px] opacity-60">,56 €</span>
        </p>
        <div className="mt-1 h-1 overflow-hidden rounded-full" style={{ backgroundColor: c.line }}>
          <div className="h-full w-3/5 rounded-full" style={{ backgroundColor: c.accent }} />
        </div>
      </div>
      {[c.cat1, c.cat2].map((dot, i) => (
        <div
          key={i}
          className="mt-1 flex items-center gap-1 rounded-md px-1.5 py-1"
          style={{ backgroundColor: c.surface }}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
          <span className="h-1 flex-1 rounded-full" style={{ backgroundColor: c.line }} />
          <span
            className="rounded-full px-1 text-[6.5px] font-semibold tnum"
            style={{ color: c.success, backgroundColor: `${c.success}22` }}
          >
            {i === 0 ? '45 €' : '12 €'}
          </span>
        </div>
      ))}
    </div>
  )
}

function ThemeCard({
  meta,
  selected,
  dark,
  onSelect,
}: {
  meta: ThemeMeta
  selected: boolean
  dark: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`Thème ${meta.label} : ${meta.tagline}`}
      onClick={onSelect}
      className={cn(
        'pressable group w-[78%] shrink-0 snap-start rounded-2xl border p-2.5 text-left transition-[border-color,box-shadow] duration-200 sm:w-auto',
        selected
          ? 'border-accent shadow-glow ring-2 ring-accent/25'
          : 'border-edge bg-surface hover:border-soft/40 [@media(hover:hover)]:hover:shadow-raised',
      )}
    >
      <div aria-hidden className="flex h-28 overflow-hidden rounded-xl ring-1 ring-inset ring-ink/[0.06]">
        {/* L'apercu du mode actif passe en premier. */}
        <MiniScreen meta={meta} dark={dark} />
        <MiniScreen meta={meta} dark={!dark} />
      </div>
      <div className="mt-2.5 flex items-start justify-between gap-2 px-1 pb-0.5">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold tracking-tight" style={{ fontFamily: `'${meta.font}', sans-serif` }}>
            {meta.label}
          </p>
          <p className="text-[12px] leading-snug text-soft">{meta.tagline}</p>
        </div>
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-[background-color,transform,opacity] duration-200 ease-spring',
            selected ? 'scale-100 bg-accent text-accentfg opacity-100' : 'scale-75 bg-surface2 opacity-0',
          )}
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      </div>
    </button>
  )
}

const MODES: { value: Mode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'dark', label: 'Sombre', icon: Moon },
  { value: 'system', label: 'Système', icon: Monitor },
]

export function AppearanceSection() {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const mode = useUiStore((s) => s.mode)
  const setMode = useUiStore((s) => s.setMode)
  const dark = resolveDark(mode)
  const carousel = useRef<HTMLDivElement>(null)

  // Carrousel mobile : le theme choisi est visible des l'affichage (sans
  // faire defiler la page verticalement).
  useEffect(() => {
    const row = carousel.current
    const card = row?.querySelector<HTMLElement>('[aria-checked="true"]')
    if (!row || !card || row.scrollWidth <= row.clientWidth) return
    row.scrollLeft = Math.max(0, card.offsetLeft - row.offsetLeft - 20)
    // Au montage seulement : un choix ulterieur est deja visible (tape).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Card className="space-y-5 p-5">
      <div
        ref={carousel}
        role="radiogroup"
        aria-label="Thème"
        className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1 scrollbar-none sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0"
      >
        {THEMES.map((meta) => (
          <ThemeCard
            key={meta.id}
            meta={meta}
            selected={theme === meta.id}
            dark={dark}
            onSelect={() => setTheme(meta.id)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-4">
        <div>
          <p className="text-[14px] font-medium">Mode</p>
          <p className="text-[12.5px] text-soft">« Système » suit le réglage de l’appareil.</p>
        </div>
        <SegmentedControl
          aria-label="Mode d’affichage"
          value={mode}
          onChange={setMode}
          options={MODES}
          className="w-full sm:w-auto"
          block
        />
      </div>
    </Card>
  )
}
