import { createPortal } from 'react-dom'
import type { BudgetRow } from '@/lib/budget'
import { addMonths, fmtEUR } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAssignSuggestions, type AssignSuggestion } from '@/components/budget/useAssignSuggestions'
import { useAnchoredBox } from '@/components/budget/anchoredLayer'

interface AssignQuickValuesProps {
  row: BudgetRow
  month: string
  /** Champ d'edition de l'assigne (ancre). */
  anchor: HTMLElement
  /** Resultat de l'expression en cours, affiche en tete quand c'en est une. */
  draftCents: number | null
  isExpression: boolean
  /** Pose et valide la valeur choisie. */
  onPick: (cents: number) => void
}

type ChipTone = 'accent' | 'success' | 'neutral'

interface Chip {
  key: string
  label: string
  /** Montant ASSIGNE pose par la puce (centimes). */
  cents: number
  /** Montant affiche sur la puce (null = libelle seul). */
  shown: number | null
  tone: ChipTone
  title: string
}

const CHIP_TONES: Record<ChipTone, string> = {
  accent: 'bg-accent/10 text-accent-ink hover:bg-accent/15 dark:text-accent',
  success: 'text-success hover:bg-success/10',
  neutral: 'text-ink hover:bg-ink/[0.06]',
}

/** '2026-08' -> 'août' (libelles courts « Assigné en août »). */
function monthName(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' })
}

function suggestionLabel(s: AssignSuggestion, month: string): string {
  const prev = monthName(addMonths(month, -1))
  switch (s.key) {
    case 'target':
      return 'Objectif'
    case 'lastAssigned':
      return `Assigné en ${prev}`
    case 'lastSpent':
      return `Dépensé en ${prev}`
    default:
      return s.label
  }
}

/**
 * Valeurs rapides sous l'editeur d'assigne (desktop) : suggestions du mois
 * (objectif, mois precedent, moyenne), « Vider » (rend le disponible au Pret a
 * assigner) et « 0 ». Couche portalisee et ancree au champ : la grille ne
 * bouge pas. Le mousedown est neutralise pour garder le focus dans le champ
 * (un clic sur une puce ne declenche pas le blur qui validerait le brouillon).
 * Ne monter QUE pour la ligne en edition : le hook de suggestions lit le cache
 * des transactions et le budget du mois precedent.
 */
export function AssignQuickValues({ row, month, anchor, draftCents, isExpression, onPick }: AssignQuickValuesProps) {
  const suggestions = useAssignSuggestions(row, month)
  const box = useAnchoredBox(anchor, { gap: 6, preferHeight: 56 })

  const chips: Chip[] = []
  for (const s of suggestions) {
    if (s.cents === row.assigned) continue
    const label = suggestionLabel(s, month)
    chips.push({
      key: s.key,
      label,
      cents: s.cents,
      shown: s.cents,
      tone: s.key === 'target' ? 'accent' : 'neutral',
      title: `${s.label} : assigner ${fmtEUR(s.cents)}`,
    })
  }
  // Vider : assigne = assigne - disponible -> disponible ramene a 0, le
  // disponible remonte au Pret a assigner.
  if (row.available > 0) {
    chips.push({
      key: 'empty',
      label: 'Vider',
      cents: row.assigned - row.available,
      shown: null,
      tone: 'success',
      title: `Rendre ${fmtEUR(row.available)} au Prêt à assigner (assigné : ${fmtEUR(row.assigned - row.available)})`,
    })
  }
  if (row.assigned !== 0) {
    chips.push({ key: 'zero', label: '0 €', cents: 0, shown: null, tone: 'neutral', title: 'Assigner 0 €' })
  }

  const showResult = isExpression && draftCents !== null
  // Champ sorti de la zone visible (defilement) : les puces se cachent.
  if (!box || !box.anchorVisible || (chips.length === 0 && !showResult)) return null

  return createPortal(
    <div
      data-inab-popover=""
      role="group"
      aria-label={`Valeurs rapides pour ${row.category.name}`}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        maxWidth: Math.min(box.maxWidth ?? 560, 560),
      }}
      className={cn(
        'z-50 flex animate-scale-in flex-wrap items-center gap-0.5 rounded-2xl border border-edge bg-surface3 p-1 shadow-elevated',
        box.placement === 'below' ? 'origin-top-right' : 'origin-bottom-right',
      )}
    >
      {showResult && (
        <span className="flex h-8 items-center gap-1 rounded-xl bg-surface2 px-2.5 text-[12.5px] text-soft tnum">
          =<span className="font-semibold text-ink">{fmtEUR(draftCents)}</span>
        </span>
      )}
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          tabIndex={-1}
          title={chip.title}
          onClick={() => onPick(chip.cents)}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-[12.5px] transition-colors duration-150 active:scale-[0.97]',
            CHIP_TONES[chip.tone],
          )}
        >
          <span className={cn(chip.shown !== null && chip.tone === 'neutral' && 'text-soft')}>{chip.label}</span>
          {chip.shown !== null && <span className="font-semibold tnum">{fmtEUR(chip.shown)}</span>}
        </button>
      ))}
    </div>,
    document.body,
  )
}
