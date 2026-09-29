import { forwardRef } from 'react'
import { Search, SkipForward } from 'lucide-react'
import type { Transaction } from '@/types/domain'
import { useCategoriesMap, useGroupsMap } from '@/lib/data'
import { TRIAGE_REASON_LABELS, type TriageSuggestion } from '@/lib/triage'
import { CategoryPicker } from '@/components/transactions/CategoryPicker'
import { GroupPill } from '@/components/shared/GroupPill'
import { Kbd } from '@/components/rules/triage/TriageHero'
import { focusCategorySearch } from '@/components/rules/focusCategorySearch'
import { cn } from '@/lib/utils'

interface TriageChoicesProps {
  tx: Transaction
  suggestions: TriageSuggestion[]
  /** Desktop : liste avec raisons et touches ; mobile : tuiles 2 x 2. */
  showKeys: boolean
  onPick: (categoryId: string) => void
  onSkip: () => void
}

/**
 * Choix pour la transaction courante : jusqu'a 4 suggestions (1-4 au
 * clavier), « Autre catégorie… » (Entree, selecteur complet, revenus
 * proposes pour une entree d'argent) et « Passer » (S). Mobile : tuiles au
 * pouce, tout tient au-dessus de la barre de navigation.
 */
export const TriageChoices = forwardRef<HTMLButtonElement, TriageChoicesProps>(function TriageChoices(
  { tx, suggestions, showKeys, onPick, onSkip },
  pickerRef,
) {
  const categories = useCategoriesMap()
  const groups = useGroupsMap()
  const inflow = tx.amount > 0
  return (
    <div className="space-y-2">
      {showKeys && suggestions.length > 0 && (
        <p className="label-caps px-1">{inflow ? "Entrée d'argent : suggestions" : 'Suggestions'}</p>
      )}
      <ul className={cn('stagger', showKeys ? 'space-y-2' : 'grid grid-cols-2 gap-2')}>
        {suggestions.map((s, i) => {
          const category = categories.get(s.categoryId)
          if (!category) return null
          const group = groups.get(category.groupId)
          const remembered = s.reason === 'payee'
          // Mobile : tuiles compactes, seule une raison qui compte est dite.
          const hint = showKeys
            ? `${group ? `${group.name} · ` : ''}${TRIAGE_REASON_LABELS[s.reason]}`
            : remembered
              ? 'Mémorisée'
              : s.reason === 'income'
                ? 'Revenus'
                : s.reason === 'session'
                  ? 'Dernier choix'
                  : ''
          return (
            <li key={s.categoryId} className="min-w-0">
              <button
                type="button"
                onClick={() => onPick(s.categoryId)}
                className={cn(
                  'group flex w-full items-center gap-3 rounded-2xl border bg-surface text-left shadow-card transition-[transform,background-color,border-color] duration-150 ease-spring active:scale-[0.97]',
                  showKeys ? 'min-h-[52px] px-3 py-2' : 'min-h-[56px] gap-2.5 px-2.5 py-2',
                  remembered
                    ? 'border-accent/40 bg-accent/[0.07] hover:bg-accent/10'
                    : 'border-edge hover:border-accent/30 hover:bg-accent/[0.04]',
                )}
              >
                <GroupPill group={group} size={showKeys ? 'md' : 'sm'} />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block font-medium leading-tight text-ink',
                      showKeys ? 'truncate text-[15px]' : 'line-clamp-2 text-[14px]',
                    )}
                  >
                    {category.name}
                  </span>
                  {hint && (
                    <span
                      className={cn(
                        'mt-0.5 block truncate text-[12px]',
                        remembered ? 'font-medium text-accent-ink dark:text-accent' : 'text-soft',
                      )}
                    >
                      {hint}
                    </span>
                  )}
                </span>
                {showKeys && <Kbd className="group-hover:border-accent/40">{String(i + 1)}</Kbd>}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 [&>span>span]:w-full [&>span]:w-full">
        <CategoryPicker label={tx.label} includeIncome={inflow} onSelect={(id) => id && onPick(id)}>
          <button
            ref={pickerRef}
            type="button"
            onClick={focusCategorySearch}
            className="flex min-h-[52px] w-full items-center gap-2.5 rounded-2xl border border-dashed border-line px-3.5 text-left text-[14.5px] font-medium text-ink transition-colors hover:border-accent/40 hover:bg-surface2/60 lg:min-h-12"
          >
            <Search className="h-4 w-4 shrink-0 text-soft" />
            <span className="min-w-0 flex-1 truncate">Autre catégorie…</span>
            {showKeys && <Kbd>↵</Kbd>}
          </button>
        </CategoryPicker>
        <button
          type="button"
          onClick={onSkip}
          className="flex min-h-[52px] items-center gap-2 rounded-2xl px-4 text-[14.5px] font-medium text-soft transition-colors hover:bg-surface2 hover:text-ink lg:min-h-12"
        >
          <SkipForward className="h-4 w-4" />
          Passer
          {showKeys && <Kbd>S</Kbd>}
        </button>
      </div>
    </div>
  )
})

/** Legende discrete des raccourcis (desktop). */
export function ShortcutLegend() {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-[12px] text-soft">
      <span className="inline-flex items-center gap-1">
        <Kbd>1</Kbd>–<Kbd>4</Kbd> choisir
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>↵</Kbd> autre catégorie
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>S</Kbd> passer
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>U</Kbd> ou <Kbd>Ctrl Z</Kbd> annuler
      </span>
    </p>
  )
}
