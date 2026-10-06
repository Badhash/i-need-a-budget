// Reglages > Notifications : activer les notifications sur cet appareil, choisir
// lesquelles recevoir, envoyer un test. Les notifications partent du serveur
// apres chaque synchro bancaire planifiee (matin et soir).

import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Bell, BellOff, BellRing, Send, Share, Smartphone } from 'lucide-react'
import {
  currentSubscription,
  disablePush,
  enablePush,
  notificationPermission,
  PUSH_KEY,
  PUSH_KINDS,
  PushPermissionError,
  pushSupport,
  resyncSubscription,
  sendTestPush,
  useLocalEndpoint,
  usePushState,
  useSetPushPrefs,
  type PushServerState,
} from '@/lib/push'
import { toast } from '@/lib/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SwitchRow } from '@/components/accounts/Switch'
import { SettingsCard } from '@/components/settings/shared/SettingsCard'

function Notice({ icon: Icon, children }: { icon: typeof Bell; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-surface2/60 p-4 text-[13.5px] leading-relaxed text-soft ring-1 ring-inset ring-edge">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink/70" />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function NotificationsSection() {
  const queryClient = useQueryClient()
  const support = pushSupport()
  const { serverReady, query } = usePushState()
  const state = query.data
  const local = useLocalEndpoint(serverReady && support === 'ok')
  const setPrefs = useSetPushPrefs()
  const [busy, setBusy] = useState(false)
  const [permission, setPermission] = useState(notificationPermission())

  const localEndpoint = local.data ?? null
  const subscribed = !!state && !!localEndpoint && state.devices.some((d) => d.endpoint === localEndpoint)

  // Abonnement local present mais inconnu du serveur (point de push renouvele
  // par le systeme) : on le re-declare sans rien demander.
  useEffect(() => {
    if (!state || support !== 'ok') return
    void resyncSubscription(state)
      .then((next) => {
        if (next) queryClient.setQueryData(PUSH_KEY, next)
      })
      .catch(() => undefined)
  }, [state, support, queryClient])

  function apply(next: PushServerState, endpoint: string | null) {
    queryClient.setQueryData(PUSH_KEY, next)
    queryClient.setQueryData([...PUSH_KEY, 'local'], endpoint)
  }

  function onEnable() {
    if (!state) return
    setBusy(true)
    // Appel synchrone depuis le clic : iOS exige le geste pour la permission.
    enablePush(state.publicKey)
      .then(async (next) => {
        setPermission(notificationPermission())
        const sub = (await currentSubscription())?.endpoint ?? null
        apply(next, sub)
        await sendTestPush(sub ?? undefined).catch(() => undefined)
        toast({ message: 'Notifications activées', description: 'Une notification de test arrive.', tone: 'success' })
      })
      .catch((err) => {
        setPermission(notificationPermission())
        if (err instanceof PushPermissionError) return
        toast({ message: 'Activation impossible', description: 'Réessaie dans un instant.', tone: 'danger' })
      })
      .finally(() => setBusy(false))
  }

  function onDisable() {
    setBusy(true)
    disablePush()
      .then((next) => {
        apply(next, null)
        toast({ message: 'Notifications désactivées sur cet appareil' })
      })
      .catch(() => toast({ message: 'Désactivation impossible', tone: 'danger' }))
      .finally(() => setBusy(false))
  }

  function onTest() {
    setBusy(true)
    sendTestPush(localEndpoint ?? undefined)
      .then((r) =>
        toast(
          r.sent > 0
            ? { message: 'Notification envoyée', description: 'Elle arrive dans quelques secondes.' }
            : { message: 'Aucun appareil joignable', description: 'Désactive puis réactive les notifications.', tone: 'warning' },
        ),
      )
      .catch(() => toast({ message: 'Envoi impossible', tone: 'danger' }))
      .finally(() => setBusy(false))
  }

  const badge = subscribed ? (
    <Badge variant="success" dot>
      Activées
    </Badge>
  ) : (
    <Badge variant="neutral" dot>
      Désactivées
    </Badge>
  )

  let body: React.ReactNode
  if (!serverReady) {
    body = (
      <Notice icon={BellOff}>
        Disponible dès la prochaine mise à jour du serveur (déploiement des Edge Functions).
      </Notice>
    )
  } else if (support === 'install') {
    body = (
      <Notice icon={Share}>
        Sur iPhone, les notifications ne marchent que depuis l’app installée : dans Safari, touche{' '}
        <span className="font-medium text-ink">Partager</span> puis{' '}
        <span className="font-medium text-ink">Sur l’écran d’accueil</span>, et ouvre l’app depuis son icône.
      </Notice>
    )
  } else if (support === 'unsupported') {
    body = <Notice icon={BellOff}>Ce navigateur ne gère pas les notifications web.</Notice>
  } else if (query.isPending || local.isPending) {
    body = <Skeleton className="h-12 w-full" />
  } else if (!state) {
    body = <Notice icon={BellOff}>Impossible de charger l’état des notifications. Réessaie plus tard.</Notice>
  } else if (!state.available) {
    body = (
      <Notice icon={BellOff}>
        Le script SQL <span className="font-medium text-ink">O-push-state.sql</span> n’est pas encore appliqué dans
        Supabase.
      </Notice>
    )
  } else if (permission === 'denied') {
    body = (
      <Notice icon={BellOff}>
        Les notifications sont bloquées pour l’app. Sur iPhone : Réglages, Notifications, puis l’app Budget, et active
        « Autoriser les notifications ».
      </Notice>
    )
  } else if (!subscribed) {
    body = (
      <div className="space-y-3">
        <p className="text-[13.5px] leading-relaxed text-soft">
          Reçois l’essentiel sans ouvrir l’app : nouvelles transactions à trier, enveloppes dépassées, argent à assigner
          et connexion bancaire à renouveler.
        </p>
        <Button onClick={onEnable} disabled={busy} className="w-full sm:w-auto">
          <BellRing className="h-4 w-4" />
          Activer sur cet appareil
        </Button>
      </div>
    )
  } else {
    const others = state.devices.filter((d) => d.endpoint !== localEndpoint)
    body = (
      <div className="space-y-4">
        <div className="-mx-3.5 divide-y divide-line/60">
          {PUSH_KINDS.map((k) => (
            <SwitchRow
              key={k.kind}
              checked={state.prefs[k.kind]}
              onCheckedChange={(next) => setPrefs.mutate({ [k.kind]: next })}
              title={k.title}
              description={k.description}
              className="rounded-none first:rounded-t-2xl last:rounded-b-2xl"
            />
          ))}
        </div>
        {others.length > 0 && (
          <p className="flex items-center gap-2 text-[13px] text-soft">
            <Smartphone className="h-4 w-4 shrink-0" />
            Aussi activées sur : {others.map((d) => d.device).join(', ')}
          </p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="soft" onClick={onTest} disabled={busy} className="w-full sm:w-auto">
            <Send className="h-4 w-4" />
            Envoyer un test
          </Button>
          <Button variant="ghost" onClick={onDisable} disabled={busy} className="w-full sm:w-auto">
            <BellOff className="h-4 w-4" />
            Désactiver sur cet appareil
          </Button>
        </div>
      </div>
    )
  }

  return (
    <SettingsCard
      icon={subscribed ? BellRing : Bell}
      tone={subscribed ? 'accent' : 'neutral'}
      title="Sur cet appareil"
      description="Envoyées après chaque synchro bancaire, matin et soir."
      action={serverReady && support === 'ok' && state?.available ? badge : undefined}
    >
      {body}
    </SettingsCard>
  )
}
