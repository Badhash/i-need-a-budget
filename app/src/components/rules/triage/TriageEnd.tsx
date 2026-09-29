import type { CSSProperties } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, CheckCheck, Inbox, RotateCcw } from 'lucide-react'
import { useBudgetMonth } from '@/lib/queries'
import { useUiStore } from '@/stores/ui'
import { Amount } from '@/components/shared/Amount'
import { EmptyState } from '@/components/shared/EmptyState'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

// Eclats de la celebration : angle (deg), distance (px), couleur (token),
// taille (px), delai (ms). Positions finales fixes : sous mouvement reduit,
// ils sont simplement la, sans envol.
const SPARKS: { angle: number; distance: number; color: string; size: number; delay: number }[] = [
  { angle: -90, distance: 78, color: 'bg-success', size: 8, delay: 0 },
  { angle: -45, distance: 70, color: 'bg-accent', size: 6, delay: 40 },
  { angle: 0, distance: 82, color: 'bg-coin', size: 7, delay: 80 },
  { angle: 40, distance: 68, color: 'bg-aura-2', size: 5, delay: 20 },
  { angle: 90, distance: 76, color: 'bg-success', size: 6, delay: 60 },
  { angle: 135, distance: 70, color: 'bg-accent', size: 8, delay: 100 },
  { angle: 180, distance: 80, color: 'bg-coin', size: 6, delay: 30 },
  { angle: -135, distance: 66, color: 'bg-aura-2', size: 7, delay: 70 },
  { angle: -20, distance: 104, color: 'bg-accent', size: 4, delay: 120 },
  { angle: 160, distance: 102, color: 'bg-success', size: 4, delay: 140 },
  { angle: 65, distance: 100, color: 'bg-coin', size: 4, delay: 90 },
  { angle: -110, distance: 106, color: 'bg-aura-2', size: 4, delay: 50 },
]

function fmtDuration(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000))
  const min = Math.floor(total / 60)
  const sec = total % 60
  if (min === 0) return `${sec} s`
  return sec === 0 ? `${min} min` : `${min} min ${String(sec).padStart(2, '0')} s`
}

interface DoneStateProps {
  count: number
  durationMs: number | null
}

/** Fin de session : « Tout est trié », eclats de celebration, Pret a assigner. */
export function TriageDone({ count, durationMs }: DoneStateProps) {
  const navigate = useNavigate()
  const month = useUiStore((s) => s.month)
  const { data: budget } = useBudgetMonth(month)
  return (
    <Card variant="hero" tone="success" auraIntensity="strong" className="px-6 py-8 text-center sm:px-10 sm:py-12">
      <div className="relative mx-auto mb-6 mt-2 flex h-24 w-24 items-center justify-center sm:mb-7">
        <span aria-hidden className="absolute inset-0 scale-150 rounded-full bg-success/20 blur-2xl" />
        {SPARKS.map((s, i) => {
          const rad = (s.angle * Math.PI) / 180
          const x = Math.cos(rad) * s.distance
          const y = Math.sin(rad) * s.distance
          const style = {
            width: s.size,
            height: s.size,
            left: `calc(50% + ${x}px - ${s.size / 2}px)`,
            top: `calc(50% + ${y}px - ${s.size / 2}px)`,
            animationDelay: `${120 + s.delay}ms`,
            '--tw-enter-translate-x': `${-x}px`,
            '--tw-enter-translate-y': `${-y}px`,
          } as CSSProperties
          return (
            <span
              key={i}
              aria-hidden
              style={style}
              className={cn(
                'absolute rounded-full opacity-90 animate-in fade-in-0 zoom-in-50 fill-mode-both duration-700 ease-out',
                s.color,
              )}
            />
          )
        })}
        <span className="relative flex h-24 w-24 animate-pop items-center justify-center rounded-full bg-gradient-to-br from-success/30 via-success/15 to-aura-2/20 shadow-highlight ring-1 ring-inset ring-success/30">
          <CheckCheck className="h-10 w-10 text-success" strokeWidth={2.2} />
        </span>
      </div>
      <h2 className="text-[26px] font-semibold tracking-tight text-ink sm:text-[30px]">Tout est trié</h2>
      <p className="mx-auto mt-2 max-w-sm text-balance text-[14.5px] leading-relaxed text-soft">
        {count === 1 ? '1 transaction catégorisée' : `${count} transactions catégorisées`}
        {durationMs !== null && durationMs > 0 ? ` en ${fmtDuration(durationMs)}` : ''}. Ton budget colle à la
        réalité.
      </p>
      {budget && (
        <div className="mx-auto mt-5 inline-flex items-center gap-3 rounded-2xl bg-surface/70 px-4 py-3 ring-1 ring-inset ring-edge dark:bg-surface3/70 sm:mt-6">
          <span className="label-caps">Prêt à assigner</span>
          <Amount cents={budget.rta} size="lg" colored={budget.rta < 0} className={cn(budget.rta >= 0 && 'text-success')} />
        </div>
      )}
      <div className="mt-6 flex flex-col-reverse items-stretch justify-center gap-2 sm:mt-7 sm:flex-row sm:items-center">
        <Button variant="outline" onClick={() => void navigate({ to: '/transactions' })}>
          Voir les transactions
        </Button>
        <Button onClick={() => void navigate({ to: '/budget' })}>
          Retour au budget
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  )
}

/** Rien a trier des l'ouverture. */
export function TriageNothing() {
  const navigate = useNavigate()
  return (
    <Card>
      <EmptyState
        tone="success"
        icon={Inbox}
        badgeIcon={CheckCheck}
        title="Rien à trier"
        description="Toutes tes transactions sont catégorisées. Ton budget est à jour."
        actionLabel="Retour au budget"
        onAction={() => void navigate({ to: '/budget' })}
      />
    </Card>
  )
}

interface SkippedLeftProps {
  count: number
  onReview: () => void
  onFinish: () => void
}

/** Il ne reste que des transactions passees : les revoir ou s'arreter la. */
export function TriageSkippedLeft({ count, onReview, onFinish }: SkippedLeftProps) {
  return (
    <Card variant="hero" className="px-6 py-10 text-center">
      <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-accent-ink ring-1 ring-inset ring-accent/20 dark:text-accent">
        <RotateCcw className="h-7 w-7" />
      </span>
      <h2 className="mt-5 text-[22px] font-semibold tracking-tight text-ink">Presque fini</h2>
      <p className="mx-auto mt-2 max-w-sm text-[14.5px] leading-relaxed text-soft">
        {count === 1
          ? 'Il ne reste que la transaction que tu as passée.'
          : `Il ne reste que les ${count} transactions que tu as passées.`}
      </p>
      <div className="mt-6 flex flex-col-reverse items-stretch justify-center gap-2 sm:flex-row sm:items-center">
        <Button variant="outline" onClick={onFinish}>
          Terminer
        </Button>
        <Button onClick={onReview}>
          <RotateCcw className="h-4 w-4" />
          {count === 1 ? 'La revoir' : 'Les revoir'}
        </Button>
      </div>
    </Card>
  )
}
