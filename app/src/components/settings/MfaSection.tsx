// Authentification a deux facteurs (TOTP, Supabase Auth) : activation par QR
// code + code de verification, desactivation. L'etat (facteur verifie) est une
// requete partagee avec le heros de la page (useMfaStatus).

import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, ShieldCheck, ShieldOff } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'
import { Medallion } from '@/components/settings/shared/SettingsCard'

const MFA_KEY = ['mfaStatus'] as const

interface MfaStatus {
  /** Facteur TOTP verifie actif, null si la 2FA est desactivee. */
  factorId: string | null
}

/** Etat de la double authentification (lu chez Supabase Auth, sans /api). */
export function useMfaStatus() {
  return useQuery({
    queryKey: MFA_KEY,
    queryFn: async (): Promise<MfaStatus> => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) return { factorId: null }
      return { factorId: data?.totp?.find((f) => f.status === 'verified')?.id ?? null }
    },
    staleTime: 5 * 60 * 1000,
  })
}

interface Enrollment {
  factorId: string
  qrCode: string
  secret: string
}

export function MfaSection() {
  const queryClient = useQueryClient()
  const status = useMfaStatus()
  const factorId = status.data?.factorId ?? null
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: MFA_KEY })

  async function onEnroll() {
    setError(null)
    setBusy(true)
    // Nettoie d'eventuels facteurs non verifies restes d'un essai precedent
    // (evite l'accumulation et les conflits de nom a l'enrolement).
    // `totp` ne contient que les facteurs VERIFIES : les brouillons d'un
    // enrolement abandonne ne sont visibles que dans `all`.
    const { data: existing } = await supabase.auth.mfa.listFactors()
    for (const f of existing?.all ?? []) {
      if (f.factor_type === 'totp' && f.status !== 'verified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    setBusy(false)
    if (enrollError || !data) {
      setError('Impossible de démarrer l’activation, réessaie.')
      return
    }
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
    setCode('')
  }

  async function onConfirm(e: FormEvent) {
    e.preventDefault()
    if (!enrollment) return
    setError(null)
    setBusy(true)
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId: enrollment.factorId,
    })
    if (challengeError || !challenge) {
      setBusy(false)
      setError('Échec de la demande de vérification, réessaie.')
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: challenge.id,
      code: code.trim(),
    })
    setBusy(false)
    if (verifyError) {
      setError('Code incorrect, vérifie ton application.')
      return
    }
    setEnrollment(null)
    setCode('')
    await refresh()
  }

  async function onCancelEnroll() {
    // Nettoie le facteur non verifie cree pour l'activation abandonnee.
    if (enrollment) await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId })
    setEnrollment(null)
    setCode('')
    setError(null)
  }

  async function onDisable() {
    if (!factorId) return
    setError(null)
    setBusy(true)
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (unenrollError) {
      setError('Impossible de désactiver, réessaie.')
      return
    }
    await refresh()
  }

  if (status.isPending) {
    return (
      <Card className="p-5">
        <Skeleton className="h-12 w-full" />
      </Card>
    )
  }

  const enabled = factorId !== null

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-5">
        <Medallion icon={enabled ? ShieldCheck : ShieldOff} tone={enabled ? 'success' : 'neutral'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15.5px] font-semibold tracking-tight">Double authentification</p>
            <Badge variant={enabled ? 'success' : 'neutral'} dot>
              {enabled ? 'Activée' : 'Désactivée'}
            </Badge>
          </div>
          <p className="mt-0.5 text-[13px] leading-relaxed text-soft">
            {enabled
              ? 'Un code à usage unique est demandé à chaque connexion, en plus du mot de passe.'
              : 'Ajoute un code temporaire de ton application d’authentification au mot de passe.'}
          </p>
        </div>
        {!enrollment &&
          (enabled ? (
            <Button variant="outline" onClick={() => void onDisable()} disabled={busy} className="w-full sm:w-auto">
              Désactiver
            </Button>
          ) : (
            <Button onClick={() => void onEnroll()} disabled={busy} className="w-full sm:w-auto">
              <KeyRound className="h-4 w-4" />
              Activer
            </Button>
          ))}
      </div>

      {enrollment && (
        <div className="animate-fade-up space-y-4 border-t border-line/70 bg-surface2/40 p-5">
          <p className="text-[13.5px] leading-relaxed text-soft">
            Scanne ce QR code avec ton application d’authentification (Google Authenticator, 1Password, Authy…), puis
            saisis le code à 6 chiffres pour confirmer.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <img
              src={enrollment.qrCode}
              alt="QR code d’authentification"
              className="h-44 w-44 shrink-0 self-center rounded-2xl border border-edge bg-white p-2 sm:self-start"
            />
            <div className="min-w-0 flex-1">
              <p className="label-caps mb-1.5">Clé de configuration</p>
              <code className="block break-all rounded-xl bg-surface px-3 py-2 text-[13px] font-medium tracking-wide text-ink ring-1 ring-inset ring-edge">
                {enrollment.secret}
              </code>
              <p className="mt-1.5 text-[12px] text-soft">À saisir à la main si tu ne peux pas scanner le QR code.</p>
            </div>
          </div>
          <form onSubmit={onConfirm} className="space-y-3">
            <label htmlFor="mfa-code" className="label-caps block">
              Code de vérification
            </label>
            <Input
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="max-w-[180px] tnum tracking-[0.3em]"
            />
            {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || code.trim().length < 6}>
                {busy ? 'Vérification…' : 'Confirmer'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => void onCancelEnroll()} disabled={busy}>
                Annuler
              </Button>
            </div>
          </form>
        </div>
      )}

      {error && !enrollment && <p className="px-5 pb-5 text-[13px] font-medium text-danger">{error}</p>}
    </Card>
  )
}
