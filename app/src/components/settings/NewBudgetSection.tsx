import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, RotateCcw } from 'lucide-react'
import { apiNewBudget, useBootstrap } from '@/lib/data'
import { addMonths, currentMonth, fmtMonthLong, fmtMonthTitle } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useSheetKeyboardInset } from '@/hooks/useKeyboardInset'
import { SettingsCard } from '@/components/settings/shared/SettingsCard'

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
  const keyboardInset = useSheetKeyboardInset()
  const currentStart = boot.data?.budgetStartMonth ?? null

  const thisMonth = currentMonth()
  const nextMonth = addMonths(thisMonth, 1)
  const [startMonth, setStartMonth] = useState(thisMonth)
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setError(null)
    setBusy(true)
    try {
      const res = await apiNewBudget(startMonth)
      setOpen(false)
      setConfirm('')
      setMonth(res.budgetStartMonth)
      toast({
        message: `Nouveau budget démarré en ${fmtMonthLong(res.budgetStartMonth)}`,
        description: 'Il ne reste qu’à assigner ton Prêt à assigner.',
        tone: 'success',
      })
      // Operation exceptionnelle : assignations de tous les mois, budget de
      // chaque mois, compteur du badge et rapports sont obsoletes (les
      // transactions, comptes et regles, eux, ne bougent pas).
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['budget'] }),
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
      ])
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setError(
        msg.includes('user_settings')
          ? 'Le script SQL M-user-settings.sql n’est pas encore appliqué dans Supabase.'
          : 'Le nouveau budget a échoué, réessaie.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsCard
      icon={RotateCcw}
      title="Nouveau budget"
      description="Repars de zéro sans rien perdre : comptes, transactions, catégories, règles et objectifs restent. Seules les assignations sont effacées ; le Prêt à assigner du mois de départ vaut le solde de tes comptes budget au 1er du mois."
      contentClassName="space-y-4"
    >
      {currentStart && (
        <p className="flex items-center gap-2 rounded-xl bg-surface2/70 px-3.5 py-2.5 text-[13px]">
          <CalendarCheck className="h-4 w-4 shrink-0 text-soft" />
          <span>
            Budget actuel démarré en <span className="font-semibold">{fmtMonthLong(currentStart)}</span> ; les mois
            précédents sont gelés.
          </span>
        </p>
      )}
      <div className="space-y-2">
        <p className="label-caps">Mois de départ</p>
        <SegmentedControl
          block
          aria-label="Mois de départ"
          value={startMonth}
          onChange={setStartMonth}
          options={[
            { value: thisMonth, label: fmtMonthTitle(thisMonth) },
            { value: nextMonth, label: fmtMonthTitle(nextMonth) },
          ]}
          className="max-w-md"
        />
        <p className="text-[12.5px] leading-relaxed text-soft">
          {startMonth === thisMonth
            ? 'Les dépenses déjà passées ce mois-ci restent dans leurs enveloppes, à couvrir en assignant.'
            : 'Le mois en cours est gelé avec le reste de l’historique : le budget démarre propre le mois prochain.'}
        </p>
      </div>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={boot.isLoading} className="w-full sm:w-auto">
        <RotateCcw className="h-4 w-4" />
        Démarrer un nouveau budget
      </Button>
      {error && <p className="text-[13px] font-medium text-danger">{error}</p>}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent style={keyboardInset > 0 ? { transform: `translateY(-${keyboardInset}px)` } : undefined}>
          <DialogHeader>
            <DialogTitle className="pr-8">Démarrer un nouveau budget en {fmtMonthLong(startMonth)} ?</DialogTitle>
            <DialogDescription>
              Toutes les assignations de tous les mois seront effacées, définitivement. Les transactions, comptes,
              catégories, règles et objectifs ne bougent pas. Exporte une sauvegarde juste au-dessus si tu veux garder
              une trace des assignations.
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 pb-2">
            <label className="block text-[13px]">
              Tape <span className="font-semibold">{CONFIRM_WORD}</span> pour confirmer
              <Input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                className="mt-1.5"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Annuler
            </Button>
            <Button
              variant="danger"
              onClick={() => void run()}
              disabled={busy || confirm.trim().toUpperCase() !== CONFIRM_WORD}
            >
              <RotateCcw className="h-4 w-4" />
              {busy ? 'En cours…' : 'Effacer les assignations et démarrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  )
}
