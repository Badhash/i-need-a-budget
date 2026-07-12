import { Check, Landmark } from 'lucide-react'
import { THEMES, type Mode, type ThemeMeta } from '@/styles/themes'
import { useUiStore } from '@/stores/ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function ThemePreview({ meta }: { meta: ThemeMeta }) {
  return (
    <div className="flex h-24 overflow-hidden rounded-xl border border-line">
      {/* apercu light */}
      <div className="flex-1 p-3" style={{ backgroundColor: meta.preview.bg }}>
        <div
          className="rounded-lg p-2 shadow-sm"
          style={{ backgroundColor: meta.preview.surface, fontFamily: `'${meta.font}', sans-serif` }}
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.preview.accent }} />
            <span className="text-[10px] font-semibold" style={{ color: meta.preview.text }}>
              1 234,56 €
            </span>
          </div>
          <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: `${meta.preview.accent}33` }} />
        </div>
      </div>
      {/* apercu dark */}
      <div className="flex-1 p-3" style={{ backgroundColor: meta.preview.darkBg }}>
        <div
          className="rounded-lg p-2"
          style={{ backgroundColor: meta.preview.darkSurface, fontFamily: `'${meta.font}', sans-serif` }}
        >
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: meta.preview.darkAccent }} />
            <span className="text-[10px] font-semibold text-white/90">1 234,56 €</span>
          </div>
          <div
            className="h-1.5 w-3/4 rounded-full"
            style={{ backgroundColor: `${meta.preview.darkAccent}44` }}
          />
        </div>
      </div>
    </div>
  )
}

function ThemeSection() {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const mode = useUiStore((s) => s.mode)
  const setMode = useUiStore((s) => s.setMode)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Apparence</CardTitle>
        <p className="text-[13px] text-soft">
          Trois thèmes complets, chacun avec un mode clair et un mode sombre.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          {THEMES.map((meta) => (
            <button
              key={meta.id}
              onClick={() => setTheme(meta.id)}
              className={cn(
                'rounded-2xl border p-3 text-left transition-all',
                theme === meta.id
                  ? 'border-accent ring-2 ring-accent/30'
                  : 'border-line hover:border-soft/40',
              )}
            >
              <ThemePreview meta={meta} />
              <div className="mt-2.5 flex items-center justify-between px-0.5">
                <div>
                  <p className="text-[14px] font-semibold">{meta.label}</p>
                  <p className="text-[11.5px] leading-snug text-soft">{meta.tagline}</p>
                </div>
                {theme === meta.id && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-accentfg">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        <div>
          <p className="label-caps mb-2">Mode</p>
          <div className="grid max-w-sm grid-cols-3 gap-1 rounded-xl bg-surface2 p-1">
            {(
              [
                ['light', 'Clair'],
                ['dark', 'Sombre'],
                ['system', 'Système'],
              ] as [Mode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={cn(
                  'h-9 rounded-lg text-[13.5px] font-medium transition-colors',
                  mode === value ? 'bg-surface text-ink shadow-sm' : 'text-soft hover:text-ink',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function BankSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connexion bancaire</CardTitle>
        <p className="text-[13px] text-soft">
          Synchronisation automatique via Enable Banking (PSD2), trois fois par jour.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 rounded-xl border border-line p-4">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface2 text-soft">
            <Landmark className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="font-semibold">Ma banque</p>
              <Badge variant="neutral">Non connectée</Badge>
            </div>
            <p className="text-[12.5px] text-soft">
              Synchronisation automatique bientôt disponible.
            </p>
          </div>
          <Button variant="outline" disabled>
            Connecter
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function SettingsPage() {
  return (
    <div className="space-y-5">
      <ThemeSection />
      <BankSection />
      <p className="px-1 text-center text-[12px] text-soft">
        I Need A Budget · version 0.1.0
      </p>
    </div>
  )
}
