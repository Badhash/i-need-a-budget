// Suivi d'un remplacement complet (import YNAB ou restauration) : etapes et
// progression pendant l'envoi, reprise apres un echec (sans nouvel
// effacement), bilan a la fin. Lit le store de lib/ynabImport.ts : l'etat
// survit a la navigation dans l'app.

import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Download, PartyPopper, RotateCcw, TriangleAlert, X } from 'lucide-react'
import {
  resetImport,
  resumeImport,
  useImportStore,
  type ImportPlan,
  type ImportResult,
  type ImportStep,
} from '@/lib/ynabImport'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { saveFile } from '@/components/settings/data/download'
import { cn } from '@/lib/utils'

interface Stage {
  id: 'structure' | 'transactions' | 'budget' | 'finish'
  label: string
  hint: string
}

function stagesOf(plan: ImportPlan): Stage[] {
  const stages: Stage[] = [
    { id: 'structure', label: 'Structure', hint: 'Effacement, puis comptes, groupes et catégories' },
    { id: 'transactions', label: 'Transactions', hint: 'Envoi par lots' },
    { id: 'budget', label: 'Budget', hint: 'Montants assignés mois par mois' },
  ]
  const extras = plan.targets.length + plan.rules.length + plan.closeAccounts.length + plan.bankLinks.length
  if (extras > 0) stages.push({ id: 'finish', label: 'Finitions', hint: 'Objectifs, règles, comptes clos, banque' })
  return stages
}

function stageIndex(step: ImportStep): number {
  switch (step) {
    case 'begin':
    case 'startMonth':
      return 0
    case 'transactions':
      return 1
    case 'assignments':
      return 2
    case 'done':
      return 99
    default:
      return 3
  }
}

const n = (v: number) => v.toLocaleString('fr-FR')

