import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CircleAlert, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { mfaSatisfied } from '@/lib/mfa'
import { BrandMark } from '@/components/layout/BrandMark'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useThemeController } from '@/hooks/useTheme'
import { readLastPath } from '@/router'

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
  // Session au niveau aal1 avec un facteur verifie (mot de passe accepte, code
  // pas encore saisi, ou MFA active depuis un autre appareil) : on enchaine
  // directement sur la saisie du code, sans redemander le mot de passe.
  useEffect(() => {
    let cancelled = false
    void supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session || cancelled) return
      if (mfaSatisfied(data.session)) {
        void navigate({ to: readLastPath() })
        return
      }
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totp = factors?.totp?.[0]
      if (totp && !cancelled) {
        setFactorId(totp.id)
        setStep('mfa')
      }
    })
    return () => {
      cancelled = true
    }
  }, [navigate])

  // Abandonner la verification : deconnexion locale, retour au mot de passe.
  async function backToPassword() {
    setError(null)
    setCode('')
    await supabase.auth.signOut({ scope: 'local' })
    setFactorId(null)
    setStep('password')
  }

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
    void navigate({ to: readLastPath() })
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
      setError('Échec de la demande de code, réessaie.')
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
    void navigate({ to: readLastPath() })
  }

  return (
    <div className="relative isolate flex min-h-app items-center justify-center overflow-hidden bg-bg px-4 py-10">
      {/* Aurore de fond : deux lueurs larges et lentes (figees si mouvement reduit). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="loader-drift absolute inset-x-0 -top-44 mx-auto h-[36rem] w-[36rem] rounded-full bg-aura-1/25 blur-3xl dark:bg-aura-1/30" />
        <div
          className="loader-drift absolute -bottom-48 -right-24 h-[28rem] w-[28rem] rounded-full bg-aura-2/20 blur-3xl"
          style={{ animationDelay: '-4.5s' }}
        />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8 flex animate-fade-up flex-col items-center gap-5 text-center">
          <BrandMark size="xl" />
          <div>
            <h1 className="text-[27px] font-semibold tracking-[-0.02em] text-ink">I Need A Budget</h1>
            <p key={step} className="mt-1.5 animate-fade-in text-[14.5px] text-soft">
              {step === 'password'
                ? 'Connecte-toi pour accéder à ton budget.'
                : 'Vérification en deux étapes.'}
            </p>
          </div>
        </div>

        <div
          className="glass animate-fade-up rounded-3xl border border-edge p-6 shadow-elevated"
          style={{ animationDelay: '60ms' }}
        >
          {step === 'password' ? (
            <form key="password" onSubmit={onSubmitPassword} className="flex animate-fade-in flex-col gap-4">
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
              {error && <FormError message={error} />}
              <Button type="submit" size="lg" className="mt-1 w-full" disabled={loading}>
                {loading ? 'Connexion…' : 'Se connecter'}
              </Button>
            </form>
          ) : (
            <form key="mfa" onSubmit={onSubmitMfa} className="flex animate-fade-in flex-col gap-4">
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
                  className="h-14 text-center text-[24px] font-semibold tracking-[0.35em] tnum lg:h-14 lg:text-[24px]"
                />
                <p className="text-[12.5px] leading-snug text-soft">
                  Saisis le code à 6 chiffres de ton application d'authentification.
                </p>
              </div>
              {error && <FormError message={error} />}
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading ? 'Vérification…' : 'Vérifier'}
              </Button>
              <button
                type="button"
                onClick={() => void backToPassword()}
                className="min-h-[44px] rounded-xl text-[13px] font-medium text-soft transition-colors hover:text-ink"
              >
                Retour à la connexion
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 flex animate-fade-in items-center justify-center gap-1.5 text-[12.5px] text-soft">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          Budget par enveloppes, personnel et chiffré.
        </p>
      </div>
    </div>
  )
}

function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex animate-fade-in items-center gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-[13px] font-medium text-danger"
    >
      <CircleAlert className="h-4 w-4 shrink-0" />
      {message}
    </p>
  )
}
