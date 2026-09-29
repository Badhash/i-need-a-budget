import { useEffect, useRef, useState } from 'react'
import { GripVertical, Target as TargetIcon } from 'lucide-react'
import type { Category } from '@/types/domain'
import { cn } from '@/lib/utils'

/**
 * Consommation du mois d'une enveloppe (ou d'un groupe) : depense / argent
 * disponible pour le mois. L'argent du mois = report + assigne, soit
 * disponible - activite (available = rollover + assigned + activity). Une
 * enveloppe sans argent mais avec des depenses est entierement depassee.
 * null quand il n'y a ni argent ni depense (rien a montrer).
 */
export function spendRatio(available: number, activity: number): { ratio: number; over: boolean } | null {
  const spent = Math.max(-activity, 0)
  const funded = available - activity
  if (funded <= 0) return spent > 0 ? { ratio: 1, over: true } : null
  return { ratio: Math.min(spent / funded, 1), over: spent > funded }
}

/**
 * Barre fine sous le nom d'une enveloppe sans objectif : part de l'argent du
 * mois deja depensee, dans la couleur pastel du groupe (danger si depassee).
 * La hauteur est toujours reservee : les lignes gardent la meme densite.
 */
export function SpentBar({
  available,
  activity,
  color,
  className,
}: {
  available: number
  activity: number
  color: string
  className?: string
}) {
  const spend = spendRatio(available, activity)
  return (
    <div className={cn('mt-1.5 h-1 w-full', className)} aria-hidden>
      {spend && (
        <div className="h-full w-full overflow-hidden rounded-full bg-ink/[0.06]">
          <div
            className="h-full rounded-full transition-[width] duration-500 ease-spring"
            style={{
              width: `${spend.ratio > 0 ? Math.max(spend.ratio * 100, 3) : 0}%`,
              backgroundColor: spend.over ? 'rgb(var(--danger))' : `var(--cat-${color}-fg)`,
            }}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Jauge compacte d'un en-tete de groupe : part de l'argent du mois depensee
 * par l'ensemble de ses enveloppes, avec le pourcentage.
 */
export function GroupMeter({
  available,
  activity,
  color,
  className,
}: {
  available: number
  activity: number
  color: string
  className?: string
}) {
  const spend = spendRatio(available, activity)
  if (!spend) return null
  const pct = Math.round(spend.ratio * 100)
  return (
    <span
      className={cn('inline-flex items-center gap-2', className)}
      title={spend.over ? 'Groupe en dépassement ce mois-ci' : `${pct} % de l'argent du mois dépensé`}
    >
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-ink/[0.07]" aria-hidden>
        <span
          className="block h-full rounded-full transition-[width] duration-500 ease-spring"
          style={{
            width: `${pct > 0 ? Math.max(pct, 4) : 0}%`,
            backgroundColor: spend.over ? 'rgb(var(--danger))' : `var(--cat-${color}-fg)`,
          }}
        />
      </span>
      <span
        className={cn(
          'hidden w-9 text-[11.5px] font-medium tnum min-[1400px]:inline',
          spend.over ? 'text-danger' : 'text-soft',
        )}
      >
        {pct} %
      </span>
    </span>
  )
}

/**
 * Poignee de glissement, revelee au survol de la ligne (classe `group/row`)
 * ou toujours visible sur ecran tactile. Seule la poignee est `draggable` :
 * l'edition inline et les clics de la ligne ne declenchent jamais de drag.
 * Hors de l'ordre de tabulation (le reordonnancement est un geste souris).
 */
export function DragHandle({
  onDragStart,
  onDragEnd,
  label,
  className,
}: {
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      draggable
      tabIndex={-1}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      title={label}
      className={cn(
        "relative flex h-7 w-4 shrink-0 cursor-grab items-center justify-center rounded-md text-soft/50 opacity-0 transition-[opacity,color] duration-150 after:absolute after:-inset-x-1.5 after:-inset-y-1 after:content-[''] hover:text-ink active:cursor-grabbing group-hover/row:opacity-100 [@media(hover:none)]:opacity-60",
        className,
      )}
    >
      <GripVertical className="h-3.5 w-3.5" aria-hidden />
    </button>
  )
}

/** Petite affordance ronde qui ouvre le dialog d'objectif d'une categorie. */
export function TargetTrigger({
  category,
  hasTarget,
  onOpen,
  variant,
}: {
  category: Category
  hasTarget: boolean
  onOpen: (category: Category) => void
  variant: 'desktop' | 'mobile'
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(category)}
      aria-label={hasTarget ? "Modifier l'objectif" : 'Définir un objectif'}
      title={hasTarget ? "Modifier l'objectif" : 'Définir un objectif'}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-xl transition-colors',
        variant === 'desktop'
          ? cn(
              "relative h-6 w-6 rounded-lg after:absolute after:-inset-1.5 after:content-[''] focus-visible:ring-offset-surface",
              hasTarget
                ? 'text-accent-ink hover:bg-accent/10 dark:text-accent'
                : 'text-soft/50 opacity-0 hover:bg-surface2 hover:text-ink focus-visible:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100',
            )
          : cn('h-11 w-11 hover:bg-surface2 active:bg-surface2', hasTarget ? 'text-accent' : 'text-soft'),
      )}
    >
      <TargetIcon className={variant === 'desktop' ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
    </button>
  )
}

/**
 * Renommage inline (enveloppe ou groupe) : champ pre-rempli et selectionne,
 * Entree ou clic ailleurs valide, Echap annule. Un nom vide ou inchange ne
 * declenche aucun appel. `onDone(viaKeyboard)` rend la main a la grille (qui
 * replace le focus apres une sortie au clavier).
 */
export function InlineRename({
  initial,
  label,
  onCommit,
  onDone,
  className,
}: {
  initial: string
  label: string
  onCommit: (name: string) => void
  onDone: (viaKeyboard: boolean) => void
  className?: string
}) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  // Focus differe d'un frame : le menu qui a lance le renommage finit de se
  // fermer sans reprendre le focus.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      ref.current?.focus({ preventScroll: true })
      ref.current?.select()
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  const finish = (commit: boolean, viaKeyboard: boolean) => {
    if (done.current) return
    done.current = true
    const name = value.trim()
    if (commit && name && name !== initial) onCommit(name)
    onDone(viaKeyboard)
  }

  return (
    <input
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true, true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false, true)
        }
      }}
      onBlur={() => finish(true, false)}
      onClick={(e) => e.stopPropagation()}
      maxLength={60}
      enterKeyHint="done"
      autoComplete="off"
      aria-label={label}
      className={cn(
        'h-8 min-w-0 flex-1 rounded-lg border border-accent/70 bg-surface px-2.5 text-[14.5px] font-medium text-ink outline-none ring-4 ring-accent/15 [@media(pointer:coarse)]:text-[16px]',
        className,
      )}
    />
  )
}
