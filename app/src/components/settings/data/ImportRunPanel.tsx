// Suivi d'un remplacement complet (import YNAB ou restauration) : etapes et
// progression pendant l'envoi, reprise apres un echec (sans nouvel
// effacement), bilan a la fin. Lit le store de lib/ynabImport.ts : l'etat
// survit a la navigation dans l'app. Apres le debut de l'effacement, abandonner
// demande confirmation et la sauvegarde de securite reste disponible
// (telechargement et restauration directe).

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArchiveRestore,
  CircleAlert,
  CircleCheck,
  Download,
  PartyPopper,
  RotateCcw,
  ShieldCheck,
  TriangleAlert,
  X,
} from 'lucide-react'
import {
  forgetSafetyBackup,
  resetImport,
  resumeImport,
  startImport,
  useImportStore,
  validatePlan,
  type ImportPlan,
  type ImportResult,
  type ImportStep,
  type SavedFile,
} from '@/lib/ynabImport'
import { useServerFeatures } from '@/lib/data'
import { useBankConnections } from '@/lib/bank'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ProgressBar } from '@/components/shared/ProgressBar'
import { buildBackupPlan, parseBackup, type ParsedBackup } from '@/components/settings/data/backupPlan'
import { fmtSize, saveFile } from '@/components/settings/data/download'
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

type SafetyState =
  | { status: 'loading' }
  | { status: 'ready'; backup: ParsedBackup }
  | { status: 'error'; message: string }

/**
 * Restauration directe de la sauvegarde de securite (prise avant l'effacement) :
 * relecture du fichier en memoire, meme plan et meme orchestrateur qu'une
 * restauration ordinaire. Pas de nouvelle sauvegarde : l'etat courant est
 * l'import incomplet, et la sauvegarde d'origine reste la reference.
 */
