// Fichiers generes par les reglages (export, sauvegarde de securite) :
// preparation et enregistrement, y compris sur iPhone. Safari (onglet)
// telecharge un lien blob avec l'attribut download si l'URL n'est pas revoquee
// trop tot ; l'app installee sur l'ecran d'accueil passe par la feuille de
// partage (« Enregistrer dans Fichiers »), plus fiable en mode standalone.

import { apiCall } from '@/lib/api'
import { standaloneConsent } from '@/lib/bank'
import type { SavedFile } from '@/lib/ynabImport'

const LAST_BACKUP_KEY = 'inab-last-backup'

function stamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}h${pad(date.getMinutes())}`
}

/** Exporte toutes les donnees dechiffrees (action exportData) en fichier JSON. */
export async function fetchBackup(prefix: string): Promise<SavedFile> {
  const data = await apiCall<unknown>('exportData')
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  return { blob, filename: `inab-${prefix}-${stamp()}.json` }
}

function downloadLink(file: SavedFile): void {
  const url = URL.createObjectURL(file.blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revocation differee : Safari peut annuler le telechargement si l'URL est
  // revoquee de facon synchrone juste apres le clic.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Enregistre un fichier. A appeler dans le geste de l'utilisateur (clic) :
 * la feuille de partage l'exige. Renvoie false si l'utilisateur a ferme la
 * feuille de partage sans enregistrer.
 */
export async function saveFile(file: SavedFile): Promise<boolean> {
  const nav = window.navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (standaloneConsent() !== null && typeof nav.share === 'function') {
    const shared = new File([file.blob], file.filename, { type: 'application/json' })
    if (nav.canShare?.({ files: [shared] })) {
      try {
        await nav.share({ files: [shared], title: file.filename })
        markBackupSaved()
        return true
      } catch (err) {
        // Feuille fermee par l'utilisateur : rien d'enregistre, pas de repli.
        if (err instanceof DOMException && err.name === 'AbortError') return false
        // Geste expire ou partage refuse : repli sur le lien de telechargement.
      }
    }
  }
  downloadLink(file)
  markBackupSaved()
  return true
}

/** Taille lisible d'un fichier (Ko / Mo, format fr-FR). */
export function fmtSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('fr-FR')} Ko`
  return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`
}

// Date de la derniere sauvegarde enregistree SUR CET APPAREIL (confort
// d'affichage uniquement : jamais une donnee metier).
export function markBackupSaved(): void {
  try {
    localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString())
    window.dispatchEvent(new Event(LAST_BACKUP_KEY))
  } catch {
    // Stockage indisponible (navigation privee) : sans effet.
  }
}

export function readLastBackup(): string | null {
  try {
    return localStorage.getItem(LAST_BACKUP_KEY)
  } catch {
    return null
  }
}

export const LAST_BACKUP_EVENT = LAST_BACKUP_KEY
