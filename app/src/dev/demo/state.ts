// Mode demonstration : configuration (parametres d'URL lus UNE fois au
// chargement du module), base en memoire (singleton de session) et simulation
// du reseau (latence, echecs cibles, hors ligne).

import { ApiError } from '@/lib/api'
import { SERVER_FEATURES } from '@/lib/features'
import { createDemoDb } from './data'
import type { DemoDb } from './db'

export interface DemoConfig {
  /** Fonctionnalites annoncees par le serveur factice (bootstrap.features). */
  features: string[]
  /** Latence simulee par appel, en millisecondes (bornes incluses). */
  latency: { min: number; max: number }
  /** Actions qui echouent systematiquement (ApiError 500 'erreur simulee'). */
  fail: Set<string>
  /** Tout appel echoue comme sans reseau (TypeError 'Failed to fetch'). */
  offline: boolean
}

export const ALL_FEATURES: string[] = Object.values(SERVER_FEATURES)

// Parametres lus dans location.search ET dans la query du hash (#/budget?x=y) :
// le hash-router ne garde pas toujours la query lors des redirections, d'ou
// la lecture unique au demarrage.
function readUrlParams(): URLSearchParams {
  const merged = new URLSearchParams()
  if (typeof window === 'undefined') return merged
  const add = (query: string) => new URLSearchParams(query).forEach((value, key) => merged.set(key, value))
  add(window.location.search)
  const hash = window.location.hash
  const q = hash.indexOf('?')
  if (q >= 0) add(hash.slice(q + 1))
  return merged
}

export function parseDemoConfig(params: URLSearchParams): DemoConfig {
  let features = ALL_FEATURES
  const rawFeatures = params.get('features')
  if (rawFeatures !== null) {
    const list = rawFeatures
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    features = list.includes('all') ? ALL_FEATURES : list.filter((f) => ALL_FEATURES.includes(f))
  }

  let latency = { min: 120, max: 300 }
  const rawLatency = params.get('latency')
  if (rawLatency !== null && /^\d+$/.test(rawLatency)) {
    const ms = Number(rawLatency)
    latency = { min: ms, max: ms }
  }

  const fail = new Set(
    (params.get('fail') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  const rawOffline = params.get('offline')
  return { features, latency, fail, offline: rawOffline === '1' || rawOffline === 'true' }
}

export const demoConfig: DemoConfig = parseDemoConfig(readUrlParams())
export const demoFeatures: ReadonlySet<string> = new Set(demoConfig.features)

export function hasFeature(feature: string): boolean {
  return demoFeatures.has(feature)
}

let db: DemoDb | null = null

/** Base de la session (creee au premier appel, perdue au rechargement). */
export function demoDb(): DemoDb {
  db ??= createDemoDb(demoFeatures)
  return db
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Appel reseau simule. Le traitement s'execute IMMEDIATEMENT, dans l'ordre
 * d'arrivee des appels (pas de reordonnancement artificiel entre deux
 * ecritures rapprochees) ; seule la reponse est retardee par la latence.
 * Un appel en echec (fail=..., offline=1) ne modifie rien. Hors ligne, le
 * rejet imite celui de fetch() (TypeError), comme un vrai appel sans reseau.
 */
export async function simulateCall<T>(action: string, handle: () => T): Promise<T> {
  let failure: Error | null = null
  if (demoConfig.offline) failure = new TypeError('Failed to fetch')
  else if (demoConfig.fail.has(action)) failure = new ApiError(500, 'erreur simulee')
  let outcome: { ok: true; value: T } | { ok: false; error: unknown } | null = null
  if (!failure) {
    try {
      outcome = { ok: true, value: handle() }
    } catch (error) {
      outcome = { ok: false, error }
    }
  }
  const { min, max } = demoConfig.latency
  const ms = min + Math.random() * (max - min)
  if (ms > 0) await sleep(ms)
  if (failure) throw failure
  if (outcome && !outcome.ok) throw outcome.error
  return (outcome as { ok: true; value: T }).value
}
