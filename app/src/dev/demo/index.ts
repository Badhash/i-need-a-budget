// MODE DEMONSTRATION (INAB_DEMO_MODULE) — l'app complete tourne dans le
// navigateur, sans Supabase, sur un jeu de donnees factice realiste servi par
// un serveur /api en memoire (miroir de l'Edge Function). Sert aux captures
// d'ecran de chaque vue (mobile/desktop, clair/sombre) et de demo.
//
// Lancer :
//   cd app && npm run demo            (equivalent : VITE_DEMO=1 npx vite)
//   puis ouvrir http://localhost:5173/#/budget
// Build de demonstration : VITE_DEMO=1 npx vite build (le build normal n'en
// contient AUCUNE trace : ce module n'est charge que par import dynamique
// derriere import.meta.env.VITE_DEMO === '1', branche morte hors demo).
//
// Parametres d'URL (lus UNE fois au chargement, dans location.search ou dans
// la query du hash : /?latency=0#/budget ou /#/budget?latency=0) :
//   features=none        serveur ANCIEN : aucune fonctionnalite annoncee (pas
//                        d'objectif « recharger », virement vers le PEA non
//                        categorise et neutre) ; features=a,b liste explicite ;
//                        par defaut, toutes celles de lib/features.ts
//   latency=0            sans latence simulee (defaut 120-300 ms par appel) ;
//                        latency=800 fixe la latence a 800 ms
//   fail=setAssigned,sync  ces actions (/api ou sync-bank) echouent :
//                        ApiError(500, 'erreur simulee')
//   offline=1            tout appel echoue comme sans reseau (TypeError
//                        'Failed to fetch')
//
// Les ecritures modifient la base en memoire de la session ; un rechargement
// repart du jeu de donnees initial, ancre sur la date du jour.

import { installDemoSession } from './session'

export { demoApiCall } from './server'
export { demoSyncBankCall } from './bank'
export { DEMO_SESSION } from './session'

/** Marqueur unique du module (verification d'absence dans le build de prod). */
export const DEMO_MARKER = 'INAB_DEMO_MODULE'

/**
 * Active le mode demonstration AVANT le premier rendu (appele par main.tsx) :
 * session factice synchrone, Supabase Auth neutralise, marqueur sur <html>.
 */
export function installDemo(): void {
  document.documentElement.dataset.demo = DEMO_MARKER
  installDemoSession()
}
