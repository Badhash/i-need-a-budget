import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, CloudOff, RefreshCw } from 'lucide-react'
import { useDialogOpen } from '@/components/ui/dialog'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { refreshData, useRefreshStore, type RefreshOutcome } from '@/lib/freshness'
import { haptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'

// Traction (px de doigt) ignoree : tap, micro-defilement, hesitation.
const DEAD_ZONE = 10
// Traction qui arme l'actualisation au relacher.
const THRESHOLD = 72
// Course visuelle maximale de la pastille sous le header (elastique).
const MAX_TRAVEL = 112
// Position tenue pendant l'actualisation.
const HOLD = 60
const CHIP = 40
const RING_RADIUS = 16
const RING_LENGTH = 2 * Math.PI * RING_RADIUS
// Resultat affiche avant de repartir (coche, nuage barre).
const RESULT_MS = 520

type Phase = 'idle' | 'pulling' | 'armed' | 'refreshing' | RefreshOutcome

// Resistance elastique : la pastille suit le doigt puis s'essouffle (iOS).
function rubberBand(pull: number): number {
  return MAX_TRAVEL * (1 - Math.exp(-pull / (MAX_TRAVEL * 0.8)))
}

// Bas du header (sticky) a l'instant : la pastille en sort, y compris quand
// iOS fait rebondir la page (le header descend avec elle).
function headerBottom(): number {
  const header = document.querySelector('header')
  return header ? header.getBoundingClientRect().bottom : 0
}

function pageScrollTop(): number {
  return document.scrollingElement?.scrollTop ?? window.scrollY
}

// Un conteneur defilant deja descendu sous le doigt (liste interne) : le geste
// lui appartient.
function insideScrolledContainer(el: Element): boolean {
  for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
    if (node.scrollTop > 0) {
      const overflowY = getComputedStyle(node).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') return true
    }
  }
  return false
}

// Couches ouvertes par-dessus la page (menu, popover, feuille) : pas de traction.
const OVERLAY_SELECTOR = '[role="dialog"], [role="menu"], [role="listbox"], [data-inab-popover]'
// Zones qui ne declenchent jamais : saisie (selection de texte, curseur),
// chrome flottant, pile de toasts, opt-out explicite.
const IGNORED_TARGETS =
  'input, textarea, select, [contenteditable="true"], [data-toaster], [data-no-pull-refresh]'

/**
 * Tirer pour rafraichir (mobile) : en haut de page, tirer vers le bas fait
 * sortir une pastille elastique du header ; relachee une fois armee, elle
 * actualise les donnees a l'ecran (meme actualisation SCOPEE que l'indicateur
 * de fraicheur).
 *
 * Cohabitation : ecouteurs passifs (aucun preventDefault : le defilement,
 * l'overscroll du body et le rebond iOS restent natifs) ; le geste s'efface
 * devant un mouvement horizontal (carrousels, lignes a glisser), une liste
 * interne deja defilee, une feuille, un menu ou un popover ouverts, un champ
 * de saisie ou une selection de texte, et le multi-touch.
 */
