import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { ChevronDown, Quote, Tag, X } from 'lucide-react'
import { useCategoriesMap, useGroupsMap } from '@/lib/data'
import { normalizeLabel, RULE_OPS, RULE_VALUE_MAX, type RuleMatcher, type RuleOp } from '@/lib/rules'
import { useRulePreview, type RulePreview } from '@/lib/ruleInsights'
import { CategoryPicker } from '@/components/transactions/CategoryPicker'
import { GroupPill } from '@/components/shared/GroupPill'
import { RulePreviewPanel } from '@/components/rules/RulePreviewPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented'
import { cn } from '@/lib/utils'

interface RuleFormProps {
  initialOp?: RuleOp
  initialValue?: string
  initialCategoryId?: string
  submitLabel: string
  pending?: boolean
  /** Empile toujours les champs (boite de dialogue etroite). */
  stacked?: boolean
  /** Regle editee : l'apercu l'evalue a sa place dans l'ordre (sinon : nouvelle
   * regle, evaluee apres toutes les autres). */
  ruleId?: string
  /** Donne le focus au champ texte a l'ouverture. */
  autoFocus?: boolean
  /** Le troisieme argument porte l'apercu au moment de la validation (nombre
   * de transactions non categorisees que la regle captera). */
  onSubmit: (matcher: RuleMatcher, categoryId: string, preview: RulePreview) => void
}

const OP_OPTIONS = RULE_OPS.map((o) => ({ value: o.value, label: o.label }))

/**
 * Formulaire partage entre la creation (page Regles, boite « Créer une
 * règle ») et l'edition d'une regle, lu comme une phrase : « Si le libellé
 * [contient] [texte] alors classer dans [catégorie] ». L'apercu en direct
 * montre ce que la regle captera, calcule sur le cache exactement comme le
 * serveur. La categorie exclut les revenus (refuses par le serveur).
 */
export function RuleForm({
  initialOp = 'contains',
  initialValue = '',
  initialCategoryId,
  submitLabel,
  pending,
  stacked,
  ruleId,
  autoFocus,
  onSubmit,
}: RuleFormProps) {
  const [op, setOp] = useState<RuleOp>(initialOp)
  const [value, setValue] = useState(initialValue)
  const [categoryId, setCategoryId] = useState<string | undefined>(initialCategoryId)
  const inputRef = useRef<HTMLInputElement>(null)

  // Apercu sur la valeur differee : la frappe reste fluide meme sur un gros
  // historique, l'apercu suit en arriere-plan.
  const deferredValue = useDeferredValue(value)
  const preview = useRulePreview(op, deferredValue, ruleId)

  const categoryById = useCategoriesMap()
  const groupById = useGroupsMap()
  const category = categoryId ? categoryById.get(categoryId) : undefined
  const group = category ? groupById.get(category.groupId) : undefined

  useEffect(() => {
    if (!autoFocus) return
    const raf = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(raf)
  }, [autoFocus])

  const valid = normalizeLabel(value).length > 0 && value.trim().length <= RULE_VALUE_MAX
  const canSubmit = valid && category !== undefined && !category.isIncome && !pending

  const submit = () => {
    if (!canSubmit || !categoryId) return
    onSubmit({ field: 'label', op, value: value.trim() }, categoryId, preview)
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="label-caps">Si le libellé</p>
        <div className="flex flex-col gap-2">
          <SegmentedControl
            options={OP_OPTIONS}
            value={op}
            onChange={setOp}
            aria-label="Condition sur le libellé"
            className={cn('w-full', !stacked && 'sm:w-auto sm:self-start')}
          />
          <div className="relative min-w-0 flex-1">
            <Quote className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft/80" />
            <Input
              ref={inputRef}
              value={value}
              maxLength={RULE_VALUE_MAX}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
              placeholder="ex. carrefour"
              aria-label="Texte recherché dans le libellé"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="done"
              className="pl-10 pr-11"
            />
            {value && (
              <button
                type="button"
                onClick={() => {
                  setValue('')
                  inputRef.current?.focus()
                }}
                aria-label="Effacer le texte"
                className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-soft transition-colors hover:text-ink lg:h-9 lg:w-9"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="label-caps">Alors classer dans</p>
        {/* Le declencheur du selecteur est enveloppe dans deux span inline :
            on les etire pour que le bouton occupe toute la largeur. */}
        <div className="flex flex-col [&>span>span]:flex-1 [&>span]:w-full">
          <CategoryPicker onSelect={(id) => id && setCategoryId(id)}>
            <button
              type="button"
              className={cn(
                'flex h-11 w-full items-center gap-2.5 rounded-xl border border-line bg-surface px-2 text-left text-[15px] text-ink transition-[border-color,background-color] duration-150 hover:border-soft/40 hover:bg-surface2/60 lg:h-10 lg:text-[14px]',
                !category && 'pl-3.5',
              )}
            >
              {category ? (
                <GroupPill group={group} size="sm" />
              ) : (
                <Tag className="h-4 w-4 shrink-0 text-soft" />
              )}
              <span className={cn('min-w-0 flex-1 truncate', !category && 'text-soft')}>
                {category ? category.name : 'Choisir une catégorie'}
              </span>
              <ChevronDown className="mr-1.5 h-4 w-4 shrink-0 text-soft" />
            </button>
          </CategoryPicker>
        </div>
      </div>

      <RulePreviewPanel preview={preview} op={op} value={deferredValue} />

      <div className="flex justify-end">
        <Button onClick={submit} disabled={!canSubmit} className={cn('w-full', !stacked && 'sm:w-auto sm:min-w-40')}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