function StageList({
  stages,
  current,
  failed,
  detail,
}: {
  stages: Stage[]
  current: number
  failed: boolean
  detail: string | null
}) {
  return (
    <ol className="space-y-1">
      {stages.map((stage, i) => {
        const state = i < current ? 'done' : i === current ? (failed ? 'failed' : 'active') : 'pending'
        return (
          <li key={stage.id} className="flex items-center gap-3 rounded-xl px-1 py-1.5">
            <span
              aria-hidden
              className={cn(
                'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                state === 'done' && 'bg-success/15 text-success',
                state === 'active' && 'bg-accent/15 text-accent-ink dark:text-accent',
                state === 'failed' && 'bg-danger/15 text-danger',
                state === 'pending' && 'bg-surface2 text-soft',
              )}
            >
              {state === 'done' && <CircleCheck className="h-4 w-4" />}
              {state === 'failed' && <CircleAlert className="h-4 w-4" />}
              {state === 'active' && (
                <>
                  <span className="absolute inset-0 animate-ping rounded-full bg-accent/25" />
                  <span className="h-2 w-2 rounded-full bg-accent" />
                </>
              )}
              {state === 'pending' && <span className="h-1.5 w-1.5 rounded-full bg-soft/50" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn('text-[14px] font-medium', state === 'pending' ? 'text-soft' : 'text-ink')}>
                {stage.label}
              </p>
              <p className="truncate text-[12px] text-soft">{stage.hint}</p>
            </div>
            {i === current && detail && (
              <span className="shrink-0 text-[12.5px] font-medium text-soft tnum">{detail}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface2/70 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-soft">{label}</p>
      <p className="mt-0.5 text-[18px] font-semibold tracking-tight tnum">{n(value)}</p>
    </div>
  )
}

function ResultStats({ result }: { result: ImportResult }) {
  const stats: [string, number][] = [
    ['Comptes', result.accounts],
    ['Catégories', result.categories],
    ['Transactions', result.transactions],
    ['Assignations', result.assignments],
  ]
  if (result.transferPairs > 0) stats.push(['Virements', result.transferPairs])
  if (result.targets > 0) stats.push(['Objectifs', result.targets])
  if (result.rules > 0) stats.push(['Règles', result.rules])
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {stats.map(([label, value]) => (
        <Stat key={label} label={label} value={value} />
      ))}
    </div>
  )
}

/** Panneau de suivi, affiche dans la carte de la source de l'import. */
export function ImportRunPanel({ source }: { source: 'ynab' | 'backup' }) {
  const queryClient = useQueryClient()
  const { phase, source: runSource, run, progress, error, result, backup } = useImportStore()
  if (phase === 'idle' || runSource !== source) return null

  // Echec de validation (aucun envoi) : simple message.
  if (!run) {
    return (
      <Card className="animate-fade-up border-danger/25 p-5" role="alert">
        <div className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
          <p className="flex-1 text-[14px] leading-relaxed">{error}</p>
          <Button variant="ghost" size="iconSm" onClick={resetImport} aria-label="Fermer">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </Card>
    )
  }

  const stages = stagesOf(run.plan)
  const current = stageIndex(progress?.step ?? run.step)
  const pct = progress?.pct ?? 0
  const detail =
    progress && progress.total > 0 && progress.step !== 'done' ? `${n(progress.done)} / ${n(progress.total)}` : null
  const backupButton = backup && (
    <Button variant="outline" onClick={() => void saveFile(backup)}>
      <Download className="h-4 w-4" />
      Sauvegarde de sécurité
    </Button>
  )

  if (phase === 'done' && result) {
    return (
      <Card variant="hero" tone="success" className="animate-fade-up p-5 lg:p-6" aria-live="polite">
        <div className="space-y-5">
          <div className="flex items-start gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-success/15 text-success shadow-highlight">
              <PartyPopper className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[18px] font-semibold tracking-tight">
                {source === 'ynab' ? 'Import terminé' : 'Sauvegarde restaurée'}
              </p>
              <p className="text-[13px] text-soft">Ton budget est prêt : toutes les pages sont à jour.</p>
            </div>
          </div>
          <ResultStats result={result} />
          {(result.notes.length > 0 ||
            result.lostCategorizations > 0 ||
            result.lostAssignments > 0 ||
            result.ignored > 0) && (
            <ul className="space-y-1.5 rounded-2xl bg-warning/10 px-4 py-3 text-[13px] leading-relaxed text-ink">
              {result.ignored > 0 && <li>{n(result.ignored)} ligne(s) illisible(s) ignorée(s).</li>}
              {result.lostCategorizations > 0 && (
                <li>{n(result.lostCategorizations)} transaction(s) importée(s) sans catégorie.</li>
              )}
              {result.lostAssignments > 0 && <li>{n(result.lostAssignments)} assignation(s) non appliquée(s).</li>}
              {result.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {source === 'ynab' && (
            <p className="text-[13px] text-soft">
              Pense à réassocier tes comptes bancaires dans la section « Banque » pour reprendre la synchronisation.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            {backupButton}
            <Button onClick={resetImport}>Terminé</Button>
          </div>
        </div>
      </Card>
    )
  }

  const failed = phase === 'failed'
  const started = run.begin !== null
  return (
    <Card variant="hero" tone={failed ? 'warning' : 'accent'} className="animate-fade-up p-5 lg:p-6" aria-live="polite">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="label-caps">
              {failed ? 'Import interrompu' : source === 'ynab' ? 'Import en cours' : 'Restauration en cours'}
            </p>
            <p className="mt-1 num-hero text-ink">
              {pct}
              <span className="text-[0.55em] font-medium text-soft"> %</span>
            </p>
          </div>
          {failed ? (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-warning/15 text-warning">
              <TriangleAlert className="h-5 w-5" />
            </span>
          ) : (
            <p className="max-w-[12rem] text-right text-[12.5px] leading-snug text-soft">
              Garde l’app ouverte jusqu’à la fin de l’envoi.
            </p>
          )}
        </div>
        <ProgressBar
          value={pct / 100}
          tone={failed ? 'warning' : 'accent'}
          animateOnMount={false}
          label="Progression de l’import"
        />
        <StageList stages={stages} current={current} failed={failed} detail={detail} />
        {failed && (
          <div className="space-y-3 border-t border-line/70 pt-4">
            <p className="text-[14px] font-medium text-ink">{error}</p>
            <p className="text-[13px] leading-relaxed text-soft">
              {started
                ? 'Tes anciennes données sont effacées et l’import est incomplet. Reprends-le : il repart du lot interrompu, sans rien effacer ni dupliquer.'
                : 'L’import n’a pas pu démarrer. Réessayer le relance proprement (un effacement commencé est simplement refait).'}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button variant="ghost" onClick={resetImport}>
                Abandonner
              </Button>
              {backupButton}
              <Button onClick={() => void resumeImport(queryClient)}>
                <RotateCcw className="h-4 w-4" />
                {started ? 'Reprendre l’import' : 'Réessayer'}
              </Button>
            </div>
            {started && (
              <p className="text-[12px] leading-relaxed text-soft">
                En cas d’abandon, la sauvegarde de sécurité se restaure depuis « Restaurer une sauvegarde ».
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
