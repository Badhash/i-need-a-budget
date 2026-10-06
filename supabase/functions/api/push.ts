// Notifications push (REF O, table push_state : 1 ligne / user, chiffree).
// Partage entre /api (abonnement, preferences, test) et sync-bank (envoi apres
// chaque synchronisation planifiee).
//
// Payload chiffre : abonnements Web Push de l'utilisateur (un par appareil),
// preferences par type, et memoire anti-doublon (ce qui a deja ete notifie).
// Le contenu des notifications est chiffre de bout en bout jusqu'a l'appareil
// (RFC 8291) : le service de push (Apple/Google/Mozilla) ne le lit pas.
// Table toleree absente : aucune notification, aucune erreur bloquante.
//
// INTERDIT : logger un payload dechiffre, un point de push ou une cle.

import {
  base64ToBytes,
  bytesToPgHex,
  decryptJson,
  encryptJson,
  type CryptoKeys,
} from '../../../packages/crypto/src/index.ts'
import {
  deriveVapidKeys,
  encryptPushPayload,
  vapidAuthorization,
  vapidFromSecrets,
  type VapidKeys,
} from '../../../packages/crypto/src/webpush.ts'
import { computeBudget } from '../../../packages/engine/src/index.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { aggIsReady, aggReadRollups, aggReadUncatCount, rollupsToEngineInput } from './aggregates.ts'
import { loadUserSettings } from './settings.ts'

// ---------------------------------------------------------------------------
// Modele
// ---------------------------------------------------------------------------

/** Types de notifications (noms IDENTIQUES a app/src/lib/push.ts). */
export const PUSH_KINDS = [
  'imports',
  'income',
  'overspent',
  'monthStart',
  'consent',
  'syncError',
] as const
export type PushKind = (typeof PUSH_KINDS)[number]
export type PushPrefs = Record<PushKind, boolean>

export const DEFAULT_PREFS: PushPrefs = {
  imports: true,
  income: true,
  overspent: true,
  monthStart: true,
  consent: true,
  syncError: true,
}

export interface PushSubscriptionRecord {
  endpoint: string
  p256dh: string
  auth: string
  /** Libelle d'appareil (ex. « iPhone »), affiche dans les reglages. */
  device: string
  createdAt: string
}

/** Memoire anti-doublon : ce qui a deja ete signale. */
interface PushSent {
  /** Mois pour lequel « nouveau mois » a ete envoye. */
  monthStart?: string
  /** Enveloppes deja signalees en depassement, par mois. */
  overspent?: { month: string; ids: string[] }
  /** Dernier Pret a assigner signale (centimes) et son mois. */
  rta?: { month: string; amount: number }
  /** Palier d'expiration deja signale par connexion bancaire (jours restants). */
  consent?: Record<string, number>
  /** Jour (YYYY-MM-DD) du dernier signalement d'echec de synchro. */
  syncErrorDay?: string
}

export interface PushState {
  subscriptions: PushSubscriptionRecord[]
  prefs: PushPrefs
  sent: PushSent
}

const MAX_SUBSCRIPTIONS = 10
const CTX = (userId: string) => ['push_state', userId]

function emptyState(): PushState {
  return { subscriptions: [], prefs: { ...DEFAULT_PREFS }, sent: {} }
}

export function isMissingTable(error: { code?: string } | null): boolean {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01')
}

/** Etat push ; `null` si la table n'existe pas (script O non applique). */
export async function loadPushState(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
): Promise<PushState | null> {
  const { data, error } = await admin
    .from('push_state')
    .select('enc_payload:enc_b64')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return null
    throw new Error('lecture push_state impossible')
  }
  if (!data) return emptyState()
  const p = await decryptJson<Partial<PushState>>(keys, base64ToBytes(data.enc_payload as string), CTX(userId))
  return {
    subscriptions: Array.isArray(p.subscriptions) ? p.subscriptions : [],
    prefs: { ...DEFAULT_PREFS, ...(p.prefs ?? {}) },
    sent: p.sent ?? {},
  }
}

export async function savePushState(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
  state: PushState,
): Promise<void> {
  const { error } = await admin.from('push_state').upsert(
    {
      user_id: userId,
      enc_payload: bytesToPgHex(await encryptJson(keys, state, CTX(userId))),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) {
    if (isMissingTable(error)) throw new Error('table push_state absente : appliquer O-push-state.sql')
    throw new Error('ecriture push_state impossible')
  }
}

// ---------------------------------------------------------------------------
// Abonnements
// ---------------------------------------------------------------------------

// Services de push des navigateurs : on n'envoie JAMAIS de requete ailleurs
// (un point de push arbitraire ferait de la fonction un relais SSRF).
const PUSH_HOSTS = [
  'push.apple.com',
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'notify.windows.com',
]

export function isAllowedEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.port !== '') return false
  return PUSH_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))
}

