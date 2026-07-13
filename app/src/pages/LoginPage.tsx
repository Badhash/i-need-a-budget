import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Loader2, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useThemeController } from '@/hooks/useTheme'

type Step = 'password' | 'mfa'

export function LoginPage() {
  useThemeController()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Deja connecte (et niveau MFA satisfait) : filer directement au budget.
  useEffect(() => {
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (!aal || aal.nextLevel === aal.currentLevel) {
        void navigate({ to: '/budget' })
      }
    })
  }, [navigate])

  async function resolveMfaOrEnter() {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (aal && aal.currentLevel === 'aal1' && aal.nextLevel === 'aal2') {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totp = factors?.totp?.[0]
      if (totp) {
        setFactorId(totp.id)
        setStep('mfa')
        return
      }
    }
    void navigate({ to: '/budget' })
  }

  async function onSubmitPassword(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setLoading(false)
    if (signInError) {
      setError('Identifiants invalides.')
      return
    }
    await resolveMfaOrEnter()
  }

  async function onSubmitMfa(e: FormEvent) {
    e.preventDefault()
    if (!factorId) return
    setError(null)
    setLoading(true)
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
      factorId,
    })
    if (challengeError || !challenge) {
      setLoading(false)
      setError('Echec de la demande de code, reessaie.')
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId: challenge.id,
      code: code.trim(),
    })
    setLoading(false)
    if (verifyError) {
      setError('Code incorrect.')
      return
    }
    void navigate({ to: '/budget' })
  }

  return (
    <div className="flex min-h-app items-center justify-center bg-bg px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accentfg">
            <Wallet className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">I Need A Budget</h1>
            <p className="text-[14px] text-soft">
              {step === 'password'
                ? 'Connecte-toi pour accéder à ton budget.'
                : 'Vérification en deux étapes.'}
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            {step === 'password' ? (
              <form onSubmit={onSubmitPassword} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="email" className="label-caps">
                    Email
                  </label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    autoFocus
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="toi@exemple.fr"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="password" className="label-caps">
                    Mot de passe
                  </label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
                <Button type="submit" size="lg" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Se connecter'}
                </Button>
              </form>
            ) : (
              <form onSubmit={onSubmitMfa} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="code" className="label-caps">
                    Code d'authentification
                  </label>
                  <Input
                    id="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="123456"
                  />
                  <p className="text-[12.5px] text-soft">
                    Saisis le code à 6 chiffres de ton application d'authentification.
                  </p>
                </div>
                {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
                <Button type="submit" size="lg" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Vérifier'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
