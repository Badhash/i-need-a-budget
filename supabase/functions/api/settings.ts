// Reglages utilisateur chiffres (REF M, table user_settings : 1 ligne / user).
// Partage entre /api et sync-bank. Contenu : le mois de depart du budget
// (« Nouveau budget ») et le perimetre des rapports (categories hors depenses,
// choix manuels par transaction). Table toleree absente : aucun reglage.
// Toute ecriture part des reglages relus (saveUserSettings ecrit le payload
// ENTIER) : un champ omis serait efface.
//
// INTERDIT : logger des payloads dechiffres ou la cle.

import {
  base64ToBytes,
  bytesToPgHex,
  decryptJson,
  encryptJson,
  type CryptoKeys,
} from '../../../packages/crypto/src/index.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'

/** Choix manuel sur une transaction : ecartee des rapports, ou gardee malgre la detection. */
export type ReportOverride = 'exclude' | 'include'

/**
 * Perimetre des rapports (lu par le front seul, jamais par le moteur) :
 * - excludedCategories : categories dont les sorties ne comptent pas comme des
 *   depenses (epargne, investissement, argent mis de cote pour un proche) ;
 * - overrides : choix manuels par transaction, prioritaires sur la detection
 *   automatique des operations exceptionnelles (faite cote front).
 */
export interface ReportSettings {
  excludedCategories: string[]
  overrides: Record<string, ReportOverride>
}

export interface UserSettings {
  /** Mois de depart du budget (YYYY-MM) ; null = budget depuis l'origine. */
  budgetStartMonth: string | null
  reports: ReportSettings
}

export const EMPTY_REPORTS: ReportSettings = { excludedCategories: [], overrides: {} }
const EMPTY: UserSettings = { budgetStartMonth: null, reports: EMPTY_REPORTS }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Relecture tolerante d'un perimetre stocke (forme ancienne ou partielle). */
function readReports(raw: unknown): ReportSettings {
  if (!raw || typeof raw !== 'object') return EMPTY_REPORTS
  const r = raw as { excludedCategories?: unknown; overrides?: unknown }
  const excludedCategories = Array.isArray(r.excludedCategories)
    ? r.excludedCategories.filter((id): id is string => typeof id === 'string' && UUID.test(id))
    : []
  const overrides: Record<string, ReportOverride> = {}
  if (r.overrides && typeof r.overrides === 'object') {
    for (const [id, flag] of Object.entries(r.overrides as Record<string, unknown>)) {
      if (UUID.test(id) && (flag === 'exclude' || flag === 'include')) overrides[id] = flag
    }
  }
  return { excludedCategories, overrides }
}

const CTX = (userId: string) => ['user_settings', userId]

function isMissingTable(error: { code?: string } | null): boolean {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01')
}

export async function loadUserSettings(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
): Promise<UserSettings> {
  const { data, error } = await admin
    .from('user_settings')
    .select('enc_payload:enc_b64')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    if (isMissingTable(error)) return EMPTY
    throw new Error('lecture user_settings impossible')
  }
  if (!data) return EMPTY
  const p = await decryptJson<Partial<UserSettings>>(
    keys,
    base64ToBytes(data.enc_payload as string),
    CTX(userId),
  )
  return { budgetStartMonth: p.budgetStartMonth ?? null, reports: readReports(p.reports) }
}

export async function saveUserSettings(
  admin: SupabaseClient,
  keys: CryptoKeys,
  userId: string,
  settings: UserSettings,
): Promise<void> {
  const { error } = await admin.from('user_settings').upsert(
    {
      user_id: userId,
      enc_payload: bytesToPgHex(await encryptJson(keys, settings, CTX(userId))),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  )
  if (error) {
    if (isMissingTable(error)) {
      throw new Error('table user_settings absente : appliquer M-user-settings.sql')
    }
    throw new Error('ecriture user_settings impossible')
  }
}

/** Supprime les reglages (retour au comportement historique). Table absente toleree. */
export async function clearUserSettings(admin: SupabaseClient, userId: string): Promise<void> {
  const { error } = await admin.from('user_settings').delete().eq('user_id', userId)
  if (error && !isMissingTable(error)) throw new Error('effacement user_settings impossible')
}
