import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, RotateCcw } from 'lucide-react'
import { apiNewBudget, useBootstrap } from '@/lib/data'
import { addMonths, CURRENT_MONTH, fmtMonthLong } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const CONFIRM_WORD = 'NOUVEAU'

// « Nouveau budget » : le budget repart de zero a partir d'un mois choisi.
// Tout est conserve (comptes, transactions, categories, regles, objectifs,
// connexions bancaires) ; seules les assignations sont effacees. L'historique
// anterieur au mois de depart est gele et devient un solde de depart verse au
// Pret a assigner, qui vaut alors exactement le solde des comptes budget.
export function NewBudgetSection() {
  const queryClient = useQueryClient()
  const boot = useBootstrap()
  const setMonth = useUiStore((s) => s.setMonth)
  const currentStart = boot.data?.budgetStartMonth ?? null

  const options = [CURRENT_MONTH, addMonths(CURRENT_MONTH, 1)]
  const [startMonth, setStartMonth] = useState(CURRENT_MONTH)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function run() {
    setError(null)
    setBusy(true)
    try {
      const res = await apiNewBudget(startMonth)
      setDone(res.budgetStartMonth)
      setOpen(false)
      setConfirm('')
      setMonth(res.budgetStartMonth)
      // Operation exceptionnelle et destructive : tout le cache est obsolete
      // (assignations, budget de chaque mois, compteur du badge).
      await queryClient.invalidateQueries()
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        msg.includes('user_settings')
          ? "Le script SQL M-user-settings.sql n'est pas encore appliqué dans Supabase."
          : 'Le nouveau budget a échoué, réessaie.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nouveau budget</CardTitle>
        <p className="text-[13px] text-soft">
          Repars de zéro sur la page Budget sans rien perdre : comptes, transactions,
          catégories, règles et objectifs sont conservés. Toutes les assignations sont
          effacées et le Prêt à assigner du mois de départ vaut exactement le solde de tes
          comptes budget au 1er de ce mois.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentStart && (
          <p className="rounded-xl bg-surface2 px-3.5 py-2.5 text-[13px]">
            Budget actuel démarré en <span className="font-semibold">{fmtMonthLong(currentStart)}</span>.
            Les mois précédents sont gelés.
          </p>
        )}
        <div>
          <p className="label-caps mb-2">Mois de départ</p>
          <div className="grid max-w-md grid-cols-2 gap-1 rounded-xl bg-surface2 p-1">
            {options.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setStartMonth(m)}
                aria-pressed={startMonth === m}
                className={cn(
                  'h-10 rounded-lg px-2 text-[13.5px] font-medium capitalize transition-colors',
                  startMonth === m ? 'bg-surface text-ink shadow-sm' : 'text-soft hover:text-ink',
                )}
              >
                {fmtMonthLong(m)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-soft">
            {startMonth === CURRENT_MONTH
              ? 'Les dépenses déjà passées ce mois-ci restent dans leurs enveloppes, à couvrir en assignant.'
              : 'Le mois en cours est gelé avec le reste de l’historique, le budget démarre propre le mois prochain.'}
          </p>
        </div>
        <Button variant="outline" onClick={() => setOpen(true)} disabled={boot.isLoading}>
          <RotateCcw className="h-4 w-4" />
          Démarrer un nouveau budget
        </Button>
        {done && (
          <p className="text-[13px] font-medium text-success">
            Nouveau budget démarré en {fmtMonthLong(done)}. Il ne reste qu’à assigner.
          </p>
        )}
        {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Démarrer un nouveau budget en {fmtMonthLong(startMonth)} ?</DialogTitle>
            <DialogDescription>
              Toutes les assignations de tous les mois seront effacées, définitivement. Les
              transactions, comptes, catégories, règles et objectifs ne bougent pas. Pense à
              exporter tes données juste au-dessus si tu veux garder une trace des assignations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block text-[13px]">
              Tape <span className="font-semibold">{CONFIRM_WORD}</span> pour confirmer
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                className="mt-1.5 h-11 w-full rounded-xl border border-line bg-surface px-3 text-[15px] outline-none focus:ring-2 focus:ring-accent/40"
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Annuler
              </Button>
              <Button
                variant="danger"
                onClick={() => void run()}
                disabled={busy || confirm.trim().toUpperCase() !== CONFIRM_WORD}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                Effacer les assignations et démarrer
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
