// Harnais DEV uniquement : vitrine du langage visuel « Aurore » (primitives,
// composants partages, coquille de l'app) avec des donnees factices, pour la
// verification visuelle. Jamais reference par l'app ; exclu du build de prod
// (seul index.html est une entree Vite).
//
// Parametres d'URL :
//   ?theme=nuit|corail|menthe  &mode=light|dark   (defaut : etat persiste)
//   &view=gallery|loader        &progress=0..100   (loader)
//   &path=/budget|/transactions|/comptes|/rapports|/regles|/reglages|/trier
//   &open=sheet|toasts          &rta=<centimes>
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import type { Session } from '@supabase/supabase-js'
import { CalendarClock, Inbox, ReceiptText, Sprout, Target, Wand2 } from 'lucide-react'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import { useThemeController } from '@/hooks/useTheme'
import { BOOTSTRAP_KEY, budgetKey, type Bootstrap } from '@/lib/data'
import type { BudgetMonth, BudgetRow } from '@/lib/budget'
import type { Category, CategoryGroup } from '@/types/domain'
import type { ThemeId } from '@/styles/themes'
import { currentMonth, fmtEUR, maxMonth, MIN_MONTH, monthRange } from '@/lib/format'
import { toast } from '@/lib/toast'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'
import { BottomNav, Fab } from '@/components/layout/BottomNav'
import { Toaster } from '@/components/shared/Toaster'
import { AppLoader } from '@/components/shared/AppLoader'
import { Amount } from '@/components/shared/Amount'
import { EmptyState } from '@/components/shared/EmptyState'
import { GroupPill } from '@/components/shared/GroupPill'
import { ProgressBar, type ProgressTone } from '@/components/shared/ProgressBar'
import { ProgressRing } from '@/components/shared/ProgressRing'
import { SectionHeader } from '@/components/shared/SectionHeader'
import { SignedAmountInput } from '@/components/shared/SignedAmountInput'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Combobox } from '@/components/ui/combobox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { MonthPicker } from '@/components/ui/month-picker'
import { SegmentedControl } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import '@/styles/globals.css'

// ---------------------------------------------------------------------------
// Parametres + theme
// ---------------------------------------------------------------------------

const params = new URLSearchParams(location.search)
const persisted = useUiStore.getState()
const theme = (params.get('theme') as ThemeId | null) ?? persisted.theme
const mode =
  params.get('mode') ??
  (persisted.mode === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
    : persisted.mode)
const view = params.get('view') ?? 'gallery'
const open = params.get('open')
const initialPath = params.get('path') ?? '/budget'
const rtaParam = Number(params.get('rta') ?? '48250')
const month = currentMonth()

useUiStore.setState({ theme, mode: mode === 'dark' ? 'dark' : 'light', month })
document.documentElement.dataset.theme = theme
document.documentElement.classList.toggle('dark', mode === 'dark')
useAuthStore.setState({
  status: 'authed',
  session: { user: { email: 'camille@exemple.fr' } } as unknown as Session,
})

// ---------------------------------------------------------------------------
// Donnees factices (jamais de donnees bancaires reelles)
// ---------------------------------------------------------------------------

const GROUPS: CategoryGroup[] = [
  { id: 'g-home', name: 'Logement', color: 'blue', icon: 'home', sortOrder: 1 },
  { id: 'g-life', name: 'Quotidien', color: 'green', icon: 'sparkles', sortOrder: 2 },
  { id: 'g-car', name: 'Transport', color: 'amber', icon: 'car', sortOrder: 3 },
  { id: 'g-subs', name: 'Abonnements', color: 'purple', icon: 'repeat', sortOrder: 4 },
  { id: 'g-save', name: 'Épargne', color: 'teal', icon: 'piggy', sortOrder: 5 },
  { id: 'g-income', name: 'Revenus', color: 'pink', icon: 'banknote', sortOrder: 6 },
]

const cat = (id: string, groupId: string, name: string, sortOrder: number, isIncome = false): Category => ({
  id,
  groupId,
  name,
  sortOrder,
  isIncome,
})

const CATEGORIES: Category[] = [
  cat('c-rent', 'g-home', 'Loyer', 1),
  cat('c-energy', 'g-home', 'Énergie', 2),
  cat('c-food', 'g-life', 'Courses', 1),
  cat('c-resto', 'g-life', 'Restaurants', 2),
  cat('c-fuel', 'g-car', 'Carburant', 1),
  cat('c-music', 'g-subs', 'Musique', 1),
  cat('c-trip', 'g-save', 'Voyage au Japon', 1),
  cat('c-salary', 'g-income', 'Salaire', 1, true),
]