export function PullToRefresh() {
  const isDesktop = useIsDesktop()
  const queryClient = useQueryClient()
  const dialogOpen = useDialogOpen()
  const dialogOpenRef = useRef(dialogOpen)
  dialogOpenRef.current = dialogOpen

  const chipRef = useRef<HTMLDivElement>(null)
  const ringRef = useRef<SVGCircleElement>(null)
  const iconRef = useRef<HTMLSpanElement>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase

  // Etats poses par React (hors geste) : position tenue, retour, masquage.
  useEffect(() => {
    const chip = chipRef.current
    if (!chip) return
    if (phase === 'pulling' || phase === 'armed') return
    const ring = ringRef.current
    const icon = iconRef.current
    chip.style.transition =
      phase === 'idle'
        ? 'transform 220ms cubic-bezier(0.4, 0, 1, 1), opacity 180ms ease-in'
        : 'transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease-out'
    if (phase === 'idle') {
      chip.style.transform = `translate3d(-50%, ${headerBottom() - CHIP - 8}px, 0) scale(0.7)`
      chip.style.opacity = '0'
      return
    }
    chip.style.transform = `translate3d(-50%, ${headerBottom() - CHIP + HOLD}px, 0) scale(1)`
    chip.style.opacity = '1'
    if (ring) ring.style.strokeDashoffset = '0'
    if (icon) icon.style.transform = ''
  }, [phase])

  useEffect(() => {
    if (isDesktop) return
    let startX = 0
    let startY = 0
    let tracking = false
    let pulling = false
    let armed = false
    let pull = 0
    let frame = 0

    const paint = () => {
      frame = 0
      const chip = chipRef.current
      if (!chip) return
      const progress = Math.min(1, pull / THRESHOLD)
      chip.style.transition = 'none'
      chip.style.transform = `translate3d(-50%, ${headerBottom() - CHIP + rubberBand(pull)}px, 0) scale(${0.7 + 0.3 * progress})`
      chip.style.opacity = String(Math.min(1, progress * 1.8))
      if (ringRef.current) ringRef.current.style.strokeDashoffset = String(RING_LENGTH * (1 - progress))
      if (iconRef.current) iconRef.current.style.transform = `rotate(${Math.round(progress * 280)}deg)`
    }

    const reset = (next: Phase = 'idle') => {
      tracking = false
      pulling = false
      armed = false
      pull = 0
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (phaseRef.current === 'pulling' || phaseRef.current === 'armed') setPhase(next)
    }

    const canStart = (e: TouchEvent): boolean => {
      if (e.touches.length !== 1) return false
      if (useRefreshStore.getState().refreshing || phaseRef.current !== 'idle') return false
      if (pageScrollTop() > 0) return false
      if (dialogOpenRef.current || document.querySelector(OVERLAY_SELECTOR)) return false
      // Defilement verrouille par une couche Radix (feuille, menu).
      if (document.body.hasAttribute('data-scroll-locked')) return false
      const target = e.target instanceof Element ? e.target : null
      if (!target || target.closest(IGNORED_TARGETS)) return false
      if (insideScrolledContainer(target)) return false
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return false
      return true
    }

    const onStart = (e: TouchEvent) => {
      if (!canStart(e)) {
        tracking = false
        return
      }
      const touch = e.touches[0]!
      startX = touch.clientX
      startY = touch.clientY
      tracking = true
      pulling = false
      armed = false
      pull = 0
    }

    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const touch = e.touches[0]
      // Second doigt, ou feuille ouverte en cours de geste : on abandonne.
      if (!touch || e.touches.length !== 1 || dialogOpenRef.current) {
        reset()
        return
      }
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY
      if (!pulling) {
        // Geste horizontal (carrousel, segmented, ligne a glisser) : on s'efface.
        if (Math.abs(dx) > DEAD_ZONE && Math.abs(dx) >= Math.abs(dy)) {
          tracking = false
          return
        }
        // Le doigt monte : c'est un defilement du contenu.
        if (dy < -DEAD_ZONE / 2) {
          tracking = false
          return
        }
        if (dy < DEAD_ZONE) return
        if (pageScrollTop() > 0) {
          tracking = false
          return
        }
        pulling = true
        setPhase('pulling')
      }
      pull = Math.max(0, dy - DEAD_ZONE)
      const nowArmed = pull >= THRESHOLD
      if (nowArmed !== armed) {
        armed = nowArmed
        if (armed) haptic(8)
        setPhase(armed ? 'armed' : 'pulling')
      }
      if (!frame) frame = requestAnimationFrame(paint)
    }

    const run = async () => {
      setPhase('refreshing')
      const outcome = await refreshData(queryClient)
      setPhase(outcome)
      window.setTimeout(() => setPhase('idle'), outcome === 'error' ? 0 : RESULT_MS)
    }

    const onEnd = () => {
      if (!tracking) return
      const shouldRefresh = pulling && armed
      tracking = false
      pulling = false
      armed = false
      pull = 0
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      if (shouldRefresh) void run()
      else if (phaseRef.current === 'pulling' || phaseRef.current === 'armed') setPhase('idle')
    }

    // La page a defile pendant la traction (inertie, clavier) : on abandonne.
    const onScroll = () => {
      if (pulling && pageScrollTop() > 0) reset()
    }

    const onCancel = () => reset()

    const options = { passive: true } as const
    document.addEventListener('touchstart', onStart, options)
    document.addEventListener('touchmove', onMove, options)
    document.addEventListener('touchend', onEnd, options)
    document.addEventListener('touchcancel', onCancel, options)
    window.addEventListener('scroll', onScroll, options)
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onCancel)
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [isDesktop, queryClient])

  // Feuille ouverte pendant une traction : retour immediat.
  useEffect(() => {
    if (dialogOpen && (phaseRef.current === 'pulling' || phaseRef.current === 'armed')) setPhase('idle')
  }, [dialogOpen])

  if (isDesktop) return null

  const armedOrBusy = phase === 'armed' || phase === 'refreshing'
  return (
    <div
      ref={chipRef}
      aria-hidden
      className="pointer-events-none fixed left-1/2 top-0 z-[39] lg:hidden"
      style={{ transform: 'translate3d(-50%, -120px, 0) scale(0.7)', opacity: 0 }}
    >
      <div
        className={cn(
          'relative flex h-10 w-10 items-center justify-center rounded-full border border-edge bg-surface3 shadow-elevated transition-colors duration-200',
          armedOrBusy && 'bg-accent/10',
          phase === 'ok' && 'bg-success/10',
          phase === 'offline' && 'bg-warning/10',
        )}
      >
        <svg aria-hidden className="absolute inset-0 -rotate-90" viewBox="0 0 40 40">
          <circle cx="20" cy="20" r={RING_RADIUS} fill="none" strokeWidth="2.5" className="stroke-ink/10" />
          <circle
            ref={ringRef}
            cx="20"
            cy="20"
            r={RING_RADIUS}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={RING_LENGTH}
            className={cn(
              'transition-colors duration-200',
              phase === 'ok' ? 'stroke-success' : phase === 'offline' ? 'stroke-warning' : 'stroke-accent',
            )}
          />
        </svg>
        {phase === 'ok' ? (
          <Check key="ok" className="relative h-[18px] w-[18px] animate-scale-in text-success" strokeWidth={2.6} />
        ) : phase === 'offline' ? (
          <CloudOff key="offline" className="relative h-[17px] w-[17px] animate-scale-in text-warning" strokeWidth={2.4} />
        ) : (
          <span ref={iconRef} className={cn('relative flex', armedOrBusy ? 'text-accent-ink' : 'text-soft')}>
            <RefreshCw
              className={cn('h-[18px] w-[18px]', phase === 'refreshing' && 'animate-spin [animation-duration:0.9s]')}
              strokeWidth={2.4}
            />
          </span>
        )}
      </div>
    </div>
  )
}
