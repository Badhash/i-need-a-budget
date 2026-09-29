// Import YNAB (Reglages > Donnees) : Register.csv (requis) + Budget.csv
// (optionnel) -> analyse locale -> apercu (comptes retenus, budget ou suivi,
// virements apparies) -> confirmation avec sauvegarde de securite ->
// remplacement complet par lots, reprenable (lib/ynabImport.ts).

import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, CalendarRange, Check, FileSpreadsheet, Import, Info, Sparkles } from 'lucide-react'
import {
  buildYnabPlan,
  decodeYnabCsv,
  parseYnabExport,
  startImport,
  useImportStore,
  validatePlan,
  type ParsedImport,
  type YnabAccountChoice,
} from '@/lib/ynabImport'
import { useServerFeatures } from '@/lib/data'
import { fmtDateNumeric } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented'
import { SettingsCard } from '@/components/settings/shared/SettingsCard'
import { FileDrop } from '@/components/settings/data/FileDrop'
import { ImportRunPanel } from '@/components/settings/data/ImportRunPanel'
import { ReplaceConfirmDialog } from '@/components/settings/data/ReplaceConfirmDialog'
import { cn } from '@/lib/utils'

const CONVENTION_LABEL: Record<ParsedImport['summary']['dateConvention'], string> = {
  DMY: 'jour/mois/année (format français)',
  MDY: 'mois/jour/année (format américain)',
  ISO: 'année-mois-jour (ISO)',
}

const n = (v: number) => v.toLocaleString('fr-FR')

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface2/70 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-soft">{label}</p>
      <p className="mt-0.5 text-[17px] font-semibold tracking-tight tnum">{n(value)}</p>
    </div>
  )
}

/** Case a cocher de la taille d'une cible tactile (ligne entiere cliquable). */
function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors duration-150',
        checked ? 'border-accent bg-accent text-accentfg' : 'border-line bg-surface',
      )}
    >
      {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
    </span>
  )
}

