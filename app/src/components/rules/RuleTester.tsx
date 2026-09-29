import { useDeferredValue, useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Plus, ScanText, X } from 'lucide-react'
import { ruleValueFromLabel } from '@/lib/rules'
import { useLabelSamples, useLabelTest, type LabelTest } from '@/lib/ruleInsights'
import { CategoryChip } from '@/components/rules/CategoryChip'
import { HighlightedLabel } from '@/components/rules/HighlightedLabel'
import { RuleSentence } from '@/components/rules/RuleSentence'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface RuleSeed {
  value: string
  categoryId?: string
}

interface RuleTesterProps {
  /** « Créer une règle » depuis un libelle que rien ne categorise. */
  onCreateRule: (seed: RuleSeed) => void
  /** Signale la regle qui capte le libelle teste (mise en evidence dans la liste). */
  onMatch?: (ruleId: string | null) => void
}

/**
 * « Tester un libellé » : colle un libelle bancaire, vois ce que ferait le
 * serveur a l'import. Etape 1, les regles dans leur ordre (la premiere qui
 * capte decide) ; etape 2, la memoire des tiers (repli, cle payeeKey) ; puis
 * le verdict. Calcule sur le cache, sans appel reseau.
 */
export function RuleTester({ onCreateRule, onMatch }: RuleTesterProps) {
  const [label, setLabel] = useState('')
  const deferred = useDeferredValue(label)
  const test = useLabelTest(deferred)
  const samples = useLabelSamples(3)

  const update = (next: string) => {
    setLabel(next)
    if (!next.trim()) onMatch?.(null)
  }

  // Remonte la regle qui capte le libelle (mise en evidence dans la liste).
  const matchedId = test?.rule?.id ?? null
  useEffect(() => {
    onMatch?.(matchedId)
  }, [matchedId, onMatch])

  return (
    <div className="space-y-3">
      <div className="relative">
        <ScanText className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-soft/80" />
        <Input
          value={label}
          onChange={(e) => update(e.target.value)}
          placeholder="Colle un libellé, ex. CB CARREFOUR 12/09"
          aria-label="Libellé bancaire à tester"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="done"
          className="pl-10 pr-11"
        />
        {label && (
          <button
            type="button"
            onClick={() => update('')}
            aria-label="Effacer le libellé"
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-soft transition-colors hover:text-ink lg:h-9 lg:w-9"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!label && samples.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[12.5px] text-soft">Essayer :</span>
          {samples.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => update(sample)}
              className="relative min-h-8 max-w-full truncate rounded-full bg-surface2 px-3 py-1 text-[12.5px] font-medium text-ink ring-1 ring-inset ring-edge transition-colors after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:bg-line/70 lg:after:hidden"
            >
              {sample}
            </button>
          ))}
        </div>
      )}

      {test && <TestResult label={deferred} test={test} onCreateRule={onCreateRule} />}
    </div>
  )
}

interface StepProps {
  index: number
  title: string
  children: ReactNode
  active: boolean
  last?: boolean
}

function Step({ index, title, children, active, last = false }: StepProps) {
  return (
    <li className={cn('relative flex gap-3', !last && 'pb-4')}>
      {!last && <span aria-hidden className="absolute bottom-0 left-[11px] top-7 w-px bg-line" />}
      <span
        className={cn(
          'relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tnum',
          active ? 'bg-brand text-accentfg shadow-button' : 'bg-surface2 text-soft ring-1 ring-inset ring-edge',
        )}
      >
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <p className="text-[13px] font-semibold text-ink">{title}</p>
        {children}
      </div>
    </li>
  )
}

function TestResult({ label, test, onCreateRule }: { label: string; test: LabelTest; onCreateRule: (seed: RuleSeed) => void }) {
  const decided = test.categoryId !== null
  return (
    <div className="animate-fade-in space-y-4 rounded-2xl bg-surface2/60 p-4 ring-1 ring-inset ring-edge">
      <ol>
        <Step index={1} title="Règles, dans leur ordre" active={test.rule !== null}>
          {test.rule ? (
            <div className="space-y-2">
              <p className="text-[13px] text-soft">
                La règle n°&nbsp;{test.rank} capte ce libellé
                {test.ruleCategoryInvalid && ", mais sa catégorie n'existe plus"} :
              </p>
              <RuleSentence matcher={test.rule.matcher} categoryId={test.rule.categoryId} />
              <HighlightedLabel
                label={label}
                op={test.rule.matcher.op}
                value={test.rule.matcher.value}
                className="block break-words rounded-lg bg-surface px-2.5 py-1.5 font-mono text-[12.5px] leading-relaxed text-ink/85 ring-1 ring-inset ring-edge"
              />
            </div>
          ) : (
            <p className="text-[13px] text-soft">Aucune règle ne capte ce libellé.</p>
          )}
        </Step>
        <Step index={2} title="Mémoire des tiers" active={test.source === 'payee'} last>
          {!test.payeeKey ? (
            <p className="text-[13px] text-soft">
              Aucun mot stable dans ce libellé : la mémoire ne peut pas reconnaître le tiers.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-soft">
              <span>Tiers</span>
              <span className="rounded-full bg-surface px-2.5 py-0.5 font-medium text-ink ring-1 ring-inset ring-edge">
                {test.payeeKey}
              </span>
              {test.payeeCategoryId ? (
                <>
                  <span>mémorisé dans</span>
                  <CategoryChip categoryId={test.payeeCategoryId} size="sm" />
                  {test.rule && <span className="w-full text-[12.5px]">Ignoré : la règle décide avant la mémoire.</span>}
                </>
              ) : (
                <span>pas encore mémorisé.</span>
              )}
            </div>
          )}
        </Step>
      </ol>

      <div
        className={cn(
          'flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center',
          decided ? 'bg-success/10 ring-1 ring-inset ring-success/20' : 'bg-warning/10 ring-1 ring-inset ring-warning/20',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
          {decided ? (
            <>
              <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-success" />
              <span>Classée dans</span>
              <CategoryChip categoryId={test.categoryId} />
              <span className="text-[12.5px] font-normal text-soft">
                {test.source === 'rule' ? 'par la règle' : 'par la mémoire des tiers'}
              </span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-[18px] w-[18px] shrink-0 text-warning" />
              <span>Resterait à catégoriser</span>
            </>
          )}
        </div>
        {!decided && (
          <Button
            variant="soft"
            size="sm"
            className="shrink-0"
            onClick={() =>
              onCreateRule({ value: ruleValueFromLabel(label), categoryId: test.payeeCategoryId ?? undefined })
            }
          >
            <Plus className="h-4 w-4" />
            Créer une règle
          </Button>
        )}
      </div>
    </div>
  )
}
