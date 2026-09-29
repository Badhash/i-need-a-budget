import { ArrowRight } from 'lucide-react'
import { opLabel, type RuleMatcher } from '@/lib/rules'
import { CategoryChip } from '@/components/rules/CategoryChip'
import { cn } from '@/lib/utils'

interface RuleSentenceProps {
  matcher: Pick<RuleMatcher, 'op' | 'value'>
  categoryId: string | null
  /** Prefixe « Si le libellé » (phrase complete) ou seulement l'operateur. */
  withSubject?: boolean
  className?: string
}

/**
 * Une regle lue comme une phrase en pastilles : « Si le libellé » [contient]
 * [« carrefour »] -> [Courses]. Les pastilles passent a la ligne proprement
 * sur mobile, la valeur reste entiere tant qu'elle tient.
 */
export function RuleSentence({ matcher, categoryId, withSubject = false, className }: RuleSentenceProps) {
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1.5', className)}>
      {withSubject && <span className="text-[13px] text-soft">Si le libellé</span>}
      <span className="rounded-full bg-surface2 px-2.5 py-0.5 text-[12.5px] font-medium text-soft ring-1 ring-inset ring-edge">
        {opLabel(matcher.op)}
      </span>
      <span className="min-w-0 max-w-full truncate rounded-full bg-accent/10 px-2.5 py-0.5 text-[13px] font-semibold text-accent-ink ring-1 ring-inset ring-accent/20 dark:text-accent">
        «&nbsp;{matcher.value}&nbsp;»
      </span>
      <ArrowRight aria-label="alors" className="h-3.5 w-3.5 shrink-0 text-soft" />
      <CategoryChip categoryId={categoryId} />
    </span>
  )
}