const B64URL_RE = /^[A-Za-z0-9_-]+$/

/** Valide et normalise un abonnement recu du front ; null si invalide. */
export function parseSubscription(raw: unknown, device: unknown): PushSubscriptionRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }
  const endpoint = r.endpoint
  const p256dh = r.keys?.p256dh
  const auth = r.keys?.auth
  if (typeof endpoint !== 'string' || endpoint.length > 1024 || !isAllowedEndpoint(endpoint)) return null
  if (typeof p256dh !== 'string' || !B64URL_RE.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return null
  if (typeof auth !== 'string' || !B64URL_RE.test(auth) || auth.length < 16 || auth.length > 32) return null
  const label = typeof device === 'string' ? device.trim().slice(0, 40) : ''
  return { endpoint, p256dh, auth, device: label || 'Appareil', createdAt: new Date().toISOString() }
}

/** Ajoute (ou remplace) un abonnement ; les plus anciens sautent au-dela de 10. */
export function upsertSubscription(state: PushState, sub: PushSubscriptionRecord): PushState {
  const others = state.subscriptions.filter((s) => s.endpoint !== sub.endpoint)
  return { ...state, subscriptions: [...others, sub].slice(-MAX_SUBSCRIPTIONS) }
}

// ---------------------------------------------------------------------------
// Envoi
// ---------------------------------------------------------------------------

export interface PushMessage {
  title: string
  body: string
  /** Route hash de l'app a ouvrir au toucher (ex. '#/trier'). */
  url: string
  /** Une notification de meme tag remplace la precedente sur l'appareil. */
  tag: string
}

let vapidPromise: Promise<VapidKeys> | null = null

/** Cles VAPID : secrets explicites s'ils existent, sinon derivees de ENCRYPTION_KEY. */
export function getVapidKeys(): Promise<VapidKeys> {
  vapidPromise ??= (async () => {
    const pub = Deno.env.get('VAPID_PUBLIC_KEY')
    const priv = Deno.env.get('VAPID_PRIVATE_KEY')
    if (pub && priv) return vapidFromSecrets(pub, priv)
    return deriveVapidKeys(Deno.env.get('ENCRYPTION_KEY') ?? '')
  })().catch((err) => {
    vapidPromise = null
    throw err
  })
  return vapidPromise
}

function vapidSubject(): string {
  return Deno.env.get('VAPID_SUBJECT') || 'https://github.com/badhash/i-need-a-budget'
}

type SendOutcome = 'sent' | 'gone' | 'failed'

async function sendOne(vapid: VapidKeys, sub: PushSubscriptionRecord, msg: PushMessage): Promise<SendOutcome> {
  if (!isAllowedEndpoint(sub.endpoint)) return 'gone'
  try {
    const body = await encryptPushPayload(sub, new TextEncoder().encode(JSON.stringify(msg)))
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(vapid, sub.endpoint, vapidSubject()),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(24 * 3600),
        Urgency: 'normal',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    })
    await res.body?.cancel()
    // 404/410 : abonnement revoque (app desinstallee, permission retiree).
    if (res.status === 404 || res.status === 410) return 'gone'
    return res.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

/**
 * Envoie un message a tous les appareils abonnes (ou a un seul) et retire de
 * l'etat les abonnements revoques. Retourne le nombre d'envois reussis et
 * l'etat mis a jour (a sauvegarder par l'appelant si `changed`).
 */
export async function sendToDevices(
  state: PushState,
  msg: PushMessage,
  onlyEndpoint?: string,
): Promise<{ sent: number; state: PushState; changed: boolean }> {
  const targets = state.subscriptions.filter((s) => !onlyEndpoint || s.endpoint === onlyEndpoint)
  if (targets.length === 0) return { sent: 0, state, changed: false }
  const vapid = await getVapidKeys()
  const outcomes = await Promise.all(targets.map((s) => sendOne(vapid, s, msg)))
  const gone = new Set(targets.filter((_, i) => outcomes[i] === 'gone').map((s) => s.endpoint))
  const sent = outcomes.filter((o) => o === 'sent').length
  if (gone.size === 0) return { sent, state, changed: false }
  return {
    sent,
    state: { ...state, subscriptions: state.subscriptions.filter((s) => !gone.has(s.endpoint)) },
    changed: true,
  }
}

