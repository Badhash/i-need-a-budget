// Section « Categories masquees » en bas de la page Budget (mobile ET desktop),
// repliee par defaut. Une enveloppe masquee (ou toutes celles d'un groupe
// masque) n'apparait plus dans la grille, mais son argent reste bien dans le
// budget : on en montre le Disponible et on permet de la reafficher.

import { useState } from 'react'
import { ChevronDown, EyeOff } from 'lucide-react'
import type { BudgetGroupBlock, BudgetRow } from '@/lib/budget'
import type { CategoryGroup } from '@/types/domain'
import { GroupPill } from '@/components/shared/GroupPill'
import { AvailableChip } from '@/components/budget/AvailableChip'
import { fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'

export type HiddenEntry =
  /** Groupe masque : toutes ses enveloppes le sont avec lui. */
  | { kind: 'group'; block: BudgetGroupBlock }
  /** Enveloppe masquee d'un groupe visible. */
  | { kind: 'category'; row: BudgetRow; group: CategoryGroup }

/** Nombre d'enveloppes masquees et leur Disponible cumule. */
export function hiddenSummary(entries: HiddenEntry[]): { count: number; available: number; overspent: number } {
  let count = 0
  let available = 0
  let overspent = 0
  const add = (row: BudgetRow) => {
    count += 1
    available += row.available
    if (row.available < 0) overspent += 1
  }
  for (const entry of entries) {
    if (entry.kind === 'group') entry.block.rows.forEach(add)
    else add(entry.row)
  }
  return { count, available, overspent }
}

// Pluriel francais : singulier sous 2 (« 1,50 € disponible »).
function plural(amountCents: number, singular: string, pluralForm: string): string {
  return Math.abs(amountCents) >= 200 ? pluralForm : singular
}

const SHOW_BUTTON =
  "relative inline-flex h-9 shrink-0 items-center rounded-xl px-3 text-[13px] font-semibold text-accent-ink transition-[background-color,transform] duration-150 ease-spring after:absolute after:-inset-1 after:content-[''] hover:bg-accent/10 active:scale-95 dark:text-accent"

export function HiddenEnvelopes({
  entries,
  onShowCategory,
  onShowGroup,
}: {
  entries: HiddenEntry[]
  onShowCategory: (categoryId: string, name: string) => void
  onShowGroup: (groupId: string, name: string) => void
}) {
  const [open, setOpen] = useState(false)
  if (entries.length === 0) return null
  const { count, available, overspent } = hiddenSummary(entries)

  return (
    <section aria-label="Catégories masquées" className="rounded-2xl border border-edge bg-surface shadow-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[64px] w-full select-none items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors active:bg-surface2/60 lg:px-5 lg:hover:bg-surface2/40"
      >
        <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink/[0.05] text-soft">
          <EyeOff className="h-[18px] w-[18px]" />
          {overspent > 0 && (
            <span aria-hidden className="absolute right-0 top-0 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-surface" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">Catégories masquées</span>
          <span className="block text-[13px] text-soft tnum">
            {count === 1 ? '1 enveloppe masquée' : `${count} enveloppes masquées`} ·{' '}
            <span className={cn(available < 0 && 'text-danger')}>
              {fmtEUR(available)} {plural(available, 'disponible', 'disponibles')}
            </span>
            {overspent > 0 && (
              <span className="text-danger">
                {' '}
                · {overspent === 1 ? '1 en dépassement' : `${overspent} en dépassement`}
              </span>
            )}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn('h-5 w-5 shrink-0 text-soft transition-transform duration-200 ease-spring', open && 'rotate-180')}
        />
      </button>

      {open && (
        <ul className="animate-fade-in divide-y divide-line/60 border-t border-line/70">
          {entries.map((entry) =>
            entry.kind === 'group' ? (
              <li key={`g-${entry.block.group.id}`} className="py-1">
                <div className="flex min-h-[56px] items-center gap-3 px-4 lg:px-5">
                  <GroupPill group={entry.block.group} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-ink">{entry.block.group.name}</span>
                    <span className="block text-[12.5px] text-soft">
                      Groupe masqué ·{' '}
                      {entry.block.rows.length === 1 ? '1 enveloppe' : `${entry.block.rows.length} enveloppes`}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={SHOW_BUTTON}
                    onClick={() => onShowGroup(entry.block.group.id, entry.block.group.name)}
                  >
                    Afficher
                  </button>
                </div>
                {entry.block.rows.length > 0 && (
                  <ul className="mb-2 ml-[52px] mr-4 space-y-0.5 border-l border-line pl-3 lg:ml-[56px] lg:mr-5">
                    {entry.block.rows.map((row) => (
                      <li key={row.category.id} className="flex min-h-[40px] items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{row.category.name}</span>
                        <AvailableChip cents={row.available} size="sm" />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ) : (
              <li key={`c-${entry.row.category.id}`} className="flex min-h-[60px] items-center gap-3 px-4 py-2 lg:px-5">
                <GroupPill group={entry.group} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-ink">{entry.row.category.name}</span>
                  <span className="block truncate text-[12.5px] text-soft tnum">
                    {entry.group.name}
                    {/* Mobile : le disponible passe sous le nom (place du bouton). */}
                    <span className={cn('sm:hidden', entry.row.available < 0 && 'text-danger')}>
                      {' '}
                      · {fmtEUR(entry.row.available)}
                    </span>
                  </span>
                </span>
                <AvailableChip cents={entry.row.available} size="sm" className="hidden sm:inline-flex" />
                <button
                  type="button"
                  className={SHOW_BUTTON}
                  onClick={() => onShowCategory(entry.row.category.id, entry.row.category.name)}
                >
                  Afficher
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}
