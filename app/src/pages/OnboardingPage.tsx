import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Landmark, Sparkles } from 'lucide-react'
import { apiCreateAccount, apiSeedDefaults, useBootstrap } from '@/lib/data'
import type { AccountKind } from '@/types/domain'
import { TODAY } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const MIN_DATE = '2026-01-01'

function parseEuros(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return 0
  const parsed = Number.parseFloat(trimmed.replace(/\s/g, '').replace(',', '.'))
  if (Number.isNaN(parsed) || parsed < 0) return null
  return Math.round(parsed * 100)
}

/** Etat vide apres login : initialise la taxonomie puis cree un premier compte. */
export function OnboardingPage() {
  const queryClient = useQueryClient()
  const boot = useBootstrap()
  const hasCategories = (boot.data?.categories.length ?? 0) > 0

  const [name, setName] = useState('Compte courant')
  const [institution, setInstitution] = useState('Ma banque')
  const [kind, setKind] = useState<AccountKind>('checking')
  const [onBudget, setOnBudget] = useState(true)
  const [balance, setBalance] = useState('')
  const [openingDate, setOpeningDate] = useState(TODAY)
  const [error, setError] = useState<string | null>(null)

  // Onboarding : le cache est quasi vide, l'impact est negligeable, mais on
  // scope par coherence (le seed cree la taxonomie ; creer un compte ajoute un
  // solde d'ouverture qui touche transactions/budget/rapports).
  const seed = useMutation({
    mutationFn: apiSeedDefaults,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['budget'] }),
      ]),
  })

  const createAccount = useMutation({
    mutationFn: apiCreateAccount,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['budget'] }),
        queryClient.invalidateQueries({ queryKey: ['reports'] }),
      ]),
  })

  const submitAccount = () => {
    if (!name.trim() || !institution.trim()) {
      setError('Renseignez le nom du compte et la banque.')
      return
    }
    const cents = parseEuros(balance)
    if (cents === null) {
      setError('Saisissez un solde valide, par exemple 1234,56.')
      return
    }
    if (openingDate < MIN_DATE || openingDate > TODAY) {
      setError("La date d'ouverture doit être antérieure ou égale à aujourd'hui.")
      return
    }
    setError(null)
    createAccount.mutate({
      name: name.trim(),
      institution: institution.trim(),
      kind,
      onBudget,
      openingBalance: cents,
      openingDate,
    })
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 py-4">
      <div className="text-center">
        <h1 className="text-[26px] font-semibold">Bienvenue</h1>
        <p className="mt-1 text-[14px] text-soft">
          Deux étapes pour préparer votre budget par enveloppes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-accent">
              {hasCategories ? <Check className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
            </span>
            1. Catégories
          </CardTitle>
          <p className="text-[13px] text-soft">
            Créez un jeu de groupes et catégories par défaut (modifiable ensuite).
          </p>
        </CardHeader>
        <CardContent>
          {hasCategories ? (
            <p className="text-[13.5px] font-medium text-success">Catégories initialisées.</p>
          ) : (
            <>
              <Button onClick={() => seed.mutate()} disabled={seed.isPending}>
                <Sparkles className="h-4 w-4" />
                {seed.isPending ? 'Initialisation…' : 'Initialiser mes catégories'}
              </Button>
              {seed.isError && (
                <p className="mt-2 text-[13px] font-medium text-danger">
                  Impossible d'initialiser les catégories. Réessayez.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Landmark className="h-4 w-4" />
            </span>
            2. Premier compte
          </CardTitle>
          <p className="text-[13px] text-soft">
            Saisissez le solde d'ouverture à la date d'activation.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="label-caps mb-1.5 block">Nom du compte</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Compte courant" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps mb-1.5 block">Banque</label>
              <Input
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                placeholder="Ma banque"
              />
            </div>
            <div>
              <label className="label-caps mb-1.5 block">Type</label>
              <Select value={kind} onChange={(e) => setKind(e.target.value as AccountKind)}>
                <option value="checking">Compte courant</option>
                <option value="savings">Épargne</option>
                <option value="investment">Investissement</option>
                <option value="card_deferred">Carte à débit différé</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label-caps mb-1.5 block">Solde d'ouverture (€)</label>
              <Input
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                placeholder="0,00"
                inputMode="decimal"
                className="text-right tnum"
              />
            </div>
            <div>
              <label className="label-caps mb-1.5 block">Date d'ouverture</label>
              <Input
                type="date"
                value={openingDate}
                min={MIN_DATE}
                max={TODAY}
                onChange={(e) => setOpeningDate(e.target.value)}
              />
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-[14px]">
            <input
              type="checkbox"
              checked={onBudget}
              onChange={(e) => setOnBudget(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            Compte inclus dans le budget
          </label>

          {error && <p className="text-[13px] font-medium text-danger">{error}</p>}

          <Button
            className="w-full"
            onClick={submitAccount}
            disabled={!hasCategories || createAccount.isPending}
          >
            {createAccount.isPending ? 'Création…' : 'Créer le compte et commencer'}
          </Button>
          {!hasCategories && (
            <p className="text-center text-[12.5px] text-soft">
              Initialisez d'abord les catégories.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
