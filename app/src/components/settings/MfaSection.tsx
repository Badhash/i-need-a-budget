import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

type MfaStatus = 'loading' | 'disabled' | 'enrolling' | 'enabled'

interface Enrollment {
  factorId: string
  qrCode: string
  secret: string
}

export function MfaSection() {
  const [status, setStatus] = useState<MfaStatus>('loading')
  // Facteur TOTP verifie actif (present uniquement quand la 2FA est activee).
  const [factorId, setFactorId] = useState<string | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    const { data, error: listError } = await supabase.auth.mfa.listFactors()
    if (listError) {
      setFactorId(null)
      setStatus('disabled')
      return
    }
    const verified = data?.totp?.find((f) => f.status === 'verified')
    if (verified) {
      setFactorId(verified.id)
      setStatus('enabled')
    } else {
      setFactorId(null)
      setStatus('disabled')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function onEnroll() {
    setError(null)
    setBusy(true)
    // Nettoie d'eventuels facteurs non verifies restes d'un essai precedent
    // (evite l'accumulation et les conflits de nom a l'enrolement).
    const { data: existing } = await supabase.auth.mfa.listFactors()
    for (const f of existing?.totp ?? []) {
      if (f.status !== 'verified') {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    setBusy(false)
    if (enrollError || !data) {
      setError("Impossible de demarrer l'activation, reessaie.")
      return
    }
    setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
    setCode('')
    setStatus('enrolling')
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
      setError('Echec de la demande de verification, reessaie.')
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrollment.factorId,
      challengeId: challenge.id,
      code: code.trim(),
    })
    setBusy(false)
    if (verifyError) {
      setError('Code incorrect, verifie ton application.')
      return
    }
    setEnrollment(null)
    setCode('')
    await refresh()
  }

  async function onCancelEnroll() {
    // Nettoie le facteur non verifie cree pour l'activation abandonnee.
    if (enrollment) {
      await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId })
    }
    setEnrollment(null)
    setCode('')
    setError(null)
    setStatus('disabled')
  }

  async function onDisable() {
    if (!factorId) return
    setError(null)
    setBusy(true)
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId })
    setBusy(false)
    if (unenrollError) {
      setError('Impossible de desactiver, reessaie.')
      return
    }
    await refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Authentification a deux facteurs</CardTitle>
        <p className="text-[13px] text-soft">
          Un code temporaire depuis ton application d'authentification, en plus du mot de passe.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {status === 'loading' && <Skeleton className="h-16 w-full" />}

        {status === 'enabled' && (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold">Deux facteurs</p>
                <Badge variant="success">Activee</Badge>
              </div>
              <p className="text-[12.5px] text-soft">
                Ton compte est protege par un code a usage unique.
              </p>
            </div>
            <Button variant="outline" onClick={() => void onDisable()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Desactiver'}
            </Button>
          </div>
        )}

        {status === 'disabled' && (
          <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface2 text-soft">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold">Deux facteurs</p>
                <Badge variant="neutral">Desactivee</Badge>
              </div>
              <p className="text-[12.5px] text-soft">
                Ajoute une couche de securite a ta connexion.
              </p>
            </div>
            <Button onClick={() => void onEnroll()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Activer'}
            </Button>
          </div>
        )}

        {status === 'enrolling' && enrollment && (
          <div className="rounded-xl border border-line p-4">
            <p className="text-[13.5px] text-soft">
              Scanne ce QR code avec ton application d'authentification (Google Authenticator, 1Password,
              Authy...), puis saisis le code a 6 chiffres pour confirmer.
            </p>

            <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
              <img
                src={enrollment.qrCode}
                alt="QR code d'authentification"
                className="h-44 w-44 shrink-0 self-center rounded-xl border border-line bg-white p-2 sm:self-start"
              />
              <div className="min-w-0 flex-1">
                <p className="label-caps mb-1.5">Cle de configuration</p>
                <code className="block break-all rounded-lg bg-surface2 px-3 py-2 text-[13px] font-medium tracking-wide text-ink">
                  {enrollment.secret}
                </code>
                <p className="mt-1.5 text-[12px] text-soft">
                  A saisir manuellement si tu ne peux pas scanner le QR code.
                </p>
              </div>
            </div>

            <form onSubmit={onConfirm} className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="mfa-code" className="label-caps">
                  Code de verification
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
                  className="max-w-[180px] tnum"
                />
              </div>
              {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={busy || code.trim().length < 6}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmer'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => void onCancelEnroll()} disabled={busy}>
                  Annuler
                </Button>
              </div>
            </form>
          </div>
        )}

        {error && status !== 'enrolling' && (
          <p className="text-[13px] font-medium text-danger">{error}</p>
        )}
      </CardContent>
    </Card>
  )
}
