// Heros de la page Reglages : identite du compte et trois etats d'un coup
// d'oeil (banque, securite, sauvegarde), chacun menant a sa section.

import { DatabaseBackup, Landmark, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { useBankConnections } from '@/lib/bank'
import { fmtRelativeTime } from '@/lib/format'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useMfaStatus } from '@/components/settings/MfaSection'
import { useLastBackup } from '@/components/settings/data/BackupCard'
import { cn } from '@/lib/utils'

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

const TONE_DOT: Record<Tone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-soft/60',
}

const TONE_ICON: Record<Tone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  neutral: 'bg-surface2 text-soft',
}

function StatusTile({
  icon: Icon,
  label,
  value,
  tone,
  loading,
  onClick,
}: {
  icon: LucideIcon
  label: string
  value: string
  tone: Tone
  loading?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable flex min-h-[92px] min-w-0 flex-col items-start justify-between gap-2 rounded-2xl border border-edge bg-surface/70 p-3 text-left transition-[background-color,border-color] duration-150 hover:bg-surface sm:min-h-0 sm:flex-row sm:items-center sm:justify-start sm:gap-3 sm:p-3.5"
    >
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10', TONE_ICON[tone])}>
        <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
      </span>
      <span className="w-full min-w-0">
        <span className="block truncate text-[10.5px] font-medium uppercase tracking-[0.04em] text-soft sm:text-[11px] sm:tracking-[0.08em]">
          {label}
        </span>
        {loading ? (
          <Skeleton className="mt-1 h-4 w-16" />
        ) : (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13px] font-semibold leading-tight text-ink sm:text-[14.5px]">
            {/* Point de statut : desktop seulement (la pastille d'icone porte deja le ton). */}
            <span aria-hidden className={cn('hidden h-1.5 w-1.5 shrink-0 rounded-full sm:block', TONE_DOT[tone])} />
            <span className="line-clamp-2 sm:truncate">{value}</span>
          </span>
        )}
      </span>
    </button>
  )
}

const DAY = 86_400_000

export function SettingsHero({ onJump }: { onJump: (sectionId: string) => void }) {
  const email = useAuthStore((s) => s.session?.user.email ?? '')
  const initial = email ? email[0]!.toUpperCase() : '?'
  const banks = useBankConnections()
  const mfa = useMfaStatus()
  const lastBackup = useLastBackup()

  // Banque : l'etat le plus urgent parmi les connexions.
  const list = banks.data ?? []
  const expired = list.find((c) => c.status === 'expired')
  const expiring = list
    .filter((c) => c.status === 'expiring' && c.validUntil)
    .sort((a, b) => (a.validUntil! < b.validUntil! ? -1 : 1))[0]
  let bank: { value: string; tone: Tone }
  if (banks.isError) bank = { value: 'Indisponible', tone: 'neutral' }
  else if (list.length === 0) bank = { value: 'Aucune', tone: 'neutral' }
  else if (expired) bank = { value: 'À reconnecter', tone: 'danger' }
  else if (expiring) {
    const days = Math.max(0, Math.ceil((new Date(expiring.validUntil!).getTime() - Date.now()) / DAY))
    bank = { value: `Expire dans ${days} j`, tone: 'warning' }
  } else if (list.every((c) => c.status === 'pending')) bank = { value: 'En attente', tone: 'neutral' }
  else bank = { value: 'Connectée', tone: 'success' }

  const secured = mfa.data?.factorId != null
  const backupAge = lastBackup ? Date.now() - new Date(lastBackup).getTime() : null
  const backup: { value: string; tone: Tone } =
    backupAge === null
      ? { value: 'Jamais ici', tone: 'warning' }
      : {
          value: (fmtRelativeTime(lastBackup!) ?? 'Récente').replace(/^il y a /, ''),
          tone: backupAge > 30 * DAY ? 'warning' : 'success',
        }

  return (
    <Card variant="hero" className="p-4 sm:p-5 lg:p-6">
      <div className="flex items-center gap-3.5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-[19px] font-semibold text-accentfg shadow-glow lg:h-14 lg:w-14 lg:text-[21px]">
          {initial}
        </span>
        <div className="min-w-0">
          <p className="label-caps">Ton espace</p>
          <p className="truncate text-[17px] font-semibold tracking-tight text-ink lg:text-[20px]">
            {email || 'Compte'}
          </p>
          <p className="text-[12.5px] text-soft">Budget chiffré de bout en bout, rien qu’à toi.</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-2.5 lg:mt-5">
        <StatusTile
          icon={Landmark}
          label="Banque"
          value={bank.value}
          tone={bank.tone}
          loading={banks.isPending}
          onClick={() => onJump('banque')}
        />
        <StatusTile
          icon={ShieldCheck}
          label="Sécurité"
          value={secured ? '2FA active' : '2FA inactive'}
          tone={secured ? 'success' : 'warning'}
          loading={mfa.isPending}
          onClick={() => onJump('securite')}
        />
        <StatusTile
          icon={DatabaseBackup}
          label="Sauvegarde"
          value={backup.value}
          tone={backup.tone}
          onClick={() => onJump('donnees')}
        />
      </div>
    </Card>
  )
}
