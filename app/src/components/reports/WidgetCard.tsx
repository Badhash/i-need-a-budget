import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { fmtPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

interface TrendBadgeProps {
  /** variation relative, ex. -0.12 pour -12 % */
  delta: number
  /** true si une baisse est une bonne nouvelle (ex. dépenses) */
  downIsGood?: boolean
  label: string
}

export function TrendBadge({ delta, downIsGood = false, label }: TrendBadgeProps) {
  const isDown = delta < 0
  const good = downIsGood ? isDown : !isDown
  const Icon = isDown ? TrendingDown : TrendingUp
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold',
        good ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {fmtPercent(Math.abs(delta))} {label}
    </span>
  )
}

interface WidgetCardProps {
  question: string
  children: ReactNode
  className?: string
}

/** Un widget = une question + un chiffre principal + une tendance + un graphe max. */
export function WidgetCard({ question, children, className }: WidgetCardProps) {
  return (
    <Card className={cn('flex flex-col gap-4 p-5', className)}>
      <p className="label-caps">{question}</p>
      {children}
    </Card>
  )
}