const BOOTSTRAP: Bootstrap = {
  accounts: [
    {
      id: 'a-main',
      name: 'Compte courant',
      institution: 'Banque démo',
      kind: 'checking',
      onBudget: true,
      openingBalance: 0,
      balance: 342517,
    },
  ],
  groups: GROUPS,
  categories: CATEGORIES,
  uncategorizedCount: 7,
  budgetStartMonth: null,
  payees: [],
  features: [],
}

const ROWS: Record<string, [number, number]> = {
  // categoryId -> [assigne, activite] (centimes)
  'c-rent': [95000, -95000],
  'c-energy': [8000, -6420],
  'c-food': [45000, -38760],
  'c-resto': [12000, -14950],
  'c-fuel': [9000, -3210],
  'c-music': [1199, -1199],
  'c-trip': [30000, 0],
}

function budgetFor(m: string, rta: number): BudgetMonth {
  const groups = GROUPS.filter((g) => g.id !== 'g-income').map((group) => {
    const rows: BudgetRow[] = CATEGORIES.filter((c) => c.groupId === group.id).map((category) => {
      const [assigned, activity] = ROWS[category.id] ?? [0, 0]
      return { category, assigned, activity, available: assigned + activity }
    })
    return {
      group,
      rows,
      totals: {
        assigned: rows.reduce((s, r) => s + r.assigned, 0),
        activity: rows.reduce((s, r) => s + r.activity, 0),
        available: rows.reduce((s, r) => s + r.available, 0),
      },
    }
  })
  return {
    month: m,
    rta,
    groups,
    totals: {
      assigned: groups.reduce((s, g) => s + g.totals.assigned, 0),
      activity: groups.reduce((s, g) => s + g.totals.activity, 0),
      available: groups.reduce((s, g) => s + g.totals.available, 0),
    },
  }
}

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
queryClient.setQueryData(BOOTSTRAP_KEY, BOOTSTRAP)
// Chaque mois a son propre Pret a assigner : changer de mois montre le compteur anime.
monthRange(MIN_MONTH, maxMonth()).forEach((m, i) => {
  queryClient.setQueryData(budgetKey(m), budgetFor(m, m === month ? rtaParam : rtaParam - (i % 3) * 12500))
})

// ---------------------------------------------------------------------------
// Vitrine
// ---------------------------------------------------------------------------

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <SectionHeader title={title} description={description} />
      {children}
    </section>
  )
}