export function YnabImportCard() {
  const queryClient = useQueryClient()
  const features = useServerFeatures()
  const withTransfers = features.has('importTransfers')
  const phase = useImportStore((s) => s.phase)
  const runSource = useImportStore((s) => s.source)
  const busy = phase === 'running'
  // Import YNAB en cours, interrompu ou termine : le panneau de suivi remplace
  // le formulaire jusqu'a sa fermeture.
  const ownRun = phase !== 'idle' && runSource === 'ynab'
  const [registerFile, setRegisterFile] = useState<File | null>(null)
  const [budgetFile, setBudgetFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [choices, setChoices] = useState<Map<string, YnabAccountChoice>>(new Map())
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const plan = useMemo(
    () => (parsed ? buildYnabPlan(parsed, choices, withTransfers) : null),
    [parsed, choices, withTransfers],
  )
  const invalid = plan ? validatePlan(plan) : null
  const txCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of parsed?.transactions ?? []) m.set(t.accountKey, (m.get(t.accountKey) ?? 0) + 1)
    return m
  }, [parsed])

  function reset() {
    setParsed(null)
    setError(null)
  }

  async function analyze() {
    if (!registerFile) return
    setError(null)
    setAnalyzing(true)
    try {
      // decodeYnabCsv (et non file.text()) : repare les emojis CESU-8 des
      // exports YNAB, sinon des categories se dedoublent silencieusement.
      const registerText = decodeYnabCsv(await registerFile.arrayBuffer())
      const budgetText = budgetFile ? decodeYnabCsv(await budgetFile.arrayBuffer()) : undefined
      const p = parseYnabExport(registerText, budgetText)
      if (p.transactions.length === 0) {
        setError('Aucune transaction lisible dans Register.csv. Vérifie le fichier.')
        setParsed(null)
        return
      }
      setParsed(p)
      // Tous les comptes retenus par defaut, nature deduite du registre.
      setChoices(new Map(p.accounts.map((a) => [a.key, { selected: true, onBudget: a.onBudget }])))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible d’analyser les fichiers.')
      setParsed(null)
    } finally {
      setAnalyzing(false)
    }
  }

  const setChoice = (key: string, patch: Partial<YnabAccountChoice>) =>
    setChoices((prev) => {
      const next = new Map(prev)
      const current = next.get(key) ?? { selected: true, onBudget: true }
      next.set(key, { ...current, ...patch })
      return next
    })

  const range = plan && plan.transactions.length > 0 ? dateRange(plan.transactions.map((t) => t.date)) : null

  return (
    <SettingsCard
      icon={FileSpreadsheet}
      title="Importer depuis YNAB"
      description="Remplace tout par l’« Export budget » de YNAB (fichiers CSV décompressés). Budget.csv apporte les montants assignés."
      contentClassName="space-y-4"
    >
      <ImportRunPanel source="ynab" />

      {!ownRun && (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <FileDrop
              label="Register.csv"
              hint="Transactions et comptes · requis"
              accept=".csv,text/csv"
              file={registerFile}
              disabled={busy}
              onPick={(f) => {
                setRegisterFile(f)
                reset()
              }}
            />
            <FileDrop
              label="Budget.csv"
              hint="Montants assignés · facultatif"
              accept=".csv,text/csv"
              file={budgetFile}
              disabled={busy}
              onPick={(f) => {
                setBudgetFile(f)
                reset()
              }}
            />
          </div>
          {!parsed && (
            <Button
              onClick={() => void analyze()}
              disabled={!registerFile || analyzing || busy}
              className="w-full sm:w-auto"
            >
              <Sparkles className="h-4 w-4" />
              {analyzing ? 'Analyse…' : 'Analyser les fichiers'}
            </Button>
          )}
          {error && (
            <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-[13px] font-medium text-danger">
              {error}
            </p>
          )}
        </>
      )}

      {parsed && plan && !ownRun && (
        <div className="animate-fade-up space-y-4 rounded-2xl border border-edge p-4">
          <div>
            <p className="label-caps mb-2">Comptes à importer</p>
            <ul className="-mx-1 space-y-0.5">
              {parsed.accounts.map((a) => {
                const choice = choices.get(a.key) ?? { selected: true, onBudget: a.onBudget }
                return (
                  <li key={a.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-1 py-1">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={choice.selected}
                      onClick={() => setChoice(a.key, { selected: !choice.selected })}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-1.5 text-left transition-colors hover:bg-ink/[0.03]"
                    >
                      <CheckMark checked={choice.selected} />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn('block truncate text-[14.5px]', !choice.selected && 'text-soft line-through')}
                        >
                          {a.name}
                        </span>
                        <span className="block text-[12px] text-soft tnum">
                          {n(txCount.get(a.key) ?? 0)} transaction{(txCount.get(a.key) ?? 0) > 1 ? 's' : ''}
                        </span>
                      </span>
                    </button>
                    {choice.selected && (
                      <SegmentedControl
                        size="sm"
                        aria-label={`Nature du compte ${a.name}`}
                        value={choice.onBudget ? 'budget' : 'tracking'}
                        onChange={(v) => setChoice(a.key, { onBudget: v === 'budget' })}
                        options={[
                          { value: 'budget', label: 'Budget' },
                          { value: 'tracking', label: 'Suivi' },
                        ]}
                        className="ml-auto"
                      />
                    )}
                  </li>
                )
              })}
            </ul>
            <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed text-soft">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Un compte de suivi (PEA, assurance-vie…) garde son solde hors du budget. Ceux sans aucune catégorie dans
              YNAB sont proposés en suivi.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <PreviewStat label="Comptes" value={plan.accounts.length} />
            <PreviewStat label="Catégories" value={plan.categories.length} />
            <PreviewStat label="Transactions" value={plan.transactions.length} />
            <PreviewStat label="Assignations" value={plan.assignments.length} />
            <PreviewStat label="Groupes" value={plan.groups.length} />
            {withTransfers ? (
              <PreviewStat label="Virements reliés" value={plan.transferPairs} />
            ) : (
              <PreviewStat label="Lignes de virement" value={parsed.summary.transferRows} />
            )}
          </div>

          <ul className="space-y-1.5 text-[12.5px] leading-relaxed text-soft">
            {range && (
              <li className="flex items-start gap-2">
                <CalendarRange className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Du {fmtDateNumeric(range.min)} au {fmtDateNumeric(range.max)}, dates lues au format{' '}
                {CONVENTION_LABEL[parsed.summary.dateConvention]}.
              </li>
            )}
            {withTransfers && plan.transferPairs > 0 && (
              <li className="flex items-start gap-2">
                <ArrowLeftRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Les virements entre deux comptes sont reliés : neutres entre comptes budget, catégorisés côté budget
                vers un compte de suivi.
              </li>
            )}
            {!parsed.summary.hasBudget && <li>Sans Budget.csv, les montants assignés ne seront pas importés.</li>}
            {plan.ignored > 0 && <li>{n(plan.ignored)} ligne(s) illisible(s) seront ignorées.</li>}
          </ul>

          {plan.notes.length > 0 && (
            <ul className="space-y-1.5 rounded-2xl bg-warning/10 px-4 py-3 text-[12.5px] leading-relaxed text-ink">
              {plan.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {invalid && (
            <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-[13px] font-medium text-danger">
              Import impossible : {invalid}.
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={reset}>
              Annuler
            </Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={invalid !== null || busy}>
              <Import className="h-4 w-4" />
              Importer et tout remplacer
            </Button>
          </div>
        </div>
      )}

      <ReplaceConfirmDialog
        open={confirmOpen}
        title="Remplacer tes données par l’import YNAB ?"
        confirmLabel="Sauvegarder et remplacer"
        onClose={() => setConfirmOpen(false)}
        onConfirm={(backup) => {
          setConfirmOpen(false)
          if (!plan) return
          const toRun = plan
          setParsed(null)
          setRegisterFile(null)
          setBudgetFile(null)
          void startImport(queryClient, toRun, backup)
        }}
      >
        {plan && (
          <p>
            Import de <strong className="font-semibold tnum">{n(plan.accounts.length)}</strong> compte
            {plan.accounts.length > 1 ? 's' : ''},{' '}
            <strong className="font-semibold tnum">{n(plan.transactions.length)}</strong> transactions et{' '}
            <strong className="font-semibold tnum">{n(plan.assignments.length)}</strong> montants assignés
            {range ? ` (du ${fmtDateNumeric(range.min)} au ${fmtDateNumeric(range.max)})` : ''}.
          </p>
        )}
      </ReplaceConfirmDialog>
    </SettingsCard>
  )
}

function dateRange(dates: string[]): { min: string; max: string } | null {
  let min: string | null = null
  let max: string | null = null
  for (const d of dates) {
    if (!min || d < min) min = d
    if (!max || d > max) max = d
  }
  return min && max ? { min, max } : null
}