function RestoreSafetyDialog({ file, open, onClose }: { file: SavedFile; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const features = useServerFeatures()
  const { data: connections, isPending: connectionsPending } = useBankConnections()
  const [state, setState] = useState<SafetyState>({ status: 'loading' })

  useEffect(() => {
    if (!open) return
    let alive = true
    setState({ status: 'loading' })
    file.blob
      .text()
      .then((text) => alive && setState({ status: 'ready', backup: parseBackup(text) }))
      .catch(
        (e: unknown) =>
          alive && setState({ status: 'error', message: e instanceof Error ? e.message : 'Fichier illisible.' }),
      )
    return () => {
      alive = false
    }
  }, [open, file])

  const plan = useMemo(
    () =>
      state.status === 'ready'
        ? buildBackupPlan(state.backup, {
            transfers: features.has('importTransfers'),
            accountFlags: features.has('accountFlags'),
            refillTargets: features.has('refillTargets'),
            connections,
          })
        : null,
    [state, features, connections],
  )
  const invalid = plan ? validatePlan(plan) : null
  const ready = plan !== null && invalid === null && !connectionsPending

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-8">Restaurer la sauvegarde de sécurité ?</DialogTitle>
          <DialogDescription>
            Ton budget revient à son état d’avant l’import. Ce qui a été importé jusqu’ici est effacé et remplacé.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-2 pt-1">
          <div className="flex items-start gap-3 rounded-2xl bg-surface2/70 px-4 py-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed">
              <p className="truncate font-medium">{file.filename}</p>
              {state.status === 'loading' && <Skeleton className="mt-2 h-3 w-40" />}
              {plan && (
                <p className="text-soft">
                  {fmtSize(file.blob.size)} · <span className="tnum">{n(plan.accounts.length)}</span> compte
                  {plan.accounts.length > 1 ? 's' : ''}, <span className="tnum">{n(plan.transactions.length)}</span>{' '}
                  transactions
                </p>
              )}
            </div>
          </div>
          {plan && plan.notes.length > 0 && (
            <ul className="space-y-1.5 rounded-2xl bg-warning/10 px-4 py-3 text-[12.5px] leading-relaxed text-ink">
              {plan.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {(state.status === 'error' || invalid) && (
            <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-[13px] font-medium text-danger">
              Restauration impossible : {state.status === 'error' ? state.message : `${invalid}.`} Le fichier enregistré
              sur cet appareil reste utilisable depuis « Restaurer une sauvegarde ».
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            variant="danger"
            disabled={!ready}
            onClick={() => {
              if (!plan || !ready) return
              onClose()
              void startImport(queryClient, plan, file)
            }}
          >
            <ArchiveRestore className="h-4 w-4" />
            Restaurer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Confirmation d'abandon d'un import dont l'effacement a commence. */
function AbandonDialog({
  open,
  done,
  total,
  backup,
  onClose,
}: {
  open: boolean
  done: number
  total: number
  backup: SavedFile | null
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="pr-8">Abandonner l’import ?</DialogTitle>
          <DialogDescription>
            Tes anciennes données sont déjà effacées : l’app garde seulement ce qui a été importé jusqu’ici
            {total > 0 ? (
              <>
                {' '}
                (<span className="tnum">{n(done)}</span> transactions sur <span className="tnum">{n(total)}</span>)
              </>
            ) : null}
            .
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-2 pt-1">
          <p className="flex items-start gap-3 rounded-2xl bg-surface2/70 px-4 py-3 text-[13.5px] leading-relaxed">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <span>
              {backup
                ? `La sauvegarde de sécurité reste disponible dans « Sauvegarde et restauration » tant que l’app reste ouverte, et dans le fichier ${backup.filename} enregistré sur cet appareil.`
                : 'La sauvegarde de sécurité enregistrée sur cet appareil se restaure depuis « Restaurer une sauvegarde ».'}
            </span>
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Continuer l’import
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onClose()
              resetImport()
            }}
          >
            Abandonner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Sauvegarde de securite gardee en memoire apres l'abandon d'un import
 * incomplet : telechargement et restauration directe (carte « Sauvegarde et
 * restauration »).
 */
export function SafetyBackupNotice() {
  const phase = useImportStore((s) => s.phase)
  const backup = useImportStore((s) => s.backup)
  const [restoreOpen, setRestoreOpen] = useState(false)
  if (phase !== 'idle' || !backup) return null
  return (
    <div className="animate-fade-up space-y-3 rounded-2xl bg-warning/10 p-4 ring-1 ring-inset ring-warning/20">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-ink">Import abandonné : ton budget est incomplet</p>
          <p className="text-[12.5px] leading-relaxed text-soft">
            La sauvegarde de sécurité prise avant l’effacement ({fmtSize(backup.blob.size)}) ramène tes données à leur
            état d’avant.
          </p>
        </div>
        <Button variant="ghost" size="iconSm" onClick={forgetSafetyBackup} aria-label="Masquer">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => void saveFile(backup)}>
          <Download className="h-4 w-4" />
          Télécharger
        </Button>
        <Button onClick={() => setRestoreOpen(true)}>
          <ArchiveRestore className="h-4 w-4" />
          Restaurer la sauvegarde de sécurité
        </Button>
      </div>
      <RestoreSafetyDialog file={backup} open={restoreOpen} onClose={() => setRestoreOpen(false)} />
    </div>
  )
}

/** Panneau de suivi, affiche dans la carte de la source de l'import. */
export function ImportRunPanel({ source }: { source: 'ynab' | 'backup' }) {
  const queryClient = useQueryClient()
  const { phase, source: runSource, run, progress, error, result, backup } = useImportStore()
  const [abandonOpen, setAbandonOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
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
  // Effacement commence (ou peut-etre commence : begin coupe sans reponse).
  const started = run.wipeStarted
  const txTotal = run.txBatches.reduce((s, b) => s + b.length, 0)
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
                ? run.begin
                  ? 'Tes anciennes données sont effacées et l’import est incomplet. Reprends-le : il repart du lot interrompu, sans rien effacer ni dupliquer. La sauvegarde de sécurité ramène sinon tes données à leur état d’avant.'
                  : 'L’effacement a peut-être commencé avant la coupure. Réessayer relance l’import proprement (l’effacement est simplement refait) ; la sauvegarde de sécurité ramène sinon tes données à leur état d’avant.'
                : 'L’import n’a pas pu démarrer et rien n’a été effacé. Réessayer le relance proprement.'}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button variant="ghost" onClick={() => (started ? setAbandonOpen(true) : resetImport())}>
                Abandonner
              </Button>
              {backupButton}
              {started && backup && (
                <Button variant="outline" onClick={() => setRestoreOpen(true)}>
                  <ArchiveRestore className="h-4 w-4" />
                  Restaurer la sauvegarde
                </Button>
              )}
              <Button onClick={() => void resumeImport(queryClient)}>
                <RotateCcw className="h-4 w-4" />
                {run.begin ? 'Reprendre l’import' : 'Réessayer'}
              </Button>
            </div>
          </div>
        )}
        <AbandonDialog
          open={abandonOpen}
          done={run.insertedTx}
          total={txTotal}
          backup={backup}
          onClose={() => setAbandonOpen(false)}
        />
        {backup && <RestoreSafetyDialog file={backup} open={restoreOpen} onClose={() => setRestoreOpen(false)} />}
      </div>
    </Card>
  )
}