function HeroDemo() {
  const [rta, setRta] = useState(rtaParam)
  const budget = budgetFor(month, rta)
  const funded = budget.totals.assigned
  const income = funded + Math.max(rta, 0)
  const tone = rta < 0 ? 'danger' : 'success'
  return (
    <Card variant="hero" tone={rta < 0 ? 'danger' : 'accent'} className="p-5 lg:p-7">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="label-caps">Prêt à assigner</p>
          <Amount cents={rta} size="hero" animate className={cn('mt-2 block', rta < 0 ? 'text-danger' : 'text-ink')} />
          <p className="mt-2 text-[13.5px] text-soft">
            {rta < 0 ? 'Tu as assigné plus que tes revenus.' : 'Donne un rôle à chaque euro.'}
          </p>
        </div>
        <Badge variant={tone} dot>
          {rta < 0 ? 'À couvrir' : 'À jour'}
        </Badge>
      </div>
      <div className="mt-6 space-y-2">
        <div className="flex justify-between text-[12.5px] text-soft">
          <span>Assigné ce mois</span>
          <span className="tnum">
            {fmtEUR(funded)} sur {fmtEUR(income)}
          </span>
        </div>
        <ProgressBar value={income > 0 ? funded / income : 0} tone="accent" size="md" label="Part assignée" />
      </div>
      <div className="mt-6 grid grid-cols-3 gap-3 border-t border-line/70 pt-4">
        {[
          { label: 'Assigné', v: budget.totals.assigned },
          { label: 'Dépensé', v: -budget.totals.activity },
          { label: 'Disponible', v: budget.totals.available },
        ].map((s) => (
          <div key={s.label}>
            <p className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-soft">{s.label}</p>
            <Amount cents={s.v} size="md" animate className="mt-0.5 block font-semibold text-ink" />
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" variant="soft" onClick={() => setRta((v) => v + 15000)}>
          +150 €
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRta((v) => v - 40000)}>
          −400 €
        </Button>
      </div>
    </Card>
  )
}

function EnvelopeRow({ row, group }: { row: BudgetRow; group: CategoryGroup }) {
  const ratio = row.assigned > 0 ? Math.max(0, -row.activity) / row.assigned : 0
  const tone: ProgressTone = row.available < 0 ? 'danger' : ratio >= 1 ? 'success' : ratio > 0.85 ? 'warning' : 'accent'
  return (
    <li className="flex items-center gap-3 px-4 py-3.5 lg:px-5">
      <GroupPill group={group} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[15px] font-medium text-ink">{row.category.name}</p>
          <span
            className={cn(
              'shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-semibold tnum',
              row.available < 0 ? 'bg-danger/10 text-danger' : row.available > 0 ? 'bg-success/10 text-success' : 'bg-surface2 text-soft',
            )}
          >
            {fmtEUR(row.available)}
          </span>
        </div>
        <ProgressBar value={Math.min(1, ratio)} tone={tone} size="sm" className="mt-2" target={0.75} />
        <p className="mt-1.5 text-[12px] text-soft tnum">
          {fmtEUR(-row.activity)} dépensés sur {fmtEUR(row.assigned)}
        </p>
      </div>
    </li>
  )
}

function SheetDemo({ defaultOpen }: { defaultOpen: boolean }) {
  const [isOpen, setOpen] = useState(defaultOpen)
  const [draft, setDraft] = useState('')
  return (
    <>
      <Button onClick={() => setOpen(true)}>Ouvrir une feuille</Button>
      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="pr-8">Courses</DialogTitle>
            <DialogDescription>Assigne un montant à cette enveloppe pour le mois.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 overflow-y-auto p-5 pt-2">
            <SignedAmountInput value={draft} onChange={setDraft} placeholder="0,00" />
            <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
              {['+50 €', '+100 €', 'Objectif : 450,00 €'].map((l) => (
                <Badge key={l} variant="outline" size="md" className="h-9 shrink-0 px-3.5 text-[13px]">
                  {l}
                </Badge>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button onClick={() => setOpen(false)}>Assigner</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const COMBO_OPTIONS = CATEGORIES.filter((c) => !c.isIncome).map((c) => ({
  value: c.id,
  label: c.name,
  group: GROUPS.find((g) => g.id === c.groupId)?.name,
  colorVar: `cat-${GROUPS.find((g) => g.id === c.groupId)?.color}-fg`,
}))

function Gallery() {
  const [combo, setCombo] = useState('c-food')
  const [pickMonth, setPickMonth] = useState(month)
  const [filter, setFilter] = useState<'all' | 'uncat' | 'income'>('all')
  const budget = budgetFor(month, rtaParam)

  useEffect(() => {
    if (open !== 'toasts') return
    toast({ message: 'Transaction catégorisée', description: 'Courses · 42,90 €', tone: 'success', duration: 0 })
    toast({ message: '3 transactions à trier', tone: 'warning', action: { label: 'Trier', onClick: () => undefined }, duration: 0 })
    toast({ message: 'Échec de l’envoi, modification annulée', tone: 'danger', action: { label: 'Réessayer', onClick: () => undefined }, duration: 0 })
  }, [])

  return (
    <div className="space-y-12">
      <Section title="Héros" description="Le chiffre clé d'un écran, sur un halo aurore, compteur animé.">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <HeroDemo />
          <div className="grid grid-cols-2 gap-4">
            {(['success', 'warning', 'danger', 'accent'] as const).map((tone) => (
              <Card key={tone} variant="hero" tone={tone} className="p-4">
                <p className="label-caps">{{ success: 'Financé', warning: 'À compléter', danger: 'Dépassé', accent: 'Épargne' }[tone]}</p>
                <Amount
                  cents={{ success: 45000, warning: 12050, danger: -2950, accent: 300000 }[tone]}
                  size="xl"
                  className={cn('mt-1 block text-[21px] sm:text-[26px]', tone === 'danger' ? 'text-danger' : 'text-ink')}
                />
                <ProgressRing
                  value={{ success: 1, warning: 0.62, danger: 1, accent: 0.34 }[tone]}
                  tone={tone}
                  size={40}
                  className="mt-3"
                >
                  {Math.round({ success: 1, warning: 0.62, danger: 1, accent: 0.34 }[tone] * 100)}
                </ProgressRing>
              </Card>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Enveloppes" description="Liste en cartes, entrée échelonnée, jauges animées.">
        <div className="grid gap-4 lg:grid-cols-2">
          {budget.groups.slice(0, 4).map((block) => (
            <Card key={block.group.id} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-line/70 px-4 py-3 lg:px-5">
                <GroupPill group={block.group} size="sm" />
                <p className="flex-1 text-[13px] font-semibold uppercase tracking-[0.06em] text-soft">{block.group.name}</p>
                <Amount cents={block.totals.available} className="text-[13px] font-semibold text-ink" />
              </div>
              <ul className="stagger divide-y divide-line/60">
                {block.rows.map((row) => (
                  <EnvelopeRow key={row.category.id} row={row} group={block.group} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Cartes" description="Profondeur par la lumière : défaut, surélevée, verre, interactive.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Par défaut</CardTitle>
              <CardDescription>Surface pleine, ombre ambiante douce.</CardDescription>
            </CardHeader>
            <CardContent>
              <Amount cents={128450} size="lg" />
            </CardContent>
          </Card>
          <Card variant="raised">
            <CardHeader>
              <CardTitle>Surélevée</CardTitle>
              <CardDescription>Panneau mis en avant.</CardDescription>
            </CardHeader>
            <CardContent>
              <Amount cents={-4210} size="lg" colored signed />
            </CardContent>
          </Card>
          <div className="relative isolate overflow-hidden rounded-2xl">
            <div aria-hidden className="absolute inset-0 -z-10 bg-brand opacity-80" />
            <Card variant="glass" className="m-3">
              <CardHeader>
                <CardTitle>Verre</CardTitle>
                <CardDescription>Réservé au chrome.</CardDescription>
              </CardHeader>
              <CardContent>
                <Amount cents={9900} size="lg" />
              </CardContent>
            </Card>
          </div>
          <Card variant="interactive" onClick={() => toast({ message: 'Carte touchée' })}>
            <CardHeader>
              <CardTitle>Interactive</CardTitle>
              <CardDescription>Survol qui s'élève, appui qui s'enfonce.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-[13px] font-medium text-accent-ink">
              <Target className="h-4 w-4" /> Voir l'objectif
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Boutons">
        <Card>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Assigner</Button>
              <Button variant="soft">Financer les objectifs</Button>
              <Button variant="secondary">Secondaire</Button>
              <Button variant="outline">Contour</Button>
              <Button variant="ghost">Discret</Button>
              <Button variant="danger">Supprimer</Button>
              <Button variant="link">Lien d'action</Button>
              <Button disabled>Désactivé</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm">Petit</Button>
              <Button size="lg">Grand</Button>
              <Button size="icon" variant="outline" aria-label="Règles">
                <Wand2 className="h-4 w-4" />
              </Button>
              <Button size="iconSm" variant="ghost" aria-label="Échéance">
                <CalendarClock className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Champs" description="Survol discret, focus accent avec halo, 16px sur mobile.">
        <Card>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="label-caps">Libellé</span>
              <Input placeholder="Boulangerie du coin" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label-caps">Compte</span>
              <Select defaultValue="a">
                <option value="a">Compte courant</option>
                <option value="b">Livret A</option>
              </Select>
            </label>
            <div className="flex flex-col gap-1.5">
              <span className="label-caps">Catégorie</span>
              <Combobox options={COMBO_OPTIONS} value={combo} onChange={setCombo} aria-label="Catégorie" />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label-caps">Mois</span>
              <MonthPicker value={pickMonth} onChange={setPickMonth} min={MIN_MONTH} max={maxMonth()} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label-caps">Montant</span>
              <SignedAmountInput value="-42,90" onChange={() => undefined} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label-caps">Filtre</span>
              <SegmentedControl
                block
                aria-label="Filtre"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'Toutes' },
                  { value: 'uncat', label: 'À trier' },
                  { value: 'income', label: 'Revenus' },
                ]}
              />
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Badges, jauges et anneaux">
        <Card>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Badge>Neutre</Badge>
              <Badge variant="accent">Objectif</Badge>
              <Badge variant="success" dot>
                Financé
              </Badge>
              <Badge variant="warning" dot>
                À catégoriser
              </Badge>
              <Badge variant="danger" dot>
                Dépassé
              </Badge>
              <Badge variant="solid">Nouveau</Badge>
              <Badge variant="outline">Hors budget</Badge>
              <Badge variant="accent" size="sm">
                3
              </Badge>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              {(['accent', 'success', 'warning', 'danger'] as const).map((tone, i) => (
                <div key={tone} className="space-y-2">
                  <div className="flex justify-between text-[12.5px] text-soft">
                    <span className="capitalize">{tone}</span>
                    <span className="tnum">{[34, 100, 72, 100][i]} %</span>
                  </div>
                  <ProgressBar value={[0.34, 1, 0.72, 1][i]!} tone={tone} target={i === 2 ? 0.8 : undefined} />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-5">
              {(['accent', 'success', 'warning', 'danger', 'neutral'] as const).map((tone, i) => (
                <ProgressRing key={tone} value={[0.34, 1, 0.62, 0.9, 0.5][i]!} tone={tone} size={52}>
                  {Math.round([0.34, 1, 0.62, 0.9, 0.5][i]! * 100)}
                </ProgressRing>
              ))}
              <ProgressRing value={0.78} size={72} strokeWidth={7}>
                <Sprout className="h-5 w-5 text-accent" />
              </ProgressRing>
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="Pastilles et montants">
        <Card>
          <CardContent className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              {GROUPS.map((g) => (
                <GroupPill key={g.id} group={g} size="lg" />
              ))}
              <GroupPill size="lg" />
              {GROUPS.slice(0, 3).map((g) => (
                <GroupPill key={`${g.id}-sm`} group={g} size="sm" />
              ))}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3">
              <Amount cents={123456} size="hero" />
              <Amount cents={123456} size="xl" />
              <Amount cents={-4290} size="lg" colored signed />
              <Amount cents={250000} size="md" colored signed />
              <Amount cents={0} size="sm" className="text-soft" />
            </div>
          </CardContent>
        </Card>
      </Section>

      <Section title="États vides et chargement">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <EmptyState
              icon={Inbox}
              title="Tout est trié"
              description="Aucune transaction à catégoriser : ton budget est à jour."
              actionLabel="Voir les transactions"
              onAction={() => toast({ message: 'Direction les transactions', tone: 'success' })}
            />
          </Card>
          <Card>
            <EmptyState
              compact
              tone="warning"
              icon={ReceiptText}
              title="Aucune règle"
              description="Crée une règle pour catégoriser automatiquement tes achats récurrents."
              actionLabel="Créer une règle"
              onAction={() => undefined}
            />
            <div className="space-y-3 border-t border-line/70 p-5">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-12 w-full" />
              <div className="flex gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </Section>

      <Section title="Feuilles et toasts" description="Feuille basse sur mobile, modale centrée sur desktop.">
        <Card>
          <CardContent className="flex flex-wrap gap-2">
            <SheetDemo defaultOpen={open === 'sheet'} />
            <Button variant="outline" onClick={() => toast({ message: 'Assignation enregistrée', tone: 'success' })}>
              Toast succès
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                toast({
                  message: 'Transaction supprimée',
                  description: 'Boulangerie · 4,20 €',
                  action: { label: 'Annuler', onClick: () => toast({ message: 'Suppression annulée' }) },
                })
              }
            >
              Toast avec action
            </Button>
            <Button variant="outline" onClick={() => toast({ message: 'Hors ligne : envoi différé', tone: 'warning' })}>
              Toast attention
            </Button>
            <Button variant="outline" onClick={() => toast({ message: 'Échec de la synchronisation', tone: 'danger' })}>
              Toast erreur
            </Button>
          </CardContent>
        </Card>
      </Section>
    </div>
  )
}

function PreviewShell() {
  useThemeController()
  return (
    <div className="min-h-app">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-[26rem] bg-[radial-gradient(55%_100%_at_50%_0%,rgb(var(--aura-1)/0.10),transparent_72%)] dark:bg-[radial-gradient(55%_100%_at_50%_0%,rgb(var(--aura-1)/0.16),transparent_72%)] lg:left-64"
      />
      <Sidebar />
      <div className="lg:pl-64">
        <Header />
        <main className="mx-auto max-w-content px-4 pb-36 pt-6 lg:px-8 lg:pb-12">
          <Gallery />
        </main>
      </div>
      <BottomNav />
      <Fab />
      <Toaster />
    </div>
  )
}

const rootRoute = createRootRoute({ component: PreviewShell })
const leaf = (path: string) => createRoute({ getParentRoute: () => rootRoute, path, component: () => null })
const router = createRouter({
  routeTree: rootRoute.addChildren(
    ['/budget', '/transactions', '/comptes', '/rapports', '/regles', '/reglages', '/trier'].map(leaf),
  ),
  history: createMemoryHistory({ initialEntries: [initialPath] }),
})

function Root() {
  if (view === 'loader') {
    const progress = params.get('progress')
    return <AppLoader progress={progress === null ? undefined : Number(progress)} />
  }
  return (
    <QueryClientProvider client={queryClient}>
      {/* Routeur de demo : type distinct du routeur enregistre de l'app. */}
      <RouterProvider router={router as never} />
    </QueryClientProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
