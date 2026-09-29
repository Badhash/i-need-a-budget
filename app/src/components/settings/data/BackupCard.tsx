// Sauvegarde et restauration (Reglages > Donnees). Exporter : tout le budget
// dechiffre en JSON (action exportData), enregistre sur l'appareil. Restaurer :
// lecture locale d'un de ces fichiers -> apercu (ce qui revient, ce qui ne
// revient pas) -> meme confirmation et meme sauvegarde de securite que
// l'import YNAB -> remplacement complet reprenable (lib/ynabImport.ts).

import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, CalendarRange, Check, DatabaseBackup, Download, FileJson } from 'lucide-react'
import { startImport, useImportStore, validatePlan, type SavedFile } from '@/lib/ynabImport'
import { useServerFeatures } from '@/lib/data'
import { useBankConnections } from '@/lib/bank'
import { fmtDateNumeric, fmtRelativeTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { SettingsCard } from '@/components/settings/shared/SettingsCard'
import { FileDrop } from '@/components/settings/data/FileDrop'
import { ImportRunPanel } from '@/components/settings/data/ImportRunPanel'
import { ReplaceConfirmDialog } from '@/components/settings/data/ReplaceConfirmDialog'
import { buildBackupPlan, parseBackup, type ParsedBackup } from '@/components/settings/data/backupPlan'
import { LAST_BACKUP_EVENT, fetchBackup, fmtSize, readLastBackup, saveFile } from '@/components/settings/data/download'

const n = (v: number) => v.toLocaleString('fr-FR')

/** Date de la derniere sauvegarde sur cet appareil (se met a jour seule). */
export function useLastBackup(): string | null {
  const [last, setLast] = useState(readLastBackup)
  useEffect(() => {
    const update = () => setLast(readLastBackup())
    window.addEventListener(LAST_BACKUP_EVENT, update)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener(LAST_BACKUP_EVENT, update)
      window.removeEventListener('storage', update)
    }
  }, [])
  return last
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface2/70 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-soft">{label}</p>
      <p className="mt-0.5 text-[17px] font-semibold tracking-tight tnum">{n(value)}</p>
    </div>
  )
}

