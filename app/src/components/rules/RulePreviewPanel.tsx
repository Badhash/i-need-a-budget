import { AlertTriangle, CornerDownRight, ScanSearch, Sparkles } from 'lucide-react'
import type { RulePreview } from '@/lib/ruleInsights'
import type { RuleOp } from '@/lib/rules'
import { fmtPercent } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import { CategoryChip } from '@/components/rules/CategoryChip'
import { HighlightedLabel } from '@/components/rules/HighlightedLabel'
import { cn } from '@/lib/utils'

/** « 1 transaction », « 12 transactions » (0 et 1 au singulier, regle francaise). */
export function countLabel(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString('fr-FR')} ${n <= 1 ? singular : plural}`
}

/** Libelle de l'offre d'application apres creation d'une regle. */
export function applyNowLabel(n: number): string {
  return n === 1
    ? 'Appliquer maintenant à la transaction non catégorisée'
    : `Appliquer maintenant aux ${n.toLocaleString('fr-FR')} transactions non catégorisées`
}

// Au-dela, la regle touche une large part des transactions : on le signale
// (typiquement « contient "a" »), sans bloquer.
const BROAD_RATIO = 0.3
const BROAD_MIN = 20

interface RulePreviewPanelProps {
  preview: RulePreview
  op: RuleOp
  /** Valeur saisie (differee) : sert au surlignage des exemples. */
  value: string
  className?: string
}

/**
 * Apercu en direct d'une regle : combien de transactions elle categoriserait
 * (dont combien sont encore a categoriser), jusqu'a 5 exemples avec la partie
 * captee surlignee, et les correspondances deja prises par une regle plus
 * prioritaire. Calcule sur le cache, exactement comme le serveur.
 */
export function RulePreviewPanel({ preview, op, value, className }: RulePreviewPanelProps) {
  const typed = value.trim().length > 0
  const broad =
    preview.candidates >= BROAD_MIN && preview.matched / Math.max(1, preview.candidates) >= BROAD_RATIO
  return (
    <div
      aria-live="polite"
      className={cn(
        'rounded-2xl bg-surface2/70 p-4 ring-1 ring-inset ring-edge transition-colors duration-200',
        typed && preview.matched > 0 && 'bg-accent/[0.06] ring-accent/20',
        className,
      )}
    >
      {!typed ? (
        <p className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-soft">
          <ScanSearch className="mt-0.5 h-4 w-4 shrink-0" />
          Tape un mot du libellé : l'aperçu montre aussitôt les transactions concernées.
        </p>
      ) : preview.empty ? (
        <p className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Ce texte ne contient rien de comparable : la règle ne capterait aucun libellé.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="flex items-start gap-2.5 text-[14px] leading-snug text-ink">
            <Sparkles
              className={cn('mt-0.5 h-4 w-4 shrink-0', preview.matched > 0 ? 'text-accent-ink dark:text-accent' : 'text-soft')}
            />
            <span>
              {preview.matched === 0 ? (
                preview.shadowed > 0 ? (
                  'Cette règle ne catégoriserait aucune transaction : une règle plus prioritaire les capte déjà.'
                ) : (
                  <>
                    Cette règle ne catégoriserait aucune transaction pour l'instant.{' '}
                    <span className="text-soft">Elle servira aux prochains imports.</span>
                  </>
                )
              ) : (
                <>
                  Cette règle catégoriserait{' '}
                  <strong className="font-semibold tnum">{countLabel(preview.matched, 'transaction', 'transactions')}</strong>{' '}
                  {preview.uncategorized > 0 ? (
                    <>
                      (dont{' '}
                      <strong className="font-semibold text-warning tnum">
                        {countLabel(preview.uncategorized, 'non catégorisée', 'non catégorisées')}
                      </strong>
                      )
                    </>
                  ) : (
                    <span className="text-soft">
                      ({preview.matched === 1 ? 'déjà catégorisée' : 'toutes déjà catégorisées'})
                    </span>
                  )}
                </>
              )}
            </span>
          </p>

          {preview.examples.length > 0 && (
            <ul className="space-y-1.5 pl-[26px]">
              {preview.examples.map((group) => (
                <li key={group.key} className="flex min-w-0 items-center gap-2 text-[13px]">
                  <HighlightedLabel
                    label={group.sample.label}
                    op={op}
                    value={value}
                    className="min-w-0 flex-1 truncate text-ink/85"
                  />
                  {group.count > 1 && (
                    <span className="shrink-0 text-[12px] font-medium text-soft tnum" title={`${group.count} transactions`}>
                      ×{group.count}
                    </span>
                  )}
                  {group.uncategorized > 0 ? (
                    <Badge variant="warning" size="sm" className="shrink-0">
                      {group.uncategorized === group.count ? 'À catégoriser' : `${group.uncategorized} à catégoriser`}
                    </Badge>
                  ) : (
                    <CategoryChip categoryId={group.categoryId} size="sm" className="max-w-[42%] shrink-0" />
                  )}
                </li>
              ))}
              {preview.moreGroups > 0 && (
                <li className="text-[12.5px] text-soft">
                  et {countLabel(preview.moreGroups, 'autre tiers', 'autres tiers')}
                </li>
              )}
            </ul>
          )}

          {preview.shadowed > 0 && preview.shadowedBy && (
            <p className="flex items-start gap-2 pl-[26px] text-[12.5px] leading-relaxed text-soft">
              <CornerDownRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {countLabel(preview.shadowed, 'autre correspondance est déjà captée', 'autres correspondances sont déjà captées')}{' '}
                par une règle plus prioritaire (« {preview.shadowedBy.matcher.value} »).
              </span>
            </p>
          )}

          {broad && (
            <p className="flex items-start gap-2 pl-[26px] text-[12.5px] font-medium leading-relaxed text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Règle très large : elle toucherait {fmtPercent(preview.matched / preview.candidates)} de tes transactions.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