// ---------------------------------------------------------------------------
// Notifications apres synchronisation (sync-bank, mode cron)
// ---------------------------------------------------------------------------

const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' })
const formatCents = (cents: number) => EUR.format(cents / 100).replace(/ | /g, ' ')

const MONTH_NAMES = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]

function monthName(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month
}

export interface SyncOutcome {
  imported: number
  errors: string[]
}

interface ConnectionInfo {
  id: string
  institution: string
  validUntil: string | null
  sessionState: string
}

// Paliers d'alerte avant expiration du consentement bancaire (jours restants).
const CONSENT_STEPS = [14, 7, 3, 1]

function consentStep(daysLeft: number): number | null {
  if (daysLeft <= 0) return 0
  for (const step of [...CONSENT_STEPS].reverse()) if (daysLeft <= step) return step
  return null
}

async function loadConnections(admin: SupabaseClient, keys: CryptoKeys, userId: string): Promise<ConnectionInfo[]> {
  const { data, error } = await admin
    .from('bank_connections')
    .select('id, enc_payload:enc_b64')
    .eq('user_id', userId)
    .limit(100)
  if (error) return []
  return Promise.all(
    (data ?? []).map(async (row: { id: string; enc_payload: string }) => {
      const p = await decryptJson<{ institution?: string; validUntil?: string | null; sessionState?: string }>(
        keys,
        base64ToBytes(row.enc_payload as string),
        ['bank_connections', userId],
      )
      return {
        id: row.id as string,
        institution: p.institution || 'Ta banque',
        validUntil: p.validUntil ?? null,
        sessionState: p.sessionState ?? 'active',
      }
    }),
  )
}

interface CategoryInfo {
  id: string
  name: string
  isIncome: boolean
  hidden: boolean
}

async function loadCategoryInfo(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
): Promise<CategoryInfo[]> {
  const { data, error } = await admin
    .from('categories')
    .select('id, enc_payload:enc_b64')
    .eq('user_id', userId)
    .limit(2000)
  if (error) throw new Error('lecture categories impossible')
  return Promise.all(
    (data ?? []).map(async (row: { id: string; enc_payload: string }) => {
      const p = await decryptJson<{ name?: string; isIncome?: boolean; hidden?: boolean }>(
        keys,
        base64ToBytes(row.enc_payload as string),
        ['categories', userId],
      )
      return { id: row.id as string, name: p.name ?? 'Enveloppe', isIncome: !!p.isIncome, hidden: !!p.hidden }
    }),
  )
}

/**
 * Construit et envoie les notifications utiles apres une synchronisation
 * planifiee. Best-effort : ne leve jamais (un echec de notification ne doit
 * pas faire echouer la synchro). Cout nul si l'utilisateur n'a aucun appareil
 * abonne (une seule lecture de push_state). Les calculs de budget n'utilisent
 * QUE les agregats (jamais l'historique complet) : agregats non prets = pas de
 * notification de budget ce tour-ci.
 */
