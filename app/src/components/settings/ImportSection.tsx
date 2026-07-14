import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, FileUp, Loader2, Upload } from 'lucide-react'
import { apiCall } from '@/lib/api'
import {
  parseYnabExport,
  runYnabImport,
  type ImportSummary,
  type ParsedImport,
} from '@/lib/ynabImport'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const CONVENTION_LABEL: Record<ParsedImport['summary']['dateConvention'], string> = {
  DMY: 'jour/mois/année (format français)',
  MDY: 'mois/jour/année (format américain)',
  ISO: 'année-mois-jour (ISO)',
}

// Selecteur de fichier stylise (l'input natif reste cache pour un rendu propre).
function FilePicker({
  label,
  hint,
  file,
  onPick,
}: {
  label: string
  hint: string
  file: File | null
  onPick: (f: File | null) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-1.5">
      <p className="label-caps">{label}</p>
      <div className="flex flex-wrap items-center gap-2.5">
        <input
          ref={ref}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
        <Button
          variant="outline"
          onClick={() => ref.current?.click()}
          className="min-h-[44px]"
        >
          <FileUp className="h-4 w-4" />
          Choisir un fichier
        </Button>
        <span className="min-w-0 flex-1 truncate text-[13px] text-soft">
          {file ? file.name : hint}
        </span>
      </div>
    </div>
  )
}

