import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: LucideIcon
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  /** Occupe toute la largeur disponible (segments egaux). */
  block?: boolean
  className?: string
  'aria-label'?: string
}

/**
 * Selecteur segmente (filtres, periodes, modes) : segments de largeur egale,
 * pastille qui glisse sous le segment actif (courbe ressort). Taille md :
 * segments de 40px a l'oeil sur mobile (36px desktop), dont la zone de toucher
 * deborde dans le rembourrage du conteneur (pseudo-element) : 48px sur mobile.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  block = false,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'relative grid auto-cols-fr grid-flow-col rounded-xl bg-surface2 p-1 ring-1 ring-inset ring-edge',
        block ? 'w-full' : 'inline-grid',
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute bottom-1 left-1 top-1 rounded-[10px] bg-surface shadow-card ring-1 ring-edge transition-transform duration-280 ease-spring dark:bg-surface3"
        style={{
          width: `calc((100% - 8px) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map(({ value: v, label, icon: Icon }) => {
        const active = v === value
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(v)}
            className={cn(
              "relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 font-medium transition-colors duration-150 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
              size === 'md' ? 'min-h-10 text-[14px] lg:min-h-9 lg:text-[13.5px]' : 'min-h-8 text-[12.5px]',
              active ? 'text-ink' : 'text-soft hover:text-ink',
            )}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            {label}
          </button>
        )
      })}
    </div>
  )
}