function fmtExportedAt(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function BackupCard() {
  const queryClient = useQueryClient()
  const features = useServerFeatures()
  const { data: connections } = useBankConnections()
  const phase = useImportStore((s) => s.phase)
  const runSource = useImportStore((s) => s.source)
  const busy = phase === 'running'
  const ownRun = phase !== 'idle' && runSource === 'backup'
  const lastBackup = useLastBackup()

  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<SavedFile | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [backup, setBackup] = useState<ParsedBackup | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const plan = useMemo(
    () =>
      backup
        ? buildBackupPlan(backup, {
            transfers: features.has('importTransfers'),
            accountFlags: features.has('accountFlags'),
            refillTargets: features.has('refillTargets'),
            connections,
          })
        : null,
    [backup, features, connections],
  )
  const invalid = plan ? validatePlan(plan) : null

  async function onExport() {
    setExportError(null)
    setExporting(true)
    try {
      const saved = await fetchBackup('sauvegarde')
      setExported(saved)
      await saveFile(saved)
    } catch {
      setExportError('L’export a échoué, réessaie.')
    } finally {
      setExporting(false)
    }
  }

  async function onPick(picked: File | null) {
    setFile(picked)
    setBackup(null)
    setReadError(null)
    if (!picked) return
    try {
      setBackup(parseBackup(await picked.text()))
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'Fichier illisible.')
    }
  }

  const relative = lastBackup ? fmtRelativeTime(lastBackup) : null

  return (
    <SettingsCard
      icon={DatabaseBackup}
      tone="accent"
      title="Sauvegarde et restauration"
      description="Tout ton budget déchiffré dans un fichier JSON, à garder en lieu sûr. Il se restaure ici en quelques secondes."
      contentClassName="space-y-4"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl bg-surface2/60 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium">Exporter mes données</p>
          <p className="text-[12.5px] text-soft">
            {relative
              ? `Dernière sauvegarde sur cet appareil ${relative}.`
              : 'Aucune sauvegarde enregistrée sur cet appareil.'}
          </p>
        </div>
        <Button onClick={() => void onExport()} disabled={exporting} className="w-full sm:w-auto">
          <Download className="h-4 w-4" />
          {exporting ? 'Préparation…' : 'Exporter (JSON)'}
        </Button>
        {exported && !exporting && (
          <div className="flex w-full flex-wrap items-center gap-2 border-t border-line/70 pt-3 text-[12.5px]">
            <Check className="h-4 w-4 shrink-0 text-success" />
            <span className="min-w-0 flex-1 truncate text-soft">
              {exported.filename} · {fmtSize(exported.blob.size)}
            </span>
            <Button variant="link" size="sm" onClick={() => void saveFile(exported)}>
              Enregistrer à nouveau
            </Button>
          </div>
        )}
        {exportError && <p className="w-full text-[13px] font-medium text-danger">{exportError}</p>}
      </div>

      <ImportRunPanel source="backup" />

      {!ownRun && (
        <div className="space-y-3">
          <FileDrop
            label="Restaurer une sauvegarde"
            hint="Fichier .json exporté depuis l’app · remplace tout"
            accept=".json,application/json"
            icon={ArchiveRestore}
            file={file}
            disabled={busy}
            onPick={(f) => void onPick(f)}
          />
          {readError && (
            <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-[13px] font-medium text-danger">
              {readError}
            </p>
          )}
        </div>
      )}

      {backup && plan && !ownRun && (
        <div className="animate-fade-up space-y-4 rounded-2xl border border-edge p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent-ink dark:text-accent">
              <FileJson className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <p className="text-[14.5px] font-semibold">
                {fmtExportedAt(backup.exportedAt) ? `Sauvegarde du ${fmtExportedAt(backup.exportedAt)}` : 'Sauvegarde'}
              </p>
              {backup.dateRange && (
                <p className="flex items-center gap-1.5 text-[12.5px] text-soft">
                  <CalendarRange className="h-3.5 w-3.5" />
                  Transactions du {fmtDateNumeric(backup.dateRange.min)} au {fmtDateNumeric(backup.dateRange.max)}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Comptes" value={plan.accounts.length} />
            <Stat label="Catégories" value={plan.categories.length} />
            <Stat label="Transactions" value={plan.transactions.length} />
            <Stat label="Assignations" value={plan.assignments.length} />
            <Stat label="Objectifs" value={plan.targets.length} />
            <Stat label="Règles" value={plan.rules.length} />
          </div>
          {(plan.notes.length > 0 || plan.ignored > 0) && (
            <ul className="space-y-1.5 rounded-2xl bg-warning/10 px-4 py-3 text-[12.5px] leading-relaxed text-ink">
              {plan.ignored > 0 && <li>{n(plan.ignored)} élément(s) illisible(s) ignoré(s).</li>}
              {plan.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {invalid && (
            <p role="alert" className="rounded-2xl bg-danger/10 px-4 py-3 text-[13px] font-medium text-danger">
              Restauration impossible : {invalid}.
            </p>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                setFile(null)
                setBackup(null)
              }}
            >
              Annuler
            </Button>
            <Button variant="danger" onClick={() => setConfirmOpen(true)} disabled={invalid !== null || busy}>
              <ArchiveRestore className="h-4 w-4" />
              Restaurer et tout remplacer
            </Button>
          </div>
        </div>
      )}

      <ReplaceConfirmDialog
        open={confirmOpen}
        title="Restaurer cette sauvegarde ?"
        confirmLabel="Sauvegarder et restaurer"
        onClose={() => setConfirmOpen(false)}
        onConfirm={(safety) => {
          setConfirmOpen(false)
          if (!plan) return
          const toRun = plan
          setFile(null)
          setBackup(null)
          void startImport(queryClient, toRun, safety)
        }}
      >
        {plan && (
          <p>
            Retour à l’état de la sauvegarde
            {fmtExportedAt(backup?.exportedAt ?? null) ? ` du ${fmtExportedAt(backup?.exportedAt ?? null)}` : ''} :{' '}
            <strong className="font-semibold tnum">{n(plan.accounts.length)}</strong> compte
            {plan.accounts.length > 1 ? 's' : ''} et{' '}
            <strong className="font-semibold tnum">{n(plan.transactions.length)}</strong> transactions.
          </p>
        )}
      </ReplaceConfirmDialog>
    </SettingsCard>
  )
}
