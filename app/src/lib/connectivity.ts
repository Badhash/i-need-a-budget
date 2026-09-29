// Connectivite : source unique de l'etat en ligne / hors ligne, partagee par
// TanStack Query (onlineManager : pause et reprise des requetes et des
// mutations) et par l'interface (pastille hors ligne, indicateur de fraicheur).
//
// TanStack ne se fie qu'aux evenements online/offline du navigateur, qui ne
// voient pas tout : reseau present mais serveur injoignable (wifi captif,
// reprise d'une PWA iOS apres l'arriere-plan, « Load failed »). On complete
// donc par l'observation des appels /api : un echec reseau declenche une SONDE
// legere ; si elle echoue aussi, l'app passe hors ligne (les mutations se
// mettent en pause, leur etat optimiste reste affiche) et resonde a intervalle
// croissant jusqu'au retour du reseau. Toute reponse du serveur, meme une
// erreur HTTP, prouve que le reseau est revenu.
//
// La sonde ne touche ni Postgres ni les Edge Functions : un GET sans en-tete ni
// identifiants vers la passerelle Supabase (mode no-cors). N'importe quelle
// reponse (401 compris) resout la requete ; seule une coupure la rejette.

import { useSyncExternalStore } from 'react'
import { onlineManager } from '@tanstack/react-query'
import { SUPABASE_URL } from '@/lib/supabase'

const DEMO = import.meta.env.VITE_DEMO === '1'

/** Echec de transport : la requete n'a obtenu aucune reponse du serveur. */
export class NetworkError extends Error {
  constructor(message = 'Connexion au serveur impossible.') {
    super(message)
    this.name = 'NetworkError'
  }
}

/**
 * Vrai pour un echec reseau (et jamais pour une erreur metier 4xx/5xx) :
 * NetworkError, ou TypeError leve par fetch() sans reseau ('Failed to fetch'
 * Chrome, 'Load failed' Safari, 'NetworkError when attempting…' Firefox).
 */
export function isNetworkError(err: unknown): boolean {
  if (err instanceof NetworkError) return true
  return err instanceof TypeError && FETCH_FAILURE.test(err.message.trim())
}

// Messages exacts des navigateurs (un TypeError de programmation qui cite
// « fetch » ne doit pas passer pour une coupure).
const FETCH_FAILURE =
  /^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?|network request failed|the network connection was lost\.?)$/i

// Intervalles de sonde tant que le serveur reste injoignable (le dernier se
// repete). Courts au debut : une coupure breve (tunnel, ascenseur) se resorbe
// vite ; plafonnes ensuite pour ne pas user la batterie.
const PROBE_DELAYS_MS = [2000, 4000, 8000, 15000, 30000]
const PROBE_TIMEOUT_MS = 8000

let probeTimer: ReturnType<typeof setTimeout> | null = null
let probeStep = 0
let inFlight: Promise<boolean> | null = null
let checking = false
const checkingListeners = new Set<() => void>()

function setChecking(value: boolean): void {
  if (checking === value) return
  checking = value
  checkingListeners.forEach((listener) => listener())
}

async function probe(): Promise<boolean> {
  if (DEMO) {
    // Mode demonstration : le reseau est simule (src/dev/demo, offline=1) et le
    // navigateur hors ligne (Playwright setOffline) compte aussi. Une action de
    // lecture inconnue suffit : erreur metier = serveur joignable.
    if (!navigator.onLine) return false
    try {
      const { demoApiCall } = await import('@/dev/demo')
      await demoApiCall('getPing')
      return true
    } catch (err) {
      return !isNetworkError(err)
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/health?probe=${Date.now()}`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function clearProbeTimer(): void {
  if (probeTimer) clearTimeout(probeTimer)
  probeTimer = null
}

function scheduleProbe(): void {
  clearProbeTimer()
  const delay = PROBE_DELAYS_MS[Math.min(probeStep, PROBE_DELAYS_MS.length - 1)]!
  probeStep += 1
  probeTimer = setTimeout(() => {
    probeTimer = null
    void checkConnectivity()
  }, delay)
}

function goOnline(): void {
  clearProbeTimer()
  probeStep = 0
  onlineManager.setOnline(true)
}

function goOffline(): void {
  onlineManager.setOnline(false)
  if (!probeTimer && !inFlight) scheduleProbe()
}

/**
 * Sonde le serveur maintenant (une seule sonde a la fois) et met l'etat a
 * jour. Renvoie true si le serveur est joignable. Appelee par la boucle de
 * sonde, au retour au premier plan, et par un appui sur la pastille ou
 * l'indicateur de fraicheur.
 */
export function checkConnectivity(): Promise<boolean> {
  if (inFlight) return inFlight
  clearProbeTimer()
  setChecking(true)
  inFlight = probe()
    .then((ok) => {
      if (ok) goOnline()
      else goOffline()
      return ok
    })
    .finally(() => {
      inFlight = null
      setChecking(false)
      // Toujours hors ligne : la boucle continue (goOffline n'a pas pu la
      // relancer tant que cette sonde etait en vol).
      if (!onlineManager.isOnline() && !probeTimer) scheduleProbe()
    })
  return inFlight
}

/**
 * Un appel /api vient d'echouer faute de reseau. En ligne, on verifie par une
 * sonde avant de basculer (un echec isole ne met pas l'app hors ligne) ; deja
 * hors ligne, la boucle de sonde s'en charge.
 */
export function reportNetworkFailure(): void {
  if (onlineManager.isOnline()) void checkConnectivity()
}

/** Le serveur a repondu (meme par une erreur HTTP) : le reseau fonctionne. */
export function reportNetworkSuccess(): void {
  // Demo : le reseau simule repond meme navigateur hors ligne ; on s'en tient
  // alors a l'etat du navigateur.
  if (DEMO && !navigator.onLine) return
  if (!onlineManager.isOnline()) goOnline()
}

let installed = false

/**
 * Branche la connectivite sur TanStack (une fois, avant le montage du
 * QueryClient) : evenements du navigateur, etat initial, retour au premier
 * plan. Remplace l'ecouteur par defaut de onlineManager.
 */
export function installConnectivity(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  onlineManager.setEventListener(() => {
    // Retour du reseau annonce par le systeme : on y croit tout de suite (un
    // echec le contredira) ; perte annoncee : hors ligne sans attendre.
    const onOnline = () => goOnline()
    const onOffline = () => goOffline()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  })
  // navigator.onLine === false est fiable (true ne l'est pas) : l'app demarre
  // hors ligne si le systeme le dit, et la sonde confirmera ou corrigera.
  if (navigator.onLine === false) goOffline()
  // Deverrouillage du telephone, retour sur l'onglet : sonde immediate plutot
  // que d'attendre la prochaine echeance de la boucle.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !onlineManager.isOnline()) void checkConnectivity()
  })
}

function subscribeOnline(listener: () => void): () => void {
  return onlineManager.subscribe(() => listener())
}

/** Etat en ligne vu par TanStack (evenements du navigateur + sondes). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => onlineManager.isOnline(), () => true)
}

function subscribeChecking(listener: () => void): () => void {
  checkingListeners.add(listener)
  return () => {
    checkingListeners.delete(listener)
  }
}

/** Vrai pendant une sonde de connectivite (retour visuel de verification en cours). */
export function useCheckingConnectivity(): boolean {
  return useSyncExternalStore(subscribeChecking, () => checking, () => false)
}