export function ImportSection() {
  const queryClient = useQueryClient()
  const [registerFile, setRegisterFile] = useState<File | null>(null)
  const [budgetFile, setBudgetFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<{ pct: number; text: string } | null>(null)
  const [result, setResult] = useState<ImportSummary | null>(null)
  // Verrou SYNCHRONE contre le double-declenchement (un second clic rapide ne
  // doit jamais lancer un deuxieme effacement concurrent).
  const importingRef = useRef(false)

  function reset() {
    setParsed(null)
    setResult(null)
    setError(null)
    setProgress(null)
  }

  // Sauvegarde de securite AVANT tout effacement : telecharge un JSON complet de
  // l'etat actuel (donnees dechiffrees). Si l'export echoue, l'appelant abandonne
  // l'import sans rien detruire.
  async function downloadSafetyBackup() {
    const data = await apiCall<unknown>('exportData')
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    a.download = `inab-sauvegarde-avant-import-${stamp}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function handleAnalyze() {
    if (!registerFile) return
    setError(null)
    setResult(null)
    setAnalyzing(true)
    try {
      const registerText = await registerFile.text()
      const budgetText = budgetFile ? await budgetFile.text() : undefined
      const p = parseYnabExport(registerText, budgetText)
      if (p.transactions.length === 0) {
        setError('Aucune transaction lisible dans Register.csv. Vérifie le fichier.')
        setParsed(null)
      } else {
        setParsed(p)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible d'analyser les fichiers.")
      setParsed(null)
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleImport() {
    if (!parsed) return
    if (importingRef.current) return // garde anti double-declenchement
    importingRef.current = true
    setConfirmOpen(false)
    setImporting(true)
    setError(null)
    setProgress({ pct: 0, text: 'Sauvegarde de sécurité...' })
    try {
      // 1) Sauvegarde AVANT effacement. Si elle echoue, on n'efface rien.
      await downloadSafetyBackup()
      // 2) Import (valide toute la forme avant le moindre wipe, puis efface + ecrit).
      const summary = await runYnabImport(parsed, (pct, text) => setProgress({ pct, text }))
      setResult(summary)
      setParsed(null)
      setRegisterFile(null)
      setBudgetFile(null)
      // Import destructif : tout le cache est obsolete, on invalide tout.
      await queryClient.invalidateQueries()
    } catch (e) {
      setError(
        e instanceof Error
          ? `L'import a échoué : ${e.message} Si l'effacement avait déjà commencé, relance l'analyse puis réessaie pour terminer.`
          : "L'import a échoué. Réessaie.",
      )
    } finally {
      setImporting(false)
      setProgress(null)
      importingRef.current = false
    }
  }

  const range = parsed?.summary.dateRange

  return (
    <Card>
      <CardHeader>
        <CardTitle>Importer depuis YNAB</CardTitle>
        <p className="text-[13px] text-soft">
          Importe l'« Export budget » de YNAB (fichiers CSV décompressés). Register.csv est requis,
          Budget.csv est optionnel (il apporte les montants assignés par mois).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3 rounded-xl border border-line p-4">
          <FilePicker
            label="Register.csv (requis)"
            hint="Transactions et comptes"
            file={registerFile}
            onPick={(f) => {
              setRegisterFile(f)
              reset()
            }}
          />
          <FilePicker
            label="Budget.csv (optionnel)"
            hint="Montants assignés par mois"
            file={budgetFile}
            onPick={(f) => {
              setBudgetFile(f)
              reset()
            }}
          />
          <Button
            onClick={() => void handleAnalyze()}
            disabled={!registerFile || analyzing || importing}
            className="min-h-[44px] w-full sm:w-auto"
          >
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Analyser
          </Button>
        </div>

        {error && <p className="text-[13px] font-medium text-danger">{error}</p>}

        {parsed && !importing && !result && (
          <div className="space-y-3 rounded-xl border border-line p-4">
            <p className="label-caps">Aperçu</p>
            <div className="grid grid-cols-2 gap-2 text-[13.5px] sm:grid-cols-3">
              <PreviewStat label="Comptes" value={parsed.accounts.length} />
              <PreviewStat label="Groupes" value={parsed.groups.length} />
              <PreviewStat label="Catégories" value={parsed.categories.length} />
              <PreviewStat label="Transactions" value={parsed.transactions.length} />
              <PreviewStat label="Assignations" value={parsed.assignments.length} />
            </div>
            <div className="space-y-1 border-t border-line/60 pt-3 text-[12.5px] text-soft">
              {range && (
                <p>
                  Période : du {range.min} au {range.max}.
                </p>
              )}
              <p>Dates interprétées au format {CONVENTION_LABEL[parsed.summary.dateConvention]}.</p>
              {!parsed.summary.hasBudget && (
                <p>Aucun Budget.csv : les montants assignés ne seront pas importés.</p>
              )}
              {parsed.summary.ignoredCount > 0 && (
                <p>{parsed.summary.ignoredCount} ligne(s) illisible(s) seront ignorées.</p>
              )}
            </div>
            <Button
              variant="danger"
              onClick={() => setConfirmOpen(true)}
              className="min-h-[44px] w-full sm:w-auto"
            >
              <AlertTriangle className="h-4 w-4" />
              Importer et TOUT REMPLACER
            </Button>
          </div>
        )}

        {importing && progress && (
          <div className="space-y-2 rounded-xl border border-line p-4">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-ink">{progress.text}</span>
              <span className="text-soft tnum">{progress.pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface2">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${progress.pct}%` }}
              />
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-2 rounded-xl border border-success/30 bg-success/10 p-4">
            <p className="text-[14px] font-semibold text-ink">Import terminé</p>
            <div className="grid grid-cols-2 gap-2 text-[13.5px] sm:grid-cols-3">
              <PreviewStat label="Comptes" value={result.comptes} />
              <PreviewStat label="Groupes" value={result.groupes} />
              <PreviewStat label="Catégories" value={result.categories} />
              <PreviewStat label="Transactions" value={result.transactions} />
              <PreviewStat label="Assignations" value={result.assignations} />
            </div>
            {result.lignesIgnorees > 0 && (
              <p className="text-[12.5px] text-soft">
                {result.lignesIgnorees} ligne(s) ignorée(s).
              </p>
            )}
            {(result.categorisationsPerdues > 0 || result.assignationsPerdues > 0) && (
              <p className="text-[12.5px] font-medium text-warning">
                {result.categorisationsPerdues > 0 &&
                  `${result.categorisationsPerdues} transaction(s) importée(s) sans catégorie. `}
                {result.assignationsPerdues > 0 &&
                  `${result.assignationsPerdues} assignation(s) non appliquée(s).`}
              </p>
            )}
            <p className="text-[12.5px] text-soft">
              Une sauvegarde de tes données précédentes a été téléchargée avant l'import.
            </p>
            <p className="text-[12.5px] text-soft">
              Pense à réassocier tes comptes bancaires dans la section « Connexion bancaire ».
            </p>
          </div>
        )}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remplacer toutes tes données ?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-1">
                <p>
                  Cet import <strong className="text-danger">efface définitivement</strong> tous tes
                  comptes, catégories, transactions et budget actuels, et les remplace par le contenu
                  de ton export YNAB.
                </p>
                <p>Ta connexion bancaire (Enable Banking) est conservée.</p>
                <p className="font-medium text-ink">Cette action est irréversible.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col-reverse gap-2 p-5 pt-2 sm:flex-row sm:justify-end">
            <DialogClose asChild>
              <Button variant="outline" className="min-h-[44px]">
                Annuler
              </Button>
            </DialogClose>
            <Button
              variant="danger"
              onClick={() => void handleImport()}
              disabled={importing}
              className="min-h-[44px]"
            >
              Effacer et importer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function PreviewStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface2 px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-soft">{label}</p>
      <p className="text-[16px] font-semibold tnum">{value.toLocaleString('fr-FR')}</p>
    </div>
  )
}
