// Notifications push (Web Push) : abonnement de CET appareil, preferences par
// type, notification de test. Le serveur (actions push* de /api) garde les
// abonnements chiffres et envoie les notifications apres chaque synchro
// bancaire planifiee (sync-bank). Le service worker (public/sw.js) les affiche
// et ouvre la bonne page au toucher.
//
// iPhone : uniquement depuis l'app ajoutee a l'ecran d'accueil (iOS 16.4+), et
// la demande de permission doit partir directement d'un geste utilisateur.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiCall } from '@/lib/api'
import { useServerFeatures } from '@/lib/data'
import { SERVER_FEATURES } from '@/lib/features'

/** Types de notifications (noms IDENTIQUES a supabase/functions/api/push.ts). */
export const PUSH_KINDS = [
  {
    kind: 'imports',
    title: 'Nouvelles transactions',
    description: 'Après chaque synchro, avec le nombre à catégoriser.',
  },
  {
    kind: 'income',
    title: 'Argent à assigner',
    description: 'Quand ton Prêt à assigner augmente (salaire, remboursement).',
  },
  {
    kind: 'overspent',
    title: 'Enveloppe dépassée',
    description: 'Dès qu’une enveloppe passe dans le rouge.',
  },
  {
    kind: 'monthStart',
    title: 'Nouveau mois',
    description: 'Le 1er du mois, pour préparer ton budget.',
  },
  {
    kind: 'consent',
    title: 'Connexion bancaire',
    description: 'À 14, 7, 3 et 1 jour de l’expiration, puis à l’expiration.',
  },
  {
    kind: 'syncError',
    title: 'Synchro en échec',
    description: 'Si les transactions n’arrivent plus (une fois par jour au plus).',
  },
] as const

export type PushKind = (typeof PUSH_KINDS)[number]['kind']
export type PushPrefs = Record<PushKind, boolean>

export interface PushDevice {
  endpoint: string
  device: string
  createdAt: string
}

export interface PushServerState {
  /** false : table push_state absente (script O-push-state.sql non applique). */
  available: boolean
  publicKey: string
  prefs: PushPrefs
  devices: PushDevice[]
}

export const PUSH_KEY = ['push'] as const

/**
 * Capacites de CET appareil :
 *  - 'ok' : Web Push disponible ;
 *  - 'install' : iPhone/iPad dans Safari, il faut ouvrir l'app depuis l'ecran d'accueil ;
 *  - 'unsupported' : navigateur sans Web Push.
 */
export function pushSupport(): 'ok' | 'install' | 'unsupported' {
  if (typeof window === 'undefined') return 'unsupported'
  const nav = window.navigator as Navigator & { standalone?: boolean }
  const ios = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  const standalone = nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
  const hasApi = 'serviceWorker' in nav && 'PushManager' in window && 'Notification' in window
  if (ios && !standalone) return 'install'
  return hasApi ? 'ok' : 'unsupported'
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad'
  if (/Android/.test(ua)) return 'Android'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'PC Windows'
  return 'Navigateur'
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

function sameKey(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a || a.byteLength !== b.length) return false
  const v = new Uint8Array(a)
  return v.every((x, i) => x === b[i])
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  // Le worker est enregistre au chargement (main.tsx, hors dev/demo) : on
  // n'attend pas indefiniment s'il n'existe pas.
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? navigator.serviceWorker.ready : null
}

/** Abonnement Web Push courant de cet appareil (null si aucun). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration()
  return reg ? reg.pushManager.getSubscription() : null
}

export function usePushState() {
  const features = useServerFeatures()
  const enabled = features.has(SERVER_FEATURES.pushNotifications)
  return {
    serverReady: enabled,
    query: useQuery({
      queryKey: PUSH_KEY,
      queryFn: () => apiCall<PushServerState>('pushGetState'),
      enabled,
      staleTime: 5 * 60_000,
    }),
  }
}

/** Endpoint de cet appareil (pour savoir s'il est abonne cote serveur). */
export function useLocalEndpoint(enabled: boolean) {
  return useQuery({
    queryKey: [...PUSH_KEY, 'local'],
    queryFn: async () => (await currentSubscription())?.endpoint ?? null,
    enabled,
    staleTime: Infinity,
  })
}

/**
 * Active les notifications sur cet appareil. A appeler DIRECTEMENT depuis le
 * gestionnaire du geste (clic) : iOS refuse la demande de permission sinon.
 */
export async function enablePush(publicKey: string): Promise<PushServerState> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new PushPermissionError(permission)
  const reg = await registration()
  if (!reg) throw new Error('service worker indisponible')
  const key = b64urlToBytes(publicKey)
  let sub = await reg.pushManager.getSubscription()
  // Cle serveur changee (rotation VAPID) : l'ancien abonnement est inutilisable.
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe().catch(() => undefined)
    sub = null
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  return apiCall<PushServerState>('pushSubscribe', { subscription: sub.toJSON(), device: deviceLabel() })
}

export class PushPermissionError extends Error {
  constructor(public permission: NotificationPermission) {
    super('permission refusee')
  }
}

export async function disablePush(): Promise<PushServerState> {
  const sub = await currentSubscription()
  const endpoint = sub?.endpoint
  await sub?.unsubscribe().catch(() => undefined)
  return apiCall<PushServerState>('pushUnsubscribe', { endpoint: endpoint ?? '' })
}

/** Re-declare silencieusement l'abonnement local s'il a disparu cote serveur. */
export async function resyncSubscription(state: PushServerState): Promise<PushServerState | null> {
  if (!state.available || notificationPermission() !== 'granted') return null
  const sub = await currentSubscription()
  if (!sub || state.devices.some((d) => d.endpoint === sub.endpoint)) return null
  if (!sameKey(sub.options.applicationServerKey, b64urlToBytes(state.publicKey))) return null
  return apiCall<PushServerState>('pushSubscribe', { subscription: sub.toJSON(), device: deviceLabel() })
}

/** Preferences : patch optimiste, rollback discret en cas d'echec. */
export function useSetPushPrefs() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (prefs: Partial<PushPrefs>) => apiCall<PushServerState>('pushSetPrefs', { prefs }),
    onMutate: async (prefs) => {
      await queryClient.cancelQueries({ queryKey: PUSH_KEY, exact: true })
      const previous = queryClient.getQueryData<PushServerState>(PUSH_KEY)
      if (previous) queryClient.setQueryData(PUSH_KEY, { ...previous, prefs: { ...previous.prefs, ...prefs } })
      return { previous }
    },
    onError: (_err, _prefs, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(PUSH_KEY, ctx.previous)
    },
  })
}

export function sendTestPush(endpoint?: string): Promise<{ sent: number }> {
  return apiCall<{ sent: number }>('pushTest', endpoint ? { endpoint } : {})
}
