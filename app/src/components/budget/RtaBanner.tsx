// Heros du Pret a assigner (MOBILE et tablette, < lg) : le chiffre cle de
// l'ecran sur un halo « aurore » a la couleur de l'etat, la part du mois deja
// assignee et, s'il y en a, les depassements a couvrir. Des que le montant
// passe sous le header en defilant, une barre compacte (montant, fine jauge,
// point rouge en cas de depassement) prend le relais sous le header ; la
// toucher ramene en haut de la page. Le desktop affiche ce resume dans le
// header (HeaderBudgetSummary).

import { useEffect, useRef, useState, type RefObject } from 'react'
import { ArrowUp, Check, Sparkles, TriangleAlert } from 'lucide-react'
import type { BudgetMonth } from '@/lib/budget'
import { Amount } from '@/components/shared/Amount'
import type { AuraTone } from '@/components/shared/Aura'
import { ProgressBar, type ProgressTone } from '@/components/shared/ProgressBar'
import { Card } from '@/components/ui/card'
import { OverspendingCard } from '@/components/budget/OverspendingCard'
import { fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Etat du Pret a assigner, qui pilote couleurs et messages. */
export type RtaState = 'toAssign' | 'balanced' | 'balancedOverspent' | 'overAssigned'

export function rtaState(rta: number, overspentCount: number): RtaState {
  if (rta < 0) return 'overAssigned'
  if (rta > 0) return 'toAssign'
  return overspentCount > 0 ? 'balancedOverspent' : 'balanced'
}

const AURA: Record<RtaState, AuraTone> = {
  toAssign: 'accent',
  balanced: 'success',
  balancedOverspent: 'warning',
  overAssigned: 'danger',
}

const BAR: Record<RtaState, ProgressTone> = {
  toAssign: 'accent',
  balanced: 'success',
  balancedOverspent: 'warning',
  overAssigned: 'danger',
}

const AMOUNT_COLOR: Record<RtaState, string> = {
  toAssign: 'text-ink',
  balanced: 'text-success',
  balancedOverspent: 'text-ink',
  overAssigned: 'text-danger',
}

const DOT: Record<RtaState, string> = {
  toAssign: 'bg-accent',
  balanced: 'bg-success',
  balancedOverspent: 'bg-warning',
  overAssigned: 'bg-danger',
}

/**
 * Part du mois qui a recu un role (0..1) : assigne / (assigne + reste a
 * assigner). Pleine quand tout est assigne (RTA = 0) ou sur-assigne (RTA < 0).
 */
export function fundingRatio(budget: BudgetMonth): number {
  if (budget.rta <= 0) return 1
  const assigned = Math.max(budget.totals.assigned, 0)
  const base = assigned + budget.rta
  return base > 0 ? assigned / base : 0
}

/**
 * Bas du header collant (safe-area haute comprise, pt-safe) : la barre
 * compacte se pose juste dessous. Mesure en direct (le header peut changer de
 * hauteur : largeur, safe-area, orientation).
 */
function useHeaderBottom(): number | undefined {
  const [bottom, setBottom] = useState<number>()
  useEffect(() => {
    const header = document.querySelector('header')
    if (!header) return
    const update = () => setBottom(Math.round(header.getBoundingClientRect().height))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])
  return bottom
}

/** Vrai quand l'element est passe tout entier SOUS le header en defilant. */
function useScrolledUnder(ref: RefObject<HTMLElement>, offset: number | undefined): boolean {
  const [under, setUnder] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || offset === undefined) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        const top = entry.rootBounds?.top ?? offset
        setUnder(!entry.isIntersecting && entry.boundingClientRect.top < top)
      },
      { rootMargin: `-${offset}px 0px 0px 0px`, threshold: 0 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, offset])
  return under
}

function scrollToTop(): void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
}

interface RtaBannerProps {
  budget: BudgetMonth
  /** Depassements du mois (enveloppes masquees comprises : argent reel). */
  overspent: { count: number; missing: number; names: string[] }
  onCover: () => void
}

