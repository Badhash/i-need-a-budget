import type { AccountKind } from '@/types/domain'
import { cn } from '@/lib/utils'
import { ACCOUNT_KINDS, KIND_META, KindPill } from './accountKinds'

/**
 * Choix du type de compte en tuiles (icone + libelle court) : 2 x 2 sur
 * mobile, une rangee de 4 au-dela. Groupe radio accessible au clavier
 * (fleches gauche/droite).
 */
export function KindPicker({
  value,
  onChange,
  className,
}: {
  value: AccountKind
  onChange: (kind: AccountKind) => void
  className?: string
}) {
  const move = (delta: number) => {
    const i = ACCOUNT_KINDS.indexOf(value)
    onChange(ACCOUNT_KINDS[(i + delta + ACCOUNT_KINDS.length) % ACCOUNT_KINDS.length]!)
  }
  return (
    <div
      role="radiogroup"
      aria-label="Type de compte"
      className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', className)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        }
      }}
    >
      {ACCOUNT_KINDS.map((kind) => {
        const active = kind === value
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(kind)}
            className={cn(
              'flex min-h-[52px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-spring active:scale-[0.98] sm:flex-col sm:items-start sm:gap-2 sm:py-3',
              active
                ? 'border-accent/60 bg-accent/[0.07] shadow-[0_0_0_3px_rgb(var(--accent)/0.12)]'
                : 'border-line bg-surface hover:border-soft/40 hover:bg-surface2/50',
            )}
          >
            <KindPill kind={kind} size="sm" />
            <span className={cn('text-[13.5px] font-medium leading-tight', active ? 'text-ink' : 'text-soft')}>
              {KIND_META[kind].short}
            </span>
          </button>
        )
      })}
    </div>
  )
}
