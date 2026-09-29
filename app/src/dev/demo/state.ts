// Mode demonstration : configuration (parametres d'URL lus UNE fois au
// chargement du module), base en memoire (singleton de session), retour de
// consentement bancaire simule et simulation du reseau (latence, echecs
// cibles, hors ligne).

import { ApiError } from '@/lib/api'
import { SERVER_FEATURES } from '@/lib/features'
import { createDemoDb } from './data'
import type { DemoDb } from './db'
import { applyConsent } from './logic'

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

const DEFAULT_LATENCY = { min: 120, max: 300 }

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

  let latency = DEFAULT_LATENCY
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

/** Parametres d'URL reproduisant une configuration (rechargement fidele). */
export function demoConfigParams(config: DemoConfig): URLSearchParams {
  const params = new URLSearchParams()
  if (!ALL_FEATURES.every((f) => config.features.includes(f))) {
    params.set('features', config.features.length > 0 ? config.features.join(',') : 'none')
  }
  if (config.latency.min !== DEFAULT_LATENCY.min || config.latency.max !== DEFAULT_LATENCY.max) {
    params.set('latency', String(config.latency.min))
  }
  if (config.fail.size > 0) params.set('fail', [...config.fail].join(','))
  if (config.offline) params.set('offline', '1')
  return params
}

// Retour de consentement bancaire simule (startAuth, cf. bank.ts) : la page est
// rechargee comme au retour de la banque. Le parametre porte la banque
// consentie ; la base de la session voyage dans sessionStorage le temps de
// l'aller-retour, pour que les ecritures de la demo survivent au rechargement.
const CONSENT_PARAM = 'consentement'
const SNAPSHOT_KEY = 'inab-demo-db'

const startupParams = readUrlParams()
export const demoConfig: DemoConfig = parseDemoConfig(startupParams)
export const demoFeatures: ReadonlySet<string> = new Set(demoConfig.features)
const consentReturn = startupParams.get(CONSENT_PARAM)

export function hasFeature(feature: string): boolean {
  return demoFeatures.has(feature)
}

let db: DemoDb | null = null

/** Base de la session (creee au premier appel ; perdue au rechargement, sauf retour de consentement). */
export function demoDb(): DemoDb {
  db ??= initialDb()
  return db
}

function initialDb(): DemoDb {
  if (consentReturn === null) {
    // Chargement ordinaire : un instantane orphelin (navigation annulee) est jete.
    try {
      sessionStorage.removeItem(SNAPSHOT_KEY)
    } catch {
      // Stockage indisponible : rien a nettoyer.
    }
    return createDemoDb(demoFeatures)
  }
  // Retour de consentement : base d'avant l'aller-retour (sinon jeu initial),
  // puis consentement accorde, comme finalizeAuth au retour de la banque.
  const base = takeSnapshot() ?? createDemoDb(demoFeatures)
  applyConsent(base, consentReturn)
  return base
}

// Instantane depose par consentReturnUrl, consomme une seule fois.
function takeSnapshot(): DemoDb | null {
  try {
    const raw = sessionStorage.getItem(SNAPSHOT_KEY)
    sessionStorage.removeItem(SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DemoDb
    return Array.isArray(parsed.accounts) && Array.isArray(parsed.transactions) ? parsed : null
  } catch {
    return null
  }
}

/**
 * URL de « retour de la banque » du consentement simule : meme page, vraiment
 * rechargee (le bouton du front attend une navigation pour se liberer), sur
 * les reglages, avec les parametres de la demo et la banque consentie. La base
 * de la session est confiee a sessionStorage le temps du rechargement.
 */
export function consentReturnUrl(institution: string): string {
  try {
    if (db) sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(db))
  } catch {
    // Stockage indisponible : le retour repart du jeu de donnees initial.
  }
  const url = new URL(window.location.href)
  const params = demoConfigParams(demoConfig)
  params.set(CONSENT_PARAM, institution)
  url.search = params.toString()
  url.hash = '#/reglages'
  return url.toString()
}

/**
 * Retire de l'URL le parametre de retour de consentement (sans recharger) :
 * un rechargement manuel ne rejoue pas le retour, et le prochain consentement
 * produit toujours une URL differente, donc une vraie navigation.
 */
export function clearConsentParam(): void {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(CONSENT_PARAM)) return
  url.searchParams.delete(CONSENT_PARAM)
  window.history.replaceState(window.history.state, '', url.toString())
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