export function RtaBanner({ budget, overspent, onCover }: RtaBannerProps) {
  const state = rtaState(budget.rta, overspent.count)
  const ratio = fundingRatio(budget)
  const pct = Math.round(ratio * 100)
  const amountRef = useRef<HTMLDivElement>(null)
  const headerBottom = useHeaderBottom()
  const collapsed = useScrolledUnder(amountRef, headerBottom)

  return (
    <>
      <Card variant="hero" tone={AURA[state]} auraIntensity="strong" className="animate-fade-up p-5">
        <div className="flex min-h-7 items-center justify-between gap-3">
          <p className="label-caps">Prêt à assigner</p>
          {state === 'balanced' && (
            <span className="inline-flex animate-scale-in items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-[12px] font-semibold text-success ring-1 ring-inset ring-success/20">
              <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
              Tout est assigné
            </span>
          )}
          {state === 'overAssigned' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2.5 py-1 text-[12px] font-semibold text-danger ring-1 ring-inset ring-danger/20">
              <TriangleAlert className="h-3.5 w-3.5" strokeWidth={2.4} />
              Trop assigné
            </span>
          )}
        </div>

        <div ref={amountRef} className="mt-1">
          <Amount cents={budget.rta} size="hero" animate className={AMOUNT_COLOR[state]} />
        </div>

        <p
          className={cn(
            'mt-1.5 flex items-center gap-1.5 text-[14px] leading-snug',
            state === 'balanced' ? 'font-medium text-success' : state === 'overAssigned' ? 'text-danger' : 'text-soft',
          )}
        >
          {state === 'balanced' && <Sparkles key="celebrate" className="h-4 w-4 shrink-0 animate-pop" />}
          {state === 'toAssign' && 'À répartir entre vos enveloppes.'}
          {state === 'balanced' && 'Chaque euro a un rôle.'}
          {state === 'balancedOverspent' && 'Tout est assigné. Il reste des dépassements à couvrir.'}
          {state === 'overAssigned' &&
            `Vous avez assigné ${fmtEUR(-budget.rta)} de plus que vos revenus : retirez-les d'une enveloppe.`}
        </p>

        <div className="mt-5">
          <ProgressBar value={ratio} tone={BAR[state]} size="md" label="Part du mois assignée" />
          <div className="mt-2 flex items-baseline justify-between gap-3 text-[12.5px] text-soft">
            <span className="tnum">
              {state === 'overAssigned' ? 'Plus que vos revenus' : `${pct} % assigné`}
            </span>
            <span className="tnum">
              Assigné <span className="font-semibold text-ink">{fmtEUR(budget.totals.assigned)}</span>
            </span>
          </div>
        </div>

        {overspent.count > 0 && (
          <OverspendingCard
            className="mt-4"
            count={overspent.count}
            missing={overspent.missing}
            names={overspent.names}
            onCover={onCover}
          />
        )}
      </Card>

      <RtaCompactBar
        budget={budget}
        state={state}
        ratio={ratio}
        overspent={overspent.count > 0}
        visible={collapsed}
        top={headerBottom}
      />
    </>
  )
}

/**
 * Barre compacte collee sous le header (mobile) : montant, fine jauge du mois
 * et point rouge en cas de depassement. Toucher = retour en haut.
 */
function RtaCompactBar({
  budget,
  state,
  ratio,
  overspent,
  visible,
  top,
}: {
  budget: BudgetMonth
  state: RtaState
  ratio: number
  overspent: boolean
  visible: boolean
  top: number | undefined
}) {
  return (
    <div
      aria-hidden={!visible}
      // Repli avant mesure : header de 56px + filet sous la safe-area haute.
      className={cn(
        'pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.5rem+1px+0.5rem)] z-30 px-4 transition-[opacity,transform,visibility] duration-280 ease-spring lg:hidden',
        visible ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-2 opacity-0',
      )}
      style={top !== undefined ? { top: top + 8 } : undefined}
    >
      <button
        type="button"
        onClick={scrollToTop}
        tabIndex={visible ? 0 : -1}
        aria-label={`Prêt à assigner : ${fmtEUR(budget.rta)}${overspent ? ', dépassements à couvrir' : ''}. Revenir en haut`}
        className="pressable pointer-events-auto relative mx-auto flex h-11 w-full max-w-content items-center gap-2.5 overflow-hidden rounded-2xl border border-edge bg-surface3/95 pl-3.5 pr-3 shadow-elevated backdrop-blur-xl"
      >
        {/* Point d'etat ; rouge des qu'une enveloppe est en depassement. */}
        <span
          aria-hidden
          className={cn(
            'h-2.5 w-2.5 shrink-0 rounded-full ring-4',
            overspent ? 'bg-danger ring-danger/15' : cn(DOT[state], 'ring-ink/[0.06]'),
          )}
        />
        <span className="text-[13px] font-medium text-soft">Prêt à assigner</span>
        <Amount
          cents={budget.rta}
          className={cn('ml-auto text-[15px] font-semibold tracking-tight', AMOUNT_COLOR[state])}
        />
        <ArrowUp className="h-4 w-4 shrink-0 text-soft" aria-hidden />
        {/* Fine jauge du mois, au ras du bord bas de la barre. */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-ink/[0.06]">
          <span
            className={cn(
              'block h-full rounded-r-full transition-[width] duration-600 ease-spring',
              state === 'toAssign' ? 'bg-brand' : DOT[state],
            )}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </span>
      </button>
    </div>
  )
}
