import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useCategoriesMap, useGroupsMap } from '@/lib/data'
import { CategoryPicker } from '@/components/transactions/CategoryPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { RULE_OPS, type RuleMatcher } from '@/lib/rules'
import { cn } from '@/lib/utils'

interface RuleFormProps {
  initialOp?: RuleMatcher['op']
  initialValue?: string
  initialCategoryId?: string
  submitLabel: string
  pending?: boolean
  /** Empile toujours les champs (utilise dans la boite de dialogue etroite). */
  stacked?: boolean
  onSubmit: (matcher: RuleMatcher, categoryId: string) => void
}

/** Formulaire partage entre l'ajout (en ligne) et l'edition (boite de dialogue)
 * d'une regle de categorisation. La categorie exclut les revenus. */
export function RuleForm({
  initialOp = 'contains',
  initialValue = '',
  initialCategoryId,
  submitLabel,
  pending,
  stacked,
  onSubmit,
}: RuleFormProps) {
  const [op, setOp] = useState<RuleMatcher['op']>(initialOp)
  const [value, setValue] = useState(initialValue)
  const [categoryId, setCategoryId] = useState<string | undefined>(initialCategoryId)

  const categoryById = useCategoriesMap()
  const groupById = useGroupsMap()
  const category = categoryId ? categoryById.get(categoryId) : undefined
  const group = category ? groupById.get(category.groupId) : undefined

  const canSubmit = value.trim().length > 0 && categoryId !== undefined && !pending

  const submit = () => {
    if (value.trim().length === 0 || categoryId === undefined || pending) return
    onSubmit({ field: 'label', op, value: value.trim() }, categoryId)
  }

  return (
    <div className={cn('flex flex-col gap-3', !stacked && 'sm:flex-row sm:flex-wrap sm:items-center')}>
      <Select
        value={op}
        onChange={(e) => setOp(e.target.value as RuleMatcher['op'])}
        aria-label="Condition sur le libellé"
        className={cn(!stacked && 'sm:w-40')}
      >
        {RULE_OPS.map((o) => (
          <option key={o.value} value={o.value}>
            {`Le libellé ${o.label}`}
          </option>
        ))}
      </Select>

      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        placeholder="ex. Carrefour"
        aria-label="Texte recherché dans le libellé"
        className={cn(!stacked && 'sm:min-w-[160px] sm:flex-1')}
      />

      <CategoryPicker onSelect={(id) => id && setCategoryId(id)}>
        <button
          type="button"
          className={cn(
            'flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-[14px] text-ink transition-colors hover:bg-surface2',
            !stacked && 'sm:h-10 sm:w-52',
          )}
        >
          {group && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: `var(--cat-${group.color}-fg)` }}
            />
          )}
          <span className={cn('flex-1 truncate text-left', !category && 'text-soft')}>
            {category ? category.name : 'Choisir une catégorie'}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-soft" />
        </button>
      </CategoryPicker>

      <Button onClick={submit} disabled={!canSubmit} className={cn('w-full', !stacked && 'sm:w-auto')}>
        {submitLabel}
      </Button>
    </div>
  )
}
