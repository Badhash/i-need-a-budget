import { ArrowLeftRight } from 'lucide-react'
import { Amount } from '@/components/shared/Amount'
import { GroupPill } from '@/components/shared/GroupPill'
import { dayHeading } from '@/lib/transactions'
import { cn } from '@/lib/utils'
import { merchantInitial, type TxRow } from './txRow'

const BUBBLE_SIZES = {
  sm: 'h-8 w-8 text-[13px] [&_svg]:h-3.5 [&_svg]:w-3.5',
  md: 'h-10 w-10 text-[15px] [&_svg]:h-[18px] [&_svg]:w-[18px]',
  lg: 'h-14 w-14 text-[21px] [&_svg]:h-6 [&_svg]:w-6',
} as const

/**
 * Pastille de tete d'une ligne : couleur et icone du groupe de la categorie,
 * sinon l'initiale du marchand (neutre : une ligne categorisee prend des
 * couleurs, une ligne a trier reste sobre), fleches pour un virement neutre.
 */
export function TxBubble({ row, size = 'md', className }: { row: TxRow; size?: keyof typeof BUBBLE_SIZES; className?: string }) {
  if (row.group) return <GroupPill group={row.group} className={cn(BUBBLE_SIZES[size], className)} />
  const neutralTransfer = Boolean(row.tx.transferGroupId) && !row.cross
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-ink/[0.06] font-semibold leading-none text-ink/70 shadow-highlight ring-1 ring-inset ring-ink/[0.05]',
        BUBBLE_SIZES[size],
        className,
      )}
    >
      {neutralTransfer ? <ArrowLeftRight strokeWidth={2.2} /> : merchantInitial(row.name)}
    </span>
  )
}

/**
 * Montant d'une ligne, chiffres tabulaires : entree d'argent en vert avec son
 * signe, depense a l'encre, virement neutre attenue (ni depense ni revenu).
 */
export function TxAmount({ row, className }: { row: TxRow; className?: string }) {
  const neutralTransfer = Boolean(row.tx.transferGroupId) && !row.cross
  const positive = row.tx.amount > 0
  return (
    <Amount
      cents={row.tx.amount}
      signed={positive}
      className={cn(
        'whitespace-nowrap font-semibold tracking-tight',
        neutralTransfer ? 'text-soft' : positive ? 'text-success' : 'text-ink',
        className,
      )}
    />
  )
}

/** Titre d'un jour : « Aujourd'hui · mardi 29 septembre » + total signe du jour. */
export function DayTitle({ date, total, className }: { date: string; total: number; className?: string }) {
  const { primary, secondary } = dayHeading(date)
  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <p className="min-w-0 truncate text-[13px] font-semibold tracking-tight text-ink">
        {primary}
        {secondary && <span className="font-medium text-soft"> · {secondary}</span>}
      </p>
      <Amount
        cents={total}
        signed={total > 0}
        className={cn('shrink-0 text-[12.5px] font-semibold', total > 0 ? 'text-success' : 'text-soft')}
      />
    </div>
  )
}
