// Compte (identifiant de connexion, deconnexion) et A propos (version de
// l'app, copiable pour un signalement).

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Check, Copy, Info, Lock, LogOut, Mail } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/auth'
import { APP_VERSION } from '@/lib/version'
import { BrandMark } from '@/components/layout/BrandMark'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Medallion } from '@/components/settings/shared/SettingsCard'

export function AccountSection() {
  const navigate = useNavigate()
  const email = useAuthStore((s) => s.session?.user.email ?? null)

  async function onSignOut() {
    await supabase.auth.signOut()
    void navigate({ to: '/login' })
  }

  return (
    <Card className="flex flex-wrap items-center gap-x-4 gap-y-3 p-5">
      <Medallion icon={Mail} />
      <div className="min-w-0 flex-1">
        <p className="label-caps">Identifiant</p>
        <p className="truncate text-[15px] font-medium">{email ?? 'Inconnu'}</p>
      </div>
      <Button variant="outline" onClick={() => void onSignOut()} className="w-full sm:w-auto">
        <LogOut className="h-4 w-4" />
        Se déconnecter
      </Button>
    </Card>
  )
}

export function AboutSection() {
  const [copied, setCopied] = useState(false)

  async function copyVersion() {
    try {
      await navigator.clipboard.writeText(`I Need A Budget ${APP_VERSION}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      // Presse-papiers indisponible : la version reste lisible a l'ecran.
    }
  }

  return (
    <Card variant="hero" className="p-5 lg:p-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3.5">
          <BrandMark size="md" />
          <div className="min-w-0">
            <p className="text-[16px] font-semibold tracking-tight">I Need A Budget</p>
            <p className="text-[13px] text-soft">Budget par enveloppes, personnel et chiffré.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface2/70 px-4 py-3">
          <Info className="h-4 w-4 shrink-0 text-soft" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-soft">Version</p>
            <p className="truncate text-[14.5px] font-semibold tnum">{APP_VERSION}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void copyVersion()} aria-label="Copier la version">
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copiée' : 'Copier'}
          </Button>
        </div>
        <p className="flex items-start gap-2 text-[12.5px] leading-relaxed text-soft">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Toutes tes données sont chiffrées (AES-256-GCM) avant d’être enregistrées : montants, libellés, comptes et
          catégories ne sont jamais stockés en clair.
        </p>
      </div>
    </Card>
  )
}
