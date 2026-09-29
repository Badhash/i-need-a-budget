// Toasts globaux : store zustand + API imperative utilisable partout (onError
// d'une mutation, callbacks, composants). Rendu par <Toaster /> (AppShell).
//
//   const id = toast({ message: 'Transaction supprimée', action: { label: 'Annuler', onClick } })
//   dismissToast(id)
//
// Duree par defaut 5 s (0 = collant jusqu'a fermeture). Au plus 3 toasts
// visibles : au-dela, les plus anciens sortent. Un `id` existant remplace le
// toast en place (et relance sa minuterie) au lieu d'en empiler un nouveau.

import { create } from 'zustand'

export type ToastTone = 'default' | 'success' | 'warning' | 'danger'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  message: string
  description?: string
  tone?: ToastTone
  /** Bouton d'action ; un clic execute onClick PUIS ferme le toast. */
  action?: ToastAction
  /** Duree d'affichage en ms (defaut 5000, 0 = collant). */
  duration?: number
  /** Identifiant stable : remplace le toast du meme id s'il est affiche. */
  id?: string
}

export interface ToastItem {
  id: string
  message: string
  description?: string
  tone: ToastTone
  action?: ToastAction
  duration: number
  /** Animation de sortie en cours (retire du store a la fin). */
  closing: boolean
  /** Incremente a chaque remplacement (meme id) : relance la minuterie. */
  version: number
}

export const TOAST_DEFAULT_DURATION = 5000
export const TOAST_MAX_VISIBLE = 3
/** Duree de l'animation de sortie (animate-toast-out). */
const EXIT_MS = 180

interface ToastState {
  toasts: ToastItem[]
}

export const useToastStore = create<ToastState>(() => ({ toasts: [] }))

let seq = 0

function removeIfClosing(id: string): void {
  useToastStore.setState((s) => ({ toasts: s.toasts.filter((t) => !(t.id === id && t.closing)) }))
}

function scheduleRemoval(ids: string[]): void {
  if (ids.length === 0) return
  window.setTimeout(() => ids.forEach(removeIfClosing), EXIT_MS)
}

/** Affiche un toast et renvoie son identifiant. */
export function toast(options: ToastOptions): string {
  const id = options.id ?? `toast-${Date.now().toString(36)}-${(seq++).toString(36)}`
  const overflow: string[] = []
  useToastStore.setState((s) => {
    const existing = s.toasts.find((t) => t.id === id)
    const item: ToastItem = {
      id,
      message: options.message,
      description: options.description,
      tone: options.tone ?? 'default',
      action: options.action,
      duration: Math.max(0, options.duration ?? TOAST_DEFAULT_DURATION),
      closing: false,
      version: existing ? existing.version + 1 : 0,
    }
    let toasts = existing ? s.toasts.map((t) => (t.id === id ? item : t)) : [...s.toasts, item]
    // Plafond de toasts visibles : les plus anciens sortent (animation).
    const visible = toasts.filter((t) => !t.closing)
    const excess = visible.length - TOAST_MAX_VISIBLE
    if (excess > 0) {
      const oldest = new Set(visible.slice(0, excess).map((t) => t.id))
      toasts = toasts.map((t) => (oldest.has(t.id) ? { ...t, closing: true } : t))
      overflow.push(...oldest)
    }
    return { toasts }
  })
  scheduleRemoval(overflow)
  return id
}

/** Ferme un toast (animation de sortie puis retrait). Sans effet s'il n'existe plus. */
export function dismissToast(id: string): void {
  let found = false
  useToastStore.setState((s) => ({
    toasts: s.toasts.map((t) => {
      if (t.id !== id || t.closing) return t
      found = true
      return { ...t, closing: true }
    }),
  }))
  if (found) scheduleRemoval([id])
}
