import { useMemo } from 'react'
import { matchRange, type RuleOp } from '@/lib/rules'

interface HighlightedLabelProps {
  label: string
  op: RuleOp
  value: string
  className?: string
}

/**
 * Libelle bancaire brut avec la partie captee par la regle surlignee. Le
 * surlignage est purement visuel : la decision de correspondance reste celle
 * du serveur (matchRange renvoie null plutot qu'une plage douteuse).
 */
export function HighlightedLabel({ label, op, value, className }: HighlightedLabelProps) {
  const range = useMemo(() => matchRange(label, op, value), [label, op, value])
  if (!range) return <span className={className}>{label}</span>
  const [start, end] = range
  return (
    <span className={className}>
      {label.slice(0, start)}
      <mark className="rounded-[5px] bg-accent/20 px-[2px] font-semibold text-ink ring-1 ring-inset ring-accent/25 dark:bg-accent/25">
        {label.slice(start, end)}
      </mark>
      {label.slice(end)}
    </span>
  )
}