export async function notifyAfterSync(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
  outcome: SyncOutcome,
  today: string,
): Promise<void> {
  try {
    const state = await loadPushState(admin, keys, userId)
    if (!state || state.subscriptions.length === 0) return
    const month = today.slice(0, 7)
    const prefs = state.prefs
    const sent: PushSent = { ...state.sent }
    const messages: PushMessage[] = []

    // 1. Consentement bancaire : paliers J-14, J-7, J-3, J-1, puis expire.
    if (prefs.consent) {
      const consent: Record<string, number> = { ...(sent.consent ?? {}) }
      const connections = await loadConnections(admin, keys, userId)
      for (const c of connections) {
        if (!c.validUntil) continue
        const daysLeft = Math.ceil((Date.parse(c.validUntil) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000)
        const step = c.sessionState === 'expired' ? 0 : consentStep(daysLeft)
        if (step === null) {
          delete consent[c.id] // reconnectee : on rearme les paliers
          continue
        }
        if (consent[c.id] !== undefined && consent[c.id] <= step) continue
        consent[c.id] = step
        messages.push(
          step === 0
            ? {
                title: 'Connexion bancaire expirée',
                body: `${c.institution} ne se synchronise plus. Reconnecte-la depuis Comptes.`,
                url: '#/comptes',
                tag: `consent-${c.id}`,
              }
            : {
                title: 'Connexion bancaire à renouveler',
                body: `${c.institution} expire dans ${daysLeft} jour${daysLeft > 1 ? 's' : ''}. Reconnecte-la depuis Comptes.`,
                url: '#/comptes',
                tag: `consent-${c.id}`,
              },
        )
      }
      for (const id of Object.keys(consent)) if (!connections.some((c) => c.id === id)) delete consent[id]
      sent.consent = consent
    }

    // 2. Echec de synchronisation : une fois par jour au plus.
    if (prefs.syncError && outcome.errors.length > 0 && sent.syncErrorDay !== today) {
      sent.syncErrorDay = today
      messages.push({
        title: 'Synchronisation bancaire en échec',
        body: 'Les dernières transactions ne sont pas arrivées. Ouvre l’app pour relancer la synchro.',
        url: '#/comptes',
        tag: 'sync-error',
      })
    }

    // 3. Budget (agregats uniquement).
    const wantBudget = prefs.imports || prefs.income || prefs.overspent || prefs.monthStart
    if (wantBudget && (await aggIsReady(admin, keys, userId))) {
      const [categories, rollups, settings] = await Promise.all([
        loadCategoryInfo(admin, keys, userId),
        aggReadRollups(admin, keys, userId),
        loadUserSettings(admin, keys, userId),
      ])
      const budget = computeBudget(
        rollupsToEngineInput(categories, rollups, month, settings.budgetStartMonth, month),
      )
      const rta = budget.readyToAssign

      // Nouvelles transactions (et combien attendent une categorie).
      if (prefs.imports && outcome.imported > 0) {
        const uncat = await aggReadUncatCount(admin, keys, userId, month)
        const n = outcome.imported
        messages.push({
          title: `${n} nouvelle${n > 1 ? 's' : ''} transaction${n > 1 ? 's' : ''}`,
          body:
            uncat > 0
              ? `${uncat} à catégoriser. Touche pour les trier.`
              : 'Tout est déjà catégorisé.',
          url: uncat > 0 ? '#/trier' : '#/transactions',
          tag: 'imports',
        })
      }

      // Argent arrive : le Pret a assigner a augmente depuis le dernier signal.
      const prevRta = sent.rta?.month === month ? sent.rta.amount : null
      if (prefs.income && outcome.imported > 0 && rta > 0 && (prevRta === null || rta > prevRta)) {
        messages.push({
          title: 'De l’argent à assigner',
          body: `${formatCents(rta)} prêts à assigner. Donne un rôle à chaque euro.`,
          url: '#/budget',
          tag: 'income',
        })
      }
      sent.rta = { month, amount: rta }

      // Enveloppes nouvellement depassees ce mois-ci.
      if (prefs.overspent) {
        const byId = new Map(categories.map((c) => [c.id, c]))
        const over = budget.categories.filter((c) => {
          const info = byId.get(c.categoryId)
          return info && !info.isIncome && !info.hidden && c.available < 0
        })
        const known = new Set(sent.overspent?.month === month ? sent.overspent.ids : [])
        const fresh = over.filter((c) => !known.has(c.categoryId))
        if (fresh.length > 0) {
          const lines = fresh
            .slice(0, 3)
            .map((c) => `${byId.get(c.categoryId)!.name} : ${formatCents(c.available)}`)
          if (fresh.length > 3) lines.push(`et ${fresh.length - 3} autre${fresh.length > 4 ? 's' : ''}`)
          messages.push({
            title: fresh.length > 1 ? `${fresh.length} enveloppes dépassées` : 'Enveloppe dépassée',
            body: `${lines.join(', ')}. Couvre-les depuis une autre enveloppe.`,
            url: '#/budget',
            tag: 'overspent',
          })
        }
        // On ne garde que celles encore dans le rouge : une enveloppe couverte
        // puis de nouveau depassee sera signalee a nouveau.
        sent.overspent = { month, ids: over.map((c) => c.categoryId) }
      }

      // Nouveau mois : premiere synchro du mois.
      if (prefs.monthStart && sent.monthStart !== month) {
        sent.monthStart = month
        messages.push({
          title: `Bienvenue en ${monthName(month)}`,
          body:
            rta > 0
              ? `${formatCents(rta)} à assigner. Prépare ton budget du mois.`
              : `Prépare ton budget de ${monthName(month)} : vérifie tes enveloppes.`,
          url: '#/budget',
          tag: 'month-start',
        })
      }
    }

    let next: PushState = { ...state, sent }
    for (const msg of messages) {
      const r = await sendToDevices(next, msg)
      next = r.state
      if (next.subscriptions.length === 0) break
    }
    if (JSON.stringify(next) !== JSON.stringify(state)) await savePushState(admin, keys, userId, next)
  } catch {
    // best-effort : jamais bloquant pour la synchro
  }
}
